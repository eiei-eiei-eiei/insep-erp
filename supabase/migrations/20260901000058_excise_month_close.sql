-- ============================================================================
-- 0058 ปิดเดือนสรรพสามิต — แยก "เช็กลิสต์" ออกจาก "ตัวล็อก" (D91)
--
-- 🔴 ต้นเรื่อง: D90 ถามผิดตาราง
--    D90 ตัดสินว่าจะซ่อนคู่ จ่าย/รับ ของออเดอร์ที่ยกเลิกไหม โดยดูว่า
--    "เดือนนั้นเคยมีแถวใน report_runs หรือยัง" — แต่ `report_runs` คือ **เช็กลิสต์**
--    (ดู comment ที่ 0005: 'เดือนนี้สร้างครบยัง' · append-only · index created_at desc)
--    ไม่ใช่บันทึกว่า "ยื่นแล้ว"
--
--    ของจริง: บัญชีประจำวัน (๐๗-๐๑/๑ · ๐๗-๐๒/๑(๑) · ๐๗-๐๒/๑(๒)) ต้องพิมพ์เก็บไว้ให้
--    เจ้าหน้าที่สรรพสามิตตรวจได้ตลอด → report_runs มีแถวแทบทุกวัน →
--    **การยกเลิกบิลถูกล็อกตลอดกาล** ทั้งที่งบเดือน (๐๗-๐๔) ซึ่งเป็นใบที่ *ยื่น* จริง
--    ยังไม่ได้ส่งด้วยซ้ำ (ยื่นได้ถึงวันที่ 15 ของเดือนถัดไป)
--
-- 🪤 บทเรียน: **ตารางเดียวทำสองหน้าที่** (ตระกูล D84 ชื่อโมดูล · D63 ดร็อปดาวน์กิจการ)
--    การกด "พิมพ์" กับการ "ยื่น" เป็นคนละเหตุการณ์ — เอาอย่างหนึ่งไปแทนอีกอย่างไม่ได้
--
-- ★ ของใหม่: ผู้ใช้ **ประกาศเองว่าปิดเดือน** แล้วถอนได้ถ้ายังไม่ได้ยื่นจริง
--    · กดพิมพ์กี่ครั้งก็ได้ ไม่ล็อกอะไรอีกต่อไป
--    · ถอนปิดเดือน = คำนวณการซ่อนใหม่ตามจริงให้ทันที (ปุ่มคืนค่าที่ผู้ใช้ขอ)
--
-- 🚨 **ห้ามแตะ `report_runs`** — D88 ใช้เป็นเงื่อนไข "ต้องสร้างแบบก่อนถึงจะจ่ายภาษีได้"
--    (lib/accounting/taxPay.ts · taxReminder.ts · /api/cron/tax-reminder) คนละโดเมน
--
-- 🚨 **ไม่ backfill อะไรทั้งสิ้น** — ไม่มีบันทึกว่าเดือนไหนยื่นจริง การไล่ปิด/ซ่อนย้อนหลัง
--    ให้เอง = แก้ฟอร์มที่อาจยื่นไปแล้ว → ให้ผู้ใช้กดเป็นรายเดือนโดยเห็นผลกระทบก่อน
-- ============================================================================

create table if not exists excise_month_close (
  id          bigserial primary key,
  tenant_id   uuid not null default my_tenant(),
  entity_id   text not null,
  month       text not null,                    -- 'yyyy-MM'
  closed_at   timestamptz not null default now(),
  closed_by   uuid,
  note        text,
  -- ★ ถอนปิด = เติม 2 ช่องนี้ **ไม่ลบแถว** → เห็นประวัติว่าปิด/ถอนกี่รอบ ใครทำ
  reopened_at timestamptz,
  reopened_by uuid,
  reopen_note text,
  -- ลายนิ้วมือ *ข้อมูลขาเข้าฟอร์ม* ณ ตอนปิด (ไม่ใช่สำเนาแบบที่ยื่น — ดู fn_excise_month_totals)
  totals      jsonb
);

-- FK ไป tenants — ★ **ไม่ใส่ on delete cascade** ให้เหมือนตารางอื่นทั้งระบบ
-- 🪤 ใส่ cascade = ตกตารางใน fn_mig_truncate แล้วเงียบ (D79/D82 ถูกจับได้ด้วยกลไกนี้)
alter table excise_month_close drop constraint if exists excise_month_close_tenant_fk;
alter table excise_month_close add constraint excise_month_close_tenant_fk
  foreign key (tenant_id) references tenants(id);

