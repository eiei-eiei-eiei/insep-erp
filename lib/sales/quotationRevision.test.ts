import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { originalDateOnRevision, quotationDocDate, revisionLabel, revisionLabelEng } from "./quotationRevision";
import { quotationHtml, type QuotationDoc } from "@/app/(app)/sales/_components/print";
import { COMPANY, ITEMS } from "./salesDocHtml.fixtures";

/**
 * golden S26 — ฉบับแก้ไขของใบเสนอราคา (D168)
 * เลข QU เดิมได้ (ใบเสนอราคาไม่ใช่เอกสารภาษี) แต่ใบที่แก้แล้วต้องแยกออกจากฉบับแรกได้บนกระดาษ
 */
const R = (rev: number, revOn = "2026-11-14", createdOn = "2026-11-01") => ({ rev, revOn, createdOn });

describe("S26 ข้อความ + วันที่", () => {
  it("ฉบับแรก = ไม่มีป้าย · วันที่สร้าง · ไม่มีบรรทัดฉบับแรก", () => {
    expect(revisionLabel(0)).toBe("");
    expect(revisionLabelEng(0)).toBe("");
    expect(quotationDocDate(R(0))).toBe("2026-11-01");
    expect(originalDateOnRevision(R(0))).toBe("");
  });
  it("ฉบับแก้ไข = ป้ายครั้งที่ N · ลงวันที่ของฉบับนั้น · บอกวันที่ฉบับแรก", () => {
    expect(revisionLabel(2)).toBe("ฉบับแก้ไขครั้งที่ 2");
    expect(revisionLabelEng(2)).toBe("Revision 2");
    expect(quotationDocDate(R(2))).toBe("2026-11-14");
    expect(originalDateOnRevision(R(2))).toBe("2026-11-01");
  });
  it("ฉบับแก้ไขที่ไม่รู้วันที่ → ใช้วันที่สร้าง ไม่เดา", () => {
    expect(quotationDocDate(R(1, ""))).toBe("2026-11-01");
  });
});

describe("S26 บนกระดาษ", () => {
  const Q: QuotationDoc = {
    quNo: "QU1", dateISO: "2026-11-14", quExp: "-", customerName: "ลูกค้า", customerAddress: "", customerTaxId: "", customerBranch: "",
    creditTerm: 30, items: ITEMS, subTotal: 2000, discount: 0, subDiscount: 2000, vat: 140, grandTotal: 2140,
    whtPercent: 0, whtAmount: 0, netPayable: 2140, remarks: "", saleName: "",
  };
  const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  it("ฉบับแรก: HTML เท่ากับไม่ส่งช่องฉบับแก้ไขเลย (ใบเดิมไม่ขยับ)", () => {
    expect(quotationHtml(COMPANY, { ...Q, revision: 0, originalDateISO: "" })).toBe(quotationHtml(COMPANY, Q));
    expect(text(quotationHtml(COMPANY, Q))).not.toContain("ฉบับแก้ไข");
  });
  it("ฉบับแก้ไขครั้งที่ 2: ป้ายใต้เลขที่ · วันที่ฉบับนี้ · ฉบับแรกลงวันที่ · ชื่อไฟล์แยกจากฉบับแรก", () => {
    const h = quotationHtml(COMPANY, { ...Q, revision: 2, originalDateISO: "2026-11-01" });
    const t = text(h);
    expect(t).toContain("เลขที่ / Quotation No. QU1 ฉบับแก้ไขครั้งที่ 2 / Revision 2 วันที่ / Date 14/11/2569 ฉบับแรกลงวันที่ / Original 01/11/2569");
    expect(h).toContain('data-doc-title="ใบเสนอราคา ฉบับแก้ไขครั้งที่ 2"');
  });
  it("ฉบับแก้ไขที่ถูกยกเลิก: ยังบอกครั้งที่ + ตรายกเลิก", () => {
    const h = quotationHtml(COMPANY, { ...Q, revision: 1, originalDateISO: "2026-11-01", cancelled: true });
    expect(h).toMatch(/data-doc-title="ใบเสนอราคา ฉบับแก้ไขครั้งที่ 1 \(/);
  });
});

describe("S26 ต่อสาย", () => {
  it("พิมพ์ซ้ำจากหน้าจัดการออเดอร์ส่งฉบับ + วันที่ของฉบับ (ไม่ใช่วันที่สร้างตรง ๆ)", () => {
    const src = readFileSync("app/(app)/sales/_components/OrdersTab.tsx", "utf8");
    const block = src.slice(src.indexOf("printQuotation(boot.company"), src.indexOf("printQuotation(boot.company") + 600);
    expect(block).toMatch(/dateISO: quotationDocDate\(/);
    expect(block).toContain("revision: o.quRev");
    expect(block).toMatch(/originalDateISO: originalDateOnRevision\(/);
  });
  it("updateQuotationAction ปิดรอบหลังบันทึกแผนงวด (แก้แค่งวดก็ต้องนับ)", () => {
    const src = readFileSync("app/(app)/sales/actions.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function updateQuotationAction"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    const plan = body.indexOf("savePlanAfter(");
    const close = body.indexOf('"fn_quotation_close_revision"');
    expect(plan).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(plan);
  });
  it("ลายนิ้วมือใน SQL ครอบ หัวออเดอร์ + รายการ + แผนงวด", () => {
    const sql = readFileSync("supabase/migrations/20261114000110_quotation_revision.sql", "utf8");
    const fp = sql.slice(sql.indexOf("create or replace function fn_quotation_fingerprint"), sql.indexOf("create or replace function fn_update_quotation"));
    for (const t of ["from sales_orders", "from sales_order_items", "from sales_installments"]) expect(fp, t).toContain(t);
  });
});
