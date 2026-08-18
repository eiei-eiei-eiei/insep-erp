import { describe, it, expect } from "vitest";
import { calcPayrollLine, appliesTo, inputValue, tierAmount, roundMoney } from "./calc";
import type { Employee, PayComponent, PayRates, PayrollSettings, PeriodContext } from "./types";

/**
 * ═══ ด่านพิสูจน์ของโมดูลเงินเดือน ═══
 *
 * โจทย์: engine ต้องเป็นกลาง (ไม่มีเกณฑ์ของบริษัทใดในโค้ด) แต่ต้อง **ตั้งค่าให้ได้ตัวเลข
 * ตรงกับที่บริษัทหนึ่งคำนวณจริงทุกบาท** — บริษัทนั้นใช้ระบบ Google Apps Script ที่สูตร
 * ผ่านการเทียบ Excel จริงมาแล้ว 40/40 แถว
 *
 * เกณฑ์ของเขาที่ต้องทำซ้ำให้ได้ (แปลงเป็น config ทั้งหมด ไม่มีบรรทัดไหนอยู่ในโค้ด):
 *   1. เงินเดือน prorate: (ฐาน + ค่าตำแหน่ง) ÷ วันมาตรฐาน × วันมาทำงาน
 *   2. ค่าตำแหน่ง **เข้า** ฐาน prorate แต่ **ไม่เข้า** ฐานคิดอัตราต่อชั่วโมงของ OT
 *   3. ชั่วโมงทำงานวันละ 9 (ไม่ใช่ 8)
 *   4. OT วันทำงาน ×1.5 สำหรับกลุ่มหนึ่ง แต่ ×1.0 สำหรับอีกกลุ่ม · OT วันหยุด ×2 ทุกคน
 *   5. เบี้ยขยัน 2 ส่วน (ขั้นบันไดตามวันขาด + เฉลี่ยคะแนน 2 ช่อง) เฉพาะกลุ่มเดียว
 *   6. ฐานประกันสังคม = เงินเดือนที่ prorate แล้ว **ไม่รวม** OT/เบี้ยขยัน/โบนัส
 *   7. ปัดเป็นจำนวนเต็มบาททุกขั้น แต่อัตรารายวัน/รายชั่วโมงคำนวณ full precision
 *
 * 🚨 พนักงานในไฟล์นี้เป็น **ตัวสมมติทั้งหมด** — ห้ามเอาชื่อ/เงินเดือน/เลขบัตรจริง
 *    ของบริษัทใดลง repo (repo นี้จะถูกขายต่อ)
 */

// ── อัตราตามกฎหมาย (ปกติมาจากตาราง pay_rates ที่มีวันเริ่มมีผล) ────────────────
const RATES: PayRates = {
  effectiveFrom: "2026-01-01",
  ssoRate: 5,
  ssoWageMin: 1650,
  ssoWageMax: 17500,
  pitBrackets: [
    { upTo: 150000, rate: 0 },
    { upTo: 300000, rate: 0.05 },
    { upTo: 500000, rate: 0.1 },
    { upTo: 750000, rate: 0.15 },
    { upTo: 1000000, rate: 0.2 },
    { upTo: 2000000, rate: 0.25 },
    { upTo: 5000000, rate: 0.3 },
    { upTo: 1e15, rate: 0.35 },
  ],
  personalAllowance: 60000,
  expenseRate: 50,
  expenseCap: 100000,
};

const SETTINGS: PayrollSettings = { hoursPerDay: 9, rounding: "baht" };
const CTX: PeriodContext = { workDaysStd: 30, monthOfYear: 5, yearBE: "2569" };

