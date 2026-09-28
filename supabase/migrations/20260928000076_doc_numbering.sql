-- ============================================================================
-- 0076 ตั้งรูปแบบเลขเอกสารเองได้ (D100 เฟส 1)
--
-- 🎯 ผู้ใช้กำหนดเองได้ต่อ "กิจการ × ชนิดเอกสาร": ตัวอักษรนำหน้า · ส่วนวันที่ · พ.ศ./ค.ศ.
--    · เริ่มนับใหม่ (ทุกวัน/เดือน/ปี/ไม่เริ่มใหม่) · จำนวนหลัก · ตัวคั่น · เลขรันอยู่หน้า/หลังวันที่
--    · "เลขถัดไป" (ลูกค้าที่ย้ายมาจากระบบอื่นแล้วใบกำกับรันถึง 0153 แล้ว)
--    เฟสนี้ครอบ: ใบเสนอราคา · ออเดอร์ · ใบแจ้งหนี้ · ใบกำกับภาษี · **ใบเสร็จผู้ไม่จด VAT (ชุดใหม่ RC)**
--                · บิลบาร์ · ใบเสร็จ/ใบกำกับอย่างย่อบาร์
--    เฟส 2 (ยังไม่ทำ): 50ทวิ · batch · ล็อตกลั่นซ้ำ
--
-- ── กติกาที่ทำให้ปลอดภัย ──────────────────────────────────────────────────────
-- 1. 🚨 **ตัวออกเลขตัวเดียว** `fn_next_doc_no` · การจัดรูปเลขอยู่ที่ `fn_doc_no_format` ที่เดียว
--    · บรรทัดตัวอย่างบนหน้าตั้งค่าเรียกตัวเดียวกันแบบไม่กินเลข (ไม่มีสำเนาฝั่ง TS —
--      พรีวิวที่ไม่ตรงกับเลขจริงแย่กว่าไม่มีพรีวิว · หลักเดียวกับพรีวิวบิลบาร์ D96)
-- 2. 🚨 **ข้ามเลขที่มีเอกสารใช้อยู่แล้วเสมอ** (`fn_doc_no_taken`) — ตัวกันเลขซ้ำตัวจริง
--    ครอบ 3 ทาง: เปลี่ยนรูปแบบแล้วชนของเก่า · restore แล้วตัวนับถอยหลัง (D82) · เลขที่พิมพ์เองดักหน้า
-- 3. ★ **ไม่ตั้งค่า = รูปแบบเดิมเป๊ะ และ key ตัวนับเดิมเป๊ะ** (`QU-260928` · `B-EID01-260928`)
--    ⇒ ลูกค้าเดิมเลขเดินต่อไม่สะดุด · ข้อยกเว้นเดียวคือใบเสร็จผู้ไม่จด VAT ที่ย้ายจากชุด INV
--    ไปชุด RC ใหม่ (ผู้ใช้ตัดสิน · ใบเก่าไม่ถูกแก้ · เลข INV เดิมยังถูกกันไม่ให้ออกซ้ำด้วยข้อ 2)
-- 4. 🚨 รูปแบบที่ทำให้เลขซ้ำได้ **บันทึกไม่ได้** — เริ่มนับใหม่ทุกวันแต่ในเลขไม่มีวัน =
--    เลขวันพรุ่งนี้ซ้ำวันนี้ (`fn_doc_cfg_error` ตัดสินที่เดียว)
-- 5. 🚨 "เลขถัดไป" ที่ชนเลขที่ออกไปแล้ว = **บล็อก** (ผู้ใช้ตัดสิน)
-- 6. ★ เปลี่ยนรูปแบบกลางรอบ = ตัวนับของรอบนี้ **เดินต่อจากเดิม** (ไม่รีเซ็ตกลับ 1 เงียบ ๆ
--    ไม่งั้นวันนั้นมีเลข 001 สองใบคนละรูปแบบ) · อยากเริ่มใหม่ = กรอกเลขถัดไปเอง
--
-- ── สิทธิ์ (D85/D99) ────────────────────────────────────────────────────────────
-- · ตั้งค่า = cap `admin` (หน้า /settings ทั้งหน้าเป็นของ admin อยู่แล้ว)
-- · ออกเลข = `sales.write` (เอกสารขาย) · `bar_guard(entity,'bar.write')` (บาร์)
-- · definer ทุกตัวมีด่าน my_tenant() ในตัว · helper ที่รับ p_tenant เป็น invoker และ
--   🚨 revoke จาก public, anon, authenticated (`revoke from public` อย่างเดียวไม่มีผลบน Supabase)
-- · ตารางไม่มี policy เขียน — เขียนผ่าน RPC เท่านั้น (บทเรียน D85/0052 `for all` ครอบ SELECT)
-- ============================================================================

