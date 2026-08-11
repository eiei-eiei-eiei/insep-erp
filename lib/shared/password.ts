/**
 * เกณฑ์รหัสผ่าน — ใช้ร่วมกันทุกจุดที่ตั้ง/เปลี่ยนรหัส (สร้างผู้ใช้ · รีเซ็ต · เปลี่ยนเอง)
 *
 * ที่มา: multi-tenant ทำให้ "รหัสผ่านซ้ำกันข้ามลูกค้า" กลายเป็นช่องโหว่จริง —
 * ถ้าลูกค้า 2 เจ้ามีทั้งชื่อผู้ใช้และรหัสตรงกัน คนของเจ้าหนึ่งล็อกอินเข้าอีกเจ้าได้
 * ผ่าน URL ของเขา · RLS ช่วยไม่ได้เพราะระบบเห็นว่าเขาคือเจ้าของบัญชีนั้นจริง ๆ
 * → ยิ่งรหัสเดาง่าย/ซ้ำกันบ่อย ความเสี่ยงยิ่งสูง
 *
 * ตั้งใจไม่ทำเกณฑ์โหดเกิน (ไม่บังคับอักขระพิเศษ) — ผู้ใช้กลุ่มนี้คือเจ้าของโรงกลั่น
 * ไม่ใช่วิศวกร บังคับมากจะได้รหัสจดใส่กระดาษแปะจอ ซึ่งแย่กว่า
 */

/** รหัสที่เจอบ่อยจนเดาได้ในไม่กี่ครั้ง — เทียบแบบ normalize แล้ว */
const COMMON = new Set([
  "password", "passw0rd", "12345678", "123456789", "1234567890",
  "qwertyui", "11111111", "00000000", "abc12345", "admin123",
  "iloveyou", "welcome1", "letmein1", "changeme", "insep123",
]);

export const PASSWORD_MIN = 8;

/**
 * ตรวจรหัสผ่าน → คืนข้อความบอกสาเหตุ (ภาษาไทย) หรือ null ถ้าผ่าน
 * @param username ถ้าส่งมา จะกันรหัสที่เหมือน/มีชื่อผู้ใช้อยู่ข้างใน
 */
export function validatePassword(
  password: string,
  username?: string | null,
): string | null {
  const pw = password ?? "";

  if (pw.length < PASSWORD_MIN) {
    return `รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN} ตัวอักษร`;
  }
  if (pw.trim() !== pw) {
    return "รหัสผ่านต้องไม่ขึ้นต้นหรือลงท้ายด้วยช่องว่าง (พิมพ์ผิดแล้วหาสาเหตุยาก)";
  }

  const norm = pw.toLowerCase();
  if (COMMON.has(norm)) {
    return "รหัสผ่านนี้เดาง่ายเกินไป — เป็นรหัสที่คนใช้กันทั่วไป";
  }
  if (/^(.)\1+$/.test(pw)) {
    return "รหัสผ่านต้องไม่เป็นตัวอักษรเดิมซ้ำทั้งหมด";
  }
  if (/^\d+$/.test(pw)) {
    return "รหัสผ่านต้องไม่เป็นตัวเลขล้วน";
  }

  const u = (username ?? "").trim().toLowerCase();
  if (u.length >= 3 && norm.includes(u)) {
    return "รหัสผ่านต้องไม่มีชื่อผู้ใช้อยู่ข้างใน";
  }

  return null;
}

/**
 * สุ่มรหัสตั้งต้นสำหรับผู้ใช้ที่สร้างให้ลูกค้า (provision/seed)
 *
 * 🚨 ห้ามใช้รหัสตั้งต้นตัวเดียวกันซ้ำข้ามลูกค้าเด็ดขาด —
 *    ลูกค้าทุกรายจะล็อกอินเข้าระบบกันเองได้ตั้งแต่วันแรก
 *    (ตัดอักขระที่อ่านสับสน 0/O/1/l/I ออก เพราะต้องบอกทางโทรศัพท์/LINE)
 */
export function generateInitialPassword(length = 14): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  // การันตีว่ามีทั้งตัวอักษรและตัวเลข (กันสุ่มได้ตัวเลขล้วนแล้วตกเกณฑ์ตัวเอง)
  return out.slice(0, length - 2) + "a7";
}
