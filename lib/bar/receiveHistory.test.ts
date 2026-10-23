import { describe, it, expect } from "vitest";
import { receiveHistory, changeText, receiveDateText, type ReceiveRecord } from "./receiveHistory";

/** golden **B22** — ประวัติราคารับของบาร์ (D126) */

const rec = (p: Partial<ReceiveRecord> & { id: number; docDate: string }): ReceiveRecord => ({
  qtyPack: 1,
  qty: 700,
  costTotal: 0,
  source: null,
  note: null,
  ...p,
});

describe("receiveHistory — ราคาต่อหน่วย", () => {
  it("รับ 2 ขวด (700 ml) จ่าย 1,000 → ขวดละ 500 · ml ละ 0.714…", () => {
    const [v] = receiveHistory([rec({ id: 1, docDate: "2026-10-01", qtyPack: 2, qty: 1400, costTotal: 1000 })]);
    expect(v.packSize).toBe(700);
    expect(v.perPack).toBe(500);
    expect(v.perUnit).toBeCloseTo(1000 / 1400, 10);
  });

  it("ขนาดขวดของล็อตคิดจากแถวนั้นเอง — ล็อตเก่า 700 ml ล็อตใหม่ 750 ml ราคาต่อขวดไม่ปนกัน", () => {
    const vs = receiveHistory([
      rec({ id: 1, docDate: "2026-09-01", qtyPack: 1, qty: 700, costTotal: 490 }),
      rec({ id: 2, docDate: "2026-10-01", qtyPack: 1, qty: 750, costTotal: 525 }),
    ]);
    expect(vs.map((v) => v.packSize)).toEqual([750, 700]);
    expect(vs.map((v) => v.perPack)).toEqual([525, 490]);
    // ต่อ ml เท่ากันพอดี (0.7) ⇒ เท่าเดิม แม้ราคาต่อขวดขึ้น
    expect(changeText(vs[0].change)).toBe("เท่าเดิม");
  });

  it("ไม่ได้ตั้งหน่วยซื้อ (qty_pack = qty) → ขนาด 1 = ราคาต่อหน่วยฐาน", () => {
    const [v] = receiveHistory([rec({ id: 1, docDate: "2026-10-01", qtyPack: 30, qty: 30, costTotal: 150 })]);
    expect(v.packSize).toBe(1);
    expect(v.perPack).toBe(5);
    expect(v.perUnit).toBe(5);
  });

  it("qty_pack ว่าง → ไม่เดาราคาต่อหน่วยซื้อ แต่ราคาต่อหน่วยฐานยังมี", () => {
    const [v] = receiveHistory([rec({ id: 1, docDate: "2026-10-01", qtyPack: null, qty: 500, costTotal: 250 })]);
    expect(v.packSize).toBeNull();
    expect(v.perPack).toBeNull();
    expect(v.perUnit).toBe(0.5);
  });

  it("ไม่กรอกราคา (0) → ทุกช่องราคาเป็น null ไม่ใช่ 0", () => {
    const [v] = receiveHistory([rec({ id: 1, docDate: "2026-10-01", costTotal: 0 })]);
    expect(v.perPack).toBeNull();
    expect(v.perUnit).toBeNull();
    expect(v.change).toBeNull();
  });
});

describe("receiveHistory — ลำดับ + ราคาขึ้นลง", () => {
  it("เรียงใหม่สุดก่อนเสมอ ไม่ว่า DB ส่งมาลำดับไหน · วันเดียวกันตัดสินด้วย id", () => {
    const input = [
      rec({ id: 3, docDate: "2026-10-05" }),
      rec({ id: 1, docDate: "2026-10-01" }),
      rec({ id: 4, docDate: "2026-10-05" }),
      rec({ id: 2, docDate: "2026-10-03" }),
    ];
    const ids = (rows: ReceiveRecord[]) => receiveHistory(rows).map((v) => v.id);
    expect(ids(input)).toEqual([4, 3, 2, 1]);
    expect(ids([...input].reverse())).toEqual([4, 3, 2, 1]);
  });

  it("เทียบกับครั้งก่อนหน้า — ขึ้น 10% / ลง 20% · ครั้งแรกสุดไม่มีอะไรให้เทียบ", () => {
    const vs = receiveHistory([
      rec({ id: 1, docDate: "2026-08-01", costTotal: 500 }),
      rec({ id: 2, docDate: "2026-09-01", costTotal: 550 }),
      rec({ id: 3, docDate: "2026-10-01", costTotal: 440 }),
    ]);
    expect(vs.map((v) => changeText(v.change))).toEqual(["▼ 20%", "▲ 10%", null]);
  });

  it("ข้ามครั้งที่ไม่กรอกราคา (ของแถม) — เทียบกับครั้งที่มีราคาก่อนหน้านั้น", () => {
    const vs = receiveHistory([
      rec({ id: 1, docDate: "2026-08-01", costTotal: 500 }),
      rec({ id: 2, docDate: "2026-09-01", costTotal: 0 }),
      rec({ id: 3, docDate: "2026-10-01", costTotal: 600 }),
    ]);
    expect(changeText(vs[0].change)).toBe("▲ 20%");
    expect(vs[1].change).toBeNull();
  });
});

describe("changeText / receiveDateText", () => {
  it("ปัดทศนิยม 1 ตำแหน่ง · ค่าแปลกคืน null", () => {
    expect(changeText(0.12345)).toBe("▲ 12.3%");
    expect(changeText(-0.0004)).toBe("เท่าเดิม");
    expect(changeText(null)).toBeNull();
    expect(changeText(Infinity)).toBeNull();
  });

  it("วันที่เป็น พ.ศ. 2 หลัก · ค่าที่ไม่ใช่วันที่คืนตามเดิม", () => {
    expect(receiveDateText("2026-10-20")).toBe("20/10/69");
    expect(receiveDateText("2027-01-05")).toBe("05/01/70");
    expect(receiveDateText("ไม่รู้")).toBe("ไม่รู้");
  });
});
