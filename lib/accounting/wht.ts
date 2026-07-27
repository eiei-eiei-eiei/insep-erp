/**
 * lib/accounting/wht — 50ทวิ: เลขเอกสาร running ต่อปี พ.ศ. + วันที่ไทย (A9)
 * port จาก Wht50Tawi.js getNextWhtDocNo / formatDateThai / wht50ToISO_
 *
 * ⚠️ docNo = ปี พ.ศ. 2 หลัก + ลำดับ padStart(2) เช่น "6901","6902"... "69100"
 *    (โค้ดเดิมไม่มีขีดกลาง — ยึดโค้ดเดิม, schema comment '69-001' คลาดเคลื่อน → ดู DECISIONS)
 */

import { thaiBaht } from "../shared/format";

const TH_MONTHS_ABBR = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** prefix ปี พ.ศ. 2 หลักท้าย ของปี ค.ศ. ที่ให้มา (default = ปีปัจจุบัน) */
export function whtDocPrefix(gregorianYear: number = new Date().getFullYear()): string {
  return (gregorianYear + 543).toString().slice(-2);
}

/**
 * A9 — เลข 50ทวิ ถัดไป: prefix + (max ของปีนั้น + 1).padStart(2)
 * @param existing รายการ doc_no ที่มีอยู่แล้วทั้งหมด
 */
export function nextWhtDocNo(
  existing: string[],
  gregorianYear: number = new Date().getFullYear(),
): string {
  const prefix = whtDocPrefix(gregorianYear);
  let maxNum = 0;
  for (const raw of existing) {
    const docNo = String(raw ?? "").trim();
    if (docNo.startsWith(prefix)) {
      const numPart = parseInt(docNo.substring(prefix.length), 10);
      if (!Number.isNaN(numPart) && numPart > maxNum) maxNum = numPart;
    }
  }
  return prefix + (maxNum + 1).toString().padStart(2, "0");
}

/**
 * A9 — วันที่ไทยย่อ จาก 'yyyy-MM-dd' → "d ม.ค. 69" (ปี พ.ศ. 2 หลัก)
 * ไม่ pad วันที่ (เหมือน getDate() เดิม)
 */
export function formatDateThai(iso: string | null | undefined): string {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "-";
  const day = parseInt(m[3], 10);
  const mon = TH_MONTHS_ABBR[parseInt(m[2], 10) - 1];
  const yy = ((parseInt(m[1], 10) + 543) % 100).toString().padStart(2, "0");
  return `${day} ${mon} ${yy}`;
}

export type Wht50PrintData = {
  docNo: string;
  whtAmount: number;
  paymentDate: string; // วันที่จ่าย (yyyy-MM-dd)
  issueDateISO: string; // วันที่ออกหนังสือ = transaction_date
  dateText: string; // วันเดือนปีที่จ่าย (ไทยย่อ)
  bahtText: string; // จำนวนเงินภาษี (ตัวอักษรไทย)
};

/**
 * A9 — ประกอบ printData ของ 50ทวิ
 * วันที่จ่าย = payment_date (fallback transaction_date) · วันออกหนังสือ = transaction_date
 */
export function buildWht50PrintData(input: {
  docNo: string;
  whtAmount: number;
  transactionDate: string; // yyyy-MM-dd (วันออกหนังสือ)
  paymentDate?: string | null; // yyyy-MM-dd (วันที่จ่าย)
}): Wht50PrintData {
  const payDate = input.paymentDate || input.transactionDate;
  return {
    docNo: input.docNo,
    whtAmount: input.whtAmount,
    paymentDate: payDate,
    issueDateISO: input.transactionDate,
    dateText: formatDateThai(payDate),
    bahtText: thaiBaht(input.whtAmount),
  };
}
