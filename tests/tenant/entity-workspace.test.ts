import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertTestEnv, cleanupTestTenants, seedTenant, signIn, seedUser, admin, anonClient, type Tenant,
} from "./harness";
import { ENTITY_HEADER, ENTITY_MISMATCH_HINT } from "../../lib/shared/entityWorkspace";

/**
 * D187 · ทาง Y เฟส 1 — "กิจการที่เลือกอยู่" ใน DB จริง (migration 0115)
 *
 * พิสูจน์ 2 ทิศเสมอ (กติกา D85/D93):
 *   ✔ ได้เมื่อควรได้   — header/กิจการล่าสุดที่อยู่ในสิทธิ์ ถูกใช้จริง
 *   ✘ ไม่ได้เมื่อไม่ควร — header ของ tenant อื่น / กิจการนอกสิทธิ์ (D120) / ค่าขยะ ถูกข้าม · จดข้ามสิทธิ์ = error
 *
 * 🔒 header ไม่ใช่ด่าน — ทุกเคส "ไม่ควรได้" ส่ง header เองตรง ๆ เหมือนผู้ใช้ที่ยิง PostgREST เอง
 */

const EID2 = "EID02";
/** กิจการที่มี **เฉพาะใน tenant B** — A ไม่มีรหัสนี้ ⇒ ใช้ทดสอบยิงข้าม tenant ได้จริง
 *  (ห้ามใช้ EID01 — ทั้งสอง tenant มี EID01 ของตัวเอง เทสจะผ่านโดยไม่ได้ทดสอบอะไร · บทเรียน TESTING 26.2) */
const B_ONLY = "EID07";

let A: Tenant;
let B: Tenant;

const h = (id: string) => ({ [ENTITY_HEADER]: id });

async function current(c: SupabaseClient): Promise<string | null> {
  const { data, error } = await c.rpc("my_current_entity");
  if (error) throw new Error(`my_current_entity: ${error.message}`);
  return (data as string | null) ?? null;
}

async function lastOf(userId: string): Promise<string | null> {
  const { data, error } = await admin().from("profiles").select("last_entity_id").eq("id", userId).single();
  if (error) throw new Error(error.message);
  return (data.last_entity_id as string | null) ?? null;
}

async function userIdOf(c: SupabaseClient): Promise<string> {
  const { data } = await c.auth.getUser();
  return data.user!.id;
}

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("ewA");
  B = await seedTenant("ewB");
  const db = admin();
  const e1 = await db.from("entities").insert({ tenant_id: A.tenantId, entity_id: EID2, name: "กิจการที่สองทดสอบ", is_vat: false });
  if (e1.error) throw new Error(`สร้าง ${EID2} ของ A: ${e1.error.message}`);
  const e2 = await db.from("entities").insert({ tenant_id: B.tenantId, entity_id: B_ONLY, name: "กิจการของ B ทดสอบ", is_vat: false });
  if (e2.error) throw new Error(`สร้าง ${B_ONLY} ของ B: ${e2.error.message}`);
}, 180_000);

afterAll(async () => {
  await cleanupTestTenants();
});

describe("my_current_entity() — ลำดับ header → ล่าสุด → กิจการหลัก", () => {
  it("ไม่มี header + ยังไม่เคยเลือก ⇒ กิจการหลัก", async () => {
    const c = await signIn(A);
    expect(await current(c)).toBe(A.entityId);
  });

  it("✔ header ชี้กิจการของตัวเอง ⇒ ใช้ค่านั้น", async () => {
    const c = await signIn(A, h(EID2));
    expect(await current(c)).toBe(EID2);
  });

  it("✘ header ชี้กิจการของ tenant อื่น ⇒ ถูกข้าม (ได้กิจการหลักของตัวเอง ไม่ใช่ของ B)", async () => {
    const c = await signIn(A, h(B_ONLY));
    expect(await current(c)).toBe(A.entityId);
    // positive control — B เองใช้ header เดียวกันได้จริง (กันเทสผ่านเพราะ header ไม่ถึง DB เลย)
    const cb = await signIn(B, h(B_ONLY));
    expect(await current(cb)).toBe(B_ONLY);
  });

  it("✘ header ขยะ/ไม่มีกิจการนั้น ⇒ ถูกข้าม", async () => {
    const c = await signIn(A, h("NOPE99"));
    expect(await current(c)).toBe(A.entityId);
  });

  it("✘ ไม่ล็อกอิน ⇒ เรียกไม่ได้เลย (revoke anon · D99)", async () => {
    const { error } = await anonClient(h(EID2)).rpc("my_current_entity");
    expect(error, "anon ต้องเรียกไม่ได้").not.toBeNull();
  });
});

