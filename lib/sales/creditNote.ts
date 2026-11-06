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

import { vatFromGross } from "../shared/vat";

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

// ── D160 — เฟส 2: ใบลดหนี้บางส่วน (คืนบางรายการ / ลดราคา) โดยไม่ยกเลิกออเดอร์ ─────────────
/**
 * ★ ออกได้เฉพาะออเดอร์ "ปิดการขาย" (ผู้ใช้ตัดสิน) · หลายใบต่อออเดอร์ได้จนยอดที่ลดได้เหลือ 0
 * ★ สูตรอยู่ที่นี่ที่เดียว — RPC ตรวจแค่ขอบเขต (ไม่เกินยอดที่เหลือ · pre+vat = total) ไม่คิดซ้ำ (D86)
 * 🚨 ถอด VAT ด้วย `vatFromGross` ตัวเดียวกับบาร์/บัญชี (golden B11) — ไม่มีสูตรชุดที่สอง
 * 🚨 ใบที่ปิดยอดที่เหลือพอดี ใช้ยอดคงเหลือ (pre/vat) ตรง ๆ ไม่ถอดใหม่ — ไม่งั้นเศษสตางค์ค้าง
 *    (บิลเดิมถอด VAT จากยอดสุทธิทั้งก้อน · ถอดใหม่จากยอดย่อยแล้วรวมกันได้คลาด 0.01)
 */
/** รายการในออเดอร์ (ราคารวม VAT ต่อหน่วย · id = sales_order_items.id) */
export type CnOrderItem = { id: number; name: string; qty: number; price: number };
/** ใบลดหนี้ที่ออกไปแล้วของออเดอร์นี้ */
export type PriorCn = { pre: number; vat: number; total: number; wht: number; items: { id: number; qty: number }[] };
export type PartialInput =
  | { mode: "return"; qtys: Record<number, number> }
  | { mode: "discount"; gross: number };
export type PartialCtx = { bills: CnBill[]; prior: PriorCn[]; items: CnOrderItem[]; grandTotal: number; whtPercent: number };
export type PartialLine = { id: number; name: string; qty: number; price: number };
export type PartialResult = CnTotals & { lines: PartialLine[]; closing: boolean };

const vatBillsOf = (bills: CnBill[]) => bills.filter((b) => b.vat > 0);

/** ยอดที่ยังลดได้ (ใบกำกับทุกใบ − ใบลดหนี้ที่ออกไปแล้ว) + จำนวนที่ยังคืนได้ต่อรายการ */
export function partialRemaining(ctx: Pick<PartialCtx, "bills" | "prior" | "items">) {
  const vb = vatBillsOf(ctx.bills);
  const pre = r2(vb.reduce((s, b) => s + b.preVat, 0) - ctx.prior.reduce((s, c) => s + c.pre, 0));
  const vat = r2(vb.reduce((s, b) => s + b.vat, 0) - ctx.prior.reduce((s, c) => s + c.vat, 0));
  const wht = r2(vb.reduce((s, b) => s + b.wht, 0) - ctx.prior.reduce((s, c) => s + c.wht, 0));
  const returned = new Map<number, number>();
  for (const c of ctx.prior) for (const it of c.items) returned.set(it.id, (returned.get(it.id) ?? 0) + it.qty);
  const qty: Record<number, number> = {};
  for (const it of ctx.items) qty[it.id] = Math.max(0, it.qty - (returned.get(it.id) ?? 0));
  return { pre, vat, wht, gross: r2(pre + vat), qty };
}

