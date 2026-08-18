"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mapDbError } from "@/lib/shared/dbError";
import { calcPayrollLine } from "@/lib/payroll/calc";
import { ssoEmployerContribution, ratesOn } from "@/lib/payroll/sso";
import { legAmount } from "@/lib/payroll/legs";
import type {
  PayComponent,
  PayPostLeg,
  PayRates,
  PayVariable,
  PayrollSettings,
} from "@/lib/payroll/types";
import { getPayrollConfig, getPeriodDetail, type EmployeeRow } from "./data";

/**
 * server action ของโมดูลเงินเดือน
 *
 * 🪤 กฎที่ห้ามละเมิด: **เงินคำนวณที่ `lib/payroll` ที่เดียว** แล้วเก็บผลลงตาราง
 *    ทั้งพรีวิวบนหน้าจอและตอนกดบันทึกต้องเรียกฟังก์ชันตัวเดียวกัน
 *    (ระบบเดิมบน GAS เขียนสูตรเบี้ยขยันซ้ำ 2 ที่ ค่าตรงกันโดยบังเอิญ
 *     แก้ที่เดียวเมื่อไหร่ใบเบี้ยขยันจะโชว์ยอดไม่ตรงกับที่จ่ายจริง)
 */

export type SaveResult = { ok: boolean; error?: string; data?: unknown };
const fail = (error: string): SaveResult => ({ ok: false, error });

// ── ตั้งค่า ─────────────────────────────────────────────────────────────────

/** ค่าตั้งแบบ 1 แถวต่อ kind (delete-then-insert เหมือนที่อื่นในระบบ) */
export async function savePayrollSettingAction(kind: string, value: string): Promise<SaveResult> {
  const supabase = await createClient();
  await supabase.from("app_settings").delete().eq("kind", kind);
  if (value.trim()) {
    const { error } = await supabase.from("app_settings").insert({ kind, value: value.trim() });
    if (error) return fail(mapDbError(error));
  }
  revalidatePath("/payroll");
  return { ok: true };
}

/** กลุ่มพนักงาน = list หลายแถวใน kind เดียว */
export async function addPayGroupAction(value: string): Promise<SaveResult> {
  const supabase = await createClient();
  const v = value.trim();
  if (!v) return fail("กรอกชื่อกลุ่มก่อน");
  const { error } = await supabase.from("app_settings").insert({ kind: "pay_group", value: v });
  if (error) return fail(mapDbError(error));
  revalidatePath("/payroll");
  return { ok: true };
}

export async function deletePayGroupAction(value: string): Promise<SaveResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("app_settings").delete().eq("kind", "pay_group").eq("value", value);
  if (error) return fail(mapDbError(error));
  revalidatePath("/payroll");
  return { ok: true };
}

export async function savePayInputAction(input: {
  code: string; label: string; unit: string; sort: number; active: boolean;
}): Promise<SaveResult> {
  const supabase = await createClient();
  const code = input.code.trim();
  if (!/^[a-z0-9_]+$/.test(code)) return fail("รหัสช่องต้องเป็น a-z 0-9 _ เท่านั้น (ใช้เป็นคีย์ในข้อมูล)");
  if (!input.label.trim()) return fail("กรอกชื่อช่องที่จะให้แสดงบนหน้าจอ");
  const { error } = await supabase.from("pay_inputs").upsert({
    code, label: input.label.trim(), unit: input.unit.trim() || null,
    sort: input.sort, active: input.active,
  });
  if (error) return fail(mapDbError(error));
  revalidatePath("/payroll");
  return { ok: true };
}

export async function deletePayInputAction(code: string): Promise<SaveResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("pay_inputs").delete().eq("code", code);
  if (error) return fail(mapDbError(error));
  revalidatePath("/payroll");
  return { ok: true };
}

