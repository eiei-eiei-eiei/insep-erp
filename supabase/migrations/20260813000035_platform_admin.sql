-- ============================================================================
-- 0035 แอปจัดการหลังบ้าน (platform admin) เฟส 1 — docs/ADMIN_APP_REQUIREMENTS.md
--   ตาราง `platform_admins` (ใครเป็นแอดมินแพลตฟอร์ม) + `platform_admin_log` (ทำอะไรไปบ้าง)
--   + ธง `tenants.is_platform` แยก "แถวของแอดมินเอง" ออกจากรายชื่อลูกค้า
--
-- 🚨 ข้อที่พลาดแล้วเจ็บที่สุดของไฟล์นี้ (requirement ข้อ 2.1):
--    ตารางใหม่ใน Postgres **ไม่มี RLS โดยปริยาย = ใครถือ anon key ก็อ่านได้**
--    และ anon key เป็นค่าสาธารณะที่ฝังอยู่ในหน้าเว็บของลูกค้าทุกคน
--    → ตารางของแพลตฟอร์มทุกตัวต้อง `enable row level security` **แล้วไม่สร้าง policy เลย**
--      = เข้าถึงได้เฉพาะ service role · ลูกค้ายิงตรงมาได้ผลลัพธ์ว่าง
--
--    ★ ซ้อนชั้นสองด้วย `revoke all from anon, authenticated` เพราะ Supabase ตั้ง
--      `alter default privileges ... grant all on tables to anon, authenticated` ไว้
--      → ตารางใหม่ได้สิทธิ์ติดมาเองอัตโนมัติ · RLS ไม่มี policy = คืนว่าง
--        แต่ revoke ด้วย = **ฟ้อง permission denied** ซึ่งดังกว่าและตรวจสอบง่ายกว่า
--
--    เทสที่คุมข้อนี้: tests/tenant/platform-tables.test.ts (สำคัญกว่าเทสอื่นทั้งหมดในงานนี้)
-- ============================================================================

-- ── ใครเป็นแอดมินแพลตฟอร์ม ───────────────────────────────────────────────────
--    env PLATFORM_ADMIN=1 อย่างเดียวไม่พอ — deployment ของแอดมินก็ยังต้องกัน
--    คนอื่นที่บังเอิญมีบัญชีในระบบเดียวกัน (requirement ข้อ 2.3)
create table if not exists platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

alter table platform_admins enable row level security;
-- ⛔ จงใจไม่มี policy — ห้ามเพิ่ม policy ให้ตารางนี้เด็ดขาด
revoke all on platform_admins from anon, authenticated;

comment on table platform_admins is
  'บัญชีที่เข้าแอปจัดการหลังบ้านได้ — RLS deny-all (ไม่มี policy) เข้าถึงได้เฉพาะ service role '
  '⚠️ ห้ามเพิ่ม policy ให้ตารางนี้: ลูกค้าอ่านได้เมื่อไหร่ = รู้ว่าใครคุมระบบ';

-- ── แอดมินทำอะไรไปบ้าง ───────────────────────────────────────────────────────
--    ตามกติกา CLAUDE.md ("ทุกจุดที่บันทึกข้อมูลได้ต้องมี audit") — ที่นี่สำคัญเป็นพิเศษ
--    เพราะ action ฝั่งนี้ใช้ service role ข้าม RLS และแตะข้อมูลของลูกค้าคนอื่น
--    ★ actor ไม่ใส่ FK โดยตั้งใจ: ลบบัญชีแอดมินแล้วประวัติต้องยังอยู่
create table if not exists platform_admin_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,                      -- create_tenant / set_modules / set_quota / add_entity / reset_password
  tenant_slug text,
  detail jsonb,
  created_at timestamptz not null default now()
);

alter table platform_admin_log enable row level security;
-- ⛔ จงใจไม่มี policy (เหตุผลเดียวกับด้านบน)
revoke all on platform_admin_log from anon, authenticated;

create index if not exists platform_admin_log_created on platform_admin_log (created_at desc);

comment on table platform_admin_log is
  'ประวัติการทำงานของแอดมินแพลตฟอร์ม — RLS deny-all '
  '🚨 ห้ามเก็บรหัสผ่านดิบลงคอลัมน์ detail เด็ดขาด (รหัสชั่วคราวแสดงบนจอครั้งเดียวเท่านั้น)';

-- ── แยกแถวของแอดมินเองออกจากรายชื่อลูกค้า ────────────────────────────────────
--    บัญชีแอดมินก็เป็น auth user ที่ต้องมี profiles.tenant_id (trigger handle_new_user บังคับ)
--    → ต้องมีแถว tenants ให้เกาะ แต่ **ไม่ใช่ลูกค้า** จึงต้องไม่โผล่ในตารางรายชื่อ/ยอดนับ
alter table tenants add column if not exists is_platform boolean not null default false;

comment on column tenants.is_platform is
  'true = แถวสำหรับผูกบัญชีแอดมินแพลตฟอร์ม ไม่ใช่ลูกค้า — ต้องกรองออกจากรายชื่อลูกค้าเสมอ';

-- slug 'platform' เป็นชื่อสงวน (lib/shared/tenant.ts RESERVED_SLUGS) — ลูกค้าใช้ไม่ได้
-- ตั้ง is_active = false ด้วย เพื่อไม่ให้โผล่ใน view tenant_branding (หน้า login)
update tenants set is_platform = true, is_active = false where slug = 'platform';

notify pgrst, 'reload schema';
