"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usernameToEmail } from "@/lib/shared/auth-domain";

export type LoginState = { error: string | null };

/**
 * เข้าสู่ระบบด้วย username (ไม่ต้องมีอีเมลจริง) + password
 * username → อีเมลภายใน <username>@insep.local (usernameToEmail) · กรอกอีเมลจริงก็ยังได้ (มี @)
 */
export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username || !password) {
    return { error: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });

  if (error) {
    const raw = error.message ?? "";
    // แยกสาเหตุที่พบบ่อยตอน setup ให้ผู้ใช้แก้เองได้ (ระบบภายใน — บอกสาเหตุจริงได้)
    if (/email not confirmed/i.test(raw)) {
      return {
        error:
          "บัญชีนี้ยังไม่ได้ยืนยัน — ให้เจ้าของสร้างผู้ใช้ผ่านหน้า 'จัดการผู้ใช้' ในแอป " +
          "(จะ auto-confirm ให้) หรือใน Supabase ติ๊ก Auto Confirm User",
      };
    }
    if (/invalid login credentials/i.test(raw)) {
      return { error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" };
    }
    return { error: `เข้าสู่ระบบไม่สำเร็จ: ${raw || "ไม่ทราบสาเหตุ"}` };
  }

  redirect("/");
}
