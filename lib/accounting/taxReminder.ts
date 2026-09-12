/**
 * lib/accounting/taxReminder — "วันนี้ต้องเตือนใครว่าต้องยื่นอะไร" (D88 · แก้ตัวจุดชนวน D95)
 *
 * 🎯 ทำไมต้องเตือนออกไปนอกแอป: ถ้าไม่ได้เปิดแอปเลย เช็กลิสต์ในหน้าจอช่วยอะไรไม่ได้ —
 *    เลยกำหนดยื่นแล้วค่อยรู้ = เบี้ยปรับ/เงินเพิ่มของจริง
 *
 * 🚨 **ไม่บอกยอดเงิน** — กลุ่ม LINE มีคนที่ไม่ควรเห็นตัวเลขภาษีของกิจการ
 *    บอกแค่ "ต้องยื่นอะไร ภายในวันไหน"
 *
 * ── สิ่งที่ D95 เปลี่ยน ──────────────────────────────────────────────────────
 * 1. **ตัวปิดเสียงเปลี่ยนจาก `report_runs` → `tax_filings`**
 *    🚨 `report_runs` คือ *กดพิมพ์แล้ว* ไม่ใช่ *ยื่นแล้ว* (ความผิดพลาดตัวเดียวกับ D90/D91)
 *       กดสร้าง ภพ.30 กลางเดือนเพื่อดูตัวเลข = การเตือนของงวดนั้นหายตลอดกาล
 * 2. **3 จังหวะแทน 1** (pre / due / late — ดู `lib/accounting/taxFiling`)
 *    พลาดวันเดียวไม่เท่ากับเงียบทั้งงวดอีกต่อไป
 * 3. **วันคิดจากวิธียื่นของกิจการ** (`entities.filing_method`) แทนการบอก 2 กำหนดเสมอ
 *
 * ── กติกาว่าใครได้รับ (ไม่เปลี่ยนจาก D88) ────────────────────────────────────
 * · ภพ.30  — เตือน **ทุกเดือนที่กิจการจด VAT** แม้เดือนนั้นไม่มียอดต้องชำระ
 *            (ผู้ประกอบการจดทะเบียนต้องยื่นทุกเดือน ยอดศูนย์ก็ต้องยื่น)
 * · ภงด.3/53 — เตือนเฉพาะเดือนที่ **มีการหักภาษี ณ ที่จ่ายจริง** (ไม่หัก = ไม่มีหน้าที่ยื่น)
 *            ★ ยื่นวันเดียวกัน จากปุ่มสร้างแบบเดียวกัน → **1 บรรทัด ไม่ใช่ 2**
 *
 * 🚨 ห้ามเติม ภงด.1 / สปส. — เป็นของโมดูลเงินเดือน (เหตุผลเต็มอยู่หัวไฟล์ taxPay.ts)
 *
 * ไม่มี I/O ในไฟล์นี้เลย → เทสได้ตรง ๆ · ตัว cron เป็นแค่คนหาข้อมูลมาป้อน
 */

import { prevMonth, type TaxKind } from "./taxPay";
import {
  filingLine,
  stageFootText,
  stageHeadText,
  stageOn,
  type FilingMethod,
  type FilingStage,
} from "./taxFiling";

/** รายการที่เตือนได้ — `id` ใช้เป็นส่วนหนึ่งของ idempotency key จึง **ห้ามเปลี่ยนค่า** */
export const REMINDER_ITEMS = [
  { id: "vat", kind: "vat" as TaxKind, label: "ภพ.30 — ภาษีมูลค่าเพิ่ม" },
  { id: "wht", kind: "pnd3" as TaxKind, label: "ภงด.3/53 — ภาษีหัก ณ ที่จ่าย" },
] as const;

export type ReminderId = (typeof REMINDER_ITEMS)[number]["id"];

