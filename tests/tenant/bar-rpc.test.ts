import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTestEnv, cleanupTestTenants, seedTenant, signIn, seedUser, admin, type Tenant } from "./harness";
import { barTotals, lineAmount } from "../../lib/bar/totals";
import { cartCost } from "../../lib/bar/cost";
import { vatFromGross } from "../../lib/bar/vat";
import type { BarItem, BarMenu, CartLine } from "../../lib/bar/types";

/**
 * โมดูลบาร์ — RPC ที่ยิง Supabase จริง (D96 · migration 0064-0065)
 *
 * 🔴 **ชั้นเดียวที่เห็นตรรกะนี้ได้** — กติกาทั้งหมดอยู่ใน plpgsql
 *    `npm run build` / `lint` / `test` มองไม่เห็นแม้แต่บรรทัดเดียว (บทเรียน D79)
 *
 * ★ เทสชุดนี้พิสูจน์ **2 ทิศทางเสมอ** — ไม่ใช่ "ทำไม่ได้แล้วผ่าน"
 *   ทุกข้อที่บล็อกต้องมีคู่ที่ทำได้จริงกำกับ ไม่งั้นเทสจะเขียวเพราะไม่มีอะไรทำงานเลย
 */

let A: Tenant;
/** ชื่อบัญชีเงินสำหรับทดสอบการลงบัญชี — ตั้งค่าในชุด ⑦ ใช้ต่อในชุด ⑨ */
let account = "";
let asA: SupabaseClient;

const E = () => A.entityId;
const today = "2026-09-12";

/** เรียก RPC ในนามผู้ใช้ที่ล็อกอิน (RLS + has_cap มีผลจริง) */
async function rpc(client: SupabaseClient, fn: string, args: Record<string, unknown>) {
  return client.rpc(fn, args);
}

/** สร้างวัตถุดิบ + เมนู + หมวด ให้พร้อมขาย */
async function seedBar() {
  const db = admin();
  const base = { tenant_id: A.tenantId, entity_id: A.entityId };

  // 🪤 **insert เป็นชุดของ PostgREST ต้องมีคีย์ครบเท่ากันทุกแถว**
  //    ถ้าแถวหนึ่งไม่มี `is_system` มันจะส่ง `null` ทับค่า default ของ DB แล้วชน not-null
  //    (เจอตอนรันจริง — เขียนไว้เพราะโค้ดแอปที่ insert เป็นชุดจะเจอเหมือนกัน)
  const cat = await db.from("bar_category").insert([
    { ...base, category_id: "T-cocktail", name: "ทดสอบ ค็อกเทล", sort: 1, is_system: false },
    { ...base, category_id: "custom", name: "เมนูเฉพาะกิจ", sort: 999, is_system: true },
  ]);
  if (cat.error) throw new Error(`หมวด: ${cat.error.message}`);

  const items = await db.from("bar_item").insert([
    { ...base, item_id: "T-GIN", name: "ทดสอบ จิน", unit: "ml", qty: 2100, cost_per_unit: 1.2, pack_size: 700 },
    { ...base, item_id: "T-VER", name: "ทดสอบ เวอร์มุท", unit: "ml", qty: 750, cost_per_unit: 0.8 },
  ]);
  if (items.error) throw new Error(`วัตถุดิบ: ${items.error.message}`);

  const menus = await db.from("bar_menu").insert([
    { ...base, menu_id: "T-M1", name: "ทดสอบ Negroni", price: 260, category_id: "T-cocktail" },
    { ...base, menu_id: "T-M2", name: "ทดสอบ ถั่วทอด", price: 80, category_id: "T-cocktail", fixed_cost: 35 },
    { ...base, menu_id: "T-M3", name: "ทดสอบ ยังไม่ตั้ง", price: 300, category_id: "custom" },
  ]);
  if (menus.error) throw new Error(`เมนู: ${menus.error.message}`);

  const rec = await db.from("bar_recipe").insert([
    { ...base, menu_id: "T-M1", item_id: "T-GIN", qty: 30 },
    { ...base, menu_id: "T-M1", item_id: "T-VER", qty: 30 },
  ]);
  if (rec.error) throw new Error(`สูตร: ${rec.error.message}`);

  const cust = await db.from("bar_customer").insert({
    ...base, customer_id: "T-C1", name: "ทดสอบ พี่โอ๊ต",
  });
  if (cust.error) throw new Error(`ลูกค้า: ${cust.error.message}`);
}

const qtyOf = async (itemId: string): Promise<number> => {
  const { data } = await admin().from("bar_item").select("qty")
    .eq("tenant_id", A.tenantId).eq("entity_id", A.entityId).eq("item_id", itemId).single();
  return Number(data!.qty);
};

const saleOf = async (saleNo: string) => {
  const { data } = await admin().from("bar_sale").select("*")
    .eq("tenant_id", A.tenantId).eq("entity_id", A.entityId).eq("sale_no", saleNo).single();
  return data!;
};

/**
 * 1 แก้ว Negroni — ส่งให้ RPC ด้วยชื่อคีย์ของ SQL (`is_comp`) แต่คิด `amount` ด้วย
 * `lineAmount()` ที่ใช้ชื่อคีย์ของ TS (`isComp`)
 *
 * 🪤 รอบแรกเขียนพลาดตรงนี้: ส่ง `{ is_comp: true }` เข้า `lineAmount()` ตรง ๆ
 *    → มันมองไม่เห็นธง เลยคืน 260 แทน 0 · **เป็นบั๊กของเทส ไม่ใช่ของโค้ด**
 *    แต่มันเปิดโปงว่า SQL เชื่อ `amount` ที่ client ส่งมาโดยไม่ตรวจอะไรเลย → ดู 0066
 */
const negroni = (qty = 1, opt: { comp?: boolean; lineDiscount?: number } = {}) => {
  const line: CartLine = {
    menuId: "T-M1", menuName: "ทดสอบ Negroni", qty, price: 260,
    isComp: opt.comp, lineDiscount: opt.lineDiscount,
  };
  return {
    menu_id: "T-M1", menu_name: "ทดสอบ Negroni", qty, price: 260,
    amount: lineAmount(line),
    is_comp: Boolean(opt.comp),
    line_discount: opt.lineDiscount ?? 0,
  };
};

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  A = await seedTenant("bar-a");
  asA = await signIn(A);
  await seedBar();
}, 180_000);

afterAll(async () => {
  await cleanupTestTenants();
}, 120_000);

