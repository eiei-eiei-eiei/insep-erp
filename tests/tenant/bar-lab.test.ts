import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, seedUser, admin, type Tenant } from "./harness";

/**
 * บาร์: ห้องทดลอง — ยิง Supabase จริง (D129 · migration 0091)
 *
 * 🔴 ตัดสต็อก/แช่ทุน/คืนของ/สิทธิ์ลบ อยู่ใน plpgsql ทั้งหมด — build/lint/test มองไม่เห็น (D79)
 * ★ ทุกข้อที่บล็อกมีคู่ที่ทำได้จริงกำกับ (2 ทิศทาง)
 */

let A: Tenant;
let asA: SupabaseClient;
let asBar: SupabaseClient;
const E = () => A.entityId;
const base = () => ({ tenant_id: A.tenantId, entity_id: A.entityId });
const today = "2026-10-25";

const qtyOf = async (itemId: string): Promise<number> => {
  const { data } = await admin().from("bar_item").select("qty")
    .eq("tenant_id", A.tenantId).eq("entity_id", E()).eq("item_id", itemId).single();
  return Number(data!.qty);
};
const useOf = async (useId: string) => {
  const { data } = await admin().from("bar_lab_use").select("*").eq("tenant_id", A.tenantId).eq("use_id", useId).maybeSingle();
  return data;
};
const recipeOf = async (id: string) => {
  const { data } = await admin().from("bar_lab_recipe").select("*").eq("tenant_id", A.tenantId).eq("recipe_id", id).maybeSingle();
  return data;
};

let slotId = "";

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("bar-lab");
  asA = await signIn(A);
  asBar = (await seedUser(A, "bar")).client;
  const db = admin();
  const c = await db.from("bar_category").insert({ ...base(), category_id: "T-c", name: "ทดสอบ", sort: 1, is_system: false });
  if (c.error) throw new Error(c.error.message);
  const i = await db.from("bar_item").insert([
    { ...base(), item_id: "T-GIN", name: "ทดสอบ Gordon", unit: "ml", qty: 1000, cost_per_unit: 1 },
    { ...base(), item_id: "T-GIN2", name: "ทดสอบ Bombay", unit: "ml", qty: 1000, cost_per_unit: 2 },
    { ...base(), item_id: "T-SYR", name: "ทดสอบ ไซรัป", unit: "ml", qty: 1000, cost_per_unit: 0.1 },
    { ...base(), item_id: "T-LIME", name: "ทดสอบ มะนาว", unit: "ลูก", qty: 20, cost_per_unit: 5 },
  ]);
  if (i.error) throw new Error(i.error.message);
  const m = await db.from("bar_menu").insert({ ...base(), menu_id: "T-M1", name: "ทดสอบ Gin Shot", price: 120, category_id: "T-c" });
  if (m.error) throw new Error(m.error.message);
  const r = await db.from("bar_recipe").insert({ ...base(), menu_id: "T-M1", item_id: "T-GIN", qty: 30 });
  if (r.error) throw new Error(r.error.message);
  const s = await asA.rpc("fn_bar_save_house_slots", { p_entity: E(), p_slots: [{ name: "House Gin", item_id: "T-GIN" }] });
  if (s.error) throw new Error(s.error.message);
  const { data } = await db.from("bar_house_slot").select("slot_id").eq("tenant_id", A.tenantId).single();
  slotId = data!.slot_id;
}, 180_000);

afterAll(async () => {
  // ★ cleanup เรียก fn_mig_truncate — พิสูจน์ไปในตัวว่าตารางห้องทดลองอยู่ในลำดับลบ
  await cleanupTestTenants();
}, 120_000);

let recipeId = "";
let round1 = "";

