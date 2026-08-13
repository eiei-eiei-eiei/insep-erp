"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { nextWhtDocNo } from "@/lib/accounting/wht";
import { previousVat, type InstallmentRow, type TaxReport, type TaxSummaryRow } from "@/lib/accounting/calc";
import { mapDbError } from "@/lib/shared/dbError";
import { bangkokDayStartUTC } from "@/lib/shared/datetime";
import {
  getDashboard,
  getApAr,
  getBalances,
  getStatement,
  searchBills,
  getBillDetail,
  searchPriceHistory,
  getInstallmentGroup,
  listInstallmentGroups,
  getWhtBundle,
  getTaxReportBundle,
  getRecentBillsByContact,
  getItemHistory,
  getReportRuns,
} from "./data";

export type SaveResult = { ok: boolean; error?: string; data?: unknown };
function fail(error: string): SaveResult {
  return { ok: false, error };
}
async function db() {
  return createClient();
}

// ── read wrappers (client เรียกสด) ──────────────────────────────────────────
export async function getDashboardAction(period: string, entityId: string) {
  return getDashboard(period, entityId);
}
export async function getApArAction(entityId: string) {
  return getApAr(entityId);
}
export async function getBalancesAction(upToPeriod: string, entityId: string) {
  return getBalances(upToPeriod, entityId);
}
export async function getStatementAction(accountName: string, period: string) {
  return getStatement(accountName, period);
}
export async function searchBillsAction(params: Parameters<typeof searchBills>[0]) {
  return searchBills(params);
}
export async function getBillDetailAction(txId: string) {
  return getBillDetail(txId);
}
export async function getRecentBillsByContactAction(contactName: string, limit?: number, entityId?: string, contactId?: string) {
  return getRecentBillsByContact(contactName, limit, entityId, contactId);
}
export async function getItemHistoryAction(entityId?: string) {
  return getItemHistory(entityId);
}
export async function searchPriceHistoryAction(params: Parameters<typeof searchPriceHistory>[0]) {
  return searchPriceHistory(params);
}
export async function getInstallmentGroupAction(poGroupId: string) {
  return getInstallmentGroup(poGroupId);
}
export async function listInstallmentGroupsAction() {
  return listInstallmentGroups();
}
export async function getWhtBundleAction(period: string, entityId: string) {
  return getWhtBundle(period, entityId);
}
export async function getTaxReportBundleAction(period: string, entityId: string) {
  return getTaxReportBundle(period, entityId);
}

/** ข้อมูลหัวกระดาษ 50ทวิ (ผู้หัก) + ผู้ถูกหัก (จากชื่อคู่ค้า) */
export async function getWht50ContextAction(entityId: string, contactName: string, contactId?: string) {
  const supabase = await db();
  // ระบุด้วย contact_id ก่อน (แม่นสาขา) — ถ้าไม่มี ใช้ชื่อ + limit(1) กัน error เมื่อชื่อซ้ำหลายสาขา (D30)
  const cq = supabase.from("contacts").select("name, tax_id, address");
  const contactP = (contactId
    ? cq.eq("contact_id", contactId)
    : cq.eq("name", contactName)
  ).limit(1);
  const [ent, contact] = await Promise.all([
    supabase.from("entities").select("name, tax_id, branch, address").eq("entity_id", entityId).maybeSingle(),
    contactP,
  ]);
  const c = contact.data?.[0];
  return {
    entInfo: { name: ent.data?.name ?? "", taxId: ent.data?.tax_id ?? "", address: ent.data?.address ?? "" },
    payee: { name: c?.name ?? contactName, taxId: c?.tax_id ?? "", address: c?.address ?? "" },
  };
}

