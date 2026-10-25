import { describe, it, expect } from "vitest";
import { quickChips, applyPick, pinnedItems, garnishEditsError, garnishWarning, pinPlan, orderedSlots, moveAt } from "./quickPick";
import { cleanRecipe, duplicateRows, danglingRows, draftFromRecipe, blankRecipeRow } from "./recipe";
import type { BarGarnish, BarItem, HouseSlot } from "./types";

/** golden **B24** — แถบปุ่มลัด · ชุดตกแต่ง · วัตถุดิบใช้บ่อย (D127) */

const ITEMS: BarItem[] = [
  { itemId: "LIME", name: "มะนาว", unit: "ml", qty: 0, costPerUnit: 0.2, pinSort: 1 },
  { itemId: "SYR", name: "น้ำเชื่อม", unit: "ml", qty: 0, costPerUnit: 0.05, pinSort: 0 },
  { itemId: "SODA", name: "โซดา", unit: "ml", qty: 0, costPerUnit: 0.02 },
  { itemId: "MINT", name: "มินต์", unit: "ใบ", qty: 0, costPerUnit: 1, pinSort: 2, active: false },
  { itemId: "GORD", name: "Gordon's", unit: "ml", qty: 0, costPerUnit: 0.6 },
];
const SLOTS: HouseSlot[] = [
  { slotId: "S2", name: "House Vodka", itemId: "GORD", sort: 1 },
  { slotId: "S1", name: "House Gin", itemId: "GORD", sort: 0 },
];
const GARNISH: BarGarnish[] = [
  { garnishId: "G1", name: "มะนาว half wheel", itemId: "LIME", qty: 3.5, sort: 0 },
  { garnishId: "G2", name: "มินต์ 3 ใบ", itemId: "MINT", qty: 3, sort: 1 },
];

describe("B24 · ปุ่มลัด 3 กลุ่ม เรียงตามที่จัดเอง", () => {
  const c = quickChips(SLOTS, ITEMS, GARNISH);
  it("House เรียงตาม sort + บอกขวดปัจจุบัน", () => {
    expect(c.house.map((x) => x.label)).toEqual(["House Gin", "House Vodka"]);
    expect(c.house[0].hint).toBe("ตอนนี้: Gordon's (ml)");
  });
  it("ใช้บ่อย = เฉพาะที่ปักหมุดและยังใช้อยู่ เรียงตาม pinSort (ไม่ใช่ตามยอดใช้/ชื่อ)", () => {
    expect(c.pinned.map((x) => x.label)).toEqual(["น้ำเชื่อม", "มะนาว"]);
  });
  it("ตกแต่ง — วัตถุดิบปิดใช้ = ไม่ขึ้นเป็นปุ่ม · hint บอกว่าบวกอะไร", () => {
    expect(c.garnish.map((x) => x.label)).toEqual(["มะนาว half wheel"]);
    expect(c.garnish[0].hint).toBe("+3.5 ml มะนาว");
  });
  it("sort เท่ากัน → ชื่อ → id (ลำดับคงที่ทุกครั้งที่โหลด · D107)", () => {
    const tie = [
      { slotId: "B", name: "X", itemId: "GORD", sort: 0 },
      { slotId: "A", name: "X", itemId: "GORD", sort: 0 },
    ];
    expect(orderedSlots(tie).map((s) => s.slotId)).toEqual(["A", "B"]);
    expect(orderedSlots([...tie].reverse()).map((s) => s.slotId)).toEqual(["A", "B"]);
  });
  it("pinnedItems", () => {
    expect(pinnedItems(ITEMS).map((i) => i.itemId)).toEqual(["SYR", "LIME"]);
  });
});

describe("B24 · applyPick — กดแล้วเพิ่ม/บวก แล้วโฟกัส", () => {
  const two = [blankRecipeRow(), blankRecipeRow()];
  it("House → ใส่แถวว่างแถวแรก ช่องจำนวนว่างรอกรอก", () => {
    expect(applyPick(two, { kind: "slot", slotId: "S1" })).toEqual({
      rows: [{ itemId: "", slotId: "S1", qty: "" }, blankRecipeRow()],
      focus: 0,
    });
  });
  it("กด House ซ้ำ = ไปที่บรรทัดเดิม ไม่สร้างบรรทัดซ้ำ ไม่แตะจำนวน", () => {
    const rows = [{ itemId: "", slotId: "S1", qty: 45 as const }, { itemId: "LIME", qty: 20 as const }];
    expect(applyPick(rows, { kind: "slot", slotId: "S1" })).toEqual({ rows, focus: 0 });
  });
  it("ไม่มีแถวว่าง → ต่อท้าย", () => {
    const rows = [{ itemId: "LIME", qty: 20 as const }];
    expect(applyPick(rows, { kind: "item", itemId: "SYR" })).toEqual({
      rows: [...rows, { itemId: "SYR", qty: "" }],
      focus: 1,
    });
  });
  it("🪤 แถวที่พิมพ์ค้างไว้ (ยังไม่ตรงอะไร) ไม่ใช่แถวว่าง — ไม่เขียนทับ", () => {
    const rows = [{ itemId: "", qty: "" as const, text: "มะนา" }];
    expect(applyPick(rows, { kind: "item", itemId: "SYR" }).focus).toBe(1);
  });
  it("ตกแต่ง → บวกเข้าบรรทัดของวัตถุดิบนั้น", () => {
    const rows = [{ itemId: "LIME", qty: 20 as const }];
    expect(applyPick(rows, { kind: "garnish", itemId: "LIME", qty: 3.5 })).toEqual({
      rows: [{ itemId: "LIME", qty: 23.5 }],
      focus: 0,
    });
  });
  it("ตกแต่ง 2 ครั้ง · ช่องจำนวนว่างนับเป็น 0 · ไม่มีเศษลอยตัว", () => {
    let rows = applyPick([{ itemId: "LIME", qty: "" }], { kind: "garnish", itemId: "LIME", qty: 0.1 }).rows;
    rows = applyPick(rows, { kind: "garnish", itemId: "LIME", qty: 0.2 }).rows;
    expect(rows).toEqual([{ itemId: "LIME", qty: 0.3 }]);
  });
  it("ตกแต่งที่ยังไม่มีบรรทัด → แถวใหม่ด้วยจำนวนของชุด", () => {
    expect(applyPick(two, { kind: "garnish", itemId: "LIME", qty: 3.5 }).rows[0]).toEqual({ itemId: "LIME", qty: 3.5 });
  });
  it("🪤 บรรทัดที่อ้างช่องซึ่งชี้ขวดเดียวกัน ไม่ใช่บรรทัดเดียวกับขวดตรง", () => {
    const rows = [{ itemId: "", slotId: "S1", qty: 45 as const }];
    expect(applyPick(rows, { kind: "item", itemId: "GORD" }).focus).toBe(1);
  });
});