describe("① ตัดสต็อกตามสูตร ณ ตอนสั่ง (ไม่ใช่ตอนปิดบิล)", () => {
  it("เปิดบิล → เพิ่ม 2 แก้ว → สต็อกลดทันทีทั้งที่ยังไม่ปิดบิล", async () => {
    const ginBefore = await qtyOf("T-GIN");
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E(), p_tab_name: "โต๊ะทดสอบ" });
    expect(open.error, open.error?.message).toBeNull();
    const saleNo = (open.data as { sale_no: string }).sale_no;
    expect(saleNo).toMatch(/^B\d{6}-\d{3}$/);

    const add = await rpc(asA, "fn_bar_add_lines", {
      p_entity: E(), p_sale_no: saleNo, p_items: [negroni(2)],
    });
    expect(add.error, add.error?.message).toBeNull();

    expect(await qtyOf("T-GIN")).toBe(ginBefore - 60);
    expect((await saleOf(saleNo)).status).toBe("เปิดอยู่");
  });

  it("ต้นทุนถูกแช่ไว้ในแถว ณ ตอนสั่ง — (30×1.2 + 30×0.8) = 60 ต่อแก้ว", async () => {
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    await rpc(asA, "fn_bar_add_lines", { p_entity: E(), p_sale_no: saleNo, p_items: [negroni(1)] });

    const { data } = await admin().from("bar_sale_item").select("cost, amount")
      .eq("tenant_id", A.tenantId).eq("sale_no", saleNo).single();
    expect(Number(data!.cost)).toBe(60);
    expect(Number(data!.amount)).toBe(260);
  });

  it("🚨 ต้นทุนที่ SQL คิด ต้องตรงกับ lib/bar/cost.ts เป๊ะ (กันสูตรแยกร่างเป็น 2 ที่)", async () => {
    const items: BarItem[] = [
      { itemId: "T-GIN", name: "จิน", unit: "ml", qty: 0, costPerUnit: 1.2 },
      { itemId: "T-VER", name: "เวอร์มุท", unit: "ml", qty: 0, costPerUnit: 0.8 },
    ];
    const menus: BarMenu[] = [{
      menuId: "T-M1", name: "Negroni", price: 260, categoryId: "T-cocktail",
      recipe: [{ itemId: "T-GIN", qty: 30 }, { itemId: "T-VER", qty: 30 }],
    }];
    const fromTs = cartCost([{ menuId: "T-M1", menuName: "x", qty: 3, price: 260 }], menus, items);

    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    await rpc(asA, "fn_bar_add_lines", { p_entity: E(), p_sale_no: saleNo, p_items: [negroni(3)] });
    const { data } = await admin().from("bar_sale_item").select("cost")
      .eq("tenant_id", A.tenantId).eq("sale_no", saleNo).single();

    expect(Number(data!.cost)).toBe(fromTs);
  });

  it("🚨 ของแถมก็ตัดสต็อก — ยอดขาย 0 แต่เหล้าหายจากขวดจริง", async () => {
    const before = await qtyOf("T-GIN");
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    await rpc(asA, "fn_bar_add_lines", {
      p_entity: E(), p_sale_no: saleNo, p_items: [negroni(1, { comp: true })],
    });

    expect(await qtyOf("T-GIN")).toBe(before - 30);
    const { data } = await admin().from("bar_sale_item").select("amount, cost")
      .eq("tenant_id", A.tenantId).eq("sale_no", saleNo).single();
    expect(Number(data!.amount)).toBe(0);
    expect(Number(data!.cost)).toBe(60);
  });

  /**
   * 🎯 **ที่มาของ migration 0066** — เทสรอบแรกของไฟล์นี้ส่ง `amount = 260` มาพร้อม
   *    `is_comp = true` (helper เขียนพลาด ใช้ชื่อคีย์ผิด) แล้ว **SQL รับไว้เฉย ๆ**
   *    = ได้แถวของแถมที่มียอดขาย 260 → รายได้และกำไรพองโดยไม่มีอะไรฟ้อง
   *
   * "ของแถมยอดขาย 0" ไม่ใช่นโยบายหน้าจอ มันเป็น**กติกาธุรกิจ** ⇒ ต้องเป็นจริงใน DB เสมอ
   * (หลักเดียวกับ D55 ที่ย้ายด่าน ม.86/13 มาไว้ที่ DB เพราะ "ยิง API ตรงก็ต้องไม่รอด")
   */
  it("🚨 SQL บังคับเอง: ส่ง amount ผิดมาพร้อม is_comp → ต้องถูกบันทึกเป็น 0", async () => {
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    await rpc(asA, "fn_bar_add_lines", {
      p_entity: E(), p_sale_no: saleNo,
      // จงใจส่งค่าที่ขัดกันเอง — เลียนแบบบั๊กฝั่ง client
      p_items: [{ menu_id: "T-M1", menu_name: "แถม", qty: 1, price: 260, amount: 260, is_comp: true }],
    });
    const { data } = await admin().from("bar_sale_item").select("amount, cost, is_comp")
      .eq("tenant_id", A.tenantId).eq("sale_no", saleNo).single();
    expect(Number(data!.amount)).toBe(0);
    expect(data!.is_comp).toBe(true);
    expect(Number(data!.cost)).toBe(60); // ต้นทุนยังนับ
  });

  it("🚨 SQL บังคับเอง: ยอดติดลบถูกปัดเป็น 0 (บรรทัดติดลบ = ยอดบิลเพี้ยนแบบเงียบ)", async () => {
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    await rpc(asA, "fn_bar_add_lines", {
      p_entity: E(), p_sale_no: saleNo,
      p_items: [{ menu_id: "T-M1", menu_name: "ติดลบ", qty: 1, price: 260, amount: -500 }],
    });
    const { data } = await admin().from("bar_sale_item").select("amount")
      .eq("tenant_id", A.tenantId).eq("sale_no", saleNo).single();
    expect(Number(data!.amount)).toBe(0);
  });

  it("เมนูโหมดต้นทุนตายตัวไม่ตัดสต็อก แต่ต้นทุนขึ้น", async () => {
    const before = await qtyOf("T-GIN");
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    await rpc(asA, "fn_bar_add_lines", {
      p_entity: E(), p_sale_no: saleNo,
      p_items: [{ menu_id: "T-M2", menu_name: "ถั่ว", qty: 2, price: 80, amount: 160 }],
    });
    expect(await qtyOf("T-GIN")).toBe(before);
    const { data } = await admin().from("bar_sale_item").select("cost")
      .eq("tenant_id", A.tenantId).eq("sale_no", saleNo).single();
    expect(Number(data!.cost)).toBe(70);
  });

  it("เมนูที่ยังไม่ตั้งต้นทุน → ต้นทุน 0 และไม่ตัดสต็อก (ขายได้ ไม่บล็อก)", async () => {
    const before = await qtyOf("T-GIN");
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    const add = await rpc(asA, "fn_bar_add_lines", {
      p_entity: E(), p_sale_no: saleNo,
      p_items: [{ menu_id: "T-M3", menu_name: "ลับ", qty: 1, price: 300, amount: 300 }],
    });
    expect(add.error).toBeNull();
    expect(await qtyOf("T-GIN")).toBe(before);
    const { data } = await admin().from("bar_sale_item").select("cost")
      .eq("tenant_id", A.tenantId).eq("sale_no", saleNo).single();
    expect(Number(data!.cost)).toBe(0);
  });
});

