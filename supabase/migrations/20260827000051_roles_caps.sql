-- ============================================================================
-- 0051 บทบาท 9 ตัว + สิทธิ์แบบ capability (D85)
--
--   ของเดิม 4 บทบาท (main/viewer/sale/warehouse) **กัน "แก้" แน่นแต่แทบไม่กัน "ดู"**
--   policy select ส่วนใหญ่เขียนว่า `using (auth.uid() is not null)` = ใครล็อกอินก็อ่านหมด
--   ทั้งบิลบัญชีทุกใบ · ราคาทุน · สูตรการผลิต · ประวัติราคาขายลูกค้าทุกราย
--   (กันจริงมีแค่โมดูลเงินเดือนกับ edit_log)
--
--   ไฟล์นี้เปลี่ยนเป็น **ถามความสามารถ ไม่ใช่ถามว่าเป็นใคร** → เพิ่มบทบาทใหม่แก้ที่เดียว
--
-- 🚨 ตาราง cap มีฝาแฝดฝั่ง TypeScript ที่ `lib/shared/roles.ts` — แก้ที่นี่ต้องแก้ที่นั่นด้วย
--    ฝั่งนี้คือตัวจริงที่บังคับ · ฝั่งโน้นคุมแค่ว่าหน้าจอโชว์อะไร
--
-- 🚨 ไฟล์นี้ **เขียน policy ใหม่ทั้งหมด** ตามแพตเทิร์นของ 0028 (drop ทุกอันแล้วสร้างใหม่)
--    เพื่อให้ "อ่านไฟล์เดียวจบว่าสิทธิ์จริงคืออะไร" — ห้ามเขียนแบบแก้ทีละ policy
-- ============================================================================

-- ── 1. บทบาทใหม่ + ย้ายของเดิม ──────────────────────────────────────────────
--    sale/warehouse ยุบเป็น sales ตัวเดียว (ผู้ใช้ตัดสิน: คนขายกับคนคลังเป็นคนเดียวกัน)
--    🚨 คนที่เคยเป็น warehouse จะ **ได้สิทธิ์เพิ่ม** (ออกใบเสนอราคาได้)
--       ต้องแจ้งเจ้าของกิจการก่อนลงบน DB ที่มีผู้ใช้จริง
--
-- ★ ไม่ต้องปิด user trigger แบบ D50 — ตรวจแล้วว่า `profiles` ไม่มี trigger สักตัว
--   และนี่เป็น update คอลัมน์เดิม ไม่ใช่ backfill คอลัมน์ใหม่
-- 🪤 ต้อง drop constraint **ก่อน** update — ค่า 'sales' ยังไม่ผ่าน check ตัวเก่า
alter table profiles drop constraint if exists profiles_role_check;
update profiles set role = 'sales' where role in ('sale', 'warehouse');
alter table profiles add constraint profiles_role_check
  check (role in ('main','viewer','sales_manager','sales',
                  'finance_manager','accounting_manager','accounting',
                  'payroll_manager','payroll'));

-- ── 2. has_cap() — ตารางสิทธิ์แหล่งเดียวของฝั่ง DB ──────────────────────────
--    security definer เพราะต้องอ่าน profiles ข้าม RLS (กัน recursion) — เหมือน my_role()
--    stable เพื่อให้ planner เรียกครั้งเดียวต่อ query ไม่ใช่ต่อแถว (NEXT_STEPS 4.8)
create or replace function has_cap(cap text) returns boolean
language sql stable security definer set search_path = public as $$
  select case (select role from profiles where id = auth.uid())
    when 'main'               then true
    when 'viewer'             then cap in ('prod.read','acct.read','sales.read')
    when 'sales_manager'      then cap in ('sales.read','sales.write','sales.config')
    when 'sales'              then cap in ('sales.read','sales.write')
    when 'finance_manager'    then cap in ('acct.read','acct.write','acct.config',
                                           'pay.read','pay.write','pay.config')
    when 'accounting_manager' then cap in ('acct.read','acct.write','acct.config')
    when 'accounting'         then cap in ('acct.read','acct.write')
    when 'payroll_manager'    then cap in ('pay.read','pay.write','pay.config')
    when 'payroll'            then cap in ('pay.read','pay.write')
    -- ★ ค่าเก่าก่อนไฟล์นี้ — ไม่ควรเหลือแล้วหลัง backfill ข้างบน แต่กันไว้เผื่อ
    --   แถวที่ถูกสร้างโดย trigger ระหว่าง deploy ที่โค้ดเก่ายังวิ่งอยู่
    when 'sale'               then cap in ('sales.read','sales.write')
    when 'warehouse'          then cap in ('sales.read','sales.write')
    -- ยังไม่ล็อกอิน / role ที่ไม่รู้จัก = ไม่มีสิทธิ์อะไรเลย (fail closed)
    else false
  end;
$$;

comment on function has_cap(text) is
  'ผู้ใช้ปัจจุบันมีความสามารถนี้ไหม — ฝาแฝดของ ROLE_CAPS ใน lib/shared/roles.ts '
  'แก้ที่เดียวไม่พอ ต้องแก้ทั้งสองที่เสมอ';

-- ── 3. app_setting_cap() — ค่าตั้งค่าแต่ละชนิดเป็นของโดเมนไหน ───────────────
--    app_settings เป็นตารางรวมของทั้งระบบ (แบรนด์ · LINE · หมวดบัญชี · คอนฟิกเงินเดือน)
--    ถ้าใช้ policy เดียวคุมทั้งตาราง = หัวหน้าฝ่ายบุคคลแก้สีแบรนด์ได้ ซึ่งไม่ใช่เรื่องของเขา
create or replace function app_setting_cap(k text) returns text
language sql immutable set search_path = public as $$
  select case
    when k = 'pay_group' or k like 'payroll\_%' then 'pay.config'
    when k in ('expense_cat','income_cat','wht_rate','tax_account','material_forward_cat')
      then 'acct.config'
    -- ที่เหลือเป็นค่าระดับกิจการ: แบรนด์ · โทเคน LINE · กิจการที่ออกเอกสาร · บัญชีรับรายได้
    -- → หน้าตั้งค่ากลาง ซึ่งเป็นของ main เท่านั้น
    else 'admin'
  end;
$$;

