import { describe, it, expect } from "vitest";
import { numText, stockText, packToBase, isLowStock } from "./units";

/** golden **B5** — แสดงยอดคงเหลือให้คนอ่านรู้เรื่อง (D96) */

describe("ตัวเลขบนจอ", () => {
  it("ใส่คอมมาและตัดศูนย์ท้ายทศนิยม", () => {
    expect(numText(2240)).toBe("2,240");
    expect(numText(3.2)).toBe("3.2");
    expect(numText(3.0)).toBe("3");
  });

  it("ค่าที่ไม่ใช่ตัวเลข = '—' ไม่ใช่ NaN โผล่บนจอ", () => {
    expect(numText(NaN)).toBe("—");
    expect(numText(Infinity)).toBe("—");
  });
});

describe("ยอดคงเหลือ — ขวดเป็นวิธีแสดงผล ไม่ใช่หน่วยที่เก็บ", () => {
  it("มี packSize → แสดงทั้งหน่วยฐานและจำนวนขวดโดยประมาณ", () => {
    expect(
      stockText({ qty: 2240, unit: "ml", packSize: 700, packLabel: "ขวด (700 ml)" }),
    ).toBe("2,240 ml ≈ 3.2 ขวด (700 ml)");
  });

  it("🪤 ไม่ปัดจำนวนขวดขึ้น — 'เหลือ 0.4 ขวด' ต้องอ่านว่าไม่ถึงขวด", () => {
    expect(stockText({ qty: 280, unit: "ml", packSize: 700, packLabel: "ขวด" }))
      .toBe("280 ml ≈ 0.4 ขวด");
  });

  it("ไม่ได้ตั้ง packSize → แสดงหน่วยฐานอย่างเดียว **ไม่เดา** ว่า 1 ขวดเท่ากับเท่าไร", () => {
    expect(stockText({ qty: 12, unit: "ลูก" })).toBe("12 ลูก");
    expect(stockText({ qty: 12, unit: "ลูก", packSize: null })).toBe("12 ลูก");
  });

  it("packSize เป็น 0 หรือติดลบ = ถือว่าไม่ได้ตั้ง (กัน Infinity โผล่บนจอ)", () => {
    expect(stockText({ qty: 100, unit: "ml", packSize: 0 })).toBe("100 ml");
    expect(stockText({ qty: 100, unit: "ml", packSize: -700 })).toBe("100 ml");
  });

  it("ไม่ได้ตั้ง packLabel → ประกอบป้ายให้เองจากขนาด", () => {
    expect(stockText({ qty: 1400, unit: "ml", packSize: 700 })).toBe("1,400 ml ≈ 2 หน่วย (700 ml)");
  });

  it("สต็อกติดลบยังแสดงตามจริง ไม่ซ่อนไม่ปัดเป็น 0", () => {
    expect(stockText({ qty: -60, unit: "ml" })).toBe("-60 ml");
  });
});

describe("แปลงหน่วยซื้อ → หน่วยฐาน", () => {
  it("รับ 3 ขวด × 700 = 2,100 ml", () => {
    expect(packToBase(3, 700)).toBe(2100);
  });

  it("ไม่ได้ตั้ง packSize = 1:1 (ซื้อเป็นหน่วยฐานอยู่แล้ว เช่น มะนาวเป็นลูก)", () => {
    expect(packToBase(12, null)).toBe(12);
    expect(packToBase(12, 0)).toBe(12);
  });
});

describe("ของใกล้หมด", () => {
  it("ต่ำกว่าหรือเท่ากับเกณฑ์ = ใกล้หมด", () => {
    expect(isLowStock({ qty: 100, lowQty: 200 })).toBe(true);
    expect(isLowStock({ qty: 200, lowQty: 200 })).toBe(true);
    expect(isLowStock({ qty: 201, lowQty: 200 })).toBe(false);
  });

  it("🪤 ไม่ได้ตั้งเกณฑ์ = **ไม่เตือน** (ไม่รู้ ≠ ใกล้หมด — หลักเดียวกับ D86)", () => {
    expect(isLowStock({ qty: 0, lowQty: null })).toBe(false);
    expect(isLowStock({ qty: 0 })).toBe(false);
  });
});
