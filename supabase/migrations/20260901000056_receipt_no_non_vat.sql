-- ============================================================================
-- 0056 เลขใบเสร็จของกิจการที่ไม่จด VAT — D89
--
-- ผู้ไม่จด VAT ออกใบกำกับภาษีไม่ได้ (ม.86/13) จึงไม่มีเลข tax_no1/tax_no2 —
-- แต่ "ใบเสร็จรับเงิน" ที่ออกแทนก็ต้องมีเลขที่ของตัวเอง และต้องไม่ซ้ำกัน
-- ของเดิมจึงได้เอกสาร 2 ใบที่ผิด: ใบเสร็จค่ามัดจำ = เลขว่าง · ใบเสร็จยอดค้าง = ซ้ำเลขใบแจ้งหนี้
--
-- โมเดล: rcpt_no1/rcpt_no2 เป็น **คู่ขนาน** ของ tax_no1/tax_no2 — ช่องรับเงิน 2 ช่องเท่ากัน
--   ครั้งแรก (มัดจำ/จ่ายเต็ม) → tax_no1 | rcpt_no1
--   ยอดค้าง                   → tax_no2 | rcpt_no2
-- ใช้เลขชุด INV (fn_next_sales_doc('INV')) เพราะผู้ไม่จด VAT ออกเลขชุด TAX ไม่ได้
--
-- 🚨 **ห้ามแก้ trigger block_tax_invoice_non_vat (0036) ให้ผู้ไม่จด VAT ใส่ tax_no* ได้**
--    นั่นคือด่านกฎหมาย ม.86/13 ที่ตั้งใจให้แข็ง · คอลัมน์ใหม่เป็นคนละช่องจึงไม่โดน trigger
--    (เจตนา: ต่อให้ยิง PostgREST ตรงก็ยังออกใบกำกับภาษีไม่ได้)
--
-- ★ fn_apply_order_action ด้านล่าง **ยกมาจาก 20260827000051_roles_caps.sql ทั้งดุ้นด้วยสคริปต์**
--   (scripts เทียบเท่า gen-0051.mjs) เปลี่ยนเฉพาะ 2 บรรทัดที่ทำเครื่องหมาย D89 ไว้
--   signature ไม่เปลี่ยน → create or replace ทับได้ ไม่เกิด overload (กับดัก D69)
-- ============================================================================

alter table sales_orders add column if not exists rcpt_no1 text;
alter table sales_orders add column if not exists rcpt_no2 text;

comment on column sales_orders.rcpt_no1 is
  'เลขใบเสร็จรับเงินครั้งแรกของกิจการที่ไม่จด VAT (คู่ขนานกับ tax_no1) — เลขชุด INV';
comment on column sales_orders.rcpt_no2 is
  'เลขใบเสร็จรับเงินยอดค้างของกิจการที่ไม่จด VAT (คู่ขนานกับ tax_no2) — เลขชุด INV';

create or replace function fn_apply_order_action(p_qu_no text, p_update jsonb, p_revenue jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tx_id text;
  v_dup boolean := false;
  it jsonb; idx int := 0;
  v_tenant uuid := my_tenant();
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

notify pgrst, 'reload schema';
