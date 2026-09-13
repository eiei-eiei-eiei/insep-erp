-- ─────────────────────────────────────────────────────────────────────────────
-- 0070 — ผังหน้าตาบิลที่ผู้ใช้จัดเอง  (D96 · ภาค 2 เฟส G)
--
-- 🎯 ผู้ใช้ขอ "อยากให้ customize บิลเองได้" — เรียงบล็อก · เปิด/ปิดบรรทัด ·
--    ข้อความหัว-ท้าย · ขนาดกระดาษ · โลโก้
--
-- 🚨 เก็บเป็น **JSON ก้อนเดียว** ใน kind `bar_receipt_layout`
--    ไม่แตกเป็น kind ละสวิตช์ เพราะ `app_settings.kind` เป็น CHECK whitelist
--    ⇒ ทุกสวิตช์ใหม่จะกลายเป็น migration ใหม่ (กับดัก D80)
--
-- 🚨 รายชื่อ kind ยกมาด้วยสคริปต์ scripts/gen/gen-0070.mjs จากไฟล์ล่าสุดที่นิยาม
--    constraint นี้ (20260910000064_bar_schema.sql) — **ยกมาขาดแม้ชื่อเดียว = ค่าที่ลูกค้าตั้งไว้แล้ว
--    insert ไม่ได้อีกเลย** และไม่มีอะไรฟ้องจนกว่าจะมีคนกดบันทึก
--
-- ★ ไม่ต้องแตะ `app_setting_cap()` — กฎ `bar\_%` → `bar.config` ของ 0064 ครอบให้แล้ว
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
                  'bar_receipt_layout'));
