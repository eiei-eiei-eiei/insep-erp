-- ============================================================================
-- seed_test.sql — ชุดข้อมูลทดสอบ Phase 2 (ผลิต) · รันซ้ำได้ (ลบของเก่าก่อน)
--   marker สำหรับลบทีเดียว: entity EID99 · master id ขึ้นต้น 'T-' · ชื่อสุรามีคำว่า 'ทดสอบ'
--   scenario เดือน 2026-07 ครบ flow: วัตถุดิบ→หมัก→กลั่น→ปรุง→บรรจุ→จ่าย
--   ⚠️ วิธีใช้: เปิด Supabase → SQL Editor → วางทั้งไฟล์ → Run  (ลบด้วย cleanup_test.sql)
-- ============================================================================

-- ล้าง log ทดสอบเก่าก่อน (กันซ้ำเวลารันหลายรอบ)
delete from log_material  where material_id like 'T-%';
delete from log_product   where product_id like 'T-%';
delete from log_ferment   where product_name like '%ทดสอบ%';
delete from log_distill    where product_name like '%ทดสอบ%';
delete from log_dilute     where product_name like '%ทดสอบ%';
delete from log_ferment_monitor where product_name like '%ทดสอบ%';
delete from log_distill_run where product_name like '%ทดสอบ%';

-- กิจการทดสอบ + เลขสรรพสามิต placeholder 13 หลัก (ตอนใช้จริงกรอกของจริงที่ entities)
-- excise_id = 17 หลัก (กล่อง 13-1-3) placeholder · ตอนใช้จริงกรอกเลขจริงของคุณที่ entities
insert into entities (entity_id, name, is_vat, tax_id, branch, excise_id)
values ('EID99', 'กิจการทดสอบ (ลบได้)', true, '9999999999999', 'สำนักงานใหญ่', '12345678901234567')
on conflict (entity_id) do update
  set name = excluded.name, excise_id = excluded.excise_id;

-- master วัตถุดิบ / ภาชนะ / สินค้า
insert into materials (material_id, name, unit) values
  ('T-MAT01', 'ข้าวเหนียวทดสอบ', 'กก.'),
  ('T-MAT02', 'น้ำตาลทดสอบ', 'กก.')
on conflict (material_id) do nothing;

insert into containers (container_id, container_type, capacity_l) values
  ('T-CON01', 'ถังหมักทดสอบ', 200)
on conflict (container_id) do nothing;

insert into products (product_id, name, degree, bottle_size_l, liquor_type, liquor_kind) values
  ('T-PROD01', 'สาโททดสอบ', 40, 0.75, 'สุราแช่', 'สาโท'),
  ('T-PROD02', 'ยินทดสอบ', 40, 0.70, 'สุรากลั่น', 'สุราขาว')
on conflict (product_id) do nothing;

-- ── scenario เดือน 2026-07 (สาโททดสอบ) ────────────────────────────────────────────
-- วัตถุดิบ: ยกมา ก.ค. + รับ + เบิกหมัก + เสียหาย
insert into log_material (doc_date, trans_type, material_id, amount, doc_ref, note) values
  ('2026-06-20', 'รับ',    'T-MAT01', 100, 'PO-1', 'ยอดยกมา'),
  ('2026-07-05', 'รับ',    'T-MAT01', 200, 'PO-2', 'ซื้อเข้า'),
  ('2026-07-06', 'จ่าย',   'T-MAT01', 120, '1/69', 'เบิกไปหมัก (อัตโนมัติ)'),
  ('2026-07-08', 'เสียหาย', 'T-MAT02', 3,   '',     'ทดสอบเสียหาย');

-- หมัก batch 1/69 (วัตถุดิบหลัก 120)
insert into log_ferment (ferment_date, product_name, batch, container_id, container_qty, material_ids, material_amounts) values
  ('2026-07-06', 'สาโททดสอบ', '1/69', 'T-CON01', 2, 'T-MAT01, T-MAT02', '120, 5');

-- กลั่น (1 batch = 1 แถว) — ได้ 40 ล. @70
insert into log_distill (distill_date, product_name, batch, vol, abv) values
  ('2026-07-10', 'สาโททดสอบ', '1/69', 40, 70);

