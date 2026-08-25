import { describe, it, expect } from "vitest";
import {
  pnd1Rows,
  sso110Rows,
  pnd1kRows,
  wht50Totals,
  taxBaseOf,
  yearBEfromCE,
  empDisplayName,
  countsForFiling,
  keepFiledItems,
  type FilingItem,
  type FilingEmployee,
} from "./filings";

/**
 * golden test เอกสารยื่นราชการ (D69)
 *
 * ★ 2 ข้อแรกของชุดนี้ **กลับด้านจากระบบเดิมบน GAS โดยตั้งใจ** — ที่นั่นกรอง `wht > 0`
 *   และ `sso > 0` ทิ้ง ซึ่งทำให้เอกสารผิด (ดูเหตุผลเต็มในหัวไฟล์ filings.ts)
 *   เทสพวกนี้จึงเป็นตัวกันไม่ให้มีใคร "ปรับปรุง" กลับไปใส่ตัวกรองอีก
 */

const EMPS: FilingEmployee[] = [
  { empId: "EMP-0001", name: "สมชาย ใจดี", nationalId: "1234567890123", ssoNo: "1234567890" },
  { empId: "EMP-0002", name: "สมหญิง รักงาน", nationalId: "9876543210987" },
  // อายุเกินเกณฑ์ → ผู้ใช้ติ๊ก "ยกเว้นประกันสังคม" เอง
  { empId: "EMP-0003", name: "ลุงมี อาวุโส", nationalId: "5555555555555", ssoExempt: true },
];

/** พนักงาน 3 คน 1 งวด — คนที่ 2 เงินเดือนน้อยจนภาษี 0 */
function period(periodId: string): FilingItem[] {
  return [
    { periodId, empId: "EMP-0001", empName: "สมชาย ใจดี", gross: 40000, taxableIncome: 40000, ssoWageBase: 15000, sso: 750, ssoEmployer: 750, wht: 1200 },
    { periodId, empId: "EMP-0002", empName: "สมหญิง รักงาน", gross: 12000, taxableIncome: 12000, ssoWageBase: 12000, sso: 600, ssoEmployer: 600, wht: 0 },
    { periodId, empId: "EMP-0003", empName: "ลุงมี อาวุโส", gross: 20000, taxableIncome: 20000, ssoWageBase: 15000, sso: 0, ssoEmployer: 0, wht: 0 },
  ];
}

describe("ภ.ง.ด.1 — ห้ามกรองคนที่ภาษีเป็น 0 ทิ้ง", () => {
  it("แสดงทุกคนที่มีแถวในงวด รวมคนที่ภาษี 0", () => {
    const r = pnd1Rows(period("PR-2026-05"), EMPS);
    expect(r.rows).toHaveLength(3);
    expect(r.rows.map((x) => x.empId)).toEqual(["EMP-0001", "EMP-0002", "EMP-0003"]);
    const zero = r.rows.find((x) => x.empId === "EMP-0002")!;
    expect(zero.wht).toBe(0);
    expect(zero.income).toBe(12000); // เงินได้ยังต้องแสดง ไม่ใช่หายไปทั้งแถว
  });

  it("🔴 งวดที่ไม่มีใครถึงเกณฑ์เสียภาษีเลย ต้องได้รายชื่อครบ ไม่ใช่ตารางว่าง", () => {
    const items = period("PR-2026-05").map((it) => ({ ...it, wht: 0 }));
    const r = pnd1Rows(items, EMPS);
    expect(r.rows).toHaveLength(3);
    expect(r.count).toBe(3);
    expect(r.countWithTax).toBe(0);
    expect(r.totalWht).toBe(0);
    expect(r.totalIncome).toBe(72000);
  });

  it("แยกจำนวนผู้มีเงินได้ทั้งหมด ออกจากจำนวนผู้ถูกหักภาษี", () => {
    const r = pnd1Rows(period("PR-2026-05"), EMPS);
    expect(r.count).toBe(3);
    expect(r.countWithTax).toBe(1);
  });

  it("คนที่ยกเว้นประกันสังคม ยังต้องขึ้นใน ภงด.1 (คนละเรื่องกัน)", () => {
    const r = pnd1Rows(period("PR-2026-05"), EMPS);
    expect(r.rows.some((x) => x.empId === "EMP-0003")).toBe(true);
  });

  it("เลขบัตรประชาชนมาจากทะเบียนพนักงาน · ไม่มีก็เป็นค่าว่าง ไม่ใช่ undefined", () => {
    const r = pnd1Rows(period("PR-2026-05"), [{ empId: "EMP-0001", name: "ก" }]);
    expect(r.rows[0].nationalId).toBe("");
  });

  it("ยอดรวมเท่ากับผลบวกของแถว", () => {
    const r = pnd1Rows(period("PR-2026-05"), EMPS);
    expect(r.totalIncome).toBe(40000 + 12000 + 20000);
    expect(r.totalWht).toBe(1200);
  });

  it("เรียงตามรหัสพนักงานเสมอ แม้ข้อมูลเข้ามาสลับลำดับ", () => {
    const shuffled = [...period("PR-2026-05")].reverse();
    const r = pnd1Rows(shuffled, EMPS);
    expect(r.rows.map((x) => x.empId)).toEqual(["EMP-0001", "EMP-0002", "EMP-0003"]);
    expect(r.rows.map((x) => x.seq)).toEqual([1, 2, 3]);
  });
});