export async function savePayComponentAction(c: PayComponent): Promise<SaveResult> {
  const supabase = await createClient();
  const code = c.code.trim();
  if (!/^[a-z0-9_]+$/.test(code)) return fail("รหัสรายการต้องเป็น a-z 0-9 _ เท่านั้น");
  if (!c.name.trim()) return fail("กรอกชื่อรายการที่จะขึ้นบนสลิป");
  if (c.method === "variable") {
    if (!c.variableCode) return fail("เลือกตัวแปรกลางที่จะใช้เป็นฐานก่อน");
    if (!c.multiplier) return fail("ใส่ตัวคูณ (เช่น 1.5 / 2 · ไม่คูณอะไรใส่ 1)");
  }
  if (c.method === "tier_table" && (c.tiers ?? []).length === 0) return fail("ใส่ขั้นบันไดอย่างน้อย 1 ขั้น");

  const { error } = await supabase.from("pay_components").upsert({
    code, name: c.name.trim(), kind: c.kind, method: c.method,
    amount: c.amount ?? 0, rate: c.rate ?? 0, multiplier: c.multiplier ?? 0,
    tiers: c.tiers ?? [],
    input_keys: c.inputKeys ?? [], input_agg: c.inputAgg ?? "sum",
    group_codes: c.groupCodes ?? [],
    taxable: c.taxable ?? true, sso_base: c.ssoBase ?? false,
    ot_base: c.otBase ?? false, prorate_base: c.prorateBase ?? false,
    variable_code: c.variableCode ?? null,
    sort: c.sort ?? 0, active: c.active ?? true,
  });
  if (error) return fail(mapDbError(error));
  revalidatePath("/payroll");
  return { ok: true };
}

export async function deletePayComponentAction(code: string): Promise<SaveResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("pay_components").delete().eq("code", code);
  if (error) return fail(mapDbError(error));
  revalidatePath("/payroll");
  return { ok: true };
}

export async function savePayRatesAction(r: PayRates): Promise<SaveResult> {
  const supabase = await createClient();
  if (!r.effectiveFrom) return fail("ใส่วันที่เริ่มมีผลก่อน");
  if ((r.pitBrackets ?? []).length === 0) return fail("ใส่ขั้นบันไดภาษีอย่างน้อย 1 ขั้น");
  const { error } = await supabase.from("pay_rates").upsert({
    effective_from: r.effectiveFrom,
    sso_rate: r.ssoRate, sso_wage_min: r.ssoWageMin, sso_wage_max: r.ssoWageMax,
    pit_brackets: r.pitBrackets,
    personal_allowance: r.personalAllowance,
    expense_rate: r.expenseRate, expense_cap: r.expenseCap,
  });
  if (error) return fail(mapDbError(error));
  revalidatePath("/payroll");
  return { ok: true };
}

export async function deletePayRatesAction(effectiveFrom: string): Promise<SaveResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("pay_rates").delete().eq("effective_from", effectiveFrom);
  if (error) return fail(mapDbError(error));
  revalidatePath("/payroll");
  return { ok: true };
}

// ── ตัวแปรกลาง ───────────────────────────────────────────────────────────────

export async function savePayVariableAction(v: PayVariable): Promise<SaveResult> {
  const supabase = await createClient();
  const code = v.code.trim();
  if (!/^[a-z0-9_]+$/.test(code)) return fail("รหัสตัวแปรต้องเป็น a-z 0-9 _ เท่านั้น");
  if (!v.name.trim()) return fail("ตั้งชื่อตัวแปรที่คนอ่านรู้เรื่อง เช่น อัตราค่าล่วงเวลาต่อชั่วโมง");
  if (v.source === "input" && !v.inputKey) return fail("เลือกช่องกรอกที่จะใช้เป็นตัวตั้ง");
  for (const d of v.divisors ?? []) {
    if (d.kind === "input" && !d.inputKey) return fail("ตัวหารที่เป็นช่องกรอก ต้องเลือกช่องด้วย");
  }
  const { error } = await supabase.from("pay_variables").upsert({
    code, name: v.name.trim(), source: v.source,
    const_value: v.constValue ?? 0, input_key: v.inputKey ?? null,
    divisors: v.divisors ?? [],
    sort: v.sort ?? 0, active: v.active ?? true,
  });
  if (error) return fail(mapDbError(error));
  revalidatePath("/payroll");
  return { ok: true };
}

export async function deletePayVariableAction(code: string): Promise<SaveResult> {
  const supabase = await createClient();
  // กันลบตัวแปรที่ยังมีรายการอ้างอยู่ — ลบแล้วรายการนั้นจะคิดได้ 0 เงียบ ๆ
  const { data: used } = await supabase
    .from("pay_components").select("name").eq("variable_code", code).limit(1);
  if (used && used.length > 0) {
    return fail(`ลบไม่ได้ — รายการ "${used[0].name}" ยังใช้ตัวแปรนี้อยู่`);
  }
  const { error } = await supabase.from("pay_variables").delete().eq("code", code);
  if (error) return fail(mapDbError(error));
  revalidatePath("/payroll");
  return { ok: true };
}

