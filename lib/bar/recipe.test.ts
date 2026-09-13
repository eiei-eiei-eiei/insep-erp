import { describe, it, expect } from "vitest";
import {
  menuMode,
  deductsStock,
  menuWarning,
  unsetMenus,
  stockPlan,
  shortages,
  mergeCart,
  cleanRecipe,
  blankRecipeRow,
  danglingRows,
} from "./recipe";
import type { BarItem, BarMenu, CartLine } from "./types";

/** golden **B2** — โหมดเมนู + แผนตัดสต็อก (D96) */

const ITEMS: BarItem[] = [
  { itemId: "I-GIN", name: "จิน", unit: "ml", qty: 2100, costPerUnit: 1.2, packSize: 700 },
  { itemId: "I-VER", name: "เวอร์มุท", unit: "ml", qty: 300, costPerUnit: 0.8, packSize: 750 },
  { itemId: "I-LIM", name: "มะนาว", unit: "ลูก", qty: 12, costPerUnit: 5 },
  { itemId: "I-SODA", name: "โซดา", unit: "ขวด", qty: 24, costPerUnit: 12 },
];

const M_COCKTAIL: BarMenu = {
  menuId: "M1",
  name: "Negroni",
  price: 260,
  categoryId: "cocktail",
  recipe: [
    { itemId: "I-GIN", qty: 30 },
    { itemId: "I-VER", qty: 30 },
  ],
};
const M_BOTTLE: BarMenu = {
  menuId: "M2",
  name: "จิน (ขวด)",
  price: 1200,
  categoryId: "bottle",
  recipe: [{ itemId: "I-GIN", qty: 700 }],
};
const M_FOOD: BarMenu = {
  menuId: "M3",
  name: "ถั่วทอด",
  price: 80,
  categoryId: "food",
  recipe: [],
  fixedCost: 35,
};
const M_UNSET: BarMenu = { menuId: "M4", name: "ค็อกเทลลับ", price: 300, categoryId: "custom", recipe: [] };

const MENUS = [M_COCKTAIL, M_BOTTLE, M_FOOD, M_UNSET];
const line = (menuId: string, qty: number, extra: Partial<CartLine> = {}): CartLine => ({
  menuId,
  menuName: MENUS.find((m) => m.menuId === menuId)?.name ?? "?",
  qty,
  price: MENUS.find((m) => m.menuId === menuId)?.price ?? 0,
  ...extra,
});

describe("โหมดต้นทุนของเมนู — 3 แบบ", () => {
  it("มีสูตร = recipe · ต้นทุนตายตัว = fixed · ไม่มีทั้งคู่ = unset", () => {
    expect(menuMode(M_COCKTAIL)).toBe("recipe");
    expect(menuMode(M_FOOD)).toBe("fixed");
    expect(menuMode(M_UNSET)).toBe("unset");
  });

  it("มีแต่โหมด recipe เท่านั้นที่ตัดสต็อก", () => {
    expect(deductsStock(M_COCKTAIL)).toBe(true);
    expect(deductsStock(M_FOOD)).toBe(false);
    expect(deductsStock(M_UNSET)).toBe(false);
  });

  it("🪤 fixedCost = 0 ยังนับเป็นโหมด fixed (ของแจกที่รู้ว่าต้นทุนศูนย์ ≠ ยังไม่ได้ตั้ง)", () => {
    expect(menuMode({ recipe: [], fixedCost: 0 })).toBe("fixed");
  });

  it("มีทั้งสูตรและต้นทุนตายตัว → สูตรชนะ แต่ **ต้องเตือน** ไม่ใช่เงียบ", () => {
    const both = { ...M_COCKTAIL, fixedCost: 99 };
    expect(menuMode(both)).toBe("recipe");
    expect(menuWarning(both)).toContain("ไม่ถูกใช้");
  });

  it("🚨 โหมด unset ต้องมีข้อความเตือนเสมอ — ห้ามข้ามเงียบ (D83/D86)", () => {
    expect(menuWarning(M_UNSET)).toBeTruthy();
    expect(menuWarning(M_UNSET)).toContain("ไม่ตัดสต็อก");
  });

  it("เมนูปกติไม่มีคำเตือน (กันเตือนพร่ำเพรื่อจนคนเลิกอ่าน)", () => {
    expect(menuWarning(M_COCKTAIL)).toBeNull();
    expect(menuWarning(M_FOOD)).toBeNull();
  });

  it("รวมรายชื่อเมนูที่ยังไม่ตั้งต้นทุน — ใช้ทำแถบ 'ยังไม่ตั้งต้นทุน N รายการ'", () => {
    expect(unsetMenus(MENUS).map((m) => m.menuId)).toEqual(["M4"]);
  });
});

