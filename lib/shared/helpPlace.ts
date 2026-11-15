/**
 * ตำแหน่งของกล่องคำอธิบาย ⓘ (D173 เฟส 2a) — ฟังก์ชันล้วน ไม่แตะ DOM เพื่อให้เทสได้
 *
 * กล่องเป็น `position: fixed` (ไม่ถูกตัดโดยกรอบ `overflow` ของตาราง/ป๊อปอัพ)
 * ⇒ พิกัดทั้งหมดเป็นพิกัดในหน้าต่าง (viewport)
 *
 * กติกา:
 *  · ปกติเปิด **ใต้ปุ่ม** ชิดขอบซ้ายของปุ่ม
 *  · ล้นขอบขวา/ซ้าย → เลื่อนเข้ามาจนห่างขอบ `margin`
 *  · ใต้ปุ่มไม่พอ และเหนือปุ่มมีที่มากกว่า → เปิด **เหนือปุ่ม**
 *  · กล่องกว้าง/สูงกว่าจอ → ชิดขอบบน-ซ้าย (ตัวกล่องเลื่อนในตัวเองได้)
 */

export type Box = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };

export const HELP_MARGIN = 8;
export const HELP_GAP = 6;

export function helpPlace(btn: Box, pop: Size, view: Size): { left: number; top: number; above: boolean } {
  const maxLeft = view.width - pop.width - HELP_MARGIN;
  const left = Math.max(HELP_MARGIN, Math.min(btn.left, maxLeft));

  const below = btn.top + btn.height + HELP_GAP;
  const spaceBelow = view.height - below - HELP_MARGIN;
  const spaceAbove = btn.top - HELP_GAP - HELP_MARGIN;
  const above = pop.height > spaceBelow && spaceAbove > spaceBelow;

  const rawTop = above ? btn.top - HELP_GAP - pop.height : below;
  const maxTop = view.height - pop.height - HELP_MARGIN;
  const top = Math.max(HELP_MARGIN, Math.min(rawTop, maxTop));

  return { left, top, above };
}
