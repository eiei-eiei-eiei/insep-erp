-- ============================================================================
-- 0053 ขายหน้าร้าน (POS) — ค่าตั้ง "ลูกค้าทั่วไป" ปริยาย — D86
--
-- หน้าขายหน้าร้านต้องมีลูกค้าปริยายให้กดขายได้เลยโดยไม่ต้องเลือกทุกบิล
-- เก็บเป็น contact_id ของแถวใน contacts (ไม่ใช่ชื่อ) — เปลี่ยนชื่อลูกค้าแล้วยังชี้ถูก
--
-- 🪤 `app_settings.kind` เป็น CHECK whitelist ที่ **เขียนทับทั้งก้อนทุกครั้ง**
--    ต้องยกรายชื่อเดิมมาครบทุกตัว (ลอกจาก 0048) — ลืมตัวใดตัวหนึ่ง = ค่าที่ลูกค้า
--    ตั้งไว้แล้วบันทึกทับไม่ได้อีกเลย และ error บอกแค่ "ค่าที่กรอกไม่ถูกต้อง"
--
-- 🪤 `app_setting_cap()` ค่าปริยายคือ 'admin' → ไม่ประกาศไว้ = หัวหน้าฝ่ายขายตั้งเองไม่ได้
--    ต้องยกฟังก์ชันจาก 0051 มาทั้งดุ้นแล้วเติมบรรทัดเดียว (create or replace = แทนที่ทั้งตัว)
-- ============================================================================

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
                  'pos_walkin_contact'));

-- ── app_setting_cap() — ยกมาจาก 20260827000051_roles_caps.sql:65-75 ทั้งดุ้น ──
--    เปลี่ยนเฉพาะการเพิ่ม pos_walkin_contact ให้เป็นของฝั่งขาย
create or replace function app_setting_cap(k text) returns text
language sql immutable set search_path = public as $fn$
  select case
    when k = 'pay_group' or k like 'payroll\_%' then 'pay.config'
    when k in ('expense_cat','income_cat','wht_rate','tax_account','material_forward_cat')
      then 'acct.config'
    -- D86: ลูกค้าทั่วไปของหน้าขายหน้าร้าน = เรื่องของฝ่ายขาย ไม่ต้องรบกวนเจ้าของกิจการ
    when k = 'pos_walkin_contact' then 'sales.config'
    -- ที่เหลือเป็นค่าระดับกิจการ: แบรนด์ · โทเคน LINE · กิจการที่ออกเอกสาร · บัญชีรับรายได้
    -- → หน้าตั้งค่ากลาง ซึ่งเป็นของ main เท่านั้น
    else 'admin'
  end;
$fn$;

notify pgrst, 'reload schema';
