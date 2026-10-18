"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mapDbError } from "@/lib/shared/dbError";
import { barTotals } from "@/lib/bar/totals";
import { businessDate } from "@/lib/bar/businessDate";
import { lineAmount } from "@/lib/bar/totals";
import { resolveLine } from "@/lib/bar/discount";
import { nextCategorySort, sortUpdates, categoryEditsError, categoryNameUpdates } from "@/lib/bar/categoryOrder";
import { menuOrderError, menuOrderUpdates, menuQtyMap, orderColumn, type OrderView } from "@/lib/bar/menuOrder";
import { fetchAllRows } from "@/lib/shared/paginate";
import { unitLockReason, type ReceiveRow, type AdjustRow, type NewItemRow, type ItemEditRow } from "@/lib/bar/stockBatch";
import type { CartLine, SaleWindow } from "@/lib/bar/types";
import { getBarBootstrap } from "./data";

/**
 * Server actions ของโมดูลบาร์ (D96)
 *
 * ── การแบ่งหน้าที่ระหว่าง TS กับ SQL (ตัดสินไว้ที่ migration 0065/0066) ──────
 * · `amount` ต่อบรรทัด  → **TS คิด** (`lineAmount` · golden B4) แล้วส่งให้ SQL
 *   🚨 แต่ SQL **บังคับกติกาซ้ำ** (ของแถม → 0 · ติดลบ → 0) เพราะนั่นเป็นกติกาธุรกิจ
 *      ไม่ใช่นโยบายหน้าจอ (0066)
 * · `cost` ต่อบรรทัด    → **SQL คิด** เพราะต้องอ่านราคาต้นทุนในจังหวะเดียวกับที่ตัดสต็อก
 * · `business_date`     → **TS คิด** (`businessDate` · golden B6) แล้วส่งให้ SQL
 *   🚨 ห้ามให้ SQL คิดเอง — สูตรจะมี 2 ที่แล้วเพี้ยนกันวันใดวันหนึ่ง (บทเรียน D79)
 *
 * 🚨 ทุก action ต้องส่งพารามิเตอร์ให้ครบทุกตัวที่ RPC ต้องการ — ละตัวที่ไม่มี default
 *    แล้ว PostgREST จะตอบ `PGRST202` ซึ่งอ่านแล้วเหมือน "ยังไม่ได้ลง migration"
 */

type Res = { ok: boolean; error?: string; data?: unknown };

const okOf = (data: unknown): Res => ({ ok: true, data });

async function rpc(fn: string, args: Record<string, unknown>): Promise<Res> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath("/bar");
  return okOf(data);
}

/** กิจการที่บาร์ใช้ — อ่านจากค่าตั้งค่าเสมอ 🚨 ห้ามเดาเป็นกิจการหลัก (ตระกูล D79) */
async function barEntity(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("value").eq("kind", "bar_entity").maybeSingle();
  return (data?.value as string) || null;
}

const NO_ENTITY = "ยังไม่ได้ตั้งกิจการของบาร์ — ไปตั้งที่แท็บ ตั้งค่าบาร์ ก่อน";

export async function openSaleAction(input: {
  tabName?: string | null;
  channel?: string | null;
  customerId?: string | null;
}): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_open_sale", {
    p_entity: entity,
    p_tab_name: input.tabName?.trim() || null,
    p_channel: input.channel?.trim() || "บาร์",
    p_customer: input.customerId || null,
  });
}

export async function addLinesAction(input: { saleNo: string; lines: CartLine[] }): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  if (!input.lines.length) return { ok: false, error: "ยังไม่ได้เลือกเมนู" };
  return rpc("fn_bar_add_lines", {
    p_entity: entity,
    p_sale_no: input.saleNo,
    p_items: input.lines.map((l) => ({
      menu_id: l.menuId,
      menu_name: l.menuName,
      qty: l.qty,
      price: l.price,
      line_discount: l.lineDiscount ?? 0,
      // 🚨 % เป็นคำอธิบาย — ตัวเงินคือ `line_discount` ข้างบนที่ `lib/bar/discount.ts` คิดมาแล้ว
      line_discount_pct: l.lineDiscountPct ?? null,
      is_comp: Boolean(l.isComp),
      amount: lineAmount(l),
    })),
  });
}

export async function voidLineAction(input: {
  saleNo: string;
  lineNo: number;
  reason?: string;
}): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_void_line", {
    p_entity: entity,
    p_sale_no: input.saleNo,
    p_line_no: input.lineNo,
    p_reason: input.reason?.trim() || "แก้บิล",
  });
}

/**
 * แก้ส่วนลด/แถม ของรายการที่ส่งเข้าบิลแล้ว (D112 · 0082) — เฉพาะบิลที่ยังเปิด
 * ★ ยอดรายการคิดที่นี่ด้วย `resolveLine` + `lineAmount` ตัวเดียวกับตอนส่งเข้าบิล
 *   จาก qty/ราคา **ที่อยู่ใน DB** (ไม่เชื่อตัวเลขจากหน้าจอ) · SQL แค่ตรวจว่าไม่ขัดกติกา
 */
export async function editLineAction(input: {
  saleNo: string;
  lineNo: number;
  lineDiscount: number;
  lineDiscountPct: number | null;
  isComp: boolean;
}): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  const supabase = await createClient();
  const cur = await supabase
    .from("bar_sale_item")
    .select("menu_id, menu_name, qty, price")
    .eq("entity_id", entity)
    .eq("sale_no", input.saleNo)
    .eq("line_no", input.lineNo)
    .maybeSingle();
  if (cur.error) return { ok: false, error: mapDbError(cur.error) };
  if (!cur.data) return { ok: false, error: "ไม่พบรายการนี้ในบิล — รีเฟรชหน้าแล้วลองใหม่" };
  const line = resolveLine({
    menuId: (cur.data.menu_id as string) ?? null,
    menuName: cur.data.menu_name as string,
    qty: Number(cur.data.qty),
    price: Number(cur.data.price),
    lineDiscount: input.isComp ? 0 : input.lineDiscount,
    lineDiscountPct: input.isComp ? null : input.lineDiscountPct,
    isComp: input.isComp,
  });
  return rpc("fn_bar_edit_line", {
    p_entity: entity,
    p_sale_no: input.saleNo,
    p_line_no: input.lineNo,
    p_line_discount: line.lineDiscount ?? 0,
    p_line_discount_pct: line.lineDiscountPct ?? null,
    p_is_comp: input.isComp,
    p_amount: lineAmount(line),
  });
}

