-- ============================================================================
-- 0013 sales RPC — โดเมนขาย (MIGRATION_PLAN sec 4.2, 6.3 · FLOW_REDESIGN sec 4)
--   fn_next_sales_doc        เลขเอกสาร QU/ORD/INV/TAX รูปแบบเดิม {prefix}{yyMMdd}-{NNN}
--   fn_save_quotation   (S8) สร้าง QU+ORD + items (quExpire +15)
--   fn_update_quotation (S8) แก้ใบเสนอราคา (เฉพาะ 'รอคอนเฟิร์ม') = delete+insert items
--   fn_apply_order_action(S2) atomic: update ออเดอร์ + RECEIVE_REVENUE (idempotent) — money จาก lib
--   fn_confirm_fulfillment(S3) คลังจัดส่ง: ตัด warehouse_stock + stock_moves + SELL_PRODUCT สุรา
--   fn_manual_stock_move     ปรับสต็อกทั่วไป manual (IN/OUT/ADJUST)
--   fn_cancel_order          ยกเลิกออเดอร์ + ย้อน side effect (FLOW sec 10.1)
--
-- money ทุกตัวคำนวณจาก lib/sales (client) แล้วส่งค่ามาเก็บ — เหมือน pattern บัญชี (0011)
-- ============================================================================

-- ── config: บัญชีรับเงิน + กิจการ ของรายรับขาย (ย้าย hardcode "กสิกร insep" → app_settings) ──
alter table app_settings drop constraint if exists app_settings_kind_check;
alter table app_settings add constraint app_settings_kind_check
  check (kind in ('expense_cat','income_cat','wht_rate','tax_account',
                  'sales_revenue_account','sales_revenue_entity'));

-- ── เลขเอกสารขาย: {prefix}{yyMMdd}-{NNN} reset รายวัน (แทน getNextSerial/PropertiesService) ──
-- key ใน counters = '{prefix}-{yyMMdd}' (แยกจาก TR/TRF บัญชี) · pad 3 ตามเดิม
create or replace function fn_next_sales_doc(p_prefix text) returns text
language sql security definer set search_path = public as $$
  select p_prefix || to_char(current_date,'YYMMDD') || '-' ||
         lpad(next_serial(p_prefix || '-' || to_char(current_date,'YYMMDD'))::text, 3, '0');
$$;

-- ── S8: สร้างใบเสนอราคา (Quotation.gs saveB2BQuotation) ──────────────────────
-- p = { customer_id, customer_name, sale_name, sub_total, discount, sub_discount,
--       vat_amount, grand_total, net_payable, wht_percent, wht_amount, remarks, category }
-- p_items = [{ name, qty, price }]
create or replace function fn_save_quotation(p jsonb, p_items jsonb default '[]'::jsonb)
returns jsonb
language plpgsql set search_path = public as $$
declare
  v_qu text := fn_next_sales_doc('QU');
  v_ord text := fn_next_sales_doc('ORD');
  v_exp date := current_date + 15;   -- quExpire +15 วัน
  it jsonb;
begin
  insert into sales_orders(
    qu_no, customer_id, customer_name, sale_name, qu_expire,
    sub_total, discount, sub_discount, vat_amount, grand_total,
    order_no, status, deposit, outstanding_balance,
    remarks, wht_percent, wht_amount, net_payable, category
  ) values (
    v_qu, nullif(p->>'customer_id',''), p->>'customer_name', nullif(p->>'sale_name',''), v_exp,
    coalesce((p->>'sub_total')::numeric,0), coalesce((p->>'discount')::numeric,0),
    coalesce((p->>'sub_discount')::numeric,0), coalesce((p->>'vat_amount')::numeric,0),
    coalesce((p->>'grand_total')::numeric,0),
    v_ord, 'รอคอนเฟิร์ม', 0,
    coalesce(nullif(p->>'net_payable','')::numeric, (p->>'grand_total')::numeric, 0),
    nullif(p->>'remarks',''), coalesce((p->>'wht_percent')::numeric,0),
    coalesce((p->>'wht_amount')::numeric,0),
    coalesce(nullif(p->>'net_payable','')::numeric, (p->>'grand_total')::numeric, 0),
    coalesce(nullif(p->>'category',''),'รายได้ค่าสินค้า')
  );

  for it in select value from jsonb_array_elements(p_items) loop
    insert into sales_order_items(qu_no, item_name, qty, price)
    values (v_qu, it->>'name', coalesce((it->>'qty')::numeric,0), coalesce((it->>'price')::numeric,0));
  end loop;

  return jsonb_build_object('ok', true, 'qu_no', v_qu, 'order_no', v_ord,
    'qu_expire', to_char(v_exp,'DD/MM/') || (extract(year from v_exp)::int + 543)::text);
end $$;

