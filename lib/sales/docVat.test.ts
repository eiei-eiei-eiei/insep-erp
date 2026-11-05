import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { amountsVat, docVatAtIssue, type DocVatSource } from "./docVat";

/**
 * golden S19 — เอกสารขายพิมพ์ซ้ำตามสถานะ VAT ณ ตอนออก (D154)
 * แต่ละเคสลองทั้งสองสถานะ "วันนี้" — หลักฐานกับเอกสารต้องชนะเสมอ
 */

const vatOrder: DocVatSource = { taxNo1: "", taxNo2: "", vatAmount: 22.9, grandTotal: 350 };
const nonVatOrder: DocVatSource = { taxNo1: "", taxNo2: "", vatAmount: 0, grandTotal: 350 };
const BOTH = [true, false];

describe("S19 amountsVat — ยอดบอกว่าตั้งราคาแบบไหน", () => {
  it("มี VAT ในยอด = แบบจด · ยอด > 0 แต่ VAT 0 = แบบไม่จด (ไม่สนสถานะวันนี้)", () => {
    for (const now of BOTH) {
      expect(amountsVat(vatOrder, now)).toBe(true);
      expect(amountsVat(nonVatOrder, now)).toBe(false);
    }
  });
  it("ยอด 0 ไม่มีหลักฐาน = สถานะวันนี้ (พฤติกรรมเดิม)", () => {
    for (const now of BOTH) expect(amountsVat({ vatAmount: 0, grandTotal: 0 }, now)).toBe(now);
  });
});

describe("S19 docVatAtIssue — ใบรับเงินดูช่องเลขก่อน", () => {
  it("ช่อง 1 มีเลข tax = ใบกำกับภาษี · มีเลข rcpt = ใบเสร็จ (ชนะยอดและสถานะวันนี้)", () => {
    for (const now of BOTH) {
      for (const dt of ["tax-invoice-deposit", "tax-invoice-receipt", "tax-invoice-receipt-do"]) {
        expect(docVatAtIssue(dt, { ...nonVatOrder, taxNo1: "TAX1" }, null, now), dt).toBe(true);
        expect(docVatAtIssue(dt, { ...vatOrder, rcptNo1: "RC1" }, null, now), dt).toBe(false);
      }
    }
  });
  it("ยอดค้างดูช่อง 2 ไม่ใช่ช่อง 1 (มัดจำตอนจด แล้วเลิกจดก่อนรับยอดค้าง)", () => {
    const o = { ...vatOrder, taxNo1: "TAX1", rcptNo2: "RC2" };
    expect(docVatAtIssue("tax-invoice-deposit", o, null, false)).toBe(true);
    expect(docVatAtIssue("tax-invoice-balance", o, null, true)).toBe(false);
    expect(docVatAtIssue("tax-invoice-balance", { ...nonVatOrder, taxNo2: "TAX2" }, null, false)).toBe(true);
  });
  it("🔴 เคสที่เจอจริง (QU260906-002): ใบเสร็จออกตอนไม่จด เลขอยู่ช่อง rcpt · วันนี้จดแล้ว → ต้องยังเป็นใบเสร็จ", () => {
    expect(docVatAtIssue("tax-invoice-receipt-do", { ...nonVatOrder, rcptNo1: "INV260906-001" }, null, true)).toBe(false);
  });
  it("ใบเสร็จก่อน D89 ที่ยืมเลข INV (ทั้งสองช่องว่าง) → ตัดสินจากยอด", () => {
    for (const now of BOTH) {
      expect(docVatAtIssue("tax-invoice-receipt-do", nonVatOrder, null, now)).toBe(false);
      expect(docVatAtIssue("tax-invoice-receipt", vatOrder, null, now)).toBe(true);
    }
  });
});

describe("S19 docVatAtIssue — ใบเสร็จรายงวด + เอกสารอื่น", () => {
  it("ใบเสร็จรายงวดเชื่อบิลของครั้งนั้น · ไม่รู้ = ตัดสินจากยอด", () => {
    for (const now of BOTH) {
      expect(docVatAtIssue("tax-invoice-installment:2", nonVatOrder, { txVat: true }, now)).toBe(true);
      expect(docVatAtIssue("tax-invoice-installment:2", vatOrder, { txVat: false }, now)).toBe(false);
      expect(docVatAtIssue("tax-invoice-installment:2", vatOrder, { txVat: null }, now)).toBe(true);
      expect(docVatAtIssue("tax-invoice-installment:2", nonVatOrder, null, now)).toBe(false);
    }
  });
  it("ใบแจ้งหนี้ทุกแบบตัดสินจากยอด ไม่อ่านช่องเลขใบรับเงิน", () => {
    for (const now of BOTH) {
      for (const dt of ["invoice", "invoice-only", "invoice-deposit", "invoice-installment:1"]) {
        expect(docVatAtIssue(dt, { ...nonVatOrder, taxNo1: "TAX1" }, null, now), dt).toBe(false);
        expect(docVatAtIssue(dt, { ...vatOrder, rcptNo1: "RC1" }, null, now), dt).toBe(true);
      }
    }
  });
  it("ใบที่เพิ่งออกตอนนี้ได้ผลเท่าเดิม: หลักฐานถูกเขียนด้วยสถานะปัจจุบัน", () => {
    expect(docVatAtIssue("tax-invoice-receipt-do", { ...vatOrder, taxNo1: "TAX1" }, null, true)).toBe(true);
    expect(docVatAtIssue("tax-invoice-receipt-do", { ...nonVatOrder, rcptNo1: "RC1" }, null, false)).toBe(false);
  });
});

describe("S19 ต่อสายครบ — ตัวพิมพ์ต้องใช้กฎนี้ (อ่านซอร์ส)", () => {
  const pr = readFileSync("app/(app)/sales/_components/print.ts", "utf8");
  it("setupDoc ตัดสินด้วย docVatAtIssue · ใบเสนอราคาด้วย amountsVat", () => {
    expect(pr).toMatch(/const isVat = docVatAtIssue\(docType, order, pay, currentIsVat\)/);
    expect(pr).toMatch(/const isVat = amountsVat\(\{ vatAmount: d\.vat, grandTotal: d\.grandTotal \}/);
  });
  it("🚨 ไม่มีที่ไหนใน print.ts ตัดสินจาก company.isVat ตรง ๆ อีก (เว้นส่งเป็นค่าสุดท้าย)", () => {
    const direct = pr.match(/const isVat = (c|company)\.isVat/g) ?? [];
    expect(direct).toEqual([]);
  });
  it("getOrderPayments เติม txVat จากบิลรายรับ", () => {
    const data = readFileSync("app/(app)/sales/data.ts", "utf8");
    expect(data).toMatch(/p\.txVat = vat\.get\(p\.txId\) \?\? null/);
  });
});
