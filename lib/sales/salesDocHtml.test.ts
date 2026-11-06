import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { salesDocsHtml, quotationHtml, creditNoteDocsHtml, type CreditNoteDoc, type QuotationDoc } from "@/app/(app)/sales/_components/print";
import { COMPANY, ITEMS, vatOrder, nonVatOrder, DOC_TYPES, planned } from "./salesDocHtml.fixtures";

/**
 * golden S20 — ตัวเลขบนเอกสารขายที่พิมพ์ออกมาจริง (D155)
 *
 * 🔴 ใบเสร็จมัดจำ/ยอดค้าง/รายงวด + ใบแจ้งหนี้ที่หักมัดจำ ของผู้ไม่จด VAT เคยคิด "มูลค่า (ก่อน VAT)"
 *    ด้วยการหาร 1.07 (reverseCalcPrint ไม่ได้รับ isVat) → มัดจำ 1,000 ขึ้นมูลค่า 934.58 แต่ยอดรับ 1,000
 * ★ พิสูจน์ตอนแก้: เรนเดอร์ใบจด VAT ทุกแบบ (22 แบบ · มี/ไม่มี WHT · รายงวด) ก่อน/หลังแก้ = HTML เหมือนกันทุกตัวอักษร
 *   ไฟล์นี้ล็อกตัวเลขหลักของใบจด VAT ไว้แทน (กันขยับทีหลัง)
 */

