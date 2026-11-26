import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { materialReport, productReport, productionReport, summaryReport } from "./reports";

/** golden จาก scripts/gen-report-golden.mjs (รันฟังก์ชันเดิมใน Reports.js บน fixture เดียวกัน) */
const g = JSON.parse(
  readFileSync(new URL("./__golden__/reports.json", import.meta.url), "utf8"),
);
const { entity, month, materialId, productId, db, expected } = g;

describe("รายงานผลิต ภส. — port ตรงระบบเดิม (P5/P6/P7)", () => {
  it("P6a ภส.๐๗-๐๑/๑ วัตถุดิบ (materialReport)", () => {
    expect(
      materialReport(month, materialId, entity, db.logMaterial, db.materials, db.products),
    ).toEqual(expected.material);
  });

  it("P6b ภส.๐๗-๐๒/๑(๒) สุราขวด (productReport)", () => {
    expect(
      productReport(month, productId, entity, db.logProduct, db.products),
    ).toEqual(expected.product);
  });

  it("P5 ภส.๐๗-๐๒/๑(๑) บัญชีผลิต (productionReport) — running balance ไหลข้าม", () => {
    expect(
      productionReport(month, productId, entity, db.products, db.logFerment, db.logDistill, db.logDilute, db.logProduct),
    ).toEqual(expected.production);
  });

  it("P7 ภส.๐๗-๐๔/๑ งบเดือน (summaryReport)", () => {
    expect(
      summaryReport(month, entity, db.materials, db.products, db.logMaterial, db.logProduct),
    ).toEqual(expected.summary);
  });
});

/**
 * D186 — ข้ามปี: "ยอดสะสมทั้งปี" นับเฉพาะ ม.ค. → เดือนรายงานของปีนั้น · "ยอดยกมา" รวมทุกปีก่อนหน้า
 * fixture มีแถว พ.ย./ธ.ค. ปีก่อน + ม.ค./ก.พ. ปีนี้ + มี.ค. (หลังเดือนรายงาน) · คาดหวังจาก Reports.js เดิม
 * (scripts/gen-report-golden.mjs → __golden__/reports-yearboundary.json)
 */
const yb = JSON.parse(
  readFileSync(new URL("./__golden__/reports-yearboundary.json", import.meta.url), "utf8"),
);

describe("D186 รายงาน ภส. ข้ามปี — ยอดสะสมรีเซ็ต ม.ค. · ยอดยกมาไม่รีเซ็ต (เทียบระบบเดิม)", () => {
  const d = yb.db;
  it("ภส.๐๗-๐๑/๑ วัตถุดิบ", () => {
    const r = materialReport(yb.month, yb.materialId, yb.entity, d.logMaterial, d.materials, d.products);
    expect(r).toEqual(yb.expected.material);
    // ตัวเลขที่ต้องเป็น (อ่านง่ายกว่า JSON): ยกมา 500−100+50 · สะสมปีนี้ไม่รวม ธ.ค. ปีก่อน · มี.ค. ไม่นับ
    expect([r.bfBalance, r.yearIn, r.yearOut]).toEqual([450, 50, 30]);
  });
  it("ภส.๐๗-๐๒/๑(๒) สุราขวด", () => {
    const r = productReport(yb.month, yb.productId, yb.entity, d.logProduct, d.products);
    expect(r).toEqual(yb.expected.product);
    expect([r.bfBalance, r.yearIn, r.yearOut]).toEqual([30, 30, 15]);
  });
  it("ภส.๐๗-๐๒/๑(๑) บัญชีผลิต", () => {
    expect(
      productionReport(yb.month, yb.productId, yb.entity, d.products, d.logFerment, d.logDistill, d.logDilute, d.logProduct),
    ).toEqual(yb.expected.production);
  });
  it("ภส.๐๗-๐๔/๑ งบเดือน", () => {
    expect(summaryReport(yb.month, yb.entity, d.materials, d.products, d.logMaterial, d.logProduct)).toEqual(yb.expected.summary);
  });
});
