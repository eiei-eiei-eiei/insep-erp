import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertTestEnv, cleanupTestTenants, seedTenant, signIn, seedUser, admin, anonClient,
  TEST_PREFIX, type Tenant,
} from "./harness";
import {
  MUST_CLOSED_DEFINERS, DEFINER_ALLOWLIST, allowViolation, auditDefiners, staleAllowlist,
  isClosed, stripSqlComments, type DefinerRow,
} from "../../lib/shared/definerPolicy";

/**
 * definer ทุกตัวต้องปิดประตูหรือมีด่านในตัว (D99 · migration 0073-0074) — ยิง Supabase จริง
 *
 * 🔴 ทำไมต้องอยู่ชั้นนี้ ไม่ใช่เทสอ่านไฟล์ SQL:
 *    `revoke ... from public` **รันผ่านแต่ไม่มีผล** บน Supabase (default privileges grant ให้
 *    anon/authenticated ตรง ๆ) — revoke ทุกบรรทัดใน repo ก่อน 0073 เป็นแบบนั้น และไม่มีเทสไหนเห็น
 *    และ `drop function` + create ใหม่ (D69) = ได้ default privileges คืนมาเงียบ ๆ
 *    ขณะที่ไฟล์ SQL ยังมีบรรทัด revoke ครบ ⇒ ต้องถามสิทธิ์ **ที่มีผลจริงใน DB** เท่านั้น
 *
 * ★ วนจาก pg_proc เอง (ผ่าน `fn_audit_definer_grants`) → ฟังก์ชันที่สร้างในอนาคตถูกครอบอัตโนมัติ
 *
 * 🚨 ห้ามพิสูจน์ด้วยการยิงฟังก์ชันที่ถูกปิดไว้เป็น anon ดู — ถ้าด่านไม่แน่นจริง การทดสอบ
 *    คือการก่อความเสียหาย (fn_mig_set_triggers ดับ trigger ทั้งฐาน) · อ่านสิทธิ์ + body เอา
 *    ที่ยิงจริงมีแค่ recompute_stock_product (ผลลัพธ์ถูกต้องเสมอ ยิงพลาดก็ไม่เสียหาย)
 */

type Row = DefinerRow;

let rows: Row[] = [];
let A: Tenant;
let B: Tenant;
let asA: SupabaseClient;
let viewerA: SupabaseClient;

const byName = (n: string) => rows.filter((r) => r.name === n);

async function stockOf(t: Tenant): Promise<number> {
  const { data, error } = await admin()
    .from("stock_product").select("balance")
    .eq("tenant_id", t.tenantId).eq("entity_id", t.entityId).eq("product_id", t.productId).single();
  if (error) throw new Error(error.message);
  return Number(data.balance);
}

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("dgA");
  B = await seedTenant("dgB");
  asA = await signIn(A);
  viewerA = (await seedUser(A, "viewer")).client;

  const { data, error } = await admin().rpc("fn_audit_definer_grants");
  if (error) throw new Error(`fn_audit_definer_grants: ${error.message} (ลง 0074 แล้วหรือยัง?)`);
  rows = (data ?? []) as Row[];
}, 180_000);

