import { describe, it, expect } from "vitest";
import {
  resolveRecipe,
  menusUsingSlot,
  slotDeleteBlock,
  slotItemChangeBlock,
  slotItemChoices,
  slotLabel,
  slotOption,
  slotWarning,
  itemUses,
  slotEditsError,
  recipeText,
} from "./houseSlot";
import { recipeUseCount, slotNamesByItem, unitLockReason, planItemEdits, editDrafts } from "./stockBatch";
import { stockPlan, shortages, menuMode } from "./recipe";
import { lineCost } from "./cost";
import { matchRef } from "./menuPricing";
import type { BarItem, BarMenu, HouseSlot } from "./types";

/** golden **B23** — เหล้าประจำบ้าน (D127) */

const ITEMS: BarItem[] = [
  { itemId: "GORD", name: "Gordon's", unit: "ml", qty: 700, costPerUnit: 0.6 },
  { itemId: "BOMB", name: "Bombay", unit: "ml", qty: 0, costPerUnit: 1.1 },
  { itemId: "GINBTL", name: "จินขวด", unit: "ขวด", qty: 0, costPerUnit: 500 },
  { itemId: "CAMP", name: "Campari", unit: "ml", qty: 700, costPerUnit: 1 },
  { itemId: "OLD", name: "จินเลิกใช้", unit: "ml", qty: 0, costPerUnit: 0.5, active: false },
];
const SLOTS: HouseSlot[] = [
  { slotId: "S-GIN", name: "House Gin", itemId: "GORD", sort: 0 },
  { slotId: "S-VOD", name: "House Vodka", itemId: "CAMP", sort: 1 },
];
const NEGRONI: BarMenu = {
  menuId: "M1",
  name: "Negroni",
  price: 260,
  categoryId: "c",
  recipe: [{ slotId: "S-GIN", qty: 30 }, { itemId: "CAMP", qty: 30 }],
};
const GT: BarMenu = { menuId: "M2", name: "Gin Tonic", price: 200, categoryId: "c", recipe: [{ slotId: "S-GIN", qty: 45 }] };
const SHOT: BarMenu = { menuId: "M3", name: "Bombay shot", price: 150, categoryId: "c", recipe: [{ itemId: "BOMB", qty: 30 }] };
const MENUS = [NEGRONI, GT, SHOT];

describe("B23 · resolveRecipe — ช่องกลายเป็นขวดที่ตั้งไว้ตอนนี้", () => {
  it("แปลงช่องเป็นขวดของช่อง", () => {
    expect(resolveRecipe(NEGRONI.recipe, SLOTS)).toEqual({
      lines: [{ itemId: "GORD", qty: 30 }, { itemId: "CAMP", qty: 30 }],
      missing: [],
    });
  });

  it("เปลี่ยนขวดในช่อง = เมนูที่อ้างช่องเปลี่ยนตามทันที", () => {
    const moved = SLOTS.map((s) => (s.slotId === "S-GIN" ? { ...s, itemId: "BOMB" } : s));
    expect(resolveRecipe(GT.recipe, moved).lines).toEqual([{ itemId: "BOMB", qty: 45 }]);
  });

  it("ช่อง + ขวดตรงที่เป็นขวดเดียวกัน → รวมยอดต่อขวด (ตรงกับ SQL ที่ group by item)", () => {
    const r = resolveRecipe([{ slotId: "S-GIN", qty: 30 }, { itemId: "GORD", qty: 15 }], SLOTS);
    expect(r.lines).toEqual([{ itemId: "GORD", qty: 45 }]);
  });

  it("🪤 ช่องที่หาไม่เจอ ไม่นับเป็น 0 เงียบ ๆ — คืนใน missing", () => {
    const r = resolveRecipe([{ slotId: "GONE", qty: 30 }, { itemId: "CAMP", qty: 30 }], SLOTS);
    expect(r).toEqual({ lines: [{ itemId: "CAMP", qty: 30 }], missing: ["GONE"] });
  });

  it("เมนูที่มีแต่บรรทัดช่องยังนับเป็นโหมด 'มีสูตร' (ไม่ตกไปต้นทุนตายตัว)", () => {
    expect(menuMode({ recipe: GT.recipe, fixedCost: 50 })).toBe("recipe");
  });
});

describe("B23 · ตัดสต็อก/ต้นทุนบนจอใช้ขวดของช่อง", () => {
  const cart = [{ menuId: "M2", menuName: "Gin Tonic", qty: 2, price: 200 }];
  it("stockPlan", () => {
    expect(stockPlan(cart, MENUS, SLOTS)).toEqual([{ itemId: "GORD", qty: 90 }]);
  });
  it("shortages — ขวดของช่องไม่พอ = เตือนที่ขวดนั้น (ไม่สลับขวดเอง)", () => {
    const big = [{ ...cart[0], qty: 20 }];
    expect(shortages(big, MENUS, ITEMS, SLOTS).short.map((s) => s.itemId)).toEqual(["GORD"]);
  });
  it("lineCost", () => {
    expect(lineCost(cart[0], MENUS, ITEMS, SLOTS)).toBe(54); // 45 × 0.6 × 2
  });
});