// ── config ที่ "ลูกค้ากรอกเอง" เพื่อทำซ้ำเกณฑ์ข้างบน ───────────────────────────
const COMPONENTS: PayComponent[] = [
  {
    // ค่าตำแหน่งต่างกันรายคน → ผูกกับช่องกรอกแล้วคูณ 1 (แทนที่จะ fixed ทั้งบริษัท)
    code: "pos",
    name: "ค่าตำแหน่ง",
    kind: "earning",
    method: "per_unit",
    amount: 1,
    inputKeys: ["pos_allow"],
    prorateBase: true, // ★ เข้า prorate
    otBase: false, // ★ ไม่เข้าฐาน OT
    ssoBase: true,
    taxable: true,
  },
  {
    code: "ot_work_a",
    name: "ค่าล่วงเวลาวันทำงาน (กลุ่ม A)",
    kind: "earning",
    method: "hourly_multiplier",
    multiplier: 1.5,
    inputKeys: ["ot_work_h"],
    groupCodes: ["A"],
    taxable: true,
    ssoBase: false, // 🚨 เข้าฐานภาษี แต่ไม่ใช่ "ค่าจ้าง" ของประกันสังคม
  },
  {
    code: "ot_work_b",
    name: "ค่าล่วงเวลาวันทำงาน (กลุ่ม B)",
    kind: "earning",
    method: "hourly_multiplier",
    multiplier: 1.0,
    inputKeys: ["ot_work_h"],
    groupCodes: ["B"],
    taxable: true,
    ssoBase: false,
  },
  {
    code: "ot_holiday",
    name: "ค่าล่วงเวลาวันหยุด",
    kind: "earning",
    method: "hourly_multiplier",
    multiplier: 2.0,
    inputKeys: ["ot_holiday_h"],
    taxable: true,
    ssoBase: false,
  },
  {
    code: "attend_absent",
    name: "เบี้ยขยัน (ส่วนขาดงาน)",
    kind: "earning",
    method: "tier_table",
    inputKeys: ["sick_d", "personal_d"],
    inputAgg: "sum",
    tiers: [
      { upTo: 1, amount: 500 },
      { upTo: 1.5, amount: 400 },
      { upTo: 2, amount: 300 },
      { upTo: 2.5, amount: 100 },
    ],
    groupCodes: ["A"],
    taxable: true,
    ssoBase: false,
  },
  {
    code: "attend_score",
    name: "เบี้ยขยัน (คะแนนหัวหน้า)",
    kind: "earning",
    method: "per_unit",
    amount: 1,
    inputKeys: ["score1", "score2"],
    inputAgg: "avg",
    groupCodes: ["A"],
    taxable: true,
    ssoBase: false,
  },
  {
    code: "bonus",
    name: "โบนัส",
    kind: "earning",
    method: "manual",
    taxable: true,
    ssoBase: false,
  },
];

function emp(over: Partial<Employee> = {}): Employee {
  return {
    empId: "E-001",
    name: "พนักงานสมมติ",
    groupCode: "A",
    wageType: "monthly_prorate",
    baseWage: 15000,
    ssoExempt: false,
    whtMode: "none",
    ...over,
  };
}

const run = (e: Employee, values: Record<string, number>, workDays: number, manual = {}) =>
  calcPayrollLine(
    e,
    { workDays, values, manual },
    COMPONENTS,
    RATES,
    SETTINGS,
    CTX,
  );

// ═══════════════════════════════════════════════════════════════════════════════

describe("ทำซ้ำเกณฑ์ของบริษัทตัวอย่างได้ครบโดยไม่แก้โค้ด (กลุ่ม A)", () => {
  // ฐาน 15,000 + ค่าตำแหน่ง 2,000 · มาทำงาน 28 จาก 30 วัน
  // OT วันทำงาน 10 ชม. · OT วันหยุด 5 ชม. · ป่วย 1 + กิจ 0.5 = 1.5 วัน · คะแนน 8/7 · โบนัส 1,000
  const line = run(
    emp(),
    { pos_allow: 2000, ot_work_h: 10, ot_holiday_h: 5, sick_d: 1, personal_d: 0.5, score1: 8, score2: 7 },
    28,
    { bonus: 1000 },
  );

  it("เงินเดือน prorate — (15000+2000)/30×28 = 15,866.67 → 15,867 (ปัดหลังคูณ ไม่ใช่ก่อน)", () => {
    expect(line.baseAmount).toBe(15867);
  });

  it("★ อัตราต่อชั่วโมงไม่รวมค่าตำแหน่ง — 15000/30/9 = 55.5556 (ไม่ใช่ 17000/30/9)", () => {
    expect(line.hourlyRate).toBeCloseTo(55.5556, 4);
  });

  it("OT วันทำงาน ×1.5 = 55.5556×1.5×10 → 833", () => {
    expect(amt(line, "ot_work_a")).toBe(833);
  });

  it("OT วันหยุด ×2 = 55.5556×2×5 → 556", () => {
    expect(amt(line, "ot_holiday")).toBe(556);
  });

  it("เบี้ยขยันส่วนขาดงาน — ขาด 1.5 วัน ตกขั้น 400", () => {
    expect(amt(line, "attend_absent")).toBe(400);
  });

  it("เบี้ยขยันส่วนคะแนน — เฉลี่ย (8+7)/2 = 7.5 → ปัดเป็น 8", () => {
    expect(amt(line, "attend_score")).toBe(8);
  });

  it("โบนัสมาจากช่องกรอกเอง (method manual)", () => {
    expect(amt(line, "bonus")).toBe(1000);
  });

  it("รวมเงินได้ = 15867+833+556+400+8+1000 = 18,664", () => {
    expect(line.gross).toBe(18664);
  });

  it("🚨 ฐานประกันสังคม = เงินเดือนอย่างเดียว ไม่รวม OT/เบี้ยขยัน/โบนัส", () => {
    // ถ้าเผลอเอา gross ไปคิด จะได้ 933 แทน 793
    expect(line.ssoWageBase).toBe(15867);
    expect(line.sso).toBe(793);
  });

  it("ยอดจ่ายจริง = 18664 − 793 = 17,871", () => {
    expect(line.net).toBe(17871);
  });
});

