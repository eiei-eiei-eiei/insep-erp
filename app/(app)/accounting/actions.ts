"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { previousVat, type InstallmentRow, type TaxReport, type TaxSummaryRow } from "@/lib/accounting/calc";
import { mapDbError, mustRead } from "@/lib/shared/dbError";
import { canPay, taxTxDescription, surchargeTxDescription, type TaxKind } from "@/lib/accounting/taxPay";
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
  getMissingInvoices,
  getRecentBillsByContact,
  getItemHistory,
  getReportRuns,
  getTaxPayBoard,
  getAdvances,
  getBankAccountAdmin,
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
export async function getAdvancesAction(entityId: string) {
  return getAdvances(entityId);
}
export async function getBalancesAction(upToPeriod: string, entityId: string) {
  return getBalances(upToPeriod, entityId);
}
export async function getStatementAction(accountName: string, range: Parameters<typeof getStatement>[1]) {
  return getStatement(accountName, range);
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
/** D124 — บิลซื้อมี VAT ที่ยังไม่กรอกเลขใบกำกับ (ลิสต์บนการ์ด ภพ.30) */
export async function getMissingInvoicesAction(period: string, entityId: string) {
  return getMissingInvoices(period, entityId);
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
// D141 — ชนิดอยู่ใน lib (Claude connector ฝั่ง server ใช้ร่วม)
import type { TxItemInput, SaveTxInput } from "@/lib/accounting/itemInputs";
export type { TxItemInput, SaveTxInput };

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

// ── D119 สำรองจ่าย: เคลีย / ถอนการเคลีย / ตัดเป็นค่าใช้จ่ายส่วนตัว ──────────────
// ★ ตัวตัดสินอยู่ใน RPC ทั้งหมด (0086) — ที่นี่แค่ส่งต่อ + แปลงผลเป็นข้อความไทย
export async function clearAdvancesAction(input: {
  txIds: string[];
  payAccount: string;
  refundAccount?: string;
  date: string;
}): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_clear_advances", {
    p_tx_ids: input.txIds,
    p_pay_account: input.payAccount,
    p_refund_account: input.refundAccount || null,
    p_date: input.date || null,
  });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string };
  if (!res.ok) return fail(res.error ?? "เคลียไม่สำเร็จ");
  revalidatePath("/accounting");
  return { ok: true, data: res };
}

export async function unclearAdvancesAction(clearId: string): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_unclear_advances", { p_clear_id: clearId });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string };
  if (!res.ok) return fail(res.error ?? "ถอนการเคลียไม่สำเร็จ");
  revalidatePath("/accounting");
  return { ok: true, data: res };
}

export async function advanceToPersonalAction(txId: string): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_advance_to_personal", { p_tx_id: txId });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string };
  if (!res.ok) return fail(res.error ?? "ตัดเป็นค่าใช้จ่ายส่วนตัวไม่สำเร็จ");
  revalidatePath("/accounting");
  return { ok: true, data: res };
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

// ── A9 เลข 50ทวิ ถัดไป (รันแยกต่อกิจการ) — สำหรับ prefill ในฟอร์ม ──
/**
 * D100 — รูปแบบตามที่ตั้งใน ตั้งค่า → เลขเอกสาร (ปริยาย = `6901` แบบเดิม · golden A9)
 * ★ `fn_suggest_doc_no` **เสนอเลขโดยไม่กินเลข** (ผู้ใช้แก้เลขในฟอร์มได้เหมือนเดิม) และข้ามเลขที่
 *   มีใบอยู่แล้วทั้งใบคู่ค้าและใบพนักงาน (ชุดเดียวกัน D69) — แทนการดึงเลขทั้งหมดมาหา max ฝั่ง TS
 * 🚨🚨 D89 — อ่านไม่ได้ = ยอมพัง ดีกว่าออกเลข 50ทวิ ซ้ำใบที่อยู่ในมือคู่ค้า
 */
