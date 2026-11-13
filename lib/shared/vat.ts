/**
 * lib/shared/vat — ถอด VAT ออกจากยอดที่ "รวมภาษีแล้ว"
 *
 * เดิมอยู่ที่ `lib/bar/vat.ts` (golden B11 · D96 เฟส F) แล้วย้ายมาที่นี่ใน D98
 * เพราะฝั่งบัญชีต้องใช้ตัวเดียวกัน — 🚨 ห้ามให้ `lib/accounting` import `lib/bar`
 * (ข้ามโดเมน) และห้ามเขียนสูตรถอด VAT ชุดที่สอง (บทเรียน D79/D86: สูตรเงิน 2 ที่
 * = วันหนึ่งจะหลุดจากกันโดยไม่มีอะไรฟ้อง) · `lib/bar/vat.ts` re-export ตัวนี้ต่อ
 *
 * ── 🚨 `base` คำนวณด้วยการ **ลบ** ไม่ใช่สูตรของตัวเอง ────────────────────────
 * `round2(gross×100/107)` กับ `round2(gross×7/107)` บวกกันแล้วคลาดจาก `gross` ได้ 1 สตางค์
 * ⇒ บนกระดาษจะเป็น `242.99 + 17.01 = 260.00` แต่บางใบเป็น `242.99 + 17.02 = 260.01`
 *   ซึ่งคนอ่านจับได้ทันที และยอดรวมบนใบกำกับต้องตรงกับเงินที่รับ/จ่ายจริงเป๊ะ
 * ★ `vatFromGross()` การันตี `base + vat === gross` เสมอ (golden B11 ล็อกไว้)
 */

const round2 = (v: number) => Math.round(v * 100) / 100;

/** อัตรา VAT ปัจจุบัน — 🚨 ห้ามฮาร์ดโค้ด 7 กระจายหลายที่ */
export const VAT_RATE = 7;

export type VatSplit = {
  /** ยอดก่อนภาษี */
  base: number;
  /** ภาษีมูลค่าเพิ่ม */
  vat: number;
  /** ยอดรวม = เงินที่รับ/จ่ายจริง (เท่ากับที่ส่งเข้ามาเสมอ) */
  gross: number;
};

/**
 * ถอด VAT ออกจากยอดที่รวมภาษีแล้ว
 *
 * · ยอด 0 หรือติดลบ → คืน 0 ทั้งชุด (ไม่มีอะไรให้ถอด)
 * · `rate` 0 → ไม่มีภาษี (base = gross) — เผื่อกิจการที่ยังไม่จด/สินค้ายกเว้น
 */
export function vatFromGross(gross: number, rate: number = VAT_RATE): VatSplit {
  const g = round2(Number(gross) || 0);
  if (g <= 0 || rate <= 0) return { base: g > 0 ? g : 0, vat: 0, gross: g > 0 ? g : 0 };
  const vat = round2((g * rate) / (100 + rate));
  // 🚨 ลบเอา ไม่ใช่คิดสูตรแยก — การันตีว่า base + vat = gross เป๊ะ
  return { base: round2(g - vat), vat, gross: g };
}

/**
 * ยอดก่อนภาษีของยอดที่รวมภาษีแล้ว — รองรับยอดติดลบ (บรรทัด "หัก" บนเอกสาร)
 * ★ ยอดบวกได้ค่าเดียวกับ `vatFromGross(g).base` เป๊ะ
 */
export function baseOfGross(gross: number, rate: number = VAT_RATE): number {
  const g = Number(gross) || 0;
  return g < 0 ? -vatFromGross(-g, rate).base : vatFromGross(g, rate).base;
}

/**
 * แบ่ง "ยอดก่อน VAT ของทั้งใบ" ลงแต่ละบรรทัด (A21 D98 · ย้ายมาจาก lib/accounting ใน D167)
 *
 * แต่ละบรรทัดถอด VAT จาก **ยอดรวม VAT ของบรรทัดนั้น** (ไม่ใช่ ราคาต่อหน่วยที่ปัดแล้ว × จำนวน)
 * 🚨 ผลรวมต้องเท่ากับ `base` **เป๊ะ** — ไม่งั้นคนบวกคอลัมน์แล้วได้ไม่ตรงกับยอดก่อน VAT ของใบเดียวกัน
 * ★ เศษปัดตกที่บรรทัดยอดใหญ่ที่สุด — คลาดเป็นสัดส่วนน้อยที่สุด
 */
export function allocateBase(lineGross: number[], base: number, rate: number = VAT_RATE): number[] {
  const out = lineGross.map((g) => baseOfGross(g, rate));
  if (out.length === 0) return out;
  const diff = round2((Number(base) || 0) - round2(out.reduce((a, b) => a + b, 0)));
  if (diff === 0) return out;
  let k = 0;
  for (let i = 1; i < lineGross.length; i++) if ((Number(lineGross[i]) || 0) > (Number(lineGross[k]) || 0)) k = i;
  out[k] = round2(out[k] + diff);
  return out;
}

/** ข้อความอัตราไว้พิมพ์บนสลิป — `ภาษีมูลค่าเพิ่ม 7%` */
export function vatLabel(rate: number = VAT_RATE): string {
  return `ภาษีมูลค่าเพิ่ม ${rate}%`;
}
