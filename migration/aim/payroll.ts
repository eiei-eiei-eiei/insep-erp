/**
 * migration/aim/payroll.ts — เงินเดือนของลูกค้า PAT&AIM → โมดูลเงินเดือนของ proof (D121)
 *
 * แอปเงินเดือนเดิม (clasp-AIM-เงินเดือน) ฝังเกณฑ์ไว้ในโค้ด (40_calc.js) — proof ให้ตั้งเกณฑ์เป็น config (D66)
 * ⇒ ไฟล์นี้ **แปลงเกณฑ์เดิมเป็น config** (ชุดเดียวกับที่ golden test ของ lib/payroll/calc.test.ts ใช้พิสูจน์)
 *   แล้วให้ engine ของ proof คิดทุกบรรทัดใหม่ เทียบกับผลที่แอปเดิมแช่ไว้ทีละบาท
 *
 * 🚨 ตัวเงินที่ยื่น/จ่ายไปแล้ว = ค่าที่แอปเดิมคิดไว้ (กติกา D75 "ตัวเงิน = ค่าที่แช่ไว้")
 *    ถ้า engine คิดได้ไม่ตรงแม้บาทเดียว = ห้ามลง ต้องหาสาเหตุก่อน (ไม่แอบใช้ค่าเดิมทับ)
 */
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import * as C from "../lib/clean";
import { calcPayrollLine } from "../../lib/payroll/calc";
import { ssoEmployerContribution } from "../../lib/payroll/sso";
import { employeeForCalc } from "../../lib/payroll/periodView";
import type { Employee, PayComponent, PayRates, PayrollLine, PayrollSettings, PayVariable, TaxAllowance } from "../../lib/payroll/types";

type Row = C.Cell[];

function rowsOf(wb: XLSX.WorkBook, name: string): Row[] {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`ไม่พบชีท '${name}'`);
  const arr = XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: true, blankrows: false, defval: null });
  return arr.slice(1).filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ""));
}

// ── เกณฑ์ของแอปเดิม → config (40_calc.js · blueprint ข้อ 4) ────────────────────
/** ประเภทพนักงานเดิม → กลุ่ม */
export const GROUP_OF: Record<string, string> = { ช่าง: "ช่าง", หัวหน้า: "หัวหน้า" };
export const GROUPS = ["ช่าง", "หัวหน้า"];

export const SETTINGS: PayrollSettings = { hoursPerDay: 9, rounding: "baht" };

/** อัตรา OT ต่อชั่วโมง = ฐานเงินเดือน ÷ วันในเดือน ÷ 9 (ไม่รวมค่าตำแหน่ง) */
export const VARIABLES: PayVariable[] = [
  { code: "hourly_rate", name: "อัตราต่อชั่วโมง", source: "base_wage", steps: [{ op: "div", kind: "work_days_std" }, { op: "div", kind: "hours_per_day" }], sort: 0 },
];

/** ช่องกรอกต่อคนต่องวด (ตรงกับคอลัมน์ input ของ Pay_Lines เดิม) */
export const INPUTS = [
  { code: "pos_allow", label: "ค่าตำแหน่ง", unit: "บาท", sort: 0 },
  { code: "ot15_h", label: "OT วันทำงาน", unit: "ชั่วโมง", sort: 1 },
  { code: "ot2_h", label: "OT วันหยุด", unit: "ชั่วโมง", sort: 2 },
  { code: "sick_d", label: "ลาป่วย", unit: "วัน", sort: 3 },
  { code: "personal_d", label: "ลากิจ", unit: "วัน", sort: 4 },
  { code: "score1", label: "คะแนนหัวหน้า 1", unit: "คะแนน", sort: 5 },
  { code: "score2", label: "คะแนนหัวหน้า 2", unit: "คะแนน", sort: 6 },
];

