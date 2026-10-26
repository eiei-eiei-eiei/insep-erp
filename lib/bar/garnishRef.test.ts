import { describe, it, expect } from "vitest";
import { parseQty, qtyTextToKeep, qtyShown } from "./fraction";
import { resolveRecipe, itemUses, recipeText, menusUsingGarnish, garnishDeleteBlock } from "./houseSlot";
import { cleanRecipe, draftFromRecipe, rowRefKey, recipeRpcLines, stockPlan, menuMode, duplicateRows } from "./recipe";
import { lineCost } from "./cost";
import { recipeUseCount, slotNamesByItem, unitLockReason } from "./stockBatch";
import { roundToDraft, roundLinesText, previewUseCost, type LabLine, type LabUse } from "./lab";
import type { BarGarnish, BarItem, BarMenu, HouseSlot, RecipeRefs } from "./types";

/** golden **B28** — บรรทัดสูตรอ้างชุดตกแต่ง + จำนวนเศษส่วน (D131) */

const ITEMS: BarItem[] = [
  { itemId: "LIME", name: "มะนาว", unit: "ลูก", qty: 10, costPerUnit: 7 },
  { itemId: "GORD", name: "Gordon's", unit: "ml", qty: 1000, costPerUnit: 0.6 },
  { itemId: "SYR", name: "น้ำเชื่อม", unit: "ml", qty: 500, costPerUnit: 0.05 },
];
const SLOTS: HouseSlot[] = [{ slotId: "S1", name: "House Gin", itemId: "GORD", sort: 0 }];
const WHEEL: BarGarnish = { garnishId: "G1", name: "Lime Wheel", itemId: "LIME", qty: 1 / 7, qtyText: "1/7", sort: 0 };
const MINT: BarGarnish = { garnishId: "G2", name: "ใบมิ้นต์กระถาง", itemId: null, qty: null, sort: 1 };
const REFS: RecipeRefs = { slots: SLOTS, garnishes: [WHEEL, MINT] };

const GIMLET: BarMenu = {
  menuId: "M1", name: "Gimlet", price: 280, categoryId: "c",
  recipe: [{ slotId: "S1", qty: 45 }, { itemId: "SYR", qty: 15 }, { garnishId: "G1", qty: 1 }],
};
const MOJITO: BarMenu = {
  menuId: "M2", name: "Mojito", price: 250, categoryId: "c",
  recipe: [{ itemId: "LIME", qty: 0.5 }, { garnishId: "G1", qty: 2 }, { garnishId: "G2", qty: 1 }],
};
const DECOR_ONLY: BarMenu = { menuId: "M3", name: "น้ำเปล่าแต่งแก้ว", price: 20, categoryId: "c", recipe: [{ garnishId: "G2", qty: 1 }] };

describe("B28 · เศษส่วน", () => {
  it("parseQty รับ 1/7 · 1 1/2 · 0.5 · .5 · 2", () => {
    expect(parseQty("1/7")).toBe(1 / 7);
    expect(parseQty(" 1 1/2 ")).toBe(1.5);
    expect(parseQty("0.5")).toBe(0.5);
    expect(parseQty(".5")).toBe(0.5);
    expect(parseQty("2")).toBe(2);
    expect(parseQty("1.5/3")).toBe(0.5);
  });
  it("พิมพ์ไม่ถูกรูป / ศูนย์ / หารศูนย์ / ติดลบ → null (ไม่เดา)", () => {
    for (const t of ["", " ", "abc", "1/0", "0", "0/5", "-1", "1/7/2", "1,5", "1 1/0"]) expect(parseQty(t)).toBeNull();
  });
  it("เก็บข้อความเฉพาะเศษส่วน · แสดงข้อความถ้ามี ไม่งั้นตัวเลข 4 ตำแหน่ง", () => {
    expect(qtyTextToKeep(" 1/7 ")).toBe("1/7");
    expect(qtyTextToKeep("1  1/2")).toBe("1 1/2");
    expect(qtyTextToKeep("0.5")).toBeNull();
    expect(qtyTextToKeep("1/0")).toBeNull();
    expect(qtyShown(1 / 7, "1/7")).toBe("1/7");
    expect(qtyShown(1 / 7)).toBe("0.1429");
    expect(qtyShown(3.5, null)).toBe("3.5");
  });
});

