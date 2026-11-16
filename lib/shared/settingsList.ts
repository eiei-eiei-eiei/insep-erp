/**
 * กติกาของหน้าตั้งค่าแบบ ก (D173 เฟส 4a) — ฟังก์ชันล้วน ไม่แตะ DOM เพื่อให้เทสได้
 * ตัวหน้าจออยู่ที่ `lib/shared/settings.tsx`
 */

export type SettingsSection = { key: string; label: string; count?: number | null };

/** หัวข้อที่ควรเปิด: ที่ขอมา ถ้ายังมีอยู่ · ไม่งั้นหัวข้อแรก (หัวข้อหายได้ตามโมดูล/สิทธิ์) */
export function sectionOf(keys: string[], wanted: string | null | undefined): string {
  if (wanted && keys.includes(wanted)) return wanted;
  return keys[0] ?? "";
}

/**
 * ตรวจค่าที่จะเพิ่มเข้ารายการ — คืนข้อความไทยเมื่อเพิ่มไม่ได้ · null = เพิ่มได้
 * ★ เทียบซ้ำแบบไม่สนช่องว่างหัวท้ายและตัวพิมพ์ ("ค่าเช่า " กับ "ค่าเช่า" คือตัวเดียวกัน)
 *   แต่ **ค่าที่บันทึกคือค่าที่ผู้ใช้พิมพ์ (ตัดช่องว่างหัวท้าย)** — ไม่แปลงตัวพิมพ์ให้
 */
export function addError(list: string[], raw: string): string | null {
  const v = raw.trim();
  if (!v) return "ยังไม่ได้พิมพ์อะไร";
  const k = v.toLowerCase();
  if (list.some((x) => x.trim().toLowerCase() === k)) return `มี “${v}” อยู่แล้ว`;
  return null;
}

/** ป้ายจำนวนชิดขวาของหัวการ์ด — null/undefined = ไม่แสดง (ยังโหลดไม่เสร็จ ≠ 0 รายการ) */
export function countText(n: number | null | undefined, unit = "รายการ"): string {
  if (n == null) return "";
  return `${n.toLocaleString("en-US")} ${unit}`;
}
