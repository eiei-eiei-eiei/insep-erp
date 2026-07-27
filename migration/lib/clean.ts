/**
 * clean.ts — ตัวช่วยแปลง/ล้างค่าจาก Google Sheets (ผ่าน xlsx) → ค่าที่ลง Postgres ได้
 *
 * ⚠️ จุดเสี่ยงที่สุด = วันที่ (MIGRATION_PLAN sec 7.2):
 *   Google Sheets เก็บวันที่เป็น Excel serial (tz-neutral) แต่ถ้าให้ xlsx แปลงเป็น JS Date
 *   จะโดน timezone ของเครื่องเลื่อน (เช่น 28 เม.ย. กลายเป็น 27 เม.ย. 17:00Z) → ผิดวัน
 *   ทางแก้: อ่านค่า "ดิบ" (raw serial number) แล้วถอดเป็น y/m/d ด้วย XLSX.SSF.parse_date_code
 *   ซึ่งไม่ยุ่งกับ timezone เลย → ได้วันตรงเป๊ะตามที่พิมพ์ในชีท
 */
import * as XLSX from "xlsx";

export type Cell = string | number | boolean | null | undefined;

/** ค่าว่างเชิงความหมาย (sheet ว่าง = '' / '-' บางคอลัมน์) */
function isBlank(v: Cell): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string" && v.trim() === "") return true;
  return false;
}

/** string หรือ null (trim) — sheet ว่าง → null */
export function str(v: Cell): string | null {
  if (isBlank(v)) return null;
  return String(v).trim();
}

/** string บังคับ (ค่าว่าง → '') — ใช้กับคอลัมน์ NOT NULL ที่ยอมค่าว่างได้ */
export function strReq(v: Cell): string {
  return isBlank(v) ? "" : String(v).trim();
}

/** ตัวเลข หรือ null — รองรับ '1,234.5', '-', ค่าว่าง → null */
export function num(v: Cell): number | null {
  if (isBlank(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/,/g, "");
  if (s === "-" || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** ตัวเลข default 0 (คอลัมน์ NOT NULL default 0) */
export function num0(v: Cell): number {
  return num(v) ?? 0;
}

/** boolean — true/'true'/'TRUE'/1/'1' → true, อื่น → false */
export function bool(v: Cell): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "ใช่";
}

/** เลขภาษี — ตัด apostrophe นำหน้า (กัน Sheets ตัด 0) + trim (ตาม getEntities_ เดิม) */
export function taxId(v: Cell): string | null {
  const s = str(v);
  if (s === null) return null;
  const t = s.replace(/^'/, "").trim();
  return t === "" || t === "-" ? null : t;
}

/** normalize เลขภาษีสำหรับ "จับคู่" (เทียบ custdata↔Contacts) — เอาเฉพาะเลข */
export function normTaxId(v: Cell): string {
  return String(v ?? "").replace(/\D/g, "");
}

/** normalize ชื่อสำหรับจับคู่ (ตรงกับ unique index lower(trim(name))) */
export function normName(v: Cell): string {
  return String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** split 'EID01,EID02' → ['EID01','EID02'] (คอลัมน์ text[] เดิมเก็บ comma) */
export function splitComma(v: Cell): string[] {
  const s = str(v);
  if (s === null) return [];
  return s.split(",").map((x) => x.trim()).filter((x) => x !== "");
}

/** ถอด Excel serial (number) → ส่วนวัน tz-neutral */
function partsFromSerial(serial: number): { y: number; m: number; d: number; H: number; M: number; S: number } {
  const p = XLSX.SSF.parse_date_code(serial);
  if (!p) throw new Error(`parse_date_code ล้มเหลว: ${serial}`);
  return { y: p.y, m: p.m, d: p.d, H: p.H, M: p.M, S: p.S };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

// แก้ปีที่พิมพ์เป็น พ.ศ. แล้วถูกเก็บเป็น serial ค.ศ. (เช่น qu_expire = ปี 2569 → 2026)
// ปลอดภัย: ข้อมูลชุดนี้ไม่มีวันจริงเกินปี 2500 CE — ปี > 2500 = พ.ศ. เสมอ
const beToCe = (y: number) => (y > 2500 ? y - 543 : y);

/**
 * แปลงเป็น 'YYYY-MM-DD' (tz-safe). รองรับ:
 *   - number  → Excel serial (ถอดด้วย SSF ไม่ยุ่ง timezone)
 *   - string  → 'YYYY-MM-DD[...]' | 'D/M/YYYY' (ปี > 2500 = พ.ศ. → ลบ 543)
 * ค่าว่าง/แปลงไม่ได้ → null
 */
export function isoDate(v: Cell): string | null {
  if (isBlank(v)) return null;
  if (typeof v === "number") {
    const { y, m, d } = partsFromSerial(v);
    return `${pad(beToCe(y), 4)}-${pad(m)}-${pad(d)}`;
  }
  const s = String(v).trim();
  // ISO นำหน้า
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // D/M/YYYY (หรือ พ.ศ.)
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) {
    let y = Number(dmy[3]);
    if (y > 2500) y -= 543; // พ.ศ. → ค.ศ.
    return `${pad(y, 4)}-${pad(Number(dmy[2]))}-${pad(Number(dmy[1]))}`;
  }
  return null;
}

/**
 * timestamp เต็ม 'YYYY-MM-DDTHH:MM:SS+07:00' (tz-safe, ตีความเป็นเวลาไทย)
 * ใช้กับคอลัมน์ created_at ที่อยากคงเวลาเดิม (ค่าใน Sheets คือเวลาไทยอยู่แล้ว)
 */
export function isoTimestampTH(v: Cell): string | null {
  if (isBlank(v)) return null;
  if (typeof v === "number") {
    const { y, m, d, H, M, S } = partsFromSerial(v);
    return `${pad(beToCe(y), 4)}-${pad(m)}-${pad(d)}T${pad(H)}:${pad(M)}:${pad(S)}+07:00`;
  }
  const iso = isoDate(v);
  return iso ? `${iso}T00:00:00+07:00` : null;
}

/** report_month 'YYYY-MM' — รองรับ serial/Date/string (ปนกันในชีท Tax_Summaries) */
export function reportMonth(v: Cell): string | null {
  if (isBlank(v)) return null;
  if (typeof v === "number") {
    const { y, m } = partsFromSerial(v);
    return `${pad(beToCe(y), 4)}-${pad(m)}`;
  }
  const s = String(v).trim();
  const ym = s.match(/^(\d{4})-(\d{2})/);
  if (ym) return `${ym[1]}-${ym[2]}`;
  const iso = isoDate(v);
  return iso ? iso.slice(0, 7) : null;
}

/** เก็บสถิติการเลื่อน/แปลงไว้รายงาน (debug tz) */
export function shiftedDayCount(rawSerial: Cell): boolean {
  // true ถ้า serial มีเศษเวลาใกล้เที่ยงคืน (บ่งชี้เคยโดน tz shift ในระบบเดิม) — ใช้แค่รายงาน
  if (typeof rawSerial !== "number") return false;
  const frac = rawSerial - Math.floor(rawSerial);
  return frac > 0.9 || frac < 0.02;
}
