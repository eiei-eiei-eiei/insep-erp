/**
 * lib/accounting/calc — สูตรบัญชี/ภาษี ที่ห้ามพลาด (MIGRATION_PLAN sec 6.2)
 * port byte-compatible จากโค้ดเดิม — ห้ามแก้สูตร มี golden test (calc.test.ts)
 *
 * A1  taxReport      ภพ.30 (Reports.js generateTaxReportHTML)
 * A2  guard          ข้ามแถว ap_ar_status != null + status 'ยกเลิก' (cash basis)
 * A3  entryCalc      VAT/WHT ฝั่งกรอกฟอร์ม (_js_entry.html calculateSummary)
 * A4  itemTotal      ส่วนลด item (Phase A) — total = qty×exVat − ส่วนลดบาท
 * A10 whtReport      ภงด.3/53 (Reports.js generateWHTReportHTML)
 * A11 dashboardData  Dashboard + WHT pending (Reports.js getDashboardAndWhtData)
 * A13 เช็คราคา        type/account ว่าง → ไม่อยู่ใน taxAccounts → หลุดทุกจุดโดยอัตโนมัติ
 */

// ── helpers ────────────────────────────────────────────────────────────────
/** parse ตัวเลข (รองรับ string มีคอมม่า) — เหมือน num() เดิม */
export function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** ปัด 2 ตำแหน่ง แบบ fmt2 เดิม (Math.round(x*100)/100) */
export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * แสดงวันที่แบบ พ.ศ. 2 หลัก จาก 'yyyy-MM-dd'
 * ภพ.30 ใช้ sep='.', ภงด. ใช้ sep='/' — ทั้งคู่ปี พ.ศ. 2 หลักท้าย
 */
export function formatDateBE(iso: string | null | undefined, sep = "."): string {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  const yy = ((parseInt(m[1], 10) + 543) % 100).toString().padStart(2, "0");
  return `${m[3]}${sep}${m[2]}${sep}${yy}`;
}

/** timestamp สำหรับเรียงลำดับจาก 'yyyy-MM-dd' (UTC midnight — เสถียร) */
function sortTsOf(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(String(iso).substring(0, 10) + "T00:00:00Z");
  return Number.isNaN(t) ? 0 : t;
}

/** yyyy-MM จากวันที่ 'yyyy-MM-dd' */
function monthOf(iso: string | null | undefined): string {
  return String(iso ?? "").substring(0, 7);
}

/**
 * แยกนิติบุคคล/บุคคลธรรมดา จากชื่อคู่ค้า (Reports.js generateWHTReportHTML)
 * match = นิติบุคคล (ภงด.53) · ไม่ match = บุคคลธรรมดา (ภงด.3)
 */
export function isCorporate(name: string | null | undefined): boolean {
  return /บริษัท|บจก|ห้างหุ้นส่วน|หจก|บมจ|จำกัด/i.test(String(name ?? ""));
}

/** entity scope (Entities.js inEntityScope_) — '' / 'ALL' = ทุกกิจการ */
function inScope(rowEntity: string | null | undefined, scope: string): boolean {
  if (!scope || scope === "ALL") return true;
  return String(rowEntity ?? "").trim() === scope;
}

// ── A4: ส่วนลด item + ยอดรวมรายการ ───────────────────────────────────────────
/** ส่วนลดบาทจากเปอร์เซ็นต์ (recalcDesktopRow) — round2(qty×exVat×pct/100) */
export function itemDiscBahtFromPct(qty: number, exVat: number, pct: number): number {
  return round2(num(qty) * num(exVat) * num(pct) / 100);
}

/** ยอดรวมรายการ (ก่อน VAT หลังหักส่วนลด item) = round2(qty×exVat − ส่วนลดบาท) */
export function itemTotal(qty: number, exVat: number, discBaht: number): number {
  return round2(num(qty) * num(exVat) - num(discBaht));
}

/** ราคา ex-vat จาก in-vat และกลับกัน (handleInVat/ExVatChange) */
export function exVatFromInVat(inVat: number): number {
  const v = num(inVat);
  return v > 0 ? round2(v / 1.07) : 0;
}
export function inVatFromExVat(exVat: number): number {
  const v = num(exVat);
  return v > 0 ? round2(v * 1.07) : 0;
}

