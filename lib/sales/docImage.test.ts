import { describe, it, expect } from "vitest";
import { docPageLabel, docImageFileName, shareAllLabel, shareDisabledReason } from "./docImage";

describe("docPageLabel", () => {
  it("ชื่อเอกสาร + ต้นฉบับ/สำเนา", () => {
    expect(docPageLabel("ใบแจ้งหนี้", "(สำเนา / Copy)")).toBe("ใบแจ้งหนี้ (สำเนา / Copy)");
  });
  it("ไม่มี copyType = ชื่อเอกสารล้วน", () => {
    expect(docPageLabel("ใบเสนอราคา")).toBe("ใบเสนอราคา");
  });
  it("ไม่มีชื่อ = เอกสาร", () => {
    expect(docPageLabel("", "")).toBe("เอกสาร");
  });
});

describe("docImageFileName", () => {
  it("ตัด / ของชื่อเอกสาร (ระบบไฟล์ไม่รับ) และวงเล็บ", () => {
    expect(docImageFileName("ใบกำกับภาษี/ใบเสร็จรับเงิน (ต้นฉบับ / Original)", "TAX260925-001", 0)).toBe(
      "ใบกำกับภาษี-ใบเสร็จรับเงิน_ต้นฉบับ_-_Original_TAX260925-001.png",
    );
  });
  it("ไม่มีเลขที่ = ชื่อเอกสารล้วน", () => {
    expect(docImageFileName("ใบเสนอราคา", "", 0)).toBe("ใบเสนอราคา.png");
  });
  it("ไม่มีอะไรเลย = เอกสาร-ลำดับ", () => {
    expect(docImageFileName("", undefined, 2)).toBe("เอกสาร-3.png");
  });
  it("ไม่มีอักขระต้องห้ามหลุดออกมา", () => {
    const n = docImageFileName('a\\b:c*d?e"f<g>h|i', "x/y", 0);
    expect(n).not.toMatch(/[\\/:*?"<>|]/);
  });
});

describe("shareAllLabel", () => {
  it("บอกจำนวนที่จะส่งจากทั้งหมด", () => {
    expect(shareAllLabel(2, 3)).toBe("แชร์ 2 จาก 3 รูป");
    expect(shareAllLabel(0, 4)).toBe("แชร์ 0 จาก 4 รูป");
  });
  it("หน้าเดียว = ไม่ต้องนับ", () => {
    expect(shareAllLabel(1, 1)).toBe("แชร์ภาพ");
  });
});

describe("shareDisabledReason", () => {
  it("กดได้เมื่อรองรับ + ภาพพร้อม + เลือกอย่างน้อย 1", () => {
    expect(shareDisabledReason("ok", 1, "ready")).toBe("");
  });
  it("ไม่ได้เลือกรูป = บอกให้ติ๊ก", () => {
    expect(shareDisabledReason("ok", 0, "ready")).toMatch(/ยังไม่ได้เลือกรูป/);
  });
  it("ภาพยังไม่พร้อม", () => {
    expect(shareDisabledReason("ok", 2, "loading")).toMatch(/กำลังเตรียม/);
  });
  it("เบราว์เซอร์ไม่รองรับ = ชี้ไปปุ่มคัดลอก (สำคัญกว่าเรื่องเลือกรูป)", () => {
    expect(shareDisabledReason("no-api", 0, "loading")).toMatch(/คัดลอกเป็นภาพ/);
    expect(shareDisabledReason("no-files", 3, "ready")).toMatch(/คัดลอกเป็นภาพ/);
  });
});

describe("shareDisabledReason — สร้างภาพไม่สำเร็จ", () => {
  it("บอกว่ายังพิมพ์ได้ (มาก่อนเหตุผลอื่นทั้งหมด)", () => {
    expect(shareDisabledReason("ok", 2, "failed")).toMatch(/ยังกดพิมพ์ได้/);
    expect(shareDisabledReason("no-api", 0, "failed")).toMatch(/ยังกดพิมพ์ได้/);
  });
});