/** เปลี่ยนลูกค้า/ชื่อบิล ของบิลที่ยังเปิดอยู่ (D112 · 0082) — บิลที่ปิดแล้ว SQL ปฏิเสธ */
export async function setSaleCustomerAction(input: {
  saleNo: string;
  customerId: string | null;
  tabName: string;
}): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_set_sale_customer", {
    p_entity: entity,
    p_sale_no: input.saleNo,
    p_customer_id: input.customerId,
    p_tab_name: input.tabName,
  });
}

/**
 * ปิดบิล
 * ★ `business_date` คิดฝั่งนี้ด้วย `lib/bar/businessDate.ts` แล้วส่งไป — SQL ไม่คิดเอง
 */
export async function closeSaleAction(input: {
  saleNo: string;
  method: string;
  discount?: number;
  /** % ที่ผู้ใช้กรอก — แค่เก็บไว้พิมพ์บนสลิป ไม่ได้เอาไปคิดเงินซ้ำ */
  discountPct?: number | null;
  rounding?: number;
  window?: SaleWindow | null;
}): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  if (!input.method?.trim()) return { ok: false, error: "เลือกวิธีรับเงินก่อน" };
  return rpc("fn_bar_close_sale", {
    p_entity: entity,
    p_sale_no: input.saleNo,
    p_method: input.method,
    p_discount: Math.max(0, input.discount ?? 0),
    p_discount_pct: input.discountPct ?? null,
    p_rounding: input.rounding ?? 0,
    p_business_date: businessDate(new Date(), input.window ?? null),
  });
}

/** ขายเร็วที่บูธ — เปิด+เพิ่ม+ปิด ในทรานแซกชันเดียว */
export async function quickSaleAction(input: {
  lines: CartLine[];
  method: string;
  channel?: string | null;
  customerId?: string | null;
  discount?: number;
  discountPct?: number | null;
  roundCash?: boolean;
  window?: SaleWindow | null;
}): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  if (!input.lines.length) return { ok: false, error: "ยังไม่ได้เลือกเมนู" };
  if (!input.method?.trim()) return { ok: false, error: "เลือกวิธีรับเงินก่อน" };
  const t = barTotals(input.lines, { discount: input.discount, roundCash: input.roundCash });
  return rpc("fn_bar_quick_sale", {
    p_entity: entity,
    p_items: input.lines.map((l) => ({
      menu_id: l.menuId,
      menu_name: l.menuName,
      qty: l.qty,
      price: l.price,
      line_discount: l.lineDiscount ?? 0,
      line_discount_pct: l.lineDiscountPct ?? null,
      is_comp: Boolean(l.isComp),
      amount: lineAmount(l),
    })),
    p_method: input.method,
    p_channel: input.channel?.trim() || "บาร์",
    p_customer: input.customerId || null,
    p_discount: Math.max(0, input.discount ?? 0),
    p_discount_pct: input.discountPct ?? null,
    p_rounding: t.rounding,
    p_business_date: businessDate(new Date(), input.window ?? null),
  });
}

/** สร้าง/แก้เมนูพร้อมสูตรในทรานแซกชันเดียว — สูตรพัง = เมนูต้องไม่เกิด */
export async function saveMenuAction(input: {
  menuId?: string | null;
  name: string;
  price: number;
  categoryId?: string | null;
  fixedCost?: number | null;
  method?: string | null;
  glass?: string | null;
  note?: string | null;
  createdFor?: string | null;
  recipe: { itemId: string; qty: number }[];
}): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  if (!input.name.trim()) return { ok: false, error: "ตั้งชื่อเมนูก่อน" };
  return rpc("fn_bar_save_menu", {
    p_entity: entity,
    p_menu: {
      menu_id: input.menuId || null,
      name: input.name.trim(),
      price: input.price,
      category_id: input.categoryId || null,
      fixed_cost: input.fixedCost ?? null,
      method: input.method?.trim() || null,
      glass: input.glass?.trim() || null,
      note: input.note?.trim() || null,
      created_for: input.createdFor || null,
    },
    p_recipe: input.recipe.filter((r) => r.itemId && r.qty > 0).map((r) => ({ item_id: r.itemId, qty: r.qty })),
  });
}

/**
 * รับของเข้าบาร์หลายรายการในครั้งเดียว (D103) — ★ ราคาเป็นของล็อตจริง หน้าจอเติมค่าล่าสุดมาให้
 * 🚨 ทั้งชุดเป็น transaction เดียว (0080) — แถวไหนล้ม ไม่มีแถวไหนเข้าเลย
 *    `row` = เลขแถวบนจอ ให้ข้อความ error ชี้ถูกแถว (แถวว่างถูกข้ามไปก่อนแล้ว)
 */
export async function receiveBatchAction(input: {
  rows: ReceiveRow[];
  source?: string | null;
  note?: string | null;
  docDate?: string | null;
}): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  if (input.rows.length === 0) return { ok: false, error: "ยังไม่มีรายการให้รับเข้า" };
  return rpc("fn_bar_receive_batch", {
    p_entity: entity,
    p_rows: input.rows.map((r) => ({
      row: r.row, item: r.itemId, qty: r.qty, qty_pack: r.qtyPack, cost_total: r.costTotal,
    })),
    p_date: input.docDate || null,
    p_source: input.source?.trim() || null,
    p_note: input.note?.trim() || null,
  });
}

