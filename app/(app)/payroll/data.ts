import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ReportSource } from "@/lib/payroll/report";
import type { FilingItem, FilingEmployee } from "@/lib/payroll/filings";
import type { FilingEntity } from "@/lib/payroll/filingHtml";
import type {
  Employee,
  PayComponent,
  PayPostLeg,
  PayRates,
  PayVariable,
  PayrollSettings,
} from "@/lib/payroll/types";

/**
 * ข้อมูลของโมดูลเงินเดือน
 *
 * ★ ทุก query อาศัย RLS ของ 0040 กรองให้ (tenant + role main + entity scope)
 *   ไม่ต้องใส่ .eq("tenant_id", …) เอง — และห้ามใส่ เพราะ my_tenant() เป็นแหล่งความจริงเดียว
 */

export type PayInput = { code: string; label: string; unit: string | null; sort: number; active: boolean };

export type EmployeeRow = Employee & {
  entityId: string;
  nationalId: string | null;
  ssoNo: string | null;
  bankName: string | null;
  bankAcct: string | null;
  startDate: string | null;
  endDate: string | null;
  active: boolean;
};

export type PeriodRow = {
  periodId: string;
  entityId: string;
  year: number;
  month: number;
  workDaysStd: number;
  payDate: string | null;
  status: "draft" | "partial" | "posted";
  postState: Record<string, { txIds?: string[]; date?: string }>;
};

export type ItemRow = {
  empId: string;
  empName: string;
  groupCode: string | null;
  inputs: { workDays?: number; values?: Record<string, number>; manual?: Record<string, number>; whtOverride?: number | null };
  computed: Record<string, unknown>;
  baseAmount: number;
  gross: number;
  sso: number;
  ssoEmployer: number;
  wht: number;
  deductions: number;
  net: number;
  txId: string | null;
};

/** ค่าตั้งของโมดูล (app_settings) + กลุ่มพนักงาน */
export async function getPayrollConfig(): Promise<{
  settings: PayrollSettings;
  groups: string[];
  entityId: string;
  /** บัญชีเงินหลักที่ใช้จ่ายเงินเดือน (ขาที่ไม่ระบุบัญชีจะใช้ตัวนี้) */
  payAccount: string;
  /** รายชื่อบัญชีเงินที่มีอยู่จริง — ให้หน้าจอทำเป็นดร็อปดาวน์ ไม่ต้องพิมพ์เอง */
  bankAccounts: string[];
  inputs: PayInput[];
  components: PayComponent[];
  variables: PayVariable[];
  legs: PayPostLeg[];
  rates: PayRates[];
}> {
  const supabase = await createClient();
  const [s, inputs, comps, vars, legs, rates, accts] = await Promise.all([
    supabase.from("app_settings").select("kind, value, sort").in("kind", [
      "pay_group",
      "payroll_entity",
      "payroll_pay_account",
      "payroll_hours_per_day",
      "payroll_rounding",
    ]).order("sort"),
    supabase.from("pay_inputs").select("code, label, unit, sort, active").order("sort"),
    supabase.from("pay_components").select("*").order("sort"),
    supabase.from("pay_variables").select("*").order("sort"),
    supabase.from("pay_post_legs").select("*").order("sort"),
    supabase.from("pay_rates").select("*").order("effective_from", { ascending: false }),
    supabase.from("bank_accounts").select("account_name").order("account_name"),
  ]);

  const rows = s.data ?? [];
  const list = (k: string) => rows.filter((r) => r.kind === k).map((r) => r.value as string);
  const one = (k: string) => list(k)[0] ?? "";

  return {
    settings: {
      // วันละ 8 ชม. เป็นค่าตั้งต้นกลาง ๆ — โรงที่ใช้ 9 ชม. ตั้งเองในหน้าตั้งค่า
      hoursPerDay: Number(one("payroll_hours_per_day")) || 8,
      rounding: one("payroll_rounding") === "satang" ? "satang" : "baht",
    },
    groups: list("pay_group"),
    entityId: one("payroll_entity"),
    payAccount: one("payroll_pay_account"),
    bankAccounts: (accts.data ?? []).map((a) => a.account_name as string),
    inputs: (inputs.data ?? []) as PayInput[],
    components: (comps.data ?? []).map(toComponent),
    variables: (vars.data ?? []).map(toVariable),
    legs: (legs.data ?? []).map(toLeg),
    rates: (rates.data ?? []).map(toRates),
  };
}

