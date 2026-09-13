import { describe, it, expect } from "vitest";
import { discountBaht, discountLabel, resolveLine, resolveLines, NO_DISCOUNT } from "./discount";
import { barTotals, lineAmount } from "./totals";
import type { CartLine } from "./types";

/**
 * golden **B10** — ส่วนลดแบบบาท/% (D96 ภาค 2)
 *
 * 🚩 ข้อสำคัญที่สุดของชุดนี้: **% ต้องถูกแปลงเป็นบาทก่อนเข้า `barTotals()` เสมอ**
 *    ⇒ golden B4 (ลำดับการคิดส่วนลด) ต้องผ่านโดยไม่ต้องแก้ไฟล์เทสของมันเลย
 */

const line = (over: Partial<CartLine> = {}): CartLine => ({
  menuId: "BM1",
  menuName: "Negroni",
  qty: 1,
  price: 260,
  ...over,
});

describe("discountBaht — แปลงส่วนลดเป็นเงินบาท (golden B10)", () => {
  it("โหมดบาท คืนค่าตามที่กรอก (ปัด 2 ตำแหน่ง)", () => {
    expect(discountBaht({ mode: "baht", value: 50 }, 520)).toBe(50);
    expect(discountBaht({ mode: "baht", value: 12.345 }, 520)).toBe(12.35);
  });

  it("โหมด % คิดจากฐานที่ส่งเข้ามา", () => {
    expect(discountBaht({ mode: "pct", value: 10 }, 520)).toBe(52);
    expect(discountBaht({ mode: "pct", value: 15 }, 133)).toBe(19.95);
  });

  it("% เกิน 100 ตัดที่ 100 — ยอดเป็น 0 ไม่ใช่ติดลบ", () => {
    expect(discountBaht({ mode: "pct", value: 150 }, 520)).toBe(520);
    expect(discountBaht({ mode: "pct", value: 100 }, 520)).toBe(520);
  });

  it("ค่าติดลบ / ศูนย์ / ไม่ใช่ตัวเลข → 0 ทั้งสองโหมด", () => {
    expect(discountBaht({ mode: "pct", value: -10 }, 520)).toBe(0);
    expect(discountBaht({ mode: "baht", value: -10 }, 520)).toBe(0);
    expect(discountBaht({ mode: "pct", value: 0 }, 520)).toBe(0);
    expect(discountBaht({ mode: "baht", value: Number.NaN }, 520)).toBe(0);
    expect(discountBaht(null, 520)).toBe(0);
    expect(discountBaht(NO_DISCOUNT, 520)).toBe(0);
  });

  it("ฐานเป็น 0 หรือติดลบ → ไม่มีอะไรให้ลด", () => {
    expect(discountBaht({ mode: "pct", value: 10 }, 0)).toBe(0);
    expect(discountBaht({ mode: "pct", value: 10 }, -100)).toBe(0);
  });

  it("🚨 โหมดบาทไม่ตัดเพดานที่นี่ — คนตัดคือ barTotals/lineAmount ที่รู้ยอดจริง", () => {
    // ตัดสองที่ = วันหนึ่งจะไม่ตรงกัน → ที่นี่ปล่อยผ่าน แล้วให้ปลายทางตัด
    expect(discountBaht({ mode: "baht", value: 9999 }, 520)).toBe(9999);
    expect(barTotals([line({ qty: 2, price: 260 })], { discount: 9999 }).grandTotal).toBe(0);
  });
});

describe("discountLabel — ข้อความกำกับ", () => {
  it("โหมด % คืนข้อความ · โหมดบาทคืน null (ตัวเลขเงินอธิบายตัวเองแล้ว)", () => {
    expect(discountLabel({ mode: "pct", value: 10 })).toBe("10%");
    expect(discountLabel({ mode: "pct", value: 150 })).toBe("100%");
    expect(discountLabel({ mode: "baht", value: 50 })).toBeNull();
    expect(discountLabel({ mode: "pct", value: 0 })).toBeNull();
    expect(discountLabel(null)).toBeNull();
  });
});

