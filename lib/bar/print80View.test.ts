import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { receiptSheetCss, receiptCss } from "./print80";

/** D106 — แผ่นบิลบนจอสำหรับคัดลอกเป็นภาพ / แชร์ */
describe("receiptSheetCss", () => {
  it("80 มม.: แผ่นกว้างเท่าม้วน ขอบข้างละ 4 มม. (80 − 72)/2", () => {
    const css = receiptSheetCss(80);
    expect(css).toContain("width: 80mm");
    expect(css).toContain("padding: 3mm 4mm 6mm");
  });
  it("58 มม.: ขอบข้างละ 5 มม. (58 − 48)/2", () => {
    const css = receiptSheetCss(58);
    expect(css).toContain("width: 58mm");
    expect(css).toContain("padding: 3mm 5mm 6mm");
  });
  it("🚨 อยู่ใน @media screen ทั้งก้อน — กระดาษที่พิมพ์ต้องไม่ถูกแตะ", () => {
    const css = receiptSheetCss(80).trim();
    expect(css.startsWith("@media screen {")).toBe(true);
    expect(css.endsWith("}")).toBe(true);
    expect(css).not.toContain("@media print");
  });
  it("🚨 CSS กระดาษเดิมไม่เปลี่ยน (body ยังกว้างเท่าส่วนที่พิมพ์ได้)", () => {
    expect(receiptCss(80)).toContain("width: 72mm");
    expect(receiptCss(58)).toContain("width: 48mm");
  });
});

/** อ่านซอร์สทั้งโปรเจกต์ — แถบปุ่มต้องมีที่เดียว (ขายกับบาร์ใช้ตัวเดียวกัน) */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("🚨 ตัวแสดงเอกสารมีชุดเดียว (D106)", () => {
  it("คลาส .dv-bar ถูกนิยามที่ lib/shared/docViewer.ts ที่เดียว", () => {
    const root = process.cwd();
    const hits = [...walk(path.join(root, "app")), ...walk(path.join(root, "lib"))].filter((f) =>
      readFileSync(f, "utf8").includes(".dv-bar {"),
    );
    expect(hits.map((f) => path.relative(root, f).replace(/\\/g, "/"))).toEqual(["lib/shared/docViewer.ts"]);
  });
  it("บาร์และขายเรียก mountDocViewer จาก lib/shared ทั้งคู่", () => {
    const bar = readFileSync("lib/bar/print80.ts", "utf8");
    const sales = readFileSync("app/(app)/sales/_components/print.ts", "utf8");
    expect(bar).toMatch(/from "\.\.\/shared\/docViewer"/);
    expect(sales).toMatch(/from "@\/lib\/shared\/docViewer"/);
  });
  it("สลิปเงินเดือนก็เรียก mountDocViewer จาก lib/shared (ไม่ก๊อปแถบปุ่มไปอีกชุด)", () => {
    const slip = readFileSync("lib/payroll/slip.ts", "utf8");
    expect(slip).toMatch(/from "\.\.\/shared\/docViewer"/);
  });
});
