import { describe, it, expect } from "vitest";
import { buildPayrollReport, type ReportSource } from "./report";

/**
 * รายงานคือที่เดียวที่เห็นว่า "เงินเดือนก้อนที่ลงบัญชีไป ข้างในเป็นอะไรบ้าง"
 * (บัญชีลงเป็นก้อนโดยตั้งใจ เพื่อไม่ให้หมวดรายจ่ายรุงรัง)
 */

const src: ReportSource[] = [
  {
    periodId: "PR-2026-01", empId: "EMP-0001", empName: "สมชาย", groupCode: "ช่าง",
    baseAmount: 15000, gross: 17000, sso: 750, ssoEmployer: 750, wht: 0, net: 16250,
    items: [
      { code: "ot", name: "ค่าล่วงเวลา", kind: "earning", amount: 1500 },
      { code: "comm", name: "คอมมิชชั่น", kind: "earning", amount: 500 },
    ],
  },
  {
    periodId: "PR-2026-02", empId: "EMP-0001", empName: "สมชาย", groupCode: "ช่าง",
    baseAmount: 15000, gross: 16000, sso: 750, ssoEmployer: 750, wht: 0, net: 15250,
    items: [{ code: "ot", name: "ค่าล่วงเวลา", kind: "earning", amount: 1000 }],
  },
  {
    periodId: "PR-2026-01", empId: "EMP-0002", empName: "สมหญิง", groupCode: "เซล",
    baseAmount: 20000, gross: 32000, sso: 750, ssoEmployer: 750, wht: 200, net: 31050,
    items: [
      { code: "comm", name: "คอมมิชชั่น", kind: "earning", amount: 12000 },
      { code: "late", name: "หักมาสาย", kind: "deduction", amount: 200 },
    ],
  },
];

describe("buildPayrollReport", () => {
  const r = buildPayrollReport(src);

  it("รวมต่อคน — สมชาย 2 งวด", () => {
    const somchai = r.rows.find((x) => x.empId === "EMP-0001")!;
    expect(somchai.periods).toBe(2);
    expect(somchai.baseAmount).toBe(30000);
    expect(somchai.gross).toBe(33000);
    expect(somchai.net).toBe(31500);
    expect(somchai.byComponent.ot).toBe(2500);
    expect(somchai.byComponent.comm).toBe(500);
  });

  it("★ เห็นได้ว่าใครทำคอมมิชชั่นได้เท่าไร (ดู performance รายคน)", () => {
    const somying = r.rows.find((x) => x.empId === "EMP-0002")!;
    expect(somying.byComponent.comm).toBe(12000);
    expect(somying.groupCode).toBe("เซล");
  });

  it("รายการที่คนนั้นไม่มี = ไม่มีคีย์ (ไม่ใช่ 0 ปลอม ๆ)", () => {
    const somying = r.rows.find((x) => x.empId === "EMP-0002")!;
    expect(somying.byComponent.ot).toBeUndefined();
  });

  it("★ รวมทั้งบริษัทต่อรายการ — เรียงยอดมากไปน้อย", () => {
    expect(r.components.map((c) => c.code)).toEqual(["comm", "ot", "late"]);
    expect(r.components.find((c) => c.code === "comm")!.total).toBe(12500);
    expect(r.components.find((c) => c.code === "ot")!.total).toBe(2500);
  });

  it("แยกรายการเพิ่ม/หักไว้ให้ (หักมาสายไม่ถูกนับเป็นรายได้)", () => {
    expect(r.components.find((c) => c.code === "late")!.kind).toBe("deduction");
  });

  it("ยอดรวมทั้งหมด", () => {
    expect(r.total.gross).toBe(65000);
    expect(r.total.ssoEmployer).toBe(2250);
    expect(r.total.wht).toBe(200);
    expect(r.total.byComponent.comm).toBe(12500);
  });

  it("ไม่มีข้อมูล = โครงว่างที่ใช้ต่อได้ ไม่ throw", () => {
    const empty = buildPayrollReport([]);
    expect(empty.rows).toEqual([]);
    expect(empty.components).toEqual([]);
    expect(empty.total.gross).toBe(0);
  });
});
