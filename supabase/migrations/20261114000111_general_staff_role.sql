-- ============================================================================
-- 0111 — บทบาท "พนักงานทุกฝ่าย" (general_staff)  (D172)
--
-- ต้นเรื่อง: Claude connector (D141) ใช้แอคเค้าเดียวต่อการเชื่อม แต่จะขยายไปโมดูลขาย/ผลิต/อื่น ๆ
--   ไม่มีบทบาทไหนได้หลายโดเมนนอกจาก main (ซึ่งได้ตั้งค่ากลาง + จัดการผู้ใช้ด้วย = กว้างเกิน)
-- ★ ระดับพนักงาน: read + write ของ ผลิต/บัญชี/ขาย/เงินเดือน/บาร์ · ไม่มี *.config · ไม่มี admin
--   ⇒ ตั้งค่าไม่ได้ · ยกเลิกออเดอร์/ใบลดหนี้ไม่ได้ · ปิดเดือนสรรพสามิตไม่ได้ · แดชบอร์ดต้นทุนบาร์ไม่ได้
-- 🚨 **เห็นเงินเดือน + เลขบัตรประชาชนของพนักงานทุกคน** — ผู้ใช้ตัดสินหลังรับทราบ (2026-11-14)
--    ROLE_HINT บนหน้าผู้ใช้บอกเรื่องนี้ตรง ๆ
--
-- 🚨 **ตารางสิทธิ์มี 2 ฝั่งที่ต้องตรงกันเสมอ** — `ROLE_CAPS` ใน lib/shared/roles.ts
--    กับ `has_cap()` ข้างล่าง · `lib/shared/rolesSql.test.ts` อ่านไฟล์นี้มาเทียบ
-- 🪤 `create or replace` = แทนที่ทั้งตัว ⇒ ยก has_cap() จาก 0109 มาทั้งดุ้น (ด้วยสคริปต์) เติมบรรทัดเดียว
-- ★ ไม่มี policy/RPC ไหนต้องแก้ — ทุกจุดถาม has_cap() อยู่แล้ว (D85)
-- ============================================================================

-- ── 1. CHECK constraint ของ profiles.role ───────────────────────────────────
--    🪤 ลำดับ drop → update → add ห้ามสลับ (ยกมาจาก 0051/0063/0109 · rolesSql.test.ts ล็อกไว้)
alter table profiles drop constraint if exists profiles_role_check;

update profiles set role = 'sales' where role in ('sale', 'warehouse');

alter table profiles add constraint profiles_role_check
  check (role in ('main','viewer','sales_manager','sales',
                  'finance_manager','accounting_manager','accounting',
                  'payroll_manager','payroll',
                  -- D96
                  'bar',
                  -- D163
                  'bar_manager',
                  -- D172
                  'general_staff'));

-- ── 2. has_cap() — ยกจาก 20261108000109_bar_manager_edit_sale.sql ทั้งดุ้น + general_staff ──
create or replace function has_cap(cap text) returns boolean
language sql stable security definer set search_path = public as $$
  select case (select role from profiles where id = auth.uid())
    when 'main'               then true
    when 'viewer'             then cap in ('prod.read','acct.read','sales.read','bar.read')
    when 'sales_manager'      then cap in ('sales.read','sales.write','sales.config')
    when 'sales'              then cap in ('sales.read','sales.write')
    when 'finance_manager'    then cap in ('acct.read','acct.write','acct.config',
                                           'pay.read','pay.write','pay.config')
    when 'accounting_manager' then cap in ('acct.read','acct.write','acct.config')
    when 'accounting'         then cap in ('acct.read','acct.write')
    when 'payroll_manager'    then cap in ('pay.read','pay.write','pay.config')
    when 'payroll'            then cap in ('pay.read','pay.write')
    -- 🚨 พนักงานบาร์ **ไม่มี bar.config โดยตั้งใจ** — config คือประตูของแดชบอร์ด
    --    ต้นทุน/กำไร · ยกเลิกทั้งบิล · ลงบัญชี · แก้บิล
    when 'bar'                then cap in ('bar.read','bar.write')
    -- D163 — หัวหน้าบาร์: ทุกอย่างของบาร์ ไม่มีอะไรนอกบาร์
    when 'bar_manager'        then cap in ('bar.read','bar.write','bar.config')
    -- D172 — พนักงานทุกฝ่าย: read+write ทุกโดเมน (รวมเงินเดือน — ผู้ใช้ตัดสิน) · ไม่มี *.config · ไม่มี admin
    when 'general_staff'      then cap in ('prod.read','prod.write','acct.read','acct.write',
                                           'sales.read','sales.write','pay.read','pay.write',
                                           'bar.read','bar.write')
    -- ★ ค่าเก่าก่อน 0051 — กันไว้เผื่อแถวที่โค้ดเก่าสร้างระหว่าง deploy
    when 'sale'               then cap in ('sales.read','sales.write')
    when 'warehouse'          then cap in ('sales.read','sales.write')
    -- ยังไม่ล็อกอิน / role ที่ไม่รู้จัก = ไม่มีสิทธิ์อะไรเลย (fail closed)
    else false
  end;
$$;

comment on function has_cap(text) is
  'ผู้ใช้ปัจจุบันมีความสามารถนี้ไหม — ฝาแฝดของ ROLE_CAPS ใน lib/shared/roles.ts '
  'แก้ที่เดียวไม่พอ ต้องแก้ทั้งสองที่เสมอ';
