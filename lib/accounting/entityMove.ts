/**
 * lib/accounting/entityMove — ย้ายบิลไปกิจการอื่นจากหน้าแก้ไขบิล (D132)
 *
 * ★ `fn_edit_transaction` (0019) เขียน `entity_id` ได้มาตั้งแต่แรก แต่หน้าแก้บิลไม่เคยมีช่องให้เลือก
 *   (ตระกูล D74/D77 — ของมีครบทุกชั้น ขาดแค่ช่องบนจอ)
 * 🚨 บิลที่ "ระบบอื่นสร้างให้" หรือ "มีเอกสารออกไปแล้วในนามกิจการเดิม" ย้ายจากหน้านี้ไม่ได้
 *    ย้ายแล้วต้นทางยังอยู่ที่กิจการเดิม = สองฝั่งไม่ตรงกันเงียบ ๆ
 *    → บอกว่าทำไม + ไปแก้ที่ไหน (ทุกครั้งที่ปิดปุ่ม ต้องตอบให้ได้ว่าผู้ใช้ต้องกดอะไรแทน · D88)
 * 🚨 ด่านตัวจริงอยู่ใน `fn_edit_transaction` (0094) — ที่นี่คือคำอธิบายบนจอ
 *    เงื่อนไขต้องตรงกัน (entityMoveSql.test.ts อ่าน SQL มาเทียบ)
 * ★ ประโยคบนจอทุกตัวตัดสินที่นี่ ไม่ใช่ในคอมโพเนนต์ (D84/D91)
 */

/** source ของบิลที่คีย์เอง — ย้ายกิจการได้ · 🚨 ต้องตรงกับ `fn_edit_transaction` (0094) */
export const MOVABLE_SOURCES = ["ui", "migration"] as const;

/**
 * บิลที่ระบบอื่นสร้างให้ → ไปแก้ที่ไหน
 * ★ `Record` ของ source ที่รู้จัก — source ที่ไม่อยู่ในลิสต์ได้ข้อความกลาง (ไม่เดา)
 */
const SOURCE_FIX: Record<string, string> = {
  sales: "บิลรายรับจากแอปขาย — กิจการมาจาก ตั้งค่า → กิจการ (การ์ดรับรายได้ฝั่งขาย) · ถ้าลงผิดกิจการ ให้แก้ค่าตั้งนั้น แล้วยกเลิกออเดอร์ที่ ขาย → จัดการออเดอร์ และออกใหม่",
  payroll: "บิลจากการลงบัญชีเงินเดือน — กิจการมาจากงวดจ่าย · ถอนการลงบัญชีที่ เงินเดือน → งวดจ่าย แล้วลงใหม่จากงวดของกิจการที่ถูก",
  tax: "บิลจ่ายภาษีของกิจการเดิม — ถอนการบันทึกจ่ายที่ บัญชี → เอกสารสรรพากร แล้วบันทึกจ่ายใหม่ในกิจการที่ถูก",
  bar: "บิลสรุปยอดขายบาร์รายวัน — ถอนการลงบัญชีวันนั้นที่ บาร์ → แดชบอร์ด แล้วลงใหม่",
  advance: "บิลที่เกิดจากการเคลียสำรองจ่าย — ใช้ปุ่ม ถอนการเคลีย ในแท็บ ลูกหนี้-เจ้าหนี้",
};

export type MoveTx = {
  source?: string | null;
  type?: string | null;
  advance_for_entity?: string | null;
  advance_clear_id?: string | null;
  advance_src_tx?: string | null;
  po_group_id?: string | null;
  transfer_id?: string | null;
};

/**
 * เหตุผลที่ "ย้ายกิจการไม่ได้" — null = ย้ายได้
 * @param whtDocNos เลข 50ทวิ ที่อ้างบิลนี้ (wht_certificates.tx_ids)
 */
export function entityMoveBlock(tx: MoveTx, whtDocNos: string[]): string | null {
  // กลุ่มงวด/โอน — fn_edit_transaction ปฏิเสธทั้งบิลอยู่แล้ว (หน้านี้แก้ไม่ได้ทุกช่อง)
  if (tx.po_group_id || tx.transfer_id) return "บิลกลุ่มงวด/โอนระหว่างบัญชี แก้ไม่ได้ — ยกเลิกแล้วสร้างใหม่ในกิจการที่ถูก";
  // ผลของการเคลียสำรองจ่าย: บิลของบริษัทต้องอยู่ในกิจการที่ถูกซื้อให้เสมอ
  if (tx.advance_clear_id || tx.advance_src_tx) return SOURCE_FIX.advance;
  const src = String(tx.source ?? "ui");
  if (!(MOVABLE_SOURCES as readonly string[]).includes(src)) {
    return SOURCE_FIX[src] ?? `บิลนี้ระบบสร้างให้อัตโนมัติ (${src}) — ย้ายกิจการจากหน้านี้ไม่ได้`;
  }
  if (whtDocNos.length > 0) {
    return `ออกใบ 50ทวิ ไปแล้ว (เลขที่ ${whtDocNos.join(", ")}) ในนามกิจการเดิม — ย้ายบิลไปแล้ว ภงด.3/53 ของสองกิจการจะไม่ตรงกับใบที่ออก · ถ้าลงผิดกิจการจริง ให้ยกเลิกบิลนี้ บันทึกใหม่ในกิจการที่ถูก แล้วออก 50ทวิ ใหม่`;
  }
  return null;
}

