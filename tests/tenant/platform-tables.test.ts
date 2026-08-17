import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, admin, anonClient, TEST_PREFIX, type Tenant } from "./harness";
import { createTenant, listTenants } from "../../lib/platform/provision";
import {
  listBilling,
  recordPayment,
  saveSubscription,
  voidLastPayment,
} from "../../lib/platform/billing-db";
import { periodEnd } from "../../lib/platform/billing";

/**
 * 🚨 เทสที่สำคัญที่สุดของงานแอปจัดการหลังบ้าน (DoD ข้อ 2 ใน docs/ADMIN_APP_REQUIREMENTS.md)
 *
 * ตารางใหม่ใน Postgres **ไม่มี RLS โดยปริยาย = ใครถือ anon key ก็อ่านได้**
 * และ anon key เป็นค่าสาธารณะที่ฝังอยู่ในหน้าเว็บของลูกค้าทุกคน
 * → ลืมเปิด RLS ให้ตารางแพลตฟอร์มทีเดียว = ข้อมูลเชิงพาณิชย์ (ใครเป็นลูกค้า/แพ็กเกจ/ราคา)
 *   รั่วให้ลูกค้าทุกเจ้าเห็น และจะไม่มีอะไรฟ้องเลยจนกว่าจะมีคนไปดู
 *
 * 3 แกนที่ต้องพิสูจน์:
 *   1. ลูกค้าที่ล็อกอินอยู่ (authenticated) อ่าน/เขียนตารางแพลตฟอร์มไม่ได้
 *   2. คนที่ยังไม่ล็อกอิน (anon) ก็ไม่ได้
 *   3. positive control — service role ยังอ่านได้ (ไม่งั้นเทสผ่านเพราะ "ไม่มีข้อมูลเลย")
 */

/** ทุกตารางของแพลตฟอร์ม — เพิ่มตารางใหม่เมื่อไหร่ **ต้องเพิ่มที่นี่ด้วย**
 *  เพราะ loop ข้างล่างคือสิ่งเดียวที่พิสูจน์ว่าไม่ได้ลืมเปิด RLS */
const PLATFORM_TABLES = [
  "platform_admins",
  "platform_admin_log",
  "subscriptions",          // 🚨 มีราคาที่ลูกค้าแต่ละเจ้าจ่าย (0037)
  "subscription_payments",
] as const;

let A: Tenant;
let asA: SupabaseClient;
let anon: SupabaseClient;
let ownerId: string;

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("plat");
  asA = await signIn(A);
  anon = anonClient();

  const db = admin();
  const { data: prof } = await db
    .from("profiles").select("id").eq("username", A.username).single();
  ownerId = prof!.id as string;

  // ★ ต้องมี "ของจริง" อยู่ในตารางก่อน ไม่งั้นเทสผ่านเพราะตารางว่าง ไม่ใช่เพราะ RLS ทำงาน
  const { error: aErr } = await db
    .from("platform_admins").upsert({ user_id: ownerId, note: "zz-test แถวสำหรับเทส" });
  if (aErr) throw new Error(`seed platform_admins: ${aErr.message}`);

  const { error: lErr } = await db.from("platform_admin_log").insert({
    actor: ownerId, action: "zz-test-action", tenant_slug: A.slug, detail: { note: "ทดสอบ" },
  });
  if (lErr) throw new Error(`seed platform_admin_log: ${lErr.message}`);

  // ค่างวด (0037) — ต้องมีของจริงในตารางเหมือนกัน ไม่งั้น deny-all ผ่านเพราะตารางว่าง
  await saveSubscription(db, A.tenantId, {
    plan: "แพ็กเกจทดสอบ",
    price: 1234,
    cycle: "monthly",
    startedOn: "2026-01-31", // ★ สิ้นเดือน — ใช้พิสูจน์เรื่อง drift ด้วยในตัว
    status: "active",
    note: "ทดสอบ",
    billingNotice: true,
  });
  await recordPayment(db, A.tenantId, {
    amount: 1234, paidOn: "2026-02-01", note: "ทดสอบ", actor: ownerId,
  });
}, 180_000);

afterAll(async () => {
  const db = admin();
  await db.from("platform_admin_log").delete().eq("action", "zz-test-action");
  await db.from("tenants").delete().like("slug", `${TEST_PREFIX}%`).eq("is_platform", true);
  await asA?.auth.signOut().catch(() => {});
  await cleanupTestTenants(); // platform_admins หายตาม auth user (on delete cascade)
});