/** ปรับยอดตามที่นับได้จริง / ของเสีย / ชิม หลายรายการในครั้งเดียว (D103) — ทุกแถวเขียน `bar_move` */
export async function adjustBatchAction(rows: AdjustRow[]): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  if (rows.length === 0) return { ok: false, error: "ยังไม่มีรายการที่ยอดเปลี่ยน" };
  return rpc("fn_bar_adjust_batch", {
    p_entity: entity,
    p_rows: rows.map((r) => ({
      row: r.row, item: r.itemId, qty_after: r.qtyAfter, reason: r.reason, note: r.note,
    })),
  });
}

/**
 * เพิ่มวัตถุดิบหลายรายการในครั้งเดียว (D103) — insert คำสั่งเดียว = เข้าหมดหรือไม่เข้าเลย
 * 🚨 ตรวจชื่อซ้ำกับของใน DB อีกรอบฝั่ง server — หน้าจออาจเปิดค้างไว้ขณะอีกเครื่องเพิ่มชื่อเดียวกัน
 */
export async function addItemsAction(rows: NewItemRow[]): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  if (rows.length === 0) return { ok: false, error: "ยังไม่มีรายการให้เพิ่ม" };
  if (rows.some((r) => !r.name.trim() || !r.unit.trim())) {
    return { ok: false, error: "ทุกรายการต้องมีชื่อและหน่วย" };
  }
  const supabase = await createClient();
  const cur = await supabase.from("bar_item").select("name").eq("entity_id", entity);
  // 🚨 อ่านไม่ได้ ≠ ไม่มีชื่อซ้ำ (D89)
  if (cur.error) return { ok: false, error: mapDbError(cur.error) };
  const key = (s: string) => s.trim().toLowerCase();
  const have = new Set((cur.data ?? []).map((r) => key(r.name as string)));
  const dup = rows.filter((r) => have.has(key(r.name))).map((r) => r.name);
  if (dup.length > 0) return { ok: false, error: `มีวัตถุดิบชื่อนี้อยู่แล้ว: ${dup.join(" · ")}` };

  const stamp = Date.now().toString(36).toUpperCase();
  const { error } = await supabase.from("bar_item").insert(
    rows.map((r, i) => ({
      entity_id: entity,
      // ★ ต่อท้ายเลขแถว — ทั้งชุดได้ Date.now() ค่าเดียวกัน ไม่ต่อ = รหัสชนกันเองทั้งชุด
      item_id: `I-${stamp}-${i + 1}`,
      name: r.name.trim(),
      unit: r.unit.trim(),
      pack_size: r.packSize,
      pack_label: r.packLabel,
      low_qty: r.lowQty,
      active: true,
    })),
  );
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath("/bar");
  return { ok: true, data: { count: rows.length } };
}

/**
 * แก้วัตถุดิบหลายรายการแล้วบันทึกทีเดียว (D104) — upsert คำสั่งเดียว = เข้าหมดหรือไม่เข้าเลย
 * 🚨 ไม่ส่ง `qty` / `cost_per_unit` — upsert ของ PostgREST SET เฉพาะคอลัมน์ที่ส่งมา
 *    สองค่านั้นขยับได้ทางเดียวคือรับของ/นับสต็อก (มีร่องรอยใน bar_move · หลักเดียวกับ D93 ที่ไม่ให้แก้ตัวเลขบน log_distill ตรง ๆ)
 * 🚨 ตรวจล็อกหน่วยซ้ำฝั่ง server — หน้าจออาจเปิดค้างไว้ระหว่างที่อีกเครื่องรับของเข้า
 *    (ยอด 0 ตอนเปิดหน้า ≠ ยอด 0 ตอนกดบันทึก)
 */
export async function updateItemsAction(rows: ItemEditRow[]): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  if (rows.length === 0) return { ok: false, error: "ยังไม่มีรายการที่เปลี่ยน" };
  const supabase = await createClient();
  const [cur, rec] = await Promise.all([
    supabase.from("bar_item").select("item_id, name, unit, qty").eq("entity_id", entity),
    supabase.from("bar_recipe").select("item_id").eq("entity_id", entity),
  ]);
  // 🚨 อ่านไม่ได้ ≠ ไม่มีอะไรขวาง (D89)
  if (cur.error) return { ok: false, error: mapDbError(cur.error) };
  if (rec.error) return { ok: false, error: mapDbError(rec.error) };

  const byId = new Map((cur.data ?? []).map((r) => [r.item_id as string, r]));
  const used = new Map<string, number>();
  for (const r of rec.data ?? []) used.set(r.item_id as string, (used.get(r.item_id as string) ?? 0) + 1);

  const key = (s: string) => s.trim().toLowerCase();
  const finalName = new Map([...byId].map(([id, r]) => [id, r.name as string]));
  for (const r of rows) finalName.set(r.itemId, r.name);
  const nameCount = new Map<string, number>();
  for (const n of finalName.values()) nameCount.set(key(n), (nameCount.get(key(n)) ?? 0) + 1);

  for (const r of rows) {
    const prev = byId.get(r.itemId);
    // ★ upsert บน id ที่ไม่มีอยู่ = insert วัตถุดิบใหม่เงียบ ๆ — ต้องกันไว้
    if (!prev) return { ok: false, error: `ไม่พบวัตถุดิบ ${r.name} (อาจถูกลบจากอีกเครื่อง) — รีเฟรชหน้าแล้วลองใหม่` };
    if (!r.name.trim() || !r.unit.trim()) return { ok: false, error: "ทุกรายการต้องมีชื่อและหน่วย" };
    // ฟ้องเฉพาะตัวที่เปลี่ยนชื่อ — ชื่อซ้ำที่มีอยู่แล้วในข้อมูลเก่าต้องไม่ล็อกการแก้ทั้งตาราง
    if (key(r.name) !== key(prev.name as string) && (nameCount.get(key(r.name)) ?? 0) > 1)
      return { ok: false, error: `ชื่อ "${r.name}" ซ้ำกับวัตถุดิบตัวอื่น` };
    if (r.unit.trim() !== prev.unit) {
      const lock = unitLockReason({ qty: Number(prev.qty), unit: prev.unit as string }, used.get(r.itemId) ?? 0);
      if (lock) return { ok: false, error: `${r.name}: ${lock}` };
    }
  }

  const { error } = await supabase.from("bar_item").upsert(
    rows.map((r) => ({
      entity_id: entity,
      item_id: r.itemId,
      name: r.name.trim(),
      unit: r.unit.trim(),
      pack_size: r.packSize,
      pack_label: r.packLabel,
      low_qty: r.lowQty,
      active: r.active,
    })),
    { onConflict: "tenant_id,entity_id,item_id" },
  );
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath("/bar");
  return { ok: true, data: { count: rows.length } };
}