-- ── 1) ตาราง ─────────────────────────────────────────────────────────────────
--    ★ ไม่มี CHECK บน doc_type โดยตั้งใจ (บทเรียน D80: whitelist ใน CHECK = ทุกชนิดใหม่ต้องมี
--      migration แก้ constraint) — ตรวจที่ fn_doc_default ซึ่งเป็นรายชื่อแหล่งเดียวฝั่ง SQL
create table if not exists doc_numbering (
  tenant_id  uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id  text not null,
  doc_type   text not null,
  prefix     text not null default '',
  date_fmt   text not null,
  era        text not null,
  reset      text not null,
  digits     int  not null,
  sep        text not null default '',
  num_first  boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (tenant_id, entity_id, doc_type),
  foreign key (tenant_id, entity_id) references entities (tenant_id, entity_id)
);

alter table doc_numbering enable row level security;

-- อ่านได้ทุกคนใน tenant (รูปแบบเลขไม่ใช่ความลับ) · 🪤 ไม่มี policy เขียนโดยตั้งใจ
drop policy if exists doc_numbering_sel on doc_numbering;
create policy doc_numbering_sel on doc_numbering for select
  using (tenant_id = my_tenant());

comment on table doc_numbering is
  'รูปแบบเลขเอกสารที่ผู้ใช้ตั้งเอง (D100) — ไม่มีแถว = ใช้รูปแบบเดิมของระบบ · เขียนผ่าน fn_doc_numbering_save เท่านั้น';

create trigger audit_doc_numbering after insert or update or delete on doc_numbering
  for each row execute function trg_audit('doc_type');

-- ── 2) รายชื่อชนิด + ค่าปริยาย — แหล่งเดียวฝั่ง SQL ───────────────────────────────
--    🚨 ต้องตรงกับ DOC_TYPES ใน lib/shared/docNumbering.ts (docNumberingSql.test.ts เทียบให้)
create or replace function fn_doc_types() returns text[]
language sql immutable set search_path = public as $$
  select array['sales_qu','sales_ord','sales_inv','sales_tax','sales_rcpt','bar_bill','bar_rcpt'];
$$;

-- ★ ค่าปริยาย = รูปแบบเดิมของระบบเป๊ะ `{prefix}{ปปดดวว ค.ศ.}-{NNN}` เริ่มใหม่ทุกวัน
create or replace function fn_doc_default(p_type text) returns jsonb
language sql immutable set search_path = public as $$
  select case when v.prefix is null then null else
    jsonb_build_object('prefix', v.prefix, 'date_fmt', 'YYMMDD', 'era', 'ce', 'reset', 'day',
                       'digits', 3, 'sep', '-', 'num_first', false)
  end
  from (select case p_type
    when 'sales_qu'   then 'QU'
    when 'sales_ord'  then 'ORD'
    when 'sales_inv'  then 'INV'
    when 'sales_tax'  then 'TAX'
    when 'sales_rcpt' then 'RC'   -- ★ ชุดใหม่ของใบเสร็จผู้ไม่จด VAT (เดิมยืมชุด INV · D89)
    when 'bar_bill'   then 'B'
    when 'bar_rcpt'   then 'BR'
  end as prefix) v;
$$;