// ── แกน 1: ลูกค้าที่ล็อกอินอยู่ ───────────────────────────────────────────────
describe("★ ลูกค้าอ่านตารางของแพลตฟอร์มไม่ได้ (RLS deny-all — 0035)", () => {
  for (const table of PLATFORM_TABLES) {
    it(`${table}: select ไม่คืนแถวใด ๆ ทั้งที่มีข้อมูลอยู่จริง`, async () => {
      const { data } = await asA.from(table).select("*");
      expect(
        data ?? [],
        `${table} รั่ว — ลูกค้าเห็นข้อมูลเชิงพาณิชย์ของแพลตฟอร์ม`,
      ).toHaveLength(0);
    });

    it(`${table}: insert ถูกปฏิเสธ`, async () => {
      // Record<string, unknown> — แต่ละตารางคนละคอลัมน์ ถ้าปล่อยให้ TS อนุมาน union
      // จะฟ้องว่า type ไม่ตรงกัน (ตัวที่ยิงคือ PostgREST อยู่แล้ว ไม่ได้พึ่ง type ตรงนี้)
      const rows: Record<string, Record<string, unknown>> = {
        platform_admins: { user_id: ownerId },
        platform_admin_log: { actor: ownerId, action: "zz-test-แอบเขียน" },
        subscriptions: {
          tenant_id: A.tenantId, plan: "แอบตั้งเอง", price: 0, cycle: "monthly",
          started_on: "2026-01-01", current_period_end: "2099-01-01",
        },
        subscription_payments: {
          tenant_id: A.tenantId, amount: 0, paid_on: "2026-01-01", period_end_after: "2099-01-01",
        },
      };
      const row = rows[table];
      const { error } = await asA.from(table).insert(row);
      expect(error, `${table} เขียนได้ = ลูกค้าตั้งตัวเองเป็นแอดมินได้`).not.toBeNull();
    });

    it(`${table}: delete ไม่ลบอะไรได้จริง`, async () => {
      await asA.from(table).delete().neq("created_at", "1970-01-01");
      const { count } = await admin().from(table).select("*", { count: "exact", head: true });
      expect(count ?? 0, `${table} ถูกลูกค้าลบได้`).toBeGreaterThan(0);
    });
  }

  it("★★ ลูกค้าตั้งตัวเองเป็นแอดมินแพลตฟอร์มไม่ได้ (อ่านไม่เห็นก็เขียนไม่ได้)", async () => {
    const { error } = await asA
      .from("platform_admins")
      .upsert({ user_id: ownerId, note: "แอบตั้งตัวเอง" });
    expect(error).not.toBeNull();
  });
});

// ── แกน 2: คนที่ยังไม่ล็อกอิน ─────────────────────────────────────────────────
describe("★ anon key ยิงตรงมาก็ไม่ได้อะไร (anon key เป็นค่าสาธารณะ)", () => {
  for (const table of PLATFORM_TABLES) {
    it(`${table}: anon select ได้ว่าง/error`, async () => {
      const { data } = await anon.from(table).select("*");
      expect(data ?? []).toHaveLength(0);
    });
  }
});

