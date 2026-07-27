/**
 * split-xlsx.ts — แตก .xlsx 3 แอป → CSV รายชีท (เฉพาะชีทที่ย้าย) ตั้งชื่อมาตรฐานตาม README
 * เก็บเป็น snapshot ต้นทางในโฟลเดอร์ migration/csv/ (gitignore แล้ว) — ไว้อ้างอิง/rollback
 * ข้ามชีทที่ตัดสินใจไม่ย้าย (POS เก่า/ฟอร์ม/log ประวัติ/credential — ดู DECISIONS D27)
 */
import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadWorkbook, CSV_DIR, type AppKey } from "./lib/loader";

// sheet → ชื่อไฟล์ csv (เฉพาะชีทที่ย้าย)
const MAP: Record<AppKey, [string, string][]> = {
  production: [
    ["Master_Material", "prod_master_material"],
    ["Master_Container", "prod_master_container"],
    ["Master_Product", "prod_master_product"],
    ["Log_Material", "prod_log_material"],
    ["Log_Ferment", "prod_log_ferment"],
    ["Log_Distill", "prod_log_distill"],
    ["Log_DistillRun", "prod_log_distillrun"],
    ["Log_FermentMonitor", "prod_log_fermentmonitor"],
    ["Log_Dilute", "prod_log_dilute"],
    ["Log_Product", "prod_log_product"],
    ["Stock_Product", "prod_stock_product"],
  ],
  accounting: [
    ["Entities", "acc_entities"],
    ["Accounts", "acc_accounts"],
    ["Contacts", "acc_contacts"],
    ["Settings", "acc_settings"],
    ["Transactions", "acc_transactions"],
    ["Transaction_Items", "acc_transaction_items"],
    ["Tax_Summaries", "acc_tax_summaries"],
    ["pnd3-53", "acc_pnd"],
  ],
  sales: [
    ["btbtransaction", "sales_btbtransaction"],
    ["btbsales", "sales_btbsales"],
    ["menu_b2b", "sales_menu_b2b"],
    ["curstock", "sales_curstock"],
    ["stockmove", "sales_stockmove"],
    ["custdata", "sales_custdata"],
  ],
};

let n = 0;
for (const app of Object.keys(MAP) as AppKey[]) {
  const wb = loadWorkbook(app);
  for (const [sheet, name] of MAP[app]) {
    const ws = wb.Sheets[sheet];
    if (!ws) {
      console.log(`  ⚠️ ข้าม ${app}:${sheet} — ไม่พบชีท`);
      continue;
    }
    const csv = XLSX.utils.sheet_to_csv(ws);
    writeFileSync(path.join(CSV_DIR, `${name}.csv`), "﻿" + csv, "utf8"); // BOM กันไทยเพี้ยน
    console.log(`  ✓ ${app}:${sheet} → ${name}.csv`);
    n++;
  }
}
console.log(`\nเสร็จ: เขียน ${n} ไฟล์ CSV ใน migration/csv/`);
