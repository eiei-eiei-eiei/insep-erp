/**
 * lib/bar/businessDate — บิลใบนี้เป็นของ "วันขาย" ไหน (golden B6 · D96)
 *
 * ── ปัญหา ──────────────────────────────────────────────────────────────────
 * เปิดบิล 23:50 ปิด 01:10 → ลงบัญชีวันไหน? บาร์ที่ปิดตีสองจะมียอดครึ่งคืน
 * ตกไปเป็นของวันถัดไปทุกคืน ทำให้ยอดรายวันอ่านไม่รู้เรื่อง
 *
 * ── กติกา ──────────────────────────────────────────────────────────────────
 * ผู้ใช้ตั้ง **รอบขาย** เป็นช่วงเวลา (เช่น 18:00–03:00)
 * · ปิดบิล **ในรอบ**   → วันที่ที่รอบนั้น **เริ่ม**
 * · ปิดบิล **นอกรอบ**  → วันที่ตามปฏิทิน (ไม่ขยับ)
 * · `start === end`     → ถือว่า **ไม่ได้ตั้งรอบ** → วันที่ตามปฏิทินเสมอ (พฤติกรรมเดิมเป๊ะ)
 *
 * 🚩 **คุณสมบัติที่ห้ามหลุด: ฟังก์ชันนี้ต้อง total — ทุกเวลาต้องแมปไปวันใดวันหนึ่งเสมอ**
 *    "นอกรอบ" จึงไม่ใช่ error · ตั้งรอบเป็นกลางคืนไว้แล้วออกบูธตอนเที่ยง
 *    **ต้องขายได้ตามปกติ** ไม่ใช่ถูกบล็อกหรือหายไปเฉย ๆ
 *
 * 🪤 เคสที่กติกานี้ยังตอบไม่สวย: ลากยาวเลยรอบไป 1 ชม. จะตกเป็นวันถัดไป
 *    ทั้งที่ใจคนคือหางของคืนก่อน → แก้ `business_date` รายบิลได้ (`bar.config` + `edit_log`)
 *    เป็นทางออกของ 1% ที่ซื่อตรงกว่าการเดาให้
 *
 * ★ เวลาไทยคงที่ UTC+7 (ไม่มี DST) — ใช้หลักเดียวกับ `lib/shared/datetime.ts`
 */
import type { SaleWindow } from "./types";

const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** 'HH:mm' → นาทีนับจากเที่ยงคืน · รูปแบบผิด = null (ไม่เดา) */
export function minutesOfClock(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** เวลาไทยของ instant นี้ — คืนทั้งวันที่และนาทีนับจากเที่ยงคืน */
function bangkokParts(at: Date): { dateISO: string; minutes: number } {
  const shifted = new Date(at.getTime() + BKK_OFFSET_MS);
  return {
    dateISO: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** เลื่อนวันที่ ISO ไปกี่วัน (คำนวณล้วน ไม่พึ่ง timezone ของเครื่อง) */
export function shiftDateISO(dateISO: string, days: number): string {
  const d = new Date(dateISO + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ตั้งรอบขายไว้จริงไหม — start เท่ากับ end หรือกรอกผิดรูปแบบ = ไม่ได้ตั้ง */
export function hasSaleWindow(win: SaleWindow | null | undefined): boolean {
  if (!win) return false;
  const s = minutesOfClock(win.start);
  const e = minutesOfClock(win.end);
  return s !== null && e !== null && s !== e;
}

/**
 * วันขายของบิลที่ปิดตอน `closedAt`
 *
 * @param closedAt เวลาปิดบิล (instant จริง — ฟังก์ชันแปลงเป็นเวลาไทยเอง)
 * @param win      รอบขาย · ไม่ส่ง/ไม่ได้ตั้ง = ใช้วันตามปฏิทินไทย
 */
export function businessDate(closedAt: Date, win?: SaleWindow | null): string {
  const { dateISO, minutes } = bangkokParts(closedAt);
  if (!hasSaleWindow(win)) return dateISO;

  const start = minutesOfClock(win!.start)!;
  const end = minutesOfClock(win!.end)!;

  // รอบอยู่ในวันเดียว เช่น 10:00–22:00 → ไม่มีอะไรต้องเลื่อน ทั้งในรอบและนอกรอบ
  // ★ เขียนเป็น early return ไม่ใช่ ternary ที่คืนค่าเดียวกันสองข้าง — โค้ดที่ดูเหมือน
  //   ไม่ทำอะไรจะถูกใครสักคน "แก้" ให้เลื่อนวัน แล้วยอดบ่ายจะย้ายวันโดยไม่มีใครสังเกต
  if (start < end) return dateISO;
  // รอบข้ามเที่ยงคืน เช่น 18:00–03:00
  if (minutes >= start) return dateISO; // หัวคืน — รอบเริ่มวันนี้
  if (minutes < end) return shiftDateISO(dateISO, -1); // หลังเที่ยงคืน — รอบเริ่มเมื่อวาน
  return dateISO; // นอกรอบ (เช่น บ่ายสอง) — วันตามปฏิทิน
}

/** อยู่ในรอบขายไหม — ใช้ขึ้นป้าย "นอกเวลาทำการ" บนหน้าขาย (เตือน ไม่บล็อก) */
export function isInSaleWindow(at: Date, win?: SaleWindow | null): boolean {
  if (!hasSaleWindow(win)) return true;
  const { minutes } = bangkokParts(at);
  const start = minutesOfClock(win!.start)!;
  const end = minutesOfClock(win!.end)!;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}
