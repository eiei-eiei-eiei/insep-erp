/**
 * lib/production/exciseReminder — "วันนี้ต้องเตือนใครว่ายังไม่ได้ปิดงบเดือนสรรพสามิต" (D92)
 *
 * 🎯 ทำไมต้องเตือนออกไปนอกแอป: D91 ทำปุ่ม **ปิดเดือน** ไว้แล้ว แต่เช็กลิสต์กับปุ่มช่วยได้
 *    เฉพาะตอนที่เปิดแอป — ไม่ได้เข้าเลยทั้งเดือนก็เลยกำหนดยื่นแล้วค่อยรู้
 *    → ยิงเข้ากลุ่ม LINE เดียวกับที่ D88 ใช้ ล่วงหน้า 3 วัน **ครั้งเดียวต่องวดต่อกิจการ**
 *
 * ── กติกาว่าใครได้รับ ────────────────────────────────────────────────────────
 * · เตือนเฉพาะกิจการที่กรอก `entities.excise_id` — คอลัมน์นี้เขียนกำกับไว้ใน schema
 *   ตั้งแต่ 0001 ว่า *"เฉพาะโรงสุรา"* → เป็นธง "กิจการนี้ต้องยื่นงบเดือน" ที่ตรงที่สุด
 *   ★ หลักเดียวกับ ภพ.30 ที่เตือน **ทุกเดือนที่จด VAT แม้ไม่มียอด** (โรงสุราต้องยื่นทุกเดือน)
 * · ปิดเดือนไปแล้ว (`excise_month_close` ที่ยัง active) = จัดการแล้ว → ไม่เตือน
 * · 🚨 **ถอนปิดแล้ว = ยังไม่ปิด → กลับมาเตือน** (งานยังค้างอยู่จริง)
 *
 * 🚨 **ไม่บอกยอดอะไรทั้งสิ้น** — กลุ่ม LINE มีคนที่ไม่ควรเห็นตัวเลขของกิจการ (กติกา D88)
 * 🚨 **บอกวันเดียว** ไม่มีวันยื่นออนไลน์เหมือน ภพ.30 — เพราะไม่รู้ **และไม่เดา**
 * 🚨 **ไม่เลื่อนวันหยุดราชการให้** (ไม่มีปฏิทิน · เตือนเร็วไปดีกว่าเดาแล้วช้า)
 *
 * ไม่มี I/O ในไฟล์นี้เลย → เทสได้ตรง ๆ · ตัว cron เป็นแค่คนหาข้อมูลมาป้อน
 */

import { formatMonthThai } from "../shared/format";
import { nextMonth, prevMonth, shiftDaysISO, thaiDay } from "../shared/period";

/** งบเดือน ภส.๐๗-๐๔ ยื่นภายในวันที่ 15 ของเดือนถัดจากงวด */
export const EXCISE_DUE_DAY = 15;

/** action ใน `integration_log` — 🚨 คนละตัวกับ `TAX_REMINDER` ของ D88 (คนละกรม คนละงาน) */
export const EXCISE_REMINDER_ACTION = "EXCISE_REMINDER";

export type ExciseReminder = {
  period: string;
  /** key กันส่งซ้ำ (ต่อกิจการ) — เก็บใน integration_log · 🚨 **ห้ามเปลี่ยนรูปแบบ** */
  key: string;
  line: string;
};

export type ExciseReminderInput = {
  /** วันนี้ตามเวลาไทย (yyyy-MM-dd) */
  todayISO: string;
  entityId: string;
  /** กิจการนี้กรอกเลขสรรพสามิตไว้ไหม (= เป็นโรงสุราที่ต้องยื่น) */
  hasExciseId: boolean;
  /** งวดนั้นปิดบัญชีสรรพสามิตไปแล้วหรือยัง */
  closed: (period: string) => boolean;
  leadDays?: number;
};

/** กำหนดยื่นงบเดือนของงวดนี้ (ISO) */
export function exciseDueDate(period: string): string {
  return `${nextMonth(period)}-${String(EXCISE_DUE_DAY).padStart(2, "0")}`;
}

/** วันที่ต้องเตือนสำหรับงวดนี้ */
export function exciseRemindDate(period: string, leadDays = 3): string {
  return shiftDaysISO(exciseDueDate(period), -leadDays);
}

