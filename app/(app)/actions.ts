"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isSessionCookie } from "@/lib/supabase/sessionCookie";

/**
 * ออกจากระบบ — 🚨 ต้องออกได้เสมอ แม้เซสชันหมดอายุ/ฝั่ง Auth ไม่ตอบ (D135)
 *
 * `supabase.auth.signOut()` ลบคุกกี้ให้ **เฉพาะเมื่อฝั่ง Auth ตอบสำเร็จ (หรือ 401/403/404)**
 *   ได้ 5xx/หมดเวลา = คืน error แล้ว**คงเซสชันเดิมไว้** ⇒ กดออกจากระบบแล้วยังติดอยู่ที่หน้าเดิม
 *   และนี่คือปุ่มที่ป้าย "โหลดนานผิดปกติ" บอกให้กด ⇒ ลบคุกกี้เซสชันเองหลังเรียกเสมอ
 */
export async function signOut() {
  const supabase = await createClient();
  try {
    await supabase.auth.signOut();
  } catch {
    // ฝั่ง Auth ล้ม — ลบคุกกี้เองข้างล่างอยู่ดี
  }
  const store = await cookies();
  for (const c of store.getAll()) if (isSessionCookie(c.name)) store.delete(c.name);
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