// ── A3: สรุปยอดบิล (calculateSummary source='items') ─────────────────────────
export type EntryItem = { quantity: number; exVat: number; discBaht: number };
export type EntryCalcInput = {
  items: EntryItem[];
  discount: number; // ส่วนลดระดับบิล
  hasVat: boolean;
  hasWht: boolean;
  whtRate: number;
};
export type EntryCalcResult = {
  baseAmount: number;
  amountAfterDiscount: number;
  vatAmount: number;
  whtRate: number;
  whtAmount: number;
  netAmount: number;
};

/**
 * A3 — คำนวณยอดบิลจากรายการสินค้า (โหมด 'items' อัตโนมัติ)
 * base = Σ item-total (แต่ละ item ปัด 2 ตำแหน่งแล้ว) → aad = base − ส่วนลดบิล
 * vat = aad×7% (ถ้ามี) · wht = aad×rate% (ถ้ามี) · net = aad + vat − wht
 */
export function entryCalc(input: EntryCalcInput): EntryCalcResult {
  const base = round2(
    input.items.reduce(
      (s, it) => s + itemTotal(it.quantity, it.exVat, it.discBaht),
      0,
    ),
  );
  const aad = round2(base - num(input.discount));
  const vat = input.hasVat ? round2(aad * 0.07) : 0;
  const rate = input.hasWht ? num(input.whtRate) : 0;
  const wht = input.hasWht ? round2(aad * (rate / 100)) : 0;
  const net = round2(aad + vat - wht);
  return {
    baseAmount: base,
    amountAfterDiscount: aad,
    vatAmount: vat,
    whtRate: rate,
    whtAmount: wht,
    netAmount: net,
  };
}

/**
 * A3 (reverse) — ถอดยอดจากยอดสุทธิ + อัตรา WHT (applyReverseCalc)
 * base = round2(net / (1 − rate/100)) · wht = round2(base − net)
 */
export function reverseWht(net: number, rate: number): { base: number; wht: number } {
  const n = num(net);
  const r = num(rate);
  if (n <= 0 || r <= 0) return { base: 0, wht: 0 };
  const base = round2(n / (1 - r / 100));
  const wht = round2(base - n);
  return { base, wht };
}

// ── A6: แบ่งจ่ายงวด (Installments.js saveTransactionInstallments) ─────────────
export type InstallmentInput = { percent: number; dueDate: string };
export type InstallmentRow = {
  installmentNo: number;
  installmentTotal: number;
  base: number;
  vatAmount: number;
  whtRate: number;
  whtAmount: number;
  netAmount: number;
  dueDate: string;
};

/**
 * A6 — แบ่งยอด totalBase เป็น N งวดตามเปอร์เซ็นต์
 * base งวด i = round2(total × pct) · งวดสุดท้ายซับ remainder (ผลรวม = total เป๊ะ)
 * vat = hasVat ? round2(base×7%) : 0 · wht = round2(base×rate%) · net = base+vat−wht
 * @param startNo/totalNo ใช้ต่อเลขงวดตอนแก้เฉพาะงวดค้าง (mode B) — default 1..N
 */
export function splitInstallments(
  totalBase: number,
  installments: InstallmentInput[],
  hasVat: boolean,
  whtRate: number,
  opts?: { startNo?: number; totalNo?: number; normalize?: boolean },
): InstallmentRow[] {
  const total = num(totalBase);
  const rate = num(whtRate);
  const N = installments.length;
  const startNo = opts?.startNo ?? 1;
  const totalNo = opts?.totalNo ?? N;
  // mode B: normalize เปอร์เซ็นต์ด้วยผลรวมจริง (แบ่งยอดคงเหลือ)
  const sumPct = installments.reduce((s, x) => s + num(x.percent), 0);
  const denom = opts?.normalize ? sumPct : 100;

  const rows: InstallmentRow[] = [];
  let acc = 0;
  for (let i = 0; i < N; i++) {
    const w = num(installments[i].percent) / denom;
    const base = i < N - 1 ? round2(total * w) : round2(total - acc);
    acc += base;
    const vat = hasVat ? round2(base * 0.07) : 0;
    const wht = round2((base * rate) / 100);
    const net = round2(base + vat - wht);
    rows.push({
      installmentNo: startNo + i,
      installmentTotal: totalNo,
      base,
      vatAmount: vat,
      whtRate: rate,
      whtAmount: wht,
      netAmount: net,
      dueDate: installments[i].dueDate || "",
    });
  }
  return rows;
}