describe("fn_set_last_entity() — จดกิจการที่สลับไป", () => {
  it("✔ จดกิจการของตัวเองได้ แล้วคำขอที่ไม่มี header (connector) ใช้ค่านี้", async () => {
    const c = await signIn(A);
    const { data, error } = await c.rpc("fn_set_last_entity", { p_entity: EID2 });
    expect(error, error?.message).toBeNull();
    expect(data).toBe(EID2);
    expect(await lastOf(await userIdOf(c))).toBe(EID2);
    expect(await current(c)).toBe(EID2);
    // header ยังชนะค่าล่าสุดเสมอ (แท็บที่เลือกกิจการหลักไว้ต้องได้กิจการหลัก)
    const c1 = await signIn(A, h(A.entityId));
    expect(await current(c1)).toBe(A.entityId);
  });

  it("✘ จดกิจการของ tenant อื่นไม่ได้ และค่าเดิมไม่ขยับ", async () => {
    const c = await signIn(A);
    const before = await lastOf(await userIdOf(c));
    const { error } = await c.rpc("fn_set_last_entity", { p_entity: B_ONLY });
    expect(error, "ต้องถูกปฏิเสธ").not.toBeNull();
    expect(await lastOf(await userIdOf(c))).toBe(before);
  });

  it("✘ แก้ได้เฉพาะโปรไฟล์ตัวเอง — ของผู้ใช้ B ไม่ถูกแตะ", async () => {
    const cb = await signIn(B);
    const bId = await userIdOf(cb);
    const before = await lastOf(bId);
    const ca = await signIn(A);
    await ca.rpc("fn_set_last_entity", { p_entity: A.entityId });
    expect(await lastOf(bId)).toBe(before);
  });
});

describe("ผู้ใช้ที่ถูกจำกัดกิจการ (D120) — เห็นแค่ EID02", () => {
  let restricted: SupabaseClient;
  let unrestricted: SupabaseClient;

  beforeAll(async () => {
    const r = await seedUser(A, "viewer", h(A.entityId)); // ★ ส่ง header ชี้กิจการที่ "ไม่มีสิทธิ์" ไว้เลย
    restricted = r.client;
    const { error } = await admin().from("profiles").update({ allowed_entity_ids: [EID2] }).eq("id", r.userId);
    if (error) throw new Error(error.message);
    unrestricted = (await seedUser(A, "sales")).client; // อีกคน ไม่จำกัด (คุมเทียบ)
  }, 120_000);

  it("✘ header ชี้กิจการนอกสิทธิ์ + กิจการหลักก็นอกสิทธิ์ ⇒ ได้กิจการในสิทธิ์ (EID02) ไม่ใช่ EID01", async () => {
    expect(await current(restricted)).toBe(EID2);
  });

  it("✘ จดกิจการนอกสิทธิ์ไม่ได้", async () => {
    const { error } = await restricted.rpc("fn_set_last_entity", { p_entity: A.entityId });
    expect(error, "ต้องถูกปฏิเสธ").not.toBeNull();
  });

  it("✔ จดกิจการในสิทธิ์ได้", async () => {
    const { error } = await restricted.rpc("fn_set_last_entity", { p_entity: EID2 });
    expect(error, error?.message).toBeNull();
  });

  it("คุมเทียบ: ผู้ใช้ที่ไม่ถูกจำกัด ไม่มี header ⇒ กิจการหลัก", async () => {
    expect(await current(unrestricted)).toBe(A.entityId);
  });
});

describe("entity_guard() — ด่านกลางของ definer (ใช้ตั้งแต่เฟส 2)", () => {
  it("✔ กิจการตรงกับที่เลือก + มีสิทธิ์ ⇒ คืน tenant_id", async () => {
    const c = await signIn(A, h(EID2));
    const { data, error } = await c.rpc("entity_guard", { p_entity: EID2, p_cap: "admin" });
    expect(error, error?.message).toBeNull();
    expect(data).toBe(A.tenantId);
  });

  it("✘ จอค้างกิจการเก่า (ส่ง EID01 แต่เลือก EID02 อยู่) ⇒ บล็อกพร้อมบอกให้รีเฟรช", async () => {
    const c = await signIn(A, h(EID2));
    const { error } = await c.rpc("entity_guard", { p_entity: A.entityId, p_cap: "admin" });
    expect(error?.message ?? "").toContain(ENTITY_MISMATCH_HINT);
  });

  it("✘ ส่งกิจการของ tenant อื่น ⇒ บล็อก", async () => {
    const c = await signIn(A, h(EID2));
    const { error } = await c.rpc("entity_guard", { p_entity: B_ONLY, p_cap: "admin" });
    expect(error, "ต้องถูกปฏิเสธ").not.toBeNull();
  });

  it("✘ ไม่มีความสามารถที่ขอ ⇒ บล็อก (accounting ไม่มี admin)", async () => {
    const v = (await seedUser(A, "accounting", h(EID2))).client;
    const { error } = await v.rpc("entity_guard", { p_entity: EID2, p_cap: "admin" });
    expect(error?.message ?? "").toContain("ไม่มีสิทธิ์");
  });

  it("✘ ไม่ระบุกิจการ / ไม่ระบุความสามารถ ⇒ บล็อก", async () => {
    const c = await signIn(A, h(EID2));
    expect((await c.rpc("entity_guard", { p_entity: "", p_cap: "admin" })).error).not.toBeNull();
    expect((await c.rpc("entity_guard", { p_entity: EID2, p_cap: null })).error).not.toBeNull();
  });
});
