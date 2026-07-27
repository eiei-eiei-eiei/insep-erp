import { describe, it, expect } from "vitest";
import {
  roundTo2,
  round2,
  exVatFromIncl,
  inclFromExVat,
  cartTotalIncl,
  expectedDeposit,
  quotationTotals,
  reverseVatWht,
  reverseCalcPrint,
  toAccItem,
  taxDocNo,
  type QuotationInput,
} from "./calc";

// ── S8: ตะกร้า/ใบเสนอราคา (โมเดล VAT-inclusive · D27) ──────────────────────────
describe("S8 quotationTotals (inclusive)", () => {
  // ราคา 210 รวม VAT/ขวด
  const base: QuotationInput = {
    items: [{ name: "เหล้า", price: 210, qty: 1 }],
    discount: 0,
    isWhtRequired: false,
    whtPercent: 3,
    isDepositRequired: false,
    depositPercent: 50,
  };

  it("1 ขวด = 210.00 กลมเป๊ะ", () => {
    const t = quotationTotals(base);
    expect(t.grandTotal).toBe(210);
    expect(t.subDiscount).toBe(196.26); // 210/1.07
    expect(t.vatAmount).toBe(13.74);
    expect(t.netPayable).toBe(210);
  });

  it("3 ขวด = 630.00 กลมเป๊ะ (แก้ปัญหา 629.99)", () => {
    const t = quotationTotals({ ...base, items: [{ name: "เหล้า", price: 210, qty: 3 }] });
    expect(t.grandIncl).toBe(630);
    expect(t.grandTotal).toBe(630);
    expect(t.subDiscount).toBe(588.79); // 630/1.07 = 588.785 → 588.79
    expect(t.vatAmount).toBe(41.21); // 630 − 588.79
    expect(t.netPayable).toBe(630);
  });

  it("2 ขวด = 420.00", () => {
    const t = quotationTotals({ ...base, items: [{ name: "เหล้า", price: 210, qty: 2 }] });
    expect(t.grandTotal).toBe(420);
  });

  it("WHT 3% หักจากยอดก่อน VAT", () => {
    const t = quotationTotals({ ...base, items: [{ name: "เหล้า", price: 210, qty: 3 }], isWhtRequired: true });
    // subDiscount 588.79 × 3% = 17.66
    expect(t.whtAmount).toBe(17.66);
    expect(t.netPayable).toBe(roundTo2(630 - 17.66));
  });

  it("ส่วนลด (รวม VAT) 30 บาท → grand 600", () => {
    const t = quotationTotals({ ...base, items: [{ name: "เหล้า", price: 210, qty: 3 }], discount: 30 });
    expect(t.grandTotal).toBe(600);
    expect(t.subDiscount).toBe(roundTo2(600 / 1.07)); // 560.75
    // base−discount(ex) = subDiscount ต้อง reconcile
    expect(roundTo2(t.subTotal - t.discountEx)).toBe(t.subDiscount);
  });

  it("ส่วนลดไม่ทำให้ grand ติดลบ", () => {
    const t = quotationTotals({ ...base, discount: 9999 });
    expect(t.grandTotal).toBe(0);
  });

  it("มัดจำ 50% ของยอดรวม (inclusive) = 315", () => {
    expect(expectedDeposit({ ...base, items: [{ name: "เหล้า", price: 210, qty: 3 }], isDepositRequired: true })).toBe(315);
  });

  it("มัดจำ 50% + WHT 3%", () => {
    // depositIncl 315 − (315/1.07 × 3%) = 315 − 8.83 = 306.17
    const d = expectedDeposit({ ...base, items: [{ name: "เหล้า", price: 210, qty: 3 }], isDepositRequired: true, isWhtRequired: true });
    expect(d).toBe(roundTo2(315 - roundTo2((315 / 1.07) * 0.03)));
  });
});

describe("แปลงราคา incl/excl", () => {
  it("exVatFromIncl(210) = 196.26", () => {
    expect(exVatFromIncl(210)).toBe(196.26);
  });
  it("inclFromExVat(196.26) = 210.00", () => {
    expect(inclFromExVat(196.26)).toBe(210);
  });
  it("cartTotalIncl", () => {
    expect(cartTotalIncl([{ name: "a", price: 210, qty: 3 }])).toBe(630);
  });
});

// ── S1: ถอด VAT/WHT (Orders.gs) ─────────────────────────────────────────────
describe("S1 reverseVatWht", () => {
  it("ไม่มี WHT → หาร 1.07", () => {
    const r = reverseVatWht(630, 0, true);
    expect(r.preVat).toBe(588.79);
    expect(r.vat).toBe(41.21);
    expect(r.wht).toBe(0);
  });
  it("WHT 3% → หาร 1.04", () => {
    const r = reverseVatWht(1040, 3, true);
    expect(r.preVat).toBe(1000);
    expect(r.vat).toBe(70);
    expect(r.wht).toBe(30);
  });
});

describe("reverseCalcPrint (พิมพ์)", () => {
  it("net 315 ไม่มี WHT", () => {
    const r = reverseCalcPrint(315, 0);
    expect(r.preVat).toBe(294.39);
    expect(r.vat).toBe(20.61);
  });
});

// ── S4: items บัญชี (โมเดล inclusive) ────────────────────────────────────────
describe("S4 toAccItem (inclusive)", () => {
  it("inVat=ราคารวม, exVat=ถอด VAT, total=exVat×qty", () => {
    const it = toAccItem("เหล้า", 3, 210);
    expect(it.inVat).toBe(210);
    expect(it.exVat).toBe(196.26); // 210/1.07
    expect(it.totalPrice).toBe(round2(196.26 * 3)); // 588.78
  });
});

// ── S5: taxDocNo fallback chain ─────────────────────────────────────────────
describe("S5 taxDocNo", () => {
  it("taxNo2 ใหม่ มาก่อน", () => {
    expect(taxDocNo({ taxNo2: "T2", taxNo1: "T1", invNo: "I" }, {})).toBe("T2");
  });
  it("ตกไป invNo ใหม่ ก่อนค่าเดิม", () => {
    expect(taxDocNo({ invNo: "I" }, { taxNo1: "old1" })).toBe("I");
  });
  it("ไม่มีอะไรเลย → '-'", () => {
    expect(taxDocNo({}, {})).toBe("-");
  });
});

describe("round helpers", () => {
  it("roundTo2 มี EPSILON", () => {
    expect(roundTo2(1.005)).toBe(1.01);
  });
});
