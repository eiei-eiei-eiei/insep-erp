import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, seedUser, admin, type Tenant } from "./harness";

/**
 * บาร์: บรรทัดสูตรอ้างชุดตกแต่ง — ยิง Supabase จริง (D131 · migration 0093)
 *
 * 🔴 แปลงชุด → วัตถุดิบตอนสั่ง / คืนสต็อกตามที่ตัดจริง / บล็อกลบ / ด่านหน่วย อยู่ใน plpgsql ทั้งหมด
 *    build/lint/test มองไม่เห็น (บทเรียน D79) — ชั้นนี้คือชั้นเดียวที่พิสูจน์ได้
 * ★ ทุกข้อที่บล็อกมีคู่ที่ทำได้จริงกำกับ (2 ทิศทาง)
 */

let A: Tenant;
let asA: SupabaseClient;
let asBar: SupabaseClient;
const E = () => A.entityId;
const base = () => ({ tenant_id: A.tenantId, entity_id: A.entityId });

const qtyOf = async (itemId: string): Promise<number> => {
  const { data } = await admin().from("bar_item").select("qty")
    .eq("tenant_id", A.tenantId).eq("entity_id", E()).eq("item_id", itemId).single();
  return Number(data!.qty);
};
const garnishesNow = async () => {
  const { data } = await admin().from("bar_garnish").select("garnish_id, name, item_id, qty, qty_text, sort")
    .eq("tenant_id", A.tenantId).eq("entity_id", E()).order("sort");
  return data ?? [];
};

let WHEEL = "";
let MINT = "";
let GIMLET = "";
let DECOR = "";

async function sell(menuId: string, qty: number): Promise<string> {
  const open = await asA.rpc("fn_bar_open_sale", { p_entity: E() });
  expect(open.error, open.error?.message).toBeNull();
  const saleNo = (open.data as { sale_no: string }).sale_no;
  const add = await asA.rpc("fn_bar_add_lines", {
    p_entity: E(), p_sale_no: saleNo, p_items: [{ menu_id: menuId, menu_name: "x", qty, price: 100, amount: 100 * qty }],
  });
  expect(add.error, add.error?.message).toBeNull();
  return saleNo;
}
const lineCost = async (saleNo: string) => {
  const { data } = await admin().from("bar_sale_item").select("cost")
    .eq("tenant_id", A.tenantId).eq("sale_no", saleNo).eq("line_no", 1).single();
  return Number(data!.cost);
};

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("bar-rg");
  asA = await signIn(A);
  asBar = (await seedUser(A, "bar")).client;
  const db = admin();
  const r1 = await db.from("bar_category").insert({ ...base(), category_id: "T-c", name: "ทดสอบ", sort: 1, is_system: false });
  if (r1.error) throw new Error(r1.error.message);
  const r2 = await db.from("bar_item").insert([
    { ...base(), item_id: "T-GIN", name: "ทดสอบ Gordon", unit: "ml", qty: 2000, cost_per_unit: 1.2 },
    { ...base(), item_id: "T-LIME", name: "ทดสอบ มะนาว", unit: "ลูก", qty: 20, cost_per_unit: 7 },
    { ...base(), item_id: "T-JUICE", name: "ทดสอบ น้ำมะนาว", unit: "ml", qty: 1000, cost_per_unit: 0.2 },
  ]);
  if (r2.error) throw new Error(r2.error.message);
}, 180_000);

afterAll(async () => {
  // ★ cleanup เรียก fn_mig_truncate — พิสูจน์ไปในตัวว่า bar_recipe_garnish อยู่ก่อน bar_garnish (ไม่ติด FK)
  await cleanupTestTenants();
}, 120_000);

