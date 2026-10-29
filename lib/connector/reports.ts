/**
 * lib/connector/reports — ตัวช่วยของเครื่องมือปิดเดือน (account_statement · search_transactions · tax_report · D141 รอบ 6)
 *
 * ★ เครื่องมือชุดนี้อ่านอย่างเดียว · ตัวเลขมาจากตัวโหลด/สูตรเดียวกับหน้าเว็บ (lib/accounting/reportLoaders)
 *   กระบวนการ (อ่าน statement · เทียบ · รายงาน) อยู่ใน skill ที่ผู้ใช้แก้เองได้ — ผู้ใช้ตัดสินแบบนี้
 */

/** ผลลัพธ์ต่อครั้งไม่เกินเพดานของ Claude (~150k ตัวอักษร) */
export const STATEMENT_ROW_CAP = 1000;
export const SEARCH_ROW_CAP = 200;

/** "YYYY-MM" (ค.ศ.) → ค่าเดิม · อย่างอื่น = null (ปี พ.ศ. ที่หลุดมาถูกปฏิเสธ ไม่เดาลบ 543) */
export function monthArg(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(s);
  if (!m || Number(m[1]) > 2400) return null;
  return s;
}

/** "YYYY-MM-DD" (ค.ศ. · วันที่มีจริง) → ค่าเดิม · อย่างอื่น = null */
export function dateArg(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number(s.slice(0, 4)) > 2400) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

/**
 * ยอดตรงกันไหม (±0.01) — เทียบทั้งยอดสุทธิ (เงินที่ออกจริง) และยอดก่อน VAT
 * ★ statement ธนาคารแสดงเงินที่ออกจริง = ยอดสุทธิ (หลังหัก ณ ที่จ่าย) — แต่คนมักค้นด้วยยอดบนบิล จึงเทียบทั้งสอง
 */
export function matchesAmount(amount: number, net: unknown, beforeVat: unknown): boolean {
  const a = Math.abs(Number(amount));
  return [net, beforeVat].some((x) => Math.abs(Math.abs(Number(x)) - a) <= 0.01 + 1e-9);
}

/**
 * ปัดเป็นสตางค์ตอนส่งออกเท่านั้น — ยอดสะสมแบบ float ได้ 12181.220000000001 (หน้าเว็บซ่อนด้วย toFixed)
 * ★ ไม่แตะสูตร: ปัดค่าที่คำนวณเสร็จแล้ว เหมือนที่หน้าจอแสดง
 */
export function money(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0;
}