alter table excise_month_close drop constraint if exists excise_month_close_entity_id_fkey;
alter table excise_month_close add constraint excise_month_close_entity_id_fkey
  foreign key (tenant_id, entity_id) references entities(tenant_id, entity_id);

-- 🚨 หัวใจของการกันปิดซ้อน: 1 กิจการ + 1 เดือน มีการปิดที่ยังไม่ถูกถอนได้ครั้งเดียว
--    (แถวที่ถอนแล้วเหลือเป็นประวัติ และไม่กันการปิดรอบใหม่ — แพตเทิร์นเดียวกับ tax_payments 0054)
create unique index if not exists excise_close_one_active
  on excise_month_close (tenant_id, entity_id, month) where reopened_at is null;
create index if not exists excise_close_lookup
  on excise_month_close (tenant_id, entity_id, month, reopened_at);

alter table excise_month_close enable row level security;

-- อ่าน: prod.read + ขอบเขตกิจการของผู้ใช้
-- 🪤 **ไม่มี policy สำหรับเขียนโดยตั้งใจ** — เขียนผ่าน RPC (definer) เท่านั้น
--    เหตุผล: `for all` ครอบ SELECT ด้วย และ policy permissive ถูก OR กัน (บทเรียน D85/0052)
-- ★ ต่างจาก `report_runs` ที่ 0055 ต้องเปิดให้ acct.read ด้วย เพราะตารางนั้นเก็บ 2 โดเมนปนกัน
--   ตารางนี้เป็นเรื่องฟอร์ม ภส. โดเมนเดียว → prod เท่านั้นถูกแล้ว **อย่าก๊อป 0055 มาโดยไม่ดูบริบท**
create policy excise_close_sel on excise_month_close for select
  using (tenant_id = my_tenant() and has_cap('prod.read')
         and (my_entities() is null or entity_id = any(my_entities())));

comment on table excise_month_close is
  'ปิดบัญชีสรรพสามิตรายเดือนต่อกิจการ (D91) — ตัวล็อกจริงของฟอร์ม ภส. '
  '🚨 อย่าเอา report_runs กลับมาทำหน้าที่นี้อีก (นั่นคือเช็กลิสต์ ไม่ใช่ตัวล็อก) · '
  'เขียนผ่าน fn_excise_close_month / fn_excise_reopen_month เท่านั้น';
comment on column excise_month_close.totals is
  'ผลรวมข้อมูลที่ฟอร์มเดือนนั้นใช้ ณ ตอนปิด — ไว้ตรวจว่าหลังปิดแล้วข้อมูลขยับไหม '
  '🚨 ไม่ใช่สำเนาแบบที่ยื่น';

-- ── คำถามกลาง: คู่ จ่าย/รับ ของ ref นี้ ซ่อนได้ไหม ────────────────────────────
--
-- 🚨 **คำถามนี้ต้องอยู่ที่เดียว** — ทั้ง fn_cancel_order และ fn_excise_recompute_hidden
--    เรียกตัวนี้ · กฎเดียวกันเขียนสองที่แล้วหลุดจากกัน = ไม่มี error ทั้งคู่ (D79/D85)
--
-- 🚨 **คู่ จ่าย/รับ ข้ามเดือนได้** (ขาย ก.ย. ยกเลิก ต.ค.) → ต้องเปิดครบ *ทุกเดือน* ที่แถวแตะ
--    ซ่อนข้างเดียว = ยอดคงเหลือบนฟอร์มเพี้ยน ซึ่ง **แย่กว่าไม่ซ่อนเลย**
-- ★ ไล่เดือนจากแถวจริง ไม่ใช่จาก current_date (D90 ใช้ current_date ซึ่งตรงตอนยกเลิก
--   แต่ผิดตอนคำนวณใหม่ทีหลัง)
create or replace function fn_excise_months_open(p_tenant uuid, p_entity text, p_ref text)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select not exists (
    select 1
    from (
      select distinct to_char(lp.doc_date, 'YYYY-MM') as m
      from log_product lp
      where lp.tenant_id = p_tenant and lp.ref_no = p_ref
    ) t
    join excise_month_close c
      on c.tenant_id = p_tenant and c.entity_id = p_entity
     and c.month = t.m and c.reopened_at is null
  );