// ── A3/A4 บันทึกบิล (+ forward ต้นทุนสุรา T6) ────────────────────────────────
export type TxItemInput = {
  item_name: string;
  quantity: number;
  in_vat: number;
  ex_vat: number;
  total_price: number;
  discount_pct?: number;
  discount_baht?: number;
  item_category?: string;
  item_job?: string;
};
export type SaveTxInput = {
  transaction_date: string;
  type: string;
  account_name?: string;
  category?: string;
  contact_name?: string;
  contact_id?: string; // ระบุสาขาที่แน่นอน (multi-branch, D30)
  description?: string;
  base_amount: number;
  discount: number;
  amount_after_discount: number;
  vat_amount: number;
  wht_rate: number;
  wht_amount: number;
  net_amount: number;
  tax_invoice_no?: string;
  tax_invoice_date?: string;
  receipt_image_url?: string;
  entity_id: string;
  ap_ar_status?: "AP" | "AR" | "";
  due_date?: string;
  forward_material?: boolean;
};

export async function saveTransactionAction(input: SaveTxInput, items: TxItemInput[]): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_save_transaction", { p: input, p_items: items });
  if (error) return fail(mapDbError(error));
  revalidatePath("/accounting");
  const res = data as { ok: boolean; tx_id: string; warning?: string | null };
  return { ok: true, data: res };
}

/** แก้บิลเดี่ยวย้อนหลัง (ค้นบิล → แก้ไข) — fn_edit_transaction (0019) */
export async function updateTransactionAction(txId: string, input: SaveTxInput, items: TxItemInput[]): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_edit_transaction", { p_tx_id: txId, p: input, p_items: items });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string };
  if (!res.ok) return fail(res.error ?? "แก้ไขไม่สำเร็จ");
  revalidatePath("/accounting");
  return { ok: true, data: res };
}

// ── A6 แบ่งงวด (money math จาก lib ฝั่ง client → ส่ง rows มา insert) ────────────
export async function saveInstallmentsAction(
  header: {
    transaction_date: string;
    type: string;
    category?: string;
    contact_name?: string;
    contact_id?: string; // ระบุสาขาที่แน่นอน (multi-branch, D30)
    entity_id: string;
  },
  rows: (InstallmentRow & { description: string })[],
  items: TxItemInput[],
): Promise<SaveResult> {
  const supabase = await db();
  const pRows = rows.map((r) => ({
    base: r.base,
    vat_amount: r.vatAmount,
    wht_rate: r.whtRate,
    wht_amount: r.whtAmount,
    net_amount: r.netAmount,
    installment_no: r.installmentNo,
    installment_total: r.installmentTotal,
    due_date: r.dueDate,
    description: r.description,
  }));
  const { data, error } = await supabase.rpc("fn_save_installments", { p: header, p_rows: pRows, p_items: items });
  if (error) return fail(mapDbError(error));
  revalidatePath("/accounting");
  return { ok: true, data };
}

// ── A7 โอนระหว่างบัญชี ───────────────────────────────────────────────────────
export async function saveTransferAction(input: {
  from: string;
  to: string;
  amount: number;
  date: string;
  note?: string;
  entityId?: string;
}): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_save_transfer", {
    p_from: input.from,
    p_to: input.to,
    p_amount: input.amount,
    p_date: input.date,
    p_note: input.note ?? "",
    p_entity: input.entityId ?? null,
  });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string };
  if (!res.ok) return fail(res.error ?? "โอนไม่สำเร็จ");
  revalidatePath("/accounting");
  return { ok: true, data };
}

// ── A5 settle บิลค้าง ────────────────────────────────────────────────────────
export async function settleApArAction(input: {
  txId: string;
  accountName?: string;
  paymentDate?: string;
  taxInvoiceNo?: string;
  taxInvoiceDate?: string;
}): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_settle_apar", {
    p_tx_id: input.txId,
    p_account_name: input.accountName ?? null,
    p_payment_date: input.paymentDate ?? null,
    p_tax_invoice_no: input.taxInvoiceNo ?? null,
    p_tax_invoice_date: input.taxInvoiceDate ?? null,
  });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string };
  if (!res.ok) return fail(res.error ?? "settle ไม่สำเร็จ");
  revalidatePath("/accounting");
  return { ok: true };
}

