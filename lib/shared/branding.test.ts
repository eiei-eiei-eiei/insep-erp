import { describe, it, expect } from "vitest";
import {
  brandingFromTenantRow,
  brandingFromSettings,
  DEFAULT_BRANDING,
  BRAND_COLORS,
} from "./branding";

/**
 * brandingFromTenantRow อ่านจาก view `tenant_branding` (ก่อนล็อกอิน)
 * ส่วน brandingFromSettings อ่านจาก app_settings (หลังล็อกอิน)
 * → คนละแหล่ง แต่ต้องให้ผลแบบเดียวกัน ไม่งั้นแบรนด์จะกระพริบตอนล็อกอินผ่าน
 */
describe("brandingFromTenantRow", () => {
  it("อ่านค่าครบ", () => {
    expect(
      brandingFromTenantRow({
        brand_name: "โรงกลั่น ก.",
        logo_url: "https://x.test/logo.png",
        brand_color: "copper",
      }),
    ).toEqual({
      name: "โรงกลั่น ก.",
      color: "copper",
      logoUrl: "https://x.test/logo.png",
      defaultMode: DEFAULT_BRANDING.defaultMode,
    });
  });

  it("ไม่มีแถว (เดา subdomain มั่ว) = ค่าเริ่มต้น ไม่ระเบิด", () => {
    expect(brandingFromTenantRow(null)).toEqual(DEFAULT_BRANDING);
    expect(brandingFromTenantRow(undefined)).toEqual(DEFAULT_BRANDING);
  });

  it("ค่าว่าง/null รายคอลัมน์ → ถอยไปค่าเริ่มต้นทีละตัว", () => {
    const b = brandingFromTenantRow({ brand_name: "  ", logo_url: null, brand_color: null });
    expect(b.name).toBe(DEFAULT_BRANDING.name);
    expect(b.logoUrl).toBeNull();
    expect(b.color).toBe(DEFAULT_BRANDING.color);
  });

  it("★ สีนอกชุดที่อนุญาตต้องถูกปัดทิ้ง (กัน CSS ไม่มี token แล้วหน้าเพี้ยน)", () => {
    expect(brandingFromTenantRow({ brand_color: "hotpink" }).color).toBe(DEFAULT_BRANDING.color);
    expect(brandingFromTenantRow({ brand_color: "#ff0000" }).color).toBe(DEFAULT_BRANDING.color);
  });

  it("รับได้ทุกสีในชุด BRAND_COLORS", () => {
    for (const c of BRAND_COLORS) {
      expect(brandingFromTenantRow({ brand_color: c.key }).color).toBe(c.key);
    }
  });

  it("ตรวจสีเหมือนกับฝั่ง app_settings เป๊ะ (ห้ามมี validation 2 ชุดที่เพี้ยนกัน)", () => {
    for (const value of ["copper", "hotpink", "", "STEEL"]) {
      expect(brandingFromTenantRow({ brand_color: value }).color).toBe(
        brandingFromSettings([{ kind: "brand_color", value }]).color,
      );
    }
  });
});
