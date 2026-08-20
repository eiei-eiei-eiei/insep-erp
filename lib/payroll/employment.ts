/**
 * lib/payroll/employment — "คนนี้ต้องอยู่ในงวดนี้ไหม"
 *
 * 🚨 เดิมตอนเติมพนักงานเข้างวดกรองด้วย `active = true` อย่างเดียว และ
 *    **`end_date` (วันพ้นสภาพ) ไม่มีโค้ดไหนใช้เลย** — เป็นช่องหลอก
 *    (ตระกูลเดียวกับ `pay_components.expense_cat` ที่ถูกลบทิ้งใน D67)
 *
 * 🪤 ทำไมใช้ `active` อย่างเดียวไม่ได้: คนที่ลาออกกลางเดือน **ยังต้องได้เงินงวดนั้น**
 *    แต่ผู้ใช้ติ๊ก "ยังทำงานอยู่" ออกไปแล้วตั้งแต่วันที่เขาออก
 *    → **วันที่ต้องเป็นตัวตัดสินหลัก · `active` เป็นตัวสำรองตอนไม่ได้กรอกวัน**
 */

/** วันแรก/วันสุดท้ายของงวด (ISO — เทียบสตริงได้ตรง ๆ เพราะรูปแบบ YYYY-MM-DD) */
export function periodRange(year: number, month: number): { start: string; end: string } {
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}

/**
 * อยู่ในสภาพลูกจ้างช่วงใดช่วงหนึ่งของงวดนี้ไหม
 *
 * | เงื่อนไข | ผล |
 * |---|---|
 * | เริ่มงานหลังวันสิ้นงวด | ไม่อยู่ (ยังไม่เข้าทำงาน) |
 * | พ้นสภาพก่อนวันเริ่มงวด | ไม่อยู่ |
 * | พ้นสภาพระหว่างงวด | **อยู่** — ต้องจ่ายงวดนั้น |
 * | ไม่มีวันพ้นสภาพ แต่ติ๊ก "ยังทำงานอยู่" ออก | ไม่อยู่ (ออกแล้ว แต่ไม่รู้วันไหน) |
 */
export function isEmployedInPeriod(
  e: { startDate?: string | null; endDate?: string | null; active?: boolean },
  year: number,
  month: number,
): boolean {
  const { start, end } = periodRange(year, month);
  const s = (e.startDate ?? "").trim();
  const x = (e.endDate ?? "").trim();

  if (s && s > end) return false;
  if (x) return x >= start;
  return e.active !== false;
}

/** เหตุผลสั้น ๆ ว่าทำไมแถวนี้ไม่ควรอยู่ในงวดแล้ว — ใช้ติดป้ายบนหน้าจอ (null = ปกติ) */
export function notInPeriodReason(
  e: { startDate?: string | null; endDate?: string | null; active?: boolean },
  year: number,
  month: number,
): string | null {
  if (isEmployedInPeriod(e, year, month)) return null;
  const { start, end } = periodRange(year, month);
  const s = (e.startDate ?? "").trim();
  const x = (e.endDate ?? "").trim();
  if (s && s > end) return `เริ่มงาน ${s} (หลังงวดนี้)`;
  if (x && x < start) return `พ้นสภาพ ${x} (ก่อนงวดนี้)`;
  return "ไม่ได้ทำงานแล้ว (ไม่ได้ระบุวันพ้นสภาพ)";
}
