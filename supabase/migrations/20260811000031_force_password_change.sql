-- ============================================================================
-- 0031 บังคับเปลี่ยนรหัสตอนล็อกอินครั้งแรก
--
--   ที่มา (ผู้ใช้จับได้ตอนเทส multi-tenant): ถ้าลูกค้า 2 เจ้ามีทั้ง username และ
--   รหัสผ่านตรงกัน คนของเจ้าหนึ่งจะล็อกอินเข้าอีกเจ้าได้ผ่าน URL ของเขา
--   — ไม่ใช่ RLS รั่ว แต่เป็น "รหัสผ่านชนกัน" ซึ่ง RLS ช่วยไม่ได้เลย
--   เพราะในสายตาระบบเขาคือเจ้าของบัญชีนั้นจริง ๆ
--
--   จุดที่อันตรายที่สุดคือ **รหัสตั้งต้นตอน provision** ถ้าตั้งเหมือนกันทุกเจ้า
--   ลูกค้าทุกรายจะเข้าระบบกันเองได้หมดตั้งแต่วันแรก
--
--   กันด้วย 2 ชั้น (ชั้นนี้ = ชั้นที่ 2):
--     1. สุ่มรหัสตั้งต้นไม่ซ้ำต่อราย (ฝั่งสคริปต์ provision/seed)
--     2. บังคับเปลี่ยนตอนล็อกอินครั้งแรก ← ไฟล์นี้
--        → ต่อให้คนติดตั้งตั้งรหัสง่าย ๆ ให้ มันก็อยู่ได้ไม่เกินการล็อกอินครั้งแรก
-- ============================================================================

alter table profiles
  add column if not exists must_change_password boolean not null default false;

comment on column profiles.must_change_password is
  'true = ยังใช้รหัสที่คนอื่นตั้งให้ ต้องเปลี่ยนก่อนใช้งาน — ตั้งตอนสร้างผู้ใช้/รีเซ็ตรหัส';

-- ผู้ใช้ที่ถูกสร้างโดย admin ต้องเปลี่ยนรหัสเสมอ (ไม่ใช่คนที่ตั้งรหัสเอง)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
begin
  v_tenant := coalesce(
    nullif(new.raw_user_meta_data ->> 'tenant_id', '')::uuid,
    my_tenant(),
    (select id from tenants where is_active limit 1)
  );

  if v_tenant is null then
    raise exception 'สร้างผู้ใช้ไม่ได้: ไม่รู้ว่าผู้ใช้นี้อยู่กิจการไหน (ส่ง tenant_id ใน user_metadata)';
  end if;

  insert into public.profiles (id, username, display_name, role, tenant_id, must_change_password)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    'viewer',
    v_tenant,
    -- สคริปต์เทส/provision ส่ง skip_password_change = true ได้เพื่อไม่ให้ติดหน้าเปลี่ยนรหัส
    coalesce((new.raw_user_meta_data ->> 'skip_password_change')::boolean, false) = false
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- ★ ผู้ใช้ต้องเคลียร์ flag ของตัวเองได้หลังเปลี่ยนรหัสสำเร็จ
--   (policy profiles_write เดิมให้เฉพาะ main แก้ → ไม่งั้น viewer เปลี่ยนรหัสแล้ว flag ค้างตลอด)
--
--   ⚠️ ห้ามแก้ด้วย RLS policy เด็ดขาด — RLS จำกัด "คอลัมน์ไหนแก้ได้" ไม่ได้
--      policy ที่อนุญาตให้ update แถวตัวเองจะเปิดให้ viewer ตั้ง role='main' ให้ตัวเองไปด้วย
--      → ใช้ security definer function ที่แตะได้คอลัมน์เดียวแทน
create or replace function clear_password_change_flag() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'ต้องเข้าสู่ระบบก่อน';
  end if;
  update profiles set must_change_password = false where id = auth.uid();
end $$;

comment on function clear_password_change_flag() is
  'เคลียร์ flag หลังผู้ใช้เปลี่ยนรหัสเอง — แตะคอลัมน์เดียว ตั้งกลับเป็น true ไม่ได้';

notify pgrst, 'reload schema';
