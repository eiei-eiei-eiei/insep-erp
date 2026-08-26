import { describe, it, expect } from "vitest";
import { missingLabels, missingText } from "./forms";

describe("missingLabels / missingText", () => {
  it("ครบแล้วคืนค่าว่าง / null (ไม่ต้องขึ้นข้อความอะไรเลย)", () => {
    const checks = [
      { label: "ลูกค้า", ok: true },
      { label: "ผู้เสนอราคา", ok: true },
    ];
    expect(missingLabels(checks)).toEqual([]);
    expect(missingText(checks)).toBeNull();
  });

  it("ขาดหลายช่อง — เรียงตามลำดับที่ส่งเข้ามา (= ลำดับบนหน้าจอ)", () => {
    const checks = [
      { label: "ลูกค้า", ok: false },
      { label: "รายการในตะกร้า", ok: true },
      { label: "ผู้เสนอราคา", ok: false },
    ];
    expect(missingLabels(checks)).toEqual(["ลูกค้า", "ผู้เสนอราคา"]);
    expect(missingText(checks)).toBe("ยังกรอกไม่ครบ: ลูกค้า · ผู้เสนอราคา");
  });

  it("ขาดช่องเดียว — บอกชื่อช่องนั้นตรง ๆ", () => {
    expect(missingText([{ label: "ผู้เสนอราคา", ok: false }])).toBe("ยังกรอกไม่ครบ: ผู้เสนอราคา");
  });

  it("เปลี่ยนคำนำหน้าได้ (บางหน้าไม่ใช่ 'กรอก' แต่เป็น 'เลือก')", () => {
    expect(missingText([{ label: "batch", ok: false }], "ยังเลือกไม่ครบ")).toBe("ยังเลือกไม่ครบ: batch");
  });

  it("ลิสต์ว่าง = ไม่มีอะไรให้ตรวจ → null", () => {
    expect(missingText([])).toBeNull();
  });
});
