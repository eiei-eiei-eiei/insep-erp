import { describe, it, expect } from "vitest";
import { taxDateOnNoChange, taxDateOnTxDateChange, shouldRefreshDraftDate } from "./entryForm";

describe("D114 — วันที่ใบกำกับตามเลขที่ใบกำกับ", () => {
  it("กรอกเลข ขณะวันที่ว่าง → ใช้วันที่รายการ", () => {
    expect(taxDateOnNoChange("IV001", "", "2026-10-18")).toBe("2026-10-18");
  });
  it("พิมพ์ต่อ/แก้เลข ไม่เขียนทับวันที่ที่มีอยู่", () => {
    expect(taxDateOnNoChange("IV0012", "2026-10-01", "2026-10-18")).toBe("2026-10-01");
  });
  it("🚨 ลบเลขจนว่าง (รวมช่องว่างล้วน) → วันที่ว่าง", () => {
    expect(taxDateOnNoChange("", "2026-10-01", "2026-10-18")).toBe("");
    expect(taxDateOnNoChange("   ", "2026-10-01", "2026-10-18")).toBe("");
  });
  it("แก้วันที่รายการ — เดินตามเฉพาะตอนยังเป็นค่าที่ระบบเติม", () => {
    expect(taxDateOnTxDateChange("IV001", "2026-10-18", "2026-10-18", "2026-10-15")).toBe("2026-10-15");
    expect(taxDateOnTxDateChange("IV001", "2026-10-01", "2026-10-18", "2026-10-15")).toBe("2026-10-01");
    expect(taxDateOnTxDateChange("", "", "2026-10-18", "2026-10-15")).toBe("");
  });
});

describe("D114 — วันที่รายการที่ค้างในร่างข้ามวัน", () => {
  it("ร่างจากเมื่อวาน ไม่มีบิลค้าง → เปลี่ยนเป็นวันนี้", () => {
    expect(shouldRefreshDraftDate("2026-10-17", "2026-10-18", false)).toBe(true);
    expect(shouldRefreshDraftDate(undefined, "2026-10-18", false)).toBe(true);
  });
  it("มีบิลค้างกรอก หรือร่างวันนี้ → คงไว้", () => {
    expect(shouldRefreshDraftDate("2026-10-17", "2026-10-18", true)).toBe(false);
    expect(shouldRefreshDraftDate("2026-10-18", "2026-10-18", false)).toBe(false);
  });
});

describe("D117 — Enter เพิ่มรายการ", () => {
  it("Enter ในแถวรายการ = เพิ่ม · Ctrl/⌘/Shift/IME/นอกแถว = ไม่เพิ่ม", async () => {
    const { isAddRowKey } = await import("./entryForm");
    const base = { key: "Enter", ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false, inItemRow: true };
    expect(isAddRowKey(base)).toBe(true);
    expect(isAddRowKey({ ...base, ctrlKey: true })).toBe(false);
    expect(isAddRowKey({ ...base, metaKey: true })).toBe(false);
    expect(isAddRowKey({ ...base, shiftKey: true })).toBe(false);
    expect(isAddRowKey({ ...base, isComposing: true })).toBe(false);
    expect(isAddRowKey({ ...base, inItemRow: false })).toBe(false);
    expect(isAddRowKey({ ...base, key: "Tab" })).toBe(false);
  });
  it("🚨 คำกำกับในตารางรายการ (ใช้ร่วมกับฟอร์มแก้บิล) ต้องไม่อ้างคีย์ลัด", async () => {
    const { itemsHintText } = await import("./calc");
    expect(itemsHintText("ex")).not.toContain("Enter");
    expect(itemsHintText("in")).not.toContain("Enter");
  });
});
