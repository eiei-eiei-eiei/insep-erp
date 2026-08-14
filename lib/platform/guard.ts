/**
 * ด่านที่ 1 ของแอปจัดการหลังบ้าน — "deployment นี้เป็นของแอดมินหรือเปล่า"
 *
 * โค้ดชุดเดียวกันถูก deploy ทั้งให้ลูกค้าและให้แอดมิน (requirement ข้อ 2.3 — ไม่แยก repo
 * เพราะต้องใช้ของร่วมกันเยอะ แยกแล้ววันหนึ่งจะเพี้ยนกัน) → ตัวแยกคือ env ต่อ deployment
 *
 * ★ ไฟล์นี้ต้อง **ไม่ import อะไรเลย** — `middleware.ts` รันบน edge runtime
 *   ซึ่งใช้ `server-only` / supabase client ไม่ได้
 *
 * 🚨 นี่เป็นแค่ด่านแรก ไม่ใช่ด่านสุดท้าย — ด่านที่ 2 คือตาราง `platform_admins`
 *    (lib/platform/auth.ts) เพราะ deployment ของแอดมินก็ยังต้องกันคนอื่นที่บังเอิญมีบัญชี
 */

/**
 * รับทั้ง "1" และ "true" — ค่าใน Vercel เป็น string เสมอ และคนตั้งค่าเองมักพิมพ์ true
 * ค่าอื่น/ไม่ตั้ง = ปิด (fail-closed) → route ตอบ 404 เหมือนไม่มีหน้านี้อยู่จริง
 */
export function platformEnabled(flag: string | null | undefined): boolean {
  const v = (flag ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/** path ที่อยู่ใต้แอปจัดการหลังบ้าน (ใช้ใน middleware) */
export function isPlatformPath(pathname: string): boolean {
  return pathname === "/platform" || pathname.startsWith("/platform/");
}
