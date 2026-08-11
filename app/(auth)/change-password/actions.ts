"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validatePassword } from "@/lib/shared/password";

export type ChangePwState = { error: string | null };

/**
 * เปลี่ยนรหัสผ่านของตัวเอง — ใช้ตอนถูกบังคับเปลี่ยนครั้งแรก และตอนอยากเปลี่ยนเอง
 *
 * ทำไมต้องมี: multi-tenant ทำให้ "รหัสผ่านซ้ำกันข้ามลูกค้า" เป็นช่องโหว่จริง
 * (คนของเจ้าหนึ่งล็อกอินเข้าอีกเจ้าได้ถ้าทั้ง username และรหัสตรงกัน)
 * → รหัสตั้งต้นที่คนอื่นตั้งให้ต้องอยู่ได้ไม่เกินการล็อกอินครั้งแรก
 */
export async function changePassword(
  _prev: ChangePwState,
  formData: FormData,
): Promise<ChangePwState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (password !== confirm) return { error: "รหัสผ่านทั้งสองช่องไม่ตรงกัน" };

  const { data: profile } = await supabase
    .from("profiles").select("username").eq("id", user.id).single();

  const bad = validatePassword(password, profile?.username as string | undefined);
  if (bad) return { error: bad };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    // Supabase ปฏิเสธเมื่อรหัสใหม่เหมือนเดิม — แปลให้อ่านรู้เรื่อง
    if (/should be different|same as/i.test(error.message)) {
      return { error: "รหัสใหม่ต้องไม่ซ้ำกับรหัสเดิม" };
    }
    return { error: `เปลี่ยนรหัสผ่านไม่สำเร็จ: ${error.message}` };
  }

  // เคลียร์ flag ผ่าน RPC ที่แตะได้คอลัมน์เดียว (0031)
  // — ไม่ให้ client update ตาราง profiles ตรง ๆ เพราะจะเปิดช่องแก้ role ตัวเองไปด้วย
  const { error: rpcErr } = await supabase.rpc("clear_password_change_flag");
  if (rpcErr) return { error: `เปลี่ยนรหัสแล้ว แต่ปลดสถานะไม่สำเร็จ: ${rpcErr.message}` };

  redirect("/");
}
