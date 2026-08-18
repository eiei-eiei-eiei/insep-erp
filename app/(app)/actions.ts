"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * signed URL ของไฟล์ใน bucket `pdf-templates` (หมดอายุ 120 วิ) — client fetch ไปทำ PDF
 *
 * ★ อยู่ที่ไฟล์กลางเพราะใช้ 2 โดเมน: ฟอร์ม ภส. (ผลิต) และ 50ทวิ (บัญชี)
 *   เดิมอยู่ใน app/(app)/reports/actions.ts แล้วบัญชี import ข้ามโดเมนมา —
 *   พอยุบ workspace รายงานราชการทิ้ง บัญชีจะ build ไม่ผ่าน จึงย้ายมาไว้ตรงกลาง
 */
export async function getPdfAssetUrl(path: string): Promise<{ url: string | null; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("pdf-templates")
    .createSignedUrl(path, 120);
  if (error) return { url: null, error: error.message };
  return { url: data.signedUrl };
}