export const COMPONENTS: PayComponent[] = [
  // daily = (ฐาน + ค่าตำแหน่ง) ÷ วันในเดือน → ค่าตำแหน่ง prorate ไปด้วย แต่ไม่เข้าฐาน OT
  { code: "pos", name: "ค่าตำแหน่ง", kind: "earning", method: "per_unit", amount: 1, inputKeys: ["pos_allow"], prorateBase: true, otBase: false, ssoBase: true, taxable: true, sort: 0 },
  // ot15: ช่าง ×1.5 · หัวหน้า ×1.0
  { code: "ot15_tech", name: "OT วันทำงาน (ช่าง)", kind: "earning", method: "variable", variableCode: "hourly_rate", multiplier: 1.5, inputKeys: ["ot15_h"], groupCodes: ["ช่าง"], taxable: true, ssoBase: false, sort: 1 },
  { code: "ot15_lead", name: "OT วันทำงาน (หัวหน้า)", kind: "earning", method: "variable", variableCode: "hourly_rate", multiplier: 1.0, inputKeys: ["ot15_h"], groupCodes: ["หัวหน้า"], taxable: true, ssoBase: false, sort: 2 },
  { code: "ot2", name: "OT วันหยุด", kind: "earning", method: "variable", variableCode: "hourly_rate", multiplier: 2.0, inputKeys: ["ot2_h"], taxable: true, ssoBase: false, sort: 3 },
  // เบี้ยขยัน (เฉพาะช่าง) = ส่วนขาดงาน + เฉลี่ยคะแนนหัวหน้า 2 คน
  {
    code: "attend_absent", name: "เบี้ยขยัน (ส่วนขาดงาน)", kind: "earning", method: "tier_table",
    inputKeys: ["sick_d", "personal_d"], inputAgg: "sum",
    tiers: [{ upTo: 1, amount: 500 }, { upTo: 1.5, amount: 400 }, { upTo: 2, amount: 300 }, { upTo: 2.5, amount: 100 }],
    groupCodes: ["ช่าง"], taxable: true, ssoBase: false, sort: 4,
  },
  { code: "attend_score", name: "เบี้ยขยัน (คะแนนหัวหน้า)", kind: "earning", method: "per_unit", amount: 1, inputKeys: ["score1", "score2"], inputAgg: "avg", groupCodes: ["ช่าง"], taxable: true, ssoBase: false, sort: 5 },
  { code: "bonus", name: "โบนัส", kind: "earning", method: "manual", taxable: true, ssoBase: false, sort: 6 },
];

/** อัตราตามกฎหมายปี 2569 (ประกันสังคม 5% เพดาน 875 · ขั้นบันได PIT 2568 ที่แอปเดิมยืนยันแล้ว) */
export const RATES: PayRates = {
  effectiveFrom: "2026-01-01",
  ssoRate: 5,
  ssoWageMin: 1650,
  ssoWageMax: 17500,
  pitBrackets: [
    { upTo: 150000, rate: 0 }, { upTo: 300000, rate: 0.05 }, { upTo: 500000, rate: 0.1 },
    { upTo: 750000, rate: 0.15 }, { upTo: 1000000, rate: 0.2 }, { upTo: 2000000, rate: 0.25 },
    { upTo: 5000000, rate: 0.3 }, { upTo: 1e15, rate: 0.35 },
  ],
  personalAllowance: 60000,
  expenseRate: 50,
  expenseCap: 100000,
};

export type AimEmployee = Employee & {
  nationalId: string | null; address: string | null; ssoNo: string | null; bankName: string | null; bankAcct: string | null;
  startDate: string | null; endDate: string | null; entityId: string; active: boolean; positionAllow: number;
};
export type AimPeriod = { legacyId: string; periodId: string; year: number; month: number; workDaysStd: number; payDate: string | null; status: string; note: string | null };
export type AimLine = {
  periodId: string; empId: string; empName: string; groupCode: string;
  inputs: { workDays: number; values: Record<string, number>; manual: Record<string, number>; whtOverride: number | null };
  legacy: { salary: number; ot15: number; ot2: number; diligence: number; gross: number; sso: number; wht: number; net: number; postedTxIds: string | null };
  line: PayrollLine; ssoEmployer: number;
  diff: string[];
};

