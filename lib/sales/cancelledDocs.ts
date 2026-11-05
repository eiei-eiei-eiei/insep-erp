/**
 * D153 — พิมพ์ใบที่ยกเลิก: ออเดอร์ที่ยกเลิกแล้ว "เคยออกเอกสารใบไหนไปแล้วบ้าง"
 *
 * ★ ที่มา (ป.86/2542 ข้อ 25): ยกเลิกใบกำกับภาษีต้องเรียกใบเดิมคืน ประทับตรายกเลิกหรือขีดฆ่า
 *   แล้วเก็บรวมกับสำเนา → ผู้ใช้ต้องพิมพ์ใบเดิม (เลขเดิม · วันที่เดิม · ยอดเดิม) พร้อมตรายกเลิกเก็บเข้าแฟ้มได้
 *   เดิมออเดอร์ที่ยกเลิกแล้วไม่มีปุ่มพิมพ์เลยสักปุ่ม
 *
 * ★ ตัดสินจาก "เลขเอกสารที่มีอยู่จริง" เท่านั้น — ไม่ใช่จากสถานะ (สถานะกลายเป็น "ยกเลิก" ไปแล้ว)
 *   `fn_cancel_order` ไม่ล้างช่องเลขของออเดอร์ · แถวการรับเงิน (`sales_payments`) ก็อยู่ครบ
 *   ไม่มีเลข = ไม่เคยออกใบนั้น = ไม่พิมพ์ (พิมพ์ใบที่ไม่มีเลขขึ้นมา = สร้างเอกสารที่ไม่เคยมีอยู่)
 *   ไม่มีสักใบ (ยกเลิกตอนรอคอนเฟิร์ม) = หน้าจอพิมพ์ใบเสนอราคา + เลขออเดอร์ พร้อมตรายกเลิกแทน
 *   (ผู้ใช้สั่ง: ให้สำนักงานบัญชีเห็นว่าเลข QU/ORD ที่ข้ามไปเป็นของออเดอร์ไหน · เลขใบกำกับไม่ได้ข้ามในกรณีนี้)
 *
 * ★ ชนิดเอกสารตัดสินด้วยกฎเดียวกับปุ่มพิมพ์ของออเดอร์ที่ยังไม่ยกเลิก (OrdersTab · doPrintFirst/doPrintClosed)
 *   - ใบแจ้งหนี้: ไม่มีวันครบกำหนด = ออกจาก "ใบแจ้งหนี้ (จ่ายเต็ม)" (ISSUE_INVOICE_FULL ไม่ตั้ง dueDate)
 *   - ช่องรับเงินที่ 1: มีมัดจำ = ใบเสร็จค่ามัดจำ · ไม่มีวันครบกำหนด = จ่ายเต็มพร้อมส่ง · นอกนั้น = จ่ายเต็มทีหลัง
 *   - ช่องรับเงินที่ 2 = ใบเสร็จยอดค้าง
 * 🚨 ใบแจ้งหนี้มัดจำที่ "ถูกยกเลิกไปก่อน" (fn_void_deposit_invoice ล้าง dep_inv_no) ไม่มีเลขเหลือให้พิมพ์
 */
import type { Installment } from "./installments";
import type { SalesPayment } from "./payments";

export type CancelledDocSource = {
  invNo: string;
  taxNo1: string;
  taxNo2: string;
  rcptNo1?: string;
  rcptNo2?: string;
  depInvNo?: string;
  deposit: number;
  dueDate: string;
  installments?: Installment[];
  payments?: SalesPayment[];
};

/** ชนิดเอกสาร (docType ของ print.ts) ที่ออกไปแล้วจริง เรียงตามลำดับที่ออก */
export function cancelledDocTypes(o: CancelledDocSource): string[] {
  const out: string[] = [];
  if (o.depInvNo) out.push("invoice-deposit");

  // D147 — ออเดอร์แบ่งงวด: ใบแจ้งหนี้รายงวดเก็บเลขที่แผน · ใบเสร็จรายงวดเก็บเลขที่แถวการรับเงิน
  //   ช่องเลขเดิม (tax_no1/2) ไม่ถูกใช้ · ใบแจ้งหนี้/ใบส่งสินค้า (inv_no) ออกตอนส่งของ
  if (o.installments?.length) {
    const seqs = [...o.installments].sort((a, b) => a.seq - b.seq);
    for (const i of seqs) {
      if (i.invNo) out.push(`invoice-installment:${i.seq}`);
      if (o.payments?.some((p) => p.installmentSeq === i.seq && p.docNo)) out.push(`tax-invoice-installment:${i.seq}`);
    }
    if (o.invNo) out.push("invoice");
    return out;
  }

  if (o.invNo) out.push(o.dueDate ? "invoice" : "invoice-only");
  if (o.taxNo1 || o.rcptNo1) {
    if ((o.deposit || 0) > 0) out.push("tax-invoice-deposit");
    else out.push(o.dueDate ? "tax-invoice-receipt" : "tax-invoice-receipt-do");
  }
  if (o.taxNo2 || o.rcptNo2) out.push("tax-invoice-balance");
  return out;
}

/**
 * คำอธิบายในกล่องยืนยันการยกเลิกออเดอร์
 * ★ ปุ่มอยู่ที่แท็บย่อย "ปิด / ยกเลิก" ของหน้าจัดการออเดอร์ — เปลี่ยนชื่อปุ่ม/แท็บต้องแก้ประโยคนี้ด้วย (เทสอ่านซอร์สล็อกไว้)
 */
export const CANCEL_ORDER_DETAIL =
  "ระบบจะย้อนรายการบัญชี/สต็อกที่เกิดแล้วให้ · ถ้าออกใบกำกับภาษีให้ลูกค้าไปแล้ว ให้เรียกใบเดิมคืนมาประทับตรายกเลิกเก็บไว้ " +
  "— พิมพ์ใบที่ยกเลิกพร้อมตราเก็บเข้าแฟ้มได้ที่ ปิด / ยกเลิก → พิมพ์ใบที่ยกเลิก";

/** ตราบนเอกสาร + ป้ายในหน้าต่างเอกสาร (แหล่งเดียว เทสล็อกไว้) */
export const CANCELLED_STAMP = "ยกเลิก";
export const CANCELLED_STAMP_ENG = "CANCELLED";
