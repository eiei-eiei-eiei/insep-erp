"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";
import { createClient } from "@/lib/supabase/server";

/**
 * อนุญาต / ปฏิเสธ คำขอเชื่อมต่อ Claude connector (D141) — Supabase OAuth 2.1 server
 * ★ Supabase คืน redirect_url (มี code หรือ error) ให้เด้งกลับไปที่ Claude
 * 🚨 อนุญาตได้เฉพาะคนที่อยู่ในรายชื่อ connector_users — ตรวจซ้ำที่นี่ (ไม่เชื่อแค่ปุ่มที่ซ่อนบนจอ)
 *    endpoint /api/mcp ตรวจอีกชั้นทุกคำขออยู่แล้ว แต่ไม่ควรแจก token ให้คนที่ใช้ไม่ได้ตั้งแต่แรก
 */
export async function decideConsent(formData: FormData): Promise<void> {
  const id = String(formData.get("authorization_id") ?? "");
  const approve = formData.get("decision") === "approve";
  if (!id) redirect("/oauth/consent" as Route);

  const supabase = await createClient();
  if (approve) {
    const allowed = await supabase.rpc("connector_allowed");
    if (allowed.error || allowed.data !== true) redirect(`/oauth/consent?authorization_id=${encodeURIComponent(id)}` as Route);
  }
  const res = approve
    ? await supabase.auth.oauth.approveAuthorization(id)
    : await supabase.auth.oauth.denyAuthorization(id);
  if (res.error || !res.data?.redirect_url) {
    redirect(`/oauth/consent?authorization_id=${encodeURIComponent(id)}&failed=1` as Route);
  }
  // redirect_url ชี้ไปที่ claude.ai (ภายนอก) — typed routes ไม่รู้จัก
  redirect(res.data.redirect_url as Route);
}
