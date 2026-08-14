import "server-only"; // ⛔ ไฟล์นี้เปิด client แบบ service role — ห้ามหลุดเข้า client bundle
import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { platformEnabled } from "./guard";

/**
 * ด่านของแอปจัดการหลังบ้าน — **ต้องเรียกที่หัวของทุก page/action ในกลุ่ม (platform)**
 *
 * 3 ชั้น เรียงจากถูกไปแพง:
 *   1. env `PLATFORM_ADMIN` — deployment ของลูกค้าไม่ตั้ง → 404 (middleware ดักไว้ก่อนแล้วอีกชั้น)
 *   2. ต้องล็อกอิน (middleware บังคับอยู่แล้ว แต่ action ถูกเรียกตรงได้ จึงต้องเช็คซ้ำ)
 *   3. uuid ต้องอยู่ในตาราง `platform_admins` — env อย่างเดียวไม่พอ เพราะ deployment ของแอดมิน
 *      ก็ยังต้องกันคนอื่นที่บังเอิญมีบัญชีในระบบเดียวกัน (requirement ข้อ 2.3)
 *
 * ★ ตอบ 404 ไม่ใช่ 403 โดยตั้งใจ — คนที่ไม่ใช่แอดมินไม่ควรรู้ด้วยซ้ำว่ามีหน้านี้อยู่
 *   (ต่างจาก requireModule() ฝั่งลูกค้าที่เด้งกลับหน้าแรก เพราะลูกค้าไม่ได้ทำอะไรผิด แค่ยังไม่ได้ซื้อ)
 */
export type PlatformAdmin = {
  adminId: string;
  /** client แบบ service role — ข้าม RLS เพื่ออ่าน/เขียนข้ามทุก tenant */
  db: SupabaseClient;
};

export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  if (!platformEnabled(process.env.PLATFORM_ADMIN)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // บัญชีแอดมินก็เป็นผู้ใช้ปกติ → ต้องเปลี่ยนรหัสชั่วคราวก่อนเหมือนทุกคน
  // (กลุ่ม (platform) ไม่ได้ผ่าน (app)/layout.tsx จึงต้องเช็คเองที่นี่)
  const { data: profile } = await supabase
    .from("profiles")
    .select("must_change_password")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.must_change_password) redirect("/change-password");

  const db = createAdminClient();
  const { data: isAdmin } = await db
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!isAdmin) notFound();

  return { adminId: user.id, db };
}

/**
 * เช็คเบา ๆ ว่าเป็นแอดมินไหม โดยไม่ throw — ใช้ที่หน้าแรกของแอปลูกค้าเพื่อพาไป /platform
 * คืน false เสมอถ้า deployment นี้ไม่ได้เปิดโหมดแอดมิน (ลูกค้าไม่ต้องจ่ายค่า query นี้)
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  if (!platformEnabled(process.env.PLATFORM_ADMIN)) return false;
  const db = createAdminClient();
  const { data } = await db
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}