describe("กลุ่ม B — ตัวคูณ OT ต่างกัน และไม่ได้เบี้ยขยัน", () => {
  const line = run(
    emp({ empId: "E-002", groupCode: "B", baseWage: 25000 }),
    { pos_allow: 5000, ot_work_h: 8, sick_d: 3, personal_d: 3, score1: 9, score2: 9 },
    30,
  );

  it("★ ได้ OT ×1.0 ของกลุ่มตัวเอง และ **ไม่ได้** ×1.5 ของกลุ่ม A (ไม่นับซ้ำ)", () => {
    expect(amt(line, "ot_work_b")).toBe(741); // 25000/30/9 × 1.0 × 8
    expect(line.items.find((i) => i.code === "ot_work_a")).toBeUndefined();
  });

  it("ไม่ได้เบี้ยขยันทั้ง 2 ส่วน แม้กรอกวันลา/คะแนนมาครบ", () => {
    expect(line.items.find((i) => i.code === "attend_absent")).toBeUndefined();
    expect(line.items.find((i) => i.code === "attend_score")).toBeUndefined();
  });

  it("★ ชนเพดานประกันสังคม — ฐาน 30,000 ถูกบีบเหลือ 17,500 → สมทบ 875", () => {
    expect(line.ssoWageBase).toBe(17500);
    expect(line.sso).toBe(875);
  });

  it("ยอดจ่ายจริง = (30000+741) − 875 = 29,866", () => {
    expect(line.gross).toBe(30741);
    expect(line.net).toBe(29866);
  });
});

describe("wage_type ทั้ง 3 แบบ", () => {
  it("รายวัน — ค่าแรง 400 × 22 วัน = 8,800 · อัตราต่อชั่วโมง = 400/9", () => {
    const line = run(
      emp({ groupCode: "C", wageType: "daily", baseWage: 400 }),
      { ot_holiday_h: 4 },
      22,
    );
    expect(line.baseAmount).toBe(8800);
    expect(line.hourlyRate).toBeCloseTo(44.4444, 4);
    expect(amt(line, "ot_holiday")).toBe(356); // 44.4444×2×4 = 355.56
    expect(line.sso).toBe(440);
  });

  it("รายเดือนเต็มจำนวน — มาทำงานกี่วันก็ไม่ลด", () => {
    const line = run(emp({ groupCode: "C", wageType: "monthly", baseWage: 20000 }), {}, 15);
    expect(line.baseAmount).toBe(20000);
  });

  it("รายเดือน prorate — มาครบทุกวันได้เต็ม", () => {
    const line = run(emp({ groupCode: "C", baseWage: 20000 }), {}, 30);
    expect(line.baseAmount).toBe(20000);
  });
});

describe("🎯 ธง 4 ตัวแยกฐานถูกต้อง — จุดที่ระบบเงินเดือนพลาดกันบ่อยที่สุด", () => {
  const comps: PayComponent[] = [
    { code: "a", name: "เข้าทั้งภาษีและ สปส.", kind: "earning", method: "fixed", amount: 1000, taxable: true, ssoBase: true },
    { code: "b", name: "เข้าภาษีอย่างเดียว", kind: "earning", method: "fixed", amount: 2000, taxable: true, ssoBase: false },
    { code: "c", name: "ไม่เข้าฐานไหนเลย", kind: "earning", method: "fixed", amount: 500 },
  ];
  const line = calcPayrollLine(
    emp({ groupCode: null, baseWage: 10000, wageType: "monthly" }),
    { workDays: 30, values: {} },
    comps,
    RATES,
    SETTINGS,
    CTX,
  );

  it("ฐาน สปส. นับเฉพาะที่ติดธง ssoBase (10000+1000 = 11,000)", () => {
    expect(line.ssoWageBase).toBe(11000);
    expect(line.sso).toBe(550);
  });

  it("รวมเงินได้นับทุกรายการ ไม่ว่าติดธงไหน (10000+1000+2000+500)", () => {
    expect(line.gross).toBe(13500);
  });
});

