"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mapDbError } from "@/lib/shared/dbError";
import { barTotals } from "@/lib/bar/totals";
import { businessDate } from "@/lib/bar/businessDate";
import { lineAmount } from "@/lib/bar/totals";
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

/** รับของเข้าบาร์ — ★ ราคาเป็นของล็อตจริง หน้าจอเติมค่าล่าสุดมาให้ กดผ่านได้ */
export async function receiveAction(input: {
  itemId: string;
  qtyPack?: number | null;
  qty: number;
  costTotal: number;
  source?: string | null;
  note?: string | null;
  docDate?: string | null;
}): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_receive", {
    p_entity: entity,
    p_item: input.itemId,
    p_qty: input.qty,
    p_cost_total: input.costTotal,
    p_qty_pack: input.qtyPack ?? null,
    p_date: input.docDate || null,
    p_source: input.source?.trim() || null,
    p_note: input.note?.trim() || null,
  });
}

/** ปรับยอดตามที่นับได้จริง / ของเสีย / ชิม — ทุกครั้งเขียน `bar_move` พร้อมเหตุผล */
export async function adjustAction(input: {
  itemId: string;
  qtyAfter: number;
  reason: string;
  note?: string | null;
}): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  return rpc("fn_bar_adjust", {
    p_entity: entity,
    p_item: input.itemId,
    p_qty_after: input.qtyAfter,
    p_reason: input.reason,
    p_note: input.note?.trim() || null,
  });
}

/**
 * เพิ่ม/แก้วัตถุดิบ — เขียนตรงผ่าน RLS (`bar_item_w` ต้องมี `bar.write`)
 * 🚨 **ไม่แตะ `qty` และ `cost_per_unit`** — สองค่านั้นขยับได้ทางเดียวคือผ่าน
 *    `fn_bar_receive` / `fn_bar_adjust` ซึ่งเขียน `bar_move` คู่กันเสมอ
 *    ให้แก้ตรง ๆ ได้เมื่อไหร่ = สต็อกขยับโดยไม่มีร่องรอย (หลักเดียวกับ D93 ที่ไม่ยอมให้
 *    "แก้ตัวเลขตรง ๆ" บน log_distill)
 */
export async function saveItemAction(input: {
  itemId?: string | null;
  name: string;
  unit: string;
  packSize?: number | null;
  packLabel?: string | null;
  lowQty?: number | null;
  active?: boolean;
}): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  if (!input.name.trim()) return { ok: false, error: "ตั้งชื่อวัตถุดิบก่อน" };
  if (!input.unit.trim()) return { ok: false, error: "ระบุหน่วยที่สูตรใช้ (เช่น ml · ขวด · ชิ้น)" };

  const supabase = await createClient();
  const row = {
    entity_id: entity,
    name: input.name.trim(),
    unit: input.unit.trim(),
    pack_size: input.packSize ?? null,
    pack_label: input.packLabel?.trim() || null,
    low_qty: input.lowQty ?? null,
    active: input.active !== false,
  };

  if (input.itemId) {
    const { error } = await supabase
      .from("bar_item")
      .update(row)
      .eq("entity_id", entity)
      .eq("item_id", input.itemId);
    if (error) return { ok: false, error: mapDbError(error) };
  } else {
    const itemId = `I-${Date.now().toString(36).toUpperCase()}`;
    const { error } = await supabase.from("bar_item").insert({ ...row, item_id: itemId });
    if (error) return { ok: false, error: mapDbError(error) };
  }
  revalidatePath("/bar");
  return { ok: true };
}

/** เพิ่ม/แก้/ลบหมวดเมนู · 🚨 ลบหมวดที่ยังมีเมนูอยู่ต้องล้ม (FK restrict ของ 0064) */
export async function saveCategoryAction(input: {
  categoryId?: string | null;
  name: string;
  sort?: number;
}): Promise<Res> {
  const entity = await barEntity();
  if (!entity) return { ok: false, error: NO_ENTITY };
  if (!input.name.trim()) return { ok: false, error: "ตั้งชื่อหมวดก่อน" };
  const supabase = await createClient();
  if (input.categoryId) {
    const { error } = await supabase
      .from("bar_category")
      .update({ name: input.name.trim(), sort: input.sort ?? 0 })
      .eq("entity_id", entity)
      .eq("category_id", input.categoryId);
    if (error) return { ok: false, error: mapDbError(error) };
  } else {
    const id = `C-${Date.now().toString(36).toUpperCase()}`;
    const { error } = await supabase.from("bar_category").insert({
      entity_id: entity,
      category_id: id,
      name: input.name.trim(),
      sort: input.sort ?? 0,
      is_system: false,
    });
    if (error) return { ok: false, error: mapDbError(error) };
  }
  revalidatePath("/bar");
  return { ok: true };
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
export async function dashboardAction(input: { from: string; to: string }): Promise<Res> {
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
