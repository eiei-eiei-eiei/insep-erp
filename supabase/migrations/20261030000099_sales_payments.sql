-- ─────────────────────────────────────────────────────────────────────────────
-- 0099 — แอปขาย: ตารางการรับเงิน sales_payments  (D143 · เฟส 1 ของแบ่งชำระหลายงวด)
--
-- 🎯 1 แถว = รับเงิน 1 ครั้ง (มัดจำ · ชำระยอดค้าง · ชำระเต็ม) พร้อมวิธีชำระของครั้งนั้น
--    เดิมออเดอร์มีช่อง payment_method ช่องเดียว ⇒ รับยอดค้างแล้วค่าของมัดจำถูกเขียนทับ
--    🔴 บั๊กที่มีอยู่จริง: พิมพ์ใบเสร็จค่ามัดจำซ้ำหลังรับยอดค้าง = ขึ้นวิธีชำระของยอดค้าง
--    → ใบเสร็จแต่ละใบอ่านวิธีชำระ/เช็คจากแถวของตัวเอง
-- ★ เฟส 1 ไม่เปลี่ยนโฟลว์: ช่องเดิมบน sales_orders (tax_no1/2 · check_detail1/2 · payment_method)
--   ยังถูกเขียนเหมือนเดิมทุกตัวอักษร ⇒ ตัวออกเลขเอกสาร/ยกเลิกออเดอร์/หน้าบัญชีไม่ต้องแตะ
-- ★ ไม่มีคอลัมน์สถานะ — "รับแล้วหรือถูกยกเลิก" อ่านจาก transactions.status ของ tx_id (แหล่งเดียว)
--   ยกเลิกออเดอร์หรือยกเลิกบิลจากหน้าค้นบิล → แถวนี้รู้เองโดยไม่ต้อง sync
-- 🚨 เขียนได้ทางเดียวคือ RPC definer (fn_apply_order_action) — ไม่มี policy เขียน (D85/0052)
-- 🚨 fn_apply_order_action ยกจาก 0056 ด้วยสคริปต์ (กัน D79) · signature เดิม = สิทธิ์เดิม (D99)
-- 🚨 fn_mig_truncate ยกจาก 0093 · sales_payments ต้องมาก่อน sales_orders (FK)
-- ─────────────────────────────────────────────────────────────────────────────

create table sales_payments (
  tenant_id     uuid not null default my_tenant() references tenants(id) on delete cascade,
  qu_no         text not null,
  seq           integer not null,                 -- ครั้งที่รับเงินของออเดอร์นี้ (1, 2, …)
  label         text not null,                    -- มัดจำ · ชำระยอดค้าง · ชำระเต็ม
  amount        numeric(14,2) not null,           -- ยอดที่รับจริง (สุทธิหลังหัก ณ ที่จ่าย = net_amount ของบิล)
  method        text,                             -- วิธีชำระของครั้งนี้ (ว่าง = ไม่รู้ · ข้อมูลเก่า)
  cheque_detail text,
  doc_date      date,
  doc_no        text,                             -- เลขใบกำกับภาษี/ใบเสร็จของครั้งนี้
  tx_id         text,                             -- บิลรายรับที่ผูกกัน (สถานะอ่านจากบิลนี้)
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  primary key (tenant_id, qu_no, seq),
  foreign key (tenant_id, qu_no) references sales_orders (tenant_id, qu_no) on delete cascade
);
create index sales_payments_tx_idx on sales_payments (tenant_id, tx_id);

alter table sales_payments enable row level security;
-- เหมือน sales_orders: ฝั่งบัญชีอ่านได้ด้วย (หน้าลูกหนี้-เจ้าหนี้) · ไม่มี policy เขียน
create policy sales_payments_sel on sales_payments for select
  using (tenant_id = my_tenant() and (has_cap('sales.read') or has_cap('acct.read')));

-- D118 — grant ในไฟล์เดียวกับ create table เสมอ
grant select, insert, update, delete on table public.sales_payments to authenticated, service_role;

