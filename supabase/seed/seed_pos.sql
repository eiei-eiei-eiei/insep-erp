-- ============================================================================
-- seed_pos.sql — ชุดข้อมูลทดสอบ "ขายหน้าร้าน (POS)" · D86 · รันซ้ำได้
--   marker ลบทีเดียว: entity EID99 · master id 'T-%' · ชื่อมี 'ทดสอบ'
--   ⚠️ ต้องรัน seed_sales.sql ก่อน (สร้าง EID99 · สินค้า T-PROD01 · เมนูขาย · config รายรับ)
--   ใช้: Supabase → SQL Editor → วางทั้งไฟล์ → Run  (ลบด้วย cleanup_test.sql)
--
-- ไฟล์นี้เติมเฉพาะของที่ POS ต้องใช้เพิ่มจาก seed_sales:
--   ① ลูกค้าทั่วไป (ต้องเป็น contact จริง — ที่อยู่/เลขภาษีบนใบกำกับอ่านจากตารางนี้)
--   ② ค่าตั้ง pos_walkin_contact (ต้องลง migration 0053 ก่อน ไม่งั้น CHECK จะปฏิเสธ)
--   ③ เมนูที่ **ไม่ได้ผูกรหัสสินค้า** ไว้พิสูจน์ว่าหน้า POS ซ่อนให้จริงและบอกเหตุผล
--   ④ สินค้าสต็อกน้อย ไว้พิสูจน์แถบเตือน "สต็อกไม่พอ" (ต้องเตือนแต่ยังขายได้)
-- ============================================================================

-- ① ลูกค้าทั่วไป — ขาจรที่ไม่ขอใบกำกับเต็มรูปใช้รายนี้ซ้ำทุกบิล
--    ★ tax_id และ branch เป็น**ค่าว่าง** ให้ตรงกับที่ฟอร์ม "ไม่มีเลขประจำตัวผู้เสียภาษี" สร้าง (D86)
--      สาขาว่าง = เอกสารไม่พิมพ์วงเล็บสาขา (`branchLabel` คืน "") — คนเดินเข้ามาซื้อไม่มีสำนักงานใหญ่/สาขา
insert into contacts (contact_id, name, tax_id, branch, address, contact_type, phone, credit_term, is_export, roles)
values ('T-C0199', 'ลูกค้าทั่วไป (ทดสอบ)', '', '', '-', 'ลูกค้า', '', 0, false, array['ลูกค้า'])
on conflict (contact_id) do nothing;

-- ② ตั้งเป็นลูกค้าปริยายของหน้าขายหน้าร้าน
--    🪤 ต้องลง migration 20260831000053 ก่อน ไม่งั้นติด app_settings_kind_check
delete from app_settings where kind = 'pos_walkin_contact';
insert into app_settings (kind, value, sort) values ('pos_walkin_contact', 'T-C0199', 98);

-- ③ เมนูที่ยังไม่ผูกรหัสสินค้า — หน้า POS ต้อง **ไม่โชว์** และขึ้นแถบบอกว่าซ่อนไปกี่ตัว
--    (ถ้าขายผ่านได้ = ขายแล้วสต็อกไม่ถูกตัดโดยไม่มีอะไรฟ้อง)
insert into sale_menu (menu_name, price, category, product_id, multiplier)
values ('บริการจัดชุดของขวัญทดสอบ', 300, 'ทั่วไป', null, 1)
on conflict (menu_name) do nothing;

-- ④ สินค้าสต็อกน้อย (เหลือ 2 ขวด) — ขาย 3 ต้องขึ้นเตือนเหลือง แต่ปุ่มขายยังกดได้
insert into products (product_id, name, degree, bottle_size_l, liquor_type, liquor_kind)
values ('T-PROD09', 'สุราทดสอบสต็อกน้อย 35 ดีกรี', 35, 0.33, 'สุราขาว', 'สุรากลั่นชุมชน')
on conflict (product_id) do nothing;
insert into stock_product (product_id, balance) values ('T-PROD09', 2)
on conflict (product_id) do update set balance = excluded.balance;
insert into sale_menu (menu_name, price, category, product_id, multiplier)
values ('สุราทดสอบสต็อกน้อย (ขวด)', 214, 'สุรา', 'T-PROD09', 1)
on conflict (menu_name) do nothing;

select 'seed ขายหน้าร้าน (D86) เรียบร้อย — เข้า /sales?tab=pos ทดสอบได้เลย' as result;