export async function nextWhtDocNoAction(entityId: string): Promise<string> {
  const supabase = await db();
  const data = mustRead(
    await supabase.rpc("fn_suggest_doc_no", { p_type: "acct_wht", p_entity: entityId, p_date: null }),
    "เลขใบ 50 ทวิ ถัดไป",
  );
  return String(data ?? "");
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
  return mustRead(await q, "ประวัติแบบที่ยื่น") ?? [];
}

/** ยอดภาษีซื้อยกมา (forwarded VAT) ของเดือน = forwarded_vat_out เดือนก่อน (ให้ผู้ใช้เช็ค) */
export async function getForwardedVatAction(period: string, entityId: string): Promise<number> {
  const supabase = await db();
  // 🚨 D89 — ว่าง = ภาษีซื้อยกมาเป็น 0 → ยอดที่ยื่นใน ภพ.30 ผิด
  const data = mustRead(
    await supabase.from("tax_summaries").select("report_month, forwarded_vat_out, entity_id, created_at"),
    "ยอดภาษียกมา",
  );
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
export async function deleteSettingAction(kind: string, value: string): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.from("app_settings").delete().eq("kind", kind).eq("value", value);
  if (error) return fail(mapDbError(error));
  revalidatePath("/accounting");
  return { ok: true };
}
/**
 * D125 — เพิ่ม/แก้บัญชีเงิน
 * · ไม่ส่ง `accountId` = เพิ่มใหม่ (ชื่อซ้ำ = error · เลิก upsert ตามชื่อแบบเดิมที่แยก "เพิ่ม" กับ "แก้" ไม่ออก)
 * · ส่ง `accountId` = แก้บัญชีนั้น · ชื่อเปลี่ยน → `fn_rename_bank_account` ตามไปแก้ทุกบิล/ค่าตั้งก่อน
 *   🚨 ห้าม update account_name ตรง ๆ — บิลอ้างบัญชีด้วยชื่อ (บิลเก่าจะหลุดบัญชีทั้งหมด)
 */
export async function saveBankAccountAction(input: {
  accountId?: string;
  accountName: string;
  entityIds: string[];
  kind?: string;
  openingBalance: number;
  openingDate?: string | null;
}): Promise<SaveResult> {
  const supabase = await db();
  const name = input.accountName.trim();
  if (!name) return fail("กรอกชื่อบัญชี");
  const fields = {
    entity_ids: input.entityIds,
    kind: input.kind?.trim() || null,
    opening_balance: input.openingBalance,
    opening_date: input.openingDate || null,
  };

  if (input.accountId) {
    const cur = mustRead<{ account_name: string } | null>(
      await supabase.from("bank_accounts").select("account_name").eq("account_id", input.accountId).maybeSingle(),
      "บัญชีเงิน",
    );
    if (!cur) return fail("ไม่พบบัญชีนี้ (อาจถูกลบไปแล้ว) — รีเฟรชหน้า");
    let renamed: Record<string, unknown> | null = null;
    if (cur.account_name !== name) {
      const { data, error } = await supabase.rpc("fn_rename_bank_account", { p_old: cur.account_name, p_new: name });
      if (error) return fail(mapDbError(error));
      renamed = data as Record<string, unknown>;
    }
    // 🪤 RLS ไม่ผ่าน = update 0 แถวโดยไม่ error → ต้องนับแถวที่แก้จริง
    const { data: upd, error } = await supabase.from("bank_accounts").update(fields).eq("account_id", input.accountId).select("account_id");
    if (error) return fail(mapDbError(error));
    if (!upd?.length) return fail("แก้บัญชีนี้ไม่ได้ — ต้องมีสิทธิ์ตั้งค่าบัญชี และเห็นทุกกิจการที่ผูกกับบัญชีนี้");
    revalidatePath("/accounting");
    return { ok: true, data: { updated: true, renamed } };
  }

  const { data: dup } = await supabase.from("bank_accounts").select("account_id").eq("account_name", name).maybeSingle();
  if (dup) return fail(`มีบัญชีชื่อ "${name}" อยู่แล้ว — กด แก้ไข ที่แถวนั้นแทน`);
  const { data: seq, error: e } = await supabase.rpc("next_serial", { p_key: "BANK_ACC" });
  if (e) return fail(mapDbError(e));
  const accountId = "ACC-" + String(seq).padStart(3, "0");
  const { error } = await supabase.from("bank_accounts").insert({ account_id: accountId, account_name: name, active: true, ...fields });
  if (error) return fail(mapDbError(error));
  revalidatePath("/accounting");
  return { ok: true, data: { updated: false, accountId } };
}

