import { describe, it, expect } from "vitest";
import {
  scaleInputs,
  scaledYield,
  prepRecipeText,
  batchPreview,
  batchPerUnit,
  lastFinished,
  perUnitChange,
  soakDays,
  batchesOf,
  soakingBatches,
  cancelBlock,
  cancelConfirmText,
  prepEditError,
  batchError,
  type PrepDef,
  type PrepBatch,
} from "./prep";
import type { BarItem } from "./types";

/** golden **B27** — ของทำเองในร้าน (D130) */

const ITEMS: BarItem[] = [
  { itemId: "SUGAR", name: "น้ำตาล", unit: "g", qty: 5000, costPerUnit: 0.03 },
  { itemId: "WATER", name: "น้ำ", unit: "ml", qty: 9999, costPerUnit: 0 },
  { itemId: "PUMP", name: "ฟักทอง", unit: "g", qty: 2000, costPerUnit: 0.05 },
  { itemId: "SYR", name: "ไซรัปฟักทอง", unit: "ml", qty: 200, costPerUnit: 0.04 },
];
const DEF: PrepDef = {
  itemId: "SYR",
  stdYield: 800,
  note: null,
  inputs: [
    { itemId: "PUMP", qty: 300, lineNo: 3 },
    { itemId: "SUGAR", qty: 500, lineNo: 1 },
    { itemId: "WATER", qty: 500, lineNo: 2 },
  ],
};
const batch = (p: Partial<PrepBatch>): PrepBatch => ({
  batchId: "PB0001", itemId: "SYR", status: "เสร็จแล้ว", multiplier: 1, startedAt: "2026-10-20T10:00:00Z",
  startDate: "2026-10-20", finishDate: "2026-10-20", yieldQty: 800, costTotal: 30, note: null, latest: false, lines: [], ...p,
});

describe("B27 · สูตรมาตรฐาน × จำนวนล็อต", () => {
  it("เรียงตามบรรทัด · ทำทีละน้อย 0.3 ล็อต ไม่มีเศษลอยตัว", () => {
    expect(scaleInputs(DEF, 0.3)).toEqual([
      { itemId: "SUGAR", qty: 150 },
      { itemId: "WATER", qty: 150 },
      { itemId: "PUMP", qty: 90 },
    ]);
    expect(scaledYield(DEF, 0.3)).toBe(240);
    expect(scaledYield(DEF, 2)).toBe(1600);
  });
  it("ข้อความสูตร", () => {
    expect(prepRecipeText(DEF, ITEMS, "ml")).toBe("น้ำตาล 500 g · น้ำ 500 ml · ฟักทอง 300 g → ได้ 800 ml");
  });
});

describe("B27 · พรีวิวทุน", () => {
  const rows = scaleInputs(DEF, 1);
  it("🚨 ทุนต่อหน่วย = ทุนที่ใช้จริง ÷ ปริมาณที่ได้จริง (งวดเหลือ 700 → แพงขึ้น)", () => {
    // 500×0.03 + 0 + 300×0.05 = 30
    expect(batchPreview(rows, ITEMS, 800, undefined)).toMatchObject({ cost: 30, perUnit: 0.0375 });
    expect(batchPreview(rows, ITEMS, 700, undefined).perUnit).toBe(0.0429);
  });
  it("ยังไม่ใส่ปริมาณที่ได้ = ทุนต่อหน่วยยังคิดไม่ได้ (null ไม่ใช่ 0)", () => {
    expect(batchPreview(rows, ITEMS, "", undefined)).toMatchObject({ cost: 30, perUnit: null, newAvg: null });
  });
  it("ทุนเฉลี่ยใหม่ถัวกับของเดิม — สูตรเดียวกับรับของ (B3)", () => {
    // (200×0.04 + 30) / (200 + 800) = 0.038
    expect(batchPreview(rows, ITEMS, 800, ITEMS[3]).newAvg).toBe(0.038);
  });
  it("วัตถุดิบที่ไม่มีทุน (น้ำ) นับใน missing ให้หน้าจอเตือน", () => {
    expect(batchPreview(rows, ITEMS, 800, undefined).missing).toBe(1);
  });
});

