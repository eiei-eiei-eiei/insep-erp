import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, seedUser, admin, type Tenant } from "./harness";
import { cartCost } from "../../lib/bar/cost";
import type { BarItem, BarMenu, HouseSlot } from "../../lib/bar/types";

/**
 * บาร์: เหล้าประจำบ้าน · ชุดตกแต่ง · วัตถุดิบใช้บ่อย — ยิง Supabase จริง (D127 · migration 0090)
 *
 * 🔴 ตรรกะแปลงช่อง → ขวด ตอนสั่ง / การคืนสต็อกตามที่ตัดจริง / ด่านหน่วย อยู่ใน plpgsql ทั้งหมด
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

const slotsNow = async () => {
  const { data } = await admin().from("bar_house_slot").select("slot_id, name, item_id, sort")
    .eq("tenant_id", A.tenantId).eq("entity_id", E()).order("sort");
  return data ?? [];
};

/** id ของเมนู Gin Tonic ที่ RPC สร้าง (เปลี่ยน id ทีหลังไม่ได้ — FK ของสูตรไม่ cascade on update) */
let GT = "";
const gtLine = (qty = 1) => ({ menu_id: GT, menu_name: "ทดสอบ Gin Tonic", qty, price: 200, amount: 200 * qty });

async function newSale(qty = 1): Promise<string> {
  const open = await asA.rpc("fn_bar_open_sale", { p_entity: E() });
  expect(open.error, open.error?.message).toBeNull();
  const saleNo = (open.data as { sale_no: string }).sale_no;
  const add = await asA.rpc("fn_bar_add_lines", { p_entity: E(), p_sale_no: saleNo, p_items: [gtLine(qty)] });
  expect(add.error, add.error?.message).toBeNull();
  return saleNo;
}

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("bar-hs");
  asA = await signIn(A);
  asBar = (await seedUser(A, "bar")).client;
  const db = admin();
  const r1 = await db.from("bar_category").insert({ ...base(), category_id: "T-c", name: "ทดสอบ", sort: 1, is_system: false });
  if (r1.error) throw new Error(r1.error.message);
  const r2 = await db.from("bar_item").insert([
    { ...base(), item_id: "T-GIN", name: "ทดสอบ Gordon", unit: "ml", qty: 2100, cost_per_unit: 1.2 },
    { ...base(), item_id: "T-GIN2", name: "ทดสอบ Bombay", unit: "ml", qty: 700, cost_per_unit: 2 },
    { ...base(), item_id: "T-BTL", name: "ทดสอบ จินขวด", unit: "ขวด", qty: 10, cost_per_unit: 500 },
    { ...base(), item_id: "T-TON", name: "ทดสอบ โทนิค", unit: "ml", qty: 5000, cost_per_unit: 0.1 },
    { ...base(), item_id: "T-LIME", name: "ทดสอบ มะนาว", unit: "ml", qty: 1000, cost_per_unit: 0.2 },
  ]);
  if (r2.error) throw new Error(r2.error.message);
}, 180_000);

afterAll(async () => {
  // ★ cleanup เรียก fn_mig_truncate — พิสูจน์ไปในตัวว่าตารางใหม่อยู่ในลำดับลบ (ไม่ติด FK)
  await cleanupTestTenants();
}, 120_000);

