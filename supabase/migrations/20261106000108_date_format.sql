-- ─────────────────────────────────────────────────────────────────────────────
-- 0108 — รูปแบบวันที่ที่ลูกค้าเลือกเอง  (D161)
--
-- 🎯 วันที่บนจอเคยมีหลายแบบปนกัน (`6 พ.ย. 69` · `06/11/2569` · `2026-11-06` ดิบ)
--    → kind ใหม่ 2 ตัว แยกกันโดยตั้งใจ:
--      'date_format'      หน้าจอ           ไม่ตั้ง = d_mon_yy      (6 พ.ย. 69)
--      'doc_date_format'  เอกสารการค้า     ไม่ตั้ง = dd_mm_yyyy_be (06/11/2569 — ที่พิมพ์อยู่เดิม)
--    ค่าเป็นคีย์ชุดปิด · ตัวจัดรูปอยู่ฝั่ง TS ที่เดียว (lib/shared/dateFormat.ts)
--    ค่าที่โค้ดไม่รู้จัก = ใช้ค่าเริ่มต้น (ไม่ทำให้หน้าจอพัง) ⇒ ไม่ต้องมี CHECK ระดับค่า
--
-- 🚨 ฟอร์มราชการไม่อ่านค่านี้ (ภส. · ภพ.30 · ภงด. · 50ทวิ · สปส.)
-- ★ อ่าน: ทุกบทบาท (layout ต้องรู้รูปแบบเพื่อวาดทุกหน้า) — policy app_settings_sel เปิดให้อยู่แล้ว
--   (ปิดเฉพาะโทเคน LINE) ⇒ ไม่ต้องแตะ policy
-- ★ เขียน: ไม่ขึ้นต้น bar_/payroll_ ⇒ app_setting_cap() = 'admin' (เจ้าของ) ⇒ ไม่ต้องแตะ
-- ★ ไม่มีตาราง/ฟังก์ชันใหม่ ⇒ ไม่มี grant ใหม่ (D99/D118)
--
-- 🪤 app_settings.kind เป็น CHECK whitelist ที่เขียนทับทั้งก้อน — ยกรายชื่อเดิมจาก 0098 มาครบ (D80)
--    ยกด้วยสคริปต์ + ด่านนับวงเล็บ + ด่านว่าไม่มี kind เดิมหลุด (บทเรียน D96)
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
                  'sales_cash_account',
                  -- ★ D161 — รูปแบบวันที่ (ค่าเดียวต่อ kind · ค่าเป็นคีย์ชุดปิดใน lib/shared/dateFormat.ts)
                  'date_format','doc_date_format'));
