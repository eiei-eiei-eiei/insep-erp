/**
 * lib/bar/prep — ของทำเองในร้าน: ไซรัป · infused · cordial (golden B27 · D130)
 *
 * ของทำเอง = วัตถุดิบตัวหนึ่ง (`bar_item`) ที่ของเข้าสต็อกด้วยการ "ทำล็อต" แทนการซื้อ
 * · สูตรมาตรฐานต่อ 1 ล็อตเป็นแค่แม่แบบ (แก้ได้ · มีผลกับล็อตถัดไป) · ทำทีละน้อยได้ (0.3 ล็อต)
 * · ปริมาณที่ได้จริงกรอกทุกครั้ง — 🚨 ทุนต่อหน่วย = ทุนวัตถุดิบที่ใช้จริง ÷ ปริมาณที่ได้จริง
 * · 2 ปุ่ม: ทำเสร็จแล้ว (เข้าสต็อกเลย) · เริ่มแช่ (ตัดวัตถุดิบวันเทลงโหล · เสร็จแล้วค่อยใส่ปริมาณที่ได้)
 * · ไม่นับค่าแรง/ค่าแก๊ส (ผู้ใช้เลือก)
 * · ทุนเฉลี่ยกับของเดิม = สูตรเดียวกับรับของเข้า (fn_bar_receive · golden B3) — พรีวิวใช้ `weightedAvgCost`
 *
 * ★ การตัดสิน/ประโยคอยู่ที่นี่ (D84/D88) · ตัวจริงคิดที่ SQL ตอนกด (0092)
 */
import type { BarItem } from "./types";
import { cleanRecipe, type RecipeDraftRow } from "./recipe";
import { recipeCost } from "./menuPricing";
import { weightedAvgCost } from "./cost";

export type PrepInput = { itemId: string; qty: number; lineNo: number };
export type PrepDef = { itemId: string; stdYield: number; note: string | null; inputs: PrepInput[] };

export type PrepStatus = "กำลังแช่" | "เสร็จแล้ว" | "ยกเลิก";
export type PrepBatchLine = { lineNo: number; inputItemId: string; label: string; unit: string | null; qty: number; cost: number };
export type PrepBatch = {
  batchId: string;
  itemId: string;
  status: PrepStatus;
  multiplier: number;
  startedAt: string;
  startDate: string;
  finishDate: string | null;
  yieldQty: number | null;
  costTotal: number;
  note: string | null;
  /** server ตัดสิน: ล็อตที่เสร็จแล้วนี้เป็นการเคลื่อนไหวล่าสุดของของทำเองตัวนี้ไหม (ยกเลิกย้อนเป๊ะได้) */
  latest: boolean;
  lines: PrepBatchLine[];
};

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** สูตรมาตรฐาน × จำนวนล็อต → แถวบนฟอร์ม (ปัด 4 ตำแหน่ง — 0.3 × 500 ต้องได้ 150 ไม่ใช่ 150.00000000000003) */
export function scaleInputs(def: Pick<PrepDef, "inputs">, multiplier: number): RecipeDraftRow[] {
  return [...def.inputs]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((i) => ({ itemId: i.itemId, qty: r4(i.qty * multiplier) }));
}

export function scaledYield(def: Pick<PrepDef, "stdYield">, multiplier: number): number {
  return r4(def.stdYield * multiplier);
}

/** สูตรมาตรฐานเป็นข้อความ — "น้ำตาล 500 g · น้ำ 500 ml → ได้ 800 ml" */
export function prepRecipeText(
  def: Pick<PrepDef, "inputs" | "stdYield">,
  items: readonly Pick<BarItem, "itemId" | "name" | "unit">[],
  unit: string,
): string {
  const byId = new Map(items.map((i) => [i.itemId, i]));
  const parts = [...def.inputs]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((i) => {
      const it = byId.get(i.itemId);
      return it ? `${it.name} ${r4(i.qty)} ${it.unit}` : `(ไม่พบวัตถุดิบ) ${r4(i.qty)}`;
    });
  return `${parts.join(" · ")} → ได้ ${r4(def.stdYield)} ${unit}`;
}

/**
 * พรีวิวก่อนกด: ทุนล็อต · ทุนต่อหน่วย (ปริมาณที่ได้ว่าง/0 = ยังคิดไม่ได้ → null ไม่ใช่ 0)
 * + ทุนเฉลี่ยใหม่หลังของเข้า (ถัวกับของเดิม — สูตรเดียวกับรับของ B3)
 */
export function batchPreview(
  rows: readonly RecipeDraftRow[],
  items: readonly BarItem[],
  yieldQty: number | "",
  prep: Pick<BarItem, "qty" | "costPerUnit"> | undefined,
): { cost: number; perUnit: number | null; missing: number; newAvg: number | null } {
  const lines = cleanRecipe(rows).flatMap((r) => (r.itemId !== undefined ? [{ itemId: r.itemId, qty: r.qty }] : []));
  const c = recipeCost(lines, items);
  const y = yieldQty === "" ? 0 : yieldQty;
  const perUnit = y > 0 ? r4(c.total / y) : null;
  const newAvg = y > 0 && prep ? weightedAvgCost(prep, { qty: y, costTotal: c.total }) : null;
  return { cost: r2(c.total), perUnit, missing: c.missing, newAvg };
}

/** ทุนต่อหน่วยของล็อต (เสร็จแล้วเท่านั้น) */
export function batchPerUnit(b: Pick<PrepBatch, "costTotal" | "yieldQty">): number | null {
  return b.yieldQty && b.yieldQty > 0 ? r4(b.costTotal / b.yieldQty) : null;
}

