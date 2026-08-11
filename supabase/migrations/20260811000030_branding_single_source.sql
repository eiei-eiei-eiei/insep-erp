-- ============================================================================
-- 0030 branding แหล่งเดียว — แก้บั๊กจาก 0025
--
--   อาการที่ผู้ใช้เจอ: เปลี่ยนสีแบรนด์ในแท็บตั้งค่าแล้ว **หน้า login ไม่เปลี่ยนตาม**
--
--   สาเหตุ: 0025 สร้างคอลัมน์ brand_name/logo_url/brand_color ไว้บน `tenants`
--   แล้วให้ view `tenant_branding` (หน้า login) อ่านจากตรงนั้น
--   แต่ทั้งแอป + UI ตั้งค่า (D43) เขียน/อ่าน `app_settings` มาตั้งแต่ต้น
--   → แบรนด์มี 2 แหล่งที่ไม่คุยกัน · ตั้งค่าที่หนึ่ง อีกที่ไม่รู้เรื่อง
--
--   แก้: `app_settings` เป็นเจ้าของค่าเพียงแหล่งเดียว (ของเดิมที่ใช้อยู่แล้ว)
--        view แค่ "เปิดหน้าต่าง" ให้อ่านได้ก่อนล็อกอินโดยอ้างอิง slug
--        แล้ว **ลบคอลัมน์แบรนด์บน tenants ทิ้ง** เพื่อไม่ให้มีที่ให้ค่าเพี้ยนกันอีก
--
--   ⚠️ view นี้ anon อ่านได้ → **ห้ามใส่ kind อื่นเข้าไปเด็ดขาด**
--      app_settings มีทั้งผังบัญชี/กิจการรับรายได้/อัตราภาษี ที่ต้องไม่หลุดก่อนล็อกอิน
-- ============================================================================

drop view if exists tenant_branding;

create view tenant_branding
with (security_invoker = off) as
  select
    t.slug,
    max(s.value) filter (where s.kind = 'brand_name')  as brand_name,
    max(s.value) filter (where s.kind = 'logo_url')    as logo_url,
    max(s.value) filter (where s.kind = 'brand_color') as brand_color
  from tenants t
  left join app_settings s
    on s.tenant_id = t.id
   and s.kind in ('brand_name', 'logo_url', 'brand_color')  -- ★ whitelist เท่านั้น
  where t.is_active
  group by t.slug;

grant select on tenant_branding to anon, authenticated;

-- คอลัมน์แบรนด์บน tenants ไม่ใช้แล้ว — ลบทิ้งกันสับสน
alter table tenants drop constraint if exists tenants_brand_color_check;
alter table tenants drop column if exists brand_name;
alter table tenants drop column if exists logo_url;
alter table tenants drop column if exists brand_color;

comment on view tenant_branding is
  'แบรนด์ต่อ tenant สำหรับหน้า login (ก่อนล็อกอิน RLS อ่าน app_settings ไม่ได้) '
  '· ห้ามเพิ่ม kind อื่นนอกจาก brand_name/logo_url/brand_color — anon อ่าน view นี้ได้';

notify pgrst, 'reload schema';
