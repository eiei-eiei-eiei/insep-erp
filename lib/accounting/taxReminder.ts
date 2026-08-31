/**
 * lib/accounting/taxReminder — "วันนี้ต้องเตือนใครว่าต้องยื่นอะไร" (D88)
 *
 * 🎯 ทำไมต้องเตือนออกไปนอกแอป: ถ้าไม่ได้เปิดแอปเลย เช็กลิสต์ในหน้าจอช่วยอะไรไม่ได้ —
 *    เลยกำหนดยื่นแล้วค่อยรู้ = เบี้ยปรับ/เงินเพิ่มของจริง
 *    → ยิงเข้ากลุ่ม LINE เดียวกับที่แอปขายใช้ ล่วงหน้า 3 วัน **ครั้งเดียวต่อแบบต่องวด**
 *
 * 🚨 **ไม่บอกยอดเงิน** — กลุ่ม LINE มีคนที่ไม่ควรเห็นตัวเลขภาษีของกิจการ
 *    บอกแค่ "ต้องยื่นอะไร ภายในวันไหน" (ผู้ใช้กำหนดไว้ตอนสั่งงาน)
 *
 * ── กติกาว่าใครได้รับ ────────────────────────────────────────────────────────
 * · ภพ.30  — เตือน **ทุกเดือนที่กิจการจด VAT** แม้เดือนนั้นไม่มียอดต้องชำระ
 *            (ผู้ประกอบการจดทะเบียนต้องยื่นทุกเดือน ยอดศูนย์ก็ต้องยื่น)
 * · ภงด.3/53 — เตือนเฉพาะเดือนที่ **มีการหักภาษี ณ ที่จ่ายจริง** (ไม่หัก = ไม่มีหน้าที่ยื่น)
 *            ★ ยื่นวันเดียวกัน จากปุ่มสร้างแบบเดียวกัน → **1 บรรทัด ไม่ใช่ 2**
 * · สร้างแบบของงวดนั้นไปแล้ว (`report_runs`) = ถือว่าจัดการแล้ว → ไม่เตือน
 *
 * 🚨 ห้ามเติม ภงด.1 / สปส. — เป็นของโมดูลเงินเดือน (เหตุผลเต็มอยู่หัวไฟล์ taxPay.ts)
 *
 * ไม่มี I/O ในไฟล์นี้เลย → เทสได้ตรง ๆ · ตัว cron เป็นแค่คนหาข้อมูลมาป้อน
 */

import { TAX_REPORT_KEY, prevMonth, reminderLine, remindDateOf, type TaxKind } from "./taxPay";

/** รายการที่เตือนได้ — `id` ใช้เป็นส่วนหนึ่งของ idempotency key จึง **ห้ามเปลี่ยนค่า** */
export const REMINDER_ITEMS = [
  { id: "vat", kind: "vat" as TaxKind, label: "ภพ.30 — ภาษีมูลค่าเพิ่ม" },
  { id: "wht", kind: "pnd3" as TaxKind, label: "ภงด.3/53 — ภาษีหัก ณ ที่จ่าย" },
] as const;

export type ReminderId = (typeof REMINDER_ITEMS)[number]["id"];

export type TaxReminder = {
  id: ReminderId;
  period: string;
  /** key กันส่งซ้ำ (ต่อกิจการ) — เก็บใน integration_log */
  key: string;
  line: string;
};

export type ReminderInput = {
  /** วันนี้ตามเวลาไทย (yyyy-MM-dd) */
  todayISO: string;
  entityId: string;
  isVat: boolean;
  /** งวดนั้นมีการหักภาษี ณ ที่จ่ายไหม */
  hasWht: (period: string) => boolean;
  /** สร้างแบบของงวดนั้นไปแล้วหรือยัง */
  filed: (reportKey: string, period: string) => boolean;
  leadDays?: number;
};

/**
 * งวดที่อาจถึงคิวเตือนวันนี้
 * 🪤 ต้องเผื่อ 2 งวด — กำหนดยื่นอยู่ "เดือนถัดจากงวด" แต่ถ้าตั้ง leadDays มากกว่า ~4 วัน
 *    วันเตือนของแบบที่ครบกำหนดวันที่ 7 จะถอยข้ามเดือนกลับไปอยู่ในเดือนของงวดเอง
 */
function candidatePeriods(todayISO: string): string[] {
  const m = todayISO.slice(0, 7);
  return [m, prevMonth(m), prevMonth(prevMonth(m))];
}

export function taxRemindersFor(inp: ReminderInput): TaxReminder[] {
  const lead = inp.leadDays ?? 3;
  const out: TaxReminder[] = [];

  for (const item of REMINDER_ITEMS) {
    for (const period of candidatePeriods(inp.todayISO)) {
      if (remindDateOf(item.kind, period, lead) !== inp.todayISO) continue;
      if (item.id === "vat" && !inp.isVat) continue;
      if (item.id === "wht" && !inp.hasWht(period)) continue;
      if (inp.filed(TAX_REPORT_KEY[item.kind], period)) continue;
      out.push({
        id: item.id,
        period,
        key: `${inp.entityId}-${item.id}-${period}`,
        line: reminderLine(item.kind, period, item.label),
      });
    }
  }
  return out;
}

/**
 * ข้อความที่ส่งเข้ากลุ่ม (รวมทุกกิจการของลูกค้ารายนั้นไว้ข้อความเดียว)
 * ★ ใส่ชื่อกิจการนำหน้าเฉพาะตอนมีหลายกิจการ — กิจการเดียวแล้วใส่ = รกเปล่า ๆ
 */
export function reminderMessage(
  blocks: { entityName: string; lines: string[] }[],
  opts: { multiEntity: boolean },
): string {
  const head = "⏰ เตือนกำหนดยื่นภาษี (อีก 3 วัน)";
  const body = blocks
    .filter((b) => b.lines.length > 0)
    .map((b) => (opts.multiEntity ? `[${b.entityName}]\n${b.lines.join("\n")}` : b.lines.join("\n")))
    .join("\n");
  return `${head}\n${body}\n\nยื่นแล้วกดสร้างแบบในแอป (บัญชี → เอกสารสรรพากร) เพื่อปิดเช็กลิสต์`;
}