describe("① ลองชงสูตรใหม่ = การ์ด + รอบ 1 + ตัดสต็อก + แช่ทุน ทีเดียว", () => {
  it("ไม่มีชื่อ / ไม่มีสูตร = บล็อก ไม่มีอะไรเกิด", async () => {
    const a = await asBar.rpc("fn_bar_lab_round", {
      p_entity: E(), p_recipe_id: null, p_name: " ", p_glasses: 1,
      p_lines: [{ item_id: "T-SYR", qty: 10 }], p_note: null, p_business_date: today,
    });
    expect(a.error?.message).toContain("ตั้งชื่อสูตร");
    const b = await asBar.rpc("fn_bar_lab_round", {
      p_entity: E(), p_recipe_id: null, p_name: "ทดสอบ ฟักทอง", p_glasses: 1,
      p_lines: [], p_note: null, p_business_date: today,
    });
    expect(b.error?.message).toContain("อย่างน้อย 1 บรรทัด");
    const { count } = await admin().from("bar_lab_recipe").select("*", { count: "exact", head: true }).eq("tenant_id", A.tenantId);
    expect(count).toBe(0);
  });

  it("✓ พนักงานบาร์ลองชงได้: 2 แก้ว (House Gin 30 + ไซรัป 20) → ตัด Gordon 60 · ไซรัป 40 · ทุน 64", async () => {
    const r = await asBar.rpc("fn_bar_lab_round", {
      p_entity: E(), p_recipe_id: null, p_name: "ทดสอบ ฟักทอง", p_glasses: 2,
      p_lines: [{ slot_id: slotId, qty: 30 }, { item_id: "T-SYR", qty: 20 }], p_note: "หวานไป", p_business_date: today,
    });
    expect(r.error, r.error?.message).toBeNull();
    const d = r.data as { recipe_id: string; use_id: string; round_no: number; cost: number };
    recipeId = d.recipe_id;
    round1 = d.use_id;
    expect(d.round_no).toBe(1);
    expect(Number(d.cost)).toBe(64); // 30×2×1 + 20×2×0.1
    expect(await qtyOf("T-GIN")).toBe(940);
    expect(await qtyOf("T-SYR")).toBe(960);
    const u = await useOf(round1);
    expect(u!.category_id).toBe("trial");
    expect(u!.note).toBe("หวานไป");
    const { data: lines } = await admin().from("bar_lab_use_line").select("line_no, kind, item_id, slot_id, label, qty, cost")
      .eq("tenant_id", A.tenantId).eq("use_id", round1).order("line_no");
    expect(lines!.map((l) => [l.kind, l.item_id, l.slot_id, l.label, Number(l.qty), Number(l.cost)])).toEqual([
      ["สูตร", "T-GIN", slotId, "House Gin (ทดสอบ Gordon)", 30, 60],
      ["สูตร", "T-SYR", null, "ทดสอบ ไซรัป", 20, 4],
    ]);
    const { data: mv } = await admin().from("bar_move").select("item_id, delta, reason").eq("tenant_id", A.tenantId).eq("ref_no", round1);
    expect(mv!.every((m) => m.reason === "ห้องทดลอง")).toBe(true);
    // หมวดตั้งต้น 2 ตัวถูกสร้างให้เอง
    const { data: cats } = await admin().from("bar_lab_category").select("category_id, is_system").eq("tenant_id", A.tenantId).order("sort");
    expect(cats).toEqual([{ category_id: "trial", is_system: true }, { category_id: "content", is_system: false }]);
  });

  it("รอบ 2 เลขต่อ · เปลี่ยนขวดใน House แล้วทุนรอบ 1 ไม่ขยับ", async () => {
    await asA.rpc("fn_bar_save_house_slots", { p_entity: E(), p_slots: [{ slot_id: slotId, name: "House Gin", item_id: "T-GIN2" }] });
    const r = await asA.rpc("fn_bar_lab_round", {
      p_entity: E(), p_recipe_id: recipeId, p_name: "", p_glasses: 1,
      p_lines: [{ slot_id: slotId, qty: 30 }, { item_id: "T-SYR", qty: 15 }], p_note: null, p_business_date: today,
    });
    expect(r.error, r.error?.message).toBeNull();
    expect((r.data as { round_no: number }).round_no).toBe(2);
    expect(Number((r.data as { cost: number }).cost)).toBe(61.5); // 30×2 + 15×0.1
    expect(Number((await useOf(round1))!.cost_total)).toBe(64);
  });
});

