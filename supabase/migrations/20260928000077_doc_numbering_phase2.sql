-- ============================================================================
-- 0077 รูปแบบเลขเอกสาร เฟส 2 — 50ทวิ · batch · ล็อตกลั่นซ้ำ + กฎ "มากกว่าเลขที่มีอยู่เสมอ" (D100)
--
-- ── 1. กฎใหม่ของเลขถัดไป (แทนกฎ "ตัวนับ + ข้ามเลขที่มีอยู่" ของ 0076) ─────────────────
--   เลขถัดไป = max( ตัวนับ , **เลขที่มากที่สุดที่มีเอกสารใช้อยู่แล้วในรอบนี้** ) + 1
--   🔴 ทำไมต้องเปลี่ยน: กฎของ 0076 เริ่มนับจาก 1 เมื่อชุดเลขยังไม่มีตัวนับ แล้ว **เติมช่องว่าง**
--      ของเดิม 50ทวิ/batch คิด max+1 — ผู้ใช้พิมพ์ `6907` เองในฟอร์ม ของเดิมเสนอ `6908`
--      แต่กฎ 0076 จะเสนอ `6901` = หนังสือรับรองที่ลงวันที่ทีหลังได้เลขน้อยกว่า (เลขไม่เรียงตามเวลา
--      บนเอกสารที่ยื่นสรรพากร) · ใบที่ถูกลบไปแล้วก็ถูกเอาเลขกลับมาใช้ = เลขซ้ำใบที่อยู่ในมือคู่ค้า
--   ★ กฎใหม่ได้ครบทุกข้อ: ไม่เติมช่องว่าง · ไม่ซ้ำ · เรียงตามเวลา · ค่าปริยายให้ผล **เท่ากับ
--     max+1 ของเดิมเป๊ะ** (test:tenant เทียบกับ nextWhtDocNo/nextBatchNumber/nextLotNumber)
--     · เปลี่ยนแค่จำนวนหลัก/ตัวคั่นแล้วเลขเดินต่อเอง · restore แล้วไม่ถอยหลัง
--     · ⇒ ไม่ต้องมีขั้น seed ตัวนับจากข้อมูลเก่าเลย (อ่านจากเอกสารจริงทุกครั้ง)
--   ★ "เลขในรอบนี้" หาด้วย regex ที่ประกอบจากรูปแบบ (`fn_doc_no_regex`) — ทำได้เพราะรูปแบบเป็น
--     **ชุดปิด** (ทาง ค) ไม่ใช่แม่แบบที่ผู้ใช้พิมพ์ · ส่วนวันที่ที่ละเอียดกว่ารอบเป็น wildcard
--     (รอบรายปี + เลขมีเดือน → ทุกเดือนของปีนั้นนับรวมกัน)
--   ★ ยังข้ามเลขที่มีอยู่เป็นชั้นสำรอง (เลขรูปแบบอื่นที่บังเอิญตรงกัน)
--
-- ── 2. ชนิดใหม่ 3 ตัว — "เสนอเลขในฟอร์ม แล้วผู้ใช้แก้ได้" ─────────────────────────
--   50ทวิ `6901` (แก้เลขได้ของเดิม) · batch `12/69` (พิมพ์เองได้ของเดิม) · ล็อต `S1/69`
--   → `fn_suggest_doc_no` เสนอเลข **โดยไม่กินเลข** (เปิดฟอร์มแล้วปิดทิ้ง = ไม่มีช่องว่าง)
--   ขอบเขต: 50ทวิ แยกกิจการ · ใบคู่ค้า+ใบพนักงานชุดเดียวกัน (D69)
--           batch/ล็อต ใช้ร่วมทั้ง tenant (ของเดิมคิดจากทุกแถว · ล็อตคีย์ (tenant, lot_no) D94)
--           → รูปแบบเก็บใต้กิจการหลัก แต่ตรวจเลขทั้ง tenant
--
-- ── 3. "เลขถัดไป" ที่ผู้ใช้ตั้ง ต้องมากกว่าเลขล่าสุดของรอบนี้ (ต่อจากกติกาบล็อกของ 0076) ─
--   ตั้งต่ำกว่า = ขอให้ออกเลขย้อนลำดับ/เลขซ้ำ → บล็อกพร้อมบอกเลขล่าสุด
--
-- 🚨 สิทธิ์ (D99): definer ทุกตัวมีด่าน my_tenant() · helper ที่รับ p_tenant เป็น invoker + revoke ครบ
-- ============================================================================

