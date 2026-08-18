/**
 * lib/shared/datetime — ขอบเขตวัน "ตามเวลาไทย" ฝั่ง server
 *
 * เหตุผล: Vercel รัน server เป็น UTC → `new Date().setHours(0,0,0,0)` = เที่ยงคืน UTC
 * = 7 โมงเช้าไทย ทำให้ตัวนับรายวัน (เช่น แจ้งเตือนค่างวดวันละครั้ง) รีเซ็ตผิดเวลา
 * ไทยเป็น UTC+7 คงที่ (ไม่มี DST) จึงบวก/ลบ 7 ชั่วโมงตรง ๆ ได้
 */

const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** วันที่ (yyyy-MM-dd) ตามเวลาไทย ณ เวลาที่กำหนด */
export function bangkokDateISO(now: Date = new Date()): string {
  return new Date(now.getTime() + BKK_OFFSET_MS).toISOString().slice(0, 10);
}
