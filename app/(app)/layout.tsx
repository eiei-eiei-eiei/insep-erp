import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { workspacesFor, type Role } from "@/lib/shared/workspaces";
import { Nav } from "./_components/nav";

/**
 * Layout ของทุกหน้าหลัง login — guard auth + โหลด profile (role/ชื่อ)
 * แล้วส่ง workspace ที่ role นี้เห็นได้ให้ Nav
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, username, role")
    .eq("id", user.id)
    .single();

  const role = (profile?.role ?? "viewer") as Role;
  const displayName = profile?.display_name ?? profile?.username ?? user.email ?? "ผู้ใช้";

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav workspaces={workspacesFor(role)} displayName={displayName} role={role} />
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