// ── A14 void (soft-delete ทั้งกลุ่ม) ─────────────────────────────────────────
export async function voidTransactionAction(txId: string): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_void_transaction", { p_tx_id: txId });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string };
  if (!res.ok) return fail(res.error ?? "ยกเลิกไม่สำเร็จ");
  revalidatePath("/accounting");
  return { ok: true, data };
}

// ── A9 เลข 50ทวิ ถัดไป (รันแยกต่อกิจการ ต่อปี พ.ศ.) — สำหรับ prefill ในฟอร์ม ──
export async function nextWhtDocNoAction(entityId: string): Promise<string> {
  const supabase = await db();
  const { data: certs } = await supabase.from("wht_certificates").select("doc_no").eq("entity_id", entityId);
  return nextWhtDocNo((certs ?? []).map((c) => c.doc_no as string));
}

// ── A9 ออก 50ทวิ (docNo/วันออก/ประเภทเงินได้ ผู้ใช้กรอก/แก้ได้) ────────────────
export async function issueWhtAction(input: {
  docNo: string;
  txIds: string[];
  contactName: string;
  contactId?: string; // สาขาที่แน่นอน (multi-branch D30) — เก็บไว้ให้พิมพ์ซ้ำได้ที่อยู่/เลขภาษีถูกสาขา
  address?: string;
  whtAmount: number;
  pndType: string;
  incomeType?: string;
  incomeSeq: number;
  baseAmount: number;
  issueDate?: string;
  paymentDate?: string;
  entityId: string;
}): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_issue_wht", {
    p_doc_no: input.docNo,
    p_tx_ids: input.txIds,
    p_issue_date: input.issueDate ?? null,
    p_contact_name: input.contactName,
    p_address: input.address ?? "",
    p_wht_amount: input.whtAmount,
    p_pnd_type: input.pndType,
    p_income_type: input.incomeType ?? "",
    p_income_seq: input.incomeSeq,
    p_base_amount: input.baseAmount,
    p_payment_date: input.paymentDate ?? null,
    p_entity_id: input.entityId,
    p_contact_id: input.contactId || null,
  });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string; doc_no?: string };
  if (!res.ok) return fail(res.error ?? "ออกเอกสารไม่สำเร็จ");
  revalidatePath("/accounting");
  return { ok: true, data: res };
}

// ── A9 แก้ใบ 50ทวิ ที่ออกแล้ว (เลขที่/วันออก/ประเภทเงินได้) ─────────────────────
export async function updateWhtAction(input: {
  entityId: string;
  oldDocNo: string;
  newDocNo: string;
  issueDate?: string;
  pndType: string;
  incomeSeq: number;
  incomeType?: string;
}): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_update_wht", {
    p_entity_id: input.entityId,
    p_old_doc_no: input.oldDocNo,
    p_new_doc_no: input.newDocNo,
    p_issue_date: input.issueDate ?? null,
    p_pnd_type: input.pndType,
    p_income_seq: input.incomeSeq,
    p_income_type: input.incomeType ?? null,
  });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string; doc_no?: string };
  if (!res.ok) return fail(res.error ?? "แก้ไขไม่สำเร็จ");
  revalidatePath("/accounting");
  return { ok: true, data: res };
}

/** ดึงวันที่จ่าย (payment_date) ของ tx สำหรับ reprint 50ทวิ */
export async function getTxPaymentDateAction(txId: string): Promise<string | null> {
  const supabase = await db();
  const { data } = await supabase.from("transactions").select("payment_date, transaction_date").eq("tx_id", txId).maybeSingle();
  return (data?.payment_date as string) ?? (data?.transaction_date as string) ?? null;
}

