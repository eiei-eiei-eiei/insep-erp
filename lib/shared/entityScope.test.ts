import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { entityScopeError, normalizeEntityScope, entityScopeLabel } from "./entityScope";

const ALL = ["EID01", "EID02", "EID03"];

describe("D120 — ตรวจค่าจำกัดกิจการ", () => {
  it("ทุกกิจการ (null) บันทึกได้เสมอ รวม main", () => {
    expect(entityScopeError("main", null, ALL)).toBeNull();
    expect(entityScopeError("finance_manager", null, ALL)).toBeNull();
  });
  it("🚨 main จำกัดไม่ได้ (แก้ profile ตัวเองคืนได้อยู่แล้ว)", () => {
    expect(entityScopeError("main", ["EID01"], ALL)).toMatch(/main/);
  });
  it("🚨 array ว่างบันทึกไม่ได้ (RLS กับ bar_guard ตีความขัดกัน)", () => {
    expect(entityScopeError("accounting", [], ALL)).toMatch(/อย่างน้อย 1/);
  });
  it("กิจการที่ไม่มีอยู่จริง = error บอกรหัส", () => {
    expect(entityScopeError("accounting", ["EID01", "EID09"], ALL)).toMatch(/EID09/);
  });
  it("ค่าปกติผ่าน", () => {
    expect(entityScopeError("accounting", ["EID01"], ALL)).toBeNull();
  });
});

describe("D120 — ค่าที่เก็บจริง", () => {
  it("ตัดซ้ำ + เรียง", () => {
    expect(normalizeEntityScope(["EID02", "EID01", "EID02"], ALL)).toEqual(["EID01", "EID02"]);
  });
  it("🪤 เลือกครบทุกกิจการ = null (กิจการที่เพิ่มทีหลังก็เห็น)", () => {
    expect(normalizeEntityScope(["EID03", "EID01", "EID02"], ALL)).toBeNull();
  });
  it("null คงเป็น null", () => {
    expect(normalizeEntityScope(null, ALL)).toBeNull();
  });
});

describe("D120 — ป้าย", () => {
  const ents = [{ entity_id: "EID01", name: "บริษัท เอม" }, { entity_id: "EID02", name: "ส่วนตัว" }];
  it("null / ว่าง = ทุกกิจการ", () => {
    expect(entityScopeLabel(null, ents)).toBe("ทุกกิจการ");
    expect(entityScopeLabel([], ents)).toBe("ทุกกิจการ");
  });
  it("มีชื่อ = รหัส — ชื่อ · ไม่มีชื่อ = รหัสอย่างเดียว", () => {
    expect(entityScopeLabel(["EID01", "EID09"], ents)).toBe("EID01 — บริษัท เอม · EID09");
  });
});

/**
 * 🚨 ฝาแฝด TS ↔ SQL (แพตเทิร์น rolesSql/tenantTables) — ด่านกิจการอยู่ใน SQL ที่ TS มองไม่เห็น
 * ลบด่านออกจาก RPC ตัวไหน = ผู้ใช้ที่ถูกจำกัดจ่ายภาษี/ลงบัญชีเงินเดือนเข้ากิจการที่มองไม่เห็นได้เงียบ ๆ
 */
describe("D120 — migration 0087 ครอบทุกจุดที่ประกาศไว้", () => {
  const sql = readFileSync("supabase/migrations/20261022000087_entity_scope_gaps.sql", "utf8").replace(/\r\n/g, "\n");
  const fnBody = (name: string) => {
    const s = sql.indexOf(`create or replace function ${name}(`);
    expect(s, `ไม่พบ ${name} ใน 0087`).toBeGreaterThan(-1);
    const next = sql.indexOf("create or replace function ", s + 10);
    return sql.slice(s, next < 0 ? undefined : next);
  };
  for (const fn of ["fn_pay_tax", "fn_unpay_tax", "fn_post_payroll", "fn_unpost_payroll", "fn_wht_doc_nos"]) {
    it(`${fn} มีด่าน my_entities()`, () => {
      expect(fnBody(fn)).toMatch(/my_entities\(\) is (not )?null/);
    });
  }
  for (const [table, pol] of [
    ["bank_accounts", "bank_accounts_sel"], ["bank_accounts", "bank_accounts_w"],
    ["transaction_items", "ti_w"], ["tax_summaries", "ts_w"], ["wht_certificates", "wht_w"],
    ["report_runs", "report_runs_sel"], ["report_runs", "report_runs_w"],
    ["payroll_items", "pi_sel"], ["payroll_items", "pi_w"],
  ] as const) {
    it(`policy ${pol} บน ${table} กรองกิจการ`, () => {
      const s = sql.indexOf(`create policy ${pol} on ${table}`);
      expect(s, `ไม่พบ policy ${pol}`).toBeGreaterThan(-1);
      const end = sql.indexOf(";", s);
      expect(sql.slice(s, end)).toMatch(/my_entities\(\)/);
    });
  }
  it("wht_w ยังคงเงื่อนไข emp_id ของ 0052 (ฝ่ายเงินเดือนเขียนได้เฉพาะใบพนักงาน)", () => {
    const s = sql.indexOf("create policy wht_w on wht_certificates");
    expect(sql.slice(s, sql.indexOf(";", s))).toMatch(/has_cap\('pay\.write'\) and emp_id is not null/);
  });
  it("report_runs ยังเปิดให้ 2 โดเมน (prod + acct) ตาม 0055", () => {
    const s = sql.indexOf("create policy report_runs_sel on report_runs");
    expect(sql.slice(s, sql.indexOf(";", s))).toMatch(/has_cap\('prod\.read'\) or has_cap\('acct\.read'\)/);
  });
});
