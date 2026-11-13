/**
 * lib/sales/docLines — ตัวเลขในตารางรายการสินค้าบนเอกสารขาย (D167)
 *
 * ราคาที่เก็บในออเดอร์เป็น **ราคารวม VAT** (D27) — เงินทุกบาทคิดจากราคานี้ (`calc.ts` ไม่ถูกแตะ)
 * แต่คนอ่านเอกสารสับสนเมื่อตารางโชว์ราคารวม VAT แล้วด้านล่างแยก VAT อีกที
 * ⇒ กิจการที่จด VAT: ตารางแสดง **ก่อน VAT** · ผู้ไม่จด VAT: แสดงตามราคาเดิม (ไม่มีอะไรให้ถอด)
 *
 * 🚨 บทเรียน D27: เคยเก็บราคาก่อน VAT ที่ปัด 2 ตำแหน่ง (196.26) แล้วเอาไปคูณจำนวนเพื่อคิดเงิน
 *    → 3 ขวดได้ 629.99 แทน 630 · ที่นี่ "หน่วยละ" เป็นค่าที่แสดงอย่างเดียว ห้ามเอาไปคูณ
 *    "จำนวนเงิน" ของแถว = ถอด VAT จากยอดรวม VAT ของแถวนั้น (249 × 50 = 12,450 → 11,635.51)
 *    แล้วเกลี่ยเศษให้ทุกแถวรวมกันได้เท่า "รวมเป็นเงิน (ก่อน VAT)" ของใบพอดี (`allocateBase`)
 * 🪤 ผลคือบางแถว หน่วยละ × จำนวน คลาดจากจำนวนเงินไม่กี่สตางค์ (232.71 × 50 = 11,635.50)
 *    เป็นเรื่องปกติของการแสดงราคาก่อนภาษี — ฐานภาษีคือมูลค่าทั้งใบ ไม่ใช่ราคาต่อหน่วย (ผู้ใช้รับทราบแล้ว)
 */
import { allocateBase, baseOfGross } from "../shared/vat";

const round2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

export type DocLineInput = { name: string; qty: number; price: number };
export type DocLine = { name: string; qty: number; /** ราคาต่อหน่วยที่แสดง */ unit: number; /** จำนวนเงินของแถวที่แสดง */ amount: number };

/** ยอดรวม VAT ของแต่ละแถว — ตัวเดียวกับที่ตารางเดิมพิมพ์ (`roundTo2(price × qty)`) */
const grossOf = (it: DocLineInput) => round2(it.price * it.qty);

/**
 * แถวในตาราง
 * @param target ยอดก่อน VAT ที่ทุกแถวต้องรวมได้ (ใบลดหนี้ส่งผลต่างที่บันทึกไว้) · ไม่ส่ง = ถอดจากยอดรวม VAT ของตาราง
 */
export function docLines(items: DocLineInput[], isVat: boolean, target?: number): DocLine[] {
  if (!isVat) return items.map((it) => ({ name: it.name, qty: it.qty, unit: it.price, amount: grossOf(it) }));
  const gross = items.map(grossOf);
  const amounts = allocateBase(gross, target ?? docLinesBase(items));
  return items.map((it, i) => ({ name: it.name, qty: it.qty, unit: baseOfGross(it.price), amount: amounts[i] }));
}

/** "รวมเป็นเงิน (ก่อน VAT)" ของตาราง = ถอด VAT จากยอดรวม VAT ทั้งตาราง (ไม่ใช่ผลรวมของแถวที่ปัดแล้ว) */
export function docLinesBase(items: DocLineInput[]): number {
  return baseOfGross(round2(items.reduce((s, it) => s + it.price * it.qty, 0)));
}

/**
 * ส่วนลดในรูปก่อน VAT ที่พิมพ์คั่นระหว่าง "รวมเป็นเงิน" กับ "มูลค่าหลังหักส่วนลด"
 * = ผลต่างของสองบรรทัดนั้นบนกระดาษ ⇒ ลบกันแล้วได้ตรงเสมอ (ไม่คิดส่วนลดแยกอีกสูตร)
 */
export function docDiscountEx(items: DocLineInput[], subDiscount: number): number {
  return round2(docLinesBase(items) - (Number(subDiscount) || 0));
}
