import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { TENANT_SLUG_HEADER } from "@/lib/supabase/middleware";
import { brandingFromTenantRow, DEFAULT_BRANDING } from "@/lib/shared/branding";
import LoginForm from "./LoginForm";

/**
 * หน้า login — server component เพราะต้องรู้ว่าเป็นลูกค้าเจ้าไหน "ก่อน" ล็อกอิน
 *
 * ปัญหาเดิม (NEXT_STEPS ข้อ 2): อ่าน app_settings ไม่ได้เพราะ RLS บล็อกก่อน login
 * → ทางแก้: subdomain บอกว่าใคร + view `tenant_branding` (0025) เปิดให้ anon อ่าน
 *   เฉพาะคอลัมน์แบรนด์
 *
 * 🚨 slug ที่ได้ตรงนี้ใช้ "แต่งหน้า + ประกอบชื่อบัญชีที่จะลองล็อกอิน" เท่านั้น
 *    ไม่ได้แจกสิทธิ์อะไร — ยังต้องมีรหัสผ่านของบัญชีนั้น และหลังล็อกอินสิทธิ์มาจาก
 *    profiles.tenant_id → my_tenant() → RLS เท่านั้น (NEXT_STEPS:181)
 */
export default async function LoginPage() {
  const slug = (await headers()).get(TENANT_SLUG_HEADER)?.trim() ?? "";

  if (!slug) {
    // ไม่มี subdomain = โหมดลิงก์เดียว/ใช้เอง → หน้าตาเดิมเป๊ะ
    return <LoginForm branding={DEFAULT_BRANDING} isTenant={false} />;
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("tenant_branding")
    .select("brand_name, logo_url, brand_color")
    .eq("slug", slug)
    .maybeSingle();

  // เดา slug มั่วแล้วไม่มีจริง → กลับไปหน้าตากลาง ไม่บอกว่า "ไม่พบลูกค้ารายนี้"
  // (ไม่ต้องช่วยคนนอกไล่เดาว่าลูกค้าเจ้าไหนมีอยู่จริง)
  if (!data) return <LoginForm branding={DEFAULT_BRANDING} isTenant={false} />;

  return <LoginForm branding={brandingFromTenantRow(data)} isTenant />;
}
