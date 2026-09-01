"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendLine } from "@/lib/line";
import { mapDbError } from "@/lib/shared/dbError";
import { bangkokDateISO } from "@/lib/shared/datetime";
import { quotationTotals, type CartItem } from "@/lib/sales/calc";
import {
  processOrder,
  neededSerials,
  type OrderAction,
  type ActionPayload,
  type GeneratedSerials,
} from "@/lib/sales/orders";
import { getSalesBootstrap, getOrders, getOrderItems, getPendingWarehouse, getWarehouseStock, getSyncHistory, getOrderState, getCustomerId, getSaleMenuFull, getMenuLinkOptions } from "./data";

export type SaveResult = { ok: boolean; error?: string; data?: unknown };
function fail(error: string): SaveResult {
  return { ok: false, error };
}
async function db() {
  return createClient();
}

// ── read wrappers ────────────────────────────────────────────────────────────
export async function getSalesBootstrapAction() {
  return getSalesBootstrap();
}
export async function getOrdersAction() {
  return getOrders();
}
export async function getOrderItemsAction(quNo: string) {
  return getOrderItems(quNo);
}
export async function getPendingWarehouseAction() {
  return getPendingWarehouse();
}
export async function getWarehouseStockAction() {
  return getWarehouseStock();
}
export async function getSyncHistoryAction() {
  return getSyncHistory();
}
export async function getSaleMenuAction() {
  return getSaleMenuFull();
}
export async function getMenuLinkOptionsAction() {
  return getMenuLinkOptions();
}

// ── จัดการเมนูขาย (sale_menu CRUD) — role main (RLS sale_menu_w = main) ────────
export async function saveSaleMenuAction(input: {
  id?: number;
  menuName: string;
  price: number;
  category: string;
  productId: string;
  multiplier: number;
}): Promise<SaveResult> {
  const supabase = await db();
  const row = {
    menu_name: input.menuName.trim(),
    price: input.price,
    category: input.category || null,
    product_id: input.productId.trim() || null,
    multiplier: input.multiplier || 1,
  };
  const { error } = input.id
    ? await supabase.from("sale_menu").update(row).eq("id", input.id)
    : await supabase.from("sale_menu").insert(row);
  if (error) return fail(mapDbError(error));
  revalidatePath("/sales");
  return { ok: true };
}

export async function deleteSaleMenuAction(id: number): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("sale_menu").delete().eq("id", id);
  if (error) return fail(mapDbError(error));
  revalidatePath("/sales");
  return { ok: true };
}

// ── S8: สร้าง/แก้ ใบเสนอราคา ─────────────────────────────────────────────────
export type QuotationPayload = {
  customer: { id: string; name: string; address?: string; taxId?: string; branch?: string; creditTerm?: number };
  items: CartItem[];
  discount: number;
  isWhtRequired: boolean;
  whtPercent: number;
  isDepositRequired: boolean;
  depositPercent: number;
  saleName: string;
  category: string;
  remarks?: string;
};

function buildQuotationDbPayload(input: QuotationPayload, isVat: boolean) {
  const t = quotationTotals(input, isVat);
  return {
    p: {
      customer_id: input.customer.id,
      customer_name: input.customer.name,
      sale_name: input.saleName,
      sub_total: t.subTotal,
      discount: t.discountEx, // เก็บส่วนลดในรูปก่อน VAT ให้บัญชี (base−discount = subDiscount)
      sub_discount: t.subDiscount,
      vat_amount: t.vatAmount,
      grand_total: t.grandTotal,
      net_payable: t.netPayable,
      wht_percent: input.isWhtRequired ? input.whtPercent : 0,
      wht_amount: t.whtAmount,
      remarks: input.remarks ?? "",
      category: input.category,
      // เงื่อนไขมัดจำ (0021) — เก็บไว้ให้กดแก้ใบเสนอราคาแล้ว prefill กลับมาครบ
      is_deposit: input.isDepositRequired,
      deposit_percent: input.isDepositRequired ? input.depositPercent : 0,
    },
    items: input.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
    totals: t,
  };
}

