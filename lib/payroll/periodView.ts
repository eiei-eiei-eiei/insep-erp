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
