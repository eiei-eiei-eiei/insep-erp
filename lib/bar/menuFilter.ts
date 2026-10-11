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
 *
 * ── 🔴 บั๊กที่เจอ (D107 · 2026-10-11): ตัวเปรียบเทียบวนเป็นวง ────────────────
 * เดิมคู่ custom↔custom ใช้ "ล่าสุด/ชื่อ" แต่คู่อื่นทั้งหมด (รวม custom↔ปกติ) ใช้เลข `sort`
 * ⇒ ข้อมูลจริงวนเป็นวง: เมรัย(custom, sort ว่าง=0) < Negroni(1) < ค็อกเทลลับ(custom, 5) < เมรัย (ตามชื่อ)
 * ตัวเรียงที่ไม่มีคำตอบเดียว = ผลลัพธ์ขึ้นกับเครื่องยนต์ JS — Node (เซิร์ฟเวอร์) กับ Chrome เรียงต่างกัน
 * ⇒ React hydration mismatch ในแท็บขาย และตะแกรง "ทั้งหมด" สลับที่เองเมื่อมีเมนูเพิ่ม
 * → **กลุ่มก่อน แล้วค่อยเกณฑ์ในกลุ่ม** (เมนูปกติก่อน · เมนูเฉพาะกิจไว้ท้าย) · ตัดสินสุดท้ายด้วย `menuId`
 *   ⇒ เป็นลำดับเดียวแน่นอนเสมอ ไม่ว่าข้อมูลเข้ามาลำดับไหน (เทสสลับลำดับข้อมูลเข้าทุกแบบ)
 * 🚨 ห้ามกลับไปเปรียบเทียบข้ามกลุ่มด้วยเกณฑ์ของกลุ่มใดกลุ่มหนึ่งอีก
 *
 * ── D108: ผู้ใช้จัดลำดับเองได้ แยกกันต่อหน้า ────────────────────────────────
 * `view = "all"` (หน้า "ทั้งหมด") ใช้ `sortAll` · หน้าหมวดใช้ `sort` — ตั้งหน้าหนึ่งไม่กระทบอีกหน้า
 * ลำดับว่าง = **ต่อท้าย** ตามชื่อ (เมนูใหม่ไม่ไปแทรกบนสุดของลำดับที่ผู้ใช้จัดไว้)
 *   ★ เดิมว่าง = 0 (ขึ้นก่อน) · เมนูที่สร้างจากหน้าจอไม่เคยมีเลขเลย ⇒ ลูกค้าที่ยังไม่เคยจัด
 *     ลำดับไม่ขยับ (ทุกตัวว่าง = เรียงตามชื่อเหมือนเดิม)
 */
export function sortMenusForGrid(
  menus: readonly BarMenu[],
  history: readonly MenuHistoryRow[] = [],
  view: "all" | "category" = "category",
): BarMenu[] {
  const pos = (x: BarMenu) => {
    const v = view === "all" ? x.sortAll : x.sort;
    return v === null || v === undefined ? Number.POSITIVE_INFINITY : v;
  };
  const last = new Map<string, string>();
  const freq = new Map<string, number>();
  for (const h of history) {
    const prev = last.get(h.menuId);
    if (!prev || h.at > prev) last.set(h.menuId, h.at);
    freq.set(h.menuId, (freq.get(h.menuId) ?? 0) + h.qty);
  }
  const isCustom = (x: BarMenu) => x.categoryId === CUSTOM_CATEGORY_ID;
  return [...menus].sort((a, b) => {
    const ca = isCustom(a);
    const cb = isCustom(b);
    if (ca !== cb) return ca ? 1 : -1; // เมนูปกติก่อน เมนูเฉพาะกิจไว้ท้าย
    if (ca) {
      const la = last.get(a.menuId) ?? "";
      const lb = last.get(b.menuId) ?? "";
      if (la !== lb) return la < lb ? 1 : -1; // ล่าสุดก่อน (ISO เทียบเป็นข้อความได้ตรง)
      const fa = freq.get(a.menuId) ?? 0;
      const fb = freq.get(b.menuId) ?? 0;
      if (fa !== fb) return fb - fa;
    } else {
      const sa = pos(a);
      const sb = pos(b);
      if (sa !== sb) return sa < sb ? -1 : 1; // (Infinity − Infinity = NaN — ห้ามลบกันตรง ๆ)
    }
    const byName = a.name.localeCompare(b.name, "th");
    if (byName !== 0) return byName;
    return a.menuId < b.menuId ? -1 : a.menuId > b.menuId ? 1 : 0;
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
