import { describe, it, expect } from "vitest";
import * as C from "./clean";

// ล็อกพฤติกรรมจุดเสี่ยงของ migration (MIGRATION_PLAN sec 7.2 + DECISIONS D27/D28)

describe("isoDate — tz-safe (จุดเสี่ยงที่สุด)", () => {
  it("Excel serial → วันตรง ไม่โดน timezone เลื่อน", () => {
    // serial 46140 = 2026-04-28 (ค่าที่ audit เห็นเป็น 2026-04-27T17:00Z ตอนเปิด cellDates)
    expect(C.isoDate(46140)).toBe("2026-04-28");
  });
  it("serial ปี พ.ศ. (qu_expire) → แปลงเป็น ค.ศ.", () => {
    // 244487 = 2569-05-18 (พ.ศ.) → ต้องได้ 2026-05-18
    expect(C.isoDate(244487)).toBe("2026-05-18");
  });
  it("string ISO ตัดเวลาออก", () => {
    expect(C.isoDate("2026-06-07T10:00:00Z")).toBe("2026-06-07");
  });
  it("string D/M/YYYY พ.ศ. → ค.ศ.", () => {
    expect(C.isoDate("18/5/2569")).toBe("2026-05-18");
  });
  it("ค่าว่าง/แปลงไม่ได้ → null", () => {
    expect(C.isoDate("")).toBeNull();
    expect(C.isoDate(null)).toBeNull();
    expect(C.isoDate("ไม่ใช่วันที่")).toBeNull();
  });
});

describe("reportMonth", () => {
  it("string 'YYYY-MM' คงเดิม", () => expect(C.reportMonth("2025-01")).toBe("2025-01"));
  it("serial ปลายเดือน → เดือนถูก (ไม่ข้ามเดือนจาก tz)", () => {
    // serial 45626 = 2024-11-30 → '2024-11'
    expect(C.reportMonth(45626)).toBe("2024-11");
  });
});

describe("taxId", () => {
  it("ตัด apostrophe นำหน้า (กัน Sheets ตัด 0)", () => {
    expect(C.taxId("'0605567002178")).toBe("0605567002178");
  });
  it("'-' หรือว่าง → null", () => {
    expect(C.taxId("-")).toBeNull();
    expect(C.taxId("")).toBeNull();
  });
  it("normTaxId เอาเฉพาะเลข (ใช้จับคู่)", () => {
    expect(C.normTaxId("0105526006688")).toBe("0105526006688");
    expect(C.normTaxId("105526006688")).toBe("105526006688");
  });
});

describe("num / num0 / bool", () => {
  it("num: '1,234.5' → 1234.5, '-'/ว่าง → null", () => {
    expect(C.num("1,234.5")).toBe(1234.5);
    expect(C.num("-")).toBeNull();
    expect(C.num("")).toBeNull();
  });
  it("num0: ว่าง → 0", () => expect(C.num0("")).toBe(0));
  it("bool: true/1/'true' → true, อื่น → false", () => {
    expect(C.bool(true)).toBe(true);
    expect(C.bool(1)).toBe(true);
    expect(C.bool("TRUE")).toBe(true);
    expect(C.bool("")).toBe(false);
    expect(C.bool("false")).toBe(false);
  });
});

describe("splitComma / normName", () => {
  it("splitComma: 'EID01,EID02' → array, ว่าง → []", () => {
    expect(C.splitComma("EID01,EID02")).toEqual(["EID01", "EID02"]);
    expect(C.splitComma("")).toEqual([]);
  });
  it("normName: trim + lower + ยุบช่องว่าง", () => {
    expect(C.normName("  บริษัท  เพ็นต้า  ")).toBe("บริษัท เพ็นต้า");
  });
});