// ── เพิ่มคู่ค้า (contacts) ────────────────────────────────────────────────────
export async function addContactAction(input: {
  name: string;
  taxId?: string;
  branch?: string;
  address?: string;
  contactType?: string;
}): Promise<SaveResult> {
  const supabase = await db();
  const { data: seq, error: seqErr } = await supabase.rpc("next_serial", { p_key: "CONTACT" });
  if (seqErr) return fail(mapDbError(seqErr));
  const contactId = "C-" + String(seq).padStart(4, "0");
  const { error } = await supabase.from("contacts").insert({
    contact_id: contactId,
    name: input.name,
    tax_id: input.taxId ?? null,
    branch: input.branch ?? null,
    address: input.address ?? null,
    contact_type: input.contactType ?? null,
  });
  if (error) return fail(mapDbError(error));
  revalidatePath("/accounting");
  return { ok: true, data: { contactId } };
}

// ── ภพ.30: บันทึก tax_summaries (regenerate = replace แถวเดิมของเดือน/กิจการ) ──
export async function recordTaxSummaryAction(period: string, entityId: string, r: TaxReport): Promise<SaveResult> {
  const supabase = await db();
  // ลบแถวเดิมของเดือน+กิจการนี้ก่อน (กันบันทึกซ้ำเมื่อกดสร้างเดือนเดิมหลายรอบ)
  await supabase.from("tax_summaries").delete().eq("report_month", period).eq("entity_id", entityId);
  const { error } = await supabase.from("tax_summaries").insert({
    report_month: period,
    total_sales_amount: r.totalSalesAmount,
    total_sales_vat: r.totalSalesVat,
    total_purchase_amount: r.totalPurchaseAmount,
    total_purchase_vat: r.totalPurchaseVat,
    forwarded_vat_in: r.forwardedVatIn,
    net_payable: r.netPayable,
    forwarded_vat_out: r.forwardedVatOut,
    entity_id: entityId,
  });
  if (error) return fail(mapDbError(error));
  return { ok: true };
}

/** รายการ tax_summaries (จัดการจากแอป) */
export async function listTaxSummariesAction(entityId: string) {
  const supabase = await db();
  let q = supabase
    .from("tax_summaries")
    .select("id, report_month, total_sales_vat, total_purchase_vat, forwarded_vat_in, net_payable, forwarded_vat_out, entity_id, created_at")
    .order("report_month", { ascending: false })
    .order("created_at", { ascending: false });
  if (entityId && entityId !== "ALL") q = q.eq("entity_id", entityId);
  const { data } = await q;
  return data ?? [];
}

/** ยอดภาษีซื้อยกมา (forwarded VAT) ของเดือน = forwarded_vat_out เดือนก่อน (ให้ผู้ใช้เช็ค) */
export async function getForwardedVatAction(period: string, entityId: string): Promise<number> {
  const supabase = await db();
  const { data } = await supabase.from("tax_summaries").select("report_month, forwarded_vat_out, entity_id, created_at");
  return previousVat(period, entityId, (data ?? []) as unknown as TaxSummaryRow[]);
}

export async function deleteTaxSummaryAction(id: number): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("tax_summaries").delete().eq("id", id);
  if (error) return fail(mapDbError(error));
  revalidatePath("/accounting");
  return { ok: true };
}

