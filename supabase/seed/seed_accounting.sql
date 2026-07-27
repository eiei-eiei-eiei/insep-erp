-- ============================================================================
-- seed_accounting.sql — ชุดข้อมูลทดสอบ Phase 3 (บัญชี) · รันซ้ำได้
--   marker ลบทีเดียว: entity EID99 · ชื่อมีคำว่า 'ทดสอบ' (บัญชี/คู่ค้า/settings)
--   scenario เดือน 2026-07: ขาย/ซื้อมี VAT+WHT / บิลค้าง AP / โอนระหว่างบัญชี / เช็คราคา
--   ⚠️ ต้องรัน seed_test.sql ก่อน (สร้าง EID99) หรือไฟล์นี้จะ insert EID99 ให้เองด้วย
--   ใช้: Supabase → SQL Editor → วางทั้งไฟล์ → Run  (ลบด้วย cleanup_test.sql)
-- ============================================================================

-- กิจการทดสอบ (เผื่อยังไม่ได้รัน seed_test.sql)
insert into entities (entity_id, name, is_vat, tax_id, branch, excise_id)
values ('EID99', 'กิจการทดสอบ (ลบได้)', true, '9999999999999', 'สำนักงานใหญ่', '12345678901234567')
on conflict (entity_id) do nothing;

-- ล้างของเก่า (กันซ้ำ)
delete from wht_certificates where entity_id = 'EID99';
delete from tax_summaries    where entity_id = 'EID99';
delete from transaction_items where tx_id in (select tx_id from transactions where entity_id = 'EID99');
delete from transactions     where entity_id = 'EID99';
delete from bank_accounts    where account_name like '%ทดสอบ%';
delete from app_settings     where value like '%ทดสอบ%';
delete from contacts         where name like '%ทดสอบ%';

-- บัญชีเงินทดสอบ (ใช้ร่วม EID99)
insert into bank_accounts (account_id, account_name, entity_ids, kind, opening_balance) values
  ('T-ACC01', 'กสิกร ทดสอบ', array['EID99'], 'ออมทรัพย์', 10000),
  ('T-ACC02', 'เงินสด ทดสอบ', array['EID99'], 'เงินสด', 0)
on conflict (account_id) do nothing;

-- settings (marker 'ทดสอบ' ใน tax_account เพื่อลบง่าย) + หมวดหมู่/อัตรา WHT
insert into app_settings (kind, value, sort) values
  ('tax_account', 'กสิกร ทดสอบ', 90),
  ('expense_cat', 'ต้นทุนสุรา', 91),
  ('expense_cat', 'ค่าบริการทดสอบ', 92),
  ('income_cat',  'ขายสินค้าทดสอบ', 93),
  ('wht_rate',    '3', 94)
on conflict (kind, value) do nothing;

-- คู่ค้าทดสอบ (บุคคล + นิติบุคคล → แยก ภงด.3/53)
insert into contacts (contact_id, name, tax_id, branch, address, contact_type) values
  ('T-C0001', 'นายทดสอบ ใจดี', '1103700000000', 'สำนักงานใหญ่', '1 ถ.ทดสอบ กรุงเทพฯ 10000', 'ผู้ขาย'),
  ('T-C0002', 'บริษัท ทดสอบขนส่ง จำกัด', '0105500000000', 'สำนักงานใหญ่', '2 ถ.ทดสอบ นครสวรรค์ 60000', 'ทั้งสอง')
on conflict (contact_id) do nothing;

-- ── transactions เดือน 2026-07 (account 'กสิกร ทดสอบ') ─────────────────────────
-- 1) ขาย มี VAT (เข้า ภพ.30 ฝั่งขาย)
insert into transactions (tx_id, transaction_date, type, account_name, category, contact_name, description,
  base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
  tax_invoice_no, tax_invoice_date, status, entity_id, source) values
  ('T-TR-0001', '2026-07-05', 'รายรับ', 'กสิกร ทดสอบ', 'ขายสินค้าทดสอบ', 'บริษัท ทดสอบขนส่ง จำกัด', 'ขายสุราทดสอบ',
   1000, 0, 1000, 70, 0, 0, 1070, 'INV-T1', '2026-07-05', 'ปกติ', 'EID99', 'ui');

