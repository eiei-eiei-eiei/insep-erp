/**
 * lib/bar/reminder — เตือนเข้า LINE ว่ามียอดบาร์ค้างยังไม่ได้ลงบัญชี (golden B13 · D96 เฟส E)
 *
 * ★ **เป็นการเพิ่มผู้เข้าร่วมรายที่สามในระบบเดิม ไม่ใช่สร้างระบบใหม่**
 *   cron ตัวเดิม (`/api/cron/tax-reminder`) · `sendLineToTenant()` เดิม · `CRON_SECRET` เดิม
 *   กันซ้ำด้วย `integration_log` เดิม ⇒ **ไม่ต้องแตะ `vercel.json`**
 *
 * ── 🚨 กติกาที่ยกมาจาก D88/D92 ทั้งดุ้น ────────────────────────────────────
 *   · **ไม่บอกยอดเงิน** — ข้อความ LINE เข้ากลุ่มได้ ยอดขายรายวันเป็นเรื่องภายใน
 *   · **ส่งก่อนแล้วค่อยจด** — จดก่อนแล้วส่งพลาด = เตือนหายตลอดกาล
 *   · **ไม่มีอะไรค้าง = เงียบ** ไม่ส่ง "ทุกอย่างเรียบร้อย" (สแปมทำให้คนเลิกอ่าน)
 *   · 🚨 **ต้องเรียกด้วยธงโมดูลของตัวเอง ห้ามเอาไปต่อท้ายลูปของงานเก่า**
 *     `taxPart()`/`excisePart()` มี `continue` หลายจุด — งานใหม่จะถูกข้ามเงียบ ๆ
 *     และ TypeScript มองไม่เห็นเลย (บทเรียน D92 ข้อที่เขียนเตือนไว้เองแล้วยังเกือบพลาดซ้ำ)
 */
import { thaiDay, type UnpostedDay } from "./posting";

/** 🚨 ต้องไม่ซ้ำกับงานอื่นใน `integration_log` — คนละงาน คนละคีย์ */
export const BAR_POST_REMINDER_ACTION = "BAR_POST_REMINDER";

/**
 * คีย์กันส่งซ้ำ — **วันละครั้งต่อลูกค้า**
 * ★ ผูกกับ *วันที่ยิง cron* ไม่ใช่จำนวนวันที่ค้าง เพราะยิง cron ซ้ำในวันเดียวกัน
 *   (retry / กดเอง) ต้องไม่ได้ข้อความซ้ำ
 */
export function barReminderKey(todayISO: string): string {
  return `bar-post|${todayISO}`;
}

export type BarReminderInput = {
  /** วันที่ค้าง เรียงเก่า→ใหม่ (มาจาก `unpostedDays()`) */
  days: readonly UnpostedDay[];
  /** ตั้ง "บัญชีที่รายได้บาร์เข้า" ไว้หรือยัง — ยังไม่ตั้ง = กดลงบัญชีไม่ได้เลย */
  hasRevenueAccount: boolean;
  /** ชื่อบาร์/กิจการ ไว้ขึ้นหัวเมื่อลูกค้ามีหลายกิจการ */
  entityName?: string | null;
};

/**
 * ข้อความ LINE — `null` = ไม่มีอะไรต้องส่ง
 *
 * 🚨 **ไม่มีตัวเลขเงินในข้อความเด็ดขาด** — บอกแค่ว่ากี่วันและวันไหน
 * 🚨 ยังไม่ได้ตั้งบัญชี = บอกให้ไป**ตั้งค่า** ไม่ใช่บอกให้ไป**กดลงบัญชี**
 *    (บอกให้กดปุ่มที่กดไม่ได้ = ผู้ใช้ไปยืนงงหน้าจอ · กติกา D92 "ไม่ทำอะไรให้ ต้องบอกว่าทำไม")
 */
export function barReminderMessage(input: BarReminderInput): string | null {
  const { days, hasRevenueAccount, entityName } = input;
  if (days.length === 0) return null;

  const names = days.slice(0, 5).map((d) => thaiDay(d.date));
  const more = days.length > 5 ? ` และอีก ${days.length - 5} วัน` : "";
  const who = entityName?.trim() ? ` (${entityName.trim()})` : "";

  const head = `🍸 ยอดขายบาร์${who} ยังไม่ได้ลงบัญชี ${days.length} วัน`;
  const list = `วันที่ค้าง: ${names.join(", ")}${more}`;
  const what = hasRevenueAccount
    ? "เปิดแอป → บาร์ → แดชบอร์ด → กด ลงบัญชีทั้งหมด"
    : "⚠️ ยังตั้ง “บัญชีที่รายได้บาร์เข้า” ไม่ครบ จึงยังกดลงบัญชีไม่ได้\nเปิดแอป → บาร์ → ตั้งค่าบาร์ → ตั้งบัญชีก่อน";

  return [head, list, what].join("\n");
}
