/**
 * lib/payroll/filings — ชั้นสูตรของ **เอกสารยื่นราชการ** (ภงด.1 · สปส.1-10 · ภงด.1ก · 50ทวิ)
 *
 * 🚨 ทุกยอดในไฟล์นี้มาจากค่าที่ **แช่ไว้แล้ว** ใน `payroll_items` ตอนกดบันทึกงวด
 *    ห้ามรับ config (pay_components / pay_rates) เข้ามาคำนวณสดเด็ดขาด —
 *    ลูกค้าแก้เกณฑ์กลางปีเมื่อไหร่ ตัวเลขที่ยื่นราชการไปแล้วจะเปลี่ยนย้อนหลังเงียบ ๆ
 *    (กับดักเดียวกับ D66 ข้อ 2 · สังเกตว่า signature ทุกตัวไม่มี config เลยโดยตั้งใจ)
 *
 * 🚨 **ไม่มีตัวกรอง "ยอด > 0" ที่ไหนทั้งสิ้น** — ระบบเดิมบน GAS กรอง `wht > 0` / `sso > 0` ทิ้ง
 *    ซึ่งทำให้เอกสาร**ผิด** ไม่ใช่แค่ดูไม่ครบ:
 *      · ภงด.1/ภงด.1ก ถามจำนวน "ผู้มีเงินได้" ไม่ใช่ "ผู้ถูกหักภาษี" → คนที่ยังไม่ถึงเกณฑ์
 *        ก็ต้องแสดง · โรงที่ไม่มีใครถึงเกณฑ์เลยจะได้ใบแนบว่างเปล่าทั้งใบ
 *      · สปส.1-10 การหายไปจากแบบนำส่ง = สปส. อ่านได้ว่าคนนั้นสิ้นสภาพผู้ประกันตน
 *    **ข้อยกเว้นเดียว**: `ssoExempt` ไม่ขึ้น สปส.1-10 เพราะธงนั้นแปลว่า "ไม่ใช่ผู้ประกันตน"
 *    (คนละเรื่องกับ "เงินสมทบเป็น 0") และเป็นเจตนาที่ผู้ใช้ตั้งเองทีละคน ไม่ใช่การเดาของโค้ด
 */

/** 1 แถวของ payroll_items เท่าที่เอกสารยื่นต้องใช้ (ค่าที่แช่ไว้แล้วล้วน ๆ) */
export type FilingItem = {
  periodId: string;
  empId: string;
  empName: string;
  gross: number;
  /** เงินได้พึงประเมิน — งวดที่บันทึกก่อน D69 จะไม่มีค่านี้ (ดู taxBaseOf) */
  taxableIncome?: number | null;
  /** ฐานค่าจ้างที่ใช้คิดเงินสมทบ (บีบเพดานแล้ว) — งวดเก่าอาจไม่มี */
  ssoWageBase?: number | null;
  sso: number;
  ssoEmployer: number;
  wht: number;
};

/** ทะเบียนพนักงานเท่าที่เอกสารยื่นต้องใช้ */
export type FilingEmployee = {
  empId: string;
  name: string;
  nationalId?: string | null;
  ssoNo?: string | null;
  address?: string | null;
  ssoExempt?: boolean;
};

export type Pnd1Row = {
  seq: number;
  empId: string;
  name: string;
  nationalId: string;
  income: number;
  wht: number;
};

export type Pnd1Result = {
  rows: Pnd1Row[];
  /** จำนวนผู้มีเงินได้ทั้งหมด */
  count: number;
  /** จำนวนเฉพาะผู้ที่ถูกหักภาษี — แบบมีช่องถามแยกจากจำนวนทั้งหมด */
  countWithTax: number;
  totalIncome: number;
  totalWht: number;
  /** true = มีอย่างน้อย 1 แถวที่ไม่มี taxableIncome แช่ไว้ → หน้าจอต้องขึ้นป้ายเตือน */
  usedGrossFallback: boolean;
};

