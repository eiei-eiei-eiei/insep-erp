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
import type { BarItem, BarMenu } from "./types";
import { packToBase, numText } from "./units";

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

/* ── หน่วยที่กรอก: หน่วยซื้อ (ลูก/ขวด) หรือหน่วยฐาน (ml) · D104 ─────────── */

/**
 * ระบบ**เก็บ**เป็นหน่วยฐานเสมอ — หน่วยซื้อเป็นแค่วิธีกรอก แปลงด้วย `packSize` ของวัตถุดิบ
 * (หลักเดียวกับ units.ts: "ขวด" เป็นวิธีแสดงผล ไม่ใช่หน่วยที่เก็บ)
 */
export type QtyUnit = "base" | "pack";

const hasPack = (packSize: number | "" | null | undefined): packSize is number =>
  typeof packSize === "number" && packSize > 0;

/** ปัด 4 ตำแหน่ง — 🪤 2.4 × 700 = 1680.0000000000002 ในเลขทศนิยมของ JS */
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** แปลงค่าที่กรอกเป็นหน่วยฐาน · ไม่มี packSize = กรอกเป็นหน่วยฐานอยู่แล้ว (เลือก pack ไม่มีผล) */
export function toBase(value: number, unit: QtyUnit, packSize: number | "" | null | undefined): number {
  return r4(unit === "pack" && hasPack(packSize) ? value * packSize : value);
}

/** หน่วยปริยายของช่องกรอก — มีหน่วยซื้อ = กรอกเป็นหน่วยซื้อ (คนนับเป็นลูก/ขวด) */
export const defaultUnit = (packSize: number | "" | null | undefined): QtyUnit => (hasPack(packSize) ? "pack" : "base");