-- ── 3) ตรวจรูปแบบ — คืนข้อความไทย หรือ null ─────────────────────────────────────
--    🚨 กฎ "เริ่มนับใหม่ต้องมีวันที่ละเอียดพอ" มีฝาแฝดฝั่ง TS = allowedResets()
--       (ใช้ปิดตัวเลือกบนจอ) · test:tenant เทียบทุกคู่ให้
create or replace function fn_doc_cfg_error(c jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare
  df text := c->>'date_fmt';
  rs text := c->>'reset';
begin
  if c is null or jsonb_typeof(c) <> 'object' then return 'ไม่มีรูปแบบเลข'; end if;
  if coalesce(c->>'prefix', '') !~ '^[A-Za-z0-9ก-๙._/-]{0,12}$' then
    return 'ตัวอักษรนำหน้าใช้ได้เฉพาะ ก-ฮ A-Z 0-9 และ . _ / - ไม่เกิน 12 ตัว (ห้ามเว้นวรรค)';
  end if;
  if df is null or df not in ('none','YY','YYYY','YYMM','YYYYMM','YYMMDD','YYYYMMDD') then
    return 'ส่วนวันที่ไม่ถูกต้อง';
  end if;
  if coalesce(c->>'era', '') not in ('ce','be') then return 'ต้องเลือกปี ค.ศ. หรือ พ.ศ.'; end if;
  if rs is null or rs not in ('never','year','month','day') then return 'ต้องเลือกว่าเริ่มนับใหม่เมื่อไร'; end if;
  -- ★ แยก 2 ชั้น — ไม่พึ่งลำดับการประเมิน OR ก่อน cast (ค่าที่ไม่ใช่ตัวเลขต้องไม่ถึง ::int)
  if coalesce(c->>'digits', '') !~ '^[0-9]{1,2}$' then
    return 'จำนวนหลักของเลขรันต้องอยู่ระหว่าง 1–10';
  end if;
  if (c->>'digits')::int not between 1 and 10 then
    return 'จำนวนหลักของเลขรันต้องอยู่ระหว่าง 1–10';
  end if;
  if coalesce(c->>'sep', '') not in ('', '-', '/', '.') then return 'ตัวคั่นไม่ถูกต้อง'; end if;
  if c ? 'num_first' and jsonb_typeof(c->'num_first') <> 'boolean' then return 'ตำแหน่งเลขรันไม่ถูกต้อง'; end if;
  -- 🚨 เลขซ้ำข้ามรอบ: นับใหม่แต่ส่วนวันที่ในเลขไม่ละเอียดพอจะแยกรอบออกจากกัน
  if rs = 'day' and df not in ('YYMMDD','YYYYMMDD') then
    return 'เริ่มนับใหม่ทุกวัน ต้องมี วัน-เดือน-ปี อยู่ในเลข — ไม่งั้นเลขของพรุ่งนี้จะซ้ำกับวันนี้';
  end if;
  if rs = 'month' and df not in ('YYMM','YYYYMM','YYMMDD','YYYYMMDD') then
    return 'เริ่มนับใหม่ทุกเดือน ต้องมี เดือน-ปี อยู่ในเลข — ไม่งั้นเลขของเดือนหน้าจะซ้ำกับเดือนนี้';
  end if;
  if rs = 'year' and df = 'none' then
    return 'เริ่มนับใหม่ทุกปี ต้องมี ปี อยู่ในเลข — ไม่งั้นเลขของปีหน้าจะซ้ำกับปีนี้';
  end if;
  return null;
end $$;

-- เก็บเฉพาะคีย์ที่รู้จัก (ผ่าน fn_doc_cfg_error มาแล้ว)
create or replace function fn_doc_cfg_clean(c jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'prefix', coalesce(c->>'prefix', ''), 'date_fmt', c->>'date_fmt', 'era', c->>'era',
    'reset', c->>'reset', 'digits', (c->>'digits')::int, 'sep', coalesce(c->>'sep', ''),
    'num_first', coalesce((c->>'num_first')::boolean, false));
$$;

-- ── 4) จัดรูปเลข — จุดเดียวของทั้งระบบ ─────────────────────────────────────────
--    🪤 ไม่ใช้ lpad ตรง ๆ กับเลขรัน — lpad('1000', 3) = '100' (ตัดทิ้ง!) ของเดิมจะออกเลขซ้ำ
--       เมื่อเกิน 999 ใบต่อวัน · ที่นี่ยาวเกิน = ปล่อยยาวตามจริง
create or replace function fn_doc_no_format(c jsonb, d date, n bigint) returns text
language plpgsql immutable set search_path = public as $$
declare
  y  int  := extract(year from d)::int + case when c->>'era' = 'be' then 543 else 0 end;
  yy text := lpad((y % 100)::text, 2, '0');
  mm text := to_char(d, 'MM');
  dd text := to_char(d, 'DD');
  dg int  := (c->>'digits')::int;
  dp text;
  np text;
  sp text;
