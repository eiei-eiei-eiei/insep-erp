"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendLine } from "@/lib/line";
import { mapDbError } from "@/lib/shared/dbError";
import { bangkokDateISO } from "@/lib/shared/datetime";
import { docDateError, shipDateError } from "@/lib/sales/backdate";
import { type OrderAction, type ActionPayload } from "@/lib/sales/orders";
import { revenueAccountFor } from "@/lib/sales/cashAccount";
import { PAY_METHODS } from "@/lib/sales/payments";
import { planError, planRowAmounts, percentToStore, isSent, type PlanRowInput } from "@/lib/sales/installments";
import { getSalesBootstrap, getOrders, getOrderItems, getOrderPayments, getOrderPlan, getPendingWarehouse, getWarehouseStock, getSyncHistory, getOrderState, getSaleMenuFull, getMenuLinkOptions, getCancelPlan, getCreditNotes, getCreditNoteNos, getPartialCreditPlan } from "./data";
import { cancelMode, cnInputError, cnReasonText, cnTotals, partialTotals, CANCEL_AFTER_PARTIAL_TEXT, type CnReason } from "@/lib/sales/creditNote";
import { accountsFor } from "@/lib/accounting/bankAccounts";
import {
  saveQuotationCore,
  withPlan,
  quotationPlanError,
  buildQuotationDbPayload,
  resolveSalesVat,
  nextSalesDocNo,
  loadRevenueConfig,
  applyOrderActionCore,
  posSaleCore,
  type QuotationPayload,
  type PosSalePayload,
} from "@/lib/sales/orderCore";
// ★ ชนิดข้อมูลย้ายไป lib/sales/orderCore (D172) — คอมโพเนนต์เดิม import จากไฟล์นี้ได้เหมือนเดิม
export type { QuotationPayload, PosSalePayload } from "@/lib/sales/orderCore";

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
/** D143 — การรับเงินทีละครั้ง (ใบเสร็จอ่านวิธีชำระของครั้งนั้น) */
export async function getOrderPaymentsAction(quNo: string) {
  return getOrderPayments(quNo);
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

export async function saveQuotationAction(input: QuotationPayload): Promise<SaveResult> {
  const supabase = await db();
  const res = await saveQuotationCore(supabase, input);
  if (!res.ok) return fail(res.error);
  // D146 — แผนงวดบันทึกหลังได้เลข QU · ล้ม = ใบเสนอราคาอยู่แล้วแต่ไม่มีแผน → บอกเหลือง ไม่ใช่เขียว (D79)
  const warning = input.plan?.length ? await savePlanAfter(res.quNo, input.plan) : "";
  await sendLine(supabase, `🛒 ออเดอร์ใหม่\n[${res.quNo}] ${input.customer.name}\n${res.itemCount} รายการ | ยอด ฿${res.grandTotal.toLocaleString("th-TH", { minimumFractionDigits: 0 })}`);
  revalidatePath("/sales");
  return { ok: true, data: { ok: true, qu_no: res.quNo, order_no: res.orderNo, qu_expire: res.quExpire, warning } };
}

export async function updateQuotationAction(quNo: string, input: QuotationPayload): Promise<SaveResult> {
  const supabase = await db();
  const config = await loadRevenueConfig(supabase);
  const vat = await resolveSalesVat(supabase, config.entityId);
  if ('conflict' in vat) return fail(vat.conflict);
  // D146 — งวดที่ออกใบแจ้งหนี้/รับเงินแล้ว = ยอดสุทธิห้ามเปลี่ยน (DB บล็อกซ้ำด้วยสถานะ — 0102)
  const current = await getOrderState(quNo);
  if (current?.installments?.some((i) => i.paid || i.invNo)) {
    return fail("ออเดอร์นี้ออกใบแจ้งหนี้หรือรับเงินงวดไปแล้ว — แก้ใบเสนอราคาไม่ได้ (ปรับงวดได้ที่หน้าจัดการออเดอร์)");
  }
  const { p, items, totals } = buildQuotationDbPayload(withPlan(input), vat.isVat);
  const planErr = quotationPlanError(input, totals.netPayable, vat.isVat);
  if (planErr) return fail(planErr);
  const { data, error } = await supabase.rpc("fn_update_quotation", { p_qu_no: quNo, p, p_items: items });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string; qu_no?: string; warning?: string; fp_before?: string; rev?: number };
  if (!res.ok) return fail(res.error ?? "แก้ไขไม่สำเร็จ");
  // ยอดสุทธิอาจเปลี่ยน → ตั้งแผนใหม่ทั้งชุด (ส่งว่าง = ยกเลิกแผน กลับเป็นจ่ายครั้งเดียว)
  if (input.plan?.length || current?.installments?.length) res.warning = await savePlanAfter(quNo, input.plan ?? []);
  // D168 — ปิดรอบหลังบันทึกแผนงวดแล้ว (แก้แค่เงื่อนไขงวดก็นับเป็นฉบับแก้ไข) · ไม่เปลี่ยนอะไร = ไม่นับ
  //   🚨 ล้ม = ใบถูกแก้แล้วแต่ไม่ได้นับ → เหลือง ไม่ใช่เขียว (D79) ไม่งั้นใบที่พิมพ์ไม่บอกว่าเป็นฉบับแก้ไข
  const rv = await supabase.rpc("fn_quotation_close_revision", { p_qu_no: quNo, p_fp_before: res.fp_before ?? null });
  const rvRes = rv.data as { ok?: boolean; rev?: number; error?: string } | null;
  if (rv.error || !rvRes?.ok) {
    const why = rv.error ? mapDbError(rv.error) : rvRes?.error ?? "";
    res.warning = [res.warning, `บันทึกการแก้ไขแล้ว แต่ไม่ได้นับเป็นฉบับแก้ไข${why ? ` — ${why}` : ""} · ใบที่พิมพ์จะไม่ขึ้นว่าเป็นฉบับแก้ไข`].filter(Boolean).join(" · ");
  } else {
    res.rev = rvRes.rev ?? 0;
  }
  delete res.fp_before;
  await sendLine(supabase, `✏️ แก้ไขออเดอร์\n[${quNo}] ${input.customer.name}\n${items.length} รายการ | ยอด ฿${totals.grandTotal.toLocaleString("th-TH", { minimumFractionDigits: 0 })}`);
  revalidatePath("/sales");
  return { ok: true, data: res };
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
 * D144 — แก้วิธีชำระของการรับเงินที่บันทึกไปแล้ว (หัวหน้าฝ่ายขายขึ้นไป · RPC เช็ค sales.config ซ้ำ)
 *
 * ★ บัญชีปลายทางตัดสินที่นี่ด้วย `revenueAccountFor()` ตัวเดียวกับตอนรับเงิน (D142)
 *   ⇒ เปลี่ยนเงินสด → โอน บิลย้ายจากบัญชีเงินสดกลับบัญชีหลักเอง · ไม่ได้ตั้งบัญชีรับรายได้ = ไม่แตะบัญชี
 * 🚨 ไม่แตะยอด/VAT/เลขเอกสาร/วันที่ — แก้แล้วพิมพ์ใบเดิมซ้ำได้ด้วยเลขเดิม
 */
export async function editPaymentMethodAction(input: {
  quNo: string;
  seq: number;
  method: string;
  chequeDetail: string;
}): Promise<SaveResult> {
  if (!(PAY_METHODS as readonly string[]).includes(input.method)) return fail("วิธีชำระไม่ถูกต้อง");
  if (input.method === "เช็ค" && !input.chequeDetail.trim()) return fail("เปลี่ยนเป็นเช็ค ต้องกรอกรายละเอียดเช็คด้วย");
  const supabase = await db();
  const config = await loadRevenueConfig(supabase);
  const account = config.accountName ? revenueAccountFor(input.method, config) : null;
  const { data, error } = await supabase.rpc("fn_sales_edit_payment", {
    p_qu_no: input.quNo,
    p_seq: input.seq,
    p_method: input.method,
    p_cheque: input.method === "เช็ค" ? input.chequeDetail.trim() : null,
    p_account: account,
  });
  if (error) return fail(mapDbError(error));
  revalidatePath("/sales");
  revalidatePath("/accounting");
  return { ok: true, data };
}

/** บันทึกแผนงวดหลังสร้าง/แก้ใบเสนอราคา — คืนข้อความเตือน (ว่าง = สำเร็จ) */
async function savePlanAfter(quNo: string, plan: PlanRowInput[]): Promise<string> {
  const r = await setOrderPlanAction(quNo, plan);
  return r.ok ? "" : `บันทึกใบเสนอราคาแล้ว แต่แผนงวดไม่ถูกบันทึก — ${r.error} · กดแก้ไขใบเสนอราคาแล้วตั้งงวดใหม่`;
}

// ── D145 — แบ่งชำระหลายงวด ──────────────────────────────────────────────────────

/** แผนงวดของออเดอร์ (ว่าง = จ่ายแบบเดิม) */
export async function getOrderPlanAction(quNo: string) {
  return getOrderPlan(quNo);
}

/**
 * ตั้ง/ปรับแผนงวด — ส่งมาเฉพาะงวดที่ยังไม่ล็อก (รับแล้ว/ออกใบแจ้งหนี้แล้วคงไว้ตามเดิม)
 * ★ ยอดเป็นบาทคิดที่นี่ด้วย `planRowAmounts()` (งวดสุดท้ายรับเศษ · งวดที่กรอกเป็นเงินใช้ยอดนั้น D164) · RPC ตรวจผลรวมซ้ำ
 * ★ ส่งว่างตอนยังไม่มีงวดล็อก = ยกเลิกแผน (กลับเป็นจ่ายครั้งเดียว)
 */
export async function setOrderPlanAction(quNo: string, rows: PlanRowInput[]): Promise<SaveResult> {
  const supabase = await db();
  const order = await getOrderState(quNo);
  if (!order) return fail("ไม่พบออเดอร์นี้ในระบบ");
  const { data: so, error: soErr } = await supabase
    .from("sales_orders").select("net_payable, grand_total, vat_amount, wht_percent").eq("qu_no", quNo).maybeSingle();
  if (soErr) return fail(mapDbError(soErr));
  const net = Number(so?.net_payable) || Number(so?.grand_total) || 0;
  // D164 — งวดที่กรอกเป็นเงินเก็บยอดก่อน VAT → แปลงเป็นยอดชำระด้วย VAT/หัก ณ ที่จ่ายของออเดอร์นี้
  const ctx = { isVat: Number(so?.vat_amount) > 0, whtPct: Number(so?.wht_percent) || 0 };
  const plan = order.installments ?? [];
  const lockedUnpaid = plan.filter((i) => !i.paid && i.invNo).reduce((s, i) => s + i.amount, 0);
  const locked = plan.some((i) => i.paid || i.invNo);
  const remain = Math.round((order.outstandingBalance - lockedUnpaid) * 100) / 100;

  let payload: Record<string, unknown>[] = [];
  if (rows.length || locked) {
    const err = planError(rows, net, remain, isSent(order.status), ctx);
    if (err) return fail(err);
    // D164 — งวดที่กรอกเป็นเงินคิดยอดจากยอดก่อน VAT ที่ตรึงไว้ (ไม่คิดกลับจาก %) · % เก็บไว้แสดง
    const amounts = planRowAmounts(net, rows, remain, ctx);
    payload = rows.map((r, i) => ({
      label: r.label.trim(), percent: percentToStore(r, net, ctx), amount: amounts[i],
      due_date: r.dueDate || null, ship_point: r.shipPoint,
    }));
  }
  const { data, error } = await supabase.rpc("fn_sales_set_plan", { p_qu_no: quNo, p_rows: payload });
  if (error) return fail(mapDbError(error));
  revalidatePath("/sales");
  return { ok: true, data };
}

/**
 * ใบแจ้งหนี้ของงวดถัดไป (ยังไม่ลงบัญชี — เหมือนใบแจ้งหนี้มัดจำ D45) · เลขชุดใบแจ้งหนี้ของวันที่บนเอกสาร
 */
export async function issueInstallmentInvoiceAction(input: {
  quNo: string; seq: number; docDate?: string; dueDate?: string;
}): Promise<SaveResult> {
  const dateErr = docDateError(input.docDate);
  if (dateErr) return fail(dateErr);
  const docDate = input.docDate || bangkokDateISO();
  const supabase = await db();
  let invNo: string;
  try {
    invNo = await nextSalesDocNo(supabase, "sales_inv", docDate);
  } catch (e) {
    return fail((e as Error).message);
  }
  const { data, error } = await supabase.rpc("fn_sales_installment_invoice", {
    p_qu_no: input.quNo, p_seq: input.seq, p_inv_no: invNo,
    p_inv_date: docDate, p_due_date: input.dueDate || null,
  });
  if (error) return fail(mapDbError(error));
  revalidatePath("/sales");
  return { ok: true, data };
}

/** ยกเลิกใบแจ้งหนี้ของงวดที่ยังไม่รับเงิน (เพื่อปรับยอดงวด) — หัวหน้าฝ่ายขายขึ้นไป */
export async function voidInstallmentInvoiceAction(quNo: string, seq: number): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_sales_void_installment_invoice", { p_qu_no: quNo, p_seq: seq });
  if (error) return fail(mapDbError(error));
  revalidatePath("/sales");
  return { ok: true, data };
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
/**
 * @param shipDate วันที่ของออกจริง (D100 เฟส 3) — ลงฟอร์ม ภส. · ไม่ส่ง = วันนี้ตามเวลาไทย
 *   🚨 ห้ามล่วงหน้า (ตรวจ 2 ชั้น: ที่นี่ + ใน RPC)
 */
export async function confirmFulfillmentAction(quNo: string, userName: string, shipDate?: string): Promise<SaveResult> {
  const supabase = await db();
  const dErr = shipDateError(shipDate, bangkokDateISO());
  if (dErr) return fail(dErr);
  const { data, error } = await supabase.rpc("fn_confirm_fulfillment", {
    p_qu_no: quNo,
    p_user: userName,
    p_date: shipDate || null,
  });
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
 * ขายหน้าร้าน (D86) — แกนอยู่ที่ `posSaleCore` ใน lib/sales/orderCore (D172 · ใช้ร่วมกับ Claude connector)
 * ★ ที่นี่เหลือแค่สิ่งที่เป็นของหน้าเว็บ: ชื่อผู้ใช้จาก session · revalidate · LINE (ข้อความเดียวต่อบิล)
 */
export async function posSaleAction(input: PosSalePayload): Promise<SaveResult> {
  const supabase = await db();
  const res = await posSaleCore(supabase, input, await currentUserName(supabase));
  if (!res.ok) return fail(res.error);
  revalidatePath("/sales");
  revalidatePath("/accounting");
  await sendLine(supabase, res.lineMsg);
  return { ok: true, data: res.data };
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

// ── D159 — ใบลดหนี้ตอนยกเลิกออเดอร์ ─────────────────────────────────────────────
/** ข้อมูลประกอบกล่องยกเลิก: ยกเลิกแบบไหน + ยอดบนใบลดหนี้ + บัญชีที่ใช้คืนเงินได้ */
export async function getCancelPlanAction(quNo: string) {
  const [plan, cns] = await Promise.all([getCancelPlan(quNo), getCreditNotes(quNo)]);
  const today = bangkokDateISO();
  const vatBills = plan.bills.filter((b) => b.vat > 0);
  return {
    mode: cancelMode(plan.bills, today.slice(0, 7), new Set(plan.filedVatMonths)),
    bills: vatBills,
    totals: cnTotals(vatBills),
    today,
    accounts: accountsFor(plan.accounts, plan.entityId).map((a) => a.account_name),
    /** D160 — มีใบลดหนี้บางส่วนแล้ว = ยกเลิกทั้งออเดอร์ไม่ได้ (RPC บังคับซ้ำ) */
    partialBlocked: cns.some((c) => c.kind !== "cancel") ? CANCEL_AFTER_PARTIAL_TEXT : null,
  };
}
export async function getCreditNotesAction(quNo: string) {
  return getCreditNotes(quNo);
}

// ── D160 — ใบลดหนี้บางส่วน (คืนบางรายการ / ลดราคา) ────────────────────────────────
export async function getPartialCreditPlanAction(quNo: string) {
  const plan = await getPartialCreditPlan(quNo);
  return {
    status: plan.status,
    bills: plan.bills.filter((b) => b.vat > 0),
    items: plan.items,
    prior: plan.prior,
    grandTotal: plan.grandTotal,
    whtPercent: plan.whtPercent,
    today: bangkokDateISO(),
    accounts: accountsFor(plan.accounts, plan.entityId).map((a) => a.account_name),
  };
}

/**
 * ออกใบลดหนี้บางส่วน — ยอดคิดที่ partialTotals() (lib) ตัวเดียวกับที่จอแสดง แล้วส่งให้ RPC ตรวจขอบเขต
 * 🚨 ห้ามรับยอดจาก client ตรง ๆ — คิดใหม่ที่ server จากข้อมูลใน DB เสมอ
 */
export async function issueCreditNoteAction(
  quNo: string,
  input: { mode: "return"; qtys: Record<number, number>; restock: boolean } | { mode: "discount"; gross: number },
  meta: { reason: string; detail: string; date: string; refundAccount: string },
): Promise<SaveResult> {
  const plan = await getPartialCreditPlan(quNo);
  if (plan.status !== "ปิดการขาย") return fail("ออกใบลดหนี้บางส่วนได้เฉพาะออเดอร์ที่ปิดการขายแล้ว");
  const bad = cnInputError({ ...meta, bills: plan.bills, today: bangkokDateISO() });
  if (bad) return fail(bad);
  const t = partialTotals(input, { bills: plan.bills, prior: plan.prior, items: plan.items, grandTotal: plan.grandTotal, whtPercent: plan.whtPercent });
  if (typeof t === "string") return fail(t);
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_sales_credit_note", {
    p_qu_no: quNo,
    p_cn: {
      kind: input.mode, reason: meta.reason, detail: meta.detail.trim(), date: meta.date,
      refund_account: meta.refundAccount, reason_text: cnReasonText(meta.reason as CnReason, meta.detail),
      restock: input.mode === "return" ? input.restock : false,
      items: t.lines.map((l) => ({ id: l.id, qty: l.qty })),
      pre: t.diff, vat: t.vat, total: t.total, wht: t.wht, refund: t.refund,
    },
  });
  if (error) return fail(mapDbError(error));
  revalidatePath("/sales");
  revalidatePath("/accounting");
  return { ok: true, data };
}
export async function getCreditNoteNosAction() {
  return getCreditNoteNos();
}

// ── ยกเลิกออเดอร์ + ย้อน side effect (role main) ─────────────────────────────
/**
 * `credit` = ออกใบลดหนี้แทนการยกเลิกบิลรายรับเดิม (D159) · ไม่ส่ง = ยกเลิกแบบเดิม
 * 🚨 ใบกำกับอยู่งวดที่ยื่น ภพ.30 แล้ว/เดือนก่อน → RPC ปฏิเสธการยกเลิกแบบเดิมเอง (ยิง API ตรงก็ไม่รอด)
 */
export async function cancelOrderAction(
  quNo: string,
  credit?: { reason: string; detail: string; date: string; refundAccount: string },
): Promise<SaveResult> {
  const supabase = await db();
  let p_credit: Record<string, string> | null = null;
  if (credit) {
    const plan = await getCancelPlan(quNo);
    const bad = cnInputError({ ...credit, bills: plan.bills, today: bangkokDateISO() });
    if (bad) return fail(bad);
    p_credit = {
      reason: credit.reason,
      detail: credit.detail.trim(),
      date: credit.date,
      refund_account: credit.refundAccount,
      // ม.86/10(6) — ข้อความเหตุบนใบประกอบที่ lib ที่เดียว (ห้ามประกอบประโยคใน SQL · D94)
      reason_text: cnReasonText(credit.reason as CnReason, credit.detail),
    };
  }
  const { data, error } = await supabase.rpc("fn_cancel_order", { p_qu_no: quNo, p_credit });
  if (error) return fail(mapDbError(error));
  // D91 — RPC บอกกลับมาด้วยว่าซ่อนคู่ จ่าย/รับ ออกจากฟอร์ม ภส. ให้หรือไม่ และติดเดือนไหนอยู่
  //        (เดือนที่ปิดบัญชีสรรพสามิตไปแล้วต้องไม่ถูกแก้ย้อนหลัง) → หน้าจอเอาไปบอกผู้ใช้ต่อ
  const res = data as {
    ok: boolean; error?: string; reversed_stock?: number;
    excise_hidden?: boolean; excise_locked_months?: string[]; cn_no?: string | null;
  };
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
