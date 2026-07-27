/**
 * login แบบ username (ไม่ต้องมีอีเมลจริง) — ผูก Supabase Auth ด้วยอีเมลภายใน
 * <username>@<LOGIN_EMAIL_DOMAIN> (แผน sec 3.1) · ถ้ากรอกมีเครื่องหมาย @ อยู่แล้ว = ใช้เป็นอีเมลจริง
 * ⚠️ ใช้ฝั่ง server เท่านั้น (อ่าน process.env ที่ไม่ใช่ NEXT_PUBLIC)
 */
export const LOGIN_EMAIL_DOMAIN = process.env.LOGIN_EMAIL_DOMAIN || "insep.local";

export function usernameToEmail(input: string): string {
  const s = input.trim();
  if (!s) return s;
  return s.includes("@") ? s.toLowerCase() : `${s.toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`;
}

/** ตรวจรูปแบบ username: a-z 0-9 . _ - ยาว 3-32 (กันตัวอักษรที่ทำให้อีเมลเพี้ยน) */
export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
