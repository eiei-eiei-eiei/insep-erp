/**
 * lib/bar/discount — ส่วนลดแบบ **บาท หรือ %** (golden B10 · D96 ภาค 2)
 *
 * ── 🚨 กติกาที่ล็อกไว้ ──────────────────────────────────────────────────────
 * **แปลง % เป็นบาทให้เสร็จ *ก่อน* เข้าท่อคำนวณเดิมเสมอ**
 * ⇒ ลำดับใน `barTotals()` ไม่ขยับแม้บรรทัดเดียว และ **golden B4 ผ่านโดยไม่แก้ไฟล์เทส**
 *   (แพตเทิร์นเดียวกับ D55 `isVat` / D69 `taxableIncome` — ของใหม่ต้องพิสูจน์ว่าไม่แตะของเก่า)
 *
 * ── ฐานที่ใช้คิด % ต่างกันคนละตัว และตั้งใจให้ต่าง ────────────────────────────
 *   · **% ต่อรายการ** คิดจาก `ราคา × จำนวน` ของบรรทัดนั้น
 *   · **% ท้ายบิล**   คิดจากยอด **หลัง** หักส่วนลดรายรายการแล้ว (`subTotal`)
 *     ⇒ ลด 10% ต่อรายการ + 10% ท้ายบิล **ไม่เท่ากับ** ลด 20% (golden B10 ล็อกไว้)
 *
 * ── 🚨 เก็บลง DB เป็น "บาท" เสมอ · % เป็นแค่คำอธิบาย ────────────────────────
 * ราคาเมนูเปลี่ยนวันหลัง แล้วถ้าไปคิด % สดตอนเปิดดูย้อนหลัง
 * **ส่วนลดของบิลเก่าจะขยับตาม = ยอดที่ลงบัญชีไปแล้วเพี้ยน**
 * (กติกา D75: ชื่อ = ค่าปัจจุบัน · **ตัวเงิน = ค่าที่แช่ไว้**)
 */
import type { CartLine } from "./types";

const round2 = (v: number) => Math.round(v * 100) / 100;

export type DiscountMode = "baht" | "pct";

/** ส่วนลดที่ผู้ใช้กรอก — ยังไม่ใช่ตัวเงินจนกว่าจะผ่าน `discountBaht()` */
export type DiscountInput = { mode: DiscountMode; value: number };

export const NO_DISCOUNT: DiscountInput = { mode: "baht", value: 0 };

/**
 * แปลงส่วนลดที่ผู้ใช้กรอก → **จำนวนเงินบาท**
 *
 * · `%` เกิน 100 → ตัดที่ 100 (ยอดเป็น 0 **ไม่ใช่ติดลบ**)
 * · ค่าติดลบ → 0 · ค่าที่ไม่ใช่ตัวเลข → 0
 * · ฐานติดลบ/เป็น 0 → 0 (ไม่มีอะไรให้ลด)
 * 🪤 โหมดบาท **ไม่ตัดเพดานที่นี่** — คนตัดคือ `barTotals()`/`lineAmount()` ซึ่งรู้ยอดจริง
 *    ตัดสองที่ = วันหนึ่งจะไม่ตรงกัน
 */
export function discountBaht(input: DiscountInput | null | undefined, base: number): number {
  if (!input) return 0;
  const v = Number(input.value);
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (input.mode === "baht") return round2(v);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const pct = Math.min(v, 100);
  return round2((base * pct) / 100);
}

/** ข้อความกำกับบนจอ/บนสลิป — `null` เมื่อไม่มีส่วนลด */
export function discountLabel(input: DiscountInput | null | undefined): string | null {
  if (!input) return null;
  const v = Number(input.value);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (input.mode === "pct") return `${Math.min(v, 100)}%`;
  return null; // โหมดบาท — ตัวเลขเงินบนจออธิบายตัวเองอยู่แล้ว
}

/**
 * บรรทัดในถาดที่ผู้ใช้เลือกลดเป็น % — เก็บ `lineDiscountPct` ไว้ แล้ว**คิดบาทสดทุกครั้ง**
 *
 * 🚨 ต้องคิดสดเพราะ **ฐานเปลี่ยนได้ตลอดเวลาที่ยังอยู่ในถาด** (กด + เพิ่มจำนวน)
 *    ถ้าแช่บาทไว้ตั้งแต่ตอนกรอก % แล้วผู้ใช้กดเพิ่มจำนวน → ส่วนลดจะค้างที่ของจำนวนเดิม
 *    ★ พอ **ส่งเข้าบิล** แล้วค่าบาทจะถูกแช่ลง DB ทันที — ตั้งแต่นั้น % ไม่มีผลอีก
 */
export function resolveLine(line: CartLine): CartLine {
  const pct = line.lineDiscountPct;
  if (pct == null || !Number.isFinite(pct) || pct <= 0) return line;
  return {
    ...line,
    lineDiscount: discountBaht({ mode: "pct", value: pct }, line.qty * line.price),
  };
}

export function resolveLines(lines: readonly CartLine[]): CartLine[] {
  return lines.map(resolveLine);
}