$fn$;

-- ── ลายนิ้วมือข้อมูลของเดือน ─────────────────────────────────────────────────
--
-- ★ เก็บ *ผลรวมขาเข้าฟอร์ม* ไม่ใช่ตัวฟอร์ม — เรนเดอร์ครบทุกใบตอนปิดเดือนต้องเรียกหลายสิบครั้ง
--   ส่วนผลรวมขาเข้าจับได้ทุกความเปลี่ยนแปลงที่จะทำให้ฟอร์มขยับ ด้วย query เดียว
-- 🪤 ปลายช่วงเป็น **วันที่ 1 ของเดือนถัดไป + `<`** ห้ามต่อ '-31' (บั๊ก 2026-11-31 ของ D88)
create or replace function fn_excise_month_totals(p_entity text, p_month text)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_tenant uuid := my_tenant();
  v_from date; v_to date;
begin
  if not has_cap('prod.read') then raise exception 'ไม่มีสิทธิ์อ่านข้อมูลฝ่ายผลิต'; end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if p_month !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'รูปแบบเดือนต้องเป็น yyyy-MM'; end if;

  v_from := to_date(p_month || '-01', 'YYYY-MM-DD');
  v_to   := (v_from + interval '1 month')::date;

  return jsonb_build_object(
    'product', (
      select coalesce(jsonb_object_agg(product_id, jsonb_build_object('in', i, 'out', o)), '{}'::jsonb)
      from (
        select product_id,
               sum(case when trans_type = 'รับ' then amount else 0 end) as i,
               sum(case when trans_type <> 'รับ' then amount else 0 end) as o
        from log_product
        where tenant_id = v_tenant and entity_id = p_entity and not excise_hidden
          and doc_date >= v_from and doc_date < v_to
        group by product_id
      ) x
    ),
    'material', (
      select coalesce(jsonb_object_agg(material_id, jsonb_build_object('in', i, 'out', o)), '{}'::jsonb)
      from (
        select material_id,
               sum(case when trans_type = 'รับ' then amount else 0 end) as i,
               sum(case when trans_type <> 'รับ' then amount else 0 end) as o
        from log_material
        where tenant_id = v_tenant and entity_id = p_entity
          and doc_date >= v_from and doc_date < v_to
        group by material_id
      ) x
    ),
    'distill', (
      select coalesce(jsonb_object_agg(product_name, jsonb_build_object('n', n, 'vol', vol)), '{}'::jsonb)
      from (
        select product_name, count(*) as n, sum(coalesce(vol, 0)) as vol
        from log_distill
        where tenant_id = v_tenant and entity_id = p_entity
          and distill_date >= v_from and distill_date < v_to
        group by product_name
      ) x
    ),
    'draw', (
      select coalesce(jsonb_object_agg(product_name, jsonb_build_object('n', n, 'vol', vol)), '{}'::jsonb)
      from (
        select product_name, count(*) as n, sum(coalesce(final_vol, vol, 0)) as vol
        from log_ferment_draw
        where tenant_id = v_tenant and entity_id = p_entity
          and draw_date >= v_from and draw_date < v_to
        group by product_name
      ) x
    )
  );
end $fn$;

-- ── คำนวณการซ่อนใหม่ตามจริง ──────────────────────────────────────────────────
--
-- ★ เซ็ต excise_hidden := fn_excise_months_open(...) — **ทั้ง true และ false**
--   ไม่ใช่ set true อย่างเดียว (เดือนที่ปิดใหม่ต้องดันแถวกลับมาแสดงได้ด้วย)
-- 🚨 **ห้ามเรียกตอนปิดเดือน** — คู่ที่ซ่อนไว้ตอนเดือนยังเปิดต้องซ่อนต่อ
--    (ของไม่เคยออกจากโรงจริง ฟอร์มที่ยื่นต้องไม่มีมัน) · เรียกตอนถอนปิด + ตอนผู้ใช้กดเองเท่านั้น
-- ★ p_dry = true → ไม่เขียนอะไร แค่บอกว่าจะกระทบกี่คู่ (ใช้โชว์ก่อนกด · ขอแค่ prod.read)
create or replace function fn_excise_recompute_hidden(p_entity text, p_month text, p_dry boolean)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := my_tenant();
  r record; v_want boolean; v_changed int := 0; v_n int;
