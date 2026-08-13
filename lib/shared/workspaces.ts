/**
 * 4 พื้นที่ทำงาน (workspace) ตาม FLOW_REDESIGN sec 2
 * — แทนการแบ่ง "3 แอป" เดิม (ผลิต/ขาย/บัญชี) + เพิ่ม workspace รายงานราชการ (แก้ T7)
 * role คุมว่าเห็น workspace ไหน (FLOW_REDESIGN sec 7 บรรทัดสุดท้าย)
 */
export type Role = "main" | "viewer" | "sale" | "warehouse";

/** โมดูลที่ขายแยกกันได้ (tenants.modules_enabled) — 7 SKU ประกอบจาก 3 ตัวนี้ */
export const MODULES = ["production", "accounting", "sales"] as const;
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
  /** role ที่เห็น workspace นี้ (main เห็นหมดเสมอ) */
  roles: Role[];
  /** โมดูลที่ต้องซื้อถึงจะเห็น workspace นี้ */
  module: ModuleKey;
};

export const WORKSPACES: Workspace[] = [
  {
    key: "production",
    label: "ผลิต",
    href: "/production",
    icon: "🏭",
    roles: ["main", "viewer"],
    module: "production",
  },
  {
    key: "sales",
    label: "ขาย",
    href: "/sales",
    icon: "🛒",
    roles: ["main", "viewer", "sale", "warehouse"],
    module: "sales",
  },
  {
    key: "accounting",
    label: "บัญชี",
    href: "/accounting",
    icon: "📒",
    roles: ["main", "viewer"],
    module: "accounting",
  },
  {
    // ★ รายงานราชการผูกกับโมดูล "ผลิต" — ฟอร์ม ภส. เป็นเอกสารของโรงกลั่น
    //   (ภพ.30/ภงด./50ทวิ อยู่ในแท็บสรรพากรของโดเมนบัญชี ไม่ได้อยู่ที่นี่)
    key: "reports",
    label: "รายงานราชการ",
    href: "/reports",
    icon: "📄",
    roles: ["main", "viewer"],
    module: "production",
  },
];

/** โมดูลนี้เปิดใช้อยู่ไหม — ค่าว่าง/อ่านไม่ได้ = เปิดหมด (ดูเหตุผล fail-open ที่ ALL_MODULES) */
export function hasModule(modules: string[] | null | undefined, key: ModuleKey): boolean {
  if (!modules || modules.length === 0) return true;
  return modules.includes(key);
}

/**
 * workspace ที่ผู้ใช้คนนี้เห็น — กรอง 2 ชั้น: **role** (ทำอะไรได้) × **โมดูล** (ซื้ออะไรไว้)
 *
 * ★ role `main` เห็นทุก workspace ที่ "ซื้อไว้" — ไม่ใช่ทุก workspace ที่มีในระบบ
 *   (ของเดิม main ลัดผ่านตัวกรองทั้งหมด ถ้าไม่แก้ เจ้าของกิจการที่ซื้อแค่โมดูลผลิต
 *    จะยังเห็นเมนูบัญชี/ขายที่ไม่ได้จ่าย)
 */
export function workspacesFor(role: Role, modules?: string[] | null): Workspace[] {
  return WORKSPACES.filter(
    (w) => (role === "main" || w.roles.includes(role)) && hasModule(modules, w.module),
  );
}

export const ROLE_LABEL: Record<Role, string> = {
  main: "เจ้าของกิจการ",
  viewer: "ผู้ดูข้อมูล",
  sale: "ฝ่ายขาย",
  warehouse: "คลังสินค้า",
};
