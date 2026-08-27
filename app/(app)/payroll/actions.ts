"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mapDbError } from "@/lib/shared/dbError";
import { calcPayrollLine } from "@/lib/payroll/calc";
import { ssoEmployerContribution, ratesOn } from "@/lib/payroll/sso";
import { legAmount } from "@/lib/payroll/legs";
import { nextWhtDocNo } from "@/lib/accounting/wht";
import type {
  PayComponent,
  PayPostLeg,
  PayRates,
  PayVariable,
  PayrollSettings,
} from "@/lib/payroll/types";
import { getPayrollConfig, getPeriodDetail, getEmployees, type EmployeeRow } from "./data";
import { employeeForCalc } from "@/lib/payroll/periodView";
import { isEmployedInPeriod } from "@/lib/payroll/employment";

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
  if (!input.label.trim()) return fail("กรอกชื่อช่องที่จะให้แสดงบนหน้าจอ");
  // ★ ของใหม่ไม่ต้องคิดรหัสเอง · ของเดิมใช้รหัสเดิมเสมอ (ข้อมูลที่แช่ไว้อ้างรหัสนี้)
  const code = input.code.trim() || (await nextCode(supabase, "pay_inputs", "in"));
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
  if (!c.name.trim()) return fail("กรอกชื่อรายการที่จะขึ้นบนสลิป");
  const code = c.code.trim() || (await nextCode(supabase, "pay_components", "item"));
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
  if (!v.name.trim()) return fail("ตั้งชื่อตัวแปรที่คนอ่านรู้เรื่อง เช่น อัตราค่าล่วงเวลาต่อชั่วโมง");
  const code = v.code.trim() || (await nextCode(supabase, "pay_variables", "var"));
  if (v.source === "input" && !v.inputKey) return fail("เลือกช่องกรอกที่จะใช้เป็นตัวตั้ง");

  // 🚨 ด่านจริงของ "ชุดปิด" อยู่ตรงนี้ — anon key เป็นค่าสาธารณะ ยิง PostgREST ตรงได้
  //    ปล่อย op แปลก ๆ เข้าไปแล้วโค้ดจะตีความเป็น div เงียบ ๆ = ตัวเลขผิดโดยไม่มีใครรู้
  const steps = v.steps ?? v.divisors ?? [];
  for (const st of steps) {
    if (st.op && !VAR_OPS.includes(st.op)) return fail("ตัวดำเนินการต้องเป็น บวก/ลบ/คูณ/หาร เท่านั้น");
    if (st.kind === "input" && !st.inputKey) return fail("ขั้นที่เลือกช่องกรอก ต้องระบุว่าช่องไหนด้วย");
  }
  if (v.rounding && !VAR_ROUNDINGS.includes(v.rounding)) return fail("ค่าความละเอียดไม่ถูกต้อง");

  const { error } = await supabase.from("pay_variables").upsert({
    code, name: v.name.trim(), source: v.source,
    const_value: v.constValue ?? 0, input_key: v.inputKey ?? null,
    // ★ เขียน op ลงไปเสมอ (ไม่ปล่อยว่างให้ไปพึ่งค่าปริยาย) — ข้อมูลที่อ่านแล้วเข้าใจได้เอง
    //   ปลอดภัยกว่าตอนมีคนมาไล่ดูใน DB ภายหลัง
    steps: steps.map((st) => ({ ...st, op: st.op ?? "div" })),
    rounding: v.rounding ?? "none",
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
  if (!l.name.trim()) return fail("ตั้งชื่อขาที่จะขึ้นบนปุ่ม");
  const code = l.code.trim() || (await nextCode(supabase, "pay_post_legs", "leg"));
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
  // 🚨 กรองด้วย **ช่วงเวลาที่เป็นลูกจ้างจริง** ไม่ใช่ธง active อย่างเดียว —
  //    คนที่ลาออกกลางเดือนยังต้องได้เงินงวดนั้น (ดูเหตุผลเต็มใน lib/payroll/employment)
  const [{ data: emps }, { data: rows }] = await Promise.all([
    supabase.from("employees").select("emp_id, name, group_code, start_date, end_date, active"),
    supabase.from("payroll_items").select("emp_id").eq("period_id", periodId),
  ]);
  const have = new Set((rows ?? []).map((r) => r.emp_id as string));
  const toAdd = (emps ?? []).filter(
    (e) =>
      !have.has(e.emp_id as string) &&
      isEmployedInPeriod(
        { startDate: e.start_date as string | null, endDate: e.end_date as string | null, active: e.active as boolean },
        input.year,
        input.month,
      ),
  );
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

  // ★ ใช้ตัวอ่านเดียวกับที่หน้าจอใช้ (mapper เดียวกัน) → ประกอบ Employee ได้เหมือนกันเป๊ะ
  const empById = new Map((await getEmployees()).map((e) => [e.empId, e]));

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

function calcLine(
  r: EmployeeRow,
  ln: LineInput,
  components: PayComponent[],
  variables: PayVariable[],
  rates: PayRates,
  settings: PayrollSettings,
  year: number,
  month: number,
  workDaysStd: number,
) {
  // 🚨 ประกอบด้วยตัวเดียวกับฝั่งพรีวิว — ห้ามเขียนซ้ำที่นี่อีก (ดูเหตุผลใน employeeForCalc)
  const emp = employeeForCalc(r);
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

// ── 50 ทวิ ของพนักงาน (D69) ─────────────────────────────────────────────────

/**
 * เลขที่ 50ทวิ ใบถัดไป
 * 🚨 **ชุดเดียวกับใบของคู่ค้าฝั่งบัญชี ต่อ entity** (ระบบเดิมก็ใช้ชีต pnd3-53 ร่วมกัน)
 *    แยกชุดเมื่อไหร่ = เลขซ้ำกันข้ามชุดในกิจการเดียว ซึ่งกรมสรรพากรไล่ไม่ได้
 */
export async function nextEmpWhtDocNoAction(entityId: string): Promise<string> {
  const supabase = await createClient();
  // 🚨 ต้องผ่าน RPC — ตั้งแต่ D85 ฝ่ายเงินเดือนเห็นแถวใน wht_certificates เฉพาะใบของ
  //    **พนักงาน** (policy กรอง emp_id) · select ตรง ๆ จะเห็นแค่ครึ่งเดียวแล้วออกเลขซ้ำ
  //    กับใบของคู่ค้า ซึ่งเป็นเอกสารที่ยื่นสรรพากรไปแล้ว (เลขชุดเดียวกันต่อกิจการ — D69)
  const { data } = await supabase.rpc("fn_wht_doc_nos", { p_entity_id: entityId });
  return nextWhtDocNo(((data ?? []) as string[]).map((d) => String(d)));
}

/**
 * ออก 50ทวิ ให้พนักงาน 1 คนสำหรับทั้งปี
 *
 * ★ ออกให้ได้แม้ภาษีเป็น 0 — ม.50 ทวิ ไม่ได้ยกเว้นกรณีไม่มีภาษี และลูกจ้างต้องใช้
 *   ใบนี้ไปยื่น ภงด.91 ของตัวเอง
 * ★ ไม่ส่ง `p_tx_ids` — ใบของพนักงานไม่ผูกกับ transaction ใบใดใบหนึ่ง (ขา NET ลงเป็นรายเดือน)
 *   ถ้าส่งไป RPC จะไปเขียน `payment_date` ทับรายการบัญชี ซึ่งไม่ใช่ความหมายของใบนี้
 */
export async function issueEmp50TawiAction(input: {
  docNo: string;
  entityId: string;
  empId: string;
  empName: string;
  address?: string;
  taxYearBE: number;
  income: number;
  whtAmount: number;
  issueDate?: string;
}): Promise<SaveResult> {
  if (!input.docNo.trim()) return fail("ยังไม่ได้ระบุเลขที่เอกสาร");
  if (!input.empId) return fail("ยังไม่ได้เลือกพนักงาน");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_issue_wht", {
    p_doc_no: input.docNo.trim(),
    p_tx_ids: [],
    p_issue_date: input.issueDate ?? null,
    p_contact_name: input.empName,
    p_address: input.address ?? "",
    p_wht_amount: input.whtAmount,
    p_pnd_type: "ภ.ง.ด.1ก",
    p_income_type: "เงินเดือน",
    p_income_seq: 1, // มาตรา 40(1) เงินเดือน ค่าจ้าง
    p_base_amount: input.income,
    p_payment_date: null,
    p_entity_id: input.entityId,
    p_contact_id: null, // ★ ลูกจ้างไม่ได้อยู่ใน contacts โดยตั้งใจ (D66)
    p_emp_id: input.empId,
    p_tax_year: input.taxYearBE,
  });
  if (error) return fail(mapDbError(error));
  const res = data as { ok: boolean; error?: string; doc_no?: string };
  if (!res.ok) return fail(res.error ?? "ออกเอกสารไม่สำเร็จ");
  revalidatePath("/payroll");
  return { ok: true, data: res };
}

/** ชุดปิดที่ยอมรับ — ต้องตรงกับ `VarOp` / `VarRounding` ใน types.ts เป๊ะ */
const VAR_OPS: string[] = ["add", "sub", "mul", "div"];
const VAR_ROUNDINGS: string[] = ["none", "int", "dec2"];

/**
 * สลับลำดับคอลัมน์ "ช่องที่ต้องกรอกต่อคนต่องวด"
 *
 * ทำไมต้องมี: ตารางงวดจ่ายเรียงคอลัมน์ตาม `sort` ซึ่งเดิมได้ค่ามาจาก "ลำดับที่เพิ่ม"
 * → ช่องที่เพิ่มทีหลังไปอยู่ท้ายสุดเสมอ ทั้งที่อาจเป็นช่องที่ต้องกรอกทุกงวด
 *
 * ★ เขียนใหม่ทั้งชุดตามลำดับที่ส่งมา (ไม่ใช่สลับทีละคู่) — ลำดับที่เห็นบนจอ
 *   คือลำดับที่บันทึก ไม่มีทางเหลื่อมกัน แม้ค่า sort เดิมจะซ้ำ/ข้ามเลข
 */
export async function reorderPayInputsAction(codes: string[]): Promise<SaveResult> {
  const supabase = await createClient();
  if (codes.length === 0) return { ok: true };
  for (let i = 0; i < codes.length; i++) {
    const { error } = await supabase.from("pay_inputs").update({ sort: i }).eq("code", codes[i]);
    if (error) return fail(mapDbError(error));
  }
  revalidatePath("/payroll");
  return { ok: true };
}

/**
 * รหัสถัดไปของตารางตั้งค่า — **ผู้ใช้ไม่ต้องคิดรหัสเอง** (D72)
 *
 * ทำไมยังต้องมีรหัส: มันคือคีย์ที่ของอื่นอ้างถึง —
 * `pay_components.variable_code` · `pay_components.input_keys[]` · `pay_post_legs.component_code`
 * และที่สำคัญกว่านั้นคือ **`payroll_items.inputs`/`computed` ที่แช่ไว้แล้วอ้างด้วยรหัสนี้**
 * 🚨 จึงสร้างรหัสให้เฉพาะ**ของใหม่**เท่านั้น · ของที่บันทึกแล้วห้ามเปลี่ยนรหัสเด็ดขาด
 *    (เปลี่ยนเมื่อไหร่ = งวดเก่าอ่านค่าที่แช่ไว้ไม่เจอ แล้วยอดกลายเป็น 0 เงียบ ๆ)
 */
async function nextCode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: "pay_inputs" | "pay_variables" | "pay_components" | "pay_post_legs",
  prefix: string,
): Promise<string> {
  const { data } = await supabase.from(table).select("code");
  let max = 0;
  for (const r of data ?? []) {
    const m = /^([a-z_]+)(\d+)$/.exec(String((r as { code: string }).code ?? ""));
    if (m && m[1] === prefix) max = Math.max(max, Number(m[2]));
  }
  return `${prefix}${max + 1}`;
}