begin
  if p_dry then
    if not has_cap('prod.read') then raise exception 'ไม่มีสิทธิ์อ่านข้อมูลฝ่ายผลิต'; end if;
  else
    if not has_cap('prod.config') then raise exception 'ไม่มีสิทธิ์แก้การซ่อนแถวบนฟอร์ม ภส.'; end if;
  end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if p_month !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'รูปแบบเดือนต้องเป็น yyyy-MM'; end if;

  for r in
    select distinct lp.ref_no as ref
    from log_product lp
    join sales_orders so
      on so.tenant_id = lp.tenant_id
     and coalesce(so.order_no, so.qu_no) = lp.ref_no
    where lp.tenant_id = v_tenant and lp.entity_id = p_entity
      and lp.ref_no is not null
      and to_char(lp.doc_date, 'YYYY-MM') = p_month
      and so.status = 'ยกเลิก'
  loop
    v_want := fn_excise_months_open(v_tenant, p_entity, r.ref);
    if p_dry then
      select count(*) into v_n from log_product
        where tenant_id = v_tenant and ref_no = r.ref and excise_hidden is distinct from v_want;
    else
      update log_product set excise_hidden = v_want
        where tenant_id = v_tenant and ref_no = r.ref and excise_hidden is distinct from v_want;
      get diagnostics v_n = row_count;
    end if;
    if v_n > 0 then v_changed := v_changed + 1; end if;
  end loop;

  return jsonb_build_object('ok', true, 'changed', v_changed, 'dry', p_dry);
end $fn$;

-- ── ปิดเดือน ─────────────────────────────────────────────────────────────────
--
-- 🚨 definer = bypass RLS → ต้องเช็ค cap **และ** ขอบเขตกิจการเอง (บทเรียน 0028→0029)
create or replace function fn_excise_close_month(p_entity text, p_month text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := my_tenant();
  v_id bigint;
begin
  if not has_cap('prod.config') then raise exception 'ไม่มีสิทธิ์ปิดเดือนสรรพสามิต'; end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if p_month !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'รูปแบบเดือนต้องเป็น yyyy-MM'; end if;
  if not exists (select 1 from entities where tenant_id = v_tenant and entity_id = p_entity) then
    raise exception 'ไม่พบกิจการ %', p_entity;
  end if;
  if my_entities() is not null and not (p_entity = any(my_entities())) then
    raise exception 'ไม่มีสิทธิ์ในกิจการ %', p_entity;
  end if;

  begin
    insert into excise_month_close(tenant_id, entity_id, month, closed_by, note, totals)
    values (v_tenant, p_entity, p_month, auth.uid(), nullif(p_note, ''),
            fn_excise_month_totals(p_entity, p_month))
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'เดือน ' || p_month || ' ปิดไปแล้ว');
  end;

  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

-- ── ถอนปิดเดือน → คำนวณการซ่อนใหม่ทันที ──────────────────────────────────────
--
-- ★ นี่คือ "ปุ่มคืนค่า" ที่ผู้ใช้ขอ — ถอนแล้วต้องคำนวณให้เลย ไม่ใช่ให้ไปกดอีกปุ่ม
create or replace function fn_excise_reopen_month(p_entity text, p_month text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := my_tenant();
  v_n int; v_changed int;
begin
  if not has_cap('prod.config') then raise exception 'ไม่มีสิทธิ์ถอนปิดเดือนสรรพสามิต'; end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if my_entities() is not null and not (p_entity = any(my_entities())) then
    raise exception 'ไม่มีสิทธิ์ในกิจการ %', p_entity;
  end if;

  update excise_month_close
     set reopened_at = now(), reopened_by = auth.uid(), reopen_note = nullif(p_note, '')
   where tenant_id = v_tenant and entity_id = p_entity
     and month = p_month and reopened_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'เดือน ' || p_month || ' ยังไม่ได้ปิด');
  end if;

  v_changed := (fn_excise_recompute_hidden(p_entity, p_month, false) ->> 'changed')::int;
  return jsonb_build_object('ok', true, 'changed', v_changed);
end $fn$;

