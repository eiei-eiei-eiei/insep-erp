import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, seedUser, signIn, admin, type Tenant } from "./harness";

/**
 * ลบ/ปิดใช้เมนูบาร์ (D138 · migration 0096)
 *
 * 🔴 ชั้นเดียวที่เห็น policy/RPC จริง (D79) — ยิงด้วย client ผู้ใช้จริง (RLS มีผล) ไม่ใช่ service role
 * ★ ทุกข้อที่บล็อกตรวจด้วย admin ว่าแถวใน DB ไม่ขยับจริง (ไม่ใช่แค่ดูว่าตอบ error) + มี positive control
 * 🪤 "ลบไม่ได้" ในโลก RLS = ลบ 0 แถวเงียบ ๆ ไม่ใช่ error (D85) — ตัดสินด้วยแถวที่ยังอยู่
 */

let A: Tenant;
let asMain: SupabaseClient;
let asStaff: SupabaseClient;

const NEW = "T-M-NEW";   // ไม่เคยขาย มีสูตร → ลบได้
const SOLD = "T-M-SOLD"; // เคยขาย → ลบไม่ได้ · ปิดใช้ได้
const LAB = "T-M-LAB";   // ไม่เคยขาย ส่งขึ้นมาจากห้องทดลอง → ลบได้ + การ์ดกลับเป็น กำลังลอง
const DIRECT = "T-M-DIRECT"; // ไม่เคยขาย — ใช้พิสูจน์ว่าลบตรงผ่าน API ไม่ได้ (ทั้ง main และพนักงาน)

const menuExists = async (id: string) => {
  const { count, error } = await admin().from("bar_menu").select("menu_id", { count: "exact", head: true })
    .eq("tenant_id", A.tenantId).eq("entity_id", A.entityId).eq("menu_id", id);
  if (error) throw new Error(`อ่านเมนู ${id}: ${error.message}`);
  return (count ?? 0) > 0;
};
const menuActive = async (id: string) => {
  const { data, error } = await admin().from("bar_menu").select("active")
    .eq("tenant_id", A.tenantId).eq("entity_id", A.entityId).eq("menu_id", id).single();
  if (error) throw new Error(`อ่านเมนู ${id}: ${error.message}`);
  return data.active as boolean;
};

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("barmenu");
  const db = admin();
  const base = { tenant_id: A.tenantId, entity_id: A.entityId };
  const must = (w: string, e: { message: string } | null) => { if (e) throw new Error(`${w}: ${e.message}`); };

  must("หมวด", (await db.from("bar_category").insert({ ...base, category_id: "T-cat", name: "ทดสอบ หมวด", sort: 1, is_system: false })).error);
  must("วัตถุดิบ", (await db.from("bar_item").insert({ ...base, item_id: "T-I-GIN", name: "ทดสอบ จิน", unit: "ml" })).error);
  // 🪤 คีย์ไม่เท่ากันทุกแถว → defaultToNull: false (D136)
  must("เมนู", (await db.from("bar_menu").insert([
    { ...base, menu_id: NEW, name: "ทดสอบ ไม่เคยขาย", price: 100, category_id: "T-cat" },
    { ...base, menu_id: SOLD, name: "ทดสอบ เคยขาย", price: 120, category_id: "T-cat" },
    { ...base, menu_id: LAB, name: "ทดสอบ จากห้องทดลอง", price: 150, category_id: "T-cat" },
    { ...base, menu_id: DIRECT, name: "ทดสอบ ลบตรง", price: 90, category_id: "T-cat" },
  ], { defaultToNull: false })).error);
  must("สูตร", (await db.from("bar_recipe").insert({ ...base, menu_id: NEW, item_id: "T-I-GIN", qty: 30 })).error);
  // บิลที่ยกเลิกแล้วก็ยังนับว่า "เคยขาย" (ประวัติยังอ้างเมนูอยู่)
  must("บิล", (await db.from("bar_sale").insert({
    ...base, sale_no: "T-S-1", status: "ยกเลิก", tab_name: "ทดสอบ", closed_at: "2026-10-20T15:00:00Z",
    business_date: "2026-10-20", method: "เงินสด", sub_total: 120, grand_total: 120,
  }, { defaultToNull: false })).error);
  must("รายการในบิล", (await db.from("bar_sale_item").insert({
    ...base, sale_no: "T-S-1", line_no: 1, menu_id: SOLD, menu_name: "ทดสอบ เคยขาย", qty: 1, price: 120, amount: 120,
  })).error);
  must("การ์ดสูตร", (await db.from("bar_lab_recipe").insert({
    ...base, recipe_id: "T-LR-1", name: "ทดสอบ การ์ดสูตร", status: "ขึ้นเมนูแล้ว", menu_id: LAB,
  })).error);

  asMain = await signIn(A);
  asStaff = (await seedUser(A, "bar")).client;
}, 180_000);

