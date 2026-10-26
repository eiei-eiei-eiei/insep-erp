import Link from "next/link";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { createClient } from "@/lib/supabase/server";
import { workspacesFor } from "@/lib/shared/workspaces";
import { toRole } from "@/lib/shared/roles";
import { WORKSPACE_ICON } from "@/lib/shared/icons";
import { isPlatformAdmin } from "@/lib/platform/auth";

/**
 * หน้าแรก — เลือกพื้นที่ทำงาน
 *
 * ★ D133 — โชว์เฉพาะโมดูลที่ซื้อไว้ (ตัวกรองเดียวกับแถบเมนู) · เดิมเป็นการ์ดเทาให้เห็นว่ามีของขายเพิ่ม
 *   แต่ลูกค้าที่ไม่ได้ทำโรงเหล้าเห็น "ผลิต"/"บาร์" แล้วงงเปล่า ๆ
 *   ★ ด่านจริงอยู่ที่ requireModule() ใน page.tsx ของแต่ละโดเมน ไม่ใช่การ์ดใบนี้
 */
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // แอดมินแพลตฟอร์มล็อกอินแล้วต้องไปโผล่ที่หน้าจัดการหลังบ้าน ไม่ใช่แอปลูกค้าที่ว่างเปล่า
  // ★ บน deployment ของลูกค้า (ไม่ได้ตั้ง PLATFORM_ADMIN) ฟังก์ชันนี้คืน false ทันทีโดยไม่ยิง DB
  if (user && (await isPlatformAdmin(user.id))) redirect("/platform");

  const [{ data: profile }, { data: tenant }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user!.id).single(),
    supabase.from("tenants").select("modules_enabled").maybeSingle(),
  ]);

  const role = toRole(profile?.role as string | null);
  const workspaces = workspacesFor(role, tenant?.modules_enabled as string[] | null);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-ink">เลือกพื้นที่ทำงาน</h1>
      <p className="mb-6 text-sm text-faint">
        ข้อมูลชุดเดียว · {workspaces.length} มุมมองงาน
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {workspaces.map((w) => {
          // 🐛 D96 — เดิมเขียน fallback เป็นไอคอนกุญแจไว้ แล้ว `WORKSPACE_ICON` ตกคีย์ `bar`
          //    ⇒ การ์ดบาร์ขึ้น **รูปกุญแจ** เหมือนยังไม่ได้ซื้อโมดูล ทั้งที่เปิดใช้อยู่
          //    ตอนนี้ Record ครบทุก key แล้ว (TS บังคับ) → ไม่ต้อง fallback อีก
          //    🚨 อย่าเอา `??` กลับมา — มันคือตัวที่กลืนความผิดพลาดนี้ไว้ 1 รอบเต็ม
          const Icon = WORKSPACE_ICON[w.key];

          return (
            <Link
              key={w.key}
              href={w.href as Route}
              className="rounded-lg border border-line bg-card p-6 shadow-sm transition hover:border-line hover:shadow-md"
            >
              <Icon size={32} className="text-brand" />
              <div className="mt-3 text-lg font-semibold text-ink">{w.label}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