-- ── backfill จากบิลรายรับที่มีอยู่ ────────────────────────────────────────────────
--   ครั้งที่ 1 = key ออเดอร์ (มัดจำ/ชำระเต็ม) · ครั้งที่ 2 = key '-balance' (ชำระยอดค้าง)
--   วิธีชำระ: อ่านจากวงเล็บท้ายคำอธิบายบิล "อ้างอิง QU: … (เงินสด)" ที่ processOrder เขียนไว้ทุกใบ
--     ไม่มี → ครั้งที่ 1 ใช้ payment_method ของออเดอร์ได้เฉพาะเมื่อยังไม่มีครั้งที่ 2
--     (มีครั้งที่ 2 แล้ว ช่องนั้นเป็นของครั้งที่ 2 — เดาให้ครั้งที่ 1 = บั๊กเดิมซ้ำ)
--   เช็ค: มัดจำเก็บช่อง 1 · ชำระเต็ม/ยอดค้างเก็บช่อง 2 (ตรงกับ processOrder + print.ts)
--   🚨 รวมบิลที่ยกเลิกแล้วด้วย — สถานะอ่านจากบิล ไม่ใช่จากการมี/ไม่มีแถว
with o as (
  select so.tenant_id, so.qu_no, coalesce(nullif(so.order_no, ''), so.qu_no) as k,
         coalesce(so.deposit, 0) > 0 as is_dep, so.payment_method,
         nullif(so.check_detail1, '') as cq1, nullif(so.check_detail2, '') as cq2
    from sales_orders so
), t1 as (
  select o.*, t.tx_id, t.net_amount, t.description, t.tax_invoice_no,
         coalesce(t.tax_invoice_date, t.transaction_date) as d,
         exists (select 1 from transactions b
                  where b.tenant_id = o.tenant_id and b.idempotency_key = o.k || '-balance') as has_bal
    from o join transactions t on t.tenant_id = o.tenant_id and t.idempotency_key = o.k
)
insert into sales_payments (tenant_id, qu_no, seq, label, amount, method, cheque_detail, doc_date, doc_no, tx_id)
select tenant_id, qu_no, 1,
       case when is_dep then 'มัดจำ' else 'ชำระเต็ม' end,
       coalesce(net_amount, 0),
       coalesce(nullif(trim(substring(description from '\(([^()]*)\)\s*$')), ''),
                case when has_bal then null else nullif(payment_method, '') end),
       case when is_dep then cq1 else cq2 end,
       d, nullif(tax_invoice_no, ''), tx_id
  from t1;

with o as (
  select so.tenant_id, so.qu_no, coalesce(nullif(so.order_no, ''), so.qu_no) as k,
         so.payment_method, nullif(so.check_detail2, '') as cq2
    from sales_orders so
)
insert into sales_payments (tenant_id, qu_no, seq, label, amount, method, cheque_detail, doc_date, doc_no, tx_id)
select o.tenant_id, o.qu_no, 2, 'ชำระยอดค้าง',
       coalesce(t.net_amount, 0),
       coalesce(nullif(trim(substring(t.description from '\(([^()]*)\)\s*$')), ''), nullif(o.payment_method, '')),
       o.cq2,
       coalesce(t.tax_invoice_date, t.transaction_date), nullif(t.tax_invoice_no, ''), t.tx_id
  from o join transactions t on t.tenant_id = o.tenant_id and t.idempotency_key = o.k || '-balance';

-- audit หลัง backfill — แถวที่ย้ายมาไม่ใช่ "การแก้ไข" ของใคร (ไม่ท่วม edit_log)
-- 🪤 ป้าย = qu_no (ไม่ใช้ generated column — restore:tenant insert ทุกคอลัมน์จากไฟล์ = ล้ม)
create trigger audit_sales_payments after insert or update or delete on sales_payments
  for each row execute function trg_audit('qu_no');

-- ── fn_apply_order_action — ยกจาก 20260901000056_receipt_no_non_vat.sql ─────────────
--    แก้จุดเดียว: เขียนแถว sales_payments ต่อจากบิลรายรับ (ใต้ not v_dup)
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

      -- ★ D143 — แถวการรับเงินของครั้งนี้ (วิธีชำระ/เช็ค/เลขเอกสารของครั้งนี้เอง)
      --   seq = ครั้งที่รับของออเดอร์นี้ · ไม่ลงซ้ำเพราะอยู่ใต้ `not v_dup` เหมือนบิล
      insert into sales_payments(tenant_id, qu_no, seq, label, amount, method, cheque_detail,
                                 doc_date, doc_no, tx_id)
      values (v_tenant, p_qu_no,
              (select coalesce(max(seq), 0) + 1 from sales_payments
                where tenant_id = v_tenant and qu_no = p_qu_no),
              coalesce(nullif(p_revenue->>'paymentLabel', ''), 'รับชำระ'),
              coalesce((p_revenue->>'netAmount')::numeric, 0),
              nullif(p_revenue->>'paymentMethod', ''), nullif(p_revenue->>'chequeDetail', ''),
              _d(p_revenue, 'taxInvoiceDate'), nullif(p_revenue->>'taxInvoiceNo', ''), v_tx_id);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'duplicate', v_dup, 'tx_id', v_tx_id);