afterAll(async () => {
  await asA?.auth.signOut().catch(() => {});
  await viewerA?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

describe("① แผนที่สิทธิ์จาก pg_proc (ไม่ใช่จากไฟล์ SQL)", () => {
  it("ได้ข้อมูลจริง — กันเทสผ่านเพราะลิสต์ว่าง", () => {
    expect(rows.filter((r) => r.definer).length).toBeGreaterThan(30);
  });

  it("🚨 fn_audit_definer_grants เองต้องปิดจาก anon/authenticated (แผนที่ช่องโหว่ห้ามหลุด)", async () => {
    const [self] = byName("fn_audit_definer_grants");
    expect(self, "ไม่พบ fn_audit_definer_grants ในผลของตัวเอง").toBeTruthy();
    expect({ anon: self.anon, authed: self.authed, service: self.service })
      .toEqual({ anon: false, authed: false, service: true });
    // อ่านอย่างเดียว ยิงได้ปลอดภัย — พิสูจน์อีกทางว่าสิทธิ์ที่เห็นคือของจริง
    expect((await anonClient().rpc("fn_audit_definer_grants")).error).not.toBeNull();
    expect((await asA.rpc("fn_audit_definer_grants")).error).not.toBeNull();
  });

  it("🚨 MUST_CLOSED_DEFINERS ทุกตัวปิดจาก anon และ authenticated · service_role ยังเรียกได้", () => {
    const a = auditDefiners(rows);
    expect(a.mustClosedMissing, "หาไม่เจอใน DB").toEqual([]);
    expect(a.mustClosedOpen, "ยังเปิดอยู่").toEqual([]);
    expect(MUST_CLOSED_DEFINERS.length).toBeGreaterThanOrEqual(6);
  });

  it("recompute_stock_product: anon ปิด · authenticated เปิด (ปุ่มซ่อมสต็อก) แต่ต้องมีด่านในตัว", () => {
    const [r] = byName("recompute_stock_product");
    expect({ anon: r.anon, authed: r.authed, service: r.service })
      .toEqual({ anon: false, authed: true, service: true });
    // ตัดแค่คอมเมนต์ (ต้องเห็นชื่อ cap ในสตริงด้วย) — ตรวจโค้ดจริง ไม่ใช่คำในคอมเมนต์
    const body = stripSqlComments(r.src);
    expect(body).toMatch(/\bhas_cap\s*\(\s*'prod\.write'\s*\)/);
    expect(body).toMatch(/p_tenant\s*<>\s*my_tenant\s*\(\s*\)/);
    expect(body).toMatch(/auth\.role\s*\(\s*\)/);
  });

  it("🔴 trg_update_stock_product เป็น definer — ไม่งั้นปิด apply_stock_delta แล้ว log_product เขียนไม่ได้", () => {
    const [r] = byName("trg_update_stock_product");
    expect(r.definer).toBe(true);
  });

  it("🔐 definer ทุกตัว: (ก) ปิดจาก anon+authenticated หรือ (ข) มีด่านในตัว หรือ allowlist ที่ตรวจตัวเองผ่าน", () => {
    expect(auditDefiners(rows).unguarded, "definer ที่คนนอกเรียกได้โดยไม่มีด่าน").toEqual([]);
  });

  it("🔐 definer ที่รับ p_tenant: ต้องปิด · หรืออ่านอย่างเดียว · หรือมีด่านเทียบ my_tenant()", () => {
    expect(auditDefiners(rows).pTenantOpen, "รับ tenant จากคนเรียก = เขียนข้ามลูกค้าได้ (R2)").toEqual([]);
  });

  it("allowlist ไม่มีชื่อค้าง — ทุกชื่อยังมีอยู่จริง และยังต้องอยู่ (เปิดอยู่ ไม่มีด่าน)", () => {
    expect(staleAllowlist(rows)).toEqual([]);
  });

  it("allowlist ตรวจตัวเองได้กับ body จริงใน DB — เติม insert เข้าไปแล้วต้องแดง", () => {
    const real = byName("entity_is_vat")[0];
    expect(allowViolation(rows, real)).toBeNull();
    const tampered: Row = { ...real, src: real.src + "; insert into stock_product values (1)" };
    expect(allowViolation(rows, tampered)).toMatch(/คำสั่งเขียน/);
    expect(isClosed(real)).toBe(false); // ยังเปิดอยู่จริง — allowlist นี้ยังจำเป็น
    expect(DEFINER_ALLOWLIST.entity_is_vat.kind).toBe("readonly");
  });
});

describe("② สต็อก — ปิด apply_stock_delta แล้ว trigger ยังทำงานครบ INSERT/UPDATE/DELETE", () => {
  it("บันทึก/แก้/ลบ log_product ด้วย session ผู้ใช้จริง → stock_product ขยับตามตัวเลขเป๊ะ", async () => {
    const before = await stockOf(A);
    const ins = await asA.from("log_product").insert({
      entity_id: A.entityId, doc_date: "2026-09-28", trans_type: "รับ",
      product_id: A.productId, amount: 7, note: "ทดสอบ D99",
    }).select("id").single();
    expect(ins.error, ins.error?.message).toBeNull();
    expect(await stockOf(A)).toBe(before + 7);

    const upd = await asA.from("log_product").update({ amount: 3 }).eq("id", ins.data!.id);
    expect(upd.error, upd.error?.message).toBeNull();
    expect(await stockOf(A)).toBe(before + 3);

    const del = await asA.from("log_product").delete().eq("id", ins.data!.id);
    expect(del.error, del.error?.message).toBeNull();
    expect(await stockOf(A)).toBe(before);
  });
});

describe("③ recompute_stock_product — ปุ่มซ่อมสต็อกยังใช้ได้ แต่ข้ามลูกค้าไม่ได้", () => {
  it("เจ้าของกดซ่อมสต็อกของตัวเอง (ไม่ส่งพารามิเตอร์) → สำเร็จ และยอดกลับมาถูก", async () => {
    const good = await stockOf(A);
    await admin().from("stock_product").update({ balance: 999 })
      .eq("tenant_id", A.tenantId).eq("entity_id", A.entityId).eq("product_id", A.productId);
    const r = await asA.rpc("recompute_stock_product");
    expect(r.error, r.error?.message).toBeNull();
    expect(await stockOf(A)).toBe(good);
  });

  it("🚨 ส่ง p_tenant ของ B → ถูกปฏิเสธ และสต็อกของ B ไม่ถูกแตะ", async () => {
    const good = await stockOf(B);
    // ทำยอด B ให้ผิดไว้ก่อน — ถ้าด่านรั่ว recompute จะแก้กลับเป็น good ให้เห็นทันที
    await admin().from("stock_product").update({ balance: 999 })
      .eq("tenant_id", B.tenantId).eq("entity_id", B.entityId).eq("product_id", B.productId);

    const r = await asA.rpc("recompute_stock_product", { p_tenant: B.tenantId });
    expect(r.error?.message ?? "").toContain("กิจการอื่น");
    expect(await stockOf(B), "สต็อก B ถูกเขียนจาก session ของ A").toBe(999);

    // ทางกลับของ restore:tenant (service role) ยังใช้ได้ — และคืนยอด B ให้ถูก
    const fix = await admin().rpc("fn_mig_recompute_stock", { p_tenant: B.tenantId });
    expect(fix.error, fix.error?.message).toBeNull();
    expect(await stockOf(B)).toBe(good);
  });

  it("viewer (ไม่มี prod.write) สั่งซ่อมไม่ได้", async () => {
    const r = await viewerA.rpc("recompute_stock_product");
    expect(r.error?.message ?? "").toContain("ไม่มีสิทธิ์");
  });

  it("anon สั่งไม่ได้เลย (ไม่มีสิทธิ์ execute)", async () => {
    const r = await anonClient().rpc("recompute_stock_product");
    expect(r.error).not.toBeNull();
  });
});

describe("④ R6 — ผู้ใช้ที่ไม่มี tenant ใน metadata ต้องสร้างไม่ได้ (fail-closed)", () => {
  it("🚨 ไม่ส่ง tenant_id → สร้างไม่ได้ (เดิมตกไปอยู่ลูกค้ารายแรกที่ active ในฐานะ viewer)", async () => {
    const db = admin();
    const email = `${TEST_PREFIX}nometa-${Date.now()}@insep.local`;
    const { data, error } = await db.auth.admin.createUser({
      email, password: "NoTenant!2569x", email_confirm: true,
      user_metadata: { username: email.split("@")[0] },
    });
    if (data?.user) {
      // ถ้ารั่ว: ดูว่าไปตกอยู่ที่ไหน แล้วลบทิ้งก่อนฟ้อง
      const { data: p } = await db.from("profiles").select("tenant_id").eq("id", data.user.id).maybeSingle();
      await db.auth.admin.deleteUser(data.user.id).catch(() => {});
      throw new Error(`สร้างผู้ใช้ได้โดยไม่มี tenant — ไปตกอยู่ที่ tenant ${p?.tenant_id ?? "(ไม่มี profile)"}`);
    }
    expect(error).not.toBeNull();
  });

  it("ส่ง tenant_id ครบ → สร้างได้ และ profile อยู่ tenant ที่ส่งมา", async () => {
    const db = admin();
    const username = `${TEST_PREFIX}meta-${Date.now()}`;
    const { data, error } = await db.auth.admin.createUser({
      email: `${username}@insep.local`, password: "HasTenant!2569x", email_confirm: true,
      user_metadata: { username, tenant_id: A.tenantId, skip_password_change: true },
    });
    expect(error, error?.message).toBeNull();
    const { data: p } = await db.from("profiles").select("tenant_id").eq("id", data!.user!.id).single();
    expect(p?.tenant_id).toBe(A.tenantId);
    // ผู้ใช้อยู่ใน tenant ทดสอบ → cleanupTestTenants ลบให้เอง
  });
});
