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
import {
  unitLockReason, recipeUseCount, slotNamesByItem,
  type ReceiveRow, type AdjustRow, type NewItemRow, type ItemEditRow,
} from "@/lib/bar/stockBatch";
import type { BarMenu, BarRecipeLine, CartLine, HouseSlot, SaleWindow } from "@/lib/bar/types";
import type { SlotDraft } from "@/lib/bar/houseSlot";
import type { GarnishDraft } from "@/lib/bar/quickPick";
import type { ReceiveRecord } from "@/lib/bar/receiveHistory";
import { can } from "@/lib/shared/roles";
import { currentRole } from "@/lib/shared/guard";
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
  /** บรรทัดอ้างขวดตรง (itemId) หรือช่องเหล้าประจำบ้าน (slotId · D127) */
  recipe: BarRecipeLine[];
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
    p_recipe: input.recipe
      .filter((r) => (r.slotId || r.itemId) && r.qty > 0)
      .map((r) => (r.slotId !== undefined ? { slot_id: r.slotId, qty: r.qty } : { item_id: r.itemId, qty: r.qty })),
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
  const [cur, rec, recSlot, slotRows] = await Promise.all([
    supabase.from("bar_item").select("item_id, name, unit, qty").eq("entity_id", entity),
    supabase.from("bar_recipe").select("menu_id, item_id").eq("entity_id", entity),
    // ★ D127: ขวดที่ใช้ผ่านช่องเหล้าประจำบ้านก็ต้องนับ ไม่งั้นเปลี่ยนหน่วยได้แล้วทุกเมนูที่อ้างช่องตัดผิดหน่วย
    supabase.from("bar_recipe_slot").select("menu_id, slot_id").eq("entity_id", entity),
    supabase.from("bar_house_slot").select("slot_id, name, item_id, sort").eq("entity_id", entity),
  ]);
  // 🚨 อ่านไม่ได้ ≠ ไม่มีอะไรขวาง (D89)
  for (const r of [cur, rec, recSlot, slotRows]) if (r.error) return { ok: false, error: mapDbError(r.error) };

  const byId = new Map((cur.data ?? []).map((r) => [r.item_id as string, r]));
  const recipeOf = new Map<string, BarRecipeLine[]>();
  const push = (k: string, l: BarRecipeLine) => recipeOf.set(k, [...(recipeOf.get(k) ?? []), l]);
  for (const r of rec.data ?? []) push(r.menu_id as string, { itemId: r.item_id as string, qty: 1 });
  for (const r of recSlot.data ?? []) push(r.menu_id as string, { slotId: r.slot_id as string, qty: 1 });
  const menus = [...recipeOf.values()].map((recipe) => ({ recipe }) as BarMenu);
  const slots: HouseSlot[] = (slotRows.data ?? []).map((x) => ({
    slotId: x.slot_id as string, name: x.name as string, itemId: x.item_id as string, sort: Number(x.sort),
  }));
  const used = recipeUseCount(menus, slots);
  const via = slotNamesByItem(menus, slots);

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
      const lock = unitLockReason({ qty: Number(prev.qty), unit: prev.unit as string }, used.get(r.itemId) ?? 0, via.get(r.itemId));
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

  // D129 — ทุนที่ใช้ในห้องทดลอง (แยกบรรทัด · ไม่หักจากกำไรขั้นต้นของการขาย)
  const [labUses, labCats] = await Promise.all([
    supabase.from("bar_lab_use").select("use_id, business_date, category_id, cost_total")
      .eq("entity_id", entity).gte("business_date", input.from).lte("business_date", input.to),
    supabase.from("bar_lab_category").select("category_id, name, sort, is_system").eq("entity_id", entity),
  ]);
  if (labUses.error) return { ok: false, error: mapDbError(labUses.error) };
  if (labCats.error) return { ok: false, error: mapDbError(labCats.error) };

  return okOf({
    labUses: labUses.data ?? [],
    labCats: labCats.data ?? [],
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

/**
 * ประวัติราคารับของของวัตถุดิบตัวหนึ่ง (D126) — อ่าน `bar_receive` ที่เก็บมาตั้งแต่ 0064
 * 🚨 **เฉพาะคนที่เห็นต้นทุน (`bar.config`)** — ตรวจที่นี่ ไม่ใช่ซ่อนปุ่มอย่างเดียว
 *    หลักเดียวกับ `stripCost()` ใน data.ts: พนักงานบาร์ต้องไม่ได้รับตัวเลขราคาตั้งแต่ชั้นข้อมูล
 */
export async function itemReceivesAction(itemId: string): Promise<Res> {
  if (!can(await currentRole(), "bar.config")) return { ok: false, error: "ไม่มีสิทธิ์ดูราคาต้นทุน" };
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bar_receive")
    .select("id, doc_date, qty_pack, qty, cost_total, source, note")
    .eq("entity_id", entity)
    .eq("item_id", itemId)
    .order("doc_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);
  if (error) return { ok: false, error: mapDbError(error) };
  const rows: ReceiveRecord[] = (data ?? []).map((r) => ({
    id: Number(r.id),
    docDate: String(r.doc_date),
    qtyPack: r.qty_pack === null ? null : Number(r.qty_pack),
    qty: Number(r.qty),
    costTotal: Number(r.cost_total),
    source: r.source ?? null,
    note: r.note ?? null,
  }));
  return okOf(rows);
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
  cashAccount?: string;
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
    ["bar_cash_account", input.cashAccount],
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

// ── D127: เหล้าประจำบ้าน · ชุดตกแต่ง · วัตถุดิบใช้บ่อย (การ์ดในแท็บตั้งค่าบาร์) ──────────────
// ★ ด่านจริงอยู่ใน RPC (ทั้งชุดเป็น transaction เดียว · ตรวจชื่อซ้ำ/ขวดหาย/ลบช่องที่มีสูตรอ้าง/หน่วยไม่ตรง)
//   หน้าจอตรวจด้วยฟังก์ชันใน lib/bar ก่อนกด (golden B23/B24) — ที่นี่แค่ส่งต่อ

/** บันทึกช่องเหล้าประจำบ้านทั้งชุด (ลำดับ = ลำดับในลิสต์) */
export async function saveHouseSlotsAction(rows: SlotDraft[]): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_save_house_slots", {
    p_entity: entity,
    p_slots: rows.map((r) => ({ slot_id: r.slotId || null, name: r.name.trim(), item_id: r.itemId || null })),
  });
}

/** บันทึกชุดตกแต่งทั้งชุด (ลำดับ = ลำดับในลิสต์) */
export async function saveGarnishesAction(rows: GarnishDraft[]): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_save_garnishes", {
    p_entity: entity,
    p_rows: rows.map((r) => ({
      garnish_id: r.garnishId || null,
      name: r.name.trim(),
      item_id: r.itemId || null,
      qty: r.qty === "" ? null : r.qty,
    })),
  });
}

