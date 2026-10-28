import { describe, it, expect } from "vitest";
import { priceHistoryTotals, singleItemSummary, priceHistoryCapNote, type PriceHistoryRow } from "./priceHistory";

const r = (itemName: string, quantity: number, totalPrice: number, type = "รายจ่าย"): PriceHistoryRow => ({ itemName, quantity, totalPrice, type });

describe("A28 — ยอดรวมแท็บประวัติราคา (D140)", () => {
  it("แยกตามประเภท + เช็คราคาไม่นับแต่บอกจำนวน", () => {
    const t = priceHistoryTotals([r("ข้าว", 10, 300), r("ข้าว", 5, 160), r("ขวด", 1, 50, "รายรับ"), r("ข้าว", 1, 999, "เช็คราคา")]);
    expect(t.byType.map((x) => [x.type, x.count, x.total])).toEqual([
      ["รายรับ", 1, 50],
      ["รายจ่าย", 2, 460],
    ]);
    expect(t.priceCheckCount).toBe(1);
  });

  it("สินค้าชื่อเดียว: จำนวนรวม + ราคาเฉลี่ยถ่วงน้ำหนัก (ไม่ใช่เฉลี่ยของราคาต่อหน่วย)", () => {
    const s = singleItemSummary([r("ข้าวเหนียว", 10, 300), r(" ข้าวเหนียว ", 30, 1200)]);
    expect(s).toEqual({ itemName: "ข้าวเหนียว", type: "รายจ่าย", quantity: 40, total: 1500, avgPrice: 37.5 });
  });

  it("หลายชื่อปนกัน = ไม่โชว์ (บวกต่างหน่วยไม่ได้)", () => {
    expect(singleItemSummary([r("ข้าว", 10, 300), r("ยีสต์", 1, 80)])).toBeNull();
  });

  it("ซื้อกับขายของชื่อเดียวกันปนกัน = ไม่โชว์", () => {
    expect(singleItemSummary([r("ข้าว", 10, 300), r("ข้าว", 2, 100, "รายรับ")])).toBeNull();
  });

  it("เช็คราคาไม่นับ — มีแต่เช็คราคา = ไม่โชว์ · ปนกับซื้อจริง = นับเฉพาะซื้อจริง", () => {
    expect(singleItemSummary([r("ข้าว", 1, 50, "เช็คราคา")])).toBeNull();
    expect(singleItemSummary([r("ข้าว", 10, 300), r("ข้าว", 1, 50, "เช็คราคา")])?.avgPrice).toBe(30);
  });

  it("จำนวนรวม 0 = ราคาเฉลี่ย null (ไม่หารศูนย์)", () => {
    expect(singleItemSummary([r("ค่าขนส่ง", 0, 100)])?.avgPrice).toBeNull();
  });

  it("ตัวพิมพ์เล็ก-ใหญ่ถือเป็นชื่อเดียว", () => {
    expect(singleItemSummary([r("Yeast", 1, 10), r("yeast", 1, 20)])?.quantity).toBe(2);
  });

  it("ไม่มีแถว = null", () => {
    expect(singleItemSummary([])).toBeNull();
  });

  it("ประโยคเพดาน: ครบ = ว่าง · ไม่ครบ = บอกจำนวน", () => {
    expect(priceHistoryCapNote(10, 10)).toBe("");
    expect(priceHistoryCapNote(10, null)).toBe("");
    expect(priceHistoryCapNote(10000, 12500)).toContain("10,000 จาก 12,500");
  });
});
