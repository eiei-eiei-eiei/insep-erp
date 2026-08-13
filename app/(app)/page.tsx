import Link from "next/link";
import type { Route } from "next";
import { createClient } from "@/lib/supabase/server";
import { workspacesWithLock, type Role } from "@/lib/shared/workspaces";
import { WORKSPACE_ICON, IconLock } from "@/lib/shared/icons";

/**
 * หน้าแรก — เลือกพื้นที่ทำงาน
 *
 * ★ โมดูลที่ลูกค้ายังไม่ได้ซื้อ **แสดงเป็นการ์ดเทากดไม่ได้ ไม่ใช่ซ่อนทิ้ง**
 *   ให้ลูกค้าเห็นว่ามีของให้ซื้อเพิ่ม (ซ่อนไปเลย = ไม่มีใครรู้ว่าขายอะไรอยู่)
 *   ส่วนแถบเมนูด้านบนยังซ่อนตามเดิม — เมนูที่ใช้ทุกวันต้องสะอาด ไม่ใช่ที่โฆษณา
 *   ★ ด่านจริงอยู่ที่ requireModule() ใน page.tsx ของแต่ละโดเมน ไม่ใช่การ์ดใบนี้
 */
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: profile }, { data: tenant }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user!.id).single(),
    supabase.from("tenants").select("modules_enabled").maybeSingle(),
  ]);

  const role = (profile?.role ?? "viewer") as Role;
  const workspaces = workspacesWithLock(role, tenant?.modules_enabled as string[] | null);
  const lockedCount = workspaces.filter((w) => w.locked).length;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-ink">เลือกพื้นที่ทำงาน</h1>
      <p className="mb-6 text-sm text-faint">
        ข้อมูลชุดเดียว · {workspaces.length} มุมมองงาน
        {lockedCount > 0 && ` · ${lockedCount} รายการยังไม่ได้เปิดใช้`}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {workspaces.map((w) => {
          const Icon = WORKSPACE_ICON[w.key] ?? IconLock;

          if (w.locked) {
            return (
              <div
                key={w.key}
                aria-disabled="true"
                className="cursor-not-allowed rounded-lg border border-line bg-raised p-6 opacity-70"
              >
                <div className="flex items-start justify-between">
                  <Icon size={32} className="text-faint" />
                  <IconLock size={18} className="text-faint" />
                </div>
                <div className="mt-3 text-lg font-semibold text-muted">{w.label}</div>
                <div className="mt-1 text-xs text-faint">ยังไม่ได้เปิดใช้ — ซื้อเพิ่มได้</div>
              </div>
            );
          }

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

      {lockedCount > 0 && (
        <p className="mt-4 text-xs text-faint">
          รายการสีเทาคือส่วนที่ยังไม่ได้เปิดใช้ในแพ็กเกจของคุณ — ติดต่อผู้ดูแลระบบเพื่อเปิดเพิ่ม
        </p>
      )}
    </div>
  );
}
