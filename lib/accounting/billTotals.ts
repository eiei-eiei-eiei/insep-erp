/**
 * lib/accounting/billTotals — D139 ยอดรวมของบิลที่กรองอยู่ในแท็บค้นบิล
 *
 * ★ เป็นตัวเลขแสดงบนจอเท่านั้น ไม่ใช่รายงานเงิน/ภาษี (ไม่แตะสูตรใด ๆ)
 * 🚨 ห้ามบวกทุกประเภทรวมเป็นเลขเดียว — รายรับกับรายจ่ายปนกันแล้วเลขไม่มีความหมาย ⇒ แยกตามประเภท
 * · บิลยกเลิกไม่นับ (แม้ติ๊ก "รวมที่ยกเลิก") แต่บอกจำนวนที่ตัดออก
 * · "เช็คราคา" ไม่นับ (ไม่ใช่เงินที่จ่ายจริง)
 * · ตั้งค้างรับ/ค้างจ่าย (ap_ar_status) ยังนับ แต่แยกบอกว่าในยอดเป็นยอดค้างเท่าไร
 * · โอนระหว่างบัญชี: 1 การโอน = 2 ขา (+/−) บวกกันได้ 0 ⇒ นับเฉพาะขาเข้าเป็น "ยอดโอน"
 */

import { num, round2 } from "./calc";
import { ADVANCE_TYPE, ADVANCE_REFUND_TYPE } from "./advance";

export type BillTotalInput = {
  type: string;
  net_amount: number | string | null;
  status: string;
  ap_ar_status: string | null;
};

export type BillTypeTotal = {
  type: string;
  count: number;
  total: number;
  /** ในยอดนี้มีบิลตั้งค้างกี่ใบ/เท่าไร */
  pendingCount: number;
  pendingTotal: number;
};

export type BillTotals = {
  byType: BillTypeTotal[];
  /** รายรับ − รายจ่าย · null = ไม่มีทั้งสองประเภทในผลกรอง */
  incomeMinusExpense: number | null;
  voidCount: number;
  priceCheckCount: number;
};

export const PRICE_CHECK_TYPE = "เช็คราคา";
const TRANSFER_TYPE = "โอนระหว่างบัญชี";

/** ลำดับแสดงผล · ประเภทที่ไม่รู้จักต่อท้ายตามลำดับที่เจอ */
const ORDER = ["รายรับ", "รายจ่าย", TRANSFER_TYPE, ADVANCE_TYPE, ADVANCE_REFUND_TYPE];

export function billTotals(rows: BillTotalInput[]): BillTotals {
  const map = new Map<string, BillTypeTotal>();
  let voidCount = 0;
  let priceCheckCount = 0;

  for (const r of rows) {
    if (r.status === "ยกเลิก") { voidCount++; continue; }
    if (r.type === PRICE_CHECK_TYPE) { priceCheckCount++; continue; }
    const net = num(r.net_amount);
    let t = map.get(r.type);
    if (!t) { t = { type: r.type, count: 0, total: 0, pendingCount: 0, pendingTotal: 0 }; map.set(r.type, t); }
    t.count++;
    // โอน: นับเฉพาะขาเข้า (ขาออกเป็นเงินก้อนเดียวกัน)
    const amt = r.type === TRANSFER_TYPE ? Math.max(net, 0) : net;
    t.total += amt;
    if (r.ap_ar_status) { t.pendingCount++; t.pendingTotal += amt; }
  }

  const byType = [...map.values()]
    .map((t) => ({ ...t, total: round2(t.total), pendingTotal: round2(t.pendingTotal) }))
    .sort((a, b) => rank(a.type) - rank(b.type));

  const inc = map.get("รายรับ");
  const exp = map.get("รายจ่าย");
  const incomeMinusExpense = inc || exp ? round2((inc?.total ?? 0) - (exp?.total ?? 0)) : null;

  return { byType, incomeMinusExpense, voidCount, priceCheckCount };
}

function rank(type: string): number {
  const i = ORDER.indexOf(type);
  return i === -1 ? ORDER.length : i;
}

/** ป้ายของแต่ละประเภทบนแถบสรุป (โอนบอกว่านับขาเข้า ไม่งั้นอ่านว่าเงินหายครึ่ง) */
export function billTotalLabel(type: string): string {
  return type === TRANSFER_TYPE ? "ยอดโอน (นับขาเข้า)" : type;
}

/** ประโยคบอกสิ่งที่ไม่ถูกนับ · ว่าง = ไม่มีอะไรตัดออก */
export function billTotalsNote(t: BillTotals, capped: boolean): string {
  const parts: string[] = [];
  if (t.voidCount > 0) parts.push(`ไม่นับบิลที่ยกเลิก ${t.voidCount} ใบ`);
  if (t.priceCheckCount > 0) parts.push(`ไม่นับเช็คราคา ${t.priceCheckCount} รายการ`);
  if (capped) parts.push("ยอดนี้นับเฉพาะ 500 รายการแรกที่โหลดมา — แคบด้วยเดือน/คู่ค้า/ประเภทเพื่อให้ยอดครบ");
  return parts.join(" · ");
}
