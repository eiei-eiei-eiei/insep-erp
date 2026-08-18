import type { Employee, PayRates, TaxAllowance } from "./types";

/**
 * lib/payroll/tax — ภาษีเงินได้หัก ณ ที่จ่าย ของเงินเดือน (เงินได้ 40(1))
 *
 * วิธีที่กฎหมายกำหนดคือ **ประมาณการทั้งปีแล้วหารเฉลี่ย** ไม่ใช่คิดจากเงินได้เดือนนั้นตรง ๆ
 *   เงินได้ทั้งปี (ประมาณการ) − ค่าใช้จ่าย − ค่าลดหย่อน → ภาษีขั้นบันได → เฉลี่ยลงแต่ละเดือน
 *
 * 🚨 ขั้นบันไดและค่าลดหย่อนมาจาก `PayRates` ที่เลือกตามวันเริ่มมีผล ไม่ใช่ค่าคงที่ในไฟล์นี้
 */

/** ภาษีทั้งปีจากเงินได้สุทธิ ตามขั้นบันได (ปัดเป็นจำนวนเต็มบาท) */
export function annualPIT(netTaxable: number, brackets: PayRates["pitBrackets"]): number {
  let net = Math.max(0, Number.isFinite(netTaxable) ? netTaxable : 0);
  if (net <= 0) return 0;

  let tax = 0;
  let prev = 0;
  for (const b of brackets) {
    if (net > b.upTo) {
      tax += (b.upTo - prev) * b.rate;
      prev = b.upTo;
    } else {
      tax += (net - prev) * b.rate;
      net = 0;
      break;
    }
  }
  // เงินได้ทะลุขั้นสุดท้าย (ขั้นบนสุดตั้ง upTo ไม่ถึง Infinity) → ใช้อัตราขั้นสุดท้ายต่อ
  if (net > prev) tax += (net - prev) * (brackets[brackets.length - 1]?.rate ?? 0);

  return Math.round(tax);
}

/** รวมค่าลดหย่อนของลูกจ้าง — ไม่ระบุ personal = ใช้ค่าปริยายจาก PayRates */
export function totalAllowance(a: TaxAllowance | undefined, rates: PayRates): number {
  const personal = a?.personal ?? rates.personalAllowance;
  return (
    n(personal) +
    n(a?.spouse) +
    n(a?.child) +
    n(a?.parent) +
    n(a?.insLife) +
    n(a?.insHealth) +
    n(a?.other)
  );
}

export type AnnualTaxBreakdown = {
  annualIncome: number;
  expense: number;
  otherIncome: number;
  allowance: number;
  netTaxable: number;
  annualTax: number;
};

/**
 * ภาษีทั้งปี (ประมาณการ) ของลูกจ้าง 1 คน
 *
 * @param monthlyIncome เงินได้ต่อเดือนที่ใช้ประมาณการ (ผู้เรียกเป็นคนตัดสินว่านับอะไรบ้าง)
 * @param monthsPerYear จำนวนเดือนที่ใช้ประมาณการ — ปกติ 12
 *
 * ⚠️ ข้อจำกัดที่รู้ตัว: นี่คือ "ประมาณการ" จากเงินได้ประจำ ไม่รวมโบนัส/OT ที่ยังไม่เกิด
 *    → ยอดหักรายเดือนจะไม่ตรงกับเงินได้จริงทั้งปีเป๊ะ ๆ ซึ่งเป็นเรื่องปกติของวิธีนี้
 *    (ส่วนต่างไปจบตอนลูกจ้างยื่น ภงด.91 เอง)
 */
export function computeAnnualTax(
  monthlyIncome: number,
  emp: Pick<Employee, "taxAllowances">,
  rates: PayRates,
  yearBE: string,
  monthsPerYear = 12,
): AnnualTaxBreakdown {
  const allow = emp.taxAllowances?.[yearBE];
  const annualIncome = n(monthlyIncome) * monthsPerYear;
  const expense = Math.min((annualIncome * rates.expenseRate) / 100, rates.expenseCap);
  const otherIncome = n(allow?.otherIncome);
  const allowance = totalAllowance(allow, rates);
  const netTaxable = Math.max(0, annualIncome - expense + otherIncome - allowance);
  return {
    annualIncome,
    expense,
    otherIncome,
    allowance,
    netTaxable,
    annualTax: annualPIT(netTaxable, rates.pitBrackets),
  };
}

/**
 * ภาษีที่ต้องหักในเดือนนี้ จากภาษีทั้งปี
 *
 * 🪤 **ปัดลง (floor) 11 เดือนแรก แล้วเดือนสุดท้ายรับเศษที่เหลือทั้งก้อน**
 *    เพื่อให้ผลรวมทั้งปีเท่ากับภาษีทั้งปีเป๊ะ · ถ้าใช้ round ทุกเดือนแทน
 *    ผลรวมจะเกิน/ขาดไปไม่กี่บาท แล้วยอดใน ภงด.1ก จะไม่ลงตัวกับที่หักจริง
 *
 * @param monthOfYear 1-12 (เดือนที่ 12 = เดือนสุดท้ายของปีภาษี)
 * @param monthsPerYear จำนวนงวดต่อปี — ปกติ 12
 */
export function monthlyWht(annualTax: number, monthOfYear: number, monthsPerYear = 12): number {
  const at = Math.round(n(annualTax));
  if (at <= 0) return 0;
  const perMonth = Math.floor(at / monthsPerYear);
  return monthOfYear >= monthsPerYear ? at - perMonth * (monthsPerYear - 1) : perMonth;
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}
