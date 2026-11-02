/**
 * lib/payroll/workDays — วันทำงานมาจากสูตรที่ลูกค้าตั้งเอง (D152)
 *
 * ★ engine (`calcPayrollLine`) ยังรับ `inputs.workDays` เป็นตัวเลขตัวเดียวเหมือนเดิม
 *   ไฟล์นี้คิดตัวเลขนั้นให้เสร็จก่อนส่งเข้า engine ⇒ งวดเก่าและสลิปไม่เปลี่ยนวิธีอ่าน
 *
 * 🚨 พรีวิวบนจอกับตอนบันทึกต้องเรียก `resolveWorkDays()` ตัวเดียวกัน (บทเรียน D75)
 *
 * ทำไมแยกตามชนิดค่าจ้าง ไม่ใช้สูตรเดียวทั้งบริษัท:
 *   รายเดือนลดตามวัน = ขาดจากวันมาตรฐาน · รายวัน = ได้เงินตามวันที่มาจริง
 *   ใช้ `วันมาตรฐาน − ลากิจ` กับคนรายวันที่มา 26 วัน จะคิดเงินแค่ 21 วัน
 */
import { appliesTo, resolveVariable } from "./calc";
import { VAR_SOURCE_SHORT, variableFormulaText } from "./varText";
import type { Employee, PayComponent, PayVariable, VarSource, WageType, WorkDayWageType } from "./types";

export const WAGE_LABEL: Record<WageType, string> = {
  monthly: "รายเดือน (เต็มจำนวน)",
  monthly_prorate: "รายเดือน (ลดตามวันมาทำงาน)",
  daily: "รายวัน",
};

/** ชนิดค่าจ้างทั้งหมด — ใช้สร้างช่องติ๊ก/ปุ่มดู */
export const WAGE_TYPES = Object.keys(WAGE_LABEL) as WageType[];

export const WORK_DAY_WAGE_TYPES: WorkDayWageType[] = ["monthly_prorate", "daily"];

/** สูตรวันทำงานเลือกได้แค่นี้ — ค่าจ้างและวันมาทำงานจริงคิดจากวันทำงาน อ้างแล้วจะวนกลับมาหาตัวเอง */
export const WORK_DAY_SOURCES: VarSource[] = ["work_days_std", "input", "constant"];

/** รหัสแถวสูตรวันทำงานตามชนิดค่าจ้าง — คงที่ เพราะมีได้ชนิดละ 1 แถว */
export const WORK_DAY_RULE_CODE: Record<WorkDayWageType, string> = {
  monthly_prorate: "workdays_prorate",
  daily: "workdays_daily",
};

export const WORK_DAY_RULE_NAME: Record<WorkDayWageType, string> = {
  monthly_prorate: "วันทำงาน (รายเดือนลดตามวันมาทำงาน)",
  daily: "วันทำงาน (รายวัน)",
};

/** แถวเริ่มต้นตอนรับลูกค้าใหม่ — ให้ผลเท่าพฤติกรรมเดิม (วันทำงาน = วันมาตรฐาน) */
export function defaultWorkDayRows(tenantId: string) {
  return WORK_DAY_WAGE_TYPES.map((wage) => ({
    tenant_id: tenantId,
    code: WORK_DAY_RULE_CODE[wage],
    name: WORK_DAY_RULE_NAME[wage],
    source: "work_days_std",
    steps: [],
    work_days_for: wage,
    sort: 0,
  }));
}

/** สูตรของชนิดค่าจ้างนี้ — ไม่มีแถว = undefined (คิดเป็นวันมาตรฐาน) */
export function ruleOf(rules: PayVariable[], wage: WageType): PayVariable | undefined {
  return rules.find((r) => r.workDaysFor === wage);
}

