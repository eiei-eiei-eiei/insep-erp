/**
 * ตำแหน่งรายการลอยของ Combobox / SuggestInput (D185 · งานค้าง D173 ข้อ 3)
 *
 * 🪤 เดิมรายการเป็น `absolute` ใต้ช่อง ⇒ อยู่ในแถวตารางที่ครอบด้วยกรอบ `overflow-x-auto` แล้ว **โดนกรอบตัด**
 *    (เห็นแค่บรรทัดแรก หรือไม่เห็นเลย) — ตารางทั้งแอปอยู่ในกรอบแบบนี้ (D165) จึงใช้ Combobox ในแถวไม่ได้
 * ⇒ วางแบบ `fixed` ตามตำแหน่งช่องบนจอ (แบบเดียวกับ ⓘ `helpPlace`) · พลิกขึ้นด้านบนเมื่อด้านล่างไม่พอ
 * ★ ฟังก์ชันล้วน — เทสไล่ช่องทั่วจอได้โดยไม่ต้องมีเบราว์เซอร์
 */
export type Rect = { top: number; bottom: number; left: number; width: number };
export type FloatStyle = { top?: number; bottom?: number; left: number; width: number; maxHeight: number };

const GAP = 4; // ระยะห่างจากช่อง
const EDGE = 8; // ระยะห่างจากขอบจอ
const MAX_H = 256; // = max-h-64 เดิม
const MIN_W = 180; // ช่องแคบในแถวตาราง (เช่น งาน) — รายการกว้างกว่าช่องได้ อ่านชื่อยาวออก
const ENOUGH = 160; // ด้านล่างเหลือน้อยกว่านี้ และด้านบนกว้างกว่า = พลิกขึ้น

export function floatPlace(r: Rect, vh: number, vw: number): FloatStyle {
  const width = Math.min(Math.max(r.width, MIN_W), vw - EDGE * 2);
  const left = Math.max(EDGE, Math.min(r.left, vw - width - EDGE));
  const below = vh - r.bottom - GAP - EDGE;
  const above = r.top - GAP - EDGE;
  if (below < ENOUGH && above > below) {
    return { bottom: vh - r.top + GAP, left, width, maxHeight: Math.min(MAX_H, Math.max(0, above)) };
  }
  return { top: r.bottom + GAP, left, width, maxHeight: Math.min(MAX_H, Math.max(0, below)) };
}
