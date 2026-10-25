import { describe, it, expect } from "vitest";
import {
  STOCK_VIEWS,
  STOCK_VIEW_LABEL,
  parseStockView,
  matchesQuery,
  itemPasses,
  countPasses,
  countRowFilled,
  visibleRows,
  hiddenPendingCount,
  hiddenPendingText,
  noMatchText,
} from "./stockNav";
import type { CountDraft } from "./stockBatch";

/** golden **B25** — แถบสลับส่วน + ช่องค้นของหน้าสต็อกบาร์ (D128) */

const GIN = { name: "Gordon's Gin", qty: 1400, lowQty: 350, active: true };
const GIN2 = { name: "จินทดสอบ ยี่ห้อ 2", qty: 100, lowQty: 350, active: true };
const OLD = { name: "จินเลิกใช้", qty: 0, lowQty: 350, active: false };
const LIME = { name: "มะนาว", qty: 10, lowQty: null, active: true };

const draft = (itemId: string, value: number | "" = ""): CountDraft => ({
  itemId, value, unit: "base", reason: "ปรับยอด", note: "",
});

describe("B25 · ส่วนที่แสดงผูกกับ URL", () => {
  it("รู้จักครบทุกส่วน · ค่าแปลก/ว่าง = วัตถุดิบ (ลิงก์เก่าเปิดได้)", () => {
    expect(STOCK_VIEWS.map(parseStockView)).toEqual(["items", "receive", "count", "prep"]);
    expect(parseStockView(null)).toBe("items");
    expect(parseStockView("")).toBe("items");
    expect(parseStockView("COUNT")).toBe("items");
    expect(parseStockView("history")).toBe("items");
  });
  it("ทุกส่วนมีชื่อไทย และชื่อไม่ซ้ำกัน", () => {
    const labels = STOCK_VIEWS.map((v) => STOCK_VIEW_LABEL[v]);
    expect(labels).toEqual(["วัตถุดิบ", "รับของเข้า", "นับสต็อก", "ของทำเอง"]);
    expect(new Set(labels).size).toBe(4);
  });
});

describe("B25 · matchesQuery", () => {
  it("ว่าง/ช่องว่างล้วน = ตรงทุกตัว", () => {
    expect(matchesQuery("อะไรก็ได้", "")).toBe(true);
    expect(matchesQuery("อะไรก็ได้", "   ")).toBe(true);
  });
  it("ไม่สนตัวพิมพ์เล็กใหญ่ · ตรงส่วนไหนของชื่อก็ได้", () => {
    expect(matchesQuery("Gordon's Gin", "GIN")).toBe(true);
    expect(matchesQuery("Gordon's Gin", "rdon")).toBe(true);
    expect(matchesQuery("จินทดสอบ ยี่ห้อ 2", "ทดสอบ")).toBe(true);
  });
  it("หลายคำ = ต้องเจอครบทุกคำ ลำดับไม่สำคัญ", () => {
    expect(matchesQuery("จินทดสอบ ยี่ห้อ 2", "จิน 2")).toBe(true);
    expect(matchesQuery("จินทดสอบ ยี่ห้อ 2", "2 จิน")).toBe(true);
    expect(matchesQuery("จินทดสอบ", "จิน 2")).toBe(false);
  });
});

describe("B25 · ทะเบียนวัตถุดิบ", () => {
  it("ใกล้หมด = เฉพาะตัวที่ยังใช้อยู่ (ตรงกับแถบเตือนบนสุด)", () => {
    expect([GIN, GIN2, OLD, LIME].filter((i) => itemPasses(i, "", "low")).map((i) => i.name)).toEqual(["จินทดสอบ ยี่ห้อ 2"]);
  });
  it("เลิกใช้ + ค้นพร้อมกัน", () => {
    expect([GIN, GIN2, OLD, LIME].filter((i) => itemPasses(i, "จิน", "inactive")).map((i) => i.name)).toEqual(["จินเลิกใช้"]);
    expect([GIN, GIN2, OLD, LIME].filter((i) => itemPasses(i, "จิน", "all"))).toHaveLength(2);
  });
});

describe("B25 · นับสต็อก", () => {
  it("กรอกแล้ว = มียอด (0 ก็นับ — 0 คือนับแล้วหมด) · ว่าง = ใช้ค่าในระบบ", () => {
    expect(countRowFilled(draft("a", 0))).toBe(true);
    expect(countRowFilled(draft("a", 5))).toBe(true);
    expect(countRowFilled(draft("a"))).toBe(false);
  });
  it("ตัวกรองที่กรอกแล้ว / ใกล้หมด", () => {
    expect(countPasses(draft("x", 0), LIME, "", "filled")).toBe(true);
    expect(countPasses(draft("x"), LIME, "", "filled")).toBe(false);
    expect(countPasses(draft("x"), GIN2, "", "low")).toBe(true);
    expect(countPasses(draft("x"), OLD, "", "low")).toBe(false);
    expect(countPasses(draft("x", 3), LIME, "จิน", "filled")).toBe(false);
  });
  it("🚨 เลขแถวคงเป็นเลขเดิมหลังกรอง (error ของการบันทึกอ้างเลขนี้)", () => {
    const rows = [draft("a"), draft("b", 1), draft("c"), draft("d", 2)];
    expect(visibleRows(rows, countRowFilled).map((x) => [x.row.itemId, x.no])).toEqual([["b", 2], ["d", 4]]);
  });
  it("ลำดับแถวไม่เปลี่ยนตามการค้น", () => {
    const rows = [draft("z"), draft("a"), draft("m")];
    expect(visibleRows(rows, () => true).map((x) => x.row.itemId)).toEqual(["z", "a", "m"]);
  });
});

describe("B25 · 🚨 ของที่จะบันทึกแต่ถูกกรองซ่อน ต้องบอก", () => {
  it("นับเฉพาะตัวที่มองไม่เห็น · ไม่นับซ้ำ", () => {
    expect(hiddenPendingCount(["a", "b", "c"], ["a"])).toBe(2);
    expect(hiddenPendingCount(["a", "a"], [])).toBe(1);
    expect(hiddenPendingCount([], ["a"])).toBe(0);
  });
  it("ประโยค — ไม่มี = ว่าง (ไม่ขึ้นอะไรเลย)", () => {
    expect(hiddenPendingText(0)).toBe("");
    expect(hiddenPendingText(3)).toBe("มีที่กรอกไว้ 3 รายการที่ถูกกรองซ่อนอยู่ — กดบันทึกแล้วจะบันทึกด้วย");
  });
  it("ค้นไม่เจอ ต้องไม่พูดว่ายังไม่มีวัตถุดิบ", () => {
    expect(noMatchText(82)).toContain("ทั้งหมด 82 รายการ");
    expect(noMatchText(82)).not.toContain("ยังไม่มี");
  });
});
