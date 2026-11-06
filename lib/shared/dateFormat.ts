/**
 * lib/shared/dateFormat — รูปแบบวันที่ที่ลูกค้าเลือกเองได้ (D161)
 *
 * 🎯 เดิมวันที่บนจอมีหลายแบบปนกัน (`6 พ.ย. 69` · `06/11/2569` · `06/11/69` · `2026-11-06` ดิบ)
 *    แต่ละหน้าเขียนตัวจัดรูปของตัวเอง → ไฟล์นี้คือ **ตัวจัดรูปตัวเดียว** ของหน้าจอและเอกสารการค้า
 *
 * ★ รูปแบบเป็น **ชุดปิด** (แนวเดียวกับเลขเอกสาร D100) — ไม่ให้พิมพ์แม่แบบเอง
 *   `Record<DateFormat, …>` ⇒ เพิ่มรูปแบบใหม่แล้วลืมเขียนวิธีแสดงข้อใดข้อหนึ่ง = build ไม่ผ่าน (D84)
 *
 * 🚨 **ฟอร์มราชการห้ามเรียกไฟล์นี้** (ภส. · ภพ.30 · ภงด. · 50ทวิ · สปส.) — รูปแบบบนแบบเป็นของกรม
 *    ไม่ใช่ของลูกค้า · ไฟล์เหล่านั้นใช้ตัวจัดรูปของตัวเองที่มี golden test ล็อกไว้
 * 🚨 ไฟล์ส่งออก (Excel/CSV/JSON) และ Claude connector ใช้ ISO ต่อ — เป็นข้อมูลให้โปรแกรมอื่นอ่าน
 *
 * ⚠️ วันที่ล้วน ('yyyy-MM-dd') แกะสตริงตรง ๆ **ไม่ผ่าน `new Date()`** — parse แล้ว format ตามเวลา
 *    เครื่องได้วันคลาด 1 วันบนเครื่องที่ offset ติดลบ (เหตุผลเดียวกับ `formatDateThai`)
 * ⚠️ timestamp ที่มีโซนเวลา (`created_at` ของ Supabase = `…T01:23:45+00:00`) แปลงเป็น **เวลาไทย**
 *    ก่อนเสมอ ไม่ว่าโค้ดจะรันบน server (UTC) หรือเบราว์เซอร์ — ตัด 10 ตัวแรกตรง ๆ = วันที่ UTC
 *    ⇒ ของที่เกิดเที่ยงคืน–7 โมงเช้าขึ้นเป็นวันก่อนหน้า (บั๊กที่เจอใน D100 เฟส 0 และ D161 เฟส 0)
 */

