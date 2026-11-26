/**
 * สูตรค่างวด — **ล้วน ไม่มี I/O** (เทสออฟไลน์ได้ 100%)
 *
 * ⚠️ นี่คือชั้นสูตรที่เกี่ยวกับเงิน → กติกาเหล็ก CLAUDE.md: ต้องมี unit test คุมทุกเคสขอบ
 *    ก่อนถือว่างานจบ · เคสขอบที่แพงที่สุดคือ "สิ้นเดือน" (ดูคำอธิบาย drift ที่ periodEnd)
 *
 * ★ ใช้ร่วมกัน 2 ฝั่ง: หน้าค่างวดของแอดมิน และแถบแจ้งเตือนในแอปของลูกค้า
 *   เกณฑ์ "ใกล้ครบกำหนด/เลยกำหนด" จึงต้องมาจากที่นี่ที่เดียว — เขียนซ้ำเมื่อไหร่จะเพี้ยนกันวันหนึ่ง
 */

import { MODULES, type ModuleKey } from "@/lib/shared/workspaces";

export type Cycle = "monthly" | "yearly";

/** ถือว่า "ใกล้ครบกำหนด" เมื่อเหลือไม่เกินกี่วัน (ใช้ที่หน้าแอดมิน) */
export const DUE_SOON_DAYS = 7;

/** ลูกค้าเห็นแถบเตือนในแอปเมื่อเหลือไม่เกินกี่วัน — สั้นกว่าฝั่งแอดมินโดยตั้งใจ
 *  แอดมินควรเห็นล่วงหน้าเพื่อเตรียมทวง · ลูกค้าไม่ควรโดนเตือนตั้งแต่ยังอีกตั้งอาทิตย์ */
export const NOTICE_DAYS = 3;

// ── วันที่ ───────────────────────────────────────────────────────────────────
// ทุกฟังก์ชันรับ/คืน 'yyyy-MM-dd' และคำนวณด้วย UTC ล้วน
// (ห้ามใช้ new Date("2026-01-31") แบบ local — เครื่องที่ timezone ติดลบจะได้วันก่อนหน้า)

function parse(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** จำนวนวันของเดือนนั้น (m = 1-12) */
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * บวกเดือนแบบ "หนีบวันที่ให้อยู่ในเดือนปลายทาง"
 * 31 ม.ค. + 1 เดือน = 28 ก.พ. (หรือ 29 ในปีอธิกสุรทิน) — ตรงกับที่ Postgres ทำเมื่อบวก interval
 */
function addMonths(iso: string, months: number): string {
  const { y, m, d } = parse(iso);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}

/**
 * วันครบกำหนดหลังจ่ายมาแล้ว `periods` รอบ — **คำนวณจากจุดยึด `startedOn` เสมอ**
 *
 * 🪤 ทำไมห้ามบวกทีละรอบจากค่าเดิม: 31 ม.ค. +1 เดือน = 28 ก.พ. แล้วบวกต่อได้ 28 มี.ค.
 *    → วันตัดรอบเลื่อนจาก 31 เป็น 28 **ถาวร** ลูกค้าเสียวันไปเรื่อย ๆ โดยไม่มีใครสังเกต
 *    คำนวณจากจุดยึด (31 ม.ค. + 2 เดือน) ได้ 31 มี.ค. ถูกต้อง และย้อนตรวจได้เสมอ
 */
export function periodEnd(startedOn: string, cycle: Cycle, periods: number): string {
  const n = Math.max(1, Math.trunc(periods));
  return addMonths(startedOn, cycle === "yearly" ? n * 12 : n);
}

/** จำนวนวันจาก `fromISO` ถึง `toISO` (บวก = ยังไม่ถึง · ลบ = เลยมาแล้ว) */
export function daysUntil(fromISO: string, toISO: string): number {
  const a = parse(fromISO);
  const b = parse(toISO);
  const MS = 24 * 60 * 60 * 1000;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / MS);
}

// ── สถานะที่แสดงบนหน้าจอแอดมิน ───────────────────────────────────────────────

export type BillingState = "past_due" | "due_soon" | "active" | "paused" | "cancelled";