describe("แผนตัดสต็อก", () => {
  it("รวมยอดต่อวัตถุดิบ แม้มาจากหลายเมนู", () => {
    const plan = stockPlan([line("M1", 2), line("M2", 1)], MENUS);
    const gin = plan.find((p) => p.itemId === "I-GIN")!;
    expect(gin.qty).toBe(30 * 2 + 700); // 760
    expect(plan.find((p) => p.itemId === "I-VER")!.qty).toBe(60);
  });

  it("เมนูที่ไม่มีสูตร **ไม่ปรากฏในแผนเลย** (ไม่ใช่ปรากฏด้วยยอด 0 — คนละความหมาย)", () => {
    const plan = stockPlan([line("M3", 5), line("M4", 5)], MENUS);
    expect(plan).toEqual([]);
  });

  it("🚨 ของแถมก็ตัดสต็อก — แถมแล้วเหล้าก็หายจากขวดจริง", () => {
    const plan = stockPlan([line("M1", 1, { isComp: true })], MENUS);
    expect(plan.find((p) => p.itemId === "I-GIN")!.qty).toBe(30);
  });

  it("เมนูที่หาไม่เจอในทะเบียนถูกข้าม (ชื่อยังอยู่ในบิลเป็น snapshot)", () => {
    expect(stockPlan([{ menuId: "ไม่มีจริง", menuName: "x", qty: 1, price: 1 }], MENUS)).toEqual([]);
  });

  it("ขายเป็นแก้วกับขายทั้งขวดใช้วัตถุดิบตัวเดียวกัน ต่างกันแค่ปริมาณ (ได้ฟรีจากโครงสูตร)", () => {
    expect(stockPlan([line("M1", 1)], MENUS).find((p) => p.itemId === "I-GIN")!.qty).toBe(30);
    expect(stockPlan([line("M2", 1)], MENUS).find((p) => p.itemId === "I-GIN")!.qty).toBe(700);
  });
});

describe("ของไม่พอ — เตือน ไม่บล็อก", () => {
  it("บอกว่าต้องใช้เท่าไร มีเท่าไร พร้อมหน่วย", () => {
    const { short } = shortages([line("M1", 20)], MENUS, ITEMS); // เวอร์มุทต้อง 600 มี 300
    expect(short).toHaveLength(1);
    expect(short[0]).toMatchObject({ itemId: "I-VER", name: "เวอร์มุท", need: 600, have: 300, unit: "ml" });
  });

  it("พอดีเป๊ะ = ไม่ขาด (เส้นแบ่งอยู่ที่ 'น้อยกว่า' ไม่ใช่ 'น้อยกว่าหรือเท่ากับ')", () => {
    const { short } = shortages([line("M2", 3)], MENUS, ITEMS); // 2100 ml พอดี
    expect(short).toEqual([]);
  });

  it("🪤 วัตถุดิบที่ไม่มีในทะเบียน = ไม่รู้ ≠ ไม่มี → ไม่นับเป็นของขาด แต่ต้องรายงานแยก", () => {
    const ghost: BarMenu = {
      menuId: "M9", name: "ผี", price: 1, categoryId: "custom",
      recipe: [{ itemId: "I-หายไป", qty: 10 }],
    };
    const { short, unknownItems } = shortages([{ menuId: "M9", menuName: "ผี", qty: 1, price: 1 }], [ghost], ITEMS);
    expect(short).toEqual([]);
    expect(unknownItems).toEqual(["I-หายไป"]);
  });
});