const NON = { ...COMPANY, isVat: false };
/** ตัวเลข/ข้อความในกรอบสรุปท้ายเอกสารใบแรก (ต้นฉบับ) */
function summary(html: string): string {
  const t = html.split("(สำเนา")[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  return t.match(/รวมเป็นเงิน.*?\( ผู้/)?.[0] ?? "";
}

describe("S20 ใบจด VAT — ตัวเลขเดิมไม่ขยับ", () => {
  it("ใบเสร็จมัดจำ ไม่มี / มี WHT 3%", () => {
    expect(summary(salesDocsHtml(COMPANY, vatOrder(0), ITEMS, ["tax-invoice-deposit"])))
      .toContain("มูลค่ามัดจำ (ก่อน VAT) 934.58 ภาษีมูลค่าเพิ่ม 7% 65.42 ยอดรับมัดจำ (รวม VAT) 1,000.00");
    expect(summary(salesDocsHtml(COMPANY, vatOrder(3), ITEMS, ["tax-invoice-deposit"])))
      .toContain("มูลค่ามัดจำ (ก่อน VAT) 961.54 ภาษีมูลค่าเพิ่ม 7% 67.31 หัก ณ ที่จ่าย 3% -28.85 ยอดรับมัดจำ (รวม VAT) 1,000.00");
  });
  it("ใบเสร็จยอดค้าง · ใบแจ้งหนี้หักมัดจำ · ใบเสร็จรายงวด", () => {
    expect(summary(salesDocsHtml(COMPANY, vatOrder(0), ITEMS, ["tax-invoice-balance"])))
      .toContain("หัก มัดจำรับแล้ว (ก่อน VAT) -934.58 ยอดคงค้างยกมา (ก่อน VAT) 1,065.42 ภาษีมูลค่าเพิ่ม 7% 74.58 ยอดรับครั้งนี้ (รวม VAT) 1,140.00");
    expect(summary(salesDocsHtml(COMPANY, vatOrder(3), ITEMS, ["invoice"])))
      .toContain("หัก มัดจำรับแล้ว (ก่อน VAT) -961.54 ยอดคงค้างยกมา (ก่อน VAT) 1,038.46 ภาษีมูลค่าเพิ่ม 7% 72.69 หัก ณ ที่จ่าย 3% -31.15 ยอดค้างชำระ (รวม VAT) 1,080.00");
    expect(summary(salesDocsHtml(COMPANY, planned(vatOrder(3), true), ITEMS, ["tax-invoice-installment:1"])))
      .toContain("มูลค่า (ก่อน VAT) 961.54 ภาษีมูลค่าเพิ่ม 7% 67.31 หัก ณ ที่จ่าย 3% -28.85 ยอดรับงวดนี้ (รวม VAT) 1,000.00");
  });
});

describe("S20 ใบผู้ไม่จด VAT — ไม่มีคำว่า VAT และตัวเลขบวกลงกัน", () => {
  it("ทุกชนิดเอกสาร · มี/ไม่มี WHT · รายงวด: ไม่มีคำว่า ก่อน VAT / รวม VAT / ภาษีมูลค่าเพิ่ม / ใบกำกับภาษี", () => {
    for (const wht of [0, 3]) {
      const htmls = [
        ...DOC_TYPES.map((dt) => [dt, salesDocsHtml(NON, nonVatOrder(wht), ITEMS, [dt])]),
        ...["invoice-installment:1", "tax-invoice-installment:1", "invoice"].map((dt) => [`plan ${dt}`, salesDocsHtml(NON, planned(nonVatOrder(wht), false), ITEMS, [dt])]),
      ];
      for (const [dt, h] of htmls) {
        for (const word of ["ก่อน VAT", "รวม VAT", "ภาษีมูลค่าเพิ่ม", "ใบกำกับภาษี", "Tax Invoice"]) {
          expect(h.includes(word), `${dt} wht=${wht} มีคำว่า ${word}`).toBe(false);
        }
      }
    }
  });
  it("ใบเสร็จมัดจำ: มูลค่า = ยอดรับ (ไม่มี WHT) · มูลค่า − WHT = ยอดรับ (มี WHT)", () => {
    expect(summary(salesDocsHtml(NON, nonVatOrder(0), ITEMS, ["tax-invoice-deposit"])))
      .toContain("มูลค่ามัดจำ 1,000.00 ยอดรับมัดจำ 1,000.00");
    expect(summary(salesDocsHtml(NON, nonVatOrder(3), ITEMS, ["tax-invoice-deposit"])))
      .toContain("มูลค่ามัดจำ 1,030.93 หัก ณ ที่จ่าย 3% -30.93 ยอดรับมัดจำ 1,000.00"); // 1,030.93 − 30.93 = 1,000
  });
  it("ใบเสร็จยอดค้าง: มัดจำ + คงค้าง = ยอดรวม 2,140", () => {
    expect(summary(salesDocsHtml(NON, nonVatOrder(0), ITEMS, ["tax-invoice-balance"])))
      .toContain("หัก มัดจำรับแล้ว -1,000.00 ยอดคงค้างยกมา 1,140.00 ยอดรับครั้งนี้ 1,140.00");
    // 1,030.93 + 1,109.07 = 2,140 · 1,109.07 − 33.27 = 1,075.80
    expect(summary(salesDocsHtml(NON, nonVatOrder(3), ITEMS, ["tax-invoice-balance"])))
      .toContain("หัก มัดจำรับแล้ว -1,030.93 ยอดคงค้างยกมา 1,109.07 หัก ณ ที่จ่าย 3% -33.27 ยอดรับครั้งนี้ 1,075.80");
  });
  it("ใบแจ้งหนี้หักมัดจำ + ใบเสร็จรายงวด", () => {
    expect(summary(salesDocsHtml(NON, nonVatOrder(0), ITEMS, ["invoice"])))
      .toContain("หัก มัดจำรับแล้ว -1,000.00 ยอดคงค้างยกมา 1,140.00 ยอดค้างชำระ 1,140.00");
    expect(summary(salesDocsHtml(NON, planned(nonVatOrder(3), false), ITEMS, ["tax-invoice-installment:1"])))
      .toContain("มูลค่า 1,030.93 หัก ณ ที่จ่าย 3% -30.93 ยอดรับงวดนี้ 1,000.00");
  });
});

describe("S20 ต่อสาย — ทุกจุดที่ถอด VAT ในตัวพิมพ์ต้องส่ง isVat", () => {
  it("ไม่มี reverseCalcPrint ที่ใช้ค่าปริยาย (= ถอด 7% เสมอ) ใน print.ts", () => {
    const pr = readFileSync("app/(app)/sales/_components/print.ts", "utf8");
    const calls = pr.match(/reverseCalcPrint\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c, c).toMatch(/, isVat\)$/);
  });
});

/**
 * D161 เฟส 3 — วันที่บนเอกสารการค้าตามค่าตั้ง `doc_date_format` (มากับ CompanyInfo.dateFormat)
 * ★ พิสูจน์ตอนแก้: เรนเดอร์ 59 แบบ (ทุกชนิด × จด/ไม่จด VAT × มี/ไม่มี WHT × ยกเลิก × รายงวด + ใบลดหนี้ + ใบเสนอราคา)
 *   ก่อน/หลังแก้ = HTML เหมือนกันทุกตัวอักษร 58 แบบ · ต่าง 1 แบบคือทางที่เอกสารไม่มีวันที่ (ใช้วันนี้)
 *   ซึ่งเดิม `toLocaleDateString` = `6/11/2569` ไม่เติมศูนย์ — ตอนนี้ `06/11/2569` เท่าวันที่อื่นบนใบเดียวกัน
 */
describe("D161 — วันที่บนเอกสารขายตามรูปแบบที่ลูกค้าเลือก", () => {
  it("ไม่ตั้ง = 06/11/2569 เท่าเดิม (HTML เท่ากับตั้งเป็น dd_mm_yyyy_be ทุกชนิด)", () => {
    for (const dt of DOC_TYPES) {
      expect(salesDocsHtml(COMPANY, vatOrder(3), ITEMS, [dt]), dt)
        .toBe(salesDocsHtml({ ...COMPANY, dateFormat: "dd_mm_yyyy_be" }, vatOrder(3), ITEMS, [dt]));
    }
    expect(salesDocsHtml(COMPANY, vatOrder(0), ITEMS, ["tax-invoice-receipt"])).toContain("05/11/2569"); // docDate2 ของ fixture
  });

  it("เลือกรูปแบบอื่น → ทุกวันที่บนใบเปลี่ยน ไม่เหลือรูปแบบเดิม", () => {
    const C = { ...COMPANY, dateFormat: "d_mon_yyyy" as const };
    for (const dt of DOC_TYPES) {
      const html = salesDocsHtml(C, vatOrder(3), ITEMS, [dt]);
      expect(html, dt).not.toMatch(/\d{2}\/\d{2}\/25\d\d/);
    }
    expect(salesDocsHtml(C, vatOrder(0), ITEMS, ["tax-invoice-receipt"])).toContain("5 พ.ย. 2569");
    const plan = salesDocsHtml(C, planned(vatOrder(3), true), ITEMS, ["invoice-installment:1"]);
    expect(plan).toContain("1 พ.ย. 2569");
    expect(plan).not.toMatch(/\d{2}\/\d{2}\/25\d\d/);
  });
});

describe("D161 — ใบเสนอราคา + ใบลดหนี้", () => {
  const Q: QuotationDoc = {
    quNo: "QU1", dateISO: "2026-11-06", quExp: "30", customerName: "ลูกค้า", customerAddress: "", customerTaxId: "", customerBranch: "",
    creditTerm: 30, items: ITEMS, subTotal: 2140, discount: 0, subDiscount: 2140, vat: 149.8, grandTotal: 2289.8,
    whtPercent: 0, whtAmount: 0, netPayable: 2289.8, remarks: "", saleName: "",
  };
  const CN: CreditNoteDoc = {
    cnNo: "CN-1", cnDate: "2026-11-06", reasonText: "คืนสินค้า", refs: [{ docNo: "TAX-1", date: "2026-10-28", preVat: 1000, vat: 70 }],
    original: 1000, correct: 500, diff: 500, vat: 35, total: 535, refund: 535, wht: 0, refundAccount: "",
  };
  it("ไม่ตั้ง = 06/11/2569 (เท่า formatThaiDate เดิม)", () => {
    expect(quotationHtml(COMPANY, Q)).toContain("06/11/2569");
    const cn = creditNoteDocsHtml(COMPANY, vatOrder(0), ITEMS, CN);
    expect(cn).toContain("06/11/2569");
    expect(cn).toContain("TAX-1 (28/10/2569)");
  });
  it("ตั้งเป็น ISO → วันที่ใบ + วันที่ใบกำกับที่อ้างอิงเปลี่ยนตาม", () => {
    const C = { ...COMPANY, dateFormat: "iso" as const };
    expect(quotationHtml(C, Q)).toContain("2026-11-06");
    expect(quotationHtml(C, Q)).not.toContain("06/11/2569");
    const cn = creditNoteDocsHtml(C, vatOrder(0), ITEMS, CN);
    expect(cn).toContain("TAX-1 (2026-10-28)");
    expect(cn).not.toMatch(/\d{2}\/\d{2}\/25\d\d/);
  });
});
