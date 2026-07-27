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

/** ถอดราคาก่อน VAT จากราคารวม VAT (÷1.07) — โมเดล inclusive */
export function exVatFromIncl(incl: number): number {
  return roundTo2(incl / 1.07);
}

/** แปลงราคาก่อน VAT → ราคารวม VAT (×1.07) — ใช้ตอนผู้ใช้กรอกราคาก่อน VAT (สินค้านอกระบบ) */
export function inclFromExVat(exVat: number): number {
  return roundTo2(exVat * 1.07);
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
export function expectedDeposit(input: QuotationInput): number {
  if (!input.isDepositRequired || !input.depositPercent) return 0;
  const grand = Math.max(0, roundTo2(cartTotalIncl(input.items) - (input.discount || 0)));
  const depositIncl = roundTo2(grand * (input.depositPercent / 100));
  const whtOnDeposit = input.isWhtRequired ? roundTo2((depositIncl / 1.07) * (input.whtPercent / 100)) : 0;
  return roundTo2(depositIncl - whtOnDeposit);
}

/** สรุปยอดทั้งใบเสนอราคา (โมเดล inclusive) */
export function quotationTotals(input: QuotationInput): QuotationTotals {
  const grandIncl = cartTotalIncl(input.items);
  const grandTotal = Math.max(0, roundTo2(grandIncl - (input.discount || 0)));
  const subDiscount = roundTo2(grandTotal / 1.07);
  const vatAmount = roundTo2(grandTotal - subDiscount);
  const subTotal = roundTo2(grandIncl / 1.07);
  const discountEx = roundTo2(subTotal - subDiscount);
  const whtAmount = input.isWhtRequired ? roundTo2(subDiscount * (input.whtPercent / 100)) : 0;
  const netPayable = roundTo2(grandTotal - whtAmount);
  return { grandIncl, subTotal, discountEx, subDiscount, vatAmount, grandTotal, whtAmount, netPayable, expectedDeposit: expectedDeposit(input) };
}

// ── S1: ถอด VAT/WHT จากยอดรับ (Orders.gs) — ตัวเลขนี้ไปลงบัญชีตรง ๆ ────────────
export type ReverseVat = { preVat: number; vat: number; wht: number };

/**
 * ถอด VAT/WHT จากยอดรับสุทธิ (accNet) ตามอัตรา WHT
 *   whtRate>0 : accPreVat = accNet / (1 + 0.07 − whtRate/100)
 *   ไม่มี WHT : accPreVat = accNet / 1.07
 */
export function reverseVatWht(accNet: number, whtRate: number, roundVat = false): ReverseVat {
  const preVat = whtRate > 0 ? accNet / (1 + 0.07 - whtRate / 100) : accNet / 1.07;
  const vat = preVat * 0.07;
  const wht = preVat * (whtRate / 100);
  return roundVat ? { preVat: round2(preVat), vat: round2(vat), wht: round2(wht) } : { preVat, vat, wht };
}

/** reverseCalc ฝั่งพิมพ์เอกสาร (ใช้ roundTo2 มี EPSILON) */
export function reverseCalcPrint(netAmt: number, whtPct: number): ReverseVat {
  const preVat = whtPct > 0 ? netAmt / (1 + 0.07 - whtPct / 100) : netAmt / 1.07;
  return { preVat: roundTo2(preVat), vat: roundTo2(preVat * 0.07), wht: roundTo2(preVat * (whtPct / 100)) };
}

// ── S4: items ที่ส่งไปบัญชี (โมเดล inclusive) — เฉพาะ isFirstPayment ─────────────
export type AccItem = { itemName: string; quantity: number; inVat: number; exVat: number; totalPrice: number };

/** แปลง 1 รายการขาย (ราคารวม VAT) → item payload บัญชี: inVat=ราคารวม, exVat=ถอด VAT, total=exVat×qty */
export function toAccItem(name: string, qty: number, priceIncl: number): AccItem {
  const exVat = round2(priceIncl / 1.07);
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
export function taxDocNo(
  updated: { taxNo2?: string; taxNo1?: string; invNo?: string },
  existing: { taxNo2?: string; taxNo1?: string; invNo?: string },
): string {
  return (
    updated.taxNo2 ||
    updated.taxNo1 ||
    updated.invNo ||
    existing.taxNo2 ||
    existing.taxNo1 ||
    existing.invNo ||
    "-"
  );
}
