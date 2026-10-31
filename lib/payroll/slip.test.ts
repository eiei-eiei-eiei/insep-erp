import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  slipCompany,
  slipHtml,
  slipsDocument,
  slipDocTitle,
  slipWindowTitle,
  SLIP_ENTITY_NO_NAME,
  SLIP_ENTITY_READ_ERROR,
  SLIP_SHEET_CSS,
  type SlipData,
} from "./slip";
import { docImageFileName, docPageLabel } from "../shared/docImage";

const ENT = {
  entityId: "EID01",
  name: "บริษัท ทดสอบ จำกัด",
  taxId: "0105558123456",
  branch: "สำนักงานใหญ่",
  address: "5/15 ม.8 ต.ทดสอบ",
};

function slip(over: Partial<SlipData> = {}): SlipData {
  const c = slipCompany(ENT);
  if ("error" in c) throw new Error(c.error);
  return {
    ...c,
    periodLabel: "05/2026",
    empName: "สมชาย ใจดี",
    empId: "E001",
    baseLabel: "เงินเดือน",
    baseAmount: 15000,
    items: [],
    sso: 750,
    wht: 0,
    gross: 15000,
    net: 14250,
    ...over,
  };
}

describe("slipCompany — หัวสลิปมาจากข้อมูลกิจการ", () => {
  it("ชื่อ · สาขา+ที่อยู่ · เลขผู้เสียภาษี", () => {
    expect(slipCompany(ENT)).toEqual({
      companyName: "บริษัท ทดสอบ จำกัด",
      companyAddress: "(สำนักงานใหญ่) 5/15 ม.8 ต.ทดสอบ",
      companyTaxLine: "เลขประจำตัวผู้เสียภาษี 0105558123456",
    });
  });
  it("สาขาเป็นตัวเลข → (สาขาที่ 00001)", () => {
    const c = slipCompany({ ...ENT, branch: "00001" });
    expect("error" in c ? "" : c.companyAddress).toBe("(สาขาที่ 00001) 5/15 ม.8 ต.ทดสอบ");
  });
  it("ไม่มีที่อยู่/เลขภาษี = ไม่มีบรรทัดนั้น (ไม่ใช่บรรทัดว่าง)", () => {
    const c = slipCompany({ entityId: "EID01", name: "ร้านเล็ก" });
    expect(c).toEqual({ companyName: "ร้านเล็ก", companyAddress: undefined, companyTaxLine: undefined });
  });
  it("🚨 อ่านกิจการไม่ได้ → error พร้อมเหตุผล ไม่ใช่หัวเปล่า", () => {
    expect(slipCompany(null)).toEqual({ error: SLIP_ENTITY_READ_ERROR });
  });
  it("🚨 ยังไม่ตั้งชื่อ → บอกว่าไปตั้งที่ไหน · ห้าม fallback เป็นรหัสกิจการ", () => {
    expect(slipCompany({ ...ENT, name: "  " })).toEqual({ error: SLIP_ENTITY_NO_NAME });
    expect(SLIP_ENTITY_NO_NAME).toContain("ตั้งค่า → กิจการ");
  });
});

describe("slipHtml", () => {
  it("หัวสลิปพิมพ์ชื่อกิจการ ไม่ใช่รหัสกิจการ", () => {
    const html = slipHtml(slip());
    expect(html).toContain("บริษัท ทดสอบ จำกัด");
    expect(html).toContain("เลขประจำตัวผู้เสียภาษี 0105558123456");
    expect(html).not.toContain("EID01");
  });
  it("ป้าย/ชื่อไฟล์ภาพของแต่ละใบบอกชื่อพนักงาน + งวด", () => {
    const html = slipHtml(slip());
    expect(html).toContain('data-doc-title="สลิปเงินเดือน สมชาย ใจดี"');
    expect(html).toContain('data-doc-no="05/2026"');
    const label = docPageLabel(slipDocTitle(slip()));
    expect(docImageFileName(label, "05/2026", 0)).toBe("สลิปเงินเดือน_สมชาย_ใจดี_05-2026.png");
  });
  it("escape ชื่อพนักงาน", () => {
    expect(slipHtml(slip({ empName: 'a"<b>' }))).toContain("a&quot;&lt;b&gt;");
  });
});

describe("หน้าต่างสลิป", () => {
  it("ชื่อหน้าต่าง: คนเดียวบอกชื่อ · ทั้งงวดบอกจำนวนคน", () => {
    expect(slipWindowTitle([slip()])).toBe("สลิปเงินเดือน สมชาย ใจดี งวด 05/2026");
    expect(slipWindowTitle([slip(), slip({ empName: "สมหญิง" })])).toBe("สลิปเงินเดือน งวด 05/2026 (2 คน)");
  });
  it("เอกสารมีหัวของตัวแสดงเอกสาร (แถบ พิมพ์/คัดลอก/แชร์) + สลิปครบทุกใบ", () => {
    const doc = slipsDocument([slip(), slip({ empId: "E002", empName: "สมหญิง" })]);
    expect(doc).toContain(".dv-bar {");
    expect(doc.match(/class="slip"/g)).toHaveLength(2);
  });
  it("🚨 แผ่นบนจออยู่ใน @media screen ทั้งก้อน — กระดาษที่พิมพ์ไม่ถูกแตะ", () => {
    const css = SLIP_SHEET_CSS.trim();
    expect(css.startsWith("@media screen {")).toBe(true);
    expect(css).not.toContain("@media print");
  });
  it("🚨 1 คน = 1 หน้ากระดาษ แม้สลิปถูกห่อเป็นแผ่น (ทุกใบเป็น :last-child ของแผ่นตัวเอง)", () => {
    const doc = slipsDocument([slip()]);
    expect(doc).toMatch(/@media print \{ \.dv-sheet \{ break-after: page; \}/);
  });
});

describe("🚨 PeriodTab ใช้หัวสลิปจากกิจการ", () => {
  const src = readFileSync("app/(app)/payroll/_components/PeriodTab.tsx", "utf8");
  it("ห้ามเอารหัสกิจการไปเป็นชื่อบริษัทบนสลิป", () => {
    expect(src).not.toMatch(/companyName:\s*config\.entityId/);
    expect(src).toContain("slipCompany(entity)");
  });
  it("มีปุ่มสลิปรายคน", () => {
    expect(src).toContain("doPrint(it)");
  });
});
