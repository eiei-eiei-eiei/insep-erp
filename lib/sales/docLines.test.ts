import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { docLines, docLinesBase, docDiscountEx } from "./docLines";
import { quotationTotals, type CartItem } from "./calc";
import { allocateExTotals } from "../accounting/calc";
import { vatFromGross } from "../shared/vat";
import { salesDocsHtml, quotationHtml, creditNoteDocsHtml, type CreditNoteDoc, type QuotationDoc } from "@/app/(app)/sales/_components/print";
import { COMPANY, vatOrder } from "./salesDocHtml.fixtures";

/**
 * golden S25 — ตารางเอกสารขายแสดงราคาก่อน VAT (D167)
 *
 * 🚨 บทเรียน D27: ราคาก่อน VAT ที่ปัดแล้ว × จำนวน = ยอดเพี้ยน (3 × 196.26 = 588.78 ≠ 630/1.07)
 *    ตารางใหม่ห้ามเอาราคาต่อหน่วยไปคูณ · เงินทุกบาทยังมาจากราคารวม VAT (calc.ts ไม่ถูกแตะ)
 */
const totals = (items: CartItem[], discount: number) =>
  quotationTotals({ items, discount, isWhtRequired: false, whtPercent: 0, isDepositRequired: false, depositPercent: 0 });
const round2 = (v: number) => Math.round(v * 100) / 100;
const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));

describe("S25 สุราท่าน้ำอ้อย 249 บาท (รวม VAT) — เคสที่ผู้ใช้เจอ", () => {
  it("หน่วยละ 232.71 · 50 ขวด จำนวนเงิน 11,635.51 (ถอดจาก 12,450 ไม่ใช่ 232.71 × 50)", () => {
    const [l] = docLines([{ name: "สุรา", qty: 50, price: 249 }], true);
    expect(l.unit).toBe(232.71);
    expect(l.amount).toBe(11635.51);
  });

  it("ทุกจำนวน 1–300 ขวด: ก่อน VAT + VAT = 249 × จำนวน เป๊ะ · ตาราง = รวมเป็นเงิน (ก่อน VAT)", () => {
    for (let q = 1; q <= 300; q++) {
      const items = [{ name: "สุรา", qty: q, price: 249 }];
      const t = totals(items, 0);
      expect(t.grandTotal, `qty ${q}`).toBe(round2(249 * q)); // เงินไม่ขยับ (สูตรเดิม)
      expect(sum(docLines(items, true).map((l) => l.amount)), `qty ${q}`).toBe(docLinesBase(items));
      expect(docLinesBase(items), `qty ${q}`).toBe(t.subDiscount);
      expect(round2(t.subDiscount + t.vatAmount), `qty ${q}`).toBe(round2(249 * q));
    }
  });

  it("หลายรายการ: แต่ละแถวคลาดจากค่าถอดตรง ๆ ไม่เกิน 1 สตางค์ต่อแถว และรวมได้เท่าหัวกรอบ", () => {
    const items = [
      { name: "a", qty: 50, price: 249 }, { name: "b", qty: 3, price: 210 },
      { name: "c", qty: 7, price: 389 }, { name: "d", qty: 1, price: 1250 },
    ];
    const lines = docLines(items, true);
    expect(sum(lines.map((l) => l.amount))).toBe(docLinesBase(items));
    lines.forEach((l, i) => {
      const direct = vatFromGross(round2(items[i].price * items[i].qty)).base;
      expect(Math.abs(round2(l.amount - direct)), l.name).toBeLessThanOrEqual(0.01 * items.length);
    });
  });
});

describe("S25 ผู้ไม่จด VAT — ตารางเหมือนเดิมทุกตัวเลข", () => {
  it("หน่วยละ = ราคาที่เก็บ · จำนวนเงิน = ราคา × จำนวน", () => {
    expect(docLines([{ name: "x", qty: 3, price: 249 }], false)).toEqual([{ name: "x", qty: 3, unit: 249, amount: 747 }]);
  });
});

describe("S25 ส่วนลด — หัวกรอบลบกันแล้วตรงเสมอ", () => {
  it("รวมเป็นเงิน − ส่วนลด = มูลค่าหลังหักส่วนลด (ค่าที่บันทึกไว้ในออเดอร์)", () => {
    const items = [{ name: "a", qty: 10, price: 249 }];
    const t = totals(items, 90);
    const disc = docDiscountEx(items, t.subDiscount);
    expect(round2(docLinesBase(items) - disc)).toBe(t.subDiscount);
    expect(disc).toBe(t.discountEx); // ตรงกับส่วนลดก่อน VAT ที่ calc.ts เก็บลงออเดอร์
  });
});