-- ── 1) รายชื่อ + ค่าปริยาย ────────────────────────────────────────────────────
create or replace function fn_doc_types() returns text[]
language sql immutable set search_path = public as $$
  select array['sales_qu','sales_ord','sales_inv','sales_tax','sales_rcpt','bar_bill','bar_rcpt',
               'acct_wht','prod_batch','prod_lot'];
$$;

-- ★ ค่าปริยาย = รูปแบบเดิมของระบบเป๊ะ
create or replace function fn_doc_default(p_type text) returns jsonb
language sql immutable set search_path = public as $$
  select case
    when p_type in ('sales_qu','sales_ord','sales_inv','sales_tax','sales_rcpt','bar_bill','bar_rcpt') then
      jsonb_build_object('prefix', case p_type
          when 'sales_qu' then 'QU' when 'sales_ord' then 'ORD' when 'sales_inv' then 'INV'
          when 'sales_tax' then 'TAX' when 'sales_rcpt' then 'RC'
          when 'bar_bill' then 'B' when 'bar_rcpt' then 'BR' end,
        'date_fmt', 'YYMMDD', 'era', 'ce', 'reset', 'day', 'digits', 3, 'sep', '-', 'num_first', false)
    -- `6901` · `69100` = ปี พ.ศ. 2 หลัก + ลำดับอย่างน้อย 2 หลัก ไม่มีตัวคั่น (golden A9)
    when p_type = 'acct_wht' then
      jsonb_build_object('prefix', '', 'date_fmt', 'YY', 'era', 'be', 'reset', 'year',
                         'digits', 2, 'sep', '', 'num_first', false)
    -- `12/69` = เลขรันหน้าปี พ.ศ. ไม่เติมศูนย์ (golden P12)
    when p_type = 'prod_batch' then
      jsonb_build_object('prefix', '', 'date_fmt', 'YY', 'era', 'be', 'reset', 'year',
                         'digits', 1, 'sep', '/', 'num_first', true)
    -- `S1/69` (D94)
    when p_type = 'prod_lot' then
      jsonb_build_object('prefix', 'S', 'date_fmt', 'YY', 'era', 'be', 'reset', 'year',
                         'digits', 1, 'sep', '/', 'num_first', true)
  end;
$$;

-- ── 2) key ของตัวนับ ─────────────────────────────────────────────────────────────
--    🚨 key แบบเดิมมีแค่ขาย/บาร์ · ชนิดใหม่ไม่เคยมีตัวนับ → key ใหม่เสมอ
--       (0076 เขียน `when not p_conf then` แบบขายเป็นกิ่งสุดท้าย — ไม่แยกออก = ชนิดใหม่ได้ key รายวัน)
create or replace function fn_doc_key(p_type text, p_entity text, c jsonb, p_conf boolean, d date)
returns text language sql immutable set search_path = public as $$
  select case
    when not p_conf and left(p_type, 4) = 'bar_' then
      (c->>'prefix') || '-' || coalesce(p_entity, '') || '-' || to_char(d, 'YYMMDD')
    when not p_conf and left(p_type, 6) = 'sales_' then
      (c->>'prefix') || '-' || to_char(d, 'YYMMDD')
    else
      'doc|' || p_type || '|' || coalesce(p_entity, '') || '|' || coalesce(c->>'prefix', '') || '|' ||
      case c->>'reset' when 'year' then to_char(d, 'YYYY') when 'month' then to_char(d, 'YYYY-MM')
                       when 'day' then to_char(d, 'YYYY-MM-DD') else '' end
  end;
$$;

