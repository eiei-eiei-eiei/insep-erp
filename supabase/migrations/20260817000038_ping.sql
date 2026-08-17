-- ============================================================================
-- 0038 public.ping() — กันโปรเจกต์ Supabase แผนฟรี "หลับ" (project pausing)
--
-- ทำไมต้องมี: แผนฟรีจะ pause โปรเจกต์ที่ *"does not receive sufficient user
--   database activity over the past week"* (7 วัน) · เอกสารเขาไม่ประกาศเลขเกณฑ์
--   แต่บอกว่า *"a few user requests to the database each day"* พอกันหลับได้
--   → เรายิงวันละครั้ง (3 request/ครั้ง) จาก GitHub Actions + Task Scheduler ในเครื่อง
--   ดูภาพรวมทั้งระบบที่ docs/DECISIONS.md D60
--
-- 🪤 กับดักที่คนพลาดกันบ่อย: **pg_cron ที่ยิงตัวเองไม่นับ** — เกณฑ์คือ *user*
--    requests ที่เข้ามาจากข้างนอก งานที่ DB สั่งตัวเองไม่ช่วยอะไรเลย
--
-- 🚨 ฟังก์ชันนี้เปิดให้ role `anon` เรียกได้ (= ใครถือ anon key ก็เรียกได้ ซึ่ง
--    anon key เป็นค่าสาธารณะที่ติดไปกับ bundle ฝั่ง browser อยู่แล้ว)
--    → **ห้ามเติมอะไรเข้าฟังก์ชันนี้เด็ดขาด** ห้ามให้มันอ่านตาราง ห้ามรับพารามิเตอร์
--    ห้ามเขียนข้อมูล · หน้าที่มันมีอย่างเดียวคือ "ทำให้มี SQL วิ่งจริงแล้วตอบ 200"
--    ถ้าวันหนึ่งอยากได้ health check ที่บอกอะไรมากกว่านี้ → สร้างฟังก์ชันใหม่ที่
--    ต้องล็อกอิน อย่าขยายตัวนี้
--
-- ทำไมต้องเป็น RPC ไม่ใช่ `select` ตารางจริง: ตารางของเราถูก RLS/revoke คุมไว้
--   ทุกใบ → ยิงด้วย anon key แล้วอาจได้ 401/แถวว่าง ซึ่งเถียงไม่ได้ว่า Supabase
--   นับเป็น "user database activity" ให้หรือไม่ · RPC นี้การันตีว่า SQL วิ่งจริง
--   และได้ 200 ทุกครั้ง โดยไม่ต้องเอา SUPABASE_SERVICE_ROLE_KEY ขึ้น GitHub
-- ============================================================================

create or replace function public.ping()
returns timestamptz
language sql
stable                      -- stable → เรียกได้ทั้ง GET และ POST /rest/v1/rpc/ping
security invoker            -- ไม่ต้องเป็น definer: ไม่แตะอะไรที่ต้องมีสิทธิ์
set search_path = ''        -- ปิดช่อง search_path hijack (pg_catalog ยังอยู่ให้ now() เสมอ)
as $$ select now() $$;

comment on function public.ping() is
  'กันโปรเจกต์แผนฟรีหลับ — คืนเวลาปัจจุบันเท่านั้น ไม่แตะตารางใด ๆ '
  'เปิดให้ anon เรียกได้โดยเจตนา 🚨 ห้ามเติมความสามารถใด ๆ เข้าฟังก์ชันนี้ (0038 · D60)';

-- ── สิทธิ์: ยึดคืนทั้งหมดก่อน แล้วให้เท่าที่จำเป็น ──────────────────────────
--    ★ `revoke from public` ก่อนเสมอ — ปริยายของ Postgres คือ "ทุก role เรียกได้"
--      ซึ่งกว้างกว่าที่เราตั้งใจ (เผื่ออนาคตมี role อื่นในระบบ)
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated, service_role;

-- บอก PostgREST ให้โหลด schema ใหม่ ไม่ต้องรอ event trigger
notify pgrst, 'reload schema';