export type MoveCheckInput = {
  fromEntity: string;
  toEntity: string;
  type: string;
  /** บิลสำรองจ่าย: กิจการที่ซื้อให้ */
  advanceForEntity?: string | null;
  vatAmount: number;
  /** กิจการปลายทางจด VAT ไหม · undefined = ไม่รู้ (ไม่เตือน) */
  toIsVat?: boolean;
  accountName: string;
  /** บัญชีนี้ใช้กับกิจการปลายทางได้ไหม (entity_ids ว่าง = ใช้ร่วม) · undefined = ไม่มีบัญชี/ไม่รู้ */
  accountLinked?: boolean;
  /** หมวดของบิลจุดชนวนรับวัตถุดิบเข้าสต็อกผลิตไหม (D79/D80) */
  isForwardCat: boolean;
  toName: string;
};

/**
 * ด่านที่ "บันทึกไม่ผ่านแน่" (ขึ้นแดง + ปุ่มบันทึกยังกดได้ให้ DB ตอบซ้ำ) — null = ผ่าน
 * 🚨 ด่านเดียวกับ DB: สำรองจ่ายให้ตัวเอง (CHECK transactions_advance_shape) · VAT ในกิจการไม่จด (trigger 0036)
 */
export function entityMoveError(x: MoveCheckInput): string | null {
  if (x.fromEntity === x.toEntity) return null;
  if (x.type === "สำรองจ่าย" && x.advanceForEntity && x.advanceForEntity === x.toEntity) {
    return `บิลนี้สำรองจ่ายให้ ${x.toName} อยู่แล้ว — ย้ายไปเป็นของ ${x.toName} เองไม่ได้ · ถ้าจริง ๆ เป็นรายจ่ายของ ${x.toName} ให้ยกเลิกบิลนี้แล้วบันทึกใหม่เป็นรายจ่าย`;
  }
  // บิลสำรองจ่าย: VAT ดูกิจการที่ซื้อให้ (0086) — ย้ายคนจ่ายไม่กระทบ
  if (x.type !== "สำรองจ่าย" && x.vatAmount > 0 && x.toIsVat === false) {
    return `${x.toName} ไม่ได้จดทะเบียน VAT — เอาติ๊ก มี VAT 7% ออกก่อน (VAT จะรวมเป็นต้นทุน)`;
  }
  return null;
}

/** คำเตือนตอนย้ายกิจการ (เหลือง · ไม่บล็อก) — ว่าง = ไม่ได้ย้าย */
export function entityMoveWarnings(x: MoveCheckInput): string[] {
  if (x.fromEntity === x.toEntity) return [];
  const out = [`ย้ายบิลไป ${x.toName} — ยอดในแดชบอร์ด/ภพ.30/ภงด. ของทั้งสองกิจการจะเปลี่ยนตาม (ถ้าเดือนนี้ยื่นไปแล้ว ตรวจยอดของทั้งสองกิจการอีกครั้ง)`];
  if (x.accountName && x.accountLinked === false) {
    out.push(`บัญชี "${x.accountName}" ไม่ได้ผูกกับ ${x.toName} — ถ้าเงินออกจากบัญชีนี้จริงแต่เป็นค่าใช้จ่ายของกิจการอื่น ควรบันทึกเป็น สำรองจ่าย แทน`);
  }
  if (x.isForwardCat && x.type === "รายจ่าย") {
    out.push("วัตถุดิบที่รับเข้าสต็อกผลิตจากบิลนี้ยังอยู่ในกิจการเดิม (หน้าแก้บิลไม่ส่งของเข้าสต็อกซ้ำ) — ไปลบรายการรับที่ ผลิต → วัตถุดิบ ของกิจการเดิม แล้วรับเข้าใหม่ในกิจการที่ถูก");
  }
  return out;
}

/** ข้อความสำเร็จหลังบันทึก — บิลที่ย้ายไปแล้วจะหายจากรายการของกิจการที่เลือกอยู่ ต้องบอก */
export function entityMoveSavedText(moved: boolean, toName: string): string {
  return moved ? `แก้ไขบิลเรียบร้อย — ย้ายไป ${toName} แล้ว (บิลจะแสดงเมื่อเลือกกิจการนั้น)` : "แก้ไขบิลเรียบร้อย";
}