/** ล็อตที่เสร็จล่าสุดของของทำเองตัวนี้ (ไว้เทียบราคา) */
export function lastFinished(itemId: string, batches: readonly PrepBatch[]): PrepBatch | undefined {
  return batches
    .filter((b) => b.itemId === itemId && b.status === "เสร็จแล้ว")
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
}

/** % เปลี่ยนของทุนต่อหน่วยเทียบล็อตก่อน (ไม่มีล็อตก่อน/ยังคิดไม่ได้ = null · ไม่ใช่ 0%) */
export function perUnitChange(now: number | null, prev: number | null): number | null {
  if (now === null || prev === null || !(prev > 0)) return null;
  return Math.round(((now - prev) / prev) * 1000) / 10;
}

/** แช่มาแล้วกี่วัน (นับวันเต็ม) */
export function soakDays(startedAt: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(startedAt)) / 86_400_000));
}

/** ล็อตของของทำเองตัวนี้ ใหม่สุดก่อน · ตัวตัดสินสุดท้าย batchId (ลำดับคงที่ · D107) */
export function batchesOf(itemId: string, batches: readonly PrepBatch[]): PrepBatch[] {
  return batches
    .filter((b) => b.itemId === itemId)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : a.batchId < b.batchId ? 1 : -1));
}

/** ล็อตที่กำลังแช่ทั้งหมด (เก่าสุดก่อน — ของที่แช่นานสุดอยู่บน) */
export function soakingBatches(batches: readonly PrepBatch[]): PrepBatch[] {
  return batches.filter((b) => b.status === "กำลังแช่").sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
}

/**
 * ยกเลิกได้ไหม — คืนเหตุผลหรือ null · 🚨 ต้องตรงกับ fn_bar_prep_cancel (0092)
 * · กำลังแช่ → ได้เสมอ · เสร็จแล้ว → ได้เฉพาะเมื่อยังไม่มีการเคลื่อนไหวอื่นตามหลัง
 */
export function cancelBlock(b: Pick<PrepBatch, "status" | "latest">): string | null {
  if (b.status === "ยกเลิก") return "ยกเลิกไปแล้ว";
  if (b.status === "เสร็จแล้ว" && !b.latest) {
    return "มีการใช้/รับ/นับ ของตัวนี้ตามหลังไปแล้ว ทุนเฉลี่ยย้อนกลับเป๊ะไม่ได้ — แก้ยอดด้วย นับสต็อก แทน";
  }
  return null;
}

/** ประโยคถามก่อนยกเลิก */
export function cancelConfirmText(b: Pick<PrepBatch, "status" | "yieldQty">, unit: string): string {
  return b.status === "กำลังแช่"
    ? "วัตถุดิบที่ตัดไปจะคืนเข้าสต็อก (ยังไม่มีของทำเองเข้าสต็อก)"
    : `ของทำเอง ${r4(b.yieldQty ?? 0)} ${unit} จะออกจากสต็อก ทุนเฉลี่ยกลับเป็นค่าก่อนล็อตนี้ และวัตถุดิบที่ใช้คืนเข้าสต็อก`;
}

// ── ตรวจก่อนบันทึก ("" = ผ่าน) ───────────────────────────────────────────────

/** ตั้ง/แก้ของทำเอง — 🚨 ใช้ตัวเองในสูตรไม่ได้ · ชื่อห้ามซ้ำกับวัตถุดิบตัวอื่น */
export function prepEditError(input: {
  itemId: string | null;
  name: string;
  unit: string;
  stdYield: number | "";
  rows: readonly RecipeDraftRow[];
  items: readonly Pick<BarItem, "itemId" | "name">[];
}): string {
  const name = input.name.trim();
  if (!name) return "ตั้งชื่อของทำเองก่อน";
  const clash = input.items.find((i) => i.itemId !== input.itemId && i.name.trim().toLowerCase() === name.toLowerCase());
  if (clash) return `มีวัตถุดิบชื่อ "${name}" อยู่แล้ว — ตั้งชื่อไม่ให้ซ้ำ`;
  if (!input.itemId && !input.unit.trim()) return "ระบุหน่วย (ml / g)";
  if (input.stdYield === "" || !(input.stdYield > 0)) return "1 ล็อตได้ประมาณเท่าไร — ใส่มากกว่า 0";
  const lines = cleanRecipe(input.rows);
  if (lines.length === 0) return "ใส่วัตถุดิบที่ใช้อย่างน้อย 1 บรรทัด";
  if (input.itemId && lines.some((l) => l.itemId === input.itemId)) return `ใช้ ${name} ในสูตรของตัวเองไม่ได้`;
  return "";
}

/** ทำล็อต — จำนวนล็อต · วัตถุดิบ · ปริมาณที่ได้ (บังคับเมื่อกด ทำเสร็จแล้ว) */
export function batchError(input: {
  multiplier: number | "";
  rows: readonly RecipeDraftRow[];
  yieldQty: number | "";
  finishNow: boolean;
}): string {
  if (input.multiplier === "" || !(input.multiplier > 0)) return "ใส่จำนวนล็อตมากกว่า 0 (ทำทีละน้อยได้ เช่น 0.3)";
  if (cleanRecipe(input.rows).length === 0) return "ไม่มีวัตถุดิบที่ใช้";
  if (input.finishNow && (input.yieldQty === "" || !(input.yieldQty > 0))) return "ใส่ปริมาณที่ได้จริงก่อน";
  return "";
}