describe("② ปิดบิล + ยอดที่ SQL คิดต้องตรงกับ lib/bar/totals.ts", () => {
  it("ปิดบิลแล้วยอดตรงกับ barTotals() และสถานะเปลี่ยนเป็น ปกติ", async () => {
    const cart: CartLine[] = [
      { menuId: "T-M1", menuName: "Negroni", qty: 2, price: 260 },
      { menuId: "T-M2", menuName: "ถั่ว", qty: 1, price: 80 },
    ];
    const want = barTotals(cart, { discount: 40 });

    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    await rpc(asA, "fn_bar_add_lines", {
      p_entity: E(), p_sale_no: saleNo,
      p_items: cart.map((l) => ({
        menu_id: l.menuId, menu_name: l.menuName, qty: l.qty, price: l.price, amount: lineAmount(l),
      })),
    });
    const close = await rpc(asA, "fn_bar_close_sale", {
      p_entity: E(), p_sale_no: saleNo, p_method: "เงินสด",
      p_business_date: today, p_discount: 40,
    });
    expect(close.error, close.error?.message).toBeNull();

    const s = await saleOf(saleNo);
    expect(s.status).toBe("ปกติ");
    expect(Number(s.sub_total)).toBe(want.subTotal);
    expect(Number(s.grand_total)).toBe(want.grandTotal);
    expect(s.business_date).toBe(today);
  });

  it("🪤 ส่วนลดเกินยอด → ตัดให้เท่ากับยอด ไม่ปล่อยให้บิลติดลบ", async () => {
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    await rpc(asA, "fn_bar_add_lines", { p_entity: E(), p_sale_no: saleNo, p_items: [negroni(1)] });
    await rpc(asA, "fn_bar_close_sale", {
      p_entity: E(), p_sale_no: saleNo, p_method: "เงินสด",
      p_business_date: today, p_discount: 9999,
    });
    const s = await saleOf(saleNo);
    expect(Number(s.grand_total)).toBe(0);
    expect(Number(s.discount)).toBe(260);
  });

  it("🚨 บิลที่ปิดแล้วเพิ่มรายการไม่ได้ — ต้องได้ error ไทย ไม่ใช่เงียบ", async () => {
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    await rpc(asA, "fn_bar_add_lines", { p_entity: E(), p_sale_no: saleNo, p_items: [negroni(1)] });
    await rpc(asA, "fn_bar_close_sale", {
      p_entity: E(), p_sale_no: saleNo, p_method: "เงินสด", p_business_date: today,
    });
    const again = await rpc(asA, "fn_bar_add_lines", {
      p_entity: E(), p_sale_no: saleNo, p_items: [negroni(1)],
    });
    expect(again.error).toBeTruthy();
    expect(again.error!.message).toContain("ปิดไปแล้ว");
  });

  it("บิลไม่มีจริง / ไม่เลือกวิธีรับเงิน → error ไทย (row_count = 0 ต้องไม่ตอบ ok)", async () => {
    const a = await rpc(asA, "fn_bar_close_sale", {
      p_entity: E(), p_sale_no: "B999999-999", p_method: "เงินสด", p_business_date: today,
    });
    expect(a.error!.message).toContain("ไม่พบบิล");

    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    const b = await rpc(asA, "fn_bar_close_sale", {
      p_entity: E(), p_sale_no: saleNo, p_method: "  ", p_business_date: today,
    });
    expect(b.error!.message).toContain("วิธีรับเงิน");
  });

  it("ขายเร็วที่บูธ (quick sale) เขียนแถวเหมือนกันเป๊ะกับเส้นทางเปิดบิลค้าง", async () => {
    const before = await qtyOf("T-GIN");
    const r = await rpc(asA, "fn_bar_quick_sale", {
      p_entity: E(), p_items: [negroni(1)], p_method: "QR",
      p_business_date: today, p_channel: "บูธทดสอบ",
    });
    expect(r.error, r.error?.message).toBeNull();
    const s = await saleOf((r.data as { sale_no: string }).sale_no);
    expect(s.status).toBe("ปกติ");
    expect(s.channel).toBe("บูธทดสอบ");
    expect(Number(s.cost_total)).toBe(60);
    expect(await qtyOf("T-GIN")).toBe(before - 30);
  });
});

describe("③ ยกเลิก — สต็อกต้องกลับมาเท่าเดิมเป๊ะ", () => {
  it("ยกเลิกทั้งบิล → คืนสต็อกครบและสถานะเป็น ยกเลิก", async () => {
    const before = await qtyOf("T-GIN");
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    await rpc(asA, "fn_bar_add_lines", { p_entity: E(), p_sale_no: saleNo, p_items: [negroni(3)] });
    expect(await qtyOf("T-GIN")).toBe(before - 90);

    const v = await rpc(asA, "fn_bar_void_sale", { p_entity: E(), p_sale_no: saleNo, p_reason: "ทดสอบ" });
    expect(v.error, v.error?.message).toBeNull();
    expect(await qtyOf("T-GIN")).toBe(before);
    expect((await saleOf(saleNo)).status).toBe("ยกเลิก");
  });

  it("ยกเลิกรายการเดียว → คืนเฉพาะแถวนั้น และยอดบิลถูกคิดใหม่", async () => {
    const before = await qtyOf("T-GIN");
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    await rpc(asA, "fn_bar_add_lines", {
      p_entity: E(), p_sale_no: saleNo, p_items: [negroni(1), negroni(2)],
    });
    expect(await qtyOf("T-GIN")).toBe(before - 90);

    const v = await rpc(asA, "fn_bar_void_line", {
      p_entity: E(), p_sale_no: saleNo, p_line_no: 2, p_reason: "ลูกค้าเปลี่ยนใจ",
    });
    expect(v.error, v.error?.message).toBeNull();
    expect(await qtyOf("T-GIN")).toBe(before - 30);
    expect(Number((v.data as { sub_total: number }).sub_total)).toBe(260);
  });

  it("🚨 soft-void — แถวยังอยู่ในฐานข้อมูล ไม่ถูกลบจริง (audit ต้องตามได้)", async () => {
    const { data } = await admin().from("bar_sale_item").select("line_no, voided_at, void_reason")
      .eq("tenant_id", A.tenantId).not("voided_at", "is", null).limit(1);
    expect(data!.length).toBe(1);
    expect(data![0].void_reason).toBeTruthy();
  });

  it("ยกเลิกรายการซ้ำ → error ไทย ไม่ใช่คืนสต็อกซ้ำ", async () => {
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    await rpc(asA, "fn_bar_add_lines", { p_entity: E(), p_sale_no: saleNo, p_items: [negroni(1)] });
    await rpc(asA, "fn_bar_void_line", { p_entity: E(), p_sale_no: saleNo, p_line_no: 1 });
    const before = await qtyOf("T-GIN");
    const again = await rpc(asA, "fn_bar_void_line", { p_entity: E(), p_sale_no: saleNo, p_line_no: 1 });
    expect(again.error!.message).toContain("ยกเลิกไปแล้ว");
    expect(await qtyOf("T-GIN")).toBe(before);
  });
});

