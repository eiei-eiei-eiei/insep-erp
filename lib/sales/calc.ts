/**
 * lib/sales/calc — สูตรเงินฝั่งขาย (S1, S4, S5, S8)
 *
 * ⚠️ โมเดลราคา = "รวม VAT แล้ว" (VAT-inclusive · DECISION D27 — ผู้ใช้เลือกวิธี C)
 *   ต่างจากระบบเดิม (VAT-exclusive) โดยเจตนา: ราคาเมนู/ตะกร้า = ราคาที่ลูกค้าจ่ายจริง
 *   → ยอดรวมกลมเป๊ะ (3×210 = 630.00) · VAT ถูก "ถอด" ออกจากยอดรวมด้วยการหาร 1.07
 *   S1 (ถอด VAT ตอนรับเงิน) ยังเหมือนเดิม เพราะเดิมก็ถอดจากยอดรับอยู่แล้ว → สอดคล้องกันพอดี
 *   - ตะกร้า/พิมพ์ ใช้ roundTo2 = Math.round((x+EPSILON)*100)/100
 *   - payload บัญชี (S1/S4) ใช้ round2 = Math.round(x*100)/100 (ไม่มี EPSILON)
 */

/** ปัดทศนิยม 2 ตำแหน่งแบบตะกร้า/พิมพ์ (มี EPSILON) */
export function roundTo2(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/** ปัด 2 ตำแหน่งแบบ payload บัญชี (ไม่มี EPSILON) */
export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * ── กิจการที่ไม่จด VAT (4.3) ─────────────────────────────────────────────────
 *
 * ทุกฟังก์ชันที่แตะ VAT รับ `isVat` เป็นพารามิเตอร์**ตัวท้ายและมีค่าปริยาย `true`**
 * → จุดเรียกเดิมและ golden test S1-S10 เดิม **ไม่ต้องแก้และต้องได้ผลเท่าเดิมทุกทศนิยม**
 *   (นั่นคือหลักฐานว่าเส้นทางของกิจการที่จด VAT ไม่ขยับ — ดู calc.test.ts)
 *
 * 🚨 ห้ามเปลี่ยนลำดับการปัดเศษ / ห้ามแตะ roundTo2 · round2
 *    ต่างระดับสตางค์ = ใบกำกับภาษีไม่ตรงกับ ภพ.30 ที่ยื่นไปแล้ว
 */

/** อัตรา VAT ที่ใช้จริงของกิจการนั้น — ไม่จด VAT = 0 (ตัวหารกลายเป็น 1 = ไม่ถอดอะไรเลย) */
function vatRate(isVat: boolean): number {
  return isVat ? 0.07 : 0;
}

/** ถอดราคาก่อน VAT จากราคารวม VAT (÷1.07) — โมเดล inclusive · ไม่จด VAT = คืนค่าเดิม */
export function exVatFromIncl(incl: number, isVat = true): number {
  return roundTo2(incl / (1 + vatRate(isVat)));
}

/** แปลงราคาก่อน VAT → ราคารวม VAT (×1.07) — ใช้ตอนผู้ใช้กรอกราคาก่อน VAT (สินค้านอกระบบ) */
export function inclFromExVat(exVat: number, isVat = true): number {
  return roundTo2(exVat * (1 + vatRate(isVat)));
}

// ── S8: สรุปยอดตะกร้า/ใบเสนอราคา (โมเดล inclusive) ─────────────────────────────
// item.price = ราคารวม VAT แล้ว (ต่อหน่วยขาย) · discount = ส่วนลดในรูปรวม VAT (บาท)
export type CartItem = { name: string; price: number; qty: number };
export type QuotationInput = {
  items: CartItem[];
  discount: number;
  isWhtRequired: boolean;
  whtPercent: number;
  isDepositRequired: boolean;
  depositPercent: number;
};
export type QuotationTotals = {
  grandIncl: number; // Σ ราคารวม VAT × qty (ก่อนหักส่วนลด) = ยอดที่ line item รวมได้
  subTotal: number; // ก่อน VAT ก่อนส่วนลด = grandIncl/1.07 (เก็บลง sales_orders + บัญชี)
  discountEx: number; // ส่วนลดในรูปก่อน VAT (เก็บลงบัญชี ให้ base−discount = subDiscount)
  subDiscount: number; // ก่อน VAT หลังส่วนลด = grand/1.07
  vatAmount: number; // VAT = grand − subDiscount
  grandTotal: number; // รวม VAT หลังส่วนลด = ยอดที่ลูกค้าจ่าย (กลมเป๊ะเมื่อไม่มีส่วนลด)
  whtAmount: number;
  netPayable: number; // grand − wht
  expectedDeposit: number;
};

/** Σ ราคารวม VAT × qty (ก่อนหักส่วนลด) */
export function cartTotalIncl(items: CartItem[]): number {
  return roundTo2(items.reduce((sum, item) => sum + item.price * item.qty, 0));
}

/** เงินมัดจำคาดหวัง (โมเดล inclusive) = grand × depositPct/100 (หัก WHT ตามสัดส่วน) */
export function expectedDeposit(input: QuotationInput, isVat = true): number {
  if (!input.isDepositRequired || !input.depositPercent) return 0;
  const grand = Math.max(0, roundTo2(cartTotalIncl(input.items) - (input.discount || 0)));
  const depositIncl = roundTo2(grand * (input.depositPercent / 100));
  // ไม่จด VAT → ฐาน WHT คือยอดมัดจำตรง ๆ (ตัวหารเป็น 1)
  const whtOnDeposit = input.isWhtRequired
    ? roundTo2((depositIncl / (1 + vatRate(isVat))) * (input.whtPercent / 100))
    : 0;
  return roundTo2(depositIncl - whtOnDeposit);
}

/**
 * สรุปยอดทั้งใบเสนอราคา (โมเดล inclusive)
 *
 * ไม่จด VAT: ราคาที่กรอก = ราคาที่ลูกค้าจ่าย ไม่มีอะไรให้ถอด
 *   → subTotal = grandIncl · subDiscount = grandTotal · vatAmount = 0 · discountEx = discount
 *   (ตัวหาร 1+0 = 1 ทำให้ได้ผลนี้เองโดยไม่ต้องแยก branch — ลดโอกาสสูตรสองชุดเพี้ยนจากกัน)
 */
export function quotationTotals(input: QuotationInput, isVat = true): QuotationTotals {
  const div = 1 + vatRate(isVat);
  const grandIncl = cartTotalIncl(input.items);
  const grandTotal = Math.max(0, roundTo2(grandIncl - (input.discount || 0)));
  const subDiscount = roundTo2(grandTotal / div);
  const vatAmount = roundTo2(grandTotal - subDiscount);
  const subTotal = roundTo2(grandIncl / div);
  const discountEx = roundTo2(subTotal - subDiscount);
  const whtAmount = input.isWhtRequired ? roundTo2(subDiscount * (input.whtPercent / 100)) : 0;
  const netPayable = roundTo2(grandTotal - whtAmount);
  return { grandIncl, subTotal, discountEx, subDiscount, vatAmount, grandTotal, whtAmount, netPayable, expectedDeposit: expectedDeposit(input, isVat) };
}

// ── S1: ถอด VAT/WHT จากยอดรับ (Orders.gs) — ตัวเลขนี้ไปลงบัญชีตรง ๆ ────────────
export type ReverseVat = { preVat: number; vat: number; wht: number };

/**
 * ถอด VAT/WHT จากยอดรับสุทธิ (accNet) ตามอัตรา WHT
 *   whtRate>0 : accPreVat = accNet / (1 + 0.07 − whtRate/100)
 *   ไม่มี WHT : accPreVat = accNet / 1.07
 *
 * ★ ไม่จด VAT: accPreVat = accNet / (1 − whtRate/100) · vat = 0
 *   ตรวจด้วยมือ: ลูกค้าเป็นหนี้ 100 · หัก ณ ที่จ่าย 3% → โอนมา 97
 *   → 97 / (1 − 0.03) = 100 ✓ ฐานภาษีถูก · wht = 3 ✓
 *   (WHT ยังคิดเสมอ — หัก ณ ที่จ่ายเป็นภาษีเงินได้ ไม่เกี่ยวกับการจด VAT)
 */
export function reverseVatWht(accNet: number, whtRate: number, roundVat = false, isVat = true): ReverseVat {
  const r = vatRate(isVat);
  const preVat = whtRate > 0 ? accNet / (1 + r - whtRate / 100) : accNet / (1 + r);
  const vat = preVat * r;
  const wht = preVat * (whtRate / 100);
  return roundVat ? { preVat: round2(preVat), vat: round2(vat), wht: round2(wht) } : { preVat, vat, wht };
}

/** reverseCalc ฝั่งพิมพ์เอกสาร (ใช้ roundTo2 มี EPSILON) */
export function reverseCalcPrint(netAmt: number, whtPct: number, isVat = true): ReverseVat {
  const r = vatRate(isVat);
  const preVat = whtPct > 0 ? netAmt / (1 + r - whtPct / 100) : netAmt / (1 + r);
  return { preVat: roundTo2(preVat), vat: roundTo2(preVat * r), wht: roundTo2(preVat * (whtPct / 100)) };
}

// ── S4: items ที่ส่งไปบัญชี (โมเดล inclusive) — เฉพาะ isFirstPayment ─────────────
export type AccItem = { itemName: string; quantity: number; inVat: number; exVat: number; totalPrice: number };

/** แปลง 1 รายการขาย (ราคารวม VAT) → item payload บัญชี: inVat=ราคารวม, exVat=ถอด VAT, total=exVat×qty
 *  ไม่จด VAT → exVat = ราคาที่กรอกตรง ๆ (ไม่มีอะไรให้ถอด) */
export function toAccItem(name: string, qty: number, priceIncl: number, isVat = true): AccItem {
  const exVat = round2(priceIncl / (1 + vatRate(isVat)));
  return {
    itemName: name,
    quantity: qty,
    inVat: round2(priceIncl),
    exVat,
    totalPrice: round2(exVat * qty),
  };
}

// ── S5: taxDocNo fallback chain (Orders.gs) ──────────────────────────────────
/**
 * เลขเอกสารภาษีที่ส่งไปบัญชี: taxNo2(ใหม่) → taxNo1(ใหม่) → invNo(ใหม่)
 *   → taxNo2(เดิม) → taxNo1(เดิม) → invNo(เดิม) → "-"
 */
export type DocNoSlots = {
  taxNo2?: string;
  taxNo1?: string;
  /** D89 — ช่องใบเสร็จของกิจการที่ไม่จด VAT (คู่ขนานกับ taxNo1/taxNo2) */
  rcptNo2?: string;
  rcptNo1?: string;
  invNo?: string;
};

export function taxDocNo(updated: DocNoSlots, existing: DocNoSlots): string {
  // ★ ใบหนึ่งเป็นได้แค่ฝั่งเดียว (จด VAT มีแต่ taxNo · ไม่จดมีแต่ rcptNo)
  //   ลำดับจึงเป็น "ช่อง 2 ก่อนช่อง 1" เหมือนเดิม แค่แทรก rcpt ไว้ข้างคู่ของมัน
  return (
    updated.taxNo2 ||
    updated.rcptNo2 ||
    updated.taxNo1 ||
    updated.rcptNo1 ||
    updated.invNo ||
    existing.taxNo2 ||
    existing.rcptNo2 ||
    existing.taxNo1 ||
    existing.rcptNo1 ||
    existing.invNo ||
    "-"
  );
}