/**
 * เอาพนักงาน 1 คนออกจากงวด (เฉพาะงวดร่าง)
 *
 * ทำไมต้องมี: ตัวกรองตอน "เติมพนักงาน" แก้เฉพาะ**การเติมครั้งใหม่** —
 * แถวที่ถูกเติมไปแล้วก่อนที่จะติ๊ก "ยังทำงานอยู่" ออก / ก่อนใส่วันพ้นสภาพ **ยังค้างอยู่ในงวด**
 * ★ กติกาของโปรเจกต์: ทุกจุดที่บันทึกข้อมูลได้ต้องลบจากแอปได้ (FLOW_REDESIGN sec 10)
 *
 * 🚨 งวดที่ลงบัญชีไปแล้วห้ามลบ — ยอดที่ลงบัญชี/ยื่นไปแล้วจะไม่ตรงกับงวดทันที
 */
export async function removePeriodLineAction(periodId: string, empId: string): Promise<SaveResult> {
  const supabase = await createClient();
  const { data: period } = await supabase
    .from("payroll_periods").select("status").eq("period_id", periodId).maybeSingle();
  if (!period) return fail("ไม่พบงวด " + periodId);
  if (period.status !== "draft") {
    return fail("งวดนี้ลงบัญชีไปแล้ว — ต้องถอนการลงบัญชีให้ครบก่อนถึงจะเอาคนออกจากงวดได้");
  }
  const { error } = await supabase
    .from("payroll_items").delete().eq("period_id", periodId).eq("emp_id", empId);
  if (error) return fail(mapDbError(error));
  revalidatePath("/payroll");
  return { ok: true };
}
