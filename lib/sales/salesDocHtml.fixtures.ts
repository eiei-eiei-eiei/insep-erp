/**
 * D155 — ออเดอร์ตัวอย่างสำหรับเทสเนื้อเอกสารขาย (salesDocHtml.test.ts)
 * ครอบทุกชนิดเอกสารที่มีตัวเลข "ก่อน VAT" · มี/ไม่มี WHT · มัดจำ/ยอดค้าง/รายงวด
 */
import type { CompanyInfo } from "./company";
import type { OrderLike } from "../../app/(app)/sales/_components/print";

export const COMPANY: CompanyInfo = {
  name: "บริษัท ทดสอบ จำกัด", nameEng: "Test Co., Ltd.", address: "1 ถ.ทดสอบ", taxLine: "เลขประจำตัวผู้เสียภาษี 0105500000000",
  bank: "ธนาคารทดสอบ 123-4-56789-0", isVat: true,
} as CompanyInfo;

export const ITEMS = [{ name: "สุรา 700ml", qty: 4, price: 535 }];

const base = {
  quNo: "QU-T1", invNo: "INV-T1", taxNo1: "", taxNo2: "", discount: 0,
  docDate1: "2026-11-01", docDate2: "2026-11-05", depInvNo: "INV-D1", depInvDate: "2026-10-30", depInvAmount: 1000, depositPercent: 50, checkDetail1: "", checkDetail2: "", paymentMethod: "โอนเงิน",
  customerName: "ลูกค้า ทดสอบ", customerAddress: "", customerTaxId: "", customerBranch: "",
};

/** ยอดรวม 2,140 (รวม VAT) · ก่อน VAT 2,000 · VAT 140 */
export function vatOrder(wht: number, over: Partial<OrderLike> = {}): OrderLike {
  const whtAmount = Math.round(2000 * wht) / 100;
  return {
    ...base, taxNo1: "TAX-T1", taxNo2: "TAX-T2", subTotal: 2000, vatAmount: 140, grandTotal: 2140,
    whtPercent: wht, whtAmount, netPayable: 2140 - whtAmount, deposit: 1000, outstandingBalance: 0, ...over,
  } as OrderLike;
}

/** ไม่จด VAT: ยอดรวม 2,140 คือราคาที่ลูกค้าจ่าย · ไม่มี VAT */
export function nonVatOrder(wht: number, over: Partial<OrderLike> = {}): OrderLike {
  const whtAmount = Math.round(2140 * wht) / 100;
  return {
    ...base, rcptNo1: "RC-T1", rcptNo2: "RC-T2", subTotal: 2140, vatAmount: 0, grandTotal: 2140,
    whtPercent: wht, whtAmount, netPayable: 2140 - whtAmount, deposit: 1000, outstandingBalance: 0, ...over,
  } as OrderLike;
}

/** ชนิดเอกสารทั้งหมดที่ทดสอบ (แผนงวดใช้ planOrder) */
export const DOC_TYPES = [
  "invoice", "invoice-only", "invoice-deposit", "tax-invoice-deposit", "tax-invoice-balance",
  "tax-invoice-receipt", "tax-invoice-receipt-do",
];

export function planned(o: OrderLike, txVat: boolean): OrderLike {
  return {
    ...o, invNo: "", taxNo1: "", taxNo2: "", rcptNo1: "", rcptNo2: "",
    installments: [
      { seq: 1, label: "มัดจำ", percent: 50, amount: 1000, dueDate: "", invNo: "INV-I1", invDate: "2026-11-01", shipPoint: false, paid: true },
      { seq: 2, label: "", percent: null, amount: o.netPayable - 1000, dueDate: "", invNo: "", invDate: "", shipPoint: true, paid: false },
    ],
    payments: [{ seq: 1, label: "งวดที่ 1 (มัดจำ)", amount: 1000, method: "โอนเงิน", chequeDetail: "", docDate: "2026-11-02", docNo: "PAY-I1", txId: "TR-1", installmentSeq: 1, txVat }],
  };
}
