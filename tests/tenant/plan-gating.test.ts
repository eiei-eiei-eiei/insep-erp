import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, admin, type Tenant } from "./harness";

/**
 * เทสแพ็กเกจของลูกค้า (`tenants.modules_enabled` / `max_entities` — 4.4/4.5)
 *
 * โมดูลเป็น "สิทธิ์ตามแพ็กเกจ" ไม่ใช่ขอบเขตความปลอดภัย → กรองที่ UI/route ก็พอ
 * **แต่สิ่งที่ต้องบังคับที่ DB จริง ๆ คือ "ลูกค้าเลื่อนแพ็กเกจให้ตัวเองไม่ได้"**
 * ไม่งั้น gate ฝั่งแอปไร้ความหมาย — ลูกค้าแก้ค่าเองแล้วเมนูโผล่ครบ
 */

let A: Tenant;
let B: Tenant;
let asA: SupabaseClient;
let asB: SupabaseClient;

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("plana");
  B = await seedTenant("planb");
  asA = await signIn(A);
  asB = await signIn(B);

  // ตั้งแพ็กเกจของ A เป็น "ผลิตอย่างเดียว โควตา 1 กิจการ" ด้วย service role (เจ้าของระบบเป็นคนตั้ง)
  const { error } = await admin()
    .from("tenants")
    .update({ modules_enabled: ["production"], max_entities: 1 })
    .eq("id", A.tenantId);
  if (error) throw new Error(`ตั้งแพ็กเกจของ A: ${error.message}`);
}, 180_000);

afterAll(async () => {
  for (const c of [asA, asB]) await c?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

describe("ลูกค้าอ่านแพ็กเกจของตัวเองได้", () => {
  it("อ่านแถว tenants ของตัวเองได้โดยไม่ต้องระบุ id (RLS กรองให้)", async () => {
    const { data, error } = await asA.from("tenants").select("modules_enabled, max_entities").maybeSingle();
    expect(error, error?.message).toBeNull();
    expect(data?.modules_enabled).toEqual(["production"]);
    expect(data?.max_entities).toBe(1);
  });

  it("เห็นแถวเดียวเสมอ — ของลูกค้าเจ้าอื่นไม่โผล่มาด้วย", async () => {
    const { data } = await asA.from("tenants").select("id");
    expect(data).toHaveLength(1);
    expect(data![0].id).toBe(A.tenantId);
  });

  it("B มีแพ็กเกจของตัวเอง ไม่ถูกค่าของ A ทับ", async () => {
    const { data } = await asB.from("tenants").select("modules_enabled").maybeSingle();
    expect(data?.modules_enabled).toEqual(["production", "accounting", "sales"]); // default ของ 0025
  });
});

describe("★ ลูกค้าเลื่อนแพ็กเกจให้ตัวเองไม่ได้ (ไม่มี policy for update บน tenants)", () => {
  it("เปิดโมดูลเพิ่มให้ตัวเองไม่ได้", async () => {
    await asA.from("tenants")
      .update({ modules_enabled: ["production", "accounting", "sales"] })
      .eq("id", A.tenantId);

    // RLS ที่ไม่มี policy for update = ไม่มีแถวไหนถูกแตะ (ไม่จำเป็นต้อง error)
    const { data } = await admin()
      .from("tenants").select("modules_enabled").eq("id", A.tenantId).single();
    expect(data!.modules_enabled, "ค่าต้องไม่ขยับ").toEqual(["production"]);
  });

  it("ขยายโควตากิจการให้ตัวเองไม่ได้", async () => {
    await asA.from("tenants").update({ max_entities: 99 }).eq("id", A.tenantId);
    const { data } = await admin()
      .from("tenants").select("max_entities").eq("id", A.tenantId).single();
    expect(Number(data!.max_entities), "โควตาต้องไม่ขยับ").toBe(1);
  });

  it("สร้างกิจการเพิ่มเองไม่ได้ (RLS 0028 — entities สร้างได้เฉพาะ service role)", async () => {
    const { error } = await asA.from("entities").insert({
      tenant_id: A.tenantId, entity_id: "EID99", name: "กิจการที่แอบสร้าง", is_vat: true,
    });
    expect(error, "ลูกค้าต้องสร้างกิจการเองไม่ได้ ไม่งั้น add-on ขายไม่ได้จริง").not.toBeNull();
  });
});
