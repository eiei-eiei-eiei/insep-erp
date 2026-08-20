import { describe, it, expect } from "vitest";
import { shownLine, differsFromStored, round2 } from "./periodView";
import type { PayrollLine } from "./types";

const L = (net: number, gross = net): PayrollLine =>
  ({
    baseAmount: gross, items: [], ssoWageBase: 0, sso: 0, wht: 0,
    gross, taxableIncome: gross, deductions: 0, net, variables: {},
  }) as PayrollLine;

describe("shownLine — จะโชว์เลขเวอร์ชันไหน", () => {
  it("งวดร่าง → ค่าที่คิดสด (แก้ทะเบียนพนักงานแล้วต้องเห็นผลทันที)", () => {
    expect(shownLine(false, L(10000), L(12000))?.net).toBe(12000);
  });

  it("งวดที่ลงบัญชีแล้ว → ค่าที่แช่ไว้ (ต้องตรงกับที่ยื่น/ลงบัญชี)", () => {
    expect(shownLine(true, L(10000), L(12000))?.net).toBe(10000);
  });

  it("งวดร่างที่ยังไม่เคยบันทึก → ค่าที่คิดสด", () => {
    expect(shownLine(false, null, L(9000))?.net).toBe(9000);
  });

  it("ลงบัญชีแล้วแต่ไม่มีค่าแช่ไว้ (ไม่ควรเกิด) → ใช้ค่าสด ไม่ปล่อยหน้าว่าง", () => {
    expect(shownLine(true, null, L(9000))?.net).toBe(9000);
  });
});

describe("differsFromStored — ต้องโชว์คู่กันไหม", () => {
  it("ยอดสุทธิต่าง = ต้องเตือน", () => {
    expect(differsFromStored(L(10000), L(12000))).toBe(true);
  });

  it("สุทธิเท่ากันแต่รวมเงินได้ต่าง = ต้องเตือน (ข้างในขยับ)", () => {
    expect(differsFromStored(L(10000, 20000), L(10000, 21000))).toBe(true);
  });

  it("เท่ากันทุกตัว = ไม่เตือน", () => {
    expect(differsFromStored(L(10000, 20000), L(10000, 20000))).toBe(false);
  });

  it("🪤 เศษทศนิยมต่ำกว่าสตางค์ ต้องไม่ทำให้เตือนผิด ๆ", () => {
    expect(differsFromStored(L(10000), L(10000.0004))).toBe(false);
    expect(differsFromStored(L(10000), L(10000.01))).toBe(true);
  });

  it("ยังไม่เคยบันทึก / ยังไม่มีค่าแสดง = ไม่เตือน", () => {
    expect(differsFromStored(null, L(10000))).toBe(false);
    expect(differsFromStored(L(10000), undefined)).toBe(false);
  });
});

describe("round2", () => {
  it("ค่าที่ไม่ใช่ตัวเลขกลายเป็น 0 (ไม่ปล่อย NaN ไปเทียบ)", () => {
    expect(round2(Number.NaN)).toBe(0);
  });
});
