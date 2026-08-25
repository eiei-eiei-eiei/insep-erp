-- ============================================================================
-- 0046 ซ่อมสะพาน "ต้นทุนสุรา (บัญชี) → รับวัตถุดิบเข้าสต็อกผลิต" (T6) — D79
--
-- 🚨 อาการที่ผู้ใช้เจอ: ลงรายจ่ายหมวด "ต้นทุนสุรา" เลือกวัตถุดิบจากดร็อปดาวน์แล้ว
--    **ไม่มีแถวโผล่ในแท็บวัตถุดิบฝั่งผลิต และไม่ขึ้นในรายงาน ภส.๐๗-๐๑/๑**
--
-- สาเหตุ (1): บล็อก forward ใน fn_save_transaction เขียนว่า
--       ... from jsonb_array_elements(p_items) it;
--    ซึ่ง `it` เป็น **ชื่อตัวแปร plpgsql ที่ประกาศไว้ข้างบน** ด้วย → PostgreSQL ตอบ
--       42702 column reference "it" is ambiguous
--    และบรรทัดนี้อยู่ **นอก** บล็อก begin/exception → error ไม่ถูกดัก
--    = ทั้งฟังก์ชัน abort → **บิลบัญชีไม่ถูกบันทึกด้วยซ้ำ** (ไม่ใช่แค่ forward พลาด)
--
--    🪤 บั๊กนี้อยู่มาตั้งแต่ 0011 และถูกคัดลอกต่อใน 0017 → เส้นทางนี้
--       **ไม่เคยทำงานสำเร็จเลยสักครั้ง** ตั้งแต่เปิดระบบ (integration_log ไม่มีแถว
--       RECEIVE_MATERIAL แม้แต่แถวเดียวใน DB จริง) — build/lint/test มองไม่เห็น
--       เพราะโค้ดอยู่ใน SQL ในฐานข้อมูล ไม่ใช่ใน TypeScript
--
-- สาเหตุ (2): fn_receive_material insert log_material โดยไม่ระบุ entity_id
--    → ตกไปที่ default my_default_entity() = **กิจการหลักเสมอ** แม้บิลจะลงกิจการที่ 2
--    (ตระกูลเดียวกับบั๊ก apply_stock_delta ที่ 0029 แก้ไปแล้ว: เอา entity จาก "แถว"
--     ไม่ใช่จาก "คนที่ล็อกอิน") → ของขึ้นผิดกิจการ = รายงานสรรพสามิตของกิจการนั้นขาด
--
-- สาเหตุ (3): แถวรายการที่กรอกแต่ราคาไม่กรอกชื่อ ก็ถูกส่งเข้า forward ด้วย
--    (buildItemInputs กรอง `itemName || exVat`) → ชื่อว่างหาไม่เจอใน master
--    → ทั้งใบ forward ล้มทั้งที่แถวที่มีชื่อถูกต้องครบ
--
-- ของแถม: fn_mig_truncate ตกตาราง log_ferment_draw (เพิ่มมาใน 0045) และ snapshots (0018)
--    ทั้งคู่มี FK มาที่ tenants แบบไม่ cascade → ลบ/รีเซ็ต tenant ล้มทันที
--    (log_ferment_draw เจอจริงตอนรัน test:tenant รอบนี้ · snapshots เป็นระเบิดเวลาแบบเดียวกัน
--     ที่รอให้ลูกค้าเคยกด "สำรองข้อมูล" สักครั้งก่อนถึงจะระเบิด)
-- ============================================================================

-- ── 1. fn_receive_material: รับ entity ของบิลมาด้วย (พารามิเตอร์เพิ่ม → ต้อง drop ก่อน) ──
-- 🪤 create or replace ที่จำนวนพารามิเตอร์ต่างกัน = สร้าง overload ตัวที่ 2 ไม่ใช่แทนที่
--    (บทเรียนเดิมจาก D69) → drop ตัวเก่าทิ้งก่อนเสมอ
drop function if exists fn_receive_material(text, date, text, text, jsonb);