describe("① ตั้งชุดตกแต่ง", () => {
  it("🚨 จำนวนที่พิมพ์สำหรับหน่วยอื่น = บันทึกไม่ได้ (กันจอค้างรุ่นเก่า)", async () => {
    const r = await asA.rpc("fn_bar_save_garnishes", {
      p_entity: E(), p_rows: [{ name: "Lime Wheel", item_id: "T-LIME", qty: 1 / 7, qty_text: "1/7", qty_unit: "ml" }],
    });
    expect(r.error?.message).toContain("หน่วย ลูก");
    expect(await garnishesNow()).toEqual([]);
  });

  it("✓ เศษส่วน + ชุดที่ไม่ตัดสต็อก (วัตถุดิบ/จำนวนว่างทั้งคู่)", async () => {
    const r = await asA.rpc("fn_bar_save_garnishes", {
      p_entity: E(),
      p_rows: [
        { name: "Lime Wheel", item_id: "T-LIME", qty: 1 / 7, qty_text: "1/7", qty_unit: "ลูก" },
        // จำนวนที่ส่งมากับชุดไม่ตัดสต็อกถูกทิ้ง (ไม่มีวัตถุดิบ = ไม่มีจำนวน)
        { name: "ใบมิ้นต์กระถาง", item_id: null, qty: 3, qty_text: "3", qty_unit: null },
      ],
    });
    expect(r.error, r.error?.message).toBeNull();
    const g = await garnishesNow();
    expect(g.map((x) => [x.name, x.item_id, x.qty_text])).toEqual([["Lime Wheel", "T-LIME", "1/7"], ["ใบมิ้นต์กระถาง", null, null]]);
    expect(Number(g[0].qty)).toBeCloseTo(1 / 7, 12);
    expect(g[1].qty).toBeNull();
    WHEEL = g[0].garnish_id;
    MINT = g[1].garnish_id;
  });

  it("🚨 CHECK กันชุดครึ่ง ๆ กลาง ๆ (มีวัตถุดิบแต่ไม่มีจำนวน) แม้เขียนตรงด้วย service role", async () => {
    const r = await admin().from("bar_garnish").insert({ ...base(), garnish_id: "GN-BAD", name: "ทดสอบ ผี", item_id: "T-LIME", qty: null });
    expect(r.error?.message).toContain("bar_garnish_item_qty_pair");
  });

  it("🚨 พนักงานบาร์ (ไม่มี bar.config) ตั้งชุดไม่ได้", async () => {
    const r = await asBar.rpc("fn_bar_save_garnishes", { p_entity: E(), p_rows: [] });
    expect(r.error?.message).toContain("ไม่มีสิทธิ์");
    expect((await garnishesNow()).length).toBe(2);
  });
});