export function buildAimPayroll(file: string) {
  const wb = XLSX.read(readFileSync(file), { cellDates: false });
  const issues: string[] = [];

  // ค่าลดหย่อนรายปี (WHT_Annual) — allowSSO ไม่มีช่องเฉพาะใน proof ⇒ รวมเข้า "อื่น ๆ"
  const allowByEmp = new Map<string, Record<string, TaxAllowance>>();
  for (const r of rowsOf(wb, "WHT_Annual")) {
    const id = C.strReq(r[0]);
    const year = String(C.num0(r[1]));
    const a: TaxAllowance = {
      personal: C.num0(r[2]), spouse: C.num0(r[3]), child: C.num0(r[4]), parent: C.num0(r[5]),
      insLife: C.num0(r[6]), insHealth: C.num0(r[7]), other: C.num0(r[8]) + C.num0(r[9]), otherIncome: C.num0(r[10]),
    };
    allowByEmp.set(id, { ...(allowByEmp.get(id) ?? {}), [year]: a });
  }

  const employees: AimEmployee[] = rowsOf(wb, "Employees").filter((r) => C.strReq(r[0]) !== "").map((r) => {
    const empType = C.strReq(r[10]);
    const group = GROUP_OF[empType];
    if (!group) issues.push(`พนักงาน ${C.strReq(r[0])}: ประเภท "${empType}" ไม่รู้จัก`);
    const whtMode = C.strReq(r[14]) === "fixed" ? "fixed" : "auto";
    return {
      empId: C.strReq(r[0]), name: C.strReq(r[1]), groupCode: group ?? null,
      wageType: "monthly_prorate", baseWage: C.num0(r[11]),
      ssoExempt: C.bool(r[13]), whtMode, whtFixed: C.num0(r[15]),
      taxAllowances: allowByEmp.get(C.strReq(r[0])) ?? {},
      nationalId: C.str(r[2]), address: C.str(r[3]), ssoNo: C.str(r[4]), bankName: C.str(r[5]), bankAcct: C.str(r[6]),
      startDate: C.isoDate(r[7]), endDate: C.isoDate(r[8]), entityId: C.str(r[9]) ?? "EID01",
      active: C.bool(r[16]), positionAllow: C.num0(r[12]),
    };
  });
  const empById = new Map(employees.map((e) => [e.empId, e]));

  // งวด: PR-<ปี พ.ศ.>-MM → PR-<ค.ศ.>-MM (proof เก็บ ISO ทั้งระบบ)
  const periods: AimPeriod[] = rowsOf(wb, "Pay_Periods").filter((r) => C.strReq(r[0]) !== "").map((r) => {
    const yearBE = C.num0(r[1]);
    const year = yearBE > 2500 ? yearBE - 543 : yearBE;
    const month = C.num0(r[2]);
    return {
      legacyId: C.strReq(r[0]), periodId: `PR-${year}-${String(month).padStart(2, "0")}`, year, month,
      workDaysStd: C.num0(r[3]), payDate: C.isoDate(r[4]), status: C.strReq(r[5]) || "draft", note: C.str(r[7]),
    };
  });
  const perByLegacy = new Map(periods.map((p) => [p.legacyId, p]));

  const lines: AimLine[] = [];
  for (const r of rowsOf(wb, "Pay_Lines")) {
    const per = perByLegacy.get(C.strReq(r[1]));
    const emp = empById.get(C.strReq(r[2]));
    if (!per || !emp) { issues.push(`บรรทัด ${C.strReq(r[0])}: หางวด/พนักงานไม่เจอ`); continue; }
    const whtInput = C.num(r[13]);
    const inputs = {
      workDays: C.num0(r[5]),
      values: {
        pos_allow: emp.positionAllow,
        ot15_h: C.num0(r[6]), ot2_h: C.num0(r[7]), sick_d: C.num0(r[8]), personal_d: C.num0(r[9]),
        score1: C.num0(r[10]), score2: C.num0(r[11]),
      },
      manual: { bonus: C.num0(r[12]) },
      whtOverride: whtInput,
    };
    // 🚨 ประกอบ Employee ด้วยตัวเดียวกับที่แอปใช้ตอนกดบันทึก (savePeriodLinesAction → calcLine)
    const line = calcPayrollLine(
      employeeForCalc(emp), inputs, COMPONENTS, RATES, SETTINGS,
      { workDaysStd: per.workDaysStd, monthOfYear: per.month, yearBE: String(per.year + 543) },
      VARIABLES,
    );
    const legacy = {
      salary: C.num0(r[14]), ot15: C.num0(r[15]), ot2: C.num0(r[16]), diligence: C.num0(r[17]),
      gross: C.num0(r[18]), sso: C.num0(r[19]), wht: C.num0(r[20]), net: C.num0(r[21]), postedTxIds: C.str(r[22]),
    };
    const amt = (codes: string[]) => line.items.filter((i) => codes.includes(i.code)).reduce((s, i) => s + i.amount, 0);
    // salary เดิม = ค่าจ้างที่ prorate แล้ว **รวมค่าตำแหน่ง**
    const got = {
      salary: line.baseAmount + amt(["pos"]),
      ot15: amt(["ot15_tech", "ot15_lead"]), ot2: amt(["ot2"]),
      diligence: amt(["attend_absent", "attend_score"]),
      gross: line.gross, sso: line.sso, wht: line.wht, net: line.net,
    };
    const diff = (Object.keys(got) as (keyof typeof got)[])
      .filter((k) => Math.abs(got[k] - legacy[k]) > 0.005)
      .map((k) => `${k}: เดิม ${legacy[k]} · proof ${got[k]}`);
    lines.push({
      periodId: per.periodId, empId: emp.empId, empName: C.strReq(r[3]) || emp.name, groupCode: emp.groupCode ?? "",
      inputs, legacy, line, ssoEmployer: ssoEmployerContribution(line.ssoWageBase, RATES, emp.ssoExempt), diff,
    });
  }
  return { employees, periods, lines, issues };
}