begin
  dp := case c->>'date_fmt'
          when 'YY' then yy               when 'YYYY' then y::text
          when 'YYMM' then yy || mm       when 'YYYYMM' then y::text || mm
          when 'YYMMDD' then yy || mm || dd
          when 'YYYYMMDD' then y::text || mm || dd
          else '' end;
  np := case when length(n::text) >= dg then n::text else lpad(n::text, dg, '0') end;
  sp := case when dp = '' then '' else coalesce(c->>'sep', '') end;
  return coalesce(c->>'prefix', '') ||
         case when coalesce((c->>'num_first')::boolean, false) then np || sp || dp else dp || sp || np end;
end $$;

-- ── 5) key ของตัวนับ ─────────────────────────────────────────────────────────────
--    🚨 ไม่ได้ตั้งค่า = key รูปแบบเดิมเป๊ะ (ลูกค้าเดิมเลขเดินต่อ) — ขาย: ระดับ tenant ·
--       บาร์: แยกกิจการ (0065) · ตั้งค่าแล้ว = key ใหม่ แยกกิจการเสมอ
--    ★ ใส่ prefix ใน key: เปลี่ยนตัวนำหน้า = ชุดเลขใหม่ · เปลี่ยนจำนวนหลัก/ตัวคั่น = ชุดเดิมเดินต่อ
create or replace function fn_doc_key(p_type text, p_entity text, c jsonb, p_conf boolean, d date)
returns text language sql immutable set search_path = public as $$
  select case
    when not p_conf and left(p_type, 4) = 'bar_' then
      (c->>'prefix') || '-' || coalesce(p_entity, '') || '-' || to_char(d, 'YYMMDD')
    when not p_conf then
      (c->>'prefix') || '-' || to_char(d, 'YYMMDD')
    else
      'doc|' || p_type || '|' || coalesce(p_entity, '') || '|' || coalesce(c->>'prefix', '') || '|' ||
      case c->>'reset' when 'year' then to_char(d, 'YYYY') when 'month' then to_char(d, 'YYYY-MM')
                       when 'day' then to_char(d, 'YYYY-MM-DD') else '' end
  end;
$$;

-- ── 6) เลขนี้มีเอกสารใช้แล้วหรือยัง — ตัวกันเลขซ้ำตัวจริง ─────────────────────────────
--    ★ ฝั่งขายตรวจ **ทุกช่องเลข** ของออเดอร์ ไม่ใช่เฉพาะช่องของชนิดนั้น — ใบเสร็จผู้ไม่จด VAT
--      เคยใช้ชุด INV (D89) · ตั้งตัวนำหน้าซ้ำกันข้ามชนิดก็ยังไม่มีทางได้เลขซ้ำ
--    🚨 เพิ่มชนิดเอกสารใหม่ = ต้องเติมที่นี่ (docNumberingSql.test.ts ตรวจว่าครบ)
create or replace function fn_doc_no_taken(p_tenant uuid, p_type text, p_entity text, p_no text)
returns boolean language sql stable set search_path = public as $$
  select case
    when left(p_type, 6) = 'sales_' then exists (
      select 1 from sales_orders
       where tenant_id = p_tenant
         and p_no in (qu_no, order_no, inv_no, dep_inv_no, tax_no1, tax_no2, rcpt_no1, rcpt_no2))
    when p_type = 'bar_bill' then exists (
      select 1 from bar_sale where tenant_id = p_tenant and entity_id = p_entity and sale_no = p_no)
    when p_type = 'bar_rcpt' then exists (
      select 1 from bar_sale where tenant_id = p_tenant and entity_id = p_entity and rcpt_no = p_no)
    else false
  end;
$$;

-- ── 7) กิจการของเอกสาร ─────────────────────────────────────────────────────────
--    เอกสารขายออกในนามกิจการเดียว (`sales_doc_entity` · D44) — ลำดับ fallback เดียวกับ
--    resolveSalesVat() ฝั่ง TS · บาร์ = กิจการที่ส่งมา
create or replace function fn_doc_entity_for(p_tenant uuid, p_type text, p_entity text)
returns text language sql stable set search_path = public as $$
  select case when left(p_type, 6) = 'sales_' then coalesce(
      (select nullif(value, '') from app_settings where tenant_id = p_tenant and kind = 'sales_doc_entity' limit 1),
      (select nullif(value, '') from app_settings where tenant_id = p_tenant and kind = 'sales_revenue_entity' limit 1),
      (select entity_id from entities where tenant_id = p_tenant and is_default limit 1),
      (select entity_id from entities where tenant_id = p_tenant order by entity_id limit 1))
    else nullif(p_entity, '') end;
