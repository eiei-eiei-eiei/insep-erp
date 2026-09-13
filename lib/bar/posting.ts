/**
 * lib/bar/posting — วันไหนขายแล้วแต่ยังไม่ได้ลงบัญชี (golden B12 · D96 ภาค 2 เฟส E)
 *
 * ── ทำไมต้องมีตัวตามเก็บ ────────────────────────────────────────────────────
 * การลงบัญชีของบาร์เป็น **สรุปรายวัน กดเอง** (แผนข้อ 13) ไม่ใช่ยิงทีละบิล
 * เหตุผลยังถูกอยู่ — คืนหนึ่ง 30-50 บิล ยิงทีละใบแล้วสมุดบัญชีจะจมจนหาบิลจริงไม่เจอ
 *
 * 🚨 แต่ **ปุ่มที่ต้องกดเป็นกิจวัตรคือปุ่มที่วันหนึ่งจะลืมกด แล้วตัวเลขผิดเงียบ ๆ** (บทเรียน D91)
 *    ⇒ ต้องมีตัวไล่ตามว่าวันไหนค้าง · ผู้ใช้เลือกทางนี้เอง (ทาง ข.) แทนการลงบัญชีอัตโนมัติ
 *
 * ── 🚨 ห้ามนับ "วันขายที่ยังขายอยู่" ────────────────────────────────────────
 * รอบขายของบาร์ข้ามเที่ยงคืน (เช่น 18:00–03:00) ⇒ ตอนตี 1 ของวันที่ 14
 * ยัง "อยู่ในวันขายของวันที่ 13" และยังเปิดบิลเพิ่มได้เรื่อย ๆ
 * เตือนตอนนั้น = บอกให้ปิดยอดทั้งที่ร้านยังขายอยู่ แล้วยอดที่ลงจะขาด
 */

/** บิลที่ปิดแล้ว 1 ใบ (เอาเฉพาะที่ต้องใช้) */
export type ClosedSale = { businessDate: string; grandTotal: number };

export type UnpostedDay = { date: string; bills: number; total: number };

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * วันที่ขายแล้วแต่ยังไม่ได้ลงบัญชี — เรียงจากเก่าไปใหม่ (ค้างนานสุดขึ้นก่อน)
 *
 * @param sales      บิลสถานะ `ปกติ` ที่มี `business_date` แล้ว
 * @param postedDays วันที่มีแถว `bar_post` ที่ยังไม่ถูกถอน
 * @param currentDay **วันขายของตอนนี้** (มาจาก `businessDate()` ไม่ใช่วันปฏิทิน)
 *                   วันนี้จะถูกกันออกเสมอ เพราะยังขายไม่จบ
 */
export function unpostedDays(
  sales: readonly ClosedSale[],
  postedDays: readonly string[],
  currentDay: string,
): UnpostedDay[] {
  const posted = new Set(postedDays);
  const byDay = new Map<string, UnpostedDay>();

  for (const s of sales) {
    const d = s.businessDate;
    if (!d) continue; // บิลที่ยังเปิดอยู่ยังไม่มีวันขาย — ไม่ใช่ของค้าง
    if (posted.has(d)) continue;
    if (d >= currentDay) continue; // 🚨 คืนนี้ยังขายอยู่ ห้ามเตือน
    const cur = byDay.get(d) ?? { date: d, bills: 0, total: 0 };
    cur.bills += 1;
    cur.total = round2(cur.total + (Number(s.grandTotal) || 0));
    byDay.set(d, cur);
  }

  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** ยอดรวมของทุกวันที่ค้าง — ไว้โชว์บนแถบเตือน */
export function unpostedTotal(days: readonly UnpostedDay[]): number {
  return round2(days.reduce((s, d) => s + d.total, 0));
}

/**
 * ข้อความบนแถบตามเก็บ — `null` = ไม่มีอะไรค้าง (ห้าม render แถบเปล่า)
 *
 * 🚨 ตัดสินข้อความที่นี่ ไม่ใช่ในคอมโพเนนต์ (D84/D88) — จำนวนวันกับรายชื่อวัน
 *    ต้องมาจากชุดข้อมูลเดียวกับปุ่มที่ผู้ใช้จะกด ไม่งั้นประโยคกับปุ่มจะไม่ตรงกัน (D91/0059)
 */
export function unpostedText(days: readonly UnpostedDay[], maxNames = 5): string | null {
  if (days.length === 0) return null;
  const names = days.slice(0, maxNames).map((d) => thaiDay(d.date));
  const more = days.length > maxNames ? ` และอีก ${days.length - maxNames} วัน` : "";
  return `ยังไม่ได้ลงบัญชี ${days.length} วัน (${names.join(", ")}${more})`;
}

const THAI_MONTH = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

/** `2026-09-12` → `12 ก.ย.` — ★ ไม่ใส่ปีเพราะแถบนี้พูดถึงของค้างไม่กี่วัน */
export function thaiDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${THAI_MONTH[Number(m[2]) - 1] ?? m[2]}`;
}