create or replace function fn_receive_material(
  p_idempotency_key text, p_date date, p_doc_ref text, p_note text, p_items jsonb,
  p_entity text default null      -- ★ ใหม่: กิจการของบิล (null = กิจการหลักของคนล็อกอิน)
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  mid text;
  n int := 0;
  v_tenant uuid := my_tenant();
  v_entity text := coalesce(nullif(p_entity, ''), my_default_entity());
  v_name text;
begin
  if my_role() <> 'main' then
    raise exception 'ไม่มีสิทธิ์บันทึกรับวัตถุดิบ';
  end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if v_entity is null then raise exception 'ไม่รู้ว่าจะรับวัตถุดิบเข้ากิจการไหน'; end if;

  begin
    insert into integration_log(tenant_id, action, idempotency_key, status, payload)
    values (v_tenant, 'RECEIVE_MATERIAL', p_idempotency_key, 'ok', p_items);
  exception when unique_violation then
    return jsonb_build_object('duplicate', true);
  end;

  for it in select value from jsonb_array_elements(p_items) loop
    v_name := nullif(trim(coalesce(it ->> 'material_name', '')), '');
    if v_name is not null and (it ->> 'amount') is not null then
      -- match ด้วยชื่อเป๊ะ (trim) เหมือนเดิม — ห้าม fuzzy · จำกัดใน tenant + กิจการของบิล
      select material_id into mid from materials
        where tenant_id = v_tenant and entity_id = v_entity and trim(name) = v_name
        limit 1;
      if mid is null then
        -- อยู่คนละกิจการ = คนละเรื่องกับสะกดผิด ต้องบอกให้ต่างกัน ไม่งั้นผู้ใช้ไล่หาผิดทาง
        if exists (select 1 from materials where tenant_id = v_tenant and trim(name) = v_name) then
          raise exception 'วัตถุดิบ ''%'' มีอยู่ แต่คนละกิจการกับบิล (บิลลงกิจการ %)', v_name, v_entity;
        end if;
        raise exception 'ไม่พบชื่อวัตถุดิบ ''%'' กรุณาตรวจการสะกด', v_name;
      end if;
      insert into log_material(tenant_id, entity_id, doc_date, trans_type, material_id, amount, doc_ref, note)
      values (v_tenant, v_entity, coalesce(p_date, current_date), 'รับ', mid,
              (it ->> 'amount')::numeric, p_doc_ref, coalesce(p_note, 'รับจากระบบจัดซื้อ'));
      n := n + 1;
    end if;
  end loop;

  return jsonb_build_object('duplicate', false, 'count', n);
end $$;

-- ── 2. fn_save_transaction: แก้ alias ชนตัวแปร + ย้ายทุกอย่างเข้า begin/exception ──
-- ★ ส่วน insert transactions/transaction_items คงเดิมทุกบรรทัดจาก 0017 (contact_id)
create or replace function fn_save_transaction(
  p jsonb,
  p_items jsonb default '[]'::jsonb
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_tx_id text := next_tx_id();
  it jsonb;
  idx int := 0;
  fwd_items jsonb;
  fwd jsonb;
  warning text := null;
begin
  insert into transactions(
    tx_id, transaction_date, type, account_name, category, contact_name, contact_id, description,
    base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
    tax_invoice_no, tax_invoice_date, receipt_image_url, status, entity_id,
    ap_ar_status, due_date, source
  ) values (
    v_tx_id, _d(p,'transaction_date'), p->>'type', nullif(p->>'account_name',''), p->>'category',
    p->>'contact_name', nullif(p->>'contact_id',''), p->>'description',
    coalesce((p->>'base_amount')::numeric,0), coalesce((p->>'discount')::numeric,0),
    coalesce((p->>'amount_after_discount')::numeric,0), coalesce((p->>'vat_amount')::numeric,0),
    coalesce((p->>'wht_rate')::numeric,0), coalesce((p->>'wht_amount')::numeric,0),
    coalesce((p->>'net_amount')::numeric,0),
    nullif(p->>'tax_invoice_no',''), _d(p,'tax_invoice_date'), nullif(p->>'receipt_image_url',''),
    coalesce(nullif(p->>'status',''),'ปกติ'), p->>'entity_id',
    nullif(p->>'ap_ar_status',''), _d(p,'due_date'), coalesce(nullif(p->>'source',''),'ui')
  );

  for it in select value from jsonb_array_elements(p_items) loop
    idx := idx + 1;
    insert into transaction_items(
      item_id, tx_id, item_name, quantity, in_vat, ex_vat, total_price,
      discount_pct, discount_baht, item_category, item_job
    ) values (
      v_tx_id || '-' || lpad(idx::text,2,'0'), v_tx_id, it->>'item_name',
      coalesce((it->>'quantity')::numeric,1), coalesce((it->>'in_vat')::numeric,0),
      coalesce((it->>'ex_vat')::numeric,0), coalesce((it->>'total_price')::numeric,0),
      coalesce((it->>'discount_pct')::numeric,0), coalesce((it->>'discount_baht')::numeric,0),
      nullif(it->>'item_category',''), nullif(it->>'item_job','')
    );
  end loop;

  -- T6: forward ต้นทุนสุรา → รับวัตถุดิบเข้าสต็อกผลิต (idempotency = tx_id)
  -- คง "พฤติกรรม warning เดิม": forward พลาด → บัญชียัง commit + คืน warning (ไม่ roll back)
  -- 🚨 ทุกบรรทัดของ forward ต้องอยู่ **ใน** begin/exception นี้ รวมทั้งการประกอบ fwd_items
  --    (บั๊กเดิม: select ประกอบ items อยู่ข้างนอก → error หลุดออกไปล้มทั้งบิล)
  if coalesce((p->>'forward_material')::boolean,false)
     and jsonb_array_length(coalesce(p_items,'[]'::jsonb)) > 0 then
    begin
      -- 🪤 alias ต้องไม่ชื่อซ้ำกับตัวแปร plpgsql (`it`) ไม่งั้น 42702 ambiguous
      -- 🪤 ข้ามแถวที่ไม่ได้กรอกชื่อ (buildItemInputs ปล่อยแถวที่มีแต่ราคาผ่านมาได้)
      --    ไม่งั้นชื่อว่าง 1 แถวล้ม forward ทั้งใบ
      select coalesce(jsonb_agg(jsonb_build_object(
               'material_name', row_it.value ->> 'item_name',
               'amount', coalesce((row_it.value ->> 'quantity')::numeric, 0))), '[]'::jsonb)
        into fwd_items
        from jsonb_array_elements(p_items) as row_it
        where nullif(trim(coalesce(row_it.value ->> 'item_name', '')), '') is not null;

      fwd := fn_receive_material(
        v_tx_id, _d(p,'transaction_date'),
        case when coalesce(p->>'tax_invoice_no','') <> '' and p->>'tax_invoice_no' <> '-'
             then p->>'tax_invoice_no' else v_tx_id end,
        'รับจาก ' || coalesce(nullif(p->>'contact_name',''),'ไม่ระบุชื่อ') ||
          case when coalesce(p->>'description','') <> '' then ' (' || (p->>'description') || ')' else '' end,
        fwd_items,
        nullif(p->>'entity_id',''));
    exception when others then
      warning := 'บันทึกบัญชีสำเร็จ แต่รับวัตถุดิบเข้าสต็อกผลิตไม่ได้: ' || sqlerrm ||
                 ' — ตรวจชื่อวัตถุดิบ/เพิ่มใน master แล้วบันทึกรับเองในแอปผลิต';
    end;
  end if;

  return jsonb_build_object('ok', true, 'tx_id', v_tx_id, 'warning', warning);
end $$;

-- ── 3. fn_mig_truncate: เติม log_ferment_draw (0045) + snapshots (0018) ──────
-- 🪤 checklist เดิมของ D67/D69 อีกครั้ง: เพิ่มตารางใหม่ = ต้องไล่ "รายชื่อตารางที่ hardcode"
--    ทั้งใน SQL และ TS (fn_mig_truncate · SNAPSHOT_ORDER · backup-tables · harness)
create or replace function fn_mig_truncate(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t text;
  -- เรียงตามลำดับ FK (ลูกก่อนแม่) เพราะ delete ไม่ cascade เองเหมือน truncate
  tables text[] := array[
    'transaction_items','transactions','tax_summaries','wht_certificates',
    'log_material','log_ferment','log_distill','log_distill_run',
    'log_ferment_monitor','log_dilute','log_ferment_draw','log_product','stock_product',
    'sales_order_items','sales_orders','warehouse_stock','stock_moves','sale_menu',
    -- เงินเดือน (0040 + 0042) — ต้องมาก่อน entities ไม่งั้นติด FK
    'payroll_items','payroll_periods','employees',
    'pay_components','pay_inputs','pay_rates','pay_variables','pay_post_legs',
    'contacts','bank_accounts',
    'materials','containers','products',
    'entities',
    'app_settings','integration_log','edit_log','report_runs','counters','snapshots'
  ];
begin
  if p_tenant is null then
    raise exception 'fn_mig_truncate: ต้องระบุ tenant — ห้ามล้างข้ามลูกค้า';
  end if;
  foreach t in array tables loop
    execute format('delete from %I where tenant_id = $1', t) using p_tenant;
  end loop;
end $$;

revoke execute on function fn_mig_truncate(uuid) from public;
grant  execute on function fn_mig_truncate(uuid) to service_role;

notify pgrst, 'reload schema';