export type Sso110Row = {
  seq: number;
  empId: string;
  name: string;
  /** เลขประกันสังคม ถ้าไม่มีใช้เลขบัตรประชาชนแทน (แบบยอมรับทั้งสอง) */
  ssoRef: string;
  wage: number;
  sso: number;
};

export type Sso110Result = {
  rows: Sso110Row[];
  count: number;
  totalWage: number;
  totalEmployee: number;
  totalEmployer: number;
  /** ยอดนำส่งทั้งสิ้น = ลูกจ้าง + นายจ้าง */
  grandTotal: number;
};

export type Pnd1kRow = Pnd1Row & { periods: number };

export type Pnd1kResult = {
  rows: Pnd1kRow[];
  count: number;
  countWithTax: number;
  totalIncome: number;
  totalWht: number;
  usedGrossFallback: boolean;
};

// ── helper ───────────────────────────────────────────────────────────────────
function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * เงินได้พึงประเมินของแถวหนึ่ง
 * 🪤 งวดที่บันทึกไว้ก่อน D69 ไม่มี `taxableIncome` → **fallback เป็น gross**
 *    ซึ่งตรงกับระบบเดิมพอดี (ที่นั่นทุกรายการติดธงภาษีอยู่แล้ว) แต่ต้องบอกผู้ใช้ให้รู้ตัว
 *    จึงคืนสถานะ fallback ขึ้นไปด้วย ไม่ใช่เงียบ ๆ
 */
export function taxBaseOf(it: FilingItem): { value: number; fallback: boolean } {
  const t = it.taxableIncome;
  if (t == null || !Number.isFinite(Number(t))) return { value: n(it.gross), fallback: true };
  return { value: n(t), fallback: false };
}

/** ฐานค่าจ้างที่ใช้คิดเงินสมทบ — งวดเก่าที่ไม่มีค่านี้ใช้ gross แทน */
function ssoWageOf(it: FilingItem): number {
  const w = it.ssoWageBase;
  if (w == null || !Number.isFinite(Number(w))) return n(it.gross);
  return n(w);
}

function empOf(emps: FilingEmployee[], empId: string): FilingEmployee | undefined {
  return emps.find((e) => e.empId === empId);
}

/** เรียงตามรหัสพนักงาน — ลำดับที่ผู้ใช้ต้องคีย์เข้าเว็บราชการต้องคงที่ทุกครั้งที่เปิด */
function byEmpId<T extends { empId: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.empId.localeCompare(b.empId));
}

// ── ภ.ง.ด.1 (ใบแนบ) รายเดือน ─────────────────────────────────────────────────
export function pnd1Rows(items: FilingItem[], emps: FilingEmployee[]): Pnd1Result {
  let usedGrossFallback = false;
  const sorted = byEmpId(items);

  const rows: Pnd1Row[] = sorted.map((it, i) => {
    const base = taxBaseOf(it);
    if (base.fallback) usedGrossFallback = true;
    const e = empOf(emps, it.empId);
    return {
      seq: i + 1,
      empId: it.empId,
      name: it.empName || e?.name || "",
      nationalId: e?.nationalId ?? "",
      income: round2(base.value),
      wht: round2(n(it.wht)),
    };
  });

  return {
    rows,
    count: rows.length,
    countWithTax: rows.filter((r) => r.wht > 0).length,
    totalIncome: round2(rows.reduce((s, r) => s + r.income, 0)),
    totalWht: round2(rows.reduce((s, r) => s + r.wht, 0)),
    usedGrossFallback,
  };
}