describe("สปส.1-10 — ตัดเฉพาะคนที่ไม่ใช่ผู้ประกันตน", () => {
  it("คนที่ติดธง ssoExempt ไม่ขึ้น แต่คนที่เงินสมทบ 0 ด้วยเหตุอื่นยังขึ้น", () => {
    const items = period("PR-2026-05").map((it) =>
      it.empId === "EMP-0002" ? { ...it, gross: 0, ssoWageBase: 0, sso: 0, ssoEmployer: 0 } : it,
    );
    const r = sso110Rows(items, EMPS);
    expect(r.rows.map((x) => x.empId)).toEqual(["EMP-0001", "EMP-0002"]);
    expect(r.rows.find((x) => x.empId === "EMP-0002")!.sso).toBe(0);
  });

  it("ค่าจ้างใช้ฐานที่บีบเพดานแล้ว ไม่ใช่เงินได้รวม", () => {
    const r = sso110Rows(period("PR-2026-05"), EMPS);
    // EMP-0001 เงินได้ 40,000 แต่ฐานที่คิดเงินสมทบตันที่ 15,000
    expect(r.rows.find((x) => x.empId === "EMP-0001")!.wage).toBe(15000);
  });

  it("ส่วนนายจ้างใช้ยอดจริง ไม่ใช่สมมติว่าเท่ากับลูกจ้าง", () => {
    const items = period("PR-2026-05").map((it) =>
      it.empId === "EMP-0001" ? { ...it, ssoEmployer: 900 } : it,
    );
    const r = sso110Rows(items, EMPS);
    expect(r.totalEmployee).toBe(750 + 600);
    expect(r.totalEmployer).toBe(900 + 600);
    expect(r.grandTotal).toBe(1350 + 1500);
  });

  it("ยอดของคนที่ถูกตัดออก ต้องไม่ถูกนับในยอดรวมใด ๆ", () => {
    const items = period("PR-2026-05").map((it) =>
      it.empId === "EMP-0003" ? { ...it, sso: 999, ssoEmployer: 999 } : it,
    );
    const r = sso110Rows(items, EMPS);
    expect(r.count).toBe(2);
    expect(r.totalEmployee).toBe(1350);
    expect(r.totalEmployer).toBe(1350);
    expect(r.totalWage).toBe(15000 + 12000);
  });

  it("ไม่มีเลขประกันสังคม → ใช้เลขบัตรประชาชนแทน", () => {
    const r = sso110Rows(period("PR-2026-05"), EMPS);
    expect(r.rows.find((x) => x.empId === "EMP-0001")!.ssoRef).toBe("1234567890");
    expect(r.rows.find((x) => x.empId === "EMP-0002")!.ssoRef).toBe("9876543210987");
  });
});