/** ชื่อหน่วยบนปุ่มสลับ — ป้ายหน่วยซื้อที่ตั้งไว้ ไม่งั้น "หน่วยซื้อ" */
export function unitLabel(item: Pick<BarItem, "unit" | "packLabel">, unit: QtyUnit): string {
  if (unit === "base") return item.unit;
  const label = item.packLabel?.trim();
  // ป้ายแบบ "ขวด (700 ml)" → เอาคำแรกพอ ปุ่มจะได้ไม่ยาว
  return label ? label.split(/\s*\(/)[0] : "หน่วยซื้อ";
}

/* ── นับสต็อก / ปรับยอด ─────────────────────────────────────────────────── */

export const ADJUST_REASONS = ["ปรับยอด", "เสียหาย", "ชิม/เทสต์"] as const;

/**
 * 1 แถวต่อวัตถุดิบ 1 ตัว — ตารางแสดงครบทุกรายการเสมอ (D104)
 * ★ **ช่องว่าง = ใช้ค่าในระบบ** (ข้าม) · 0 = นับแล้วหมด
 */
export type CountDraft = { itemId: string; value: number | ""; unit: QtyUnit; reason: string; note: string };
export type AdjustRow = { row: number; itemId: string; qtyAfter: number; reason: string; note: string };

/** วัตถุดิบที่ยังใช้อยู่ + ตัวที่เลิกใช้แต่ยังมียอดค้าง (ยอดค้างต้องนับได้ ไม่งั้นติดอยู่อย่างนั้นตลอดไป) */
export function countItems(items: readonly BarItem[]): BarItem[] {
  return items.filter((i) => i.active !== false || i.qty !== 0);
}

export function countDrafts(items: readonly BarItem[]): CountDraft[] {
  return countItems(items).map((i) => ({
    itemId: i.itemId, value: "", unit: defaultUnit(i.packSize), reason: ADJUST_REASONS[0], note: "",
  }));
}

/** ค่าที่จะบันทึกของแถวนี้ (หน่วยฐาน) + ต่างจากระบบเท่าไร · ว่าง = null */
export function countPreview(d: CountDraft, item: BarItem): { after: number; diff: number } | null {
  if (d.value === "") return null;
  const after = toBase(d.value, d.unit, item.packSize);
  return { after, diff: r4(after - item.qty) };
}

/**
 * · ว่าง = ข้ามเงียบ (ใช้ค่าในระบบ) — นี่คือสภาพปกติของตารางที่แสดงครบทุกรายการ
 * · 🚨 เปลี่ยนเหตุผล/ใส่หมายเหตุ แต่ไม่กรอกยอด = error ไม่ใช่ข้ามเงียบ
 *   (ผู้ใช้ตั้งใจบันทึกบางอย่างในแถวนั้น — ข้ามแล้วของที่ตั้งใจบันทึกหายโดยไม่มีอะไรบอก)
 * · ยอดเท่าเดิม = ข้าม (นับจำนวนไว้บอกบนจอ) — RPC ตัวเดี่ยวตอบ error เมื่อเท่าเดิม
 */
export function planCount(drafts: readonly CountDraft[], items: readonly BarItem[]): Result<AdjustRow> & { same: number } {
  const rows: AdjustRow[] = [];
  const errors: RowError[] = [];
  let skipped = 0;
  let same = 0;
  drafts.forEach((d, i) => {
    const row = i + 1;
    const item = items.find((it) => it.itemId === d.itemId);
    if (!item) return void errors.push({ row, text: "ไม่พบวัตถุดิบ (รีเฟรชหน้า)" });
    if (d.value === "") {
      if (d.note.trim() || d.reason !== ADJUST_REASONS[0])
        return void errors.push({ row, text: `${item.name}: ใส่เหตุผล/หมายเหตุไว้แต่ยังไม่ได้กรอกยอดที่นับได้` });
      skipped++;
      return;
    }
    if (d.value < 0) return void errors.push({ row, text: `${item.name}: ยอดที่นับได้ติดลบไม่ได้` });
    if (!(ADJUST_REASONS as readonly string[]).includes(d.reason))
      return void errors.push({ row, text: `${item.name}: เหตุผลไม่ถูกต้อง` });
    const after = toBase(d.value, d.unit, item.packSize);
    if (after === item.qty) {
      same++;
      return;
    }
    rows.push({ row, itemId: item.itemId, qtyAfter: after, reason: d.reason, note: d.note.trim() });
  });
  return { rows, errors, skipped, same };
}

/* ── ค่าเตือนของใกล้หมด — กรอกเป็นหน่วยซื้อได้ (D104) ────────────────────── */

/**
 * ค่าที่เก็บไว้ (หน่วยฐาน) → ค่าในช่องกรอก
 * 🪤 แปลงเป็นหน่วยซื้อเฉพาะเมื่อหารลงตัวไม่เกินทศนิยม 2 ตำแหน่ง — 100 ml ของขวด 700
 *    = 0.142857… ขวด ขึ้นในช่องแบบนั้นอ่านไม่รู้เรื่อง และแปลงกลับแล้วเพี้ยนจากค่าเดิม
 */
export function lowToDraft(
  lowQty: number | null | undefined,
  packSize: number | "" | null | undefined,
): { lowQty: number | ""; lowUnit: QtyUnit } {
  if (lowQty === null || lowQty === undefined) return { lowQty: "", lowUnit: defaultUnit(packSize) };
  if (hasPack(packSize)) {
    const packs = lowQty / packSize;
    if (Math.abs(Math.round(packs * 100) / 100 - packs) < 1e-9) return { lowQty: Math.round(packs * 100) / 100, lowUnit: "pack" };
  }
  return { lowQty, lowUnit: "base" };
}

/** ช่องกรอก → ค่าที่เก็บ · ว่าง/0 = ไม่เตือน (null) */
export function lowToBase(value: number | "", unit: QtyUnit, packSize: number | "" | null | undefined): number | null {
  if (value === "" || !(value > 0)) return null;
  return toBase(value, unit, packSize);
}

/* ── เพิ่มวัตถุดิบ ──────────────────────────────────────────────────────── */

export type NewItemDraft = {
  name: string;
  unit: string;
  packSize: number | "";
  packLabel: string;
  lowQty: number | "";
  lowUnit: QtyUnit;
};
export type NewItemRow = {
  name: string;
  unit: string;
  packSize: number | null;
  packLabel: string | null;
  lowQty: number | null;
};

export const blankNewItem = (): NewItemDraft => ({ name: "", unit: "ml", packSize: "", packLabel: "", lowQty: "", lowUnit: "pack" });

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
      lowQty: lowToBase(d.lowQty, d.lowUnit, d.packSize),
    });
  });
  return { rows, errors, skipped };
}

/* ── แก้วัตถุดิบทุกรายการแล้วบันทึกทีเดียว (D104) ─────────────────────────── */

export type ItemEditDraft = {
  itemId: string;
  name: string;
  unit: string;
  packSize: number | "";
  packLabel: string;
  lowQty: number | "";
  lowUnit: QtyUnit;
  active: boolean;
};
export type ItemEditRow = {
  itemId: string;
  name: string;
  unit: string;
  packSize: number | null;
  packLabel: string | null;
  lowQty: number | null;
  active: boolean;
};

export function editDrafts(items: readonly BarItem[]): ItemEditDraft[] {
  return items.map((i) => ({
    itemId: i.itemId,
    name: i.name,
    unit: i.unit,
    packSize: i.packSize ?? "",
    packLabel: i.packLabel ?? "",
    ...lowToDraft(i.lowQty, i.packSize),
    active: i.active !== false,
  }));
}

/** วัตถุดิบตัวไหนถูกใช้ในสูตรกี่เมนู */
export function recipeUseCount(menus: readonly BarMenu[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const menu of menus) for (const line of menu.recipe) m.set(line.itemId, (m.get(line.itemId) ?? 0) + 1);
  return m;
}

