-- ============================================================================
-- 0028 tenant RLS — เขียน policy ใหม่ทุกข้อให้กรอง tenant (NEXT_STEPS ข้อ 4.1)
--
--   หลัก: ทุก policy = tenant_id = my_tenant()  AND  <เงื่อนไข role/entity เดิม>
--   → ต่อยอดจาก 0006 ไม่ใช่เขียนทับ · สิทธิ์ role/entity ที่ใช้อยู่ต้องเหมือนเดิมเป๊ะ
--
--   ★ my_tenant() คืน null เมื่อยังไม่ล็อกอิน → `tenant_id = null` ได้ NULL → ไม่ใช่ true
--     = ปิดตายอัตโนมัติ (fail closed) ไม่ต้องเขียนเงื่อนไข anon แยก
--
--   🚨 policy อย่างเดียวไม่พอ — ฟังก์ชัน security definer 25 ตัว bypass RLS ทั้งหมด
--      ต้องอุดใน 0029 ด้วย ไม่งั้นลูกค้า A ส่ง qu_no ของ B เข้า RPC แล้วแก้ออเดอร์คนอื่นได้
--      ทั้งที่ policy ในไฟล์นี้ถูกทุกข้อ
-- ============================================================================

-- ── ล้าง policy เดิมทั้งหมดในตารางที่เราคุม แล้วเขียนใหม่ ─────────────────────
--    (ทำแบบ drop-แล้วสร้าง เพื่อให้อ่านไฟล์เดียวจบว่าสิทธิ์จริงคืออะไร)
do $$
declare
  r record;
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

-- ── profiles ────────────────────────────────────────────────────────────────
-- เห็นเฉพาะคนในกิจการเดียวกัน · ตัวเอง (+ main เห็นทั้ง tenant) · แก้ได้เฉพาะ main
create policy profiles_sel on profiles for select
  using (tenant_id = my_tenant() and (id = auth.uid() or my_role() = 'main'));
create policy profiles_write on profiles for all
  using (tenant_id = my_tenant() and my_role() = 'main')
  with check (tenant_id = my_tenant() and my_role() = 'main');

-- ── master ส่วนกลาง ─────────────────────────────────────────────────────────
create policy bank_accounts_sel on bank_accounts for select
  using (tenant_id = my_tenant());
create policy bank_accounts_w on bank_accounts for all
  using (tenant_id = my_tenant() and my_role() = 'main')
  with check (tenant_id = my_tenant() and my_role() = 'main');

create policy app_settings_sel on app_settings for select
  using (tenant_id = my_tenant());
create policy app_settings_w on app_settings for all
  using (tenant_id = my_tenant() and my_role() = 'main')
  with check (tenant_id = my_tenant() and my_role() = 'main');

create policy contacts_sel on contacts for select
  using (tenant_id = my_tenant());
create policy contacts_w on contacts for all
  using (tenant_id = my_tenant() and my_role() in ('main','sale'))
  with check (tenant_id = my_tenant() and my_role() in ('main','sale'));

-- integration_log / counters: อ่านได้ · เขียนผ่าน RPC security definer เท่านั้น
create policy integration_log_sel on integration_log for select
  using (tenant_id = my_tenant());
create policy counters_sel on counters for select
  using (tenant_id = my_tenant());

-- ── entities — ★ แก้ได้ แต่ "สร้างเพิ่มเอง" ไม่ได้ ───────────────────────────
--   ลูกค้าต้องแก้ข้อมูลกิจการได้ (ชื่อ/ที่อยู่/เลขภาษี/เลขบัญชี บนหัวเอกสารการค้า — D44)
--   แต่ "กิจการที่ 2" เป็น add-on ที่ขายแยก → insert/delete ทำได้เฉพาะ service role
--   (NEXT_STEPS 4.2 "บังคับที่ DB ไม่ใช่แค่ซ่อน UI" — ลูกค้าเลี่ยงผ่าน API ไม่ได้)
create policy entities_sel on entities for select
  using (tenant_id = my_tenant()
         and (my_entities() is null or entity_id = any(my_entities())));