// ── ขาลงบัญชี ────────────────────────────────────────────────────────────────

export async function savePayPostLegAction(l: PayPostLeg): Promise<SaveResult> {
  const supabase = await createClient();
  const code = l.code.trim();
  if (!/^[a-z0-9_]+$/.test(code)) return fail("รหัสขาต้องเป็น a-z 0-9 _ เท่านั้น");
  if (!l.name.trim()) return fail("ตั้งชื่อขาที่จะขึ้นบนปุ่ม");
  if (!l.category.trim()) return fail("กรอกหมวดรายจ่ายที่จะขึ้นบนรายการบัญชี");
  if (l.amountSource === "component" && !l.componentCode) {
    return fail("เลือกรายการที่จะเอายอดมาลงบัญชี");
  }
  const { error } = await supabase.from("pay_post_legs").upsert({
    code, name: l.name.trim(), amount_source: l.amountSource,
    component_code: l.componentCode ?? null,
    split_by_employee: l.splitByEmployee ?? false,
    category: l.category.trim(),
    account_name: l.accountName?.trim() || null,
    contact_name: l.contactName?.trim() || null,
    suggest_day: l.suggestDay ?? 0,
    sort: l.sort ?? 0, active: l.active ?? true,
  });
  if (error) return fail(mapDbError(error));
  revalidatePath("/payroll");
  return { ok: true };
}

export async function deletePayPostLegAction(code: string): Promise<SaveResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("pay_post_legs").delete().eq("code", code);
  if (error) return fail(mapDbError(error));
  revalidatePath("/payroll");
  return { ok: true };
}

// ── พนักงาน ─────────────────────────────────────────────────────────────────

export async function saveEmployeeAction(e: Partial<EmployeeRow>): Promise<SaveResult> {
  const supabase = await createClient();
  if (!e.name?.trim()) return fail("กรอกชื่อ-สกุล");
  if (!e.wageType) return fail("เลือกวิธีคิดค่าจ้าง");
  if (!(Number(e.baseWage) > 0)) return fail("ใส่ค่าจ้างมากกว่า 0");

  // เลขบัตรประชาชน: เก็บเฉพาะตัวเลข · ระบบเดิมไม่เช็คเลย ทำให้ 50ทวิ ออกมาเลขไม่ครบ
  const nid = (e.nationalId ?? "").replace(/\D/g, "");
  if (nid && nid.length !== 13) return fail("เลขประจำตัวประชาชนต้องมี 13 หลัก");

  const row = {
    name: e.name.trim(),
    national_id: nid || null,
    sso_no: e.ssoNo?.trim() || null,
    bank_name: e.bankName?.trim() || null,
    bank_acct: e.bankAcct?.trim() || null,
    start_date: e.startDate || null,
    end_date: e.endDate || null,
    group_code: e.groupCode || null,
    wage_type: e.wageType,
    base_wage: Number(e.baseWage),
    sso_exempt: e.ssoExempt ?? false,
    wht_mode: e.whtMode ?? "none",
    wht_fixed: Number(e.whtFixed ?? 0),
    tax_allowances: e.taxAllowances ?? {},
    active: e.active ?? true,
  };

  if (e.empId) {
    const { error } = await supabase.from("employees").update(row).eq("emp_id", e.empId);
    if (error) return fail(mapDbError(error));
    revalidatePath("/payroll");
    return { ok: true, data: { empId: e.empId } };
  }

  const { data: idData, error: idErr } = await supabase.rpc("next_emp_id");
  if (idErr) return fail(mapDbError(idErr));
  const empId = idData as string;
  const { error } = await supabase.from("employees").insert({ ...row, emp_id: empId });
  if (error) return fail(mapDbError(error));
  revalidatePath("/payroll");
  return { ok: true, data: { empId } };
}

// ── งวดจ่าย ─────────────────────────────────────────────────────────────────

