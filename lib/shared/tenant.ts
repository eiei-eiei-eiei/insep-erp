/**
 * ตัวช่วยเรื่อง tenant ฝั่ง "แต่งหน้า + ชี้ทาง" เท่านั้น (NEXT_STEPS ข้อ 4.7)
 *
 * 🚨 กติกาเหล็ก: **ห้ามใช้ค่าจากไฟล์นี้ตัดสินสิทธิ์เข้าถึงข้อมูลเด็ดขาด**
 *    slug มาจาก URL ซึ่งใครก็พิมพ์เองได้ → ใช้ได้แค่ 2 อย่าง
 *      1. เลือกว่าจะโชว์แบรนด์ของใครที่หน้า login (ยังไม่รู้ว่าใครล็อกอิน)
 *      2. ประกอบชื่อบัญชีที่จะ "ลอง" ล็อกอิน (ยังต้องมีรหัสผ่านของบัญชีนั้นอยู่ดี)
 *    สิทธิ์เห็นข้อมูลจริงมาจาก auth.uid() → profiles.tenant_id → my_tenant() → RLS เท่านั้น
 */

/**
 * slug ต้องปลอดภัยทั้งเป็น subdomain และเป็นส่วนหนึ่งของโดเมนอีเมล
 * → รูปแบบเดียวกับ DNS label: a-z 0-9 และ - (ห้ามขึ้นต้น/ลงท้ายด้วย -) ยาว 1-32
 * ⚠️ ห้ามใช้ภาษาไทยเป็น slug — subdomain ไทยต้องแปลงเป็น punycode ทำให้อีเมลภายในเพี้ยน
 */
export const TENANT_SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

export function isValidTenantSlug(slug: string): boolean {
  return TENANT_SLUG_RE.test(slug);
}

/** โดเมนหลักของแพลตฟอร์ม (ไม่มี = โหมดลิงก์เดียว ไม่ใช้ subdomain) */
export const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "";

/** subdomain ที่สงวนไว้ ไม่ใช่ชื่อลูกค้า */
const RESERVED = new Set(["www", "app", "admin", "api", "static", "assets"]);

/**
 * แกะ slug ของ tenant จาก host
 *
 * รองรับ 3 แบบ:
 *   rongkor.example.com  + root example.com → 'rongkor'
 *   rongkor.localhost:3000                  → 'rongkor'  (เทส multi-tenant ในเครื่องได้)
 *   example.com / localhost:3000            → null       (ไม่มี subdomain)
 *
 * คืน null เมื่อแกะไม่ได้ / เป็นชื่อสงวน / รูปแบบไม่ผ่าน — ผู้เรียกต้องรับมือกรณี null เสมอ
 */
export function hostToTenantSlug(
  host: string | null | undefined,
  rootDomain: string = ROOT_DOMAIN,
): string | null {
  if (!host) return null;

  // ตัด port + normalize (host header อาจมี :3000 หรือตัวพิมพ์ใหญ่ปนมา)
  const h = host.split(":")[0].trim().toLowerCase();
  if (!h) return null;

  let sub: string | null = null;

  if (h.endsWith(".localhost")) {
    sub = h.slice(0, -".localhost".length);
  } else {
    const root = rootDomain.trim().toLowerCase();
    if (!root || h === root || !h.endsWith(`.${root}`)) return null;
    sub = h.slice(0, -(root.length + 1));
  }

  // รับเฉพาะชั้นเดียว (a.b.example.com ไม่ใช่ tenant — กันความกำกวม)
  if (!sub || sub.includes(".")) return null;
  if (RESERVED.has(sub)) return null;
  return isValidTenantSlug(sub) ? sub : null;
}

/**
 * ── ทำไมไม่มีฟังก์ชัน "redirect ไป subdomain ที่ถูกต้อง" ────────────────────
 *
 * เคสที่พูดถึง: ผู้ใช้ของลูกค้า ก. ไปยืนที่ subdomain ของลูกค้า ข. แล้วกรอก
 * **อีเมลเต็ม** ของตัวเอง → ล็อกอินผ่าน เห็นข้อมูลของ ก. ถูกต้อง (RLS ตัดสินจาก
 * profiles ไม่ใช่ URL) แต่หน้า login ที่เพิ่งผ่านมาแสดงแบรนด์ของ ข.
 *
 * ตอนแรกวางแผนจะ redirect ไป subdomain ที่ถูก แต่ตอนลงมือพบว่าไม่คุ้ม:
 *   1. cookie ของ Supabase เป็น host-only (ไม่ตั้ง Domain) → ข้าม subdomain แล้ว
 *      session ไม่ติดไปด้วย = ผู้ใช้ต้องล็อกอิน **ซ้ำอีกรอบ** โดยไม่รู้ว่าทำไม
 *   2. แบรนด์ที่ผิดหายไปเองทันทีที่เข้าแอป เพราะ (app)/layout.tsx อ่าน app_settings
 *      ของ tenant ที่ล็อกอินอยู่ → ผิดแค่ชั่ววินาทีบนหน้า login ที่ผ่านไปแล้ว
 *   3. ไม่ใช่ช่องโหว่ — ไม่มีข้อมูลของใครรั่ว มีแค่โลโก้ผิดชั่วคราว
 *
 * → ปล่อยไว้ดีกว่าแก้ · ถ้าวันหนึ่งอยากทำจริง ต้องแก้เรื่อง cookie domain ก่อน
 */
