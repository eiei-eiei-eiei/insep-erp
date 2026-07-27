-- ============================================================================
-- 0014 migration helpers (Phase 5) — เครื่องมือช่วย import/reconcile เท่านั้น
--   · fn_mig_truncate()        ล้างตารางข้อมูลทั้งหมดเพื่อโหลดใหม่ทับ (rerun/cutover)
--   · fn_mig_set_triggers(b)   ปิด/เปิด user trigger (audit + stock) ตอน bulk import
--   · fn_mig_recompute_stock() สร้าง stock_product จาก log_product (เรียกหลัง import)
-- เรียกผ่าน service role เท่านั้น (supabase-js .rpc) — DDL/TRUNCATE ทำผ่าน REST ไม่ได้
-- ⚠️ ทำลายข้อมูล — grant execute ให้ service_role อย่างเดียว
-- ============================================================================

-- ล้างทุกตารางที่ migration เขียน (ไม่แตะ profiles/auth.users — user สร้างเอง)
-- CASCADE + RESTART IDENTITY: ลบตามลำดับ FK อัตโนมัติ + reset bigserial
create or replace function fn_mig_truncate() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table
    transaction_items, transactions, tax_summaries, wht_certificates, scan_log,
    log_material, log_ferment, log_distill, log_distill_run,
    log_ferment_monitor, log_dilute, log_product, stock_product,
    sales_order_items, sales_orders, warehouse_stock, stock_moves, sale_menu,
    contacts, bank_accounts, entities,
    materials, containers, products,
    app_settings, integration_log, edit_log, report_runs, counters
  restart identity cascade;
end $$;

-- ปิด/เปิด user trigger บนตารางที่ import (audit_* + stock) — กัน edit_log บวมตอน bulk
-- + ให้ stock_product สร้างทีเดียวด้วย recompute (แทน trigger ยิงราย row)
create or replace function fn_mig_set_triggers(p_enable boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  t text;
  tbls text[] := array[
    'transactions','sales_orders',
    'log_material','log_ferment','log_distill','log_distill_run',
    'log_ferment_monitor','log_dilute','log_product'
  ];
begin
  foreach t in array tbls loop
    if p_enable then
      execute format('alter table %I enable trigger user', t);
    else
      execute format('alter table %I disable trigger user', t);
    end if;
  end loop;
end $$;

-- wrapper ให้เรียก recompute ผ่าน rpc ได้ (recompute_stock_product มีใน 0002 แล้ว)
create or replace function fn_mig_recompute_stock() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform recompute_stock_product();
end $$;

-- จำกัดสิทธิ์: อันตราย — เฉพาะ service_role (migration script) เท่านั้น
revoke execute on function fn_mig_truncate()            from public;
revoke execute on function fn_mig_set_triggers(boolean) from public;
revoke execute on function fn_mig_recompute_stock()     from public;
grant  execute on function fn_mig_truncate()            to service_role;
grant  execute on function fn_mig_set_triggers(boolean) to service_role;
grant  execute on function fn_mig_recompute_stock()     to service_role;
