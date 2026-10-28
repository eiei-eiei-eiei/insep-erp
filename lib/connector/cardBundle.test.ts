/**
 * C6 — การ์ดตรวจบิล (MCP App · D141): ไฟล์ที่ฝังไว้ต้องตรงกับซอร์ส + กติกาที่ TS มองไม่เห็น
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BILL_CARD_HTML } from "./card/billCard.generated";

const ROOT = path.resolve(__dirname, "../..");
const src = (rel: string) =>
  readFileSync(path.join(ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

describe("C6 — การ์ดตรวจบิล", () => {
  it("🚨 billCard.generated.ts ตรงกับที่ build จากซอร์สตอนนี้ (แก้การ์ดแล้วลืม npm run gen:bill-card = เทสแดง)", async () => {
    const gen = await import(pathToFileURL(path.join(ROOT, "scripts/gen/gen-bill-card.mjs")).href);
    const fresh = gen.moduleSource(await gen.buildBillCardHtml());
    const committed = readFileSync(path.join(ROOT, "lib/connector/card/billCard.generated.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(committed === fresh, "ไฟล์การ์ดเก่ากว่าซอร์ส — รัน npm run gen:bill-card").toBe(true);
  }, 60_000);

  it("ไฟล์เดียวจบ: ไม่โหลดสคริปต์/สไตล์จากภายนอก (CSP ของ Claude ปิดทุก origin)", () => {
    expect(BILL_CARD_HTML).not.toMatch(/<script[^>]+src=/i);
    expect(BILL_CARD_HTML).not.toMatch(/<link[^>]+href=/i);
    expect(BILL_CARD_HTML).not.toMatch(/import\s*\(?\s*["']https?:/);
    expect(BILL_CARD_HTML).toMatch(/<div id="root">/);
  });

  it("ขนาดไม่บวมเกิน (ใช้ app-with-deps ที่ย่อแล้ว ไม่ลาก zod เต็มก้อน)", () => {
    expect(BILL_CARD_HTML.length).toBeLessThan(450_000);
  });

  it("🚨 การ์ดไม่คิดเงินเอง — ไม่มี 0.07/1.07/round ของยอด · ตัวเลขทุกตัวมาจาก recalc_bill", () => {
    const s = src("lib/connector/card/billCard.ts");
    expect(s).not.toMatch(/1\.07|0\.07|\* *7 *\/ *100|entryCalc/);
    expect(s).toMatch(/name: "recalc_bill"/);
  });

  it("การ์ดเรียก save_bill จุดเดียว และส่ง tenant_slug ไปด้วยเสมอ", () => {
    const s = src("lib/connector/card/billCard.ts");
    expect(s.match(/name: "save_bill"/g)?.length).toBe(1);
    expect(s).toMatch(/name: "save_bill",\s*arguments: \{ tenant_slug: data\.tenant_slug/);
  });

  it("ปุ่ม/ข้อความตัดสินที่ cardView (ไม่แต่งเงื่อนไขในการ์ด)", () => {
    expect(src("lib/connector/card/billCard.ts")).toMatch(/primaryAction\(/);
  });

  it("preview_bill ผูกการ์ด · recalc_bill มองเห็นเฉพาะการ์ด (Claude เรียกไม่ได้)", () => {
    const s = src("lib/connector/tools.ts");
    const preview = s.slice(s.indexOf('"preview_bill"'), s.indexOf('"recalc_bill"'));
    expect(preview).toMatch(/resourceUri: BILL_CARD_URI/);
    const recalc = s.slice(s.indexOf('"recalc_bill"'), s.indexOf("registerAppResource("));
    expect(recalc).toMatch(/visibility: \["app"\]/);
    expect(recalc).not.toMatch(/fn_save_transaction/);
  });
});