/** ยอดบนใบลดหนี้บางส่วน · string = เหตุที่ออกไม่ได้ (ข้อความไทยพร้อมแสดง) */
export function partialTotals(input: PartialInput, ctx: PartialCtx): PartialResult | string {
  if (!vatBillsOf(ctx.bills).length) return "ออเดอร์นี้ไม่มีใบกำกับภาษีให้ลดหนี้";
  const rem = partialRemaining(ctx);
  if (rem.gross <= 0) return "ออเดอร์นี้ลดหนี้ครบยอดแล้ว";
  let gross: number;
  const lines: PartialLine[] = [];
  let allReturned = false;
  if (input.mode === "return") {
    for (const it of ctx.items) {
      const q = Number(input.qtys[it.id]) || 0;
      if (q < 0) return `${it.name}: จำนวนคืนติดลบไม่ได้`;
      if (q > rem.qty[it.id] + 1e-9) return `${it.name}: คืนได้ไม่เกิน ${rem.qty[it.id]} (ขาย ${it.qty})`;
      if (q > 0) lines.push({ id: it.id, name: it.name, qty: q, price: it.price });
    }
    if (!lines.length) return "เลือกรายการและจำนวนที่ลูกค้าคืน";
    // ส่วนลดท้ายบิลของออเดอร์ → ลดตามสัดส่วนเดียวกัน (ยอดคืน = มูลค่ารายการ × ยอดจริง/ยอดก่อนลด)
    const listTotal = ctx.items.reduce((s, it) => s + it.qty * it.price, 0);
    const factor = listTotal > 0 ? ctx.grandTotal / listTotal : 1;
    gross = r2(lines.reduce((s, l) => s + l.qty * l.price, 0) * factor);
    allReturned = ctx.items.every((it) => rem.qty[it.id] - (Number(input.qtys[it.id]) || 0) <= 1e-9);
  } else {
    gross = r2(Number(input.gross) || 0);
    if (gross <= 0) return "กรอกยอดที่ลด (รวม VAT)";
  }
  // ★ คืนครบทุกรายการที่เหลือ = ปิดยอดที่เหลือพอดี แม้มูลค่าตามราคาจะเกิน (เคยลดราคาไปแล้ว — ลดซ้ำไม่ได้)
  const fmtB = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2 });
  if (!allReturned && gross > rem.gross + 0.005) {
    return input.mode === "return"
      ? `มูลค่าสินค้าที่คืน ${fmtB(gross)} บาท เกินยอดที่ยังลดได้ ${fmtB(rem.gross)} บาท (เคยลดหนี้ไปแล้ว) — ถ้าลูกค้าคืนของที่เหลือทั้งหมด ให้ใส่ครบทุกรายการ ระบบจะลดเท่ายอดที่เหลือ`
      : `ลดได้ไม่เกินยอดที่เหลือ ${fmtB(rem.gross)} บาท`;
  }

  const closing = allReturned || Math.abs(gross - rem.gross) < 0.005;
  const split = closing ? { base: rem.pre, vat: rem.vat } : vatFromGross(gross);
  const pre = r2(split.base);
  const vat = r2(split.vat);
  const wht = closing ? rem.wht : r2((pre * (Number(ctx.whtPercent) || 0)) / 100);
  const total = r2(pre + vat);
  return {
    original: rem.pre, correct: r2(rem.pre - pre), diff: pre, vat, total,
    refund: r2(total - wht), wht, lines, closing,
  };
}

/** ยกเลิกทั้งออเดอร์ไม่ได้เมื่อมีใบลดหนี้บางส่วนแล้ว (คืนสต็อก/ภาษีซ้ำ) — ฝาแฝดด่านใน fn_cancel_order (0107) */
export const CANCEL_AFTER_PARTIAL_TEXT =
  "ออเดอร์นี้มีใบลดหนี้บางส่วนแล้ว — ยกเลิกทั้งออเดอร์ไม่ได้ (สต็อกและภาษีจะคืนซ้ำ) ให้กด ออกใบลดหนี้ สำหรับส่วนที่เหลือแทน";

/**
 * D160 — บรรทัด "มูลค่าตามใบกำกับภาษีเดิม" บนใบลดหนี้ใบที่ 2 เป็นต้นไป
 * ม.86/10(5) ถามมูลค่า **ตามใบกำกับเดิม** — ไม่ใช่ยอดที่เหลือหลังลดหนี้ครั้งก่อน
 * ⇒ แสดงยอดใบกำกับจริง (Σ ก่อน VAT ของใบที่อ้าง · แช่ไว้ใน refs) แล้วหักใบลดหนี้ก่อนหน้าเป็นอีกบรรทัด
 *    ให้ เดิม − ก่อนหน้า − ผลต่าง = ที่ถูกต้อง บวกลบลงตัวบนกระดาษ
 * ★ อ่านจากแถวที่บันทึกไว้ทั้งหมด → พิมพ์ซ้ำไม่ขยับ · ใบแรก/ยกเลิกทั้งออเดอร์ prior = 0 (หน้าตาเดิมเป๊ะ)
 */
export function cnInvoiceLines(refs: { preVat: number }[], original: number): { invoice: number; prior: number } {
  const invoice = Math.round(refs.reduce((s, r) => s + (Number(r.preVat) || 0), 0) * 100) / 100;
  const prior = Math.round((invoice - original) * 100) / 100;
  // refs ว่าง/ข้อมูลเก่าไม่ครบ = ไม่เดา ใช้ยอดที่บันทึกไว้ตามเดิม
  return prior > 0.004 ? { invoice, prior } : { invoice: original, prior: 0 };
}
