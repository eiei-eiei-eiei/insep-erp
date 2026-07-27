-- ============================================================================
-- 0018 snapshots — จับสภาพข้อมูลทั้งระบบไว้ย้อนกลับ (D33)
--   ผู้ใช้ (main) จับ snapshot ตอนข้อมูลคลีน → ทดลองในระบบ → restore ย้อนกลับได้
--   ⚠️ ตารางนี้ *ไม่อยู่* ใน fn_mig_truncate → รอด truncate ตอน restore (ไม่ล้างตัวเอง)
--   payload = ข้อมูลทุกตารางเป็น jsonb · เขียนผ่าน service role (server action) เท่านั้น
-- ============================================================================

create table snapshots (
  id bigserial primary key,
  name text not null,
  created_at timestamptz not null default now(),
  created_by text,                    -- username ผู้จับ
  is_auto boolean not null default false,  -- true = auto-snapshot ก่อน restore
  row_counts jsonb not null default '{}'::jsonb,  -- {table: n} สำหรับ preview เร็ว
  payload jsonb not null              -- {table: [rows...]} ข้อมูลเต็ม
);
create index snapshots_created on snapshots (created_at desc);

alter table snapshots enable row level security;
-- main อ่านรายการได้ (ดู list/preview) · เขียน/ลบผ่าน service role เท่านั้น (ไม่มี write policy)
create policy snapshots_sel_main on snapshots for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'main')
);
