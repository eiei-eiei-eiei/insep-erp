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
  PayVariable,
  VarSource,
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

/** ค่าที่ตัวแปรกลางใช้เป็นตัวตั้ง/ตัวหารได้ */
export type VarContext = {
  baseWage: number;
  proratedBase: number;
  workDaysStd: number;
  workDaysActual: number;
  hoursPerDay: number;
  values: Record<string, number>;
};

/** อ่านค่าของ 1 ช่อง (ตัวตั้งหรือตัวหาร) จากชุดปิด */
function slotValue(
  kind: VarSource,
  ctx: VarContext,
  opt: { constValue?: number; inputKey?: string },
): number {
  switch (kind) {
    case "base_wage": return n(ctx.baseWage);
    case "prorated_base": return n(ctx.proratedBase);
    case "work_days_std": return n(ctx.workDaysStd);
    case "work_days_actual": return n(ctx.workDaysActual);
    case "hours_per_day": return n(ctx.hoursPerDay);
    case "input": return n(ctx.values[opt.inputKey ?? ""]);
    case "constant": return n(opt.constValue);
    default: return 0;
  }
}

/** ปัดค่าของตัวแปรกลาง — ไม่ระบุ = ไม่ปัด (พฤติกรรมเดิมก่อน D70 · ห้ามเปลี่ยนค่าปริยาย) */
export function applyVarRounding(x: number, r: PayVariable["rounding"]): number {
  if (!Number.isFinite(x)) return 0;
  if (r === "int") return Math.round(x);
  if (r === "dec2") return Math.round(x * 100) / 100;
  return x;
}

/**
 * ค่าของตัวแปรกลาง = ตัวตั้ง แล้วคิดทีละขั้น **เรียงซ้ายไปขวา ไม่มีลำดับความสำคัญ**
 *
 * 🚨 `ฐาน − A ÷ B` ที่นี่ = `((ฐาน − A) ÷ B)` ไม่ใช่ `ฐาน − (A ÷ B)` แบบกฎคณิตศาสตร์ —
 *    ไม่มี parser ไม่มีวงเล็บ ตั้งใจให้เส้นทางคำนวณนับได้จนครบ (กติกาเหล็กข้อ 1)
 *    → หน้าจอต้องโชว์วงเล็บตามลำดับที่คิดจริง ไม่งั้นลูกค้าอ่านผิดแล้วตั้งเกณฑ์ผิด
 *
 * 🪤 **หารด้วย 0 หรือค่าที่หาไม่ได้ = ข้ามขั้นนั้น ไม่ใช่ได้ Infinity**
 *    เดือนที่ยังไม่กรอกชั่วโมงโอทีจะได้ตัวหาร 0 เป็นเรื่องปกติ —
 *    ปล่อยเป็น Infinity แล้วยอดทั้งงวดกลายเป็น NaN แล้วบันทึกลง DB เงียบ ๆ
 * 🪤 แต่ **คูณด้วย 0 ไม่ข้าม** — ผลคือ 0 ซึ่งนิยามชัดเจนและถูกต้อง
 *    (ข้ามแล้วจะได้ค่าตั้งต้นกลับมา = ยอดพองขึ้นเงียบ ๆ ซึ่งอันตรายกว่ามาก)
 */
export function resolveVariable(v: PayVariable, ctx: VarContext): number {
  let out = slotValue(v.source, ctx, { constValue: v.constValue, inputKey: v.inputKey });
  // ★ `divisors` = ชื่อเดิมสมัยที่หารได้อย่างเดียว — อ่านต่อไว้โดยตั้งใจ 2 เหตุผล:
  //   1. golden test ชุดก่อน D70 เขียนด้วยชื่อนี้ → ผ่านได้**โดยไม่ต้องแก้ไฟล์เทส**
  //      = หลักฐานว่าการเพิ่มตัวดำเนินการไม่ได้ขยับผลลัพธ์ของเส้นทางเดิมเลย
  //   2. กันข้อมูล jsonb ที่เขียนไว้ก่อนเปลี่ยนชื่อคอลัมน์
  for (const s of v.steps ?? v.divisors ?? []) {
    const val = slotValue(s.kind, ctx, { constValue: s.value, inputKey: s.inputKey });
    if (!Number.isFinite(val)) continue;
    switch (s.op ?? "div") {
      case "add": out = out + val; break;
      case "sub": out = out - val; break;
      case "mul": out = out * val; break;
      default: if (val !== 0) out = out / val; break;
    }
  }
  return applyVarRounding(out, v.rounding);
}