/**
 * สถานะที่เอาไปทาสีบนตาราง — **`past_due` คำนวณสด ไม่ได้เก็บใน DB**
 * (ไม่มี cron มาพลิกค่าให้ เก็บลง DB แล้วจะกลายเป็นค่าที่โกหก — ดู comment ในไฟล์ migration 0037)
 *
 * หยุดพัก/ยกเลิกชนะเสมอ: ตกลงกันแล้วว่าพัก ก็ไม่ต้องขึ้นว่าค้างจ่าย
 */
export function billingState(
  sub: { status: string; currentPeriodEnd: string } | null | undefined,
  todayISO: string,
): BillingState | "none" {
  if (!sub) return "none";
  if (sub.status === "paused") return "paused";
  if (sub.status === "cancelled") return "cancelled";

  const left = daysUntil(todayISO, sub.currentPeriodEnd);
  if (left < 0) return "past_due";
  return left <= DUE_SOON_DAYS ? "due_soon" : "active";
}

export const BILLING_STATE_LABEL: Record<BillingState | "none", string> = {
  past_due: "เลยกำหนด",
  due_soon: "ใกล้ครบกำหนด",
  active: "ปกติ",
  paused: "หยุดพัก",
  cancelled: "ยกเลิกแล้ว",
  none: "ยังไม่ได้ตั้งค่างวด",
};

// ── แถบแจ้งเตือนในแอปของลูกค้า ───────────────────────────────────────────────

export type NoticeLevel = "none" | "due_soon" | "overdue";

/**
 * ลูกค้าควรเห็นอะไร — ใช้ `tenants.billing_due_on` ที่มิเรอร์มา (ไม่แตะ subscriptions)
 *
 * ★ วันครบกำหนดพอดี = **ยังไม่เลย** (ให้เขาโอนภายในวันนั้นได้)
 * ★ `dueOn` เป็น null (ยังไม่ตั้งค่างวด / หยุดพัก / ปิดการเตือน) = เงียบสนิท
 */
export function noticeLevel(dueOn: string | null | undefined, todayISO: string): NoticeLevel {
  if (!dueOn) return "none";
  const left = daysUntil(todayISO, dueOn);
  if (left < 0) return "overdue";
  return left <= NOTICE_DAYS ? "due_soon" : "none";
}

// ── ราคา ─────────────────────────────────────────────────────────────────────

/**
 * ราคาต่อเดือนตาม docs/NEXT_STEPS.md 4.1 — แก้ราคาที่นี่ที่เดียว
 *
 * 🔴 Y8 (รีวิว Fable · D182) — เดิมเป็น `Record<string, number>` รู้จักแค่ 3 โมดูล
 *    ⇒ ลูกค้าที่ซื้อบาร์อย่างเดียวถูกเสนอ **0 บาท "ยังไม่ระบุ"** · ซื้อ 3 โมดูล + เงินเดือน = ราคาเท่า 3 โมดูล
 *    และ TS ไม่ฟ้องเพราะ key เป็น string อะไรก็ได้ (ตระกูล D84)
 *    ⇒ บังคับครบทุก `ModuleKey` · `null` = **ยังไม่ได้ตั้งราคา** (ผู้ใช้สั่ง 2026-11-26: ราคาสรุปทีเดียวทีหลัง)
 *    — ห้ามใส่ 0 แทน null: 0 คือ "ฟรี" ซึ่งเป็นการตัดสินเชิงพาณิชย์อีกแบบ
 */
export const MODULE_PRICE: Record<ModuleKey, number | null> = {
  production: 790,
  accounting: 490,
  sales: 490,
  payroll: null, // ⏳ ยังไม่ตั้งราคา (NEXT_STEPS 0.-7)
  bar: null, // ⏳ เสนอไว้ ฿490 แต่ยังไม่สรุป (NEXT_STEPS 0.-7)
};

/** 3 โมดูลที่ราคาเหมาครอบ — ราคาเหมาตั้งไว้ตอนมีแค่ 3 โมดูล ยังไม่รวมเงินเดือน/บาร์ */
export const FULL_BUNDLE: readonly ModuleKey[] = ["production", "accounting", "sales"];

/** ซื้อครบ 3 โมดูลหลัก = ราคาเหมา (ถูกกว่าบวกกันเอง 270) */
export const FULL_PRICE = 1490;