describe("④ ใบเสร็จ + การแก้หลังออกใบเสร็จ", () => {
  let saleNo = "";

  it("ออกเลขใบเสร็จได้ และ **idempotent** (กดซ้ำได้เลขเดิม ไม่ออกใบใหม่)", async () => {
    /**
     * 🔄 **กติกาเปลี่ยนใน 0069 (D96 เฟส F)** — กิจการที่ **จด VAT** จะได้เลขใบกำกับ
     *    อย่างย่อตั้งแต่ตอนปิดบิล ⇒ กดขอทีหลังจะได้ `reused: true` ตั้งแต่ครั้งแรก
     *    (เส้นทางนั้นมีเทสของตัวเองในชุด ⑨)
     * 🚨 ข้อนี้เทสเส้นทาง **ออกตามคำขอ** ของกิจการที่ไม่จด VAT จึงต้องตั้งค่าให้ชัด
     *    ไม่ใช่พึ่งค่าเริ่มต้นของ harness — เทสที่ผลลัพธ์ขึ้นกับค่าที่ไม่ได้ตั้งเอง
     *    คือเทสที่วันหนึ่งจะแดงโดยไม่มีใครรู้ว่าทำไม
     */
    await admin().from("entities").update({ is_vat: false })
      .eq("tenant_id", A.tenantId).eq("entity_id", A.entityId);

    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    saleNo = (open.data as { sale_no: string }).sale_no;
    await rpc(asA, "fn_bar_add_lines", { p_entity: E(), p_sale_no: saleNo, p_items: [negroni(1)] });
    await rpc(asA, "fn_bar_close_sale", {
      p_entity: E(), p_sale_no: saleNo, p_method: "เงินสด", p_business_date: today,
    });

    const a = await rpc(asA, "fn_bar_issue_receipt", { p_entity: E(), p_sale_no: saleNo });
    expect(a.error, a.error?.message).toBeNull();
    const first = (a.data as { rcpt_no: string; reused: boolean });
    expect(first.rcpt_no).toMatch(/^BR\d{6}-\d{3}$/);
    expect(first.reused).toBe(false);

    const b = await rpc(asA, "fn_bar_issue_receipt", { p_entity: E(), p_sale_no: saleNo });
    expect((b.data as { rcpt_no: string; reused: boolean })).toMatchObject({
      rcpt_no: first.rcpt_no, reused: true,
    });
  });

  it("🚨 ออกใบเสร็จแล้วแก้รายการไม่ได้ — ใบอยู่ในมือลูกค้าแล้ว", async () => {
    const r = await rpc(asA, "fn_bar_void_line", { p_entity: E(), p_sale_no: saleNo, p_line_no: 1 });
    expect(r.error).toBeTruthy();
    expect(r.error!.message).toContain("ออกใบเสร็จ");
    expect(r.error!.message).toContain("ยกเลิกทั้งบิล"); // ต้องบอกว่าต้องกดอะไรแทน (D86)
  });

  it("บิลที่ยังเปิดอยู่ออกใบเสร็จไม่ได้", async () => {
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const s = (open.data as { sale_no: string }).sale_no;
    const r = await rpc(asA, "fn_bar_issue_receipt", { p_entity: E(), p_sale_no: s });
    expect(r.error!.message).toContain("ปิดแล้ว");
  });
});

describe("⑤ รับของ + ต้นทุนถัวเฉลี่ย + ปรับยอด", () => {
  it("รับของแล้วสต็อกเพิ่มและต้นทุนถัวเฉลี่ยถูกอัปเดต", async () => {
    const db = admin();
    await db.from("bar_item").insert({
      tenant_id: A.tenantId, entity_id: A.entityId,
      item_id: "T-SYR", name: "ทดสอบ ไซรัป", unit: "ml", qty: 1000, cost_per_unit: 2,
    });
    const r = await rpc(asA, "fn_bar_receive", {
      p_entity: E(), p_item: "T-SYR", p_qty_pack: 1, p_qty: 1000,
      p_cost_total: 4000, p_date: today, p_source: "ทดสอบ",
    });
    expect(r.error, r.error?.message).toBeNull();
    // (1000×2 + 4000) / 2000 = 3
    expect(Number((r.data as { cost_per_unit: number }).cost_per_unit)).toBe(3);
    expect(await qtyOf("T-SYR")).toBe(2000);
  });

  it("🚨 สต็อกติดลบ → ใช้ราคาล็อตใหม่ล้วน ไม่ใช่ได้ต้นทุนติดลบ", async () => {
    const db = admin();
    await db.from("bar_item").insert({
      tenant_id: A.tenantId, entity_id: A.entityId,
      item_id: "T-NEG", name: "ทดสอบ ติดลบ", unit: "ml", qty: -100, cost_per_unit: 5,
    });
    const r = await rpc(asA, "fn_bar_receive", {
      p_entity: E(), p_item: "T-NEG", p_qty_pack: 1, p_qty: 700,
      p_cost_total: 700, p_date: today, p_source: "ทดสอบ", p_note: null,
    });
    expect(r.error, r.error?.message).toBeNull();
    const cost = Number((r.data as { cost_per_unit: number }).cost_per_unit);
    expect(cost).toBe(1);
    expect(cost).toBeGreaterThan(0);
  });

  it("ปรับยอดตามที่นับได้จริง + จดเหตุผลใน bar_move", async () => {
    const r = await rpc(asA, "fn_bar_adjust", {
      p_entity: E(), p_item: "T-SYR", p_qty_after: 1800,
      p_reason: "ปรับยอด", p_note: "นับจริงได้เท่านี้",
    });
    expect(r.error, r.error?.message).toBeNull();
    expect(await qtyOf("T-SYR")).toBe(1800);

    const { data } = await admin().from("bar_move").select("delta, reason, note")
      .eq("tenant_id", A.tenantId).eq("item_id", "T-SYR").eq("reason", "ปรับยอด").single();
    expect(Number(data!.delta)).toBe(-200);
    expect(data!.note).toBe("นับจริงได้เท่านี้");
  });

  it("ปรับเป็นยอดเดิม → error ไทย ไม่ใช่เขียนแถวเปล่า", async () => {
    const r = await rpc(asA, "fn_bar_adjust", { p_entity: E(), p_item: "T-SYR", p_qty_after: 1800 });
    expect(r.error!.message).toContain("ยอดเท่าเดิม");
  });

  it("เหตุผลนอกรายการที่กำหนด → error", async () => {
    const r = await rpc(asA, "fn_bar_adjust", {
      p_entity: E(), p_item: "T-SYR", p_qty_after: 1, p_reason: "อะไรก็ไม่รู้",
    });
    expect(r.error!.message).toContain("เหตุผลไม่ถูกต้อง");
  });
});