create policy entities_upd on entities for update
  using (tenant_id = my_tenant() and my_role() = 'main')
  with check (tenant_id = my_tenant() and my_role() = 'main');

-- ── บัญชี ───────────────────────────────────────────────────────────────────
create policy tx_sel on transactions for select
  using (tenant_id = my_tenant()
         and (my_entities() is null or entity_id = any(my_entities())));
create policy tx_w on transactions for all
  using (tenant_id = my_tenant() and my_role() = 'main'
         and (my_entities() is null or entity_id = any(my_entities())))
  with check (tenant_id = my_tenant() and my_role() = 'main'
         and (my_entities() is null or entity_id = any(my_entities())));

create policy ti_sel on transaction_items for select using (
  tenant_id = my_tenant()
  and exists (select 1 from transactions t
              where t.tenant_id = transaction_items.tenant_id
                and t.tx_id = transaction_items.tx_id
                and (my_entities() is null or t.entity_id = any(my_entities()))));
create policy ti_w on transaction_items for all
  using (tenant_id = my_tenant() and my_role() = 'main')
  with check (tenant_id = my_tenant() and my_role() = 'main');

create policy ts_sel on tax_summaries for select
  using (tenant_id = my_tenant()
         and (my_entities() is null or entity_id = any(my_entities())));
create policy ts_w on tax_summaries for all
  using (tenant_id = my_tenant() and my_role() = 'main')
  with check (tenant_id = my_tenant() and my_role() = 'main');

create policy wht_sel on wht_certificates for select
  using (tenant_id = my_tenant()
         and (my_entities() is null or entity_id = any(my_entities())));
create policy wht_w on wht_certificates for all
  using (tenant_id = my_tenant() and my_role() = 'main')
  with check (tenant_id = my_tenant() and my_role() = 'main');

create policy scan_log_sel on scan_log for select
  using (tenant_id = my_tenant() and my_role() in ('main','viewer'));
create policy scan_log_w on scan_log for all
  using (tenant_id = my_tenant() and my_role() = 'main')
  with check (tenant_id = my_tenant() and my_role() = 'main');

-- ── ผลิต — master + log อ่านได้ทุกคนใน tenant · เขียนเฉพาะ main ──────────────
do $$
declare
  t text;
  tables text[] := array[
    'materials','containers','products',
    'log_material','log_ferment','log_distill','log_distill_run',
    'log_ferment_monitor','log_dilute','log_product'
  ];
begin
  foreach t in array tables loop
    execute format(
      'create policy %I on %I for select using (tenant_id = my_tenant())',
      t || '_sel', t);
    execute format(
      'create policy %I on %I for all
         using (tenant_id = my_tenant() and my_role() = ''main'')
         with check (tenant_id = my_tenant() and my_role() = ''main'')',
      t || '_w', t);
  end loop;
end $$;

-- stock_product: อ่านได้ · เขียนผ่าน apply_stock_delta/recompute เท่านั้น (ไม่มี write policy)
create policy stock_product_sel on stock_product for select
  using (tenant_id = my_tenant());

-- ── ขาย ─────────────────────────────────────────────────────────────────────
create policy sale_menu_sel on sale_menu for select
  using (tenant_id = my_tenant());
create policy sale_menu_w on sale_menu for all
  using (tenant_id = my_tenant() and my_role() = 'main')
  with check (tenant_id = my_tenant() and my_role() = 'main');

create policy so_sel on sales_orders for select
  using (tenant_id = my_tenant());
create policy so_w on sales_orders for all
  using (tenant_id = my_tenant() and my_role() in ('main','sale'))
  with check (tenant_id = my_tenant() and my_role() in ('main','sale'));

create policy soi_sel on sales_order_items for select
  using (tenant_id = my_tenant());