describe("รวมบรรทัดในตะกร้า", () => {
  it("เมนู ราคา ส่วนลด และสถานะแถมเหมือนกัน → รวมเป็นบรรทัดเดียว", () => {
    const merged = mergeCart([line("M1", 1), line("M1", 2)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].qty).toBe(3);
  });

  it("🚨 ของแถมห้ามรวมกับของขาย — ยอดต่างกันคนละเรื่อง", () => {
    const merged = mergeCart([line("M1", 1), line("M1", 1, { isComp: true })]);
    expect(merged).toHaveLength(2);
  });

  it("ส่วนลดต่อรายการต่างกัน = คนละบรรทัด", () => {
    expect(mergeCart([line("M1", 1, { lineDiscount: 20 }), line("M1", 1)])).toHaveLength(2);
  });

  it("ไม่แก้ของเดิม (คืน array ใหม่ — กัน state ของ React เพี้ยน)", () => {
    const input = [line("M1", 1)];
    const out = mergeCart(input);
    out[0].qty = 99;
    expect(input[0].qty).toBe(1);
  });
});

/**
 * แถวสูตรระหว่างกรอกบนฟอร์ม (D96)
 *
 * 🐛 มาจากบั๊กจริง: "ราคาขายกับจำนวนวัตถุดิบที่ใส่มี 0 ค้าง ลบไม่ได้"
 *    ⇒ ฟอร์มต้องยอมให้ช่องว่างได้ระหว่างพิมพ์ แล้วกรองทิ้งตอนบันทึกที่จุดเดียว
 */
describe("แถวสูตรบนฟอร์ม — cleanRecipe / danglingRows (D96)", () => {
  it("เอาเฉพาะแถวที่มีทั้งวัตถุดิบและปริมาณ > 0", () => {
    expect(
      cleanRecipe([
        { itemId: "T-GIN", qty: 45 },
        { itemId: "T-CAM", qty: 30 },
      ]),
    ).toEqual([
      { itemId: "T-GIN", qty: 45 },
      { itemId: "T-CAM", qty: 30 },
    ]);
  });

  it("ทิ้งแถวว่าง · แถวที่ยังพิมพ์ไม่เสร็จ (qty = \"\") · แถวที่ปริมาณเป็น 0", () => {
    expect(
      cleanRecipe([
        blankRecipeRow(),
        { itemId: "T-GIN", qty: "" },
        { itemId: "T-CAM", qty: 0 },
        { itemId: "", qty: 30 },
        { itemId: "T-VER", qty: 30 },
      ]),
    ).toEqual([{ itemId: "T-VER", qty: 30 }]);
  });

  it("ปริมาณติดลบไม่ผ่าน — สูตรติดลบ = ตัดสต็อกกลับด้าน", () => {
    expect(cleanRecipe([{ itemId: "T-GIN", qty: -45 }])).toEqual([]);
  });

  it("blankRecipeRow() ให้ปริมาณเป็นค่าว่าง ไม่ใช่ 0 — ต้นเหตุของ 0 ค้างพอดี", () => {
    expect(blankRecipeRow()).toEqual({ itemId: "", qty: "" });
  });

  it("นับแถวที่กรอกครึ่งเดียวได้ — ต้องเตือน ไม่ใช่ทิ้งเงียบ ๆ", () => {
    expect(
      danglingRows([
        { itemId: "T-GIN", qty: 45 }, // ครบ — ไม่นับ
        { itemId: "T-CAM", qty: "" }, // เลือกของแต่ไม่ใส่ปริมาณ
        { itemId: "T-VER", qty: 0 }, // ปริมาณ 0 = ยังไม่ได้ใส่
        { itemId: "", qty: 30 }, // ใส่ปริมาณแต่ลืมเลือกของ
        blankRecipeRow(), // ว่างทั้งแถว — ไม่นับ (ยังไม่ได้เริ่มกรอก)
      ]),
    ).toBe(3);
  });

  it("ฟอร์มที่ยังไม่ได้แตะเลย = ไม่มีแถวค้าง (ห้ามเตือนตั้งแต่เปิดฟอร์ม)", () => {
    expect(danglingRows([blankRecipeRow(), blankRecipeRow(), blankRecipeRow()])).toBe(0);
  });
});
