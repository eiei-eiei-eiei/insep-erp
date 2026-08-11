-- ============================================================================
-- 0024 ใบแจ้งหนี้ค่ามัดจำ (D45) — เคสจริง: เสนอราคาแบบมัดจำ 50% ลูกค้าขอ
--   "ใบแจ้งหนี้ของยอดมัดจำ" ก่อนโอนเงิน แต่แอปมีแต่ใบแจ้งหนี้ยอดเต็ม
--
--   โฟลว์ใหม่:  รอคอนเฟิร์ม --ISSUE_INVOICE_DEPOSIT--> รอชำระมัดจำ
--                          --DEPOSIT_AND_SEND (เดิม)--> รอคลังจัดส่ง ...
--
--   ⚠️ ไม่แตะสูตรเงิน/ภาษีใด ๆ — action ใหม่ "ไม่ลงบัญชี" (ยังไม่ได้รับเงิน:
--      cash basis + จุดความรับผิด VAT เกิดเมื่อรับชำระ/ส่งมอบ)
--   ⚠️ เก็บเลข/วันที่/ยอด ในคอลัมน์ dep_* ใหม่ ห้ามใช้ inv_no/doc_date1 ร่วม
--      (สองช่องนั้นเป็นของใบแจ้งหนี้ + ใบกำกับภาษีมัดจำตอนรับเงินจริง)
-- ============================================================================

alter table sales_orders add column if not exists dep_inv_no text;      -- เลขใบแจ้งหนี้มัดจำ (ชุด INV เดียวกัน)
alter table sales_orders add column if not exists dep_inv_date date;    -- วันที่ออกใบแจ้งหนี้มัดจำ
alter table sales_orders add column if not exists dep_inv_amount numeric(14,2) not null default 0; -- ยอดเรียกเก็บ (รวม VAT, หัก WHT แล้ว)
alter table sales_orders add column if not exists dep_due_date date;    -- ครบกำหนดชำระมัดจำ

-- ── recreate fn_apply_order_action จาก 0021 — เพิ่ม 4 คอลัมน์ dep_* เท่านั้น ──
-- (logic บัญชี/idempotency/contact_id คงเดิมเป๊ะทุกบรรทัด)
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
    doc_date2           = coalesce(_d(p_update,'docDate2'), doc_date2),
    -- ★ 0024: ใบแจ้งหนี้ค่ามัดจำ
    dep_inv_no          = coalesce(nullif(p_update->>'depInvNo',''), dep_inv_no),
    dep_inv_date        = coalesce(_d(p_update,'depInvDate'), dep_inv_date),
    dep_inv_amount      = coalesce((p_update->>'depInvAmount')::numeric, dep_inv_amount),
    dep_due_date        = coalesce(_d(p_update,'depDueDate'), dep_due_date)
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
        insert into transaction_items(item_id, tx_id, item_name, quantity, in_vat, ex_vat, total_price)
        values (v_tx_id || '-' || lpad(idx::text,2,'0'), v_tx_id, it->>'itemName',
                coalesce((it->>'quantity')::numeric,1), coalesce((it->>'inVat')::numeric,0),
                coalesce((it->>'exVat')::numeric,0), coalesce((it->>'totalPrice')::numeric,0));
      end loop;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'duplicate', v_dup, 'tx_id', v_tx_id);
end $$;

-- ── ยกเลิกใบแจ้งหนี้มัดจำ → กลับไป 'รอคอนเฟิร์ม' เพื่อแก้ใบเสนอราคาได้เหมือนเดิม ──
-- ปลอดภัยเพราะสถานะนี้ยังไม่มีรายการบัญชี/สต็อกใด ๆ เกิดขึ้น (ยังไม่ได้รับเงิน)
-- เลข INV ที่ออกไปแล้วถือว่ายกเลิกทั้งใบ (เลขข้ามไป — ไม่นำกลับมาใช้ซ้ำ)
create or replace function fn_void_deposit_invoice(p_qu_no text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_status text; v_old text;
begin
  if my_role() <> 'main' then raise exception 'ไม่มีสิทธิ์ยกเลิกใบแจ้งหนี้มัดจำ (เฉพาะ main)'; end if;

  select status, dep_inv_no into v_status, v_old from sales_orders where qu_no = p_qu_no;
  if v_status is null then return jsonb_build_object('ok', false, 'error', 'ไม่พบออเดอร์ ' || p_qu_no); end if;
  if v_status <> 'รอชำระมัดจำ' then
    return jsonb_build_object('ok', false, 'error', 'ยกเลิกได้เฉพาะออเดอร์ที่สถานะ "รอชำระมัดจำ" (ตอนนี้: ' || v_status || ')');
  end if;

  update sales_orders set
    status = 'รอคอนเฟิร์ม',
    dep_inv_no = null, dep_inv_date = null, dep_inv_amount = 0, dep_due_date = null,
    doc_to_print = null, next_status = null
  where qu_no = p_qu_no;

  -- audit: trigger audit_sales_orders (0005) เก็บ before/after ให้อยู่แล้ว ไม่ต้อง log ซ้ำ
  return jsonb_build_object('ok', true, 'dep_inv_no', v_old);
end $$;