/** วัตถุดิบใช้บ่อย — ลำดับ item_id ทั้งชุด · ตัวที่ไม่อยู่ในลำดับ = ถอดหมุด */
export async function savePinsAction(itemIds: string[]): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_save_pins", { p_entity: entity, p_items: itemIds });
}

// ── D129: ห้องทดลอง (ลองชงสูตรใหม่ · ใช้ทำคอนเทนต์) ──────────────────────────────
// ★ การเขียนทุกอย่างผ่าน RPC definer ใน 0091 (ตารางไม่มี policy เขียน) — ที่นี่แค่ส่งต่อ
// 🚨 ตัวเลขทุนส่งให้เฉพาะคนที่มี bar.config — พนักงานบาร์ได้ 0 ตั้งแต่ชั้นนี้ (ไม่ใช่ซ่อนด้วย CSS · D96)

/** ข้อมูลห้องทดลองทั้งหมดของกิจการบาร์ (หมวด · การ์ดสูตร · รายการพร้อมบรรทัด) */
export async function labDataAction(): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  const supabase = await createClient();
  const canSeeCost = can(await currentRole(), "bar.config");
  const { data: auth } = await supabase.auth.getUser();
  try {
    const [cats, recipes, uses, lines] = await Promise.all([
      supabase.from("bar_lab_category").select("category_id, name, sort, is_system").eq("entity_id", entity)
        .order("sort").order("category_id"),
      supabase.from("bar_lab_recipe").select("recipe_id, name, status, menu_id, created_at").eq("entity_id", entity),
      fetchAllRows<Record<string, unknown>>(
        async (from, to) => {
          const { data, error, count } = await supabase
            .from("bar_lab_use")
            .select("use_id, used_at, business_date, category_id, recipe_id, round_no, glasses, event_name, note, cost_total, created_by",
              { count: from === 0 ? "exact" : undefined })
            .eq("entity_id", entity)
            .order("use_id")
            .range(from, to);
          return { data, error, count };
        },
        { label: "รายการห้องทดลอง" },
      ),
      fetchAllRows<Record<string, unknown>>(
        async (from, to) => {
          const { data, error, count } = await supabase
            .from("bar_lab_use_line")
            .select("use_id, line_no, kind, item_id, slot_id, menu_id, lab_recipe_id, label, unit, qty, cost",
              { count: from === 0 ? "exact" : undefined })
            .eq("entity_id", entity)
            .order("use_id")
            .order("line_no")
            .range(from, to);
          return { data, error, count };
        },
        { label: "บรรทัดห้องทดลอง" },
      ),
    ]);
    // 🚨 อ่านไม่ได้ ≠ ไม่มีข้อมูล (D89)
    if (cats.error) return { ok: false, error: mapDbError(cats.error) };
    if (recipes.error) return { ok: false, error: mapDbError(recipes.error) };
    const cost = (v: unknown) => (canSeeCost ? Number(v) || 0 : 0);
    const byUse = new Map<string, unknown[]>();
    for (const l of lines) {
      const k = l.use_id as string;
      const list = byUse.get(k) ?? [];
      list.push({
        lineNo: Number(l.line_no),
        kind: l.kind,
        itemId: (l.item_id as string) ?? null,
        slotId: (l.slot_id as string) ?? null,
        menuId: (l.menu_id as string) ?? null,
        labRecipeId: (l.lab_recipe_id as string) ?? null,
        label: l.label,
        unit: (l.unit as string) ?? null,
        qty: Number(l.qty),
        cost: cost(l.cost),
      });
      byUse.set(k, list);
    }
    return okOf({
      me: auth.user?.id ?? null,
      canSeeCost,
      categories: (cats.data ?? []).map((c) => ({
        categoryId: c.category_id, name: c.name, sort: Number(c.sort), isSystem: Boolean(c.is_system),
      })),
      recipes: (recipes.data ?? []).map((r) => ({
        recipeId: r.recipe_id, name: r.name, status: r.status, menuId: r.menu_id ?? null, createdAt: r.created_at,
      })),
      uses: uses.map((u) => ({
        useId: u.use_id,
        usedAt: u.used_at,
        businessDate: u.business_date,
        categoryId: u.category_id,
        recipeId: u.recipe_id ?? null,
        roundNo: u.round_no == null ? null : Number(u.round_no),
        glasses: u.glasses == null ? null : Number(u.glasses),
        eventName: u.event_name ?? null,
        note: u.note ?? null,
        costTotal: cost(u.cost_total),
        createdBy: u.created_by ?? null,
        lines: byUse.get(u.use_id as string) ?? [],
      })),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "อ่านข้อมูลห้องทดลองไม่สำเร็จ" };
  }
}

