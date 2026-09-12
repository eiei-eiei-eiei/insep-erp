/**
 * lib/accounting/taxFiling — "ยื่นแล้วหรือยัง" และ "วันไหนต้องเตือน" (D95)
 *
 * ── ต้นเรื่อง ────────────────────────────────────────────────────────────────
 * D88 เอา `report_runs` (= **เช็กลิสต์ว่ากดพิมพ์แล้ว**) ไปตอบคำถาม *"ยื่นแล้วหรือยัง"*
 * ซึ่งเป็นความผิดพลาดตัวเดียวกับที่ D91 แก้ไปแล้วฝั่งสรรพสามิต แต่ยังค้างอยู่ฝั่งสรรพากร:
 *   · กดสร้าง ภพ.30 กลางเดือนเพื่อ**ดูตัวเลข** = การเตือนของงวดนั้นหายไปตลอดกาล
 *   · เดือนที่ยอดเป็นศูนย์ยัง**ต้องยื่น** แต่กดปุ่มจ่ายไม่ได้ (ไม่มียอด) → ผูกการเตือน
 *     กับ "จ่ายแล้ว" ไม่ได้เช่นกัน
 *
 * ★ ของใหม่: **"ยื่นแล้ว" เป็นเหตุการณ์ของตัวเอง** (ตาราง `tax_filings`) ที่ผู้ใช้ประกาศเอง
 *   และถอนได้ — แพตเทิร์นเดียวกับ `excise_month_close` ของ D91 ทั้งดุ้น
 *   · `report_runs` กลับไปเป็นเช็กลิสต์อย่างเดียว **ไม่ถูกแตะแม้บรรทัดเดียว**
 *     (ยังเป็นเงื่อนไข "ต้องสร้างแบบก่อนถึงจ่ายได้" ของ D88 เหมือนเดิม)
 *   · บันทึกจ่ายสำเร็จ → ติ๊ก "ยื่นแล้ว" ให้อัตโนมัติ (จ่ายได้แปลว่ายื่นแล้ว)
 *     🚨 **ไม่กลับกัน** — ติ๊กยื่นแล้วไม่ได้แปลว่าจ่ายแล้ว (เดือนยอดศูนย์ยื่นแต่ไม่ต้องจ่าย)
 *
 * ── วิธียื่นของกิจการ (`entities.filing_method`) ─────────────────────────────
 * ระบบไม่เคยรู้ว่ากิจการนี้ยื่นกระดาษหรือออนไลน์ จึงเคยบอกทั้ง 2 กำหนดในข้อความเดียว
 * → พอเพิ่มจังหวะเตือน "วันสุดท้าย" ขึ้นมา ต้องรู้ว่า *วันสุดท้ายของใคร*
 * 🚨 **ไม่ตั้ง = ใช้กำหนดกระดาษ (เร็วกว่า) แต่ต้องบอกบนข้อความว่ายังไม่ได้ตั้ง**
 *    หลักเดียวกับ "ไม่เลื่อนวันหยุดราชการให้" ของ D88 — เตือนเร็วไปดีกว่าเดาแล้วช้า
 *    และทุกครั้งที่ระบบเลือกแทนผู้ใช้ ต้องบอกว่าเลือกอะไรและเปลี่ยนได้ที่ไหน (D92)
 *
 * ไม่มี I/O ในไฟล์นี้เลย — ทั้งหน้าจอและ cron ตัดสินด้วยฟังก์ชันชุดนี้ชุดเดียว
 */

import { formatMonthThai } from "../shared/format";
import {
  DUE_STAGES,
  nextMonth,
  stageDatesFromDue,
  stageOnDate,
  thaiDay,
  type DueStage,
  type StageDate,
} from "../shared/period";

// ── ชนิดภาษีและกำหนดยื่น ──────────────────────────────────────────────────────
//
// ★ ย้ายมาจาก `taxPay.ts` ตอน D95 เพราะที่นั่น import ไฟล์นี้ไม่ได้ (จะวนกลับ) —
//   แพตเทิร์นเดียวกับที่ `nextMonth/prevMonth` ย้ายไป `lib/shared/period` ตอน D92
//   `taxPay.ts` re-export ของพวกนี้ต่อ → **ไฟล์ที่เรียกอยู่เดิมไม่ต้องแก้แม้บรรทัดเดียว**

export const TAX_KINDS = ["vat", "pnd3", "pnd53"] as const;
export type TaxKind = (typeof TAX_KINDS)[number];

