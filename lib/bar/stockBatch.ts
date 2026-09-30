/**
 * lib/bar/stockBatch — กรอกหลายแถวแล้วบันทึกทีเดียว (D103)
 *
 * แท็บสต็อกบาร์เดิมบันทึกทีละรายการ ⇒ รับของจากโรงกลั่น 10 อย่าง = กด 10 ครั้ง รอ 10 รอบ
 * ไฟล์นี้ตัดสินว่า "แถวไหนจะถูกส่ง · แถวไหนข้าม · แถวไหนผิด" ก่อนถึง server
 * (ห้ามตัดสินในคอมโพเนนต์ — D84/D88)
 *
 * ── หลัก ───────────────────────────────────────────────────────────────────
 * · **แถวว่างทั้งแถว = ข้ามเงียบ ๆ** (ช่องเผื่อกรอกต่อ ไม่ใช่ข้อผิดพลาด)
 * · **แถวที่กรอกครึ่งเดียว = error พร้อมเลขแถว** 🚨 ห้ามข้ามเงียบ — ผู้ใช้นึกว่าบันทึกครบแล้ว
 *   แต่ของหายไป 1 รายการ = สต็อกบนจอโกหก (บั๊กตระกูล D79 "บันทึกได้บางส่วน ≠ สำเร็จ")
 * · **ทั้งชุดสำเร็จหรือไม่สำเร็จเลย** — ฝั่ง DB เป็น transaction เดียว (0080)
 *   ⇒ ไม่มีสภาพ "รับเข้าไป 6 จาก 10 แล้วไม่รู้ว่าตัวไหนเข้า"
 * · วัตถุดิบซ้ำในชุดเดียวกัน = error (ปรับยอดตัวเดียวกัน 2 แถว = แถวหลังทับแถวแรกเงียบ ๆ ·
 *   รับของซ้ำ 2 แถวมักเป็นกดเพิ่มแถวซ้ำโดยไม่ตั้งใจ = รับของเข้าสองเท่า)
 */
import type { BarItem } from "./types";
import { packToBase } from "./units";

export type RowError = { row: number; text: string };
type Result<T> = { rows: T[]; errors: RowError[]; skipped: number };

const num = (v: number | "") => (v === "" ? null : v);

/* ── รับของเข้า ─────────────────────────────────────────────────────────── */

export type ReceiveDraft = { itemId: string; qtyPack: number | ""; costTotal: number | "" };
export type ReceiveRow = { row: number; itemId: string; qtyPack: number; qty: number; costTotal: number };

export const blankReceive = (): ReceiveDraft => ({ itemId: "", qtyPack: "", costTotal: "" });

