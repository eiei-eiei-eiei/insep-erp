/**
 * 4 พื้นที่ทำงาน (workspace) — ผลิต / ขาย / บัญชี / เงินเดือน
 *
 * ★ เคยมี workspace ที่ 4 "รายงานราชการ" — ยุบแล้ว (D62): ฟอร์ม ภส. กลายเป็นแท็บ
 *   "รายงานสรรพสามิต" ในผลิต · ภพ.30/ภงด./50ทวิ อยู่แท็บ "เอกสารสรรพากร" ในบัญชีตั้งแต่ D23#7
 *
 * ★ **บทบาท/สิทธิ์ย้ายไป `lib/shared/roles.ts` แล้ว** — ที่นี่ถามแค่ว่า workspace นี้
 *   ต้องมีความสามารถอะไรถึงจะเห็น · re-export `Role`/`ROLE_LABEL` ต่อให้ import เดิมใช้ได้เหมือนเดิม
 */
import { can, type Cap, type Role } from "./roles";

export { ROLES, ROLE_LABEL, ROLE_HINT, ROLE_CAPS, CAPS, can, canAny, toRole } from "./roles";
export type { Role, Cap } from "./roles";

/** โมดูลที่ขายแยกกันได้ (tenants.modules_enabled) — 7 SKU ประกอบจาก 3 ตัวนี้ */
export const MODULES = ["production", "accounting", "sales", "payroll"] as const;
export type ModuleKey = (typeof MODULES)[number];

/** ค่าเริ่มต้นเมื่ออ่านค่าจาก DB ไม่ได้ — เปิดหมด (ตรงกับ default ของคอลัมน์ใน 0025)
 *  ★ ตั้งใจ fail-open เพราะนี่คือสิทธิ์ตามแพ็กเกจ ไม่ใช่ขอบเขตความปลอดภัย
 *    อ่านค่าพลาดแล้วล็อกลูกค้าออกจากระบบที่จ่ายเงินแล้ว แย่กว่าปล่อยให้เห็นเมนูเกิน */
export const ALL_MODULES: ModuleKey[] = [...MODULES];

export type Workspace = {
  key: string;
  label: string;
  href: string;
  icon: string;
  /** ความสามารถที่ต้องมีถึงจะเห็น workspace นี้ (ดู lib/shared/roles.ts) */
  cap: Cap;
  /** โมดูลที่ต้องซื้อถึงจะเห็น workspace นี้ */
  module: ModuleKey;
};

export const WORKSPACES: Workspace[] = [
  // 🚨 เงินเดือนต้องมี `pay.read` — ซึ่ง **viewer ไม่มีโดยตั้งใจ** (เงินเดือนรายคนเป็นข้อมูล
  //    อ่อนไหวที่สุดในระบบ · viewer มักเป็นบัญชีที่แจกให้คนนอกหรือที่ปรึกษาดู)
  //    RLS ของ 0040/0051 กันซ้ำอีกชั้นฝั่ง DB
  {
    key: "production",
    label: "ผลิต",
    href: "/production",
    icon: "🏭",
    cap: "prod.read",
    module: "production",
  },
  {
    key: "sales",
    label: "ขาย",
    href: "/sales",
    icon: "🛒",
    cap: "sales.read",
    module: "sales",
  },
  {
    key: "accounting",
    label: "บัญชี",
    href: "/accounting",
    icon: "📒",
    cap: "acct.read",
    module: "accounting",
  },
  {
    key: "payroll",
    label: "เงินเดือน",
    href: "/payroll",
    icon: "👥",
    cap: "pay.read",
    module: "payroll",
  },
];

/** โมดูลนี้เปิดใช้อยู่ไหม — ค่าว่าง/อ่านไม่ได้ = เปิดหมด (ดูเหตุผล fail-open ที่ ALL_MODULES) */
export function hasModule(modules: string[] | null | undefined, key: ModuleKey): boolean {
  if (!modules || modules.length === 0) return true;
  return modules.includes(key);
}

/**
 * workspace ที่ผู้ใช้คนนี้เห็น — กรอง 2 ชั้น: **สิทธิ์** (ทำอะไรได้) × **โมดูล** (ซื้ออะไรไว้)
 *
 * ★ `main` ไม่ได้ลัดผ่านตัวกรองโมดูล — เห็นทุก workspace ที่ "ซื้อไว้" ไม่ใช่ทุก workspace
 *   ที่มีในระบบ (ไม่งั้นเจ้าของกิจการที่ซื้อแค่โมดูลผลิตจะเห็นเมนูบัญชี/ขายที่ไม่ได้จ่าย)
 *   ส่วนชั้นสิทธิ์ `main` ผ่านเองอยู่แล้วเพราะมีครบทุก cap
 */
export function workspacesFor(role: Role, modules?: string[] | null): Workspace[] {
  return WORKSPACES.filter((w) => can(role, w.cap) && hasModule(modules, w.module));
}

/**
 * เหมือน workspacesFor แต่ **ไม่ตัดตัวที่ยังไม่ได้ซื้อทิ้ง** — ติดธง `locked` มาแทน
 *
 * ใช้ที่หน้าแรกเพื่อให้ลูกค้าเห็นว่า "ยังมีของให้ซื้อเพิ่ม" (กดไม่ได้ แต่เห็น)
 * ส่วนแถบเมนูยังใช้ workspacesFor ตัวเดิมที่ตัดทิ้ง — เมนูที่ใช้ทุกวันต้องสะอาด
 * ไม่ใช่ที่โฆษณา
 *
 * ★ ชั้นสิทธิ์ยังตัดทิ้งเหมือนเดิม — พนักงานขายไม่ควรเห็นว่า "มีโมดูลบัญชีให้ซื้อ"
 *   เพราะไม่ใช่คนตัดสินใจซื้อ และเห็นแล้วสับสนเปล่า ๆ
 */
export function workspacesWithLock(
  role: Role,
  modules?: string[] | null,
): (Workspace & { locked: boolean })[] {
  return WORKSPACES.filter((w) => can(role, w.cap)).map((w) => ({
    ...w,
    locked: !hasModule(modules, w.module),
  }));
}

/**
 * ชื่อไทยของโมดูล — **แหล่งเดียวทั้งระบบ** (ตรงกับ label ของ workspace ที่โมดูลนั้นเปิดให้)
 *
 * 🚨 ห้ามเขียน ternary ไล่เช็ค key เองที่หน้าจอไหนอีก — D84 เจอมาแล้วว่าหน้าแอดมินเขียน
 *    `m === "production" ? "ผลิต" : m === "accounting" ? "บัญชี" : "ขาย"` ไว้ตอนมี 3 โมดูล
 *    พอ D66 เพิ่มโมดูลที่ 4 `payroll` มันตกเข้า else กลายเป็น **"ขาย"** เงียบ ๆ
 *    → ลูกค้าที่ซื้อเงินเดือนดูเหมือนซื้อขาย 2 อัน บนหน้าจอที่ใช้ตัดสินเรื่องเงิน
 *
 * ★ ประกาศเป็น `Record<ModuleKey, string>` โดยตั้งใจ — เพิ่มโมดูลใหม่ใน MODULES แล้วลืมเติมที่นี่
 *   จะ **build ไม่ผ่าน** ไม่ใช่ขึ้นชื่อผิดบนจอ
 */
export const MODULE_LABEL: Record<ModuleKey, string> = {
  production: "ผลิต",
  accounting: "บัญชี",
  sales: "ขาย",
  payroll: "เงินเดือน",
};