describe("B27 · ประวัติล็อต", () => {
  const B = [
    batch({ batchId: "PB0001", startedAt: "2026-10-20T10:00:00Z", costTotal: 30, yieldQty: 800 }),
    batch({ batchId: "PB0002", startedAt: "2026-10-22T10:00:00Z", costTotal: 33, yieldQty: 800 }),
    batch({ batchId: "PB0003", startedAt: "2026-10-24T10:00:00Z", status: "กำลังแช่", yieldQty: null, finishDate: null }),
    batch({ batchId: "PB0004", startedAt: "2026-10-23T10:00:00Z", status: "ยกเลิก" }),
    batch({ batchId: "PB0009", itemId: "OTHER", startedAt: "2026-10-25T10:00:00Z", status: "กำลังแช่", yieldQty: null }),
  ];
  it("ทุนต่อหน่วยของล็อต · ล็อตที่ยังแช่ = null", () => {
    expect(batchPerUnit(B[1])).toBe(0.0413);
    expect(batchPerUnit(B[2])).toBeNull();
  });
  it("ล็อตเสร็จล่าสุด ไม่นับที่แช่อยู่/ยกเลิก", () => {
    expect(lastFinished("SYR", B)?.batchId).toBe("PB0002");
    expect(lastFinished("NONE", B)).toBeUndefined();
  });
  it("% เทียบล็อตก่อน · ไม่มีล็อตก่อน = null", () => {
    expect(perUnitChange(0.0413, 0.0375)).toBe(10.1);
    expect(perUnitChange(0.04, null)).toBeNull();
    expect(perUnitChange(null, 0.04)).toBeNull();
  });
  it("เรียงใหม่สุดก่อน · กำลังแช่ทั้งร้านเรียงเก่าสุดก่อน", () => {
    expect(batchesOf("SYR", B).map((b) => b.batchId)).toEqual(["PB0003", "PB0004", "PB0002", "PB0001"]);
    expect(soakingBatches(B).map((b) => b.batchId)).toEqual(["PB0003", "PB0009"]);
  });
  it("แช่มาแล้วกี่วัน (วันเต็ม)", () => {
    expect(soakDays("2026-10-24T10:00:00Z", Date.parse("2026-10-26T09:00:00Z"))).toBe(1);
    expect(soakDays("2026-10-24T10:00:00Z", Date.parse("2026-10-26T10:00:00Z"))).toBe(2);
    expect(soakDays("2026-10-24T10:00:00Z", Date.parse("2026-10-24T09:00:00Z"))).toBe(0);
  });
});

describe("B27 · ยกเลิกล็อต (ต้องตรงกับ fn_bar_prep_cancel)", () => {
  it("กำลังแช่ = ได้เสมอ", () => {
    expect(cancelBlock({ status: "กำลังแช่", latest: false })).toBeNull();
  });
  it("🚨 เสร็จแล้ว = ได้เฉพาะเมื่อเป็นการเคลื่อนไหวล่าสุด", () => {
    expect(cancelBlock({ status: "เสร็จแล้ว", latest: true })).toBeNull();
    expect(cancelBlock({ status: "เสร็จแล้ว", latest: false })).toContain("นับสต็อก");
    expect(cancelBlock({ status: "ยกเลิก", latest: true })).toBe("ยกเลิกไปแล้ว");
  });
  it("ประโยคถามบอกผลให้ตรงกับสถานะ", () => {
    expect(cancelConfirmText({ status: "กำลังแช่", yieldQty: null }, "ml")).toContain("ยังไม่มีของทำเองเข้าสต็อก");
    expect(cancelConfirmText({ status: "เสร็จแล้ว", yieldQty: 800 }, "ml")).toContain("800 ml จะออกจากสต็อก");
  });
});

describe("B27 · ตรวจก่อนบันทึก", () => {
  const base = { itemId: null, name: "ไซรัปใบเตย", unit: "ml", stdYield: 500 as number | "", rows: [{ itemId: "SUGAR", qty: 300 as number | "" }], items: ITEMS };
  it("ผ่าน", () => {
    expect(prepEditError(base)).toBe("");
  });
  it("ชื่อว่าง / ชื่อซ้ำวัตถุดิบอื่น (ไม่สนตัวพิมพ์) / ไม่มีหน่วย / ได้ 0 / ไม่มีวัตถุดิบ", () => {
    expect(prepEditError({ ...base, name: " " })).toContain("ตั้งชื่อ");
    expect(prepEditError({ ...base, name: "น้ำตาล" })).toContain("อยู่แล้ว");
    expect(prepEditError({ ...base, unit: "" })).toContain("หน่วย");
    expect(prepEditError({ ...base, stdYield: 0 })).toContain("มากกว่า 0");
    expect(prepEditError({ ...base, rows: [] })).toContain("อย่างน้อย 1");
  });
  it("🚨 ใช้ตัวเองในสูตรไม่ได้ · แก้ของเดิมชื่อเดิมไม่นับว่าซ้ำ", () => {
    expect(prepEditError({ ...base, itemId: "SYR", name: "ไซรัปฟักทอง", rows: [{ itemId: "SYR", qty: 10 }] })).toContain("ของตัวเอง");
    expect(prepEditError({ ...base, itemId: "SYR", name: "ไซรัปฟักทอง" })).toBe("");
  });
  it("ทำล็อต: ทำเสร็จเลยต้องมีปริมาณที่ได้ · เริ่มแช่ไม่ต้อง", () => {
    const rows = [{ itemId: "SUGAR", qty: 300 as number | "" }];
    expect(batchError({ multiplier: 0.3, rows, yieldQty: "", finishNow: true })).toContain("ปริมาณที่ได้");
    expect(batchError({ multiplier: 0.3, rows, yieldQty: "", finishNow: false })).toBe("");
    expect(batchError({ multiplier: "", rows, yieldQty: 100, finishNow: true })).toContain("0.3");
    expect(batchError({ multiplier: 1, rows: [], yieldQty: 100, finishNow: true })).toContain("ไม่มีวัตถุดิบ");
  });
});
