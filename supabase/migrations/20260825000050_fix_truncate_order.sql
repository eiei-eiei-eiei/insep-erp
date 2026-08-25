-- ============================================================================
-- 0050 fn_mig_truncate ลบ entities ก่อน report_runs — D82 (เจอตอนเทส restore จริง)
--
-- 🚨 อาการ: `rpc fn_mig_truncate: update or delete on table "entities" violates
--    foreign key constraint "report_runs_entity_id_fkey" on table "report_runs"`
--
--    `report_runs.entity_id` มี FK ชี้ไป `entities` (ผูกไว้ตั้งแต่ 0027) แต่ในลิสต์
--    ของ `fn_mig_truncate` มันอยู่**หลัง** `'entities'` → ลบแม่ก่อนลูก = ล้มทั้งฟังก์ชัน
--
-- 🔴 ผลกระทบจริง (บั๊กนี้มีมาตั้งแต่ 0029 — ก๊อปต่อกันมาถึง 0046/0049):
--    · **ลบ/รีเซ็ตลูกค้าจากหน้าแอดมินไม่ได้เลย** ถ้าลูกค้ารายนั้นเคยกดออกฟอร์ม ภส. สักครั้ง
--    · เอาข้อมูลกลับ (`npm run restore:tenant`) ล้มด้วยเหตุเดียวกัน
--
-- 🪤 ทำไม `npm run test:tenant` ไม่จับ: tenant ที่เทสสร้างขึ้นมาไม่เคยมีแถวใน `report_runs`
--    → FK ไม่มีอะไรให้ละเมิด · **ลิสต์ที่ "ครบ" ไม่ได้แปลว่า "เรียงถูก"** —
--    เทสเดิมตรวจแค่ว่ามีชื่อครบทุกตาราง ไม่ได้ตรวจลำดับ (เพิ่มเทสลำดับแล้วใน tenantTables.test.ts)
--
-- ★ แก้จุดเดียว: ย้าย 'report_runs' ขึ้นไปก่อน 'entities' · ที่เหลือคงเดิมทุกบรรทัด
-- ============================================================================
create or replace function fn_mig_truncate(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t text;
  -- เรียงตามลำดับ FK (ลูกก่อนแม่) เพราะ delete ไม่ cascade เองเหมือน truncate
  tables text[] := array[
    'transaction_items','transactions','tax_summaries','wht_certificates',
    'log_material','log_ferment','log_distill','log_distill_run',
    'log_ferment_monitor','log_dilute','log_ferment_draw','log_product','stock_product',
    'sales_order_items','sales_orders','warehouse_stock','stock_moves','sale_menu',
    -- เงินเดือน (0040 + 0042) — ต้องมาก่อน entities ไม่งั้นติด FK
    'payroll_items','payroll_periods','employees',
    'pay_components','pay_inputs','pay_rates','pay_variables','pay_post_legs',
    'contacts','bank_accounts',
    'materials','containers','products',
    -- ★ report_runs มี entity_id FK → ต้องมาก่อน entities ด้วย (0050)
    'report_runs',
    'entities',
    'app_settings','integration_log','edit_log','counters'
  ];
begin
  if p_tenant is null then
    raise exception 'fn_mig_truncate: ต้องระบุ tenant — ห้ามล้างข้ามลูกค้า';
  end if;
  foreach t in array tables loop
    execute format('delete from %I where tenant_id = $1', t) using p_tenant;
  end loop;
end $$;

revoke execute on function fn_mig_truncate(uuid) from public;
grant  execute on function fn_mig_truncate(uuid) to service_role;

notify pgrst, 'reload schema';