/**
 * แกนการสร้างใบเสนอราคา — **ไม่ยิง LINE ไม่ revalidate** เพื่อให้ POS (D86) เอาไปใช้ต่อได้
 * โดยไม่ได้ข้อความแจ้งเตือน 3 ข้อความต่อการขาย 1 บิล
 */
async function saveQuotationCore(
  supabase: Awaited<ReturnType<typeof db>>,
  input: QuotationPayload,
): Promise<
  | { ok: true; quNo: string; orderNo: string; quExpire: string; grandTotal: number; itemCount: number }
  | { ok: false; error: string }
> {
  const config = await loadRevenueConfig(supabase);
  const vat = await resolveSalesVat(supabase, config.entityId);
  if ("conflict" in vat) return { ok: false, error: vat.conflict };
  const { p, items, totals } = buildQuotationDbPayload(input, vat.isVat);
  const { data, error } = await supabase.rpc("fn_save_quotation", { p, p_items: items });
  if (error) return { ok: false, error: mapDbError(error) };
  const res = data as { ok: boolean; qu_no: string; order_no: string; qu_expire: string };
  return {
    ok: true,
    quNo: res.qu_no,
    orderNo: res.order_no,
    quExpire: res.qu_expire,
    grandTotal: totals.grandTotal,
    itemCount: items.length,
  };
}

export async function saveQuotationAction(input: QuotationPayload): Promise<SaveResult> {
  const supabase = await db();
  const res = await saveQuotationCore(supabase, input);
  if (!res.ok) return fail(res.error);
  await sendLine(supabase, `🛒 ออเดอร์ใหม่\n[${res.quNo}] ${input.customer.name}\n${res.itemCount} รายการ | ยอด ฿${res.grandTotal.toLocaleString("th-TH", { minimumFractionDigits: 0 })}`);
  revalidatePath("/sales");
  return { ok: true, data: { ok: true, qu_no: res.quNo, order_no: res.orderNo, qu_expire: res.quExpire } };
}

export async function updateQuotationAction(quNo: string, input: QuotationPayload): Promise<SaveResult> {
  const supabase = await db();
  const config = await loadRevenueConfig(supabase);
  const vat = await resolveSalesVat(supabase, config.entityId);
  if ('conflict' in vat) return fail(vat.conflict);
  const { p, items, totals } = buildQuotationDbPayload(input, vat.isVat);
  const { data, error } = await supabase.rpc("fn_update_quotation", { p_qu_no: quNo, p, p_items: items });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string; qu_no?: string };
  if (!res.ok) return fail(res.error ?? "แก้ไขไม่สำเร็จ");
  await sendLine(supabase, `✏️ แก้ไขออเดอร์\n[${quNo}] ${input.customer.name}\n${items.length} รายการ | ยอด ฿${totals.grandTotal.toLocaleString("th-TH", { minimumFractionDigits: 0 })}`);
  revalidatePath("/sales");
  return { ok: true, data: res };
}

/**
 * สถานะ VAT ของกิจการที่ออกเอกสาร — **อ่านจาก DB ฝั่ง server เสมอ** (4.3)
 *
 * 🚨 ห้ามรับค่านี้จาก client เด็ดขาด — หน้าเว็บส่ง `isVat: true` มาเองได้
 *    = ผู้ไม่จด VAT ออกใบกำกับภาษี (ผิด ประมวลรัษฎากร ม.86/13)
 *    (ด่านสุดท้ายคือ trigger ใน 0036 แต่ไม่ควรปล่อยให้ไปตายที่นั่น — error จะอ่านไม่รู้เรื่อง)
 *
 * คืน `null` เมื่อกิจการที่ออกเอกสารกับกิจการที่รับรายได้ **มีสถานะ VAT ต่างกัน** →
 * ผู้เรียกต้องปฏิเสธ ไม่ใช่เดาข้างใดข้างหนึ่ง (จะได้ใบเสนอราคาคิด VAT แต่ลงบัญชีไม่มี VAT)
 */
