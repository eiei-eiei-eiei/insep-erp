/**
 * lib/bar/payMethods — วิธีรับเงินของบาร์ + บัญชีที่แต่ละวิธีลง (golden B21 · D116)
 *
 * D116 — ผู้ใช้ตอบว่า **ไม่รับบัตร** และ **เงินสดเก็บไว้หมุนในร้าน (ไม่ได้ฝากธนาคาร)**
 * · เดิมมี 4 ปุ่ม เงินสด/โอนเงิน/QR/บัตรเครดิต แต่ "โอนเงิน" กับ "QR" ทำงานเหมือนกันทุกอย่าง
 *   (ขึ้น QR พร้อมเพย์ทั้งคู่ · ลงบัญชีเดียวกัน) ต่างแค่ป้าย ⇒ รวมเป็น **โอน/QR**
 * · เงินสดเคยลงบัญชีเดียวกับเงินโอน ⇒ ยอดธนาคารในแอปสูงกว่าเงินในธนาคารจริงทุกคืน
 *   → ตั้ง **บัญชีเงินสด** แยกได้ (ไม่ตั้ง = ลงบัญชีหลักเหมือนเดิม)
 *
 * 🚨 บิลเก่ายังเก็บป้ายเดิม ("QR" / "โอนเงิน" / "บัตรเครดิต") — **ไม่แก้ย้อนหลัง**
 *    ทุกป้ายที่ไม่ใช่เงินสดลงบัญชีหลักเหมือนเดิม
 * 🚨 กติกา "วิธีไหนลงบัญชีไหน" มี 2 ฝั่ง: `accountForMethod()` (หน้าจอบอกล่วงหน้า)
 *    กับ `fn_bar_post_day` (ตัวจริง · 0084) — เทสอ่าน SQL มาเทียบคำว่าเงินสด
 */

export const CASH_METHOD = "เงินสด";
export const TRANSFER_METHOD = "โอน/QR";
export const PAY_METHODS = [CASH_METHOD, TRANSFER_METHOD] as const;

/** วิธีที่ต้องโชว์ QR พร้อมเพย์ (รวมป้ายเก่า เผื่อมีที่ไหนส่งมา) */
export function wantsQr(method: string): boolean {
  return method === TRANSFER_METHOD || method === "QR" || method === "โอนเงิน";
}

/** บัญชีที่ยอดของวิธีรับเงินนี้จะลง — ตรงกับ fn_bar_post_day (0084) */
export function accountForMethod(method: string, revenueAccount: string, cashAccount: string): string {
  const cash = cashAccount.trim();
  return method.trim() === CASH_METHOD && cash ? cash : revenueAccount;
}
