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

  const { data: users } = await supabase
    .from("profiles")
    .select("id, username, display_name, role, created_at")
    .order("created_at", { ascending: true });

  return (
    <UsersManager users={(users ?? []) as UserRow[]} currentUserId={user.id} />
  );
}
