import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UsersManager, type UserRow } from "./_components/users-manager";

export default async function UsersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "main") redirect("/");

  const { data: users } = await supabase
    .from("profiles")
    .select("id, username, display_name, role, created_at")
    .order("created_at", { ascending: true });

  return (
    <UsersManager users={(users ?? []) as UserRow[]} currentUserId={user.id} />
  );
}
