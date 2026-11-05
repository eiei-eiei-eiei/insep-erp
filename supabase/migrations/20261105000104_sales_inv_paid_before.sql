-- 0104 · D156 — ใบแจ้งหนี้/ใบส่งสินค้าของออเดอร์แบ่งงวด พิมพ์ซ้ำแล้วยอดต้องเท่าวันที่ออก
--
-- 🔴 เดิมตัวพิมพ์หัก "รับชำระแล้ว" ด้วย sales_orders.deposit **ปัจจุบัน** (ยอดรับรวมถึงวันนี้)
--    ⇒ ส่งของหลังงวด 1 แล้วรับครบ · พิมพ์ใบแจ้งหนี้ซ้ำ = หักทุกงวด คงค้าง 0.00 ไม่ตรงใบที่ลูกค้าถือ
-- ★ แช่ยอด ณ ตอนออกเลขใบแจ้งหนี้ (ตัวเลขบนเอกสารที่ออกแล้วต้องเป็นค่าที่แช่ไว้ · D69/D75/D90)
--   processOrder (lib/sales/orders.ts) ส่ง invPaidBefore มาเฉพาะตอนออกเลข inv_no ของออเดอร์แบ่งงวด
--   ว่าง (null) = ไม่รู้ → ตัวพิมพ์ใช้ deposit แบบเดิม (ไม่เดา)

alter table sales_orders add column if not exists inv_paid_before numeric(14,2);
comment on column sales_orders.inv_paid_before is
  'D156 — ยอดรับชำระแล้ว ณ วันออกใบแจ้งหนี้/ใบส่งสินค้า (ออเดอร์แบ่งงวด) · null = ไม่รู้ ใช้ deposit';

-- ── fn_apply_order_action — ยกจาก 20261030000101_sales_installments.sql ───────────────
--    แก้จุดเดียว: เขียน inv_paid_before (สร้างด้วย scripts/gen-0104.mjs)
create or replace function fn_apply_order_action(p_qu_no text, p_update jsonb, p_revenue jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tx_id text;
  v_dup boolean := false;
  it jsonb; idx int := 0;
  v_tenant uuid := my_tenant();
  -- D145 — แผนงวด
  v_inst_seq int; v_next int; v_last int; v_planned numeric; v_net numeric; v_last_amt numeric;
begin
  if not has_cap('sales.write') then raise exception 'ไม่มีสิทธิ์บันทึกการขาย'; end if;
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
    -- D89 — ช่องเลขใบเสร็จของกิจการที่ไม่จด VAT (คู่ขนานกับ tax_no1/tax_no2 ด้านบน)
    rcpt_no1            = coalesce(nullif(p_update->>'rcptNo1',''), rcpt_no1),
    rcpt_no2            = coalesce(nullif(p_update->>'rcptNo2',''), rcpt_no2),
    check_detail1       = coalesce(p_update->>'checkDetail1', check_detail1),
    check_detail2       = coalesce(p_update->>'checkDetail2', check_detail2),
    doc_to_print        = coalesce(nullif(p_update->>'docToPrint',''), doc_to_print),
    next_status         = coalesce(nullif(p_update->>'nextStatus',''), next_status),
    doc_date1           = coalesce(_d(p_update,'docDate1'), doc_date1),
    doc_date2           = coalesce(_d(p_update,'docDate2'), doc_date2),
    dep_inv_no          = coalesce(nullif(p_update->>'depInvNo',''), dep_inv_no),
    dep_inv_date        = coalesce(_d(p_update,'depInvDate'), dep_inv_date),
    dep_inv_amount      = coalesce((p_update->>'depInvAmount')::numeric, dep_inv_amount),
    dep_due_date        = coalesce(_d(p_update,'depDueDate'), dep_due_date),
    -- D156 — ยอดรับชำระแล้ว ณ วันออกใบแจ้งหนี้/ใบส่งสินค้า (ออเดอร์แบ่งงวด) · เขียนครั้งเดียวตอนออกเลข
    inv_paid_before     = coalesce((p_update->>'invPaidBefore')::numeric, inv_paid_before)
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
      -- ★ D145 — รับเงินของงวด: ต้องเป็นงวดถัดไป (รับตามลำดับ) · ตรวจก่อนลงบิล
      v_inst_seq := nullif(p_revenue->>'installmentSeq', '')::int;
      if v_inst_seq is not null then
        select min(seq) into v_next from sales_installments i
         where i.tenant_id = v_tenant and i.qu_no = p_qu_no and not sales_installment_paid(v_tenant, p_qu_no, i.seq);
        if v_next is distinct from v_inst_seq then
          raise exception 'ต้องรับงวดที่ % ก่อน (รับตามลำดับงวด)', coalesce(v_next::text, '-');
        end if;
        select amount into v_planned from sales_installments
         where tenant_id = v_tenant and qu_no = p_qu_no and seq = v_inst_seq;
      end if;

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

      -- ★ D143 — แถวการรับเงินของครั้งนี้ (วิธีชำระ/เช็ค/เลขเอกสารของครั้งนี้เอง)
      --   seq = ครั้งที่รับของออเดอร์นี้ · ไม่ลงซ้ำเพราะอยู่ใต้ `not v_dup` เหมือนบิล
      insert into sales_payments(tenant_id, qu_no, seq, label, amount, method, cheque_detail,
                                 doc_date, doc_no, tx_id, installment_seq)
      values (v_tenant, p_qu_no,
              (select coalesce(max(seq), 0) + 1 from sales_payments
                where tenant_id = v_tenant and qu_no = p_qu_no),
              coalesce(nullif(p_revenue->>'paymentLabel', ''), 'รับชำระ'),
              coalesce((p_revenue->>'netAmount')::numeric, 0),
              nullif(p_revenue->>'paymentMethod', ''), nullif(p_revenue->>'chequeDetail', ''),
              _d(p_revenue, 'taxInvoiceDate'), nullif(p_revenue->>'taxInvoiceNo', ''), v_tx_id, v_inst_seq);

      -- ★ D145 — งวดที่รับแล้วเก็บยอดที่รับจริง · ส่วนต่างจากยอดงวดไปลงงวดสุดท้ายที่ยังไม่รับ
      --   🚨 งวดสุดท้ายต้องรับเต็ม (ไม่งั้นยอดค้างไม่มีงวดรองรับ) · ส่วนต่างทำให้งวดสุดท้าย ≤ 0 = ปฏิเสธ
      if v_inst_seq is not null then
        v_net := round(coalesce((p_revenue->>'netAmount')::numeric, 0), 2);
        update sales_installments set amount = v_net
         where tenant_id = v_tenant and qu_no = p_qu_no and seq = v_inst_seq;
        select max(seq) into v_last from sales_installments i
         where i.tenant_id = v_tenant and i.qu_no = p_qu_no and not sales_installment_paid(v_tenant, p_qu_no, i.seq);
        if round(v_planned - v_net, 2) <> 0 then
          if v_last is null then
            raise exception 'งวดสุดท้ายต้องรับเต็มยอดค้าง % — ถ้าลูกค้าจ่ายไม่ครบ ให้ปรับงวดเพิ่มงวดก่อน', v_planned;
          end if;
          select round(amount + (v_planned - v_net), 2) into v_last_amt from sales_installments
           where tenant_id = v_tenant and qu_no = p_qu_no and seq = v_last;
          if v_last_amt <= 0 then
            raise exception 'ยอดที่รับเกินจนงวดสุดท้ายไม่เหลือยอด — ปรับงวดก่อนรับเงิน';
          end if;
          update sales_installments set amount = v_last_amt
           where tenant_id = v_tenant and qu_no = p_qu_no and seq = v_last;
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'duplicate', v_dup, 'tx_id', v_tx_id);
end $$;