describe("① ตั้งช่องเหล้าประจำบ้าน", () => {
  it("🚨 ไม่เลือกขวด = บันทึกไม่ได้ (ช่องว่างไม่มีอยู่จริง)", async () => {
    const r = await asA.rpc("fn_bar_save_house_slots", { p_entity: E(), p_slots: [{ name: "House Gin", item_id: null }] });
    expect(r.error?.message).toContain("เลือกขวด");
    expect(await slotsNow()).toEqual([]);
  });

  it("ชื่อซ้ำ (ไม่สนตัวพิมพ์) = บล็อกทั้งชุด", async () => {
    const r = await asA.rpc("fn_bar_save_house_slots", {
      p_entity: E(),
      p_slots: [{ name: "House Gin", item_id: "T-GIN" }, { name: "house gin ", item_id: "T-GIN2" }],
    });
    expect(r.error?.message).toContain("ซ้ำ");
    expect(await slotsNow()).toEqual([]);
  });

  it("✓ สร้างช่องได้ · ลำดับตามลิสต์", async () => {
    const r = await asA.rpc("fn_bar_save_house_slots", {
      p_entity: E(),
      p_slots: [{ name: "House Gin", item_id: "T-GIN" }, { name: "House Vodka", item_id: "T-GIN2" }],
    });
    expect(r.error, r.error?.message).toBeNull();
    const s = await slotsNow();
    expect(s.map((x) => [x.name, x.item_id, x.sort])).toEqual([["House Gin", "T-GIN", 0], ["House Vodka", "T-GIN2", 1]]);
  });

  it("🚨 พนักงานบาร์ (bar.write ไม่มี bar.config) ตั้งช่องไม่ได้ — และแก้ตรงผ่าน API ก็ไม่ได้", async () => {
    const r = await asBar.rpc("fn_bar_save_house_slots", { p_entity: E(), p_slots: [] });
    expect(r.error?.message).toContain("ไม่มีสิทธิ์");
    const gin = (await slotsNow())[0];
    const u = await asBar.from("bar_house_slot").update({ item_id: "T-GIN2" }).eq("slot_id", gin.slot_id).select();
    expect(u.data ?? []).toEqual([]); // RLS กรองแถวทิ้ง = ไม่มีแถวถูกแก้
    expect((await slotsNow())[0].item_id).toBe("T-GIN");
  });
});

