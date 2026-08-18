/**
 * export-supabase-to-csv.ts — ดึงข้อมูลจาก Supabase → CSV (สำหรับ rollback, MIGRATION_PLAN sec 8.3)
 * ถ้าตัดสินใจถอยหลัง cutover: export ข้อมูลที่คีย์ในระบบใหม่กลับเป็น CSV เพื่อวางกลับชีทเดิม
 * ออกไฟล์ที่ migration/export/<table>.csv (gitignore — ข้อมูลจริง)
 */
import { serviceClient, requireTenantArg } from "./lib/client";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve("migration/export");

const TABLES = [
  "entities", "bank_accounts", "app_settings", "contacts",
  "materials", "containers", "products", "sale_menu",
  "log_material", "log_ferment", "log_distill", "log_distill_run",
  "log_ferment_monitor", "log_dilute", "log_product", "stock_product",
  "transactions", "transaction_items", "wht_certificates", "tax_summaries",
  "sales_orders", "sales_order_items", "warehouse_stock", "stock_moves",
  "counters", "integration_log",
];

function toCsv(records: Record<string, unknown>[]): string {
  if (records.length === 0) return "";
  const cols = Object.keys(records[0]);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    let s = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const head = cols.join(",");
  const body = records.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n");
  return head + "\n" + body;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const TENANT = requireTenantArg();
  const db = serviceClient();
  let n = 0;
  for (const t of TABLES) {
    const { data, error } = await db.from(t).select("*").eq("tenant_id", TENANT);
    if (error) {
      console.log(`  ⚠️ ${t}: ${error.message}`);
      continue;
    }
    const csv = toCsv((data ?? []) as Record<string, unknown>[]);
    writeFileSync(path.join(OUT, `${t}.csv`), "﻿" + csv, "utf8");
    console.log(`  ✓ ${t} (${data?.length ?? 0} แถว)`);
    n++;
  }
  console.log(`\nเสร็จ: export ${n} ตาราง → migration/export/`);
}

main().catch((e) => {
  console.error("\n❌ " + (e as Error).message);
  process.exit(1);
});
