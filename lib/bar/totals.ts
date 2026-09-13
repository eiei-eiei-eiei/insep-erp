/**
 * lib/bar/totals — ยอดบิล · ส่วนลด 3 แบบ · ปัดเศษเงินสด (golden B4 · D96)
 *
 * ── 🚨 ลำดับการคิดถูกล็อกไว้โดยตั้งใจ ─────────────────────────────────────
 *      ส่วนลดต่อรายการ → รวมเป็นยอดก่อนส่วนลดท้ายบิล → ส่วนลดท้ายบิล → ปัดเศษ
 *   สลับลำดับเมื่อไหร่ **ยอดเปลี่ยนโดยไม่มีอะไรฟ้อง** (ส่วนลด 10% ท้ายบิลกับส่วนลด 10%
 *   ต่อรายการให้ผลไม่เท่ากันเมื่อมีอีกอย่างมาซ้อน) → golden B4 ล็อกลำดับนี้ไว้ทั้งชุด
 *
 * ── ส่วนลด 3 แบบที่ผู้ใช้สั่งให้มีครบ ──────────────────────────────────────
 *   1. ต่อรายการ (`lineDiscount`) — บาท
 *   2. ท้ายบิล   (`discount`)     — บาท
 *   3. ของแถม    (`isComp`)       — ยอดขาย 0 แต่ **ต้นทุนยังนับ** (อยู่ใน cost.ts)
 */
import type { CartLine } from "./types";

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * ยอดขายของ 1 บรรทัด
 * · ของแถม → 0 เสมอ (ไม่ว่าราคาหรือส่วนลดจะเป็นเท่าไร)
 * · ส่วนลดต่อรายการมากกว่ายอด → **0 ไม่ใช่ติดลบ** (บรรทัดติดลบ = ยอดบิลเพี้ยนแบบเงียบ)
 */
export function lineAmount(line: CartLine): number {
  if (line.isComp) return 0;
  const gross = line.qty * line.price;
  return round2(Math.max(0, gross - (line.lineDiscount ?? 0)));
}

export type BarTotals = {
  /** ยอดหลังหักส่วนลดต่อรายการแล้ว แต่ยังไม่หักส่วนลดท้ายบิล */
  subTotal: number;
  /** ส่วนลดท้ายบิลที่ใช้ได้จริง (ถูกจำกัดไม่ให้เกิน subTotal) */
  discount: number;
  /** ผลต่างจากการปัดเศษ — ติดลบ = ปัดลง · บวก = ปัดขึ้น · 0 = ไม่ได้เปิดใช้ */
  rounding: number;
  grandTotal: number;
  /** รวมส่วนลดต่อรายการทั้งบิล — ไว้โชว์บนสลิปว่าลดไปเท่าไร */
  lineDiscountTotal: number;
  /** จำนวนบรรทัดที่เป็นของแถม */
  compCount: number;
};

/**
 * คิดยอดทั้งบิล
 *
 * · `roundCash` = ปัดยอดสุทธิเป็นจำนวนเต็มบาท (ค่าปริยาย **ปิด** — ผู้ใช้ตั้งราคาไม่ให้มีเศษอยู่แล้ว)
 * 🪤 ส่วนลดท้ายบิลเกินยอด → ตัดให้เท่ากับยอด **ไม่ใช่ปล่อยให้ยอดสุทธิติดลบ**
 *    (บิลติดลบ = ตอนลงบัญชีรายวันจะกลายเป็นรายรับติดลบซึ่งไม่มีใครสังเกต)
 */
export function barTotals(
  cart: readonly CartLine[],
  opts: { discount?: number; roundCash?: boolean } = {},
): BarTotals {
  const subTotal = round2(cart.reduce((s, l) => s + lineAmount(l), 0));
  const lineDiscountTotal = round2(
    cart.reduce((s, l) => (l.isComp ? s : s + Math.min(l.lineDiscount ?? 0, l.qty * l.price)), 0),
  );
  const compCount = cart.filter((l) => l.isComp).length;

  const wanted = Math.max(0, opts.discount ?? 0);
  const discount = round2(Math.min(wanted, subTotal));
  const afterDiscount = round2(subTotal - discount);

  const rounded = opts.roundCash ? Math.round(afterDiscount) : afterDiscount;
  const rounding = round2(rounded - afterDiscount);

  return {
    subTotal,
    discount,
    rounding,
    grandTotal: round2(afterDiscount + rounding),
    lineDiscountTotal,
    compCount,
  };
}

/**
 * ยอดบิลจากแถวที่ยัง**ไม่ถูกยกเลิก**เท่านั้น
 * ★ ใช้ตอนยกเลิกรายการทีละแถวหลังปิดบิล (ข้อ D ของแผน) — ยอดต้องถูกเขียนทับใหม่
 *   ไม่ใช่ปล่อยให้ `grand_total` เดิมค้างอยู่ทั้งที่รายการหายไปแล้ว
 */
export function totalsOfLiveLines(
  lines: readonly (CartLine & { voidedAt?: string | null })[],
  opts: { discount?: number; roundCash?: boolean } = {},
): BarTotals {
  return barTotals(lines.filter((l) => !l.voidedAt), opts);
}