describe("resolveLine — บรรทัดที่ลดเป็น % ต้องคิดบาทสดตามจำนวนล่าสุด", () => {
  it("ไม่มี pct = คืนบรรทัดเดิมไม่แตะอะไร", () => {
    const l = line({ lineDiscount: 10 });
    expect(resolveLine(l)).toBe(l);
  });

  it("มี pct → เขียน lineDiscount จากฐาน ราคา × จำนวน", () => {
    expect(resolveLine(line({ qty: 1, price: 260, lineDiscountPct: 10 })).lineDiscount).toBe(26);
  });

  it("🚨 กดเพิ่มจำนวนแล้วส่วนลด % ต้องโตตาม (ไม่ค้างที่ของจำนวนเดิม)", () => {
    const one = resolveLine(line({ qty: 1, price: 260, lineDiscountPct: 10 }));
    const two = resolveLine(line({ qty: 2, price: 260, lineDiscountPct: 10 }));
    expect(one.lineDiscount).toBe(26);
    expect(two.lineDiscount).toBe(52);
    expect(lineAmount(two)).toBe(468); // 520 − 52
  });

  it("ของแถมยังยอด 0 เสมอ ไม่ว่าจะลดกี่ %", () => {
    expect(lineAmount(resolveLine(line({ qty: 2, lineDiscountPct: 50, isComp: true })))).toBe(0);
  });

  it("resolveLines ทำทั้งชุด", () => {
    const out = resolveLines([
      line({ qty: 2, price: 260, lineDiscountPct: 10 }),
      line({ menuId: "BM2", qty: 1, price: 100, lineDiscount: 20 }),
    ]);
    expect(out.map((l) => l.lineDiscount)).toEqual([52, 20]);
  });
});

describe("🚩 ฐานของ % ต่อรายการ กับ % ท้ายบิล ต้องต่างกันจริง (กติกาข้อสำคัญ)", () => {
  /**
   * 2 × 260 = 520
   *   · ลด 10% ต่อรายการ → 52 → subTotal 468
   *   · แล้วลด 10% ท้ายบิลจาก **468** → 46.80 → สุทธิ 421.20
   *   ≠ ลด 20% จาก 520 (= 416)
   */
  it("ลด 10% สองชั้น ≠ ลด 20% ชั้นเดียว", () => {
    const lines = resolveLines([line({ qty: 2, price: 260, lineDiscountPct: 10 })]);
    const sub = barTotals(lines, {}).subTotal;
    expect(sub).toBe(468);

    const billDisc = discountBaht({ mode: "pct", value: 10 }, sub);
    expect(billDisc).toBe(46.8);
    expect(barTotals(lines, { discount: billDisc }).grandTotal).toBe(421.2);

    const flat20 = discountBaht({ mode: "pct", value: 20 }, 520);
    expect(barTotals([line({ qty: 2, price: 260 })], { discount: flat20 }).grandTotal).toBe(416);
  });

  it("% ท้ายบิลคิดจาก subTotal **หลัง** หักส่วนลดรายรายการ ไม่ใช่จากราคาเต็ม", () => {
    const lines = resolveLines([line({ qty: 1, price: 100, lineDiscountPct: 50 })]);
    expect(barTotals(lines, {}).subTotal).toBe(50);
    expect(discountBaht({ mode: "pct", value: 10 }, 50)).toBe(5); // ไม่ใช่ 10
  });

  it("ลด 100% ท้ายบิล → สุทธิ 0 พอดี ไม่ติดลบ", () => {
    const lines = [line({ qty: 1, price: 133 })];
    const d = discountBaht({ mode: "pct", value: 100 }, barTotals(lines, {}).subTotal);
    expect(barTotals(lines, { discount: d }).grandTotal).toBe(0);
  });

  it("ปัดเศษเงินสดยังทำงานหลังหัก % เหมือนเดิม", () => {
    const lines = [line({ qty: 1, price: 133 })];
    const d = discountBaht({ mode: "pct", value: 15 }, 133); // 19.95 → 113.05
    const t = barTotals(lines, { discount: d, roundCash: true });
    expect(t.discount).toBe(19.95);
    expect(t.grandTotal).toBe(113);
    expect(t.rounding).toBe(-0.05);
  });
});