-- 2) ซื้อ มี VAT + WHT 3% (เข้า ภพ.30 ฝั่งซื้อ + ภงด.3 บุคคล + ค้างออก 50ทวิ)
insert into transactions (tx_id, transaction_date, type, account_name, category, contact_name, description,
  base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
  tax_invoice_no, tax_invoice_date, status, entity_id, source) values
  ('T-TR-0002', '2026-07-08', 'รายจ่าย', 'กสิกร ทดสอบ', 'ค่าบริการทดสอบ', 'นายทดสอบ ใจดี', 'ค่าบริการทดสอบ',
   2000, 0, 2000, 140, 3, 60, 2080, 'B-T1', '2026-07-08', 'ปกติ', 'EID99', 'ui');

-- 3) ซื้อ WHT นิติบุคคล ไม่มี VAT (เข้า ภงด.53)
insert into transactions (tx_id, transaction_date, type, account_name, category, contact_name, description,
  base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
  status, entity_id, source) values
  ('T-TR-0003', '2026-07-10', 'รายจ่าย', 'กสิกร ทดสอบ', 'ค่าบริการทดสอบ', 'บริษัท ทดสอบขนส่ง จำกัด', 'ค่าขนส่งทดสอบ',
   1000, 0, 1000, 0, 1, 10, 990, 'ปกติ', 'EID99', 'ui');

-- 4) บิลค้าง AP (เจ้าหนี้) — ไม่เข้ารายงาน/ยอดเงินจนกว่า settle
insert into transactions (tx_id, transaction_date, type, account_name, category, contact_name, description,
  base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
  status, entity_id, ap_ar_status, due_date, source) values
  ('T-TR-0004', '2026-07-11', 'รายจ่าย', '', 'ค่าบริการทดสอบ', 'นายทดสอบ ใจดี', 'ค่าซ่อมทดสอบ (ตั้งค้าง)',
   3000, 0, 3000, 210, 0, 0, 3210, 'ปกติ', 'EID99', 'AP', '2026-08-11', 'ui');

-- 5) โอนระหว่างบัญชี (2 แถว ผูก transfer_id) — ไม่เข้า ภพ.30/dashboard
insert into transactions (tx_id, transaction_date, type, account_name, category, contact_name, description,
  net_amount, tax_invoice_date, status, transfer_id, entity_id, source) values
  ('T-TR-0005', '2026-07-12', 'โอนระหว่างบัญชี', 'กสิกร ทดสอบ', 'โอนระหว่างบัญชี', '', 'โอนออกไป [เงินสด ทดสอบ]',
   -500, '2026-07-12', 'ปกติ', 'TRF-TEST-01', 'EID99', 'ui'),
  ('T-TR-0006', '2026-07-12', 'โอนระหว่างบัญชี', 'เงินสด ทดสอบ', 'โอนระหว่างบัญชี', '', 'รับโอนจาก [กสิกร ทดสอบ]',
   500, '2026-07-12', 'ปกติ', 'TRF-TEST-01', 'EID99', 'ui');

-- 6) เช็คราคา (ยอด 0 · account ว่าง → หลุดทุกรายงาน)
insert into transactions (tx_id, transaction_date, type, account_name, category, contact_name, description,
  status, entity_id, source) values
  ('T-TR-0007', '2026-07-09', 'เช็คราคา', '', 'เช็คราคา', 'นายทดสอบ ใจดี', 'สอบถามราคาทดสอบ', 'ปกติ', 'EID99', 'ui');

-- items (ประวัติราคา)
insert into transaction_items (item_id, tx_id, item_name, quantity, in_vat, ex_vat, total_price) values
  ('T-TR-0001-01', 'T-TR-0001', 'สุราทดสอบ 750ml', 10, 107, 100, 1000),
  ('T-TR-0002-01', 'T-TR-0002', 'ค่าบริการออกแบบทดสอบ', 1, 2140, 2000, 2000),
  ('T-TR-0007-01', 'T-TR-0007', 'ขวดแก้วทดสอบ', 100, 5.35, 5, 0)
on conflict (item_id) do nothing;

select 'seed บัญชีทดสอบเรียบร้อย (EID99 · 2026-07)' as result;