describe("B28 · แปลงสูตร (ฝาแฝดของ bar_menu_lines ใน 0093)", () => {
  it("ชุด → วัตถุดิบ × (จำนวนชุด × ต่อชุด) · รวมกับบรรทัดวัตถุดิบตัวเดียวกัน", () => {
    const { lines, missing } = resolveRecipe(MOJITO.recipe, REFS);
    expect(missing).toEqual([]);
    // มะนาว 0.5 + 2 × 1/7 · ชุดไม่ตัดสต็อกไม่มีบรรทัด (ไม่ใช่บรรทัด 0)
    expect(lines).toEqual([{ itemId: "LIME", qty: 0.7857142857 }]);
  });
  it("🚨 1/7 ลูก × 7 แก้ว = 1 ลูกพอดี (ไม่ปัด 4 ตำแหน่งก่อนคูณ)", () => {
    const plan = stockPlan([{ menuId: "M1", menuName: "Gimlet", qty: 7, price: 280 }], [GIMLET], REFS);
    expect(plan.find((p) => p.itemId === "LIME")?.qty).toBeCloseTo(1, 8);
  });
  it("ชุดที่หาไม่เจอ (ลบจากอีกเครื่อง) → missing ไม่นับเป็น 0 เงียบ ๆ", () => {
    expect(resolveRecipe([{ garnishId: "GX", qty: 1 }], REFS)).toEqual({ lines: [], missing: ["GX"] });
  });
  it("แก้สัดส่วนของชุด = ทุกเมนูที่อ้างเปลี่ยนตาม", () => {
    const eight: RecipeRefs = { ...REFS, garnishes: [{ ...WHEEL, qty: 1 / 8, qtyText: "1/8" }, MINT] };
    expect(resolveRecipe(GIMLET.recipe, eight).lines.find((l) => l.itemId === "LIME")?.qty).toBe(0.125);
  });
  it("ต้นทุน = ช่อง + วัตถุดิบ + ชุด · ชุดไม่ตัดสต็อกไม่มีทุน", () => {
    // 45 × 0.6 + 15 × 0.05 + 1/7 × 7 = 27 + 0.75 + 1 = 28.75
    expect(lineCost({ menuId: "M1", menuName: "Gimlet", qty: 1, price: 280 }, [GIMLET], ITEMS, REFS)).toBe(28.75);
    expect(lineCost({ menuId: "M3", menuName: "x", qty: 3, price: 20 }, [DECOR_ONLY], ITEMS, REFS)).toBe(0);
  });
  it("🪤 สูตรมีแต่ชุดไม่ตัดสต็อก = ยังเป็นโหมดสูตร (ตรงกับ bar_menu_has_recipe ไม่ใช่ exists(bar_menu_lines))", () => {
    expect(menuMode(DECOR_ONLY)).toBe("recipe");
    expect(stockPlan([{ menuId: "M3", menuName: "x", qty: 1, price: 20 }], [DECOR_ONLY], REFS)).toEqual([]);
  });
});

describe("B28 · บรรทัดฟอร์ม ↔ บรรทัดสูตร ↔ RPC", () => {
  it("draftFromRecipe → cleanRecipe ไปกลับได้ค่าเดิม", () => {
    expect(cleanRecipe(draftFromRecipe(MOJITO.recipe))).toEqual(MOJITO.recipe);
  });
  it("ชุดกับวัตถุดิบตัวเดียวกันเป็นคนละบรรทัด · ชุดเดิม 2 แถวรวมเป็นแถวเดียว", () => {
    expect(rowRefKey({ itemId: "", garnishId: "G1" })).toBe("garnish:G1");
    const rows = [
      { itemId: "LIME", qty: 0.5 as const },
      { itemId: "", garnishId: "G1", qty: 1 as const },
      { itemId: "", garnishId: "G1", qty: 2 as const },
    ];
    expect(cleanRecipe(rows)).toEqual([{ itemId: "LIME", qty: 0.5 }, { garnishId: "G1", qty: 3 }]);
    expect(duplicateRows(rows)).toBe(1);
  });
  it("recipeRpcLines ส่งคีย์เดียวต่อบรรทัด", () => {
    expect(recipeRpcLines(GIMLET.recipe)).toEqual([
      { slot_id: "S1", qty: 45 },
      { item_id: "SYR", qty: 15 },
      { garnish_id: "G1", qty: 1 },
    ]);
  });
  it("ข้อความสูตร: ชื่อชุด × จำนวน (สิ่งที่ตัด) · หลายชุดบอกว่า 'ชุดละ' · ไม่ตัดสต็อก", () => {
    expect(recipeText(MOJITO.recipe, ITEMS, REFS)).toBe(
      "มะนาว 0.5 ลูก · Lime Wheel × 2 (ชุดละ มะนาว 1/7 ลูก) · ใบมิ้นต์กระถาง × 1 (ไม่ตัดสต็อก)",
    );
    expect(recipeText([{ garnishId: "G1", qty: 1 }], ITEMS, REFS)).toBe("Lime Wheel × 1 (มะนาว 1/7 ลูก)");
    expect(recipeText([{ garnishId: "GX", qty: 1 }], ITEMS, REFS)).toBe("(ไม่พบชุดตกแต่ง) × 1");
  });
});

