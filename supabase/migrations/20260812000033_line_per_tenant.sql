-- ============================================================================
-- 0033 LINE ต่อ tenant — ปิดช่องแจ้งเตือนรั่วข้ามลูกค้า (NEXT_STEPS 4.0.1b)
--
--   ปัญหา: lib/line.ts อ่าน LINE_CHANNEL_TOKEN / LINE_GROUP_ID จาก **env ของ Vercel project**
--   → ลูกค้าทุกเจ้าที่อยู่ deployment เดียวกันยิงเข้ากลุ่ม LINE กลุ่มเดียวกันหมด
--   → ลูกค้า ก. เห็นออเดอร์/ชื่อลูกค้า/ยอดเงินของลูกค้า ข.
--
--   ★ รั่วโดยไม่ต้องมีใครตั้งใจเจาะ — เกิดเองทันทีที่ลูกค้าเจ้าที่ 2 เข้าระบบ
--     ต่างจากช่องโหว่รหัสผ่านที่ยังต้องมีคนเดารหัสถูกก่อน
--
--   แก้: ย้ายค่าไป app_settings ต่อ tenant (ที่เดียวกับ brand_color — D47)
--        แล้วให้ lib/line.ts อ่านจาก tenant ของ session เท่านั้น **ห้าม fallback ไป env**
--        (fallback = ตัวบั๊กเอง: tenant ที่ยังไม่ตั้งค่าจะไปยิงเข้ากลุ่มของ env ซึ่งเป็นของอีกเจ้า)
-- ============================================================================

-- ── 1. kind ใหม่ 2 ตัว ───────────────────────────────────────────────────────
--    ⚠️ ต้องยกรายการเดิมจาก 0023 มาครบ — constraint นี้เป็นการเขียนทับทั้งก้อน
--       ตกไปตัวเดียว = ค่าที่ลูกค้าตั้งไว้อยู่แล้วบันทึกไม่ได้อีก
alter table app_settings drop constraint if exists app_settings_kind_check;
alter table app_settings add constraint app_settings_kind_check
  check (kind in ('expense_cat','income_cat','wht_rate','tax_account',
                  'sales_revenue_account','sales_revenue_entity','sales_doc_entity',
                  'brand_name','brand_color','logo_url','default_mode',
                  'line_channel_token','line_group_id'));

-- ── 2. ค่าลับอ่านได้เฉพาะ main ───────────────────────────────────────────────
--    โทเคน LINE เป็นกุญแจแท้ ๆ (ใครถือก็โพสต์เข้ากลุ่มได้) — ของเดิม app_settings_sel (0028)
--    เปิดให้ **ทุกคนใน tenant** อ่านทุกแถว → พนักงานยิง query ตรงด้วย anon key อ่านโทเคนได้
--
--    🚨 ห้ามปิด select ทั้งตารางเป็น main-only: (app)/layout.tsx โหลด brand_* ให้ **ทุก role**
--       ไว้วาดแถบเมนู → ปิดหมดแล้วพนักงานเข้าแอปไม่ได้เลยทั้งระบบ
--    → แยกตาม kind: ลับ = main เท่านั้น · ที่เหลือคงเดิมเป๊ะ
--
--    เพิ่ม kind ลับใหม่ในอนาคต = แก้ทั้ง 2 ที่: รายการในนี้ + SECRET_KINDS ใน lib/line.ts
drop policy if exists app_settings_sel on app_settings;
create policy app_settings_sel on app_settings for select
  using (
    tenant_id = my_tenant()
    and (my_role() = 'main' or kind not in ('line_channel_token','line_group_id'))
  );

comment on policy app_settings_sel on app_settings is
  'ค่าตั้งค่าทั่วไปอ่านได้ทุก role ใน tenant (แถบเมนูต้องใช้ brand_*) '
  'แต่ค่าที่เป็นความลับ (โทเคน LINE) อ่านได้เฉพาะ main — ซ่อนที่ UI อย่างเดียวกันไม่ได้ '
  'เพราะ anon key เป็นค่าสาธารณะ ใครก็ยิง PostgREST ตรงได้';

-- ── 3. ห้าม backfill จาก env ─────────────────────────────────────────────────
--    migration อ่าน env ไม่ได้ และค่าใน Vercel env เป็นของกิจการเจ้าของระบบเอง
--    ผู้ใช้ต้องกรอกผ่านการ์ด "แจ้งเตือน LINE" ในแท็บตั้งค่าเอง แล้วค่อยลบ env ทิ้ง
--    (ขั้นตอนอยู่ใน docs/GOLIVE_CHECKLIST.md)

notify pgrst, 'reload schema';