export async function getEmployees(): Promise<EmployeeRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("employees").select("*").order("emp_id");
  return (data ?? []).map(toEmployee);
}

export async function getPeriods(): Promise<PeriodRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payroll_periods")
    .select("period_id, entity_id, year, month, work_days_std, pay_date, status, post_state")
    .order("period_id", { ascending: false })
    .limit(36);
  return (data ?? []).map(toPeriod);
}

export async function getPeriodDetail(periodId: string): Promise<{ period: PeriodRow | null; items: ItemRow[] }> {
  const supabase = await createClient();
  const [p, it] = await Promise.all([
    supabase
      .from("payroll_periods")
      .select("period_id, entity_id, year, month, work_days_std, pay_date, status, post_state")
      .eq("period_id", periodId)
      .maybeSingle(),
    supabase.from("payroll_items").select("*").eq("period_id", periodId).order("emp_id"),
  ]);
  return {
    period: p.data ? toPeriod(p.data) : null,
    items: (it.data ?? []).map(toItem),
  };
}

// ── mappers (snake_case ของ DB → camelCase ของ lib/payroll) ──────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */

function toComponent(r: any): PayComponent {
  return {
    code: r.code,
    name: r.name,
    kind: r.kind,
    method: r.method,
    amount: Number(r.amount),
    rate: Number(r.rate),
    multiplier: Number(r.multiplier),
    tiers: r.tiers ?? [],
    inputKeys: r.input_keys ?? [],
    inputAgg: r.input_agg,
    groupCodes: r.group_codes ?? [],
    taxable: r.taxable,
    ssoBase: r.sso_base,
    otBase: r.ot_base,
    prorateBase: r.prorate_base,
    variableCode: r.variable_code ?? undefined,
    sort: r.sort,
    active: r.active,
  };
}

function toVariable(r: any): PayVariable {
  return {
    code: r.code,
    name: r.name,
    source: r.source,
    constValue: Number(r.const_value),
    inputKey: r.input_key ?? undefined,
    // ★ คอลัมน์ถูกเปลี่ยนชื่อเป็น steps ใน 0044 — อ่าน divisors ต่อไว้กันกรณี DB ยังไม่ได้ลง migration
    steps: r.steps ?? r.divisors ?? [],
    rounding: r.rounding ?? "none",
    sort: r.sort,
    active: r.active,
  };
}

function toLeg(r: any): PayPostLeg {
  return {
    code: r.code,
    name: r.name,
    amountSource: r.amount_source,
    componentCode: r.component_code ?? undefined,
    splitByEmployee: r.split_by_employee,
    category: r.category,
    accountName: r.account_name ?? undefined,
    contactName: r.contact_name ?? undefined,
    suggestDay: r.suggest_day,
    sort: r.sort,
    active: r.active,
  };
}

function toRates(r: any): PayRates {
  return {
    effectiveFrom: r.effective_from,
    ssoRate: Number(r.sso_rate),
    ssoWageMin: Number(r.sso_wage_min),
    ssoWageMax: Number(r.sso_wage_max),
    pitBrackets: r.pit_brackets ?? [],
    personalAllowance: Number(r.personal_allowance),
    expenseRate: Number(r.expense_rate),
    expenseCap: Number(r.expense_cap),
  };
}

