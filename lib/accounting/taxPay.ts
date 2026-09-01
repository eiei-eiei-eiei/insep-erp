/**
 * lib/accounting/taxPay — "เดือนนี้ต้องยื่น/จ่ายภาษีอะไรบ้าง" (S/A — D88)
 *
 * ── ขอบเขต ───────────────────────────────────────────────────────────────────
 * มีแค่ **3 แบบ** ที่หน้าบัญชีเป็นเจ้าของ: ภพ.30 · ภงด.3 · ภงด.53
 *
 * 🚨 **ห้ามเพิ่ม ภงด.1 / สปส.1-10 เข้ามาในนี้เด็ดขาด** — โมดูลเงินเดือนบันทึกการจ่าย
 *    2 ตัวนั้นอยู่แล้วผ่าน "ขาลงบัญชี" (`pay_post_legs` → `fn_post_payroll`, D67)
 *    เติมปุ่มจ่ายที่หน้าบัญชีอีก = **ลงรายจ่ายซ้ำ และไม่มีอะไรใน DB ฟ้อง**
 *    (กลไกเดียวกับที่ `legCoverage()` ของ D67 ถูกสร้างมาเตือน)
 *
 * ── ทำไมไฟล์นี้ไม่มี I/O เลย ─────────────────────────────────────────────────
 * ทั้งหน้าจอ (แท็บเอกสารสรรพากร) และ **cron ที่ยิงเตือนเข้า LINE** ตัดสินด้วยฟังก์ชัน
 * ชุดเดียวกันนี้ — ถ้าแยกกันคิด วันหนึ่งบนจอจะบอกว่า "ครบกำหนด 15" แต่ LINE เตือนวันที่ 12
 * ของอีกงวด แล้วไม่มีใครรู้ว่าอันไหนถูก (บทเรียน D75: ของที่ป้อนเข้าสูตรก็ต้องประกอบที่เดียว)
 *
 * golden test = taxPay.test.ts
 */

import { formatMonthThai } from "../shared/format";
import { nextMonth, shiftDaysISO, thaiDay } from "../shared/period";

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
 * ปุ่มสร้างแบบในแท็บเดียวกันเขียน `report_runs` ด้วย key พวกนี้
 * 🪤 ภงด.3 กับ ภงด.53 **สร้างจากปุ่มเดียวกัน** จึงใช้ key ร่วมกัน — ต่างกันแค่ตอนยื่น/จ่าย
 */