/** D125 — ปิดใช้/เปิดใช้ (บัญชีที่มีบิลแล้วลบไม่ได้ ใช้ตัวนี้แทน) */
export async function setBankAccountActiveAction(accountId: string, active: boolean): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.from("bank_accounts").update({ active }).eq("account_id", accountId).select("account_id");
  if (error) return fail(mapDbError(error));
  if (!data?.length) return fail("เปลี่ยนสถานะบัญชีนี้ไม่ได้ — ต้องมีสิทธิ์ตั้งค่าบัญชี");
  revalidatePath("/accounting");
  return { ok: true };
}

/** D125 — ลบ · DB ตรวจซ้ำว่าไม่มีอะไรอ้างถึง (`fn_delete_bank_account`) */
export async function deleteBankAccountAction(accountName: string): Promise<SaveResult> {
  const supabase = await db();
  const { error } = await supabase.rpc("fn_delete_bank_account", { p_name: accountName });
  if (error) return fail(mapDbError(error));
  revalidatePath("/accounting");
  return { ok: true };
}

/** D125 — ข้อมูลสำหรับการ์ดบัญชีเงินในหน้าตั้งค่า (การใช้งาน + ยอดคงเหลือปัจจุบัน) */
export async function getBankAccountAdminAction() {
  return getBankAccountAdmin();
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

// ── D88 ชำระภาษี (ภพ.30 / ภงด.3 / ภงด.53) ───────────────────────────────────

export async function getTaxPayBoardAction(period: string, entityId: string) {
  return getTaxPayBoard(period, entityId);
}

export type PayTaxInput = {
  kind: TaxKind;
  period: string;
  entityId: string;
  payDate: string;
  amount: number;
  surcharge: number;
  accountName: string;
  category: string;
  surchargeCategory: string;
  contactName: string;
  contactId?: string;
  note?: string;
};

/**
 * บันทึกการจ่ายภาษี → สร้างบิล `รายจ่าย` + แถวใน `tax_payments` ใน transaction เดียว
 *
 * 🚨 ตรวจซ้ำฝั่ง server ด้วย `canPay()` ตัวเดียวกับที่หน้าจอใช้ทำ `disabled=`
 *    (หน้าจอที่เปิดค้างไว้ข้ามวัน/ข้ามคนแก้บิล = ข้อมูลบนจอเก่าได้เสมอ)
 *    ★ ยอดเงินไม่ถูกบังคับให้เท่าที่ระบบคำนวณ — ผู้ใช้แก้ได้ (จ่ายบางส่วน/ปัดเศษ)
 *      แต่ยอดที่ระบบคำนวณ ณ ตอนนั้นถูกแช่ลง `computed_amount` ไว้เทียบย้อนหลัง
 */
export async function payTaxAction(input: PayTaxInput): Promise<SaveResult> {
  if (!(input.amount > 0)) return fail("ยอดที่จ่ายต้องมากกว่า 0");
  if ((input.surcharge ?? 0) > 0 && !input.surchargeCategory.trim()) {
    return fail("กรอกเบี้ยปรับแล้วต้องเลือกหมวดของเบี้ยปรับด้วย (ห้ามรวมหมวดเดียวกับตัวภาษี)");
  }

  const board = await getTaxPayBoard(input.period, input.entityId);
  const row = board.rows.find((r) => r.kind === input.kind);
  if (!row) return fail("กิจการนี้ไม่มีแบบนี้ให้ชำระ");
  if (!canPay(row)) return fail(row.blocked ?? "งวดนี้บันทึกการจ่ายไปแล้ว");

  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_pay_tax", {
    p_kind: input.kind,
    p_period: input.period,
    p_entity: input.entityId,
    p_date: input.payDate,
    p_amount: input.amount,
    p_surcharge: input.surcharge ?? 0,
    p_payload: {
      accountName: input.accountName,
      category: input.category,
      surchargeCategory: input.surchargeCategory,
      contactName: input.contactName,
      contactId: input.contactId ?? "",
      note: input.note ?? "",
      computedAmount: String(row.amount),
      description: taxTxDescription(input.kind, input.period),
      surchargeDescription: surchargeTxDescription(input.kind, input.period),
    },
  });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string; tx_id?: string };
  if (!res.ok) return fail(res.error ?? "บันทึกจ่ายไม่สำเร็จ");
  revalidatePath("/accounting");
  return { ok: true, data: res };
}