// ── แปลงเป็นแถว DB (ยังไม่มี tenant_id — ตัวลง DB เติมให้) ─────────────────────
type Rec = Record<string, unknown>;
export type AimPayroll = ReturnType<typeof buildAimPayroll>;

/** ขาลงบัญชี 3 ขา ตรงกับที่แอปเดิมลง (หมวด/คู่ค้าเดียวกับบิลเดิมใน Transactions) */
export const LEGS = [
  { code: "net", name: "เงินเดือนสุทธิ", amount_source: "net", split_by_employee: true, category: "เงินเดือน", contact_name: null, suggest_day: 0, sort: 0 },
  { code: "sso", name: "นำส่งประกันสังคม", amount_source: "sso_total", split_by_employee: false, category: "ประกันสังคม", contact_name: "สำนักงานประกันสังคม", suggest_day: 15, sort: 1 },
  { code: "wht", name: "นำส่งภาษีหัก ณ ที่จ่าย", amount_source: "wht", split_by_employee: false, category: "ภาษีหัก ณ ที่จ่าย", contact_name: "กรมสรรพากร", suggest_day: 7, sort: 2 },
] as const;

/**
 * สถานะลงบัญชีของงวด (post_state) จากแอปเดิม
 *
 * 🚨 ภ.ง.ด.1ก/50ทวิ นับเฉพาะงวดที่ลงบัญชีแล้ว (D81) — งวด ม.ค.–เม.ย. แอปเดิมเป็น "draft"
 *    ทั้งที่จ่ายเงินจริงไปแล้ว (จ่ายนอกแอป) ⇒ ลงเป็นร่าง = ภ.ง.ด.1ก ปี 2569 ขาด 4 เดือนเงียบ ๆ
 *    → ติดขาครบ 3 ขาแบบ **ไม่มีบิล** (txIds ว่าง + `imported`) ไม่สร้างรายจ่ายย้อนหลังให้
 * ★ txIds ใส่เฉพาะบิลที่ย้ายมาจริง — บิลที่แอปเดิมอ้างแต่ไม่มีในบัญชี (พ.ค.) ไม่ใส่
 *    (ถอนการลงบัญชีทีหลัง = ยกเลิกเฉพาะบิลที่ txIds ชี้ · ชี้บิลที่ไม่มีก็ไม่เกิดอะไร แต่ทำให้อ่านผิด)
 */