describe("② สูตรอ้างช่อง → ตอนสั่งตัดขวดที่ช่องชี้อยู่", () => {
  let ginSlot = "";
  let firstSale = "";

  it("บันทึกเมนูที่มีบรรทัดช่อง + ขวดตรง (พนักงานบาร์สร้างเมนูได้)", async () => {
    ginSlot = (await slotsNow())[0].slot_id;
    const r = await asBar.rpc("fn_bar_save_menu", {
      p_entity: E(),
      p_menu: { menu_id: null, name: "ทดสอบ Gin Tonic", price: 200, category_id: "T-c" },
      p_recipe: [{ slot_id: ginSlot, qty: 45 }, { item_id: "T-TON", qty: 120 }],
    });
    expect(r.error, r.error?.message).toBeNull();
    GT = (r.data as { menu_id: string }).menu_id;
    const { data } = await admin().from("bar_recipe_slot").select("slot_id, qty")
      .eq("tenant_id", A.tenantId).eq("menu_id", GT);
    expect(data!.map((x) => [x.slot_id, Number(x.qty)])).toEqual([[ginSlot, 45]]);
  });

  it("ช่องที่ไม่มีอยู่ = บันทึกเมนูไม่ได้ (ข้อความไทย ไม่ใช่ FK ดิบ)", async () => {
    const r = await asA.rpc("fn_bar_save_menu", {
      p_entity: E(),
      p_menu: { menu_id: null, name: "ทดสอบ ผี", price: 1, category_id: "T-c" },
      p_recipe: [{ slot_id: "HS-NOPE", qty: 45 }],
    });
    expect(r.error?.message).toContain("ไม่พบช่องเหล้าประจำบ้าน");
  });

  it("สั่ง 2 แก้ว → ตัด Gordon 90 + โทนิค 240 · ต้นทุนแช่ = (45×1.2 + 120×0.1)×2 = 132", async () => {
    const gin = await qtyOf("T-GIN");
    const gin2 = await qtyOf("T-GIN2");
    firstSale = await newSale(2);
    expect(await qtyOf("T-GIN")).toBe(gin - 90);
    expect(await qtyOf("T-GIN2")).toBe(gin2);
    const { data } = await admin().from("bar_sale_item").select("cost, moves_linked, line_no")
      .eq("tenant_id", A.tenantId).eq("sale_no", firstSale).single();
    expect(Number(data!.cost)).toBe(132);
    expect(data!.moves_linked).toBe(true);
    const mv = await admin().from("bar_move").select("item_id, ref_line")
      .eq("tenant_id", A.tenantId).eq("ref_no", firstSale).eq("reason", "ขาย");
    expect(mv.data!.every((m) => m.ref_line === data!.line_no)).toBe(true);
  });

  it("🚨 ต้นทุนที่ SQL คิด ตรงกับ lib/bar/cost.ts ที่แปลงช่องด้วย resolveRecipe (สูตรไม่แยกร่าง)", async () => {
    const items: BarItem[] = [
      { itemId: "T-GIN", name: "g", unit: "ml", qty: 0, costPerUnit: 1.2 },
      { itemId: "T-TON", name: "t", unit: "ml", qty: 0, costPerUnit: 0.1 },
    ];
    const slots: HouseSlot[] = [{ slotId: ginSlot, name: "House Gin", itemId: "T-GIN", sort: 0 }];
    const menus: BarMenu[] = [{
      menuId: GT, name: "x", price: 200, categoryId: "T-c",
      recipe: [{ slotId: ginSlot, qty: 45 }, { itemId: "T-TON", qty: 120 }],
    }];
    expect(cartCost([{ menuId: GT, menuName: "x", qty: 2, price: 200 }], menus, items, slots)).toBe(132);
  });

  it("เปลี่ยนขวดในช่อง (หน่วยเดียวกัน) → แก้วถัดไปตัด Bombay · บิลเก่าต้นทุนไม่ขยับ", async () => {
    const r = await asA.rpc("fn_bar_save_house_slots", {
      p_entity: E(),
      p_slots: (await slotsNow()).map((s) => ({
        slot_id: s.slot_id, name: s.name, item_id: s.slot_id === ginSlot ? "T-GIN2" : s.item_id,
      })),
    });
    expect(r.error, r.error?.message).toBeNull();
    const gin = await qtyOf("T-GIN");
    const gin2 = await qtyOf("T-GIN2");
    const sale2 = await newSale(1);
    expect(await qtyOf("T-GIN")).toBe(gin);
    expect(await qtyOf("T-GIN2")).toBe(gin2 - 45);
    const { data } = await admin().from("bar_sale_item").select("cost").eq("tenant_id", A.tenantId).eq("sale_no", sale2).single();
    expect(Number(data!.cost)).toBe(102); // 45×2 + 120×0.1
    const old = await admin().from("bar_sale_item").select("cost").eq("tenant_id", A.tenantId).eq("sale_no", firstSale).single();
    expect(Number(old.data!.cost)).toBe(132);
  });

  it("🚨 ยกเลิกรายการของบิลเก่า → คืนเข้า Gordon (ขวดที่ตัดจริง) ไม่ใช่ Bombay (ขวดของช่องตอนนี้)", async () => {
    const gin = await qtyOf("T-GIN");
    const gin2 = await qtyOf("T-GIN2");
    const ton = await qtyOf("T-TON");
    const r = await asA.rpc("fn_bar_void_line", { p_entity: E(), p_sale_no: firstSale, p_line_no: 1, p_reason: "ทดสอบ" });
    expect(r.error, r.error?.message).toBeNull();
    expect(await qtyOf("T-GIN")).toBe(gin + 90);
    expect(await qtyOf("T-GIN2")).toBe(gin2);
    expect(await qtyOf("T-TON")).toBe(ton + 240);
  });

  it("🚨 ยกเลิกทั้งบิล → คืนตามที่ตัดจริงเหมือนกัน", async () => {
    const sale = await newSale(1); // ตัด Bombay 45
    // เปลี่ยนช่องกลับเป็น Gordon ก่อนยกเลิก
    await asA.rpc("fn_bar_save_house_slots", {
      p_entity: E(),
      p_slots: (await slotsNow()).map((s) => ({ slot_id: s.slot_id, name: s.name, item_id: s.slot_id === ginSlot ? "T-GIN" : s.item_id })),
    });
    const gin = await qtyOf("T-GIN");
    const gin2 = await qtyOf("T-GIN2");
    const r = await asA.rpc("fn_bar_void_sale", { p_entity: E(), p_sale_no: sale, p_reason: "ทดสอบ" });
    expect(r.error, r.error?.message).toBeNull();
    expect(await qtyOf("T-GIN2")).toBe(gin2 + 45);
    expect(await qtyOf("T-GIN")).toBe(gin);
  });

  it("บรรทัดเก่าก่อน 0090 (moves_linked = false) ยังคืนตามสูตรปัจจุบันแบบเดิม", async () => {
    const sale = await newSale(1); // ช่องชี้ Gordon
    await admin().from("bar_sale_item").update({ moves_linked: false }).eq("tenant_id", A.tenantId).eq("sale_no", sale);
    const ton = await qtyOf("T-TON");
    const r = await asA.rpc("fn_bar_void_line", { p_entity: E(), p_sale_no: sale, p_line_no: 1 });
    expect(r.error, r.error?.message).toBeNull();
    // พฤติกรรมเดิม: อ่าน bar_recipe อย่างเดียว (โทนิค) — ไม่เปลี่ยนให้
    expect(await qtyOf("T-TON")).toBe(ton + 120);
  });
});

