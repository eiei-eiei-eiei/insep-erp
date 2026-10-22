-- ============================================================================
-- seed_advance.sql — ชุดข้อมูลทดสอบ "สำรองจ่าย" (D119 · migration 0086) · รันซ้ำได้
--   marker ลบทีเดียว: entity EID99 · tx id 'T-ADV-%' · บัญชีชื่อมีคำว่า 'ทดสอบ'
--   ลบด้วย cleanup_test.sql (ตามบิลที่เกิดจากการเคลียด้วย advance_src_tx ให้แล้ว)
--   ⚠️ วิธีใช้: Supabase → SQL Editor → **แก้ค่า v_slug บรรทัดล่าง** → วางทั้งไฟล์ → Run
--
-- 🎯 สร้างสภาพตั้งต้น: กิจการส่วนตัวทดสอบ EID99 (ไม่จด VAT) สำรองจ่ายให้กิจการหลักของ tenant
--    รอเบิกคืน 3 ใบ — เคลีย/ถอน/ตัดเป็นส่วนตัว ทำต่อบนหน้าจอ (TESTING ส่วนที่ 77)
--      T-ADV-0001  10,700.00  VAT 700  จาก "ส่วนตัว ทดสอบ"     ใบกำกับ ก.ย. 69
--      T-ADV-0002     535.00  VAT 35   จาก "เงินสดส่วนตัว ทดสอบ" ใบกำกับ ก.ย. 69
--      T-ADV-0003   2,140.00  VAT 140  จาก "ส่วนตัว ทดสอบ"     ใบกำกับ **ก.พ. 69** (เก่าเกิน 6 เดือน → เตือนเหลือง)
--
-- 🚨 ไม่สร้างการเคลียให้โดยตั้งใจ — สิ่งที่ต้องพิสูจน์คือกดผ่านหน้าจอแล้วได้บิลถูก
-- 🪤 ต้องระบุ tenant_id/entity_id เอง — SQL Editor ไม่มี JWT → my_tenant() เป็น null (D94)
-- ★ insert ตรงด้วย postgres ผ่านด่าน advance_guard ได้ (ไม่มี JWT) จึงต้องใส่ advance_status เอง
-- ============================================================================

do $$
declare
  -- 🔧 แก้ตรงนี้ให้ตรงกับกิจการที่จะเทส (ดูรายชื่อ: select slug, name from tenants)
  v_slug   text := 'siamdist';
  v_tenant uuid;
  v_target text;
begin
  select id into v_tenant from tenants where slug = v_slug;
  if v_tenant is null then
    raise exception 'ไม่พบ tenant slug = %  (ดูรายชื่อ: select slug, name from tenants)', v_slug;
  end if;

  -- กิจการที่ "ถูกซื้อให้" = กิจการหลักของ tenant
  select entity_id into v_target
    from entities where tenant_id = v_tenant and entity_id <> 'EID99'
    order by is_default desc, entity_id limit 1;
  if v_target is null then
    raise exception 'tenant % ยังไม่มีกิจการหลัก — สร้างกิจการก่อน', v_slug;
  end if;

  -- ── ล้างของเก่า (รันซ้ำได้) ────────────────────────────────────────────────
  delete from transaction_items where tenant_id = v_tenant
    and tx_id in (select tx_id from transactions where tenant_id = v_tenant and advance_src_tx like 'T-ADV-%');
  delete from transactions where tenant_id = v_tenant and advance_src_tx like 'T-ADV-%';
  delete from transaction_items where tenant_id = v_tenant and tx_id like 'T-ADV-%';
  delete from transactions where tenant_id = v_tenant and entity_id = 'EID99';

  -- ── กิจการส่วนตัวทดสอบ (ไม่จด VAT) + บัญชี 2 บัญชี ─────────────────────────
  insert into entities (tenant_id, entity_id, name, type, is_vat)
  values (v_tenant, 'EID99', 'ส่วนตัว ทดสอบ', 'ส่วนตัว', false)
  on conflict (tenant_id, entity_id) do nothing;

  delete from bank_accounts where tenant_id = v_tenant and account_id in ('T-ADV-P', 'T-ADV-C');
  insert into bank_accounts (tenant_id, account_id, account_name, entity_ids, kind, opening_balance) values
    (v_tenant, 'T-ADV-P', 'ส่วนตัว ทดสอบ',       array['EID99'], 'ธนาคาร', 50000),
    (v_tenant, 'T-ADV-C', 'เงินสดส่วนตัว ทดสอบ', array['EID99'], 'เงินสด', 5000);

  -- ── บิลสำรองจ่ายรอเบิกคืน 3 ใบ ─────────────────────────────────────────────
  insert into transactions (tenant_id, tx_id, transaction_date, type, account_name, category, contact_name,
    description, base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
    tax_invoice_no, tax_invoice_date, status, entity_id, source, advance_for_entity, advance_status) values
    (v_tenant, 'T-ADV-0001', '2026-09-25', 'สำรองจ่าย', 'ส่วนตัว ทดสอบ', 'ค่าต้นทุนสินค้า', 'ร้านวัสดุ ทดสอบ',
     'สายไฟทดสอบ (สำรองจ่าย)', 10000, 0, 10000, 700, 0, 0, 10700, 'IV-ADV-1', '2026-09-25', 'ปกติ', 'EID99', 'ui',
     v_target, 'รอเบิกคืน'),
    (v_tenant, 'T-ADV-0002', '2026-09-28', 'สำรองจ่าย', 'เงินสดส่วนตัว ทดสอบ', 'ค่าใช้จ่ายเบ็ดเตล็ด', 'ร้านวัสดุ ทดสอบ',
     'น็อตทดสอบ (สำรองจ่าย)', 500, 0, 500, 35, 0, 0, 535, 'IV-ADV-2', '2026-09-28', 'ปกติ', 'EID99', 'ui',
     v_target, 'รอเบิกคืน'),
    (v_tenant, 'T-ADV-0003', '2026-02-10', 'สำรองจ่าย', 'ส่วนตัว ทดสอบ', 'ค่าต้นทุนสินค้า', 'ร้านวัสดุ ทดสอบ',
     'ใบเก่าทดสอบ (สำรองจ่าย)', 2000, 0, 2000, 140, 0, 0, 2140, 'IV-ADV-OLD', '2026-02-10', 'ปกติ', 'EID99', 'ui',
     v_target, 'รอเบิกคืน');

  insert into transaction_items (tenant_id, item_id, tx_id, item_name, quantity, in_vat, ex_vat, total_price) values
    (v_tenant, 'T-ADV-0001-01', 'T-ADV-0001', 'สายไฟทดสอบ', 10, 1070, 1000, 10000),
    (v_tenant, 'T-ADV-0002-01', 'T-ADV-0002', 'น็อตทดสอบ', 100, 5.35, 5, 500),
    (v_tenant, 'T-ADV-0003-01', 'T-ADV-0003', 'ท่อทดสอบ', 4, 535, 500, 2000);

  raise notice 'สร้างสำรองจ่ายทดสอบ 3 ใบ ให้กิจการ % ของ % แล้ว', v_target, v_slug;
end $$;
