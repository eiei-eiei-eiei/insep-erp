/**
 * lib/sales/creditNote — ใบลดหนี้ตอนยกเลิกออเดอร์ (D159 · เฟส 1 = ลดทั้งออเดอร์)
 *
 * กฎหมาย (สรุปใน docs/CREDIT_NOTE_PLAN.md):
 * · ต้องเข้าเหตุตาม ม.82/10 + ประกาศอธิบดีฉบับที่ 82 → หน้าจอบังคับเลือกเหตุ
 * · ออกในเดือนภาษีที่เหตุเกิด · ภาษีขายที่ลดลงหักในเดือนที่ออกใบลดหนี้ — งวดเดิมไม่แก้
 * · ใบลดหนี้ 1 ใบอ้างใบกำกับเดิมได้หลายใบ (ป.80/2542 ข้อ 4)
 *
 * 🚨 ฝาแฝดฝั่ง SQL: `cancelMode()` ↔ ด่านใน `fn_cancel_order` (0106) — SQL คือตัวบังคับจริง
 *    (creditNote.test.ts อ่าน SQL มาเทียบ · test:tenant ยิงจริง)
 */

/** บิลรายรับของออเดอร์ที่ยังไม่ถูกยกเลิก (= ใบกำกับ/ใบเสร็จที่ออกไปแล้ว) */
export type CnBill = {
  txId: string;
  /** วันที่รายการ (yyyy-MM-dd) = เดือนภาษีของใบกำกับ */
  date: string;
  taxInvoiceNo: string;
  taxInvoiceDate: string;
  /** มูลค่าก่อน VAT (amount_after_discount) */
  preVat: number;
  vat: number;
  /** ยอดที่ลูกค้าจ่ายจริง (หลังหัก ณ ที่จ่าย) */
  net: number;
  wht: number;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const monthOf = (iso: string) => String(iso ?? "").slice(0, 7);

/**
 * ยกเลิกออเดอร์แบบไหน
 * · `void`        = ยกเลิกแบบเดิม (ไม่มีใบกำกับภาษีที่มี VAT ให้ลด — ใบเสนอราคา/ใบแจ้งหนี้ล้วน หรือผู้ไม่จด VAT)
 * · `choice`      = ใบกำกับทุกใบอยู่เดือนเดียวกับวันนี้ และเดือนนั้นยังไม่ติ๊กยื่น ภพ.30
 *                   → เลือกได้: เรียกใบเดิมคืนแล้วยกเลิก (ป.86/2542 ข้อ 25) หรือออกใบลดหนี้
 * · `credit_note` = มีใบกำกับเดือนก่อน หรือเดือนนั้นยื่น ภพ.30 แล้ว → ต้องออกใบลดหนี้
 *                   (ยกเลิกแบบเดิม = ภาษีขายหายจากงวดที่ยื่นไปแล้ว)
 */
export type CancelMode = "void" | "choice" | "credit_note";
export function cancelMode(bills: CnBill[], todayMonth: string, filedVatMonths: ReadonlySet<string>): CancelMode {
  const vatBills = bills.filter((b) => b.vat > 0);
  if (!vatBills.length) return "void";
  const locked = vatBills.some((b) => monthOf(b.date) !== todayMonth || filedVatMonths.has(monthOf(b.date)));
  return locked ? "credit_note" : "choice";
}

/** เหตุออกใบลดหนี้ — ชุดปิด · ผูกกับตัวบท */
export const CN_REASONS = {
  return: { label: "รับคืนสินค้า", law: "ม.82/10(3) · ประกาศอธิบดีฉบับที่ 82 ข้อ 2(3)(4)" },
  refund_advance: { label: "คืนเงินมัดจำ/เงินจ่ายล่วงหน้าตามข้อตกลง", law: "ประกาศอธิบดีฉบับที่ 82 ข้อ 2(2)" },
  price_error: { label: "สินค้าผิดข้อกำหนด/ชำรุด/คำนวณราคาผิดสูงกว่าจริง", law: "ม.82/10(1)" },
  other: { label: "เหตุอื่นตามข้อตกลงทางการค้า", law: "ม.82/10 · ประกาศอธิบดีฉบับที่ 82" },
} as const;
export type CnReason = keyof typeof CN_REASONS;
export const CN_REASON_KEYS = Object.keys(CN_REASONS) as CnReason[];

/** ข้อความเหตุบนใบลดหนี้ (ม.86/10(6) คำอธิบายสั้น ๆ) */
export function cnReasonText(reason: CnReason, detail: string): string {
  const d = detail.trim();
  return d ? `${CN_REASONS[reason].label} — ${d}` : CN_REASONS[reason].label;
}

/** ตรวจก่อนออก · null = ผ่าน */
export function cnInputError(x: { reason: string; detail: string; date: string; bills: CnBill[]; today: string }): string | null {
  if (!(x.reason in CN_REASONS)) return "เลือกเหตุที่ออกใบลดหนี้";
  if (x.reason === "other" && !x.detail.trim()) return "เหตุอื่น — พิมพ์อธิบายสั้น ๆ ว่าลดหนี้เพราะอะไร (ต้องพิมพ์บนใบลดหนี้)";
  if (x.detail.length > 200) return "คำอธิบายยาวเกิน 200 ตัวอักษร";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date)) return "เลือกวันที่ใบลดหนี้";
  if (x.date > x.today) return "วันที่ใบลดหนี้ต้องไม่เป็นวันในอนาคต";
  const latest = x.bills.map((b) => b.taxInvoiceDate || b.date).sort().at(-1);
  if (latest && x.date < latest) return `วันที่ใบลดหนี้ต้องไม่ก่อนวันที่ใบกำกับเดิม (${latest})`;
  if (!x.bills.some((b) => b.vat > 0)) return "ออเดอร์นี้ไม่มีใบกำกับภาษีให้ลดหนี้";
  return null;
}

/**
 * ยอดบนใบลดหนี้ (ม.86/10(5)) — เฟส 1 ลดทั้งออเดอร์: มูลค่าที่ถูกต้อง = 0
 * ★ บวกยอดที่บันทึกไว้ในบิลเดิมตรง ๆ ไม่ถอด VAT ใหม่ (สูตรเงินมีที่เดียว · บทเรียน D86)
 */
export type CnTotals = { original: number; correct: number; diff: number; vat: number; total: number; refund: number; wht: number };
export function cnTotals(bills: CnBill[]): CnTotals {
  const sum = (f: (b: CnBill) => number) => r2(bills.reduce((s, b) => s + f(b), 0));
  const original = sum((b) => b.preVat);
  const vat = sum((b) => b.vat);
  return { original, correct: 0, diff: original, vat, total: r2(original + vat), refund: sum((b) => b.net), wht: sum((b) => b.wht) };
}

/** บรรทัดเตือนเมื่อลูกค้าหัก ณ ที่จ่ายไว้ (คืนเงินสุทธิ · ใบ 50ทวิ ที่ลูกค้าออกให้ไม่ถูกแตะ) */
export function cnWhtNote(t: CnTotals): string | null {
  if (t.wht <= 0) return null;
  return `ลูกค้าหัก ณ ที่จ่ายไว้ ${t.wht.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท — คืนเงินเฉพาะยอดที่รับจริง · หนังสือรับรอง 50ทวิ ที่ลูกค้าออกให้ ต้องคุยกับลูกค้าเอง`;
}
