import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { installmentTag, isGenericInstallmentLabel, planDocRows, planMainLine, BALANCE_TAG } from "./planDocTable";
import { legacyDepositError, LEGACY_DEPOSIT_MSG } from "./installments";
import { reverseCalcPrint } from "./calc";
import { salesDocsHtml } from "@/app/(app)/sales/_components/print";
import { COMPANY, vatOrder, nonVatOrder, planned } from "./salesDocHtml.fixtures";

/**
 * golden S27 — เอกสารของออเดอร์แบ่งงวด (D170)
 * ตารางมีบรรทัดเงินบรรทัดเดียว = งวดนี้/ยอดคงค้าง · รายการตามใบเสนอราคามีแค่จำนวน
 * + เลิกโฟลว์มัดจำแบบเดิม (เหลือแค่แบ่งงวด)
 */
const ITEMS = [{ name: "สุราขาวสยาม 40 ดีกรี 700ml", qty: 4, price: 535 }, { name: "ค่าที่ปรึกษา", qty: 1, price: 0 }];
const NON = { ...COMPANY, isVat: false };
const text = (h: string) => h.split("(สำเนา")[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const table = (h: string) => text(h).match(/ลำดับ รายการ .*?(?=ช่องทางการโอนเงิน|การชำระเงินจะสมบูรณ์)/)?.[0] ?? "";

describe("S27 ป้ายงวด + แถวตาราง", () => {
  it("ป้ายงวด: ครั้งที่/ทั้งหมด + ชื่อ + (%) · ไม่มี % / ชื่อว่าง = ไม่พิมพ์", () => {
    expect(installmentTag(1, 2, "มัดจำ", 50)).toBe("งวดที่ 1/2 มัดจำ (50%)");
    expect(installmentTag(2, 3, " ", null)).toBe("งวดที่ 2/3");
    expect(installmentTag(1, 2, "ก", 28.0374)).toBe("งวดที่ 1/2 ก (28.04%)");
  });
  it("D171 ชื่องวดที่เป็นแค่ \"งวดที่ N\" ไม่พิมพ์ซ้ำ (เคสที่ผู้ใช้เจอ)", () => {
    expect(installmentTag(1, 3, "งวดที่1", 33.33)).toBe("งวดที่ 1/3 (33.33%)");
    for (const l of ["งวดที่1", "งวดที่ 2", " งวด3 ", "งวด 10"]) expect(isGenericInstallmentLabel(l), l).toBe(true);
    for (const l of ["มัดจำ", "งวดสุดท้าย", "ส่งมอบงานเฟส 1", "งวดที่ 1 มัดจำ", ""]) expect(isGenericInstallmentLabel(l), l).toBe(false);
  });
  it("D171 คำกลาง: ชำระ… ตามใบเสนอราคา (ไม่ใช่ ค่าสินค้า — ใช้กับค่าที่ปรึกษาได้)", () => {
    expect(planMainLine(" QU2611-002 ", "งวดที่ 1/3 (33.33%)")).toBe("ชำระงวดที่ 1/3 (33.33%) ตามใบเสนอราคา QU2611-002");
    expect(planMainLine("QU1", BALANCE_TAG)).toBe("ชำระยอดคงค้าง ตามใบเสนอราคา QU1");
  });
  it("บรรทัดเงินบรรทัดเดียว · รายการมีแค่จำนวน · ไม่มีรายการ = ไม่มีหัว", () => {
    const rows = planDocRows({ quNo: "QU1", tag: "งวดที่ 1/2", value: 934.58, items: ITEMS });
    expect(rows).toEqual([
      { kind: "main", no: 1, name: "ชำระงวดที่ 1/2 ตามใบเสนอราคา QU1", qty: 1, unit: 934.58, amount: 934.58 },
      { kind: "head", name: "รายการตามใบเสนอราคา:" },
      { kind: "item", name: "สุราขาวสยาม 40 ดีกรี 700ml", qty: 4 },
      { kind: "item", name: "ค่าที่ปรึกษา", qty: 1 },
    ]);
    expect(planDocRows({ quNo: "QU1", tag: BALANCE_TAG, value: 1, items: [] })).toHaveLength(1);
  });
});

describe("S27 บนกระดาษ (จด VAT)", () => {
  it("ใบกำกับรายงวด: บรรทัดเงิน = มูลค่างวดก่อน VAT · รายการครบไม่มีราคา · กรอบสรุปเฉพาะงวด · VAT ตัวเดียว", () => {
    const h = salesDocsHtml(COMPANY, planned(vatOrder(3), true), ITEMS, ["tax-invoice-installment:1"]);
    const v = reverseCalcPrint(1000, 3, true);
    expect(table(h)).toBe(
      `ลำดับ รายการ จำนวน หน่วยละ (ก่อน VAT) จำนวนเงิน (ก่อน VAT) 1 ชำระงวดที่ 1/2 มัดจำ (50%) ตามใบเสนอราคา QU-T1 1 961.54 961.54 ` +
      `รายการตามใบเสนอราคา: · สุราขาวสยาม 40 ดีกรี 700ml 4 · ค่าที่ปรึกษา 1 `,
    );
    expect(v.preVat).toBe(961.54);
    const t = text(h);
    expect(t).toContain("มูลค่างวดนี้ (ก่อน VAT) 961.54 ภาษีมูลค่าเพิ่ม 7% 67.31 หัก ณ ที่จ่าย 3% -28.85 ยอดรับงวดนี้ 1,000.00");
    expect(t).toContain("ยอดตามสัญญา (สุทธิ) 2,080.00 รับชำระแล้วก่อนหน้า 0.00 คงเหลือหลังงวดนี้ 1,080.00");
    expect(t.match(/ภาษีมูลค่าเพิ่ม/g)).toHaveLength(1); // 🚨 VAT ตัวเดียวบนใบกำกับ
    expect(t).not.toContain("2,000.00"); // ไม่มีมูลค่าทั้งสัญญาก่อน VAT ในตาราง/กรอบ
  });
  it("ใบแจ้งหนี้รายงวด: ยอดเรียกเก็บงวดนี้ = ยอดงวด · ตัวเลขเท่าใบกำกับของงวดเดียวกัน", () => {
    const t = text(salesDocsHtml(COMPANY, planned(vatOrder(0), true), ITEMS, ["invoice-installment:1"]));
    expect(t).toContain("1 ชำระงวดที่ 1/2 มัดจำ (50%) ตามใบเสนอราคา QU-T1 1 934.58 934.58");
    expect(t).toContain("มูลค่างวดนี้ (ก่อน VAT) 934.58 ภาษีมูลค่าเพิ่ม 7% 65.42 ยอดเรียกเก็บงวดนี้ 1,000.00");
    expect(t).toContain("ยอดตามสัญญา (รวม VAT) 2,140.00");
  });
  it("ใบแจ้งหนี้/ใบส่งสินค้าของออเดอร์แบ่งงวด: รูปแบบเดียวกัน บรรทัดเงิน = ยอดคงค้าง", () => {
    const t = text(salesDocsHtml(COMPANY, { ...planned(vatOrder(0), true), invNo: "INV-S", invPaidBefore: 1000 }, ITEMS, ["invoice"]));
    expect(t).toContain("1 ชำระยอดคงค้าง ตามใบเสนอราคา QU-T1 1 1,065.42 1,065.42 รายการตามใบเสนอราคา: · สุราขาวสยาม 40 ดีกรี 700ml 4");
    expect(t).toContain("มูลค่ายอดคงค้าง (ก่อน VAT) 1,065.42 ภาษีมูลค่าเพิ่ม 7% 74.58 ยอดค้างชำระ 1,140.00");
    expect(t).toContain("รับชำระแล้ว 1,000.00");
  });
});

describe("S27 ผู้ไม่จด VAT", () => {
  it("ไม่มีคำว่า VAT · บรรทัดเงิน = ยอดงวดเต็ม", () => {
    const h = salesDocsHtml(NON, planned(nonVatOrder(0), false), ITEMS, ["tax-invoice-installment:1"]);
    const t = text(h);
    expect(t).not.toMatch(/VAT|ภาษีมูลค่าเพิ่ม|ใบกำกับภาษี/);
    expect(t).toContain("1 ชำระงวดที่ 1/2 มัดจำ (50%) ตามใบเสนอราคา QU-T1 1 1,000.00 1,000.00");
    expect(t).toContain("มูลค่างวดนี้ 1,000.00 ยอดรับงวดนี้ 1,000.00");
  });
});

describe("S27 ออเดอร์ที่ไม่ได้แบ่งงวดไม่เปลี่ยน", () => {
  it("ใบแจ้งหนี้/ใบกำกับของออเดอร์จ่ายครั้งเดียว: ตารางรายการเต็มแบบเดิม ไม่มีบรรทัด ชำระ… ตามใบเสนอราคา", () => {
    for (const dt of ["invoice", "tax-invoice-receipt", "tax-invoice-receipt-do", "invoice-only"]) {
      const t = text(salesDocsHtml(COMPANY, vatOrder(0), ITEMS, [dt]));
      expect(t, dt).not.toContain("ตามใบเสนอราคา QU");
      expect(t, dt).toContain("สุราขาวสยาม 40 ดีกรี 700ml 4 500.00 2,000.00");
    }
  });
});

describe("S27 เลิกโฟลว์มัดจำแบบเดิม", () => {
  it("ใบแจ้งหนี้มัดจำใหม่ = ปฏิเสธเสมอ · รับมัดจำจากรอคอนเฟิร์ม = ปฏิเสธ · ออเดอร์กลางทาง (รอชำระมัดจำ) ทำต่อได้", () => {
    expect(legacyDepositError("ISSUE_INVOICE_DEPOSIT", "รอคอนเฟิร์ม")).toBe(LEGACY_DEPOSIT_MSG);
    expect(legacyDepositError("DEPOSIT_AND_SEND", "รอคอนเฟิร์ม")).toBe(LEGACY_DEPOSIT_MSG);
    expect(legacyDepositError("DEPOSIT_AND_SEND", "รอชำระมัดจำ")).toBeNull();
    for (const a of ["ISSUE_INVOICE_FULL", "SEND_TO_WH", "FULL_PAYMENT_AND_SEND", "PAY_BALANCE", "RECEIVE_INSTALLMENT"]) {
      expect(legacyDepositError(a, "รอคอนเฟิร์ม"), a).toBeNull();
    }
  });
  it("server ตรวจก่อนทำ action · หน้าจอไม่มีปุ่มมัดจำเดิมในสถานะรอคอนเฟิร์ม และบอกทางแทน", () => {
    const act = readFileSync("app/(app)/sales/actions.ts", "utf8");
    expect(act).toMatch(/legacyDepositError\(action, order\.status\)/);
    const ui = readFileSync("app/(app)/sales/_components/OrdersTab.tsx", "utf8");
    const block = ui.slice(ui.indexOf('o.status === "รอคอนเฟิร์ม" && !hasPlan(o)'), ui.indexOf('o.status === "รอชำระมัดจำ" && !hasPlan(o)'));
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toContain('"ISSUE_INVOICE_DEPOSIT"');
    expect(block).not.toContain('"DEPOSIT_AND_SEND"');
    expect(block).toContain("DEPOSIT_HINT");
  });
});
