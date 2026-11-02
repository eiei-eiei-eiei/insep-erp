import { describe, it, expect } from "vitest";
import { calcPayrollLine, appliesTo } from "./calc";
import {
  componentForWage, dailyWageWarnings, defaultWorkDayRows, formulaWorkDays, overrideFromInput,
  resolveWorkDays, storedOverride, wageSwitchWarning, wageTypesText, workDayCaption,
  workDayRuleError, workDayRuleText,
} from "./workDays";
import type { Employee, PayComponent, PayRates, PayrollSettings, PayVariable } from "./types";

/**
 * Golden: บริษัทที่มีพนักงานครบ 3 แบบ
 * ตัวเลขคาดหวังคำนวณมือจากสูตร ไม่ได้ก๊อปจากผลของโค้ด
 */
const RATES: PayRates = {
  effectiveFrom: "2026-01-01", ssoRate: 5, ssoWageMin: 1650, ssoWageMax: 17500,
  pitBrackets: [{ upTo: 150000, rate: 0 }, { upTo: 1e15, rate: 0.05 }],
  personalAllowance: 60000, expenseRate: 50, expenseCap: 100000,
};
const SET: PayrollSettings = { hoursPerDay: 8, rounding: "baht" };
const CTX = { workDaysStd: 23, monthOfYear: 10, yearBE: "2569" };

const RULES: PayVariable[] = [
  { code: "workdays_prorate", name: "ลดตามวัน", source: "work_days_std", workDaysFor: "monthly_prorate", steps: [{ op: "sub", kind: "input", inputKey: "personal_d" }] },
  { code: "workdays_daily", name: "รายวัน", source: "input", inputKey: "days", workDaysFor: "daily", steps: [] },
];

const base = { whtMode: "none", taxAllowances: {}, ssoExempt: false } as const;
const A: Employee = { ...base, empId: "A", name: "เต็ม", groupCode: null, wageType: "monthly", baseWage: 30000 };
const B: Employee = { ...base, empId: "B", name: "ลดตามวัน", groupCode: null, wageType: "monthly_prorate", baseWage: 23000 };
const C: Employee = { ...base, empId: "C", name: "รายวัน", groupCode: null, wageType: "daily", baseWage: 500 };

const HOURLY: PayVariable = { code: "hourly", name: "ต่อชั่วโมง", source: "wage_per_day", steps: [{ op: "div", kind: "hours_per_day" }] };
const OT: PayComponent = { code: "ot", name: "OT", kind: "earning", method: "variable", variableCode: "hourly", multiplier: 1.5, inputKeys: ["ot_h"], taxable: true };
const POS: PayComponent = { code: "pos", name: "ค่าตำแหน่ง", kind: "earning", method: "per_unit", amount: 1, inputKeys: ["pos_allow"], prorateBase: true, ssoBase: true, taxable: true, wageTypes: ["monthly", "monthly_prorate"] };

function line(e: Employee, values: Record<string, number>, comps: PayComponent[] = [], vars: PayVariable[] = []) {
  const workDays = resolveWorkDays(e.wageType, RULES, CTX.workDaysStd, values, null);
  return { workDays, ...calcPayrollLine(e, { workDays, values, manual: {} }, comps, RATES, SET, CTX, vars) };
}

