/**
 * lib/payroll/report — รวมยอดเงินเดือนข้ามงวด เพื่อดูว่าเงินไปไหนบ้าง
 *
 * ทำไมต้องมีแท็บรายงาน: การลงบัญชีเป็น "ก้อน" (ยอดสุทธิ/นำส่ง) เพื่อไม่ให้บัญชียุ่ง —
 * บัญชีจึงไม่รู้ว่าในก้อนนั้นเป็นเงินเดือนเท่าไร ค่าล่วงเวลาเท่าไร คอมมิชชั่นเท่าไร
 * → รายละเอียดมาดูที่นี่แทน (แยกตามรายการ × รายคน)
 *
 * 🪤 อ่านจาก `payroll_items.computed` ที่ **แช่ค่าไว้ตอนกดบันทึก** เท่านั้น
 *    ห้ามคำนวณสดจาก config ไม่งั้นรายงานของงวดเก่าจะขยับตามเกณฑ์ใหม่
 */

/** 1 แถวของ payroll_items เท่าที่รายงานต้องใช้ */
export type ReportSource = {
  periodId: string;
  empId: string;
  empName: string;
  groupCode?: string | null;
  baseAmount: number;
  gross: number;
  sso: number;
  ssoEmployer: number;
  wht: number;
  net: number;
  items: { code: string; name: string; kind: "earning" | "deduction"; amount: number }[];
};

export type ReportRow = {
  empId: string;
  empName: string;
  groupCode: string | null;
  periods: number;
  baseAmount: number;
  gross: number;
  sso: number;
  ssoEmployer: number;
  wht: number;
  net: number;
  /** ยอดรวมต่อรายการ — key = component code */
  byComponent: Record<string, number>;
};

export type PayrollReport = {
  rows: ReportRow[];
  /** ชื่อรายการที่โผล่ในช่วงนี้ (เรียงตามยอดรวมมากไปน้อย) */
  components: { code: string; name: string; kind: "earning" | "deduction"; total: number }[];
  total: Omit<ReportRow, "empId" | "empName" | "groupCode" | "periods"> & { periods: number };
};

/**
 * รวมยอดต่อพนักงาน + ต่อรายการ
 *
 * ★ ค่าจ้างฐานถูกแยกออกจาก `byComponent` โดยตั้งใจ — มันไม่ใช่ "รายการเพิ่ม"
 *   แต่เป็นตัวตั้งต้น · แสดงเป็นคอลัมน์ของตัวเองในตาราง
 */
export function buildPayrollReport(src: ReportSource[]): PayrollReport {
  const byEmp = new Map<string, ReportRow>();
  const compMeta = new Map<string, { name: string; kind: "earning" | "deduction"; total: number }>();

  for (const s of src) {
    let row = byEmp.get(s.empId);
    if (!row) {
      row = {
        empId: s.empId,
        empName: s.empName,
        groupCode: s.groupCode ?? null,
        periods: 0,
        baseAmount: 0, gross: 0, sso: 0, ssoEmployer: 0, wht: 0, net: 0,
        byComponent: {},
      };
      byEmp.set(s.empId, row);
    }
    row.periods += 1;
    row.baseAmount += n(s.baseAmount);
    row.gross += n(s.gross);
    row.sso += n(s.sso);
    row.ssoEmployer += n(s.ssoEmployer);
    row.wht += n(s.wht);
    row.net += n(s.net);

    for (const it of s.items ?? []) {
      row.byComponent[it.code] = n(row.byComponent[it.code]) + n(it.amount);
      const m = compMeta.get(it.code);
      if (m) m.total += n(it.amount);
      else compMeta.set(it.code, { name: it.name, kind: it.kind, total: n(it.amount) });
    }
  }

  const rows = [...byEmp.values()]
    .map((r) => ({ ...r, ...round(r) }))
    .sort((a, b) => (a.empId < b.empId ? -1 : 1));

  const components = [...compMeta.entries()]
    .map(([code, m]) => ({ code, name: m.name, kind: m.kind, total: round2(m.total) }))
    .sort((a, b) => b.total - a.total);

  const total = {
    periods: src.length,
    baseAmount: round2(sum(rows, "baseAmount")),
    gross: round2(sum(rows, "gross")),
    sso: round2(sum(rows, "sso")),
    ssoEmployer: round2(sum(rows, "ssoEmployer")),
    wht: round2(sum(rows, "wht")),
    net: round2(sum(rows, "net")),
    byComponent: Object.fromEntries(components.map((c) => [c.code, c.total])),
  };

  return { rows, components, total };
}

function round(r: ReportRow) {
  return {
    baseAmount: round2(r.baseAmount),
    gross: round2(r.gross),
    sso: round2(r.sso),
    ssoEmployer: round2(r.ssoEmployer),
    wht: round2(r.wht),
    net: round2(r.net),
    byComponent: Object.fromEntries(Object.entries(r.byComponent).map(([k, v]) => [k, round2(v)])),
  };
}
function sum(rows: ReportRow[], k: "baseAmount" | "gross" | "sso" | "ssoEmployer" | "wht" | "net") {
  return rows.reduce((s, r) => s + r[k], 0);
}
function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
