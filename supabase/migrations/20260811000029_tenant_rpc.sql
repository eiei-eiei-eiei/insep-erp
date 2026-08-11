-- ============================================================================
-- 0029 tenant RPC — อุดฟังก์ชันที่ bypass RLS (NEXT_STEPS ข้อ 4.1 · ปิดงานฐาน multi-tenant)
--
--   ★ ตรวจแล้ว: RPC ส่วนใหญ่เป็น SECURITY INVOKER → RLS จาก 0028 กรอง tenant ให้เองแล้ว
--     (ฝั่งบัญชีทั้งชุด 0011 · fn_save_quotation/fn_update_quotation/fn_manual_stock_move
--      · fn_save_ferment/fn_close_batch) — ไม่ต้องแก้
--
--   ที่ต้องแก้จริงคือตัวที่เป็น SECURITY DEFINER เพราะมัน **bypass RLS โดยนิยาม**:
--     fn_apply_order_action · fn_void_deposit_invoice · fn_confirm_fulfillment
--     · fn_cancel_order · fn_receive_material · fn_sell_product · fn_mig_*
--
--   ช่องโหว่ที่อุด: ฟังก์ชันพวกนี้ค้นด้วยคีย์ที่คนเรียกส่งมา (p_qu_no/p_tx_id) โดยไม่กรอง
--   tenant → ลูกค้า A ส่งเลขออเดอร์ของ B เข้าไปแล้ว **แก้/ยกเลิกออเดอร์คนอื่นได้**
--   ทั้งที่ policy ใน 0028 ถูกทุกข้อ
--
--   🐛 แก้บั๊กที่เกิดจาก 0027 ด้วย: apply_stock_delta ใช้ my_default_entity()
--      → สต็อกจะไปลงกิจการหลักเสมอ แม้แถว log_product เป็นของอีกกิจการ
--      ต้องเอา entity จากแถวที่ทำให้ trigger ทำงาน ไม่ใช่จากคนที่ล็อกอิน
-- ============================================================================

-- ── 1. สต็อก: เอา tenant/entity จากแถว ไม่ใช่จากคนล็อกอิน ────────────────────
drop function if exists apply_stock_delta(text, numeric);

