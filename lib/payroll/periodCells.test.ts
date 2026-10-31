import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * D150 — ช่องกรอกในตารางงวดเงินเดือนต้องมีความกว้างขั้นต่ำ
 * หัวคอลัมน์สั้น ("ลากิจ" · "โบนัส") เคยเหลือที่ให้ตัวเลข ~24px → พิมพ์ 5000 ช่องโชว์ "500"
 * (ค่าที่บันทึกถูก แต่คนกรอกเห็นเลขผิด) · อ่านซอร์สตรวจ เพราะ TS/build มองไม่เห็นเรื่องความกว้าง
 */
describe("🚨 PeriodTab — ช่องกรอกในตารางงวดมีความกว้างขั้นต่ำ", () => {
  const src = readFileSync("app/(app)/payroll/_components/PeriodTab.tsx", "utf8");

  it("CELL_W เป็น min-width (ไม่ใช่ w-* ที่แพ้ w-full ของช่องกรอก)", () => {
    expect(src).toMatch(/const CELL_W = "min-w-\[[\d.]+rem\]";/);
  });

  it("ช่องกรอกทุกช่องในแถวงวด (readOnly={locked}) ใส่ CELL_W", () => {
    const boxes = src.match(/<NumBox[^>]*readOnly=\{locked\}[^>]*/g) ?? [];
    expect(boxes.length).toBeGreaterThanOrEqual(4);
    for (const b of boxes) expect(b, b).toContain("className={CELL_W}");
  });
});
