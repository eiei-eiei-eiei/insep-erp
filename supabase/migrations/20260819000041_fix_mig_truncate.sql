-- ============================================================================
-- 0041 แก้ fn_mig_truncate ให้ตรงกับความจริงของ schema
--   1. เอา `scan_log` ออก — ตารางถูกลบไปแล้วใน 0039 → ฟังก์ชันพังทันทีเมื่อถูกเรียก
--   2. เพิ่ม 6 ตารางของโมดูลเงินเดือน (0040)
--
-- 🪤 บทเรียนที่ต้องจำ: **ลบตารางแล้วต้องไล่ดู "รายชื่อตารางที่ hardcode ไว้ใน SQL" ด้วย**
--    ไม่ใช่แค่ฝั่ง TypeScript · 0039 ไล่แก้ครบทั้ง 6 ไฟล์ฝั่ง TS แต่ลืมฟังก์ชันใน DB
--    → `npm run test:tenant` เป็นตัวเดียวที่จับได้ (unit test ออฟไลน์มองไม่เห็น SQL ใน DB)
--
-- 🚨 อาการถ้าไม่แก้: การรีเซ็ต/ลบข้อมูล tenant ล้มทั้งรายการด้วย
--    `relation "scan_log" does not exist` — และถ้าเพิ่มโมดูลใหม่แล้วไม่เติมตารางเข้าลิสต์
--    การลบจะติด FK ของ `entities` แทน (employees/payroll_periods อ้างอยู่)
-- ============================================================================

create or replace function fn_mig_truncate(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t text;
  -- เรียงตามลำดับ FK (ลูกก่อนแม่) เพราะ delete ไม่ cascade เองเหมือน truncate
  tables text[] := array[
    'transaction_items','transactions','tax_summaries','wht_certificates',
    'log_material','log_ferment','log_distill','log_distill_run',
    'log_ferment_monitor','log_dilute','log_product','stock_product',
    'sales_order_items','sales_orders','warehouse_stock','stock_moves','sale_menu',
    -- เงินเดือน (0040) — ต้องมาก่อน entities ไม่งั้นติด FK
    'payroll_items','payroll_periods','employees',
    'pay_components','pay_inputs','pay_rates',
    'contacts','bank_accounts',
    'materials','containers','products',
    'entities',
    'app_settings','integration_log','edit_log','report_runs','counters'
  ];
begin
  if p_tenant is null then
    raise exception 'fn_mig_truncate: ต้องระบุ tenant — ห้ามล้างข้ามลูกค้า';
  end if;
  foreach t in array tables loop
    execute format('delete from %I where tenant_id = $1', t) using p_tenant;
  end loop;
end $$;

notify pgrst, 'reload schema';