/** กิจการที่ 2 ขึ้นไป (add-on) — ช่วงราคาจริง 390–590 ใช้ค่ากลางเป็นค่าเสนอ */
export const EXTRA_ENTITY_PRICE = 490;

/** ★ Record<ModuleKey,…> — เพิ่มโมดูลใหม่แล้วลืมเติม = TS ฟ้อง (D84) */
const MODULE_SHORT: Record<ModuleKey, string> = {
  production: "ผลิต",
  accounting: "บัญชี",
  sales: "ขาย",
  payroll: "เงินเดือน",
  bar: "บาร์",
};

const isModule = (m: string): m is ModuleKey => (MODULES as readonly string[]).includes(m);
/** โมดูลที่ซื้อ (ตัดค่าที่ไม่รู้จัก · เรียงตามลำดับมาตรฐาน · ไม่ซ้ำ) */
const boughtOf = (modules: string[]): ModuleKey[] => MODULES.filter((m) => modules.includes(m));

/**
 * ราคาที่ระบบ **เสนอ** — คนกดพิมพ์ทับได้เสมอ (ส่วนลด/ดีลพิเศษเป็นเรื่องของคน)
 * มีไว้กันลืมคิดเงินตอนลูกค้าซื้อโมดูล/กิจการเพิ่ม ไม่ได้มีไว้บังคับ
 *
 * ★ โมดูลที่ยังไม่ตั้งราคา **ไม่ถูกนับ** — ผู้เรียกต้องโชว์ `unpricedText()` คู่กันเสมอ
 *   (ไม่งั้นตัวเลขที่เสนอดูเหมือนครบ ทั้งที่ยังขาดโมดูลนั้น)
 * ⚠️ รายปี = รายเดือน × 12 **ไม่ใส่ส่วนลดอัตโนมัติ** — เป็นการตัดสินใจเชิงพาณิชย์
 */
export function suggestPrice(modules: string[], entityCount: number, cycle: Cycle): number {
  const bought = boughtOf(modules.filter(isModule));
  const fullBundle = FULL_BUNDLE.every((m) => bought.includes(m));
  const base = bought.reduce((sum, m) => {
    if (fullBundle && FULL_BUNDLE.includes(m)) return sum; // อยู่ในราคาเหมาแล้ว
    return sum + (MODULE_PRICE[m] ?? 0);
  }, fullBundle ? FULL_PRICE : 0);
  const extra = Math.max(0, Math.trunc(entityCount) - 1) * EXTRA_ENTITY_PRICE;
  const monthly = base + extra;
  return cycle === "yearly" ? monthly * 12 : monthly;
}

/** โมดูลที่ลูกค้าซื้อแต่ยังไม่มีราคาตั้ง — ราคาที่เสนอไม่ได้รวมไว้ */
export function unpricedModules(modules: string[]): ModuleKey[] {
  return boughtOf(modules.filter(isModule)).filter((m) => MODULE_PRICE[m] === null);
}

/** ข้อความเตือนบนจอ (D83) · `null` = ราคาที่เสนอครอบทุกโมดูลที่ซื้อแล้ว */
export function unpricedText(modules: string[]): string | null {
  const miss = unpricedModules(modules);
  if (miss.length === 0) return null;
  return `โมดูล${miss.map((m) => MODULE_SHORT[m]).join(" · ")} ยังไม่มีราคาตั้งในระบบ — ราคาที่เสนอไม่ได้รวมไว้ พิมพ์ราคาเองให้ครอบ`;
}

/** ชื่อแพ็กเกจที่เสนอ เช่น 'ผลิต+บัญชี' · ซื้อครบทุกโมดูล = 'ครบทุกโมดูล' */
export function suggestPlanName(modules: string[]): string {
  const bought = boughtOf(modules.filter(isModule));
  if (bought.length === 0) return "ยังไม่ระบุ";
  if (bought.length === MODULES.length) return "ครบทุกโมดูล";
  return bought.map((m) => MODULE_SHORT[m]).join("+");
}

/** ราคาต่อเดือนเทียบเท่า — ใช้รวมเป็นรายได้ต่อเดือน (MRR) โดยไม่ให้รายปีมาบวมทีเดียว */
export function monthlyEquivalent(price: number, cycle: Cycle): number {
  const v = Number(price) || 0;
  return cycle === "yearly" ? Math.round((v / 12) * 100) / 100 : v;
}