describe("B24 · รวมบรรทัดซ้ำตอนบันทึก (🐛 เดิมชน PK แล้วขึ้น 'มีข้อมูลนี้อยู่แล้ว')", () => {
  const rows = [
    { itemId: "LIME", qty: 20 as const },
    { itemId: "", slotId: "S1", qty: 45 as const },
    { itemId: "LIME", qty: 3.5 as const },
    { itemId: "SYR", qty: "" as const },
  ];
  it("cleanRecipe รวมยอด คงลำดับแถวแรกที่เจอ", () => {
    expect(cleanRecipe(rows)).toEqual([{ itemId: "LIME", qty: 23.5 }, { slotId: "S1", qty: 45 }]);
  });
  it("duplicateRows บอกจำนวนแถวที่จะถูกรวม · danglingRows นับแถวช่องด้วย", () => {
    expect(duplicateRows(rows)).toBe(1);
    expect(danglingRows(rows)).toBe(1);
    expect(danglingRows([{ itemId: "", slotId: "S1", qty: "" }])).toBe(1);
  });
  it("draftFromRecipe → cleanRecipe ไปกลับได้ค่าเดิม", () => {
    const rec = [{ slotId: "S1", qty: 45 }, { itemId: "LIME", qty: 20 }];
    expect(cleanRecipe(draftFromRecipe(rec))).toEqual(rec);
  });
});

describe("B24 · ตั้งค่าชุดตกแต่ง / ใช้บ่อย", () => {
  it("garnishEditsError", () => {
    const ok = { garnishId: null, name: "มะนาว", itemId: "LIME", qty: 3.5 as number | "" };
    expect(garnishEditsError([ok], ITEMS)).toBe("");
    expect(garnishEditsError([{ ...ok, name: "" }], ITEMS)).toContain("ตั้งชื่อ");
    expect(garnishEditsError([ok, { ...ok, name: " มะนาว " }], ITEMS)).toContain("ซ้ำ");
    expect(garnishEditsError([{ ...ok, itemId: "" }], ITEMS)).toContain("เลือกวัตถุดิบ");
    expect(garnishEditsError([{ ...ok, qty: "" }], ITEMS)).toContain("มากกว่า 0");
    expect(garnishEditsError([{ ...ok, qty: 0 }], ITEMS)).toContain("มากกว่า 0");
  });
  it("garnishWarning — ปิดใช้ต้องบอกว่าทำไมไม่ขึ้นเป็นปุ่ม", () => {
    expect(garnishWarning({ itemId: "MINT" }, ITEMS)).toContain("ไม่ขึ้นเป็นปุ่ม");
    expect(garnishWarning({ itemId: "LIME" }, ITEMS)).toBeNull();
  });
  it("pinPlan เขียน 0,1,2 ตามลำดับ · ถอดหมุด = null · ไม่เขียนแถวที่ไม่เปลี่ยน", () => {
    expect(pinPlan(["SYR", "LIME", "MINT"], ITEMS)).toEqual([]);
    expect(pinPlan(["LIME", "SODA"], ITEMS)).toEqual([
      { itemId: "LIME", pinSort: 0 },
      { itemId: "SYR", pinSort: null },
      { itemId: "SODA", pinSort: 1 },
      { itemId: "MINT", pinSort: null },
    ]);
  });
});

describe("B24 · moveAt", () => {
  it("เลื่อนขึ้น/ลง · ขอบลิสต์ไม่ขยับ · ไม่แก้ลิสต์เดิม", () => {
    const xs = ["a", "b", "c"];
    expect(moveAt(xs, 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveAt(xs, 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveAt(xs, 0, -1)).toEqual(xs);
    expect(moveAt(xs, 2, 1)).toEqual(xs);
    expect(xs).toEqual(["a", "b", "c"]);
  });
});