function toEmployee(r: any): EmployeeRow {
  return {
    empId: r.emp_id,
    entityId: r.entity_id,
    name: r.name,
    nationalId: r.national_id,
    ssoNo: r.sso_no,
    bankName: r.bank_name,
    bankAcct: r.bank_acct,
    startDate: r.start_date,
    endDate: r.end_date,
    groupCode: r.group_code,
    wageType: r.wage_type,
    baseWage: Number(r.base_wage),
    ssoExempt: r.sso_exempt,
    whtMode: r.wht_mode,
    whtFixed: Number(r.wht_fixed),
    taxAllowances: r.tax_allowances ?? {},
    active: r.active,
  };
}

function toPeriod(r: any): PeriodRow {
  return {
    periodId: r.period_id,
    entityId: r.entity_id,
    year: r.year,
    month: r.month,
    workDaysStd: Number(r.work_days_std),
    payDate: r.pay_date,
    status: r.status,
    postState: r.post_state ?? {},
  };
}

function toItem(r: any): ItemRow {
  return {
    empId: r.emp_id,
    empName: r.emp_name,
    groupCode: r.group_code,
    inputs: r.inputs ?? {},
    computed: r.computed ?? {},
    baseAmount: Number(r.base_amount),
    gross: Number(r.gross),
    sso: Number(r.sso),
    ssoEmployer: Number(r.sso_employer),
    wht: Number(r.wht),
    deductions: Number(r.deductions),
    net: Number(r.net),
    txId: r.tx_id,
  };
}

/**
 * ข้อมูลรายงานของปีหนึ่ง — อ่านจาก `computed` ที่แช่ไว้ตอนกดบันทึกเท่านั้น
 * 🪤 ห้ามคำนวณสดจาก config ไม่งั้นรายงานของงวดเก่าจะขยับตามเกณฑ์ที่แก้ทีหลัง
 */
export async function getPayrollReportSource(year: number): Promise<ReportSource[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payroll_items")
    .select("period_id, emp_id, emp_name, group_code, computed, base_amount, gross, sso, sso_employer, wht, net")
    .like("period_id", `PR-${year}-%`)
    .order("period_id");

  return (data ?? []).map((r: any) => ({
    periodId: r.period_id,
    empId: r.emp_id,
    empName: r.emp_name,
    groupCode: r.group_code,
    baseAmount: Number(r.base_amount),
    gross: Number(r.gross),
    sso: Number(r.sso),
    ssoEmployer: Number(r.sso_employer),
    wht: Number(r.wht),
    net: Number(r.net),
    items: Array.isArray(r.computed?.items) ? r.computed.items : [],
  }));
}

// ── เอกสารยื่นราชการ (D69) ───────────────────────────────────────────────────
/**
 * 🚨 ดึงเฉพาะค่าที่ **แช่ไว้แล้ว** — ห้ามดึง pay_components/pay_rates มาคำนวณสด
 *    (ดูเหตุผลในหัว `lib/payroll/filings.ts`) · สังเกตว่าไม่มี query ไปตาราง config เลย
 */
export type FilingData = {
  entity: FilingEntity;
  items: FilingItem[];
  emps: FilingEmployee[];
};

