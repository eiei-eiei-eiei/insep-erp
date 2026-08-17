import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { workspacesFor, type Role } from "@/lib/shared/workspaces";
import { brandingFromSettings } from "@/lib/shared/branding";
import { bangkokDateISO } from "@/lib/shared/datetime";
import { Nav } from "./_components/nav";
import { BillingNotice } from "./_components/billing-notice";

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

  const [{ data: profile }, { data: settings }, { data: tenant }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, username, role, must_change_password")
      .eq("id", user.id)
      .single(),
    supabase.from("app_settings").select("kind, value").in("kind", ["brand_name", "brand_color", "logo_url", "default_mode"]),
    // โมดูลที่ลูกค้าซื้อ (4.5) + สถานะการใช้งาน/ค่างวด (0037)
    // RLS กรองเหลือแถวของ tenant ตัวเองอยู่แล้ว — ต่อคอลัมน์ในคิวรีเดิม ไม่เพิ่ม query ใหม่
    supabase
      .from("tenants")
      .select("modules_enabled, is_active, is_platform, billing_due_on, billing_notice")
      .maybeSingle(),
  ]);

  // ยังใช้รหัสที่คนอื่นตั้งให้ → ต้องเปลี่ยนก่อนเข้าใช้งาน (0031)
  // เช็คตรงนี้เพราะ query profiles อยู่แล้ว — ไม่เพิ่มภาระต่อ request
  // (ทำใน middleware จะต้องยิง DB ทุก request รวมถึงไฟล์ static)
  if (profile?.must_change_password) redirect("/change-password");

  // ── ระงับการใช้งาน (0037) ──────────────────────────────────────────────────
  // 🚨 เทียบ `=== false` เท่านั้น — อ่านค่าไม่ได้/เป็น null **ห้ามถือว่าถูกระงับ**
  //    ไม่งั้นเน็ตสะดุดทีเดียว ลูกค้าที่จ่ายเงินแล้วหลุดออกทั้งระบบ (fail-open เหมือน D53)
  // 🚨 ข้ามเมื่อเป็น tenant ของแอดมินแพลตฟอร์ม — แถวนั้นตั้ง is_active = false ไว้ตั้งแต่ 0035
  //    โดยตั้งใจ (กันโผล่ใน tenant_branding) ไม่ได้แปลว่าถูกระงับ
  if (tenant?.is_active === false && !tenant?.is_platform) redirect("/suspended");

  const role = (profile?.role ?? "viewer") as Role;
  const displayName = profile?.display_name ?? profile?.username ?? user.email ?? "ผู้ใช้";
  const branding = brandingFromSettings(settings);

  // แจ้งเตือนค่าบริการ — เฉพาะเจ้าของกิจการ และเฉพาะรายที่ยังเปิดการเตือนไว้
  // (พนักงานขาย/คลังเห็นแล้วทำอะไรไม่ได้ · เป็นเรื่องน่าอายของเจ้าของด้วย)
  const billingDueOn =
    role === "main" && tenant?.billing_notice !== false
      ? ((tenant?.billing_due_on as string | null) ?? null)
      : null;

  return (
    <div data-brand={branding.color} className="min-h-screen bg-page text-ink">
      <BillingNotice dueOn={billingDueOn} todayISO={bangkokDateISO()} />
      <Nav
        workspaces={workspacesFor(role, tenant?.modules_enabled as string[] | null)}
        displayName={displayName}
        role={role}
        branding={branding}
      />
      {/* pb ล่างบนมือถือ กันเนื้อหาโดน bottom-tab บัง */}
      <main className="mx-auto max-w-6xl px-4 py-6 pb-24 md:pb-6">{children}</main>
    </div>
  );
}