describe("ตารางขั้นบันได (tier_table) — ตรงขอบทุกช่วง", () => {
  const tiers = [
    { upTo: 1, amount: 500 },
    { upTo: 1.5, amount: 400 },
    { upTo: 2, amount: 300 },
    { upTo: 2.5, amount: 100 },
  ];
  it("ค่าขอบนับรวมในขั้นนั้น (<=)", () => {
    expect(tierAmount(tiers, 0)).toBe(500);
    expect(tierAmount(tiers, 1)).toBe(500);
    expect(tierAmount(tiers, 1.01)).toBe(400);
    expect(tierAmount(tiers, 1.5)).toBe(400);
    expect(tierAmount(tiers, 2)).toBe(300);
    expect(tierAmount(tiers, 2.5)).toBe(100);
  });
  it("เกินขั้นสุดท้าย = 0", () => {
    expect(tierAmount(tiers, 2.51)).toBe(0);
    expect(tierAmount(tiers, 99)).toBe(0);
  });
});

describe("รายการหัก + override", () => {
  const comps: PayComponent[] = [
    { code: "late", name: "หักมาสาย", kind: "deduction", method: "per_unit", amount: 100, inputKeys: ["late_times"] },
    { code: "loan", name: "หักเงินกู้", kind: "deduction", method: "fixed", amount: 1500 },
  ];
  it("หักครบทุกรายการ และไม่ไปโผล่ในรวมเงินได้", () => {
    const line = calcPayrollLine(
      emp({ groupCode: null, baseWage: 20000, wageType: "monthly" }),
      { workDays: 30, values: { late_times: 3 } },
      comps,
      RATES,
      SETTINGS,
      CTX,
    );
    expect(line.gross).toBe(20000);
    expect(line.deductions).toBe(1800);
    expect(line.sso).toBe(875);
    expect(line.net).toBe(20000 - 875 - 1800);
  });

  it("★ override ภาษีชนะทุกอย่าง แม้ตั้ง whtMode = auto", () => {
    const line = calcPayrollLine(
      emp({ groupCode: null, baseWage: 50000, wageType: "monthly", whtMode: "auto" }),
      { workDays: 30, values: {}, whtOverride: 1234 },
      [],
      RATES,
      SETTINGS,
      CTX,
    );
    expect(line.wht).toBe(1234);
  });

  it("whtMode fixed หักยอดคงที่ · none = ไม่หัก", () => {
    const base = { workDays: 30, values: {} };
    const f = calcPayrollLine(emp({ groupCode: null, wageType: "monthly", whtMode: "fixed", whtFixed: 300 }), base, [], RATES, SETTINGS, CTX);
    const nn = calcPayrollLine(emp({ groupCode: null, wageType: "monthly", whtMode: "none" }), base, [], RATES, SETTINGS, CTX);
    expect(f.wht).toBe(300);
    expect(nn.wht).toBe(0);
  });
});

describe("helper", () => {
  it("appliesTo — ไม่ระบุกลุ่ม = ทุกคน · ระบุแล้วต้องตรง · active=false ถูกข้าม", () => {
    const c = (o: Partial<PayComponent>) => ({ code: "x", name: "x", kind: "earning" as const, method: "fixed" as const, ...o });
    expect(appliesTo(c({}), "A")).toBe(true);
    expect(appliesTo(c({ groupCodes: [] }), null)).toBe(true);
    expect(appliesTo(c({ groupCodes: ["A"] }), "A")).toBe(true);
    expect(appliesTo(c({ groupCodes: ["A"] }), "B")).toBe(false);
    expect(appliesTo(c({ groupCodes: ["A"] }), null)).toBe(false);
    expect(appliesTo(c({ active: false }), "A")).toBe(false);
  });

  it("inputValue — sum เป็นค่าปริยาย · avg หารด้วยจำนวนช่อง", () => {
    const c = (keys: string[], agg?: "sum" | "avg") =>
      ({ code: "x", name: "x", kind: "earning" as const, method: "per_unit" as const, inputKeys: keys, inputAgg: agg });
    expect(inputValue(c(["a", "b"]), { a: 1, b: 2 })).toBe(3);
    expect(inputValue(c(["a", "b"], "avg"), { a: 8, b: 7 })).toBe(7.5);
    expect(inputValue(c([]), { a: 1 })).toBe(0);
    expect(inputValue(c(["missing"]), {})).toBe(0);
  });

  it("roundMoney — baht ปัดจำนวนเต็ม · satang เก็บ 2 ตำแหน่ง", () => {
    expect(roundMoney(15866.667, "baht")).toBe(15867);
    expect(roundMoney(15866.667, "satang")).toBe(15866.67);
  });
});

/** ยอดของรายการหนึ่งในผลลัพธ์ */
function amt(line: { items: { code: string; amount: number }[] }, code: string): number {
  return line.items.find((i) => i.code === code)?.amount ?? 0;
}
