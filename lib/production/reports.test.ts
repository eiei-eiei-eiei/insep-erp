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