/** ชื่อสั้นบนปุ่ม/ตาราง */
export const TAX_KIND_LABEL: Record<TaxKind, string> = {
  vat: "ภพ.30",
  pnd3: "ภงด.3",
  pnd53: "ภงด.53",
};

/** ชื่อเต็มในข้อความเตือน/คำอธิบายบิล */
export const TAX_KIND_FULL: Record<TaxKind, string> = {
  vat: "ภพ.30 — ภาษีมูลค่าเพิ่ม",
  pnd3: "ภงด.3 — หัก ณ ที่จ่าย (บุคคลธรรมดา)",
  pnd53: "ภงด.53 — หัก ณ ที่จ่าย (นิติบุคคล)",
};

/**
 * กำหนดยื่น = วันที่ N ของ **เดือนถัดจากงวด**
 * · ยื่นกระดาษ: ภพ.30 วันที่ 15 · ภงด.3/53 วันที่ 7
 * · ยื่นออนไลน์ (e-Filing): ขยายให้อีก 8 วัน → 23 และ 15 ตามลำดับ
 *
 * 🚨 **ไม่เลื่อนวันหยุดให้** — ระบบไม่มีปฏิทินวันหยุดราชการไทย และการ "เดา" ว่าเลื่อนไป
 *    วันทำการถัดไปแล้วเตือนช้าลง อันตรายกว่าการเตือนเร็วไป 1-2 วัน
 *    (กติกาเดียวกับ D78: ไม่รู้ ≠ เดาให้)
 */
export const TAX_DUE_DAY: Record<TaxKind, { paper: number; efiling: number }> = {
  vat: { paper: 15, efiling: 23 },
  pnd3: { paper: 7, efiling: 15 },
  pnd53: { paper: 7, efiling: 15 },
};

export type DueDates = { paper: string; efiling: string };

/** กำหนดยื่นของงวด `period` (yyyy-MM) — คืนเป็น ISO ทั้งคู่ */
export function dueDateOf(kind: TaxKind, period: string): DueDates {
  const nm = nextMonth(period);
  const day = TAX_DUE_DAY[kind];
  return {
    paper: `${nm}-${String(day.paper).padStart(2, "0")}`,
    efiling: `${nm}-${String(day.efiling).padStart(2, "0")}`,
  };
}

// ── วิธียื่นแบบ ───────────────────────────────────────────────────────────────

export const FILING_METHODS = ["paper", "efiling"] as const;
export type FilingMethod = (typeof FILING_METHODS)[number];

export const FILING_METHOD_LABEL: Record<FilingMethod, string> = {
  paper: "ยื่นกระดาษ (สรรพากรพื้นที่)",
  efiling: "ยื่นออนไลน์ (e-Filing)",
};

/** ไม่ได้ตั้ง = ใช้กำหนดของกระดาษ ซึ่งมาก่อนเสมอ (เตือนเร็วไปดีกว่าเตือนช้า) */
export const DEFAULT_FILING_METHOD: FilingMethod = "paper";

/**
 * แปลงค่าที่อ่านจาก DB → วิธียื่น · **คืน null เมื่อยังไม่ได้ตั้ง**
 * 🚨 ห้ามให้ชั้นข้อมูลเติมค่าปริยายเงียบ ๆ — หน้าจอกับข้อความเตือนต้องรู้ว่า
 *    "ยังไม่ได้ตั้ง" เพื่อบอกผู้ใช้ (ค่าปริยายที่มองไม่เห็น = กับดัก D80)
 */
export function toFilingMethod(v: unknown): FilingMethod | null {
  const s = String(v ?? "").trim();
  return (FILING_METHODS as readonly string[]).includes(s) ? (s as FilingMethod) : null;
}

/** วิธีที่ *มีผลจริง* ตอนคิดวัน (null → ค่าปริยาย) */
export function effectiveMethod(m: FilingMethod | null): FilingMethod {
  return m ?? DEFAULT_FILING_METHOD;
}

/**
 * วันสุดท้ายจริงของกิจการนี้สำหรับแบบนี้
 * · paper   → กำหนดยื่นกระดาษ (ภพ.30 วันที่ 15 · ภงด. วันที่ 7)
 * · efiling → กำหนด e-Filing  (ภพ.30 วันที่ 23 · ภงด. วันที่ 15)
 */
export function finalDueDate(kind: TaxKind, period: string, m: FilingMethod | null): string {
  const due = dueDateOf(kind, period);
  return effectiveMethod(m) === "efiling" ? due.efiling : due.paper;
}

// ── จังหวะเตือน ───────────────────────────────────────────────────────────────

