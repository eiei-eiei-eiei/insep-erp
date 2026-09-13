import { describe, it, expect } from "vitest";
import { lineAmount, barTotals, totalsOfLiveLines } from "./totals";
import type { CartLine } from "./types";

/**
 * golden **B4** — ยอดบิล · ส่วนลด 3 แบบ · ปัดเศษ (D96)
 *
 * 🚨 ชุดนี้ล็อก **ลำดับการคิด** ไว้ด้วย ไม่ใช่แค่ผลลัพธ์:
 *    ส่วนลดต่อรายการ → รวม → ส่วนลดท้ายบิล → ปัดเศษ
 *    สลับลำดับแล้วยอดเปลี่ยนโดยไม่มีอะไรฟ้อง
 */

const L = (qty: number, price: number, extra: Partial<CartLine> = {}): CartLine => ({
  menuId: "M",
  menuName: "เมนู",
  qty,
  price,
  ...extra,
});

describe("ยอดต่อบรรทัด", () => {
  it("จำนวน × ราคา", () => {
    expect(lineAmount(L(3, 120))).toBe(360);
  });

  it("หักส่วนลดต่อรายการ", () => {
    expect(lineAmount(L(2, 100, { lineDiscount: 30 }))).toBe(170);
  });

  it("🚨 ของแถม = 0 เสมอ ไม่ว่าราคาจะเป็นเท่าไร", () => {
    expect(lineAmount(L(2, 260, { isComp: true }))).toBe(0);
    expect(lineAmount(L(1, 999, { isComp: true, lineDiscount: 10 }))).toBe(0);
  });

  it("🪤 ส่วนลดมากกว่ายอด → 0 ไม่ใช่ติดลบ (บรรทัดติดลบ = ยอดบิลเพี้ยนแบบเงียบ)", () => {
    expect(lineAmount(L(1, 100, { lineDiscount: 500 }))).toBe(0);
  });

  it("ทศนิยมปัด 2 ตำแหน่งให้ตรงกับ numeric(14,2) ฝั่ง DB", () => {
    expect(lineAmount(L(3, 33.333))).toBe(100);
  });
});

describe("ยอดทั้งบิล", () => {
  it("รวมทุกบรรทัด", () => {
    const t = barTotals([L(2, 260), L(1, 80)]);
    expect(t.subTotal).toBe(600);
    expect(t.grandTotal).toBe(600);
    expect(t.discount).toBe(0);
    expect(t.rounding).toBe(0);
  });

  it("ส่วนลดท้ายบิลหักจากยอดรวม", () => {
    const t = barTotals([L(2, 260)], { discount: 20 });
    expect(t.subTotal).toBe(520);
    expect(t.discount).toBe(20);
    expect(t.grandTotal).toBe(500);
  });

  it("🚨 ลำดับล็อก: ส่วนลดต่อรายการถูกหักก่อน แล้วส่วนลดท้ายบิลจึงหักจากยอดที่เหลือ", () => {
    // 2×260 = 520 − 20 (ต่อรายการ) = 500 − 50 (ท้ายบิล) = 450
    const t = barTotals([L(2, 260, { lineDiscount: 20 })], { discount: 50 });
    expect(t.subTotal).toBe(500);
    expect(t.grandTotal).toBe(450);
    expect(t.lineDiscountTotal).toBe(20);
  });

  it("🪤 ส่วนลดท้ายบิลเกินยอด → ตัดให้เท่ากับยอด ไม่ปล่อยให้บิลติดลบ", () => {
    const t = barTotals([L(1, 100)], { discount: 500 });
    expect(t.discount).toBe(100);
    expect(t.grandTotal).toBe(0);
  });

  it("ส่วนลดติดลบถือเป็น 0 (กันพิมพ์ผิดแล้วยอดพองขึ้น)", () => {
    expect(barTotals([L(1, 100)], { discount: -50 }).grandTotal).toBe(100);
  });

  it("ของแถมไม่เพิ่มยอด แต่ถูกนับจำนวนไว้โชว์บนสลิป", () => {
    const t = barTotals([L(1, 260), L(1, 260, { isComp: true })]);
    expect(t.subTotal).toBe(260);
    expect(t.compCount).toBe(1);
  });

  it("บิลว่าง = 0 ทุกช่อง ไม่ใช่ NaN", () => {
    const t = barTotals([]);
    expect(t).toMatchObject({ subTotal: 0, discount: 0, rounding: 0, grandTotal: 0 });
  });
});

describe("ปัดเศษเงินสด — ค่าปริยายต้องปิด", () => {
  it("ไม่เปิดใช้ = ยอดไม่ขยับและ rounding เป็น 0", () => {
    const t = barTotals([L(1, 260.4)]);
    expect(t.grandTotal).toBe(260.4);
    expect(t.rounding).toBe(0);
  });

  it("เปิดใช้แล้วปัดขึ้น — rounding เป็นบวก", () => {
    const t = barTotals([L(1, 260.6)], { roundCash: true });
    expect(t.grandTotal).toBe(261);
    expect(t.rounding).toBe(0.4);
  });

  it("เปิดใช้แล้วปัดลง — rounding เป็นลบ", () => {
    const t = barTotals([L(1, 260.4)], { roundCash: true });
    expect(t.grandTotal).toBe(260);
    expect(t.rounding).toBe(-0.4);
  });

  it("ยอดลงตัวอยู่แล้ว = ไม่มีการปัด", () => {
    expect(barTotals([L(1, 260)], { roundCash: true }).rounding).toBe(0);
  });

  it("🚨 ปัดเศษต้องเกิด **หลัง** ส่วนลดท้ายบิล — สลับลำดับแล้วยอดต่าง", () => {
    // 100.50 − 0.30 = 100.20 → ปัดเป็น 100
    // ถ้าปัดก่อนหักส่วนลดจะได้ 101 − 0.30 = 100.70 (ผิด)
    const t = barTotals([L(1, 100.5)], { discount: 0.3, roundCash: true });
    expect(t.grandTotal).toBe(100);
  });
});

describe("ยกเลิกรายการทีละแถว — ยอดต้องถูกคิดใหม่จากแถวที่ยังอยู่", () => {
  it("แถวที่ถูกยกเลิกไม่นับ (soft-void ไม่ลบแถวจริง)", () => {
    const t = totalsOfLiveLines([
      L(1, 260),
      { ...L(1, 100), voidedAt: "2026-09-10T18:00:00Z" },
    ]);
    expect(t.subTotal).toBe(260);
  });

  it("ยกเลิกหมดทุกแถว = ยอด 0 (ไม่ใช่ค้างยอดเดิมไว้)", () => {
    const t = totalsOfLiveLines([{ ...L(1, 260), voidedAt: "x" }]);
    expect(t.grandTotal).toBe(0);
  });

  it("ส่วนลดท้ายบิลถูกจำกัดตามยอดใหม่หลังยกเลิกแถว", () => {
    const t = totalsOfLiveLines(
      [L(1, 100), { ...L(1, 400), voidedAt: "x" }],
      { discount: 300 },
    );
    expect(t.discount).toBe(100);
    expect(t.grandTotal).toBe(0);
  });
});