-- ── S8: แก้ใบเสนอราคา (Quotation.gs updateB2BQuotation) — เฉพาะ 'รอคอนเฟิร์ม' ─────
create or replace function fn_update_quotation(p_qu_no text, p jsonb, p_items jsonb default '[]'::jsonb)
returns jsonb
language plpgsql set search_path = public as $$
declare v_status text; it jsonb;
begin
  select status into v_status from sales_orders where qu_no = p_qu_no for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบใบเสนอราคา ' || p_qu_no); end if;
  if v_status <> 'รอคอนเฟิร์ม' then
    return jsonb_build_object('ok', false, 'error', 'แก้ไขไม่ได้ — สถานะปัจจุบันคือ "' || v_status || '"');
  end if;

  update sales_orders set
    sale_name = coalesce(nullif(p->>'sale_name',''), sale_name),
    sub_total = coalesce((p->>'sub_total')::numeric,0),
    discount = coalesce((p->>'discount')::numeric,0),
    sub_discount = coalesce((p->>'sub_discount')::numeric,0),
    vat_amount = coalesce((p->>'vat_amount')::numeric,0),
    grand_total = coalesce((p->>'grand_total')::numeric,0),
    outstanding_balance = coalesce(nullif(p->>'net_payable','')::numeric, (p->>'grand_total')::numeric, 0),
    remarks = nullif(p->>'remarks',''),
    wht_percent = coalesce((p->>'wht_percent')::numeric,0),
    wht_amount = coalesce((p->>'wht_amount')::numeric,0),
    net_payable = coalesce(nullif(p->>'net_payable','')::numeric, (p->>'grand_total')::numeric, 0),
    category = coalesce(nullif(p->>'category',''),'รายได้ค่าสินค้า')
  where qu_no = p_qu_no;

  delete from sales_order_items where qu_no = p_qu_no;
  for it in select value from jsonb_array_elements(p_items) loop
    insert into sales_order_items(qu_no, item_name, qty, price)
    values (p_qu_no, it->>'name', coalesce((it->>'qty')::numeric,0), coalesce((it->>'price')::numeric,0));
  end loop;

  return jsonb_build_object('ok', true, 'qu_no', p_qu_no);
end $$;