$$;

-- รูปแบบที่มีผล: แถวที่ตั้งไว้ หรือค่าปริยาย · คืนพร้อมธง configured
create or replace function fn_doc_cfg_get(p_tenant uuid, p_type text, p_entity text)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('prefix', prefix, 'date_fmt', date_fmt, 'era', era, 'reset', reset,
              'digits', digits, 'sep', sep, 'num_first', num_first,
              'configured', true, 'updated_at', updated_at)
       from doc_numbering
      where tenant_id = p_tenant and entity_id = p_entity and doc_type = p_type),
    fn_doc_default(p_type) || jsonb_build_object('configured', false));
$$;

-- ── 8) ดูเลขถัดไปโดยไม่กินเลข (พรีวิว) ──────────────────────────────────────────────
--    p_seed_key = key ของรูปแบบที่ใช้อยู่ตอนนี้ — ถ้ารูปแบบใหม่ยังไม่มีตัวนับ ให้เดินต่อจากตัวนี้ (กติกาข้อ 6)
create or replace function fn_doc_peek(p_tenant uuid, p_type text, p_entity text, p_cfg jsonb,
                                       p_conf boolean, p_date date, p_seed_key text default null)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_key   text := fn_doc_key(p_type, p_entity, p_cfg, p_conf, p_date);
  v_n     bigint;
  v_first bigint;
  v_no    text;
  v_skip  int := 0;
begin
  select value into v_n from counters where tenant_id = p_tenant and key = v_key;
  if v_n is null and p_seed_key is not null then
    select value into v_n from counters where tenant_id = p_tenant and key = p_seed_key;
  end if;
  v_n := coalesce(v_n, 0) + 1;
  v_first := v_n;
  loop
    v_no := fn_doc_no_format(p_cfg, p_date, v_n);
    exit when not fn_doc_no_taken(p_tenant, p_type, p_entity, v_no) or v_skip >= 5000;
    v_n := v_n + 1;
    v_skip := v_skip + 1;
  end loop;
  return jsonb_build_object('next_no', v_no, 'next_n', v_n, 'skipped', v_skip,
                            'first_no', fn_doc_no_format(p_cfg, p_date, v_first));
end $$;