describe("golden B — พนักงาน 3 แบบในบริษัทเดียว", () => {
  const v = { personal_d: 2, days: 26 };

  it("รายเดือนเต็ม: ลากิจไม่กระทบเงิน", () => {
    const l = line(A, v);
    expect(l.workDays).toBe(23);
    expect(l.baseAmount).toBe(30000);
  });

  it("รายเดือนลดตามวัน: 23,000 ÷ 23 × 21 = 21,000", () => {
    const l = line(B, v);
    expect(l.workDays).toBe(21);
    expect(l.baseAmount).toBe(21000);
  });

  it("รายวัน: 500 × 26 วันที่มาจริง = 13,000 ไม่ถูกหักด้วยสูตรของรายเดือน", () => {
    const l = line(C, v);
    expect(l.workDays).toBe(26);
    expect(l.baseAmount).toBe(13000);
  });

  it("OT ตัวแปรตัวเดียว ค่าจ้างต่อวัน ÷ ชม. ถูกทั้ง 3 แบบ", () => {
    const ot = (e: Employee) => line(e, { ...v, ot_h: 10 }, [OT], [HOURLY]).items[0].amount;
    expect(ot(A)).toBe(Math.round((30000 / 23 / 8) * 1.5 * 10)); // 2446
    expect(ot(B)).toBe(Math.round((23000 / 23 / 8) * 1.5 * 10)); // 1875
    expect(ot(C)).toBe(Math.round((500 / 8) * 1.5 * 10));        // 938 ไม่ใช่ 41
  });

  it("ค่าตำแหน่งจำกัดชนิดค่าจ้าง: รายเดือนได้ · รายวันไม่ถูกคูณวัน", () => {
    const p = { ...v, pos_allow: 500 };
    expect(line(A, p, [POS]).baseAmount).toBe(30500);
    expect(line(B, p, [POS]).baseAmount).toBe(Math.round((23500 / 23) * 21));
    expect(line(C, p, [POS]).baseAmount).toBe(13000);
  });
});

describe("appliesTo — ตัวกรองชนิดค่าจ้าง", () => {
  const c: PayComponent = { code: "x", name: "x", kind: "earning", method: "fixed" };

  it("🚨 ไม่ติ๊กเลย = ใช้กับทุกชนิด (รายการของลูกค้าเดิมไม่ขยับ)", () => {
    expect(appliesTo(c, null, "daily")).toBe(true);
    expect(appliesTo({ ...c, wageTypes: [] }, null, "monthly")).toBe(true);
  });

  it("ติ๊กแล้วได้เฉพาะชนิดนั้น", () => {
    const m = { ...c, wageTypes: ["monthly" as const] };
    expect(appliesTo(m, null, "monthly")).toBe(true);
    expect(appliesTo(m, null, "daily")).toBe(false);
  });

  it("ต้องผ่านทั้งกลุ่มและชนิดค่าจ้าง", () => {
    const m = { ...c, wageTypes: ["daily" as const], groupCodes: ["ช่าง"] };
    expect(appliesTo(m, "ช่าง", "daily")).toBe(true);
    expect(appliesTo(m, "หัวหน้า", "daily")).toBe(false);
    expect(appliesTo(m, "ช่าง", "monthly")).toBe(false);
  });

  it("ไม่ส่งชนิดค่าจ้าง = ไม่กรองด่านนี้ (ผู้เรียกเดิม)", () => {
    expect(appliesTo({ ...c, wageTypes: ["daily"] }, null)).toBe(true);
  });
});

