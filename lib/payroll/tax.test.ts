import { describe, it, expect } from "vitest";
import { annualPIT, computeAnnualTax, monthlyWht, totalAllowance } from "./tax";
import type { PayRates } from "./types";

/**
 * ภาษีหัก ณ ที่จ่ายของเงินเดือน — วิธี "ประมาณการทั้งปีแล้วเฉลี่ย"
 * ตัวเลขคาดหวังคำนวณมือจากขั้นบันไดตรง ๆ (แพตเทิร์นเดียวกับ lib/accounting/calc.test.ts)
 */

const BRACKETS: PayRates["pitBrackets"] = [
  { upTo: 150000, rate: 0 },
  { upTo: 300000, rate: 0.05 },
  { upTo: 500000, rate: 0.1 },
  { upTo: 750000, rate: 0.15 },
  { upTo: 1000000, rate: 0.2 },
  { upTo: 2000000, rate: 0.25 },
  { upTo: 5000000, rate: 0.3 },
  { upTo: 1e15, rate: 0.35 },
];

const RATES: PayRates = {
  effectiveFrom: "2026-01-01",
  ssoRate: 5,
  ssoWageMin: 1650,
  ssoWageMax: 17500,
  pitBrackets: BRACKETS,
  personalAllowance: 60000,
  expenseRate: 50,
  expenseCap: 100000,
};

describe("annualPIT — ขั้นบันไดทุกช่วง", () => {
  it("ไม่ถึงเกณฑ์ = 0", () => {
    expect(annualPIT(0, BRACKETS)).toBe(0);
    expect(annualPIT(150000, BRACKETS)).toBe(0);
    expect(annualPIT(-5000, BRACKETS)).toBe(0);
  });

  it("ขั้น 5% — 200,000 → (200000−150000)×5% = 2,500", () => {
    expect(annualPIT(200000, BRACKETS)).toBe(2500);
  });

  it("ขอบขั้น 5% — 300,000 → 7,500", () => {
    expect(annualPIT(300000, BRACKETS)).toBe(7500);
  });

  it("ข้าม 2 ขั้น — 500,000 → 7,500 + 200,000×10% = 27,500", () => {
    expect(annualPIT(500000, BRACKETS)).toBe(27500);
  });

  it("ข้าม 3 ขั้น — 750,000 → 27,500 + 250,000×15% = 65,000", () => {
    expect(annualPIT(750000, BRACKETS)).toBe(65000);
  });

  it("ขั้นบนสุด — 6,000,000 → 965,000 + 1,000,000×35% = 1,315,000", () => {
    // 7500 + 20000 + 37500 + 50000 + 250000 + 900000 = 1,265,000 ที่ 5,000,000
    expect(annualPIT(5000000, BRACKETS)).toBe(1265000);
    expect(annualPIT(6000000, BRACKETS)).toBe(1265000 + 350000);
  });
});

describe("monthlyWht — 🪤 floor 11 เดือน แล้วเดือนสุดท้ายรับเศษ", () => {
  it("ภาษีปี 2,500 → 11 เดือนแรกเดือนละ 208 · เดือน 12 = 212", () => {
    expect(monthlyWht(2500, 1)).toBe(208);
    expect(monthlyWht(2500, 11)).toBe(208);
    expect(monthlyWht(2500, 12)).toBe(212);
  });

  it("★ รวมทั้งปีต้องเท่ากับภาษีปีเป๊ะ (ไม่งั้น ภงด.1ก ไม่ลงตัวกับที่หักจริง)", () => {
    for (const annual of [2500, 7500, 12345, 99999, 1]) {
      let sum = 0;
      for (let m = 1; m <= 12; m++) sum += monthlyWht(annual, m);
      expect(sum, `ภาษีปี ${annual}`).toBe(annual);
    }
  });

  it("ภาษีปีหารลงตัว — ทุกเดือนเท่ากัน", () => {
    expect(monthlyWht(12000, 1)).toBe(1000);
    expect(monthlyWht(12000, 12)).toBe(1000);
  });

  it("ไม่มีภาษี = 0 ทุกเดือน (รวมเดือนสุดท้าย)", () => {
    expect(monthlyWht(0, 12)).toBe(0);
    expect(monthlyWht(-100, 12)).toBe(0);
  });
});

describe("totalAllowance", () => {
  it("ไม่ระบุค่าลดหย่อนส่วนตัว = ใช้ค่าปริยายจากอัตรา", () => {
    expect(totalAllowance(undefined, RATES)).toBe(60000);
    expect(totalAllowance({}, RATES)).toBe(60000);
  });

  it("ระบุเองแล้วใช้ค่าที่ระบุ (บางคนใช้สิทธิ์ไม่เต็ม)", () => {
    expect(totalAllowance({ personal: 30000 }, RATES)).toBe(30000);
  });

  it("รวมทุกช่อง · otherIncome ไม่ใช่ค่าลดหย่อน ไม่ถูกนับ", () => {
    expect(
      totalAllowance(
        { spouse: 60000, child: 30000, insLife: 100000, other: 10000, otherIncome: 999999 },
        RATES,
      ),
    ).toBe(60000 + 60000 + 30000 + 100000 + 10000);
  });
});

describe("computeAnnualTax — ประมาณการทั้งปี", () => {
  it("เดือนละ 30,000 · ลดหย่อนปริยาย → ภาษีปี 2,500", () => {
    const r = computeAnnualTax(30000, {}, RATES, "2569");
    expect(r.annualIncome).toBe(360000);
    expect(r.expense).toBe(100000); // 50% = 180,000 แต่ติดเพดาน 100,000
    expect(r.allowance).toBe(60000);
    expect(r.netTaxable).toBe(200000);
    expect(r.annualTax).toBe(2500);
  });

  it("★ ค่าใช้จ่าย 50% ไม่ติดเพดานเมื่อรายได้น้อย — เดือนละ 12,000", () => {
    const r = computeAnnualTax(12000, {}, RATES, "2569");
    expect(r.annualIncome).toBe(144000);
    expect(r.expense).toBe(72000); // 50% ของ 144,000 ยังไม่ถึงเพดาน
    expect(r.netTaxable).toBe(12000); // 144000 − 72000 − 60000
    expect(r.annualTax).toBe(0); // ยังไม่ถึงขั้นแรก 150,000 → ไม่ต้องหักภาษี
  });

  it("ค่าลดหย่อนของลูกจ้างแยกตามปีภาษี — ปีที่ไม่มีข้อมูลใช้ค่าปริยาย", () => {
    const empWith = { taxAllowances: { "2569": { spouse: 60000 } } };
    const y69 = computeAnnualTax(30000, empWith, RATES, "2569");
    const y70 = computeAnnualTax(30000, empWith, RATES, "2570");
    expect(y69.allowance).toBe(120000);
    expect(y69.annualTax).toBe(annualPIT(360000 - 100000 - 120000, BRACKETS));
    expect(y70.allowance).toBe(60000); // ปี 2570 ยังไม่กรอก → ปริยาย
  });

  it("เงินได้อื่นบวกหลังหักค่าใช้จ่าย (ไม่ได้หัก 50% ซ้ำ)", () => {
    const r = computeAnnualTax(30000, { taxAllowances: { "2569": { otherIncome: 50000 } } }, RATES, "2569");
    expect(r.netTaxable).toBe(250000); // 360000 − 100000 + 50000 − 60000
  });
});