/** ยอดของรายการ 1 ตัว (ยังไม่ปัด — ผู้เรียกเป็นคนปัด) */
function componentAmount(
  c: PayComponent,
  inputs: PeriodInputs,
  ctx: { wageBase: number; vars: Map<string, number> },
): number {
  switch (c.method) {
    case "fixed":
      return n(c.amount);
    case "per_unit":
      return n(c.amount) * inputValue(c, inputs.values);
    case "percent_base":
      return (ctx.wageBase * n(c.rate)) / 100;
    case "variable": {
      // ค่าตัวแปรกลาง × ตัวคูณ × ค่าจากช่องกรอก
      // ★ ไม่เลือกช่องกรอก = คูณ 1 (เช่นเบี้ยเหมาที่คิดจากอัตราต่อวันตรง ๆ)
      const base = ctx.vars.get(c.variableCode ?? "") ?? 0;
      const keys = c.inputKeys ?? [];
      const units = keys.length === 0 ? 1 : inputValue(c, inputs.values);
      return base * n(c.multiplier) * units;
    }
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
 * @param variables  ตัวแปรกลางที่ลูกค้านิยามไว้ — ไม่ส่งมา = รายการ method='variable' ได้ 0
 */
export function calcPayrollLine(
  emp: Employee,
  inputs: PeriodInputs,
  components: PayComponent[],
  rates: PayRates,
  settings: PayrollSettings,
  ctx: PeriodContext,
  variables: PayVariable[] = [],
): PayrollLine {
  const R = (v: number) => roundMoney(v, settings.rounding);
  const mine = components.filter((c) => appliesTo(c, emp.groupCode));
  const earnings = mine.filter((c) => c.kind === "earning");
  const deductionsCfg = mine.filter((c) => c.kind === "deduction");

  const workDaysStd = n(ctx.workDaysStd) || 1; // กันหารศูนย์
  const hoursPerDay = n(settings.hoursPerDay) || 1;

  // ── ขั้น 1-3(ก): ฐานที่ใช้ prorate = ค่าจ้าง + รายการที่ติดธง prorateBase ────
  //    (ค่าตำแหน่งมักติดธงนี้ = ลดตามวันมาทำงานไปด้วย)
  //    ★ ตอนนี้ยังไม่มีค่าตัวแปรกลาง — รายการที่ติด prorateBase จึงใช้ method ที่ไม่พึ่งตัวแปร
  //      (fixed / per_unit / manual) · ถ้าติด prorateBase + method=variable จะได้ 0 ซึ่งถูกต้อง
  //      เพราะตัวแปรส่วนใหญ่คิดจากค่าจ้างฐาน = อ้างวนกันเอง
  const emptyVars = new Map<string, number>();
  const prorateExtras = earnings
    .filter((c) => c.prorateBase)
    .reduce((s, c) => s + componentAmount(c, inputs, { wageBase: emp.baseWage, vars: emptyVars }), 0);

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

  // ── ขั้น 3(ข): คิดค่าตัวแปรกลางทั้งหมดก่อน แล้วรายการค่อยเอาไปคูณ ────────────
  //    ฐานที่ตัวแปรใช้ = ค่าจ้าง + เฉพาะรายการที่ติดธง otBase (ค่าตำแหน่งมักไม่ติด)
  //    ★ ลูกค้าเป็นคนนิยามสูตรของตัวแปรเอง — โค้ดไม่รู้จัก "อัตราต่อชั่วโมง" อีกแล้ว
  const otExtras = earnings
    .filter((c) => c.otBase)
    .reduce((s, c) => s + componentAmount(c, inputs, { wageBase: emp.baseWage, vars: emptyVars }), 0);
  const varWageBase = n(emp.baseWage) + otExtras;

  const varCtx: VarContext = {
    baseWage: varWageBase,
    proratedBase: baseAmount,
    workDaysStd,
    workDaysActual: n(inputs.workDays),
    hoursPerDay,
    values: inputs.values,
  };
  const vars = new Map<string, number>(
    (variables ?? [])
      .filter((v) => v.active !== false)
      .map((v) => [v.code, resolveVariable(v, varCtx)]),
  );

  // ── ขั้น 2: รายการเพิ่ม ──────────────────────────────────────────────────────
  //    ★ รายการที่ติด prorateBase ถูกนับไปแล้วในค่าจ้างฐาน — ห้ามนับซ้ำที่นี่
  const earnItems: PayLineItem[] = earnings
    .filter((c) => !c.prorateBase)
    .map((c) => ({
      code: c.code,
      name: c.name,
      kind: "earning" as const,
      amount: R(componentAmount(c, inputs, { wageBase: emp.baseWage, vars })),
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
      amount: R(componentAmount(c, inputs, { wageBase: emp.baseWage, vars })),
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
    // ★ คำนวณอยู่แล้วในขั้น 3(ค) — คืนออกมาเพื่อให้ถูกแช่ลง computed
    //   (เอกสารยื่นราชการต้องใช้ยอดนี้ ห้ามไปไล่อ่านธง taxable สดตอนออกเอกสาร)
    taxableIncome,
    deductions,
    net,
    // ค่าตัวแปรกลางที่คำนวณได้ในงวดนี้ — เก็บไว้ให้ตรวจย้อนหลังว่าอัตราที่ใช้คือเท่าไร
    variables: Object.fromEntries(vars),
  };
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}