/** ข้อความผิดของสูตรวันทำงาน — null = ใช้ได้ */
export function workDayRuleError(rule: Pick<PayVariable, "source" | "inputKey" | "steps">): string | null {
  const slots = [{ kind: rule.source, inputKey: rule.inputKey }, ...(rule.steps ?? [])];
  for (const s of slots) {
    if (!WORK_DAY_SOURCES.includes(s.kind)) return "สูตรวันทำงานใช้ได้แค่ วันมาตรฐาน · ช่องกรอก · ค่าคงที่";
    if (s.kind === "input" && !s.inputKey) return "เลือกช่องกรอกที่จะใช้ในสูตรวันทำงาน";
  }
  return null;
}

/** วันทำงานตามสูตร — ไม่มีสูตร = วันมาตรฐาน · ลาเกินวันมาตรฐาน = 0 ไม่ติดลบ */
export function formulaWorkDays(
  rule: PayVariable | undefined,
  std: number,
  values: Record<string, number>,
): number {
  if (!rule) return Number(std) || 0;
  const v = resolveVariable(rule, {
    baseWage: 0, proratedBase: 0, workDaysStd: Number(std) || 0, workDaysActual: 0, hoursPerDay: 1, values,
  });
  return Math.max(0, v);
}

/**
 * วันทำงานที่ส่งเข้า engine
 *
 * ★ รายเดือนเต็ม: เงินไม่ขึ้นกับวันทำงาน ได้วันมาตรฐานเสมอ (ค่าเดียวกับที่ระบบเติมให้ก่อน D152)
 * ★ ค่าที่แก้รายคนชนะสูตร
 */
export function resolveWorkDays(
  wage: WageType,
  rules: PayVariable[],
  std: number,
  values: Record<string, number>,
  override: number | null | undefined,
): number {
  if (wage === "monthly") return Number(std) || 0;
  if (override != null) return Number(override);
  return formulaWorkDays(ruleOf(rules, wage), std, values);
}

/**
 * ค่าที่แก้รายคนของแถวที่บันทึกไว้
 *
 * 🪤 แถวก่อน D152 ไม่มีช่อง `workDaysOverride` — มีแต่ตัวเลขที่เติมหรือกรอกไว้
 *    เท่าค่าตั้งต้น = ยังไม่มีใครแตะ · ต่างจากค่าตั้งต้น = กรอกเอง ต้องเก็บไว้ ห้ามทิ้งเงียบ ๆ
 */
export function storedOverride(
  inputs: { workDays?: number; workDaysOverride?: number | null },
  baseline: number,
): number | null {
  if ("workDaysOverride" in inputs) return inputs.workDaysOverride ?? null;
  if (inputs.workDays == null || Number(inputs.workDays) === Number(baseline)) return null;
  return Number(inputs.workDays);
}

/** ค่าที่พิมพ์ลงช่องวันทำงาน — ว่างหรือเท่าสูตร = กลับไปใช้สูตร */
export function overrideFromInput(typed: number | "", formula: number): number | null {
  return typed === "" || typed === formula ? null : typed;
}

/** ข้อความสูตรวันทำงานของชนิดค่าจ้างนี้ */
export function workDayRuleText(
  wage: WageType,
  rules: PayVariable[],
  inputLabels?: Record<string, string>,
): string {
  if (wage === "monthly") return "ไม่ใช้วันทำงานคิดเงิน";
  const rule = ruleOf(rules, wage);
  return rule ? variableFormulaText(rule, inputLabels) : VAR_SOURCE_SHORT.work_days_std;
}

/** บรรทัดเหนือตารางงวด — เฉพาะชนิดค่าจ้างที่มีคนอยู่ในงวดนี้ */
export function workDayCaption(
  present: WageType[],
  rules: PayVariable[],
  inputLabels?: Record<string, string>,
): string {
  const lines = WORK_DAY_WAGE_TYPES
    .filter((w) => present.includes(w))
    .map((w) => `${WAGE_LABEL[w]} = ${workDayRuleText(w, rules, inputLabels)}`);
  return lines.length > 0 ? `วันทำงาน: ${lines.join(" · ")}` : "";
}

/** ค่าจ้างฐานคิดยังไง — ตรงกับขั้น 1 ของ `calcPayrollLine` */
export function wageBaseText(wage: WageType): string {
  if (wage === "monthly") return "เงินเดือน (เต็มจำนวน)";
  if (wage === "monthly_prorate") return "เงินเดือน ÷ วันมาตรฐาน × วันทำงาน";
  return "ค่าแรงต่อวัน × วันทำงาน";
}

