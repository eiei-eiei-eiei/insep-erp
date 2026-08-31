/**
 * lib/sales/pos — ขายหน้าร้าน (POS · D86)
 *
 * 🚨 **ไม่มีสูตรเงินชุดใหม่ในไฟล์นี้** — POS คือใบเสนอราคาที่ไม่มี WHT และไม่มีมัดจำ
 *    ทุกยอดยังมาจาก `quotationTotals()` ตัวเดิม (กติกาเหล็กข้อ 1: สูตรเงินมีที่เดียว)
 *    ถ้าวันหนึ่งมีคนอยากให้ POS "คิดเร็วขึ้น" ด้วยการคูณเอง — นั่นคือจุดที่ตัวเลข
 *    บนใบกำกับภาษีจะเริ่มไม่ตรงกับที่ลงบัญชี
 */

import { quotationTotals, type CartItem, type QuotationInput, type QuotationTotals } from "./calc";

/** แถวเมนูขายเท่าที่ POS ต้องรู้ (โครงเดียวกับ MenuRow ใน sales/data.ts — ไม่ import เพราะนั่น server-only) */
export type PosMenuRow = {
  name: string;
  itemCode: string;
  /** คงเหลือในหน่วยขาย (floor(balance / multiplier)) · `null` = ไม่รู้ (ยังไม่มีแถวสต็อก) */
  stockQty: number | null;
};

/**
 * input ของ `quotationTotals` สำหรับบิลหน้าร้าน
 * — ไม่มี WHT (ลูกค้าขาจรไม่หัก ณ ที่จ่าย) · ไม่มีมัดจำ (จ่ายจบหน้าร้าน)
 */
export function posQuotationInput(items: CartItem[], discount: number): QuotationInput {
  return {
    items,
    discount: Number(discount) || 0,
    isWhtRequired: false,
    whtPercent: 0,
    isDepositRequired: false,
    depositPercent: 0,
  };
}

/** ยอดบิลหน้าร้าน — ทางลัดของ `quotationTotals(posQuotationInput(...))` */
export function posTotals(items: CartItem[], discount: number, isVat = true): QuotationTotals {
  return quotationTotals(posQuotationInput(items, discount), isVat);
}

export type Shortage = { name: string; want: number; have: number };

/**
 * รายการที่สั่งเกินสต็อกคงเหลือ — **เตือนอย่างเดียว ไม่บล็อก** (มติผู้ใช้ D86)
 *
 * 🪤 จับคู่ด้วย `trim(ชื่อ)` ให้ตรงกับที่ `fn_confirm_fulfillment` join
 *    (`trim(sm.menu_name) = trim(soi.item_name)`) — ใช้กติกาคนละแบบเมื่อไหร่
 *    หน้าจอจะเตือนสินค้าตัวหนึ่ง แต่ DB ไปตัดอีกตัวหนึ่ง
 *
 * `stockQty = null` (ยังไม่มีแถวสต็อก) → **ไม่เตือน** — ไม่รู้ ≠ ไม่มี
 * การเดาว่าเป็น 0 จะทำให้ทุกบิลขึ้นเตือนจนคนเลิกอ่าน
 */
export function stockShortages(items: CartItem[], menu: PosMenuRow[]): Shortage[] {
  const have = new Map<string, number | null>();
  for (const m of menu) have.set(m.name.trim(), m.stockQty);

  const want = new Map<string, number>();
  for (const it of items) {
    const k = it.name.trim();
    want.set(k, (want.get(k) ?? 0) + (Number(it.qty) || 0));
  }

  const out: Shortage[] = [];
  for (const [name, qty] of want) {
    const hv = have.get(name);
    if (hv === null || hv === undefined) continue; // ไม่รู้ = ไม่เตือน
    if (qty > hv) out.push({ name, want: qty, have: hv });
  }
  return out;
}

/** รวมรายการชื่อซ้ำเป็นบรรทัดเดียว (กันบิลที่มีสินค้าตัวเดิม 2 บรรทัด แล้วเตือนสต็อกเพี้ยน) */
export function mergeCart(items: CartItem[]): CartItem[] {
  const out: CartItem[] = [];
  for (const it of items) {
    const found = out.find((o) => o.name.trim() === it.name.trim() && o.price === it.price);
    if (found) found.qty += it.qty;
    else out.push({ ...it });
  }
  return out;
}