export type TaxReminder = {
  id: ReminderId;
  period: string;
  stage: FilingStage;
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
  /**
   * ประกาศว่า "ยื่นแล้ว" ของงวดนั้นหรือยัง (`tax_filings`)
   * 🚨 **ไม่ใช่ `report_runs`** — การกดพิมพ์แบบไม่ใช่การยื่น (D95)
   */
  submitted: (kind: TaxKind, period: string) => boolean;
  /** วิธียื่นของกิจการ — null = ยังไม่ได้ตั้ง (ใช้กำหนดกระดาษ และบอกในข้อความ) */
  method: FilingMethod | null;
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

/**
 * key กันส่งซ้ำ
 *
 * 🚨 จังหวะ `pre` ต้องคง **รูปแบบเดิมของ D88 เป๊ะ** — ลูกค้ามีแถวที่จดไว้แล้วใน
 *    `integration_log` เปลี่ยนรูปแบบเมื่อไหร่ = งวดที่เคยเตือนไปแล้วถูกส่งซ้ำทั้งชุด
 *    จังหวะใหม่ (due/late) ต่อท้ายชื่อจังหวะ จึงไม่ชนของเดิม
 */
export function reminderKey(entityId: string, id: ReminderId, period: string, stage: FilingStage): string {
  const base = `${entityId}-${id}-${period}`;
  return stage === "pre" ? base : `${base}-${stage}`;
}

export function taxRemindersFor(inp: ReminderInput): TaxReminder[] {
  const lead = inp.leadDays ?? 3;
  const out: TaxReminder[] = [];

  for (const item of REMINDER_ITEMS) {
    for (const period of candidatePeriods(inp.todayISO)) {
      const stage = stageOn(inp.todayISO, item.kind, period, inp.method, lead);
      if (!stage) continue;
      if (item.id === "vat" && !inp.isVat) continue;
      if (item.id === "wht" && !inp.hasWht(period)) continue;
      // 🚨 ภงด.3 กับ ภงด.53 ยื่นคนละใบ แต่บรรทัดเดียวกัน → เงียบเมื่อ **ยื่นครบทั้งคู่**
      //    (ยื่นข้างเดียวแล้วเงียบ = อีกใบหายไปเงียบ ๆ ซึ่งคือสิ่งที่งานนี้ตั้งใจกัน)
      const done =
        item.id === "wht"
          ? inp.submitted("pnd3", period) && inp.submitted("pnd53", period)
          : inp.submitted(item.kind, period);
      if (done) continue;
      out.push({
        id: item.id,
        period,
        stage,
        key: reminderKey(inp.entityId, item.id, period, stage),
        line: filingLine(item.kind, period, inp.method, item.label),
      });
    }
  }
  return out;
}

/**
 * ข้อความที่ส่งเข้ากลุ่ม (รวมทุกกิจการของลูกค้ารายนั้นไว้ข้อความเดียว)
 *
 * ★ ใส่ชื่อกิจการนำหน้าเฉพาะตอนมีหลายกิจการ — กิจการเดียวแล้วใส่ = รกเปล่า ๆ
 * 🚨 **1 ข้อความต่อ 1 จังหวะ** — หัวข้อความ ("อีก 3 วัน" / "วันนี้วันสุดท้าย" /
 *    "เลยกำหนดแล้ว") ต้องตรงกับทุกบรรทัดในข้อความนั้น · รวมคนละจังหวะไว้ด้วยกัน
 *    = หัวข้อความโกหกบรรทัดใดบรรทัดหนึ่งเสมอ (ตระกูล D91/0059)
 */
export function reminderMessage(
  blocks: { entityName: string; lines: string[] }[],
  opts: { multiEntity: boolean; stage?: FilingStage; leadDays?: number },
): string {
  const stage = opts.stage ?? "pre";
  const head = stageHeadText(stage, opts.leadDays ?? 3);
  const body = blocks
    .filter((b) => b.lines.length > 0)
    .map((b) => (opts.multiEntity ? `[${b.entityName}]\n${b.lines.join("\n")}` : b.lines.join("\n")))
    .join("\n");
  return `${head}\n${body}\n\n${stageFootText(stage)}`;
}
