import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { TENANT_TABLES, MIG_TRUNCATE_SKIP, AUDITED_TABLES, ENTITY_SCOPED_TABLES, tableLabel } from "./tenantTables";
import { RESTORE_SKIP, EXPORT_TABLES } from "../export/tenantExport";

/**
 * เทสนี้ตรวจ "รายชื่อตารางที่ก๊อปกันไว้หลายที่" ให้ตรงกันเสมอ (D79)
 *
 * ★ อ่านไฟล์เป็น **ข้อความ** ไม่ import โมดูล — เพราะบางไฟล์มี `import "server-only"`
 *   และ backup-tables.ts เรียก main() ตอนโหลด · การอ่านข้อความยังทำให้ตรวจ **SQL** ได้ด้วย
 *   ซึ่งเป็นชั้นที่ unit test ปกติมองไม่เห็นเลย (ตรรกะอยู่ในฐานข้อมูล ไม่ใช่ใน TypeScript)
 */
const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/** ดึงรายชื่อในลิสต์ที่คั่นด้วย quote จากบล็อกข้อความ (รองรับทั้ง "x" ของ TS และ 'x' ของ SQL) */
function namesIn(block: string): string[] {
  return [...block.matchAll(/["']([a-z_]+)["']/g)].map((m) => m[1]);
}

/** ตัดบล็อก array ที่ขึ้นต้นด้วย marker จนถึง `]` ตัวแรก */
function arrayAfter(src: string, marker: string): string {
  const i = src.indexOf(marker);
  expect(i, `หาไม่เจอ: ${marker}`).toBeGreaterThan(-1);
  // 🪤 เริ่มหา `]` **หลัง marker จบ** — marker ของ SQL มี `]` อยู่ในตัวเอง (`text[] := array[`)
  const j = src.indexOf("]", i + marker.length);
  return src.slice(i + marker.length, j);
}

/** ไฟล์ migration ล่าสุดที่นิยาม fn_mig_truncate — ตัวที่มีผลจริงใน DB */
function latestMigTruncateSql(): string {
  const dir = path.join(ROOT, "supabase/migrations");
  const hit = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .find((f) => readFileSync(path.join(dir, f), "utf8").includes("function fn_mig_truncate"));
  expect(hit, "ไม่พบ migration ที่นิยาม fn_mig_truncate").toBeTruthy();
  return readFileSync(path.join(dir, hit!), "utf8");
}

const sorted = (a: readonly string[]) => [...a].sort();
const expected = (skip: readonly string[]) => sorted(TENANT_TABLES.filter((t) => !skip.includes(t)));

describe("รายชื่อตารางต่อ tenant ต้องตรงกันทุกที่ (D79)", () => {
  it("fn_mig_truncate (SQL) ครบทุกตาราง — ตกตาราง = ลบลูกค้าไม่ได้ ติด FK ของ tenants", () => {
    const sql = latestMigTruncateSql();
    const list = namesIn(arrayAfter(sql, "tables text[] := array["));
    expect(sorted(list)).toEqual(expected(MIG_TRUNCATE_SKIP));
  });

  it("RESTORE_ORDER ครบทุกตาราง — ตกตาราง = เอาข้อมูลกลับแล้วของหายเงียบ ๆ (D82)", () => {
    const list = namesIn(arrayAfter(read("lib/export/tenantExport.ts"), "export const RESTORE_ORDER: readonly TenantTable[] = ["));
    expect(sorted(list)).toEqual(expected(RESTORE_SKIP));
  });

  it("ไฟล์ export ต้องมีข้อมูล**ทุกตาราง** — RESTORE_SKIP ตัดเฉพาะตอนเอากลับ ไม่ใช่ตอนสำรอง", () => {
    // ลูกค้าต้องได้ข้อมูลตัวเองครบในไฟล์ · stock_product/profiles แค่ไม่ถูกเขียนกลับเข้า DB
    expect(sorted(EXPORT_TABLES)).toEqual(sorted(TENANT_TABLES));
  });

  it("🚨 ไม่มีตาราง snapshots หลงเหลือที่ไหน — ถูก drop ใน 0049 แล้ว (D82)", () => {
    expect(TENANT_TABLES as readonly string[]).not.toContain("snapshots");
    const sql = latestMigTruncateSql();
    expect(namesIn(arrayAfter(sql, "tables text[] := array["))).not.toContain("snapshots");
  });

  it("scripts/backup-tables.ts ครบทุกตาราง", () => {
    const list = namesIn(arrayAfter(read("scripts/backup-tables.ts"), "const TABLES = ["));
    expect(sorted(list)).toEqual(sorted(TENANT_TABLES));
  });

  it("TENANT_TABLES ของ harness (เทสกันข้อมูลรั่ว) ครบทุกตาราง", () => {
    const list = namesIn(arrayAfter(read("tests/tenant/harness.ts"), "export const TENANT_TABLES = ["));
    expect(sorted(list)).toEqual(sorted(TENANT_TABLES));
  });

  it("ไม่มีชื่อซ้ำในลิสต์กลาง", () => {
    expect(new Set(TENANT_TABLES).size).toBe(TENANT_TABLES.length);
  });

  it("AUDITED_TABLES ตรงกับ trigger audit_* ในไฟล์ SQL จริง (D80)", () => {
    const dir = path.join(ROOT, "supabase/migrations");
    const found = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql"))) {
      const sql = readFileSync(path.join(dir, f), "utf8");
      // เฉพาะ create — ไฟล์ 0047 มี `drop trigger if exists audit_… on …` ปนอยู่ด้วย
      for (const m of sql.matchAll(/create trigger\s+audit_\w+[\s\S]*?\son\s+([a-z_]+)/g)) found.add(m[1]);
    }
    expect(sorted([...found])).toEqual(sorted(AUDITED_TABLES));
  });

  it("ทุกตารางใน AUDITED_TABLES อยู่ในลิสต์กลาง และมีชื่อไทย", () => {
    for (const t of AUDITED_TABLES) {
      expect(TENANT_TABLES, `${t} ไม่อยู่ใน TENANT_TABLES`).toContain(t);
      expect(tableLabel(t), `${t} ยังไม่มีชื่อไทย`).not.toBe(t);
    }
  });
});

/**
 * D82 — ทุกตารางกลายเป็น "ชื่อชีต" ในไฟล์ Excel ที่ลูกค้าเปิดอ่านเอง
 * ก่อนหน้านี้ชื่อไทยใช้แค่ในดร็อปดาวน์หน้าประวัติการแก้ไข ตารางที่ไม่มีชื่อจึงไม่เคยโผล่
 */
describe("ชื่อไทยของตาราง (D82 — ไปเป็นชื่อชีต Excel)", () => {
  it("🚨 ทุกตารางที่อยู่ในไฟล์ export ต้องมีชื่อไทย — ลูกค้าอ่านชื่อตารางดิบไม่ออก", () => {
    const missing = EXPORT_TABLES.filter((t) => tableLabel(t) === t);
    expect(missing, `ยังไม่มีชื่อไทย: ${missing.join(", ")}`).toEqual([]);
  });

  it("ชื่อไทยต้องไม่ซ้ำกัน — ซ้ำแล้วชีต Excel จะโดนเติมเลขต่อท้ายให้งง", () => {
    const names = EXPORT_TABLES.map((t) => tableLabel(t));
    expect(new Set(names).size).toBe(names.length);
  });
});

/**
 * D82 — ลิสต์ที่ "ครบ" ไม่ได้แปลว่า "เรียงถูก"
 * `report_runs` อยู่หลัง `entities` มาตั้งแต่ 0029 · เทสเดิมตรวจแค่ชื่อครบเลยไม่เห็น
 * · `test:tenant` ก็ไม่เห็น เพราะ tenant ที่เทสสร้างไม่มีแถวใน report_runs ให้ FK ละเมิด
 */
describe("ลำดับใน fn_mig_truncate ต้องลบลูกก่อนแม่ (D82)", () => {
  function truncateOrder(): string[] {
    const sql = latestMigTruncateSql();
    return namesIn(arrayAfter(sql, "tables text[] := array["));
  }

  it("🚨 ทุกตารางที่มี entity_id ต้องถูกลบก่อน entities", () => {
    const order = truncateOrder();
    const iEntities = order.indexOf("entities");
    expect(iEntities, "ไม่เจอ entities ในลิสต์").toBeGreaterThan(-1);
    const late = ENTITY_SCOPED_TABLES.filter((t) => order.indexOf(t) > iEntities);
    expect(late, `ลบหลัง entities จะติด FK: ${late.join(", ")}`).toEqual([]);
  });

  it("ทุกตารางใน ENTITY_SCOPED_TABLES ต้องอยู่ในลิสต์กลาง และอยู่ในลำดับ truncate จริง", () => {
    const order = truncateOrder();
    for (const t of ENTITY_SCOPED_TABLES) {
      expect(TENANT_TABLES, `${t} ไม่อยู่ใน TENANT_TABLES`).toContain(t);
      expect(order, `${t} ไม่อยู่ใน fn_mig_truncate`).toContain(t);
    }
  });

  it("transaction_items ต้องมาก่อน transactions · sales_order_items ก่อน sales_orders", () => {
    const order = truncateOrder();
    expect(order.indexOf("transaction_items")).toBeLessThan(order.indexOf("transactions"));
    expect(order.indexOf("sales_order_items")).toBeLessThan(order.indexOf("sales_orders"));
    expect(order.indexOf("payroll_items")).toBeLessThan(order.indexOf("payroll_periods"));
  });
});
