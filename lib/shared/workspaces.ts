/**
 * 4 พื้นที่ทำงาน (workspace) ตาม FLOW_REDESIGN sec 2
 * — แทนการแบ่ง "3 แอป" เดิม (ผลิต/ขาย/บัญชี) + เพิ่ม workspace รายงานราชการ (แก้ T7)
 * role คุมว่าเห็น workspace ไหน (FLOW_REDESIGN sec 7 บรรทัดสุดท้าย)
 */
export type Role = "main" | "viewer" | "sale" | "warehouse";

export type Workspace = {
  key: string;
  label: string;
  href: string;
  icon: string;
  /** role ที่เห็น workspace นี้ (main เห็นหมดเสมอ) */
  roles: Role[];
};

export const WORKSPACES: Workspace[] = [
  {
    key: "production",
    label: "ผลิต",
    href: "/production",
    icon: "🏭",
    roles: ["main", "viewer"],
  },
  {
    key: "sales",
    label: "ขาย",
    href: "/sales",
    icon: "🛒",
    roles: ["main", "viewer", "sale", "warehouse"],
  },
  {
    key: "accounting",
    label: "บัญชี",
    href: "/accounting",
    icon: "📒",
    roles: ["main", "viewer"],
  },
  {
    key: "reports",
    label: "รายงานราชการ",
    href: "/reports",
    icon: "📄",
    roles: ["main", "viewer"],
  },
];

export function workspacesFor(role: Role): Workspace[] {
  if (role === "main") return WORKSPACES;
  return WORKSPACES.filter((w) => w.roles.includes(role));
}

export const ROLE_LABEL: Record<Role, string> = {
  main: "เจ้าของกิจการ",
  viewer: "ผู้ดูข้อมูล",
  sale: "ฝ่ายขาย",
  warehouse: "คลังสินค้า",
};