-- ปรุง: 40 ล.@70 → 80 ล.@40
insert into log_dilute (dilute_date, product_name, bottle_size, start_vol, start_abv, water, final_vol, final_abv, note) values
  ('2026-07-12', 'สาโททดสอบ', '0.75', 40, 70, 40, 80, 40, 'ปรับดีกรีทดสอบ');

-- บรรจุ 100 ขวด (trigger สต็อก +100) + จ่าย 30 (สต็อก -30) → คงเหลือ 70
insert into log_product (doc_date, trans_type, product_id, amount, note) values
  ('2026-07-15', 'รับ',  'T-PROD01', 100, 'บรรจุทดสอบ'),
  ('2026-07-20', 'จ่าย', 'T-PROD01', 30,  'ส่ง ORD260720-001');

-- ── ข้อมูลสำหรับหน้า "ประวัติ/เทียบ" (ค่าวัดหมัก + reading กลั่น) 2 batch ────────────
-- batch 1/69 (สาโททดสอบ): ค่าวัดหมัก 3 ครั้ง + กลั่น 1 หม้อ
insert into log_ferment_monitor (measure_date, measure_time, batch, product_name, ph, brix, temp, note) values
  ('2026-07-06', '08:00', '1/69', 'สาโททดสอบ', 4.5, 12, 28, ''),
  ('2026-07-08', '08:00', '1/69', 'สาโททดสอบ', 4.1, 8,  32, ''),
  ('2026-07-09', '08:00', '1/69', 'สาโททดสอบ', 3.9, 5,  30, '');
insert into log_distill_run (run_id, pot_no, batch, product_name, minute, phase, abv_obs, temp_spirit, abv20, cum_vol, vapor_temp, ferm_charge) values
  ('DR-TEST1', 1, '1/69', 'สาโททดสอบ', 0,  'เริ่มกลั่น', null, null, null, null, null, 120),
  ('DR-TEST1', 1, '1/69', 'สาโททดสอบ', 10, 'กลาง', 82, 30, 80, 15, 95, null),
  ('DR-TEST1', 1, '1/69', 'สาโททดสอบ', 20, 'กลาง', 78, 30, 76, 40, 96, null),
  ('DR-TEST1', 1, '1/69', 'สาโททดสอบ', 25, 'จบหม้อ', 74, 30, 72, 40, 97, null);

-- batch 2/69 (ยินทดสอบ): หมัก + ค่าวัด + กลั่น (ไว้เทียบกับ 1/69)
insert into log_ferment (ferment_date, product_name, batch, container_id, container_qty, material_ids, material_amounts) values
  ('2026-07-06', 'ยินทดสอบ', '2/69', 'T-CON01', 1, 'T-MAT02', '80');
insert into log_distill (distill_date, product_name, batch, vol, abv) values
  ('2026-07-11', 'ยินทดสอบ', '2/69', 30, 75);
insert into log_ferment_monitor (measure_date, measure_time, batch, product_name, ph, brix, temp, note) values
  ('2026-07-06', '09:00', '2/69', 'ยินทดสอบ', 4.6, 14, 27, ''),
  ('2026-07-08', '09:00', '2/69', 'ยินทดสอบ', 4.2, 9,  31, ''),
  ('2026-07-09', '09:00', '2/69', 'ยินทดสอบ', 4.0, 6,  29, '');
insert into log_distill_run (run_id, pot_no, batch, product_name, minute, phase, abv_obs, temp_spirit, abv20, cum_vol, vapor_temp, ferm_charge) values
  ('DR-TEST2', 1, '2/69', 'ยินทดสอบ', 0,  'เริ่มกลั่น', null, null, null, null, null, 80),
  ('DR-TEST2', 1, '2/69', 'ยินทดสอบ', 12, 'กลาง', 84, 29, 82, 12, 94, null),
  ('DR-TEST2', 1, '2/69', 'ยินทดสอบ', 24, 'กลาง', 80, 29, 78, 30, 95, null),
  ('DR-TEST2', 1, '2/69', 'ยินทดสอบ', 30, 'จบหม้อ', 76, 29, 74, 30, 96, null);

-- ตรวจผลเร็ว ๆ
select 'stock T-PROD01 (คาดหวัง 70)' as check, balance from stock_product where product_id = 'T-PROD01';
