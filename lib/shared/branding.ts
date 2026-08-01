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