// ── สปส.1-10 รายเดือน ────────────────────────────────────────────────────────
export function sso110Rows(items: FilingItem[], emps: FilingEmployee[]): Sso110Result {
  // ★ ตัดเฉพาะคนที่ผู้ใช้ตั้งไว้ว่า "ไม่ใช่ผู้ประกันตน" — ไม่ได้ตัดตามยอดเงิน
  const insured = byEmpId(items).filter((it) => empOf(emps, it.empId)?.ssoExempt !== true);

  const rows: Sso110Row[] = insured.map((it, i) => {
    const e = empOf(emps, it.empId);
    return {
      seq: i + 1,
      empId: it.empId,
      name: it.empName || e?.name || "",
      ssoRef: e?.ssoNo || e?.nationalId || "",
      wage: round2(ssoWageOf(it)),
      sso: round2(n(it.sso)),
    };
  });

  const totalEmployee = round2(rows.reduce((s, r) => s + r.sso, 0));
  const totalEmployer = round2(insured.reduce((s, it) => s + n(it.ssoEmployer), 0));

  return {
    rows,
    count: rows.length,
    totalWage: round2(rows.reduce((s, r) => s + r.wage, 0)),
    totalEmployee,
    totalEmployer,
    grandTotal: round2(totalEmployee + totalEmployer),
  };
}

// ── ภ.ง.ด.1ก รายปี ───────────────────────────────────────────────────────────
export function pnd1kRows(yearItems: FilingItem[], emps: FilingEmployee[]): Pnd1kResult {
  let usedGrossFallback = false;
  const agg = new Map<string, { name: string; income: number; wht: number; periods: number }>();

  for (const it of yearItems) {
    const base = taxBaseOf(it);
    if (base.fallback) usedGrossFallback = true;
    const cur = agg.get(it.empId) ?? { name: it.empName, income: 0, wht: 0, periods: 0 };
    cur.income += base.value;
    cur.wht += n(it.wht);
    cur.periods += 1;
    // ชื่อล่าสุดชนะ (คนเปลี่ยนนามสกุลกลางปี — เอกสารสิ้นปีควรเป็นชื่อปัจจุบัน)
    if (it.empName) cur.name = it.empName;
    agg.set(it.empId, cur);
  }

  const rows: Pnd1kRow[] = [...agg.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([empId, v], i) => ({
      seq: i + 1,
      empId,
      name: v.name || empOf(emps, empId)?.name || "",
      nationalId: empOf(emps, empId)?.nationalId ?? "",
      income: round2(v.income),
      wht: round2(v.wht),
      periods: v.periods,
    }));

  return {
    rows,
    count: rows.length,
    countWithTax: rows.filter((r) => r.wht > 0).length,
    totalIncome: round2(rows.reduce((s, r) => s + r.income, 0)),
    totalWht: round2(rows.reduce((s, r) => s + r.wht, 0)),
    usedGrossFallback,
  };
}

// ── 50 ทวิ (รายคน/ปี) ────────────────────────────────────────────────────────
/**
 * ยอดทั้งปีของพนักงาน 1 คน สำหรับเติมลงหนังสือรับรองการหักภาษี ณ ที่จ่าย
 * ★ ออกให้ได้แม้ `wht` เป็น 0 — ม.50 ทวิ ไม่ได้ยกเว้นกรณีไม่มีภาษี
 *   และลูกจ้างต้องใช้ใบนี้ไปยื่น ภงด.91 ของตัวเอง
 */
export function wht50Totals(
  yearItems: FilingItem[],
  empId: string,
): { income: number; wht: number; sso: number; periods: number; usedGrossFallback: boolean } {
  const mine = yearItems.filter((it) => it.empId === empId);
  let usedGrossFallback = false;
  let income = 0;
  for (const it of mine) {
    const base = taxBaseOf(it);
    if (base.fallback) usedGrossFallback = true;
    income += base.value;
  }
  return {
    income: round2(income),
    wht: round2(mine.reduce((s, it) => s + n(it.wht), 0)),
    sso: round2(mine.reduce((s, it) => s + n(it.sso), 0)),
    periods: mine.length,
    usedGrossFallback,
  };
}

/** ปี พ.ศ. จากปี ค.ศ. (ระบบเก็บ period เป็น ค.ศ. ทั้งหมด — เอกสารราชการใช้ พ.ศ.) */
export function yearBEfromCE(yearCE: number): number {
  return yearCE + 543;
}
