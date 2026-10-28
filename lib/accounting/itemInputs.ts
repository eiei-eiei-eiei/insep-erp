/**
 * รายการสินค้าในบิล → payload ที่ RPC รับ (`p_items` ของ fn_save_transaction / fn_edit_transaction)
 *
 * ★ ย้ายมาจาก app/(app)/accounting/_components/billItems.ts (D141) คำต่อคำ
 *   เพื่อให้ Claude connector (app/api/mcp · ฝั่ง server) ประกอบรายการด้วยตัวเดียวกับฟอร์ม
 *   ไม่ใช่ก๊อปไปอีกชุด (บทเรียน billItems D42: เลขตอนสร้าง ≠ เลขตอนแก้)
 * 🚨 ไฟล์นี้ต้องไม่ import React — ฝั่ง server ใช้ด้วย · billItems.ts re-export ต่อให้ฟอร์ม
 */
import { itemTotal, inVatFromExVat, allocateExTotals, type VatMode } from "./calc";

/** แถวรายการที่ RPC รับ */
export type TxItemInput = {
  item_name: string;
  quantity: number;
  in_vat: number;
  ex_vat: number;
  total_price: number;
  discount_pct?: number;
  discount_baht?: number;
  item_category?: string;
  item_job?: string;
};

/** หัวบิลที่ fn_save_transaction รับ (`p`) — ค่าเงินคำนวณจาก entryCalc แล้ว */
export type SaveTxInput = {
  transaction_date: string;
  type: string;
  account_name?: string;
  category?: string;
  contact_name?: string;
  contact_id?: string; // ระบุสาขาที่แน่นอน (multi-branch, D30)
  description?: string;
  base_amount: number;
  discount: number;
  amount_after_discount: number;
  vat_amount: number;
  wht_rate: number;
  wht_amount: number;
  net_amount: number;
  tax_invoice_no?: string;
  tax_invoice_date?: string;
  receipt_image_url?: string;
  entity_id: string;
  ap_ar_status?: "AP" | "AR" | "";
  due_date?: string;
  forward_material?: boolean;
  /** D119 — type สำรองจ่าย: กิจการที่ซื้อให้ (entity_id = กิจการของคนจ่าย) */
  advance_for_entity?: string;
  /** D141 — บิลจาก Claude connector · ไม่ส่ง = 'ui' (ค่าปริยายของ RPC) */
  source?: "claude";
};

export type Qty = number | "";
export type BillItem = {
  itemName: string;
  itemCategory: string;
  itemJob: string;
  quantity: Qty;
  exVat: number;
  inVat: number;
  discPct: number;
  discBaht: number;
};

/** แถวที่นับเป็น "มีของ" — ในโหมด in ผู้ใช้อาจกรอกเฉพาะช่องรวม VAT */
export function hasContent(it: BillItem, mode: VatMode = "ex"): boolean {
  return Boolean(it.itemName || it.exVat || (mode === "in" && it.inVat));
}

/** แถวรายการ → payload ที่ RPC รับ (ช่องว่าง = 1 ตอนบันทึก ตามเดิม) */
export function buildItemInputs(items: BillItem[], mode: VatMode = "ex", baseAmount = 0): TxItemInput[] {
  const kept = items.filter((it) => hasContent(it, mode));
  const qtyOf = (it: BillItem) => (it.quantity === "" ? 1 : it.quantity);
  /**
   * total_price = ยอดบรรทัด **ก่อน VAT** (คอลัมน์นี้โผล่ในการ์ด "ดู" และแท็บประวัติราคา)
   * · โหมด ex: qty×ราคาไม่รวม VAT − ส่วนลด (เหมือนเดิมทุกตัวอักษร)
   * · โหมด in: ยอดบรรทัดที่กรอกเป็นยอด *รวม VAT* → ต้องถอดแล้วเกลี่ยให้ผลรวมเท่า
   *   baseAmount ของบิลเป๊ะ ไม่งั้นบวกคอลัมน์แล้วไม่ตรงกับยอดก่อน VAT ของบิลเดียวกัน
   */
  const totals = mode === "in"
    ? allocateExTotals(kept.map((it) => itemTotal(qtyOf(it), it.inVat, it.discBaht)), baseAmount)
    : kept.map((it) => itemTotal(qtyOf(it), it.exVat, it.discBaht));
  return kept.map((it, i) => ({
    item_name: it.itemName,
    quantity: qtyOf(it),
    in_vat: it.inVat || inVatFromExVat(it.exVat),
    ex_vat: it.exVat,
    total_price: totals[i] ?? 0,
    discount_pct: it.discPct,
    discount_baht: it.discBaht,
    item_category: it.itemCategory,
    item_job: it.itemJob,
  }));
}
