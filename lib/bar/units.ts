/**
 * lib/bar/units — แสดงยอดคงเหลือให้คนอ่านรู้เรื่อง (golden B5 · D96)
 *
 * ── หลักคิด ────────────────────────────────────────────────────────────────
 * ระบบ**เก็บ**ยอดในหน่วยที่สูตรกิน (ml) แต่คน**คิด**เป็นขวด
 * ⇒ "ขวด" เป็นแค่**วิธีแสดงผล ไม่ใช่หน่วยที่เก็บ** — เพราะถ้าเก็บเป็นขวด
 *   การขาย 1 แก้ว (60 ml) จะกลายเป็นเศษทศนิยมของขวดทันที และทุกยอดหลังจากนั้นจะปัดเพี้ยน
 *
 * 🚨 ฟังก์ชันในไฟล์นี้ **ห้ามถูกใช้คำนวณอะไรทั้งสิ้น** — เป็นชั้นแสดงผลล้วน ๆ
 *    ตัวเลขที่ตัดสต็อก/คิดต้นทุน ต้องมาจาก `recipe.ts` / `cost.ts` เท่านั้น
 */
import type { BarItem } from "./types";

/** ตัวเลขแบบมีคอมมา ตัดศูนย์ท้ายทศนิยมทิ้ง (2,240 · 3.2 · 0.5) */
export function numText(v: number, maxDecimals = 2): string {
  if (!Number.isFinite(v)) return "—";
  const rounded = Number(v.toFixed(maxDecimals));
  return rounded.toLocaleString("en-US", { maximumFractionDigits: maxDecimals });
}

/**
 * ยอดคงเหลือของ item — `"2,240 ml ≈ 3.2 ขวด (700 ml)"`
 *
 * · ไม่ได้ตั้ง `packSize` → แสดงหน่วยฐานอย่างเดียว (ไม่เดาว่า 1 ขวดเท่ากับเท่าไร)
 * · `packSize <= 0` → ถือว่าไม่ได้ตั้ง (หารด้วย 0 = Infinity ซึ่งจะกลายเป็นข้อความมั่ว)
 * 🪤 ไม่ปัดจำนวนขวดขึ้น — "เหลือ 0.4 ขวด" ต้องอ่านว่าไม่ถึงขวด ไม่ใช่ "1 ขวด"
 */
export function stockText(item: Pick<BarItem, "qty" | "unit" | "packSize" | "packLabel">): string {
  const base = `${numText(item.qty)} ${item.unit}`;
  const size = item.packSize ?? 0;
  if (!(size > 0)) return base;
  const packs = item.qty / size;
  const label = item.packLabel?.trim() || `หน่วย (${numText(size)} ${item.unit})`;
  return `${base} ≈ ${numText(packs, 1)} ${label}`;
}

/** แปลงหน่วยซื้อ → หน่วยฐาน (รับ 3 ขวด × 700 = 2,100 ml) · ไม่ได้ตั้ง packSize = 1:1 */
export function packToBase(qtyPack: number, packSize: number | null | undefined): number {
  const size = packSize ?? 0;
  return size > 0 ? qtyPack * size : qtyPack;
}

/** ของใกล้หมดไหม — ไม่ได้ตั้ง `lowQty` = **ไม่เตือน** (ไม่รู้ ≠ ใกล้หมด · หลัก D86) */
export function isLowStock(item: Pick<BarItem, "qty" | "lowQty">): boolean {
  const low = item.lowQty;
  if (low === null || low === undefined || !Number.isFinite(low)) return false;
  return item.qty <= low;
}