-- ── backfill ออเดอร์แบ่งงวดที่ออกใบแจ้งหนี้ไปแล้ว ─────────────────────────────────────
-- เวลาที่ออกเลข = แถวแรกใน edit_log ที่ inv_no เปลี่ยนจากว่างเป็นมีค่า (trigger audit_sales_orders · 0005)
-- ยอดที่รับแล้ว = การรับเงินที่บันทึกไม่หลังเวลานั้น
--   ★ fn_apply_order_action แก้ออเดอร์กับเขียน sales_payments ใน transaction เดียว → now() เท่ากัน
--     ⇒ งวดที่เป็นจุดส่งของ (รับเงินพร้อมออกใบ) ถูกนับด้วย ตรงกับ processOrder
-- 🚨 หาเวลาไม่เจอ = ปล่อยว่าง (ตัวพิมพ์ใช้ deposit แบบเดิม) — ไม่เดาตัวเลข
update sales_orders o
   set inv_paid_before = (
         select coalesce(sum(p.amount), 0) from sales_payments p
          where p.tenant_id = o.tenant_id and p.qu_no = o.qu_no and p.created_at <= e.at)
  from (
    select el.tenant_id, el.row_pk, min(el.created_at) as at
      from edit_log el
     where el.table_name = 'sales_orders' and el.action = 'update'
       and coalesce(el.before ->> 'inv_no', '') = ''
       and coalesce(el.after ->> 'inv_no', '') <> ''
     group by el.tenant_id, el.row_pk
  ) e
 where e.tenant_id = o.tenant_id and e.row_pk = o.qu_no
   and o.inv_no is not null and o.inv_paid_before is null
   and exists (select 1 from sales_installments i where i.tenant_id = o.tenant_id and i.qu_no = o.qu_no);