describe("② ใช้เมนูที่มี / สูตรทดลอง / วัตถุดิบ", () => {
  let useId = "";
  it("ถ่ายคอนเทนต์: Gin Shot 2 แก้ว + สูตรทดลอง 1 แก้ว (รอบล่าสุด · House = Bombay ตอนนี้) + มะนาว 1 ลูก", async () => {
    const before = { gin: await qtyOf("T-GIN"), gin2: await qtyOf("T-GIN2"), syr: await qtyOf("T-SYR"), lime: await qtyOf("T-LIME") };
    const r = await asBar.rpc("fn_bar_lab_use", {
      p_entity: E(), p_category_id: "content", p_event: "ทดสอบ ถ่ายรีล", p_note: null,
      p_menus: [{ menu_id: "T-M1", qty: 2 }], p_recipes: [{ recipe_id: recipeId, qty: 1 }], p_items: [{ item_id: "T-LIME", qty: 1 }],
      p_business_date: today,
    });
    expect(r.error, r.error?.message).toBeNull();
    useId = (r.data as { use_id: string }).use_id;
    // 30×1×2 = 60 · 30×2 + 15×0.1 = 61.5 · 5 = 5
    expect(Number((r.data as { cost: number }).cost)).toBe(126.5);
    expect(await qtyOf("T-GIN")).toBe(before.gin - 60);
    expect(await qtyOf("T-GIN2")).toBe(before.gin2 - 30);
    expect(await qtyOf("T-SYR")).toBe(before.syr - 15);
    expect(await qtyOf("T-LIME")).toBe(before.lime - 1);
    const u = await useOf(useId);
    expect([u!.category_id, u!.event_name, u!.recipe_id]).toEqual(["content", "ทดสอบ ถ่ายรีล", null]);
  });

  it("หมวดที่ไม่มีอยู่ / ไม่เลือกอะไรเลย = บล็อก", async () => {
    const a = await asA.rpc("fn_bar_lab_use", {
      p_entity: E(), p_category_id: "NOPE", p_event: null, p_note: null,
      p_menus: [{ menu_id: "T-M1", qty: 1 }], p_recipes: [], p_items: [], p_business_date: today,
    });
    expect(a.error?.message).toContain("ไม่พบหมวด");
    const b = await asA.rpc("fn_bar_lab_use", {
      p_entity: E(), p_category_id: "content", p_event: null, p_note: null,
      p_menus: [], p_recipes: [], p_items: [], p_business_date: today,
    });
    expect(b.error?.message).toContain("ยังไม่ได้เลือก");
  });

  it("🚨 ลบรายการ → คืนของเข้าขวดที่ตัดจริง (Bombay) แม้ House เปลี่ยนกลับเป็น Gordon แล้ว", async () => {
    await asA.rpc("fn_bar_save_house_slots", { p_entity: E(), p_slots: [{ slot_id: slotId, name: "House Gin", item_id: "T-GIN" }] });
    const before = { gin: await qtyOf("T-GIN"), gin2: await qtyOf("T-GIN2") };
    const r = await asBar.rpc("fn_bar_lab_delete_use", { p_entity: E(), p_use_id: useId });
    expect(r.error, r.error?.message).toBeNull();
    expect(await qtyOf("T-GIN2")).toBe(before.gin2 + 30);
    expect(await qtyOf("T-GIN")).toBe(before.gin + 60); // Gin Shot 2 แก้ว
    expect(await useOf(useId)).toBeNull();
  });
});

