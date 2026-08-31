import { describe, it, expect } from "vitest";
import { posQuotationInput, posTotals, stockShortages, mergeCart, type PosMenuRow } from "./pos";
import { quotationTotals, type CartItem } from "./calc";

// ── S12: ขายหน้าร้าน (POS · D86) ────────────────────────────────────────────────
//
// 🚩 ข้อพิสูจน์หลักของชุดนี้: POS **ไม่ได้แตกสูตรเงินออกมาเป็นชุดที่ 2**
//    ยอดทุกบาททุกสตางค์ต้องเท่ากับใบเสนอราคาที่ปิด WHT/มัดจำ — ถ้าวันไหนเทสนี้แดง
//    แปลว่ามีคนเริ่มคำนวณเองในเส้นทาง POS แล้ว

const cart: CartItem[] = [
  { name: "สุราขาว 40 ดีกรี (ลัง)", price: 2520, qty: 2 },
  { name: "สุราขาว 40 ดีกรี (ขวด)", price: 210, qty: 3 },
];

describe("S12 posQuotationInput / posTotals", () => {
  it("ปิด WHT และมัดจำเสมอ (ลูกค้าขาจรไม่หัก ณ ที่จ่าย · จ่ายจบหน้าร้าน)", () => {
    const input = posQuotationInput(cart, 0);
    expect(input.isWhtRequired).toBe(false);
    expect(input.whtPercent).toBe(0);
    expect(input.isDepositRequired).toBe(false);
    expect(input.depositPercent).toBe(0);
  });

  it("🚩 ยอดตรงกับ quotationTotals ทุกทศนิยม (ไม่มีสูตรชุดที่ 2)", () => {
    for (const discount of [0, 20, 137.5, 1000]) {
      expect(posTotals(cart, discount)).toEqual(
        quotationTotals({
          items: cart,
          discount,
          isWhtRequired: false,
          whtPercent: 0,
          isDepositRequired: false,
          depositPercent: 0,
        }),
      );
    }
  });

  it("ไม่มีส่วนลด → ยอดกลมเป๊ะ และ VAT ถูกถอดออกจากยอดรวม (โมเดล inclusive D27)", () => {
    const t = posTotals(cart, 0);
    expect(t.grandTotal).toBe(5670); // 2520×2 + 210×3
    expect(t.subDiscount).toBe(5299.07); // 5670 / 1.07
    expect(t.vatAmount).toBe(370.93);
    expect(t.whtAmount).toBe(0);
    expect(t.netPayable).toBe(5670); // ไม่มี WHT → จ่ายเท่ายอดรวม
    expect(t.expectedDeposit).toBe(0);
  });

  it("ค่าปริยาย isVat = true · กิจการไม่จด VAT ไม่มีอะไรให้ถอด", () => {
    const t = posTotals(cart, 0, false);
    expect(t.vatAmount).toBe(0);
    expect(t.subDiscount).toBe(5670);
    expect(t.grandTotal).toBe(5670);
  });

  it("ส่วนลดท้ายบิลเป็นบาทรูปรวม VAT (ช่องเดียวที่ POS ให้กรอก)", () => {
    const t = posTotals(cart, 170);
    expect(t.grandTotal).toBe(5500);
    expect(t.discountEx).toBe(158.88); // 5299.07 − 5140.19
  });

  it("ส่วนลดเกินยอด → ไม่ติดลบ (กันคีย์ผิดแล้วได้บิลยอดติดลบ)", () => {
    expect(posTotals(cart, 99999).grandTotal).toBe(0);
  });
});

describe("S12 stockShortages", () => {
  const menu: PosMenuRow[] = [
    { name: "สุราขาว 40 ดีกรี (ลัง)", itemCode: "P001", stockQty: 1 },
    { name: "สุราขาว 40 ดีกรี (ขวด)", itemCode: "P001", stockQty: 50 },
    { name: "แก้วช็อต", itemCode: "W-GLASS", stockQty: null },
  ];

  it("เตือนเฉพาะรายการที่สั่งเกินคงเหลือ", () => {
    expect(stockShortages(cart, menu)).toEqual([
      { name: "สุราขาว 40 ดีกรี (ลัง)", want: 2, have: 1 },
    ]);
  });

  it("สั่งพอดีคงเหลือ = ไม่เตือน (ขายของชิ้นสุดท้ายเป็นเรื่องปกติ)", () => {
    expect(stockShortages([{ name: "สุราขาว 40 ดีกรี (ลัง)", price: 2520, qty: 1 }], menu)).toEqual([]);
  });

  it("🪤 stockQty = null (ยังไม่มีแถวสต็อก) → ไม่เตือน — ไม่รู้ ≠ ไม่มี", () => {
    expect(stockShortages([{ name: "แก้วช็อต", price: 50, qty: 999 }], menu)).toEqual([]);
  });

  it("ไม่มีในเมนู → ไม่เตือน (POS ให้เลือกจากเมนูเท่านั้นอยู่แล้ว)", () => {
    expect(stockShortages([{ name: "ของนอกเมนู", price: 10, qty: 5 }], menu)).toEqual([]);
  });

  it("🪤 ชื่อซ้ำหลายบรรทัดต้องรวมยอดก่อนเทียบ ไม่งั้นเกินแล้วไม่ฟ้อง", () => {
    const twoLines: CartItem[] = [
      { name: "สุราขาว 40 ดีกรี (ลัง)", price: 2520, qty: 1 },
      { name: "สุราขาว 40 ดีกรี (ลัง)", price: 2520, qty: 1 },
    ];
    expect(stockShortages(twoLines, menu)).toEqual([
      { name: "สุราขาว 40 ดีกรี (ลัง)", want: 2, have: 1 },
    ]);
  });

  it("🪤 จับคู่ด้วย trim(ชื่อ) แบบเดียวกับ fn_confirm_fulfillment", () => {
    expect(stockShortages([{ name: "  สุราขาว 40 ดีกรี (ลัง) ", price: 2520, qty: 3 }], menu)).toEqual([
      { name: "สุราขาว 40 ดีกรี (ลัง)", want: 3, have: 1 },
    ]);
  });
});

describe("S12 mergeCart", () => {
  it("รวมชื่อ+ราคาเดียวกันเป็นบรรทัดเดียว", () => {
    expect(
      mergeCart([
        { name: "ก", price: 100, qty: 1 },
        { name: "ข", price: 50, qty: 2 },
        { name: "ก", price: 100, qty: 3 },
      ]),
    ).toEqual([
      { name: "ก", price: 100, qty: 4 },
      { name: "ข", price: 50, qty: 2 },
    ]);
  });

  it("ราคาต่างกันไม่รวม (สินค้าตัวเดิมแต่คนละราคา = คนละบรรทัดบนใบกำกับ)", () => {
    const items: CartItem[] = [
      { name: "ก", price: 100, qty: 1 },
      { name: "ก", price: 90, qty: 1 },
    ];
    expect(mergeCart(items)).toHaveLength(2);
  });

  it("ไม่แก้ของเดิม (คืน array ใหม่ — กัน state ใน React ถูกกลายพันธุ์)", () => {
    const items: CartItem[] = [{ name: "ก", price: 100, qty: 1 }];
    mergeCart(items);
    expect(items[0].qty).toBe(1);
  });
});
