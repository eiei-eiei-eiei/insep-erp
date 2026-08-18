import { ssoContribution, ssoWageBase } from "./sso";
import { computeAnnualTax, monthlyWht } from "./tax";
import type {
  Employee,
  PayComponent,
  PayLineItem,
  PayRates,
  PayrollLine,
  PayrollSettings,
  PeriodContext,
  PeriodInputs,
} from "./types";

/**
 * lib/payroll/calc — engine คำนวณเงินเดือน (pure · ไม่มี I/O)
 *
 * ═══ ลำดับ 7 ขั้นนี้ล็อกตายในโค้ด ห้ามให้ลูกค้าสลับ ═══
 *   1. ค่าจ้างฐาน (ตาม wageType)
 *   2. + รายการเพิ่ม            ← ลูกค้าเติมได้ไม่จำกัด
 *   3. แยกฐาน: prorate / OT / ภาษี / ประกันสังคม  ← ตามธง 4 ตัวของแต่ละรายการ
 *   4. − ประกันสังคม
 *   5. − ภาษีหัก ณ ที่จ่าย
 *   6. − รายการหัก              ← ลูกค้าเติมได้ไม่จำกัด
 *   7. = ยอดจ่ายจริง
 *
 * สลับลำดับเมื่อไหร่ = ตัวเลขที่ยื่น ภงด.1/สปส.1-10 ผิด → เปิดได้เฉพาะขั้น 2 กับ 6
 *
 * 🪤 การปัดเศษเป็นส่วนหนึ่งของสูตร: อัตรารายวัน/รายชั่วโมงคำนวณ **full precision
 *    ห้ามปัดก่อนคูณ** แล้วค่อยปัดผลลัพธ์ตาม settings.rounding
 *    ปัดผิดจังหวะ = ตัวเลขเพี้ยนทั้งงวดโดยไม่มีอะไรฟ้อง
 */

/** ปัดยอดเงินตามที่บริษัทตั้งไว้ (จำนวนเต็มบาท หรือทศนิยม 2 ตำแหน่ง) */
export function roundMoney(v: number, rounding: PayrollSettings["rounding"]): number {
  const x = Number.isFinite(v) ? v : 0;
  return rounding === "satang" ? Math.round(x * 100) / 100 : Math.round(x);
}

/** รายการนี้ใช้กับลูกจ้างคนนี้ไหม — ไม่ระบุกลุ่ม = ทุกคน */
export function appliesTo(c: PayComponent, groupCode: string | null | undefined): boolean {
  if (c.active === false) return false;
  if (!c.groupCodes || c.groupCodes.length === 0) return true;
  return groupCode != null && c.groupCodes.includes(groupCode);
}

/** ค่าที่ป้อนให้รายการนี้ จากช่องกรอกที่ผูกไว้ (sum หรือ avg) */
export function inputValue(c: PayComponent, values: Record<string, number>): number {
  const keys = c.inputKeys ?? [];
  if (keys.length === 0) return 0;
  const nums = keys.map((k) => n(values[k]));
  const sum = nums.reduce((a, b) => a + b, 0);
  return c.inputAgg === "avg" ? sum / nums.length : sum;
}

/** ค้นขั้นบันได — คืน amount ของขั้นแรกที่ค่า <= upTo · เกินทุกขั้น = 0 */
export function tierAmount(tiers: PayComponent["tiers"], value: number): number {
  for (const t of tiers ?? []) {
    if (value <= t.upTo) return n(t.amount);
  }
  return 0;
}

/** ยอดของรายการ 1 ตัว (ยังไม่ปัด — ผู้เรียกเป็นคนปัด) */
function componentAmount(
  c: PayComponent,
  inputs: PeriodInputs,
  ctx: { wageBase: number; hourlyRate: number },
): number {
  switch (c.method) {
    case "fixed":
      return n(c.amount);
    case "per_unit":
      return n(c.amount) * inputValue(c, inputs.values);
    case "percent_base":
      return (ctx.wageBase * n(c.rate)) / 100;
    case "hourly_multiplier":
      return ctx.hourlyRate * n(c.multiplier) * inputValue(c, inputs.values);
    case "tier_table":
      return tierAmount(c.tiers, inputValue(c, inputs.values));
    case "manual":
      return n(inputs.manual?.[c.code]);
    default:
      return 0;
  }
}

/**
 * คำนวณเงินเดือนของลูกจ้าง 1 คนในงวดหนึ่ง
 *
 * @param components รายการเพิ่ม/หักทั้งหมดของบริษัท (ฟังก์ชันกรองตามกลุ่มให้เอง)
 */