revoke execute on function fn_excise_months_open(uuid, text, text) from public;
revoke execute on function fn_excise_month_totals(text, text) from public;
grant  execute on function fn_excise_month_totals(text, text) to authenticated;
revoke execute on function fn_excise_recompute_hidden(text, text, boolean) from public;
grant  execute on function fn_excise_recompute_hidden(text, text, boolean) to authenticated;
revoke execute on function fn_excise_close_month(text, text, text) from public;
grant  execute on function fn_excise_close_month(text, text, text) to authenticated;
revoke execute on function fn_excise_reopen_month(text, text, text) from public;
grant  execute on function fn_excise_reopen_month(text, text, text) to authenticated;

-- ── fn_cancel_order — ยกมาจาก 0057 ทั้งดุ้นด้วยสคริปต์ เปลี่ยนเฉพาะบล็อกที่ทำเครื่องหมาย D91
--    signature ไม่เปลี่ยน → create or replace ทับได้ ไม่เกิด overload (กับดัก D69)

create or replace function fn_cancel_order(p_qu_no text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  -- D91 — ซ่อนคู่ จ่าย/รับ ออกจากฟอร์ม ภส. ได้ไหม (คำถามอยู่ที่ fn_excise_months_open ที่เดียว)
  v_hide boolean := false; v_locked text[];
  v_order sales_orders%rowtype;
  v_ref text; mv record; v_before numeric; v_after numeric;
  v_reversed int := 0;
  v_tenant uuid := my_tenant();
begin
  -- 🚨 ยกเลิก = void ใบกำกับภาษีที่ออกไปแล้ว + คืนสต็อก → **ระดับหัวหน้าเท่านั้น**
  --    ใช้ sales.config (มีแต่ sales_manager กับ main) จงใจไม่ใช่ sales.write
  if not has_cap('sales.config') then raise exception 'ไม่มีสิทธิ์ยกเลิกออเดอร์ (เฉพาะหัวหน้าฝ่ายขาย)'; end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;

  select * into v_order from sales_orders
    where qu_no = p_qu_no and tenant_id = v_tenant for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบออเดอร์ ' || p_qu_no); end if;
  v_ref := coalesce(v_order.order_no, p_qu_no);

  -- 1) void รายรับที่ลงบัญชีแล้ว (deposit + balance)
  update transactions set status = 'ยกเลิก'
    where tenant_id = v_tenant
      and idempotency_key in (v_ref, v_ref || '-balance') and status <> 'ยกเลิก';

  -- 2) คืน warehouse_stock ตาม stock_moves OUT ที่ยังไม่ถูกคืน
  for mv in
    select item_code, item_name, qty from stock_moves
    where tenant_id = v_tenant and entity_id = v_order.entity_id
      and ref_no = v_ref and action = 'OUT'
      and not exists (select 1 from stock_moves r
                      where r.tenant_id = stock_moves.tenant_id
                        and r.entity_id = stock_moves.entity_id
                        and r.ref_no = v_ref and r.action = 'IN'
                        and r.item_code = stock_moves.item_code)
  loop
    select qty into v_before from warehouse_stock
      where item_code = mv.item_code and tenant_id = v_tenant and entity_id = v_order.entity_id
      for update;
    if found then
      v_after := coalesce(v_before,0) + mv.qty;
      update warehouse_stock set qty = v_after
        where item_code = mv.item_code and tenant_id = v_tenant and entity_id = v_order.entity_id;
      insert into stock_moves(tenant_id, entity_id, item_code, item_name, qty_before, action, qty,
                              ref_no, qty_after, user_name, remarks)
      values (v_tenant, v_order.entity_id, mv.item_code, mv.item_name, coalesce(v_before,0),
              'IN', mv.qty, v_ref, v_after, 'system', 'คืนสต็อก: ยกเลิกออเดอร์');
      v_reversed := v_reversed + 1;
    end if;
  end loop;

  -- 3) คืนสต็อกผลิตสุรา ถ้าเคยตัด
  if exists (select 1 from integration_log
             where tenant_id = v_tenant and action='SELL_PRODUCT'
               and idempotency_key = v_ref and status='ok') then
    insert into log_product(tenant_id, entity_id, doc_date, trans_type, product_id, amount, note, ref_no)
    select v_tenant, v_order.entity_id, current_date, 'รับ',
           li->>'product_id', (li->>'amount')::numeric,
           'คืนสต็อก: ยกเลิกออเดอร์ ' || v_ref, v_ref
    from integration_log, jsonb_array_elements(payload) li
    where tenant_id = v_tenant and action='SELL_PRODUCT'
      and idempotency_key = v_ref and status='ok';

    /*
     * D91 — ยกเลิกแล้วต้องไม่ไปกวนฟอร์มสรรพสามิต **แต่ห้ามแก้ฟอร์มที่ยื่นไปแล้ว**
     *
     * ★ ตัดสิน ณ ตอนกดยกเลิก แล้วแช่ผลไว้ในคอลัมน์ — ห้ามไปตัดสินตอนเปิดดูฟอร์ม
     *   ไม่งั้นพอเดือนนั้นถูกปิดทีหลัง แถวจะโผล่กลับมาเอง = ฟอร์มเปลี่ยนย้อนหลังอีกแบบ
     * 🚨 **เลิกถาม report_runs แล้ว** (D90 ถามผิดตาราง — นั่นคือเช็กลิสต์ ไม่ใช่ตัวล็อก)
     *   คำถามที่ถูกคือ "เดือนนั้นถูกปิดบัญชีสรรพสามิตหรือยัง" ซึ่งผู้ใช้ประกาศเอง
     * ★ คำถามอยู่ที่ fn_excise_months_open() ที่เดียว — ใช้ร่วมกับ fn_excise_recompute_hidden
     * ★ ซ่อนเป็นคู่ที่หักล้างกันพอดีเสมอ → ยอดคงเหลือบนฟอร์มยังตรงกับสต็อกจริง
     */
    v_hide := fn_excise_months_open(v_tenant, v_order.entity_id, v_ref);

    if v_hide then
      update log_product set excise_hidden = true
        where tenant_id = v_tenant and ref_no = v_ref;
    else
      -- เดือนไหนบ้างที่ปิดไปแล้ว — ส่งกลับให้หน้าจอขายบอกผู้ใช้ว่าต้องทำอะไรต่อ
      select array_agg(distinct m order by m) into v_locked
        from (
          select to_char(lp.doc_date,'YYYY-MM') as m
          from log_product lp
          where lp.tenant_id = v_tenant and lp.ref_no = v_ref
        ) t
        where exists (
          select 1 from excise_month_close c
          where c.tenant_id = v_tenant and c.entity_id = v_order.entity_id
            and c.month = t.m and c.reopened_at is null
        );
    end if;

    update integration_log set status='duplicate', message='reversed by cancel'
      where tenant_id = v_tenant and action='SELL_PRODUCT'
        and idempotency_key = v_ref and status='ok';
  end if;

  update sales_orders set status = 'ยกเลิก', outstanding_balance = 0
    where qu_no = p_qu_no and tenant_id = v_tenant;

  return jsonb_build_object(
    'ok', true, 'reversed_stock', v_reversed,
    'excise_hidden', v_hide,
    'excise_locked_months', coalesce(to_jsonb(v_locked), '[]'::jsonb));
