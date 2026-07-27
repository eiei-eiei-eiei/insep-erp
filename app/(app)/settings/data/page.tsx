import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DataManager } from "./_components/data-manager";

export default async function DataSnapshotPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "main") redirect("/");

  return <DataManager />;
}
