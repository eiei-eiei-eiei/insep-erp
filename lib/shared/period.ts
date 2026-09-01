/**
 * lib/shared/period — เลขเดือน `yyyy-MM` และวันที่แบบไทยสั้น ๆ
 *
 * ทำไมต้องอยู่ที่นี่: ตัวช่วยพวกนี้เกิดใน `lib/accounting/taxPay.ts` (D88) แล้ว D92
 * ต้องใช้ชุดเดียวกันฝั่งผลิต (เตือนกำหนดยื่นงบเดือนสรรพสามิต)
 * 🚨 **ห้ามให้ `lib/production` import `lib/accounting`** — ย้ายมาบ้านกลางแทน
 *    แล้ว `taxPay.ts` re-export ต่อ เพื่อให้ไฟล์เดิมที่ import จากที่นั่นไม่ต้องแก้สักบรรทัด
 *
 * ★ ย้ายมาเฉย ๆ ไม่แก้พฤติกรรม — golden A17/A18 ต้องผ่านโดยไม่แก้ไฟล์เทส
 */

/** yyyy-MM ของเดือนถัดไป */
export function nextMonth(period: string): string {
  const [y, m] = period.split("-").map((x) => parseInt(x, 10));
  if (!y || !m) return period;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** yyyy-MM ของเดือนก่อนหน้า */
export function prevMonth(period: string): string {
  const [y, m] = period.split("-").map((x) => parseInt(x, 10));
  if (!y || !m) return period;
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

/**
 * ถอย/เดินวันจาก ISO date — คิดด้วย UTC ล้วน
 * 🪤 ใช้ `new Date(iso)` ตรง ๆ ไม่ได้ เพราะ timezone ของเครื่องจะทำให้คลาดไป 1 วัน
 */
export function shiftDaysISO(iso: string, days: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "15 ก.ย." — วันที่แบบสั้นสำหรับข้อความเตือน (ไม่ใส่ปี เพราะเป็นวันในอนาคตอันใกล้เสมอ) */
export function thaiDay(iso: string): string {
  const TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const mo = TH[parseInt(iso.slice(5, 7), 10) - 1] ?? "";
  return `${parseInt(iso.slice(8, 10), 10)} ${mo}`;
}