-- ── 4. ล้าง policy เดิมทั้งหมดแล้วเขียนใหม่ ─────────────────────────────────
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and tablename <> 'tenants'
  loop
    execute format('drop policy if exists %I on %I.%I',
                   r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  ส่วนกลาง — ทุกคนใน tenant อ่านได้ (ข้อมูลของกิจการตัวเอง ไม่ใช่ความลับระหว่างฝ่าย)
-- ════════════════════════════════════════════════════════════════════════════

-- profiles: เห็นตัวเอง · main เห็นทั้ง tenant · แก้ได้เฉพาะคนจัดการผู้ใช้
create policy profiles_sel on profiles for select
  using (tenant_id = my_tenant() and (id = auth.uid() or has_cap('admin')));
create policy profiles_write on profiles for all
  using (tenant_id = my_tenant() and has_cap('admin'))
  with check (tenant_id = my_tenant() and has_cap('admin'));

-- bank_accounts: ทุกคนอ่านได้ (ดร็อปดาวน์บัญชีเงินใช้ทั้งบัญชีและเงินเดือน)
--                แก้ได้จากแท็บตั้งค่าของบัญชี
create policy bank_accounts_sel on bank_accounts for select
  using (tenant_id = my_tenant());
create policy bank_accounts_w on bank_accounts for all
  using (tenant_id = my_tenant() and has_cap('acct.config'))
  with check (tenant_id = my_tenant() and has_cap('acct.config'));

-- app_settings: 🚨 ห้ามปิด select ทั้งตาราง — (app)/layout.tsx โหลด brand_* ให้ทุก role
--    ไว้วาดแถบเมนู ปิดหมดแล้วพนักงานเข้าแอปไม่ได้เลยทั้งระบบ (กติกาจาก 0033 คงไว้ทั้งดุ้น)
create policy app_settings_sel on app_settings for select
  using (
    tenant_id = my_tenant()
    and (has_cap('admin') or kind not in ('line_channel_token','line_group_id'))
  );
create policy app_settings_w on app_settings for all
  using (tenant_id = my_tenant() and has_cap(app_setting_cap(kind)))
  with check (tenant_id = my_tenant() and has_cap(app_setting_cap(kind)));

comment on policy app_settings_sel on app_settings is
  'อ่านได้ทุกบทบาทใน tenant (แถบเมนูต้องใช้ brand_*) แต่โทเคน LINE อ่านได้เฉพาะ main '
  'ซ่อนที่ UI อย่างเดียวกันไม่ได้ เพราะ anon key เป็นค่าสาธารณะ ใครก็ยิง PostgREST ตรงได้';

-- contacts: คู่ค้า/ลูกค้า — ทั้งฝั่งขายและฝั่งบัญชีสร้างได้ (เงินเดือนอ่านอย่างเดียว
--           เพื่อเติมชื่อคู่ค้าของขาลงบัญชี)
create policy contacts_sel on contacts for select
  using (tenant_id = my_tenant());
create policy contacts_w on contacts for all
  using (tenant_id = my_tenant() and (has_cap('sales.write') or has_cap('acct.write')))
  with check (tenant_id = my_tenant() and (has_cap('sales.write') or has_cap('acct.write')));

-- integration_log / counters: อ่านได้ · เขียนผ่าน RPC เท่านั้น (ไม่มี write policy โดยตั้งใจ)
create policy integration_log_sel on integration_log for select
  using (tenant_id = my_tenant());
create policy counters_sel on counters for select
  using (tenant_id = my_tenant());

-- entities: แก้ข้อมูลกิจการได้ (หัวเอกสารการค้า) แต่ **สร้างกิจการที่ 2 เองไม่ได้**
--   — เป็น add-on ที่ขายแยก insert/delete ทำได้เฉพาะ service role (กติกาจาก 0028 คงไว้)
create policy entities_sel on entities for select
  using (tenant_id = my_tenant()
         and (my_entities() is null or entity_id = any(my_entities())));
create policy entities_upd on entities for update
  using (tenant_id = my_tenant() and has_cap('admin'))
  with check (tenant_id = my_tenant() and has_cap('admin'));

-- ════════════════════════════════════════════════════════════════════════════
--  บัญชี — 🔴 ของใหม่: ฝ่ายขาย/เงินเดือน **อ่านบิลไม่ได้อีกต่อไป**
-- ════════════════════════════════════════════════════════════════════════════
create policy tx_sel on transactions for select
  using (tenant_id = my_tenant() and has_cap('acct.read')
         and (my_entities() is null or entity_id = any(my_entities())));
create policy tx_w on transactions for all
  using (tenant_id = my_tenant() and has_cap('acct.write')
         and (my_entities() is null or entity_id = any(my_entities())))
  with check (tenant_id = my_tenant() and has_cap('acct.write')
         and (my_entities() is null or entity_id = any(my_entities())));

create policy ti_sel on transaction_items for select using (
  tenant_id = my_tenant() and has_cap('acct.read')
  and exists (select 1 from transactions t
              where t.tenant_id = transaction_items.tenant_id
                and t.tx_id = transaction_items.tx_id
                and (my_entities() is null or t.entity_id = any(my_entities()))));
create policy ti_w on transaction_items for all
  using (tenant_id = my_tenant() and has_cap('acct.write'))
  with check (tenant_id = my_tenant() and has_cap('acct.write'));

create policy ts_sel on tax_summaries for select
  using (tenant_id = my_tenant() and has_cap('acct.read')
         and (my_entities() is null or entity_id = any(my_entities())));
create policy ts_w on tax_summaries for all
  using (tenant_id = my_tenant() and has_cap('acct.write'))
  with check (tenant_id = my_tenant() and has_cap('acct.write'));

-- wht_certificates: ตารางเดียวเก็บ 50ทวิ ของ **คู่ค้า** และของ **พนักงาน** ปนกัน
--   🪤 ฝ่ายเงินเดือนต้องเห็นเฉพาะใบของพนักงาน (emp_id ไม่ว่าง) ไม่ใช่ใบของคู่ค้า
--      ซึ่งเปิดเผยว่าจ่ายใครเท่าไหร่ — แยกด้วยคอลัมน์ ไม่ใช่แยกตาราง
create policy wht_sel on wht_certificates for select
  using (tenant_id = my_tenant()
         and (has_cap('acct.read') or (has_cap('pay.read') and emp_id is not null))
         and (my_entities() is null or entity_id = any(my_entities())));
create policy wht_w on wht_certificates for all
  using (tenant_id = my_tenant() and (has_cap('acct.write') or has_cap('pay.write')))
  with check (tenant_id = my_tenant() and (has_cap('acct.write') or has_cap('pay.write')));

-- ════════════════════════════════════════════════════════════════════════════
--  ผลิต
-- ════════════════════════════════════════════════════════════════════════════

-- 🪤 products + stock_product = **แคตตาล็อกสินค้า** ที่หน้าขายต้องใช้ (เมนูขาย + ยอดคงเหลือ)
--    → เปิดให้ทั้ง prod.read และ sales.read อ่าน
--    ★ ห้ามแก้ด้วยการเติม prod.read ให้ฝ่ายขายแทน — นั่นจะเปิดสูตรการผลิตทั้งหมดให้ด้วย
create policy products_sel on products for select
  using (tenant_id = my_tenant() and (has_cap('prod.read') or has_cap('sales.read')));
create policy products_w on products for all
  using (tenant_id = my_tenant() and has_cap('prod.write'))
  with check (tenant_id = my_tenant() and has_cap('prod.write'));

create policy stock_product_sel on stock_product for select
  using (tenant_id = my_tenant() and (has_cap('prod.read') or has_cap('sales.read')));
-- ไม่มี write policy โดยตั้งใจ — เขียนผ่าน apply_stock_delta/recompute เท่านั้น

-- materials: ฝั่งบัญชีต้องอ่านได้ (ดร็อปดาวน์รับวัตถุดิบเข้าสต็อกผลิต · D79)
--   ★ เป็น "รายชื่อวัตถุดิบ" ไม่ใช่ต้นทุน — ต้นทุนอยู่ใน transactions ซึ่งปิดตามสิทธิ์บัญชีอยู่แล้ว
create policy materials_sel on materials for select
  using (tenant_id = my_tenant() and (has_cap('prod.read') or has_cap('acct.read')));
create policy materials_w on materials for all
  using (tenant_id = my_tenant() and has_cap('prod.write'))
  with check (tenant_id = my_tenant() and has_cap('prod.write'));

-- ที่เหลือของฝั่งผลิต = สูตร/ค่าดีกรี/ยอดกลั่น → เห็นได้เฉพาะคนที่เข้าหน้าผลิตได้
do $$
declare
  t text;
  tables text[] := array[
    'containers',
    'log_material','log_ferment','log_distill','log_distill_run',
    'log_ferment_monitor','log_dilute','log_ferment_draw','log_product',
    'report_runs'
  ];
begin
  foreach t in array tables loop
    execute format(
      'create policy %I on %I for select
         using (tenant_id = my_tenant() and has_cap(''prod.read''))',
      t || '_sel', t);
    execute format(
      'create policy %I on %I for all
         using (tenant_id = my_tenant() and has_cap(''prod.write''))
         with check (tenant_id = my_tenant() and has_cap(''prod.write''))',
      t || '_w', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  ขาย
-- ════════════════════════════════════════════════════════════════════════════

-- sale_menu: เมนู+ราคาขาย → แก้ได้จากแท็บ "จัดการข้อมูล" ของหน้าขาย
create policy sale_menu_sel on sale_menu for select
  using (tenant_id = my_tenant() and has_cap('sales.read'));
create policy sale_menu_w on sale_menu for all
  using (tenant_id = my_tenant() and has_cap('sales.config'))
  with check (tenant_id = my_tenant() and has_cap('sales.config'));

-- sales_orders: 🪤 ฝั่งบัญชีต้องอ่านได้ — แท็บลูกหนี้-เจ้าหนี้แสดง "ยอดค้างออเดอร์"
create policy so_sel on sales_orders for select
  using (tenant_id = my_tenant() and (has_cap('sales.read') or has_cap('acct.read')));
create policy so_w on sales_orders for all
  using (tenant_id = my_tenant() and has_cap('sales.write'))
  with check (tenant_id = my_tenant() and has_cap('sales.write'));

create policy soi_sel on sales_order_items for select
  using (tenant_id = my_tenant() and (has_cap('sales.read') or has_cap('acct.read')));
create policy soi_w on sales_order_items for all
  using (tenant_id = my_tenant() and has_cap('sales.write'))
  with check (tenant_id = my_tenant() and has_cap('sales.write'));

create policy ws_sel on warehouse_stock for select
  using (tenant_id = my_tenant() and has_cap('sales.read'));
create policy ws_w on warehouse_stock for all
  using (tenant_id = my_tenant() and has_cap('sales.write'))
  with check (tenant_id = my_tenant() and has_cap('sales.write'));

create policy sm_sel on stock_moves for select
  using (tenant_id = my_tenant() and has_cap('sales.read'));
create policy sm_w on stock_moves for all
  using (tenant_id = my_tenant() and has_cap('sales.write'))
  with check (tenant_id = my_tenant() and has_cap('sales.write'));

-- ════════════════════════════════════════════════════════════════════════════
--  เงินเดือน — 🚨 ข้อมูลอ่อนไหวที่สุดในระบบ · **viewer ก็ไม่เห็น** (ตัดสินไว้ตอนวางแผน)
-- ════════════════════════════════════════════════════════════════════════════

-- ตารางที่มี entity_id → พ่วง entity scope ด้วย
create policy employees_sel on employees for select
  using (tenant_id = my_tenant() and has_cap('pay.read')
         and (my_entities() is null or entity_id = any(my_entities())));
create policy employees_w on employees for all
  using (tenant_id = my_tenant() and has_cap('pay.write')
         and (my_entities() is null or entity_id = any(my_entities())))
  with check (tenant_id = my_tenant() and has_cap('pay.write')
         and (my_entities() is null or entity_id = any(my_entities())));

create policy pp_sel on payroll_periods for select
  using (tenant_id = my_tenant() and has_cap('pay.read')
         and (my_entities() is null or entity_id = any(my_entities())));
create policy pp_w on payroll_periods for all
  using (tenant_id = my_tenant() and has_cap('pay.write')
         and (my_entities() is null or entity_id = any(my_entities())))
  with check (tenant_id = my_tenant() and has_cap('pay.write')
         and (my_entities() is null or entity_id = any(my_entities())));

-- งวดจ่ายรายคน = งานประจำวัน → pay.write
create policy pi_sel on payroll_items for select
  using (tenant_id = my_tenant() and has_cap('pay.read'));
create policy pi_w on payroll_items for all
  using (tenant_id = my_tenant() and has_cap('pay.write'))
  with check (tenant_id = my_tenant() and has_cap('pay.write'));

-- ★ ตาราง config ของเงินเดือน = **เกณฑ์การคำนวณ** → ต้อง pay.config ไม่ใช่ pay.write
--   (พนักงานเงินเดือนกรอกชั่วโมง OT ได้ แต่แก้สูตรคิดเงินไม่ได้)
do $$
declare
  t text;
  tables text[] := array['pay_inputs','pay_components','pay_rates','pay_variables','pay_post_legs'];
begin
  foreach t in array tables loop
    execute format(
      'create policy %I on %I for select
         using (tenant_id = my_tenant() and has_cap(''pay.read''))',
      t || '_sel', t);
    execute format(
      'create policy %I on %I for all
         using (tenant_id = my_tenant() and has_cap(''pay.config''))
         with check (tenant_id = my_tenant() and has_cap(''pay.config''))',
      t || '_w', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  audit
-- ════════════════════════════════════════════════════════════════════════════
-- edit_log มีค่าเก่า/ค่าใหม่ของทุกตารางปนกัน (รวมเงินเดือนและบิล) → main เท่านั้น
create policy edit_log_sel on edit_log for select
  using (tenant_id = my_tenant() and has_cap('admin'));

-- ── Storage ─────────────────────────────────────────────────────────────────
drop policy if exists "pdf_templates_read"       on storage.objects;
drop policy if exists "pdf_templates_write_main" on storage.objects;
drop policy if exists "receipts_read"            on storage.objects;
drop policy if exists "receipts_write_main"      on storage.objects;

-- pdf-templates: **จงใจแชร์ข้ามลูกค้า** — ฟอร์มราชการ + ฟอนต์ THSarabun เหมือนกันทุกโรง
create policy "pdf_templates_read" on storage.objects for select
  using (bucket_id = 'pdf-templates' and auth.uid() is not null);
create policy "pdf_templates_write_main" on storage.objects for insert
  with check (bucket_id = 'pdf-templates' and public.has_cap('admin'));

create policy "receipts_read" on storage.objects for select
  using (bucket_id = 'receipts'
         and (storage.foldername(name))[1] = public.my_tenant()::text);
create policy "receipts_write_main" on storage.objects for all
  using (bucket_id = 'receipts' and public.has_cap('acct.write')
         and (storage.foldername(name))[1] = public.my_tenant()::text)
  with check (bucket_id = 'receipts' and public.has_cap('acct.write')
         and (storage.foldername(name))[1] = public.my_tenant()::text);

-- ════════════════════════════════════════════════════════════════════════════
--  5. RPC — ฟังก์ชัน security definer bypass RLS ทั้งหมด จึงต้องเช็คสิทธิ์เอง
--
--  🚨 policy ถูกครบแต่ลืม RPC = คนที่ไม่มีสิทธิ์ยิง action ตรงแล้วผ่าน (บทเรียน 0028→0029)
--  ★ ตัวฟังก์ชันด้านล่างถูก **ยกมาจาก migration เดิมทั้งดุ้นด้วยสคริปต์**
--    (scripts/gen-0051.mjs) เปลี่ยนเฉพาะบรรทัดเช็คสิทธิ์ — ไม่ได้พิมพ์ใหม่ด้วยมือ
--    เพื่อไม่ให้เกิดเหตุแบบ D79 ที่บั๊กถูกก๊อปต่อจากไฟล์หนึ่งไปอีกไฟล์
--
--  🚨 fn_save_transaction / fn_edit_transaction / fn_issue_wht **ไม่ต้องแก้**
--     เพราะเป็น invoker (ไม่ใช่ definer) → ถูกกั้นด้วย policy ข้างบนอยู่แล้ว
-- ════════════════════════════════════════════════════════════════════════════

-- fn_receive_material — ยกมาจาก 20260824000046_fix_forward_material.sql ทั้งดุ้น เปลี่ยนเฉพาะบรรทัดเช็คสิทธิ์
create or replace function fn_receive_material(
  p_idempotency_key text, p_date date, p_doc_ref text, p_note text, p_items jsonb,
  p_entity text default null      -- ★ ใหม่: กิจการของบิล (null = กิจการหลักของคนล็อกอิน)
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  mid text;
  n int := 0;
  v_tenant uuid := my_tenant();
  v_entity text := coalesce(nullif(p_entity, ''), my_default_entity());
  v_name text;
begin
  if not has_cap('acct.write') then
    raise exception 'ไม่มีสิทธิ์บันทึกรับวัตถุดิบ';
  end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if v_entity is null then raise exception 'ไม่รู้ว่าจะรับวัตถุดิบเข้ากิจการไหน'; end if;

  begin
    insert into integration_log(tenant_id, action, idempotency_key, status, payload)
    values (v_tenant, 'RECEIVE_MATERIAL', p_idempotency_key, 'ok', p_items);
  exception when unique_violation then
    return jsonb_build_object('duplicate', true);
  end;

  for it in select value from jsonb_array_elements(p_items) loop
    v_name := nullif(trim(coalesce(it ->> 'material_name', '')), '');
    if v_name is not null and (it ->> 'amount') is not null then
      -- match ด้วยชื่อเป๊ะ (trim) เหมือนเดิม — ห้าม fuzzy · จำกัดใน tenant + กิจการของบิล
      select material_id into mid from materials
        where tenant_id = v_tenant and entity_id = v_entity and trim(name) = v_name
        limit 1;
      if mid is null then
        -- อยู่คนละกิจการ = คนละเรื่องกับสะกดผิด ต้องบอกให้ต่างกัน ไม่งั้นผู้ใช้ไล่หาผิดทาง
        if exists (select 1 from materials where tenant_id = v_tenant and trim(name) = v_name) then
          raise exception 'วัตถุดิบ ''%'' มีอยู่ แต่คนละกิจการกับบิล (บิลลงกิจการ %)', v_name, v_entity;
        end if;
        raise exception 'ไม่พบชื่อวัตถุดิบ ''%'' กรุณาตรวจการสะกด', v_name;
      end if;
      insert into log_material(tenant_id, entity_id, doc_date, trans_type, material_id, amount, doc_ref, note)
      values (v_tenant, v_entity, coalesce(p_date, current_date), 'รับ', mid,
              (it ->> 'amount')::numeric, p_doc_ref, coalesce(p_note, 'รับจากระบบจัดซื้อ'));
      n := n + 1;
    end if;
  end loop;

  return jsonb_build_object('duplicate', false, 'count', n);
end $$;

-- fn_sell_product — ยกมาจาก 20260811000029_tenant_rpc.sql ทั้งดุ้น เปลี่ยนเฉพาะบรรทัดเช็คสิทธิ์
create or replace function fn_sell_product(
  p_idempotency_key text, p_date date, p_trans_type text, p_note text, p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it jsonb; n int := 0; v_tenant uuid := my_tenant();
begin
  if not has_cap('sales.write') then
    raise exception 'ไม่มีสิทธิ์ตัดสต็อกขาย';
  end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;

  begin
    insert into integration_log(tenant_id, action, idempotency_key, status, message, payload)
    values (v_tenant, 'SELL_PRODUCT', p_idempotency_key, 'ok', 'ตัดสต็อกขาย', p_items);
  exception when unique_violation then
    return jsonb_build_object('duplicate', true,
      'message', 'ข้ามบันทึกซ้ำ: '||coalesce(p_idempotency_key,''));
  end;

  for it in select value from jsonb_array_elements(p_items) loop
    if (it->>'product_id') is not null and (it->>'amount') is not null then
      insert into log_product(doc_date, trans_type, product_id, amount, note)
      values (coalesce(p_date, current_date), coalesce(p_trans_type, 'จ่าย'),
              it->>'product_id', (it->>'amount')::numeric, p_note);
      n := n + 1;
    end if;
  end loop;

  return jsonb_build_object('duplicate', false, 'count', n);
end $$;

-- fn_apply_order_action — ยกมาจาก 20260811000029_tenant_rpc.sql ทั้งดุ้น เปลี่ยนเฉพาะบรรทัดเช็คสิทธิ์
create or replace function fn_apply_order_action(p_qu_no text, p_update jsonb, p_revenue jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tx_id text;
  v_dup boolean := false;
  it jsonb; idx int := 0;
  v_tenant uuid := my_tenant();
begin
  if not has_cap('sales.write') then raise exception 'ไม่มีสิทธิ์บันทึกการขาย'; end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;

  update sales_orders set
    status              = coalesce(p_update->>'status', status),
    deposit             = coalesce((p_update->>'deposit')::numeric, deposit),
    outstanding_balance = coalesce((p_update->>'outstandingBalance')::numeric, outstanding_balance),
    due_date            = coalesce(_d(p_update,'dueDate'), due_date),
    payment_method      = coalesce(nullif(p_update->>'paymentMethod',''), payment_method),
    inv_no              = coalesce(nullif(p_update->>'invNo',''), inv_no),
    tax_no1             = coalesce(nullif(p_update->>'taxNo1',''), tax_no1),
    tax_no2             = coalesce(nullif(p_update->>'taxNo2',''), tax_no2),
    check_detail1       = coalesce(p_update->>'checkDetail1', check_detail1),
    check_detail2       = coalesce(p_update->>'checkDetail2', check_detail2),
    doc_to_print        = coalesce(nullif(p_update->>'docToPrint',''), doc_to_print),
    next_status         = coalesce(nullif(p_update->>'nextStatus',''), next_status),
    doc_date1           = coalesce(_d(p_update,'docDate1'), doc_date1),
    doc_date2           = coalesce(_d(p_update,'docDate2'), doc_date2),
    dep_inv_no          = coalesce(nullif(p_update->>'depInvNo',''), dep_inv_no),
    dep_inv_date        = coalesce(_d(p_update,'depInvDate'), dep_inv_date),
    dep_inv_amount      = coalesce((p_update->>'depInvAmount')::numeric, dep_inv_amount),
    dep_due_date        = coalesce(_d(p_update,'depDueDate'), dep_due_date)
  where qu_no = p_qu_no and tenant_id = v_tenant;      -- ★ กันแก้ออเดอร์ของลูกค้าเจ้าอื่น
  if not found then raise exception 'ไม่พบออเดอร์ %', p_qu_no; end if;

  if p_revenue is not null and p_revenue <> 'null'::jsonb then
    -- idempotency: RECEIVE_REVENUE key ชน unique = เคยลงบัญชีแล้ว → duplicate (ไม่ลงซ้ำ)
    begin
      insert into integration_log(tenant_id, action, idempotency_key, status, message, payload)
      values (v_tenant, 'RECEIVE_REVENUE', p_revenue->>'idempotencyKey', 'ok',
              'รายรับจากขาย ' || p_qu_no, p_revenue);
    exception when unique_violation then
      v_dup := true;
    end;

    if not v_dup then
      v_tx_id := next_tx_id();
      insert into transactions(
        tenant_id, tx_id, transaction_date, type, account_name, category, contact_name, contact_id,
        description, base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount,
        net_amount, tax_invoice_no, tax_invoice_date, status, entity_id, idempotency_key, source
      ) values (
        v_tenant, v_tx_id, _d(p_revenue,'taxInvoiceDate'), 'รายรับ',
        nullif(p_revenue->>'accountName',''), p_revenue->>'category', p_revenue->>'contactName',
        nullif(p_revenue->>'contactId',''),
        p_revenue->>'description',
        coalesce((p_revenue->>'baseAmount')::numeric,0), coalesce((p_revenue->>'discount')::numeric,0),
        coalesce((p_revenue->>'amountAfterDiscount')::numeric,0), coalesce((p_revenue->>'vatAmount')::numeric,0),
        coalesce((p_revenue->>'whtRate')::numeric,0), coalesce((p_revenue->>'whtAmount')::numeric,0),
        coalesce((p_revenue->>'netAmount')::numeric,0),
        nullif(p_revenue->>'taxInvoiceNo',''), _d(p_revenue,'taxInvoiceDate'),
        'ปกติ', p_revenue->>'entityId', p_revenue->>'idempotencyKey', 'sales'
      );

      for it in select value from jsonb_array_elements(coalesce(p_revenue->'items','[]'::jsonb)) loop
        idx := idx + 1;
        insert into transaction_items(tenant_id, item_id, tx_id, item_name, quantity, in_vat, ex_vat, total_price)
        values (v_tenant, v_tx_id || '-' || lpad(idx::text,2,'0'), v_tx_id, it->>'itemName',
                coalesce((it->>'quantity')::numeric,1), coalesce((it->>'inVat')::numeric,0),
                coalesce((it->>'exVat')::numeric,0), coalesce((it->>'totalPrice')::numeric,0));
      end loop;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'duplicate', v_dup, 'tx_id', v_tx_id);
end $$;

-- fn_cancel_order — ยกมาจาก 20260811000029_tenant_rpc.sql ทั้งดุ้น เปลี่ยนเฉพาะบรรทัดเช็คสิทธิ์
create or replace function fn_cancel_order(p_qu_no text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order sales_orders%rowtype;
  v_ref text; mv record; v_before numeric; v_after numeric;
  v_reversed int := 0;
  v_tenant uuid := my_tenant();
begin
  -- 🚨 ยกเลิก = void ใบกำกับภาษีที่ออกไปแล้ว + คืนสต็อก → **ระดับหัวหน้าเท่านั้น**
  --    ใช้ sales.config (มีแต่ sales_manager กับ main) จงใจไม่ใช่ sales.write
  if not has_cap('sales.config') then raise exception 'ไม่มีสิทธิ์ยกเลิกออเดอร์ (เฉพาะหัวหน้าฝ่ายขาย)'; end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;

  select * into v_order from sales_orders
    where qu_no = p_qu_no and tenant_id = v_tenant for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบออเดอร์ ' || p_qu_no); end if;
  v_ref := coalesce(v_order.order_no, p_qu_no);

  -- 1) void รายรับที่ลงบัญชีแล้ว (deposit + balance)
  update transactions set status = 'ยกเลิก'
    where tenant_id = v_tenant
      and idempotency_key in (v_ref, v_ref || '-balance') and status <> 'ยกเลิก';

  -- 2) คืน warehouse_stock ตาม stock_moves OUT ที่ยังไม่ถูกคืน
  for mv in
    select item_code, item_name, qty from stock_moves
    where tenant_id = v_tenant and entity_id = v_order.entity_id
      and ref_no = v_ref and action = 'OUT'
      and not exists (select 1 from stock_moves r
                      where r.tenant_id = stock_moves.tenant_id
                        and r.entity_id = stock_moves.entity_id
                        and r.ref_no = v_ref and r.action = 'IN'
                        and r.item_code = stock_moves.item_code)
  loop
    select qty into v_before from warehouse_stock
      where item_code = mv.item_code and tenant_id = v_tenant and entity_id = v_order.entity_id
      for update;
    if found then
      v_after := coalesce(v_before,0) + mv.qty;
      update warehouse_stock set qty = v_after
        where item_code = mv.item_code and tenant_id = v_tenant and entity_id = v_order.entity_id;
      insert into stock_moves(tenant_id, entity_id, item_code, item_name, qty_before, action, qty,
                              ref_no, qty_after, user_name, remarks)
      values (v_tenant, v_order.entity_id, mv.item_code, mv.item_name, coalesce(v_before,0),
              'IN', mv.qty, v_ref, v_after, 'system', 'คืนสต็อก: ยกเลิกออเดอร์');
      v_reversed := v_reversed + 1;
    end if;
  end loop;

  -- 3) คืนสต็อกผลิตสุรา ถ้าเคยตัด
  if exists (select 1 from integration_log
             where tenant_id = v_tenant and action='SELL_PRODUCT'
               and idempotency_key = v_ref and status='ok') then
    insert into log_product(tenant_id, entity_id, doc_date, trans_type, product_id, amount, note)
    select v_tenant, v_order.entity_id, current_date, 'รับ',
           li->>'product_id', (li->>'amount')::numeric,
           'คืนสต็อก: ยกเลิกออเดอร์ ' || v_ref
    from integration_log, jsonb_array_elements(payload) li
    where tenant_id = v_tenant and action='SELL_PRODUCT'
      and idempotency_key = v_ref and status='ok';

    update integration_log set status='duplicate', message='reversed by cancel'
      where tenant_id = v_tenant and action='SELL_PRODUCT'
        and idempotency_key = v_ref and status='ok';
  end if;

  update sales_orders set status = 'ยกเลิก', outstanding_balance = 0
    where qu_no = p_qu_no and tenant_id = v_tenant;

  return jsonb_build_object('ok', true, 'reversed_stock', v_reversed);
end $$;

-- fn_confirm_fulfillment — ยกมาจาก 20260811000029_tenant_rpc.sql ทั้งดุ้น เปลี่ยนเฉพาะบรรทัดเช็คสิทธิ์
create or replace function fn_confirm_fulfillment(p_qu_no text, p_user text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order sales_orders%rowtype;
  v_next text; v_is_export boolean := false; v_trans_type text;
  it record;
  v_real numeric; v_before numeric; v_after numeric;
  v_liquor jsonb := '[]'::jsonb;
  v_summary jsonb := '[]'::jsonb;
  v_dup boolean := false; v_warning text := null;
  li jsonb;
  v_tenant uuid := my_tenant();
begin
  if not has_cap('sales.write') then raise exception 'ไม่มีสิทธิ์จัดส่ง'; end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;

  select * into v_order from sales_orders
    where qu_no = p_qu_no and tenant_id = v_tenant and status = 'รอคลังจัดส่ง' for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ออเดอร์นี้ถูกจัดส่งไปแล้ว หรือไม่พบข้อมูลในระบบ');
  end if;
  v_next := coalesce(v_order.next_status, 'ส่งของแล้ว');

  select coalesce(is_export,false) into v_is_export from contacts
    where contact_id = v_order.customer_id and tenant_id = v_tenant;
  v_trans_type := case when v_is_export then 'จำหน่ายต่างประเทศ' else 'จ่าย' end;

  for it in
    select soi.item_name, soi.qty,
           sm.category, sm.product_id, coalesce(sm.multiplier,1) as multiplier
    from sales_order_items soi
    left join sale_menu sm on sm.tenant_id = soi.tenant_id
                          and sm.entity_id = v_order.entity_id
                          and trim(sm.menu_name) = trim(soi.item_name)
    where soi.qu_no = p_qu_no and soi.tenant_id = v_tenant
  loop
    if it.product_id is null or trim(it.product_id) = '' then continue; end if;
    v_real := it.qty * it.multiplier;

    select qty into v_before from warehouse_stock
      where item_code = trim(it.product_id)
        and tenant_id = v_tenant and entity_id = v_order.entity_id;
    if found then
      v_after := coalesce(v_before,0) - v_real;
      update warehouse_stock set qty = v_after
        where item_code = trim(it.product_id)
          and tenant_id = v_tenant and entity_id = v_order.entity_id;
      insert into stock_moves(tenant_id, entity_id, item_code, item_name, qty_before, action, qty,
                              ref_no, qty_after, user_name, remarks)
      values (v_tenant, v_order.entity_id, trim(it.product_id),
              (select item_name from warehouse_stock
                 where item_code = trim(it.product_id)
                   and tenant_id = v_tenant and entity_id = v_order.entity_id),
              coalesce(v_before,0), 'OUT', v_real, coalesce(v_order.order_no, p_qu_no),
              v_after, p_user, 'จัดส่งออเดอร์ B2B');
      v_summary := v_summary || jsonb_build_object(
        'name', (select coalesce(item_name, it.item_name) from warehouse_stock
                   where item_code = trim(it.product_id)
                     and tenant_id = v_tenant and entity_id = v_order.entity_id),
        'remaining', v_after);
    end if;

    if it.category = 'สุรา' and v_real > 0 then
      v_liquor := v_liquor || jsonb_build_object('product_id', trim(it.product_id), 'amount', v_real);
    end if;
  end loop;

  if jsonb_array_length(v_liquor) > 0 then
    begin
      insert into integration_log(tenant_id, action, idempotency_key, status, message, payload)
      values (v_tenant, 'SELL_PRODUCT', coalesce(v_order.order_no, p_qu_no), 'ok', 'ตัดสต็อกขาย', v_liquor);
      for li in select value from jsonb_array_elements(v_liquor) loop
        insert into log_product(tenant_id, entity_id, doc_date, trans_type, product_id, amount, note)
        values (v_tenant, v_order.entity_id, current_date, v_trans_type,
                li->>'product_id', (li->>'amount')::numeric,
                'ลูกค้า: ' || coalesce(v_order.customer_name,'') || ' (' || coalesce(v_order.order_no, p_qu_no) || ')');
      end loop;
    exception when unique_violation then
      v_dup := true;   -- เคยตัดสต็อกผลิตของ order นี้แล้ว → ข้าม (retry ปลอดภัย)
    end;
  end if;

  update sales_orders set status = v_next where qu_no = p_qu_no and tenant_id = v_tenant;

  return jsonb_build_object('ok', true, 'newStatus', v_next, 'duplicate', v_dup,
    'warning', v_warning, 'summary', v_summary,
    'customerName', v_order.customer_name, 'orderNo', coalesce(v_order.order_no, p_qu_no));
end $$;

-- fn_void_deposit_invoice — ยกมาจาก 20260811000029_tenant_rpc.sql ทั้งดุ้น เปลี่ยนเฉพาะบรรทัดเช็คสิทธิ์
create or replace function fn_void_deposit_invoice(p_qu_no text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_status text; v_old text; v_tenant uuid := my_tenant();
begin
  -- 🚨 ระดับหัวหน้าเท่านั้น เหตุผลเดียวกับ fn_cancel_order
  if not has_cap('sales.config') then raise exception 'ไม่มีสิทธิ์ยกเลิกใบแจ้งหนี้มัดจำ (เฉพาะหัวหน้าฝ่ายขาย)'; end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;

  select status, dep_inv_no into v_status, v_old from sales_orders
    where qu_no = p_qu_no and tenant_id = v_tenant;
  if v_status is null then return jsonb_build_object('ok', false, 'error', 'ไม่พบออเดอร์ ' || p_qu_no); end if;
  if v_status <> 'รอชำระมัดจำ' then
    return jsonb_build_object('ok', false, 'error', 'ยกเลิกได้เฉพาะออเดอร์ที่สถานะ "รอชำระมัดจำ" (ตอนนี้: ' || v_status || ')');
  end if;

  update sales_orders set
    status = 'รอคอนเฟิร์ม',
    dep_inv_no = null, dep_inv_date = null, dep_inv_amount = 0, dep_due_date = null,
    doc_to_print = null, next_status = null
  where qu_no = p_qu_no and tenant_id = v_tenant;

  return jsonb_build_object('ok', true, 'dep_inv_no', v_old);
end $$;

-- fn_post_payroll — ยกมาจาก 20260819000042_pay_variables_legs.sql ทั้งดุ้น เปลี่ยนเฉพาะบรรทัดเช็คสิทธิ์
create or replace function fn_post_payroll(
  p_period_id text,
  p_kind      text,      -- รหัสขา (pay_post_legs.code)
  p_date      date,
  p_payload   jsonb      -- { entityId, accountName, category, contactName, description,
                         --   amount, lines:[{empId, contactName, description, amount}] }
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_dup boolean := false;
  v_state jsonb;
  v_tx_id text;
  v_tx_ids text[] := '{}';
  v_legs int;
  ln jsonb;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if not has_cap('pay.write') then raise exception 'ไม่มีสิทธิ์ลงบัญชีเงินเดือน'; end if;
  if coalesce(p_kind,'') = '' then raise exception 'ต้องระบุขาที่จะลงบัญชี'; end if;
  if p_date is null then raise exception 'ต้องระบุวันที่ลงบัญชี'; end if;

  select post_state into v_state from payroll_periods
   where tenant_id = v_tenant and period_id = p_period_id;   -- ★ กันแตะงวดของลูกค้าเจ้าอื่น
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบงวด ' || p_period_id); end if;

  v_state := coalesce(v_state, '{}'::jsonb);
  if v_state ? p_kind then
    return jsonb_build_object('ok', false, 'error', 'งวดนี้ลงบัญชีขานี้ไปแล้ว — ต้องถอนก่อนถึงจะลงใหม่ได้');
  end if;

  -- idempotency: insert ก่อนแล้วจับ unique_violation (ปลอดภัยกับ race — แพตเทิร์นจาก 0029)
  begin
    insert into integration_log(tenant_id, action, idempotency_key, status, message, payload)
    values (v_tenant, 'POST_PAYROLL', p_period_id || '-' || p_kind, 'ok',
            'ลงบัญชีเงินเดือน ' || p_period_id || ' (' || p_kind || ')', p_payload);
  exception when unique_violation then
    v_dup := true;
  end;

  if not v_dup then
    if jsonb_array_length(coalesce(p_payload->'lines','[]'::jsonb)) > 0 then
      -- แยกรายคน → ตรวจกับสลิปได้ทีละใบ
      for ln in select value from jsonb_array_elements(p_payload->'lines') loop
        if coalesce((ln->>'amount')::numeric, 0) <> 0 then
          v_tx_id := next_tx_id();
          insert into transactions(
            tenant_id, tx_id, transaction_date, type, account_name, category, contact_name,
            description, base_amount, amount_after_discount, net_amount,
            status, entity_id, payment_date, idempotency_key, source
          ) values (
            v_tenant, v_tx_id, p_date, 'รายจ่าย',
            nullif(p_payload->>'accountName',''), p_payload->>'category', ln->>'contactName',
            ln->>'description',
            (ln->>'amount')::numeric, (ln->>'amount')::numeric, (ln->>'amount')::numeric,
            'ปกติ', p_payload->>'entityId', p_date,
            p_period_id || '-' || p_kind || '-' || (ln->>'empId'), 'payroll'
          );
          v_tx_ids := v_tx_ids || v_tx_id;
          update payroll_items set tx_id = v_tx_id
           where tenant_id = v_tenant and period_id = p_period_id and emp_id = ln->>'empId';
        end if;
      end loop;
    else
      if coalesce((p_payload->>'amount')::numeric, 0) = 0 then
        return jsonb_build_object('ok', false, 'error', 'ยอดเป็นศูนย์ ไม่ต้องลงบัญชี');
      end if;
      v_tx_id := next_tx_id();
      insert into transactions(
        tenant_id, tx_id, transaction_date, type, account_name, category, contact_name,
        description, base_amount, amount_after_discount, net_amount,
        status, entity_id, payment_date, idempotency_key, source
      ) values (
        v_tenant, v_tx_id, p_date, 'รายจ่าย',
        nullif(p_payload->>'accountName',''), p_payload->>'category', p_payload->>'contactName',
        p_payload->>'description',
        (p_payload->>'amount')::numeric, (p_payload->>'amount')::numeric, (p_payload->>'amount')::numeric,
        'ปกติ', p_payload->>'entityId', p_date,
        p_period_id || '-' || p_kind, 'payroll'
      );
      v_tx_ids := array[v_tx_id];
    end if;

    v_state := v_state || jsonb_build_object(
      p_kind, jsonb_build_object('txIds', to_jsonb(v_tx_ids), 'date', p_date)
    );
    select count(*) into v_legs from pay_post_legs where tenant_id = v_tenant and active;
    update payroll_periods set
      post_state = v_state,
      status = case when (select count(*) from jsonb_object_keys(v_state)) >= greatest(v_legs, 1)
                    then 'posted' else 'partial' end
     where tenant_id = v_tenant and period_id = p_period_id;
  end if;

  return jsonb_build_object('ok', true, 'duplicate', v_dup, 'tx_ids', to_jsonb(v_tx_ids));
end $$;

-- fn_unpost_payroll — ยกมาจาก 20260819000042_pay_variables_legs.sql ทั้งดุ้น เปลี่ยนเฉพาะบรรทัดเช็คสิทธิ์
create or replace function fn_unpost_payroll(p_period_id text, p_kind text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_state jsonb;
  v_ids jsonb;
  v_n int := 0;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if not has_cap('pay.write') then raise exception 'ไม่มีสิทธิ์ถอนการลงบัญชีเงินเดือน'; end if;

  select post_state into v_state from payroll_periods
   where tenant_id = v_tenant and period_id = p_period_id;
  if v_state is null then return jsonb_build_object('ok', false, 'error', 'ไม่พบงวด ' || p_period_id); end if;
  if not (v_state ? p_kind) then
    return jsonb_build_object('ok', false, 'error', 'ขานี้ยังไม่ได้ลงบัญชี');
  end if;

  v_ids := v_state -> p_kind -> 'txIds';
  update transactions set status = 'ยกเลิก'
   where tenant_id = v_tenant
     and tx_id in (select jsonb_array_elements_text(coalesce(v_ids, '[]'::jsonb)));
  get diagnostics v_n = row_count;

  update integration_log set status = 'duplicate', message = 'ถอนการลงบัญชีเงินเดือน'
   where tenant_id = v_tenant and action = 'POST_PAYROLL'
     and idempotency_key = p_period_id || '-' || p_kind and status = 'ok';

  update payroll_items set tx_id = null
   where tenant_id = v_tenant and period_id = p_period_id
     and tx_id in (select jsonb_array_elements_text(coalesce(v_ids, '[]'::jsonb)));

  v_state := v_state - p_kind;
  update payroll_periods set
    post_state = v_state,
    status = case when v_state = '{}'::jsonb then 'draft' else 'partial' end
   where tenant_id = v_tenant and period_id = p_period_id;

  return jsonb_build_object('ok', true, 'voided', v_n);
end $$;



-- ── fn_wht_doc_nos — เลข 50ทวิ ทั้งหมดของกิจการ (ไว้คำนวณเลขใบถัดไป) ────────
--
-- 🪤 ทำไมต้องมี: เลข 50ทวิ ของ **พนักงาน** กับของ **คู่ค้า** เป็นชุดเดียวกันต่อกิจการ (D69)
--    แต่ policy `wht_sel` ข้างบนให้ฝ่ายเงินเดือนเห็นเฉพาะใบของพนักงาน
--    → ถ้าให้หน้าเงินเดือน select เองตรง ๆ มันจะเห็นแค่ครึ่งเดียว แล้ว **ออกเลขซ้ำกับใบคู่ค้า**
--      ซึ่งเป็นเอกสารที่ยื่นกรมสรรพากรและอยู่ในมือคนจริงไปแล้ว
--
-- ★ คืน **เฉพาะเลขที่** ไม่คืนชื่อ/ยอดเงิน — ฝ่ายเงินเดือนไม่ได้เห็นว่าจ่ายคู่ค้าคนไหนเท่าไหร่
-- ★ ตรรกะการตั้งเลข (prefix ปี พ.ศ. + running) ยังอยู่ที่ `nextWhtDocNo()` ฝั่ง TypeScript
--   ที่มี golden test คุมอยู่ — **ห้ามย้ายมาเขียนซ้ำใน SQL** (สูตรต้องมีที่เดียว)
create or replace function fn_wht_doc_nos(p_entity_id text)
returns setof text
language sql stable security definer set search_path = public as $$
  select doc_no from wht_certificates
   where tenant_id = my_tenant()
     and entity_id = p_entity_id
     and (has_cap('acct.read') or has_cap('pay.read'));
$$;

-- ── 6. ให้ PostgREST โหลด schema ใหม่ ──────────────────────────────────────
notify pgrst, 'reload schema';
