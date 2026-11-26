/**
 * lib/payroll/periodView — กฎว่า "หน้างวดจ่ายจะโชว์ตัวเลขไหน"
 *
 * 🚨 กฎนี้พลาดมาแล้ว 2 รอบ จึงถูกดึงออกมาเป็นฟังก์ชันที่มีเทสคุม:
 *   · D73 — เคยคิดสดทุกแถวเสมอ → ลบรายการเพิ่มทิ้งแล้วหน้างวดเปลี่ยนทันที
 *           แต่แท็บรายงาน (อ่านค่าที่แช่ไว้) ไม่เปลี่ยน = สองหน้าจอขัดกันเอง
 *   · D75 — พอแก้เป็น "โชว์ค่าที่แช่ไว้" ผู้ใช้แก้ฐานเงินเดือนในทะเบียนพนักงาน
 *           แล้วเปิดงวดร่างมาดู เห็นยอดเดิม เลยเข้าใจว่า **คำนวณผิด**
 *
 * ทางออกที่ใช้: **เลือกตามสถานะของงวด แล้วโชว์อีกค่าคู่กันเมื่อไม่ตรง**
 * — ไม่ใช่เลือกอันใดอันหนึ่งแล้วให้ผู้ใช้เดาว่ากำลังดูเลขเวอร์ชันไหนอยู่
 */
import type { Employee, PayrollLine } from "./types";

/**
 * ตัวเลขที่เอาไปแสดงของแถวหนึ่ง
 *
 * | งวด | ใช้ | เพราะ |
 * |---|---|---|
 * | ลงบัญชีแล้ว | ค่าที่แช่ไว้ | เป็นบันทึกทางประวัติศาสตร์ ต้องตรงกับที่ยื่น/ลงบัญชี · แก้ไม่ได้อยู่แล้ว |
 * | ร่าง | ค่าที่คิดสด | ยังทำงานอยู่ — แก้เกณฑ์/ทะเบียนพนักงานแล้วต้องเห็นผลทันที |
 *
 * ★ งวดที่ลงบัญชีแล้วแต่ยังไม่มีค่าแช่ไว้ (ไม่ควรเกิด) → ใช้ค่าสดกันหน้าว่าง
 */
export function shownLine(
  locked: boolean,
  stored: PayrollLine | null,
  live: PayrollLine | undefined,
): PayrollLine | undefined {
  return locked && stored ? stored : live;
}

/**
 * ค่าที่แช่ไว้ **ต่างจากที่กำลังแสดง** ไหม — ต่างเมื่อไหร่ต้องโชว์คู่กันบนหน้าจอ
 * ★ เทียบแค่ `net` กับ `gross` พอ (สองตัวนี้ขยับ = อะไรข้างในก็ขยับ) และปัด 2 ตำแหน่ง
 *   ก่อนเทียบ ไม่งั้นเศษทศนิยมจากการคิดสดจะทำให้เตือนทั้งที่ยอดจริงเท่ากัน
 */
export function differsFromStored(
  stored: PayrollLine | null,
  shown: PayrollLine | undefined,
): boolean {
  if (!stored || !shown) return false;
  return round2(stored.net) !== round2(shown.net) || round2(stored.gross) !== round2(shown.gross);
}

export function round2(x: number): number {
  return Math.round((Number(x) || 0) * 100) / 100;
}

