import { describe, it, expect } from "vitest";
import { floatPlace } from "./floatPlace";

/** D185 — รายการลอยของ Combobox/SuggestInput ต้องอยู่ในจอเสมอ ไม่ว่าช่องจะอยู่ตรงไหน */
describe("floatPlace", () => {
  const VH = 800, VW = 1280;
  const R = (top: number, left: number, width = 200, h = 36) => ({ top, bottom: top + h, left, width });

  it("ปกติอยู่ใต้ช่อง ชิดซ้ายเท่าช่อง กว้างเท่าช่อง", () => {
    expect(floatPlace(R(100, 300), VH, VW)).toEqual({ top: 140, left: 300, width: 200, maxHeight: 256 });
  });
  it("ช่องแคบ (ในแถวตาราง) → รายการกว้างขั้นต่ำ 180 อ่านชื่อยาวออก", () => {
    expect(floatPlace(R(100, 300, 90), VH, VW).width).toBe(180);
  });
  it("ช่องใกล้ขอบล่าง → พลิกขึ้นด้านบน", () => {
    const s = floatPlace(R(720, 300), VH, VW);
    expect(s.top).toBeUndefined();
    expect(s.bottom).toBe(VH - 720 + 4);
    expect(s.maxHeight).toBe(256);
  });
  it("ด้านล่างเหลือน้อยแต่ด้านบนน้อยกว่า → ยังอยู่ด้านล่าง (เตี้ยลงแทน)", () => {
    const s = floatPlace({ top: 60, bottom: 700, left: 0, width: 200 }, VH, VW);
    expect(s.top).toBe(704);
    expect(s.maxHeight).toBe(800 - 700 - 4 - 8);
  });
  it("ช่องชิดขอบขวา → เลื่อนรายการเข้ามาในจอ ไม่ล้น", () => {
    const s = floatPlace(R(100, 1250, 90), VH, VW);
    expect(s.left + s.width).toBeLessThanOrEqual(VW - 8);
  });
  it("ไล่ทุกตำแหน่งบนจอมือถือ 360×640: อยู่ในจอเสมอ", () => {
    for (let top = 0; top <= 600; top += 20) {
      for (let left = 0; left <= 340; left += 20) {
        const s = floatPlace(R(top, left, 120), 640, 360);
        expect(s.left).toBeGreaterThanOrEqual(8);
        expect(s.left + s.width).toBeLessThanOrEqual(352);
        if (s.top !== undefined) expect(s.top + s.maxHeight).toBeLessThanOrEqual(640 - 8);
        else expect(640 - s.bottom! - s.maxHeight).toBeGreaterThanOrEqual(8 - 0.001);
      }
    }
  });
});

describe("D185 — แถวบิล/แถวแก้ฝั่งผลิตใช้ช่องพิมพ์ค้นตัวกลาง (อ่านซอร์ส)", async () => {
  const { readFileSync } = await import("node:fs");
  const code = (f: string) => readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  it("หน้าบันทึกบิล: แถวรายการเลิกใช้ datalist ของเบราว์เซอร์", () => {
    const s = code("app/(app)/accounting/_components/EntryTab.tsx");
    expect(s).not.toMatch(/list="hist-item-/);
    expect(s).toContain("<SuggestInput data-item-first");
  });
  it("🪤 Enter ที่ดร็อปดาวน์ใช้เลือกรายการแล้ว ต้องไม่นับเป็น 'เพิ่มแถว'", () => {
    const s = code("app/(app)/accounting/_components/EntryTab.tsx");
    const fn = s.slice(s.indexOf("function onItemsKeyDown"));
    expect(fn.indexOf("e.defaultPrevented")).toBeGreaterThan(-1);
    expect(fn.indexOf("e.defaultPrevented")).toBeLessThan(fn.indexOf("addItem()"));
  });
  it("ป๊อปอัพแก้บิล: หมวด/งาน ในแถวเลิกใช้ datalist", () => {
    expect(code("app/(app)/accounting/_components/BillsTab.tsx")).not.toMatch(/list="edit-item-/);
  });
  it("แถวแก้ฝั่งผลิต (วัตถุดิบ · บรรจุ/จ่าย) ใช้ Combobox", () => {
    expect(code("app/(app)/production/_components/MaterialTab.tsx")).toMatch(/<Combobox aria-label="วัตถุดิบ" value=\{edit\.materialId\}/);
    expect(code("app/(app)/production/_components/ProductTab.tsx")).toMatch(/<Combobox aria-label="สินค้า" value=\{edit\.productId\}/);
  });
  it("รายการลอยเป็น fixed ไม่ใช่ absolute (absolute = โดนกรอบเลื่อนของตารางตัด)", () => {
    const ui = readFileSync("lib/shared/ui.tsx", "utf8");
    expect(ui).toMatch(/const floatCls = "fixed /);
    expect(ui).not.toMatch(/absolute z-30 mt-1 max-h-64/);
  });
});