describe("ภ.ง.ด.1ก — รวมทั้งปี", () => {
  const year = [...period("PR-2026-01"), ...period("PR-2026-02"), ...period("PR-2026-03")];

  it("รวมต่อคน และแสดงทุกคนแม้ภาษีทั้งปีเป็น 0", () => {
    const r = pnd1kRows(year, EMPS);
    expect(r.rows).toHaveLength(3);
    const zero = r.rows.find((x) => x.empId === "EMP-0002")!;
    expect(zero.wht).toBe(0);
    expect(zero.income).toBe(36000);
    expect(zero.periods).toBe(3);
  });

  it("🔑 ยอดรวมของ ภงด.1 ทุกงวด = ยอดรวมของ ภงด.1ก (ตัวคุมข้ามเอกสาร)", () => {
    const monthly = ["PR-2026-01", "PR-2026-02", "PR-2026-03"].map((p) => pnd1Rows(period(p), EMPS));
    const sumIncome = monthly.reduce((s, m) => s + m.totalIncome, 0);
    const sumWht = monthly.reduce((s, m) => s + m.totalWht, 0);

    const annual = pnd1kRows(year, EMPS);
    expect(annual.totalIncome).toBe(sumIncome);
    expect(annual.totalWht).toBe(sumWht);
  });

  it("คนที่เข้ากลางปี รวมเฉพาะงวดที่มีแถวจริง", () => {
    const late: FilingItem = {
      periodId: "PR-2026-03", empId: "EMP-0009", empName: "เข้าใหม่",
      gross: 10000, taxableIncome: 10000, ssoWageBase: 10000, sso: 500, ssoEmployer: 500, wht: 0,
    };
    const r = pnd1kRows([...year, late], EMPS);
    const row = r.rows.find((x) => x.empId === "EMP-0009")!;
    expect(row.periods).toBe(1);
    expect(row.income).toBe(10000);
  });

  it("เปลี่ยนนามสกุลกลางปี → ใช้ชื่อ**ปัจจุบันในทะเบียน** ไม่ใช่ชื่อที่แช่ไว้ในงวดไหนเลย", () => {
    const items: FilingItem[] = [
      { periodId: "PR-2026-01", empId: "EMP-0001", empName: "สมชาย ใจดี", gross: 100, taxableIncome: 100, ssoWageBase: 100, sso: 0, ssoEmployer: 0, wht: 0 },
      { periodId: "PR-2026-02", empId: "EMP-0001", empName: "สมชาย ใจงาม", gross: 100, taxableIncome: 100, ssoWageBase: 100, sso: 0, ssoEmployer: 0, wht: 0 },
    ];
    const emps: FilingEmployee[] = [{ empId: "EMP-0001", name: "สมชาย เปลี่ยนแล้ว", nationalId: "1234567890123" }];
    expect(pnd1kRows(items, emps).rows[0].name).toBe("สมชาย เปลี่ยนแล้ว");
  });
});

/**
 * 🚨 กติกา D75/D80 — **ชื่อ = ค่าปัจจุบันเสมอ · ตัวเงิน = ค่าที่แช่ไว้เสมอ**
 *
 * อาการจริงที่ทำให้ต้องมีชุดนี้ (เจอตอนเทสใช้งานจริงในเบราว์เซอร์):
 * ภงด.1 พิมพ์ชื่อเก่าที่แช่ไว้ในงวด คู่กับ **เลขประจำตัวผู้เสียภาษีที่ดึงจากทะเบียนปัจจุบัน**
 * → ชื่อกับเลขบัตรเป็นคนละคนบนแบบที่ยื่นสรรพากร
 */
describe("ชื่อบนเอกสารยื่น = ชื่อปัจจุบันเสมอ (D80)", () => {
  const renamed: FilingEmployee[] = [
    { empId: "EMP-0001", name: "สมชาย ชื่อใหม่", nationalId: "1234567890123", ssoNo: "1234567890" },
    { empId: "EMP-0002", name: "สมหญิง รักงาน", nationalId: "9876543210987" },
    { empId: "EMP-0003", name: "ลุงมี อาวุโส", nationalId: "5555555555555", ssoExempt: true },
  ];
  const items = period("PR-2026-05"); // empName ที่แช่ไว้ยังเป็น "สมชาย ใจดี"

  it("ภ.ง.ด.1 ใช้ชื่อปัจจุบัน", () => {
    const row = pnd1Rows(items, renamed).rows.find((r) => r.empId === "EMP-0001")!;
    expect(row.name).toBe("สมชาย ชื่อใหม่");
    expect(row.nationalId).toBe("1234567890123"); // ★ ชื่อกับเลขบัตรต้องเป็นคนเดียวกัน
  });

  it("สปส.1-10 ใช้ชื่อปัจจุบัน", () => {
    const row = sso110Rows(items, renamed).rows.find((r) => r.empId === "EMP-0001")!;
    expect(row.name).toBe("สมชาย ชื่อใหม่");
  });

  it("ภ.ง.ด.1ก ใช้ชื่อปัจจุบัน", () => {
    expect(pnd1kRows(items, renamed).rows[0].name).toBe("สมชาย ชื่อใหม่");
  });

  it("พนักงานถูกลบจากทะเบียนแล้ว → ตกไปใช้ชื่อที่แช่ไว้ (ไม่ปล่อยช่องว่าง)", () => {
    const gone: FilingEmployee[] = renamed.filter((e) => e.empId !== "EMP-0001");
    expect(pnd1Rows(items, gone).rows.find((r) => r.empId === "EMP-0001")!.name).toBe("สมชาย ใจดี");
    expect(pnd1kRows(items, gone).rows[0].name).toBe("สมชาย ใจดี");
  });

  it("empDisplayName: ทะเบียน > snapshot > ค่าว่าง", () => {
    expect(empDisplayName(renamed, "EMP-0001", "เก่า")).toBe("สมชาย ชื่อใหม่");
    expect(empDisplayName([], "EMP-0001", "เก่า")).toBe("เก่า");
    expect(empDisplayName([], "EMP-9999", null)).toBe("");
  });
});

