-- ============================================================================
-- 0109 — บทบาท "หัวหน้าบาร์" + แก้วันขาย/วิธีรับเงินของบิลที่ปิดแล้ว  (D163)
--
-- ต้นเรื่อง (ผู้ใช้): รับโอนจากลูกค้าไปแล้วแต่ลืมกดรับเงิน มากดเช้าวันถัดไป
--   ⇒ บิลได้ business_date ของวันถัดไป ยอดไปอยู่ผิดวัน และไม่มีทางแก้จากหน้าจอ
--   (คอมเมนต์ใน 0064 เขียนไว้ว่า "แก้รายบิลได้ (bar.config)" แต่ไม่เคยมี RPC — ตระกูล D74/D77)
--
-- ── 1. บทบาท bar_manager ────────────────────────────────────────────────────
-- 🚨 **ตารางสิทธิ์มี 2 ฝั่งที่ต้องตรงกันเสมอ** — `ROLE_CAPS` ใน lib/shared/roles.ts
--    กับ `has_cap()` ข้างล่าง · `lib/shared/rolesSql.test.ts` อ่านไฟล์นี้มาเทียบ
-- 🪤 `create or replace` = แทนที่ทั้งตัว ⇒ ยก has_cap() จาก 0063 มาทั้งดุ้น เติมบรรทัดเดียว
--    ตกบทบาทไหนไป = คนนั้นสิทธิ์หายทันทีทั้งระบบ
-- ★ หัวหน้าบาร์ได้ bar.config เต็ม (แดชบอร์ดต้นทุน/กำไร · ยกเลิกทั้งบิล · ลงบัญชีรายวัน
--   · ตั้งค่าบาร์ · แก้บิล) แต่ **ไม่ได้อะไรนอกบาร์เลย** (ไม่เห็นบัญชี/ขาย/ผลิต/เงินเดือน)
--
-- ── 2. fn_bar_edit_sale ─────────────────────────────────────────────────────
-- แก้ได้ 2 อย่างเท่านั้น: **วันขาย** กับ **วิธีรับเงิน** (ผู้ใช้ตกลงว่าไม่ต้องแก้รายการ —
-- กดรับเงินแล้วลูกค้าจ่ายราคานั้นไปแล้ว · แก้รายการ = คืน/ตัดสต็อกใหม่ + ใบเสร็จที่ออกแล้ว)
-- 🚨 วันเดิมหรือวันใหม่ที่ **ลงบัญชีแล้ว** → บล็อก (ย้ายออกจากวันที่ลงแล้ว = บัญชีมียอด
--    แต่บิลหาย · ย้ายเข้า = บิลไม่มีวันเข้าบัญชี — บั๊กเดียวกับที่ 0083 อุดตอนปิดบิล)
-- 🚨 วิธีรับเงินเปลี่ยนบัญชีที่ลง (เงินสด ↔ โอน/QR · D116) ⇒ ด่านลงบัญชีเดียวกัน
-- ★ ไม่แตะ closed_at — ใบเสร็จยังพิมพ์เวลาที่กดรับเงินจริง
-- ★ ค่าเดิมเก็บใน edit_log เอง (trigger audit_bar_sale มีตั้งแต่ 0064)
-- ============================================================================

-- ── 1a. CHECK constraint ของ profiles.role ──────────────────────────────────
--    🪤 ลำดับ drop → update → add ห้ามสลับ (ยกมาจาก 0051/0063 · rolesSql.test.ts ล็อกไว้)
alter table profiles drop constraint if exists profiles_role_check;

update profiles set role = 'sales' where role in ('sale', 'warehouse');

alter table profiles add constraint profiles_role_check
  check (role in ('main','viewer','sales_manager','sales',
                  'finance_manager','accounting_manager','accounting',
                  'payroll_manager','payroll',
                  -- D96
                  'bar',
                  -- D163
                  'bar_manager'));

-- ── 1b. has_cap() — ยกจาก 20260910000063_bar_role_cap.sql ทั้งดุ้น + bar_manager ──
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