describe("⑥ เมนู + สูตร ในทรานแซกชันเดียว", () => {
  it("สร้างเมนูใหม่พร้อมสูตร → ลงหมวด custom อัตโนมัติ", async () => {
    const r = await rpc(asA, "fn_bar_save_menu", {
      p_entity: E(),
      p_menu: { name: "ทดสอบ เมนูสด", price: 320, created_for: "T-C1", method: "shake 12 วิ", glass: "coupe" },
      p_recipe: [{ item_id: "T-GIN", qty: 45 }],
    });
    expect(r.error, r.error?.message).toBeNull();
    const menuId = (r.data as { menu_id: string }).menu_id;

    const { data } = await admin().from("bar_menu").select("category_id, created_for, method, glass")
      .eq("tenant_id", A.tenantId).eq("menu_id", menuId).single();
    expect(data).toMatchObject({ category_id: "custom", created_for: "T-C1", glass: "coupe" });
  });

  it("🚨 สูตรพัง → เมนูต้องไม่เกิด (ทั้งก้อนต้อง rollback)", async () => {
    const before = await admin().from("bar_menu").select("menu_id", { count: "exact", head: true })
      .eq("tenant_id", A.tenantId);
    const r = await rpc(asA, "fn_bar_save_menu", {
      p_entity: E(),
      p_menu: { name: "ทดสอบ เมนูพัง", price: 100 },
      p_recipe: [{ item_id: "T-GIN", qty: 0 }],
    });
    expect(r.error!.message).toContain("มากกว่า 0");

    const after = await admin().from("bar_menu").select("menu_id", { count: "exact", head: true })
      .eq("tenant_id", A.tenantId);
    expect(after.count).toBe(before.count);
  });

  it("ไม่ตั้งชื่อ → error ไทย", async () => {
    const r = await rpc(asA, "fn_bar_save_menu", { p_entity: E(), p_menu: { name: "  " } });
    expect(r.error!.message).toContain("ชื่อเมนู");
  });
});

describe("⑦ ลงบัญชีรายวัน — จุดเชื่อมเดียวกับระบบเดิม", () => {
  const POST_DAY = "2026-09-20";
  // ★ ใช้ร่วมกับชุด ⑨ VAT ด้านล่างด้วย (ประกาศระดับไฟล์)

  beforeAll(async () => {
    const { data } = await admin().from("bank_accounts").select("account_name")
      .eq("tenant_id", A.tenantId).limit(1);
    account = data?.[0]?.account_name ?? "บัญชีทดสอบ";
    if (!data?.length) {
      await admin().from("bank_accounts").insert({
        tenant_id: A.tenantId, account_id: "T-ACC", account_name: account,
        entity_ids: [A.entityId],
      });
    }
    // 2 บิล คนละวิธีรับเงิน
    for (const method of ["เงินสด", "QR"]) {
      await rpc(asA, "fn_bar_quick_sale", {
        p_entity: E(), p_items: [negroni(1)], p_method: method, p_business_date: POST_DAY,
      });
    }
  }, 60_000);

  it("ลงบัญชีแล้วได้ 1 บิลบัญชีต่อ 1 วิธีรับเงิน", async () => {
    const r = await rpc(asA, "fn_bar_post_day", {
      p_entity: E(), p_date: POST_DAY, p_account: account,
    });
    expect(r.error, r.error?.message).toBeNull();
    const out = r.data as { tx_ids: string[]; total: number };
    expect(out.tx_ids).toHaveLength(2);
    expect(Number(out.total)).toBe(520);

    const { data } = await admin().from("transactions").select("type, net_amount, entity_id, source")
      .eq("tenant_id", A.tenantId).in("tx_id", out.tx_ids);
    expect(data).toHaveLength(2);
    for (const tx of data!) {
      expect(tx.type).toBe("รายรับ");
      expect(tx.entity_id).toBe(A.entityId); // 🚨 entity จากค่าที่ตั้งไว้ ไม่ใช่จากคนล็อกอิน
      expect(tx.source).toBe("bar");
    }
  });

  it("🚨 ลงซ้ำวันเดิม → error ไทย ไม่ใช่ได้บิลซ้ำ", async () => {
    const r = await rpc(asA, "fn_bar_post_day", {
      p_entity: E(), p_date: POST_DAY, p_account: account,
    });
    expect(r.error!.message).toContain("ลงบัญชีไปแล้ว");
  });

  it("🚨 วันที่ลงบัญชีแล้ว ยกเลิกบิลไม่ได้ — ต้องถอนบัญชีก่อน (และบอกว่าต้องกดอะไร)", async () => {
    const { data } = await admin().from("bar_sale").select("sale_no")
      .eq("tenant_id", A.tenantId).eq("business_date", POST_DAY).eq("status", "ปกติ").limit(1);
    const r = await rpc(asA, "fn_bar_void_sale", { p_entity: E(), p_sale_no: data![0].sale_no });
    expect(r.error!.message).toContain("ถอนบัญชี");
  });

  it("ถอนบัญชี → บิลบัญชีถูก soft-void (ไม่ลบ) แล้วลงใหม่ได้", async () => {
    const un = await rpc(asA, "fn_bar_unpost_day", { p_entity: E(), p_date: POST_DAY });
    expect(un.error, un.error?.message).toBeNull();
    expect((un.data as { voided_tx: number }).voided_tx).toBe(2);

    const { data } = await admin().from("transactions").select("status")
      .eq("tenant_id", A.tenantId).eq("source", "bar");
    expect(data!.every((t) => t.status === "ยกเลิก")).toBe(true);

    const again = await rpc(asA, "fn_bar_post_day", {
      p_entity: E(), p_date: POST_DAY, p_account: account,
    });
    expect(again.error, again.error?.message).toBeNull();
  });

  it("วันที่ไม่มีบิล → error ไทย ไม่ใช่ลงบิลยอด 0", async () => {
    const r = await rpc(asA, "fn_bar_post_day", {
      p_entity: E(), p_date: "2026-01-01", p_account: account,
    });
    expect(r.error!.message).toContain("ไม่มีบิล");
  });

  it("ยังไม่ได้ตั้งบัญชีรับเงิน → error ที่บอกว่าไปตั้งที่ไหน", async () => {
    const r = await rpc(asA, "fn_bar_post_day", { p_entity: E(), p_date: POST_DAY, p_account: "  " });
    expect(r.error!.message).toContain("ตั้งค่าบาร์");
  });
});

