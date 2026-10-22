import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UsersManager, type UserRow } from "./_components/users-manager";

/** guard role main อยู่ที่ app/(app)/settings/layout.tsx แล้ว — ที่นี่ต้องการแค่ user.id */
export default async function UsersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: users }, { data: entities }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, username, display_name, role, created_at, allowed_entity_ids")
      .order("created_at", { ascending: true }),
    // D120 — main เห็นทุกกิจการ (ไม่ถูกจำกัด) จึงได้รายชื่อครบสำหรับเลือก
    supabase.from("entities").select("entity_id, name").order("entity_id"),
  ]);

  return (
    <UsersManager
      users={(users ?? []) as UserRow[]}
      entities={(entities ?? []) as { entity_id: string; name: string }[]}
      currentUserId={user.id}
    />
  );
}
