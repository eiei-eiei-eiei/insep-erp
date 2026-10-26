/**
 * lib/shared/moduleScope — ส่วนไหนของหน้าจอเป็นของโมดูลไหน (D133)
 *
 * ที่มา: ลูกค้าที่ไม่ได้ทำโรงเหล้า (ซื้อแค่บัญชี/ขาย/เงินเดือน) เห็นของฝั่งผลิต/บาร์แล้วงงเปล่า ๆ
 *   เช่น หน้าตั้งค่ากลางให้กรอกเลขทะเบียนสรรพสามิต · บทบาท "พนักงานบาร์" · ตารางผลิตในประวัติการแก้ไข
 *   · หมวดรายจ่าย "วัตถุดิบผลิตสุรา" ในดร็อปดาวน์บัญชี
 *
 * ★ ตัดสินที่นี่ที่เดียว (มีเทสคุม) — หน้าจอถามแค่ "โชว์ไหม" ไม่ไล่เช็คชื่อโมดูลเอง (D84)
 * ★ fail-open ตาม `hasModule()` — อ่านโมดูลไม่ได้ = โชว์ครบ (D53: เห็นเกินดีกว่าล็อกลูกค้าออกจากของที่จ่ายแล้ว)
 * 🚨 ซ่อนแค่บนจอ **ไม่ลบค่า** — ค่าเดิมในแถวยังถูกส่งกลับตอนบันทึก (เช่น excise_id ของลูกค้าที่เลิกใช้โมดูลผลิต)
 */
import { hasModule, type ModuleKey } from "./workspaces";
import { ROLES, ROLE_CAPS, type Role } from "./roles";
import { AUDITED_TABLES, type TenantTable } from "./tenantTables";

/** ช่อง/การ์ดในหน้า ตั้งค่า → กิจการ ที่เป็นของโมดูลเดียว (ข้อมูลพื้นฐานของกิจการโชว์เสมอ) */
export type CompanySections = {
  /** เลขทะเบียนสรรพสามิต — ขึ้นหัวฟอร์ม ภส. + ธงเตือนงบเดือน (D92) */
  excise: boolean;
  /** วิธียื่นแบบภาษี — ใช้คิดวันเตือน ภพ.30/ภงด. ของแอปบัญชี (D95) */
  filingMethod: boolean;
  /** เลขที่บัญชีนายจ้าง สปส. — ขึ้นหัว สปส.1-10 ของแอปเงินเดือน (D69) */
  ssoEmployer: boolean;
  /** ช่องทางโอนเงิน + ตัวอย่างหัวกระดาษ + ผู้ออกเอกสารการค้า + กิจการ/บัญชีรับรายได้ขาย */
  salesDocs: boolean;
};

export function companySectionsFor(modules: string[] | null | undefined): CompanySections {
  return {
    excise: hasModule(modules, "production"),
    filingMethod: hasModule(modules, "accounting"),
    ssoEmployer: hasModule(modules, "payroll"),
    salesDocs: hasModule(modules, "sales"),
  };
}

/** โดเมนของ cap → โมดูล · `admin` ไม่ผูกโมดูล */
const CAP_MODULE: Record<string, ModuleKey | null> = {
  prod: "production",
  acct: "accounting",
  sales: "sales",
  pay: "payroll",
  bar: "bar",
  admin: null,
};

/**
 * บทบาทที่ให้เลือกตอนสร้าง/เปลี่ยนสิทธิ์ผู้ใช้
 * · บทบาทที่มี `admin` (เจ้าของกิจการ) โชว์เสมอ
 * · นอกนั้นโชว์เมื่อมี cap อย่างน้อยหนึ่งตัวที่โมดูลเปิดอยู่ (viewer/ผู้จัดการการเงิน ผ่านด้วยโมดูลใดโมดูลหนึ่ง)
 * ★ `keep` = บทบาทปัจจุบันของผู้ใช้ที่กำลังแก้ ต้องอยู่ในลิสต์เสมอ (ไม่งั้น Select โชว์ค่าว่าง
 *   แล้วกดบันทึก = เปลี่ยนบทบาทเงียบ ๆ · แพตเทิร์น `accountsFor` D125)
 */
export function rolesFor(modules: string[] | null | undefined, keep?: string | null): Role[] {
  return ROLES.filter((r) => {
    if (keep && r === keep) return true;
    return ROLE_CAPS[r].some((c) => {
      const m = CAP_MODULE[c.split(".")[0]];
      return m === null || (m !== undefined && hasModule(modules, m));
    });
  });
}

/**
 * ตารางใน ประวัติการแก้ไข → โมดูล · null = ของกลาง (กิจการ · คู่ค้า · เลขเอกสาร) โชว์เสมอ
 * 🚨 ทุกตารางใน AUDITED_TABLES ต้องตอบได้ (เทสไล่ครบ) — ตารางใหม่ที่ไม่เข้ากฎ = โยน error ให้เห็นตอนเทส
 */
export function auditTableModule(t: TenantTable): ModuleKey | null {
  if (t.startsWith("bar_")) return "bar";
  if (t.startsWith("log_") || t === "products" || t === "materials" || t === "containers") return "production";
  if (t.startsWith("pay_") || t === "payroll_items" || t === "employees") return "payroll";
  if (t.startsWith("sales_")) return "sales";
  if (t === "transactions" || t === "bank_accounts") return "accounting";
  if (t === "entities" || t === "contacts" || t === "doc_numbering") return null;
  throw new Error(`ยังไม่ได้กำหนดโมดูลของตาราง ${t} (lib/shared/moduleScope.ts)`);
}

/** ตารางที่ให้กรองในหน้าประวัติการแก้ไข */
export function auditTablesFor(modules: string[] | null | undefined): TenantTable[] {
  return AUDITED_TABLES.filter((t) => {
    const m = auditTableModule(t);
    return m === null || hasModule(modules, m);
  });
}

/**
 * สิ่งที่ระบบส่งเข้ากลุ่ม LINE — ตามโมดูลที่ซื้อ (คำอธิบายบนการ์ด ตั้งค่า → แจ้งเตือน)
 * 🪤 เดิมเขียนตายตัวว่า "ออเดอร์ใหม่ · รับเงิน · จัดส่ง" = ลูกค้าที่ซื้อแค่บัญชีอ่านแล้วนึกว่าไม่เกี่ยวกับตัวเอง
 *    ทั้งที่การเตือนกำหนดยื่นภาษีก็ส่งทางนี้ (D88)
 */
export function lineEventsFor(modules: string[] | null | undefined): string[] {
  const out: string[] = [];
  if (hasModule(modules, "sales")) out.push("ออเดอร์ใหม่ · แก้ไขออเดอร์ · รับเงิน · จัดส่ง");
  if (hasModule(modules, "accounting")) out.push("เตือนกำหนดยื่น ภพ.30 / ภงด.3/53");
  if (hasModule(modules, "production")) out.push("เตือนกำหนดยื่นงบเดือนสรรพสามิต");
  if (hasModule(modules, "bar")) out.push("เตือนวันที่ยอดขายบาร์ยังไม่ได้ลงบัญชี");
  return out;
}
