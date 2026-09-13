-- ============================================================================
-- 0063 — บทบาท `bar` + ความสามารถ `bar.read` / `bar.write` / `bar.config`  (D96)
--
-- เฟสที่ 1 ของโมดูลบาร์/POS (`docs/BAR_POS_PLAN.md`) — **ยังไม่มีตารางของบาร์เลย**
-- ไฟล์นี้ทำแค่เปิดทางให้: ติ๊กขายโมดูลได้ · สร้างผู้ใช้บทบาท "พนักงานบาร์" ได้
-- ตาราง `bar_*` + RLS + RPC อยู่ใน migration ถัดไป
--
-- 🚨 **ตารางสิทธิ์มี 2 ฝั่งที่ต้องตรงกันเสมอ**
--    · `ROLE_CAPS` ใน `lib/shared/roles.ts` → คุมว่าหน้าจอโชว์อะไร
--    · `has_cap()` ในไฟล์นี้              → **ตัวจริงที่บังคับสิทธิ์** (RLS + RPC เรียกตัวนี้)
--    หลุดจากกันแล้ว **ไม่มี error ทั้งคู่** — `lib/shared/rolesSql.test.ts` อ่าน SQL นี้
--    เป็นข้อความมาเทียบ (ชั้นเดียวกับ `tenantTables.test.ts` ของ D79)
--
-- 🪤 `create or replace` = แทนที่ทั้งตัว ⇒ **ต้องยก `has_cap()` จาก 0051 มาทั้งดุ้น**
--    แล้วเติมบรรทัดเดียว · ตกบทบาทไหนไป = คนนั้นสิทธิ์หายทันทีทั้งระบบ
-- ============================================================================

-- ── 1. CHECK constraint ของ profiles.role ────────────────────────────────────
--    🪤 ลำดับ drop → update → add ห้ามสลับ (ยกมาจาก 0051 พร้อมเหตุผล):
--       backfill ค่าเก่า sale/warehouse ต้องทำตอนที่ constraint ถูกถอดออกแล้ว
--       ไม่งั้น update ติด check ตัวเก่า · `rolesSql.test.ts` ล็อกลำดับนี้ไว้
alter table profiles drop constraint if exists profiles_role_check;

update profiles set role = 'sales' where role in ('sale', 'warehouse');

alter table profiles add constraint profiles_role_check
  check (role in ('main','viewer','sales_manager','sales',
                  'finance_manager','accounting_manager','accounting',
                  'payroll_manager','payroll',
                  -- D96
                  'bar'));

-- ── 2. has_cap() — ยกมาจาก 20260827000051_roles_caps.sql:36-56 ทั้งดุ้น ──────
--    เปลี่ยนจากของเดิม 2 จุดเท่านั้น:
--      · viewer  ได้ 'bar.read' เพิ่ม (คำอธิบายบทบาทคือ "ดูได้ทุกหน้า ยกเว้นเงินเดือน"
--                — ไม่ให้ = ประโยคนั้นกลายเป็นคำโกหก · และ viewer เห็นบัญชีทั้งหมดอยู่แล้ว
--                ★ แดชบอร์ดต้นทุน/กำไรอยู่หลัง bar.config จึงยังปิดอยู่)
--      · เพิ่มบทบาท 'bar' ใหม่
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
    --    ต้นทุน/กำไร · ยกเลิกทั้งบิล · ลงบัญชี ซึ่งเป็นเรื่องของเจ้าของ
    --    (ยึดเส้นเดียวกับ D85 ที่ให้ "ยกเลิกออเดอร์ = sales.config")
    when 'bar'                then cap in ('bar.read','bar.write')
    -- ★ ค่าเก่าก่อน 0051 — ไม่ควรเหลือแล้วหลัง backfill ข้างบน แต่กันไว้เผื่อ
    --   แถวที่ถูกสร้างโดย trigger ระหว่าง deploy ที่โค้ดเก่ายังวิ่งอยู่
    when 'sale'               then cap in ('sales.read','sales.write')
    when 'warehouse'          then cap in ('sales.read','sales.write')
    -- ยังไม่ล็อกอิน / role ที่ไม่รู้จัก = ไม่มีสิทธิ์อะไรเลย (fail closed)
    else false
  end;
$$;

comment on function has_cap(text) is
  'ผู้ใช้ปัจจุบันมีความสามารถนี้ไหม — ฝาแฝดของ ROLE_CAPS ใน lib/shared/roles.ts '
  'แก้ที่เดียวไม่พอ ต้องแก้ทั้งสองที่เสมอ';

notify pgrst, 'reload schema';