async function resolveSalesVat(
  supabase: Awaited<ReturnType<typeof db>>,
  revenueEntityId: string,
): Promise<{ isVat: boolean } | { conflict: string }> {
  const [{ data: st }, { data: ents }] = await Promise.all([
    supabase.from("app_settings").select("kind, value").in("kind", ["sales_doc_entity", "sales_revenue_entity"]),
    supabase.from("entities").select("entity_id, is_vat"),
  ]);
  const rows = ents ?? [];
  const vatOf = (id: string) => rows.find((e) => e.entity_id === id)?.is_vat;

  const docId =
    (st ?? []).find((r) => r.kind === "sales_doc_entity")?.value ||
    (st ?? []).find((r) => r.kind === "sales_revenue_entity")?.value ||
    revenueEntityId;

  const docVat = vatOf(docId);
  // ไม่พบกิจการ = ถือว่าจด VAT (พฤติกรรมเดิม) — อย่าบล็อกคนที่ยังไม่ได้ตั้งค่าให้ครบ
  const isVat = docVat !== false;

  if (revenueEntityId && revenueEntityId !== docId) {
    const revVat = vatOf(revenueEntityId);
    if (revVat !== undefined && revVat !== docVat) {
      return {
        conflict:
          `กิจการที่ออกเอกสาร (${docId}) กับกิจการที่รับรายได้ (${revenueEntityId}) ` +
          `มีสถานะ VAT ต่างกัน — ระบบไม่เดาให้ว่าจะคิด VAT หรือไม่ ` +
          `เพราะจะได้เอกสารกับบัญชีที่ตัวเลขไม่ตรงกัน · ไปแก้ที่ บัญชี → ตั้งค่า ให้ตรงกันก่อน`,
      };
    }
  }
  return { isVat };
}

/** config รายรับขาย (บัญชี + กิจการ) จาก app_settings — go-live ต้องตั้งค่า */
async function loadRevenueConfig(supabase: Awaited<ReturnType<typeof db>>) {
  const { data } = await supabase.from("app_settings").select("kind, value").in("kind", ["sales_revenue_account", "sales_revenue_entity"]);
  const get = (k: string) => (data ?? []).find((r) => r.kind === k)?.value as string | undefined;
  return { accountName: get("sales_revenue_account") ?? "", entityId: get("sales_revenue_entity") ?? "" };
}

// ── S2: ประมวลผล action ออเดอร์ (atomic + idempotent + LINE) ──────────────────
/**
 * แกนของ S2 — **แหล่งเดียว** ที่อ่าน config · ตรวจ VAT · ขอเลขเอกสาร · เรียก processOrder
 * แล้วยิง `fn_apply_order_action`
 *
 * 🚨 คืน `lineMsg` กลับไปให้ผู้เรียกตัดสินใจส่งเอง **ไม่ส่งในนี้** —
 *    หน้าขายหน้าร้าน (D86) ทำ 3 จังหวะรวด ถ้าแต่ละจังหวะยิง LINE เอง
 *    ลูกค้าจะได้ 3 ข้อความต่อการขาย 1 บิล
 */
async function applyOrderActionCore(
  supabase: Awaited<ReturnType<typeof db>>,
  quNo: string,
  action: OrderAction,
  payload: ActionPayload,
): Promise<
  | { ok: true; newStatus: string; duplicate: boolean; lineMsg: string | null; invNo: string; taxNo1: string; taxNo2: string; rcptNo1: string; rcptNo2: string }
  | { ok: false; error: string }