export const DATE_FORMATS = [
  "d_mon_yy",
  "d_mon_yyyy",
  "dd_mm_yyyy_be",
  "dd_mm_yy_be",
  "dd_mm_yyyy_ce",
  "iso",
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** ค่าเริ่มต้นของหน้าจอ = ผลเดียวกับ `formatDateThai` (A9) เป๊ะ */
export const DEFAULT_SCREEN_FORMAT: DateFormat = "d_mon_yy";
/**
 * ค่าเริ่มต้นของเอกสารการค้า = ผลเดียวกับ `formatThaiDate` (lib/sales/orders) เป๊ะ
 * ★ แยกจากหน้าจอโดยตั้งใจ — ไม่ตั้ง = กระดาษของลูกค้าทุกรายเหมือนเดิมทุกตัวอักษร
 */
export const DEFAULT_DOC_FORMAT: DateFormat = "dd_mm_yyyy_be";

/** ชื่อ kind ใน `app_settings` (ต้องอยู่ใน CHECK whitelist — migration 0108) */
export const DATE_FORMAT_KIND = "date_format";
export const DOC_DATE_FORMAT_KIND = "doc_date_format";

export const DATE_FORMAT_LABEL: Record<DateFormat, string> = {
  d_mon_yy: "วัน เดือนย่อ ปี พ.ศ. 2 หลัก",
  d_mon_yyyy: "วัน เดือนย่อ ปี พ.ศ. เต็ม",
  dd_mm_yyyy_be: "ตัวเลข ปี พ.ศ. เต็ม",
  dd_mm_yy_be: "ตัวเลข ปี พ.ศ. 2 หลัก",
  dd_mm_yyyy_ce: "ตัวเลข ปี ค.ศ.",
  iso: "ปี-เดือน-วัน ค.ศ. (มาตรฐานสากล)",
};

const TH_MONTHS_ABBR = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_WEEKDAYS_ABBR = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

type YMD = { y: number; m: number; d: number }; // m = 1..12

const p2 = (n: number) => String(n).padStart(2, "0");
const be = (y: number) => y + 543;
const be2 = (y: number) => p2(be(y) % 100);

type Spec = {
  /** วันที่เต็ม */
  date: (p: YMD) => string;
  /** เดือน (งวด 'yyyy-MM') */
  month: (y: number, m: number) => string;
  /** วันที่แบบสั้น ไม่มีปี — ใช้ในข้อความที่พูดถึงวันใกล้ ๆ (แถบเตือน · วันในสัปดาห์นี้) */
  day: (p: YMD) => string;
};

const SPEC: Record<DateFormat, Spec> = {
  d_mon_yy: {
    date: ({ y, m, d }) => `${d} ${TH_MONTHS_ABBR[m - 1]} ${be2(y)}`,
    month: (y, m) => `${TH_MONTHS_ABBR[m - 1]} ${be2(y)}`,
    day: ({ m, d }) => `${d} ${TH_MONTHS_ABBR[m - 1]}`,
  },
  d_mon_yyyy: {
    date: ({ y, m, d }) => `${d} ${TH_MONTHS_ABBR[m - 1]} ${be(y)}`,
    month: (y, m) => `${TH_MONTHS_ABBR[m - 1]} ${be(y)}`,
    day: ({ m, d }) => `${d} ${TH_MONTHS_ABBR[m - 1]}`,
  },
  dd_mm_yyyy_be: {
    date: ({ y, m, d }) => `${p2(d)}/${p2(m)}/${be(y)}`,
    month: (y, m) => `${p2(m)}/${be(y)}`,
    day: ({ m, d }) => `${p2(d)}/${p2(m)}`,
  },
  dd_mm_yy_be: {
    date: ({ y, m, d }) => `${p2(d)}/${p2(m)}/${be2(y)}`,
    month: (y, m) => `${p2(m)}/${be2(y)}`,
    day: ({ m, d }) => `${p2(d)}/${p2(m)}`,
  },
  dd_mm_yyyy_ce: {
    date: ({ y, m, d }) => `${p2(d)}/${p2(m)}/${y}`,
    month: (y, m) => `${p2(m)}/${y}`,
    day: ({ m, d }) => `${p2(d)}/${p2(m)}`,
  },
  iso: {
    date: ({ y, m, d }) => `${y}-${p2(m)}-${p2(d)}`,
    month: (y, m) => `${y}-${p2(m)}`,
    // ★ ISO ไม่มีรูปแบบ "ไม่มีปี" ที่อ่านแล้วไม่งง (`11-06` เป็นวันที่ 6 หรือ 11?) → ใช้วันที่เต็ม
    day: ({ y, m, d }) => `${y}-${p2(m)}-${p2(d)}`,
  },
};

const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** แปลง Date เป็นส่วนประกอบตามเวลาไทย (ไม่ขึ้นกับโซนเวลาของเครื่องที่รัน) */
function bkkParts(t: Date): YMD & { hh: number; mi: number } {
  const s = new Date(t.getTime() + BKK_OFFSET_MS);
  return { y: s.getUTCFullYear(), m: s.getUTCMonth() + 1, d: s.getUTCDate(), hh: s.getUTCHours(), mi: s.getUTCMinutes() };
}

/** ช่วงค่าที่สมเหตุสมผล — `2026-13-45` ไม่ใช่วันที่ ห้ามพิมพ์ออกมาเป็น "45 undefined 69" */
function valid(p: YMD): boolean {
  if (!(p.m >= 1 && p.m <= 12 && p.d >= 1 && p.d <= 31 && p.y >= 1)) return false;
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDate() === p.d;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** มีเวลา + โซนเวลา (Z / +07:00 / +0000) → เป็นจุดบนเส้นเวลา ต้องแปลงเป็นเวลาไทย */
const ZONED = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/;

/** ข้อความ timestamp → Date · เติม ":00" ให้โซนแบบ "+00" ที่ Postgres พิมพ์ (`new Date()` อ่านไม่ออก) */
function parseZoned(s: string): Date {
  return new Date(s.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
}

/**
 * อ่านวันที่จากค่าที่ DB ส่งมา
 * - 'yyyy-MM-dd' → ตามตัวอักษร
 * - timestamp มีโซนเวลา → วันที่ตามเวลาไทย
 * - 'yyyy-MM-ddTHH:mm…' ไม่มีโซน → ใช้ส่วนวันที่ตามตัวอักษร (ไม่เดาโซน)
 * - อื่น ๆ → null
 */
export function parseDateParts(v: string | null | undefined): YMD | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let p: YMD | null = null;
  const m = DATE_ONLY.exec(s);
  if (m) p = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  else if (ZONED.test(s)) {
    const t = parseZoned(s);
    if (!Number.isNaN(t.getTime())) p = bkkParts(t);
  } else {
    const pre = /^(\d{4})-(\d{2})-(\d{2})[T ]/.exec(s);
    if (pre) p = { y: Number(pre[1]), m: Number(pre[2]), d: Number(pre[3]) };
  }
  return p && valid(p) ? p : null;
}

/**
 * วันที่ตามรูปแบบที่เลือก
 * ★ ค่าว่าง/null → "" (ให้หน้าจอเลือกเองว่าจะแสดง "—" หรือไม่แสดง)
 * ★ ค่าที่อ่านไม่ออก → คืนตามเดิม **ไม่เดา** (เห็นค่าแปลกบนจอดีกว่าเห็นวันที่ผิด)
 */
export function formatDate(v: string | null | undefined, fmt: DateFormat): string {
  if (v == null || String(v).trim() === "") return "";
  const p = parseDateParts(v);
  return p ? SPEC[fmt].date(p) : String(v);
}

/** วันที่แบบสั้นไม่มีปี (แถบเตือน · ของค้างไม่กี่วัน) */
export function formatDayShort(v: string | null | undefined, fmt: DateFormat): string {
  if (v == null || String(v).trim() === "") return "";
  const p = parseDateParts(v);
  return p ? SPEC[fmt].day(p) : String(v);
}

/** เดือนจากงวด 'yyyy-MM' (หรือวันที่เต็ม — ใช้แค่ปีกับเดือน) */
export function formatMonth(period: string | null | undefined, fmt: DateFormat): string {
  const s = String(period ?? "").trim();
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})(?:$|-)/.exec(s);
  if (!m) return s;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!(mo >= 1 && mo <= 12)) return s;
  return SPEC[fmt].month(y, mo);
}

