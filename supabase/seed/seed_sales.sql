-- ============================================================================
-- seed_sales.sql — ชุดข้อมูลทดสอบ Phase 4 (ขาย) · รันซ้ำได้
--   marker ลบทีเดียว: entity EID99 · master id 'T-%' · ชื่อมี 'ทดสอบ'
--   สร้าง: สินค้าสุรา (มีสต็อกผลิต) + สินค้าทั่วไป (warehouse_stock) + ลูกค้า + config รายรับ
--   ⚠️ ต้องรัน seed_accounting.sql ก่อน (สร้าง EID99 + บัญชี 'กสิกร ทดสอบ') หรือไฟล์นี้ insert EID99 ให้เอง
--   ใช้: Supabase → SQL Editor → วางทั้งไฟล์ → Run  (ลบด้วย cleanup_test.sql)
-- ============================================================================

-- กิจการทดสอบ (เผื่อยังไม่ได้รัน seed อื่น)
insert into entities (entity_id, name, is_vat, tax_id, branch, excise_id)
values ('EID99', 'กิจการทดสอบ (ลบได้)', true, '9999999999999', 'สำนักงานใหญ่', '12345678901234567')
on conflict (entity_id) do nothing;

-- ล้างของเก่า (กันซ้ำ) — items→orders ก่อน
delete from sales_order_items where qu_no in (select qu_no from sales_orders where customer_id like 'T-%' or customer_name like '%ทดสอบ%');
delete from sales_orders     where customer_id like 'T-%' or customer_name like '%ทดสอบ%';
delete from stock_moves      where item_code like 'T-%';
delete from warehouse_stock  where item_code like 'T-%';
delete from sale_menu        where product_id like 'T-%';
delete from stock_product    where product_id like 'T-%';
delete from products         where product_id like 'T-%';

-- สินค้าสุราทดสอบ + สต็อกผลิต (240 ขวด = 20 ลัง × 12)
insert into products (product_id, name, degree, bottle_size_l, liquor_type, liquor_kind)
values ('T-PROD01', 'สุราทดสอบ 40 ดีกรี', 40, 0.7, 'สุราขาว', 'สุรากลั่นชุมชน')
on conflict (product_id) do nothing;
insert into stock_product (product_id, balance) values ('T-PROD01', 240)
on conflict (product_id) do update set balance = excluded.balance;

-- เมนูขาย: สุรา (ตัดสต็อกผลิต) + ทั่วไป (ตัด warehouse_stock)
-- ⚠️ ราคา = รวม VAT แล้ว (D27) · 3210 รวม VAT = ก่อน VAT 3000 + VAT 210
insert into sale_menu (menu_name, price, category, product_id, multiplier) values
  ('สุราทดสอบ (ลัง 12 ขวด)', 3210, 'สุรา',   'T-PROD01', 12),
  ('กล่องของขวัญทดสอบ',      150,  'ทั่วไป', 'T-WH01',   1)
on conflict (menu_name) do nothing;

-- สต็อกสินค้าทั่วไป (curstock เดิม)
insert into warehouse_stock (item_code, item_name, unit, qty) values
  ('T-WH01', 'กล่องของขวัญทดสอบ', 'กล่อง', 100)
on conflict (item_code) do update set qty = excluded.qty;

-- ลูกค้าทดสอบ (ในประเทศ · เครดิต 30 วัน)
insert into contacts (contact_id, name, tax_id, branch, address, contact_type, phone, credit_term, is_export, roles)
values ('T-C0100', 'บริษัท ลูกค้าทดสอบ จำกัด', '0105512345671', 'สำนักงานใหญ่',
        '99 ถ.ทดสอบ กรุงเทพฯ 10110', 'ลูกค้า', '021234567', 30, false, array['ลูกค้า'])
on conflict (contact_id) do nothing;

-- ลูกค้าส่งออกทดสอบ (transType → 'จำหน่ายต่างประเทศ' ตอนตัดสต็อกผลิต)
insert into contacts (contact_id, name, tax_id, branch, address, contact_type, phone, credit_term, is_export, roles)
values ('T-C0101', 'Export Customer Test Ltd. (ทดสอบ)', '', 'สำนักงานใหญ่',
        '1 Test Rd, Singapore', 'ลูกค้า', '', 0, true, array['ลูกค้า'])
on conflict (contact_id) do nothing;

-- config รายรับขาย (บัญชี + กิจการ) — ชี้ไป EID99 + บัญชีทดสอบ (go-live เปลี่ยนเป็นค่าจริง)
insert into app_settings (kind, value, sort) values
  ('sales_revenue_entity',  'EID99',       95),
  ('sales_revenue_account', 'กสิกร ทดสอบ', 96)
on conflict (kind, value) do nothing;

select 'seed ขาย (Phase 4) เรียบร้อย — เข้า /sales ทดสอบได้เลย' as result;
