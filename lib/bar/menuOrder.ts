/**
 * lib/bar/menuOrder — จัดลำดับเมนูบนหน้าขายเอง ▲▼ (D108)
 *
 * ผู้ใช้ขอ: เอาเมนูที่สั่งบ่อยมาไว้บนสุด ไม่ต้องเลื่อนหา · ผู้ใช้เลือก:
 *   · **จัดเองทั้งหมด** (ไม่ให้ระบบเรียงตามยอดขายเอง — ตำแหน่งขยับเองทำให้บาร์เทนเดอร์กดผิดตอนชงเร็ว ๆ)
 *   · **แต่ละหน้าตั้งแยกกัน** — หน้า "ทั้งหมด" ใช้ `sort_all` · หน้าหมวดใช้ `sort`
 *     (เมนูหนึ่งอยู่ได้หมวดเดียว ⇒ ลำดับของหมวดหนึ่งไม่มีทางกระทบหมวดอื่น)
 *
 * ★ ตัวเลขยอดขาย 30 วันโชว์ข้าง ๆ ให้**ช่วยตัดสินใจ**เท่านั้น ไม่ได้ใช้เรียง
 * 🚨 เมนูเฉพาะกิจ (`custom`) **จัดลำดับไม่ได้** — เรียงตามที่สั่งล่าสุดเสมอ (D96/D107)
 *    และอยู่ท้ายหน้า "ทั้งหมด" เสมอ · ปุ่มต้องบอกเหตุผล ไม่ใช่ซ่อนเฉย ๆ (D83)
 * 🚨 ประโยค/การตัดสินทุกอย่างอยู่ที่นี่ ห้ามตัดสินในคอมโพเนนต์ (D84/D88)
 */
import type { BarMenu } from "./types";
import { CUSTOM_CATEGORY_ID } from "./types";
import { sortMenusForGrid } from "./menuFilter";

/** "all" = หน้า "ทั้งหมด" · อื่น ๆ = category_id */
export type OrderView = "all" | string;

export const ALL_VIEW = "all";

/** คอลัมน์ที่หน้านั้นใช้ — ตัดสินที่นี่ที่เดียว (server เขียนตามนี้) */
export function orderColumn(view: OrderView): "sort_all" | "sort" {
  return view === ALL_VIEW ? "sort_all" : "sort";
}

/** หมวดเฉพาะกิจเรียงตามที่สั่งล่าสุด — คืนข้อความเหตุผลที่จัดเองไม่ได้ ("" = จัดได้) */
export function orderLockedReason(view: OrderView): string {
  return view === CUSTOM_CATEGORY_ID
    ? "หมวดเมนูที่คิดหน้าบาร์เรียงตามที่สั่งล่าสุดให้อัตโนมัติ — จัดลำดับเองไม่ได้"
    : "";
}

/**
 * รายการที่จัดลำดับได้ของหน้านั้น ตามลำดับที่หน้าขายแสดงอยู่ตอนนี้
 * (เฉพาะเมนูที่เปิดใช้ · ไม่รวมเมนูเฉพาะกิจ)
 */
export function orderableMenus(menus: readonly BarMenu[], view: OrderView): BarMenu[] {
  if (orderLockedReason(view)) return [];
  const list = menus.filter(
    (m) =>
      m.active !== false &&
      m.categoryId !== CUSTOM_CATEGORY_ID &&
      (view === ALL_VIEW || m.categoryId === view),
  );
  return sortMenusForGrid(list, [], view === ALL_VIEW ? "all" : "category");
}

/** ย้ายขึ้น/ลง 1 ขั้น — ★ ▲▼ ไม่ใช่ลาก (ทัชสกรีนชนกับการเลื่อนหน้า · D70) */
export function moveMenu(ids: readonly string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return [...ids];
  const out = [...ids];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** ขึ้นบนสุด — เมนูขายดีตัวใหม่ไม่ต้องกด ▲ ทีละขั้นยี่สิบครั้ง */
export function moveMenuToTop(ids: readonly string[], id: string): string[] {
  if (!ids.includes(id)) return [...ids];
  return [id, ...ids.filter((x) => x !== id)];
}

/**
 * ตรวจลำดับที่ส่งมาก่อนเขียน — ฝั่ง server เรียก
 * 🚨 ทุกตัวต้องมีจริง · ไม่ซ้ำ · อยู่ในหน้านั้นจริง · ไม่ใช่เมนูเฉพาะกิจ
 *    (ไม่บังคับให้ครบชุด: อีกเครื่องเพิ่มเมนูระหว่างนั้น เมนูใหม่ไม่มีเลข = ต่อท้ายเอง ไม่เสียหาย)
 */
export function menuOrderError(
  ids: readonly string[],
  rows: readonly { menuId: string; categoryId: string }[],
  view: OrderView,
): string {
  const locked = orderLockedReason(view);
  if (locked) return locked;
  if (ids.length === 0) return "ยังไม่มีเมนูให้จัดลำดับ";
  if (new Set(ids).size !== ids.length) return "มีเมนูซ้ำในลำดับที่ส่งมา — รีเฟรชหน้าแล้วลองใหม่";
  const byId = new Map(rows.map((r) => [r.menuId, r.categoryId]));
  for (const id of ids) {
    const cat = byId.get(id);
    if (cat === undefined) return "มีเมนูที่ถูกลบไประหว่างนั้น (อาจจากอีกเครื่อง) — รีเฟรชหน้าแล้วลองใหม่";
    if (cat === CUSTOM_CATEGORY_ID) return orderLockedReason(CUSTOM_CATEGORY_ID);
    if (view !== ALL_VIEW && cat !== view) {
      return "มีเมนูที่ถูกย้ายหมวดไประหว่างนั้น (อาจจากอีกเครื่อง) — รีเฟรชหน้าแล้วลองใหม่";
    }
  }
  return "";
}

/** แถวที่ต้องเขียนใหม่ — เลข 0,1,2,… ตามลำดับ · เขียนเฉพาะแถวที่ค่าเปลี่ยน */
export function menuOrderUpdates(
  ids: readonly string[],
  current: ReadonlyMap<string, number | null>,
): { menuId: string; pos: number }[] {
  return ids.map((menuId, pos) => ({ menuId, pos })).filter((u) => current.get(u.menuId) !== u.pos);
}

/** ยอดสั่ง (จำนวนแก้ว/ชิ้น) ต่อเมนู — ไม่นับบรรทัดที่ยกเลิก */
export function menuQtyMap(
  rows: readonly { menuId: string | null; qty: number; voided: boolean }[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.menuId || r.voided) continue;
    out.set(r.menuId, (out.get(r.menuId) ?? 0) + r.qty);
  }
  return out;
}

/** ป้ายยอดขายข้างชื่อเมนู */
export function salesHint(qty: number | undefined, days: number): string {
  return qty ? `ขายได้ ${qty.toLocaleString("en-US")} ใน ${days} วัน` : `ยังไม่มียอดใน ${days} วัน`;
}
