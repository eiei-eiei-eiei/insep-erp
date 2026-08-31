-- ============================================================================
-- seed_taxpay.sql — ชุดข้อมูลทดสอบ "ชำระภาษี" (D88) · รันซ้ำได้
--   marker ลบทีเดียว: entity EID99 · tx id 'T-TX8%' (ลบด้วย cleanup_test.sql)
--   scenario เดือน **2026-08** (คนละเดือนกับ seed_accounting.sql ที่ใช้ 2026-07
--   โดยตั้งใจ — จะได้เทสทั้ง "เดือนที่ต้องจ่าย" และ "เดือนที่ยกไป" พร้อมกันได้)
--
--   ⚠️ ต้องรัน seed_accounting.sql ก่อน (สร้าง EID99 · บัญชี 'กสิกร ทดสอบ' ·
--      คู่ค้าทดสอบ · app_settings tax_account) — ไฟล์นี้เติมเฉพาะบิลของเดือน ส.ค.
--
--   ตัวเลขที่ควรได้ (กิจการ EID99 · งวด 2026-08):
--     ภาษีขาย   3,500.00   (ขาย 50,000)
--     ภาษีซื้อ     700.00   (ซื้อ 10,000)
--     ต้องชำระ   2,800.00 − ภาษีซื้อยกมาจากเดือน ก.ค. (ถ้าเคยกดสร้าง ภพ.30 ของ ก.ค.
--                            จะมียกมา 70.00 → เหลือ 2,730.00 · ยังไม่เคยกด = 2,800.00)
--     ภงด.3        150.00   (บุคคล · ฐาน 5,000 × 3%)
--     ภงด.53       200.00   (นิติบุคคล · ฐาน 20,000 × 1%)
--   ใช้: Supabase → SQL Editor → วางทั้งไฟล์ → Run
-- ============================================================================

-- ล้างของเก่าของเดือนนี้ (กันรันซ้ำแล้วยอดบวกทบ)
delete from tax_payments      where entity_id = 'EID99' and period = '2026-08';
delete from tax_summaries     where entity_id = 'EID99' and report_month = '2026-08';
delete from report_runs       where entity_id = 'EID99' and month = '2026-08';
delete from transaction_items where tx_id like 'T-TX8%';
delete from transactions      where tx_id like 'T-TX8%';

-- ① ขาย มี VAT → ภาษีขาย 3,500
insert into transactions (tx_id, transaction_date, type, account_name, category, contact_name, description,
  base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
  tax_invoice_no, tax_invoice_date, status, entity_id, source) values
  ('T-TX8-0001', '2026-08-06', 'รายรับ', 'กสิกร ทดสอบ', 'ขายสินค้าทดสอบ', 'บริษัท ทดสอบขนส่ง จำกัด',
   'ขายสุราทดสอบ (ส.ค.)', 50000, 0, 50000, 3500, 0, 0, 53500, 'INV-T8-1', '2026-08-06', 'ปกติ', 'EID99', 'ui');

-- ② ซื้อ มี VAT → ภาษีซื้อ 700
insert into transactions (tx_id, transaction_date, type, account_name, category, contact_name, description,
  base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
  tax_invoice_no, tax_invoice_date, status, entity_id, source) values
  ('T-TX8-0002', '2026-08-07', 'รายจ่าย', 'กสิกร ทดสอบ', 'ค่าบริการทดสอบ', 'บริษัท ทดสอบขนส่ง จำกัด',
   'ซื้อวัสดุทดสอบ (ส.ค.)', 10000, 0, 10000, 700, 0, 0, 10700, 'B-T8-1', '2026-08-07', 'ปกติ', 'EID99', 'ui');

-- ③ จ่ายบุคคลธรรมดา หัก 3% → ภงด.3 = 150
insert into transactions (tx_id, transaction_date, type, account_name, category, contact_name, description,
  base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
  status, entity_id, source) values
  ('T-TX8-0003', '2026-08-12', 'รายจ่าย', 'กสิกร ทดสอบ', 'ค่าบริการทดสอบ', 'นายทดสอบ ใจดี',
   'ค่าจ้างทำของทดสอบ (ส.ค.)', 5000, 0, 5000, 0, 3, 150, 4850, 'ปกติ', 'EID99', 'ui');

-- ④ จ่ายนิติบุคคล หัก 1% → ภงด.53 = 200
insert into transactions (tx_id, transaction_date, type, account_name, category, contact_name, description,
  base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
  status, entity_id, source) values
  ('T-TX8-0004', '2026-08-14', 'รายจ่าย', 'กสิกร ทดสอบ', 'ค่าบริการทดสอบ', 'บริษัท ทดสอบขนส่ง จำกัด',
   'ค่าขนส่งทดสอบ (ส.ค.)', 20000, 0, 20000, 0, 1, 200, 19800, 'ปกติ', 'EID99', 'ui');

-- ⑤ บิลค้างจ่าย (AP) ที่ **มี WHT** — cash basis ต้องยังไม่นับเข้า ภงด. จนกว่าจะจ่ายจริง
--    🚨 ถ้าเห็นยอด ภงด.3 เป็น 300 แทน 150 แปลว่าตัวกรอง ap_ar_status หลุด
insert into transactions (tx_id, transaction_date, type, account_name, category, contact_name, description,
  base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
  status, entity_id, ap_ar_status, due_date, source) values
  ('T-TX8-0005', '2026-08-20', 'รายจ่าย', '', 'ค่าบริการทดสอบ', 'นายทดสอบ ใจดี',
   'ค่าที่ปรึกษาทดสอบ (ตั้งค้าง ส.ค.)', 5000, 0, 5000, 0, 3, 150, 4850,
   'ปกติ', 'EID99', 'AP', '2026-09-20', 'ui');

select 'seed ชำระภาษีทดสอบเรียบร้อย (EID99 · งวด 2026-08 · ต้องชำระ ภพ.30 2,800 · ภงด.3 150 · ภงด.53 200)' as result;
