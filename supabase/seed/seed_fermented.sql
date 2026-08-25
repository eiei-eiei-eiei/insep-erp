-- ============================================================================
-- seed_fermented.sql — ชุดข้อมูลทดสอบ **เส้นทางสุราแช่** (D78 · migration 0045)
--   marker เดียวกับชุดอื่น: entity EID99 · master id 'T-' · ชื่อมีคำว่า 'ทดสอบ'
--   ลบทีเดียวด้วย cleanup_test.sql เหมือนเดิม
--
--   สถานการณ์ พ.ค. 2569 (ตัวเลขกลม ตรวจกับฟอร์มด้วยตาได้):
--     3 พ.ค.  หมัก 11/69  2 ถัง × 100 ล. = น้ำหมัก 200 ล.
--     8 พ.ค.  หมัก 12/69  1 ถัง × 100 ล. = น้ำหมัก 100 ล.
--    24 พ.ค.  ริน 11/69 ได้ 160 ล. 12 ดีกรี → ปรุงเป็น 200 ล. 9 ดีกรี (เติมน้ำ 40)
--    28 พ.ค.  บรรจุ 0.75 ล. × 200 ขวด = 150 ล.
--   ค่าที่ต้องเห็นบนฟอร์ม ภส.๐๗-๐๒/๑(๑) ฉบับสุราแช่:
--     รวมเดือนนี้ = น้ำหมัก 300 · น้ำสุราแช่ 200 · น้ำหมักคงเหลือ 100 · บรรจุ 150 · สุราแช่คงเหลือ 50
--     รวมแต่ต้นปี = 300 / 200 / 150 (ไม่มีช่องคงเหลือ)
--
--   ⚠️ วิธีใช้: Supabase → SQL Editor → วางทั้งไฟล์ → Run  (ต้องรัน seed_test.sql ก่อน — ใช้ EID99 ร่วมกัน)
-- ============================================================================

-- ล้างของเก่าก่อน (รันซ้ำได้)
delete from log_ferment_draw where product_name like '%ไวน์ลิ้นจี่ทดสอบ%';
delete from log_ferment      where product_name like '%ไวน์ลิ้นจี่ทดสอบ%';
delete from log_product      where product_id = 'T-PROD03';

-- กิจการทดสอบ (เผื่อยังไม่ได้รัน seed_test.sql)
insert into entities (entity_id, name, is_vat, tax_id, branch, excise_id)
values ('EID99', 'กิจการทดสอบ (ลบได้)', true, '9999999999999', 'สำนักงานใหญ่', '12345678901234567')
on conflict (entity_id) do nothing;

insert into containers (container_id, container_type, capacity_l) values
  ('T-CON02', 'ถังหมักไวน์ทดสอบ', 120)
on conflict (container_id) do nothing;

-- ★ ประเภทสุรา = 'สุราแช่' → ระบบจะโชว์แท็บ "รินน้ำสุราแช่" และออกฟอร์มบัญชีผลิตฉบับสุราแช่
insert into products (product_id, name, degree, bottle_size_l, liquor_type, liquor_kind) values
  ('T-PROD03', 'ไวน์ลิ้นจี่ทดสอบ', 9, 0.75, 'สุราแช่', 'ไวน์ผลไม้')
on conflict (product_id) do update
  set liquor_type = excluded.liquor_type, degree = excluded.degree, bottle_size_l = excluded.bottle_size_l;

-- ── หมัก 2 ครั้ง (ค่าแรกของ material_amounts = ปริมาณน้ำหมักเป็นลิตร) ──────────────
insert into log_ferment (ferment_date, product_name, batch, container_id, container_qty, material_ids, material_amounts) values
  ('2026-05-03', 'ไวน์ลิ้นจี่ทดสอบ', '11/69', 'T-CON02', 2, 'T-MAT02', '200'),
  ('2026-05-08', 'ไวน์ลิ้นจี่ทดสอบ', '12/69', 'T-CON02', 1, 'T-MAT02', '100');

-- ── ริน 11/69 + ปรุงในแถวเดียวกัน (1 ครั้งที่หมัก = 1 แถว) ────────────────────────
--    ★ 12/69 ตั้งใจไม่ริน — ไว้เทสว่ายังโผล่ในดร็อปดาวน์ "ครั้งที่หมักที่ยังไม่ริน"
--      และน้ำหมักของมัน (100 ล.) ยังค้างเป็นยอดคงเหลือ
insert into log_ferment_draw (draw_date, product_name, batch, vol, abv, water, final_vol, final_abv, note) values
  ('2026-05-24', 'ไวน์ลิ้นจี่ทดสอบ', '11/69', 160, 12, 40, 200, 9, '');

-- ── บรรจุ 200 ขวด × 0.75 ล. = 150 ล. (trigger สต็อก +200 ขวด) ────────────────────
insert into log_product (doc_date, trans_type, product_id, amount, note) values
  ('2026-05-28', 'รับ', 'T-PROD03', 200, 'บรรจุทดสอบสุราแช่');

select 'seed สุราแช่เรียบร้อย — ออกฟอร์มเดือน 2026-05 ของ "ไวน์ลิ้นจี่ทดสอบ" แล้วเทียบเลข 300/200/100/150/50' as result;