// ── ตั้งค่า (ข้อ3): app_settings / bank_accounts / contacts CRUD ──────────────
export async function addSettingAction(kind: string, value: string): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("app_settings").insert({ kind, value });
  if (error) return fail(mapDbError(error));
  revalidatePath("/accounting");
  return { ok: true };
}
/** ตั้งค่าแบรนด์ของกิจการ (D43) — upsert ทีละ kind (app_settings เก็บ 1 แถวต่อ kind) */
export async function saveBrandingAction(input: {
  name: string;
  color: string;
  logoUrl: string;
  defaultMode: string;
}): Promise<SaveResult> {
  const supabase = await db();
  const pairs: [string, string][] = [
    ["brand_name", input.name],
    ["brand_color", input.color],
    ["default_mode", input.defaultMode],
    ["logo_url", input.logoUrl],
  ];
  for (const [kind, value] of pairs) {
    await supabase.from("app_settings").delete().eq("kind", kind);
    if (!value) continue; // ค่าว่าง (เช่นไม่ใส่โลโก้) = ไม่ต้องเก็บแถว
    const { error } = await supabase.from("app_settings").insert({ kind, value });
    if (error) return fail(mapDbError(error));
  }
  revalidatePath("/", "layout"); // แถบเมนูอยู่ใน layout — ต้อง revalidate ทั้ง layout
  return { ok: true };
}

/**
 * แจ้งเตือน LINE ต่อกิจการ (0033) — ของเดิมอ่านจาก env ของ Vercel
 * → ลูกค้าทุกเจ้าใน deployment เดียวกันยิงเข้ากลุ่มเดียวกันหมด (เห็นออเดอร์กัน)
 *
 * ★ `token = null` แปลว่า "ไม่เปลี่ยนโทเคนเดิม" — หน้าจอไม่เคยได้ค่าเต็มกลับไป
 *   จึงส่งกลับมาไม่ได้ · ส่งสตริงว่างมาไม่ได้แปลว่าลบ (ใช้ปุ่มลบแยก)
 * สิทธิ์: บังคับด้วย RLS `app_settings_w` (main เท่านั้น) ไม่ต้องเช็คซ้ำในนี้
 */
export async function saveLineAction(input: {
  token: string | null;
  groupId: string;
}): Promise<SaveResult> {
  const supabase = await db();
  const groupId = input.groupId.trim();
  const token = input.token?.trim() ?? null;

  await supabase.from("app_settings").delete().eq("kind", "line_group_id");
  if (groupId) {
    const { error } = await supabase.from("app_settings").insert({ kind: "line_group_id", value: groupId });
    if (error) return fail(mapDbError(error));
  }

  if (token !== null) {
    await supabase.from("app_settings").delete().eq("kind", "line_channel_token");
    if (token) {
      const { error } = await supabase.from("app_settings").insert({ kind: "line_channel_token", value: token });
      if (error) return fail(mapDbError(error));
    }
  }

  revalidatePath("/accounting");
  return { ok: true };
}

/** ปิดแจ้งเตือน LINE ของกิจการนี้ — ลบทั้งโทเคนและกลุ่ม */
export async function clearLineAction(): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase
    .from("app_settings")
    .delete()
    .in("kind", ["line_channel_token", "line_group_id"]);
  if (error) return fail(mapDbError(error));
  revalidatePath("/accounting");
  return { ok: true };
}

/**
 * ข้อมูลผู้ขายบนเอกสารการค้า (D44) — แก้แถว `entities` + จำว่ากิจการไหนเป็นคนออกเอกสาร
 * ค่าชุดนี้ขึ้นหัวใบเสนอราคา/ใบแจ้งหนี้/ใบกำกับภาษี/ใบเสร็จ และใช้ร่วมกับฟอร์มราชการ
 * (ภพ.30/ภงด./50ทวิ/ภส. อ่านจากตารางเดียวกัน) → หัวเอกสารทั้งระบบตรงกันเสมอ
 */
