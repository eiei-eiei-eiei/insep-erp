import { can, type Cap, type Role } from "./roles";

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
  /**
   * ความสามารถที่ต้องมีถึงจะเห็นแท็บนี้ (ไม่ระบุ = ใครเข้า workspace นี้ได้ก็เห็น)
   * ★ ใช้กับแท็บที่ทำอะไรได้มากกว่าคนอื่น — โดยเฉพาะ **แท็บตั้งค่าของแต่ละโดเมน**
   */
  cap?: Cap;
  /**
   * D78 — แท็บนี้เกี่ยวกับ "ประเภทสุรา" ไหน (ไม่ระบุ = เห็นเสมอ)
   * โรงที่ทำแต่สุรากลั่นไม่ต้องเห็นแท็บของสุราแช่ และกลับกัน
   * ★ ตัดสินจาก **สินค้าจริงใน products** ไม่ใช่ธงแพ็กเกจ (หลักเดียวกับ D51)
   */
  process?: string;
};

/** ผลิต — ลำดับตรงกับแถบแท็บใน ProductionApp */
export const PRODUCTION_TABS: SubTab[] = [
  { slug: "board", label: "กระดาน batch" },
  { slug: "material", label: "วัตถุดิบ" },
  { slug: "ferment", label: "ลงหมัก" },
  { slug: "monitor", label: "ติดตามหมัก" },
  { slug: "distill", label: "กลั่น", process: "สุรากลั่น" },
  { slug: "dilute", label: "ปรุง/ปรับดีกรี", process: "สุรากลั่น" },
  { slug: "draw", label: "รินน้ำสุราแช่", process: "สุราแช่" },
  { slug: "pack", label: "บรรจุ/จ่าย" },
  { slug: "history", label: "ประวัติ/เทียบ" },
  { slug: "stock", label: "สต็อก" },
  { slug: "excise", label: "รายงานสรรพสามิต" },
  { slug: "master", label: "จัดการข้อมูล", cap: "prod.write" },
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
  { slug: "settings", label: "ตั้งค่า", cap: "acct.config" },
];

/**
 * ขาย — ที่นี่ slug = key เดิมของ SalesApp อยู่แล้ว (`create`/`orders`/…)
 * role คุมว่าเห็นแท็บไหน (เดิมอยู่ในฟังก์ชัน tabsForRole ของ SalesApp)
 */
export const SALES_TABS: SubTab[] = [
  { slug: "create", label: "＋ สร้างใบเสนอราคา", cap: "sales.write" },
  // D86 — ขายหน้าร้าน (POS) · 🪤 ห้ามย้ายไปเป็นตัวแรก: SalesApp ใช้ allowed[0]
  //       เป็นแท็บปริยาย → วางแรกเมื่อไหร่ หน้าแรกของทุกคนเปลี่ยนทันที
  { slug: "pos", label: "ขายหน้าร้าน", cap: "sales.write" },
  { slug: "orders", label: "จัดการออเดอร์" },
  { slug: "warehouse", label: "คลังจัดส่ง", cap: "sales.write" },
  { slug: "sync", label: "ประวัติเชื่อมระบบ", cap: "sales.write" },
  { slug: "manage", label: "จัดการข้อมูล", cap: "sales.config" },
];

/** เงินเดือน — เข้าได้ต้องมี `pay.read` อยู่แล้ว · แท็บตั้งค่าการคำนวณต้อง `pay.config` เพิ่ม */
export const PAYROLL_TABS: SubTab[] = [
  { slug: "period", label: "งวดจ่าย" },
  { slug: "report", label: "รายงาน" },
  { slug: "filing", label: "เอกสารยื่น" },
  { slug: "employees", label: "พนักงาน" },
  { slug: "config", label: "ตั้งค่าการคำนวณ", cap: "pay.config" },
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
  { slug: "history", label: "ประวัติการแก้ไข", href: "/settings/history" },
  { slug: "data", label: "สำรองข้อมูล", href: "/settings/data" },
];

/**
 * แท็บที่ role นี้เห็น (workspace ที่ไม่กรอง role = เห็นครบ)
 * processes = ประเภทสุราที่มีสินค้าจริงในระบบ (D78)
 *   · ไม่ส่งมา หรือส่งมาเป็นเซ็ตว่าง → **เห็นครบ** (ระบบเปล่าที่ยังไม่มีสินค้าต้องไม่หายทั้งแท็บ)
 */
export function tabsFor(workspaceKey: string, role: Role, processes?: string[]): SubTab[] {
  const set = processes && processes.length > 0 ? new Set(processes) : null;
  return (WORKSPACE_TABS[workspaceKey] ?? []).filter(
    (t) => (!t.cap || can(role, t.cap)) && (!set || !t.process || set.has(t.process)),
  );
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
export function navSubItems(workspaceKey: string, role: Role, processes?: string[]): { label: string; href: string }[] {
  if (workspaceKey === "settings") {
    return SETTINGS_TABS.map((t) => ({ label: t.label, href: t.href }));
  }
  return tabsFor(workspaceKey, role, processes).map((t) => ({
    label: t.label,
    href: `/${workspaceKey}?tab=${t.slug}`,
  }));
}