/** รายการนี้ใช้กับชนิดค่าจ้างนี้ไหม — ไม่ดูกลุ่ม ใช้กับปุ่มดูบนหน้าตั้งค่า */
export function componentForWage(c: PayComponent, wage: WageType): boolean {
  return !c.wageTypes || c.wageTypes.length === 0 || c.wageTypes.includes(wage);
}

/** ข้อความในคอลัมน์ "ใช้กับ" */
export function wageTypesText(c: PayComponent): string {
  const list = c.wageTypes ?? [];
  return list.length === 0 || list.length === WAGE_TYPES.length
    ? "ทุกแบบ"
    : list.map((w) => WAGE_LABEL[w]).join(", ");
}

function usesStdDays(v: PayVariable): boolean {
  return v.source === "work_days_std" || (v.steps ?? v.divisors ?? []).some(
    (s) => s.kind === "work_days_std" && (s.op ?? "div") === "div",
  );
}

/**
 * การตั้งค่าที่เสี่ยงกับคนรายวัน — เตือนอย่างเดียว ไม่บล็อก
 * ★ ดูจากพนักงานจริง: บริษัทที่ไม่มีคนรายวัน หรือจำกัดรายการแล้ว จะไม่ขึ้นคำเตือน
 */
export function dailyWageWarnings(
  components: PayComponent[],
  variables: PayVariable[],
  employees: Pick<Employee, "wageType" | "groupCode">[],
): string[] {
  const daily = employees.filter((e) => e.wageType === "daily");
  const out: string[] = [];
  for (const c of components) {
    if (!daily.some((e) => appliesTo(c, e.groupCode, "daily"))) continue;
    const v = c.method === "variable" ? variables.find((x) => x.code === c.variableCode) : undefined;
    if (v && usesStdDays(v)) {
      out.push(`"${c.name}" ใช้ตัวแปร "${v.name}" ที่หารวันมาตรฐาน คนรายวันจะได้ยอดต่ำผิดปกติ — เปลี่ยนตัวตั้งเป็นค่าจ้างต่อวัน หรือไม่ให้รายการนี้ใช้กับรายวัน`);
    }
    if (c.prorateBase) {
      out.push(`"${c.name}" รวมกับค่าจ้างฐาน คนรายวันจะคิดเป็นบาทต่อวัน — ไม่ให้รายการนี้ใช้กับรายวัน ถ้าตัวเลขเป็นบาทต่อเดือน`);
    }
    if (c.method === "percent_base") {
      out.push(`"${c.name}" คิดเป็น % ของค่าจ้างฐาน คนรายวันจะคิดจากค่าแรงต่อวัน`);
    }
  }
  return out;
}

/** เปลี่ยนระหว่างรายวันกับรายเดือนแล้วตัวเลขยังเท่าเดิม — ความหมายของตัวเลขเปลี่ยนไป */
export function wageSwitchWarning(
  fromType: WageType | undefined,
  toType: WageType | undefined,
  fromWage: number | undefined,
  toWage: number | undefined,
): string | null {
  if (!fromType || !toType || !fromWage) return null;
  if ((fromType === "daily") === (toType === "daily") || Number(fromWage) !== Number(toWage)) return null;
  return fromType === "daily"
    ? `ตัวเลข ${Number(fromWage).toLocaleString()} เดิมคือค่าแรงต่อวัน ตอนนี้จะถูกใช้เป็นเงินเดือน — ตรวจตัวเลขก่อนบันทึก`
    : `ตัวเลข ${Number(fromWage).toLocaleString()} เดิมคือเงินเดือน ตอนนี้จะถูกใช้เป็นค่าแรงต่อวัน — ตรวจตัวเลขก่อนบันทึก`;
}

/** หน่วยของตัวเลขค่าจ้างในตารางพนักงาน */
export function wageUnit(wage: WageType): string {
  return wage === "daily" ? "/วัน" : "/เดือน";
}