-- ── 3) เลขเอกสารทั้งหมดที่มีอยู่ของชนิดนั้น — ทะเบียนเดียว (ใช้ทั้งกันซ้ำและหาเลขล่าสุด) ──────
--    🚨 เพิ่มชนิดใหม่ = ต้องเติมที่นี่ (docNumberingSql.test.ts ตรวจว่าครบทุกชนิด)
--    ★ ฝั่งขายรวม **ทุกช่องเลข** ของออเดอร์ (รวม rcpt ที่เคยยืมชุด INV · D89)
--    ★ batch รวมทุกตารางที่เลข batch ไปโผล่ (หมัก · ปิด batch · รินสุราแช่) ทั้ง tenant
create or replace function fn_doc_nos(p_tenant uuid, p_type text, p_entity text)
returns setof text language sql stable set search_path = public as $$
  select x from (
    select unnest(array[qu_no, order_no, inv_no, dep_inv_no, tax_no1, tax_no2, rcpt_no1, rcpt_no2]) as x
      from sales_orders where left(p_type, 6) = 'sales_' and tenant_id = p_tenant
    union all
    select sale_no from bar_sale where p_type = 'bar_bill' and tenant_id = p_tenant and entity_id = p_entity
    union all
    select rcpt_no from bar_sale where p_type = 'bar_rcpt' and tenant_id = p_tenant and entity_id = p_entity
    union all
    select doc_no from wht_certificates where p_type = 'acct_wht' and tenant_id = p_tenant and entity_id = p_entity
    union all
    select batch from log_ferment where p_type = 'prod_batch' and tenant_id = p_tenant
    union all
    select batch from log_distill where p_type = 'prod_batch' and tenant_id = p_tenant
    union all
    select batch from log_ferment_draw where p_type = 'prod_batch' and tenant_id = p_tenant
    union all
    select lot_no from log_redistill where p_type = 'prod_lot' and tenant_id = p_tenant
  ) s where x is not null;
$$;

create or replace function fn_doc_no_taken(p_tenant uuid, p_type text, p_entity text, p_no text)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from fn_doc_nos(p_tenant, p_type, p_entity) x where x = p_no);
$$;

-- ── 4) regex ของ "เลขในรอบเดียวกัน" — กลุ่มที่ 1 คือเลขรัน ─────────────────────────────
--    ส่วนวันที่ที่กำหนดรอบ = ตัวอักษรตรงตัว · ส่วนที่ละเอียดกว่ารอบ = \d (นับรวมกันทั้งรอบ)
--    🪤 เลขรันต้องเป็น (\d+) ไม่จำกัดความยาว — เลขที่ยาวเกินจำนวนหลักต้องถูกนับด้วย
create or replace function fn_doc_no_regex(c jsonb, d date) returns text
language plpgsql immutable set search_path = public as $$
declare
  rs  text := c->>'reset';
  y   int  := extract(year from d)::int + case when c->>'era' = 'be' then 543 else 0 end;
  yy  text := case when rs = 'never' then '\d{2}' else lpad((y % 100)::text, 2, '0') end;
  y4  text := case when rs = 'never' then '\d{4}' else y::text end;
  mm  text := case when rs in ('month','day') then to_char(d, 'MM') else '\d{2}' end;
  dd  text := case when rs = 'day' then to_char(d, 'DD') else '\d{2}' end;
  dp  text;
  sp  text;
  pre text := regexp_replace(coalesce(c->>'prefix', ''), '([.\\/^$|?*+()\[\]{}-])', '\\\1', 'g');
begin
  dp := case c->>'date_fmt'
          when 'YY' then yy     when 'YYYY' then y4
          when 'YYMM' then yy || mm   when 'YYYYMM' then y4 || mm
          when 'YYMMDD' then yy || mm || dd   when 'YYYYMMDD' then y4 || mm || dd
          else '' end;
  -- 🪤 ตัวคั่นเป็นอะไรก็ได้ในชุดที่อนุญาต ไม่ใช่ตัวที่ตั้งอยู่ตอนนี้ — เปลี่ยนแค่ตัวคั่นกลางรอบ
  --    ต้องเดินเลขต่อ ไม่งั้นเดือนเดียวมี "เลขที่ 1" สองใบ (IV6909-0001 กับ IV6909/0001)
  --    (เปลี่ยนตัวอักษรนำหน้า = ชุดเลขใหม่ โดยตั้งใจ)
  sp := case when dp = '' then '' else '[-/.]?' end;
  return '^' || pre ||
         case when coalesce((c->>'num_first')::boolean, false) then '(\d+)' || sp || dp
              else dp || sp || '(\d+)' end || '$';