// ── D95 ประกาศว่า "ยื่นแล้ว" (คนละเหตุการณ์กับการกดพิมพ์แบบ) ──────────────────

/**
 * บันทึกว่ายื่นแบบของงวดนี้แล้ว → ปิดการเตือนเข้ากลุ่ม LINE ของงวดนั้น
 *
 * 🚨 **ไม่บังคับว่าต้องกดสร้างแบบในแอปก่อน** — ผู้ใช้จำนวนมากกรอกในเว็บ e-Filing เอง (D69)
 *    หน้าจอเตือนว่ายังไม่ได้สร้างแบบ แต่ไม่บล็อก (เตือนไม่บล็อก — กติกาเดิมของ D67/D91)
 * ★ ไม่แตะยอดเงินหรือบิลใด ๆ ทั้งสิ้น — เป็นการบันทึก "เหตุการณ์" ล้วน ๆ
 */
export async function fileTaxAction(input: {
  kind: TaxKind;
  period: string;
  entityId: string;
  filedOn?: string;
  note?: string;
}): Promise<SaveResult> {
  if (!input.entityId) return fail("เลือกกิจการก่อน");
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_file_tax", {
    p_kind: input.kind,
    p_period: input.period,
    p_entity: input.entityId,
    p_filed_on: input.filedOn || null,
    p_note: input.note ?? "",
  });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string };
  if (!res.ok) return fail(res.error ?? "บันทึกการยื่นไม่สำเร็จ");
  revalidatePath("/accounting");
  return { ok: true, data: res };
}

/**
 * ถอนการบันทึกยื่น — งวดนั้นกลับมาถูกเตือนอีกครั้ง
 * 🚨 ถอนไม่ได้ถ้ายังมีการบันทึกจ่ายค้างอยู่ (RPC เป็นคนบล็อกและบอกว่าต้องกดอะไรก่อน)
 */
export async function unfileTaxAction(
  kind: TaxKind,
  period: string,
  entityId: string,
  note?: string,
): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_unfile_tax", {
    p_kind: kind,
    p_period: period,
    p_entity: entityId,
    p_note: note ?? "",
  });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string };
  if (!res.ok) return fail(res.error ?? "ถอนการบันทึกยื่นไม่สำเร็จ");
  revalidatePath("/accounting");
  return { ok: true, data: res };
}

/** ถอนการบันทึกจ่าย — บิลกลายเป็น 'ยกเลิก' (ไม่ลบ) · ต้องมีสิทธิ์ acct.config */
export async function unpayTaxAction(kind: TaxKind, period: string, entityId: string): Promise<SaveResult> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("fn_unpay_tax", {
    p_kind: kind,
    p_period: period,
    p_entity: entityId,
  });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string };
  if (!res.ok) return fail(res.error ?? "ถอนไม่สำเร็จ");
  revalidatePath("/accounting");
  return { ok: true, data: res };
}
