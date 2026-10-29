/**
 * C6 — เครื่องมือปิดเดือนของ connector (D141 รอบ 6): ตัวตรวจค่าที่ Claude ส่งมา + กติกาอ่านอย่างเดียว
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { monthArg, dateArg, matchesAmount } from "./reports";

const ROOT = path.resolve(__dirname, "../..");
const code = (rel: string) =>
  readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

describe("C6 — monthArg / dateArg", () => {
  it("รับ ค.ศ. YYYY-MM", () => {
    expect(monthArg("2026-09")).toBe("2026-09");
    expect(monthArg(" 2026-12 ")).toBe("2026-12");
  });
  it("🚨 ปี พ.ศ. ถูกปฏิเสธ ไม่เดาลบ 543", () => {
    expect(monthArg("2569-09")).toBeNull();
    expect(dateArg("2569-09-01")).toBeNull();
  });
  it("รูปแบบผิด/เดือนไม่มีจริง = null", () => {
    for (const v of ["2026-13", "2026-00", "2026-9", "09/2026", "", null, undefined]) expect(monthArg(v)).toBeNull();
  });
  it("dateArg ปฏิเสธวันที่ไม่มีจริง (31 พ.ย. · 29 ก.พ. ปีปกติ)", () => {
    expect(dateArg("2026-11-30")).toBe("2026-11-30");
    expect(dateArg("2026-11-31")).toBeNull();
    expect(dateArg("2027-02-29")).toBeNull();
    expect(dateArg("2028-02-29")).toBe("2028-02-29");
  });
});

describe("C6 — matchesAmount (statement ธนาคาร = ยอดสุทธิ · คนค้นด้วยยอดบนบิล)", () => {
  it("ตรงยอดสุทธิหรือยอดก่อน VAT ±0.01", () => {
    expect(matchesAmount(1166.36, 1166.36, 1121.5)).toBe(true);
    expect(matchesAmount(1121.5, 1166.36, 1121.5)).toBe(true);
    expect(matchesAmount(1166.37, 1166.36, 1121.5)).toBe(true);
    expect(matchesAmount(1166.38, 1166.36, 1121.5)).toBe(false);
  });
  it("ไม่สนเครื่องหมาย (statement บางธนาคารแสดงเงินออกเป็นลบ)", () => {
    expect(matchesAmount(-500, 500, 467.29)).toBe(true);
  });
});

describe("C6 — 🚨 เครื่องมือปิดเดือนอ่านอย่างเดียว และใช้ตัวโหลดเดียวกับหน้าเว็บ", () => {
  const s = code("lib/connector/tools.ts");
  const body = (name: string) => {
    const a = s.indexOf(`"${name}",`);
    expect(a, name).toBeGreaterThan(0);
    const b = s.slice(a + 1).search(/\n  (server\.registerTool|registerAppTool|registerAppResource|const contactShape)/);
    return s.slice(a, a + 1 + b);
  };

  it.each(["account_statement", "search_transactions", "tax_report"])("%s: readOnlyHint · ไม่มี rpc/insert/update/delete", (n) => {
    const b = body(n);
    expect(b).toMatch(/readOnlyHint: true/);
    expect(b).not.toMatch(/\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    expect(b).not.toMatch(/visibility: \["app"\]/); // Claude ต้องเรียกเองได้
  });

  it("ตัวเลขมาจาก reportLoaders (ไม่ประกอบรายงานภาษีชุดที่สอง · D81)", () => {
    expect(body("account_statement")).toMatch(/statementFor\(db,/);
    expect(body("search_transactions")).toMatch(/fetchAllTransactions\(db,/);
    expect(body("tax_report")).toMatch(/taxReportBundleFor\(db,/);
    expect(body("tax_report")).toMatch(/missingInvoicesFor\(db,/);
    // ห้ามคิด VAT เองในเครื่องมือ
    expect(body("tax_report")).not.toMatch(/\* ?0\.07|7 ?\/ ?100|1\.07/);
  });

  it("data.ts ของหน้าเว็บเรียกตัวโหลดตัวเดียวกัน (ไม่ใช่ก๊อปไว้คนละชุด)", () => {
    const d = code("app/(app)/accounting/data.ts");
    expect(d).toMatch(/statementFor\(await db\(\)/);
    expect(d).toMatch(/taxReportBundleFor\(await db\(\)/);
    expect(d).toMatch(/missingInvoicesFor\(await db\(\)/);
    expect(d).not.toMatch(/function fetchAllTransactions/);
  });

  it("reportLoaders ไม่แตะ service role", () => {
    expect(code("lib/accounting/reportLoaders.ts")).not.toMatch(/SERVICE_ROLE|createAdminClient|supabase\/admin/);
  });

  it("tax_report ถามสถานะยื่นจาก tax_filings (ไม่ใช่ report_runs · D95) และไม่นับแถวที่ถอนแล้ว", () => {
    const b = body("tax_report");
    expect(b).toMatch(/from\("tax_filings"\)/);
    expect(b).not.toMatch(/report_runs/);
    expect(b).toMatch(/!f\.reopened_at/);
  });
});

describe("C6 — money (ปัดตอนส่งออก)", () => {
  it("ตัดเศษ float ของยอดสะสม", async () => {
    const { money } = await import("./reports");
    expect(money(12181.220000000001)).toBe(12181.22);
    expect(money(1.005)).toBe(1.01);
    expect(money(-0.1 - 0.2)).toBe(-0.3);
    expect(money("x")).toBe(0);
  });
});