/** บรรทัดสูตร (ขวดตรง/ช่อง House) → รูปที่ RPC รับ */
const recipeArg = (recipe: BarRecipeLine[]) =>
  recipe
    .filter((r) => (r.slotId || r.itemId) && r.qty > 0)
    .map((r) => (r.slotId !== undefined ? { slot_id: r.slotId, qty: r.qty } : { item_id: r.itemId, qty: r.qty }));

/** ลองชง 1 รอบ — recipeId ว่าง = สูตรใหม่ */
export async function labRoundAction(input: {
  recipeId: string | null;
  name: string;
  glasses: number;
  recipe: BarRecipeLine[];
  note?: string | null;
  /** รอบขายของร้าน — วันขายคิดฝั่ง TS (golden B6) แบบเดียวกับตอนปิดบิล */
  window?: SaleWindow | null;
}): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_lab_round", {
    p_entity: entity,
    p_recipe_id: input.recipeId || null,
    p_name: input.name.trim(),
    p_glasses: input.glasses,
    p_lines: recipeArg(input.recipe),
    p_note: input.note?.trim() || null,
    p_business_date: businessDate(new Date(), input.window ?? null),
  });
}

/** ใช้เมนูที่มี / สูตรทดลอง / วัตถุดิบเดี่ยว (คอนเทนต์ และหมวดอื่น ๆ) */
export async function labUseAction(input: {
  categoryId: string;
  eventName?: string | null;
  note?: string | null;
  menus: { menuId: string; qty: number }[];
  recipes: { recipeId: string; qty: number }[];
  items: { itemId: string; qty: number }[];
  window?: SaleWindow | null;
}): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_lab_use", {
    p_entity: entity,
    p_category_id: input.categoryId,
    p_event: input.eventName?.trim() || null,
    p_note: input.note?.trim() || null,
    p_menus: input.menus.map((m) => ({ menu_id: m.menuId, qty: m.qty })),
    p_recipes: input.recipes.map((r) => ({ recipe_id: r.recipeId, qty: r.qty })),
    p_items: input.items.map((i) => ({ item_id: i.itemId, qty: i.qty })),
    p_business_date: businessDate(new Date(), input.window ?? null),
  });
}

