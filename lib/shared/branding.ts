/**
 * แบรนด์ต่อกิจการ (D43) — ชื่อ/สี/โลโก้/โหมดเริ่มต้น
 *
 * ค่าจริงอยู่ในตาราง `app_settings` ของแต่ละ tenant (migration 0022)
 * → อัปเดตโค้ดกี่ครั้งค่าที่ลูกค้าตั้งไว้ก็ไม่หาย เพราะ deploy เปลี่ยนแค่โค้ด ไม่แตะข้อมูล
 *
 * ★ สีสถานะ (ok/warn/crit) ไม่อยู่ที่นี่โดยตั้งใจ — ล็อกตายใน globals.css ทุกราย
 *   เพื่อให้ "เหลือง = มีของค้าง" แปลเหมือนกันทุกโรง ตอนสอนงาน/แก้ปัญหาทางโทรศัพท์
 */

export const BRAND_COLORS = [
  { key: "steel", label: "เหล็ก (ค่าเริ่มต้น)", swatch: "#5b636d" },
  { key: "copper", label: "ทองแดง", swatch: "#b5651d" },
  { key: "green", label: "เขียวไพร", swatch: "#176b4c" },
  { key: "indigo", label: "ครามไทย", swatch: "#34509b" },
  { key: "wine", label: "ไวน์", swatch: "#993455" },
  { key: "teal", label: "เขียวน้ำทะเล", swatch: "#0f6b73" },
  { key: "rust", label: "ส้มอิฐ", swatch: "#a8452a" },
] as const;

export type BrandColor = (typeof BRAND_COLORS)[number]["key"];
export type ColorMode = "light" | "dark";

export type Branding = {
  name: string;
  color: BrandColor;
  logoUrl: string | null;
  defaultMode: ColorMode;
};

export const DEFAULT_BRANDING: Branding = {
  name: "Insep ERP",
  color: "steel",
  logoUrl: null,
  defaultMode: "light",
};

const COLOR_KEYS = new Set<string>(BRAND_COLORS.map((c) => c.key));

/** ชื่อสินค้าที่ต่อท้าย "powered by" บนหน้า login (co-brand) — ยังไม่เคาะชื่อจริง
 *  เก็บไว้ที่เดียวเพื่อให้เปลี่ยนทีหลังจบในบรรทัดนี้บรรทัดเดียว */
export const PRODUCT_NAME = "Insep ERP";

/**
 * คำโปรยใต้ชื่อบนหน้า login **ตอนไม่มี subdomain** (โหมดลิงก์เดียว)
 *
 * ★ ต้องเป็นกลาง ใช้ได้ทั้งกับกิจการเจ้าของระบบเองและลูกค้าที่เปิดลิงก์มาดู
 *   ของเดิมเขียนว่า "ระบบ**ภายใน**โรงกลั่นสุราคราฟต์" ซึ่งเป็นคำของกิจการเจ้าของระบบ
 *   → ลูกค้าที่เปิดลิงก์เดโมมาเห็นแล้วงงว่าเข้าผิดที่รึเปล่า (ยังไม่ซื้อโดเมน จึงยังไม่มี
 *   subdomain ต่อลูกค้า — ทุกคนเห็นหน้านี้หน้าเดียวกันหมด)
 *
 * เคาะชื่อสินค้าจริงเมื่อไหร่ → แก้ที่นี่กับ PRODUCT_NAME จบ ไม่ต้องไล่หาในหน้าจอ
 */
export const PRODUCT_TAGLINE = "ระบบจัดการโรงกลั่นสุราคราฟต์ — ผลิต · บัญชี · ขาย";

/**
 * แถวจาก view `tenant_branding` (migration 0025) → Branding
 *
 * คนละรูปกับ app_settings (ที่นั่นเก็บเป็น kind/value รายแถว · ที่นี่เป็นคอลัมน์)
 * แต่ใช้ type + การตรวจสีชุดเดียวกัน — ห้ามเขียน validation ใหม่แยก ไม่งั้นวันหนึ่งจะเพี้ยนกัน
 *
 * ใช้ตอน "ก่อนล็อกอิน" เท่านั้น (ยังอ่าน app_settings ไม่ได้เพราะ RLS บล็อก)
 * → ไม่มี default_mode ในนี้ ใช้ค่าเริ่มต้นไปก่อน
 */
export function brandingFromTenantRow(
  row: { brand_name?: string | null; logo_url?: string | null; brand_color?: string | null } | null | undefined,
): Branding {
  if (!row) return DEFAULT_BRANDING;
  const color = (row.brand_color ?? "").trim();
  return {
    name: (row.brand_name ?? "").trim() || DEFAULT_BRANDING.name,
    color: COLOR_KEYS.has(color) ? (color as BrandColor) : DEFAULT_BRANDING.color,
    logoUrl: (row.logo_url ?? "").trim() || null,
    defaultMode: DEFAULT_BRANDING.defaultMode,
  };
}

/** อ่านค่าจากแถว app_settings (kind/value) → Branding ที่ใช้ได้แน่นอน */
export function brandingFromSettings(
  rows: { kind: string; value: string }[] | null | undefined,
): Branding {
  const get = (k: string) => rows?.find((r) => r.kind === k)?.value?.trim() || "";
  const color = get("brand_color");
  const mode = get("default_mode");
  return {
    name: get("brand_name") || DEFAULT_BRANDING.name,
    color: COLOR_KEYS.has(color) ? (color as BrandColor) : DEFAULT_BRANDING.color,
    logoUrl: get("logo_url") || null,
    defaultMode: mode === "dark" ? "dark" : "light",
  };
}
