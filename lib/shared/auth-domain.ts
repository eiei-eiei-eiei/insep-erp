/**
 * login แบบ username (ไม่ต้องมีอีเมลจริง) — ผูก Supabase Auth ด้วยอีเมลภายใน
 * <username>@<LOGIN_EMAIL_DOMAIN> (แผน sec 3.1) · ถ้ากรอกมีเครื่องหมาย @ อยู่แล้ว = ใช้เป็นอีเมลจริง
 * ⚠️ ใช้ฝั่ง server เท่านั้น (อ่าน process.env ที่ไม่ใช่ NEXT_PUBLIC)
 *
 * ★ multi-tenant (NEXT_STEPS 4.7): auth.users.email ถูกบังคับ unique ทั้ง Supabase project
 *   และเป็นตารางของ auth เราเติม tenant_id เข้าไปไม่ได้ → ลูกค้า 2 เจ้าตั้งชื่อผู้ใช้ 'admin'
 *   เหมือนกันไม่ได้ ถ้าไม่แยก namespace ที่โดเมน
 *   → ใส่ slug คั่น: admin@rongkor.insep.local  vs  admin@rongkhor.insep.local
 */
import { isValidTenantSlug } from "./tenant";

export const LOGIN_EMAIL_DOMAIN = process.env.LOGIN_EMAIL_DOMAIN || "insep.local";

/**
 * @param tenantSlug slug จาก subdomain — **ใช้แค่ประกอบชื่อบัญชีที่จะลองล็อกอิน ไม่ใช่ตัวให้สิทธิ์**
 *   ไม่ส่ง = พฤติกรรมเดิมทุกอย่าง (deployment ที่มีลูกค้าเจ้าเดียว เช่น DB ของเจ้าของเอง
 *   ที่บัญชีเดิมเป็น <username>@insep.local อยู่แล้ว — ห้ามทำให้ล็อกอินเดิมพัง)
 */
export function usernameToEmail(input: string, tenantSlug?: string | null): string {
  const s = input.trim();
  if (!s) return s;

  // กรอกอีเมลเต็มมาเอง = ใช้ตามนั้น (ทางออกตอน subdomain ไม่ตรง — ดูกติกาข้อ 3 ในแผน)
  if (s.includes("@")) return s.toLowerCase();

  const domain =
    tenantSlug && isValidTenantSlug(tenantSlug)
      ? `${tenantSlug}.${LOGIN_EMAIL_DOMAIN}`
      : LOGIN_EMAIL_DOMAIN;

  return `${s.toLowerCase()}@${domain}`;
}

/** ตรวจรูปแบบ username: a-z 0-9 . _ - ยาว 3-32 (กันตัวอักษรที่ทำให้อีเมลเพี้ยน) */
export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