> {
  const order = await getOrderState(quNo);
  if (!order) return { ok: false, error: "ไม่พบออเดอร์นี้ในระบบ" };

  const config = await loadRevenueConfig(supabase);
  // ต้องมีกิจการรับรายได้ก่อน (RECEIVE_REVENUE ลง transactions ต้องมี entity_id ที่มีจริง)
  const needsRevenue = ["DEPOSIT_AND_SEND", "FULL_PAYMENT_AND_SEND", "FULL_PAYMENT_LATER", "PAY_BALANCE"].includes(action);
  if (needsRevenue && !config.entityId) {
    // 🪤 ของเดิมชี้ให้ไปเปิดไฟล์เอกสาร + บอกชื่อ kind ใน DB ทั้งที่ **ไม่มีหน้าจอให้ตั้งเลย**
    //    (D80) — ตอนนี้ตั้งได้จากในแอปแล้ว ข้อความต้องพาไปถึงที่
    return { ok: false, error: "ยังไม่ได้ตั้งกิจการที่รับรายได้จากการขาย — ไปที่ ตั้งค่า → กิจการ → การ์ด “กิจการและบัญชีที่รับรายได้จากการขาย”" };
  }

  // ข้อมูลคู่ค้า (taxId/branch/address) จาก contacts
  const customerId = await getCustomerId(quNo);
  const [{ data: contactRow }, items] = await Promise.all([
    customerId
      ? supabase.from("contacts").select("tax_id, branch, address").eq("contact_id", customerId).maybeSingle()
      : Promise.resolve({ data: null }),
    getOrderItems(quNo),
  ]);
  const contact = {
    taxId: (contactRow?.tax_id as string) ?? "",
    branch: (contactRow?.branch as string) ?? "",
    address: (contactRow?.address as string) ?? "",
    contactId: customerId ?? "", // multi-branch: ลงบัญชีด้วย contact_id ให้ ภพ.30/ภงด. ได้สาขาถูก (D42)
  };

  // generate เลข INV/TAX เฉพาะที่ needed (atomic ผ่าน counters)
  // 4.3 — กิจการไม่จด VAT ไม่มีสิทธิ์ได้เลขใบกำกับภาษี (ด่านสุดท้ายคือ trigger ใน 0036)
  const vat = await resolveSalesVat(supabase, config.entityId);
  if ('conflict' in vat) return { ok: false, error: vat.conflict };
  const need = neededSerials(action, order, vat.isVat);
  const gen: GeneratedSerials = {};
  if (need.inv) {
    const { data } = await supabase.rpc("fn_next_sales_doc", { p_prefix: "INV" });
    gen.invNo = data as string;
  }
  if (need.tax1) {
    const { data } = await supabase.rpc("fn_next_sales_doc", { p_prefix: "TAX" });
    gen.taxNo1 = data as string;
  }
  if (need.tax2) {
    const { data } = await supabase.rpc("fn_next_sales_doc", { p_prefix: "TAX" });
    gen.taxNo2 = data as string;
  }
  // D89 — กิจการไม่จด VAT: ใบเสร็จได้เลข **ชุด INV** (ออกเลขชุด TAX ไม่ได้ตาม ม.86/13)
  if (need.rcpt1) {
    const { data } = await supabase.rpc("fn_next_sales_doc", { p_prefix: "INV" });
    gen.rcptNo1 = data as string;
  }
  if (need.rcpt2) {
    const { data } = await supabase.rpc("fn_next_sales_doc", { p_prefix: "INV" });
    gen.rcptNo2 = data as string;
  }

  // ★ ส่ง isVat ที่อ่านจาก DB ฝั่ง server เข้าไปกับ config — payload บัญชีจะได้ vat = 0
  //   และฐานคิดจาก (1 − wht) เมื่อกิจการไม่จด VAT
  const result = processOrder(order, action, payload, items, gen, contact, { ...config, isVat: vat.isVat });

  const { data, error } = await supabase.rpc("fn_apply_order_action", {
    p_qu_no: quNo,
    p_update: result.update,
    p_revenue: result.revenue,
  });
  if (error) return { ok: false, error: mapDbError(error) };
  const res = data as { ok: boolean; duplicate: boolean; tx_id?: string };

  return {
    ok: true,
    newStatus: result.newStatus,
    duplicate: res.duplicate,
    // ไม่ส่งซ้ำถ้าเป็น duplicate (เคยลงบัญชีไปแล้ว)
    lineMsg: res.duplicate ? null : result.lineMsg,
    // เลขที่เพิ่ง generate ถ้ามี ไม่งั้นใช้ของเดิมในใบ — ผู้เรียกเอาไปพิมพ์เอกสารต่อได้ทันที
    invNo: result.update.invNo || order.invNo || "",
    taxNo1: result.update.taxNo1 || order.taxNo1 || "",
    taxNo2: result.update.taxNo2 || order.taxNo2 || "",
    rcptNo1: result.update.rcptNo1 || order.rcptNo1 || "",
    rcptNo2: result.update.rcptNo2 || order.rcptNo2 || "",
  };
}

