import { describe, it, expect } from "vitest";
import { priceHistoryTotals, singleItemSummary, priceHistoryCapNote, netLine, priceHistoryTable, toTsv, type PriceHistoryRow } from "./priceHistory";

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

describe("A29 — ราคาต่อหน่วยสุทธิ + ส่งออกตาราง (D181)", () => {
  const base = { type: "รายจ่าย", quantity: 10, exVat: 30, totalPrice: 300, baseAmount: 300, amountAfterDiscount: 300 };

  it("ไม่มีส่วนลดท้ายบิล = รวม ÷ จำนวน ตรง ๆ (ข้อเสนอของผู้ใช้)", () => {
    expect(netLine(base)).toEqual({ netTotal: 300, netUnit: 30, billDiscounted: false });
  });

  it("ส่วนลดรายบรรทัด: total_price หักแล้ว ⇒ รวม ÷ จำนวน", () => {
    // 10 × 30 − ลด 20 = 280
    expect(netLine({ ...base, totalPrice: 280, baseAmount: 280, amountAfterDiscount: 280 }).netUnit).toBe(28);
  });

  it("ส่วนลดท้ายบิล: เกลี่ยตามสัดส่วนยอดเงิน (บรรทัดแพงได้ส่วนลดมาก)", () => {
    // บิล 2 บรรทัด 300 + 100 = 400 · ลดท้ายบิล 40 ⇒ สัดส่วน 0.9
    const a = netLine({ ...base, totalPrice: 300, baseAmount: 400, amountAfterDiscount: 360 });
    const b = netLine({ ...base, quantity: 4, totalPrice: 100, baseAmount: 400, amountAfterDiscount: 360 });
    expect(a).toEqual({ netTotal: 270, netUnit: 27, billDiscounted: true });
    expect(b).toEqual({ netTotal: 90, netUnit: 22.5, billDiscounted: true });
    expect(a.netTotal + b.netTotal).toBe(360); // ผลรวมกลับมาเท่ายอดหลังส่วนลดของบิล
  });

  it("จำนวน 0 = null (ไม่หารศูนย์) · ยอดบิล 0 = ไม่เกลี่ย", () => {
    expect(netLine({ ...base, quantity: 0 }).netUnit).toBeNull();
    expect(netLine({ ...base, baseAmount: 0, amountAfterDiscount: 0 })).toEqual({ netTotal: 300, netUnit: 30, billDiscounted: false });
  });

  it("หารไม่ลงตัวเก็บ 4 ตำแหน่ง (ไปปัดตอนแสดง)", () => {
    expect(netLine({ ...base, quantity: 3, totalPrice: 100, baseAmount: 100, amountAfterDiscount: 100 }).netUnit).toBe(33.3333);
  });

  it("ใบเช็คราคา = ราคาที่กรอก แม้ยอดรวมที่เก็บไว้เป็น 0 (ใบที่บันทึกก่อน D181)", () => {
    expect(netLine({ ...base, type: "เช็คราคา", exVat: 25, totalPrice: 0, baseAmount: 0, amountAfterDiscount: 0 })).toEqual({ netTotal: 250, netUnit: 25, billDiscounted: false });
  });

  it("ราคาเฉลี่ยของสินค้าชื่อเดียว ใช้ยอดสุทธิ (ตรงกับคอลัมน์ราคาสุทธิ)", () => {
    const s = singleItemSummary([{ ...r("ข้าว", 10, 300), netTotal: 270 }, { ...r("ข้าว", 10, 300), netTotal: 300 }]);
    expect(s?.avgPrice).toBe(28.5);
    expect(s?.total).toBe(600); // ยอดรวมเดิมไม่ขยับ
  });

  const row = {
    date: "2026-11-25", itemName: "ข้าว\tเหนียว", contactName: "ร้านเอ", type: "รายจ่าย", category: "วัตถุดิบ", job: "",
    quantity: 10, exVat: 30, totalPrice: 300, netUnit: 27 as number | null, netTotal: 270, txId: "TX-1",
  };

  it("ตาราง: หัว 12 คอลัมน์ · ตัวเลขเป็น number · ราคาสุทธิ null = ช่องว่าง", () => {
    const t = priceHistoryTable([row, { ...row, netUnit: null }]);
    expect(t[0]).toHaveLength(12);
    expect(t[1]).toEqual(["2026-11-25", "ข้าว\tเหนียว", "ร้านเอ", "รายจ่าย", "วัตถุดิบ", "", 10, 30, 300, 27, 270, "TX-1"]);
    expect(t[2][9]).toBe("");
  });

  it("TSV: คั่นแท็บ ขึ้นบรรทัดแบบ Excel · แท็บในชื่อสินค้าถูกแทนด้วยช่องว่าง (ไม่ให้ช่องเลื่อน)", () => {
    const tsv = toTsv(priceHistoryTable([row]));
    const lines = tsv.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1].split("\t")).toHaveLength(12);
    expect(lines[1]).toContain("ข้าว เหนียว");
  });
});