/**
 * เพิ่มหมวดเมนู · 🚨 ลบหมวดที่ยังมีเมนูอยู่ต้องล้ม (FK restrict ของ 0064)
 * · 🔄 D109: แก้ชื่อย้ายไป `saveCategoriesAction` (บันทึกพร้อมลำดับทีเดียว) — ทางเดียว ไม่ให้มีสองทาง (D81)
 * · หมวดใหม่ต่อท้ายด้วย max+1 คิดฝั่ง server — 🪤 ของเดิมรับ "จำนวนหมวด" จากหน้าจอ
 *   เคยลบหมวดไปแล้ว = เลขชนกัน ลำดับบนหน้าขายสลับไปมาเอง (D101)
 */
export async function saveCategoryAction(input: { name: string }): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  if (!input.name.trim()) return { ok: false, error: "ตั้งชื่อหมวดก่อน" };
  const supabase = await createClient();
  {
    const cur = await supabase.from("bar_category").select("sort").eq("entity_id", entity);
    // 🚨 อ่านไม่ได้ ≠ ไม่มีหมวด (D89) — เดาเป็น 0 = ไปชนหมวดแรก
    if (cur.error) return { ok: false, error: mapDbError(cur.error) };
    const id = `C-${Date.now().toString(36).toUpperCase()}`;
    const { error } = await supabase.from("bar_category").insert({
      entity_id: entity,
      category_id: id,
      name: input.name.trim(),
      sort: nextCategorySort((cur.data ?? []).map((r) => Number(r.sort) || 0)),
      is_system: false,
    });
    if (error) return { ok: false, error: mapDbError(error) };
  }
  revalidatePath("/bar");
  return { ok: true };
}

/**
 * บันทึกหมวดทีเดียว — ลำดับ + ชื่อที่แก้ (D109 · แทน reorderCategoriesAction + แก้ชื่อรายหมวดของ D101)
 * `order` = category_id ทั้งชุดตามลำดับใหม่ · `names` = เฉพาะหมวดที่ผู้ใช้แตะ
 * 🚨 ชุดหมวดต้องตรงกับใน DB พอดี ไม่งั้นแปลว่าอีกเครื่องเพิ่ม/ลบหมวดระหว่างนั้น → ไม่เดา ให้รีเฟรช
 * 🪤 ไม่ใช่ transaction (หมวดมีไม่กี่แถว) — ล้มกลางทาง บางส่วนค้าง แต่ไม่มีข้อมูลเสีย กดบันทึกอีกครั้งเขียนให้ครบ
 */
export async function saveCategoriesAction(input: {
  order: string[];
  names: Record<string, string>;
}): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  const supabase = await createClient();
  const cur = await supabase.from("bar_category").select("category_id, name, sort").eq("entity_id", entity);
  if (cur.error) return { ok: false, error: mapDbError(cur.error) };
  const rows = cur.data ?? [];
  const bad = categoryEditsError(
    input.order,
    input.names,
    rows.map((r) => r.category_id as string),
  );
  if (bad) return { ok: false, error: bad };
  const names = categoryNameUpdates(input.names, new Map(rows.map((r) => [r.category_id as string, r.name as string])));
  const sorts = sortUpdates(input.order, new Map(rows.map((r) => [r.category_id as string, Number(r.sort)])));
  for (const u of names) {
    const { error } = await supabase
      .from("bar_category")
      .update({ name: u.name })
      .eq("entity_id", entity)
      .eq("category_id", u.categoryId);
    if (error) return { ok: false, error: mapDbError(error) };
  }
  for (const u of sorts) {
    const { error } = await supabase
      .from("bar_category")
      .update({ sort: u.sort })
      .eq("entity_id", entity)
      .eq("category_id", u.categoryId);
    if (error) return { ok: false, error: mapDbError(error) };
  }
  revalidatePath("/bar");
  return { ok: true };
}

/**
 * จัดลำดับเมนูบนหน้าขาย (▲▼ · D108) — `view` = "all" (หน้า "ทั้งหมด" → sort_all) หรือ category_id (→ sort)
 * ★ แต่ละหน้าตั้งแยกกัน ไม่มีผลต่อกัน (ผู้ใช้เลือก) · คอลัมน์ตัดสินที่ `orderColumn()` ที่เดียว
 * 🪤 ไม่ใช่ transaction (แบบเดียวกับเรียงหมวด D101) — ล้มกลางทาง ลำดับค้างครึ่งเดียวแต่ไม่มีข้อมูลเสีย
 *    กดบันทึกอีกครั้งเขียนทั้งชุดใหม่ให้เอง
 */
