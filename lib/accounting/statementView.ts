/**
 * lib/accounting/statementView — D139 ตัวเลือกช่วงเวลาของ statement (ปุ่มลัด + ป้าย + ตรวจค่า)
 * ★ ตัวคำนวณยอดอยู่ที่ `accountStatementRange` (ledger.ts) ที่เดียว — ไฟล์นี้แค่แปลงปุ่มเป็นช่วงเดือน
 */

import { prevMonth } from "../shared/period";
import type { StatementRange } from "./ledger";

export type StatementPreset = "month" | "3m" | "ytd" | "all" | "custom";

export const STATEMENT_PRESETS: { key: Exclude<StatementPreset, "custom">; label: string }[] = [
  { key: "month", label: "เดือนนี้" },
  { key: "3m", label: "3 เดือน" },
  { key: "ytd", label: "ต้นปีถึงเดือนนี้" },
  { key: "all", label: "ทั้งหมด" },
];

/** ช่วงของปุ่มลัด · นับถอยจากเดือนที่เลือกไว้ด้านบนของหน้า (period) */
export function presetRange(preset: Exclude<StatementPreset, "custom">, period: string): StatementRange {
  switch (preset) {
    case "month":
      return { from: period, to: period };
    case "3m":
      return { from: prevMonth(prevMonth(period)), to: period };
    case "ytd":
      return { from: `${period.slice(0, 4)}-01`, to: period };
    case "all":
      return { from: null, to: null };
  }
}

/** ป้ายหัวการ์ด */
export function rangeTitle(r: StatementRange): string {
  if (!r.from && !r.to) return "ทั้งหมด";
  if (r.from && r.to) return r.from === r.to ? `เดือน ${r.from}` : `${r.from} ถึง ${r.to}`;
  if (r.from) return `ตั้งแต่ ${r.from}`;
  return `จนถึง ${r.to}`;
}

/** ข้อความผิดพลาดของช่วงที่กรอกเอง · ว่าง = ใช้ได้ */
export function rangeError(r: StatementRange): string {
  if (r.from && r.to && r.from > r.to) return "เดือนเริ่มต้องไม่หลังเดือนสุดท้าย";
  return "";
}

/** ดูหลายเดือนไหม (ถึงจะแทรกแถวสรุปท้ายเดือน) */
export function isMultiMonth(r: StatementRange): boolean {
  return !(r.from && r.to && r.from === r.to);
}