describe("สูตรวันทำงาน", () => {
  const rule = RULES[0];

  it("🚨 ไม่มีสูตร = วันมาตรฐาน (พฤติกรรมเดิม)", () => {
    expect(formulaWorkDays(undefined, 23, { personal_d: 2 })).toBe(23);
  });

  it("ค่าเริ่มต้นที่ seed ให้ผลเท่าวันมาตรฐาน", () => {
    const seeded = defaultWorkDayRows("t");
    expect(seeded).toHaveLength(2);
    for (const r of seeded) {
      expect(formulaWorkDays({ ...r, workDaysFor: r.work_days_for, steps: [] } as unknown as PayVariable, 23, { personal_d: 2 })).toBe(23);
    }
  });

  it("ครึ่งวันคิดได้", () => {
    expect(formulaWorkDays(rule, 23, { personal_d: 1.5 })).toBe(21.5);
  });

  it("ลาเกินวันมาตรฐาน = 0 ไม่ติดลบ", () => {
    expect(formulaWorkDays(rule, 23, { personal_d: 25 })).toBe(0);
  });

  it("ค่าที่แก้รายคนชนะสูตร", () => {
    expect(resolveWorkDays("monthly_prorate", RULES, 23, { personal_d: 2 }, 10)).toBe(10);
  });

  it("แก้รายคนเป็น 0 ได้ (ไม่ถูกมองว่าไม่ได้แก้)", () => {
    expect(resolveWorkDays("daily", RULES, 23, { days: 26 }, 0)).toBe(0);
  });

  it("รายเดือนเต็มไม่สนค่าแก้รายคน", () => {
    expect(resolveWorkDays("monthly", RULES, 23, {}, 10)).toBe(23);
  });

  it("สูตรอ้างค่าจ้างไม่ได้ (วนกลับหาตัวเอง)", () => {
    expect(workDayRuleError({ source: "base_wage" })).toContain("ใช้ได้แค่");
    expect(workDayRuleError({ source: "work_days_std", steps: [{ op: "sub", kind: "work_days_actual" }] })).toContain("ใช้ได้แค่");
  });

  it("เลือกช่องกรอกแล้วต้องระบุช่อง", () => {
    expect(workDayRuleError({ source: "input" })).toContain("เลือกช่องกรอก");
    expect(workDayRuleError({ source: "work_days_std", steps: [{ op: "sub", kind: "input" }] })).toContain("เลือกช่องกรอก");
  });

  it("สูตรที่ถูกผ่าน", () => {
    expect(workDayRuleError(rule)).toBeNull();
  });
});

describe("แถวก่อน D152", () => {
  it("🚨 แถวที่กรอกเองไว้ต้องเก็บค่า ไม่ทิ้งเงียบ ๆ", () => {
    expect(storedOverride({ workDays: 21 }, 23)).toBe(21);
  });

  it("แถวที่เท่าวันมาตรฐาน = ยังไม่มีใครแตะ", () => {
    expect(storedOverride({ workDays: 23 }, 23)).toBeNull();
  });

  it("แถวใหม่ที่มีช่องแล้ว อ่านค่าตรง ๆ", () => {
    expect(storedOverride({ workDays: 30, workDaysOverride: null }, 23)).toBeNull();
    expect(storedOverride({ workDays: 21, workDaysOverride: 21 }, 21)).toBe(21);
  });

  it("ไม่มีค่าเลย = ใช้สูตร", () => {
    expect(storedOverride({}, 23)).toBeNull();
  });
});

describe("ช่องวันทำงานในตาราง", () => {
  it("พิมพ์เท่าสูตรหรือลบค่าออก = กลับไปใช้สูตร", () => {
    expect(overrideFromInput(21, 21)).toBeNull();
    expect(overrideFromInput("", 21)).toBeNull();
  });

  it("พิมพ์ค่าอื่น = แก้รายคน รวมถึง 0", () => {
    expect(overrideFromInput(10, 21)).toBe(10);
    expect(overrideFromInput(0, 21)).toBe(0);
  });
});

describe("ข้อความสูตร", () => {
  const labels = { personal_d: "ลากิจ", days: "วันมาทำงาน" };

  it("บอกสูตรของแต่ละชนิด", () => {
    expect(workDayRuleText("monthly_prorate", RULES, labels)).toBe("วันมาตรฐาน − ลากิจ");
    expect(workDayRuleText("daily", RULES, labels)).toBe("วันมาทำงาน");
    expect(workDayRuleText("monthly", RULES, labels)).toBe("ไม่ใช้วันทำงานคิดเงิน");
  });

  it("ไม่มีแถวสูตร = บอกว่าใช้วันมาตรฐาน", () => {
    expect(workDayRuleText("daily", [], labels)).toBe("วันมาตรฐาน");
  });

  it("บรรทัดเหนือตารางแสดงเฉพาะชนิดที่มีคนในงวด", () => {
    expect(workDayCaption(["monthly_prorate"], RULES, labels)).toBe("วันทำงาน: รายเดือน (ลดตามวันมาทำงาน) = วันมาตรฐาน − ลากิจ");
    expect(workDayCaption(["monthly"], RULES, labels)).toBe("");
  });

  it("คอลัมน์ใช้กับ", () => {
    expect(wageTypesText({ code: "x", name: "x", kind: "earning", method: "fixed" })).toBe("ทุกแบบ");
    expect(wageTypesText({ code: "x", name: "x", kind: "earning", method: "fixed", wageTypes: ["daily"] })).toBe("รายวัน");
    expect(wageTypesText({ code: "x", name: "x", kind: "earning", method: "fixed", wageTypes: ["monthly", "monthly_prorate", "daily"] })).toBe("ทุกแบบ");
  });

  it("ปุ่มดูตามชนิดค่าจ้าง", () => {
    expect(componentForWage(POS, "daily")).toBe(false);
    expect(componentForWage(POS, "monthly")).toBe(true);
    expect(componentForWage(OT, "daily")).toBe(true);
  });
});

