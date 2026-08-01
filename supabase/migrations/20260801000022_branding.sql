-- ============================================================================
-- 0022 branding — ชื่อ/สี/โลโก้ ต่อกิจการ (D43 · เตรียมขายเป็นสินค้าให้โรงอื่น)
--   เก็บใน app_settings ของแต่ละ tenant → deploy โค้ดใหม่ไม่กระทบค่าที่ตั้งไว้
--   (โค้ดอยู่ที่ Vercel · ค่าอยู่ที่ Supabase ของลูกค้า — คนละที่กัน)
--
--   brand_color เก็บ "ชื่อชุดสี" ไม่ใช่รหัสสี — เพราะแต่ละชุดมีค่าคู่ สว่าง/มืด
--   ที่ตรวจ contrast แล้ว (ดู app/globals.css) · กันลูกค้าเลือกสีที่อ่านไม่ออก
--   ★ สีสถานะ (เขียว=ปกติ เหลือง=ค้าง แดง=ผิดพลาด) ล็อกตายในโค้ด ห้ามตั้งค่าได้
-- ============================================================================

alter table app_settings drop constraint if exists app_settings_kind_check;
alter table app_settings add constraint app_settings_kind_check
  check (kind in ('expense_cat','income_cat','wht_rate','tax_account',
                  'sales_revenue_account','sales_revenue_entity',
                  'brand_name','brand_color','logo_url','default_mode'));

-- ชุดสีที่อนุญาต (ตรงกับ [data-brand] ใน globals.css) + โหมดเริ่มต้น
alter table app_settings drop constraint if exists app_settings_brand_value_check;
alter table app_settings add constraint app_settings_brand_value_check check (
  kind <> 'brand_color' or value in ('steel','copper','green','indigo','wine','teal','rust')
);
alter table app_settings drop constraint if exists app_settings_mode_value_check;
alter table app_settings add constraint app_settings_mode_value_check check (
  kind <> 'default_mode' or value in ('light','dark')
);

-- ค่าเริ่มต้นของ tenant นี้ (แก้ได้จากแท็บตั้งค่า)
insert into app_settings (kind, value)
select 'brand_name', 'Insep ERP'
where not exists (select 1 from app_settings where kind = 'brand_name');

insert into app_settings (kind, value)
select 'brand_color', 'steel'
where not exists (select 1 from app_settings where kind = 'brand_color');

insert into app_settings (kind, value)
select 'default_mode', 'light'
where not exists (select 1 from app_settings where kind = 'default_mode');