// ── transaction row (ชื่อคอลัมน์ตาม DB ใหม่) ─────────────────────────────────
export type Tx = {
  tx_id: string;
  transaction_date: string | null; // yyyy-MM-dd
  type: string;
  account_name: string | null;
  category: string | null;
  contact_name: string | null;
  contact_id?: string | null; // ระบุสาขาที่แน่นอน (multi-branch) — null = fallback ชื่อ (D30)
  description?: string | null;
  amount_after_discount: number | string;
  vat_amount: number | string;
  wht_rate: number | string;
  wht_amount: number | string;
  net_amount: number | string;
  tax_invoice_no: string | null;
  tax_invoice_date: string | null; // yyyy-MM-dd
  status: string;
  entity_id: string;
  ap_ar_status: string | null;
};

export type ContactInfo = { tax_id?: string | null; branch?: string | null; address?: string | null };
export type ContactMap = Record<string, ContactInfo>;

/**
 * หา ContactInfo ของ tx — ระบุด้วย contact_id ก่อน (แม่นสาขา multi-branch) แล้ว fallback ชื่อ
 * (contactMap เก็บ key ทั้ง contact_id และ name ชี้ info เดียวกัน — ดู loadContactMap)
 */
function resolveContact(tx: { contact_id?: string | null; contact_name: string | null }, map: ContactMap): ContactInfo {
  return (tx.contact_id ? map[tx.contact_id] : undefined) || map[tx.contact_name ?? ""] || {};
}

import { formatTaxId, formatBranch } from "../shared/format";

/**
 * A2 — guard cash basis: เข้ารายงานเฉพาะแถวปกติที่ไม่ใช่ AP/AR ค้าง
 * และบัญชีอยู่ในระบบภาษี (taxAccounts) + อยู่ในขอบเขตกิจการ
 */
function passesTaxGuard(tx: Tx, entityId: string, taxAccounts: Set<string>): boolean {
  return (
    tx.status === "ปกติ" &&
    !tx.ap_ar_status &&
    inScope(tx.entity_id, entityId) &&
    taxAccounts.has(tx.account_name ?? "")
  );
}

// ── A1: ภพ.30 ────────────────────────────────────────────────────────────────
export type TaxReportRow = {
  date: string; // dd.mm.yy (พ.ศ.)
  invoiceNo: string;
  name: string;
  taxId: string;
  isHQMark: string; // '/' ถ้า สนญ.
  branchMark: string; // เลขสาขา ถ้าไม่ใช่ สนญ.
  amount: number; // amountAfterDiscount
  vat: number; // vat_amount รายแถว (แสดงเท่านั้น)
  sortTs: number;
};
export type TaxReport = {
  period: string;
  sales: TaxReportRow[];
  purchases: TaxReportRow[];
  totalSalesAmount: number;
  totalSalesVat: number;
  totalPurchaseAmount: number;
  totalPurchaseVat: number;
  forwardedVatIn: number;
  netPayable: number;
  forwardedVatOut: number;
};

/**
 * A1 — รายงานภาษีซื้อ-ขาย (ภพ.30)
 * filter เดือนด้วย transaction_date · แสดงวันที่ด้วย tax_invoice_date (fallback transaction_date)
 * VAT รวมคำนวณรอบเดียวจากยอดรวม (ไม่ sum vat รายแถว)
 * netPayable = (tSVat − tPVat) − forwardedVatIn · ติดลบ → forwardedVatOut
 */
