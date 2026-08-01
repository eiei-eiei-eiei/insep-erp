-- ============================================================================
-- 0021 ปิดช่องโหว่ "คู่ค้าหลายสาขาชื่อเดียวกัน" ที่ยังเหลือ (ต่อจาก D30/0016)
--   จุดที่ยังผูกด้วย "ชื่อ" อยู่ 2 จุด → เอกสาร/รายงานอาจได้สาขาแรกเสมอ:
--     (1) wht_certificates (50ทวิ) — พิมพ์ซ้ำหาที่อยู่/เลขภาษีจากชื่อ
--     (2) รายรับจากขาย (fn_apply_order_action) — insert transactions ไม่มี contact_id
--         → ภพ.30/ภงด. resolveContact() fallback ชื่อ = ได้ taxId/สาขาแรก (เลขยื่นผิดสาขา)
--   แก้แบบเพิ่มคอลัมน์อย่างเดียว — ไม่แตะสูตรเงิน/ภาษี/พิกัดฟอร์ม PDF
--
--   + เก็บ "เงื่อนไขมัดจำ" ของใบเสนอราคา (is_deposit/deposit_percent) เพื่อให้
--     กดแก้ใบเสนอราคาแล้ว prefill กลับมาครบ + พิมพ์ซ้ำได้เงื่อนไขเดิม (APP_REVIEW A3)
-- ============================================================================

-- ── (1) 50ทวิ: ผูกคู่ค้าด้วย contact_id (null = ใบเก่า → fallback ชื่อเหมือนเดิม) ──
alter table wht_certificates add column if not exists contact_id text references contacts(contact_id);

drop function if exists fn_issue_wht(text, text[], date, text, text, numeric, text, text, int, numeric, date, text);
create or replace function fn_issue_wht(
  p_doc_no text, p_tx_ids text[], p_issue_date date, p_contact_name text, p_address text,
  p_wht_amount numeric, p_pnd_type text, p_income_type text, p_income_seq int, p_base_amount numeric,
  p_payment_date date, p_entity_id text, p_contact_id text default null
) returns jsonb
language plpgsql set search_path = public as $$
declare v_entity text := coalesce(nullif(p_entity_id,''),'EID01');
begin
  insert into wht_certificates(doc_no, issue_date, contact_name, contact_id, address, wht_amount,
    pnd_type, income_type, income_seq, base_amount, tx_ids, entity_id)
  values (p_doc_no, coalesce(p_issue_date, current_date), p_contact_name, nullif(p_contact_id,''),
    p_address, p_wht_amount,
    p_pnd_type, p_income_type, coalesce(p_income_seq, 6), p_base_amount, coalesce(p_tx_ids,'{}'), v_entity);

  -- เขียนวันที่จ่าย (col W เดิม) ให้ทุก tx ที่ออกใบนี้
  update transactions set payment_date = coalesce(p_payment_date, current_date)
    where tx_id = any(coalesce(p_tx_ids,'{}'));

  return jsonb_build_object('ok', true, 'doc_no', p_doc_no);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'เลขเอกสาร ' || p_doc_no || ' ถูกใช้แล้วในกิจการนี้ ลองใหม่');
end $$;

-- backfill ใบเก่า: เติม contact_id ให้เฉพาะใบที่ชื่อคู่ค้าตรงกับ contact เพียงรายเดียว
-- (ชื่อซ้ำหลายสาขา = เดาไม่ได้ ปล่อย null ให้ fallback เหมือนเดิม — ไม่เดาข้อมูลราชการ)
update wht_certificates w set contact_id = c.contact_id
from contacts c
where w.contact_id is null
  and lower(trim(c.name)) = lower(trim(w.contact_name))
  and (select count(*) from contacts c2 where lower(trim(c2.name)) = lower(trim(w.contact_name))) = 1;

-- ── (2) รายรับจากขาย: เก็บ contact_id ลง transactions (สาขาลูกค้าที่แน่นอน) ──
-- recreate จาก 0013 — เพิ่มคอลัมน์ contact_id ในการ insert เท่านั้น logic อื่นคงเดิมเป๊ะ
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
        tx_id, transaction_date, type, account_name, category, contact_name, contact_id, description,
        base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
        tax_invoice_no, tax_invoice_date, status, entity_id, idempotency_key, source
      ) values (
        v_tx_id, _d(p_revenue,'taxInvoiceDate'), 'รายรับ',
        nullif(p_revenue->>'accountName',''), p_revenue->>'category', p_revenue->>'contactName',
        nullif(p_revenue->>'contactId',''),                       -- ★ 0021: สาขาลูกค้าที่แน่นอน
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

-- backfill รายรับขายเดิม: เติม contact_id จาก sales_orders.customer_id ผ่าน idempotency_key
-- (key = orderNo/quNo หรือ '<ref>-balance' — ตรงกับที่ lib/sales/orders.ts สร้าง)
update transactions t set contact_id = so.customer_id
from sales_orders so
where t.source = 'sales'
  and t.contact_id is null
  and so.customer_id is not null
  and (t.idempotency_key = so.order_no or t.idempotency_key = so.qu_no
       or t.idempotency_key = so.order_no || '-balance' or t.idempotency_key = so.qu_no || '-balance');

-- ── (3) เงื่อนไขมัดจำของใบเสนอราคา (prefill ตอนแก้ + พิมพ์ซ้ำได้เหมือนเดิม) ──
alter table sales_orders add column if not exists is_deposit boolean not null default false;
alter table sales_orders add column if not exists deposit_percent numeric(5,2) not null default 0;

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
    remarks, wht_percent, wht_amount, net_payable, category,
    is_deposit, deposit_percent
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
    coalesce(nullif(p->>'category',''),'รายได้ค่าสินค้า'),
    coalesce((p->>'is_deposit')::boolean, false), coalesce((p->>'deposit_percent')::numeric, 0)
  );

  for it in select value from jsonb_array_elements(p_items) loop
    insert into sales_order_items(qu_no, item_name, qty, price)
    values (v_qu, it->>'name', coalesce((it->>'qty')::numeric,0), coalesce((it->>'price')::numeric,0));
  end loop;

  return jsonb_build_object('ok', true, 'qu_no', v_qu, 'order_no', v_ord,
    'qu_expire', to_char(v_exp,'DD/MM/') || (extract(year from v_exp)::int + 543)::text);
end $$;

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
    customer_id = coalesce(nullif(p->>'customer_id',''), customer_id),
    customer_name = coalesce(nullif(p->>'customer_name',''), customer_name),
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
    category = coalesce(nullif(p->>'category',''),'รายได้ค่าสินค้า'),
    is_deposit = coalesce((p->>'is_deposit')::boolean, is_deposit),
    deposit_percent = coalesce((p->>'deposit_percent')::numeric, deposit_percent)
  where qu_no = p_qu_no;

  delete from sales_order_items where qu_no = p_qu_no;
  for it in select value from jsonb_array_elements(p_items) loop
    insert into sales_order_items(qu_no, item_name, qty, price)
    values (p_qu_no, it->>'name', coalesce((it->>'qty')::numeric,0), coalesce((it->>'price')::numeric,0));
  end loop;

  return jsonb_build_object('ok', true, 'qu_no', p_qu_no);
end $$;
