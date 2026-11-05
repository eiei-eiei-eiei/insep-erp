/**
 * D154 — เอกสารขายที่พิมพ์ซ้ำต้องเป็น "แบบที่ออกไปจริง" ไม่ใช่ตามสถานะ VAT ของกิจการวันนี้
 *
 * 🔴 เดิมหัวเอกสาร/แถว VAT ตัดสินจาก `entities.is_vat` **ปัจจุบัน** ทุกใบ
 *    ⇒ กิจการที่เปลี่ยนจากไม่จด → จด VAT พิมพ์ใบเสร็จเก่าซ้ำแล้วขึ้นหัว "ใบกำกับภาษี" (ใบนั้นไม่เคยเป็นใบกำกับ ·
 *       เลขก็เป็นชุดใบเสร็จ) · กลับทิศ: จด → เลิกจด พิมพ์ใบกำกับเก่าซ้ำแล้วกลายเป็น "ใบเสร็จรับเงิน" ไม่มีแถว VAT
 *    เจอตอนเทส D153 (QU260906-002 ของ siamdist) · กระทบปุ่มพิมพ์ซ้ำทุกปุ่ม
 *
 * ★ ตัดสินจาก "หลักฐานที่แช่อยู่กับเอกสาร" เรียงจากแน่นที่สุด — ไม่เพิ่มคอลัมน์ ไม่มี migration
 *   1. ช่องเลขของใบรับเงิน: `tax_no*` = ออกเป็นใบกำกับภาษี · `rcpt_no*` = ออกเป็นใบเสร็จ
 *      (trigger 0036 ห้ามผู้ไม่จด VAT มี tax_no · neededSerials ลงช่องตามสถานะ ณ ตอนออก)
 *   2. ใบเสร็จรายงวด: บิลรายรับของครั้งนั้นมี VAT ไหม (`SalesPayment.txVat`)
 *   3. ยอดของออเดอร์: `vat_amount > 0` = ตั้งราคาแบบจด VAT · ยอด > 0 แต่ VAT 0 = แบบไม่จด
 *      (quotationTotals คิด VAT ตามสถานะ ณ ตอนบันทึกใบเสนอราคา) — ใช้กับใบแจ้งหนี้ / ใบเสนอราคา
 *      และใบรับเงินที่ไม่มีเลขในช่องของตัวเอง (ใบเสร็จผู้ไม่จด VAT ก่อน D89 ที่ยืมเลข INV)
 *   4. ไม่มีหลักฐานเลย (ยอด 0) = สถานะปัจจุบันของกิจการ (พฤติกรรมเดิม)
 * 🚨 ใบที่เพิ่งออกตอนนี้ได้ผลเท่าเดิมเสมอ — หลักฐานทุกข้อถูกเขียนด้วยสถานะปัจจุบันนั่นเอง
 */

export type DocVatSource = {
  taxNo1: string;
  taxNo2: string;
  rcptNo1?: string;
  rcptNo2?: string;
  vatAmount: number;
  grandTotal: number;
};

/** ข้อ 3-4 — ยอดของออเดอร์/ใบเสนอราคาบอกว่าตั้งราคาแบบไหน */
export function amountsVat(o: { vatAmount: number; grandTotal: number }, currentIsVat: boolean): boolean {
  if ((Number(o.vatAmount) || 0) > 0) return true;
  if ((Number(o.grandTotal) || 0) > 0) return false;
  return currentIsVat;
}

/** ใบรับเงินแต่ละชนิดใช้ช่องเลขช่องไหน (ช่อง 1 = มัดจำ/จ่ายเต็ม · ช่อง 2 = ยอดค้าง) */
const SLOT: Record<string, 1 | 2> = {
  "tax-invoice-deposit": 1,
  "tax-invoice-receipt": 1,
  "tax-invoice-receipt-do": 1,
  "tax-invoice-balance": 2,
};

/** เอกสารใบนี้ออกไปตอนกิจการจด VAT ไหม */
export function docVatAtIssue(
  docType: string,
  o: DocVatSource,
  pay: { txVat?: boolean | null } | null,
  currentIsVat: boolean,
): boolean {
  if (/^tax-invoice-installment:\d+$/.test(docType) && typeof pay?.txVat === "boolean") return pay.txVat;
  const slot = SLOT[docType];
  if (slot === 1) {
    if (o.taxNo1) return true;
    if (o.rcptNo1) return false;
  } else if (slot === 2) {
    if (o.taxNo2) return true;
    if (o.rcptNo2) return false;
  }
  return amountsVat(o, currentIsVat);
}
