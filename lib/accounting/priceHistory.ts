/**
 * lib/accounting/priceHistory — D140 ยอดรวมของแท็บประวัติราคา
 *
 * ★ ตัวเลขบนจอเท่านั้น ไม่ใช่รายงานเงิน/ภาษี (ไม่แตะสูตรใด ๆ)
 * ★ ยอดต่อประเภทใช้ `billTotals` ตัวเดียวกับหน้าค้นบิล (D139) — ไม่เขียนตัวบวกชุดที่สอง
 *   · ใบเช็คราคาแสดงในตารางได้ แต่ไม่นับเข้ายอด (ไม่ใช่เงินที่จ่ายจริง)
 * · ยอดเป็น `total_price` = ยอดก่อน VAT หลังส่วนลด*รายบรรทัด* (D98 เกลี่ยให้รวมได้เท่า base_amount ของบิล)
 *   🪤 ยังไม่หักส่วนลดท้ายบิล — ราคาสุทธิต่อหน่วยที่หักครบทุกชั้นคือ `netLine` (D181)
 */

import { billTotals, type BillTotals } from "./billTotals";
import { round2 } from "./calc";

export type PriceHistoryRow = {
  itemName: string;
  quantity: number;
  totalPrice: number;
  type: string;
  /** D181 — ยอดหลังเกลี่ยส่วนลดท้ายบิล (`netLine`) · ไม่ส่ง = เท่ากับ totalPrice */
  netTotal?: number;
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
  /** ยอดสุทธิ ÷ จำนวน (ก่อน VAT · หลังเกลี่ยส่วนลดท้ายบิล D181) · null = จำนวนรวมเป็น 0 หารไม่ได้ */
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
  // D181 — เฉลี่ยจากยอดสุทธิ ให้ตรงกับคอลัมน์ "ราคา/หน่วยสุทธิ" ในตาราง (ไม่มีส่วนลดท้ายบิล = ค่าเท่าเดิม)
  const net = round2(counted.reduce((s, r) => s + (Number(r.netTotal ?? r.totalPrice) || 0), 0));
  return {
    itemName: counted[0].itemName.trim(),
    type,
    quantity,
    total,
    avgPrice: quantity > 0 ? round2(net / quantity) : null,
  };
}

/** ประโยคบอกว่ายอดไม่ครบเพราะชนเพดาน · ว่าง = ครบ */
export function priceHistoryCapNote(loaded: number, total: number | null): string {
  if (total == null || total <= loaded) return "";
  return `โหลดมา ${loaded.toLocaleString("en-US")} จาก ${total.toLocaleString("en-US")} รายการ (ล่าสุดก่อน) — ยอดรวมยังไม่ครบ ให้แคบด้วยช่วงเวลา/งาน/คู่ค้า`;
}