-- helper ที่รับ p_tenant — เรียกได้จาก definer ข้างล่างเท่านั้น (owner ยังเรียกได้เสมอ)
revoke execute on function fn_doc_no_taken(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function fn_doc_entity_for(uuid, text, text) from public, anon, authenticated;
revoke execute on function fn_doc_cfg_get(uuid, text, text) from public, anon, authenticated;
revoke execute on function fn_doc_peek(uuid, text, text, jsonb, boolean, date, text) from public, anon, authenticated;
grant execute on function fn_doc_no_taken(uuid, text, text, text) to service_role;
grant execute on function fn_doc_entity_for(uuid, text, text) to service_role;
grant execute on function fn_doc_cfg_get(uuid, text, text) to service_role;
grant execute on function fn_doc_peek(uuid, text, text, jsonb, boolean, date, text) to service_role;

-- ── 9) ตัวออกเลข — ตัวเดียวของเอกสารทุกชนิดในเฟสนี้ ────────────────────────────────
--    p_date = วันที่ของเอกสาร (ปริยาย = วันนี้ตามเวลาไทย) · เฟส 3 (ลงย้อนหลัง) จะส่งวันที่มาเอง
create or replace function fn_next_doc_no(p_type text, p_entity text default null, p_date date default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_entity text;
  v_date   date := coalesce(p_date, (now() at time zone 'Asia/Bangkok')::date);
  v_cfg    jsonb;
  v_conf   boolean;
  v_key    text;
  v_n      bigint;
  v_no     text;
  v_skip   int := 0;
begin
  if v_tenant is null then
    raise exception 'ออกเลขเอกสารไม่ได้ — ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)';
  end if;
  if fn_doc_default(p_type) is null then
    raise exception 'ไม่รู้จักชนิดเอกสาร %', coalesce(p_type, '(ว่าง)');
  end if;
  if left(p_type, 6) = 'sales_' then
    if not has_cap('sales.write') then raise exception 'ไม่มีสิทธิ์ออกเลขเอกสารขาย'; end if;
  elsif left(p_type, 4) = 'bar_' then
    perform bar_guard(p_entity, 'bar.write');   -- ตรวจทั้ง cap และสิทธิ์เข้าถึงกิจการ
  end if;

  v_entity := fn_doc_entity_for(v_tenant, p_type, p_entity);
  v_cfg := fn_doc_cfg_get(v_tenant, p_type, v_entity);
  v_conf := (v_cfg->>'configured')::boolean;
  v_key := fn_doc_key(p_type, v_entity, v_cfg, v_conf, v_date);

  loop
    insert into counters (tenant_id, key, value) values (v_tenant, v_key, 1)
    on conflict (tenant_id, key) do update set value = counters.value + 1
    returning value into v_n;
    v_no := fn_doc_no_format(v_cfg, v_date, v_n);
    exit when not fn_doc_no_taken(v_tenant, p_type, v_entity, v_no);
    v_skip := v_skip + 1;
    if v_skip >= 5000 then
      raise exception 'ออกเลขเอกสารไม่ได้ — เลขถัดไปถูกใช้ไปแล้วติดกันเกิน 5,000 เลข · ตรวจรูปแบบที่ ตั้งค่า → เลขเอกสาร';
    end if;
  end loop;
  return v_no;
end $$;

-- ── 10) ของเดิมเรียกผ่านตัวใหม่ — ผู้เรียกทุกจุดไม่ต้องแก้ ─────────────────────────────
--    🚨 เป็น definer หมวด delegates ใน DEFINER_ALLOWLIST: ไม่เขียนเอง ส่งต่อให้ fn_next_doc_no
--       ซึ่งมีด่าน · ห้ามเรียกฟังก์ชันอื่นที่ไม่มีด่านในตัวนี้ (ตัวตรวจ D99 จะแดง)
create or replace function fn_next_sales_doc(p_prefix text) returns text
language sql security definer set search_path = public as $$
  select fn_next_doc_no(case p_prefix
           when 'QU' then 'sales_qu' when 'ORD' then 'sales_ord' when 'INV' then 'sales_inv'
           when 'TAX' then 'sales_tax' when 'RC' then 'sales_rcpt' end);
$$;

create or replace function fn_bar_next_doc(p_prefix text, p_entity text) returns text
language sql security definer set search_path = public as $fn$
  select fn_next_doc_no(case p_prefix when 'B' then 'bar_bill' when 'BR' then 'bar_rcpt' end, p_entity);
$fn$;

