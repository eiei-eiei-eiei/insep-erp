import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { taxReport, whtReport, previousVat, missingInvoicePurchases, type Tx, type ContactMap, type TaxSummaryRow } from "./calc";
import { accountStatementRange, type LedgerTx, type StatementRange } from "./ledger";
import { fetchAllRows } from "@/lib/shared/paginate";
import { mustRead } from "@/lib/shared/dbError";

/**
 * ตัวโหลดข้อมูลรายงานบัญชี — รับ supabase client จากผู้เรียก (D141 รอบ 6)
 *
 * ★ ย้ายมาจาก app/(app)/accounting/data.ts คำต่อคำ เพื่อให้ Claude connector (token ของผู้ใช้)
 *   ใช้ตัวโหลดชุดเดียวกับหน้าเว็บ (คุกกี้) — ไม่ใช่เขียนการเลือกข้อมูลชุดที่สอง
 *   🪤 บทเรียน D81: สูตรถูกหมดแต่ตัวเลือกข้อมูลผิด แล้วไม่มีเทสไหนเห็น ⇒ ตัวเลือกข้อมูลต้องมีที่เดียว
 * 🚨 ทุกตัวอ่านด้วยสิทธิ์ของผู้เรียก (RLS) — ไม่มี service role
 */

// คอลัมน์ transactions ที่ใช้ทุกรายงาน
export const TX_COLS =
  "tx_id, transaction_date, type, account_name, category, contact_name, contact_id, description, base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount, tax_invoice_no, tax_invoice_date, status, entity_id, ap_ar_status, payment_date, settled_on, transfer_id, po_group_id, installment_no, installment_total, due_date, source, receipt_image_url, advance_for_entity, advance_status, advance_clear_id, advance_src_tx";

export function txBase(supabase: SupabaseClient, withCount = false) {
  return supabase.from("transactions").select(TX_COLS, withCount ? { count: "exact" } : undefined);
}
export type TxBuilder = ReturnType<typeof txBase>;

/**
 * ดึงทุกแถวของ transactions แบบแบ่งหน้า (range) — กัน PostgREST cap `max_rows` ตัดเงียบ
 * ทำให้รายงานเงิน/ภาษี (dashboard/ยอดบัญชี/ภพ.30/statement) ขาดแถวเก่าโดยไม่มี error เมื่อข้อมูลโต
 * ตรรกะวน/ตรวจยอดกับ count อยู่ที่ lib/shared/paginate (มี unit test — paginate.test.ts)
 */
export async function fetchAllTransactions(
  supabase: SupabaseClient,
  applyFilters?: (q: TxBuilder) => TxBuilder,
): Promise<Record<string, unknown>[]> {
  return fetchAllRows<Record<string, unknown>>(
    async (from, to) => {
      let q = txBase(supabase, from === 0); // ขอ count เฉพาะหน้าแรก → ตรวจว่าได้ครบ
      if (applyFilters) q = applyFilters(q);
      const { data, error, count } = await q.order("tx_id", { ascending: true }).range(from, to);
      return { data: (data ?? []) as Record<string, unknown>[], error, count };
    },
    { label: "รายการบัญชี" },
  );
}

/** map ชื่อคู่ค้า → {tax_id, branch, address} */
export async function loadContactMap(supabase: SupabaseClient): Promise<ContactMap> {
  // 🚨 D89 — ว่างเพราะอ่านไม่ได้ = ช่องเลขผู้เสียภาษีบน ภพ.30/ภงด. ว่างทั้งแบบ
  const data = mustRead(
    await supabase.from("contacts").select("contact_id, name, tax_id, branch, address"),
    "ทะเบียนคู่ค้า",
  );
  const map: ContactMap = {};
  // key ทั้ง contact_id (แม่นสาขา) และ name (fallback ข้อมูลเก่า — ชื่อซ้ำหลายสาขา = อันท้ายชนะ)
  for (const c of data ?? []) {
    const info = { tax_id: c.tax_id, branch: c.branch, address: c.address };
    map[c.name as string] = info;
    if (c.contact_id) map[c.contact_id as string] = info;
  }
  return map;
}