afterAll(async () => {
  await cleanupTestTenants();
}, 120_000);

describe("รายชื่อเมนูที่เคยถูกใช้ (bar_menu_used_ids)", () => {
  it("คืนเฉพาะเมนูที่อยู่ในบิล (รวมบิลยกเลิก) · ไม่มีเมนูที่ไม่เคยขาย", async () => {
    const { data, error } = await asMain.rpc("bar_menu_used_ids", { p_entity: A.entityId });
    expect(error).toBeNull();
    expect((data as string[]).sort()).toEqual([SOLD]);
  });
});

describe("ปิดใช้/เปิดใช้ — สิทธิ์ bar.write", () => {
  it("พนักงานบาร์ปิดใช้เมนูที่เคยขายได้ แล้วเปิดคืนได้ (แถวไม่หาย)", async () => {
    const off = await asStaff.from("bar_menu").update({ active: false })
      .eq("entity_id", A.entityId).eq("menu_id", SOLD).select("menu_id");
    expect(off.error).toBeNull();
    expect(off.data).toHaveLength(1);
    expect(await menuActive(SOLD)).toBe(false);
    const on = await asStaff.from("bar_menu").update({ active: true })
      .eq("entity_id", A.entityId).eq("menu_id", SOLD).select("menu_id");
    expect(on.data).toHaveLength(1);
    expect(await menuActive(SOLD)).toBe(true);
  });
});

describe("ลบ — ด่านอยู่ใน DB", () => {
  it("🚨 ลบตรงผ่าน API ไม่ได้ทั้งพนักงานและเจ้าของ (ไม่มี policy delete) · แถวยังอยู่", async () => {
    for (const c of [asStaff, asMain]) {
      const r = await c.from("bar_menu").delete().eq("entity_id", A.entityId).eq("menu_id", DIRECT).select("menu_id");
      expect(r.data ?? []).toHaveLength(0);
      expect(await menuExists(DIRECT)).toBe(true);
    }
  });

  it("🚨 พนักงานบาร์ (ไม่มี bar.config) เรียก RPC ลบไม่ได้ · แถวยังอยู่", async () => {
    const r = await asStaff.rpc("fn_bar_delete_menu", { p_entity: A.entityId, p_menu_id: NEW });
    expect(r.error).not.toBeNull();
    expect(await menuExists(NEW)).toBe(true);
  });

  it("🚨 เมนูที่เคยขาย ลบไม่ได้แม้เป็นเจ้าของ — บอกให้ใช้ปิดใช้ · แถวยังอยู่", async () => {
    const r = await asMain.rpc("fn_bar_delete_menu", { p_entity: A.entityId, p_menu_id: SOLD });
    expect(r.error).not.toBeNull();
    expect(String(r.error?.message)).toContain("ปิดใช้");
    expect(await menuExists(SOLD)).toBe(true);
  });

  it("★ เมนูที่ไม่เคยขาย เจ้าของลบได้ · สูตรหายตาม", async () => {
    const r = await asMain.rpc("fn_bar_delete_menu", { p_entity: A.entityId, p_menu_id: NEW });
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ ok: true, lab_cards_reset: 0 });
    expect(await menuExists(NEW)).toBe(false);
    const { count } = await admin().from("bar_recipe").select("*", { count: "exact", head: true })
      .eq("tenant_id", A.tenantId).eq("menu_id", NEW);
    expect(count).toBe(0);
  });

  it("★ เมนูจากห้องทดลอง ลบแล้วการ์ดสูตรกลับเป็น กำลังลอง (ไม่ชี้ไปหาเมนูที่ไม่มีแล้ว)", async () => {
    const r = await asMain.rpc("fn_bar_delete_menu", { p_entity: A.entityId, p_menu_id: LAB });
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ ok: true, lab_cards_reset: 1 });
    const { data } = await admin().from("bar_lab_recipe").select("status, menu_id")
      .eq("tenant_id", A.tenantId).eq("recipe_id", "T-LR-1").single();
    expect(data).toEqual({ status: "กำลังลอง", menu_id: null });
  });

  it("เมนูที่ไม่มีอยู่ = ตอบภาษาไทย", async () => {
    const r = await asMain.rpc("fn_bar_delete_menu", { p_entity: A.entityId, p_menu_id: "T-M-NONE" });
    expect(String(r.error?.message)).toContain("ไม่พบเมนู");
  });
});
