-- ============================================================================
-- 0079 แก้กฎ "เลขล่าสุด" ของ 0077 (D100) — จับได้จาก test:tenant หลังลง 0077
--
-- 🔴 0077 นิยาม "เลขล่าสุด" = เลขมากสุดของ **เอกสารที่บันทึกแล้ว** อย่างเดียว แต่เลขที่ออกไปแล้ว
--    ไม่ได้อยู่ในเอกสารเสมอไป — ขอเลขแล้วบันทึกไม่สำเร็จ (ล้มกลางทาง) เลขนั้นถูกแจกไปแล้วแต่ไม่มีแถวไหนถือ
--    อาการ 2 ข้อ (test:tenant แดง 2 ข้อ):
--    1. เปลี่ยนรูปแบบกลางรอบ → เลขเริ่ม 1 ใหม่ · 0076 เคยมีขั้น "ยกตัวนับของรูปแบบเดิมไปให้รูปแบบใหม่"
--       แล้ว 0077 ตัดทิ้งเพราะคิดว่าเลขจากเอกสารครอบแล้ว — **ครอบไม่หมด** (ผมตัดสินผิด)
--    2. ตั้ง "เลขถัดไป" ทับเลขที่แจกไปแล้วแต่ยังไม่ถูกบันทึกได้ = แจกเลขเดิมซ้ำ
-- ★ แก้: "เลขล่าสุด" = max(ตัวนับ, เลขมากสุดในเอกสาร) ทุกจุด (พรีวิว · บันทึก · ตัวเลขที่ขึ้นจอ)
--    + คืนขั้นยกตัวนับเมื่อเปลี่ยนรูปแบบ (ถ้ารูปแบบใหม่ยังไม่มีตัวนับของตัวเอง)
--    ตัวออกเลข (fn_next_doc_no) ไม่ต้องแก้ — คิด greatest(ตัวนับ, max) อยู่แล้ว
-- 🚨 ไฟล์ใหม่ ไม่ใช่แก้ 0077 — 0077 ลง DB ไปแล้ว (แก้ไฟล์เดิม = ไม่มีผลกับ DB ที่รันแล้ว · D95)
-- ============================================================================

-- ── 1) พรีวิว: last_n รวมตัวนับด้วย ─────────────────────────────────────────────
create or replace function fn_doc_peek(p_tenant uuid, p_type text, p_entity text, p_cfg jsonb,
                                       p_conf boolean, p_date date, p_seed_key text default null)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_key   text := fn_doc_key(p_type, p_entity, p_cfg, p_conf, p_date);
  v_cnt   bigint;
  v_max   bigint := fn_doc_max_n(p_tenant, p_type, p_entity, p_cfg, p_date);
  v_last  bigint;
  v_n     bigint;
  v_no    text;
  v_skip  int := 0;
begin
  select value into v_cnt from counters where tenant_id = p_tenant and key = v_key;
  -- รูปแบบใหม่ที่ยังไม่มีตัวนับ = เดินต่อจากตัวนับของรูปแบบที่ใช้อยู่ (ตรงกับที่ save จะยกไปให้)
  if v_cnt is null and p_seed_key is not null then
    select value into v_cnt from counters where tenant_id = p_tenant and key = p_seed_key;
  end if;
  v_last := greatest(coalesce(v_cnt, 0), v_max);
  v_n := v_last + 1;
  loop
    v_no := fn_doc_no_format(p_cfg, p_date, v_n);
    exit when not fn_doc_no_taken(p_tenant, p_type, p_entity, v_no) or v_skip >= 5000;
    v_n := v_n + 1;
    v_skip := v_skip + 1;
  end loop;
  return jsonb_build_object('next_no', v_no, 'next_n', v_n, 'skipped', v_skip, 'last_n', v_last);
end $$;

-- ── 2) เลขล่าสุดของรอบนี้ภายใต้รูปแบบหนึ่ง — จุดเดียว (ใช้ทั้งพรีวิวและบันทึก) ─────────────────
--    p_seed_key = key ของรูปแบบที่ใช้อยู่ (ถ้ารูปแบบใหม่ยังไม่มีตัวนับ ให้นับตัวนับเดิมด้วย)
create or replace function fn_doc_last_n(p_tenant uuid, p_type text, p_entity text, p_cfg jsonb,
                                         p_date date, p_seed_key text)
returns bigint language plpgsql stable set search_path = public as $$
declare
  v_cnt bigint;
