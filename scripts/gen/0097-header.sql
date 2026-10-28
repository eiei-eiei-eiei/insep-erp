-- ============================================================================
-- 0097 Claude connector — ส่งรูปบิลในแชท Claude แล้วลงบัญชีผ่าน MCP (D141)
--
-- ที่มา: ผู้ใช้อยากถ่ายรูปบิลส่งในแอป Claude มือถือ แล้วให้ลงบัญชีให้ (ใช้เองก่อน ·
--   เผื่อรับลงบิลให้ลูกค้าทีหลัง → เปิด connector ไว้ทั้ง 2 DB ตั้งแต่แรก)
--   endpoint อยู่ที่ app/api/mcp (env CLAUDE_CONNECTOR=1) · token มาจาก Supabase OAuth 2.1 server
--   ⇒ token เป็นของผู้ใช้คนนั้นจริง ⇒ RLS/my_tenant() เดิมทำงานต่อโดยไม่ต้องแก้ policy สักตัว
--
-- ไฟล์นี้มี 2 เรื่อง:
--   1. ตาราง connector_users — ใครใช้ connector ได้ (ตารางแพลตฟอร์ม · จัดการที่หน้า /platform)
--      🚨 เปิด OAuth ไว้ทั้งก้อนลูกค้า ⇒ ไม่มีตารางนี้ = ผู้ใช้ลูกค้าคนไหนมี Claude Pro ก็ต่อเข้ามาได้
--   2. fn_edit_transaction รู้จัก source 'claude' (บิลที่ Claude บันทึก ย้ายกิจการได้เหมือนบิลคีย์มือ · D132)
--
-- ★ ไม่แตะสูตรเงิน · ไม่แตะ fn_save_transaction (รับ p->>'source' ได้อยู่แล้ว ไม่มี CHECK)
-- ★ ตารางใหม่ 1 ตัว → grant ในไฟล์นี้ (D118) · definer ใหม่ 1 ตัว อ่านอย่างเดียว (D99 หมวด readonly)
-- ★ สร้างด้วย scripts/gen/gen-0097.mjs — ห้ามพิมพ์มือ (D79)
-- ============================================================================

-- ── 1. ใครใช้ Claude connector ได้ ─────────────────────────────────────────────
--    🚨 ตารางแพลตฟอร์ม: RLS deny-all (ไม่มี policy) + revoke จาก anon/authenticated
--       เขียนได้เฉพาะหน้า /platform (service role) · ลูกค้าห้ามให้สิทธิ์กันเอง
--    ★ ไม่มี tenant_id — ผูกกับผู้ใช้ (ผู้ใช้ 1 คนอยู่ tenant เดียวเสมอ · profiles.tenant_id)
--    ★ granted_by ไม่ใส่ FK โดยตั้งใจ (ลบบัญชีแอดมินแล้วประวัติต้องยังอยู่ · แพตเทิร์น platform_admin_log)
create table if not exists connector_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid,
  note text,
  created_at timestamptz not null default now()
);

alter table connector_users enable row level security;
-- ⛔ จงใจไม่มี policy — ห้ามเพิ่ม policy ให้ตารางนี้เด็ดขาด
revoke all on table public.connector_users from anon, authenticated;
grant select, insert, update, delete on table public.connector_users to service_role;

comment on table connector_users is
  'ผู้ใช้ที่ต่อ Claude connector (app/api/mcp) ได้ — RLS deny-all เขียนได้เฉพาะ service role (หน้า /platform) '
  '⚠️ ห้ามเพิ่ม policy: ลูกค้าเขียนได้เมื่อไหร่ = ให้สิทธิ์ตัวเองใช้ connector ได้';

-- ── ตัวฉันใช้ connector ได้ไหม ─────────────────────────────────────────────────
--    endpoint ถามทุกครั้งที่เรียกเครื่องมือ (ไม่ใช่ครั้งเดียวตอนล็อกอิน) ⇒ ถอนสิทธิ์แล้วหยุดทันที
--    แม้ token ที่ Claude ถืออยู่ยังไม่หมดอายุ
--    🚨 ต้องเช็คการระงับลูกค้าด้วย: การระงับบังคับที่ app/(app)/layout.tsx ไม่ใช่ RLS (D59)
--       และ connector ไม่ผ่าน layout ⇒ ไม่เช็คตรงนี้ = ลูกค้าค้างค่างวดยังบันทึกบิลผ่าน Claude ได้
--    ★ must_change_password: ยังไม่ได้ตั้งรหัสเอง (รหัสชั่วคราวจากแอดมิน) = ยังไม่ให้ใช้
--    ★ definer เพราะ connector_users ปิดสนิท · อ่านอย่างเดียว · ตอบได้แค่เรื่องของ auth.uid() เอง
create or replace function connector_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from connector_users c
      join profiles p on p.id = c.user_id
      join tenants t on t.id = p.tenant_id
     where c.user_id = auth.uid()
       and t.is_active
       and not t.is_platform
       and not p.must_change_password
  );
$$;

revoke execute on function connector_allowed() from public, anon;
grant execute on function connector_allowed() to authenticated, service_role;

-- ── 2. บิลจาก Claude ย้ายกิจการได้ (D132) ──────────────────────────────────────