describe("③ สิทธิ์ลบ + เปลี่ยนสถานะ + หมวด", () => {
  it("🚨 พนักงานบาร์ลบรายการของคนอื่นไม่ได้ · เจ้าของลบได้", async () => {
    const r = await asA.rpc("fn_bar_lab_use", {
      p_entity: E(), p_category_id: "content", p_event: null, p_note: null,
      p_menus: [], p_recipes: [], p_items: [{ item_id: "T-LIME", qty: 1 }], p_business_date: today,
    });
    const id = (r.data as { use_id: string }).use_id;
    const bad = await asBar.rpc("fn_bar_lab_delete_use", { p_entity: E(), p_use_id: id });
    expect(bad.error?.message).toContain("ไม่มีสิทธิ์");
    expect(await useOf(id)).not.toBeNull();
    const ok = await asA.rpc("fn_bar_lab_delete_use", { p_entity: E(), p_use_id: id });
    expect(ok.error, ok.error?.message).toBeNull();
  });

  it("🚨 ตารางห้องทดลองไม่มี policy เขียน — แก้ทุนตรงผ่าน API ไม่ได้แม้เป็นเจ้าของ", async () => {
    const u = await asA.from("bar_lab_use").update({ cost_total: 0 }).eq("use_id", round1).select();
    expect(u.data ?? []).toEqual([]);
    expect(Number((await useOf(round1))!.cost_total)).toBe(64);
    // อ่านได้ (bar.read)
    const read = await asBar.from("bar_lab_use").select("use_id").eq("use_id", round1);
    expect(read.data).toHaveLength(1);
  });

  it("เลิกลอง → ลองรอบใหม่ไม่ได้ · กลับมาลองต่อ → ได้", async () => {
    await asBar.rpc("fn_bar_lab_update_recipe", { p_entity: E(), p_recipe_id: recipeId, p_name: "ทดสอบ ฟักทอง", p_status: "เลิกลอง" });
    const args = {
      p_entity: E(), p_recipe_id: recipeId, p_name: "", p_glasses: 1,
      p_lines: [{ item_id: "T-SYR", qty: 1 }], p_note: null, p_business_date: today,
    };
    expect((await asBar.rpc("fn_bar_lab_round", args)).error?.message).toContain("กลับมาลองต่อ");
    await asBar.rpc("fn_bar_lab_update_recipe", { p_entity: E(), p_recipe_id: recipeId, p_name: "ทดสอบ ฟักทอง", p_status: "กำลังลอง" });
    const ok = await asBar.rpc("fn_bar_lab_round", args);
    expect(ok.error, ok.error?.message).toBeNull();
    expect((ok.data as { round_no: number }).round_no).toBe(3);
  });

  it("หมวด: พนักงานเพิ่มได้ (ชื่อซ้ำ = คืนตัวเดิม) · แก้/ลบต้อง bar.config · ระบบ/มีรายการ ลบไม่ได้", async () => {
    const a = await asBar.rpc("fn_bar_lab_add_category", { p_entity: E(), p_name: "ทดสอบ ชิมให้ลูกค้า" });
    expect(a.error, a.error?.message).toBeNull();
    const again = await asBar.rpc("fn_bar_lab_add_category", { p_entity: E(), p_name: " ทดสอบ ชิมให้ลูกค้า " });
    expect((again.data as { category_id: string }).category_id).toBe((a.data as { category_id: string }).category_id);
    const newId = (a.data as { category_id: string }).category_id;

    expect((await asBar.rpc("fn_bar_lab_save_categories", { p_entity: E(), p_rows: [] })).error?.message).toContain("ไม่มีสิทธิ์");
    const sys = await asA.rpc("fn_bar_lab_save_categories", {
      p_entity: E(), p_rows: [{ category_id: "content", name: "ถ่ายคอนเทนต์" }, { category_id: newId, name: "x" }],
    });
    expect(sys.error?.message).toContain("หมวดของระบบ");
    // content ยังไม่มีรายการ (ลบไปหมดแล้ว) → ลบได้ · trial ต้องอยู่
    const ok = await asA.rpc("fn_bar_lab_save_categories", {
      p_entity: E(), p_rows: [{ category_id: "trial", name: "ทดลองสูตร (R&D)" }, { category_id: newId, name: "ชิมให้ลูกค้า" }],
    });
    expect(ok.error, ok.error?.message).toBeNull();
    const { data } = await admin().from("bar_lab_category").select("category_id, name, sort").eq("tenant_id", A.tenantId).order("sort");
    expect(data).toEqual([
      { category_id: "trial", name: "ทดลองสูตร (R&D)", sort: 0 },
      { category_id: newId, name: "ชิมให้ลูกค้า", sort: 1 },
    ]);
    // trial มีรายการ → ต่อให้ไม่ใช่ระบบก็ลบไม่ได้ (พิสูจน์ด้วย error ระบบมาก่อน)
    const used = await asA.rpc("fn_bar_lab_save_categories", { p_entity: E(), p_rows: [{ category_id: newId, name: "ชิมให้ลูกค้า" }] });
    expect(used.error?.message).toMatch(/หมวดของระบบ|มีรายการ/);
  });
});