export function planReceive(drafts: readonly ReceiveDraft[], items: readonly BarItem[]): Result<ReceiveRow> {
  const rows: ReceiveRow[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  drafts.forEach((d, i) => {
    const row = i + 1;
    const qtyPack = num(d.qtyPack);
    const cost = num(d.costTotal);
    if (!d.itemId && qtyPack === null && cost === null) {
      skipped++;
      return;
    }
    const item = items.find((it) => it.itemId === d.itemId);
    if (!item) return void errors.push({ row, text: "ยังไม่ได้เลือกวัตถุดิบ" });
    if (seen.has(item.itemId)) return void errors.push({ row, text: `${item.name} ซ้ำกับแถวก่อนหน้า` });
    seen.add(item.itemId);
    if (qtyPack === null || qtyPack <= 0) return void errors.push({ row, text: `${item.name}: จำนวนต้องมากกว่า 0` });
    if (cost !== null && cost < 0) return void errors.push({ row, text: `${item.name}: ราคาติดลบไม่ได้` });
    rows.push({ row, itemId: item.itemId, qtyPack, qty: packToBase(qtyPack, item.packSize), costTotal: cost ?? 0 });
  });
  return { rows, errors, skipped };
}

/* ── ปรับยอด ────────────────────────────────────────────────────────────── */

export const ADJUST_REASONS = ["ปรับยอด", "เสียหาย", "ชิม/เทสต์"] as const;

export type AdjustDraft = { itemId: string; qtyAfter: number | ""; reason: string; note: string };
export type AdjustRow = { row: number; itemId: string; qtyAfter: number; reason: string; note: string };

export const blankAdjust = (): AdjustDraft => ({ itemId: "", qtyAfter: "", reason: ADJUST_REASONS[0], note: "" });

/**
 * 🪤 **ยอดเท่าเดิม = ข้าม ไม่ใช่ error** — ปุ่ม "นับทั้งหมด" เติมทุกรายการด้วยยอดปัจจุบัน
 *    แล้วผู้ใช้แก้เฉพาะตัวที่ไม่ตรง ⇒ ส่วนใหญ่เท่าเดิมเป็นสภาพปกติ
 *    (RPC ตัวเดี่ยวตอบ error เมื่อเท่าเดิม — ส่งไปทั้งชุดจะล้มทั้งชุด)
 */
export function planAdjust(drafts: readonly AdjustDraft[], items: readonly BarItem[]): Result<AdjustRow> & { same: number } {
  const rows: AdjustRow[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let same = 0;
  drafts.forEach((d, i) => {
    const row = i + 1;
    const after = num(d.qtyAfter);
    if (!d.itemId && after === null) {
      skipped++;
      return;
    }
    const item = items.find((it) => it.itemId === d.itemId);
    if (!item) return void errors.push({ row, text: "ยังไม่ได้เลือกวัตถุดิบ" });
    if (seen.has(item.itemId)) return void errors.push({ row, text: `${item.name} ซ้ำกับแถวก่อนหน้า` });
    seen.add(item.itemId);
    // ★ 0 คือคำตอบจริง (นับแล้วหมด) — ว่างต่างหากที่แปลว่ายังไม่กรอก
    if (after === null) return void errors.push({ row, text: `${item.name}: ยังไม่ได้กรอกยอดที่นับได้` });
    if (!(ADJUST_REASONS as readonly string[]).includes(d.reason))
      return void errors.push({ row, text: `${item.name}: เหตุผลไม่ถูกต้อง` });
    if (after === item.qty) {
      same++;
      return;
    }
    rows.push({ row, itemId: item.itemId, qtyAfter: after, reason: d.reason, note: d.note.trim() });
  });
  return { rows, errors, skipped, same };
}

/** เติมทุกรายการที่ยังใช้อยู่ด้วยยอดปัจจุบัน — สำหรับนับสต็อกทั้งร้าน */
export function countAllDrafts(items: readonly BarItem[]): AdjustDraft[] {
  return items
    .filter((i) => i.active !== false)
    .map((i) => ({ itemId: i.itemId, qtyAfter: i.qty, reason: ADJUST_REASONS[0], note: "" }));
}

/* ── เพิ่มวัตถุดิบ ──────────────────────────────────────────────────────── */

export type NewItemDraft = {
  name: string;
  unit: string;
  packSize: number | "";
  packLabel: string;
  lowQty: number | "";
};
export type NewItemRow = {
  name: string;
  unit: string;
  packSize: number | null;
  packLabel: string | null;
  lowQty: number | null;
};

export const blankNewItem = (): NewItemDraft => ({ name: "", unit: "ml", packSize: "", packLabel: "", lowQty: "" });

/**
 * แถวที่มีแค่หน่วยปริยาย (ml) ไม่มีชื่อ = แถวว่าง
 * 🚨 ชื่อซ้ำกับของที่มีอยู่แล้ว = error — DB ไม่มี unique ชื่อ (PK เป็นรหัส)
 *    ปล่อยผ่าน = มีวัตถุดิบชื่อเดียวกัน 2 ตัว แล้วรับของเข้าผิดตัวไปตลอด
 */
export function planNewItems(drafts: readonly NewItemDraft[], items: readonly BarItem[]): Result<NewItemRow> {
  const rows: NewItemRow[] = [];
  const errors: RowError[] = [];
  const key = (s: string) => s.trim().toLowerCase();
  const existing = new Set(items.map((i) => key(i.name)));
  const seen = new Set<string>();
  let skipped = 0;
  drafts.forEach((d, i) => {
    const row = i + 1;
    const name = d.name.trim();
    const touched = name || d.packSize !== "" || d.packLabel.trim() || d.lowQty !== "";
    if (!touched) {
      skipped++;
      return;
    }
    if (!name) return void errors.push({ row, text: "ยังไม่ได้ตั้งชื่อ" });
    if (existing.has(key(name))) return void errors.push({ row, text: `มี "${name}" อยู่แล้ว` });
    if (seen.has(key(name))) return void errors.push({ row, text: `"${name}" ซ้ำกับแถวก่อนหน้า` });
    seen.add(key(name));
    if (!d.unit.trim()) return void errors.push({ row, text: `${name}: ระบุหน่วยที่สูตรใช้ (ml · ขวด · ชิ้น)` });
    rows.push({
      name,
      unit: d.unit.trim(),
      packSize: d.packSize !== "" && d.packSize > 0 ? d.packSize : null,
      packLabel: d.packLabel.trim() || null,
      lowQty: d.lowQty !== "" && d.lowQty > 0 ? d.lowQty : null,
    });
  });
  return { rows, errors, skipped };
}

/** ข้อความ error รวม — บอกเลขแถวเสมอ ไม่งั้นหาไม่เจอว่าแถวไหน */
export function errorsText(errors: readonly RowError[]): string {
  return errors.map((e) => `แถว ${e.row}: ${e.text}`).join(" · ");
}