export async function processOrderActionAction(quNo: string, action: OrderAction, payload: ActionPayload): Promise<SaveResult> {
  const supabase = await db();
  const res = await applyOrderActionCore(supabase, quNo, action, payload);
  if (!res.ok) return fail(res.error);

  // LINE หลัง commit (silent fail)
  if (res.lineMsg) await sendLine(supabase, res.lineMsg);

  revalidatePath("/sales");
  revalidatePath("/accounting");
  return { ok: true, data: { newStatus: res.newStatus, duplicate: res.duplicate, warning: res.duplicate ? "รายการนี้ลงบัญชีไปแล้ว (ข้ามการบันทึกซ้ำ)" : "" } };
}

/**
 * D45 — ยกเลิกใบแจ้งหนี้ค่ามัดจำ → กลับสถานะ 'รอคอนเฟิร์ม' (แก้ใบเสนอราคาต่อได้)
 * ปลอดภัย: สถานะ 'รอชำระมัดจำ' ยังไม่มีรายการบัญชี/สต็อกเกิดขึ้น · role main เท่านั้น
 */
export async function voidDepositInvoiceAction(quNo: string): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_void_deposit_invoice", { p_qu_no: quNo });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string; dep_inv_no?: string };
  if (!res.ok) return fail(res.error ?? "ยกเลิกใบแจ้งหนี้มัดจำไม่สำเร็จ");
  revalidatePath("/sales");
  return { ok: true, data: res };
}

// ── S3: คลังยืนยันจัดส่ง (ตัดสต็อก + SELL_PRODUCT + LINE) ───────────────────────
export async function confirmFulfillmentAction(quNo: string, userName: string): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_confirm_fulfillment", { p_qu_no: quNo, p_user: userName });
  if (error) return fail(mapDbError(error));
  const res = data as {
    ok: boolean;
    error?: string;
    newStatus?: string;
    duplicate?: boolean;
    warning?: string | null;
    summary?: { name: string; remaining: number }[];
    customerName?: string;
    orderNo?: string;
  };
  if (!res.ok) return fail(res.error ?? "จัดส่งไม่สำเร็จ");

  // LINE 2.3 — แจ้งจัดส่ง + คงเหลือ
  const summary = res.summary ?? [];
  let msg = `📦 ส่งของแล้ว\n[${res.orderNo}] ${res.customerName ?? ""}\n${summary.length} รายการ`;
  if (summary.length > 0) {
    msg += "\n—";
    for (const s of summary) msg += `\n• ${s.name}: คงเหลือ ${Number(s.remaining).toLocaleString("th-TH", { minimumFractionDigits: 0 })}`;
  }
  await sendLine(supabase, msg);

  revalidatePath("/sales");
  return { ok: true, data: res };
}

// ── D86: ขายหน้าร้าน (POS) — สร้าง → รับเงินเต็ม → ตัดสต็อก ในการกดครั้งเดียว ────

export type PosSalePayload = {
  /** ต้องเป็น contact จริงเสมอ — ที่อยู่/เลขภาษีบนใบกำกับอ่านจาก `contacts` ไม่ได้เก็บในออเดอร์ */
  customer: { id: string; name: string };
  items: CartItem[];
  /** ส่วนลดท้ายบิล (บาท รูปรวม VAT) — ช่องเดียวที่หน้าขายหน้าร้านให้กรอก */
  discount: number;
  method: string;
};

/** ชื่อผู้ทำรายการ — ลง `stock_moves.user_name` และ `sales_orders.sale_name` */
async function currentUserName(supabase: Awaited<ReturnType<typeof db>>): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return "";
  const { data: p } = await supabase
    .from("profiles")
    .select("display_name, username")
    .eq("id", u.user.id)
    .maybeSingle();
  return (((p?.display_name as string) || (p?.username as string)) ?? "").trim();
}

