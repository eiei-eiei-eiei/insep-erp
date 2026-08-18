import type { Role } from "./workspaces";

/**
 * ทะเบียนแท็บย่อยของแต่ละ workspace — **แหล่งเดียว** ที่แถบเมนูด้านบนใช้ทำดร็อปดาวน์
 * และที่ตัว workspace ใช้วาดแถบแท็บของตัวเอง
 *
 * ทำไมต้องมี: เดิมแท็บถูกประกาศไว้ใน App component ของแต่ละโดเมนแบบ `useState` ล้วน
 * → แถบเมนูไม่รู้ว่ามีแท็บอะไรบ้าง และลิงก์ตรงเข้าแท็บไม่ได้เลย (กด refresh ก็เด้งกลับแท็บแรก)
 *
 * ★ `slug` เป็น ASCII เสมอ เพราะมันไปโผล่ใน URL (`?tab=distill`)
 *   — ใช้ label ไทยเป็น slug จะโดน percent-encode ยาวเหยียดจนก๊อปลิงก์ส่งกันไม่ไหว
 * ★ `label` ยังเป็นข้อความไทยตัวเดิมเป๊ะ เพราะ App component ใช้ label เป็น key ของ state
 *   (`show("กลั่น")`) — เปลี่ยน label เมื่อไหร่ต้องไล่แก้ทั้งไฟล์นั้นด้วย
 */
export type SubTab = {
  slug: string;
  label: string;
  /** role ที่เห็นแท็บนี้ (ไม่ระบุ = ทุก role ที่เข้า workspace นี้ได้อยู่แล้ว) */
  roles?: Role[];
};

/** ผลิต — ลำดับตรงกับแถบแท็บใน ProductionApp */
export const PRODUCTION_TABS: SubTab[] = [
  { slug: "board", label: "กระดาน batch" },
  { slug: "material", label: "วัตถุดิบ" },
  { slug: "ferment", label: "ลงหมัก" },
  { slug: "monitor", label: "ติดตามหมัก" },
  { slug: "distill", label: "กลั่น" },
  { slug: "dilute", label: "ปรุง/ปรับดีกรี" },
  { slug: "pack", label: "บรรจุ/จ่าย" },
  { slug: "history", label: "ประวัติ/เทียบ" },
  { slug: "stock", label: "สต็อก" },
  { slug: "excise", label: "รายงานสรรพสามิต" },
  { slug: "master", label: "จัดการข้อมูล" },
];

/** บัญชี — ลำดับตรงกับแถบแท็บใน AccountingApp */
export const ACCOUNTING_TABS: SubTab[] = [
  { slug: "entry", label: "บันทึก" },
  { slug: "dashboard", label: "แดชบอร์ด" },
  { slug: "accounts", label: "บัญชี & เงินสด" },
  { slug: "apar", label: "ลูกหนี้-เจ้าหนี้" },
  { slug: "bills", label: "ค้นบิล" },
  { slug: "installments", label: "แบ่งงวด" },
  { slug: "price-history", label: "ประวัติราคา" },
  { slug: "price-check", label: "เช็คราคา" },
  { slug: "tax-docs", label: "เอกสารสรรพากร" },
  { slug: "settings", label: "ตั้งค่า" },
];

/**
 * ขาย — ที่นี่ slug = key เดิมของ SalesApp อยู่แล้ว (`create`/`orders`/…)
 * role คุมว่าเห็นแท็บไหน (เดิมอยู่ในฟังก์ชัน tabsForRole ของ SalesApp)
 */
export const SALES_TABS: SubTab[] = [
  { slug: "create", label: "＋ สร้างใบเสนอราคา", roles: ["main", "sale"] },
  { slug: "orders", label: "จัดการออเดอร์", roles: ["main", "sale", "viewer"] },
  { slug: "warehouse", label: "คลังจัดส่ง", roles: ["main", "warehouse"] },
  { slug: "sync", label: "ประวัติเชื่อมระบบ", roles: ["main", "sale"] },
  { slug: "manage", label: "จัดการข้อมูล", roles: ["main"] },
];

/** เงินเดือน — เปิดเฉพาะ role main (ทั้ง workspace) จึงไม่ต้องกรอง roles รายแท็บ */
export const PAYROLL_TABS: SubTab[] = [
  { slug: "period", label: "งวดจ่าย" },
  { slug: "employees", label: "พนักงาน" },
  { slug: "config", label: "ตั้งค่าการคำนวณ" },
];

export const WORKSPACE_TABS: Record<string, SubTab[]> = {
  production: PRODUCTION_TABS,
  accounting: ACCOUNTING_TABS,
  sales: SALES_TABS,
  payroll: PAYROLL_TABS,
};

/**
 * แท็บของหน้าตั้งค่ากลาง — เป็น **route จริง** ไม่ใช่ ?tab=
 * (แต่ละแท็บดึงข้อมูลคนละชุด แยกหน้าจึงโหลดเฉพาะที่ใช้ · ผู้ใช้ทั้งหมดต้องเป็น role main)
 */
export const SETTINGS_TABS: { slug: string; label: string; href: string }[] = [
  { slug: "company", label: "กิจการ", href: "/settings/company" },
  { slug: "branding", label: "แบรนด์", href: "/settings/branding" },
  { slug: "notify", label: "แจ้งเตือน", href: "/settings/notify" },
  { slug: "users", label: "ผู้ใช้", href: "/settings/users" },
  { slug: "data", label: "สำรองข้อมูล", href: "/settings/data" },
];

/** แท็บที่ role นี้เห็น (workspace ที่ไม่กรอง role = เห็นครบ) */
export function tabsFor(workspaceKey: string, role: Role): SubTab[] {
  return (WORKSPACE_TABS[workspaceKey] ?? []).filter((t) => !t.roles || t.roles.includes(role));
}

/** slug → label · ไม่รู้จัก = null ให้ผู้เรียกใช้ค่าปริยายของตัวเอง (URL แปลก ๆ ต้องไม่ทำให้หน้าว่าง) */
export function labelFromSlug(workspaceKey: string, slug: string | null | undefined): string | null {
  if (!slug) return null;
  return (WORKSPACE_TABS[workspaceKey] ?? []).find((t) => t.slug === slug)?.label ?? null;
}

/** label → slug · ไม่รู้จัก = สตริงว่าง (ผู้เรียกจะได้ไม่เขียน ?tab= ที่ไม่มีความหมายลง URL) */
export function slugFromLabel(workspaceKey: string, label: string): string {
  return (WORKSPACE_TABS[workspaceKey] ?? []).find((t) => t.label === label)?.slug ?? "";
}

/**
 * รายการในดร็อปดาวน์ของแถบเมนู — คืน href พร้อมใช้
 * · workspace ปกติ → `/production?tab=excise`
 * · ตั้งค่า → route จริง `/settings/company`
 */
export function navSubItems(workspaceKey: string, role: Role): { label: string; href: string }[] {
  if (workspaceKey === "settings") {
    return SETTINGS_TABS.map((t) => ({ label: t.label, href: t.href }));
  }
  return tabsFor(workspaceKey, role).map((t) => ({
    label: t.label,
    href: `/${workspaceKey}?tab=${t.slug}`,
  }));
}
