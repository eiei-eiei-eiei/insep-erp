-- ============================================================================
-- 0009 — ปรับ handle_new_user ให้ใช้ username/display_name จาก user_metadata
--   หน้า "จัดการผู้ใช้" ในแอปส่ง metadata { username, display_name } ตอนสร้าง user
--   → profile ได้ค่าที่ถูกต้องทันที (fallback = ส่วนหน้า @ ของอีเมล เหมือนเดิม)
-- (create or replace — ไม่ต้องแตะ trigger เดิมจาก 0008)
-- ============================================================================

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    'viewer'
  )
  on conflict (id) do nothing;
  return new;
end $$;