/**
 * ขายหน้าร้าน 1 บิล = 3 จังหวะของโฟลว์เดิมต่อกัน
 *   ① `fn_save_quotation`  ② `FULL_PAYMENT_AND_SEND` (ลงบัญชี)  ③ `fn_confirm_fulfillment` (ตัดสต็อก)
 *
 * 🚨 **จงใจไม่เขียน RPC ก้อนเดียว** — จะต้องยกตรรกะเลขเอกสาร/ถอด VAT ไปไว้ใน SQL อีกชุด
 *    = สูตรเงินมี 2 ที่ ซึ่งเป็นกลไกเดียวกับที่ทำให้ D79 พังเงียบมาเป็นปี
 *
 * 🚨 ล้มกลางทาง = "สำเร็จบางส่วน" **ห้ามรายงานว่าสำเร็จ** — คืน `warning` ให้หน้าจอ
 *    ขึ้นสีเหลืองพร้อมบอกว่าออเดอร์ค้างอยู่ใบไหนและต้องไปกดต่อที่แท็บอะไร (บทเรียน D79)
 */
export async function posSaleAction(input: PosSalePayload): Promise<SaveResult> {
  const supabase = await db();
  if (!input.customer?.id) return fail("ยังไม่ได้เลือกลูกค้า");
  if (!input.items.length) return fail("ยังไม่ได้เลือกสินค้า");

  const userName = await currentUserName(supabase);
  const docDate = bangkokDateISO(); // 🪤 server เป็น UTC — ใช้วันตามเวลาไทยเสมอ

  // ① สร้างออเดอร์ (ไม่ยิง LINE — บิลเดียวต้องได้ข้อความเดียว)
  const saved = await saveQuotationCore(supabase, {
    customer: input.customer,
    items: input.items,
    discount: input.discount,
    isWhtRequired: false, // ขาจรไม่หัก ณ ที่จ่าย
    whtPercent: 0,
    isDepositRequired: false, // จ่ายจบหน้าร้าน
    depositPercent: 0,
    saleName: userName,
    category: "รายได้ค่าสินค้า",
    remarks: "ขายหน้าร้าน",
  });
  if (!saved.ok) return fail(saved.error);

  // ② รับเงินเต็มจำนวน + ลงบัญชี (ยอดมาจาก outstanding_balance ของใบที่เพิ่งสร้าง)
  const paid = await applyOrderActionCore(supabase, saved.quNo, "FULL_PAYMENT_AND_SEND", {
    method: input.method,
    docDate,
  });
  if (!paid.ok) {
    return fail(
      `${paid.error}\n\nออเดอร์ ${saved.quNo} ถูกสร้างไว้แล้วแต่ยังไม่ได้รับเงิน — ` +
        `ไปทำต่อที่แท็บ “จัดการออเดอร์” หรือให้หัวหน้ายกเลิกใบนี้`,
    );
  }

  // ③ ตัดสต็อก (คลังทั่วไป + สต็อกสุราที่เข้าฟอร์ม ภส.)
  const { data: fulfilData, error: fulfilErr } = await supabase.rpc("fn_confirm_fulfillment", {
    p_qu_no: saved.quNo,
    p_user: userName || "pos",
  });
  const fulfil = fulfilData as
    | { ok: boolean; error?: string; summary?: { name: string; remaining: number }[] }
    | null;
  const stockErr = fulfilErr ? mapDbError(fulfilErr) : !fulfil?.ok ? (fulfil?.error ?? "ตัดสต็อกไม่สำเร็จ") : "";

  revalidatePath("/sales");
  revalidatePath("/accounting");

  const summary = fulfil?.summary ?? [];
  const amountText = saved.grandTotal.toLocaleString("th-TH", { minimumFractionDigits: 0 });

  // LINE — **ข้อความเดียวต่อบิล** (ไม่ใช่ 3 ข้อความแบบที่ 3 จังหวะยิงกันเอง)
  let msg = `🧾 ขายหน้าร้าน\n[${saved.orderNo}] ${input.customer.name}\n${input.items.length} รายการ | ฿${amountText} (${input.method})`;
  if (stockErr) msg += `\n⚠️ ยังไม่ได้ตัดสต็อก — ${stockErr}`;
  else for (const s of summary) msg += `\n• ${s.name}: คงเหลือ ${Number(s.remaining).toLocaleString("th-TH", { minimumFractionDigits: 0 })}`;
  await sendLine(supabase, msg);

  return {
    ok: true,
    data: {
      quNo: saved.quNo,
      orderNo: saved.orderNo,
      invNo: paid.invNo,
      taxNo1: paid.taxNo1,
      rcptNo1: paid.rcptNo1,
      docDate,
      summary,
      // 🚨 ขายและลงบัญชีสำเร็จแล้วแต่สต็อกยังไม่ขยับ = ต้องขึ้นเหลือง ไม่ใช่เขียว
      warning: stockErr
        ? `บันทึกการขายและลงบัญชีเรียบร้อยแล้ว แต่ยังตัดสต็อกไม่สำเร็จ (${stockErr}) — ` +
          `ไปที่แท็บ “คลังจัดส่ง” แล้วกดยืนยันจัดส่งของออเดอร์ ${saved.orderNo}`
        : "",
    },
  };
}

