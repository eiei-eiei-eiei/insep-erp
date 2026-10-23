/** D125 — แปลงคู่ค้าที่บันทึกไว้กลับเป็นช่องฟอร์ม (คู่กับ branchToSave ของ S13) */
import { describe, it, expect } from "vitest";
import { branchFormOf, branchToSave, validateNewCustomer } from "./taxCustomer";

describe("branchFormOf", () => {
  it("แปลงค่าที่บันทึกไว้กลับเป็นฟอร์ม", () => {
    expect(branchFormOf("", "")).toEqual({ branchMode: "hq", branchNumber: "", noTaxId: true });
    expect(branchFormOf("สำนักงานใหญ่", "0105512345678")).toMatchObject({ branchMode: "hq", noTaxId: false });
    expect(branchFormOf("00000", "0105512345678")).toMatchObject({ branchMode: "hq" });
    expect(branchFormOf("00002", "0105512345678")).toMatchObject({ branchMode: "branch", branchNumber: "2" });
    expect(branchFormOf("สาขา 13", "0105512345678")).toMatchObject({ branchMode: "branch", branchNumber: "13" });
  });
  it("🪤 สาขาที่ไม่มีตัวเลข → เลขสาขาว่าง แล้วฟอร์มฟ้อง (ไม่เดาว่าเป็นสำนักงานใหญ่)", () => {
    const f = branchFormOf("สาขาบางนา", "0105512345678");
    expect(f).toMatchObject({ branchMode: "branch", branchNumber: "" });
    expect(validateNewCustomer({ name: "ก", taxId: "0105512345678", isExport: false, ...f })).toMatch(/เลขสาขา/);
  });
  it("ไป-กลับตรงกัน: บันทึกแล้วเปิดมาแก้ แล้วบันทึกซ้ำ ได้ค่าเดิม", () => {
    for (const b of ["สำนักงานใหญ่", "00002", "00123"]) {
      const f = branchFormOf(b, "0105512345678");
      expect(branchToSave(f)).toBe(b);
    }
  });
});