begin
  select value into v_cnt from counters
   where tenant_id = p_tenant and key = fn_doc_key(p_type, p_entity, p_cfg, true, p_date);
  if v_cnt is null and p_seed_key is not null then
    select value into v_cnt from counters where tenant_id = p_tenant and key = p_seed_key;
  end if;
  return greatest(coalesce(v_cnt, 0), fn_doc_max_n(p_tenant, p_type, p_entity, p_cfg, p_date));
end $$;
revoke execute on function fn_doc_last_n(uuid, text, text, jsonb, date, text) from public, anon, authenticated;
grant execute on function fn_doc_last_n(uuid, text, text, jsonb, date, text) to service_role;

-- ── 3) พรีวิวรูปแบบที่ยังไม่บันทึก ─────────────────────────────────────────────────
create or replace function fn_doc_numbering_preview(p_type text, p_entity text, p_cfg jsonb, p_next bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant  uuid := my_tenant();
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
  v_entity  text;
  v_err     text;
  v_cfg     jsonb;
  v_old     jsonb;
  v_old_key text;
  v_last    bigint;
  v_no      text;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if not has_cap('admin') then raise exception 'ดูรูปแบบเลขเอกสารได้เฉพาะผู้ดูแลระบบ'; end if;
  if fn_doc_default(p_type) is null then raise exception 'ไม่รู้จักชนิดเอกสาร %', coalesce(p_type, '(ว่าง)'); end if;
  v_err := fn_doc_cfg_error(p_cfg);
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  v_entity := fn_doc_entity_for(v_tenant, p_type, p_entity);
  v_cfg := fn_doc_cfg_clean(p_cfg);
  v_old := fn_doc_cfg_get(v_tenant, p_type, v_entity);
  v_old_key := fn_doc_key(p_type, v_entity, v_old, (v_old->>'configured')::boolean, v_today);
  if p_next is not null then
    if p_next < 1 then return jsonb_build_object('ok', false, 'error', 'เลขถัดไปต้องเป็น 1 ขึ้นไป'); end if;
    v_last := fn_doc_last_n(v_tenant, p_type, v_entity, v_cfg, v_today, v_old_key);
    v_no := fn_doc_no_format(v_cfg, v_today, p_next);
    return jsonb_build_object('ok', true, 'next_no', v_no, 'next_n', p_next, 'skipped', 0, 'last_n', v_last,
      'taken', p_next <= v_last or fn_doc_no_taken(v_tenant, p_type, v_entity, v_no));
  end if;
  return jsonb_build_object('ok', true, 'taken', false)
    || fn_doc_peek(v_tenant, p_type, v_entity, v_cfg, true, v_today, v_old_key);
end $$;

-- ── 4) บันทึก ─────────────────────────────────────────────────────────────────────
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

  -- ★ อ่านรูปแบบเดิม **ก่อน** เขียนทับ — ใช้ยกตัวนับ และนับเลขที่แจกไปแล้วด้วย
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
    v_last := fn_doc_last_n(v_tenant, p_type, v_entity, v_cfg, v_today, v_old_key);
    v_no := fn_doc_no_format(v_cfg, v_today, p_next);
    -- 🚨 บล็อกทั้งการบันทึก (raise → rollback รูปแบบด้วย): ต่ำกว่า/เท่าเลขล่าสุด (รวมเลขที่แจกไปแล้ว) หรือชน
    if p_next <= v_last then
      raise exception 'เลขถัดไปต้องมากกว่า % ซึ่งเป็นเลขล่าสุดที่ออกไปแล้วในรอบนี้ — ออกเลขย้อนลำดับไม่ได้',
        fn_doc_no_format(v_cfg, v_today, v_last);
    end if;
    if fn_doc_no_taken(v_tenant, p_type, v_entity, v_no) then
      raise exception 'เลข % ถูกใช้ไปแล้ว — ใส่เลขที่มากกว่านี้ หรือเว้นช่องเลขถัดไปว่างให้ระบบหาเอง', v_no;
    end if;
    insert into counters (tenant_id, key, value) values (v_tenant, v_key, p_next - 1)
    on conflict (tenant_id, key) do update set value = excluded.value;
  elsif v_key <> v_old_key then
    -- เปลี่ยนรูปแบบกลางรอบ = เดินต่อจากตัวนับเดิม (รวมเลขที่แจกไปแล้วแต่ยังไม่ถูกบันทึก)
    insert into counters (tenant_id, key, value)
    select v_tenant, v_key, value from counters where tenant_id = v_tenant and key = v_old_key
    on conflict (tenant_id, key) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'entity_id', v_entity)
    || fn_doc_peek(v_tenant, p_type, v_entity, v_cfg, true, v_today);
end $$;

notify pgrst, 'reload schema';
