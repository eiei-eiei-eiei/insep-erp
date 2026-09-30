import { describe, it, expect } from "vitest";
import type { BarItem } from "./types";
import type { BarMenu } from "./types";
import {
  planReceive, planNewItems, errorsText, blankReceive, blankNewItem,
  toBase, unitLabel, countItems, countDrafts, countPreview, planCount,
  lowToDraft, lowToBase, editDrafts, recipeUseCount, unitLockReason, planItemEdits,
  type CountDraft,
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

describe("toBase / unitLabel — B17 กรอกเป็นหน่วยซื้อหรือหน่วยฐาน (D104)", () => {
  it("หน่วยซื้อ × packSize", () => expect(toBase(12, "pack", 25)).toBe(300));
  it("🪤 ปัดเศษทศนิยมของ JS (2.4 × 700)", () => expect(toBase(2.4, "pack", 700)).toBe(1680));
  it("หน่วยฐาน = ค่าเดิม", () => expect(toBase(300, "base", 25)).toBe(300));
  it("ไม่มี packSize = เลือก pack ก็ไม่มีผล (ไม่เดา)", () => {
    expect(toBase(5, "pack", null)).toBe(5);
    expect(toBase(5, "pack", 0)).toBe(5);
  });
  it("ป้ายหน่วยซื้อตัดวงเล็บทิ้ง", () => {
    expect(unitLabel({ unit: "ml", packLabel: "ขวด (700 ml)" }, "pack")).toBe("ขวด");
    expect(unitLabel({ unit: "ml", packLabel: null }, "pack")).toBe("หน่วยซื้อ");
    expect(unitLabel({ unit: "ml", packLabel: "ขวด" }, "base")).toBe("ml");
  });
});

describe("planCount — B17 นับสต็อกทั้งร้าน (D104)", () => {
  const drafts = (): CountDraft[] => countDrafts(items);
  const at = (d: CountDraft[], id: string) => d.find((x) => x.itemId === id)!;

  it("แสดงตัวที่ใช้อยู่ครบ · ตัวที่เลิกใช้โผล่เฉพาะเมื่อยังมียอดค้าง", () => {
    expect(countItems(items).map((i) => i.itemId)).toEqual(["I-GIN", "I-LIME"]);
    const withLeftover = [...items.slice(0, 2), { ...items[2], qty: 50 }] as BarItem[];
    expect(countItems(withLeftover).map((i) => i.itemId)).toEqual(["I-GIN", "I-LIME", "I-OLD"]);
  });
  it("ช่องเริ่มว่าง · หน่วยปริยาย = หน่วยซื้อเมื่อตั้งไว้", () => {
    expect(drafts().map((d) => [d.value, d.unit])).toEqual([["", "pack"], ["", "base"]]);
  });
  it("★ ไม่กรอกเลยสักช่อง = ไม่มีอะไรถูกส่ง (ใช้ค่าในระบบ)", () => {
    expect(planCount(drafts(), items)).toMatchObject({ rows: [], errors: [], skipped: 2, same: 0 });
  });
  it("กรอกเป็นขวด → แปลงเป็น ml", () => {
    const d = drafts();
    at(d, "I-GIN").value = 1.5;
    expect(planCount(d, items).rows).toEqual([{ row: 1, itemId: "I-GIN", qtyAfter: 1050, reason: "ปรับยอด", note: "" }]);
  });
  it("สลับเป็นหน่วยฐานแล้วกรอก ml ตรง ๆ", () => {
    const d = drafts();
    Object.assign(at(d, "I-GIN"), { value: 1000, unit: "base" });
    expect(planCount(d, items).rows[0].qtyAfter).toBe(1000);
  });
  it("ยอดเท่าในระบบ (ขวด 2 = 1,400 ml) = ข้าม นับเป็น same", () => {
    const d = drafts();
    at(d, "I-GIN").value = 2;
    expect(planCount(d, items)).toMatchObject({ rows: [], same: 1 });
  });
  it("★ 0 = นับแล้วหมด ไม่ใช่ว่าง", () => {
    const d = drafts();
    at(d, "I-LIME").value = 0;
    expect(planCount(d, items).rows).toEqual([{ row: 2, itemId: "I-LIME", qtyAfter: 0, reason: "ปรับยอด", note: "" }]);
  });
  it("🚨 ใส่เหตุผล/หมายเหตุแต่ไม่กรอกยอด = error ไม่ข้ามเงียบ", () => {
    const d = drafts();
    at(d, "I-LIME").reason = "เสียหาย";
    expect(planCount(d, items).errors).toEqual([{ row: 2, text: "มะนาว: ใส่เหตุผล/หมายเหตุไว้แต่ยังไม่ได้กรอกยอดที่นับได้" }]);
    const d2 = drafts();
    at(d2, "I-GIN").note = "ขวดแตก";
    expect(planCount(d2, items).errors[0].row).toBe(1);
  });
  it("ติดลบ = error", () => {
    const d = drafts();
    at(d, "I-LIME").value = -1;
    expect(planCount(d, items).errors).toHaveLength(1);
  });
  it("countPreview บอกค่าหลังแปลงและส่วนต่าง", () => {
    const d = drafts();
    at(d, "I-GIN").value = 1.5;
    expect(countPreview(at(d, "I-GIN"), items[0])).toEqual({ after: 1050, diff: -350 });
    expect(countPreview(at(d, "I-LIME"), items[1])).toBeNull();
  });
});

describe("lowToDraft / lowToBase — ค่าเตือนกรอกเป็นหน่วยซื้อได้ (D104)", () => {
  it("หารลงตัว → แสดงเป็นหน่วยซื้อ", () => expect(lowToDraft(250, 25)).toEqual({ lowQty: 10, lowUnit: "pack" }));
  it("🪤 หารไม่ลงตัว (100 ml ของขวด 700) → คงเป็นหน่วยฐาน", () =>
    expect(lowToDraft(100, 700)).toEqual({ lowQty: 100, lowUnit: "base" }));
  it("ยังไม่ตั้ง → ว่าง หน่วยปริยาย", () => {
    expect(lowToDraft(null, 25)).toEqual({ lowQty: "", lowUnit: "pack" });
    expect(lowToDraft(null, null)).toEqual({ lowQty: "", lowUnit: "base" });
  });
  it("แปลงกลับ · ว่าง/0 = ไม่เตือน (null)", () => {
    expect(lowToBase(10, "pack", 25)).toBe(250);
    expect(lowToBase("", "pack", 25)).toBeNull();
    expect(lowToBase(0, "base", 25)).toBeNull();
  });
});

describe("planItemEdits — B17 แก้ทุกรายการแล้วบันทึกทีเดียว (D104)", () => {
  const none = new Map<string, number>();
  it("ไม่แก้อะไร = ไม่มีอะไรถูกส่ง (รวมค่าเตือนที่แปลงไป-กลับ)", () => {
    const withLow = [{ ...items[0], lowQty: 100 }, { ...items[1], lowQty: 5 }, items[2]] as BarItem[];
    expect(planItemEdits(editDrafts(withLow), withLow, none)).toEqual({ rows: [], errors: [] });
  });
  it("ตั้งค่าเตือนมะนาว 3 ลูก → เก็บ 3 · จิน 1 ขวด → 700 ml · ส่งเฉพาะ 2 แถวนั้น", () => {
    const d = editDrafts(items);
    Object.assign(d[0], { lowQty: 1, lowUnit: "pack" });
    Object.assign(d[1], { lowQty: 3 });
    const r = planItemEdits(d, items, none);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.itemId, x.lowQty])).toEqual([["I-GIN", 700], ["I-LIME", 3]]);
  });
  it("🚨 ชื่อชนกับตัวอื่นหลังแก้ = error · สลับชื่อกันได้", () => {
    const d = editDrafts(items);
    d[1].name = "จิน";
    expect(planItemEdits(d, items, none).errors[0].text).toContain("ซ้ำ");
    const swap = editDrafts(items);
    swap[0].name = "มะนาว";
    swap[1].name = "จิน";
    expect(planItemEdits(swap, items, none).errors).toEqual([]);
  });
  it("🪤 ฟ้องเฉพาะแถวที่เปลี่ยนชื่อ ไม่ฟ้องแถวที่ไม่ได้แตะ", () => {
    const d = editDrafts(items);
    d[1].name = "จิน";
    expect(planItemEdits(d, items, none).errors.map((e) => e.row)).toEqual([2]);
  });
  it("🪤 ข้อมูลเก่ามีชื่อซ้ำกันอยู่แล้ว → ยังแก้ช่องอื่นได้ (ไม่ล็อกทั้งตาราง)", () => {
    const legacy = [items[0], { ...items[1], name: "จิน" }] as BarItem[];
    const d = editDrafts(legacy);
    d[1].lowQty = 3;
    const r = planItemEdits(d, legacy, none);
    expect(r.errors).toEqual([]);
    expect(r.rows).toMatchObject([{ itemId: "I-LIME", lowQty: 3 }]);
  });
  it("🚨 เปลี่ยนหน่วยของตัวที่มียอด = error พร้อมบอกทางไปต่อ", () => {
    const d = editDrafts(items);
    d[0].unit = "ขวด";
    expect(planItemEdits(d, items, none).errors[0].text).toContain("นับสต็อกให้เป็น 0 ก่อน");
  });
  it("🚨 เปลี่ยนหน่วยของตัวที่ยอด 0 แต่อยู่ในสูตร = error", () => {
    const d = editDrafts(items);
    d[2].unit = "g";
    const used = new Map([["I-OLD", 2]]);
    expect(planItemEdits(d, items, used).errors[0].text).toContain("สูตร 2 เมนู");
  });
  it("ยอด 0 และไม่มีสูตร → เปลี่ยนหน่วยได้", () => {
    const d = editDrafts(items);
    d[2].unit = "g";
    expect(planItemEdits(d, items, none).rows).toMatchObject([{ itemId: "I-OLD", unit: "g" }]);
  });
  it("เปิดกลับมาใช้ = ส่งแถวนั้น", () => {
    const d = editDrafts(items);
    d[2].active = true;
    expect(planItemEdits(d, items, none).rows).toMatchObject([{ itemId: "I-OLD", active: true }]);
  });
  it("unitLockReason / recipeUseCount", () => {
    expect(unitLockReason({ qty: 0, unit: "ml" }, 0)).toBeNull();
    const menus = [
      { recipe: [{ itemId: "I-GIN", qty: 45 }] },
      { recipe: [{ itemId: "I-GIN", qty: 30 }, { itemId: "I-LIME", qty: 1 }] },
    ] as unknown as BarMenu[];
    expect([...recipeUseCount(menus)]).toEqual([["I-GIN", 2], ["I-LIME", 1]]);
  });
});

describe("planNewItems — B17 เพิ่มวัตถุดิบหลายแถว", () => {
  it("แถวที่มีแค่หน่วยปริยาย = ว่าง", () => {
    expect(planNewItems([blankNewItem()], items)).toMatchObject({ rows: [], skipped: 1 });
  });
  it("แปลงช่องว่าง/0 เป็น null", () => {
    const r = planNewItems([{ name: " วอดก้า ", unit: "ml", packSize: 750, packLabel: "", lowQty: 0, lowUnit: "pack" }], items);
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

describe("planNewItems — ค่าเตือนเป็นหน่วยซื้อ (D104)", () => {
  it("10 ลูก × 25 ml = 250", () => {
    const r = planNewItems([{ ...blankNewItem(), name: "เลม่อน", packSize: 25, lowQty: 10, lowUnit: "pack" }], items);
    expect(r.rows[0].lowQty).toBe(250);
  });
});