describe("② สูตรอ้างชุด → ตอนสั่งตัดวัตถุดิบของชุด ณ ตอนนั้น", () => {
  let firstSale = "";

  it("ชุดที่ไม่มีอยู่ = บันทึกเมนูไม่ได้ (ข้อความไทย ไม่ใช่ FK ดิบ)", async () => {
    const r = await asA.rpc("fn_bar_save_menu", {
      p_entity: E(), p_menu: { menu_id: null, name: "ทดสอบ ผี", price: 1, category_id: "T-c" },
      p_recipe: [{ garnish_id: "GN-NOPE", qty: 1 }],
    });
    expect(r.error?.message).toContain("ไม่พบชุดตกแต่ง");
  });

  it("บรรทัดอ้างสองอย่างพร้อมกัน = ปฏิเสธ", async () => {
    const r = await asA.rpc("fn_bar_save_menu", {
      p_entity: E(), p_menu: { menu_id: null, name: "ทดสอบ ผี", price: 1, category_id: "T-c" },
      p_recipe: [{ garnish_id: WHEEL, item_id: "T-LIME", qty: 1 }],
    });
    expect(r.error?.message).toContain("ทีละอย่าง");
  });

  it("✓ พนักงานบาร์บันทึกเมนูที่มีบรรทัดชุดได้ · แก้เมนูแล้วบรรทัดเดิมถูกแทนที่", async () => {
    const r = await asBar.rpc("fn_bar_save_menu", {
      p_entity: E(), p_menu: { menu_id: null, name: "ทดสอบ Gimlet", price: 100, category_id: "T-c" },
      p_recipe: [{ item_id: "T-GIN", qty: 45 }, { garnish_id: WHEEL, qty: 2 }],
    });
    expect(r.error, r.error?.message).toBeNull();
    GIMLET = (r.data as { menu_id: string }).menu_id;
    const r2 = await asBar.rpc("fn_bar_save_menu", {
      p_entity: E(), p_menu: { menu_id: GIMLET, name: "ทดสอบ Gimlet", price: 100, category_id: "T-c" },
      p_recipe: [{ item_id: "T-GIN", qty: 45 }, { garnish_id: WHEEL, qty: 1 }, { garnish_id: MINT, qty: 1 }],
    });
    expect(r2.error, r2.error?.message).toBeNull();
    const { data } = await admin().from("bar_recipe_garnish").select("garnish_id, qty")
      .eq("tenant_id", A.tenantId).eq("menu_id", GIMLET).order("garnish_id");
    expect(data!.map((x) => [x.garnish_id, Number(x.qty)]).sort()).toEqual([[MINT, 1], [WHEEL, 1]].sort());
  });

  it("🚨 ขาย 7 แก้ว = มะนาว 1 ลูกพอดี · ชุดไม่ตัดสต็อกไม่ตัดอะไร · ต้นทุนแช่ในบรรทัดบิล", async () => {
    const lime = await qtyOf("T-LIME");
    const gin = await qtyOf("T-GIN");
    firstSale = await sell(GIMLET, 7);
    expect(await qtyOf("T-LIME")).toBeCloseTo(lime - 1, 9);
    expect(await qtyOf("T-GIN")).toBe(gin - 315);
    // 7 × (45 × 1.2 + 1/7 × 7) = 7 × 55 = 385
    expect(await lineCost(firstSale)).toBe(385);
  });

  it("🚨 แก้สัดส่วนของชุด (1/7 → 1/8) = เมนูเปลี่ยนตาม · แต่แก้วที่ขายไปแล้วไม่ขยับ", async () => {
    const r = await asA.rpc("fn_bar_save_garnishes", {
      p_entity: E(),
      p_rows: [
        { garnish_id: WHEEL, name: "Lime Wheel", item_id: "T-LIME", qty: 1 / 8, qty_text: "1/8", qty_unit: "ลูก" },
        { garnish_id: MINT, name: "ใบมิ้นต์กระถาง", item_id: null, qty: null, qty_text: null, qty_unit: null },
      ],
    });
    expect(r.error, r.error?.message).toBeNull();
    const lime = await qtyOf("T-LIME");
    const second = await sell(GIMLET, 8);
    expect(await qtyOf("T-LIME")).toBeCloseTo(lime - 1, 9);
    expect(await lineCost(firstSale)).toBe(385); // ต้นทุนบิลเก่าแช่ไว้
    expect(await lineCost(second)).toBe(8 * (54 + 7 / 8));
  });

  it("🚨 ยกเลิกบรรทัดบิลเก่า = คืนมะนาวตามที่ตัดจริงตอนนั้น (1 ลูก) ไม่ใช่ตามสัดส่วนใหม่ (7/8)", async () => {
    const lime = await qtyOf("T-LIME");
    const r = await asA.rpc("fn_bar_void_line", { p_entity: E(), p_sale_no: firstSale, p_line_no: 1, p_reason: "ทดสอบ" });
    expect(r.error, r.error?.message).toBeNull();
    expect(await qtyOf("T-LIME")).toBeCloseTo(lime + 1, 9);
  });

  it("🪤 เมนูที่สูตรมีแต่ชุดไม่ตัดสต็อก = โหมดสูตร (ทุน 0) ไม่ตกไปใช้ต้นทุนตายตัว", async () => {
    const r = await asA.rpc("fn_bar_save_menu", {
      p_entity: E(), p_menu: { menu_id: null, name: "ทดสอบ น้ำแต่งแก้ว", price: 20, category_id: "T-c", fixed_cost: 30 },
      p_recipe: [{ garnish_id: MINT, qty: 1 }],
    });
    expect(r.error, r.error?.message).toBeNull();
    DECOR = (r.data as { menu_id: string }).menu_id;
    const sale = await sell(DECOR, 2);
    expect(await lineCost(sale)).toBe(0);
  });
});