-- ── 2. แก้วันขาย / วิธีรับเงิน ของบิลที่ปิดแล้ว ─────────────────────────────
create or replace function fn_bar_edit_sale(
  p_entity text, p_sale_no text, p_business_date date, p_method text
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.config');
  v_sale bar_sale%rowtype;
  v_method text := nullif(trim(coalesce(p_method, '')), '');
  -- 🪤 เวลาไทย ไม่ใช่ current_date (server เป็น UTC — บทเรียน D100 เฟส 0)
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_n int;
begin
  select * into v_sale from bar_sale
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no for update;
  if not found then raise exception 'ไม่พบบิล %', p_sale_no; end if;
  if v_sale.status <> 'ปกติ' then
    raise exception 'แก้ได้เฉพาะบิลที่รับเงินแล้ว (บิล % สถานะ %)', p_sale_no, v_sale.status;
  end if;
  if p_business_date is null then raise exception 'ต้องระบุวันขาย'; end if;
  if p_business_date > v_today then raise exception 'วันขายเป็นวันในอนาคตไม่ได้'; end if;
  if v_method is null then raise exception 'ต้องเลือกวิธีรับเงิน'; end if;
  -- ★ ป้ายเก่า (QR/โอนเงิน/บัตรเครดิต) คงไว้ได้ถ้าไม่ได้เปลี่ยน · เปลี่ยนใหม่ต้องเป็น 2 ค่าปัจจุบัน
  if v_method is distinct from v_sale.method and v_method not in ('เงินสด', 'โอน/QR') then
    raise exception 'วิธีรับเงินต้องเป็น เงินสด หรือ โอน/QR';
  end if;

  if p_business_date = v_sale.business_date and v_method is not distinct from v_sale.method then
    return jsonb_build_object('ok', true, 'sale_no', p_sale_no, 'changed', false);
  end if;

  if exists (select 1 from bar_post
              where tenant_id = v_tenant and entity_id = p_entity
                and post_date = v_sale.business_date and status = 'ปกติ') then
    raise exception 'ยอดวันที่ % ลงบัญชีไปแล้ว — ต้องถอนการลงบัญชีวันนั้นก่อน (แท็บแดชบอร์ด) แล้วค่อยแก้บิล',
      to_char(v_sale.business_date, 'DD/MM/YYYY');
  end if;
  if p_business_date <> v_sale.business_date and exists (
    select 1 from bar_post
     where tenant_id = v_tenant and entity_id = p_entity
       and post_date = p_business_date and status = 'ปกติ') then
    raise exception 'ยอดวันที่ % ลงบัญชีไปแล้ว — ย้ายบิลเข้าวันนั้นไม่ได้ ต้องถอนการลงบัญชีวันนั้นก่อน (แท็บแดชบอร์ด)',
      to_char(p_business_date, 'DD/MM/YYYY');
  end if;

  update bar_sale set business_date = p_business_date, method = v_method
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no;
  get diagnostics v_n = row_count;
  -- 🚨 row_count = 0 ต้องตอบ error ไทย ไม่ใช่ ok (บทเรียน D93)
  if v_n = 0 then raise exception 'แก้บิล % ไม่สำเร็จ — รีเฟรชหน้าแล้วลองใหม่', p_sale_no; end if;

  -- สถิติลูกค้า: วันแรก/วันล่าสุดที่มา คิดใหม่จากบิลจริง (ย้ายวันแล้วค่าเดิมอาจผิด)
  if v_sale.customer_id is not null and p_business_date <> v_sale.business_date then
    update bar_customer c set
      first_seen = s.first_d, last_seen = s.last_d
      from (select min(business_date) first_d, max(business_date) last_d
              from bar_sale
             where tenant_id = v_tenant and entity_id = p_entity
               and customer_id = v_sale.customer_id and status = 'ปกติ') s
     where c.tenant_id = v_tenant and c.entity_id = p_entity
       and c.customer_id = v_sale.customer_id;
  end if;

  return jsonb_build_object('ok', true, 'sale_no', p_sale_no, 'changed', true,
                            'from_date', v_sale.business_date, 'to_date', p_business_date);
end $fn$;

comment on function fn_bar_edit_sale(text, text, date, text) is
  'D163 — แก้วันขาย/วิธีรับเงินของบิลบาร์ที่ปิดแล้ว (bar.config) · บล็อกวันที่ลงบัญชีแล้ว';

notify pgrst, 'reload schema';