/**
 * 🚨 **หน่วยที่สูตรใช้ แก้ได้เฉพาะวัตถุดิบที่ยอดเป็น 0 และไม่มีสูตรไหนใช้**
 *    วอดก้าเหลือ 1,400 ml แล้วแก้หน่วยเป็น "ขวด" = ยอดกลายเป็น 1,400 ขวดทันที
 *    และสูตรที่ตัด 45 (ml) จะตัด 45 ขวด — ตัวเลขไม่ขยับสักตัว แค่ความหมายเปลี่ยน ไม่มีอะไรฟ้อง
 * คืนเหตุผลที่ล็อก (บอกว่าต้องทำอะไรก่อน · D88) หรือ null = แก้ได้
 */
export function unitLockReason(item: Pick<BarItem, "qty" | "unit">, usedIn: number): string | null {
  if (item.qty !== 0) return `ยังมียอดคงเหลือ ${numText(item.qty)} ${item.unit} — นับสต็อกให้เป็น 0 ก่อนถึงจะเปลี่ยนหน่วยได้`;
  if (usedIn > 0) return `ใช้อยู่ในสูตร ${usedIn} เมนู — เอาออกจากสูตรก่อนถึงจะเปลี่ยนหน่วยได้`;
  return null;
}

/** ส่งเฉพาะแถวที่เปลี่ยนจริง · ตรวจชื่อว่าง/ซ้ำ · หน่วยที่ถูกล็อก */
export function planItemEdits(
  drafts: readonly ItemEditDraft[],
  items: readonly BarItem[],
  used: ReadonlyMap<string, number>,
): { rows: ItemEditRow[]; errors: RowError[] } {
  const rows: ItemEditRow[] = [];
  const errors: RowError[] = [];
  const key = (s: string) => s.trim().toLowerCase();
  // ชื่อหลังแก้ของทุกตัว — ตัวที่ไม่ได้อยู่ในฉบับร่างใช้ชื่อเดิม
  const finalName = new Map(items.map((i) => [i.itemId, i.name]));
  for (const d of drafts) finalName.set(d.itemId, d.name);
  const count = new Map<string, number>();
  for (const n of finalName.values()) count.set(key(n), (count.get(key(n)) ?? 0) + 1);

  drafts.forEach((d, i) => {
    const row = i + 1;
    const item = items.find((it) => it.itemId === d.itemId);
    if (!item) return void errors.push({ row, text: "ไม่พบวัตถุดิบ (รีเฟรชหน้า)" });
    const name = d.name.trim();
    const unit = d.unit.trim();
    if (!name) return void errors.push({ row, text: `${item.name}: ชื่อว่างไม่ได้` });
    // 🪤 ฟ้องเฉพาะแถวที่ "เปลี่ยนชื่อ" — ข้อมูลเก่าที่มีชื่อซ้ำกันอยู่แล้วต้องไม่ล็อกการแก้ทั้งตารางตลอดไป
    //    (และไม่ฟ้องแถวที่ผู้ใช้ไม่ได้แตะ ให้ข้อความชี้ไปที่แถวที่เพิ่งพิมพ์)
    if (key(name) !== key(item.name) && (count.get(key(name)) ?? 0) > 1)
      return void errors.push({ row, text: `"${name}" ซ้ำกับวัตถุดิบตัวอื่น` });
    if (!unit) return void errors.push({ row, text: `${name}: ระบุหน่วยที่สูตรใช้` });
    if (unit !== item.unit) {
      const lock = unitLockReason(item, used.get(item.itemId) ?? 0);
      if (lock) return void errors.push({ row, text: `${name}: ${lock}` });
    }
    const packSize = hasPack(d.packSize) ? d.packSize : null;
    const next: ItemEditRow = {
      itemId: item.itemId,
      name,
      unit,
      packSize,
      packLabel: d.packLabel.trim() || null,
      lowQty: lowToBase(d.lowQty, d.lowUnit, packSize),
      active: d.active,
    };
    const changed =
      next.name !== item.name ||
      next.unit !== item.unit ||
      next.packSize !== (item.packSize ?? null) ||
      next.packLabel !== (item.packLabel?.trim() || null) ||
      (next.lowQty === null ? item.lowQty != null : item.lowQty == null || r4(item.lowQty) !== next.lowQty) ||
      next.active !== (item.active !== false);
    if (changed) rows.push(next);
  });
  return { rows, errors };
}

/** ข้อความ error รวม — บอกเลขแถวเสมอ ไม่งั้นหาไม่เจอว่าแถวไหน */
export function errorsText(errors: readonly RowError[]): string {
  return errors.map((e) => `แถว ${e.row}: ${e.text}`).join(" · ");
}