export async function reorderMenusAction(view: OrderView, ids: string[]): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  const supabase = await createClient();
  const col = orderColumn(view);
  const cur = await supabase.from("bar_menu").select("menu_id, category_id, sort, sort_all").eq("entity_id", entity);
  // 🚨 อ่านไม่ได้ ≠ ไม่มีเมนู (D89)
  if (cur.error) return { ok: false, error: mapDbError(cur.error) };
  const rows = (cur.data ?? []).map((r) => ({
    menuId: r.menu_id as string,
    categoryId: r.category_id as string,
    pos: (col === "sort_all" ? r.sort_all : r.sort) as number | null,
  }));
  const bad = menuOrderError(ids, rows, view);
  if (bad) return { ok: false, error: bad };
  const current = new Map(rows.map((r) => [r.menuId, r.pos === null ? null : Number(r.pos)]));
  const results = await Promise.all(
    menuOrderUpdates(ids, current).map((u) =>
      supabase.from("bar_menu").update({ [col]: u.pos }).eq("entity_id", entity).eq("menu_id", u.menuId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, error: mapDbError(failed.error) };
  revalidatePath("/bar");
  return { ok: true };
}

/**
 * ยอดสั่งต่อเมนูย้อนหลัง N วัน — ใช้โชว์ข้างชื่อตอนจัดลำดับ (ช่วยตัดสินใจ ไม่ได้ใช้เรียง)
 * ไม่นับบรรทัดที่ยกเลิก และบิลที่ยกเลิกทั้งใบ
 * 🪤 PostgREST คืนแค่ 1,000 แถวเงียบ ๆ — บาร์ 30 วันเกินแน่ ต้องวน `.range()` (D82)
 */
/**
 * เมนูที่ "เป็นของ" ลูกค้าคนนี้ สำหรับชิปกรองหน้าขาย (D111) — ของโปรด + เคยสั่งจากบิลที่ปิดแล้ว ย้อนหลัง N วัน
 * (เมนูที่สร้างให้ + บิลที่ยังเปิด หน้าจอมีอยู่แล้วในข้อมูลหลัก)
 * ★ ไม่ใส่ในข้อมูลหลักของหน้า (bootstrap) — ประวัติทุกลูกค้า 90 วันหนักเกินไป ขอเฉพาะคนที่ใช้ชิปอยู่
 * ไม่นับบิลที่ยกเลิก / บรรทัดที่ยกเลิก
 */
export async function getCustomerMenusAction(
  customerId: string,
  days = 90,
): Promise<{ ok: boolean; error?: string; data?: { fav: string[]; ordered: string[] } }> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [favs, sales] = await Promise.all([
    supabase.from("bar_customer_fav").select("menu_id").eq("entity_id", entity).eq("customer_id", customerId),
    supabase
      .from("bar_sale")
      .select("sale_no")
      .eq("entity_id", entity)
      .eq("customer_id", customerId)
      .neq("status", "ยกเลิก")
      .gte("opened_at", since)
      .limit(1000),
  ]);
  // 🚨 อ่านไม่ได้ ≠ ไม่มี (D89) — บอก แล้วชิปยังใช้ข้อมูลที่มีอยู่ได้
  if (favs.error || sales.error) return { ok: false, error: "อ่านของโปรด/ประวัติลูกค้าไม่สำเร็จ — ชิปกรองแสดงได้ไม่ครบ" };
  const saleNos = (sales.data ?? []).map((r) => r.sale_no as string);
  const ordered = new Set<string>();
  // .in() ทีละก้อน — URL ยาวเกินถ้าส่งเลขบิลหลายร้อยใบในคำขอเดียว
  for (let i = 0; i < saleNos.length; i += 150) {
    const items = await supabase
      .from("bar_sale_item")
      .select("menu_id")
      .eq("entity_id", entity)
      .in("sale_no", saleNos.slice(i, i + 150))
      .is("voided_at", null)
      .limit(5000);
    if (items.error) return { ok: false, error: "อ่านประวัติการสั่งของลูกค้าไม่สำเร็จ — ชิปกรองแสดงได้ไม่ครบ" };
    for (const r of items.data ?? []) if (r.menu_id) ordered.add(r.menu_id as string);
  }
  return { ok: true, data: { fav: (favs.data ?? []).map((r) => r.menu_id as string), ordered: [...ordered] } };
}

type SaleItemRow = { sale_no: string; menu_id: string | null; qty: number; voided_at: string | null };

export async function getMenuSalesAction(
  days = 30,
): Promise<{ ok: boolean; error?: string; data?: Record<string, number> }> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  try {
    const [items, cancelled] = await Promise.all([
      fetchAllRows<SaleItemRow>(
        async (from, to) => {
          const { data, error, count } = await supabase
            .from("bar_sale_item")
            .select("sale_no, menu_id, qty, voided_at", { count: from === 0 ? "exact" : undefined })
            .eq("entity_id", entity)
            .gte("added_at", since)
            .order("sale_no")
            .order("line_no")
            .range(from, to);
          return { data: (data ?? []) as SaleItemRow[], error, count };
        },
        { label: "ยอดขายเมนู" },
      ),
      fetchAllRows<{ sale_no: string }>(
        async (from, to) => {
          const { data, error, count } = await supabase
            .from("bar_sale")
            .select("sale_no", { count: from === 0 ? "exact" : undefined })
            .eq("entity_id", entity)
            .eq("status", "ยกเลิก")
            .gte("opened_at", new Date(Date.now() - (days + 2) * 86_400_000).toISOString())
            .order("sale_no")
            .range(from, to);
          return { data: (data ?? []) as { sale_no: string }[], error, count };
        },
        { label: "บิลที่ยกเลิก" },
      ),
    ]);
    const dead = new Set(cancelled.map((r) => r.sale_no));
    const qty = menuQtyMap(
      items
        .filter((r) => !dead.has(r.sale_no))
        .map((r) => ({ menuId: r.menu_id, qty: Number(r.qty) || 0, voided: r.voided_at != null })),
    );
    return { ok: true, data: Object.fromEntries(qty) };
  } catch {
    return { ok: false, error: "อ่านยอดขายไม่สำเร็จ — จัดลำดับได้ตามปกติ แค่ไม่มีตัวเลขช่วยดู" };
  }
}