export async function saveCompanyDocAction(input: {
  entityId: string;
  name: string;
  nameEng: string;
  taxId: string;
  branch: string;
  address: string;
  phone: string;
  bankLine: string;
}): Promise<SaveResult> {
  const supabase = await db();
  const entityId = input.entityId.trim();
  if (!entityId) return fail("เลือกกิจการที่ใช้ออกเอกสารก่อน");
  if (!input.name.trim()) return fail("กรอกชื่อกิจการ (ขึ้นหัวเอกสาร)");

  const { error } = await supabase
    .from("entities")
    .update({
      name: input.name.trim(),
      name_eng: input.nameEng.trim() || null,
      tax_id: input.taxId.trim() || null,
      branch: input.branch.trim() || null,
      address: input.address.trim() || null,
      phone: input.phone.trim() || null,
      bank_line: input.bankLine.trim() || null,
    })
    .eq("entity_id", entityId);
  if (error) return fail(mapDbError(error));

  // 1 แถวต่อ kind (เหมือน saveBrandingAction) — ลบของเดิมแล้วใส่ใหม่
  await supabase.from("app_settings").delete().eq("kind", "sales_doc_entity");
  const { error: e2 } = await supabase.from("app_settings").insert({ kind: "sales_doc_entity", value: entityId });
  if (e2) return fail(mapDbError(e2));

  revalidatePath("/accounting");
  revalidatePath("/sales");
  return { ok: true };
}

export async function deleteSettingAction(kind: string, value: string): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("app_settings").delete().eq("kind", kind).eq("value", value);
  if (error) return fail(mapDbError(error));
  revalidatePath("/accounting");
  return { ok: true };
}
export async function saveBankAccountAction(input: {
  accountId?: string;
  accountName: string;
  entityIds: string[];
  kind?: string;
  openingBalance: number;
}): Promise<SaveResult> {
  const supabase = await db();
  const name = input.accountName.trim();
  if (!name) return fail("กรอกชื่อบัญชี");
  // มีชื่อบัญชีนี้แล้ว → อัปเดตตามชื่อ (D23#3 upsert by ชื่อ) ไม่สร้าง id ใหม่ กัน account_name ซ้ำ (unique)
  const { data: existing } = await supabase.from("bank_accounts").select("account_id").eq("account_name", name).maybeSingle();
  if (existing?.account_id || input.accountId) {
    const { error } = await supabase.from("bank_accounts").update({
      entity_ids: input.entityIds,
      kind: input.kind ?? null,
      opening_balance: input.openingBalance,
    }).eq("account_name", name);
    if (error) return fail(mapDbError(error));
    revalidatePath("/accounting");
    return { ok: true, data: { updated: true } };
  }
  const { data: seq, error: e } = await supabase.rpc("next_serial", { p_key: "BANK_ACC" });
  if (e) return fail(mapDbError(e));
  const accountId = "ACC-" + String(seq).padStart(3, "0");
  const { error } = await supabase.from("bank_accounts").insert({
    account_id: accountId,
    account_name: name,
    entity_ids: input.entityIds,
    kind: input.kind ?? null,
    opening_balance: input.openingBalance,
  });
  if (error) return fail(mapDbError(error));
  revalidatePath("/accounting");
  return { ok: true, data: { updated: false } };
}
export async function deleteBankAccountAction(accountId: string): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("bank_accounts").delete().eq("account_id", accountId);
  if (error) return fail(mapDbError(error));
  revalidatePath("/accounting");
  return { ok: true };
}
export async function updateContactAction(input: {
  contactId: string;
  name: string;
  taxId?: string;
  branch?: string;
  address?: string;
  contactType?: string;
}): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("contacts").update({
    name: input.name,
    tax_id: input.taxId ?? null,
    branch: input.branch ?? null,
    address: input.address ?? null,
    contact_type: input.contactType ?? null,
  }).eq("contact_id", input.contactId);
  if (error) return fail(mapDbError(error));
  revalidatePath("/accounting");
  return { ok: true };
}
export async function deleteContactAction(contactId: string): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("contacts").delete().eq("contact_id", contactId);
  if (error) return fail(mapDbError(error));
  revalidatePath("/accounting");
  return { ok: true };
}

/** checklist "เดือนนี้สร้างรายงานครบยัง" (FLOW sec 6) */
export async function getReportRunsAction(month: string, entityId: string) {
  return getReportRuns(month, entityId);
}