end $$;

-- เลขรันที่มากที่สุดของรอบนี้ (ไม่มี = 0)
create or replace function fn_doc_max_n(p_tenant uuid, p_type text, p_entity text, c jsonb, d date)
returns bigint language sql stable set search_path = public as $$
  select coalesce(max((regexp_match(x, fn_doc_no_regex(c, d)))[1]::numeric), 0)::bigint
    from fn_doc_nos(p_tenant, p_type, p_entity) x
   where x ~ fn_doc_no_regex(c, d);
$$;

-- ── 5) กิจการของเอกสาร ─────────────────────────────────────────────────────────
create or replace function fn_doc_entity_for(p_tenant uuid, p_type text, p_entity text)
returns text language sql stable set search_path = public as $$
  select case
    when left(p_type, 6) = 'sales_' then coalesce(
      (select nullif(value, '') from app_settings where tenant_id = p_tenant and kind = 'sales_doc_entity' limit 1),
      (select nullif(value, '') from app_settings where tenant_id = p_tenant and kind = 'sales_revenue_entity' limit 1),
      (select entity_id from entities where tenant_id = p_tenant and is_default limit 1),
      (select entity_id from entities where tenant_id = p_tenant order by entity_id limit 1))
    -- batch/ล็อตใช้ร่วมทั้ง tenant → เก็บรูปแบบใต้กิจการหลักเสมอ (ไม่สนกิจการที่ส่งมา)
    when left(p_type, 5) = 'prod_' then coalesce(
      (select entity_id from entities where tenant_id = p_tenant and is_default limit 1),
      (select entity_id from entities where tenant_id = p_tenant order by entity_id limit 1))
    else nullif(p_entity, '') end;
$$;

-- ── 6) ด่านสิทธิ์ของการขอเลข — จุดเดียว (ออกเลข + เสนอเลข) ────────────────────────────
create or replace function fn_doc_issue_guard(p_type text, p_entity text) returns void
language plpgsql stable set search_path = public as $$
begin
  if fn_doc_default(p_type) is null then
    raise exception 'ไม่รู้จักชนิดเอกสาร %', coalesce(p_type, '(ว่าง)');
  end if;
  if left(p_type, 6) = 'sales_' then
    if not has_cap('sales.write') then raise exception 'ไม่มีสิทธิ์ออกเลขเอกสารขาย'; end if;
  elsif left(p_type, 4) = 'bar_' then
    perform bar_guard(p_entity, 'bar.write');   -- ตรวจทั้ง cap และสิทธิ์เข้าถึงกิจการ
  elsif p_type = 'acct_wht' then
    -- ใบคู่ค้า (บัญชี) และใบพนักงาน (เงินเดือน) ใช้เลขชุดเดียวกัน (D69)
    if not (has_cap('acct.write') or has_cap('pay.write')) then
      raise exception 'ไม่มีสิทธิ์ออกเลขหนังสือรับรอง 50 ทวิ';
    end if;
  elsif left(p_type, 5) = 'prod_' then
    if not has_cap('prod.write') then raise exception 'ไม่มีสิทธิ์ออกเลข batch/ล็อต'; end if;
  end if;
end $$;

-- ── 7) ดูเลขถัดไปโดยไม่กินเลข (พรีวิว) — กฎเดียวกับตัวออกเลข ───────────────────────────
--    (ลายเซ็นเดิมของ 0076 — create or replace ต้องคงพารามิเตอร์ครบ · p_seed_key ยังใช้เป็นพื้นได้)
create or replace function fn_doc_peek(p_tenant uuid, p_type text, p_entity text, p_cfg jsonb,
                                       p_conf boolean, p_date date, p_seed_key text default null)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_key   text := fn_doc_key(p_type, p_entity, p_cfg, p_conf, p_date);
  v_cnt   bigint;
  v_max   bigint := fn_doc_max_n(p_tenant, p_type, p_entity, p_cfg, p_date);
  v_n     bigint;
  v_no    text;
  v_skip  int := 0;
