/**
 * lib/connector/grant — กติกาให้สิทธิ์ Claude connector จากหน้า /platform (D141) · ฟังก์ชันล้วน
 * ★ ประโยคบนจอตัดสินที่นี่ (มีเทสคุม) ไม่ใช่ในคอมโพเนนต์ (D84/D91)
 */
import { can, ROLE_LABEL, toRole } from "../shared/roles";

/**
 * เหตุผลที่ "ให้สิทธิ์ไม่ได้" — null = ให้ได้
 * 🚨 บทบาทที่บันทึกบิลบัญชีไม่ได้ (ไม่มี acct.write) ให้ไปก็ใช้ไม่ได้ (endpoint ตอบ 403)
 *    กดได้แล้วใช้ไม่ได้ = แอดมินนึกว่าเสร็จแล้ว · บล็อกตั้งแต่ปุ่มพร้อมบอกว่าทำไม
 */
export function grantBlock(p: { role: string | null; must_change_password?: boolean | null }, tenantActive: boolean): string | null {
  const role = toRole(p.role);
  if (!can(role, "acct.write")) return `บทบาท ${ROLE_LABEL[role]} บันทึกบิลบัญชีไม่ได้ — เปลี่ยนบทบาทก่อน (เช่น พนักงานบัญชี) ถึงจะใช้ connector ได้`;
  if (!tenantActive) return "ลูกค้ารายนี้ถูกระงับอยู่ — ให้สิทธิ์แล้วก็ใช้ไม่ได้จนกว่าจะเปิดใช้งาน";
  return null;
}

/**
 * คำเตือน (ไม่บล็อก) ตอนให้สิทธิ์
 * ★ ใช้บัญชีเจ้าของ (main) ได้ แต่ถ้า token หลุด คนที่ถือได้สิทธิ์ทุกอย่างของเจ้าของ
 *   ผู้ใช้บทบาทพนักงานบัญชีแยกไว้ให้ Claude จำกัดความเสียหายได้ดีกว่า
 */
export function grantWarn(p: { role: string | null; must_change_password?: boolean | null }): string | null {
  if (p.must_change_password) return "บัญชีนี้ยังใช้รหัสชั่วคราว — ต้องล็อกอินเปลี่ยนรหัสก่อน connector ถึงจะใช้ได้";
  if (toRole(p.role) === "main") {
    return "บัญชีนี้เป็นเจ้าของ (สิทธิ์ทุกอย่าง) — แนะนำสร้างผู้ใช้บทบาท พนักงานบัญชี แยกไว้ให้ Claude ถ้าการเชื่อมต่อหลุดไปถึงคนอื่น จะเสียหายน้อยกว่า";
  }
  return null;
}

/** ข้อความหลังถอนสิทธิ์ — บอกว่ามีผลทันที (endpoint ถามทุกคำขอ) */
export const REVOKE_DONE_TEXT = "ถอนสิทธิ์แล้ว — Claude ใช้บัญชีนี้บันทึกบิลไม่ได้ตั้งแต่คำขอถัดไป";
