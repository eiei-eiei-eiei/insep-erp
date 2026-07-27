"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { usernameToEmail, USERNAME_RE } from "@/lib/shared/auth-domain";

export type ActionResult = { ok: boolean; error?: string };

const ROLES = ["main", "viewer", "sale", "warehouse"] as const;

/**
 * ตรวจว่า caller เป็น main จริง (ผ่าน session ปกติ + RLS) — ป้องกันคนอื่นเรียก action ตรง ๆ
 * คืน user id ของ caller ไว้ใช้กันลบ/แก้ตัวเอง
 */
async function requireMain(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("ต้องเข้าสู่ระบบก่อน");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "main") {
    throw new Error("เฉพาะเจ้าของกิจการ (main) เท่านั้นที่จัดการผู้ใช้ได้");
  }
  return user.id;
}

function guard<T extends unknown[]>(
  fn: (...args: T) => Promise<ActionResult>,
) {
  return async (...args: T): Promise<ActionResult> => {
    try {
      return await fn(...args);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "เกิดข้อผิดพลาด" };
    }
  };
}

/** สร้างผู้ใช้ใหม่ (username + รหัส) — ไม่ต้องมีอีเมลจริง, auto-confirm ทันที */
export const createUserAction = guard(async (input: {
  username: string;
  displayName: string;
  password: string;
  role: string;
}): Promise<ActionResult> => {
  await requireMain();
  const username = input.username.trim().toLowerCase();
  const displayName = input.displayName.trim() || username;
  const password = input.password;
  const role = input.role;

  if (!USERNAME_RE.test(username))
    return { ok: false, error: "username ต้องเป็น a-z 0-9 . _ - ยาว 3-32 ตัว" };
  if (password.length < 6)
    return { ok: false, error: "รหัสผ่านอย่างน้อย 6 ตัวอักษร" };
  if (!ROLES.includes(role as (typeof ROLES)[number]))
    return { ok: false, error: "role ไม่ถูกต้อง" };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true, // ไม่ต้องยืนยันอีเมล — login ได้ทันที
    user_metadata: { username, display_name: displayName },
  });
  if (error) {
    if (/already been registered|already exists/i.test(error.message))
      return { ok: false, error: `username "${username}" ถูกใช้แล้ว` };
    return { ok: false, error: error.message };
  }

  // trigger สร้าง profile เป็น viewer — ปรับ role/ชื่อ ตามที่เลือก
  if (data.user) {
    const { error: upErr } = await admin
      .from("profiles")
      .update({ role, display_name: displayName, username })
      .eq("id", data.user.id);
    if (upErr) return { ok: false, error: upErr.message };
  }

  revalidatePath("/settings/users");
  return { ok: true };
});

/** เปลี่ยนสิทธิ์ (role) — ผ่าน session main + RLS (ไม่ต้อง service role) */
export const updateRoleAction = guard(async (input: {
  id: string;
  role: string;
}): Promise<ActionResult> => {
  const callerId = await requireMain();
  if (!ROLES.includes(input.role as (typeof ROLES)[number]))
    return { ok: false, error: "role ไม่ถูกต้อง" };
  if (input.id === callerId && input.role !== "main")
    return { ok: false, error: "ห้ามลดสิทธิ์ตัวเอง (กันล็อกตัวเองออกจากระบบ)" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ role: input.role })
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/users");
  return { ok: true };
});

/** รีเซ็ตรหัสผ่านของผู้ใช้คนอื่น (service role) */
export const resetPasswordAction = guard(async (input: {
  id: string;
  password: string;
}): Promise<ActionResult> => {
  await requireMain();
  if (input.password.length < 6)
    return { ok: false, error: "รหัสผ่านอย่างน้อย 6 ตัวอักษร" };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(input.id, {
    password: input.password,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
});

/** ลบผู้ใช้ (service role) — profile ถูกลบตาม FK cascade · ห้ามลบตัวเอง */
export const deleteUserAction = guard(async (input: {
  id: string;
}): Promise<ActionResult> => {
  const callerId = await requireMain();
  if (input.id === callerId)
    return { ok: false, error: "ห้ามลบบัญชีตัวเอง" };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(input.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/users");
  return { ok: true };
});