end $$;

-- ── fn_mig_truncate — ยกจาก 20261026000093_bar_recipe_garnish.sql ──────────────────
--    แก้จุดเดียว: เติม sales_payments ก่อน sales_order_items/sales_orders
create or replace function fn_mig_truncate(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  t text;
  -- เรียงตามลำดับ FK (ลูกก่อนแม่) เพราะ delete ไม่ cascade เองเหมือน truncate
  tables text[] := array[
    'transaction_items','transactions','tax_summaries','tax_payments','tax_filings','wht_certificates',
    'log_material','log_ferment','log_distill','log_distill_run',
    'log_ferment_monitor','log_dilute','log_ferment_draw','log_product','stock_product',
    -- ★ D94 — กลั่นซ้ำ: รอบมี FK ไปล็อต · ล็อตมี entity_id FK
    'log_redistill_round','log_redistill',
    -- ★ D143 — การรับเงินมี FK ไปออเดอร์ → ต้องมาก่อน sales_orders
    'sales_payments','sales_order_items','sales_orders','warehouse_stock','stock_moves','sale_menu',
    -- ★ D96 — บาร์/POS · ลูกก่อนแม่:
    --   sale_item→sale · fav→customer,menu · recipe→menu,item · menu→category,customer
    --   receive/move→item · sale→customer
    -- ★ D129 — ห้องทดลอง: บรรทัด → รายการ → สูตร/หมวด (ลูกก่อนแม่ · หมวด FK ไป entities)
    'bar_lab_use_line','bar_lab_use','bar_lab_recipe','bar_lab_category',
    -- ★ D130 — ของทำเอง: บรรทัดล็อต → ล็อต → วัตถุดิบในสูตร → ของทำเอง (ทั้งหมดก่อน bar_item)
    'bar_prep_batch_line','bar_prep_batch','bar_prep_input','bar_prep',
    'bar_sale_item','bar_sale','bar_post','bar_move','bar_receive',
    'bar_customer_fav','bar_recipe',
    -- ★ D127 — recipe_slot → house_slot → item · garnish → item (ลูกก่อนแม่)
    -- ★ D131 — บรรทัดสูตรที่อ้างชุดตกแต่ง ต้องมาก่อน bar_garnish (FK restrict)
    'bar_recipe_garnish',
    'bar_recipe_slot','bar_house_slot','bar_garnish',
    'bar_menu','bar_category','bar_customer','bar_item',
    -- เงินเดือน (0040 + 0042) — ต้องมาก่อน entities ไม่งั้นติด FK
    'payroll_items','payroll_periods','employees',
    'pay_components','pay_inputs','pay_rates','pay_variables','pay_post_legs',
    'contacts','bank_accounts',
    'materials','containers','products',
    -- ★ report_runs มี entity_id FK → ต้องมาก่อน entities ด้วย (0050)
    'report_runs',
    -- ★ D91 — excise_month_close มี entity_id FK → ต้องมาก่อน entities ด้วย
    'excise_month_close',
    -- ★ D100 — doc_numbering มี entity_id FK → ต้องมาก่อน entities ด้วย
    'doc_numbering',
    'entities',
    'app_settings','integration_log','edit_log','counters'
  ];
begin
  if p_tenant is null then
    raise exception 'fn_mig_truncate: ต้องระบุ tenant — ห้ามล้างข้ามลูกค้า';
  end if;
  foreach t in array tables loop
    execute format('delete from %I where tenant_id = $1', t) using p_tenant;
  end loop;
end $fn$;

-- 🚨 D99: fn_mig_truncate ถูกนิยามใหม่ในไฟล์นี้ → revoke ซ้ำ
revoke execute on function fn_mig_truncate(uuid) from public, anon, authenticated;
grant  execute on function fn_mig_truncate(uuid) to service_role;

notify pgrst, 'reload schema';
