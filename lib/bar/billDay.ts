/**
 * lib/bar/billDay — บิลข้ามวันขาย: ถามตอนรับเงิน · เตือนก่อนตัดรอบ · แก้วันขายย้อนหลัง (golden B30 · D163)
 *
 * ── ต้นเรื่อง ───────────────────────────────────────────────────────────────
 * ผู้ใช้รับโอนไปแล้วแต่ลืมกดรับเงิน มากดเช้าวันถัดไป ⇒ ยอดไปอยู่ผิดวัน
 * (วันขายตัดสินจาก **เวลาที่กดรับเงิน** ไม่ใช่เวลาเปิดบิล — `businessDate()` golden B6)
 *
 * ทางแก้ 3 ชั้น ทั้งหมดตัดสินในไฟล์นี้ (ห้ามตัดสินในคอมโพเนนต์ · D84/D88):
 *   1. ตอนรับเงิน: บิลเปิดตั้งแต่วันขายก่อน → **ให้เลือกวัน ไม่เดาให้** (`crossDayChoice`)
 *   2. หน้าขาย: บิลค้างจากวันก่อน / อีกไม่นานจะตัดรอบ → แถบเตือน (`openBillsNotice`)
 *   3. ประวัติบิล: แก้วันขาย/วิธีรับเงินได้ (bar.config) → `editSaleProblem` เป็นฝาแฝดของ
 *      ด่านใน `fn_bar_edit_sale` (0109) — ฝั่ง SQL คือตัวจริง ฝั่งนี้คุมแค่ปุ่มบนจอ
 */
import type { SaleWindow } from "./types";
import { businessDate, hasSaleWindow, minutesOfClock } from "./businessDate";
import { PAY_METHODS } from "./payMethods";

const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MIN = 24 * 60;