export function taxReport(
  period: string,
  entityId: string,
  forwardedVatIn: number,
  txs: Tx[],
  contactMap: ContactMap,
  taxAccounts: Set<string>,
): TaxReport {
  const sales: TaxReportRow[] = [];
  const purchases: TaxReportRow[] = [];
  let tSAmt = 0;
  let tPAmt = 0;

  for (const tx of txs) {
    if (!passesTaxGuard(tx, entityId, taxAccounts)) continue;
    if (num(tx.vat_amount) <= 0) continue;
    if (monthOf(tx.transaction_date) !== period) continue;

    const displayDate = tx.tax_invoice_date || tx.transaction_date;
    const cInfo = resolveContact(tx, contactMap);
    const branchInfo = formatBranch(cInfo.branch);
    const amt = num(tx.amount_after_discount);
    const rec: TaxReportRow = {
      date: formatDateBE(displayDate, "."),
      invoiceNo: tx.tax_invoice_no || "-",
      name: tx.contact_name ?? "",
      taxId: formatTaxId(cInfo.tax_id),
      isHQMark: branchInfo.isHQ ? "/" : "",
      branchMark: branchInfo.isHQ ? "" : branchInfo.text,
      amount: amt,
      vat: num(tx.vat_amount),
      sortTs: sortTsOf(displayDate),
    };
    if (tx.type === "รายรับ") {
      sales.push(rec);
      tSAmt += amt;
    } else if (tx.type === "รายจ่าย" || tx.type === "บันทึกภาษี") {
      // 'บันทึกภาษี' = ภาษีซื้อนำเข้า/ศุลกากร → นับเป็นภาษีซื้อเหมือนรายจ่าย (D29)
      // (ไม่กระทบยอดบัญชี — ledger.txEffect คืน 0 ให้ type นี้อยู่แล้ว)
      purchases.push(rec);
      tPAmt += amt;
    }
  }

  sales.sort((a, b) => a.sortTs - b.sortTs);
  purchases.sort((a, b) => a.sortTs - b.sortTs);

  const tSVat = round2(tSAmt * 7 / 100);
  const tPVat = round2(tPAmt * 7 / 100);
  const netPayable = tSVat - tPVat - num(forwardedVatIn);
  const forwardedVatOut = netPayable < 0 ? Math.abs(netPayable) : 0;

  return {
    period,
    sales,
    purchases,
    totalSalesAmount: tSAmt,
    totalSalesVat: tSVat,
    totalPurchaseAmount: tPAmt,
    totalPurchaseVat: tPVat,
    forwardedVatIn: num(forwardedVatIn),
    netPayable,
    forwardedVatOut,
  };
}

/**
 * getPreviousVAT — ภาษีซื้อยกมา = forwarded_vat_out ของแถวล่าสุด เดือนก่อนหน้า (ต่อกิจการ)
 * รับ tax_summaries ทั้งหมด (คัดเดือน/กิจการ + เอาแถว created_at ล่าสุด)
 */