/** สร้างงวด + เติมบรรทัดให้พนักงานที่ยัง active (เรียกซ้ำได้ ไม่สร้างซ้ำ) */
export async function createPeriodAction(input: {
  year: number; month: number; workDaysStd: number; payDate: string;
}): Promise<SaveResult> {
  const supabase = await createClient();
  if (!(input.workDaysStd > 0)) return fail("ใส่จำนวนวันทำงานมาตรฐานของเดือนนี้");
  const periodId = `PR-${input.year}-${String(input.month).padStart(2, "0")}`;

  const { data: exist } = await supabase
    .from("payroll_periods").select("status").eq("period_id", periodId).maybeSingle();

  if (!exist) {
    const { error } = await supabase.from("payroll_periods").insert({
      period_id: periodId, year: input.year, month: input.month,
      work_days_std: input.workDaysStd, pay_date: input.payDate || null,
    });
    if (error) return fail(mapDbError(error));
  } else if (exist.status !== "draft") {
    return fail("งวดนี้ลงบัญชีไปแล้ว แก้วันทำงานมาตรฐานไม่ได้ — ต้องถอนการลงบัญชีก่อน");
  } else {
    const { error } = await supabase.from("payroll_periods")
      .update({ work_days_std: input.workDaysStd, pay_date: input.payDate || null })
      .eq("period_id", periodId);
    if (error) return fail(mapDbError(error));
  }

  // เติมบรรทัดของคนที่ยังไม่มีในงวดนี้
  const [{ data: emps }, { data: rows }] = await Promise.all([
    supabase.from("employees").select("emp_id, name, group_code").eq("active", true),
    supabase.from("payroll_items").select("emp_id").eq("period_id", periodId),
  ]);
  const have = new Set((rows ?? []).map((r) => r.emp_id as string));
  const toAdd = (emps ?? []).filter((e) => !have.has(e.emp_id as string));
  if (toAdd.length > 0) {
    const { error } = await supabase.from("payroll_items").insert(
      toAdd.map((e) => ({
        period_id: periodId, emp_id: e.emp_id, emp_name: e.name, group_code: e.group_code,
        inputs: { workDays: input.workDaysStd, values: {}, manual: {} },
      })),
    );
    if (error) return fail(mapDbError(error));
  }

  revalidatePath("/payroll");
  return { ok: true, data: { periodId } };
}

export type LineInput = {
  empId: string;
  workDays: number;
  values: Record<string, number>;
  manual: Record<string, number>;
  whtOverride: number | null;
};

/**
 * คำนวณทั้งงวดแล้วบันทึก — **แช่ผลลัพธ์ไว้** (computed + rates_snapshot)
 * 🪤 ห้ามคำนวณสดตอนเปิดดู ไม่งั้นลูกค้าแก้เกณฑ์กลางปีแล้วงวดที่ยื่นไปแล้วเปลี่ยนตัวเลขย้อนหลัง
 */
export async function savePeriodLinesAction(periodId: string, lines: LineInput[]): Promise<SaveResult> {
  const supabase = await createClient();
  const { period } = await getPeriodDetail(periodId);
  if (!period) return fail("ไม่พบงวด " + periodId);
  if (period.status !== "draft") {
    return fail("งวดนี้ลงบัญชีไปแล้วบางส่วน — ต้องถอนการลงบัญชีให้ครบก่อนถึงจะแก้ตัวเลขได้");
  }

  const cfg = await getPayrollConfig();
  const periodEnd = lastDayISO(period.year, period.month);
  const rates = ratesOn(cfg.rates, periodEnd);
  if (!rates) return fail(`ยังไม่มีชุดอัตราที่มีผลถึงวันที่ ${periodEnd} — ไปตั้งที่แท็บตั้งค่าการคำนวณก่อน`);

  const { data: empRows } = await supabase.from("employees").select("*");
  const empById = new Map((empRows ?? []).map((r) => [r.emp_id as string, r]));

  for (const ln of lines) {
    const r = empById.get(ln.empId);
    if (!r) continue;
    const result = calcLine(r, ln, cfg.components, cfg.variables, rates, cfg.settings, period.year, period.month, period.workDaysStd);
    const { error } = await supabase.from("payroll_items").update({
      inputs: { workDays: ln.workDays, values: ln.values, manual: ln.manual, whtOverride: ln.whtOverride },
      computed: result.line as unknown as Record<string, unknown>,
      rates_snapshot: rates as unknown as Record<string, unknown>,
      base_amount: result.line.baseAmount,
      gross: result.line.gross,
      sso: result.line.sso,
      sso_employer: result.ssoEmployer,
      wht: result.line.wht,
      deductions: result.line.deductions,
      net: result.line.net,
      updated_at: new Date().toISOString(),
    }).eq("period_id", periodId).eq("emp_id", ln.empId);
    if (error) return fail(mapDbError(error));
  }

  revalidatePath("/payroll");
  return { ok: true };
}

// ── ลงบัญชี ─────────────────────────────────────────────────────────────────

