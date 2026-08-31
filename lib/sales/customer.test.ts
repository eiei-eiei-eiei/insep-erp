import { describe, it, expect } from "vitest";
import {
  taxIdRequired,
  hidesBranch,
  branchToSave,
  taxIdToSave,
  validateNewCustomer,
  type NewCustomerInput,
} from "./customer";

// ── S13: กติกากรอกข้อมูลคู่ค้า (D86) ─────────────────────────────────────────────
const base: NewCustomerInput = {
  name: "บริษัท ทดสอบ จำกัด",
  taxId: "0105512345671",
  branchMode: "hq",
  branchNumber: "",
  noTaxId: false,
  isExport: false,
};
const at = (o: Partial<NewCustomerInput>): NewCustomerInput => ({ ...base, ...o });

describe("S13 taxIdRequired", () => {
  it("★ ปกติยังบังคับเหมือนเดิม — คุณภาพข้อมูล B2B ต้องไม่ตก", () => {
    expect(taxIdRequired(base)).toBe(true);
  });

  it("ติ๊ก “ไม่มีเลขภาษี” → ไม่บังคับ (ลูกค้าทั่วไป/ขาจร)", () => {
    expect(taxIdRequired(at({ noTaxId: true }))).toBe(false);
  });

  it("🔴 ลูกค้าส่งออก → ไม่บังคับ (ผู้ซื้อต่างชาติไม่มีเลขภาษีไทย)", () => {
    expect(taxIdRequired(at({ isExport: true }))).toBe(false);
  });
});

describe("S13 validateNewCustomer", () => {
  it("ข้อมูลครบ = ผ่าน", () => {
    expect(validateNewCustomer(base)).toBeNull();
  });

  it("ไม่มีชื่อ = ไม่ผ่านก่อนเรื่องอื่นเสมอ", () => {
    expect(validateNewCustomer(at({ name: "  ", taxId: "" }))).toBe("กรอกชื่อลูกค้า");
  });

  it("🚨 เลขภาษีไม่ครบ 13 หลัก = ไม่ผ่าน และข้อความต้องบอกทางออก", () => {
    const err = validateNewCustomer(at({ taxId: "010551234" }));
    expect(err).toContain("13 หลัก");
    expect(err).toContain("ไม่มีเลขประจำตัวผู้เสียภาษี"); // ต้องชี้ทางออก ไม่ใช่บอกแค่ว่าผิด
  });

  it("ติ๊กไม่มีเลขภาษี → เว้นว่างได้", () => {
    expect(validateNewCustomer(at({ taxId: "", noTaxId: true }))).toBeNull();
  });

  it("🔴 ลูกค้าส่งออกเว้นเลขภาษีได้ — บั๊กเดิมคือสร้างผ่านหน้าจอไม่ได้เลย", () => {
    expect(validateNewCustomer(at({ taxId: "", isExport: true }))).toBeNull();
  });

  it("🪤 ส่งออกที่เป็นนิติบุคคลไทย ยังกรอกเลขภาษีได้ตามปกติ (ผ่อนกฎ ≠ ห้ามกรอก)", () => {
    expect(validateNewCustomer(at({ isExport: true }))).toBeNull();
    expect(taxIdToSave(at({ isExport: true }))).toBe("0105512345671");
  });

  it("🪤 เลือก “สาขา” แล้วไม่กรอกเลข = ไม่ผ่าน (ของเดิม pad เป็น 00000 ผ่านไปเงียบ ๆ)", () => {
    expect(validateNewCustomer(at({ branchMode: "branch", branchNumber: "" }))).toBe(
      "เลขสาขาต้องเป็นตัวเลข 1-5 หลัก",
    );
  });

  it("เลือกสาขาแล้วกรอกเลขสั้น ๆ ผ่าน แล้วค่อยเติมศูนย์ตอนบันทึก", () => {
    expect(validateNewCustomer(at({ branchMode: "branch", branchNumber: "12" }))).toBeNull();
  });

  it("ติ๊กไม่มีเลขภาษี = ข้ามการตรวจสาขาด้วย (ช่องถูกซ่อนไปแล้ว)", () => {
    expect(validateNewCustomer(at({ taxId: "", noTaxId: true, branchMode: "branch", branchNumber: "" }))).toBeNull();
  });
});

describe("S13 ค่าที่บันทึกจริง", () => {
  it("สำนักงานใหญ่", () => {
    expect(branchToSave(base)).toBe("สำนักงานใหญ่");
  });

  it("สาขาเติมศูนย์นำหน้าให้ครบ 5 หลัก", () => {
    expect(branchToSave(at({ branchMode: "branch", branchNumber: "12" }))).toBe("00012");
  });

  it("🚨 ติ๊กไม่มีเลขภาษี → สาขาว่าง เพื่อไม่ให้พิมพ์ “(สำนักงานใหญ่)” บนใบของลูกค้าขาจร", () => {
    expect(branchToSave(at({ noTaxId: true }))).toBe("");
    expect(hidesBranch(at({ noTaxId: true }))).toBe(true);
  });

  it("🚨 ติ๊กไม่มีเลขภาษีแล้วต้องไม่เก็บเลขที่เผลอพิมพ์ค้างไว้", () => {
    expect(taxIdToSave(at({ noTaxId: true, taxId: "0105512345671" }))).toBe("");
  });

  it("ส่งออกไม่ล้างสาขา (ต่างจาก noTaxId) — ผ่อนกฎอย่างเดียว", () => {
    expect(branchToSave(at({ isExport: true }))).toBe("สำนักงานใหญ่");
    expect(hidesBranch(at({ isExport: true }))).toBe(false);
  });
});
