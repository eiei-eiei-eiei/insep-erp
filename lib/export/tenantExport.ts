/**
 * lib/export/tenantExport — โครงไฟล์ "ดาวน์โหลดข้อมูลของกิจการ" (D82)
 *
 * 🎯 แทนที่ระบบ snapshot เดิมที่เก็บไว้ใน DB แล้วมีปุ่มย้อนกลับให้ลูกค้ากดเอง
 *    เหตุผลเต็มอยู่ใน `docs/DECISIONS.md` D82 — สรุป: ปุ่มย้อนกลับเรียก
 *    `fn_mig_set_triggers` ซึ่งปิด trigger **ทั้งฐานข้อมูล** = กระทบลูกค้าเจ้าอื่นที่ใช้อยู่พร้อมกัน
 *
 * ไฟล์นี้เป็น**ตรรกะบริสุทธิ์**ล้วน ๆ (ไม่มี IO / ไม่มี supabase) เพื่อให้เทสได้ตรง ๆ
 */
// ★ ใช้ path สัมพัทธ์ ไม่ใช่ alias `@/` — ไฟล์นี้ถูกโหลดโดย vitest และ tsx (สคริปต์) ด้วย
//   ซึ่งไม่รู้จัก alias ของ Next (ไฟล์ใน lib/ ที่มีเทส ใช้แบบนี้กันหมด)
import { TENANT_TABLES, tableLabel, type TenantTable } from "../shared/tenantTables";

export const EXPORT_FORMAT = "insep-erp-export";
export const EXPORT_VERSION = 1;

export type ExportTenant = { id: string; slug: string; name: string };

export type ExportEnvelope = {
  format: typeof EXPORT_FORMAT;
  version: number;
  exported_at: string;
  exported_by: string;
  tenant: ExportTenant;
  counts: Record<string, number>;
  tables: Record<string, Record<string, unknown>[]>;
};

/**
 * ตารางที่ **ข้ามตอนเอาข้อมูลกลับ** (สคริปต์ `scripts/restore-tenant.ts`)
 * · stock_product = ยอดคงเหลือที่คำนวณใหม่ได้ (`fn_mig_recompute_stock`)
 * · profiles      = ผูกกับ `auth.users` — ลบ/ใส่ทับแล้วเซสชันลูกค้าพัง
 *
 * ★ ทั้งสองตารางยัง **อยู่ในไฟล์ export** (ลูกค้าควรได้ข้อมูลตัวเองครบ) แค่ไม่เอากลับเข้า DB
 */
export const RESTORE_SKIP: readonly TenantTable[] = ["stock_product", "profiles"];

/** ลำดับ FK-safe ตอนใส่ข้อมูลกลับ (ลูกก่อนแม่ไม่ได้ — insert ต้องแม่ก่อนลูก) */
export const RESTORE_ORDER: readonly TenantTable[] = [
  "entities", "bank_accounts", "app_settings", "contacts",
  "materials", "containers", "products", "sale_menu",
  "log_material", "log_ferment", "log_distill", "log_distill_run",
  "log_ferment_monitor", "log_dilute", "log_ferment_draw", "log_product",
  "transactions", "transaction_items", "wht_certificates", "tax_summaries",
  "sales_orders", "sales_order_items", "warehouse_stock", "stock_moves",
  "pay_inputs", "pay_components", "pay_rates", "pay_variables", "pay_post_legs",
  "employees", "payroll_periods", "payroll_items",
  "integration_log", "edit_log", "report_runs", "counters",
];

/** ตารางทั้งหมดที่ใส่ลงไฟล์ = ทุกตารางของ tenant (ไม่ข้ามอะไรเลย — สำรองต้องครบ) */
export const EXPORT_TABLES: readonly TenantTable[] = TENANT_TABLES;

export function buildEnvelope(input: {
  tenant: ExportTenant;
  exportedBy: string;
  tables: Record<string, Record<string, unknown>[]>;
  now?: Date;
}): ExportEnvelope {
  const counts: Record<string, number> = {};
  for (const [t, rows] of Object.entries(input.tables)) counts[t] = rows.length;
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: (input.now ?? new Date()).toISOString(),
    exported_by: input.exportedBy,
    tenant: input.tenant,
    counts,
    tables: input.tables,
  };
}

export const totalRows = (counts: Record<string, number>): number =>
  Object.values(counts).reduce((s, n) => s + (Number(n) || 0), 0);

/** วันเวลาแบบ `2026-08-25-1430` — เรียงไฟล์ในโฟลเดอร์แล้วได้ลำดับเวลาพอดี */
function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * ชื่อไฟล์ที่ตกลงเครื่องลูกค้า
 * 🪤 slug มาจาก DB — กันอักขระที่ Windows/macOS ห้ามใช้ในชื่อไฟล์ ไม่งั้นดาวน์โหลดแล้วชื่อเพี้ยน/ไม่ยอมเซฟ
 */
export function exportFileName(slug: string, kind: "json" | "xlsx", now: Date = new Date()): string {
  const safe = (slug || "tenant").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "tenant";
  return `insep-${safe}-${stamp(now)}.${kind}`;
}

/**
 * ชื่อชีตของ Excel
 * 🪤 กฎของ Excel: ยาวได้ ≤31 ตัว · ห้ามมี : \ / ? * [ ] · ห้ามซ้ำ
 *    ผิดข้อใดข้อหนึ่ง = ไฟล์เปิดไม่ขึ้น/ชีตหาย ไม่ใช่แค่ชื่อไม่สวย
 */
export function sheetNameOf(table: string, used: Set<string>): string {
  const base = (tableLabel(table) || table).replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || table.slice(0, 31);
  let name = base;
  for (let i = 2; used.has(name); i++) {
    const suffix = `~${i}`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name);
  return name;
}

/**
 * คอลัมน์ที่ต้องออกเป็น **ข้อความ** ใน Excel เสมอ
 *
 * 🚨 เลขพวกนี้มีศูนย์นำหน้าได้และยาวเกิน 15 หลักไม่ได้ — ถ้าปล่อยเป็นตัวเลข Excel จะ
 *    กินศูนย์หน้าทิ้ง (`0105558123456` → `105558123456`) หรือแปลงเป็น `1.05559E+11`
 *    = เลขผู้เสียภาษี/เลขบัตร/เลขสรรพสามิต บนไฟล์ที่ส่งให้บัญชี**ผิด**
 */
const TEXT_COLUMNS = new Set([
  "tax_id", "national_id", "sso_no", "sso_employer_no", "excise_id",
  "bank_acct", "phone", "branch", "account_no",
]);

export type Cell = string | number | boolean | null;

/**
 * แปลงค่าจาก DB เป็นค่าที่ใส่ช่อง Excel ได้
 * · jsonb / array → ข้อความ JSON (ไม่ใช่ `[object Object]`)
 * · คอลัมน์ในลิสต์ข้างบน → บังคับเป็นข้อความเสมอ
 */
export function cellSafe(column: string, value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return JSON.stringify(value);
  if (TEXT_COLUMNS.has(column)) return String(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

/** แปลงตารางเดียวเป็น array-of-array พร้อมหัวคอลัมน์ (ว่าง = แถวเดียวบอกว่าไม่มีข้อมูล) */
export function sheetRows(rows: Record<string, unknown>[]): Cell[][] {
  if (rows.length === 0) return [["(ไม่มีข้อมูล)"]];
  const cols = Object.keys(rows[0]);
  return [cols, ...rows.map((r) => cols.map((c) => cellSafe(c, r[c])))];
}