describe("B23 · ลบช่อง / เปลี่ยนขวด", () => {
  it("menusUsingSlot เรียงชื่อ", () => {
    expect(menusUsingSlot("S-GIN", MENUS)).toEqual(["Gin Tonic", "Negroni"]);
  });
  it("ลบช่องที่มีสูตรอ้าง = บล็อก + บอกรายชื่อเมนู", () => {
    const r = slotDeleteBlock("S-GIN", MENUS);
    expect(r).toContain("2 เมนู");
    expect(r).toContain("Gin Tonic · Negroni");
    expect(slotDeleteBlock("S-VOD", MENUS)).toBeNull();
  });
  it("รายชื่อยาว ตัดที่ 5 แล้วบอกจำนวนที่เหลือ", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ name: `M${i}`, recipe: [{ slotId: "S", qty: 1 }] }));
    expect(slotDeleteBlock("S", many)).toContain("และอีก 2 เมนู");
  });
  it("🚨 ช่องที่มีสูตรอ้าง เปลี่ยนเป็นขวดคนละหน่วยไม่ได้", () => {
    const r = slotItemChangeBlock(ITEMS[0], ITEMS[2], 2);
    expect(r).toContain("ml");
    expect(r).toContain("2 เมนู");
    expect(slotItemChangeBlock(ITEMS[0], ITEMS[1], 2)).toBeNull();
  });
  it("ช่องที่ยังไม่มีเมนูใช้ เปลี่ยนได้ทุกหน่วย", () => {
    expect(slotItemChangeBlock(ITEMS[0], ITEMS[2], 0)).toBeNull();
  });
  it("ไม่เลือกขวด = บล็อก (ช่องว่างไม่มีอยู่จริง)", () => {
    expect(slotItemChangeBlock(ITEMS[0], undefined, 0)).toBe("เลือกขวดของช่องนี้ก่อน");
  });
  it("slotItemChoices — ช่องที่ใช้อยู่ เหลือเฉพาะหน่วยเดียวกัน · ขวดปัจจุบันอยู่เสมอแม้ปิดใช้", () => {
    expect(slotItemChoices("GORD", ITEMS, 2).map((i) => i.itemId)).toEqual(["GORD", "BOMB", "CAMP"]);
    expect(slotItemChoices("GORD", ITEMS, 0).map((i) => i.itemId)).toEqual(["GORD", "BOMB", "GINBTL", "CAMP"]);
    expect(slotItemChoices("OLD", ITEMS, 1).map((i) => i.itemId)).toEqual(["GORD", "BOMB", "CAMP", "OLD"]);
    expect(slotItemChoices(null, ITEMS, 0).map((i) => i.itemId)).not.toContain("OLD");
  });
});

describe("B23 · ป้าย / คำเตือน", () => {
  it("slotLabel", () => {
    expect(slotLabel(SLOTS[0], ITEMS)).toBe("House Gin → Gordon's (ml)");
    expect(slotLabel({ name: "X", itemId: "NOPE" }, ITEMS)).toBe("X → (ไม่พบขวด)");
  });
  it("slotWarning — ขวดปิดใช้ยังตัดขวดนั้น แค่บอก", () => {
    expect(slotWarning({ itemId: "OLD" }, ITEMS)).toContain("ยังตัดขวดนี้อยู่");
    expect(slotWarning({ itemId: "GORD" }, ITEMS)).toBeNull();
  });
  it("matchRef — ป้ายเต็มของช่องไม่ชนป้ายวัตถุดิบ", () => {
    expect(matchRef(slotOption(SLOTS[0]), ITEMS, SLOTS)).toEqual({ itemId: "", slotId: "S-GIN" });
    expect(matchRef("Gordon's (ml)", ITEMS, SLOTS)).toEqual({ itemId: "GORD" });
    expect(matchRef("house gin", ITEMS, SLOTS)).toEqual({ itemId: "", slotId: "S-GIN" });
    expect(matchRef("gordon's", ITEMS, SLOTS)).toEqual({ itemId: "GORD" });
    expect(matchRef("house", ITEMS, SLOTS)).toEqual({ itemId: "" });
  });
  it("🚨 ชื่อเปล่าตรงทั้งช่องและวัตถุดิบ = ไม่เลือกให้", () => {
    const clash = [...ITEMS, { itemId: "HG", name: "House Gin", unit: "ml", qty: 0, costPerUnit: 0 }];
    expect(matchRef("House Gin", clash, SLOTS)).toEqual({ itemId: "" });
  });
});