export async function deleteCategoryAction(categoryId: string): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  const supabase = await createClient();
  const { error } = await supabase
    .from("bar_category")
    .delete()
    .eq("entity_id", entity)
    .eq("category_id", categoryId);
  // 🪤 FK restrict จะคืน 23503 — `mapDbError` แปลเป็นไทยให้แล้ว แต่ข้อความกลาง ๆ
  //    ตรงนี้บอกให้ชัดว่าต้องทำอะไรก่อน (ทุกครั้งที่ปิดทาง ต้องบอกว่ากดอะไรแทน · D88)
  if (error) {
    return {
      ok: false,
      error:
        error.code === "23503"
          ? "ลบไม่ได้ — ยังมีเมนูอยู่ในหมวดนี้ ย้ายเมนูไปหมวดอื่นก่อน"
          : mapDbError(error),
    };
  }
  revalidatePath("/bar");
  return { ok: true };
}

/**
 * ค้นบิลย้อนหลัง — ไม่โหลดมาใน bootstrap เพราะโตไม่จำกัด
 * 🚨 อ่านไม่สำเร็จต้องฟ้อง ไม่ใช่คืนลิสต์ว่าง (D89)
 */
export async function searchSalesAction(input: {
  from: string;
  to: string;
  q?: string;
}): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  const supabase = await createClient();

  const sales = await supabase
    .from("bar_sale")
    .select(
      "sale_no, status, tab_name, customer_id, channel, opened_at, closed_at, business_date, method, sub_total, discount, rounding, grand_total, rcpt_no",
    )
    .eq("entity_id", entity)
    .gte("business_date", input.from)
    .lte("business_date", input.to)
    .order("closed_at", { ascending: false })
    .limit(300);
  if (sales.error) return { ok: false, error: mapDbError(sales.error) };

  const rows = sales.data ?? [];
  const q = (input.q ?? "").trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) =>
        [r.sale_no, r.tab_name, r.rcpt_no, r.channel]
          .some((f) => String(f ?? "").toLowerCase().includes(q)),
      )
    : rows;

  if (!filtered.length) return okOf({ sales: [], lines: [] });

  const lines = await supabase
    .from("bar_sale_item")
    .select("sale_no, line_no, menu_id, menu_name, qty, price, line_discount, is_comp, amount, voided_at")
    .eq("entity_id", entity)
    .in("sale_no", filtered.map((r) => r.sale_no as string))
    .order("line_no");
  if (lines.error) return { ok: false, error: mapDbError(lines.error) };

  return okOf({ sales: filtered, lines: lines.data ?? [] });
}

/**
 * เพิ่ม/แก้ลูกค้าบาร์
 *
 * 🚨 **ความยินยอมให้โรงกลั่นติดต่อ (PDPA)**
 *    · ค่าปริยาย `false` เสมอ — ความยินยอมที่ติ๊กไว้ล่วงหน้าไม่ใช่ความยินยอม
 *    · ติ๊กแล้วบันทึก `consent_at` · **ถอนแล้วต้องล้าง `consent_at` ด้วย**
 *      (CHECK `bar_customer_consent_pair` ใน 0064 บังคับให้สองค่านี้ตรงกันเสมอ)
 */
export async function saveCustomerAction(input: {
  customerId?: string | null;
  name: string;
  nickname?: string | null;
  phone?: string | null;
  taxId?: string | null;
  branch?: string | null;
  address?: string | null;
  note?: string | null;
  consentMarketing?: boolean;
  active?: boolean;
}): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  if (!input.name.trim()) return { ok: false, error: "ตั้งชื่อลูกค้าก่อน" };

  const supabase = await createClient();
  const consent = Boolean(input.consentMarketing);
  const row = {
    entity_id: entity,
    name: input.name.trim(),
    nickname: input.nickname?.trim() || null,
    phone: input.phone?.trim() || null,
    tax_id: input.taxId?.trim() || null,
    branch: input.branch?.trim() || null,
    address: input.address?.trim() || null,
    note: input.note?.trim() || null,
    consent_marketing: consent,
    // 🚨 ถอนความยินยอม = ล้างวันที่ ไม่ใช่ค้างไว้
    consent_at: consent ? new Date().toISOString() : null,
    active: input.active !== false,
  };

  if (input.customerId) {
    // ★ ถ้าเคยยินยอมอยู่แล้วและยังยินยอมอยู่ **อย่าเขียนวันที่ทับ** — วันที่ต้องเป็น
    //   ตอนที่ได้รับความยินยอมครั้งแรก ไม่ใช่ตอนที่เผลอกดบันทึกโปรไฟล์
    const { data: cur } = await supabase
      .from("bar_customer")
      .select("consent_marketing, consent_at")
      .eq("entity_id", entity)
      .eq("customer_id", input.customerId)
      .maybeSingle();
    if (consent && cur?.consent_marketing && cur.consent_at) row.consent_at = cur.consent_at as string;

    const { error } = await supabase
      .from("bar_customer")
      .update(row)
      .eq("entity_id", entity)
      .eq("customer_id", input.customerId);
    if (error) return { ok: false, error: mapDbError(error) };
    revalidatePath("/bar");
    return okOf({ customer_id: input.customerId });
  }

  const customerId = `BC-${Date.now().toString(36).toUpperCase()}`;
  const { error } = await supabase.from("bar_customer").insert({ ...row, customer_id: customerId });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath("/bar");
  return okOf({ customer_id: customerId });
}

/**
 * ลบลูกค้า — PDPA ต้องลบได้จริง ไม่ใช่แค่ปิดธง
 * 🪤 บิลเก่าอ้าง `customer_id` อยู่ · FK เป็น `on delete set null` (0064)
 *    ⇒ บิลไม่หาย แค่ไม่ผูกกับใครแล้ว ซึ่งถูกต้อง — ยอดขายที่เกิดขึ้นจริงต้องไม่หายไปกับคน
 */
export async function deleteCustomerAction(customerId: string): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  const supabase = await createClient();
  const { error } = await supabase
    .from("bar_customer")
    .delete()
    .eq("entity_id", entity)
    .eq("customer_id", customerId);
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath("/bar");
  return { ok: true };
}