begin
  select value into v_cnt from counters where tenant_id = p_tenant and key = v_key;
  if v_cnt is null and p_seed_key is not null then
    select value into v_cnt from counters where tenant_id = p_tenant and key = p_seed_key;
  end if;
  v_n := greatest(coalesce(v_cnt, 0), v_max) + 1;
  loop
    v_no := fn_doc_no_format(p_cfg, p_date, v_n);
    exit when not fn_doc_no_taken(p_tenant, p_type, p_entity, v_no) or v_skip >= 5000;
    v_n := v_n + 1;
    v_skip := v_skip + 1;
  end loop;
  return jsonb_build_object('next_no', v_no, 'next_n', v_n, 'skipped', v_skip, 'last_n', v_max);
end $$;

-- helper ที่รับ p_tenant — เรียกจาก definer เท่านั้น (owner เรียกได้เสมอ) · 🚨 D99 revoke ครบ 3 role
revoke execute on function fn_doc_nos(uuid, text, text) from public, anon, authenticated;
revoke execute on function fn_doc_max_n(uuid, text, text, jsonb, date) from public, anon, authenticated;
revoke execute on function fn_doc_issue_guard(text, text) from public, anon, authenticated;
grant execute on function fn_doc_nos(uuid, text, text) to service_role;
grant execute on function fn_doc_max_n(uuid, text, text, jsonb, date) to service_role;
grant execute on function fn_doc_issue_guard(text, text) to service_role;