describe("50 ทวิ", () => {
  const year = [...period("PR-2026-01"), ...period("PR-2026-02")];

  it("รวมเงินได้ / ภาษี / ประกันสังคม ทั้งปีของคนเดียว", () => {
    const t = wht50Totals(year, "EMP-0001");
    expect(t.income).toBe(80000);
    expect(t.wht).toBe(2400);
    expect(t.sso).toBe(1500);
    expect(t.periods).toBe(2);
  });

  it("ออกให้คนที่ภาษีทั้งปีเป็น 0 ได้ (ม.50 ทวิ ไม่ยกเว้นกรณีไม่มีภาษี)", () => {
    const t = wht50Totals(year, "EMP-0002");
    expect(t.wht).toBe(0);
    expect(t.income).toBe(24000);
    expect(t.periods).toBe(2);
  });

  it("คนที่ไม่มีแถวเลย → ทุกยอดเป็น 0 และ periods = 0 (หน้าจอเอาไว้กันออกใบเปล่า)", () => {
    const t = wht50Totals(year, "EMP-9999");
    expect(t).toMatchObject({ income: 0, wht: 0, sso: 0, periods: 0 });
  });
});

describe("fallback งวดเก่าที่ยังไม่มี taxableIncome แช่ไว้", () => {
  const old: FilingItem = {
    periodId: "PR-2026-01", empId: "EMP-0001", empName: "เก่า",
    gross: 30000, sso: 750, ssoEmployer: 750, wht: 500,
  };

  it("ใช้ gross แทน และ **ประกาศว่า fallback** ไม่ใช่เงียบ ๆ", () => {
    expect(taxBaseOf(old)).toEqual({ value: 30000, fallback: true });
    expect(pnd1Rows([old], EMPS).usedGrossFallback).toBe(true);
    expect(pnd1kRows([old], EMPS).usedGrossFallback).toBe(true);
    expect(wht50Totals([old], "EMP-0001").usedGrossFallback).toBe(true);
  });

  it("งวดที่มีค่าแช่ไว้ ต้องไม่ถูกตั้งธง fallback", () => {
    expect(pnd1Rows(period("PR-2026-05"), EMPS).usedGrossFallback).toBe(false);
  });

  it("taxableIncome ที่ต่างจาก gross ต้องชนะ gross เสมอ", () => {
    const it: FilingItem = { ...old, taxableIncome: 25000 };
    expect(taxBaseOf(it).value).toBe(25000);
    expect(pnd1Rows([it], EMPS).totalIncome).toBe(25000);
  });
});

describe("ปี พ.ศ.", () => {
  it("ค.ศ. → พ.ศ.", () => {
    expect(yearBEfromCE(2026)).toBe(2569);
  });
});

/**
 * D81 — เอกสารยื่นต้องนับเฉพาะงวดที่ลงบัญชีแล้ว
 *
 * ★ ของเดิมไม่มีตัวกรองนี้เลย ทั้งที่หน้าจอเขียนว่า "งวดร่างยังไม่นับ" →
 *   ภ.ง.ด.1ก ของ tenant ทดสอบขึ้น 925,171 ทั้งที่งวดที่ลงบัญชีจริงมีแค่ 254,860
 */