/** ตั้งลูกค้าปริยายของหน้าขายหน้าร้าน (RLS: `app_setting_cap('pos_walkin_contact') = sales.config`) */
export async function savePosWalkinContactAction(contactId: string): Promise<SaveResult> {
  const supabase = await db();
  const id = contactId.trim();
  if (!id) return fail("ยังไม่ได้เลือกลูกค้า");
  // 🪤 unique เป็น (tenant_id, kind, value) ไม่ใช่ (tenant_id, kind) → upsert ทับไม่ได้
  //    ค่า 1 แถวต่อ kind ทั้งแอปใช้แพตเทิร์น ลบก่อนแล้วค่อย insert (settings/actions.ts:102-103)
  await supabase.from("app_settings").delete().eq("kind", "pos_walkin_contact");
  const { error } = await supabase.from("app_settings").insert({ kind: "pos_walkin_contact", value: id });
  if (error) return fail(mapDbError(error));
  revalidatePath("/sales");
  return { ok: true };
}

// ── ปรับสต็อกทั่วไป manual ────────────────────────────────────────────────────
export async function manualStockMoveAction(
  input: { itemCode: string; actionType: "IN" | "OUT" | "ADJUST"; qty: number; refNo?: string; remarks?: string },
  userName: string,
): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_manual_stock_move", { p: input, p_user: userName });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string; newStock?: number };
  if (!res.ok) return fail(res.error ?? "ปรับสต็อกไม่สำเร็จ");
  revalidatePath("/sales");
  return { ok: true, data: res };
}

// ── ยกเลิกออเดอร์ + ย้อน side effect (role main) ─────────────────────────────
export async function cancelOrderAction(quNo: string): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_cancel_order", { p_qu_no: quNo });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string; reversed_stock?: number };
  if (!res.ok) return fail(res.error ?? "ยกเลิกไม่สำเร็จ");
  revalidatePath("/sales");
  revalidatePath("/accounting");
  return { ok: true, data: res };
}

// ── เพิ่มลูกค้า (contacts + roles ลูกค้า + is_export) ──────────────────────────
export async function saveCustomerAction(input: {
  name: string;
  address: string;
  taxId: string;
  branch: string;
  phone?: string;
  creditTerm?: number;
  isExport?: boolean;
  saleName?: string;
}): Promise<SaveResult> {
  const supabase = await db();
  const { data: seq, error: seqErr } = await supabase.rpc("next_serial", { p_key: "CONTACT" });
  if (seqErr) return fail(mapDbError(seqErr));
  const contactId = "C-" + String(seq).padStart(4, "0");
  const { error } = await supabase.from("contacts").insert({
    contact_id: contactId,
    name: input.name,
    address: input.address,
    tax_id: input.taxId,
    branch: input.branch,
    phone: input.phone ?? null,
    credit_term: input.creditTerm ?? 0,
    is_export: input.isExport ?? false,
    sale_name: input.saleName ?? null,
    contact_type: "ลูกค้า",
    roles: ["ลูกค้า"],
  });
  if (error) return fail(mapDbError(error));
  revalidatePath("/sales");
  return { ok: true, data: { id: contactId } };
}