export const TAX_REPORT_KEY: Record<TaxKind, string> = {
  vat: "phor_por_30",
  pnd3: "pnd_3_53",
  pnd53: "pnd_3_53",
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

/** หมวดรายจ่ายที่เติมให้ในป๊อปอัพครั้งแรก (ครั้งต่อไปใช้ค่าที่เคยเลือก) */
export const DEFAULT_TAX_CAT: Record<TaxKind, string> = {
  vat: "ภาษีมูลค่าเพิ่มนำส่ง",
  pnd3: "ภาษีหัก ณ ที่จ่ายนำส่ง",
  pnd53: "ภาษีหัก ณ ที่จ่ายนำส่ง",
};

/**
 * 🚨 เบี้ยปรับ/เงินเพิ่ม **ต้องแยกหมวดจากตัวภาษี** — เป็นรายจ่ายต้องห้าม
 *    ที่ต้องบวกกลับตอนคำนวณภาษีเงินได้นิติบุคคลสิ้นปี
 *    รวมหมวดเดียวกับภาษีเมื่อไหร่ ผู้ทำบัญชีแยกออกมาไม่ได้อีกเลย
 */
export const DEFAULT_SURCHARGE_CAT = "เบี้ยปรับ/เงินเพิ่มภาษี";
export const DEFAULT_TAX_PAYEE = "กรมสรรพากร";

/**
 * ★ ย้ายไป `lib/shared/period.ts` แล้ว (D92 — ฝั่งผลิตต้องใช้ชุดเดียวกัน
 *   และห้ามให้ lib/production import lib/accounting) · re-export ไว้ให้ผู้เรียกเดิมไม่ต้องแก้
 */
export { nextMonth, prevMonth } from "../shared/period";

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

/** ต่างกันกี่วัน (b − a) — คิดจากสตริง ISO ล้วน ไม่แตะ timezone ของเครื่อง */
export function daysBetween(aISO: string, bISO: string): number {
  const a = Date.UTC(+aISO.slice(0, 4), +aISO.slice(5, 7) - 1, +aISO.slice(8, 10));
  const b = Date.UTC(+bISO.slice(0, 4), +bISO.slice(5, 7) - 1, +bISO.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/** วันที่ต้องยิงเตือน = กำหนดยื่น (กระดาษ) ลบ leadDays */
export function remindDateOf(kind: TaxKind, period: string, leadDays = 3): string {
  return shiftDaysISO(dueDateOf(kind, period).paper, -leadDays);
}

/**
 * ข้อความเตือนหนึ่งบรรทัด
 * 🚨 **ไม่บอกยอดเงิน** (ผู้ใช้สั่งไว้) — กลุ่ม LINE มีคนนอกฝ่ายบัญชีอยู่ด้วย
 * ★ บอกกำหนดทั้ง 2 แบบเสมอ เพราะระบบไม่รู้ว่ากิจการนี้ยื่นกระดาษหรือออนไลน์
 *   (เขียนข้างเดียวแล้วผิด = คำโกหกบนจอ ตระกูล D85)
 */
export function reminderLine(kind: TaxKind, period: string, label?: string): string {
  const due = dueDateOf(kind, period);
  return `• ${label ?? TAX_KIND_FULL[kind]} งวด ${formatMonthThai(period)} — ยื่นภายใน ${thaiDay(due.paper)} (ยื่นออนไลน์ถึง ${thaiDay(due.efiling)})`;
}

/** "15 ก.ย." จาก ISO — ใช้ในข้อความเตือนเท่านั้น */


/** คำอธิบายที่ไปอยู่บนบิลบัญชี */
export function taxTxDescription(kind: TaxKind, period: string): string {
  return `${TAX_KIND_LABEL[kind]} งวด ${formatMonthThai(period)}`;
}
export function surchargeTxDescription(kind: TaxKind, period: string): string {
  return `${TAX_KIND_LABEL[kind]} งวด ${formatMonthThai(period)} — เบี้ยปรับ/เงินเพิ่ม`;
}

// ── กระดานสถานะ "ยื่นแล้วยัง จ่ายแล้วยัง" ────────────────────────────────────

/** แถวใน `tax_payments` เท่าที่หน้าจอต้องรู้ */
export type TaxPaymentRow = {
  kind: string;
  period: string;
  amount: number;
  surcharge: number;
  computed_amount: number | null;
  pay_date: string;
  tx_id: string | null;
  surcharge_tx_id: string | null;
  account_name: string | null;
  category: string | null;
  contact_name: string | null;
  status: string;
  /** สถานะจริงของบิลใน `transactions` (null = หาไม่เจอ) — ดูหมายเหตุที่ `billVoided` */
  tx_status?: string | null;
};

export type TaxDueRow = {
  kind: TaxKind;
  label: string;
  period: string;
  due: DueDates;
  /** ยอดที่ระบบเสนอให้จ่าย */
  amount: number;
  /** ยอดที่คำนวณสด ณ ตอนนี้ (ภพ.30 = จากบิลปัจจุบัน · ใช้เทียบกับยอดที่แช่ไว้) */
  liveAmount: number;
  /** ยอดที่แช่ไว้ตอนกดสร้างแบบต่างจากยอดสด → ต้องโชว์ทั้งคู่ ห้ามเลือกข้างให้ (D75) */
  drifted: boolean;
  /** กดสร้างแบบของเดือนนี้แล้วหรือยัง (report_runs) */
  filed: boolean;
  payment: TaxPaymentRow | null;
  /**
   * บิลของการจ่ายถูกยกเลิกจากหน้าค้นบิลไปแล้ว แต่แถว `tax_payments` ยังเป็น 'ปกติ'
   * 🚨 เลือกทาง "แสดงความจริง" ไม่ใช่ซ่อนหรือแก้ให้เอง — ผู้ใช้จะได้เห็นว่าเกิดอะไรขึ้น
   *    แล้วตัดสินใจเองว่าจะกดจ่ายใหม่หรือไม่
   */
  billVoided: boolean;
  /**
   * ป้ายสถานะที่หน้าจอต้องแสดง — ตัดสินใน lib ที่มีเทสคุม ไม่ใช่เขียนเงื่อนไขซ้ำใน component
   * · paid    จ่ายแล้ว
   * · voided  บิลถูกยกเลิกจากหน้าอื่น (ยังค้างสถานะจ่ายอยู่)
   * · unfiled ยังไม่ได้กดสร้างแบบของเดือนนี้
   * · due     ถึงคิวจ่าย
   * · none    เดือนนี้ไม่มียอด
   */
  badge: "paid" | "voided" | "unfiled" | "due" | "none";
  /** ยังกดจ่ายไม่ได้เพราะอะไร (null = กดได้) — ไปโผล่ใต้ปุ่มด้วย <MissingHint> */
  blocked: string | null;
};

export type TaxBoardInput = {
  period: string;
  isVat: boolean;
  /** net_payable ที่แช่ไว้ตอนกดสร้าง ภพ.30 (null = ยังไม่เคยสร้าง) */
  summaryNetPayable: number | null;
  /**
   * ยอด "ยกไปเดือนหน้า" ที่ **แช่ไว้ตอนกดสร้าง ภพ.30** (null = ยังไม่เคยสร้าง)
   * 🚨 ตัวนี้คือตัวที่ *มีผลจริง* — เดือนถัดไปอ่านค่านี้ไปเป็น "ภาษีซื้อยกมา"
   *    เคยโชว์ค่าที่คำนวณสดแทน แล้วเลขบนจอไม่ตรงกับตารางประวัติยอดในหน้าเดียวกัน (ตระกูล D75)
   */
  summaryCarry: number | null;
  /** ยอดที่คำนวณสดจากบิลปัจจุบัน */
  liveVatPayable: number;
  liveVatCarry: number;
  livePnd3: number;
  livePnd53: number;
  /** report_key → วันที่สร้างล่าสุด */
  runs: Record<string, string>;
  payments: TaxPaymentRow[];
};

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * แปลงข้อมูลดิบ → แถวบนกระดาน "ชำระภาษี"
 *
 * ลำดับเหตุผลที่กดไม่ได้ **สำคัญ** — บอกเหตุผลที่ผู้ใช้แก้ได้ก่อนเสมอ:
 *   1. ยังไม่ได้สร้างแบบ  → ไปกดปุ่มสร้างข้างบน
 *   2. ไม่มียอดต้องชำระ   → เดือนนี้ไม่ต้องจ่าย (ยังต้องยื่นอยู่ ถ้าเป็น ภพ.30)
 *   3. จ่ายไปแล้ว        → ไม่ block แต่โชว์ปุ่มถอนแทน
 */
export function taxDueBoard(inp: TaxBoardInput): TaxDueRow[] {
  const out: TaxDueRow[] = [];
  const payOf = (k: TaxKind) =>
    inp.payments.find((p) => p.kind === k && p.period === inp.period && p.status === "ปกติ") ?? null;

  // ── ภพ.30 — กิจการที่ไม่ได้จด VAT ไม่มีแถวนี้เลย (ไม่ใช่โชว์แล้วเทา) ──
  //    ไม่มีหน้าที่ยื่นจริง ๆ ตาม D55 → โชว์ไว้ = ชวนให้เข้าใจผิดว่าลืมทำอะไรอยู่
  if (inp.isVat) {
    const filed = !!inp.runs[TAX_REPORT_KEY.vat] && inp.summaryNetPayable !== null;
    const amount = r2(Math.max(inp.summaryNetPayable ?? 0, 0));
    const live = r2(Math.max(inp.liveVatPayable, 0));
    out.push(
      row("vat", inp, {
        filed,
        amount,
        live,
        blocked: !filed
          ? 'ต้องกดปุ่ม "สร้าง ภพ.30" ของเดือนนี้ก่อน (ยอดที่จ่ายต้องเป็นยอดที่ยื่นจริง)'
          : amount <= 0
            ? `เดือนนี้ไม่มีภาษีต้องชำระ — ภาษีซื้อมากกว่าภาษีขาย ยกไปเดือนหน้า ${fmtNum(inp.summaryCarry ?? inp.liveVatCarry)} บาท`
            : null,
        payment: payOf("vat"),
      }),
    );
  }

  for (const k of ["pnd3", "pnd53"] as const) {
    const filed = !!inp.runs[TAX_REPORT_KEY[k]];
    const live = r2(k === "pnd3" ? inp.livePnd3 : inp.livePnd53);
    out.push(
      row(k, inp, {
        filed,
        amount: live,
        live,
        blocked: !filed
          ? 'ต้องกดปุ่ม "สร้าง ภงด.3/53" ของเดือนนี้ก่อน'
          : live <= 0
            ? "เดือนนี้ไม่มีการหักภาษี ณ ที่จ่ายของประเภทนี้ — ไม่ต้องยื่นและไม่ต้องจ่าย"
            : null,
        payment: payOf(k),
      }),
    );
  }

  return out;
}

function row(
  kind: TaxKind,
  inp: TaxBoardInput,
  x: { filed: boolean; amount: number; live: number; blocked: string | null; payment: TaxPaymentRow | null },
): TaxDueRow {
  const billVoided = !!x.payment && x.payment.tx_status === "ยกเลิก";

  /**
   * 🚨 บิลถูกยกเลิกจากหน้าค้นบิล **ไม่ได้แปลว่าจ่ายใหม่ได้ทันที**
   *    แถวใน `tax_payments` ยังเป็น "ปกติ" อยู่ → unique index ฝั่ง DB ยังกันอยู่
   *    เคยปล่อยให้ปุ่มกดได้แล้วเด้งแดง *"งวดนี้บันทึกการจ่ายไปแล้ว"* และปุ่มถอนก็หายไปด้วย
   *    = **ทางตัน กดอะไรไม่ได้เลยทั้งแถว** (เจอตอนเทสเบราว์เซอร์ 2026-08-31)
   *    → บอกขั้นตอนที่ต้องทำ แล้วคงปุ่มถอนไว้ให้กด
   */
  const blocked = billVoided
    ? `บิล ${x.payment?.tx_id ?? ""} ถูกยกเลิกไปแล้ว — กด "ถอนการบันทึกจ่าย" ก่อน แล้วจึงบันทึกจ่ายใหม่ได้`
    : x.payment
      ? null // จ่ายแล้ว = ไม่ต้องบอกว่าขาดอะไร (ปุ่มเปลี่ยนเป็น "ถอนการบันทึกจ่าย")
      : x.blocked;

  return {
    kind,
    label: TAX_KIND_LABEL[kind],
    period: inp.period,
    due: dueDateOf(kind, inp.period),
    amount: x.amount,
    liveAmount: x.live,
    // 🪤 ยังไม่ได้สร้างแบบ = ยังไม่มี "ยอดที่ยื่นไว้" ให้เทียบ → ห้ามบอกว่าต่างจากยอดที่ยื่น
    //    (เคยขึ้นข้อความ "ต่างจากยอดที่ยื่นไว้" ทั้งที่ยังไม่เคยกดสร้างแบบเลยสักครั้ง)
    drifted: x.filed && Math.abs(r2(x.amount) - r2(x.live)) >= 0.005,
    filed: x.filed,
    payment: x.payment,
    billVoided,
    badge: x.payment && !billVoided ? "paid"
      : billVoided ? "voided"
      : !x.filed ? "unfiled"
      : x.amount > 0 ? "due"
      : "none",
    blocked,
  };
}

function fmtNum(n: number): string {
  return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * ยังกดจ่ายได้ไหม — ตัวเดียวที่หน้าจอและ server action ใช้ร่วมกัน
 * (หน้าจอเอาไปทำ `disabled=` · action เอาไป validate ซ้ำก่อนเรียก RPC)
 */
/**
 * ยังถอนการบันทึกจ่ายได้ไหม
 * ★ **รวมกรณีบิลถูกยกเลิกไปแล้ว** — นั่นคือทางเดียวที่ผู้ใช้จะเคลียร์สถานะค้างแล้วจ่ายใหม่ได้
 */
export function canUnpay(r: TaxDueRow): boolean {
  return r.payment !== null;
}

export function canPay(r: TaxDueRow): boolean {
  return r.blocked === null && r.payment === null;
}
