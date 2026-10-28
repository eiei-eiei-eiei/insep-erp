/**
 * lib/accounting/priceHistory — D140 ยอดรวมของแท็บประวัติราคา
 *
 * ★ ตัวเลขบนจอเท่านั้น ไม่ใช่รายงานเงิน/ภาษี (ไม่แตะสูตรใด ๆ)
 * ★ ยอดต่อประเภทใช้ `billTotals` ตัวเดียวกับหน้าค้นบิล (D139) — ไม่เขียนตัวบวกชุดที่สอง
 *   · ใบเช็คราคาแสดงในตารางได้ แต่ไม่นับเข้ายอด (ไม่ใช่เงินที่จ่ายจริง)
 * · ยอดเป็น `total_price` = ยอดก่อน VAT หลังส่วนลดของบรรทัดนั้น (D98 เกลี่ยให้รวมได้เท่าฐานภาษีของบิล)
 */

import { billTotals, type BillTotals } from "./billTotals";
import { round2 } from "./calc";

export type PriceHistoryRow = {
  itemName: string;
  quantity: number;
  totalPrice: number;
  type: string;
};

export function priceHistoryTotals(rows: PriceHistoryRow[]): BillTotals {
  // บรรทัดสินค้าไม่มีสถานะตั้งค้าง/ยกเลิกของตัวเอง (บิลยกเลิกถูกกรองทิ้งตั้งแต่ฝั่ง server)
  return billTotals(rows.map((r) => ({ type: r.type, net_amount: r.totalPrice, status: "ปกติ", ap_ar_status: null })));
}

export type SingleItemSummary = {
  itemName: string;
  type: string;
  quantity: number;
  total: number;
  /** ยอด ÷ จำนวน (ก่อน VAT) · null = จำนวนรวมเป็น 0 หารไม่ได้ */
  avgPrice: number | null;
};

/**
 * จำนวนรวม + ราคาเฉลี่ยต่อหน่วย — เฉพาะเมื่อแถวที่นับยอดเป็น**สินค้าชื่อเดียวกันและประเภทเดียวกัน**
 * 🚨 หลายชื่อปนกัน = บวกจำนวนต่างหน่วยกัน (กก. + ลิตร) ⇒ ไม่โชว์ ดีกว่าโชว์เลขที่ไม่มีความหมาย
 * 🚨 ซื้อและขายของชื่อเดียวกันปนกัน = เฉลี่ยราคาซื้อกับราคาขายรวมกัน ⇒ ไม่โชว์
 * · ใบเช็คราคาไม่นับ (เหมือนยอดรวม) · ชื่อเทียบแบบตัดช่องว่างหัวท้าย ไม่สนตัวพิมพ์เล็ก-ใหญ่
 */
export function singleItemSummary(rows: PriceHistoryRow[], priceCheckType = "เช็คราคา"): SingleItemSummary | null {
  const counted = rows.filter((r) => r.type !== priceCheckType);
  if (counted.length === 0) return null;
  const key = (s: string) => s.trim().toLowerCase();
  const name = key(counted[0].itemName);
  const type = counted[0].type;
  if (!name) return null;
  if (counted.some((r) => key(r.itemName) !== name || r.type !== type)) return null;
  const quantity = round2(counted.reduce((s, r) => s + (Number(r.quantity) || 0), 0));
  const total = round2(counted.reduce((s, r) => s + (Number(r.totalPrice) || 0), 0));
  return {
    itemName: counted[0].itemName.trim(),
    type,
    quantity,
    total,
    avgPrice: quantity > 0 ? round2(total / quantity) : null,
  };
}

/** ประโยคบอกว่ายอดไม่ครบเพราะชนเพดาน · ว่าง = ครบ */
export function priceHistoryCapNote(loaded: number, total: number | null): string {
  if (total == null || total <= loaded) return "";
  return `โหลดมา ${loaded.toLocaleString("en-US")} จาก ${total.toLocaleString("en-US")} รายการ (ล่าสุดก่อน) — ยอดรวมยังไม่ครบ ให้แคบด้วยช่วงเวลา/งาน/คู่ค้า`;
}
