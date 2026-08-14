import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, admin, anonClient, TEST_PREFIX, type Tenant } from "./harness";
import { createTenant, listTenants } from "../../lib/platform/provision";

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

const PLATFORM_TABLES = ["platform_admins", "platform_admin_log"] as const;

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
      const row =
        table === "platform_admins"
          ? { user_id: ownerId }
          : { actor: ownerId, action: "zz-test-แอบเขียน" };
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
