import type { PayRates } from "./types";

/**
 * lib/payroll/sso — เงินสมทบประกันสังคม
 *
 * สูตรที่กฎหมายกำหนด (ล็อกในโค้ด): บีบฐานค่าจ้างเข้าช่วง [min, max] ก่อน แล้วคูณอัตรา
 * ตัวเลขทั้งหมด (อัตรา/พื้น/เพดาน) มาจาก `PayRates` ที่เลือกตามวันเริ่มมีผล —
 * **ห้ามฝังตัวเลขไว้ในไฟล์นี้** เพราะถูกแก้ด้วยกฎกระทรวงเป็นระยะ
 *
 * 🪤 ลำดับสำคัญ: บีบเพดาน **ที่ฐานค่าจ้าง** ไม่ใช่ที่ยอดเงินสมทบ
 *    ผลลัพธ์ต่างกันเมื่ออัตราไม่ใช่ 5% พอดี และเวลาที่กฎหมายลดอัตราชั่วคราว
 *    (เคยเกิดจริงช่วงโควิด) ค่าที่ถูกคือบีบฐานก่อน
 */

/** บีบฐานค่าจ้างเข้าช่วงที่กฎหมายกำหนด — ต่ำกว่าพื้น = ใช้พื้น · เกินเพดาน = ใช้เพดาน */
export function ssoWageBase(wage: number, rates: PayRates): number {
  const w = Number.isFinite(wage) ? wage : 0;
  if (w <= 0) return 0;
  return Math.min(Math.max(w, rates.ssoWageMin), rates.ssoWageMax);
}

/**
 * เงินสมทบฝั่งลูกจ้าง (ปัดเป็นจำนวนเต็มบาท — แบบเดียวกับที่สำนักงานประกันสังคมเรียกเก็บ)
 * @param exempt ลูกจ้างที่ได้รับยกเว้น (เช่น อายุเกินเกณฑ์) = 0
 */
export function ssoContribution(wage: number, rates: PayRates, exempt = false): number {
  if (exempt) return 0;
  const base = ssoWageBase(wage, rates);
  if (base <= 0) return 0;
  return Math.round((base * rates.ssoRate) / 100);
}

/**
 * เงินสมทบฝั่งนายจ้าง — อัตราเดียวกับลูกจ้าง
 * แยกฟังก์ชันไว้เพราะเป็น **รายจ่ายของบริษัท** (ลูกจ้างไม่ได้จ่าย) และวันหนึ่ง
 * อัตราสองฝั่งอาจไม่เท่ากัน (เคยไม่เท่ากันมาแล้วตอนลดอัตราช่วงโควิด)
 */
export function ssoEmployerContribution(wage: number, rates: PayRates, exempt = false): number {
  return ssoContribution(wage, rates, exempt);
}

/**
 * เลือกชุดอัตราที่มีผล ณ วันที่กำหนด — แถวล่าสุดที่ `effectiveFrom <= onDate`
 *
 * 🚨 ใช้ "วันสิ้นงวด" เป็น onDate เสมอ ไม่ใช่วันที่เปิดหน้าจอ
 *    ไม่งั้นเปิดดูงวดเก่าปีที่แล้วจะได้อัตราปีนี้
 */
export function ratesOn(all: PayRates[], onDate: string): PayRates | null {
  const usable = all
    .filter((r) => r.effectiveFrom <= onDate)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return usable[0] ?? null;
}
