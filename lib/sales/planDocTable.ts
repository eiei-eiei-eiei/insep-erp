/**
 * lib/sales/planDocTable — ตารางรายการบนเอกสารของออเดอร์แบ่งงวด (D170)
 *
 * ที่มา: ใบรายงวดเคยพิมพ์ตารางรายการเต็มของทั้งออเดอร์ (จำนวนเงินทั้งสัญญา) แล้วยอดของงวดไปอยู่ลึกในกรอบสรุป
 *   ⇒ คนจ่ายเงินเห็นตัวเลขใหญ่ในตารางก่อน แล้วไม่แน่ใจว่าต้องจ่ายเท่าไร
 *
 * แบบใหม่ (ผู้ใช้เลือก):
 *   1  ชำระงวดที่ 1/2 มัดจำ (50%) ตามใบเสนอราคา QU…   จำนวน 1   ราคา = มูลค่างวดนี้ (D171)
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
 * ชื่องวดที่ไม่ได้บอกอะไรเพิ่ม — "งวดที่1" · "งวดที่ 2" · "งวด3"
 * D171: ผู้ใช้ตั้งชื่องวดแบบนี้แล้วบรรทัดหลักขึ้น "งวดที่ 1/3 งวดที่1" ซ้อนกัน → ไม่พิมพ์ชื่อที่ซ้ำกับเลขงวด
 */
export function isGenericInstallmentLabel(label: string): boolean {
  return /^งวด(ที่)?\s*\d+$/.test(label.trim());
}

/**
 * ป้ายของงวดบนบรรทัดหลัก — "งวดที่ 1/2 มัดจำ (50%)"
 * ★ % มาจากแผน (ไว้แสดง) · ไม่มี % = ไม่พิมพ์ · ชื่อว่าง/ชื่อที่เป็นแค่ "งวดที่ N" = ไม่พิมพ์ชื่อ
 */
export function installmentTag(k: number, n: number, label: string, percent: number | null): string {
  const name = label.trim() && !isGenericInstallmentLabel(label) ? ` ${label.trim()}` : "";
  const pct = percent != null && percent > 0 ? ` (${r2(percent)}%)` : "";
  return `งวดที่ ${k}/${n}${name}${pct}`;
}

/** ป้ายของใบแจ้งหนี้/ใบส่งสินค้า (ตอนส่งของ) — เรียกเก็บยอดที่ยังค้างทั้งหมด */
export const BALANCE_TAG = "ยอดคงค้าง";

/**
 * "ชำระงวดที่ 1/3 (33.33%) ตามใบเสนอราคา QU…"
 * D171 — คำกลาง (ผู้ใช้เลือกทาง ก): เดิม "ค่าสินค้าตามใบเสนอราคา …" อ่านแปลกกับค่าที่ปรึกษา/งานบริการ
 *   ★ ไม่เดาประเภทจากหมวดรายได้ (หมวดตั้งเองได้ · เลือกผิดแล้วคำผิดไปโผล่บนใบกำกับ)
 *   ★ ขายอะไรดูได้จากรายการใต้ "รายการตามใบเสนอราคา"
 */
export function planMainLine(quNo: string, tag: string): string {
  return `ชำระ${tag} ตามใบเสนอราคา ${quNo.trim()}`;
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
