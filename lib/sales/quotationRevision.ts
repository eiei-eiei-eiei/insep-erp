/**
 * lib/sales/quotationRevision — ฉบับแก้ไขของใบเสนอราคา (D168)
 *
 * แก้ใบเสนอราคาแล้วเลข QU เดิม — ไม่ผิดกฎหมาย (ใบเสนอราคาไม่ใช่เอกสารภาษี)
 * แต่ถ้าส่งใบแรกให้ลูกค้าไปแล้ว ลูกค้าถือ 2 ใบเลขเดียวกันราคาต่างกัน แยกไม่ออกว่าตกลงที่ใบไหน
 * ⇒ ใบที่แก้แล้วพิมพ์ "ฉบับแก้ไขครั้งที่ N" + ลงวันที่ของฉบับนั้น + บอกวันที่ฉบับแรก
 *
 * ตัวนับอยู่ใน DB (`sales_orders.qu_rev` / `qu_rev_on` · 0110) นับเฉพาะตอนเนื้อหาบนใบเปลี่ยนจริง
 * ไฟล์นี้ตัดสินแค่ "พิมพ์อะไร" — ห้ามตัดสินในคอมโพเนนต์ (D84)
 */

export type QuotationRevision = {
  /** ครั้งที่แก้ (0 = ฉบับแรก) */
  rev: number;
  /** วันที่ของฉบับล่าสุด (ISO) · ว่าง = ไม่รู้ */
  revOn: string;
  /** วันที่สร้างใบเสนอราคา (ISO) */
  createdOn: string;
};

/** "ฉบับแก้ไขครั้งที่ 2" · ฉบับแรก = ว่าง */
export function revisionLabel(rev: number): string {
  return rev > 0 ? `ฉบับแก้ไขครั้งที่ ${rev}` : "";
}

/** "Revision 2" · ฉบับแรก = ว่าง */
export function revisionLabelEng(rev: number): string {
  return rev > 0 ? `Revision ${rev}` : "";
}

/**
 * วันที่บนใบเสนอราคา = วันที่ของฉบับนั้น
 * ฉบับแก้ไขที่ไม่รู้วันที่ (ไม่ควรเกิด — DB เขียนคู่กันเสมอ) = วันที่สร้าง ไม่เดา
 */
export function quotationDocDate(r: QuotationRevision): string {
  return r.rev > 0 && r.revOn ? r.revOn : r.createdOn;
}

/** วันที่ฉบับแรกที่พิมพ์กำกับบนฉบับแก้ไข · ฉบับแรก/ไม่รู้วันที่ = ว่าง (ไม่พิมพ์บรรทัดนั้น) */
export function originalDateOnRevision(r: QuotationRevision): string {
  return r.rev > 0 && r.createdOn ? r.createdOn : "";
}
