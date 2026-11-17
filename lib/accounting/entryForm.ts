/**
 * กติกาของฟอร์มบันทึกบิล (บัญชี) ที่ไม่ใช่สูตรเงิน แต่กระทบข้อมูลที่ลงรายงานภาษี (D114)
 * แยกมาไว้ใน lib เพื่อให้มีเทสคุม — ตัดสินในคอมโพเนนต์แล้วแก้ข้างเดียวไม่มีอะไรฟ้อง
 */

/**
 * วันที่ใบกำกับ เมื่อผู้ใช้แก้ "เลขที่ใบกำกับภาษี" (ทำแบบเดียวกับติ๊ก VAT อัตโนมัติ)
 * · ลบเลขจนว่าง  → วันที่ว่าง (ไม่มีใบกำกับ = ไม่มีวันที่ใบกำกับ)
 *   🪤 ปล่อยค้าง = บิลที่ไม่มีใบกำกับถูกบันทึก tax_invoice_date ของใบก่อนติดไป
 * · มีเลข + วันที่ยังว่าง → ใช้วันที่รายการ
 * · มีเลข + มีวันที่อยู่แล้ว → คงไว้ (ผู้ใช้อาจแก้เป็นวันบนใบจริงไว้แล้ว ห้ามเขียนทับระหว่างพิมพ์)
 */
export function taxDateOnNoChange(newNo: string, curDate: string, txDate: string): string {
  if (newNo.trim() === "") return "";
  return curDate || txDate;
}

/**
 * วันที่ใบกำกับ เมื่อผู้ใช้แก้ "วันที่รายการ"
 * ★ เดินตามเฉพาะตอนที่ยังเท่ากับวันที่รายการเดิม (= ยังเป็นค่าที่ระบบเติมให้)
 *   ถ้าผู้ใช้แก้เป็นวันอื่นไว้แล้ว ถือว่าเป็นวันบนใบจริง ไม่แตะ
 */
export function taxDateOnTxDateChange(no: string, curDate: string, oldTx: string, newTx: string): string {
  if (no.trim() !== "" && curDate === oldTx) return newTx;
  return curDate;
}

/**
 * เปิดฟอร์มแล้วควรเปลี่ยนวันที่รายการที่ค้างในร่างเป็นวันนี้ไหม
 * · ร่างมาจากวันอื่น + ไม่มีบิลที่ยังไม่บันทึกค้างอยู่ → ใช่ (วันที่ที่คงไว้หลังบันทึกมีไว้คีย์ต่อเนื่อง
 *   ในรอบเดียวกัน — วันรุ่งขึ้นเปิดมาแล้วยังเป็นวันเมื่อวาน = บิลลงวันผิดเงียบ ๆ)
 * · มีบิลค้างกรอกอยู่ → ไม่ (ผู้ใช้อาจตั้งใจลงย้อนหลัง และยังไม่ได้บันทึก)
 * · ร่างเก่าที่ไม่มี savedOn → ถือว่าวันอื่น
 */
export function shouldRefreshDraftDate(savedOn: string | undefined, today: string, hasUnsaved: boolean): boolean {
  return savedOn !== today && !hasUnsaved;
}

/**
 * D117 — กด Enter ในแถวรายการสินค้า = เพิ่มรายการใหม่ (Ctrl/⌘+Enter = บันทึกบิล จับที่ระดับฟอร์ม)
 * · ทุกช่องในแถว รวมช่องชื่อที่มีรายการแนะนำ (เดิมยกเว้นช่อง datalist → Enter ในช่องชื่อไม่ทำอะไรเลย)
 * · Shift+Enter ไม่เพิ่ม (เผื่อคนกดค้างผิด) · ระหว่างพิมพ์ด้วย IME (isComposing) ไม่เพิ่ม
 * · นอกแถวรายการ (ปุ่มโหมด VAT · ช่องในการ์ดสรุป) ไม่เพิ่ม
 */
export function isAddRowKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; isComposing?: boolean; inItemRow: boolean }): boolean {
  return e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.isComposing && e.inItemRow;
}

/** คำกำกับคีย์ลัดใต้ตารางรายการ — เฉพาะฟอร์มบันทึก (ฟอร์มแก้บิลไม่มีคีย์ลัดนี้ ห้ามบอก) */
export const ITEM_KEYS_HINT = "Enter ในแถวรายการ = เพิ่มรายการใหม่ · Ctrl+Enter = บันทึกบิล";

/**
 * บิล **รายจ่าย** ที่ผู้ขายในทะเบียนคู่ค้า "ไม่มีเลขประจำตัวผู้เสียภาษี" → ติ๊ก VAT ไม่ได้ (D173)
 * ผู้ขายที่ไม่มีเลขผู้เสียภาษีออกใบกำกับภาษีไม่ได้ ⇒ ไม่มีภาษีซื้อให้ขอคืน
 *
 * 🚨 เฉพาะรายจ่าย — ฝั่ง **รายรับ** ห้ามใช้กติกานี้: ขายให้บุคคลทั่วไปที่ไม่มีเลขภาษี
 *    กิจการที่จด VAT ก็ยังต้องเก็บ VAT และนำส่ง (ปิดช่อง = ภาษีขายหายจาก ภพ.30)
 * 🪤 ชื่อที่พิมพ์เองและไม่อยู่ในทะเบียน = ไม่รู้ ⇒ ไม่บล็อก (ไม่รู้ ≠ ไม่มี)
 * 🪤 ชื่อเดียวกันหลายสาขา: บล็อกเมื่อ **ทุกแถว** ไม่มีเลข (มีสักแถวที่มีเลข = ปล่อย)
 */
export function sellerHasNoTaxId(
  type: string,
  contactName: string,
  contacts: { name: string; tax_id?: string | null }[],
): boolean {
  if (type !== "รายจ่าย") return false;
  const name = contactName.trim();
  if (!name) return false;
  const hits = contacts.filter((c) => c.name.trim() === name);
  return hits.length > 0 && hits.every((c) => !(c.tax_id ?? "").trim());
}

export const NO_TAX_ID_VAT_REASON =
  "คู่ค้ารายนี้ไม่มีเลขประจำตัวผู้เสียภาษี จึงออกใบกำกับภาษีไม่ได้ — ถ้ามีเลขจริง ให้แก้ที่ ตั้งค่า → คู่ค้า";

