/**
 * lib/sales/payments — การรับเงินของออเดอร์ทีละครั้ง (D143 · golden S15)
 *
 * ตาราง `sales_payments` (0099): 1 แถว = รับเงิน 1 ครั้ง พร้อมวิธีชำระ/เช็ค/เลขเอกสารของครั้งนั้น
 *
 * 🔴 ทำไมต้องมี: ออเดอร์มีช่อง `payment_method` ช่องเดียว ⇒ รับยอดค้างแล้วค่าของมัดจำถูกเขียนทับ
 *    พิมพ์ใบเสร็จค่ามัดจำซ้ำทีหลัง = ขึ้นวิธีชำระของยอดค้าง (บั๊กที่มีอยู่จริงก่อน D143)
 * ★ เฟส 1 ยังเขียนช่องเดิมของออเดอร์ทุกตัวเหมือนเดิม — ตารางนี้เป็น "ความจริงต่อครั้ง" ที่ใบเสร็จอ่าน
 * ★ ไม่มีคอลัมน์สถานะ: ถูกยกเลิกหรือไม่ อ่านจาก `transactions.status` ของ `tx_id` (แหล่งเดียว)
 */
import type { OrderAction } from "./orders";

/** ป้ายของการรับเงินแต่ละแบบ — 🚨 ใช้ทั้งลงตาราง · ข้อความ LINE · backfill ใน 0099 (เทสเทียบให้) */
export const PAY_LABEL = {
  deposit: "มัดจำ",
  balance: "ชำระยอดค้าง",
  full: "ชำระเต็ม",
} as const;
export type PayLabel = (typeof PAY_LABEL)[keyof typeof PAY_LABEL];

/** action ไหนคือการรับเงินแบบไหน · ไม่ใช่การรับเงิน = null */
export function payLabelFor(action: OrderAction): PayLabel | null {
  if (action === "DEPOSIT_AND_SEND") return PAY_LABEL.deposit;
  if (action === "PAY_BALANCE") return PAY_LABEL.balance;
  if (action === "FULL_PAYMENT_AND_SEND" || action === "FULL_PAYMENT_LATER") return PAY_LABEL.full;
  return null;
}

export type SalesPayment = {
  seq: number;
  label: string;
  amount: number;
  method: string;
  chequeDetail: string;
  docDate: string;
  docNo: string;
  txId: string;
};

/** ใบเสร็จแต่ละชนิดเป็นของการรับเงินแบบไหน */
const DOC_LABEL: Record<string, PayLabel> = {
  "tax-invoice-deposit": PAY_LABEL.deposit,
  "tax-invoice-balance": PAY_LABEL.balance,
  "tax-invoice-receipt": PAY_LABEL.full,
  "tax-invoice-receipt-do": PAY_LABEL.full,
};

/**
 * การรับเงินที่เอกสารใบนี้เป็นของ — null = ไม่ใช่ใบเสร็จ หรือไม่มีแถว (ออเดอร์ก่อน 0099 ที่ไม่มีบิลให้ backfill)
 * ★ จับคู่ด้วยป้าย ไม่ใช่ลำดับ — ออเดอร์เก่าที่ backfill ได้แค่ครั้งที่ 2 ก็ยังจับถูกใบ
 * ★ ป้ายซ้ำ (ไม่ควรเกิดในเฟส 1) → เอาครั้งล่าสุด
 */
export function paymentForDoc(docType: string, payments: SalesPayment[] | undefined): SalesPayment | null {
  const label = DOC_LABEL[docType];
  if (!label || !payments?.length) return null;
  const hit = payments.filter((p) => p.label === label).sort((a, b) => b.seq - a.seq);
  return hit[0] ?? null;
}
