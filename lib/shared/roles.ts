/**
 * บทบาทผู้ใช้ + ความสามารถ (capability) — **แหล่งเดียวของทั้งระบบ**
 *
 * ── ทำไมต้องเป็น capability ไม่ใช่รายชื่อ role ────────────────────────────────
 * ของเดิมเขียนเงื่อนไขสิทธิ์เป็นรายชื่อ role กระจายทั่วโค้ดและ SQL
 * (`my_role()='main'` อย่างเดียวมี **150 จุดใน 15 ไฟล์ migration**)
 * → เพิ่มบทบาทใหม่ = ต้องไล่แก้ทุกจุด และ**ลืมจุดไหนก็ไม่มีอะไรฟ้อง**
 *   ซึ่งเป็นกลไกเดียวกับที่ทำให้ D84 เกิด (ternary ไล่เช็ค key ที่ else กลืนของใหม่)
 *
 * ตอนนี้: หน้าจอ/RLS ถามว่า "ทำสิ่งนี้ได้ไหม" (`can(role, "acct.write")`)
 * ไม่ใช่ "เป็นใคร" → เพิ่มบทบาทใหม่แก้ที่ `ROLE_CAPS` ที่เดียว
 *
 * 🚨 **ตารางนี้มีฝาแฝดอยู่ในฐานข้อมูล** — ฟังก์ชัน `has_cap()` ใน migration 0051
 *    แก้ที่นี่แล้วต้องแก้ที่นั่นด้วยเสมอ (ฝั่ง DB คือตัวจริงที่บังคับสิทธิ์ · ฝั่งนี้คุมแค่หน้าจอ)
 *
 * ★ ประกาศเป็น `Record<Role, …>` โดยตั้งใจ — เพิ่มบทบาทใหม่ใน ROLES แล้วลืมกำหนด
 *   ความสามารถ/ชื่อไทย จะ **build ไม่ผ่าน** ไม่ใช่ได้สิทธิ์ว่างเปล่าเงียบ ๆ (บทเรียน D84)
 */

/** บทบาททั้งหมด — ต้องตรงกับ CHECK constraint ของ `profiles.role` (migration 0051) */
export const ROLES = [
  "main",
  "viewer",
  "sales_manager",
  "sales",
  "finance_manager",
  "accounting_manager",
  "accounting",
  "payroll_manager",
  "payroll",
] as const;
export type Role = (typeof ROLES)[number];

/**
 * ความสามารถ — `<โดเมน>.<ระดับ>`
 * · `read`   = เปิดดูหน้านั้นและอ่านข้อมูลของโดเมนได้
 * · `write`  = บันทึก/แก้/ลบงานประจำวันของโดเมนได้
 * · `config` = แก้ **เกณฑ์/ข้อมูลตั้งต้น** ของโดเมนนั้น (แท็บตั้งค่าในแต่ละ workspace)
 * · `admin`  = หน้าตั้งค่ากลาง `/settings` (กิจการ · แบรนด์ · LINE · ผู้ใช้ · ประวัติ · สำรองข้อมูล)
 */
export const CAPS = [
  "prod.read",
  "prod.write",
  // D91 — ปิด/ถอนปิดบัญชีสรรพสามิตรายเดือน (ระดับหัวหน้า แบบเดียวกับ sales.config = ยกเลิกออเดอร์)
  // ★ ตอนนี้มีแต่ main ที่ได้ เพราะยังไม่มีบทบาท "หัวหน้าฝ่ายผลิต" — has_cap() ไม่ต้องแก้
  //   (main → true ทุก cap · บทบาทอื่นไม่มีชื่อนี้ในลิสต์ = false เอง)
  "prod.config",
  "acct.read",
  "acct.write",
  "acct.config",
  "sales.read",
  "sales.write",
  "sales.config",
  "pay.read",
  "pay.write",
  "pay.config",
  "admin",
] as const;
export type Cap = (typeof CAPS)[number];

/** ชื่อไทยที่ผู้ใช้เห็นในดร็อปดาวน์ */
export const ROLE_LABEL: Record<Role, string> = {
  main: "เจ้าของกิจการ",
  viewer: "ผู้ดูข้อมูล",
  sales_manager: "หัวหน้าฝ่ายขาย/คลัง",
  sales: "ฝ่ายขาย/คลัง",
  finance_manager: "ผู้จัดการการเงิน",
  accounting_manager: "หัวหน้าบัญชี",
  accounting: "พนักงานบัญชี",
  payroll_manager: "หัวหน้าฝ่ายบุคคล",
  payroll: "พนักงานเงินเดือน",
};

/** คำอธิบายใต้ตัวเลือก — 9 บทบาทเยอะพอที่จะเดาผิด ต้องบอกตรง ๆ ว่าได้/ไม่ได้อะไร */
export const ROLE_HINT: Record<Role, string> = {
  main: "ทุกอย่าง รวมตั้งค่ากลางและจัดการผู้ใช้",
  viewer: "ดูได้ทุกหน้า ยกเว้นเงินเดือน · แก้ไม่ได้เลย",
  sales_manager: "ขาย + คลัง + จัดการข้อมูลของหน้าขาย",
  sales: "ขาย + คลัง · ตั้งค่าไม่ได้",
  finance_manager: "บัญชี + เงินเดือน รวมตั้งค่าของทั้งสองหน้า",
  accounting_manager: "บัญชี + ตั้งค่าหน้าบัญชี",
  accounting: "บัญชี · ตั้งค่าไม่ได้",
  payroll_manager: "เงินเดือน + ตั้งค่าการคำนวณ",
  payroll: "เงินเดือน · ตั้งค่าไม่ได้",
};