export type LegLink = { period: string; leg: string; txId: string };
export function periodPostState(per: AimPeriod, lines: AimLine[], have: Set<string>, links: LegLink[] = [], txDate = new Map<string, string>()) {
  const notes: string[] = [];
  let n: Rec = {};
  try { n = per.note ? JSON.parse(per.note) : {}; } catch { notes.push(`${per.periodId}: อ่านหมายเหตุงวดไม่ออก`); }
  const imported = "ย้ายจากแอปเดิม";
  const state: Record<string, { txIds: string[]; date: string | null; imported?: string }> = {};
  const exists = (ids: string[]) => ids.filter((i) => have.has(i));

  if (per.status === "draft") {
    for (const l of LEGS) state[l.code] = { txIds: [], date: per.payDate, imported: `${imported} (งวดนี้แอปเดิมยังไม่ได้ลงบัญชี — จ่ายนอกระบบ)` };
    notes.push(`${per.periodId}: แอปเดิมเป็นร่าง → ลงเป็น "ลงบัญชีแล้ว" แบบไม่มีบิล (ให้นับใน ภ.ง.ด.1ก)`);
    return { state, notes };
  }
  const netIds = lines.flatMap((l) => (l.legacy.postedTxIds ?? "").split(/[,\s]+/).filter(Boolean));
  if (per.status === "posted" || n.postedNet) {
    const got = exists(netIds);
    state.net = { txIds: got, date: (n.netDate as string) || per.payDate, ...(got.length < netIds.length ? { imported } : {}) };
    if (got.length < netIds.length) notes.push(`${per.periodId}: บิลเงินเดือนที่แอปเดิมอ้าง ${netIds.length - got.length} ใบไม่มีในบัญชี (ถูกลบไปแล้ว) → ติดขาไว้แบบไม่มีบิล`);
  }
  for (const [code, idKey, dateKey] of [["sso", "ssoTxId", "ssoDate"], ["wht", "whtTxId", "whtDate"]] as const) {
    const id = String(n[idKey] ?? "").trim();
    if (!id) continue;
    const got = exists([id]);
    state[code] = { txIds: got, date: (n[dateKey] as string) || per.payDate, ...(got.length ? {} : { imported }) };
    if (!got.length) notes.push(`${per.periodId}: บิล${code === "sso" ? "ประกันสังคม" : "ภาษี"} ${id} ไม่มีในบัญชี → ติดขาไว้แบบไม่มีบิล`);
  }
  for (const k of links.filter((x) => x.period === per.periodId)) {
    if (!LEGS.some((l) => l.code === k.leg)) { notes.push(`${per.periodId}: legLinks ขา "${k.leg}" ไม่มีอยู่จริง`); continue; }
    if (!have.has(k.txId)) { notes.push(`${per.periodId}: legLinks ชี้บิล ${k.txId} ที่ไม่มีในบัญชี — ไม่ผูก`); continue; }
    if (state[k.leg]?.txIds.length) { notes.push(`${per.periodId}: ขา ${k.leg} มีบิลอยู่แล้ว — ไม่ผูก ${k.txId} ซ้ำ`); continue; }
    state[k.leg] = { txIds: [k.txId], date: txDate.get(k.txId) ?? per.payDate, imported: "ผูกกับบิลที่คีย์เองในแอปบัญชี" };
    notes.push(`${per.periodId}: ขา ${k.leg} ผูกกับบิล ${k.txId} ที่คีย์เอง (ตามไฟล์ค่าตั้ง)`);
  }
  const open = LEGS.filter((l) => !state[l.code]).map((l) => l.name);
  if (open.length) notes.push(`${per.periodId}: ยังไม่ลงบัญชี ${open.join(" · ")} (ตามแอปเดิม) — ถ้าจ่ายไปแล้วด้วยบิลที่คีย์เอง อย่ากดลงบัญชีขานี้ซ้ำ`);
  return { state, notes };
}