// ── D181 — ราคาต่อหน่วยสุทธิ (หลังส่วนลดทุกชั้น) ─────────────────────────────
export type NetLineInput = {
  type: string;
  quantity: number;
  exVat: number;
  /** transaction_items.total_price = ยอดบรรทัดก่อน VAT หลังส่วนลด*รายบรรทัด* (ยังไม่หักส่วนลดท้ายบิล) */
  totalPrice: number;
  /** transactions.base_amount — ยอดก่อน VAT ก่อนหักส่วนลดท้ายบิล */
  baseAmount: number;
  /** transactions.amount_after_discount — ยอดก่อน VAT หลังหักส่วนลดท้ายบิล */
  amountAfterDiscount: number;
};
export type NetLine = {
  /** ยอดบรรทัดก่อน VAT หลังเกลี่ยส่วนลดท้ายบิลตามสัดส่วนแล้ว */
  netTotal: number;
  /** ราคาต่อหน่วยสุทธิ (ก่อน VAT) · null = จำนวน 0 หารไม่ได้ */
  netUnit: number | null;
  /** true = บิลนี้มีส่วนลดท้ายบิล ⇒ ราคาสุทธิถูกเกลี่ยส่วนลดนั้นเข้าไปแล้ว (บอกบนจอ) */
  billDiscounted: boolean;
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * ราคาต่อหน่วยสุทธิของบรรทัดหนึ่ง = ยอดบรรทัด × (ยอดหลังส่วนลดท้ายบิล ÷ ยอดก่อนส่วนลดท้ายบิล) ÷ จำนวน
 *
 * 🪤 `total_price` หักแค่ส่วนลด*รายบรรทัด* — ส่วนลดท้ายบิล (`transactions.discount`) ไม่ได้เกลี่ยลงบรรทัด
 *    ทั้งโหมด ex และ in (A21 เกลี่ยให้รวมเท่า `base_amount` ซึ่งเป็นยอด*ก่อน*ส่วนลดท้ายบิล)
 *    ⇒ รวม÷จำนวน ตรง ๆ จะได้ราคาที่ยังไม่หักส่วนลดท้ายบิล · เกลี่ยตามสัดส่วนยอดเงิน (บรรทัดแพงได้ส่วนลดมาก)
 * · ไม่มีส่วนลดท้ายบิล (สัดส่วน = 1) ⇒ เท่ากับ รวม÷จำนวน ตรง ๆ
 * · ใบเช็คราคาไม่มีส่วนลดใด ๆ ⇒ ราคาต่อหน่วยที่กรอก (ใบเก่าที่บันทึกยอดรวมเป็น 0 ก็ยังถูก)
 * ★ ตัวเลขบนจอเท่านั้น ไม่ใช่รายงานเงิน/ภาษี
 */
export function netLine(r: NetLineInput, priceCheckType = "เช็คราคา"): NetLine {
  const qty = Number(r.quantity) || 0;
  if (r.type === priceCheckType) {
    const ex = Number(r.exVat) || 0;
    return { netTotal: round2(qty * ex), netUnit: ex, billDiscounted: false };
  }
  const base = Number(r.baseAmount) || 0;
  const aad = Number(r.amountAfterDiscount) || 0;
  const billDiscounted = base > 0 && Math.abs(base - aad) > 0.005;
  const factor = billDiscounted ? aad / base : 1;
  const netTotal = round2((Number(r.totalPrice) || 0) * factor);
  return { netTotal, netUnit: qty > 0 ? round4(((Number(r.totalPrice) || 0) * factor) / qty) : null, billDiscounted };
}

// ── D181 — ส่งออกตาราง (Excel / คัดลอกไปวาง) ──────────────────────────────────
export type PriceHistoryExportRow = {
  date: string;
  itemName: string;
  contactName: string;
  type: string;
  category: string;
  job: string;
  quantity: number;
  exVat: number;
  totalPrice: number;
  netUnit: number | null;
  netTotal: number;
  txId: string;
};

export const PRICE_HISTORY_EXPORT_HEADER = [
  "วันที่", "รายการ", "คู่ค้า", "ประเภท", "หมวด", "งาน", "จำนวน",
  "ราคา/หน่วย (ก่อน VAT)", "รวม (ก่อน VAT)", "ราคา/หน่วยสุทธิ (หลังส่วนลด)", "รวมสุทธิ (หลังส่วนลด)", "เลขบิล",
] as const;

/** แถวข้อมูล → ตาราง 2 มิติ (หัว + แถว) · ตัวเลขเป็น number ให้ Excel คิดต่อได้ · วันที่ ISO (Excel อ่านเป็นวันที่ได้ทุก locale) */
export function priceHistoryTable(rows: PriceHistoryExportRow[]): (string | number)[][] {
  return [
    [...PRICE_HISTORY_EXPORT_HEADER],
    ...rows.map((r) => [
      r.date, r.itemName, r.contactName, r.type, r.category, r.job, r.quantity,
      r.exVat, r.totalPrice, r.netUnit ?? "", r.netTotal, r.txId,
    ]),
  ];
}

/**
 * ตาราง → ข้อความคั่นแท็บ สำหรับคัดลอกไปวางใน Excel / Google Sheets (วางแล้วแตกช่องเอง)
 * 🪤 แท็บ/ขึ้นบรรทัดในชื่อสินค้า = ช่องเลื่อน ⇒ แทนด้วยช่องว่าง
 */
export function toTsv(table: (string | number)[][]): string {
  return table.map((row) => row.map((c) => String(c).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\r\n");
}
