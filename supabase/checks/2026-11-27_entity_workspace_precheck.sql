-- ============================================================================
-- ตรวจก่อนเริ่มเฟส 1 ทาง Y (docs/ENTITY_WORKSPACE_SPEC.md ส่วนที่ 9) — 2026-11-27
-- ★ อ่านอย่างเดียว (select ล้วน) ไม่แก้ข้อมูลใด ๆ · รันได้ทุก DB
-- ★ รันใน Supabase SQL Editor ทีละข้อ (ก๊อปทีละบล็อก → Run) — Editor โชว์ผลแค่คำสั่งสุดท้าย
-- ★ ต้องรันทั้ง 2 DB (ของเจ้าของ + proof-app)
-- ============================================================================


-- ── ข้อ 1: มีแถวของ ผลิต/ขาย/บาร์/เงินเดือน อยู่นอกกิจการหลักไหม ──────────────
-- ควรเห็น: คอลัมน์ "แถวนอกกิจการหลัก" = 0 ทุกตาราง
--   · ยกเว้นตาราง bar_* ที่อาจไม่เป็น 0 ได้ ถ้าลูกค้าตั้ง "กิจการของบาร์" เป็นกิจการอื่น (ดูข้อ 2 คู่กัน)
--   · ตารางไหนไม่เป็น 0 → ส่งผลให้ Claude ดู (อย่าเพิ่งเริ่มเฟส 1)
with t as (
  select c.table_name
  from information_schema.columns c
  join information_schema.tables tb
    on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
  where c.table_schema = 'public'
    and c.column_name = 'entity_id'
    and c.table_name ~ '^(log_|bar_|sale_|sales_|warehouse_stock|stock_|materials$|containers$|products$|employees$|payroll_|pay_|excise_)'
    and exists (select 1 from information_schema.columns c2
                where c2.table_schema = 'public' and c2.table_name = c.table_name and c2.column_name = 'tenant_id')
)
select
  t.table_name as "ตาราง",
  (xpath('/row/n/text()', query_to_xml(format(
     'select count(*) as n from public.%I', t.table_name), false, true, '')))[1]::text::bigint
    as "แถวทั้งหมด",
  (xpath('/row/n/text()', query_to_xml(format(
     'select count(*) as n from public.%I x
        left join public.entities e on e.tenant_id = x.tenant_id and e.is_default
      where e.entity_id is null or x.entity_id is distinct from e.entity_id', t.table_name), false, true, '')))[1]::text::bigint
    as "แถวนอกกิจการหลัก"
from t
order by 3 desc, 1;


-- ── ข้อ 2: ค่าตั้ง "กิจการของโมดูล" 4 ตัวที่จะยุบ (Q9) ชี้กิจการอื่นไหม ──────────
-- ควรเห็น: ไม่มีแถวเลย หรือทุกแถว "ตรงกิจการหลัก ✓"
--   · มีแถว "⚠️ ไม่ใช่กิจการหลัก" → ส่งผลให้ Claude ดู (ข้อมูลโมดูลนั้นอาจต้องย้ายก่อนยุบ)
select
  t.slug     as "ลูกค้า",
  s.kind     as "ค่าตั้ง",
  s.value    as "ตั้งเป็นกิจการ",
  e.entity_id as "กิจการหลัก",
  case when s.value = e.entity_id then 'ตรงกิจการหลัก ✓' else '⚠️ ไม่ใช่กิจการหลัก' end as "ผล"
from app_settings s
join tenants t on t.id = s.tenant_id
left join entities e on e.tenant_id = s.tenant_id and e.is_default
where s.kind in ('sales_doc_entity', 'sales_revenue_entity', 'bar_entity', 'payroll_entity')
  and nullif(trim(s.value), '') is not null
order by (s.value is distinct from e.entity_id) desc, 1, 2;


-- ── ข้อ 3: ลูกค้าที่มี ≥ 2 กิจการ ตั้งรูปแบบเลขเอกสารขายไว้อย่างไร (Q4) ──────────
-- ควรเห็น: ไม่มีแถว "⚠️ ตัวนำหน้าซ้ำกิจการอื่น"
--   · "ยังไม่ได้ตั้ง" = ใช้รูปแบบปริยายของระบบ — ไม่ผิด แค่จดไว้ (เฟส 3 จะบังคับให้ตั้งก่อนกิจการที่ 2 ออกเลขขาย)
with multi as (
  select tenant_id, count(*) as n
  from entities
  group by tenant_id
  having count(*) >= 2
)
select
  t.slug      as "ลูกค้า",
  m.n         as "จำนวนกิจการ",
  d.entity_id as "กิจการ",
  d.doc_type  as "ชนิดเอกสาร",
  d.prefix    as "ตัวนำหน้า",
  case
    when d.doc_type is null then 'ยังไม่ได้ตั้งรูปแบบเลขขาย (ใช้ค่าปริยาย)'
    when count(*) over (partition by d.tenant_id, d.doc_type, d.prefix) > 1 then '⚠️ ตัวนำหน้าซ้ำกิจการอื่น'
    else 'ไม่ซ้ำ ✓'
  end as "ผล"
from multi m
join tenants t on t.id = m.tenant_id
left join doc_numbering d on d.tenant_id = m.tenant_id and d.doc_type like 'sales\_%'
order by 1, 4, 3;
