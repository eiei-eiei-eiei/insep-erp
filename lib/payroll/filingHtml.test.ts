import { describe, it, expect } from "vitest";
import { formatNationalId, thaiMonthYear, toTsv, pnd1Html, sso110Html } from "./filingHtml";
import { pnd1Rows, sso110Rows, type FilingItem, type FilingEmployee } from "./filings";

const ENT = { entityId: "EID01", name: "บริษัท ทดสอบ จำกัด", taxId: "0105558000000", branch: "สำนักงานใหญ่" };

const EMPS: FilingEmployee[] = [
  { empId: "EMP-0001", name: "สมชาย ใจดี", nationalId: "1234567890123" },
  { empId: "EMP-0002", name: "สมหญิง รักงาน", nationalId: "9876543210987" },
];

const ITEMS: FilingItem[] = [
  { periodId: "PR-2026-05", empId: "EMP-0001", empName: "สมชาย ใจดี", gross: 40000, taxableIncome: 40000, ssoWageBase: 15000, sso: 750, ssoEmployer: 750, wht: 1200 },
  { periodId: "PR-2026-05", empId: "EMP-0002", empName: "สมหญิง รักงาน", gross: 12000, taxableIncome: 12000, ssoWageBase: 12000, sso: 600, ssoEmployer: 600, wht: 0 },
];

describe("formatNationalId", () => {
  it("จัดรูป 13 หลัก", () => {
    expect(formatNationalId("1234567890123")).toBe("1-2345-67890-12-3");
  });
  it("ไม่ครบ 13 หลัก คืนค่าเดิม ไม่เดารูปแบบ", () => {
    expect(formatNationalId("12345")).toBe("12345");
  });
  it("ค่าว่าง/null ไม่พัง", () => {
    expect(formatNationalId(null)).toBe("");
    expect(formatNationalId(undefined)).toBe("");
  });
});

describe("thaiMonthYear", () => {
  it("เดือนไทย + ปี พ.ศ.", () => {
    expect(thaiMonthYear(5, 2569)).toBe("พฤษภาคม 2569");
  });
});

describe("toTsv", () => {
  it("คั่นด้วยแท็บและขึ้นบรรทัดใหม่", () => {
    expect(toTsv(["a", "b"], [[1, 2], [3, 4]])).toBe("a\tb\n1\t2\n3\t4");
  });
  it("แท็บ/ขึ้นบรรทัดในข้อมูลถูกแทนที่ ไม่งั้นคอลัมน์เลื่อนตอนวาง", () => {
    expect(toTsv(["a"], [["x\ty\nz"]])).toBe("a\nx y z");
  });
});

describe("HTML เอกสารยื่น", () => {
  it("ภงด.1 แสดงคนที่ภาษี 0 พร้อมเลข 0.00 (ไม่ใช่ช่องว่าง)", () => {
    const html = pnd1Html(ENT, "พฤษภาคม 2569", pnd1Rows(ITEMS, EMPS));
    expect(html).toContain("สมหญิง รักงาน");
    expect(html).toContain("0.00");
    expect(html).toContain("จำนวนผู้มีเงินได้ทั้งหมด");
  });

  it("ไม่มีข้อมูล → บอกว่าไม่มี ไม่ใช่ตารางหัวโล้น", () => {
    const html = pnd1Html(ENT, "พฤษภาคม 2569", pnd1Rows([], EMPS));
    expect(html).toContain("ไม่มีข้อมูลในงวดนี้");
  });

  it("🚨 ห้ามมี token สี/คลาสของแอปหลุดเข้าเอกสารพิมพ์ (D43 ข้อ 4)", () => {
    const html =
      pnd1Html(ENT, "พฤษภาคม 2569", pnd1Rows(ITEMS, EMPS)) +
      sso110Html(ENT, "พฤษภาคม 2569", sso110Rows(ITEMS, EMPS));
    expect(html).not.toMatch(/bg-|text-ink|text-muted|var\(--/);
  });

  it("สปส.1-10 ไม่มีเลขบัญชีนายจ้าง → fallback เป็นเลขผู้เสียภาษี (เหมือนระบบเดิม)", () => {
    const html = sso110Html(ENT, "พฤษภาคม 2569", sso110Rows(ITEMS, EMPS));
    expect(html).toContain("0105558000000");
  });

  it("สปส.1-10 มีเลขบัญชีนายจ้าง → ใช้เลขนั้นแทน", () => {
    const html = sso110Html({ ...ENT, ssoEmployerNo: "1234567890" }, "พฤษภาคม 2569", sso110Rows(ITEMS, EMPS));
    expect(html).toContain("เลขที่บัญชีนายจ้าง: 1234567890");
  });

  it("escape อักขระพิเศษในชื่อ (กัน HTML พัง)", () => {
    const html = pnd1Html({ entityId: "EID01", name: 'บ. <script>x</script> "A" & B' }, "พฤษภาคม 2569", pnd1Rows([], []));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
