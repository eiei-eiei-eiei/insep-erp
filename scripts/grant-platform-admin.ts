/**
 * grant-platform-admin — ให้สิทธิ์เข้า "แอปจัดการหลังบ้าน" (migration 0035)
 *
 *   # สร้างบัญชีแอดมินใหม่ในระบบที่ยังไม่มีใครเลย (ครั้งเดียวตอนตั้งระบบ)
 *   npx tsx scripts/grant-platform-admin.ts --env=.env.local --username=platformadmin --create
 *
 *   # ให้สิทธิ์บัญชีที่มีอยู่แล้ว
 *   npx tsx scripts/grant-platform-admin.ts --env=.env.local --username=ceo
 *
 *   # ถอนสิทธิ์
 *   npx tsx scripts/grant-platform-admin.ts --env=.env.local --username=ceo --revoke
 *
 * ★ นี่คือสคริปต์เดียวที่ยังต้องรันใน terminal — เป็นการ bootstrap ตัวเอง
 *   (จะให้กดจากหน้าจอที่ยังเข้าไม่ได้ ไม่ได้) · หลังจากนี้ทุกงานทำจาก `/platform` ได้หมด
 *
 * ⚠️ ตาราง `platform_admins` เป็น RLS deny-all → แก้ได้ด้วย service role เท่านั้น
 *    = สคริปต์นี้ หรือ SQL Editor ใน Supabase Dashboard
 */
import { adminFromEnv, argOf, hasFlag, die } from "./lib/provision";
import { USERNAME_RE, usernameToEmail } from "../lib/shared/auth-domain";
import { generateInitialPassword } from "../lib/shared/password";

/** slug ของแถว tenants ที่มีไว้ผูกบัญชีแอดมิน — ไม่ใช่ลูกค้า (0035 กรองออกจากรายชื่อ) */
const PLATFORM_SLUG = "platform";

async function main() {
  const envFile = argOf("env") || ".env.local";
  const username = argOf("username").trim().toLowerCase();
  const note = argOf("note") || null;
  const create = hasFlag("create");
  const revoke = hasFlag("revoke");

  if (!username) die('--username ต้องระบุ เช่น --username=platformadmin');
  if (!USERNAME_RE.test(username)) die("--username ต้องเป็น a-z 0-9 . _ - ยาว 3-32 ตัว");
  if (create && revoke) die("ใช้ --create กับ --revoke พร้อมกันไม่ได้");

  const { db, ref } = adminFromEnv(envFile);
  console.log(`\n🔑 สิทธิ์แอดมินแพลตฟอร์มที่ project: ${ref}\n`);

  // ── หาบัญชีเดิมก่อน ────────────────────────────────────────────────────────
  const { data: existing, error: pErr } = await db
    .from("profiles")
    .select("id, username, tenant_id")
    .eq("username", username)
    .maybeSingle();
  if (pErr) die(`ค้นหาผู้ใช้: ${pErr.message}`);

  // ── ถอนสิทธิ์ ──────────────────────────────────────────────────────────────
  if (revoke) {
    if (!existing) die(`ไม่พบผู้ใช้ "${username}" ที่ project นี้`);
    const { error } = await db.from("platform_admins").delete().eq("user_id", existing!.id);
    if (error) die(`ถอนสิทธิ์: ${error.message}`);
    console.log(`✅ ถอนสิทธิ์แอดมินของ "${username}" แล้ว (บัญชีเดิมยังอยู่)\n`);
    return;
  }

  let userId = existing?.id as string | undefined;
  let freshPassword: string | null = null;

  // ── สร้างบัญชีใหม่ (เฉพาะเมื่อสั่ง --create) ────────────────────────────────
  if (!userId) {
    if (!create) {
      die(
        `ไม่พบผู้ใช้ "${username}" ที่ project นี้\n` +
          "   ถ้าต้องการสร้างบัญชีแอดมินใหม่ ให้ใส่ --create ต่อท้าย",
      );
    }

    // บัญชีแอดมินก็เป็น auth user ปกติ → trigger handle_new_user (0025) บังคับว่าต้องรู้ tenant
    // จึงต้องมีแถว tenants ให้เกาะ · ตั้ง is_platform = true เพื่อไม่ให้ปนกับรายชื่อลูกค้า
    const { data: pt } = await db
      .from("tenants").select("id").eq("slug", PLATFORM_SLUG).maybeSingle();
    let platformTenantId = pt?.id as string | undefined;

    if (!platformTenantId) {
      const { data: created, error } = await db
        .from("tenants")
        .insert({
          slug: PLATFORM_SLUG,
          name: "ผู้ดูแลแพลตฟอร์ม",
          is_platform: true,
          is_active: false, // ไม่โผล่ใน view tenant_branding (หน้า login)
          modules_enabled: ["production"], // ค่าอะไรก็ได้ — บัญชีนี้ไม่ได้ใช้แอปฝั่งลูกค้า
        })
        .select("id")
        .single();
      if (error) die(`สร้างแถว tenants ของแอดมิน: ${error.message}`);
      platformTenantId = created!.id as string;
      console.log(`   สร้างแถว tenants '${PLATFORM_SLUG}' (is_platform = true) แล้ว`);
    }

    freshPassword = generateInitialPassword();
    const { data: u, error: uErr } = await db.auth.admin.createUser({
      email: usernameToEmail(username),
      password: freshPassword,
      email_confirm: true,
      // ไม่ส่ง skip_password_change → ระบบบังคับให้ตั้งรหัสเองตอนล็อกอินครั้งแรก (0031)
      user_metadata: { username, display_name: "ผู้ดูแลแพลตฟอร์ม", tenant_id: platformTenantId },
    });
    if (uErr) {
      die(/already been registered|already exists/i.test(uErr.message)
        ? `ชื่อผู้ใช้ "${username}" ถูกใช้แล้ว (ชื่อผู้ใช้ห้ามซ้ำทั้งระบบ) — เปลี่ยนชื่อ`
        : `สร้างผู้ใช้: ${uErr.message}`);
    }
    userId = u!.user!.id;
    await db.from("profiles").update({ role: "main" }).eq("id", userId);
  }

  // ── ให้สิทธิ์ ──────────────────────────────────────────────────────────────
  const { error } = await db
    .from("platform_admins")
    .upsert({ user_id: userId, note }, { onConflict: "user_id" });
  if (error) die(`ให้สิทธิ์แอดมิน: ${error.message}`);

  console.log(`✅ "${username}" เข้าแอปจัดการหลังบ้านได้แล้ว\n`);
  if (freshPassword) {
    console.log(`   ชื่อผู้ใช้        : ${username}`);
    console.log(`   รหัสผ่านชั่วคราว : ${freshPassword}`);
    console.log(`   ⚠️  รหัสนี้พิมพ์ครั้งเดียว ไม่มีทางสั่งพิมพ์ซ้ำ — ก๊อปเก็บทันที`);
    console.log(`   ระบบจะบังคับให้ตั้งรหัสใหม่ตอนล็อกอินครั้งแรก\n`);
  }
  console.log("   เหลืออีกขั้นเดียว: deployment ที่จะใช้เป็นแอปแอดมิน ต้องตั้ง env");
  console.log("     PLATFORM_ADMIN=1");
  console.log("   ไม่ตั้ง = /platform ตอบ 404 (ตั้งใจ — deployment ของลูกค้าต้องไม่มีหน้านี้)\n");
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
