import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { workspacesFor, type Role } from "@/lib/shared/workspaces";
import { brandingFromSettings } from "@/lib/shared/branding";
import { Nav } from "./_components/nav";

/**
 * Layout ของทุกหน้าหลัง login — guard auth + โหลด profile (role/ชื่อ) + แบรนด์ของกิจการ
 *
 * data-brand อยู่ที่ div นี้ (ไม่ใช่ <html>) เพราะกว่าจะรู้แบรนด์ต้อง login ก่อน
 * — token สีคาสเคดลงลูกทั้งหมด · โหมดสว่าง/มืดอยู่ที่ <html> (อ่านจาก cookie ใน root layout)
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [{ data: profile }, { data: settings }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, username, role, must_change_password")
      .eq("id", user.id)
      .single(),
    supabase.from("app_settings").select("kind, value").in("kind", ["brand_name", "brand_color", "logo_url", "default_mode"]),
  ]);

  // ยังใช้รหัสที่คนอื่นตั้งให้ → ต้องเปลี่ยนก่อนเข้าใช้งาน (0031)
  // เช็คตรงนี้เพราะ query profiles อยู่แล้ว — ไม่เพิ่มภาระต่อ request
  // (ทำใน middleware จะต้องยิง DB ทุก request รวมถึงไฟล์ static)
  if (profile?.must_change_password) redirect("/change-password");

  const role = (profile?.role ?? "viewer") as Role;
  const displayName = profile?.display_name ?? profile?.username ?? user.email ?? "ผู้ใช้";
  const branding = brandingFromSettings(settings);

  return (
    <div data-brand={branding.color} className="min-h-screen bg-page text-ink">
      <Nav
        workspaces={workspacesFor(role)}
        displayName={displayName}
        role={role}
        branding={branding}
      />
      {/* pb ล่างบนมือถือ กันเนื้อหาโดน bottom-tab บัง */}
      <main className="mx-auto max-w-6xl px-4 py-6 pb-24 md:pb-6">{children}</main>
    </div>
  );
}