describe("งวดที่นับเข้าเอกสารยื่น (D81)", () => {
  it("posted และ partial นับ · draft ไม่นับ", () => {
    expect(countsForFiling("posted")).toBe(true);
    expect(countsForFiling("partial")).toBe(true);
    expect(countsForFiling("draft")).toBe(false);
  });

  it("🪤 partial ต้องนับ — ลงยอดสุทธิแล้วแต่ยังไม่ลงขา WHT คือคนที่กำลังจะยื่น ภ.ง.ด.1 พอดี", () => {
    expect(countsForFiling("partial")).toBe(true);
  });

  it("ไม่รู้สถานะ (null/undefined) = ไม่นับ — ห้ามเดาว่าลงบัญชีแล้ว", () => {
    expect(countsForFiling(null)).toBe(false);
    expect(countsForFiling(undefined)).toBe(false);
  });

  it("keepFiledItems ตัดแถวของงวดที่ไม่ได้อยู่ในลิสต์ และคงลำดับเดิม", () => {
    const all = [...period("PR-2026-01"), ...period("PR-2026-02")];
    const kept = keepFiledItems(all, ["PR-2026-02"]);
    expect(kept).toHaveLength(3);
    expect(kept.every((r) => r.periodId === "PR-2026-02")).toBe(true);
    expect(kept.map((r) => r.empId)).toEqual(["EMP-0001", "EMP-0002", "EMP-0003"]);
  });

  it("ไม่มีงวดที่นับได้เลย → ได้ลิสต์ว่าง (ไม่ใช่คืนทั้งหมด)", () => {
    expect(keepFiledItems(period("PR-2026-01"), [])).toEqual([]);
  });

  it("🔑 ตัวคุมข้ามเอกสาร — ภ.ง.ด.1ก ของชุดที่กรองแล้ว = ผลบวก ภ.ง.ด.1 เฉพาะงวดที่ลงบัญชี", () => {
    const filedIds = ["PR-2026-01", "PR-2026-02"];
    const all = [...period("PR-2026-01"), ...period("PR-2026-02"), ...period("PR-2026-03")];

    const k = pnd1kRows(keepFiledItems(all, filedIds), EMPS);
    const sumFiled = filedIds.reduce((s, id) => s + pnd1Rows(period(id), EMPS).totalIncome, 0);
    const sumWht = filedIds.reduce((s, id) => s + pnd1Rows(period(id), EMPS).totalWht, 0);

    expect(k.totalIncome).toBe(sumFiled);
    expect(k.totalWht).toBe(sumWht);
    expect(k.rows.every((r) => r.periods === 2)).toBe(true);
  });

  it("🔴 ยอดที่กรองแล้วต้องน้อยกว่ายอดที่รวมงวดร่าง (ล็อกบั๊กไว้ไม่ให้กลับมา)", () => {
    const all = [...period("PR-2026-01"), ...period("PR-2026-02"), ...period("PR-2026-03")];
    const filtered = pnd1kRows(keepFiledItems(all, ["PR-2026-01", "PR-2026-02"]), EMPS);
    const unfiltered = pnd1kRows(all, EMPS);

    expect(filtered.totalIncome).toBeLessThan(unfiltered.totalIncome);
    expect(filtered.totalWht).toBeLessThan(unfiltered.totalWht);
    // สัดส่วนต้องเป็น 2 ใน 3 งวดพอดี — ไม่ใช่แค่ "น้อยกว่า" เฉย ๆ
    expect(filtered.totalIncome).toBe((unfiltered.totalIncome / 3) * 2);
  });

  it("50ทวิ หลังกรองแล้ว ต้องไม่นับงวดร่าง", () => {
    const all = [...period("PR-2026-01"), ...period("PR-2026-02")];
    const t = wht50Totals(keepFiledItems(all, ["PR-2026-01"]), "EMP-0001");
    expect(t.periods).toBe(1);
    expect(t.income).toBe(40000);
    expect(t.wht).toBe(1200);
  });

  it("สปส.1-10 ของงวดที่นับได้ ต้องไม่ขยับเพราะมีงวดร่างอยู่ในระบบ", () => {
    const all = [...period("PR-2026-01"), ...period("PR-2026-02")];
    const only = sso110Rows(keepFiledItems(all, ["PR-2026-01"]), EMPS);
    expect(only).toEqual(sso110Rows(period("PR-2026-01"), EMPS));
  });
});
