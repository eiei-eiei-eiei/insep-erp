-- ============================================================================
-- 0010 production RPC — งานที่ต้อง atomic ข้ามตาราง / idempotent (MIGRATION_PLAN sec 4.2, 6.1)
--   fn_save_ferment   (P10) หมัก 1 แถว + เบิกวัตถุดิบ auto ใน tx เดียว
--   fn_close_batch    (P3)  ปิด batch = log_distill 1 แถว (unique batch กันซ้ำ)
--   fn_sell_product          idempotent ตัดสต็อกจากการขาย (integration_log unique)
--   fn_receive_material      บัญชี→ผลิต match ชื่อวัตถุดิบเป๊ะ + idempotency = tx_id
-- ============================================================================

-- ── P10: บันทึกหมัก + เบิกวัตถุดิบอัตโนมัติ (SheetData.js saveTransaction('ferment')) ──
-- SECURITY INVOKER → RLS บังคับ main เขียนเองอยู่แล้ว
create or replace function fn_save_ferment(
  p_date date,
  p_product_name text,
  p_batch text,
  p_container_id text,
  p_container_qty numeric,
  p_materials jsonb              -- [{"material_id":"M001","amount":100}, ...] · ตัวแรก = วัตถุดิบหลัก
) returns jsonb
language plpgsql set search_path = public as $$
declare
  mat_ids text;
  mat_amounts text;
  it jsonb;
begin
  -- comma string ตามเดิม (fidelity P4: ค่าแรกของ list = ฐานคิดส่า) — คงลำดับด้วย ordinality
  select string_agg(x->>'material_id', ', ' order by ord),
         string_agg(x->>'amount', ', ' order by ord)
    into mat_ids, mat_amounts
  from jsonb_array_elements(p_materials) with ordinality as t(x, ord);

  insert into log_ferment(ferment_date, product_name, batch, container_id, container_qty,
                          material_ids, material_amounts)
  values (p_date, p_product_name, p_batch, p_container_id, p_container_qty, mat_ids, mat_amounts);

  -- เบิกวัตถุดิบไปหมัก (log_material 'จ่าย') ต่อวัตถุดิบ — note/doc_ref ตามเดิมเป๊ะ
  for it in select value from jsonb_array_elements(p_materials) loop
    if (it->>'material_id') is not null and (it->>'amount') is not null then
      insert into log_material(doc_date, trans_type, material_id, amount, doc_ref, note)
      values (p_date, 'จ่าย', it->>'material_id', (it->>'amount')::numeric,
              p_batch, 'เบิกไปหมัก (อัตโนมัติ)');
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'batch', p_batch);
end $$;

-- ── P3: ปิด batch = log_distill 1 แถว (unique(batch) กันหักส่าซ้ำ) ────────────────────
create or replace function fn_close_batch(
  p_date date, p_product_name text, p_batch text, p_vol numeric, p_abv numeric
) returns jsonb
language plpgsql set search_path = public as $$
begin
  insert into log_distill(distill_date, product_name, batch, vol, abv)
  values (p_date, p_product_name, p_batch, p_vol, p_abv);
  return jsonb_build_object('ok', true, 'batch', p_batch);
exception when unique_violation then
  return jsonb_build_object('ok', false,
    'error', 'batch "'||p_batch||'" ปิดไปแล้ว (1 batch = 1 แถว ตามกฎ ภส.)');
end $$;

-- ── ขาย→ผลิต SELL_PRODUCT: idempotent ตัดสต็อก (Api.js doPost) ──────────────────────
-- SECURITY DEFINER (bypass RLS log_product/integration_log) + guard role ('main'/'sale')
create or replace function fn_sell_product(
  p_idempotency_key text,
  p_date date,
  p_trans_type text,
  p_note text,
  p_items jsonb                  -- [{"product_id":"P001","amount":10}, ...]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it jsonb; n int := 0;
begin
  if my_role() not in ('main','sale') then
    raise exception 'ไม่มีสิทธิ์ตัดสต็อกขาย';
  end if;

  -- idempotency: insert 'ok' ชน unique = เคย process แล้ว → duplicate (แทน isIdempotentDuplicate_)
  begin
    insert into integration_log(action, idempotency_key, status, message, payload)
    values ('SELL_PRODUCT', p_idempotency_key, 'ok',
            'ตัดสต็อกขาย', p_items);
  exception when unique_violation then
    return jsonb_build_object('duplicate', true,
      'message', 'ข้ามบันทึกซ้ำ: '||coalesce(p_idempotency_key,''));
  end;

  for it in select value from jsonb_array_elements(p_items) loop
    if (it->>'product_id') is not null and (it->>'amount') is not null then
      insert into log_product(doc_date, trans_type, product_id, amount, note)
      values (coalesce(p_date, current_date), coalesce(p_trans_type, 'จ่าย'),
              it->>'product_id', (it->>'amount')::numeric, p_note);
      n := n + 1;
    end if;
  end loop;

  return jsonb_build_object('duplicate', false, 'count', n);
end $$;

-- ── บัญชี→ผลิต RECEIVE_MATERIAL: match ชื่อวัตถุดิบเป๊ะ + idempotency = tx_id ──────────
create or replace function fn_receive_material(
  p_idempotency_key text,       -- = tx_id ฝั่งบัญชี (กันซ้ำโดยธรรมชาติ)
  p_date date,
  p_doc_ref text,
  p_note text,
  p_items jsonb                 -- [{"material_name":"ข้าวเหนียว","amount":50}, ...]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it jsonb; mid text; n int := 0;
begin
  if my_role() <> 'main' then
    raise exception 'ไม่มีสิทธิ์บันทึกรับวัตถุดิบ';
  end if;

  begin
    insert into integration_log(action, idempotency_key, status, payload)
    values ('RECEIVE_MATERIAL', p_idempotency_key, 'ok', p_items);
  exception when unique_violation then
    return jsonb_build_object('duplicate', true);
  end;

  for it in select value from jsonb_array_elements(p_items) loop
    if (it->>'material_name') is not null and (it->>'amount') is not null then
      -- match ด้วยชื่อเป๊ะ (trim) เหมือนเดิม — ห้าม fuzzy
      select material_id into mid from materials
        where trim(name) = trim(it->>'material_name') limit 1;
      if mid is null then
        raise exception 'ไม่พบชื่อวัตถุดิบ ''%'' กรุณาตรวจการสะกด', it->>'material_name';
      end if;
      insert into log_material(doc_date, trans_type, material_id, amount, doc_ref, note)
      values (coalesce(p_date, current_date), 'รับ', mid, (it->>'amount')::numeric,
              p_doc_ref, coalesce(p_note, 'รับจากระบบจัดซื้อ'));
      n := n + 1;
    end if;
  end loop;

  return jsonb_build_object('duplicate', false, 'count', n);
end $$;
