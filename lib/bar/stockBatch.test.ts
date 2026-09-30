import { describe, it, expect } from "vitest";
import type { BarItem } from "./types";
import {
  planReceive, planAdjust, planNewItems, countAllDrafts, errorsText,
  blankReceive, blankAdjust, blankNewItem,
} from "./stockBatch";

const items = [
  { itemId: "I-GIN", name: "จิน", unit: "ml", qty: 1400, costPerUnit: 0.5, packSize: 700, packLabel: "ขวด", lowQty: null, active: true },
  { itemId: "I-LIME", name: "มะนาว", unit: "ลูก", qty: 10, costPerUnit: 3, packSize: null, packLabel: null, lowQty: null, active: true },
  { itemId: "I-OLD", name: "เหล้าเก่า", unit: "ml", qty: 0, costPerUnit: 0, packSize: null, packLabel: null, lowQty: null, active: false },
] as unknown as BarItem[];

describe("planReceive — B17 รับของหลายแถว", () => {
  it("แปลงหน่วยซื้อเป็นหน่วยฐานต่อแถว", () => {
    const r = planReceive(
      [
        { itemId: "I-GIN", qtyPack: 3, costTotal: 1500 },
        { itemId: "I-LIME", qtyPack: 20, costTotal: 60 },
      ],
      items,
    );
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { row: 1, itemId: "I-GIN", qtyPack: 3, qty: 2100, costTotal: 1500 },
      { row: 2, itemId: "I-LIME", qtyPack: 20, qty: 20, costTotal: 60 },
    ]);
  });
  it("แถวว่างทั้งแถว = ข้ามเงียบ", () => {
    const r = planReceive([{ itemId: "I-GIN", qtyPack: 1, costTotal: 500 }, blankReceive(), blankReceive()], items);
    expect(r.rows).toHaveLength(1);
    expect(r.skipped).toBe(2);
    expect(r.errors).toEqual([]);
  });
  it("🚨 กรอกครึ่งแถว = error พร้อมเลขแถว ไม่ใช่ข้ามเงียบ", () => {
    const r = planReceive([{ itemId: "I-GIN", qtyPack: 1, costTotal: 1 }, { itemId: "", qtyPack: 2, costTotal: "" }], items);
    expect(r.errors).toEqual([{ row: 2, text: "ยังไม่ได้เลือกวัตถุดิบ" }]);
  });
  it("จำนวนว่าง/0 = error", () => {
    expect(planReceive([{ itemId: "I-GIN", qtyPack: "", costTotal: 100 }], items).errors).toHaveLength(1);
    expect(planReceive([{ itemId: "I-GIN", qtyPack: 0, costTotal: 100 }], items).errors).toHaveLength(1);
  });
  it("ราคาว่าง = 0 (ของฟรี ตามพฤติกรรมเดิม)", () => {
    expect(planReceive([{ itemId: "I-LIME", qtyPack: 5, costTotal: "" }], items).rows[0].costTotal).toBe(0);
  });
  it("ราคาติดลบ = error", () => {
    expect(planReceive([{ itemId: "I-LIME", qtyPack: 5, costTotal: -1 }], items).errors).toHaveLength(1);
  });
  it("🚨 วัตถุดิบซ้ำในชุดเดียว = error (กันรับเข้าสองเท่า)", () => {
    const r = planReceive([{ itemId: "I-GIN", qtyPack: 1, costTotal: 1 }, { itemId: "I-GIN", qtyPack: 1, costTotal: 1 }], items);
    expect(r.errors[0].row).toBe(2);
  });
});

