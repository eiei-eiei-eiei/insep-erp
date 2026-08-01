import Link from "next/link";
import type { Route } from "next";
import { createClient } from "@/lib/supabase/server";
import { workspacesFor, type Role } from "@/lib/shared/workspaces";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user!.id)
    .single();

  const role = (profile?.role ?? "viewer") as Role;
  const workspaces = workspacesFor(role);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-ink">เลือกพื้นที่ทำงาน</h1>
      <p className="mb-6 text-sm text-faint">
        ข้อมูลชุดเดียว · 4 มุมมองงาน (FLOW_REDESIGN)
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {workspaces.map((w) => (
          <Link
            key={w.key}
            href={w.href as Route}
            className="rounded-lg border border-line bg-card p-6 shadow-sm transition hover:border-line hover:shadow-md"
          >
            <div className="text-3xl">{w.icon}</div>
            <div className="mt-3 text-lg font-semibold text-ink">
              {w.label}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
