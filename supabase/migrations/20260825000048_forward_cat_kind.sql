-- ============================================================================
-- 0048 เปิด app_settings.kind ใหม่: material_forward_cat — D80 ชุด B
--
-- หมวดรายจ่ายที่ "จุดชนวน" การรับวัตถุดิบเข้าสต็อกผลิต (T6) — เดิมฮาร์ดโค้ดคำว่า
-- 'ต้นทุนสุรา' ไว้ในหน้าจอ แต่ผังบัญชีจริงของลูกค้าไม่มีคำนี้ → ให้ตั้งเองได้ หลายหมวดได้
--
-- ★ ไม่ต้อง seed ค่าให้ลูกค้าเดิม — ไม่มีแถว = โค้ดใช้ค่าปริยาย 'วัตถุดิบผลิตสุรา'
--   (lib/accounting/forwardCats.ts) · ปลอดภัยเพราะเส้นทางนี้ไม่เคยทำงานสำเร็จเลยก่อน 0046
--
-- 🪤 `app_settings.kind` เป็น **CHECK whitelist** — เพิ่ม kind ใหม่ในโค้ดอย่างเดียวไม่พอ
--    ผู้ใช้จะกดเพิ่มแล้วเด้ง "ค่าที่กรอกไม่ถูกต้องตามที่ระบบกำหนด" (เจอจริงตอนเทส)
--    ★ ต้องยกรายชื่อเดิมมาครบทุกตัว — constraint นี้เขียนทับทั้งก้อนทุกครั้ง
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
                  'material_forward_cat'));

notify pgrst, 'reload schema';