create or replace function apply_stock_delta(
  p_tenant uuid, p_entity text, p_product_id text, p_delta numeric
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into stock_product (tenant_id, entity_id, product_id, balance, last_updated)
  values (p_tenant, p_entity, p_product_id, p_delta, now())
  on conflict (tenant_id, entity_id, product_id) do update
    set balance = stock_product.balance + p_delta,
        last_updated = now();
end $$;

-- ทิศทาง +/- ต้องตรง isStockInbound_ เดิมเป๊ะ: บวกเฉพาะ 'รับ' ที่เหลือลบหมด (P2)
-- ★ ตรรกะเดิมทุกบรรทัด เปลี่ยนแค่ "ส่ง tenant/entity ของแถวเข้าไปด้วย"
create or replace function trg_update_stock_product() returns trigger
language plpgsql as $$
declare
  old_delta numeric := 0;
  new_delta numeric := 0;
begin
  if (tg_op in ('INSERT','UPDATE')) then
    new_delta := case when new.trans_type = 'รับ' then new.amount else -new.amount end;
  end if;
  if (tg_op in ('DELETE','UPDATE')) then
    old_delta := case when old.trans_type = 'รับ' then old.amount else -old.amount end;
  end if;

  if (tg_op = 'DELETE') then
    perform apply_stock_delta(old.tenant_id, old.entity_id, old.product_id, -old_delta);
    return old;
  elsif (tg_op = 'INSERT') then
    perform apply_stock_delta(new.tenant_id, new.entity_id, new.product_id, new_delta);
    return new;
  else  -- UPDATE
    if (old.tenant_id = new.tenant_id and old.entity_id = new.entity_id
        and old.product_id = new.product_id) then
      perform apply_stock_delta(new.tenant_id, new.entity_id, new.product_id, new_delta - old_delta);
    else
      perform apply_stock_delta(old.tenant_id, old.entity_id, old.product_id, -old_delta);
      perform apply_stock_delta(new.tenant_id, new.entity_id, new.product_id, new_delta);
    end if;
    return new;
  end if;
end $$;

-- recompute: ปกติซ่อมเฉพาะ tenant ของคนเรียก · service role/pg_cron (my_tenant() = null)
-- เรียกแบบไม่ส่งพารามิเตอร์ = ซ่อมทุก tenant ตามเดิม (pg_cron รายสัปดาห์)
-- ★ ต้อง drop ตัวเดิมก่อน ไม่งั้นมี 2 signature แล้วเรียก recompute_stock_product() กำกวม
drop function if exists recompute_stock_product();

create or replace function recompute_stock_product(p_tenant uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_t uuid := coalesce(p_tenant, my_tenant());
begin
  insert into stock_product (tenant_id, entity_id, product_id, balance, last_updated)
  select tenant_id, entity_id, product_id, 0, now() from products
  where (v_t is null or tenant_id = v_t)
  on conflict (tenant_id, entity_id, product_id)
    do update set balance = 0, last_updated = now();

  update stock_product s
    set balance = coalesce(agg.bal, 0), last_updated = now()
  from (
    select tenant_id, entity_id, product_id,
           sum(case when trans_type = 'รับ' then amount else -amount end) as bal
    from log_product
    where (v_t is null or tenant_id = v_t)
    group by tenant_id, entity_id, product_id
  ) agg
  where s.tenant_id = agg.tenant_id
    and s.entity_id = agg.entity_id
    and s.product_id = agg.product_id
    and (v_t is null or s.tenant_id = v_t);
end $$;

-- ── 2. audit: เอา tenant จากแถวที่ถูกแก้ ─────────────────────────────────────
--   ของเดิมพึ่ง default my_tenant() ซึ่งเป็น null ตอน service role เขียน (import/restore)
--   → edit_log insert ไม่ผ่าน = การเขียนทั้งรายการ fail ตามไปด้วย
create or replace function trg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pk_col text := tg_argv[0];
  rec jsonb;
begin
  if (tg_op = 'DELETE') then rec := to_jsonb(old); else rec := to_jsonb(new); end if;
  insert into edit_log (tenant_id, table_name, row_pk, action, before, after, user_id)
  values (
    (rec ->> 'tenant_id')::uuid,
    tg_table_name,
    rec ->> pk_col,
    lower(tg_op),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) end,
    auth.uid()
  );
  return null;  -- after trigger
end $$;

-- ── 3. ผลิต: กรอง tenant ตอนค้น master ───────────────────────────────────────
create or replace function fn_receive_material(
  p_idempotency_key text, p_date date, p_doc_ref text, p_note text, p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it jsonb; mid text; n int := 0; v_tenant uuid := my_tenant();
begin
  if my_role() <> 'main' then
    raise exception 'ไม่มีสิทธิ์บันทึกรับวัตถุดิบ';
  end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;

  begin
    insert into integration_log(tenant_id, action, idempotency_key, status, payload)
    values (v_tenant, 'RECEIVE_MATERIAL', p_idempotency_key, 'ok', p_items);
  exception when unique_violation then
    return jsonb_build_object('duplicate', true);
  end;

  for it in select value from jsonb_array_elements(p_items) loop
    if (it->>'material_name') is not null and (it->>'amount') is not null then
      -- match ด้วยชื่อเป๊ะ (trim) เหมือนเดิม — ห้าม fuzzy · ★ จำกัดใน tenant ตัวเอง
      select material_id into mid from materials
        where tenant_id = v_tenant and trim(name) = trim(it->>'material_name') limit 1;
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

create or replace function fn_sell_product(
  p_idempotency_key text, p_date date, p_trans_type text, p_note text, p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it jsonb; n int := 0; v_tenant uuid := my_tenant();
begin
  if my_role() not in ('main','sale') then
    raise exception 'ไม่มีสิทธิ์ตัดสต็อกขาย';
  end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;

  begin
    insert into integration_log(tenant_id, action, idempotency_key, status, message, payload)
    values (v_tenant, 'SELL_PRODUCT', p_idempotency_key, 'ok', 'ตัดสต็อกขาย', p_items);
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

-- ── 4. ขาย: ★ จุดที่อันตรายที่สุด — ค้นด้วย qu_no ที่คนเรียกส่งมา ──────────────
create or replace function fn_apply_order_action(p_qu_no text, p_update jsonb, p_revenue jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tx_id text;
  v_dup boolean := false;
  it jsonb; idx int := 0;
  v_tenant uuid := my_tenant();
begin
  if my_role() not in ('main','sale') then raise exception 'ไม่มีสิทธิ์บันทึกการขาย'; end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;

  update sales_orders set
    status              = coalesce(p_update->>'status', status),
    deposit             = coalesce((p_update->>'deposit')::numeric, deposit),
    outstanding_balance = coalesce((p_update->>'outstandingBalance')::numeric, outstanding_balance),
    due_date            = coalesce(_d(p_update,'dueDate'), due_date),
    payment_method      = coalesce(nullif(p_update->>'paymentMethod',''), payment_method),
    inv_no              = coalesce(nullif(p_update->>'invNo',''), inv_no),
    tax_no1             = coalesce(nullif(p_update->>'taxNo1',''), tax_no1),
    tax_no2             = coalesce(nullif(p_update->>'taxNo2',''), tax_no2),
    check_detail1       = coalesce(p_update->>'checkDetail1', check_detail1),
    check_detail2       = coalesce(p_update->>'checkDetail2', check_detail2),
    doc_to_print        = coalesce(nullif(p_update->>'docToPrint',''), doc_to_print),
    next_status         = coalesce(nullif(p_update->>'nextStatus',''), next_status),
    doc_date1           = coalesce(_d(p_update,'docDate1'), doc_date1),
    doc_date2           = coalesce(_d(p_update,'docDate2'), doc_date2),
    dep_inv_no          = coalesce(nullif(p_update->>'depInvNo',''), dep_inv_no),
    dep_inv_date        = coalesce(_d(p_update,'depInvDate'), dep_inv_date),
    dep_inv_amount      = coalesce((p_update->>'depInvAmount')::numeric, dep_inv_amount),
    dep_due_date        = coalesce(_d(p_update,'depDueDate'), dep_due_date)
  where qu_no = p_qu_no and tenant_id = v_tenant;      -- ★ กันแก้ออเดอร์ของลูกค้าเจ้าอื่น
  if not found then raise exception 'ไม่พบออเดอร์ %', p_qu_no; end if;

  if p_revenue is not null and p_revenue <> 'null'::jsonb then
    -- idempotency: RECEIVE_REVENUE key ชน unique = เคยลงบัญชีแล้ว → duplicate (ไม่ลงซ้ำ)
    begin
      insert into integration_log(tenant_id, action, idempotency_key, status, message, payload)
      values (v_tenant, 'RECEIVE_REVENUE', p_revenue->>'idempotencyKey', 'ok',
              'รายรับจากขาย ' || p_qu_no, p_revenue);
    exception when unique_violation then
      v_dup := true;
    end;

    if not v_dup then
      v_tx_id := next_tx_id();
      insert into transactions(
        tenant_id, tx_id, transaction_date, type, account_name, category, contact_name, contact_id,
        description, base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount,
        net_amount, tax_invoice_no, tax_invoice_date, status, entity_id, idempotency_key, source
      ) values (
        v_tenant, v_tx_id, _d(p_revenue,'taxInvoiceDate'), 'รายรับ',
        nullif(p_revenue->>'accountName',''), p_revenue->>'category', p_revenue->>'contactName',
        nullif(p_revenue->>'contactId',''),
        p_revenue->>'description',
        coalesce((p_revenue->>'baseAmount')::numeric,0), coalesce((p_revenue->>'discount')::numeric,0),
        coalesce((p_revenue->>'amountAfterDiscount')::numeric,0), coalesce((p_revenue->>'vatAmount')::numeric,0),
        coalesce((p_revenue->>'whtRate')::numeric,0), coalesce((p_revenue->>'whtAmount')::numeric,0),
        coalesce((p_revenue->>'netAmount')::numeric,0),
        nullif(p_revenue->>'taxInvoiceNo',''), _d(p_revenue,'taxInvoiceDate'),
        'ปกติ', p_revenue->>'entityId', p_revenue->>'idempotencyKey', 'sales'
      );

      for it in select value from jsonb_array_elements(coalesce(p_revenue->'items','[]'::jsonb)) loop
        idx := idx + 1;
        insert into transaction_items(tenant_id, item_id, tx_id, item_name, quantity, in_vat, ex_vat, total_price)
        values (v_tenant, v_tx_id || '-' || lpad(idx::text,2,'0'), v_tx_id, it->>'itemName',
                coalesce((it->>'quantity')::numeric,1), coalesce((it->>'inVat')::numeric,0),
                coalesce((it->>'exVat')::numeric,0), coalesce((it->>'totalPrice')::numeric,0));
      end loop;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'duplicate', v_dup, 'tx_id', v_tx_id);
end $$;

create or replace function fn_void_deposit_invoice(p_qu_no text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_status text; v_old text; v_tenant uuid := my_tenant();
begin
  if my_role() <> 'main' then raise exception 'ไม่มีสิทธิ์ยกเลิกใบแจ้งหนี้มัดจำ (เฉพาะ main)'; end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;

  select status, dep_inv_no into v_status, v_old from sales_orders
    where qu_no = p_qu_no and tenant_id = v_tenant;
  if v_status is null then return jsonb_build_object('ok', false, 'error', 'ไม่พบออเดอร์ ' || p_qu_no); end if;
  if v_status <> 'รอชำระมัดจำ' then
    return jsonb_build_object('ok', false, 'error', 'ยกเลิกได้เฉพาะออเดอร์ที่สถานะ "รอชำระมัดจำ" (ตอนนี้: ' || v_status || ')');
  end if;

  update sales_orders set
    status = 'รอคอนเฟิร์ม',
    dep_inv_no = null, dep_inv_date = null, dep_inv_amount = 0, dep_due_date = null,
    doc_to_print = null, next_status = null
  where qu_no = p_qu_no and tenant_id = v_tenant;

  return jsonb_build_object('ok', true, 'dep_inv_no', v_old);
end $$;

create or replace function fn_confirm_fulfillment(p_qu_no text, p_user text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order sales_orders%rowtype;
  v_next text; v_is_export boolean := false; v_trans_type text;
  it record;
  v_real numeric; v_before numeric; v_after numeric;
  v_liquor jsonb := '[]'::jsonb;
  v_summary jsonb := '[]'::jsonb;
  v_dup boolean := false; v_warning text := null;
  li jsonb;
  v_tenant uuid := my_tenant();
begin
  if my_role() not in ('main','warehouse') then raise exception 'ไม่มีสิทธิ์จัดส่ง'; end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;

  select * into v_order from sales_orders
    where qu_no = p_qu_no and tenant_id = v_tenant and status = 'รอคลังจัดส่ง' for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ออเดอร์นี้ถูกจัดส่งไปแล้ว หรือไม่พบข้อมูลในระบบ');
  end if;
  v_next := coalesce(v_order.next_status, 'ส่งของแล้ว');

  select coalesce(is_export,false) into v_is_export from contacts
    where contact_id = v_order.customer_id and tenant_id = v_tenant;
  v_trans_type := case when v_is_export then 'จำหน่ายต่างประเทศ' else 'จ่าย' end;

  for it in
    select soi.item_name, soi.qty,
           sm.category, sm.product_id, coalesce(sm.multiplier,1) as multiplier
    from sales_order_items soi
    left join sale_menu sm on sm.tenant_id = soi.tenant_id
                          and sm.entity_id = v_order.entity_id
                          and trim(sm.menu_name) = trim(soi.item_name)
    where soi.qu_no = p_qu_no and soi.tenant_id = v_tenant
  loop
    if it.product_id is null or trim(it.product_id) = '' then continue; end if;
    v_real := it.qty * it.multiplier;

    select qty into v_before from warehouse_stock
      where item_code = trim(it.product_id)
        and tenant_id = v_tenant and entity_id = v_order.entity_id;
    if found then
      v_after := coalesce(v_before,0) - v_real;
      update warehouse_stock set qty = v_after
        where item_code = trim(it.product_id)
          and tenant_id = v_tenant and entity_id = v_order.entity_id;
      insert into stock_moves(tenant_id, entity_id, item_code, item_name, qty_before, action, qty,
                              ref_no, qty_after, user_name, remarks)
      values (v_tenant, v_order.entity_id, trim(it.product_id),
              (select item_name from warehouse_stock
                 where item_code = trim(it.product_id)
                   and tenant_id = v_tenant and entity_id = v_order.entity_id),
              coalesce(v_before,0), 'OUT', v_real, coalesce(v_order.order_no, p_qu_no),
              v_after, p_user, 'จัดส่งออเดอร์ B2B');
      v_summary := v_summary || jsonb_build_object(
        'name', (select coalesce(item_name, it.item_name) from warehouse_stock
                   where item_code = trim(it.product_id)
                     and tenant_id = v_tenant and entity_id = v_order.entity_id),
        'remaining', v_after);
    end if;

    if it.category = 'สุรา' and v_real > 0 then
      v_liquor := v_liquor || jsonb_build_object('product_id', trim(it.product_id), 'amount', v_real);
    end if;
  end loop;

  if jsonb_array_length(v_liquor) > 0 then
    begin
      insert into integration_log(tenant_id, action, idempotency_key, status, message, payload)
      values (v_tenant, 'SELL_PRODUCT', coalesce(v_order.order_no, p_qu_no), 'ok', 'ตัดสต็อกขาย', v_liquor);
      for li in select value from jsonb_array_elements(v_liquor) loop
        insert into log_product(tenant_id, entity_id, doc_date, trans_type, product_id, amount, note)
        values (v_tenant, v_order.entity_id, current_date, v_trans_type,
                li->>'product_id', (li->>'amount')::numeric,
                'ลูกค้า: ' || coalesce(v_order.customer_name,'') || ' (' || coalesce(v_order.order_no, p_qu_no) || ')');
      end loop;
    exception when unique_violation then
      v_dup := true;   -- เคยตัดสต็อกผลิตของ order นี้แล้ว → ข้าม (retry ปลอดภัย)
    end;
  end if;

  update sales_orders set status = v_next where qu_no = p_qu_no and tenant_id = v_tenant;

  return jsonb_build_object('ok', true, 'newStatus', v_next, 'duplicate', v_dup,
    'warning', v_warning, 'summary', v_summary,
    'customerName', v_order.customer_name, 'orderNo', coalesce(v_order.order_no, p_qu_no));
end $$;

create or replace function fn_cancel_order(p_qu_no text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order sales_orders%rowtype;
  v_ref text; mv record; v_before numeric; v_after numeric;
  v_reversed int := 0;
  v_tenant uuid := my_tenant();
begin
  if my_role() <> 'main' then raise exception 'เฉพาะ main ยกเลิกออเดอร์ได้'; end if;
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
    insert into log_product(tenant_id, entity_id, doc_date, trans_type, product_id, amount, note)
    select v_tenant, v_order.entity_id, current_date, 'รับ',
           li->>'product_id', (li->>'amount')::numeric,
           'คืนสต็อก: ยกเลิกออเดอร์ ' || v_ref
    from integration_log, jsonb_array_elements(payload) li
    where tenant_id = v_tenant and action='SELL_PRODUCT'
      and idempotency_key = v_ref and status='ok';

    update integration_log set status='duplicate', message='reversed by cancel'
      where tenant_id = v_tenant and action='SELL_PRODUCT'
        and idempotency_key = v_ref and status='ok';
  end if;

  update sales_orders set status = 'ยกเลิก', outstanding_balance = 0
    where qu_no = p_qu_no and tenant_id = v_tenant;

  return jsonb_build_object('ok', true, 'reversed_stock', v_reversed);
end $$;

-- ── 5. migration helper: ต้องรับ tenant เพราะเรียกด้วย service role (my_tenant() = null) ──
--   ★ ของเดิม truncate ทั้งตาราง = ล้างข้อมูลลูกค้าทุกเจ้า
drop function if exists fn_mig_truncate();

create or replace function fn_mig_truncate(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t text;
  -- เรียงตามลำดับ FK (ลูกก่อนแม่) เพราะ delete ไม่ cascade เองเหมือน truncate
  tables text[] := array[
    'transaction_items','transactions','tax_summaries','wht_certificates','scan_log',
    'log_material','log_ferment','log_distill','log_distill_run',
    'log_ferment_monitor','log_dilute','log_product','stock_product',
    'sales_order_items','sales_orders','warehouse_stock','stock_moves','sale_menu',
    'contacts','bank_accounts',
    'materials','containers','products',
    'entities',
    'app_settings','integration_log','edit_log','report_runs','counters'
  ];
begin
  if p_tenant is null then
    raise exception 'fn_mig_truncate: ต้องระบุ tenant — ห้ามล้างข้ามลูกค้า';
  end if;
  foreach t in array tables loop
    execute format('delete from %I where tenant_id = $1', t) using p_tenant;
  end loop;
end $$;

drop function if exists fn_mig_recompute_stock();

create or replace function fn_mig_recompute_stock(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_tenant is null then
    raise exception 'fn_mig_recompute_stock: ต้องระบุ tenant';
  end if;
  perform recompute_stock_product(p_tenant);
end $$;

-- ⚠️ fn_mig_set_triggers ยังปิด trigger ทั้งตาราง (Postgres ปิดเป็นราย tenant ไม่ได้)
--    → import ของลูกค้ารายหนึ่งจะทำให้ audit ของรายอื่นหายไปในช่วงนั้น
--    กติกาใช้งาน: รันตอน provision ลูกค้าใหม่เท่านั้น ห้ามรันบนระบบที่มีคนใช้อยู่
comment on function fn_mig_set_triggers(boolean) is
  '⚠️ ปิด trigger ทั้งตาราง กระทบทุก tenant — ใช้ตอน provision ลูกค้าใหม่เท่านั้น';

revoke execute on function fn_mig_truncate(uuid)        from public;
revoke execute on function fn_mig_recompute_stock(uuid) from public;
grant  execute on function fn_mig_truncate(uuid)        to service_role;
grant  execute on function fn_mig_recompute_stock(uuid) to service_role;

notify pgrst, 'reload schema';