/** ข้อมูลกิจการที่ออกเอกสาร — งวด/ปีอ้าง entity_id ของตัวเอง */
async function filingEntity(entityId: string | null): Promise<FilingEntity> {
  const supabase = await createClient();
  let q = supabase.from("entities").select("entity_id, name, tax_id, branch, address, sso_employer_no");
  q = entityId ? q.eq("entity_id", entityId) : q.eq("is_default", true);
  const { data } = await q.maybeSingle();
  return {
    entityId: data?.entity_id ?? "",
    name: data?.name ?? "",
    taxId: data?.tax_id ?? null,
    branch: data?.branch ?? null,
    address: data?.address ?? null,
    ssoEmployerNo: data?.sso_employer_no ?? null,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toFilingItem(r: any): FilingItem {
  const c = (r.computed ?? {}) as Record<string, unknown>;
  return {
    periodId: r.period_id,
    empId: r.emp_id,
    empName: r.emp_name,
    gross: Number(r.gross),
    // ★ อ่านจาก computed ที่แช่ไว้ · งวดเก่าไม่มี → undefined แล้วให้ taxBaseOf fallback
    taxableIncome: c.taxableIncome == null ? null : Number(c.taxableIncome),
    ssoWageBase: c.ssoWageBase == null ? null : Number(c.ssoWageBase),
    sso: Number(r.sso),
    ssoEmployer: Number(r.sso_employer),
    wht: Number(r.wht),
  };
}

function toFilingEmployee(r: any): FilingEmployee {
  return {
    empId: r.emp_id,
    name: r.name,
    nationalId: r.national_id,
    ssoNo: r.sso_no,
    address: r.address,
    ssoExempt: r.sso_exempt,
  };
}

/** เอกสารรายเดือน (ภงด.1 · สปส.1-10) */
export async function getFilingPeriod(
  periodId: string,
): Promise<FilingData & { period: PeriodRow | null }> {
  const supabase = await createClient();
  const [p, it, em] = await Promise.all([
    supabase
      .from("payroll_periods")
      .select("period_id, entity_id, year, month, work_days_std, pay_date, status, post_state")
      .eq("period_id", periodId)
      .maybeSingle(),
    supabase
      .from("payroll_items")
      .select("period_id, emp_id, emp_name, computed, gross, sso, sso_employer, wht")
      .eq("period_id", periodId)
      .order("emp_id"),
    supabase.from("employees").select("emp_id, name, national_id, sso_no, address, sso_exempt"),
  ]);

  const period = p.data ? toPeriod(p.data) : null;
  return {
    period,
    entity: await filingEntity(period?.entityId ?? null),
    items: (it.data ?? []).map(toFilingItem),
    emps: (em.data ?? []).map(toFilingEmployee),
  };
}

/** เอกสารรายปี (ภงด.1ก · 50ทวิ) — `year` เป็น ค.ศ. ตาม period_id */
export async function getFilingYear(year: number): Promise<FilingData & { certs: EmpCertRow[] }> {
  const supabase = await createClient();
  const [it, em, ct] = await Promise.all([
    supabase
      .from("payroll_items")
      .select("period_id, emp_id, emp_name, computed, gross, sso, sso_employer, wht")
      .like("period_id", `PR-${year}-%`)
      .order("emp_id"),
    supabase.from("employees").select("emp_id, name, national_id, sso_no, address, sso_exempt"),
    supabase
      .from("wht_certificates")
      .select("doc_no, issue_date, emp_id, tax_year, base_amount, wht_amount")
      .eq("tax_year", year + 543)
      .not("emp_id", "is", null),
  ]);

  // 🪤 กิจการต้องมาจาก **งวดของปีนั้นจริง ๆ** ไม่ใช่กิจการปริยายของ tenant —
  //    โรงที่รันเงินเดือนใต้กิจการที่ 2 จะได้หัวเอกสาร/เลข 50ทวิ ผิดกิจการทันที
  const { data: per } = await supabase
    .from("payroll_periods")
    .select("entity_id")
    .like("period_id", `PR-${year}-%`)
    .limit(1)
    .maybeSingle();

  return {
    entity: await filingEntity(per?.entity_id ?? null),
    items: (it.data ?? []).map(toFilingItem),
    emps: (em.data ?? []).map(toFilingEmployee),
    certs: (ct.data ?? []).map((r: any) => ({
      docNo: r.doc_no,
      issueDate: r.issue_date,
      empId: r.emp_id,
      taxYear: r.tax_year,
      baseAmount: Number(r.base_amount),
      whtAmount: Number(r.wht_amount),
    })),
  };
}

/** ใบ 50ทวิ ของพนักงานที่ออกไปแล้ว */
export type EmpCertRow = {
  docNo: string;
  issueDate: string;
  empId: string;
  taxYear: number;
  baseAmount: number;
  whtAmount: number;
};
