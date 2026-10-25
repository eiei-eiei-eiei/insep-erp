/**
 * lib/bar/stockNav — แถบสลับส่วน + ช่องค้นของหน้าสต็อกบาร์ (golden B25 · D128)
 *
 * ผู้ใช้ขอ: วัตถุดิบเยอะแล้วหน้าสต็อกยาวมาก (ตารางทะเบียน + ตารางนับสต็อก ยาวเท่าจำนวนวัตถุดิบทั้งคู่
 *           และการ์ดรับของจมอยู่ตรงกลาง) → อยากได้ตัวนำทาง + ช่องค้นในแต่ละส่วน
 * ผู้ใช้เลือก: **แบบ B — สลับทีละส่วน** (วัตถุดิบ | รับของเข้า | นับสต็อก) ผูกกับ URL `?view=`
 *
 * ── กติกาที่ล็อกไว้ ──────────────────────────────────────────────────────────
 * · 🚨 **การกรองซ่อนแถวบนจอเท่านั้น ไม่ได้ตัดแถวออกจากสิ่งที่จะบันทึก** — แถวที่กรอก/แก้ไว้แล้ว
 *   แต่ถูกกรองซ่อน ยังถูกบันทึกด้วย ⇒ ต้องบอกบนจอเสมอ (`hiddenPendingText`) ไม่งั้นผู้ใช้กดบันทึก
 *   โดยไม่รู้ว่ามีของที่มองไม่เห็นติดไปด้วย
 * · 🚨 **เลขแถวคงเป็นเลขเดิมแม้กรองอยู่** — ข้อความ error ของการบันทึกอ้าง "แถว 7"
 *   (`planCount`/`planItemEdits` นับจากลิสต์เต็ม) เลขแถวเปลี่ยนตามการกรอง = ผู้ใช้ไปแก้ผิดแถว
 * · ค้นจากชื่อ ไม่สนตัวพิมพ์เล็กใหญ่ · หลายคำคั่นด้วยช่องว่าง = ต้องเจอครบทุกคำ ("จิน 2")
 * · ลำดับแถวไม่เปลี่ยนตามการค้น (เรียงเหมือนตอนไม่ค้น — ตาจำตำแหน่งได้)
 */
import type { BarItem } from "./types";
import { isLowStock } from "./units";
import type { CountDraft } from "./stockBatch";

export const STOCK_VIEWS = ["items", "receive", "count"] as const;
export type StockView = (typeof STOCK_VIEWS)[number];

/** `Record` บังคับครบทุกส่วน — เพิ่มส่วนใหม่แล้วลืมตั้งชื่อ = build ไม่ผ่าน (D84) */
export const STOCK_VIEW_LABEL: Record<StockView, string> = {
  items: "วัตถุดิบ",
  receive: "รับของเข้า",
  count: "นับสต็อก",
};

/** ค่าจาก URL → ส่วนที่แสดง · ค่าที่ไม่รู้จัก/ว่าง = วัตถุดิบ (ไม่ error · ลิงก์เก่าต้องยังเปิดได้) */
export function parseStockView(v: string | null | undefined): StockView {
  return (STOCK_VIEWS as readonly string[]).includes(v ?? "") ? (v as StockView) : "items";
}

/** ชื่อตรงกับคำค้นไหม — ว่าง = ตรงทุกตัว · หลายคำ = ต้องเจอครบทุกคำ (ลำดับไม่สำคัญ) */
export function matchesQuery(name: string, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const n = name.toLowerCase();
  return words.every((w) => n.includes(w));
}

// ── ส่วนที่ 1: ทะเบียนวัตถุดิบ ────────────────────────────────────────────────

export type ItemFilter = "all" | "low" | "inactive";
export const ITEM_FILTER_LABEL: Record<ItemFilter, string> = { all: "ทั้งหมด", low: "ใกล้หมด", inactive: "เลิกใช้" };

/**
 * ★ "ใกล้หมด" นับเฉพาะตัวที่ยังใช้อยู่ — ตรงกับแถบเตือนบนสุดและป้ายในตาราง (ตัวเลิกใช้ไม่ขึ้นใกล้หมด)
 */
export function itemPasses(item: Pick<BarItem, "name" | "qty" | "lowQty" | "active">, query: string, filter: ItemFilter): boolean {
  if (!matchesQuery(item.name, query)) return false;
  if (filter === "low") return item.active !== false && isLowStock(item);
  if (filter === "inactive") return item.active === false;
  return true;
}

// ── ส่วนที่ 3: นับสต็อก ───────────────────────────────────────────────────────

export type CountFilter = "all" | "filled" | "low";
export const COUNT_FILTER_LABEL: Record<CountFilter, string> = { all: "ทั้งหมด", filled: "ที่กรอกแล้ว", low: "ใกล้หมด" };

/** แถวนับสต็อกที่ "กรอกแล้ว" = มียอดที่นับได้ (0 ก็นับ — 0 คือนับแล้วหมด) */
export function countRowFilled(d: Pick<CountDraft, "value">): boolean {
  return d.value !== "";
}

/**
 * แถวที่แสดง + **เลขแถวเดิม** (ลำดับในลิสต์เต็ม เริ่ม 1) — ห้ามนับเลขใหม่หลังกรอง
 */
export function visibleRows<T extends { itemId: string }>(
  rows: readonly T[],
  pass: (row: T) => boolean,
): { row: T; no: number }[] {
  return rows.map((row, i) => ({ row, no: i + 1 })).filter((x) => pass(x.row));
}

export function countPasses(
  d: CountDraft,
  item: Pick<BarItem, "name" | "qty" | "lowQty" | "active">,
  query: string,
  filter: CountFilter,
): boolean {
  if (!matchesQuery(item.name, query)) return false;
  if (filter === "filled") return countRowFilled(d);
  if (filter === "low") return item.active !== false && isLowStock(item);
  return true;
}

/**
 * แถวที่ "มีของค้างจะบันทึก" แต่ถูกกรองซ่อนอยู่
 * @param pendingIds itemId ของแถวที่จะถูกบันทึก (หรือกรอกไว้)
 * @param visibleIds itemId ของแถวที่เห็นบนจอตอนนี้
 */
export function hiddenPendingCount(pendingIds: readonly string[], visibleIds: readonly string[]): number {
  const seen = new Set(visibleIds);
  return new Set(pendingIds.filter((id) => !seen.has(id))).size;
}

/** ประโยคเตือนเมื่อมีของที่จะถูกบันทึกแต่มองไม่เห็น ("" = ไม่มี) */
export function hiddenPendingText(n: number): string {
  return n > 0 ? `มีที่กรอกไว้ ${n} รายการที่ถูกกรองซ่อนอยู่ — กดบันทึกแล้วจะบันทึกด้วย` : "";
}

/** ข้อความเมื่อค้นแล้วไม่เจอ — บอกว่ามีทั้งหมดกี่ตัว ไม่ใช่ "ยังไม่มีวัตถุดิบ" (ซึ่งเป็นคำโกหก) */
export function noMatchText(total: number): string {
  return `ไม่พบวัตถุดิบที่ตรงกับคำค้น/ตัวกรอง (ทั้งหมด ${total} รายการ)`;
}