describe("③ ลบชุด / เปลี่ยนหน่วย", () => {
  it("🚨 ลบชุดที่มีเมนูอ้าง = บล็อก + บอกรายชื่อเมนู", async () => {
    const r = await asA.rpc("fn_bar_save_garnishes", {
      p_entity: E(), p_rows: [{ garnish_id: WHEEL, name: "Lime Wheel", item_id: "T-LIME", qty: 1 / 8, qty_text: "1/8", qty_unit: "ลูก" }],
    });
    expect(r.error?.message).toContain("ลบชุดตกแต่ง ใบมิ้นต์กระถาง ไม่ได้");
    expect(r.error?.message).toContain("ทดสอบ Gimlet");
    expect(r.error?.message).toContain("ทดสอบ น้ำแต่งแก้ว");
    expect((await garnishesNow()).length).toBe(2);
  });

  it("🚨 เปลี่ยนวัตถุดิบเป็นหน่วยอื่นโดยไม่ใส่จำนวนใหม่ = ปฏิเสธ · ใส่ใหม่แล้วผ่าน", async () => {
    const bad = await asA.rpc("fn_bar_save_garnishes", {
      p_entity: E(),
      p_rows: [
        { garnish_id: WHEEL, name: "Lime Wheel", item_id: "T-JUICE", qty: 1 / 8, qty_text: "1/8", qty_unit: "ลูก" },
        { garnish_id: MINT, name: "ใบมิ้นต์กระถาง", item_id: null },
      ],
    });
    expect(bad.error?.message).toContain("หน่วย ml");
    const ok = await asA.rpc("fn_bar_save_garnishes", {
      p_entity: E(),
      p_rows: [
        { garnish_id: WHEEL, name: "Lime Wheel", item_id: "T-LIME", qty: 1 / 7, qty_text: "1/7", qty_unit: "ลูก" },
        { garnish_id: MINT, name: "ใบมิ้นต์กระถาง", item_id: null },
      ],
    });
    expect(ok.error, ok.error?.message).toBeNull();
  });

  it("✓ เอาออกจากสูตรก่อนแล้วลบได้", async () => {
    const r = await asA.rpc("fn_bar_save_menu", {
      p_entity: E(), p_menu: { menu_id: DECOR, name: "ทดสอบ น้ำแต่งแก้ว", price: 20, category_id: "T-c", fixed_cost: 30 },
      p_recipe: [],
    });
    expect(r.error, r.error?.message).toBeNull();
    const r2 = await asA.rpc("fn_bar_save_menu", {
      p_entity: E(), p_menu: { menu_id: GIMLET, name: "ทดสอบ Gimlet", price: 100, category_id: "T-c" },
      p_recipe: [{ item_id: "T-GIN", qty: 45 }, { garnish_id: WHEEL, qty: 1 }],
    });
    expect(r2.error, r2.error?.message).toBeNull();
    const del = await asA.rpc("fn_bar_save_garnishes", {
      p_entity: E(), p_rows: [{ garnish_id: WHEEL, name: "Lime Wheel", item_id: "T-LIME", qty: 1 / 7, qty_text: "1/7", qty_unit: "ลูก" }],
    });
    expect(del.error, del.error?.message).toBeNull();
    expect((await garnishesNow()).map((g) => g.name)).toEqual(["Lime Wheel"]);
  });
});

describe("④ ห้องทดลอง", () => {
  let recipeId = "";
  const today = new Date().toISOString().slice(0, 10);

  it("ชงรอบที่มีบรรทัดชุด = ตัดวัตถุดิบของชุด × แก้ว · บรรทัดจำชุดและปริมาณต่อชุด", async () => {
    const lime = await qtyOf("T-LIME");
    const r = await asBar.rpc("fn_bar_lab_round", {
      p_entity: E(), p_recipe_id: null, p_name: "ทดสอบ Lab Gimlet", p_glasses: 7,
      p_lines: [{ item_id: "T-GIN", qty: 45 }, { garnish_id: WHEEL, qty: 1 }], p_note: null, p_business_date: today,
    });
    expect(r.error, r.error?.message).toBeNull();
    recipeId = (r.data as { recipe_id: string }).recipe_id;
    expect(Number((r.data as { cost: number }).cost)).toBe(385);
    expect(await qtyOf("T-LIME")).toBeCloseTo(lime - 1, 9);
    const { data } = await admin().from("bar_lab_use_line").select("kind, item_id, garnish_id, garnish_qty, label, qty")
      .eq("tenant_id", A.tenantId).eq("use_id", (r.data as { use_id: string }).use_id).eq("line_no", 2).single();
    expect(data!.kind).toBe("ชุดตกแต่ง");
    expect(data!.garnish_id).toBe(WHEEL);
    expect(data!.label).toBe("Lime Wheel (ทดสอบ มะนาว 1/7 ลูก)");
    expect(Number(data!.garnish_qty)).toBeCloseTo(1 / 7, 12);
  });

  it("ใช้สูตรทดลองทำคอนเทนต์ = ชุด ณ ตอนนี้ (แก้สัดส่วนแล้วตามใหม่)", async () => {
    const s = await asA.rpc("fn_bar_save_garnishes", {
      p_entity: E(), p_rows: [{ garnish_id: WHEEL, name: "Lime Wheel", item_id: "T-LIME", qty: 0.5, qty_text: null, qty_unit: "ลูก" }],
    });
    expect(s.error, s.error?.message).toBeNull();
    const lime = await qtyOf("T-LIME");
    const r = await asA.rpc("fn_bar_lab_use", {
      p_entity: E(), p_category_id: "content", p_event: "ทดสอบ ถ่ายรีล", p_note: null,
      p_menus: [], p_recipes: [{ recipe_id: recipeId, qty: 2 }], p_items: [], p_business_date: today,
    });
    expect(r.error, r.error?.message).toBeNull();
    expect(await qtyOf("T-LIME")).toBeCloseTo(lime - 1, 9);
    // 2 × (45 × 1.2 + 0.5 × 7) = 2 × 57.5
    expect(Number((r.data as { cost: number }).cost)).toBe(115);
  });
});
