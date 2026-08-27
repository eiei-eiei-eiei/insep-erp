"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { usernameToEmail, USERNAME_RE } from "@/lib/shared/auth-domain";
import { validatePassword } from "@/lib/shared/password";
import { ROLES, can, toRole } from "@/lib/shared/roles";

export type ActionResult = { ok: boolean; error?: string };


/**
 * ตรวจว่า caller เป็น main จริง (ผ่าน session ปกติ + RLS) — ป้องกันคนอื่นเรียก action ตรง ๆ
 * คืน user id ของ caller ไว้ใช้กันลบ/แก้ตัวเอง
 */
type Caller = { callerId: string; tenantId: string };

async function requireMain(): Promise<Caller> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("ต้องเข้าสู่ระบบก่อน");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single();
  if (!profile || !can(toRole(profile.role as string | null), "admin")) {
    throw new Error("เฉพาะเจ้าของกิจการ (main) เท่านั้นที่จัดการผู้ใช้ได้");
  }
  if (!profile.tenant_id) {
    throw new Error("บัญชีนี้ยังไม่ได้ผูกกับกิจการ (tenant) — ติดต่อผู้ดูแลระบบ");
  }
  return { callerId: user.id, tenantId: profile.tenant_id as string };
}

/**
 * 🚨 กันแตะผู้ใช้ของลูกค้าเจ้าอื่น
 * action ที่ใช้ service role รับ user id ดิบ ๆ มาจาก client → ถ้าไม่เช็ค tenant
 * main ของลูกค้า A จะรีเซ็ตรหัส/ลบผู้ใช้ของ B ได้ถ้าเดา uuid ถูก (RLS ช่วยไม่ได้ เพราะ bypass)
 */
async function assertSameTenant(userId: string, tenantId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) throw new Error("ไม่พบผู้ใช้นี้ในกิจการของคุณ");
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
  const me = await requireMain();
  const username = input.username.trim().toLowerCase();
  const displayName = input.displayName.trim() || username;
  const password = input.password;
  const role = input.role;

  if (!USERNAME_RE.test(username))
    return { ok: false, error: "username ต้องเป็น a-z 0-9 . _ - ยาว 3-32 ตัว" };
  // ★ รหัสที่ตั้งให้คนอื่นเป็นรหัสชั่วคราว — ผู้ใช้จะถูกบังคับเปลี่ยนตอนล็อกอินครั้งแรก
  //   (handle_new_user ตั้ง must_change_password = true ให้เอง — 0031)
  const badPw = validatePassword(password, username);
  if (badPw) return { ok: false, error: badPw };
  if (!ROLES.includes(role as (typeof ROLES)[number]))
    return { ok: false, error: "role ไม่ถูกต้อง" };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    // ชื่อผู้ใช้ไม่ซ้ำทั้งระบบ (0032) → ชนกับลูกค้าเจ้าอื่นจะถูกปฏิเสธตรงนี้
    email: usernameToEmail(username),
    password,
    email_confirm: true, // ไม่ต้องยืนยันอีเมล — login ได้ทันที
    // ★ handle_new_user() (0025) อ่าน tenant_id จากตรงนี้ — ไม่ส่ง = สร้าง profile ไม่ได้
    user_metadata: { username, display_name: displayName, tenant_id: me.tenantId },
  });
  if (error) {
    if (/already been registered|already exists/i.test(error.message))
      return {
        ok: false,
        // ชื่อผู้ใช้ไม่ซ้ำทั้งระบบ (0032) → อาจถูกใช้โดยกิจการอื่นที่เราไม่เห็น
        // จงใจไม่บอกว่าใครใช้ — บอกแค่ว่าใช้ไม่ได้ แล้วแนะทางออก
        error:
          `ชื่อผู้ใช้ "${username}" ถูกใช้แล้ว — ` +
          "ลองเติมชื่อกิจการต่อท้าย เช่น " + username + ".rongkor",
      };
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
  const { callerId } = await requireMain();
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
  const me = await requireMain();
  const badPw = validatePassword(input.password);
  if (badPw) return { ok: false, error: badPw };
  await assertSameTenant(input.id, me.tenantId);

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(input.id, {
    password: input.password,
  });
  if (error) return { ok: false, error: error.message };

  // เจ้าของตั้งรหัสให้ = รหัสชั่วคราว → เจ้าตัวต้องเปลี่ยนเองตอนล็อกอินครั้งถัดไป
  const { error: flagErr } = await admin
    .from("profiles").update({ must_change_password: true }).eq("id", input.id);
  if (flagErr) return { ok: false, error: flagErr.message };

  return { ok: true };
});

/** ลบผู้ใช้ (service role) — profile ถูกลบตาม FK cascade · ห้ามลบตัวเอง */
export const deleteUserAction = guard(async (input: {
  id: string;
}): Promise<ActionResult> => {
  const { callerId, tenantId } = await requireMain();
  if (input.id === callerId)
    return { ok: false, error: "ห้ามลบบัญชีตัวเอง" };
  await assertSameTenant(input.id, tenantId);

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(input.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/users");
  return { ok: true };
});
