"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isSessionCookie } from "@/lib/supabase/sessionCookie";
import { revalidatePath } from "next/cache";
import { ENTITY_COOKIE, ENTITY_COOKIE_MAX_AGE, sanitizeEntityId } from "@/lib/shared/entityWorkspace";

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
  // D187 — กิจการที่เลือกเป็นของผู้ใช้คนนี้ ไม่ใช่ของเครื่อง (คนถัดไปที่ล็อกอินเครื่องนี้ใช้ค่าของตัวเอง)
  store.delete(ENTITY_COOKIE);
  redirect("/login");
}

/**
 * สลับ "กิจการที่เลือกอยู่" ทั้งเบราว์เซอร์ (D187 · ทาง Y)
 *
 * ลำดับสำคัญ: จดใน DB ก่อน (fn_set_last_entity ตรวจ tenant + สิทธิ์ D120 และ error ดัง ๆ ถ้าไม่มีสิทธิ์)
 *   แล้วค่อยตั้ง cookie ด้วย **ค่าที่ DB ยืนยันกลับมา** — ไม่ตั้ง cookie จากค่าที่ client ส่งตรง ๆ
 * 🔒 cookie ไม่ใช่ด่าน (ผู้ใช้แก้เองได้) — my_current_entity() ตรวจซ้ำทุกคำขออยู่แล้ว
 */
export async function switchEntityAction(
  entityId: string,
): Promise<{ ok: true; entityId: string } | { ok: false; error: string }> {
  const id = sanitizeEntityId(entityId);
  if (!id) return { ok: false, error: "รหัสกิจการไม่ถูกต้อง" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_set_last_entity", { p_entity: id });
  if (error) return { ok: false, error: error.message };
  const confirmed = sanitizeEntityId(data as string | null);
  if (!confirmed) return { ok: false, error: "ระบบไม่ยืนยันกิจการที่เลือก — ลองใหม่อีกครั้ง" };

  const store = await cookies();
  store.set(ENTITY_COOKIE, confirmed, {
    path: "/",
    httpOnly: true, // อ่านเฉพาะฝั่ง server (แนบ header) — สคริปต์ในหน้าไม่ต้องรู้
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ENTITY_COOKIE_MAX_AGE,
  });
  // ทุกหน้าต้องโหลดข้อมูลใหม่ของกิจการที่สลับไป
  revalidatePath("/", "layout");
  return { ok: true, entityId: confirmed };
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
