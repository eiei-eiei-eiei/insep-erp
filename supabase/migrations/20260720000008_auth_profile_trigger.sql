-- ============================================================================
-- 0008 auto-profile — สร้างแถว profiles อัตโนมัติเมื่อมี auth user ใหม่
--   ลดงาน onboarding: สร้าง user ใน Authentication แล้วได้ profile (role viewer) เลย
--   เจ้าของ (main) แค่ปรับ role ทีหลัง — ไม่ต้อง insert profile มือทุกครั้ง
-- (pattern มาตรฐาน Supabase — trigger บน auth.users)
-- ============================================================================

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name, role)
  values (
    new.id,
    new.email,                                 -- อีเมลเต็ม (unique อยู่แล้ว) = username
    split_part(new.email, '@', 1),             -- ส่วนหน้า @ = ชื่อแสดงผลเริ่มต้น
    'viewer'                                    -- ค่าเริ่มต้นปลอดภัยสุด — main ค่อยปรับขึ้น
  )
  on conflict (id) do nothing;                 -- ถ้ามี profile อยู่แล้ว (สร้างมือ) ไม่ทับ
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