/** A8 — statement บัญชี · D139 เลือกช่วงเดือน / ทั้งหมด (from/to = null) */
export async function statementFor(supabase: SupabaseClient, accountName: string, range: StatementRange) {
  const ym = /^\d{4}-\d{2}$/;
  if ((range.from && !ym.test(range.from)) || (range.to && !ym.test(range.to))) throw new Error("รูปแบบเดือนไม่ถูกต้อง");
  if (range.from && range.to && range.from > range.to) throw new Error("เดือนเริ่มต้องไม่หลังเดือนสุดท้าย");
  const [txAll, accRes] = await Promise.all([
    fetchAllTransactions(supabase, (q) => q.eq("account_name", accountName)),
    supabase.from("bank_accounts").select("opening_balance").eq("account_name", accountName).maybeSingle(),
  ]);
  // 🚨 D89 — opening = 0 เงียบ ๆ ทำให้ running balance ทั้งคอลัมน์ผิด
  const openRow = mustRead<{ opening_balance: number | null } | null>(accRes, "ยอดยกมาของบัญชี");
  const opening = Number(openRow?.opening_balance) || 0;
  return accountStatementRange(accountName, range, txAll as unknown as LedgerTx[], opening);
}

/** ชุดข้อมูล ภพ.30 / ภงด. (หน้าเอกสารสรรพากร + connector) */
export async function taxReportBundleFor(supabase: SupabaseClient, period: string, entityId: string) {
  const [txAll, contactMap, summaries, entity] = await Promise.all([
    fetchAllTransactions(supabase),
    loadContactMap(supabase),
    supabase.from("tax_summaries").select("report_month, forwarded_vat_out, entity_id, created_at"),
    supabase.from("entities").select("name, tax_id, branch, excise_id").eq("entity_id", entityId).maybeSingle(),
  ]);
  const txs = txAll as unknown as Tx[];
  // 🚨 D89 — summaries ว่าง = ภาษีซื้อยกมาหายทั้งก้อน → ยอดที่ยื่นใน ภพ.30 ผิด
  const fwdIn = previousVat(period, entityId, mustRead(summaries, "ยอดภาษียกมา") as unknown as TaxSummaryRow[]);
  return {
    entity: mustRead<{ name: string; tax_id: string; branch: string; excise_id: string } | null>(
      entity, "ข้อมูลกิจการบนแบบยื่น",
    ) ?? { name: "", tax_id: "", branch: "", excise_id: "" },
    taxReport: taxReport(period, entityId, fwdIn, txs, contactMap),
    whtReport: whtReport(period, entityId, txs, contactMap),
    forwardedVatIn: fwdIn,
  };
}

/**
 * D124 — บิลซื้อเดือนนี้ที่มี VAT แต่ยังไม่กรอกเลขใบกำกับ (นับอยู่ใน ภพ.30 — ทาง ก)
 * ★ ตัดสินด้วย `missingInvoicePurchases()` ซึ่งใช้ด่านเดียวกับ ภพ.30 ⇒ ลิสต์ = บิลที่อยู่ในตัวเลขจริงพอดี
 */
export async function missingInvoicesFor(supabase: SupabaseClient, period: string, entityId: string) {
  const txs = await fetchAllTransactions(supabase, (q) => q.gt("vat_amount", 0).in("type", ["รายจ่าย", "บันทึกภาษี"]));
  return missingInvoicePurchases(period, entityId, txs as unknown as Tx[])
    .sort((a, b) => String(a.transaction_date).localeCompare(String(b.transaction_date)))
    .map((t) => ({
      txId: t.tx_id,
      date: t.transaction_date ?? "",
      contactName: t.contact_name ?? "",
      description: t.description ?? "",
      amount: Number(t.amount_after_discount) || 0,
      vat: Number(t.vat_amount) || 0,
    }));
}
