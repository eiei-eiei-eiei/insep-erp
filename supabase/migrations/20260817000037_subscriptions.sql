-- ============================================================================
-- 0037 ค่างวดลูกค้า (แอปจัดการหลังบ้าน เฟส 2) — docs/ADMIN_APP_REQUIREMENTS.md §3
--   subscriptions + subscription_payments + ธงแจ้งเตือนฝั่งลูกค้าบน tenants
--
-- 🚨 กติกาเดียวกับ 0035 ห้ามลืม: ตารางของแพลตฟอร์มต้อง
--    `enable row level security` **แล้วไม่สร้าง policy เลย** + `revoke all from anon, authenticated`
--    ที่นี่เดิมพันสูงกว่า 0035 อีก เพราะในตารางนี้มี **ราคาที่ลูกค้าแต่ละเจ้าจ่าย**
--    หลุดเมื่อไหร่ = ลูกค้ารู้ว่าอีกเจ้าจ่ายถูกกว่า ซึ่งพังทั้งความสัมพันธ์และอำนาจต่อรอง
--
--   เทสที่คุมข้อนี้: tests/tenant/platform-tables.test.ts (วนทุกตารางใน PLATFORM_TABLES)
-- ============================================================================

-- ── ค่างวดของลูกค้าแต่ละราย (1 ลูกค้า = 1 แถว) ────────────────────────────────
--    ★ ตัดรอบแบบ anniversary: ยึด started_on เป็นจุดตั้งต้นเสมอ แล้วนับด้วย periods_paid
--      **ห้ามคำนวณรอบถัดไปด้วยการบวกจาก current_period_end** — จะ drift ถาวร
--      (31 ม.ค. +1 เดือน = 28 ก.พ. แล้วรอบถัดไปได้ 28 มี.ค. ทั้งที่ควรเป็น 31 มี.ค.)
--      สูตรจริงอยู่ที่ lib/platform/billing.ts `periodEnd()` ซึ่งมี golden test คุม
create table if not exists subscriptions (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  plan text not null,                        -- ชื่อแพ็กเกจที่คนอ่านรู้เรื่อง เช่น 'ผลิต+บัญชี'
  price numeric(12,2) not null default 0,    -- ราคาต่อ 1 รอบ (ไม่ใช่ต่อเดือนเสมอไป)
  cycle text not null check (cycle in ('monthly','yearly')),
  started_on date not null,                  -- ★ จุดยึดวันตัดรอบ
  periods_paid int not null default 1 check (periods_paid >= 1),
  current_period_end date not null,          -- = periodEnd(started_on, cycle, periods_paid)
  status text not null default 'active'
    check (status in ('active','paused','cancelled')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table subscriptions enable row level security;
-- ⛔ จงใจไม่มี policy — **ห้ามเพิ่ม policy ให้ตารางนี้เด็ดขาด** แม้แต่ "ให้ลูกค้าอ่านแถวตัวเอง"
--    ถ้าลูกค้าต้องรู้วันครบกำหนด ให้ใช้ tenants.billing_due_on ที่มิเรอร์ไว้ (ไม่มีราคาติดไป)
revoke all on subscriptions from anon, authenticated;

comment on table subscriptions is
  'ค่างวดของลูกค้าแต่ละราย — RLS deny-all (ไม่มี policy) เข้าถึงได้เฉพาะ service role '
  '🚨 มีราคาที่ลูกค้าแต่ละเจ้าจ่าย ห้ามเปิด policy ให้ลูกค้าอ่านเด็ดขาด '
  'ลูกค้าต้องรู้แค่วันครบกำหนด → อ่านจาก tenants.billing_due_on';

comment on column subscriptions.status is
  'สถานะที่ "คนกด" เท่านั้น (active/paused/cancelled) '
  '⚠️ จงใจไม่มีค่า past_due — เลยกำหนดต้องคำนวณสดจาก current_period_end < วันนี้ '
  'เพราะเฟส 2 ไม่มี cron มาพลิกค่าให้ เก็บลง DB แล้วจะกลายเป็นค่าที่โกหก';

comment on column subscriptions.periods_paid is
  'จ่ายมาแล้วกี่รอบ — ใช้คู่กับ started_on คำนวณ current_period_end '
  'มีไว้กัน drift ของวันตัดรอบ ห้ามลบทิ้งแล้วหันไปบวกจาก current_period_end';

-- ── ประวัติการจ่าย ───────────────────────────────────────────────────────────
--    period_end_after เก็บไว้เพื่อย้อนดู/กู้ได้ว่า "จ่ายรอบนั้นแล้วดันไปถึงวันไหน"
create table if not exists subscription_payments (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  amount numeric(12,2) not null,
  paid_on date not null,
  period_end_after date not null,
  note text,
  created_by uuid,                           -- ไม่ใส่ FK: ลบบัญชีแอดมินแล้วประวัติต้องอยู่ต่อ
  created_at timestamptz not null default now()
);

alter table subscription_payments enable row level security;
-- ⛔ จงใจไม่มี policy (เหตุผลเดียวกับด้านบน)
revoke all on subscription_payments from anon, authenticated;

create index if not exists subscription_payments_tenant
  on subscription_payments (tenant_id, paid_on desc, id desc);

comment on table subscription_payments is
  'ประวัติการจ่ายค่างวด — RLS deny-all · ย้อนได้เฉพาะรายการล่าสุด (ย้อนอันกลางแล้วเลขรอบกำกวม)';

-- ── ธงแจ้งเตือนฝั่งลูกค้า (อยู่บน tenants ไม่ใช่ subscriptions) ────────────────
--    ลูกค้าอ่านแถว tenants ของตัวเองได้อยู่แล้วผ่าน policy tenants_sel (0025)
--    → มิเรอร์**เฉพาะวันครบกำหนด** ลงมาที่นี่ = แจ้งเตือนได้โดยไม่ต้องเปิด subscriptions ให้ใคร
--    🚨 ห้ามเพิ่มราคา/ชื่อแพ็กเกจลงคอลัมน์พวกนี้
--    🚨 ห้ามเพิ่มคอลัมน์พวกนี้เข้า view tenant_branding (view นั้น anon อ่านได้ก่อน login)
alter table tenants add column if not exists billing_due_on date;
alter table tenants add column if not exists billing_notice boolean not null default true;

comment on column tenants.billing_due_on is
  'วันครบกำหนดชำระถัดไป — มิเรอร์จาก subscriptions ด้วย trigger (null = ไม่ต้องเตือน) '
  'ลูกค้าอ่านได้ผ่าน policy tenants_sel · 🚨 ห้ามใส่ราคา/ชื่อแพ็กเกจลงคอลัมน์นี้';

comment on column tenants.billing_notice is
  'เปิด/ปิดการแจ้งเตือนค่างวดในแอปของลูกค้ารายนี้ (ลูกค้าที่จ่ายแบบวางบิล/PO ควรปิด)';

-- ── มิเรอร์ด้วย trigger ไม่ใช่เรียกจากโค้ด ────────────────────────────────────
--    หลักเดียวกับที่ 0036 เลือกใช้ trigger: **ครอบทุกทางเข้าพร้อมกัน**
--    (แอป · สคริปต์ service role · แก้มือใน SQL Editor) — เขียนในโค้ดแล้ววันหนึ่งจะลืมทางใดทางหนึ่ง
--    ★ status ที่ไม่ใช่ active → null = หยุดพัก/ยกเลิกแล้วต้องไม่ไปเตือนลูกค้า
create or replace function sync_tenant_billing_due() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    update tenants set billing_due_on = null where id = old.tenant_id;
    return old;
  end if;

  update tenants
  set billing_due_on = case when new.status = 'active' then new.current_period_end end
  where id = new.tenant_id;

  if tg_op = 'UPDATE' and old.tenant_id <> new.tenant_id then
    update tenants set billing_due_on = null where id = old.tenant_id;
  end if;
  return new;
end $$;

drop trigger if exists subscriptions_sync_due on subscriptions;
create trigger subscriptions_sync_due
after insert or update or delete on subscriptions
for each row execute function sync_tenant_billing_due();

notify pgrst, 'reload schema';
