-- ============================================================================
-- 0023 ข้อมูลผู้ขายบนเอกสารการค้า (D44 · ปลดล็อกการขายเป็นสินค้า)
--   เดิมชื่อบริษัท/ที่อยู่/เลขภาษี/เลขบัญชีธนาคาร ถูก hardcode ใน
--   app/(app)/sales/_components/print.ts → ลูกค้ารายอื่นพิมพ์ใบกำกับภาษี
--   ออกมาเป็นชื่อ+บัญชีธนาคารของโรงกลั่นเจ้าของโค้ด (เงินเข้าผิดบัญชี/ผิดนิติบุคคล)
--
--   ย้ายมาอ่านจากตาราง `entities` ซึ่งเป็นข้อมูลต่อกิจการอยู่แล้ว
--   (ฟอร์มราชการ ภพ.30/ภงด./50ทวิ/ภส. อ่านจากตารางนี้อยู่ก่อนแล้ว → หัวเอกสารตรงกันทั้งระบบ)
--
--   3 คอลัมน์ที่ยังไม่มี: ชื่ออังกฤษ · เบอร์โทร · ช่องทางโอนเงิน (หลายบรรทัดได้)
-- ============================================================================

alter table entities add column if not exists name_eng  text;   -- ชื่อภาษาอังกฤษใต้ชื่อไทยบนหัวเอกสาร
alter table entities add column if not exists phone     text;   -- เบอร์โทรต่อท้ายบรรทัดเลขภาษี
alter table entities add column if not exists bank_line text;   -- กล่อง "ช่องทางการโอนเงิน" (ขึ้นบรรทัดใหม่ได้)

-- กิจการที่ใช้ออกเอกสารการค้า — แยกจาก sales_revenue_entity (กิจการที่ลงบัญชีรับเงิน)
-- โดยตั้งใจ: ส่วนใหญ่เป็นตัวเดียวกัน แต่ผู้ใช้ที่มีหลายนิติบุคคลต้องเลือกได้ว่าหัวกระดาษเป็นชื่อใคร
-- ถ้าไม่ตั้ง → ระบบใช้ sales_revenue_entity → ถ้ายังไม่มีอีกและมีกิจการเดียว ใช้กิจการนั้น
alter table app_settings drop constraint if exists app_settings_kind_check;
alter table app_settings add constraint app_settings_kind_check
  check (kind in ('expense_cat','income_cat','wht_rate','tax_account',
                  'sales_revenue_account','sales_revenue_entity','sales_doc_entity',
                  'brand_name','brand_color','logo_url','default_mode'));