describe("③ ด่านหน่วยของช่อง + ลบช่อง", () => {
  it("🚨 ช่องที่มีสูตรอ้าง เปลี่ยนเป็นขวดคนละหน่วยไม่ได้ — ทั้งผ่าน RPC และแก้ตารางตรง", async () => {
    const s = await slotsNow();
    const gin = s.find((x) => x.name === "House Gin")!;
    const r = await asA.rpc("fn_bar_save_house_slots", {
      p_entity: E(),
      p_slots: s.map((x) => ({ slot_id: x.slot_id, name: x.name, item_id: x.slot_id === gin.slot_id ? "T-BTL" : x.item_id })),
    });
    expect(r.error?.message).toContain("หน่วย");
    const u = await asA.from("bar_house_slot").update({ item_id: "T-BTL" }).eq("slot_id", gin.slot_id);
    expect(u.error?.message).toContain("หน่วย");
    expect((await slotsNow()).find((x) => x.slot_id === gin.slot_id)!.item_id).toBe("T-GIN");
  });

  it("✓ ช่องที่ไม่มีเมนูใช้ เปลี่ยนเป็นหน่วยอื่นได้", async () => {
    const s = await slotsNow();
    const r = await asA.rpc("fn_bar_save_house_slots", {
      p_entity: E(),
      p_slots: s.map((x) => ({ slot_id: x.slot_id, name: x.name, item_id: x.name === "House Vodka" ? "T-BTL" : x.item_id })),
    });
    expect(r.error, r.error?.message).toBeNull();
  });

  it("🚨 ลบช่องที่มีสูตรอ้าง = บล็อก + บอกชื่อเมนู · ✓ ลบช่องที่ไม่มีใครใช้ได้", async () => {
    const s = await slotsNow();
    const keepVodkaOnly = s.filter((x) => x.name === "House Vodka").map((x) => ({ slot_id: x.slot_id, name: x.name, item_id: x.item_id }));
    const r = await asA.rpc("fn_bar_save_house_slots", { p_entity: E(), p_slots: keepVodkaOnly });
    expect(r.error?.message).toContain("ทดสอบ Gin Tonic");
    expect((await slotsNow()).length).toBe(2);

    const keepGinOnly = s.filter((x) => x.name === "House Gin").map((x) => ({ slot_id: x.slot_id, name: x.name, item_id: x.item_id }));
    const ok = await asA.rpc("fn_bar_save_house_slots", { p_entity: E(), p_slots: keepGinOnly });
    expect(ok.error, ok.error?.message).toBeNull();
    expect((await slotsNow()).map((x) => x.name)).toEqual(["House Gin"]);
  });
});