/**
 * ประกอบ `Employee` ให้ engine จากทะเบียนพนักงาน
 *
 * 🚨 **ต้องมีที่เดียวและใช้ทั้งฝั่งพรีวิวและฝั่งบันทึก**
 *    เดิมแยกกันเขียน 2 ที่ (`PeriodTab.empOf` กับ `actions.calcLine`) แล้ว **ประกอบไม่เหมือนกัน**:
 *    ฝั่งพรีวิวใช้ `groupCode` ที่ **แช่ไว้ในแถวงวด** ส่วนฝั่งบันทึกใช้กลุ่ม**ปัจจุบัน**
 *    → ย้ายพนักงานข้ามกลุ่มหลังสร้างงวด แล้วรายการที่ให้เฉพาะกลุ่มจะเข้า/ไม่เข้าไม่ตรงกัน
 *      = ยอดบนจอกับยอดที่บันทึกจริงคนละตัว โดยไม่มีอะไรฟ้อง
 *    (ตระกูลเดียวกับที่หัวไฟล์ `PeriodTab` เตือนเรื่องเขียนสูตรซ้ำ 2 ที่ —
 *     คราวนี้สูตรใช้ตัวเดียวกัน แต่ **ของที่ป้อนเข้าสูตร** ต่างกัน)
 *
 * ★ ใช้ค่าจากทะเบียน**ปัจจุบัน**ทั้งหมด สอดคล้องกับกติกา D75
 *   (ตัวเลขที่ยื่นไปแล้วไม่ขยับ เพราะงวดที่ลงบัญชีแล้วโชว์/ใช้ค่าที่แช่ไว้ และแก้ไม่ได้)
 */
export function employeeForCalc(e: {
  empId: string;
  name: string;
  groupCode?: string | null;
  wageType: Employee["wageType"];
  baseWage: number;
  ssoExempt?: boolean;
  whtMode: Employee["whtMode"];
  whtFixed?: number;
  taxAllowances?: Employee["taxAllowances"];
}): Employee {
  return {
    empId: e.empId,
    name: e.name,
    groupCode: e.groupCode ?? null,
    wageType: e.wageType,
    baseWage: Number(e.baseWage),
    ssoExempt: e.ssoExempt,
    whtMode: e.whtMode,
    whtFixed: Number(e.whtFixed ?? 0),
    taxAllowances: e.taxAllowances ?? {},
  };
}

/**
 * ค่าช่องกรอกที่ยกจากงวดก่อนให้แถวใหม่ (D152)
 * ★ เฉพาะช่องที่เปิดไว้ · ค่า 0/ว่างไม่ยก (ไม่มีอะไรต้องจำ)
 */
export function carriedValues(
  carryCodes: string[],
  prev: Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const code of carryCodes) {
    const v = Number(prev?.[code]);
    if (v) out[code] = v;
  }
  return out;
}

/**
 * คนที่วันทำงานเกินวันมาตรฐาน — เฉพาะแบบลดตามวันมาทำงาน
 * ★ `daily` ไม่นับ: ค่าแรงรายวันไม่ได้ใช้วันมาตรฐานเป็นตัวหาร ทำงานเกินวันที่ตั้งไว้ได้ตามจริง
 * ★ `monthly` ไม่นับ: เงินเดือนเหมาไม่ขึ้นกับวันทำงาน
 */
export function overStdEmpIds(
  rows: { empId: string; wageType?: Employee["wageType"]; workDays: number }[],
  std: number,
): string[] {
  return rows.filter((r) => r.wageType === "monthly_prorate" && Number(r.workDays) > Number(std)).map((r) => r.empId);
}

/** ข้อความหลังเปลี่ยนวันมาตรฐาน — null = ไม่มีแถวไหนกระทบ */
export function rebaseNotice(rebased: number, kept: number, std: number): string | null {
  if (rebased === 0 && kept === 0) return null;
  const parts = [`เปลี่ยนวันทำงานมาตรฐานเป็น ${std} วันแล้ว`];
  if (rebased > 0) parts.push(`ปรับวันทำงานตาม ${rebased} คน`);
  if (kept > 0) parts.push(`คงค่าที่กรอกไว้ ${kept} คน ตรวจแถวเหล่านั้นอีกครั้ง`);
  return parts.join(" · ");
}

