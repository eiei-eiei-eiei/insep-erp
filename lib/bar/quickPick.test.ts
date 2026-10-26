import { describe, it, expect } from "vitest";
import {
  quickChips, applyPick, pinnedItems, garnishEditsError, garnishWarning, pinPlan, orderedSlots, moveAt,
  garnishDraftOf, garnishPickItem, garnishTypeQty, garnishQtyHint, garnishPayload, type GarnishDraft,
} from "./quickPick";
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
  { garnishId: "G3", name: "ใบมิ้นต์กระถาง", itemId: null, qty: null, sort: 2 },
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
  it("ตกแต่ง — วัตถุดิบปิดใช้ = ไม่ขึ้นเป็นปุ่ม · ชุดไม่ตัดสต็อกขึ้นเสมอ · hint บอกว่า 1 ชุดตัดอะไร (D131)", () => {
    expect(c.garnish.map((x) => x.label)).toEqual(["มะนาว half wheel", "ใบมิ้นต์กระถาง"]);
    expect(c.garnish[0].hint).toBe("+1 ชุด · มะนาว 3.5 ml");
    expect(c.garnish[1].hint).toBe("+1 ชุด · ไม่ตัดสต็อก");
    expect(c.garnish[0].pick).toEqual({ kind: "garnish", garnishId: "G1" });
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
  it("D131 ตกแต่ง → บรรทัดของชุด 1 ชุด (ไม่บวกเข้าบรรทัดวัตถุดิบตัวเดียวกัน)", () => {
    const rows = [{ itemId: "LIME", qty: 20 as const }];
    expect(applyPick(rows, { kind: "garnish", garnishId: "G1" })).toEqual({
      rows: [{ itemId: "LIME", qty: 20 }, { itemId: "", garnishId: "G1", qty: 1 }],
      focus: 1,
    });
  });
  it("D131 กดชุดเดิมซ้ำ = +1 ชุด · ช่องจำนวนว่างนับเป็น 0", () => {
    let rows = applyPick([{ itemId: "", garnishId: "G1", qty: "" }], { kind: "garnish", garnishId: "G1" }).rows;
    expect(rows).toEqual([{ itemId: "", garnishId: "G1", qty: 1 }]);
    rows = applyPick(rows, { kind: "garnish", garnishId: "G1" }).rows;
    expect(rows).toEqual([{ itemId: "", garnishId: "G1", qty: 2 }]);
  });
  it("ตกแต่งที่ยังไม่มีบรรทัด → ใส่แถวว่างแถวแรก", () => {
    expect(applyPick(two, { kind: "garnish", garnishId: "G1" }).rows[0]).toEqual({ itemId: "", garnishId: "G1", qty: 1 });
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
  const MENUS = [
    { name: "Mojito", recipe: [{ garnishId: "G1", qty: 1 }] },
    { name: "Gimlet", recipe: [{ garnishId: "G1", qty: 2 }] },
  ];
  it("garnishEditsError (D131)", () => {
    const ok: GarnishDraft = { garnishId: null, name: "มะนาว", itemId: "LIME", qtyText: "1/7", qtyUnit: "ml" };
    expect(garnishEditsError([ok], ITEMS, [], [])).toBe("");
    expect(garnishEditsError([{ ...ok, name: "" }], ITEMS, [], [])).toContain("ตั้งชื่อ");
    expect(garnishEditsError([ok, { ...ok, name: " มะนาว " }], ITEMS, [], [])).toContain("ซ้ำ");
    // ไม่ตัดสต็อก = ไม่ต้องมีจำนวน
    expect(garnishEditsError([{ ...ok, itemId: "", qtyText: "", qtyUnit: null }], ITEMS, [], [])).toBe("");
    expect(garnishEditsError([{ ...ok, qtyText: "" }], ITEMS, [], [])).toContain("มากกว่า 0");
    expect(garnishEditsError([{ ...ok, qtyText: "0" }], ITEMS, [], [])).toContain("มากกว่า 0");
    expect(garnishEditsError([{ ...ok, qtyText: "1/0" }], ITEMS, [], [])).toContain("มากกว่า 0");
    // จำนวนที่พิมพ์ไว้สำหรับหน่วยอื่น
    expect(garnishEditsError([{ ...ok, qtyUnit: "ลูก" }], ITEMS, [], [])).toContain("หน่วย ml");
  });
  it("ลบชุดที่มีเมนูอ้าง = บล็อก + บอกรายชื่อเมนู · ไม่มีใครใช้ = ลบได้", () => {
    const err = garnishEditsError([], ITEMS, GARNISH.slice(0, 1), MENUS);
    expect(err).toContain("ลบชุด มะนาว half wheel ไม่ได้");
    expect(err).toContain("2 เมนู: Gimlet · Mojito");
    expect(garnishEditsError([], ITEMS, GARNISH.slice(1, 2), MENUS)).toBe("");
  });
  it("ชุดที่ถูกลบจากอีกเครื่อง → บอกให้รีเฟรช", () => {
    const d = garnishDraftOf(GARNISH[0], ITEMS);
    expect(garnishEditsError([d], ITEMS, [], [])).toContain("รีเฟรช");
  });
  it("garnishDraftOf / garnishPayload ไปกลับ — เก็บข้อความเฉพาะเศษส่วน", () => {
    const g: BarGarnish = { garnishId: "G9", name: "Lime Wheel", itemId: "LIME", qty: 1 / 7, qtyText: "1/7", sort: 0 };
    const d = garnishDraftOf(g, ITEMS);
    expect(d).toEqual({ garnishId: "G9", name: "Lime Wheel", itemId: "LIME", qtyText: "1/7", qtyUnit: "ml" });
    expect(garnishPayload(d)).toEqual({ garnish_id: "G9", name: "Lime Wheel", item_id: "LIME", qty: 1 / 7, qty_text: "1/7", qty_unit: "ml" });
    expect(garnishPayload({ ...d, qtyText: "0.5" })).toMatchObject({ qty: 0.5, qty_text: null });
    expect(garnishPayload(garnishDraftOf(GARNISH[2], ITEMS))).toEqual({
      garnish_id: "G3", name: "ใบมิ้นต์กระถาง", item_id: null, qty: null, qty_text: null, qty_unit: null,
    });
  });
  it("เปลี่ยนวัตถุดิบเป็นหน่วยอื่นขณะมีเมนูใช้ → ล้างช่องจำนวน + เหลืองบอกให้ใส่ใหม่ + บันทึกไม่ได้", () => {
    const d = garnishDraftOf(GARNISH[0], ITEMS); // มะนาว ml 3.5
    const moved = garnishPickItem(d, "MINT", ITEMS, 2); // มินต์ หน่วย ใบ
    expect(moved).toMatchObject({ itemId: "MINT", qtyText: "", qtyUnit: null });
    expect(garnishQtyHint(moved, ITEMS)).toContain("เป็น ใบ");
    // บอกด้วยว่าทำไมช่องว่าง (เปลี่ยนหน่วย) และจำนวนเดิมคืออะไร
    expect(garnishQtyHint(moved, ITEMS, GARNISH[0])).toBe(
      "วัตถุดิบเปลี่ยนจากหน่วย ml เป็น ใบ — จำนวนเดิม (3.5 ml) ใช้ไม่ได้แล้ว ใส่จำนวนต่อ 1 ชุดใหม่เป็น ใบ",
    );
    expect(garnishEditsError([moved], ITEMS, GARNISH, [])).toContain("มากกว่า 0");
    const typed = garnishTypeQty(moved, "1", ITEMS);
    expect(typed.qtyUnit).toBe("ใบ");
    expect(garnishEditsError([typed], ITEMS, GARNISH, [])).toBe("");
  });
  it("ยังไม่มีเมนูใช้ หรือหน่วยเดิม → คงจำนวนไว้ · เลือกไม่ตัดสต็อก → ล้างจำนวน", () => {
    const d = garnishDraftOf(GARNISH[0], ITEMS);
    expect(garnishPickItem(d, "MINT", ITEMS, 0)).toMatchObject({ itemId: "MINT", qtyText: "3.5", qtyUnit: "ใบ" });
    expect(garnishPickItem(d, "SYR", ITEMS, 5)).toMatchObject({ itemId: "SYR", qtyText: "3.5", qtyUnit: "ml" });
    expect(garnishPickItem(d, "", ITEMS, 5)).toMatchObject({ itemId: "", qtyText: "", qtyUnit: null });
    expect(garnishQtyHint({ ...d, qtyText: "abc" }, ITEMS)).toContain("เศษส่วน");
    expect(garnishQtyHint(d, ITEMS)).toBeNull();
  });
  it("garnishWarning — ปิดใช้ต้องบอกว่าทำไมไม่ขึ้นเป็นปุ่ม และว่าเมนูยังตัดต่อ · ไม่ตัดสต็อก = ไม่เตือน", () => {
    expect(garnishWarning({ itemId: "MINT" }, ITEMS)).toContain("ไม่ขึ้นเป็นปุ่ม");
    expect(garnishWarning({ itemId: "MINT" }, ITEMS)).toContain("ยังตัด มินต์ ต่อ");
    expect(garnishWarning({ itemId: "LIME" }, ITEMS)).toBeNull();
    expect(garnishWarning({ itemId: null }, ITEMS)).toBeNull();
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