/**
 * 3 จังหวะที่ผู้ใช้เลือกไว้ (D95) — แต่ละจังหวะมีความหมายต่างกันจริง:
 * · pre  ล่วงหน้า N วัน   — "เตรียมตัว" ยังมีเวลาไปทำเอกสาร
 * · due  วันสุดท้ายของคุณ — "วันนี้วันสุดท้าย"
 * · late วันถัดมา **ครั้งเดียว ไม่วนซ้ำ** — "เลยกำหนดแล้ว ยิ่งช้ายิ่งเบี้ยปรับ"
 *
 * 🚨 ของเดิมมีจังหวะเดียวแล้วจดลง `integration_log` → **พลาดวันนั้น = งวดนั้นเงียบตลอดกาล**
 * 🚨 เจตนาที่ไม่ทำ: เตือนวนซ้ำทุกสัปดาห์หลังเลยกำหนด — เตือนบ่อยจนคนเลิกอ่าน
 *    อันตรายกว่าไม่เตือน (ข้อความที่ถูกปัดทิ้งเป็นนิสัย จะพาข้อความสำคัญไปด้วย)
 */
export const FILING_STAGES = DUE_STAGES;
export type FilingStage = DueStage;

/** วันของแต่ละจังหวะ (ISO) — เรียงตามเวลา · กติกาการตัดวันซ้ำอยู่ที่ `stageDatesFromDue` */
export function stageDates(
  kind: TaxKind,
  period: string,
  m: FilingMethod | null,
  leadDays = 3,
): StageDate[] {
  return stageDatesFromDue(finalDueDate(kind, period, m), leadDays);
}

/** จังหวะของวันนี้สำหรับแบบ+งวดนี้ (null = วันนี้ไม่ต้องเตือนอะไร) */
export function stageOn(
  todayISO: string,
  kind: TaxKind,
  period: string,
  m: FilingMethod | null,
  leadDays = 3,
): FilingStage | null {
  return stageOnDate(todayISO, finalDueDate(kind, period, m), leadDays);
}

// ── ข้อความ ──────────────────────────────────────────────────────────────────

/** หัวข้อความต่อจังหวะ — จำนวนวันคิดจาก `leadDays` **ห้ามฮาร์ดโค้ด** (กติกา D92) */
export function stageHeadText(stage: FilingStage, leadDays = 3): string {
  if (stage === "pre") return `⏰ เตือนกำหนดยื่นภาษี (อีก ${leadDays} วัน)`;
  if (stage === "due") return "⏰ วันนี้วันสุดท้ายของกำหนดยื่นภาษี";
  return "🔴 เลยกำหนดยื่นภาษีแล้ว";
}

/** ท้ายข้อความ — ต้องบอกเสมอว่า **ต้องไปกดอะไร** ถึงจะหยุดเตือน (D83/D88) */
export function stageFootText(stage: FilingStage): string {
  const how = 'ยื่นแล้วกดปุ่ม "ยื่นแล้ว" ในแอป (บัญชี → เอกสารสรรพากร) เพื่อปิดการเตือนของงวดนี้';
  return stage === "late"
    ? `ยิ่งยื่นช้า เบี้ยปรับ/เงินเพิ่มยิ่งเพิ่มตามจำนวนวัน · ${how}`
    : how;
}

/**
 * บรรทัดเตือนหนึ่งรายการ
 *
 * 🚨 **ไม่บอกยอดเงิน** (กติกา D88 — กลุ่ม LINE มีคนที่ไม่ควรเห็นตัวเลขของกิจการ)
 * ★ ตั้งวิธียื่นแล้ว = บอก **วันเดียว** ตามวิธีนั้น (เลิกบอก 2 กำหนดทุกเดือน ซึ่งมีอันหนึ่ง
 *   ที่ไม่เกี่ยวกับกิจการนี้เลยเสมอ) · ยังไม่ตั้ง = บอกว่าใช้กำหนดกระดาษให้ก่อน
 *   พร้อมวันของออนไลน์ และบอกว่าตั้งได้ที่ไหน
 */
export function filingLine(
  kind: TaxKind,
  period: string,
  m: FilingMethod | null,
  label?: string,
): string {
  const head = `• ${label ?? TAX_KIND_FULL[kind]} งวด ${formatMonthThai(period)}`;
  const due = dueDateOf(kind, period);
  if (m) {
    return `${head} — ยื่นภายใน ${thaiDay(finalDueDate(kind, period, m))} (${FILING_METHOD_LABEL[m]})`;
  }
  return (
    `${head} — ยื่นภายใน ${thaiDay(due.paper)} (ยังไม่ได้ตั้งวิธียื่น ระบบใช้กำหนดของกระดาษ · ` +
    `ถ้ายื่นออนไลน์มีถึง ${thaiDay(due.efiling)} — ตั้งได้ที่ ตั้งค่า → กิจการ)`
  );
}

