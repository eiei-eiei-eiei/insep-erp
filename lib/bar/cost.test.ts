import { describe, it, expect } from "vitest";
import { weightedAvgCost, lineCost, cartCost, grossMargin } from "./cost";
import type { BarItem, BarMenu, CartLine } from "./types";

/** golden **B3** — ต้นทุนถัวเฉลี่ยถ่วงน้ำหนัก + ต้นทุนต่อบิล (D96) */

const ITEMS: BarItem[] = [
  { itemId: "I-GIN", name: "จิน", unit: "ml", qty: 2100, costPerUnit: 1.2 },
  { itemId: "I-VER", name: "เวอร์มุท", unit: "ml", qty: 750, costPerUnit: 0.8 },
];
const M_COCKTAIL: BarMenu = {
  menuId: "M1", name: "Negroni", price: 260, categoryId: "cocktail",
  recipe: [{ itemId: "I-GIN", qty: 30 }, { itemId: "I-VER", qty: 30 }],
};
const M_FOOD: BarMenu = { menuId: "M3", name: "ถั่วทอด", price: 80, categoryId: "food", recipe: [], fixedCost: 35 };
const M_UNSET: BarMenu = { menuId: "M4", name: "ลับ", price: 300, categoryId: "custom", recipe: [] };
const MENUS = [M_COCKTAIL, M_FOOD, M_UNSET];

const L = (menuId: string, qty: number, extra: Partial<CartLine> = {}): CartLine => ({
  menuId, menuName: "x", qty, price: 0, ...extra,
});

describe("ถัวเฉลี่ยถ่วงน้ำหนักตอนรับของ", () => {
  it("ยอดเดิม 1000 @2 + รับ 1000 จ่าย 4000 (=@4) → @3", () => {
    expect(weightedAvgCost({ qty: 1000, costPerUnit: 2 }, { qty: 1000, costTotal: 4000 })).toBe(3);
  });

  it("ถ่วงน้ำหนักตามปริมาณจริง ไม่ใช่เฉลี่ยราคาเปล่า ๆ", () => {
    // 900 @1 + 100 จ่าย 500 (=@5) → (900+500)/1000 = 1.4  (ไม่ใช่ (1+5)/2 = 3)
    expect(weightedAvgCost({ qty: 900, costPerUnit: 1 }, { qty: 100, costTotal: 500 })).toBe(1.4);
  });

  it("สต็อกเดิมเป็น 0 → ใช้ราคาล็อตใหม่ล้วน", () => {
    expect(weightedAvgCost({ qty: 0, costPerUnit: 99 }, { qty: 700, costTotal: 840 })).toBe(1.2);
  });

  it("🚨 สต็อกเดิมติดลบ → ใช้ราคาล็อตใหม่ล้วน ไม่ใช่เอาสูตรถัวเฉลี่ยไปใช้", () => {
    // เอาสูตรไปใช้กับยอดติดลบจะได้ต้นทุน**ติดลบ** แล้วกำไรจะพองมหาศาลโดยไม่มีใครสังเกต
    const v = weightedAvgCost({ qty: -100, costPerUnit: 5 }, { qty: 700, costTotal: 700 });
    expect(v).toBe(1);
    expect(v).toBeGreaterThan(0);
  });

  it("รับเข้า 0 หรือติดลบ = ไม่เปลี่ยนต้นทุนเดิม (กันหารศูนย์)", () => {
    expect(weightedAvgCost({ qty: 100, costPerUnit: 2 }, { qty: 0, costTotal: 500 })).toBe(2);
    expect(weightedAvgCost({ qty: 100, costPerUnit: 2 }, { qty: -5, costTotal: 500 })).toBe(2);
  });

  it("⚠️ รับของฟรี (คีย์ 0) ทำให้ค่าเฉลี่ยลดลงจริง — ถูกตามเลขคณิต แต่กำไรจะดูดีเกินจริง", () => {
    expect(weightedAvgCost({ qty: 700, costPerUnit: 2 }, { qty: 700, costTotal: 0 })).toBe(1);
  });

  it("ปัด 4 ตำแหน่งให้ตรงกับ numeric(14,4) ฝั่ง DB", () => {
    expect(weightedAvgCost({ qty: 3, costPerUnit: 1 }, { qty: 4, costTotal: 2 })).toBe(0.7143);
  });
});

describe("ต้นทุนต่อบรรทัด — ตามโหมดของเมนู", () => {
  it("โหมดสูตร: Σ(ปริมาณ × ต้นทุนต่อหน่วย) × จำนวน", () => {
    // (30×1.2) + (30×0.8) = 60 ต่อแก้ว
    expect(lineCost(L("M1", 1), MENUS, ITEMS)).toBe(60);
    expect(lineCost(L("M1", 3), MENUS, ITEMS)).toBe(180);
  });

  it("โหมดต้นทุนตายตัว: ใช้ค่าที่ตั้งไว้ × จำนวน", () => {
    expect(lineCost(L("M3", 2), MENUS, ITEMS)).toBe(70);
  });

  it("โหมดยังไม่ตั้ง: ต้นทุน 0 (และหน้าจอต้องเตือน — ดู B2)", () => {
    expect(lineCost(L("M4", 5), MENUS, ITEMS)).toBe(0);
  });

  it("🚨 ของแถมมีต้นทุนเท่าของขาย — isComp ตัดแค่ยอดขาย ไม่ตัดต้นทุน", () => {
    expect(lineCost(L("M1", 1, { isComp: true }), MENUS, ITEMS)).toBe(60);
  });

  it("วัตถุดิบที่หาไม่เจอนับเป็น 0 ไม่ใช่ระเบิด (สูตรอ้างของที่ถูกลบไปแล้ว)", () => {
    const ghost: BarMenu = {
      menuId: "M9", name: "ผี", price: 1, categoryId: "custom",
      recipe: [{ itemId: "หายไป", qty: 10 }],
    };
    expect(lineCost(L("M9", 1), [ghost], ITEMS)).toBe(0);
  });

  it("เมนูที่ไม่มีในทะเบียน = 0", () => {
    expect(lineCost(L("ไม่มี", 1), MENUS, ITEMS)).toBe(0);
  });
});

describe("ต้นทุนทั้งบิล", () => {
  it("รวมทุกบรรทัดรวมของแถม", () => {
    expect(cartCost([L("M1", 1), L("M3", 1), L("M1", 1, { isComp: true })], MENUS, ITEMS))
      .toBe(60 + 35 + 60);
  });

  it("บิลว่าง = 0", () => {
    expect(cartCost([], MENUS, ITEMS)).toBe(0);
  });
});

describe("กำไรขั้นต้น", () => {
  it("คำนวณกำไรและเปอร์เซ็นต์", () => {
    expect(grossMargin(260, 60)).toEqual({ profit: 200, pct: 76.9 });
  });

  it("🪤 ยอดขาย 0 → pct เป็น null ไม่ใช่ 0 (บทเรียน D94 'หายระหว่างทาง 100%')", () => {
    expect(grossMargin(0, 0)).toEqual({ profit: 0, pct: null });
    expect(grossMargin(0, 50).pct).toBeNull();
  });

  it("ขาดทุนได้ (กำไรติดลบ) — ต้องไม่ถูกปัดเป็น 0", () => {
    expect(grossMargin(100, 150).profit).toBe(-50);
  });
});
