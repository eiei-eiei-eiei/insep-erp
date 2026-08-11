/**
 * login แบบ username (ไม่ต้องมีอีเมลจริง) — ผูก Supabase Auth ด้วยอีเมลภายใน
 * <username>@<LOGIN_EMAIL_DOMAIN> (แผน sec 3.1) · ถ้ากรอกมีเครื่องหมาย @ อยู่แล้ว = ใช้เป็นอีเมลจริง
 * ⚠️ ใช้ฝั่ง server เท่านั้น (อ่าน process.env ที่ไม่ใช่ NEXT_PUBLIC)
 *
 * ★ multi-tenant: **ชื่อผู้ใช้ไม่ซ้ำทั้งระบบ** (migration 0032) ไม่ได้แยก namespace ต่อกิจการ
 *
 *   เคยลองแยกด้วย slug (`admin@rongkor.insep.local`) เพื่อให้ลูกค้าทุกเจ้าใช้ชื่อ 'admin' ได้
 *   แต่เปิดช่องให้คนของกิจการหนึ่งพิมพ์ **ชื่อตัวเอง** ที่ URL ของอีกกิจการ แล้วเข้าได้เลย
 *   ถ้ารหัสผ่านบังเอิญตรงกัน — โดยไม่ต้องรู้อะไรเกี่ยวกับเป้าหมายเลย
 *   → เลิกใช้ · ชื่อไม่ซ้ำทั้งระบบแทน = พิมพ์ชื่อตัวเองที่ URL ไหนก็เข้าบัญชีตัวเอง
 *
 *   ผลพลอยได้: subdomain ไม่เกี่ยวกับการล็อกอินอีกต่อไป เป็นแค่ของแต่งหน้า (co-brand)
 */
export const LOGIN_EMAIL_DOMAIN = process.env.LOGIN_EMAIL_DOMAIN || "insep.local";

export function usernameToEmail(input: string): string {
  const s = input.trim();
  if (!s) return s;
  // กรอกอีเมลจริงมาเอง = ใช้ตามนั้น
  return s.includes("@") ? s.toLowerCase() : `${s.toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`;
}

/** ตรวจรูปแบบ username: a-z 0-9 . _ - ยาว 3-32 (กันตัวอักษรที่ทำให้อีเมลเพี้ยน) */
export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