/** ปักหมุด/ถอนหมุดเมนูโปรดของลูกค้า */
export async function toggleFavAction(input: {
  customerId: string;
  menuId: string;
  on: boolean;
}): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  const supabase = await createClient();
  if (input.on) {
    const { error } = await supabase
      .from("bar_customer_fav")
      .insert({ entity_id: entity, customer_id: input.customerId, menu_id: input.menuId });
    // ปักซ้ำ = ไม่ใช่ความผิดพลาด (23505 = มีอยู่แล้ว)
    if (error && error.code !== "23505") return { ok: false, error: mapDbError(error) };
  } else {
    const { error } = await supabase
      .from("bar_customer_fav")
      .delete()
      .eq("entity_id", entity)
      .eq("customer_id", input.customerId)
      .eq("menu_id", input.menuId);
    if (error) return { ok: false, error: mapDbError(error) };
  }
  revalidatePath("/bar");
  return { ok: true };
}

/** การ์ดลูกค้า — เมนูโปรด + ประวัติที่เคยสั่ง (เรียงล่าสุดก่อน) */
export async function customerCardAction(customerId: string): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  const supabase = await createClient();

  const favs = await supabase
    .from("bar_customer_fav")
    .select("menu_id")
    .eq("entity_id", entity)
    .eq("customer_id", customerId);
  if (favs.error) return { ok: false, error: mapDbError(favs.error) };

  const sales = await supabase
    .from("bar_sale")
    .select("sale_no, business_date, grand_total, status")
    .eq("entity_id", entity)
    .eq("customer_id", customerId)
    .eq("status", "ปกติ")
    .order("closed_at", { ascending: false })
    .limit(50);
  if (sales.error) return { ok: false, error: mapDbError(sales.error) };

  const saleNos = (sales.data ?? []).map((s) => s.sale_no as string);
  let lines: unknown[] = [];
  if (saleNos.length) {
    const r = await supabase
      .from("bar_sale_item")
      .select("sale_no, menu_id, menu_name, qty, voided_at")
      .eq("entity_id", entity)
      .in("sale_no", saleNos);
    if (r.error) return { ok: false, error: mapDbError(r.error) };
    lines = r.data ?? [];
  }

  return okOf({ favMenuIds: (favs.data ?? []).map((f) => f.menu_id as string), sales: sales.data ?? [], lines });
}

/** ยอดขายในช่วง — ใช้ทำแดชบอร์ด · อ่านค่าที่ **แช่ไว้ในบิล** เท่านั้น (D75) */
export async function dashboardAction(input: { from: string; to: string; prev?: { from: string; to: string } }): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  const supabase = await createClient();

  const sales = await supabase
    .from("bar_sale")
    .select("sale_no, status, business_date, channel, method, grand_total, cost_total")
    .eq("entity_id", entity)
    .gte("business_date", input.from)
    .lte("business_date", input.to);
  if (sales.error) return { ok: false, error: mapDbError(sales.error) };

  /**
   * D115 — ช่วงก่อนหน้า (ไว้เทียบ ▲▼ %) · ดึงแค่ยอดที่แช่ไว้ ไม่ดึงรายการเมนู
   * 🚨 อ่านพลาดต้องฟ้อง ไม่ใช่เทียบกับศูนย์ (= ทุกตัวขึ้น "ไม่มีข้อมูลเทียบ" เงียบ ๆ · D89)
   */
  let prevSales: unknown[] = [];
  if (input.prev) {
    const p = await supabase
      .from("bar_sale")
      .select("sale_no, status, business_date, channel, method, grand_total, cost_total")
      .eq("entity_id", entity)
      .gte("business_date", input.prev.from)
      .lte("business_date", input.prev.to);
    if (p.error) return { ok: false, error: mapDbError(p.error) };
    prevSales = p.data ?? [];
  }

  const saleNos = (sales.data ?? []).map((s) => s.sale_no as string);
  let lines: unknown[] = [];
  if (saleNos.length) {
    const r = await supabase
      .from("bar_sale_item")
      .select("sale_no, menu_id, menu_name, qty, amount, cost, voided_at")
      .eq("entity_id", entity)
      .in("sale_no", saleNos);
    if (r.error) return { ok: false, error: mapDbError(r.error) };
    lines = r.data ?? [];
  }

  const posts = await supabase
    .from("bar_post")
    .select("post_date, status, tx_ids, totals, posted_at")
    .eq("entity_id", entity)
    .gte("post_date", input.from)
    .lte("post_date", input.to)
    .eq("status", "ปกติ");
  if (posts.error) return { ok: false, error: mapDbError(posts.error) };

  const customers = await supabase
    .from("bar_customer")
    .select("customer_id, name, last_seen, visits, spend_total")
    .eq("entity_id", entity)
    .eq("active", true);
  if (customers.error) return { ok: false, error: mapDbError(customers.error) };

  /**
   * 🐛 **เจอตอนเทสในเบราว์เซอร์ 2026-09-12** — บิลที่ยังเปิดอยู่ **ยังไม่มี `business_date`**
   *    (เซ็ตตอนปิดบิลเท่านั้น) → `gte/lte` ข้างบนคัดทิ้งหมด เพราะ null เทียบไม่ผ่านทั้งสองข้าง
   *    ⇒ ตัวนับบิลเปิดเป็น **0 เสมอ** และแถบเตือน "ยังไม่นับเป็นยอดขาย" ไม่เคยขึ้นเลย
   *    ซึ่งเป็นแถบที่ใส่ไว้เพื่อกันคนสงสัยว่ายอดหายไปไหนพอดี (ตระกูล D74/D77 —
   *    ของมีครบทุกชั้น ขาดชั้นที่เอามาใช้จริง)
   * ⇒ นับแยกโดย **ไม่กรองวันที่** เพราะบิลเปิดค้างไม่ได้สังกัดวันไหนจนกว่าจะปิด
   */
  const openBills = await supabase
    .from("bar_sale")
    .select("sale_no", { count: "exact", head: true })
    .eq("entity_id", entity)
    .eq("status", "เปิดอยู่");
  if (openBills.error) return { ok: false, error: mapDbError(openBills.error) };

  return okOf({
    sales: sales.data ?? [],
    prevSales,
    lines,
    posts: posts.data ?? [],
    customers: customers.data ?? [],
    openBills: openBills.count ?? 0,
  });
}

