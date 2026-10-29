-- ─────────────────────────────────────────────────────────────────────────────
-- 0098 — แอปขาย: บัญชีรับเงินสดแยก  (D142)
--
-- 🎯 ผู้ใช้: รับเงินสดจากออเดอร์แล้วยอดไปลงบัญชีธนาคาร (sales_revenue_account) ⇒ สเตทเม้นต์ไม่ตรง
--    เงินสดเข้าธนาคารจริงตอนเอาไปฝาก (คนละวัน · รวมก้อน · อาจหยิบไปใช้ก่อน)
--    → kind ใหม่ 'sales_cash_account' · รับเงินด้วยวิธี "เงินสด" ลงบัญชีนั้น ที่เหลือลงบัญชีหลัก
--    ไม่ตั้ง = พฤติกรรมเดิมทุกตัวอักษร (แพตเทิร์นเดียวกับ bar_cash_account ของ D116)
--
-- ★ การเลือกบัญชีอยู่ฝั่ง TS ที่เดียว (`revenueAccountFor()` ใน lib/sales/orders.ts)
--   fn_apply_order_action เขียน account_name ตามที่ได้รับมา ⇒ ไม่ต้องแตะ RPC
-- ★ ยกเลิกออเดอร์ = เปลี่ยนสถานะบิลเดิมเป็น 'ยกเลิก' ⇒ ย้อนจากบัญชีที่รับไว้จริงเสมอ ไม่ต้องแตะ
-- ★ สิทธิ์เขียน: ไม่ขึ้นต้น bar_/payroll_ ⇒ app_setting_cap() = 'admin' เหมือน sales_revenue_account
--
-- 🪤 app_settings.kind เป็น CHECK whitelist ที่เขียนทับทั้งก้อน — ยกรายชื่อเดิมจาก 0084 มาครบ (D80)
-- 🚨 fn_account_setting_kinds() ต้องมี kind ใหม่ด้วย ไม่งั้นเปลี่ยนชื่อบัญชีแล้วค่าตั้งนี้
--    ชี้ไปบัญชีที่ไม่มีอยู่ + ลบบัญชีที่ตั้งไว้ได้ (D125 · bankAccounts.test.ts เทียบให้)
--    signature เดิม + ไม่ใช่ definer ⇒ create or replace คงสิทธิ์เดิม (D99)
-- ─────────────────────────────────────────────────────────────────────────────

alter table app_settings drop constraint if exists app_settings_kind_check;
alter table app_settings add constraint app_settings_kind_check
  check (kind in ('expense_cat','income_cat','wht_rate','tax_account',
                  'sales_revenue_account','sales_revenue_entity','sales_doc_entity',
                  'brand_name','brand_color','logo_url','default_mode',
                  'line_channel_token','line_group_id',
                  -- เงินเดือน (0040)
                  'pay_group',
                  'payroll_entity','payroll_pay_account','payroll_sso_account',
                  'payroll_wht_account','payroll_hours_per_day','payroll_rounding',
                  -- D80: หมวดที่จุดชนวนรับวัตถุดิบเข้าสต็อกผลิต (list — มีได้หลายแถว)
                  'material_forward_cat',
                  -- D86: ลูกค้าปริยายของหน้าขายหน้าร้าน (contact_id · แถวเดียว)
                  'pos_walkin_contact',
                  -- ★ D96 — บาร์/POS
                  'bar_entity','bar_revenue_account','bar_income_cat',
                  'bar_promptpay_type','bar_promptpay_id',
                  'bar_channels',                       -- list — ป้ายช่องทาง/งาน ตั้งชื่อเอง
                  'bar_day_start','bar_day_end',        -- รอบขาย · เท่ากัน = ไม่ได้ตั้งรอบ
                  'bar_round_cash','bar_block_negative',
                  'bar_receipt_footer',
                  -- ★ ผังหน้าตาบิล — **JSON ก้อนเดียว** ไม่แตกเป็น kind ละสวิตช์
                  --   เพราะทุกสวิตช์ใหม่จะกลายเป็น migration ใหม่ (กับดัก D80)
                  'bar_receipt_layout',
                  -- ★ D116 — บัญชีเงินสดของบาร์ (แถวเดียว · ไม่ตั้ง = ใช้ bar_revenue_account)
                  'bar_cash_account',
                  -- ★ D142 — บัญชีเงินสดของแอปขาย (แถวเดียว · ไม่ตั้ง = ใช้ sales_revenue_account)
                  'sales_cash_account'));

create or replace function fn_account_setting_kinds() returns text[]
language sql immutable set search_path = public as $$
  select array['sales_revenue_account','sales_cash_account','bar_revenue_account','bar_cash_account',
               'payroll_pay_account','payroll_sso_account','payroll_wht_account',
               'tax_account'];
$$;