create policy soi_w on sales_order_items for all
  using (tenant_id = my_tenant() and my_role() in ('main','sale'))
  with check (tenant_id = my_tenant() and my_role() in ('main','sale'));

create policy ws_sel on warehouse_stock for select
  using (tenant_id = my_tenant());
create policy ws_w on warehouse_stock for all
  using (tenant_id = my_tenant() and my_role() in ('main','warehouse'))
  with check (tenant_id = my_tenant() and my_role() in ('main','warehouse'));

create policy sm_sel on stock_moves for select
  using (tenant_id = my_tenant());
create policy sm_w on stock_moves for all
  using (tenant_id = my_tenant() and my_role() in ('main','warehouse'))
  with check (tenant_id = my_tenant() and my_role() in ('main','warehouse'));

-- ── รายงาน / audit ──────────────────────────────────────────────────────────
create policy rr_sel on report_runs for select
  using (tenant_id = my_tenant());
create policy rr_w on report_runs for all
  using (tenant_id = my_tenant() and my_role() = 'main')
  with check (tenant_id = my_tenant() and my_role() = 'main');

create policy edit_log_sel on edit_log for select
  using (tenant_id = my_tenant() and my_role() = 'main');

-- snapshots: ของเดิม (0018) เขียน subquery ตรง ๆ ใน policy ซึ่ง NEXT_STEPS 4.8 ห้าม
--   (ประเมินต่อแถวแทนที่จะครั้งเดียวต่อ query) → เปลี่ยนมาใช้ my_role() ให้เหมือนที่อื่น
create policy snapshots_sel on snapshots for select
  using (tenant_id = my_tenant() and my_role() = 'main');

-- ── Storage ─────────────────────────────────────────────────────────────────
drop policy if exists "pdf_templates_read"       on storage.objects;
drop policy if exists "pdf_templates_write_main" on storage.objects;
drop policy if exists "receipts_read"            on storage.objects;
drop policy if exists "receipts_write_main"      on storage.objects;

-- pdf-templates: **จงใจแชร์ข้ามลูกค้า** — ฟอร์มราชการ ภส./ภพ.30 + ฟอนต์ THSarabun
--   เหมือนกันทุกโรงอยู่แล้ว · อัปโหลดครั้งเดียวใช้ได้ทุกเจ้า = ข้อดี ไม่ใช่ช่องโหว่
--   (เขียนได้เฉพาะ service role / main — ไม่มีข้อมูลธุรกิจของใครอยู่ในนี้)
create policy "pdf_templates_read" on storage.objects for select
  using (bucket_id = 'pdf-templates' and auth.uid() is not null);
create policy "pdf_templates_write_main" on storage.objects for insert
  with check (bucket_id = 'pdf-templates' and public.my_role() = 'main');

-- receipts: ★ ของเดิมเป็น "ล็อกอินแล้วอ่านได้ทุกไฟล์" → พอมีหลายลูกค้า =
--   เห็นรูปใบเสร็จของกันและกัน (ชื่อคู่ค้า/ยอดเงิน/เลขภาษี) → ต้องแยกตามโฟลเดอร์ tenant
--   ⚠️ โค้ดที่อัปโหลดต้องวางไฟล์ที่ path `<tenant_id>/<ชื่อไฟล์>` เท่านั้น
--      (ตอนนี้ยังไม่มีโค้ดอัปโหลดเข้า bucket นี้ — ของเก่าอยู่ Google Drive)
create policy "receipts_read" on storage.objects for select
  using (bucket_id = 'receipts'
         and (storage.foldername(name))[1] = public.my_tenant()::text);
create policy "receipts_write_main" on storage.objects for all
  using (bucket_id = 'receipts' and public.my_role() = 'main'
         and (storage.foldername(name))[1] = public.my_tenant()::text)
  with check (bucket_id = 'receipts' and public.my_role() = 'main'
         and (storage.foldername(name))[1] = public.my_tenant()::text);

notify pgrst, 'reload schema';
