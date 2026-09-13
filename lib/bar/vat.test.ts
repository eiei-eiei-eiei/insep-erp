import { describe, it, expect } from "vitest";
import { vatFromGross, vatLabel, VAT_RATE } from "./vat";
import { barTotals } from "./totals";
import { discountBaht } from "./discount";
import type { CartLine } from "./types";

/** golden **B11** — ถอด VAT จากราคาที่รวมภาษีแล้ว (D96 ภาค 2 เฟส F) */

describe("vatFromGross (golden B11)", () => {
  it("260 รวม VAT → ฐาน 242.99 + ภาษี 17.01", () => {
    expect(vatFromGross(260)).toEqual({ base: 242.99, vat: 17.01, gross: 260 });
  });

  it("ยอดกลม ๆ ที่คนคิดในใจได้", () => {
    expect(vatFromGross(107)).toEqual({ base: 100, vat: 7, gross: 107 });
    expect(vatFromGross(1070)).toEqual({ base: 1000, vat: 70, gross: 1070 });
  });

  /**
   * 🚩 **ข้อสำคัญที่สุดของชุดนี้** — ยอดรวมบนใบกำกับต้องตรงกับเงินที่รับเป๊ะ
   *    ถ้าคิด base กับ vat แยกสูตรกัน จะมีใบที่ `base + vat ≠ gross` โผล่มาเป็นระยะ
   *    ซึ่งลูกค้าอ่านแล้วจับได้ทันที
   */
  it("🚨 base + vat = gross เสมอ ทุกยอดตั้งแต่ 0.01 ถึง 5000 บาท", () => {
    for (let cents = 1; cents <= 500000; cents += 7) {
      const g = cents / 100;
      const { base, vat, gross } = vatFromGross(g);
      expect(Math.round((base + vat) * 100)).toBe(Math.round(gross * 100));
    }
  });

  it("ยอด 0 / ติดลบ → 0 ทั้งชุด (ไม่มีอะไรให้ถอด)", () => {
    expect(vatFromGross(0)).toEqual({ base: 0, vat: 0, gross: 0 });
    expect(vatFromGross(-100)).toEqual({ base: 0, vat: 0, gross: 0 });
  });

  it("อัตรา 0 → ไม่มีภาษี ฐานเท่ายอดรวม", () => {
    expect(vatFromGross(260, 0)).toEqual({ base: 260, vat: 0, gross: 260 });
  });

  it("ค่าที่ไม่ใช่ตัวเลข → 0 ไม่ใช่ NaN บนใบกำกับ", () => {
    expect(vatFromGross(Number.NaN)).toEqual({ base: 0, vat: 0, gross: 0 });
  });

  it("อัตรามาตรฐานคือ 7 และ label อ่านรู้เรื่อง", () => {
    expect(VAT_RATE).toBe(7);
    expect(vatLabel()).toBe("ภาษีมูลค่าเพิ่ม 7%");
  });
});

/**
 * 🚩 ถอดจาก **ยอดสุทธิหลังส่วนลดและปัดเศษ** ไม่ใช่จาก subTotal
 *    ถอดผิดจังหวะ = ภาษีขายที่ยื่นสูงกว่าเงินที่รับจริง
 */
describe("🚩 จังหวะที่ถอด VAT — ต้องเป็นยอดสุทธิเท่านั้น", () => {
  const line = (qty: number, price: number, over: Partial<CartLine> = {}): CartLine => ({
    menuId: "BM1", menuName: "Negroni", qty, price, ...over,
  });

  it("มีส่วนลดท้ายบิล → ภาษีต้องคิดจากยอดหลังลด", () => {
    const lines = [line(2, 260)];
    const sub = barTotals(lines, {}).subTotal; // 520
    const t = barTotals(lines, { discount: discountBaht({ mode: "pct", value: 10 }, sub) });
    expect(t.grandTotal).toBe(468);

    const v = vatFromGross(t.grandTotal);
    expect(v.vat).toBe(30.62); // ไม่ใช่ 34.02 (7/107 ของ 520)
    expect(v.base + v.vat).toBe(468);
  });

  it("เปิดปัดเศษเงินสด → ภาษีคิดจากยอดที่ปัดแล้ว (เงินที่รับจริง)", () => {
    const t = barTotals([line(1, 133)], { discount: 19.95, roundCash: true });
    expect(t.grandTotal).toBe(113);
    const v = vatFromGross(t.grandTotal);
    expect(v.gross).toBe(113);
    expect(v.base + v.vat).toBe(113);
  });

  it("บิลที่แถมทั้งใบ (ยอด 0) → ไม่มีภาษี ไม่ใช่ค่าติดลบ", () => {
    const t = barTotals([line(1, 260, { isComp: true })], {});
    expect(t.grandTotal).toBe(0);
    expect(vatFromGross(t.grandTotal)).toEqual({ base: 0, vat: 0, gross: 0 });
  });
});