export type TaxSummaryRow = {
  report_month: string;
  forwarded_vat_out: number | string | null;
  entity_id: string | null;
  created_at: string;
};
export function previousVat(
  period: string,
  entityId: string,
  summaries: TaxSummaryRow[],
): number {
  const [y, m] = period.split("-").map((x) => parseInt(x, 10));
  let year = y;
  let month = m - 1;
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  const prev = `${year}-${String(month).padStart(2, "0")}`;
  const scope = entityId || "EID01";
  const matched = summaries
    .filter(
      (s) =>
        String(s.report_month).replace(/^'/, "").trim() === prev &&
        (String(s.entity_id ?? "").trim() || "EID01") === scope,
    )
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const last = matched[matched.length - 1];
  return last ? num(last.forwarded_vat_out) : 0;
}

// ── A10: ภงด.3/53 ────────────────────────────────────────────────────────────
export type WhtReportRow = {
  date: string; // dd/mm/yy (พ.ศ.)
  taxId: string;
  contactName: string;
  category: string;
  whtRate: number;
  amountPaid: number;
  whtAmount: number;
  address: string;
};
export type WhtReport = {
  pnd3: WhtReportRow[];
  pnd53: WhtReportRow[];
  pnd3TotalPaid: number;
  pnd3TotalWht: number;
  pnd53TotalPaid: number;
  pnd53TotalWht: number;
};

/**
 * A10 — รายละเอียดหักภาษี ณ ที่จ่าย (ภงด.3 บุคคล / ภงด.53 นิติบุคคล)
 * เฉพาะ type='รายจ่าย' && wht_amount>0 + guard เดิม · filter เดือนด้วย transaction_date
 */
export function whtReport(
  period: string,
  entityId: string,
  txs: Tx[],
  contactMap: ContactMap,
  taxAccounts: Set<string>,
): WhtReport {
  const pnd3: WhtReportRow[] = [];
  const pnd53: WhtReportRow[] = [];

  for (const tx of txs) {
    if (!passesTaxGuard(tx, entityId, taxAccounts)) continue;
    if (tx.type !== "รายจ่าย") continue;
    if (num(tx.wht_amount) <= 0) continue;
    if (monthOf(tx.transaction_date) !== period) continue;

    const cInfo = resolveContact(tx, contactMap);
    const rec: WhtReportRow = {
      date: formatDateBE(tx.transaction_date, "/"),
      taxId: formatTaxId(cInfo.tax_id),
      contactName: tx.contact_name ?? "",
      category: tx.category ?? "",
      whtRate: num(tx.wht_rate),
      amountPaid: num(tx.amount_after_discount),
      whtAmount: num(tx.wht_amount),
      address: cInfo.address ?? "",
    };
    if (isCorporate(tx.contact_name)) pnd53.push(rec);
    else pnd3.push(rec);
  }

  const sum = (rows: WhtReportRow[], k: "amountPaid" | "whtAmount") =>
    rows.reduce((s, r) => s + r[k], 0);

  return {
    pnd3,
    pnd53,
    pnd3TotalPaid: sum(pnd3, "amountPaid"),
    pnd3TotalWht: sum(pnd3, "whtAmount"),
    pnd53TotalPaid: sum(pnd53, "amountPaid"),
    pnd53TotalWht: sum(pnd53, "whtAmount"),
  };
}

// ── A11: Dashboard + WHT pending ─────────────────────────────────────────────
export type DashPending = {
  transactionId: string;
  displayDate: string; // dd/mm/yy (พ.ศ.)
  transactionDateISO: string; // yyyy-MM-dd (วันออกหนังสือ 50ทวิ)
  contactName: string;
  category: string;
  amount: number;
  whtAmount: number;
  whtRate: number;
};
export type DashboardData = {
  dash: { income: number; expense: number; vatOut: number; vatIn: number };
  whtPending: DashPending[];
};

/**
 * A11 — Dashboard สรุปรายเดือน + WHT ค้างออก 50ทวิ
 * ⚠️ filter เดือนด้วย tax_invoice_date ก่อน (fallback transaction_date) — ต่างจาก ภพ.30 (จงใจ)
 * pending WHT = รายจ่ายมี wht ที่ tx_id ยังไม่อยู่ใน issuedTxIds (จาก wht_certificates.tx_ids)
 */
export function dashboardData(
  period: string,
  entityId: string,
  txs: Tx[],
  taxAccounts: Set<string>,
  issuedTxIds: Set<string>,
): DashboardData {
  let income = 0;
  let expense = 0;
  let vatOut = 0;
  let vatIn = 0;
  const whtPending: DashPending[] = [];

  for (const tx of txs) {
    if (!passesTaxGuard(tx, entityId, taxAccounts)) continue;
    const filterDate = tx.tax_invoice_date || tx.transaction_date;
    if (!filterDate) continue;
    if (monthOf(filterDate) !== period) continue;

    const amount = num(tx.amount_after_discount);
    const vat = num(tx.vat_amount);
    const whtAmount = num(tx.wht_amount);

    if (tx.type === "รายรับ") {
      income += amount;
      vatOut += vat;
    } else if (tx.type === "รายจ่าย") {
      expense += amount;
      vatIn += vat;
      if (whtAmount > 0 && !issuedTxIds.has(tx.tx_id)) {
        whtPending.push({
          transactionId: tx.tx_id,
          displayDate: formatDateBE(filterDate, "/"),
          transactionDateISO: String(tx.transaction_date ?? "").substring(0, 10),
          contactName: tx.contact_name ?? "",
          category: tx.category ?? "",
          amount,
          whtAmount,
          whtRate: num(tx.wht_rate),
        });
      }
    }
  }

  return { dash: { income, expense, vatOut, vatIn }, whtPending };
}
