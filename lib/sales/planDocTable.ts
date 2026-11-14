/**
 * lib/sales/planDocTable — ตารางรายการบนเอกสารของออเดอร์แบ่งงวด (D170)
 *
 * ที่มา: ใบรายงวดเคยพิมพ์ตารางรายการเต็มของทั้งออเดอร์ (จำนวนเงินทั้งสัญญา) แล้วยอดของงวดไปอยู่ลึกในกรอบสรุป
 *   ⇒ คนจ่ายเงินเห็นตัวเลขใหญ่ในตารางก่อน แล้วไม่แน่ใจว่าต้องจ่ายเท่าไร
 *
 * แบบใหม่ (ผู้ใช้เลือก):
 *   1  ค่าสินค้าตามใบเสนอราคา QU… — งวดที่ 1/2 มัดจำ 50%   จำนวน 1   ราคา = มูลค่างวดนี้
 *      รายการตามใบเสนอราคา:
 *      · สุราขาวสยาม 40 ดีกรี 700ml                           จำนวน 4   (ไม่มีราคา)
 * ★ ในตารางมีตัวเลขเงินบรรทัดเดียว = ยอดของงวดนี้ · รายการสินค้า+จำนวนยังอยู่ครบ
 *   (ใบกำกับภาษี ม.86/4 ต้องระบุชื่อ ชนิด ปริมาณ · ใบส่งสินค้าต้องให้คนรับของตรวจได้) → ไม่ตัดรายการทิ้ง
 * 🚨 ไฟล์นี้ไม่คิดเงิน — มูลค่างวดมาจากผู้เรียก (`reverseCalcPrint` ตัวเดียวกับที่พิมพ์ในกรอบสรุป)
 */

export type PlanDocRow =
  | { kind: "main"; no: number; name: string; qty: number; unit: number; amount: number }
  | { kind: "head"; name: string }
  | { kind: "item"; name: string; qty: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * ป้ายของงวดบนบรรทัดหลัก — "งวดที่ 1/2 มัดจำ 50%"
 * ★ % มาจากแผน (ไว้แสดง) · ไม่มี % = ไม่พิมพ์ · ชื่องวดว่าง = ไม่พิมพ์
 */
export function installmentTag(k: number, n: number, label: string, percent: number | null): string {
  const pct = percent != null && percent > 0 ? ` ${r2(percent)}%` : "";
  return `งวดที่ ${k}/${n}${label.trim() ? ` ${label.trim()}` : ""}${pct}`;
}

/** ป้ายของใบแจ้งหนี้/ใบส่งสินค้า (ตอนส่งของ) — เรียกเก็บยอดที่ยังค้างทั้งหมด */
export const BALANCE_TAG = "ยอดคงค้าง";

/** "ค่าสินค้าตามใบเสนอราคา QU… — งวดที่ 1/2 มัดจำ 50%" */
export function planMainLine(quNo: string, tag: string): string {
  return `ค่าสินค้าตามใบเสนอราคา ${quNo.trim()} — ${tag}`;
}

/** แถวทั้งหมดของตาราง · ไม่มีรายการสินค้า = บรรทัดหลักบรรทัดเดียว (ไม่พิมพ์หัว "รายการตามใบเสนอราคา" เปล่า) */
export function planDocRows(input: {
  quNo: string;
  tag: string;
  /** มูลค่าของงวด/ยอดคงค้าง (ก่อน VAT · ผู้ไม่จด VAT = ยอดเต็ม) */
  value: number;
  items: { name: string; qty: number }[];
}): PlanDocRow[] {
  const rows: PlanDocRow[] = [
    { kind: "main", no: 1, name: planMainLine(input.quNo, input.tag), qty: 1, unit: r2(input.value), amount: r2(input.value) },
  ];
  if (input.items.length) {
    rows.push({ kind: "head", name: "รายการตามใบเสนอราคา:" });
    for (const it of input.items) rows.push({ kind: "item", name: it.name, qty: it.qty });
  }
  return rows;
}
