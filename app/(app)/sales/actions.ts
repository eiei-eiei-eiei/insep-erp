"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendLine } from "@/lib/line";
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
  if (error) return fail(error.message);
  revalidatePath("/sales");
  return { ok: true };
}

export async function deleteSaleMenuAction(id: number): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("sale_menu").delete().eq("id", id);
  if (error) return fail(error.message);
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

function buildQuotationDbPayload(input: QuotationPayload) {
  const t = quotationTotals(input);
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
    },
    items: input.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
    totals: t,
  };
}

export async function saveQuotationAction(input: QuotationPayload): Promise<SaveResult> {
  const supabase = await db();
  const { p, items, totals } = buildQuotationDbPayload(input);
  const { data, error } = await supabase.rpc("fn_save_quotation", { p, p_items: items });
  if (error) return fail(error.message);
  const res = data as { ok: boolean; qu_no: string; order_no: string; qu_expire: string };
  await sendLine(`🛒 ออเดอร์ใหม่\n[${res.qu_no}] ${input.customer.name}\n${items.length} รายการ | ยอด ฿${totals.grandTotal.toLocaleString("th-TH", { minimumFractionDigits: 0 })}`);
  revalidatePath("/sales");
  return { ok: true, data: res };
}

export async function updateQuotationAction(quNo: string, input: QuotationPayload): Promise<SaveResult> {
  const supabase = await db();
  const { p, items, totals } = buildQuotationDbPayload(input);
  const { data, error } = await supabase.rpc("fn_update_quotation", { p_qu_no: quNo, p, p_items: items });
  if (error) return fail(error.message);
  const res = data as { ok: boolean; error?: string; qu_no?: string };
  if (!res.ok) return fail(res.error ?? "แก้ไขไม่สำเร็จ");
  await sendLine(`✏️ แก้ไขออเดอร์\n[${quNo}] ${input.customer.name}\n${items.length} รายการ | ยอด ฿${totals.grandTotal.toLocaleString("th-TH", { minimumFractionDigits: 0 })}`);
  revalidatePath("/sales");
  return { ok: true, data: res };
}

/** config รายรับขาย (บัญชี + กิจการ) จาก app_settings — go-live ต้องตั้งค่า */
async function loadRevenueConfig(supabase: Awaited<ReturnType<typeof db>>) {
  const { data } = await supabase.from("app_settings").select("kind, value").in("kind", ["sales_revenue_account", "sales_revenue_entity"]);
  const get = (k: string) => (data ?? []).find((r) => r.kind === k)?.value as string | undefined;
  return { accountName: get("sales_revenue_account") ?? "", entityId: get("sales_revenue_entity") ?? "" };
}

// ── S2: ประมวลผล action ออเดอร์ (atomic + idempotent + LINE) ──────────────────
export async function processOrderActionAction(quNo: string, action: OrderAction, payload: ActionPayload): Promise<SaveResult> {
  const supabase = await db();
  const order = await getOrderState(quNo);
  if (!order) return fail("ไม่พบออเดอร์นี้ในระบบ");

  const config = await loadRevenueConfig(supabase);
  // ต้องมีกิจการรับรายได้ก่อน (RECEIVE_REVENUE ลง transactions ต้องมี entity_id ที่มีจริง)
  const needsRevenue = ["DEPOSIT_AND_SEND", "FULL_PAYMENT_AND_SEND", "FULL_PAYMENT_LATER", "PAY_BALANCE"].includes(action);
  if (needsRevenue && !config.entityId) {
    return fail("ยังไม่ได้ตั้งค่ากิจการรับรายได้ขาย (app_settings sales_revenue_entity) — ดู GOLIVE_CHECKLIST Phase 4");
  }

  // ข้อมูลคู่ค้า (taxId/branch/address) จาก contacts
  const customerId = await getCustomerId(quNo);
  const [{ data: contactRow }, items] = await Promise.all([
    customerId
      ? supabase.from("contacts").select("tax_id, branch, address").eq("contact_id", customerId).maybeSingle()
      : Promise.resolve({ data: null }),
    getOrderItems(quNo),
  ]);
  const contact = { taxId: (contactRow?.tax_id as string) ?? "", branch: (contactRow?.branch as string) ?? "", address: (contactRow?.address as string) ?? "" };

  // generate เลข INV/TAX เฉพาะที่ needed (atomic ผ่าน counters)
  const need = neededSerials(action, order);
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

  const result = processOrder(order, action, payload, items, gen, contact, config);

  const { data, error } = await supabase.rpc("fn_apply_order_action", {
    p_qu_no: quNo,
    p_update: result.update,
    p_revenue: result.revenue,
  });
  if (error) return fail(error.message);
  const res = data as { ok: boolean; duplicate: boolean; tx_id?: string };

  // LINE หลัง commit (silent fail) — ไม่ส่งซ้ำถ้าเป็น duplicate
  if (result.lineMsg && !res.duplicate) await sendLine(result.lineMsg);

  revalidatePath("/sales");
  revalidatePath("/accounting");
  return { ok: true, data: { newStatus: result.newStatus, duplicate: res.duplicate, warning: res.duplicate ? "รายการนี้ลงบัญชีไปแล้ว (ข้ามการบันทึกซ้ำ)" : "" } };
}

// ── S3: คลังยืนยันจัดส่ง (ตัดสต็อก + SELL_PRODUCT + LINE) ───────────────────────
export async function confirmFulfillmentAction(quNo: string, userName: string): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_confirm_fulfillment", { p_qu_no: quNo, p_user: userName });
  if (error) return fail(error.message);
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
  await sendLine(msg);

  revalidatePath("/sales");
  return { ok: true, data: res };
}

// ── ปรับสต็อกทั่วไป manual ────────────────────────────────────────────────────
export async function manualStockMoveAction(
  input: { itemCode: string; actionType: "IN" | "OUT" | "ADJUST"; qty: number; refNo?: string; remarks?: string },
  userName: string,
): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_manual_stock_move", { p: input, p_user: userName });
  if (error) return fail(error.message);
  const res = data as { ok: boolean; error?: string; newStock?: number };
  if (!res.ok) return fail(res.error ?? "ปรับสต็อกไม่สำเร็จ");
  revalidatePath("/sales");
  return { ok: true, data: res };
}

// ── ยกเลิกออเดอร์ + ย้อน side effect (role main) ─────────────────────────────
export async function cancelOrderAction(quNo: string): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_cancel_order", { p_qu_no: quNo });
  if (error) return fail(error.message);
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
  if (seqErr) return fail(seqErr.message);
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
  if (error) return fail(error.message);
  revalidatePath("/sales");
  return { ok: true, data: { id: contactId } };
}