export function exciseReminderLine(period: string): string {
  return `• งบเดือน (ภส.๐๗-๐๔) งวด ${formatMonthThai(period)} — ยื่นภายใน ${thaiDay(exciseDueDate(period))}`;
}

/**
 * งวดที่อาจถึงคิวเตือนวันนี้
 * 🪤 ต้องเผื่อย้อนหลัง — กำหนดยื่นอยู่ "เดือนถัดจากงวด" แต่ถ้าตั้ง `leadDays` มากกว่า ~14 วัน
 *    วันเตือนจะถอยข้ามเดือนกลับไปอยู่ในเดือนของงวดเอง (แพตเทิร์นเดียวกับ taxReminder ของ D88)
 */
function candidatePeriods(todayISO: string): string[] {
  const m = todayISO.slice(0, 7);
  return [m, prevMonth(m), prevMonth(prevMonth(m))];
}

export function exciseRemindersFor(inp: ExciseReminderInput): ExciseReminder[] {
  if (!inp.hasExciseId) return [];
  const lead = inp.leadDays ?? 3;
  const out: ExciseReminder[] = [];

  for (const period of candidatePeriods(inp.todayISO)) {
    if (exciseRemindDate(period, lead) !== inp.todayISO) continue;
    if (inp.closed(period)) continue;
    out.push({
      period,
      key: `${inp.entityId}-excise-${period}`,
      line: exciseReminderLine(period),
    });
  }
  return out;
}

/**
 * ข้อความที่ส่งเข้ากลุ่ม (รวมทุกกิจการของลูกค้ารายนั้นไว้ข้อความเดียว)
 *
 * ★ ใส่ชื่อกิจการนำหน้าเฉพาะตอนมีหลายกิจการ — กิจการเดียวแล้วใส่ = รกเปล่า ๆ (แบบเดียวกับ D88)
 * ★ จำนวนวันในหัวข้อความคิดจาก `leadDays` **ห้ามฮาร์ดโค้ด** — เปลี่ยนค่าแล้วหัวข้อความต้องขยับตาม
 */
export function exciseReminderMessage(
  blocks: { entityName: string; lines: string[] }[],
  opts: { multiEntity: boolean; leadDays?: number },
): string {
  const head = `⏰ เตือนกำหนดยื่นงบเดือนสรรพสามิต (อีก ${opts.leadDays ?? 3} วัน)`;
  const body = blocks
    .filter((b) => b.lines.length > 0)
    .map((b) => (opts.multiEntity ? `[${b.entityName}]\n${b.lines.join("\n")}` : b.lines.join("\n")))
    .join("\n");
  return `${head}\n${body}\n\nยื่นแล้วกด "ปิดเดือน" ในแอป (ผลิต → รายงานสรรพสามิต) เพื่อปิดการเตือน`;
}

/**
 * บรรทัดบนการ์ดปิดเดือนในแอป — บอกให้รู้ว่ามีการเตือนอยู่ และรู้เมื่อการเตือนถูกปิด
 *
 * 🚨 ไม่กรอกเลขสรรพสามิต = **ไม่มีการเตือนเลย** ซึ่งเป็นความเงียบที่ผู้ใช้ไม่มีทางรู้เอง
 *    → ต้องบอกบนจอ (ทุกครั้งที่ระบบไม่ทำอะไรให้ ต้องบอกว่าทำไม)
 */
export function reminderHintText(o: {
  hasExciseId: boolean;
  closed: boolean;
  period: string;
  leadDays?: number;
}): { text: string; warn: boolean } | null {
  if (!o.hasExciseId) {
    return {
      text: "ยังไม่ได้กรอกเลขสรรพสามิตของกิจการนี้ — ระบบจะไม่เตือนกำหนดยื่นงบเดือนเข้ากลุ่ม LINE (กรอกที่ ตั้งค่า → กิจการ)",
      warn: true,
    };
  }
  if (o.closed) return null; // ปิดแล้วไม่มีอะไรต้องเตือน
  return {
    text: `ถ้ายังไม่ปิดเดือน ระบบจะเตือนเข้ากลุ่ม LINE วันที่ ${thaiDay(exciseRemindDate(o.period, o.leadDays ?? 3))} (ครบกำหนดยื่น ${thaiDay(exciseDueDate(o.period))})`,
    warn: false,
  };
}