describe("B23 · ล็อกหน่วยวัตถุดิบ นับการอ้างผ่านช่องด้วย (D104 + D127)", () => {
  it("itemUses / recipeUseCount นับเมนูไม่ซ้ำ", () => {
    const u = itemUses(MENUS, SLOTS);
    expect(u.get("GORD")).toEqual({ menus: 2, viaSlots: ["House Gin"] });
    expect(u.get("CAMP")).toEqual({ menus: 1, viaSlots: [] });
    expect(recipeUseCount(MENUS, SLOTS).get("BOMB")).toBe(1);
    // ช่อง + ขวดตรงขวดเดียวกันในเมนูเดียว = 1 เมนู
    const both = [{ recipe: [{ slotId: "S-GIN", qty: 1 }, { itemId: "GORD", qty: 1 }] }] as BarMenu[];
    expect(recipeUseCount(both, SLOTS).get("GORD")).toBe(1);
  });
  it("🚨 ขวดที่ใช้ผ่านช่องเท่านั้น ก็เปลี่ยนหน่วยไม่ได้ + บอกทางแก้ว่าเปลี่ยนขวดของช่อง", () => {
    const empty = ITEMS.map((i) => (i.itemId === "GORD" ? { ...i, qty: 0 } : i));
    const d = editDrafts(empty).map((x) => (x.itemId === "GORD" ? { ...x, unit: "ขวด" } : x));
    const r = planItemEdits(d, empty, recipeUseCount(MENUS, SLOTS), slotNamesByItem(MENUS, SLOTS));
    expect(r.errors[0].text).toContain("House Gin");
    expect(r.errors[0].text).toContain("เปลี่ยนขวดของช่อง");
  });
  it("ใช้ตรง ๆ อย่างเดียว ข้อความเดิมไม่เปลี่ยน", () => {
    expect(unitLockReason({ qty: 0, unit: "ml" }, 1)).toBe("ใช้อยู่ในสูตร 1 เมนู — เอาออกจากสูตรก่อนถึงจะเปลี่ยนหน่วยได้");
  });
});

describe("B23 · slotEditsError — ด่านก่อนบันทึกช่องทั้งชุด", () => {
  const keep = SLOTS.map((s) => ({ slotId: s.slotId, name: s.name, itemId: s.itemId }));
  it("ไม่เปลี่ยนอะไร = ผ่าน", () => {
    expect(slotEditsError(keep, SLOTS, ITEMS, MENUS)).toBe("");
  });
  it("ชื่อว่าง / ซ้ำ (ไม่สนตัวพิมพ์) / ไม่เลือกขวด", () => {
    expect(slotEditsError([...keep, { slotId: null, name: " ", itemId: "BOMB" }], SLOTS, ITEMS, MENUS)).toContain("ตั้งชื่อ");
    expect(slotEditsError([...keep, { slotId: null, name: "house gin", itemId: "BOMB" }], SLOTS, ITEMS, MENUS)).toContain("ซ้ำ");
    expect(slotEditsError([...keep, { slotId: null, name: "House Rum", itemId: "" }], SLOTS, ITEMS, MENUS)).toContain("เลือกขวด");
  });
  it("ลบช่องที่มีสูตรอ้าง = บล็อก · ลบช่องที่ไม่มีใครใช้ = ผ่าน", () => {
    expect(slotEditsError([keep[1]], SLOTS, ITEMS, MENUS)).toContain("ลบช่อง House Gin ไม่ได้");
    expect(slotEditsError([keep[0]], SLOTS, ITEMS, MENUS)).toBe("");
  });
  it("เปลี่ยนขวดคนละหน่วยของช่องที่ใช้อยู่ = บล็อก · หน่วยเดียวกัน = ผ่าน", () => {
    expect(slotEditsError([{ ...keep[0], itemId: "GINBTL" }, keep[1]], SLOTS, ITEMS, MENUS)).toContain("หน่วย");
    expect(slotEditsError([{ ...keep[0], itemId: "BOMB" }, keep[1]], SLOTS, ITEMS, MENUS)).toBe("");
  });
  it("ช่องที่ถูกลบจากอีกเครื่อง → ให้รีเฟรช", () => {
    expect(slotEditsError([{ slotId: "GONE", name: "X", itemId: "BOMB" }], SLOTS, ITEMS, [])).toContain("รีเฟรช");
  });
});

describe("B23 · recipeText — แท็บเมนูแสดงทั้งชื่อช่องและขวดปัจจุบัน", () => {
  it("ช่อง + ขวดตรง", () => {
    expect(recipeText(NEGRONI.recipe, ITEMS, SLOTS)).toBe("House Gin (Gordon's) 30 ml · Campari 30 ml");
  });
  it("ของที่หาไม่เจอบอกตรง ๆ ไม่หายเงียบ", () => {
    expect(recipeText([{ slotId: "X", qty: 1 }, { itemId: "Y", qty: 2.5 }], ITEMS, SLOTS)).toBe(
      "(ไม่พบช่อง) 1 · (ไม่พบวัตถุดิบ) 2.5",
    );
  });
});
