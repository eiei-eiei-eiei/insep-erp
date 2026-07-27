-- ============================================================================
-- 0005 reports + audit
--   report_runs — ตัวช่วยกันลืมว่าเดือนไหนสร้างรายงานอะไรแล้ว (FLOW sec 8 ข้อ 3)
--   edit_log    — audit ทุกการแก้ (FLOW sec 10.3) ทดแทน version history ของ Sheets
-- ============================================================================

create table report_runs (
  id bigserial primary key,
  report_key text not null,                 -- 'phor_so_07_01' / 'phor_por_30' ฯลฯ
  month text not null,                      -- 'yyyy-MM'
  entity_id text references entities(entity_id),
  created_at timestamptz not null default now()
);
create index rr_key_month on report_runs (report_key, month, entity_id, created_at desc);

-- audit log (before/after jsonb) — กู้ค่าที่แก้ผิดได้เองโดยไม่ต้องพึ่ง backup
create table edit_log (
  id bigserial primary key,
  table_name text not null,
  row_pk text,
  action text not null check (action in ('insert','update','delete')),
  before jsonb,
  after jsonb,
  user_id uuid,                             -- auth.uid() (null = migration/service)
  created_at timestamptz not null default now()
);
create index el_table_row on edit_log (table_name, row_pk, created_at desc);

-- trigger กลาง — รับชื่อคอลัมน์ PK เป็น argument (TG_ARGV[0])
create or replace function trg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pk_col text := tg_argv[0];
  rec jsonb;
begin
  if (tg_op = 'DELETE') then rec := to_jsonb(old); else rec := to_jsonb(new); end if;
  insert into edit_log (table_name, row_pk, action, before, after, user_id)
  values (
    tg_table_name,
    rec ->> pk_col,
    lower(tg_op),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) end,
    auth.uid()
  );
  return null;  -- after trigger
end $$;

-- attach บนตารางสำคัญ (transactions, log_* ทุกตัว, sales_orders)
create trigger audit_transactions after insert or update or delete on transactions
  for each row execute function trg_audit('tx_id');
create trigger audit_sales_orders after insert or update or delete on sales_orders
  for each row execute function trg_audit('qu_no');
create trigger audit_log_material after insert or update or delete on log_material
  for each row execute function trg_audit('id');
create trigger audit_log_ferment after insert or update or delete on log_ferment
  for each row execute function trg_audit('id');
create trigger audit_log_distill after insert or update or delete on log_distill
  for each row execute function trg_audit('id');
create trigger audit_log_distill_run after insert or update or delete on log_distill_run
  for each row execute function trg_audit('id');
create trigger audit_log_ferment_monitor after insert or update or delete on log_ferment_monitor
  for each row execute function trg_audit('id');
create trigger audit_log_dilute after insert or update or delete on log_dilute
  for each row execute function trg_audit('id');
create trigger audit_log_product after insert or update or delete on log_product
  for each row execute function trg_audit('id');
