-- ============================================================================
-- 0049 เลิกระบบ snapshot ในแอป — D82
--
-- 🎯 ทำไมตัดทิ้งแทนที่จะซ่อม: `restoreSnapshot()` เรียก `fn_mig_set_triggers(false)`
--    ซึ่ง **ไม่มีพารามิเตอร์ tenant** (Postgres สั่ง disable trigger ได้ระดับตารางเท่านั้น)
--    → ปิด trigger 9 ตาราง **ทั้งฐานข้อมูล กระทบลูกค้าทุกเจ้าที่อยู่ก้อนเดียวกัน**:
--      · edit_log ของเจ้าอื่นไม่บันทึก
--      · 🔴 stock trigger ไม่ทำงาน → เจ้าอื่นบันทึกบรรจุ/จ่ายตอนนั้น stock_product ไม่ขยับ
--        และไม่มีอะไรมาคำนวณให้ (recompute ยิงเฉพาะ tenant ที่กดย้อน) = สต็อกผิดถาวรเงียบ ๆ
--      · process ตายกลางทาง = trigger ค้างปิดทั้ง DB ตลอดไป
--    และ comment ของฟังก์ชันนั้นใน 0029 เขียนเองว่า "ห้ามรันบนระบบที่มีคนใช้อยู่"
--    แต่ restore เป็นปุ่มที่ลูกค้ากดเองได้ตลอดเวลา = โค้ดขัดกับกติกาที่ตัวเองเขียนไว้
--
-- ★ แทนด้วย: ปุ่ม **ดาวน์โหลดข้อมูล** (ลูกค้าเก็บไฟล์ไว้เอง) + `npm run restore:tenant` (เจ้าของ)
--   สคริปต์ตัวใหม่ **ไม่แตะ fn_mig_set_triggers** — ปล่อย trigger ทำงาน แล้ว recompute ปิดท้าย
--
-- ★ `fn_mig_set_triggers` **ยังเก็บไว้** — ผู้เรียกที่เหลือมีที่เดียวคือ `migration/import-csv.ts`
--   ซึ่งรันตอน cutover บนระบบเปล่า = ตรงตามกติกาที่เขียนกำกับไว้พอดี
-- ============================================================================

-- ── 1. ทิ้งตาราง snapshots ──────────────────────────────────────────────────
-- payload เก็บเป็น jsonb ก้อนใหญ่ใน DB ด้วย → ทิ้งแล้วคืนโควตาแผนฟรีไปในตัว
drop policy if exists snapshots_sel      on snapshots;
drop policy if exists snapshots_sel_main on snapshots;
drop table if exists snapshots;

-- ── 2. 🚨 fn_mig_truncate ต้องเอา 'snapshots' ออก ───────────────────────────
-- ของเดิม (0046) มี 'snapshots' อยู่ในลิสต์ → drop ตารางแล้วไม่แก้ =
-- `delete from snapshots` พังทันที = **ลบ/รีเซ็ตลูกค้าไม่ได้เลย** (ตระกูล D79 เป๊ะ ๆ)
-- ★ ลิสต์ที่เหลือคงเดิมทุกบรรทัดจาก 0046 · `lib/shared/tenantTables.test.ts` ไล่อ่านไฟล์นี้มาเทียบ
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

revoke execute on function fn_mig_truncate(uuid) from public;
grant  execute on function fn_mig_truncate(uuid) to service_role;

notify pgrst, 'reload schema';