describe("B28 · ลบชุด / ล็อกหน่วย", () => {
  const MENUS = [GIMLET, MOJITO, DECOR_ONLY];
  it("เมนูที่อ้างชุด เรียงตามชื่อ · ลบไม่ได้บอกรายชื่อ", () => {
    expect(menusUsingGarnish("G1", MENUS)).toEqual(["Gimlet", "Mojito"]);
    expect(garnishDeleteBlock("G1", MENUS)).toBe("ใช้อยู่ในสูตร 2 เมนู: Gimlet · Mojito — เอาออกจากสูตรก่อนถึงจะลบได้");
    expect(garnishDeleteBlock("G9", MENUS)).toBeNull();
  });
  it("🚨 ล็อกหน่วยนับการอ้างผ่านชุดด้วย และบอกชื่อชุด", () => {
    const only = [{ ...GIMLET, recipe: [{ garnishId: "G1", qty: 1 }] }];
    expect(recipeUseCount(only, REFS).get("LIME")).toBe(1);
    expect(slotNamesByItem(only, REFS).get("LIME")).toEqual(["Lime Wheel"]);
    expect(unitLockReason({ qty: 0, unit: "ลูก" }, 1, ["Lime Wheel"])).toContain("Lime Wheel");
    // ชุดไม่ตัดสต็อก ไม่ล็อกอะไร
    expect(itemUses([DECOR_ONLY], REFS).size).toBe(0);
  });
});

describe("B28 · ห้องทดลอง", () => {
  const line = (p: Partial<LabLine>): LabLine => ({
    lineNo: 1, kind: "สูตร", itemId: null, slotId: null, garnishId: null, garnishQty: null, menuId: null,
    labRecipeId: null, label: "", unit: null, qty: 1, cost: 0, ...p,
  });
  const ROUND: LabUse = {
    useId: "LB1", usedAt: "2026-10-26T10:00:00Z", businessDate: "2026-10-26", categoryId: "trial",
    recipeId: "LR1", roundNo: 1, glasses: 1, eventName: null, note: null, costTotal: 0, createdBy: null,
    lines: [
      line({ lineNo: 1, itemId: "GORD", label: "Gordon's", unit: "ml", qty: 45 }),
      line({ lineNo: 2, kind: "ชุดตกแต่ง", itemId: "LIME", garnishId: "G1", garnishQty: 1 / 7, label: "Lime Wheel (มะนาว 1/7 ลูก)", unit: "ลูก", qty: 1 }),
      line({ lineNo: 3, kind: "ชุดตกแต่ง", garnishId: "G2", label: "ใบมิ้นต์กระถาง (ไม่ตัดสต็อก)", qty: 1 }),
    ],
  };
  it("รอบ → ฟอร์ม: ชุดที่ยังอยู่กลับเป็นชุดเดิม", () => {
    expect(roundToDraft(ROUND, REFS)).toEqual([
      { itemId: "GORD", qty: 45 },
      { itemId: "", garnishId: "G1", qty: 1 },
      { itemId: "", garnishId: "G2", qty: 1 },
    ]);
  });
  it("ชุดถูกลบแล้ว → วัตถุดิบ × ปริมาณที่จำไว้ · ชุดไม่ตัดสต็อกที่ถูกลบ → ไม่มีแถว (ไม่เดา)", () => {
    expect(roundToDraft(ROUND, { slots: [], garnishes: [] })).toEqual([
      { itemId: "GORD", qty: 45 },
      { itemId: "LIME", qty: 0.1428571429 },
    ]);
  });
  it("ข้อความรอบใช้ป้ายที่แช่ไว้ + × จำนวนชุด", () => {
    expect(roundLinesText(ROUND)).toBe("Gordon's 45 ml · Lime Wheel (มะนาว 1/7 ลูก) × 1 · ใบมิ้นต์กระถาง (ไม่ตัดสต็อก) × 1");
  });
  it("พรีวิวทุนสูตรทดลองรวมชุด ณ ตอนนี้", () => {
    // 7 แก้ว × (45 × 0.6 + 1/7 × 7) = 7 × 28 = 196
    expect(previewUseCost({ menus: [], recipes: [{ recipeId: "LR1", qty: 7 }], items: [], errors: [] }, [], ITEMS, REFS, [ROUND])).toBe(196);
  });
});