/** นาทีนับจากเที่ยงคืนตามเวลาไทย */
function bkkMinutes(at: Date): number {
  const s = new Date(at.getTime() + BKK_OFFSET_MS);
  return s.getUTCHours() * 60 + s.getUTCMinutes();
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * อีกกี่นาที "วันขาย" จะเปลี่ยน (บิลที่รับเงินหลังจากนั้นเป็นยอดของอีกวัน)
 * · ไม่ได้ตั้งรอบ หรือรอบอยู่ในวันเดียว (เช่น 10:00–22:00) → ตัดที่เที่ยงคืน
 * · รอบข้ามเที่ยงคืน (เช่น 18:00–12:00) → ตัดที่เวลาจบรอบ
 * ★ ต้องตรงกับ `businessDate()` เป๊ะ — เทสไล่ทุกนาทีของวันเทียบกันตรง ๆ
 */
export function cutoffInfo(now: Date, win?: SaleWindow | null): { minutesLeft: number; at: string } {
  const m = bkkMinutes(now);
  let cut = DAY_MIN; // เที่ยงคืน
  if (hasSaleWindow(win)) {
    const s = minutesOfClock(win!.start)!;
    const e = minutesOfClock(win!.end)!;
    if (s > e) cut = e;
  }
  const minutesLeft = cut === DAY_MIN ? DAY_MIN - m : m < cut ? cut - m : DAY_MIN - m + cut;
  const at = cut === DAY_MIN ? "00:00" : `${pad(Math.floor(cut / 60))}:${pad(cut % 60)}`;
  return { minutesLeft, at };
}

/**
 * ตอนกดรับเงิน: บิลนี้เปิดตั้งแต่วันขายก่อนหน้าไหม
 * · null = วันเดียวกัน ไม่ต้องถามอะไร (กรณีปกติเกือบทั้งหมด)
 * · มีค่า = ต้องให้ผู้ใช้เลือกว่าลงยอดวันไหน — 🚨 **ห้ามเลือกให้ก่อน**
 *   (เลือกวันเปิดไว้ให้ = บิลที่เปิดค้างทั้งคืนแต่รับเงินจริงวันนี้ถูกย้ายเงียบ ๆ
 *    เลือกวันนี้ไว้ให้ = กลับไปเป็นปัญหาเดิมที่ผู้ใช้แจ้ง)
 */
export function crossDayChoice(
  openedAt: string,
  now: Date,
  win?: SaleWindow | null,
): { openDate: string; nowDate: string } | null {
  const t = new Date(openedAt);
  if (Number.isNaN(t.getTime())) return null;
  const openDate = businessDate(t, win);
  const nowDate = businessDate(now, win);
  return openDate === nowDate ? null : { openDate, nowDate };
}

/** วันขายที่ server ยอมรับตอนปิดบิล — วันนี้ หรือวันที่เปิดบิล เท่านั้น (กันส่งวันอะไรก็ได้มา) */
export function allowedCloseDates(openedAt: string | null, now: Date, win?: SaleWindow | null): string[] {
  const today = businessDate(now, win);
  if (!openedAt) return [today];
  const c = crossDayChoice(openedAt, now, win);
  return c ? [c.nowDate, c.openDate] : [today];
}

/** เตือนล่วงหน้ากี่นาทีก่อนตัดรอบ */
export const CUTOFF_LEAD_MIN = 60;

export type OpenBillNotice = {
  /** บิลที่เปิดตั้งแต่วันขายก่อน — รับเงินตอนนี้จะถูกถามว่าลงวันไหน */
  stale: { saleNo: string; label: string; openDate: string }[];
  /** อีกไม่นานจะตัดรอบ และยังมีบิลเปิดอยู่ (ที่ยังเป็นของวันนี้) */
  soon: { minutesLeft: number; at: string; count: number } | null;
};

/** แถบเตือนบนหน้าขาย · ไม่มีอะไรต้องเตือน = null (ไม่ render อะไรเลย) */
export function openBillsNotice(
  sales: { saleNo: string; tabName: string | null; openedAt: string }[],
  now: Date,
  win?: SaleWindow | null,
  leadMin = CUTOFF_LEAD_MIN,
): OpenBillNotice | null {
  const stale: OpenBillNotice["stale"] = [];
  let current = 0;
  for (const s of sales) {
    const c = crossDayChoice(s.openedAt, now, win);
    if (c) stale.push({ saleNo: s.saleNo, label: s.tabName || s.saleNo, openDate: c.openDate });
    else current++;
  }
  const cut = cutoffInfo(now, win);
  const soon = current > 0 && cut.minutesLeft <= leadMin ? { ...cut, count: current } : null;
  return stale.length || soon ? { stale, soon } : null;
}

/* ── แก้บิลในประวัติ ─────────────────────────────────────────────────────── */

/** วิธีรับเงินที่เลือกได้ตอนแก้ — ป้ายเก่าของบิลนั้น (QR/โอนเงิน/บัตรเครดิต) คงไว้ได้ถ้าไม่เปลี่ยน */
export function editMethodOptions(current: string | null): string[] {
  const base: string[] = [...PAY_METHODS];
  return current && !base.includes(current) ? [current, ...base] : base;
}

/**
 * ปัญหาที่ทำให้แก้ไม่ได้ (ข้อความไทยพร้อมบอกว่าต้องไปกดอะไร) · null = แก้ได้
 * 🚨 ฝาแฝดของด่านใน `fn_bar_edit_sale` (0109) — เทสอ่าน SQL มาเทียบว่ายังมีครบ
 */
export function editSaleProblem(input: {
  status: string;
  oldDate: string | null;
  newDate: string;
  oldMethod: string | null;
  newMethod: string;
  today: string;
  posted: ReadonlySet<string>;
  /** จัดรูปวันที่ในข้อความ (หน้าจอส่ง `df.date` มา) · ไม่ส่ง = ISO */
  fmtDate?: (iso: string) => string;
}): string | null {
  const f = input.fmtDate ?? ((d: string) => d);
  if (input.status !== "ปกติ") return "แก้ได้เฉพาะบิลที่รับเงินแล้ว";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.newDate)) return "ต้องระบุวันขาย";
  if (input.newDate > input.today) return "วันขายเป็นวันในอนาคตไม่ได้";
  if (!input.newMethod.trim()) return "ต้องเลือกวิธีรับเงิน";
  if (input.oldDate && input.posted.has(input.oldDate))
    return `ยอดวันที่ ${f(input.oldDate)} ลงบัญชีไปแล้ว — ต้องถอนการลงบัญชีวันนั้นก่อน (แท็บแดชบอร์ด)`;
  if (input.newDate !== input.oldDate && input.posted.has(input.newDate))
    return `ยอดวันที่ ${f(input.newDate)} ลงบัญชีไปแล้ว — ย้ายบิลเข้าวันนั้นไม่ได้ ต้องถอนการลงบัญชีวันนั้นก่อน (แท็บแดชบอร์ด)`;
  return null;
}

/** มีอะไรเปลี่ยนไหม — ไม่เปลี่ยน = ปุ่มบันทึกเทา */
export function editSaleChanged(i: {
  oldDate: string | null;
  newDate: string;
  oldMethod: string | null;
  newMethod: string;
}): boolean {
  return i.newDate !== i.oldDate || i.newMethod.trim() !== (i.oldMethod ?? "");
}