describe("planAdjust — B17 ปรับยอดหลายแถว", () => {
  it("ส่งเฉพาะแถวที่ยอดเปลี่ยน · นับตัวที่เท่าเดิม", () => {
    const r = planAdjust(
      [
        { itemId: "I-GIN", qtyAfter: 1400, reason: "ปรับยอด", note: "" },
        { itemId: "I-LIME", qtyAfter: 7, reason: "เสียหาย", note: " เน่า " },
      ],
      items,
    );
    expect(r.errors).toEqual([]);
    expect(r.same).toBe(1);
    expect(r.rows).toEqual([{ row: 2, itemId: "I-LIME", qtyAfter: 7, reason: "เสียหาย", note: "เน่า" }]);
  });
  it("★ 0 คือยอดจริง (นับแล้วหมด) ไม่ใช่ว่าง", () => {
    expect(planAdjust([{ itemId: "I-LIME", qtyAfter: 0, reason: "ปรับยอด", note: "" }], items).rows[0].qtyAfter).toBe(0);
  });
  it("เลือกวัตถุดิบแต่ยอดว่าง = error", () => {
    expect(planAdjust([{ itemId: "I-LIME", qtyAfter: "", reason: "ปรับยอด", note: "" }], items).errors).toHaveLength(1);
  });
  it("แถวว่าง = ข้าม", () => {
    expect(planAdjust([blankAdjust()], items)).toMatchObject({ rows: [], errors: [], skipped: 1 });
  });
  it("🚨 ตัวเดียวกัน 2 แถว = error", () => {
    const r = planAdjust(
      [
        { itemId: "I-LIME", qtyAfter: 5, reason: "ปรับยอด", note: "" },
        { itemId: "I-LIME", qtyAfter: 4, reason: "เสียหาย", note: "" },
      ],
      items,
    );
    expect(r.errors[0].row).toBe(2);
  });
  it("เหตุผลนอกชุดปิด = error (ตรงกับ CHECK ใน fn_bar_adjust)", () => {
    expect(planAdjust([{ itemId: "I-LIME", qtyAfter: 5, reason: "ขโมย", note: "" }], items).errors).toHaveLength(1);
  });
});

describe("countAllDrafts — นับทั้งร้าน", () => {
  it("เติมเฉพาะที่ยังใช้อยู่ ด้วยยอดปัจจุบัน ⇒ ไม่แตะอะไร = ไม่มีอะไรถูกส่ง", () => {
    const d = countAllDrafts(items);
    expect(d.map((x) => x.itemId)).toEqual(["I-GIN", "I-LIME"]);
    const r = planAdjust(d, items);
    expect(r.rows).toEqual([]);
    expect(r.same).toBe(2);
  });
});

describe("planNewItems — B17 เพิ่มวัตถุดิบหลายแถว", () => {
  it("แถวที่มีแค่หน่วยปริยาย = ว่าง", () => {
    expect(planNewItems([blankNewItem()], items)).toMatchObject({ rows: [], skipped: 1 });
  });
  it("แปลงช่องว่าง/0 เป็น null", () => {
    const r = planNewItems([{ name: " วอดก้า ", unit: "ml", packSize: 750, packLabel: "", lowQty: 0 }], items);
    expect(r.rows).toEqual([{ name: "วอดก้า", unit: "ml", packSize: 750, packLabel: null, lowQty: null }]);
  });
  it("🚨 ชื่อซ้ำของเดิม (ไม่สนตัวพิมพ์/ช่องว่าง) = error", () => {
    expect(planNewItems([{ ...blankNewItem(), name: " จิน " }], items).errors).toHaveLength(1);
  });
  it("ชื่อซ้ำในชุดเดียว = error", () => {
    const r = planNewItems([{ ...blankNewItem(), name: "โซดา" }, { ...blankNewItem(), name: "โซดา" }], items);
    expect(r.errors[0].row).toBe(2);
  });
  it("กรอกขนาดแต่ไม่ตั้งชื่อ = error ไม่ใช่ข้าม", () => {
    expect(planNewItems([{ ...blankNewItem(), packSize: 700 }], items).errors).toEqual([{ row: 1, text: "ยังไม่ได้ตั้งชื่อ" }]);
  });
  it("ไม่มีหน่วย = error", () => {
    expect(planNewItems([{ ...blankNewItem(), name: "น้ำแข็ง", unit: " " }], items).errors).toHaveLength(1);
  });
});

it("errorsText บอกเลขแถวเสมอ", () => {
  expect(errorsText([{ row: 3, text: "x" }, { row: 5, text: "y" }])).toBe("แถว 3: x · แถว 5: y");
});