/**
 * ตารางบทบาท × ความสามารถ
 *
 * 🚨 แก้ตารางนี้ = เปลี่ยนสิทธิ์จริงของคนที่ใช้ระบบอยู่ · `roles.test.ts` ล็อกทั้งตารางไว้เป็น
 *    snapshot โดยตั้งใจ → แก้แล้วเทสพัง = บังคับให้ตัดสินใจอย่างรู้ตัว ไม่ใช่หลุดไปเงียบ ๆ
 *
 * 🪤 **ฝ่ายขายไม่มี `prod.read`** — `prod.read` แปลว่า "เข้าหน้าผลิตได้" ซึ่งฝ่ายขายไม่ควรเห็น
 *    ส่วนตารางที่หน้าขายจำเป็นต้องอ่าน (`products` แคตตาล็อกสินค้า + `stock_product` สต็อก
 *    สินค้าสำเร็จรูป) ฝั่ง DB เปิดให้ **`prod.read` หรือ `sales.read`** อ่านได้ทั้งคู่
 *    → สูตรการผลิต/ค่าดีกรี (`materials` · `log_*`) ยังปิดสนิทจากฝ่ายขาย
 *    🚨 อย่าเผลอเติม `prod.read` ให้ฝ่ายขายเพื่อแก้ปัญหา "หน้าขายอ่านสต็อกไม่ได้" —
 *       นั่นจะเปิดสูตรการผลิตทั้งหมดให้ด้วย · ที่ถูกคือแก้ policy ของตารางนั้น
 */
export const ROLE_CAPS: Record<Role, readonly Cap[]> = {
  main: [...CAPS],
  viewer: ["prod.read", "acct.read", "sales.read"],
  sales_manager: ["sales.read", "sales.write", "sales.config"],
  sales: ["sales.read", "sales.write"],
  finance_manager: [
    "acct.read",
    "acct.write",
    "acct.config",
    "pay.read",
    "pay.write",
    "pay.config",
  ],
  accounting_manager: ["acct.read", "acct.write", "acct.config"],
  accounting: ["acct.read", "acct.write"],
  payroll_manager: ["pay.read", "pay.write", "pay.config"],
  payroll: ["pay.read", "pay.write"],
};

/** บทบาทนี้ทำสิ่งนี้ได้ไหม — ทุกที่ที่ตัดสินสิทธิ์บนหน้าจอต้องผ่านฟังก์ชันนี้ */
export function can(role: Role | null | undefined, cap: Cap): boolean {
  if (!role) return false;
  return (ROLE_CAPS[role] ?? []).includes(cap);
}

/** ทำสิ่งใดสิ่งหนึ่งในลิสต์ได้ไหม (เช่น แท็บที่เปิดให้ทั้งคนอ่านและคนเขียน) */
export function canAny(role: Role | null | undefined, caps: readonly Cap[]): boolean {
  return caps.some((c) => can(role, c));
}

/**
 * ค่าที่อ่านจาก DB → Role ที่โค้ดรู้จัก
 *
 * 🚨 ไม่รู้จัก = `viewer` (สิทธิ์ต่ำสุดที่ยังใช้งานได้) **ห้าม fallback เป็น main**
 *    — ต่างจากธงโมดูลที่ตั้งใจ fail-open เพราะนั่นคือเรื่องแพ็กเกจที่ลูกค้าจ่ายแล้ว
 *      ส่วนนี่คือขอบเขตความปลอดภัย อ่านค่าพลาดต้องปิด ไม่ใช่เปิด
 * ★ รับค่าเก่าก่อน 0051 ด้วย (`sale`/`warehouse` → `sales`) กันจังหวะที่ DB ยังไม่ได้ลง migration
 */
export function toRole(raw: string | null | undefined): Role {
  const v = (raw ?? "").trim();
  if ((ROLES as readonly string[]).includes(v)) return v as Role;
  if (v === "sale" || v === "warehouse") return "sales";
  return "viewer";
}

/**
 * บทบาทที่ทำสิ่งนี้ได้มีใครบ้าง — ใช้เขียนข้อความบอกผู้ใช้ตอนปุ่มถูกปิด
 *
 * 🚨 **ห้ามเขียนชื่อบทบาทตายตัวในข้อความบนจอ** ("ต้องเป็น main") — เพิ่ม/เปลี่ยนบทบาท
 *    เมื่อไร ข้อความนั้นกลายเป็นคำโกหกทันทีโดยไม่มีอะไรฟ้อง (บทเรียน D85 ข้อ 3)
 */
export function rolesWithCap(cap: Cap): Role[] {
  return ROLES.filter((r) => can(r, cap));
}

/** "เจ้าของกิจการ" / "หัวหน้าฝ่ายขาย หรือ เจ้าของกิจการ" — ต่อท้ายข้อความว่าใครกดได้ */
export function capHolderText(cap: Cap): string {
  return rolesWithCap(cap).map((r) => ROLE_LABEL[r]).join(" หรือ ");
}