// ── สถานะ "ยื่นแล้ว" ของงวด ──────────────────────────────────────────────────

/** ที่มาของการติ๊กยื่น — `pay` = ระบบติ๊กให้ตอนบันทึกจ่าย (จ่ายได้แปลว่ายื่นแล้ว) */
export type FilingSource = "manual" | "pay";

export type TaxFilingRow = {
  id: number;
  kind: string;
  period: string;
  filedAt: string;
  filedOn: string | null;
  source: string;
  note: string | null;
  reopenedAt: string | null;
};

export type FilingState = {
  /** ยื่นแล้วตอนนี้ไหม = มีแถวที่ยังไม่ถูกถอน */
  submitted: boolean;
  active: TaxFilingRow | null;
  /** เคยติ๊กแล้วถอนกี่รอบ — ใช้บอกผู้ใช้ว่างวดนี้ถูกแก้มาก่อน */
  reopenedTimes: number;
};

export function filingStateOf(
  rows: readonly TaxFilingRow[],
  kind: TaxKind,
  period: string,
): FilingState {
  const mine = rows.filter((r) => r.kind === kind && r.period === period);
  const active = mine.find((r) => !r.reopenedAt) ?? null;
  return { submitted: active !== null, active, reopenedTimes: mine.filter((r) => r.reopenedAt).length };
}

/**
 * ป้ายสถานะการยื่น — ★ ตัดสินที่นี่ที่เดียว ห้ามเขียน ternary ในคอมโพเนนต์ (บทเรียน D84/D88)
 * 🚨 ป้ายนี้ตอบคำถาม "ยื่นแล้วหรือยัง" อย่างเดียว — "จ่ายแล้วหรือยัง" เป็นป้ายคนละตัว
 */
export function filingBadge(submitted: boolean): { text: string; tone: "ok" | "warn" } {
  return submitted ? { text: "ยื่นแล้ว", tone: "ok" } : { text: "ยังไม่ได้ยื่น", tone: "warn" };
}

/**
 * เตือนก่อนกด "ยื่นแล้ว" ทั้งที่ยังไม่ได้กดสร้างแบบในแอป
 *
 * 🚨 **เตือน ไม่บล็อก** — ผู้ใช้จำนวนมากกรอกในเว็บ e-Filing ของสรรพากรเอง (D69)
 *    ระบบไม่มีสิทธิ์บอกว่า "คุณยังไม่ได้ยื่น" เพียงเพราะไม่ได้กดพิมพ์ในแอป
 */
export function fileWithoutFormWarn(formCreated: boolean): string | null {
  if (formCreated) return null;
  return "ยังไม่ได้กดสร้างแบบของงวดนี้ในแอป — บันทึกว่ายื่นแล้วได้ (ถ้ายื่นผ่านเว็บสรรพากรเอง) แต่ระบบจะไม่มีสำเนาแบบไว้ย้อนดู";
}

/**
 * คำอธิบายใต้ปุ่ม "ยื่นแล้ว" — บอกว่าการกดหมายถึงอะไร และผลคืออะไร
 * 🚨 ปุ่มนี้ **ไม่ใช่การจ่ายเงิน** และไม่แตะตัวเลขใด ๆ บนแบบ — ต้องพูดให้ชัด
 */
export function filingHintText(
  st: { submitted: boolean; bySystem?: boolean },
  stagesDesc: string,
): string {
  if (st.submitted) {
    const src = st.bySystem ? " (ระบบติ๊กให้ตอนบันทึกจ่าย)" : "";
    return `บันทึกว่ายื่นแล้ว${src} — ระบบจะไม่เตือนงวดนี้เข้ากลุ่ม LINE อีก`;
  }
  return `ยังไม่ได้บันทึกว่ายื่น — ถ้ายังไม่กด ระบบจะเตือนเข้ากลุ่ม LINE วันที่ ${stagesDesc}`;
}

/** "12 ก.ย. · 15 ก.ย. · 16 ก.ย." — ใช้ในคำอธิบายบนจอ (เห็นล่วงหน้าว่าจะโดนเตือนวันไหน) */
export function stagesDescText(
  kind: TaxKind,
  period: string,
  m: FilingMethod | null,
  leadDays = 3,
): string {
  return stageDates(kind, period, m, leadDays)
    .map((s) => thaiDay(s.date))
    .join(" · ");
}