// ── แกน 3: positive control ──────────────────────────────────────────────────
describe("positive control — service role ยังทำงานได้ (ไม่งั้นเทสข้างบนไร้ความหมาย)", () => {
  it("service role อ่าน platform_admins เห็นแถวที่ seed ไว้", async () => {
    const { data, error } = await admin()
      .from("platform_admins").select("user_id").eq("user_id", ownerId);
    expect(error, error?.message).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("service role อ่าน platform_admin_log เห็นแถวที่ seed ไว้", async () => {
    const { data, error } = await admin()
      .from("platform_admin_log").select("action").eq("action", "zz-test-action");
    expect(error, error?.message).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });
});

// ── ตรรกะที่ทั้งแอปแอดมินและสคริปต์ใช้ร่วมกัน ────────────────────────────────
describe("createTenant / listTenants (lib/platform/provision)", () => {
  const slug = `${TEST_PREFIX}newcust`;

  it("รับลูกค้าใหม่แล้วได้ **ระบบเปล่า** — ไม่มีข้อมูลตัวอย่างติดมาเลย (D53)", async () => {
    const db = admin();
    const { tenantId, username, password } = await createTenant(db, {
      slug,
      name: "โรงทดสอบแอดมิน",
      color: "copper",
      entityId: "EID01",
      maxEntities: 1,
      modules: ["production"],
    });

    expect(username).toBe(`owner-${slug}`);
    expect(password.length).toBeGreaterThanOrEqual(12);

    for (const t of ["products", "sale_menu", "sales_orders", "transactions", "log_ferment"]) {
      const { count } = await db
        .from(t).select("*", { count: "exact", head: true }).eq("tenant_id", tenantId);
      expect(count ?? 0, `ลูกค้าใหม่ไม่ควรมีข้อมูลในตาราง ${t}`).toBe(0);
    }

    // สิ่งที่ต้องมี: กิจการแรก + แบรนด์ + ผู้ใช้ role main
    const { data: ents } = await db.from("entities").select("entity_id, is_default").eq("tenant_id", tenantId);
    expect(ents).toHaveLength(1);
    expect(ents![0].is_default).toBe(true);

    const { data: prof } = await db
      .from("profiles").select("role, must_change_password").eq("tenant_id", tenantId).single();
    expect(prof!.role).toBe("main");
    expect(prof!.must_change_password, "ลูกค้าต้องถูกบังคับตั้งรหัสเองครั้งแรก").toBe(true);
  }, 60_000);

  it("สร้าง slug ซ้ำไม่ได้", async () => {
    await expect(
      createTenant(admin(), {
        slug, name: "ซ้ำ", color: "steel", entityId: "EID01", maxEntities: 1, modules: ["sales"],
      }),
    ).rejects.toThrow();
  });

  it("★ listTenants ไม่แสดงแถว is_platform (แถวผูกบัญชีแอดมิน ไม่ใช่ลูกค้า)", async () => {
    const db = admin();
    const platformSlug = `${TEST_PREFIX}platformrow`;
    const { error } = await db
      .from("tenants")
      .insert({ slug: platformSlug, name: "แถวแอดมินทดสอบ", is_platform: true, is_active: false });
    expect(error, error?.message).toBeNull();

    const rows = await listTenants(db);
    expect(rows.some((r) => r.slug === platformSlug), "แถวของแอดมินหลุดเข้ารายชื่อลูกค้า").toBe(false);
    expect(rows.some((r) => r.slug === slug), "ลูกค้าจริงต้องอยู่ในรายชื่อ").toBe(true);
  });

  it("listTenants คืนจำนวนกิจการ/ผู้ใช้/โมดูล ตรงกับที่สร้างไว้", async () => {
    const row = (await listTenants(admin())).find((r) => r.slug === slug);
    expect(row).toBeTruthy();
    expect(row!.entities).toHaveLength(1);
    expect(row!.users).toHaveLength(1);
    expect(row!.modules).toEqual(["production"]);
    expect(row!.maxEntities).toBe(1);
    expect(row!.color).toBe("copper");
  });
});

// ── ค่างวด: ตรรกะที่หน้าจอแอดมินใช้ (0037 · เฟส 2) ──────────────────────────
describe("subscriptions — เลื่อนรอบแบบ anniversary ไม่ drift", () => {
  // seed ไว้ใน beforeAll: started_on = 2026-01-31 (สิ้นเดือน) · จ่ายมาแล้ว 1 รอบ
  const ANCHOR = "2026-01-31";

  it("ตั้งค่างวดแล้ว current_period_end = จุดยึด + 1 รอบ", async () => {
    const { data } = await admin()
      .from("subscriptions").select("*").eq("tenant_id", A.tenantId).single();
    // beforeAll กด recordPayment ไป 1 ครั้ง → periods_paid = 2
    expect(Number(data!.periods_paid)).toBe(2);
    expect(data!.current_period_end).toBe(periodEnd(ANCHOR, "monthly", 2));
    expect(data!.current_period_end).toBe("2026-03-31"); // ★ ไม่ใช่ 2026-03-28
  });

  it("★★ จ่ายอีก 2 รอบ วันตัดรอบต้องยังเป็นวันที่ 31 (พิสูจน์ว่าไม่บวกจากค่าเดิม)", async () => {
    const db = admin();
    await recordPayment(db, A.tenantId, { amount: 1234, paidOn: "2026-03-01", note: null, actor: ownerId });
    const r = await recordPayment(db, A.tenantId, { amount: 1234, paidOn: "2026-04-01", note: null, actor: ownerId });
    expect(r.periodEndAfter).toBe(periodEnd(ANCHOR, "monthly", 4));
    expect(r.periodEndAfter).toBe("2026-05-31");
  });

  it("ย้อนรายการล่าสุดแล้วกลับไปรอบก่อนหน้าเป๊ะ", async () => {
    const db = admin();
    const before = await db
      .from("subscription_payments").select("id", { count: "exact", head: true }).eq("tenant_id", A.tenantId);
    const r = await voidLastPayment(db, A.tenantId);
    expect(r.periodEndAfter).toBe(periodEnd(ANCHOR, "monthly", 3));

    const after = await db
      .from("subscription_payments").select("id", { count: "exact", head: true }).eq("tenant_id", A.tenantId);
    expect((after.count ?? 0) + 1).toBe(before.count ?? 0);
  });

  it("★ trigger มิเรอร์วันครบกำหนดลง tenants.billing_due_on ให้อัตโนมัติ", async () => {
    const db = admin();
    const { data: sub } = await db
      .from("subscriptions").select("current_period_end").eq("tenant_id", A.tenantId).single();
    const { data: t } = await db
      .from("tenants").select("billing_due_on").eq("id", A.tenantId).single();
    expect(t!.billing_due_on).toBe(sub!.current_period_end);
  });

  it("★ หยุดพัก = ไม่มีวันครบกำหนดให้เตือน (ตกลงกันแล้วว่าพัก ห้ามไปตื๊อลูกค้า)", async () => {
    const db = admin();
    await saveSubscription(db, A.tenantId, {
      plan: "แพ็กเกจทดสอบ", price: 1234, cycle: "monthly", startedOn: ANCHOR,
      status: "paused", note: null, billingNotice: true,
    });
    const { data: t } = await db
      .from("tenants").select("billing_due_on").eq("id", A.tenantId).single();
    expect(t!.billing_due_on).toBeNull();

    // คืนสถานะ active แล้วต้องกลับมา
    await saveSubscription(db, A.tenantId, {
      plan: "แพ็กเกจทดสอบ", price: 1234, cycle: "monthly", startedOn: ANCHOR,
      status: "active", note: null, billingNotice: true,
    });
    const { data: t2 } = await db
      .from("tenants").select("billing_due_on").eq("id", A.tenantId).single();
    expect(t2!.billing_due_on).not.toBeNull();
  });

  it("listBilling เรียงครบกำหนดเร็วสุดก่อน และบอกว่าใครยังไม่ได้ตั้งค่างวด", async () => {
    const rows = await listBilling(admin());
    const mine = rows.find((r) => r.tenantId === A.tenantId);
    expect(mine?.subscription?.plan).toBe("แพ็กเกจทดสอบ");
    expect(mine?.payments.length).toBeGreaterThan(0);

    // ลูกค้าที่ไม่มี subscription ต้องอยู่ท้ายรายการเสมอ
    const firstMissing = rows.findIndex((r) => !r.subscription);
    if (firstMissing >= 0) {
      expect(rows.slice(firstMissing).every((r) => !r.subscription)).toBe(true);
    }
  });
});

// ── ระงับการใช้งาน: ต้อง**ไม่**ไปตัดที่ RLS ──────────────────────────────────
describe("★ ระงับลูกค้า = กันที่ชั้นแอป ไม่ใช่ตัดข้อมูลที่ DB", () => {
  it("ลูกค้าที่ถูกระงับยังอ่านข้อมูลตัวเองได้ที่ระดับ DB", async () => {
    const db = admin();
    await db.from("tenants").update({ is_active: false }).eq("id", A.tenantId);

    const { data, error } = await asA.from("transactions").select("tx_id").limit(1);
    expect(error, "ตัดที่ RLS = ลูกค้าเข้าข้อมูลภาษีตัวเองไม่ได้ และ trigger/RPC จะพังตาม").toBeNull();
    expect(data).toBeTruthy();

    await db.from("tenants").update({ is_active: true }).eq("id", A.tenantId);
  });

  it("ลูกค้าปลดระงับ/เลื่อนวันครบกำหนดให้ตัวเองไม่ได้ (tenants ไม่มี policy update)", async () => {
    const db = admin();
    await db.from("tenants").update({ is_active: false }).eq("id", A.tenantId);

    await asA.from("tenants").update({ is_active: true }).eq("id", A.tenantId);
    await asA.from("tenants").update({ billing_due_on: "2099-01-01" }).eq("id", A.tenantId);

    const { data } = await db
      .from("tenants").select("is_active, billing_due_on").eq("id", A.tenantId).single();
    expect(data!.is_active, "ลูกค้าปลดระงับตัวเองได้ = ปุ่มระงับไร้ความหมาย").toBe(false);
    expect(data!.billing_due_on).not.toBe("2099-01-01");

    await db.from("tenants").update({ is_active: true }).eq("id", A.tenantId);
  });

  it("★ ลูกค้าอ่าน billing_due_on ของตัวเองได้ แต่ยังอ่าน subscriptions ไม่ได้เลย", async () => {
    // นี่คือเหตุผลทั้งหมดที่เลือกมิเรอร์วันครบกำหนดลง tenants แทนการเปิด policy ให้อ่าน subscriptions
    const { data: t } = await asA.from("tenants").select("billing_due_on").maybeSingle();
    expect(t, "ลูกค้าต้องอ่านแถวตัวเองได้ ไม่งั้นแถบแจ้งเตือนขึ้นไม่ได้").toBeTruthy();

    const { data: s } = await asA.from("subscriptions").select("price");
    expect(s ?? [], "ราคาที่ลูกค้าจ่ายห้ามหลุดถึงเบราว์เซอร์").toHaveLength(0);
  });
});