-- ── 8) ตัวออกเลข (กินเลข) ──────────────────────────────────────────────────────
--    ★ max กับตัวนับรวมในคำสั่ง upsert เดียว → row lock ของตัวนับกันสองคนได้เลขเดียวกัน
create or replace function fn_next_doc_no(p_type text, p_entity text default null, p_date date default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_entity text;
  v_date   date := coalesce(p_date, (now() at time zone 'Asia/Bangkok')::date);
  v_cfg    jsonb;
  v_key    text;
  v_max    bigint;
  v_n      bigint;
  v_no     text;
  v_skip   int := 0;
begin
  if v_tenant is null then
    raise exception 'ออกเลขเอกสารไม่ได้ — ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)';
  end if;
  perform fn_doc_issue_guard(p_type, p_entity);

  v_entity := fn_doc_entity_for(v_tenant, p_type, p_entity);
  v_cfg := fn_doc_cfg_get(v_tenant, p_type, v_entity);
  v_key := fn_doc_key(p_type, v_entity, v_cfg, (v_cfg->>'configured')::boolean, v_date);
  v_max := fn_doc_max_n(v_tenant, p_type, v_entity, v_cfg, v_date);

  insert into counters (tenant_id, key, value) values (v_tenant, v_key, v_max + 1)
  on conflict (tenant_id, key) do update set value = greatest(counters.value, v_max) + 1
  returning value into v_n;
  loop
    v_no := fn_doc_no_format(v_cfg, v_date, v_n);
    exit when not fn_doc_no_taken(v_tenant, p_type, v_entity, v_no);
    v_skip := v_skip + 1;
    if v_skip >= 5000 then
      raise exception 'ออกเลขเอกสารไม่ได้ — เลขถัดไปถูกใช้ไปแล้วติดกันเกิน 5,000 เลข · ตรวจรูปแบบที่ ตั้งค่า → เลขเอกสาร';
    end if;
    update counters set value = value + 1 where tenant_id = v_tenant and key = v_key
    returning value into v_n;
  end loop;
  return v_no;
end $$;

-- ── 9) เสนอเลข (ไม่กินเลข) — ฟอร์มที่ผู้ใช้แก้เลขได้ (50ทวิ · batch · ล็อต) ────────────────
create or replace function fn_suggest_doc_no(p_type text, p_entity text default null, p_date date default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_entity text;
  v_date   date := coalesce(p_date, (now() at time zone 'Asia/Bangkok')::date);
  v_cfg    jsonb;
begin
  if v_tenant is null then
    raise exception 'ขอเลขเอกสารไม่ได้ — ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)';
  end if;
  perform fn_doc_issue_guard(p_type, p_entity);
  v_entity := fn_doc_entity_for(v_tenant, p_type, p_entity);
  v_cfg := fn_doc_cfg_get(v_tenant, p_type, v_entity);
  return fn_doc_peek(v_tenant, p_type, v_entity, v_cfg, (v_cfg->>'configured')::boolean, v_date)->>'next_no';
end $$;

-- ── 10) หน้าตั้งค่า: พรีวิว + บันทึก — "เลขถัดไป" ต้องมากกว่าเลขล่าสุดของรอบนี้ ─────────────
create or replace function fn_doc_numbering_preview(p_type text, p_entity text, p_cfg jsonb, p_next bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_today  date := (now() at time zone 'Asia/Bangkok')::date;
  v_entity text;
  v_err    text;
  v_cfg    jsonb;
  v_last   bigint;
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
    v_last := fn_doc_max_n(v_tenant, p_type, v_entity, v_cfg, v_today);
    v_no := fn_doc_no_format(v_cfg, v_today, p_next);
    return jsonb_build_object('ok', true, 'next_no', v_no, 'next_n', p_next, 'skipped', 0, 'last_n', v_last,
      'taken', p_next <= v_last or fn_doc_no_taken(v_tenant, p_type, v_entity, v_no));
  end if;
  return jsonb_build_object('ok', true, 'taken', false)
    || fn_doc_peek(v_tenant, p_type, v_entity, v_cfg, true, v_today);
end $$;

create or replace function fn_doc_numbering_save(p_type text, p_entity text, p_cfg jsonb, p_next bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant  uuid := my_tenant();
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
  v_entity  text;
  v_err     text;
  v_cfg     jsonb;
  v_key     text;
  v_last    bigint;
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

  insert into doc_numbering (tenant_id, entity_id, doc_type, prefix, date_fmt, era, reset, digits, sep,
                             num_first, updated_at, updated_by)
  values (v_tenant, v_entity, p_type, v_cfg->>'prefix', v_cfg->>'date_fmt', v_cfg->>'era', v_cfg->>'reset',
          (v_cfg->>'digits')::int, v_cfg->>'sep', (v_cfg->>'num_first')::boolean, now(), auth.uid())
  on conflict (tenant_id, entity_id, doc_type) do update set
    prefix = excluded.prefix, date_fmt = excluded.date_fmt, era = excluded.era, reset = excluded.reset,
    digits = excluded.digits, sep = excluded.sep, num_first = excluded.num_first,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by;

  if p_next is not null then
    if p_next < 1 then raise exception 'เลขถัดไปต้องเป็น 1 ขึ้นไป'; end if;
    v_last := fn_doc_max_n(v_tenant, p_type, v_entity, v_cfg, v_today);
    v_no := fn_doc_no_format(v_cfg, v_today, p_next);
    -- 🚨 บล็อกทั้งการบันทึก (raise → rollback รูปแบบด้วย): ชนเลขที่มีอยู่ หรือย้อนลำดับ
    if p_next <= v_last then
      raise exception 'เลขถัดไปต้องมากกว่า % ซึ่งเป็นเลขล่าสุดที่ออกไปแล้วในรอบนี้ — ออกเลขย้อนลำดับไม่ได้',
        fn_doc_no_format(v_cfg, v_today, v_last);
    end if;
    if fn_doc_no_taken(v_tenant, p_type, v_entity, v_no) then
      raise exception 'เลข % ถูกใช้ไปแล้ว — ใส่เลขที่มากกว่านี้ หรือเว้นช่องเลขถัดไปว่างให้ระบบหาเอง', v_no;
    end if;
    v_key := fn_doc_key(p_type, v_entity, v_cfg, true, v_today);
    insert into counters (tenant_id, key, value) values (v_tenant, v_key, p_next - 1)
    on conflict (tenant_id, key) do update set value = excluded.value;
  end if;

  return jsonb_build_object('ok', true, 'entity_id', v_entity)
    || fn_doc_peek(v_tenant, p_type, v_entity, v_cfg, true, v_today);
end $$;

notify pgrst, 'reload schema';