/**
 * วันที่ + เวลา (24 ชม. ตามเวลาไทยเสมอ) — ใช้กับ timestamp เช่น `created_at`
 * ★ ไม่มีวินาที: จอคนอ่านไม่ต้องการ และวินาทีทำให้ server กับเบราว์เซอร์ render ไม่ตรงกัน
 */
export function formatDateTime(v: string | Date | null | undefined, fmt: DateFormat): string {
  if (v == null || (typeof v === "string" && v.trim() === "")) return "";
  // ไม่มีโซนเวลา → อ่านไม่ได้ว่าเป็นเวลาไหนจริง ⇒ ไม่เดา คืนตามเดิม
  if (typeof v === "string" && !ZONED.test(v.trim())) return v;
  const t = typeof v === "string" ? parseZoned(v) : v;
  if (Number.isNaN(t.getTime())) return String(v);
  const p = bkkParts(t);
  return `${SPEC[fmt].date(p)} ${p2(p.hh)}:${p2(p.mi)}`;
}

/** วันในสัปดาห์แบบย่อ ("ศ.") — ไม่ขึ้นกับรูปแบบที่เลือก */
export function weekdayShort(v: string | null | undefined): string {
  const p = parseDateParts(v);
  if (!p) return "";
  return TH_WEEKDAYS_ABBR[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
}

/** ค่าจาก DB → รูปแบบที่รู้จัก · ไม่รู้จัก/ว่าง = ค่าเริ่มต้น (ไม่ทำให้หน้าจอพัง) */
export function toDateFormat(v: unknown, fallback: DateFormat): DateFormat {
  return (DATE_FORMATS as readonly string[]).includes(String(v)) ? (v as DateFormat) : fallback;
}

export type DateFormats = { screen: DateFormat; doc: DateFormat };
export const DEFAULT_DATE_FORMATS: DateFormats = { screen: DEFAULT_SCREEN_FORMAT, doc: DEFAULT_DOC_FORMAT };

/** อ่านจากแถว `app_settings` (kind, value) — ไม่มีแถว = ค่าเริ่มต้น */
export function dateFormatsFromSettings(rows: { kind: string; value: string }[] | null | undefined): DateFormats {
  const get = (k: string) => (rows ?? []).find((r) => r.kind === k)?.value;
  return {
    screen: toDateFormat(get(DATE_FORMAT_KIND), DEFAULT_SCREEN_FORMAT),
    doc: toDateFormat(get(DOC_DATE_FORMAT_KIND), DEFAULT_DOC_FORMAT),
  };
}