-- ── 11) RPC ของหน้า ตั้งค่า → เลขเอกสาร (admin) ────────────────────────────────────
create or replace function fn_doc_numbering_list(p_entity text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_today  date := (now() at time zone 'Asia/Bangkok')::date;
  v_out    jsonb := '[]'::jsonb;
  t        text;
  v_entity text;
  v_cfg    jsonb;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if not has_cap('admin') then raise exception 'ดูรูปแบบเลขเอกสารได้เฉพาะผู้ดูแลระบบ'; end if;
  foreach t in array fn_doc_types() loop
    v_entity := fn_doc_entity_for(v_tenant, t, p_entity);
    v_cfg := fn_doc_cfg_get(v_tenant, t, v_entity);
    v_out := v_out || jsonb_build_array(
      jsonb_build_object('doc_type', t, 'entity_id', v_entity, 'cfg', v_cfg)
      || fn_doc_peek(v_tenant, t, v_entity, v_cfg, (v_cfg->>'configured')::boolean, v_today));
  end loop;
  return v_out;
end $$;

-- พรีวิวรูปแบบที่ยังไม่บันทึก — คืน error เป็นข้อมูล (ไม่ raise) เพราะเรียกทุกครั้งที่พิมพ์
create or replace function fn_doc_numbering_preview(p_type text, p_entity text, p_cfg jsonb, p_next bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_today  date := (now() at time zone 'Asia/Bangkok')::date;
  v_entity text;
  v_err    text;
  v_cfg    jsonb;
  v_old    jsonb;
  v_no     text;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if not has_cap('admin') then raise exception 'ดูรูปแบบเลขเอกสารได้เฉพาะผู้ดูแลระบบ'; end if;
  if fn_doc_default(p_type) is null then raise exception 'ไม่รู้จักชนิดเอกสาร %', coalesce(p_type, '(ว่าง)'); end if;
  v_err := fn_doc_cfg_error(p_cfg);
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  v_entity := fn_doc_entity_for(v_tenant, p_type, p_entity);
  v_cfg := fn_doc_cfg_clean(p_cfg);
  if p_next is not null then
    if p_next < 1 then return jsonb_build_object('ok', false, 'error', 'เลขถัดไปต้องเป็น 1 ขึ้นไป'); end if;
    v_no := fn_doc_no_format(v_cfg, v_today, p_next);
    return jsonb_build_object('ok', true, 'next_no', v_no, 'next_n', p_next, 'skipped', 0,
                              'taken', fn_doc_no_taken(v_tenant, p_type, v_entity, v_no));
  end if;
  v_old := fn_doc_cfg_get(v_tenant, p_type, v_entity);
  return jsonb_build_object('ok', true, 'taken', false)
    || fn_doc_peek(v_tenant, p_type, v_entity, v_cfg, true, v_today,
                   fn_doc_key(p_type, v_entity, v_old, (v_old->>'configured')::boolean, v_today));
end $$;

create or replace function fn_doc_numbering_save(p_type text, p_entity text, p_cfg jsonb, p_next bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant  uuid := my_tenant();
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
  v_entity  text;
  v_err     text;
  v_cfg     jsonb;
  v_old     jsonb;
  v_old_key text;
  v_key     text;
  v_no      text;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if not has_cap('admin') then raise exception 'ตั้งรูปแบบเลขเอกสารได้เฉพาะผู้ดูแลระบบ'; end if;
  if fn_doc_default(p_type) is null then raise exception 'ไม่รู้จักชนิดเอกสาร %', coalesce(p_type, '(ว่าง)'); end if;
  v_entity := fn_doc_entity_for(v_tenant, p_type, p_entity);
  if v_entity is null or not exists (select 1 from entities where tenant_id = v_tenant and entity_id = v_entity) then
    raise exception 'ไม่พบกิจการ %', coalesce(v_entity, '(ว่าง)');
  end if;
  v_err := fn_doc_cfg_error(p_cfg);
  if v_err is not null then raise exception '%', v_err; end if;
  v_cfg := fn_doc_cfg_clean(p_cfg);

  v_old := fn_doc_cfg_get(v_tenant, p_type, v_entity);
  v_old_key := fn_doc_key(p_type, v_entity, v_old, (v_old->>'configured')::boolean, v_today);

  insert into doc_numbering (tenant_id, entity_id, doc_type, prefix, date_fmt, era, reset, digits, sep,
                             num_first, updated_at, updated_by)
  values (v_tenant, v_entity, p_type, v_cfg->>'prefix', v_cfg->>'date_fmt', v_cfg->>'era', v_cfg->>'reset',
          (v_cfg->>'digits')::int, v_cfg->>'sep', (v_cfg->>'num_first')::boolean, now(), auth.uid())
  on conflict (tenant_id, entity_id, doc_type) do update set
    prefix = excluded.prefix, date_fmt = excluded.date_fmt, era = excluded.era, reset = excluded.reset,
    digits = excluded.digits, sep = excluded.sep, num_first = excluded.num_first,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by;

  v_key := fn_doc_key(p_type, v_entity, v_cfg, true, v_today);
  if p_next is not null then
    if p_next < 1 then raise exception 'เลขถัดไปต้องเป็น 1 ขึ้นไป'; end if;
    v_no := fn_doc_no_format(v_cfg, v_today, p_next);
    -- 🚨 กติกาข้อ 5: ชนเลขที่ออกไปแล้ว = บล็อกทั้งการบันทึก (raise → rollback รูปแบบด้วย)
    if fn_doc_no_taken(v_tenant, p_type, v_entity, v_no) then
      raise exception 'เลข % ถูกใช้ไปแล้ว — ใส่เลขที่มากกว่านี้ หรือเว้นช่องเลขถัดไปว่างให้ระบบหาเลขว่างถัดไปเอง', v_no;
    end if;
    insert into counters (tenant_id, key, value) values (v_tenant, v_key, p_next - 1)
    on conflict (tenant_id, key) do update set value = excluded.value;
  elsif v_key <> v_old_key then
    -- กติกาข้อ 6: รอบนี้เดินต่อจากตัวนับเดิม (ถ้ารูปแบบใหม่ยังไม่มีตัวนับของตัวเอง)
    insert into counters (tenant_id, key, value)
    select v_tenant, v_key, value from counters where tenant_id = v_tenant and key = v_old_key
    on conflict (tenant_id, key) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'entity_id', v_entity)
    || fn_doc_peek(v_tenant, p_type, v_entity, v_cfg, true, v_today);
end $$;

-- คืนค่าเริ่มต้น = ลบแถว (กลับไปใช้ key เดิมของระบบ · เลขที่ออกไประหว่างนั้นถูกข้ามด้วยข้อ 2)
create or replace function fn_doc_numbering_reset(p_type text, p_entity text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_entity text;
  v_n      int;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if not has_cap('admin') then raise exception 'ตั้งรูปแบบเลขเอกสารได้เฉพาะผู้ดูแลระบบ'; end if;
  if fn_doc_default(p_type) is null then raise exception 'ไม่รู้จักชนิดเอกสาร %', coalesce(p_type, '(ว่าง)'); end if;
  v_entity := fn_doc_entity_for(v_tenant, p_type, p_entity);
  delete from doc_numbering where tenant_id = v_tenant and entity_id = v_entity and doc_type = p_type;
  get diagnostics v_n = row_count;
  -- 🚨 row_count = 0 ต้องตอบ error ไทย ไม่ใช่ ok (D91/D93)
  if v_n = 0 then raise exception 'เอกสารนี้ใช้รูปแบบเริ่มต้นของระบบอยู่แล้ว'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ── 12) fn_mig_truncate — ยกจาก 20260914000071_tax_filings.sql · เติม doc_numbering ก่อน entities ────────
create or replace function fn_mig_truncate(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  t text;
  -- เรียงตามลำดับ FK (ลูกก่อนแม่) เพราะ delete ไม่ cascade เองเหมือน truncate
  tables text[] := array[
    'transaction_items','transactions','tax_summaries','tax_payments','tax_filings','wht_certificates',
    'log_material','log_ferment','log_distill','log_distill_run',
    'log_ferment_monitor','log_dilute','log_ferment_draw','log_product','stock_product',
    -- ★ D94 — กลั่นซ้ำ: รอบมี FK ไปล็อต · ล็อตมี entity_id FK
    'log_redistill_round','log_redistill',
    'sales_order_items','sales_orders','warehouse_stock','stock_moves','sale_menu',
    -- ★ D96 — บาร์/POS · ลูกก่อนแม่:
    --   sale_item→sale · fav→customer,menu · recipe→menu,item · menu→category,customer
    --   receive/move→item · sale→customer
    'bar_sale_item','bar_sale','bar_post','bar_move','bar_receive',
    'bar_customer_fav','bar_recipe','bar_menu','bar_category','bar_customer','bar_item',
    -- เงินเดือน (0040 + 0042) — ต้องมาก่อน entities ไม่งั้นติด FK
    'payroll_items','payroll_periods','employees',
    'pay_components','pay_inputs','pay_rates','pay_variables','pay_post_legs',
    'contacts','bank_accounts',
    'materials','containers','products',
    -- ★ report_runs มี entity_id FK → ต้องมาก่อน entities ด้วย (0050)
    'report_runs',
    -- ★ D91 — excise_month_close มี entity_id FK → ต้องมาก่อน entities ด้วย
    'excise_month_close',
    -- ★ D100 — doc_numbering มี entity_id FK → ต้องมาก่อน entities ด้วย
    'doc_numbering',
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
end $fn$;

-- 🚨 D99: revoke ต้องครอบ anon/authenticated เสมอ (from public อย่างเดียวไม่มีผลบน Supabase)
revoke execute on function fn_mig_truncate(uuid) from public, anon, authenticated;
grant  execute on function fn_mig_truncate(uuid) to service_role;

notify pgrst, 'reload schema';