export async function markReportRunAction(reportKey: string, month: string, entityId: string): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("report_runs").insert({ report_key: reportKey, month, entity_id: entityId });
  if (error) return fail(mapDbError(error));
  return { ok: true };
}

// ── A15 สแกนใบเสร็จ AI (Claude Haiku vision) ─────────────────────────────────
export async function scanReceiptAction(base64: string, mimeType: string): Promise<SaveResult> {
  const supabase = await db();
  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email ?? "anonymous";
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const limit = parseInt(process.env.SCAN_DAILY_LIMIT ?? "100", 10);

  const logScan = async (status: string, confidence: string | null, err: string | null) => {
    await supabase.from("scan_log").insert({ user_email: email, status, confidence: confidence ?? "-", error_message: err ?? "-" });
  };

  if (!apiKey || apiKey.includes("ใส่-key")) {
    await logScan("error", null, "API key not configured");
    return fail("ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY");
  }

  // rate limit: นับ scan สำเร็จของ user "วันนี้ตามเวลาไทย"
  // (server เป็น UTC บน Vercel — ถ้าใช้ setHours(0,0,0,0) โควตาจะรีเซ็ต 7 โมงเช้าไทย ไม่ใช่เที่ยงคืน)
  const todayStart = bangkokDayStartUTC();
  const { count } = await supabase
    .from("scan_log")
    .select("id", { count: "exact", head: true })
    .eq("user_email", email)
    .eq("status", "success")
    .gte("created_at", todayStart.toISOString());
  if ((count ?? 0) >= limit) {
    await logScan("rate_limit", null, `${count}/${limit}`);
    return fail(`เกินจำนวนสแกนรายวัน (${count}/${limit}) — ลองใหม่พรุ่งนี้`);
  }

  const systemPrompt =
    "คุณเป็น AI ผู้เชี่ยวชาญในการอ่านตัวเลขและข้อมูลจากใบเสร็จและใบกำกับภาษีของไทย ให้ extract เป็น JSON เท่านั้น ไม่ต้องมี markdown code block สำหรับข้อความไทยที่อ่านไม่ชัดให้ใส่ null";
  const userPrompt = `อ่านข้อมูลจากใบเสร็จ/ใบกำกับภาษีนี้ return JSON:
{"taxId":"เลขภาษีผู้ออกบิล 13 หลักตัวเลขล้วน","taxInvoiceNo":"เลขที่ใบกำกับ","taxInvoiceDate":"yyyy-MM-dd","description":"รายละเอียดสั้นๆ","hasVat":true/false,"priceType":"incl_vat|excl_vat|unknown","items":[{"itemName":"ชื่อ หรือ null","quantity":1,"scannedPrice":ตัวเลข}],"confidence":"high|medium|low","uncertainFields":[]}
กฎ: taxId ของผู้ขาย · scannedPrice = ราคาต่อหน่วย · อ่านไม่ชัดใส่ null · return JSON เท่านั้น`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
              { type: "text", text: userPrompt },
            ],
          },
        ],
      }),
    });
    if (!resp.ok) {
      await logScan("error", null, `HTTP ${resp.status}`);
      return fail(`Anthropic API error ${resp.status} — ตรวจ API Key`);
    }
    const json = (await resp.json()) as { content: { text: string }[] };
    const raw = (json.content?.[0]?.text ?? "").trim();
    const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    let extracted: Record<string, unknown>;
    try {
      extracted = JSON.parse(clean);
    } catch {
      await logScan("error", null, "JSON parse failed: " + raw.substring(0, 200));
      return fail("AI ตอบกลับในรูปแบบที่อ่านไม่ได้ — ลองสแกนใหม่ให้ชัดกว่านี้");
    }
    await logScan("success", (extracted.confidence as string) ?? "-", null);
    return { ok: true, data: extracted };
  } catch (e) {
    await logScan("error", null, e instanceof Error ? e.message : "unknown");
    return fail("เกิดข้อผิดพลาดขณะสแกน");
  }
}
