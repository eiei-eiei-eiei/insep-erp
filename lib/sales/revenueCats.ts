/**
 * lib/sales/revenueCats — ลิสต์ "ประเภทรายได้" ของแอปขาย (D148 · golden S17)
 *
 * เดิมฮาร์ดโค้ด 4 ตัวไว้ใน QuotationTab แก้จากแอปไม่ได้ ทั้งที่ค่านี้ไปเป็น **หมวดของบิลรายรับในบัญชี**
 * ⇒ ผู้ใช้ตัดสิน: ใช้ลิสต์เดียวกับ "หมวดหมู่รายรับ" ของบัญชี (`app_settings.income_cat`)
 *   แก้ที่เดียวมีผลทั้งสองฝั่ง · ไม่ต้องมี migration
 *
 * 🚨 ยังไม่ตั้ง (ลิสต์ว่าง) = ใช้ 4 ตัวเดิม (พฤติกรรมเดิมทุกตัวอักษร)
 * 🚨 ค่าที่ออเดอร์เก็บไว้แต่ไม่อยู่ในลิสต์แล้ว ต้องยังอยู่ในตัวเลือก
 *    ไม่งั้น <select> โชว์ตัวแรกแต่ state ยังเป็นค่าเดิม = หน้าจอโกหก
 * 🚨 ประโยคบนจอตัดสินที่นี่ ไม่ใช่ในคอมโพเนนต์ (D84/D91)
 */

export const DEFAULT_REVENUE_CATS = ["รายได้ค่าสินค้า", "รายได้ค่าบริการ", "รายได้ค่าที่ปรึกษา", "รายได้อื่น ๆ"];

/** ค่าปริยายเดิมของใบใหม่และขายหน้าร้าน */
const PREFERRED = "รายได้ค่าสินค้า";

function clean(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of list) {
    const t = (v ?? "").trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** ลิสต์ที่มีผลจริง — ตั้งไว้ใช้ที่ตั้ง · ว่าง = ค่าเริ่มต้น 4 ตัว */
export function revenueCatsOf(set: readonly string[]): string[] {
  const s = clean(set);
  return s.length ? s : [...DEFAULT_REVENUE_CATS];
}

/** ตัวเลือกในดร็อปดาวน์ — ค่าปัจจุบันที่หลุดจากลิสต์ไปแล้วต่อหัวไว้ (แก้ใบเก่าแล้วหมวดไม่เปลี่ยนเงียบ ๆ) */
export function revenueCatOptions(set: readonly string[], current = ""): string[] {
  const list = revenueCatsOf(set);
  const cur = current.trim();
  return cur && !list.includes(cur) ? [cur, ...list] : list;
}

/** หมวดของใบใหม่/ขายหน้าร้าน — "รายได้ค่าสินค้า" ถ้ายังอยู่ในลิสต์ ไม่งั้นตัวแรกของลิสต์ */
export function defaultRevenueCat(set: readonly string[]): string {
  const list = revenueCatsOf(set);
  return list.includes(PREFERRED) ? PREFERRED : list[0];
}

/** คำอธิบายใต้ดร็อปดาวน์ — ว่าง = ไม่ต้องแสดงอะไร */
export function revenueCatHint(set: readonly string[], current: string, hasAccounting: boolean): string {
  const cur = current.trim();
  if (cur && clean(set).length && !clean(set).includes(cur)) {
    return `"${cur}" ไม่อยู่ในหมวดหมู่รายรับของบัญชีแล้ว — ใบนี้ยังใช้หมวดเดิมจนกว่าจะเลือกใหม่`;
  }
  if (!clean(set).length && hasAccounting) {
    return "ยังไม่ได้ตั้งหมวดหมู่รายรับ จึงใช้ค่าเริ่มต้น 4 ตัว — ตั้งลิสต์เองได้ที่ บัญชี → ตั้งค่า → หมวดหมู่รายรับ";
  }
  return hasAccounting ? "ลิสต์มาจาก บัญชี → ตั้งค่า → หมวดหมู่รายรับ" : "";
}