-- ── S2: apply order action — atomic update ออเดอร์ + RECEIVE_REVENUE (idempotent) ──
-- p_update = OrderUpdate (lib/sales/orders) — ฟิลด์ที่ต้องเขียนลง sales_orders
-- p_revenue = RevenuePayload | null — ถ้ามี = ลง transactions (source='sales') กันซ้ำด้วย idempotency_key
-- SECURITY DEFINER + guard (main/sale) เพราะ RLS transactions = main เท่านั้น
create or replace function fn_apply_order_action(p_qu_no text, p_update jsonb, p_revenue jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tx_id text;
  v_dup boolean := false;
  it jsonb; idx int := 0;
begin
  if my_role() not in ('main','sale') then raise exception 'ไม่มีสิทธิ์บันทึกการขาย'; end if;

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
    doc_date2           = coalesce(_d(p_update,'docDate2'), doc_date2)
  where qu_no = p_qu_no;
  if not found then raise exception 'ไม่พบออเดอร์ %', p_qu_no; end if;

  if p_revenue is not null and p_revenue <> 'null'::jsonb then
    -- idempotency: RECEIVE_REVENUE key ชน unique = เคยลงบัญชีแล้ว → duplicate (ไม่ลงซ้ำ)
    begin
      insert into integration_log(action, idempotency_key, status, message, payload)
      values ('RECEIVE_REVENUE', p_revenue->>'idempotencyKey', 'ok',
              'รายรับจากขาย ' || p_qu_no, p_revenue);
    exception when unique_violation then
      v_dup := true;
    end;

    if not v_dup then
      v_tx_id := next_tx_id();
      insert into transactions(
        tx_id, transaction_date, type, account_name, category, contact_name, description,
        base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
        tax_invoice_no, tax_invoice_date, status, entity_id, idempotency_key, source
      ) values (
        v_tx_id, _d(p_revenue,'taxInvoiceDate'), 'รายรับ',
        nullif(p_revenue->>'accountName',''), p_revenue->>'category', p_revenue->>'contactName',
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
        insert into transaction_items(item_id, tx_id, item_name, quantity, in_vat, ex_vat, total_price)
        values (v_tx_id || '-' || lpad(idx::text,2,'0'), v_tx_id, it->>'itemName',
                coalesce((it->>'quantity')::numeric,1), coalesce((it->>'inVat')::numeric,0),
                coalesce((it->>'exVat')::numeric,0), coalesce((it->>'totalPrice')::numeric,0));
      end loop;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'duplicate', v_dup, 'tx_id', v_tx_id);
end $$;

-- ── S3: คลังยืนยันจัดส่ง — ตัดสต็อก + SELL_PRODUCT สุรา (Warehouse.gs) ──────────
-- SECURITY DEFINER + guard (main/warehouse) · SELL_PRODUCT inline (role warehouse ยิงได้)
create or replace function fn_confirm_fulfillment(p_qu_no text, p_user text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order sales_orders%rowtype;
  v_next text; v_is_export boolean := false; v_trans_type text;
  it record; m record;
  v_real numeric; v_before numeric; v_after numeric;
  v_liquor jsonb := '[]'::jsonb;
  v_summary jsonb := '[]'::jsonb;
  v_dup boolean := false; v_warning text := null;
  li jsonb;
begin
  if my_role() not in ('main','warehouse') then raise exception 'ไม่มีสิทธิ์จัดส่ง'; end if;

  select * into v_order from sales_orders where qu_no = p_qu_no and status = 'รอคลังจัดส่ง' for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ออเดอร์นี้ถูกจัดส่งไปแล้ว หรือไม่พบข้อมูลในระบบ');
  end if;
  v_next := coalesce(v_order.next_status, 'ส่งของแล้ว');

  select coalesce(is_export,false) into v_is_export from contacts where contact_id = v_order.customer_id;
  v_trans_type := case when v_is_export then 'จำหน่ายต่างประเทศ' else 'จ่าย' end;

  -- ตัดสต็อกทีละรายการ (join menu หา category/product_id/multiplier)
  for it in
    select soi.item_name, soi.qty,
           sm.category, sm.product_id, coalesce(sm.multiplier,1) as multiplier
    from sales_order_items soi
    left join sale_menu sm on trim(sm.menu_name) = trim(soi.item_name)
    where soi.qu_no = p_qu_no
  loop
    -- item ไม่มี mapping/code ว่าง → ข้าม (เหมือนเดิม)
    if it.product_id is null or trim(it.product_id) = '' then continue; end if;
    v_real := it.qty * it.multiplier;

    -- ตัด warehouse_stock (ถ้ามีรายการ) + stock_moves OUT
    select qty into v_before from warehouse_stock where item_code = trim(it.product_id);
    if found then
      v_after := coalesce(v_before,0) - v_real;
      update warehouse_stock set qty = v_after where item_code = trim(it.product_id);
      insert into stock_moves(item_code, item_name, qty_before, action, qty, ref_no, qty_after, user_name, remarks)
      values (trim(it.product_id),
              (select item_name from warehouse_stock where item_code = trim(it.product_id)),
              coalesce(v_before,0), 'OUT', v_real, coalesce(v_order.order_no, p_qu_no), v_after, p_user, 'จัดส่งออเดอร์ B2B');
      v_summary := v_summary || jsonb_build_object(
        'name', (select coalesce(item_name, it.item_name) from warehouse_stock where item_code = trim(it.product_id)),
        'remaining', v_after);
    end if;

    -- สุรา: ยิงตัดสต็อกผลิตเสมอ (แม้ไม่มีใน warehouse_stock)
    if it.category = 'สุรา' and v_real > 0 then
      v_liquor := v_liquor || jsonb_build_object('product_id', trim(it.product_id), 'amount', v_real);
    end if;
  end loop;

  -- SELL_PRODUCT (inline, idempotent ด้วย integration_log · key = order_no) — role warehouse ยิงได้
  if jsonb_array_length(v_liquor) > 0 then
    begin
      insert into integration_log(action, idempotency_key, status, message, payload)
      values ('SELL_PRODUCT', coalesce(v_order.order_no, p_qu_no), 'ok', 'ตัดสต็อกขาย', v_liquor);
      for li in select value from jsonb_array_elements(v_liquor) loop
        insert into log_product(doc_date, trans_type, product_id, amount, note)
        values (current_date, v_trans_type, li->>'product_id', (li->>'amount')::numeric,
                'ลูกค้า: ' || coalesce(v_order.customer_name,'') || ' (' || coalesce(v_order.order_no, p_qu_no) || ')');
      end loop;
    exception when unique_violation then
      v_dup := true;   -- เคยตัดสต็อกผลิตของ order นี้แล้ว → ข้าม (retry ปลอดภัย)
    end;
  end if;

  update sales_orders set status = v_next where qu_no = p_qu_no;

  return jsonb_build_object('ok', true, 'newStatus', v_next, 'duplicate', v_dup,
    'warning', v_warning, 'summary', v_summary,
    'customerName', v_order.customer_name, 'orderNo', coalesce(v_order.order_no, p_qu_no));
end $$;

-- ── ปรับสต็อกทั่วไป manual (Stock.gs processManualStockMove) — IN/OUT/ADJUST ──────
create or replace function fn_manual_stock_move(p jsonb, p_user text)
returns jsonb
language plpgsql set search_path = public as $$
declare
  v_code text := p->>'itemCode';
  v_qty numeric := coalesce((p->>'qty')::numeric,0);
  v_type text := p->>'actionType';
  v_before numeric; v_name text; v_after numeric; v_action text;
begin
  select qty, item_name into v_before, v_name from warehouse_stock where item_code = v_code for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบรหัสสินค้านี้ในฐานข้อมูล (warehouse_stock)'); end if;

  v_action := v_type;
  if v_type = 'IN' then v_after := coalesce(v_before,0) + abs(v_qty);
  elsif v_type = 'OUT' then v_after := coalesce(v_before,0) - abs(v_qty);
  elsif v_type = 'ADJUST' then
    v_after := coalesce(v_before,0) + v_qty;
    v_action := case when v_qty >= 0 then 'ADJUST_IN' else 'ADJUST_OUT' end;
  else return jsonb_build_object('ok', false, 'error', 'ประเภทไม่ถูกต้อง'); end if;

  update warehouse_stock set qty = v_after where item_code = v_code;
  insert into stock_moves(item_code, item_name, qty_before, action, qty, ref_no, qty_after, user_name, remarks)
  values (v_code, v_name, coalesce(v_before,0), v_action, abs(v_qty), nullif(p->>'refNo',''), v_after, p_user, nullif(p->>'remarks',''));

  return jsonb_build_object('ok', true, 'newStock', v_after);
end $$;

-- ── ยกเลิกออเดอร์ + ย้อน side effect (FLOW sec 10.1) — role main ─────────────────
-- void transactions รายรับของ order (idempotency_key = orderNo / orderNo-balance)
-- + คืน warehouse_stock (stock_moves OUT ที่ ref=orderNo → บวกคืน + stock_moves IN)
-- + คืนสต็อกผลิตสุรา (log_product 'รับ' อ้างอิง) ถ้าเคยตัด
-- ไม่ลบประวัติ — mark 'ยกเลิก'
create or replace function fn_cancel_order(p_qu_no text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order sales_orders%rowtype;
  v_ref text; mv record; v_before numeric; v_after numeric;
  v_reversed int := 0;
begin
  if my_role() <> 'main' then raise exception 'เฉพาะ main ยกเลิกออเดอร์ได้'; end if;
  select * into v_order from sales_orders where qu_no = p_qu_no for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบออเดอร์ ' || p_qu_no); end if;
  v_ref := coalesce(v_order.order_no, p_qu_no);

  -- 1) void รายรับที่ลงบัญชีแล้ว (deposit + balance)
  update transactions set status = 'ยกเลิก'
    where idempotency_key in (v_ref, v_ref || '-balance') and status <> 'ยกเลิก';

  -- 2) คืน warehouse_stock ตาม stock_moves OUT ที่ยังไม่ถูกคืน (ref = orderNo, action='OUT')
  for mv in
    select item_code, item_name, qty from stock_moves
    where ref_no = v_ref and action = 'OUT'
      and not exists (select 1 from stock_moves r where r.ref_no = v_ref and r.action = 'IN' and r.item_code = stock_moves.item_code)
  loop
    select qty into v_before from warehouse_stock where item_code = mv.item_code for update;
    if found then
      v_after := coalesce(v_before,0) + mv.qty;
      update warehouse_stock set qty = v_after where item_code = mv.item_code;
      insert into stock_moves(item_code, item_name, qty_before, action, qty, ref_no, qty_after, user_name, remarks)
      values (mv.item_code, mv.item_name, coalesce(v_before,0), 'IN', mv.qty, v_ref, v_after, 'system', 'คืนสต็อก: ยกเลิกออเดอร์');
      v_reversed := v_reversed + 1;
    end if;
  end loop;

  -- 3) คืนสต็อกผลิตสุรา ถ้าเคยตัด (มี integration_log SELL_PRODUCT key=orderNo 'ok')
  if exists (select 1 from integration_log where action='SELL_PRODUCT' and idempotency_key = v_ref and status='ok') then
    insert into log_product(doc_date, trans_type, product_id, amount, note)
    select current_date, 'รับ', li->>'product_id', (li->>'amount')::numeric,
           'คืนสต็อก: ยกเลิกออเดอร์ ' || v_ref
    from integration_log, jsonb_array_elements(payload) li
    where action='SELL_PRODUCT' and idempotency_key = v_ref and status='ok';
    -- ปิด key เดิมไม่ให้ block การตัดใหม่ในอนาคต (mark reversed)
    update integration_log set status='duplicate', message='reversed by cancel'
      where action='SELL_PRODUCT' and idempotency_key = v_ref and status='ok';
  end if;

  update sales_orders set status = 'ยกเลิก', outstanding_balance = 0 where qu_no = p_qu_no;

  return jsonb_build_object('ok', true, 'reversed_stock', v_reversed);
end $$;