export function payrollTables(
  p: AimPayroll,
  have: Set<string>,
  opts: { entityId: string; payAccount: string; links?: LegLink[]; txDate?: Map<string, string> },
) {
  const notes: string[] = [];
  const app_settings: Rec[] = [
    ...GROUPS.map((g, i) => ({ kind: "pay_group", value: g, sort: i })),
    { kind: "payroll_entity", value: opts.entityId, sort: 0 },
    { kind: "payroll_pay_account", value: opts.payAccount, sort: 0 },
    { kind: "payroll_hours_per_day", value: String(SETTINGS.hoursPerDay), sort: 0 },
    { kind: "payroll_rounding", value: SETTINGS.rounding, sort: 0 },
  ];
  const pay_inputs: Rec[] = INPUTS.map((i) => ({ ...i, active: true }));
  const pay_variables: Rec[] = VARIABLES.map((v) => ({
    code: v.code, name: v.name, source: v.source, const_value: v.constValue ?? 0, input_key: v.inputKey ?? null,
    steps: v.steps, rounding: v.rounding ?? "none", sort: v.sort ?? 0, active: true,
  }));
  const pay_components: Rec[] = COMPONENTS.map((c) => ({
    code: c.code, name: c.name, kind: c.kind, method: c.method,
    amount: c.amount ?? 0, rate: c.rate ?? 0, multiplier: c.multiplier ?? 0, tiers: c.tiers ?? [],
    input_keys: c.inputKeys ?? [], input_agg: c.inputAgg ?? "sum", group_codes: c.groupCodes ?? [],
    taxable: c.taxable ?? true, sso_base: c.ssoBase ?? false, ot_base: c.otBase ?? false, prorate_base: c.prorateBase ?? false,
    variable_code: c.variableCode ?? null, sort: c.sort ?? 0, active: true,
  }));
  const pay_rates: Rec[] = [{
    effective_from: RATES.effectiveFrom, sso_rate: RATES.ssoRate, sso_wage_min: RATES.ssoWageMin, sso_wage_max: RATES.ssoWageMax,
    pit_brackets: RATES.pitBrackets, personal_allowance: RATES.personalAllowance,
    expense_rate: RATES.expenseRate, expense_cap: RATES.expenseCap, note: "ย้ายจากแอปเดิม (ปี 2569)",
  }];
  const pay_post_legs: Rec[] = LEGS.map((l) => ({ ...l, account_name: null, active: true }));
  const employees: Rec[] = p.employees.map((e) => ({
    emp_id: e.empId, entity_id: e.entityId, name: e.name, national_id: e.nationalId, sso_no: e.ssoNo, address: e.address,
    bank_name: e.bankName, bank_acct: e.bankAcct, start_date: e.startDate, end_date: e.endDate, group_code: e.groupCode,
    wage_type: e.wageType, base_wage: e.baseWage, sso_exempt: e.ssoExempt, wht_mode: e.whtMode, wht_fixed: e.whtFixed ?? 0,
    tax_allowances: e.taxAllowances ?? {}, active: e.active,
  }));
  const payroll_periods: Rec[] = [];
  for (const per of p.periods) {
    const lines = p.lines.filter((l) => l.periodId === per.periodId);
    const { state, notes: n } = periodPostState(per, lines, have, opts.links, opts.txDate);
    notes.push(...n);
    const legs = Object.keys(state).length;
    payroll_periods.push({
      period_id: per.periodId, entity_id: opts.entityId, year: per.year, month: per.month,
      work_days_std: per.workDaysStd, pay_date: per.payDate, post_state: state,
      status: legs >= LEGS.length ? "posted" : legs > 0 ? "partial" : "draft",
    });
  }
  const payroll_items: Rec[] = p.lines.map((l) => {
    const net = (l.legacy.postedTxIds ?? "").split(/[,\s]+/).filter((i) => have.has(i));
    return {
      period_id: l.periodId, emp_id: l.empId, emp_name: l.empName, group_code: l.groupCode || null,
      inputs: l.inputs, computed: l.line, rates_snapshot: RATES,
      base_amount: l.line.baseAmount, gross: l.line.gross, sso: l.line.sso, sso_employer: l.ssoEmployer,
      wht: l.line.wht, deductions: l.line.deductions, net: l.line.net, tx_id: net[0] ?? null,
    };
  });
  const maxEmp = Math.max(0, ...p.employees.map((e) => Number(e.empId.replace(/\D/g, "")) || 0));
  return {
    tables: { app_settings, pay_inputs, pay_variables, pay_components, pay_rates, pay_post_legs, employees, payroll_periods, payroll_items },
    counters: [{ key: "EMP", value: maxEmp }],
    notes,
  };
}
