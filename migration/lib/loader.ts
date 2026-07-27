/**
 * loader.ts — อ่านไฟล์ .xlsx 3 แอป แล้วคืนแถวเป็น array ตาม index คอลัมน์
 * อ่านค่าดิบ (raw: true, cellDates: false) → วันที่มาเป็น Excel serial (number)
 * เพื่อให้ clean.isoDate ถอดแบบ tz-safe (ดู clean.ts) — ห้ามเปิด cellDates
 */
import * as XLSX from "xlsx";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Cell } from "./clean";

export type Row = Cell[];

export const CSV_DIR = path.resolve("migration/csv");

export const FILES = {
  production: "production.xlsx",
  accounting: "accounting.xlsx",
  sales: "sales.xlsx",
} as const;
export type AppKey = keyof typeof FILES;

export function loadWorkbook(app: AppKey): XLSX.WorkBook {
  const full = path.join(CSV_DIR, FILES[app]);
  if (!existsSync(full)) {
    throw new Error(`ไม่พบไฟล์ ${full} — วาง .xlsx 3 ไฟล์ใน migration/csv/ ก่อน (ดู README)`);
  }
  return XLSX.read(readFileSync(full), { cellDates: false });
}

/** แถวข้อมูล (ตัด header + แถวว่างล้วนออก) เป็น array ตาม index */
export function rows(wb: XLSX.WorkBook, sheet: string): Row[] {
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error(`ไม่พบชีท '${sheet}' ในไฟล์`);
  const arr = XLSX.utils.sheet_to_json<Row>(ws, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: null,
  });
  // ตัด header (แถวแรก) + แถวที่ทุกช่องว่าง
  return arr.slice(1).filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ""));
}

/** จำนวนแถวข้อมูลจริง (ใช้ reconcile) */
export function rowCount(wb: XLSX.WorkBook, sheet: string): number {
  return rows(wb, sheet).length;
}
