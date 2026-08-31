import { describe, it, expect } from "vitest";
import { thaiBaht, formatTaxId, formatBranch, formatMonthThai } from "./format";

/**
 * Golden tests — ค่า expected ทั้งหมดสร้างจากการรันฟังก์ชัน "ระบบเดิม"
 * (accounting/Config.js) ตรง ๆ ห้ามแก้ค่า expected ให้ตรงกับ output ที่เปลี่ยนสูตร
 */

describe("thaiBaht (A9)", () => {
  const cases: Array<[number, string]> = [
    [0, "ศูนย์บาทถ้วน"],
    [1, "หนึ่งบาทถ้วน"],
    [11, "สิบเอ็ดบาทถ้วน"],
    [12, "สิบสองบาทถ้วน"],
    [20, "ยี่สิบบาทถ้วน"],
    [21, "ยี่สิบเอ็ดบาทถ้วน"],
    [25, "ยี่สิบห้าบาทถ้วน"],
    [100, "หนึ่งร้อยบาทถ้วน"],
    [101, "หนึ่งร้อยหนึ่งบาทถ้วน"],
    [111, "หนึ่งร้อยสิบเอ็ดบาทถ้วน"],
    [121, "หนึ่งร้อยยี่สิบเอ็ดบาทถ้วน"],
    [200, "สองร้อยบาทถ้วน"],
    [1000, "หนึ่งพันบาทถ้วน"],
    [1000000, "หนึ่งล้านบาทถ้วน"],
    [2000000, "สองล้านบาทถ้วน"],
    [0.25, "ยี่สิบห้าสตางค์"],
    [0.5, "ห้าสิบสตางค์"],
    [1.25, "หนึ่งบาทยี่สิบห้าสตางค์"],
    [99.99, "เก้าสิบเก้าบาทเก้าสิบเก้าสตางค์"],
    [1234567.89, "หนึ่งล้านสองแสนสามหมื่นสี่พันห้าร้อยหกสิบเจ็ดบาทแปดสิบเก้าสตางค์"],
  ];

  it.each(cases)("thaiBaht(%d) = %s", (input, expected) => {
    expect(thaiBaht(input)).toBe(expected);
  });

  it("null/undefined/NaN → ศูนย์บาทถ้วน", () => {
    expect(thaiBaht(null)).toBe("ศูนย์บาทถ้วน");
    expect(thaiBaht(undefined)).toBe("ศูนย์บาทถ้วน");
    expect(thaiBaht(Number.NaN)).toBe("ศูนย์บาทถ้วน");
  });

  it("รับ string ที่แปลงเป็นเลขได้", () => {
    expect(thaiBaht("1.25")).toBe("หนึ่งบาทยี่สิบห้าสตางค์");
  });
});

describe("formatTaxId (A12)", () => {
  const cases: Array<[string, string]> = [
    ["0123456789012", "0123456789012"],
    ["123", "0000000000123"],
    ["", "-"],
    ["-", "-"],
    ["12 3", "0000000000123"],
    ["'0105", "0000000000105"],
    ["012345678901234", "012345678901234"],
    ["abc", "abc"],
    ["1234567890123", "1234567890123"],
  ];

  it.each(cases)("formatTaxId(%j) = %j", (input, expected) => {
    expect(formatTaxId(input)).toBe(expected);
  });

  it("null/undefined → -", () => {
    expect(formatTaxId(null)).toBe("-");
    expect(formatTaxId(undefined)).toBe("-");
  });
});

describe("formatBranch (A12)", () => {
  it("HQ variants → {isHQ:true, text:'00000'}", () => {
    for (const v of ["", "-", "สำนักงานใหญ่", "00000", null, undefined]) {
      expect(formatBranch(v)).toEqual({ isHQ: true, text: "00000" });
    }
  });

  const cases: Array<[string, { isHQ: boolean; text: string }]> = [
    ["1", { isHQ: false, text: "00001" }],
    ["12", { isHQ: false, text: "00012" }],
    ["00002", { isHQ: false, text: "00002" }],
    ["123456", { isHQ: false, text: "123456" }],
    ["สาขาA", { isHQ: false, text: "สาขาA" }],
  ];

  it.each(cases)("formatBranch(%j) = %j", (input, expected) => {
    expect(formatBranch(input)).toEqual(expected);
  });
});

/** D88 — เดือนไทยในข้อความที่ผู้ใช้อ่าน (คำอธิบายบิลจ่ายภาษี · ข้อความเตือน LINE) */
describe("formatMonthThai", () => {
  it("แปลง yyyy-MM เป็นเดือนย่อ + ปี พ.ศ.", () => {
    expect(formatMonthThai("2026-08")).toBe("ส.ค. 2569");
    expect(formatMonthThai("2026-01")).toBe("ม.ค. 2569");
    expect(formatMonthThai("2026-12")).toBe("ธ.ค. 2569");
  });

  it("รับ yyyy-MM-dd ได้ด้วย (ตัดวันทิ้ง)", () => {
    expect(formatMonthThai("2027-03-15")).toBe("มี.ค. 2570");
  });

  it("ค่าที่ไม่ใช่เดือน คืน - ไม่ใช่ NaN หรือ undefined โผล่บนจอ", () => {
    expect(formatMonthThai("")).toBe("-");
    expect(formatMonthThai(null)).toBe("-");
    expect(formatMonthThai("2026-13")).toBe("-");
  });
});
