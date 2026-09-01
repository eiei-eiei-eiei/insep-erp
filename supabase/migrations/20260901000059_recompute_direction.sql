-- ============================================================================
-- 0059 คำนวณการซ่อนใหม่ต้องบอก "ทิศทาง" ไม่ใช่แค่จำนวน — D91 (เจอตอนเทสเบราว์เซอร์)
--
-- 🔴 อาการ: เปิดเดือน ต.ค. ที่มีคู่ จ่าย/รับ ซึ่ง**ถูกซ่อนอยู่** แต่เดือนที่ขาย (ก.ย.) ปิดไปแล้ว
--    หน้าจอขึ้นว่า *"มีคู่ … ที่ยังแสดงบนฟอร์ม — กดเพื่อเอาออก"*
--    ซึ่งเป็น **คำโกหกที่กลับด้านกับความจริงพอดี**: คู่นั้นถูกซ่อนอยู่ และการกดจะทำให้มัน
--    **กลับมาแสดง** (ถูกต้องแล้ว เพราะฟอร์ม ก.ย. ที่ยื่นไปมีแถวนั้นอยู่)
--
-- 🚨 สาเหตุ: dry-run คืนแค่ `changed` = "จะเปลี่ยนกี่คู่" ซึ่งเป็นเลขที่ไม่มีทิศทาง
--    แล้วฝั่งหน้าจอ **เดาเอาเองว่าทิศทางคือ 'ซ่อนเพิ่ม' เสมอ** ทั้งที่ recompute
--    ตั้งใจให้เป็นสองทาง (set ทั้ง true และ false) มาตั้งแต่ 0058
--
-- 🪤 บทเรียน (ตระกูล D81): **ตัวเลขที่ไม่มีทิศทาง ห้ามเอาไปแต่งประโยคที่มีทิศทาง**
--    ตรรกะฝั่ง DB ถูกตั้งแต่แรก (พิสูจน์แล้วว่าคู่ข้ามเดือนไม่ถูกซ่อนครึ่งเดียว)
--    ที่ผิดคือ "คำอธิบาย" ซึ่งผู้ใช้อ่านแล้วตัดสินใจกดปุ่ม
--
-- ★ ยกฟังก์ชันจาก 0058 มาทั้งดุ้นด้วยสคริปต์ `scripts/gen/gen-0059.mjs` · signature ไม่เปลี่ยน
--   → create or replace ทับได้ ไม่เกิด overload (กับดัก D69)
-- ============================================================================

create or replace function fn_excise_recompute_hidden(p_entity text, p_month text, p_dry boolean)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := my_tenant();
  r record; v_want boolean; v_changed int := 0; v_n int;
  -- D91b — แยกตามทิศทาง: จะซ่อนเพิ่ม กี่คู่ · จะเอากลับมาแสดง กี่คู่
  v_to_hide int := 0; v_to_show int := 0;
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
    if v_n > 0 then
      v_changed := v_changed + 1;
      if v_want then v_to_hide := v_to_hide + 1; else v_to_show := v_to_show + 1; end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'changed', v_changed,
                            'to_hide', v_to_hide, 'to_show', v_to_show, 'dry', p_dry);
end $fn$;

create or replace function fn_excise_reopen_month(p_entity text, p_month text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := my_tenant();
  v_n int; v_rc jsonb;
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

  v_rc := fn_excise_recompute_hidden(p_entity, p_month, false);
  return jsonb_build_object('ok', true,
    'changed', (v_rc ->> 'changed')::int,
    'to_hide', (v_rc ->> 'to_hide')::int,
    'to_show', (v_rc ->> 'to_show')::int);
end $fn$;

notify pgrst, 'reload schema';
