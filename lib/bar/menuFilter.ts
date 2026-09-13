/**
 * lib/bar/menuFilter — ชิปกรอง "เฉพาะของ [ลูกค้า]" + เรียงหมวด custom (golden B9 · D96)
 *
 * ── 🚨 กติกาข้อเดียวที่ห้ามพลาดของไฟล์นี้ ─────────────────────────────────
 * **นี่คือ "มุมมอง" ไม่ใช่ "สิทธิ์"**
 * เมนูที่สร้างให้ลูกค้าคนหนึ่ง ลูกค้าคนอื่น**ต้องสั่งได้ปกติ** — ปิดชิปกรองแล้วต้องเห็นครบ
 * ⇒ ห้ามเอา `createdFor` ไปกรองใน RLS หรือใน query หลักเด็ดขาด
 *   พลาดข้อนี้ เมนูจะค่อย ๆ หายจากตะแกรงโดยไม่มีใครรู้สาเหตุ
 *   (หลักเดียวกับ D78/D80/D94: **การซ่อนก็คือการเดา**)
 *
 * ── ความสัมพันธ์ลูกค้า↔เมนู มี 3 ทาง รวมเป็นเซตเดียว ───────────────────────
 *   1. สร้างให้ตั้งแต่แรก  `menu.createdFor`
 *   2. ปักหมุดเป็นของโปรด  `bar_customer_fav`
 *   3. เคยสั่ง             ไล่จากประวัติ `bar_sale_item` (ไม่ต้องเก็บซ้ำ)
 */
import type { BarMenu } from "./types";
import { CUSTOM_CATEGORY_ID } from "./types";

/** 1 แถวประวัติการสั่งที่ย่อแล้ว — พอสำหรับทั้งฟิลเตอร์และการเรียง */
export type MenuHistoryRow = {
  menuId: string;
  customerId?: string | null;
  /** ISO datetime ของตอนสั่ง */
  at: string;
  qty: number;
};

/**
 * เมนูที่ "เป็นของ" ลูกค้าคนนี้ — union ของ 3 ทาง
 * ไม่ระบุลูกค้า = เซตว่าง (ไม่ใช่ทุกเมนู — ชิปกรองจะไม่ถูกแสดงอยู่แล้ว)
 */
export function customerMenuIds(
  customerId: string | null | undefined,
  src: {
    menus: readonly BarMenu[];
    favMenuIds?: readonly string[];
    history?: readonly MenuHistoryRow[];
  },
): Set<string> {
  const out = new Set<string>();
  if (!customerId) return out;
  for (const m of src.menus) if (m.createdFor === customerId) out.add(m.menuId);
  for (const id of src.favMenuIds ?? []) out.add(id);
  for (const h of src.history ?? []) if (h.customerId === customerId) out.add(h.menuId);
  return out;
}

/**
 * ใช้ชิปกรองกับรายการเมนู
 * 🚨 `on = false` **ต้องคืนรายการเดิมครบทุกตัว** — เทสล็อกไว้ 2 ทิศทาง
 */
export function applyCustomerChip(
  menus: readonly BarMenu[],
  on: boolean,
  ids: ReadonlySet<string>,
): BarMenu[] {
  if (!on) return [...menus];
  return menus.filter((m) => ids.has(m.menuId));
}

/**
 * เรียงเมนูในหมวด `custom`
 *
 * 🪤 ผ่านไปครึ่งปีหมวดนี้จะมีเป็นร้อยเมนู — เรียงตามตัวอักษรจะหาไม่เจอ
 *    ⇒ เรียงตาม **สั่งล่าสุดก่อน** แล้วค่อยตามความถี่ แล้วค่อยตามชื่อ
 * ★ จงใจยังไม่เพิ่มธง "ซ่อนจากตะแกรง" — ธงที่สองบนของชิ้นเดียวคือต้นทางของ
 *   "ค่าเดียวมีสองนิยาม" ที่กัดมาแล้วใน D81/D88/D91 · เพิ่มเมื่อเจอปัญหาจริง
 */
export function sortMenusForGrid(
  menus: readonly BarMenu[],
  history: readonly MenuHistoryRow[] = [],
): BarMenu[] {
  const last = new Map<string, string>();
  const freq = new Map<string, number>();
  for (const h of history) {
    const prev = last.get(h.menuId);
    if (!prev || h.at > prev) last.set(h.menuId, h.at);
    freq.set(h.menuId, (freq.get(h.menuId) ?? 0) + h.qty);
  }
  return [...menus].sort((a, b) => {
    const custom = a.categoryId === CUSTOM_CATEGORY_ID && b.categoryId === CUSTOM_CATEGORY_ID;
    if (custom) {
      const la = last.get(a.menuId) ?? "";
      const lb = last.get(b.menuId) ?? "";
      if (la !== lb) return lb.localeCompare(la); // ล่าสุดก่อน
      const fa = freq.get(a.menuId) ?? 0;
      const fb = freq.get(b.menuId) ?? 0;
      if (fa !== fb) return fb - fa;
      return a.name.localeCompare(b.name, "th");
    }
    const sa = a.sort ?? 0;
    const sb = b.sort ?? 0;
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name, "th");
  });
}

/** ค้นหาเมนูด้วยข้อความ — ชื่อ · โน้ต · แก้ว · วิธีชง (พิมพ์คำในสูตรก็เจอ) */
export function searchMenus(menus: readonly BarMenu[], q: string): BarMenu[] {
  const t = q.trim().toLowerCase();
  if (!t) return [...menus];
  return menus.filter((m) =>
    [m.name, m.note, m.glass, m.method].some((f) => (f ?? "").toLowerCase().includes(t)),
  );
}