/**
 * คำกำกับใต้ตารางงวด — บอกว่า **ตัวเลขที่เห็นอยู่คือเวอร์ชันไหน**
 *
 * 🚨 ต้องตัดสินจาก `locked` ตัวเดียวกับที่ `shownLine()` ใช้ — ถ้าประโยคกับตัวเลข
 *    ตัดสินคนละเงื่อนไข จะได้หน้าจอที่ **ตัวเลขถูกแต่คำอธิบายผิด** ซึ่งอันตรายพอกัน
 *    เพราะผู้ใช้สรุปจากประโยค (ตระกูลเดียวกับบั๊กทิศทางของ 0059 · D91)
 *
 * 🪤 อาการของเดิม: ประโยค "ผลคำนวณสด" ถูกแสดง**ทุกกรณี** แม้บนงวดที่ลงบัญชีแล้ว
 *    ซึ่งโชว์ค่าที่แช่ไว้ → คนที่เพิ่งแก้เกณฑ์แล้วมาเปิดงวดที่ยื่นไปแล้วเพื่อตรวจ
 *    จะอ่านว่า "นี่คือค่าสด" แล้วสรุปผิดว่า *เกณฑ์ใหม่ให้ผลเท่าเดิม*
 */
export function tableCaption(locked: boolean): string {
  return locked
    ? "งวดนี้ลงบัญชีแล้ว — ตัวเลขบนตารางคือค่าที่บันทึกไว้ ไม่ใช่ผลคำนวณสด (แก้เกณฑ์ทีหลังจะไม่ทำให้ยอดของงวดนี้ขยับ)"
    : "ตัวเลขบนตารางคือผลคำนวณสด — กดบันทึกเพื่อแช่ค่าไว้ก่อนลงบัญชี";
}

/** ค่าที่กรอกของ 1 แถวในตารางงวด — รูปเดียวกับ `LineInput` ใน payroll/actions.ts (ไม่ import ข้าม "use server") */
export type PeriodDraftLine = {
  workDaysOverride: number | null;
  values: Record<string, number>;
  manual: Record<string, number>;
  whtOverride: number | null;
};

/** เทียบช่องตัวเลขแบบ "ไม่มี key = 0" — กันกรณี NumBox เติม 0 ให้ทั้งที่ผู้ใช้ไม่ได้แก้ */
function sameNums(a: Record<string, number> = {}, b: Record<string, number> = {}): boolean {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if ((Number(a[k]) || 0) !== (Number(b[k]) || 0)) return false;
  }
  return true;
}

/**
 * ตารางงวดเงินเดือนมีค่าที่ "แก้แล้วยังไม่บันทึก" ไหม — ตัวตัดสินของ `useUnsaved` (D173 งานค้าง ข้อ 1)
 *
 * ★ เทียบกับค่าที่โหลดมาตอนเปิดงวด/หลังบันทึก (baseline) ไม่ใช่ดูว่า draft มีค่าหรือไม่
 *   เพราะ draft ถูกเติมจากค่าที่บันทึกไว้ตั้งแต่โหลด (มีค่าเสมอแม้ไม่ได้แก้)
 * 🪤 `setVal` เติม key เป็น 0 ได้ทั้งที่ไม่ได้แก้ → ช่องที่ไม่มี key ถือเป็น 0
 * ★ งวดที่ลงบัญชีแล้ว (locked) = ไม่นับเสมอ (แก้อะไรไม่ได้อยู่แล้ว)
 * ★ แถวที่ไม่มีใน baseline (เช่นเพิ่งเติมพนักงานแต่ยังไม่โหลดใหม่) เทียบกับแถวว่าง
 */
export function periodDraftDirty(
  locked: boolean,
  draft: Record<string, PeriodDraftLine>,
  baseline: Record<string, PeriodDraftLine>,
): boolean {
  if (locked) return false;
  const empty: PeriodDraftLine = { workDaysOverride: null, values: {}, manual: {}, whtOverride: null };
  for (const id of Object.keys(draft)) {
    const d = draft[id];
    const b = baseline[id] ?? empty;
    if ((d.workDaysOverride ?? null) !== (b.workDaysOverride ?? null)) return true;
    if ((d.whtOverride ?? null) !== (b.whtOverride ?? null)) return true;
    if (!sameNums(d.values, b.values) || !sameNums(d.manual, b.manual)) return true;
  }
  return false;
}