export function calcPayrollLine(
  emp: Employee,
  inputs: PeriodInputs,
  components: PayComponent[],
  rates: PayRates,
  settings: PayrollSettings,
  ctx: PeriodContext,
): PayrollLine {
  const R = (v: number) => roundMoney(v, settings.rounding);
  const mine = components.filter((c) => appliesTo(c, emp.groupCode));
  const earnings = mine.filter((c) => c.kind === "earning");
  const deductionsCfg = mine.filter((c) => c.kind === "deduction");

  const workDaysStd = n(ctx.workDaysStd) || 1; // กันหารศูนย์
  const hoursPerDay = n(settings.hoursPerDay) || 1;

  // ── ขั้น 1-3(ก): ฐานที่ใช้ prorate = ค่าจ้าง + รายการที่ติดธง prorateBase ────
  //    (ค่าตำแหน่งมักติดธงนี้ = ลดตามวันมาทำงานไปด้วย)
  const prorateExtras = earnings
    .filter((c) => c.prorateBase)
    .reduce((s, c) => s + componentAmount(c, inputs, { wageBase: emp.baseWage, hourlyRate: 0 }), 0);

  const fullWage = n(emp.baseWage) + prorateExtras;

  let baseAmount: number;
  switch (emp.wageType) {
    case "daily":
      // ค่าแรงต่อวัน — รายการ prorateBase ถือเป็นส่วนเพิ่มต่อวันเช่นกัน
      baseAmount = R(fullWage * n(inputs.workDays));
      break;
    case "monthly_prorate":
      // ★ full precision ก่อนคูณ — ปัดตรงนี้แล้วยอดจะเพี้ยนสะสม
      baseAmount = R((fullWage / workDaysStd) * n(inputs.workDays));
      break;
    default: // monthly
      baseAmount = R(fullWage);
  }

  // ── ขั้น 3(ข): อัตราต่อชั่วโมงสำหรับ OT ──────────────────────────────────────
  //    ฐาน OT = ค่าจ้าง + เฉพาะรายการที่ติดธง otBase (มักไม่รวมค่าตำแหน่ง)
  const otExtras = earnings
    .filter((c) => c.otBase)
    .reduce((s, c) => s + componentAmount(c, inputs, { wageBase: emp.baseWage, hourlyRate: 0 }), 0);
  const otWageBase = n(emp.baseWage) + otExtras;
  const hourlyRate =
    emp.wageType === "daily"
      ? otWageBase / hoursPerDay
      : otWageBase / workDaysStd / hoursPerDay;

  // ── ขั้น 2: รายการเพิ่ม ──────────────────────────────────────────────────────
  //    ★ รายการที่ติด prorateBase ถูกนับไปแล้วในค่าจ้างฐาน — ห้ามนับซ้ำที่นี่
  const earnItems: PayLineItem[] = earnings
    .filter((c) => !c.prorateBase)
    .map((c) => ({
      code: c.code,
      name: c.name,
      kind: "earning" as const,
      amount: R(componentAmount(c, inputs, { wageBase: emp.baseWage, hourlyRate })),
    }))
    .filter((i) => i.amount !== 0);

  const gross = R(baseAmount + earnItems.reduce((s, i) => s + i.amount, 0));

  // ── ขั้น 3(ค): ฐานประกันสังคม / ฐานภาษี ─────────────────────────────────────
  //    🚨 สองฐานนี้ไม่เท่ากัน — ค่าล่วงเวลา/โบนัสเข้าฐานภาษี แต่ไม่ใช่ "ค่าจ้าง" ของ สปส.
  const byCode = new Map(mine.map((c) => [c.code, c]));
  const sumFlagged = (flag: "ssoBase" | "taxable") =>
    earnItems.reduce((s, i) => s + (byCode.get(i.code)?.[flag] ? i.amount : 0), 0);

  const ssoWage = baseAmount + sumFlagged("ssoBase");
  const taxableIncome = baseAmount + sumFlagged("taxable");

  // ── ขั้น 4: ประกันสังคม ─────────────────────────────────────────────────────
  const sso = ssoContribution(ssoWage, rates, emp.ssoExempt);

  // ── ขั้น 5: ภาษีหัก ณ ที่จ่าย — override > fixed > auto ──────────────────────
  let wht = 0;
  if (inputs.whtOverride != null && Number.isFinite(Number(inputs.whtOverride))) {
    wht = Math.round(Number(inputs.whtOverride));
  } else if (emp.whtMode === "fixed") {
    wht = Math.round(n(emp.whtFixed));
  } else if (emp.whtMode === "auto") {
    const { annualTax } = computeAnnualTax(taxableIncome, emp, rates, ctx.yearBE);
    wht = monthlyWht(annualTax, ctx.monthOfYear);
  }

  // ── ขั้น 6: รายการหัก ───────────────────────────────────────────────────────
  const dedItems: PayLineItem[] = deductionsCfg
    .map((c) => ({
      code: c.code,
      name: c.name,
      kind: "deduction" as const,
      amount: R(componentAmount(c, inputs, { wageBase: emp.baseWage, hourlyRate })),
    }))
    .filter((i) => i.amount !== 0);

  const deductions = R(dedItems.reduce((s, i) => s + i.amount, 0));

  // ── ขั้น 7 ──────────────────────────────────────────────────────────────────
  const net = R(gross - sso - wht - deductions);

  return {
    baseAmount,
    items: [...earnItems, ...dedItems],
    ssoWageBase: ssoWageBase(ssoWage, rates),
    sso,
    wht,
    gross,
    deductions,
    net,
    hourlyRate,
  };
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}