export async function labDeleteUseAction(useId: string): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_lab_delete_use", { p_entity: entity, p_use_id: useId });
}

export async function labUpdateUseAction(input: { useId: string; note: string; eventName?: string | null }): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_lab_update_use", {
    p_entity: entity, p_use_id: input.useId, p_note: input.note, p_event: input.eventName ?? null,
  });
}

export async function labUpdateRecipeAction(input: { recipeId: string; name: string; status: string }): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_lab_update_recipe", {
    p_entity: entity, p_recipe_id: input.recipeId, p_name: input.name, p_status: input.status,
  });
}

/** ส่งขึ้นเมนูขาย — ข้อมูลชุดเดียวกับ saveMenuAction แล้วผูกการ์ดสูตร (transaction เดียวใน SQL) */
export async function labPromoteAction(recipeId: string, input: Parameters<typeof saveMenuAction>[0]): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  if (!input.name.trim()) return { ok: false, error: "ตั้งชื่อเมนูก่อน" };
  return rpc("fn_bar_lab_promote", {
    p_entity: entity,
    p_recipe_id: recipeId,
    p_menu: {
      menu_id: null,
      name: input.name.trim(),
      price: input.price,
      category_id: input.categoryId || null,
      fixed_cost: input.fixedCost ?? null,
      method: input.method?.trim() || null,
      glass: input.glass?.trim() || null,
      note: input.note?.trim() || null,
      created_for: input.createdFor || null,
    },
    p_recipe: recipeArg(input.recipe),
  });
}

export async function labAddCategoryAction(name: string): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_lab_add_category", { p_entity: entity, p_name: name });
}

export async function labSaveCategoriesAction(rows: { categoryId: string; name: string }[]): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_lab_save_categories", {
    p_entity: entity,
    p_rows: rows.map((r) => ({ category_id: r.categoryId, name: r.name.trim() })),
  });
}

// ── D130: ของทำเองในร้าน (ไซรัป · infused · cordial) ────────────────────────────
// ★ เขียนผ่าน RPC definer ใน 0092 (ไม่มี policy เขียน) · ทุนส่งให้เฉพาะ bar.config (D96)

