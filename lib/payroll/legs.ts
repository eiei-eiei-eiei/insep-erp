import type { PayPostLeg } from "./types";

/**
 * lib/payroll/legs — ยอดของ "ขาลงบัญชี" ที่ลูกค้าตั้งเอง
 *
 * ของเดิมล็อกไว้ 3 ขาในโค้ด (สุทธิ/ประกันสังคม/ภาษี) แต่แต่ละเจ้าอยากแยกไม่เหมือนกัน
 * → ตอนนี้ขาเป็นข้อมูล · ไฟล์นี้แปลง "ขา" เป็น "ยอด" อย่างเดียว
 *
 * 🚨 กับดักใหญ่ของการเปิดให้ตั้งขาเอง: **ขาซ้อนกันได้**
 *    ตั้งขา 'โอที' เพิ่มทั้งที่โอทีอยู่ในยอดสุทธิอยู่แล้ว = ลงรายจ่ายซ้ำ
 *    และไม่มีอะไรใน DB ฟ้อง → ใช้ `legCoverage()` โชว์ตัวเลขคุมบนหน้าจอเสมอ
 */

/** ยอดของพนักงาน 1 คนที่ขาใช้อ้างอิง (มาจากผลคำนวณที่แช่ไว้แล้ว) */
export type LegLine = {
  gross: number;
  net: number;
  sso: number;
  ssoEmployer: number;
  wht: number;
  items: { code: string; kind: "earning" | "deduction"; amount: number }[];
};

/** ยอดของขานี้สำหรับพนักงาน 1 คน */
export function legAmount(leg: PayPostLeg, line: LegLine): number {
  switch (leg.amountSource) {
    case "net": return n(line.net);
    case "gross": return n(line.gross);
    case "sso_employee": return n(line.sso);
    case "sso_employer": return n(line.ssoEmployer);
    case "sso_total": return n(line.sso) + n(line.ssoEmployer);
    case "wht": return n(line.wht);
    case "component": {
      const c = (line.items ?? []).find((i) => i.code === leg.componentCode);
      return c ? n(c.amount) : 0;
    }
    default: return 0;
  }
}

/** ยอดรวมของขานี้ทั้งงวด */
export function legTotal(leg: PayPostLeg, lines: LegLine[]): number {
  return lines.reduce((s, l) => s + legAmount(leg, l), 0);
}

/**
 * ตัวเลขคุมว่า "ขาที่ตั้งไว้ครอบเงินที่บริษัทจ่ายจริงพอดีไหม"
 *
 * `shouldBe` = รวมเงินได้ + เงินสมทบฝั่งนายจ้าง
 *   คือเงินที่บริษัทควรบันทึกเป็นรายจ่ายทั้งหมดของงวดนั้น
 *   (ยอดสุทธิ + ประกันสังคมลูกจ้าง + ภาษี = รวมเงินได้ พอดี เพราะ 2 ตัวหลังคือส่วนที่หักไว้
 *    แล้วนำส่งแทนลูกจ้าง — เงินออกจากบริษัทเท่ากันทั้งก้อน)
 *
 * ต่างกัน → เตือน **ไม่บล็อก** เพราะบางเจ้าอาจตั้งใจไม่ลงบางส่วน
 */
export function legCoverage(
  legs: PayPostLeg[],
  lines: LegLine[],
): { legsTotal: number; shouldBe: number; diff: number; ok: boolean } {
  const active = legs.filter((l) => l.active !== false);
  const legsTotal = active.reduce((s, l) => s + legTotal(l, lines), 0);
  const shouldBe = lines.reduce((s, l) => s + n(l.gross) + n(l.ssoEmployer), 0);
  const diff = round2(legsTotal - shouldBe);
  return { legsTotal: round2(legsTotal), shouldBe: round2(shouldBe), diff, ok: Math.abs(diff) < 0.005 };
}

/** วันที่แนะนำของขา = สิ้นงวด + n วัน · 0 = วันจ่ายเงินเดือนของงวด */
export function suggestLegDate(
  leg: PayPostLeg,
  period: { year: number; month: number; payDate?: string | null },
): string {
  const day = n(leg.suggestDay);
  if (day <= 0) return period.payDate ?? lastDayISO(period.year, period.month);
  const end = new Date(Date.UTC(period.year, period.month, 0));
  end.setUTCDate(end.getUTCDate() + day);
  return end.toISOString().slice(0, 10);
}

function lastDayISO(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