describe("⑧ สิทธิ์ — พิสูจน์ 2 ทิศทาง", () => {
  let barClient: SupabaseClient;

  beforeAll(async () => {
    barClient = (await seedUser(A, "bar")).client;
  }, 60_000);

  it("พนักงานบาร์ **ขายได้จริง** (ไม่ใช่ทำอะไรไม่ได้แล้วเทสผ่าน)", async () => {
    const r = await rpc(barClient, "fn_bar_quick_sale", {
      p_entity: E(), p_items: [negroni(1)], p_method: "เงินสด", p_business_date: today,
    });
    expect(r.error, r.error?.message).toBeNull();
  });

  it("พนักงานบาร์รับของและปรับยอดได้", async () => {
    // ★ จงใจไม่ส่ง p_qty_pack / p_date / p_source / p_note — พิสูจน์ว่า default ของ 0066 ใช้ได้จริง
    //   (ก่อน 0066 การละพารามิเตอร์ที่ไม่มี default ทำให้ PostgREST ตอบ PGRST202
    //    ซึ่งอ่านแล้วเหมือน "ยังไม่ได้ลง migration" ทั้งที่ลงแล้ว)
    const a = await rpc(barClient, "fn_bar_receive", {
      p_entity: E(), p_item: "T-SYR", p_qty: 100, p_cost_total: 300,
    });
    expect(a.error, a.error?.message).toBeNull();
    const b = await rpc(barClient, "fn_bar_adjust", {
      p_entity: E(), p_item: "T-SYR", p_qty_after: 1500, p_reason: "ปรับยอด", p_note: null,
    });
    expect(b.error, b.error?.message).toBeNull();
  });

  /**
   * 🔄 **กติกาเปลี่ยนใน 0067 (D96)** — เดิมบังคับ `bar.config` ทุกกรณี
   *    ⇒ พนักงานบาร์เปิดบิลผิดแล้ว **ลบเองไม่ได้เลย** ต้องไปตามเจ้าของร้านมากด
   *    ทั้งที่บิลนั้นยังไม่มีอะไรอยู่ในนั้น (ผู้ใช้แจ้งเองตอนลองใช้จริง)
   *
   * ★ เส้นแบ่งใหม่อยู่ที่ **บิลปิดไปแล้วหรือยัง** ไม่ใช่ที่จำนวนรายการ —
   *   บิลที่ปิดแล้วคือเงินที่รับมาแล้วและใบเสร็จที่อาจอยู่ในมือลูกค้า
   */
  it("พนักงานบาร์ปิดบิลที่ยัง **เปิดอยู่** ทิ้งได้ (bar.write) — 0067", async () => {
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    const r = await rpc(barClient, "fn_bar_void_sale", { p_entity: E(), p_sale_no: saleNo });
    expect(r.error, r.error?.message).toBeNull();
    expect((await saleOf(saleNo)).status).toBe("ยกเลิก");
  });

  it("🚨 ทางกลับ — บิลที่ **ปิดแล้ว** พนักงานบาร์ยกเลิกไม่ได้ (ต้อง bar.config)", async () => {
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    await rpc(asA, "fn_bar_add_lines", { p_entity: E(), p_sale_no: saleNo, p_items: [negroni(1)] });
    await rpc(asA, "fn_bar_close_sale", {
      p_entity: E(), p_sale_no: saleNo, p_method: "เงินสด", p_business_date: today,
    });

    const r = await rpc(barClient, "fn_bar_void_sale", { p_entity: E(), p_sale_no: saleNo });
    expect(r.error!.message).toContain("ไม่มีสิทธิ์");
    expect((await saleOf(saleNo)).status).toBe("ปกติ");
  });

  it("🚨 พนักงานบาร์ลงบัญชี/ถอนบัญชีไม่ได้", async () => {
    const a = await rpc(barClient, "fn_bar_post_day", {
      p_entity: E(), p_date: today, p_account: "x",
    });
    expect(a.error!.message).toContain("ไม่มีสิทธิ์");
    const b = await rpc(barClient, "fn_bar_unpost_day", { p_entity: E(), p_date: today });
    expect(b.error!.message).toContain("ไม่มีสิทธิ์");
  });

  it("🚨 พนักงานบาร์อ่านตารางบัญชี/ผลิตไม่ได้ — ในโลก RLS = ลิสต์ว่าง ไม่ใช่ error (D85)", async () => {
    for (const table of ["transactions", "log_distill", "employees", "sales_orders"]) {
      const { data, error } = await barClient.from(table).select("*").limit(5);
      expect(error, `${table} ควรอ่านได้แต่ว่าง`).toBeNull();
      expect(data, `พนักงานบาร์เห็นแถวใน ${table}`).toEqual([]);
    }
  });

  it("พนักงานบาร์อ่านตารางบาร์ได้จริง (คู่ตรงข้ามของข้อบน)", async () => {
    const { data, error } = await barClient.from("bar_menu").select("menu_id");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("🚨 ยิงเข้ากิจการที่ไม่มีอยู่ → error ไม่ใช่เขียนลงกิจการหลักเงียบ ๆ", async () => {
    const r = await rpc(asA, "fn_bar_open_sale", { p_entity: "EID-ไม่มีจริง" });
    expect(r.error!.message).toContain("ไม่พบกิจการ");
  });
});

describe("⑧ ส่วนลดเป็น % — DB ต้องเก็บ % ไว้เป็น **คำอธิบาย** เท่านั้น (D96 · 0068)", () => {
  it("เก็บ line_discount_pct ตามที่ส่งมา · ตัวเงินยังเป็น line_discount", async () => {
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    // 2 × 260 = 520 · ลด 10% = 52 → ยอด 468 (TS คิดมาแล้ว SQL แค่เก็บ)
    const add = await rpc(asA, "fn_bar_add_lines", {
      p_entity: E(),
      p_sale_no: saleNo,
      p_items: [{ ...negroni(2, { lineDiscount: 52 }), line_discount_pct: 10 }],
    });
    expect(add.error, add.error?.message).toBeNull();

    const { data } = await admin()
      .from("bar_sale_item")
      .select("line_discount, line_discount_pct, amount")
      .eq("sale_no", saleNo)
      .single();
    expect(Number(data!.line_discount)).toBe(52);
    expect(Number(data!.line_discount_pct)).toBe(10);
    expect(Number(data!.amount)).toBe(468);
  });

  it("ไม่ส่ง % มา → เก็บเป็น null ไม่ใช่ 0 (0 แปลว่า 'ลด 0%' ซึ่งคนละความหมายกับ 'ไม่ได้ใช้ %')", async () => {
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    await rpc(asA, "fn_bar_add_lines", {
      p_entity: E(), p_sale_no: saleNo, p_items: [negroni(1, { lineDiscount: 20 })],
    });
    const { data } = await admin()
      .from("bar_sale_item").select("line_discount, line_discount_pct")
      .eq("sale_no", saleNo).single();
    expect(Number(data!.line_discount)).toBe(20);
    expect(data!.line_discount_pct).toBeNull();
  });

  it("% เกิน 100 → ตัดที่ 100 · ติดลบ → null (SQL กันเองไม่พึ่งหน้าจอ)", async () => {
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    await rpc(asA, "fn_bar_add_lines", {
      p_entity: E(),
      p_sale_no: saleNo,
      p_items: [
        { ...negroni(1, { lineDiscount: 0 }), line_discount_pct: 250 },
        { ...negroni(1, { lineDiscount: 0 }), line_discount_pct: -5 },
      ],
    });
    const { data } = await admin()
      .from("bar_sale_item").select("line_no, line_discount_pct")
      .eq("sale_no", saleNo).order("line_no");
    expect(Number(data![0].line_discount_pct)).toBe(100);
    expect(data![1].line_discount_pct).toBeNull();
  });

  it("ปิดบิลแล้วเก็บ discount_pct ท้ายบิลไว้ด้วย", async () => {
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    await rpc(asA, "fn_bar_add_lines", { p_entity: E(), p_sale_no: saleNo, p_items: [negroni(1)] });
    // 260 · ลด 10% = 26 → 234
    const close = await rpc(asA, "fn_bar_close_sale", {
      p_entity: E(), p_sale_no: saleNo, p_method: "เงินสด",
      p_business_date: today, p_discount: 26, p_discount_pct: 10,
    });
    expect(close.error, close.error?.message).toBeNull();

    const s = await saleOf(saleNo);
    expect(Number(s.discount)).toBe(26);
    expect(Number(s.discount_pct)).toBe(10);
    expect(Number(s.grand_total)).toBe(234);
  });

  /**
   * 🚩 **ข้อที่สำคัญที่สุดของชุดนี้** — ส่ง % ที่ขัดกับจำนวนเงินเข้าไปตรง ๆ
   *    ถ้าวันหนึ่งมีคนไป "ปรับปรุง" ให้ SQL คิดบาทจาก % เอง เทสนี้จะแดงทันที
   *    (ตระกูลเดียวกับ 0066 ที่ส่ง amount ขัดกับ is_comp เข้าไปพิสูจน์)
   */
  it("🚨 ส่ง discount 26 บาท คู่กับ discount_pct 99 → ยอดต้องใช้ **26** ไม่ใช่ 99%", async () => {
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    await rpc(asA, "fn_bar_add_lines", { p_entity: E(), p_sale_no: saleNo, p_items: [negroni(1)] });
    await rpc(asA, "fn_bar_close_sale", {
      p_entity: E(), p_sale_no: saleNo, p_method: "เงินสด",
      p_business_date: today, p_discount: 26, p_discount_pct: 99,
    });

    const s = await saleOf(saleNo);
    expect(Number(s.discount)).toBe(26);
    expect(Number(s.grand_total)).toBe(234); // ไม่ใช่ 260 − 257.4
    expect(Number(s.discount_pct)).toBe(99); // เก็บไว้ตามที่ส่ง แต่ไม่มีผลต่อเงิน
  });

  it("ไม่ส่ง % ตอนปิดบิล → discount_pct เป็น null (บิลที่ลดเป็นบาท)", async () => {
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    await rpc(asA, "fn_bar_add_lines", { p_entity: E(), p_sale_no: saleNo, p_items: [negroni(1)] });
    await rpc(asA, "fn_bar_close_sale", {
      p_entity: E(), p_sale_no: saleNo, p_method: "เงินสด", p_business_date: today, p_discount: 50,
    });
    const s = await saleOf(saleNo);
    expect(Number(s.discount)).toBe(50);
    expect(s.discount_pct).toBeNull();
  });

  it("ขายเร็วที่บูธส่ง % ต่อไปถึง close_sale ได้", async () => {
    const q = await rpc(asA, "fn_bar_quick_sale", {
      p_entity: E(),
      p_items: [negroni(1)],
      p_method: "QR",
      p_business_date: today,
      p_discount: 26,
      p_discount_pct: 10,
    });
    expect(q.error, q.error?.message).toBeNull();
    const s = await saleOf((q.data as { sale_no: string }).sale_no);
    expect(Number(s.discount_pct)).toBe(10);
    expect(Number(s.grand_total)).toBe(234);
  });
});

/**
 * ⑨ VAT ครบวง (D96 · 0069)
 *
 * 🔴 **ชั้นเดียวที่เห็นได้** — กติกาอยู่ใน plpgsql ทั้งหมด
 * 🚩 ทุกข้อพิสูจน์ **2 ทิศ**: กิจการจด VAT ต้องเปลี่ยน · กิจการไม่จด **ต้องไม่ขยับแม้ช่องเดียว**
 *    (เส้นทางไม่จดคือของลูกค้าที่ใช้อยู่ทุกวันนี้)
 */
describe("⑨ VAT — ใบกำกับอย่างย่อ + ช่องภาษีตอนลงบัญชี (D96 · 0069)", () => {
  const setVat = async (on: boolean) => {
    const r = await admin()
      .from("entities")
      .update({ is_vat: on })
      .eq("tenant_id", A.tenantId)
      .eq("entity_id", A.entityId);
    if (r.error) throw new Error(`ตั้ง is_vat: ${r.error.message}`);
  };

  /** ปิดบิล 1 ใบแล้วคืนแถวที่บันทึกจริง */
  const sellOne = async (method = "เงินสด", date = today) => {
    const open = await rpc(asA, "fn_bar_open_sale", { p_entity: E() });
    const saleNo = (open.data as { sale_no: string }).sale_no;
    await rpc(asA, "fn_bar_add_lines", { p_entity: E(), p_sale_no: saleNo, p_items: [negroni(1)] });
    const close = await rpc(asA, "fn_bar_close_sale", {
      p_entity: E(), p_sale_no: saleNo, p_method: method, p_business_date: date,
    });
    expect(close.error, close.error?.message).toBeNull();
    return { saleNo, result: close.data as Record<string, unknown> };
  };

  afterAll(async () => {
    await setVat(false); // ★ คืนสภาพ ไม่ให้ไปกวนเทสข้ออื่น
  });

  it("🚨 ไม่จด VAT — ปิดบิลแล้ว **ไม่ออกเลขใบเสร็จให้** (พฤติกรรมเดิมเป๊ะ)", async () => {
    await setVat(false);
    const { saleNo, result } = await sellOne();
    expect(result.is_vat).toBe(false);
    expect(result.rcpt_no).toBeNull();
    expect((await saleOf(saleNo)).rcpt_no).toBeNull();
  });

  it("จด VAT — ปิดบิลแล้วได้เลขใบกำกับอย่างย่อทันที ไม่ต้องรอลูกค้าขอ", async () => {
    await setVat(true);
    const { saleNo, result } = await sellOne();
    expect(result.is_vat).toBe(true);
    expect(String(result.rcpt_no)).toMatch(/^BR\d{6}-\d{3}$/);
    expect((await saleOf(saleNo)).rcpt_no).toBe(result.rcpt_no);
  });

  it("กดขอใบเสร็จซ้ำหลังปิดบิล → ได้เลขเดิม ไม่ออกใบใหม่", async () => {
    await setVat(true);
    const { saleNo, result } = await sellOne();
    const again = await rpc(asA, "fn_bar_issue_receipt", { p_entity: E(), p_sale_no: saleNo });
    expect(again.error, again.error?.message).toBeNull();
    expect((again.data as { rcpt_no: string; reused: boolean }).rcpt_no).toBe(result.rcpt_no);
    expect((again.data as { reused: boolean }).reused).toBe(true);
  });

  /**
   * 🚩 **ข้อที่สำคัญที่สุดของชุดนี้**
   *    `taxReport()` ของ ภพ.30 ข้ามแถวที่ `vat_amount <= 0` ทิ้ง
   *    ⇒ ไม่เซ็ต vat_amount = ยอดขายบาร์หายจาก ภพ.30 ทั้งเดือนโดยไม่มีอะไรฟ้อง
   */
  it("🚨 จด VAT — ลงบัญชีแล้วบิลบัญชีต้องมี vat_amount และฐานเป็นยอด**ก่อน**ภาษี", async () => {
    await setVat(true);
    const d = "2026-08-21";
    await sellOne("เงินสด", d); // 260 รวม VAT
    const post = await rpc(asA, "fn_bar_post_day", {
      p_entity: E(), p_date: d, p_account: account, p_category: "รายได้บาร์",
    });
    expect(post.error, post.error?.message).toBeNull();

    const { data } = await admin()
      .from("transactions")
      .select("base_amount, amount_after_discount, vat_amount, net_amount, tax_invoice_no, tax_invoice_date")
      .eq("tenant_id", A.tenantId)
      .eq("tx_id", (post.data as { tx_ids: string[] }).tx_ids[0])
      .single();

    // 260 รวม VAT → ภาษี 17.01 · ฐาน 242.99 (ตรงกับ golden B11 ฝั่ง TS)
    expect(Number(data!.vat_amount)).toBe(17.01);
    expect(Number(data!.base_amount)).toBe(242.99);
    expect(Number(data!.amount_after_discount)).toBe(242.99);
    // 🚨 เงินที่รับจริงยังเป็นยอดเต็ม — ฐาน + ภาษี ต้องเท่ากับยอดนี้เป๊ะ
    expect(Number(data!.net_amount)).toBe(260);
    expect(Number(data!.base_amount) + Number(data!.vat_amount)).toBe(260);
    // ภพ.30 ต้องอ้างอิงเอกสารได้
    expect(String(data!.tax_invoice_no)).toMatch(/^BR\d{6}-\d{3}/);
    expect(data!.tax_invoice_date).toBe(d);
  });

  it("🚨 ทางกลับ — ไม่จด VAT ลงบัญชีแล้วช่องภาษีต้องว่างและฐานเป็นยอดเต็ม (เหมือนเดิม)", async () => {
    await setVat(false);
    const d = "2026-08-22";
    await sellOne("เงินสด", d);
    const post = await rpc(asA, "fn_bar_post_day", {
      p_entity: E(), p_date: d, p_account: account, p_category: "รายได้บาร์",
    });
    expect(post.error, post.error?.message).toBeNull();

    const { data } = await admin()
      .from("transactions")
      .select("base_amount, amount_after_discount, vat_amount, net_amount, tax_invoice_no")
      .eq("tenant_id", A.tenantId)
      .eq("tx_id", (post.data as { tx_ids: string[] }).tx_ids[0])
      .single();

    expect(Number(data!.vat_amount)).toBe(0);
    expect(Number(data!.base_amount)).toBe(260);
    expect(Number(data!.net_amount)).toBe(260);
    expect(data!.tax_invoice_no).toBeNull();
  });

  /**
   * 🚩 สูตรถอด VAT อยู่ 2 ฝั่ง (TS สำหรับสลิป · SQL สำหรับบิลบัญชี)
   *    หลุดจากกันแล้ว **เลขบนกระดาษกับเลขที่ยื่นภาษีจะต่างกันโดยไม่มีอะไรฟ้อง**
   *    (บทเรียน D79 "สูตรเงินมี 2 ที่") ⇒ เทียบผลที่ SQL เขียนจริงกับ `vatFromGross()`
   */
  it("🚩 เลขที่ SQL เขียน ต้องตรงกับ lib/bar/vat.ts เป๊ะ", async () => {
    await setVat(true);
    const d = "2026-08-23";
    // ขาย 3 บิล 2 วิธีรับเงิน → ได้ 2 แถวบัญชีที่ยอดต่างกัน
    await sellOne("เงินสด", d);
    await sellOne("เงินสด", d);
    await sellOne("QR", d);

    const post = await rpc(asA, "fn_bar_post_day", {
      p_entity: E(), p_date: d, p_account: account, p_category: "รายได้บาร์",
    });
    expect(post.error, post.error?.message).toBeNull();

    const { data } = await admin()
      .from("transactions")
      .select("base_amount, vat_amount, net_amount")
      .eq("tenant_id", A.tenantId)
      .in("tx_id", (post.data as { tx_ids: string[] }).tx_ids);

    expect(data!.length).toBe(2); // เงินสด 520 · QR 260
    for (const row of data!) {
      const ts = vatFromGross(Number(row.net_amount));
      expect(Number(row.base_amount), `ฐานของยอด ${row.net_amount}`).toBe(ts.base);
      expect(Number(row.vat_amount), `ภาษีของยอด ${row.net_amount}`).toBe(ts.vat);
    }
  });
});