/**
 * ลงบัญชียอดขายรายวัน — **จุดเชื่อมเดียวกับระบบเดิม**
 * 🚨 บัญชีรับเงินและหมวดรายรับต้องตั้งไว้ก่อน — ไม่เดาให้
 */
export async function postDayAction(date: string): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("app_settings")
    .select("kind, value")
    .in("kind", ["bar_revenue_account", "bar_income_cat"]);
  const account = rows?.find((r) => r.kind === "bar_revenue_account")?.value as string | undefined;
  const category = rows?.find((r) => r.kind === "bar_income_cat")?.value as string | undefined;
  if (!account) {
    return { ok: false, error: "ยังไม่ได้ตั้งบัญชีที่รายได้บาร์เข้า — ไปตั้งที่แท็บ ตั้งค่าบาร์ ก่อน" };
  }
  return rpc("fn_bar_post_day", {
    p_entity: entity,
    p_date: date,
    p_account: account,
    p_category: category || "รายได้บาร์",
  });
}

export async function unpostDayAction(date: string): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_unpost_day", { p_entity: entity, p_date: date });
}

/**
 * ส่งออกรายชื่อลูกค้าที่ยินยอมให้โรงกลั่นติดต่อ (CSV)
 *
 * 🚨 **เฉพาะแถวที่ `consent_marketing = true`** — เป็น *การส่งมอบที่มองเห็นได้ ไม่ใช่ท่อลับ*
 *    ผู้ใช้กดเอง รู้ตัวว่ากำลังส่งอะไรให้ใคร · ไม่มี query ข้ามกิจการที่ไหนในระบบ
 */
export async function exportConsentedAction(): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bar_customer")
    .select("name, nickname, phone, note, consent_at, last_seen, visits")
    .eq("entity_id", entity)
    .eq("consent_marketing", true)
    .order("name");
  if (error) return { ok: false, error: mapDbError(error) };
  return okOf(data ?? []);
}

/** ประวัติความเคลื่อนไหวสต็อกของวัตถุดิบตัวหนึ่ง */
export async function itemMovesAction(itemId: string): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bar_move")
    .select("id, moved_at, delta, qty_after, reason, ref_no, note")
    .eq("entity_id", entity)
    .eq("item_id", itemId)
    .order("moved_at", { ascending: false })
    .limit(100);
  if (error) return { ok: false, error: mapDbError(error) };
  return okOf(data ?? []);
}

export async function issueReceiptAction(saleNo: string): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_issue_receipt", { p_entity: entity, p_sale_no: saleNo });
}

export async function voidSaleAction(saleNo: string): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_void_sale", { p_entity: entity, p_sale_no: saleNo });
}

/** โหลดข้อมูลใหม่ทั้งก้อน — ใช้หลังบันทึกเพื่อให้สต็อก/บิลบนจอตรงกับ DB */
export async function reloadBarAction() {
  return getBarBootstrap();
}

/**
 * บันทึกค่าตั้งค่าของบาร์
 * 🪤 `app_settings` มี CHECK whitelist และ `app_setting_cap()` คุมสิทธิ์รายคีย์อยู่แล้ว
 *    ที่นี่จึงเขียนตรง ๆ ได้ — RLS เป็นตัวปฏิเสธถ้าไม่มี `bar.config`
 * ★ ค่าที่เป็นลิสต์ (`bar_channels`) ลบทั้งชุดแล้วเขียนใหม่ · ค่าเดี่ยวลบแถวเดิมก่อน insert
 */
export async function saveBarSettingsAction(input: {
  entityId?: string;
  promptPayType?: string;
  promptPayId?: string;
  channels?: string[];
  dayStart?: string;
  dayEnd?: string;
  roundCash?: boolean;
  blockNegative?: boolean;
  footer?: string;
  revenueAccount?: string;
  incomeCat?: string;
  /** ผังหน้าตาบิล — เก็บเป็น JSON ก้อนเดียว (ดูเหตุผลใน migration 0070) */
  layout?: unknown;
}): Promise<Res> {
  const supabase = await createClient();

  const singles: [string, string | undefined][] = [
    ["bar_entity", input.entityId],
    ["bar_promptpay_type", input.promptPayType],
    ["bar_promptpay_id", input.promptPayId],
    ["bar_day_start", input.dayStart],
    ["bar_day_end", input.dayEnd],
    ["bar_round_cash", input.roundCash === undefined ? undefined : input.roundCash ? "1" : "0"],
    ["bar_block_negative", input.blockNegative === undefined ? undefined : input.blockNegative ? "1" : "0"],
    ["bar_receipt_footer", input.footer],
    ["bar_revenue_account", input.revenueAccount],
    ["bar_income_cat", input.incomeCat],
    ["bar_receipt_layout", input.layout === undefined ? undefined : JSON.stringify(input.layout)],
  ];

  for (const [kind, value] of singles) {
    if (value === undefined) continue;
    const del = await supabase.from("app_settings").delete().eq("kind", kind);
    if (del.error) return { ok: false, error: mapDbError(del.error) };
    if (value !== "") {
      const ins = await supabase.from("app_settings").insert({ kind, value });
      if (ins.error) return { ok: false, error: mapDbError(ins.error) };
    }
  }

  if (input.channels) {
    const del = await supabase.from("app_settings").delete().eq("kind", "bar_channels");
    if (del.error) return { ok: false, error: mapDbError(del.error) };
    const list = input.channels.map((c) => c.trim()).filter(Boolean);
    if (list.length) {
      const ins = await supabase
        .from("app_settings")
        .insert(list.map((value) => ({ kind: "bar_channels", value })));
      if (ins.error) return { ok: false, error: mapDbError(ins.error) };
    }
  }

  revalidatePath("/bar");
  return { ok: true };
}
