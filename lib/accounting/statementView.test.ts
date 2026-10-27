import { describe, it, expect } from "vitest";
import { presetRange, rangeTitle, rangeError, isMultiMonth } from "./statementView";

describe("A27 — ปุ่มลัดช่วงเวลา statement (D139)", () => {
  it("เดือนนี้ / 3 เดือน / ต้นปี / ทั้งหมด", () => {
    expect(presetRange("month", "2026-07")).toEqual({ from: "2026-07", to: "2026-07" });
    expect(presetRange("3m", "2026-07")).toEqual({ from: "2026-05", to: "2026-07" });
    expect(presetRange("ytd", "2026-07")).toEqual({ from: "2026-01", to: "2026-07" });
    expect(presetRange("all", "2026-07")).toEqual({ from: null, to: null });
  });
  it("3 เดือนข้ามปี", () => {
    expect(presetRange("3m", "2026-02")).toEqual({ from: "2025-12", to: "2026-02" });
  });
  it("ป้ายหัวการ์ด", () => {
    expect(rangeTitle({ from: "2026-07", to: "2026-07" })).toBe("เดือน 2026-07");
    expect(rangeTitle({ from: "2026-05", to: "2026-07" })).toBe("2026-05 ถึง 2026-07");
    expect(rangeTitle({ from: null, to: null })).toBe("ทั้งหมด");
  });
  it("เดือนเริ่มหลังเดือนสุดท้าย = ผิด", () => {
    expect(rangeError({ from: "2026-08", to: "2026-07" })).not.toBe("");
    expect(rangeError({ from: "2026-07", to: "2026-07" })).toBe("");
  });
  it("แถวสรุปท้ายเดือนเฉพาะตอนดูหลายเดือน", () => {
    expect(isMultiMonth({ from: "2026-07", to: "2026-07" })).toBe(false);
    expect(isMultiMonth({ from: "2026-06", to: "2026-07" })).toBe(true);
    expect(isMultiMonth({ from: null, to: null })).toBe(true);
  });
});