/** ของทำเองทั้งหมด (สูตรมาตรฐาน) + ล็อตพร้อมบรรทัด + ธง "ล็อตนี้เป็นการเคลื่อนไหวล่าสุด" (ไว้ยกเลิก) */
export async function prepDataAction(): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  const supabase = await createClient();
  const canSeeCost = can(await currentRole(), "bar.config");
  const [preps, inputs, batches, lines] = await Promise.all([
    supabase.from("bar_prep").select("item_id, std_yield, note").eq("entity_id", entity),
    supabase.from("bar_prep_input").select("item_id, input_item_id, line_no, qty").eq("entity_id", entity),
    supabase
      .from("bar_prep_batch")
      .select("batch_id, item_id, status, multiplier, started_at, start_date, finish_date, yield_qty, cost_total, receive_id, note")
      .eq("entity_id", entity),
    supabase.from("bar_prep_batch_line").select("batch_id, line_no, input_item_id, label, unit, qty, cost").eq("entity_id", entity),
  ]);
  // 🚨 อ่านไม่ได้ ≠ ไม่มีข้อมูล (D89)
  for (const r of [preps, inputs, batches, lines]) if (r.error) return { ok: false, error: mapDbError(r.error) };

  // การเคลื่อนไหวล่าสุดของของทำเองแต่ละตัว — ล็อตที่เสร็จแล้วยกเลิกย้อนเป๊ะได้เฉพาะตอนเป็นตัวล่าสุด (ตรงกับ fn_bar_prep_cancel)
  const prepIds = (preps.data ?? []).map((p) => p.item_id as string);
  const lastMove = new Map<string, { reason: string; ref: string | null }>();
  const lasts = await Promise.all(
    prepIds.map((id) =>
      supabase.from("bar_move").select("item_id, reason, ref_no").eq("entity_id", entity).eq("item_id", id)
        .order("id", { ascending: false }).limit(1),
    ),
  );
  for (const r of lasts) {
    if (r.error) return { ok: false, error: mapDbError(r.error) };
    const m = r.data?.[0];
    if (m) lastMove.set(m.item_id as string, { reason: m.reason as string, ref: (m.ref_no as string) ?? null });
  }

  const money = (v: unknown) => (canSeeCost ? Number(v) || 0 : 0);
  const linesOf = new Map<string, unknown[]>();
  for (const l of lines.data ?? []) {
    const list = linesOf.get(l.batch_id as string) ?? [];
    list.push({
      lineNo: Number(l.line_no), inputItemId: l.input_item_id, label: l.label, unit: l.unit ?? null,
      qty: Number(l.qty), cost: money(l.cost),
    });
    linesOf.set(l.batch_id as string, list);
  }
  return okOf({
    canSeeCost,
    preps: (preps.data ?? []).map((p) => ({
      itemId: p.item_id,
      stdYield: Number(p.std_yield),
      note: p.note ?? null,
      inputs: (inputs.data ?? [])
        .filter((i) => i.item_id === p.item_id)
        .map((i) => ({ itemId: i.input_item_id, qty: Number(i.qty), lineNo: Number(i.line_no) })),
    })),
    batches: (batches.data ?? []).map((b) => {
      const last = lastMove.get(b.item_id as string);
      return {
        batchId: b.batch_id,
        itemId: b.item_id,
        status: b.status,
        multiplier: Number(b.multiplier),
        startedAt: b.started_at,
        startDate: b.start_date,
        finishDate: b.finish_date ?? null,
        yieldQty: b.yield_qty == null ? null : Number(b.yield_qty),
        costTotal: money(b.cost_total),
        note: b.note ?? null,
        latest: b.receive_id != null && last?.reason === "รับเข้า" && last.ref === String(b.receive_id),
        lines: linesOf.get(b.batch_id as string) ?? [],
      };
    }),
  });
}

/** ตั้ง/แก้ของทำเอง — itemId ว่าง = สร้างวัตถุดิบใหม่ */
export async function prepSaveAction(input: {
  itemId: string | null;
  name: string;
  unit: string;
  stdYield: number;
  inputs: { itemId: string; qty: number }[];
  note?: string | null;
}): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_prep_save", {
    p_entity: entity,
    p_item_id: input.itemId || null,
    p_name: input.name.trim(),
    p_unit: input.unit.trim(),
    p_std_yield: input.stdYield,
    p_inputs: input.inputs.map((i) => ({ item_id: i.itemId, qty: i.qty })),
    p_note: input.note?.trim() || null,
  });
}

export async function prepDeleteAction(itemId: string): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_prep_delete", { p_entity: entity, p_item_id: itemId });
}

/** ทำล็อต — yieldQty มีค่า = ทำเสร็จแล้วเข้าสต็อกเลย · null = เริ่มแช่ */
export async function prepStartAction(input: {
  itemId: string;
  multiplier: number;
  inputs: { itemId: string; qty: number }[];
  yieldQty: number | null;
  note?: string | null;
  window?: SaleWindow | null;
}): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_prep_start", {
    p_entity: entity,
    p_item_id: input.itemId,
    p_multiplier: input.multiplier,
    p_inputs: input.inputs.map((i) => ({ item_id: i.itemId, qty: i.qty })),
    p_yield: input.yieldQty,
    p_note: input.note?.trim() || null,
    p_business_date: businessDate(new Date(), input.window ?? null),
  });
}

export async function prepFinishAction(input: { batchId: string; yieldQty: number; window?: SaleWindow | null }): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_prep_finish", {
    p_entity: entity,
    p_batch_id: input.batchId,
    p_yield: input.yieldQty,
    p_business_date: businessDate(new Date(), input.window ?? null),
  });
}

export async function prepCancelAction(batchId: string): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_prep_cancel", { p_entity: entity, p_batch_id: batchId });
}