export async function postPayrollAction(
  periodId: string,
  legCode: string,
  date: string,
): Promise<SaveResult> {
  const supabase = await createClient();
  const [{ period, items }, cfg] = await Promise.all([getPeriodDetail(periodId), getPayrollConfig()]);
  if (!period) return fail("ไม่พบงวด " + periodId);
  if (!date) return fail("เลือกวันที่ลงบัญชีก่อน");

  const leg = cfg.legs.find((l) => l.code === legCode && l.active !== false);
  if (!leg) return fail("ไม่พบขาลงบัญชีนี้ (อาจถูกลบหรือปิดไปแล้ว)");

  const account = leg.accountName || cfg.payAccount;
  if (!account) return fail("ยังไม่ได้ตั้งบัญชีเงินของขานี้ หรือบัญชีเงินหลัก (แท็บตั้งค่าการคำนวณ)");

  const monthLabel = `${String(period.month).padStart(2, "0")}/${period.year}`;
  const lines = items.map((i) => ({ ...i, items: itemsOf(i) }));

  const base = {
    entityId: cfg.entityId || period.entityId,
    accountName: account,
    category: leg.category,
    contactName: leg.contactName ?? "",
  };

  let payload: Record<string, unknown>;
  if (leg.splitByEmployee) {
    // 1 รายการต่อคน → ตรวจกับสลิปได้ทีละใบ
    payload = {
      ...base,
      lines: lines.map((l) => ({
        empId: l.empId,
        contactName: leg.contactName || l.empName,
        description: `${leg.name} ${monthLabel} — ${l.empName}`,
        amount: legAmount(leg, l),
      })),
    };
  } else {
    payload = {
      ...base,
      description: `${leg.name} ${monthLabel}`,
      amount: lines.reduce((sum, l) => sum + legAmount(leg, l), 0),
    };
  }

  const { data, error } = await supabase.rpc("fn_post_payroll", {
    p_period_id: periodId, p_kind: leg.code, p_date: date, p_payload: payload,
  });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string; duplicate?: boolean };
  if (!res?.ok) return fail(res?.error ?? "ลงบัญชีไม่สำเร็จ");

  revalidatePath("/payroll");
  revalidatePath("/accounting");
  return { ok: true, data: res };
}
export async function unpostPayrollAction(periodId: string, legCode: string): Promise<SaveResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_unpost_payroll", { p_period_id: periodId, p_kind: legCode });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string };
  if (!res?.ok) return fail(res?.error ?? "ถอนการลงบัญชีไม่สำเร็จ");
  revalidatePath("/payroll");
  revalidatePath("/accounting");
  return { ok: true, data: res };
}

// ── helpers ─────────────────────────────────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */

function calcLine(
  r: any,
  ln: LineInput,
  components: PayComponent[],
  variables: PayVariable[],
  rates: PayRates,
  settings: PayrollSettings,
  year: number,
  month: number,
  workDaysStd: number,
) {
  const emp = {
    empId: r.emp_id, name: r.name, groupCode: r.group_code,
    wageType: r.wage_type, baseWage: Number(r.base_wage),
    ssoExempt: r.sso_exempt, whtMode: r.wht_mode, whtFixed: Number(r.wht_fixed),
    taxAllowances: r.tax_allowances ?? {},
  };
  const line = calcPayrollLine(
    emp,
    { workDays: ln.workDays, values: ln.values, manual: ln.manual, whtOverride: ln.whtOverride },
    components,
    rates,
    settings,
    { workDaysStd, monthOfYear: month, yearBE: String(year + 543) },
    variables,
  );
  return { line, ssoEmployer: ssoEmployerContribution(line.ssoWageBase, rates, emp.ssoExempt) };
}

/**
 * รายการที่แจกแจงไว้ของพนักงาน 1 คน — อ่านจาก `computed` ที่ **แช่ไว้ตอนกดบันทึก**
 * ★ ห้ามคำนวณสดที่นี่ ไม่งั้นขาที่อ้างรายการจะได้ยอดคนละชุดกับที่บันทึกไว้
 */
function itemsOf(i: { computed: Record<string, unknown> }) {
  const raw = (i.computed?.items ?? []) as { code: string; kind: "earning" | "deduction"; amount: number }[];
  return Array.isArray(raw) ? raw : [];
}

/** วันสุดท้ายของเดือน (ISO) — ใช้เลือกชุดอัตราที่มีผล ณ งวดนั้น */
function lastDayISO(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0));
  return d.toISOString().slice(0, 10);
}