describe("④ ส่งขึ้นเมนูขาย", () => {
  it("ชื่อว่าง = เมนูไม่เกิด และการ์ดไม่เปลี่ยนสถานะ (transaction เดียว)", async () => {
    const r = await asBar.rpc("fn_bar_lab_promote", {
      p_entity: E(), p_recipe_id: recipeId, p_menu: { name: " ", price: 250, category_id: "T-c" },
      p_recipe: [{ slot_id: slotId, qty: 30 }],
    });
    expect(r.error?.message).toContain("ชื่อเมนู");
    expect((await recipeOf(recipeId))!.status).toBe("กำลังลอง");
  });

  it("✓ สร้างเมนูพร้อมสูตร (บรรทัด House ยังเป็นช่อง) + การ์ดขึ้น ขึ้นเมนูแล้ว", async () => {
    const r = await asBar.rpc("fn_bar_lab_promote", {
      p_entity: E(), p_recipe_id: recipeId, p_menu: { name: "ทดสอบ ฟักทอง Negroni", price: 250, category_id: "T-c" },
      p_recipe: [{ slot_id: slotId, qty: 30 }, { item_id: "T-SYR", qty: 15 }],
    });
    expect(r.error, r.error?.message).toBeNull();
    const menuId = (r.data as { menu_id: string }).menu_id;
    const rec = await recipeOf(recipeId);
    expect([rec!.status, rec!.menu_id]).toEqual(["ขึ้นเมนูแล้ว", menuId]);
    const { data: rs } = await admin().from("bar_recipe_slot").select("slot_id, qty").eq("tenant_id", A.tenantId).eq("menu_id", menuId);
    expect(rs!.map((x) => [x.slot_id, Number(x.qty)])).toEqual([[slotId, 30]]);
  });

  it("ลบรอบสุดท้ายของสูตร → การ์ดหายด้วย", async () => {
    const r = await asA.rpc("fn_bar_lab_round", {
      p_entity: E(), p_recipe_id: null, p_name: "ทดสอบ ลงผิด", p_glasses: 1,
      p_lines: [{ item_id: "T-SYR", qty: 5 }], p_note: null, p_business_date: today,
    });
    const d = r.data as { recipe_id: string; use_id: string };
    const del = await asA.rpc("fn_bar_lab_delete_use", { p_entity: E(), p_use_id: d.use_id });
    expect((del.data as { recipe_deleted: boolean }).recipe_deleted).toBe(true);
    expect(await recipeOf(d.recipe_id)).toBeNull();
  });
});