describe("S25 ตัวเกลี่ยเศษย้ายไป lib/shared — ฝั่งบัญชี (A21) ได้ค่าเดิม", () => {
  it("allocateExTotals ยังใช้ได้ผลเดิม", () => {
    const grosses = [1200, 75, 33.33];
    const base = vatFromGross(sum(grosses)).base;
    const lines = allocateExTotals(grosses, base);
    expect(sum(lines)).toBe(base);
    expect(lines.slice(1)).toEqual([vatFromGross(75).base, vatFromGross(33.33).base]);
  });
  it("บรรทัดติดลบ (หักส่วนลดบนใบลดหนี้) ถอด VAT ได้ ไม่กลายเป็น 0", () => {
    const [, neg] = docLines([{ name: "a", qty: 1, price: 535 }, { name: "หัก", qty: 1, price: -107 }], true);
    expect(neg.amount).toBe(-100);
    expect(neg.unit).toBe(-100);
  });
});

describe("S25 เอกสารจริง — ตาราง + กรอบสรุป", () => {
  const strip = (h: string) => h.split("(สำเนา")[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  it("ใบกำกับภาษีจ่ายเต็ม: ตารางก่อน VAT · หัวกรอบ = ผลรวมตาราง · ยอดรวมทั้งสิ้นเดิม", () => {
    const t = strip(salesDocsHtml(COMPANY, vatOrder(0), [{ name: "สุรา 700ml", qty: 4, price: 535 }], ["tax-invoice-receipt"]));
    expect(t).toContain("หน่วยละ (ก่อน VAT) จำนวนเงิน (ก่อน VAT) 1 สุรา 700ml 4 500.00 2,000.00");
    expect(t).toContain("รวมเป็นเงิน (ก่อน VAT) 2,000.00 ภาษีมูลค่าเพิ่ม 7% 140.00 ยอดรวมทั้งสิ้น 2,140.00");
    expect(t).not.toContain("รวมในราคาแล้ว");
    expect(t).not.toContain("มูลค่าสินค้า"); // ไม่พิมพ์เลขเดียวกันซ้ำสองบรรทัด
  });

  it("ใบเสนอราคามีส่วนลด: รวมเป็นเงิน − ส่วนลด = มูลค่าหลังหักส่วนลด", () => {
    const items = [{ name: "สุรา", qty: 10, price: 249 }];
    const tt = totals(items, 90);
    const Q: QuotationDoc = {
      quNo: "QU1", dateISO: "2026-11-06", quExp: "30", customerName: "ลูกค้า", customerAddress: "", customerTaxId: "", customerBranch: "",
      creditTerm: 30, items, subTotal: tt.subTotal, discount: tt.discountEx, subDiscount: tt.subDiscount, vat: tt.vatAmount,
      grandTotal: tt.grandTotal, whtPercent: 0, whtAmount: 0, netPayable: tt.netPayable, remarks: "", saleName: "",
    };
    const t = strip(quotationHtml(COMPANY, Q));
    expect(t).toContain("1 สุรา 10 232.71 2,327.10");
    expect(t).toContain("รวมเป็นเงิน (ก่อน VAT) 2,327.10 หักส่วนลด (ก่อน VAT) -84.11 มูลค่าหลังหักส่วนลด (ก่อน VAT) 2,242.99 ภาษีมูลค่าเพิ่ม 7% 157.01 ยอดรวมทั้งสิ้น 2,400.00");
  });

  it("ใบลดหนี้ยกเลิกทั้งออเดอร์ที่มีส่วนลด: ตารางรวมได้เท่าผลต่างของใบ", () => {
    const CN: CreditNoteDoc = {
      cnNo: "CN-1", cnDate: "2026-11-06", reasonText: "ยกเลิก", refs: [{ docNo: "TAX-1", date: "2026-10-28", preVat: 2242.99, vat: 157.01 }],
      original: 2242.99, correct: 0, diff: 2242.99, vat: 157.01, total: 2400, refund: 2400, wht: 0, refundAccount: "", kind: "cancel",
    };
    const t = strip(creditNoteDocsHtml(COMPANY, vatOrder(0), [{ name: "สุรา", qty: 10, price: 249 }], CN));
    expect(t).toContain("1 สุรา 10 232.71 2,327.10 2 หัก ส่วนลดตามใบกำกับเดิม / ยอดที่ลดหนี้ไปแล้ว 1 -84.11 -84.11");
  });

  it("print.ts ไม่คูณราคาต่อหน่วยในตาราง (กันถอยกลับไปบั๊ก D27)", () => {
    const src = readFileSync("app/(app)/sales/_components/print.ts", "utf8");
    const table = src.slice(src.indexOf("function itemsTable"), src.indexOf("function exHeadRows"));
    expect(table).toContain("docLines(");
    expect(table).not.toMatch(/\.price \* it\.qty|unit \* /);
  });
});
