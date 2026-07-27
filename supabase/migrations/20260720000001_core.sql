-- ============================================================================
-- 0001 core — ตารางส่วนกลาง (MIGRATION_PLAN sec 2.1)
--   entities · bank_accounts · profiles · contacts(+ฟิลด์ขาย) · app_settings
--   · integration_log · counters + next_serial()
-- ค่า enum ภาษาไทยคงตามเดิม (CHECK constraint กันสะกดผิด — กติกาเหล็กข้อ 4)
-- ============================================================================

-- กิจการ (ชีท Entities) + excise_id (เดิม Properties แอปผลิต — เฉพาะโรงสุรา)
create table entities (
  entity_id text primary key,               -- 'EID01'
  name text not null,
  type text,
  is_vat boolean not null default false,
  tax_id text,
  branch text default 'สำนักงานใหญ่',
  address text,
  excise_id text
);

-- บัญชีเงิน (ชีท Accounts) — entity_ids[] = ใช้ร่วมข้ามกิจการ (Option A เดิม)
create table bank_accounts (
  account_id text primary key,
  account_name text not null unique,        -- Transactions อ้างด้วย "ชื่อบัญชี"
  entity_ids text[] not null default '{}',
  kind text,
  opening_balance numeric(14,2) not null default 0,
  opening_date date
);

-- ผู้ใช้ (รวม Users บัญชี + inteam ขาย) ผูก Supabase Auth
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text,
  role text not null default 'viewer'
    check (role in ('main','viewer','sale','warehouse')),
  allowed_entity_ids text[],                -- null = ALL
  created_at timestamptz not null default now()
);

-- คู่ค้า/ลูกค้า — ★ยุบ custdata เข้าที่นี่ (FLOW_REDESIGN sec 8 ข้อ 1, แก้ T1)
--   เพิ่มฟิลด์ฝั่งขาย: phone/email/credit_term/sale_name/is_export/roles[]
create table contacts (
  contact_id text primary key,              -- 'C-0001' (running เดิม)
  name text not null,
  tax_id text,
  branch text,
  address text,
  contact_type text,                        -- 'ผู้ขาย'/'ลูกค้า' (ของเดิม — คงไว้)
  phone text,
  email text,
  credit_term int not null default 0,
  sale_name text,
  is_export boolean not null default false, -- ตัดสิน transType ไปแอปผลิต
  roles text[] not null default '{}',       -- {'ลูกค้า','ผู้ขาย'}
  created_at timestamptz not null default now()
);
-- กัน contact ซ้ำจาก whitespace/case (แทน logic B.2.2 เดิม)
create unique index contacts_name_norm on contacts (lower(trim(name)));

-- ค่าตั้งค่า (ชีท Settings col A-E → แถว kind/value)
create table app_settings (
  id bigserial primary key,
  kind text not null check (kind in
    ('expense_cat','income_cat','wht_rate','tax_account')),
  value text not null,
  sort int not null default 0,
  unique (kind, value)
);

-- log กลาง integration (ยุบ API_Log 2 แอป + แทน acc_sync_queue)
create table integration_log (
  id bigserial primary key,
  action text not null,                     -- 'SELL_PRODUCT'/'RECEIVE_MATERIAL'/'RECEIVE_REVENUE'
  idempotency_key text,
  status text not null,                     -- 'ok'/'duplicate'/'failed'
  message text,
  payload jsonb,
  created_at timestamptz not null default now()
);
-- 🔑 idempotency ใหม่: unique แทนการ scan sheet ทั้งใบ
create unique index integration_ok_key
  on integration_log (action, idempotency_key)
  where status = 'ok' and idempotency_key is not null;

-- เลขรันเอกสาร (แทน PropertiesService counters + scan sheet)
create table counters (
  key text primary key,
  value bigint not null default 0
);

-- next_serial — atomic increment (update ... returning) แทน LockService
create or replace function next_serial(p_key text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into counters (key, value) values (p_key, 1)
  on conflict (key) do update set value = counters.value + 1
  returning value into v;
  return v;
end $$;