describe("④ ชุดตกแต่ง + วัตถุดิบใช้บ่อย", () => {
  it("ชุดตกแต่ง: ไม่เลือกวัตถุดิบ / จำนวน 0 = บล็อก · ✓ บันทึกได้ + ลบได้", async () => {
    const bad = await asA.rpc("fn_bar_save_garnishes", { p_entity: E(), p_rows: [{ name: "มะนาว", item_id: null, qty: 3.5 }] });
    expect(bad.error?.message).toContain("เลือกวัตถุดิบ");
    const zero = await asA.rpc("fn_bar_save_garnishes", { p_entity: E(), p_rows: [{ name: "มะนาว", item_id: "T-LIME", qty: 0 }] });
    expect(zero.error?.message).toContain("มากกว่า 0");
    const ok = await asA.rpc("fn_bar_save_garnishes", {
      p_entity: E(),
      p_rows: [{ name: "มะนาว half wheel", item_id: "T-LIME", qty: 3.5 }, { name: "โทนิคท็อป", item_id: "T-TON", qty: 10 }],
    });
    expect(ok.error, ok.error?.message).toBeNull();
    const { data } = await admin().from("bar_garnish").select("garnish_id, name, qty, sort").eq("tenant_id", A.tenantId).order("sort");
    expect(data!.map((g) => [g.name, Number(g.qty), g.sort])).toEqual([["มะนาว half wheel", 3.5, 0], ["โทนิคท็อป", 10, 1]]);
    const del = await asA.rpc("fn_bar_save_garnishes", {
      p_entity: E(), p_rows: [{ garnish_id: data![1].garnish_id, name: "โทนิคท็อป", item_id: "T-TON", qty: 10 }],
    });
    expect(del.error, del.error?.message).toBeNull();
    const after = await admin().from("bar_garnish").select("name, sort").eq("tenant_id", A.tenantId);
    expect(after.data).toEqual([{ name: "โทนิคท็อป", sort: 0 }]);
  });

  it("ใช้บ่อย: เรียงตามลำดับที่ส่ง · ตัวที่ไม่อยู่ในลำดับ = ถอดหมุด · id ที่ไม่มีจริง = บล็อก", async () => {
    const pins = async () =>
      (await admin().from("bar_item").select("item_id, pin_sort").eq("tenant_id", A.tenantId).not("pin_sort", "is", null).order("pin_sort")).data!
        .map((x) => x.item_id);
    expect((await asA.rpc("fn_bar_save_pins", { p_entity: E(), p_items: ["T-LIME", "T-TON"] })).error).toBeNull();
    expect(await pins()).toEqual(["T-LIME", "T-TON"]);
    expect((await asA.rpc("fn_bar_save_pins", { p_entity: E(), p_items: ["T-TON"] })).error).toBeNull();
    expect(await pins()).toEqual(["T-TON"]);
    const bad = await asA.rpc("fn_bar_save_pins", { p_entity: E(), p_items: ["T-NOPE"] });
    expect(bad.error?.message).toContain("รีเฟรช");
    expect(await pins()).toEqual(["T-TON"]);
  });

  it("🚨 พนักงานบาร์ตั้งชุดตกแต่ง/ใช้บ่อยไม่ได้", async () => {
    expect((await asBar.rpc("fn_bar_save_garnishes", { p_entity: E(), p_rows: [] })).error?.message).toContain("ไม่มีสิทธิ์");
    expect((await asBar.rpc("fn_bar_save_pins", { p_entity: E(), p_items: [] })).error?.message).toContain("ไม่มีสิทธิ์");
  });
});