end $$;

-- ── fn_mig_truncate — ยกมาจาก 0054 ทั้งดุ้น เติม 'excise_month_close' ─────────
create or replace function fn_mig_truncate(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t text;
  -- เรียงตามลำดับ FK (ลูกก่อนแม่) เพราะ delete ไม่ cascade เองเหมือน truncate
  tables text[] := array[
    'transaction_items','transactions','tax_summaries','tax_payments','wht_certificates',
    'log_material','log_ferment','log_distill','log_distill_run',
    'log_ferment_monitor','log_dilute','log_ferment_draw','log_product','stock_product',
    'sales_order_items','sales_orders','warehouse_stock','stock_moves','sale_menu',
    -- เงินเดือน (0040 + 0042) — ต้องมาก่อน entities ไม่งั้นติด FK
    'payroll_items','payroll_periods','employees',
    'pay_components','pay_inputs','pay_rates','pay_variables','pay_post_legs',
    'contacts','bank_accounts',
    'materials','containers','products',
    -- ★ report_runs มี entity_id FK → ต้องมาก่อน entities ด้วย (0050)
    'report_runs',
    -- ★ D91 — excise_month_close มี entity_id FK → ต้องมาก่อน entities ด้วย
    'excise_month_close',
    'entities',
    'app_settings','integration_log','edit_log','counters'
  ];
begin
  if p_tenant is null then
    raise exception 'fn_mig_truncate: ต้องระบุ tenant — ห้ามล้างข้ามลูกค้า';
  end if;
  foreach t in array tables loop
    execute format('delete from %I where tenant_id = $1', t) using p_tenant;
  end loop;
end $$;

notify pgrst, 'reload schema';
