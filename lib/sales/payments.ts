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

/**
 * วิธีชำระที่เลือกได้ในหน้าขาย (หน้าต่างรับเงินของจัดการออเดอร์)
 * 🚨 ชุดเดียวกับ array ใน fn_sales_edit_payment (0100) — เทสเทียบ
 */
export const PAY_METHODS = ["โอนเงิน", "เงินสด", "บัตรเครดิต", "เช็ค"] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

/**
 * ข้อความรายละเอียดเช็คที่เก็บลง DB — รูปเดียวกับที่หน้าต่างรับเงินเขียนมาตั้งแต่ระบบเดิม
 * (`formatChequeDetail` ใน print.ts อ่านรูปนี้ตรง ๆ) · ใช้ทั้งตอนรับเงินและตอนแก้วิธีชำระ
 */
export function chequeText(bank: string, no: string, date: string): string {
  let b = bank.trim() || "-";
  if (!b.includes("ธนาคาร") && b !== "-") b = "ธนาคาร" + b;
  return `${b} เลขที่เช็ค : ${no.trim() || "-"} ลงวันที่ ${date || "-"}`;
}

/**
 * แยกข้อความเช็คกลับเป็น 3 ช่อง — เติมค่าเดิมให้ตอนแก้ (แก้แค่เลขที่ที่กรอกผิด ไม่ต้องพิมพ์ธนาคารใหม่)
 * ★ ย้อนรูปของ `chequeText()` · รูปอื่น (ข้อมูลเก่า/พิมพ์เอง) → ใส่ทั้งก้อนในช่องธนาคาร ไม่เดาแยก
 */
export function parseCheque(text: string): { bank: string; no: string; date: string } {
  const m = /^(.*) เลขที่เช็ค : (.*) ลงวันที่ (.*)$/.exec((text ?? "").trim());
  if (!m) return { bank: (text ?? "").trim(), no: "", date: "" };
  const clean = (s: string) => (s.trim() === "-" ? "" : s.trim());
  return { bank: clean(m[1]), no: clean(m[2]), date: /^\d{4}-\d{2}-\d{2}$/.test(m[3].trim()) ? m[3].trim() : "" };
}

/**
 * ใบเสร็จของการรับเงินครั้งนี้ — ปุ่ม "พิมพ์ใบนี้ใหม่" หลังแก้วิธีชำระ
 * ★ กติกาเดียวกับปุ่มพิมพ์เดิมของหน้าจัดการออเดอร์ (ชำระเต็มตอนสั่ง = มีใบส่งสินค้าในใบเดียว)
 */
export function receiptDocFor(label: string, order: { dueDate: string; deposit: number }): string | null {
  if (label === PAY_LABEL.deposit) return "tax-invoice-deposit";
  if (label === PAY_LABEL.balance) return "tax-invoice-balance";
  if (label === PAY_LABEL.full) {
    return order.dueDate === "" && (order.deposit || 0) === 0 ? "tax-invoice-receipt-do" : "tax-invoice-receipt";
  }
  return null;
}

/**
 * ออเดอร์นี้เคยรับเงินแล้วหรือยัง — ปุ่ม "แก้วิธีชำระ" (D144) โชว์เฉพาะออเดอร์ที่มีการรับเงิน
 * ★ ตัดสินจากยอด (ค้างน้อยกว่ายอดสุทธิ) ไม่ใช่สถานะ — "รอคลังจัดส่ง" มีทั้งแบบรับมัดจำแล้วและแบบส่งเครดิต
 */
export function hasReceivedPayment(o: { status: string; outstandingBalance: number; netPayable: number; grandTotal: number }): boolean {
  if (o.status === "ยกเลิก") return false;
  const net = o.netPayable || o.grandTotal;
  return net > 0 && o.outstandingBalance < net;
}

/** ผลของ fn_sales_edit_payment (0100) */
export type EditPaymentResult = {
  from_method: string | null;
  from_account: string | null;
  to_account: string | null;
  doc_no: string | null;
};

/**
 * ข้อความหลังแก้วิธีชำระ — บอกครบว่าเปลี่ยนอะไรไปบ้าง (บัญชีของบิลเปลี่ยนตามด้วย ต้องเห็น)
 * 🚨 ประโยคตัดสินที่นี่ ไม่ใช่ในคอมโพเนนต์ (D84/D91)
 */
export function editPaymentDoneText(toMethod: string, r: EditPaymentResult): string {
  const parts = [`แก้วิธีชำระแล้ว: ${r.from_method || "ไม่ระบุ"} → ${toMethod}`];
  if (r.from_account && r.to_account && r.from_account !== r.to_account) {
    parts.push(`บิลรายรับย้ายบัญชี ${r.from_account} → ${r.to_account}`);
  }
  if (r.doc_no) parts.push(`พิมพ์ใบ ${r.doc_no} ใหม่ได้เลย (เลขเดิม)`);
  return parts.join(" · ");
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