describe("เตือนการตั้งค่าที่เสี่ยงกับคนรายวัน", () => {
  const OLD: PayVariable = { code: "old", name: "อัตราเดิม", source: "base_wage", steps: [{ op: "div", kind: "work_days_std" }, { op: "div", kind: "hours_per_day" }] };
  const OT_OLD: PayComponent = { ...OT, variableCode: "old" };
  const POS_ALL: PayComponent = { ...POS, wageTypes: [] };
  const PCT: PayComponent = { code: "pct", name: "เบี้ย 5%", kind: "earning", method: "percent_base", rate: 5 };
  const daily = [{ wageType: "daily" as const, groupCode: null }];
  const noDaily = [{ wageType: "monthly" as const, groupCode: null }];

  it("ตัวแปรที่หารวันมาตรฐาน", () => {
    expect(dailyWageWarnings([OT_OLD], [OLD], daily)[0]).toContain("หารวันมาตรฐาน");
  });

  it("รายการที่รวมกับค่าจ้างฐาน", () => {
    expect(dailyWageWarnings([POS_ALL], [], daily)[0]).toContain("บาทต่อวัน");
  });

  it("รายการ % ของค่าจ้างฐาน", () => {
    expect(dailyWageWarnings([PCT], [], daily)[0]).toContain("ค่าแรงต่อวัน");
  });

  it("ไม่เตือนเมื่อไม่มีคนรายวัน", () => {
    expect(dailyWageWarnings([OT_OLD, POS_ALL, PCT], [OLD], noDaily)).toEqual([]);
  });

  it("ไม่เตือนเมื่อจำกัดรายการแล้ว หรือใช้ตัวแปรค่าจ้างต่อวัน", () => {
    expect(dailyWageWarnings([POS, { ...OT_OLD, wageTypes: ["monthly"] }, OT], [OLD, HOURLY], daily)).toEqual([]);
  });

  it("คนรายวันอยู่นอกกลุ่มของรายการ = ไม่เตือน", () => {
    expect(dailyWageWarnings([{ ...PCT, groupCodes: ["ช่าง"] }], [], daily)).toEqual([]);
  });
});

describe("เปลี่ยนวิธีคิดค่าจ้างของคนเดิม", () => {
  it("เงินเดือน → รายวัน ตัวเลขเดิม = เตือน", () => {
    expect(wageSwitchWarning("monthly_prorate", "daily", 23000, 23000)).toContain("ค่าแรงต่อวัน");
  });

  it("รายวัน → เงินเดือน ตัวเลขเดิม = เตือน", () => {
    expect(wageSwitchWarning("daily", "monthly", 500, 500)).toContain("เงินเดือน");
  });

  it("แก้ตัวเลขแล้ว = ไม่เตือน", () => {
    expect(wageSwitchWarning("monthly", "daily", 23000, 500)).toBeNull();
  });

  it("สลับระหว่างรายเดือนด้วยกัน = ตัวเลขยังหมายถึงเงินเดือน", () => {
    expect(wageSwitchWarning("monthly", "monthly_prorate", 23000, 23000)).toBeNull();
  });

  it("พนักงานใหม่ = ไม่เตือน", () => {
    expect(wageSwitchWarning(undefined, "daily", undefined, 500)).toBeNull();
  });
});
