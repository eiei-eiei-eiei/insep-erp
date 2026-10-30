-- ─────────────────────────────────────────────────────────────────────────────
-- 0101 — แอปขาย: แผนงวด sales_installments  (D145 · เฟส 3a ของแบ่งชำระหลายงวด)
--
-- 🎯 ผู้ใช้: แบ่งชำระมากกว่ามัดจำ-ยอดค้าง (เช่น 50/20/30) และปรับงวดที่ยังไม่จ่ายได้
--    (รวบ 20+30 · สลับ 30/20 · แตก 20/20/10) · ออกใบกำกับภาษี/ใบเสร็จแยกใบต่องวด (ยืนยันแล้ว)
-- เฟส 3a = ข้อมูล + กติกาที่ DB บังคับ (ยังไม่มีหน้าจอ · 3b ใบเสนอราคา · 3c หน้าออเดอร์+เอกสาร)
--
-- กติกา (ชุดเดียวกับ lib/sales/installments.ts · เทสเทียบ):
--   · รับตามลำดับงวด · งวดที่รับแล้ว/ออกใบแจ้งหนี้แล้วล็อก และต้องอยู่ต้นแผนเสมอ
--   · งวดที่ยังไม่ล็อกต้องรวมได้เท่า (ยอดค้าง − งวดล็อกที่ยังไม่รับ) พอดี — TS คิดยอดให้ (งวดสุดท้ายรับเศษ)
--     ที่นี่ตรวจผลรวมซ้ำ (กันยิง RPC ตรงด้วยยอดมั่ว)
--   · รับไม่เท่ายอดงวด → ส่วนต่างไปลงงวดสุดท้าย · งวดสุดท้ายต้องรับเต็มยอดค้าง
-- ★ ออเดอร์ที่รับเงินแบบเดิม (มัดจำ/ยอดค้าง ไม่มี installment_seq) ตั้งแผนงวดไม่ได้ — ใช้ปุ่มเดิมจนปิด
-- ★ "รับแล้ว" อ่านจาก sales_payments + สถานะบิล (D143 · ไม่มีคอลัมน์สถานะ)
-- 🚨 ยกฟังก์ชันเดิมด้วยสคริปต์ + diff (กัน D79):
--    fn_apply_order_action (0099) · fn_cancel_order (0058) · fn_doc_nos (0077) · fn_mig_truncate (0099)
-- ─────────────────────────────────────────────────────────────────────────────

create table sales_installments (
  tenant_id   uuid not null default my_tenant() references tenants(id) on delete cascade,
  qu_no       text not null,
  seq         integer not null,
  label       text not null,
  percent     numeric(7,4),                     -- % ที่ผู้ใช้กรอก (ไว้แสดง) · ยอดจริงคือ amount
  amount      numeric(14,2) not null check (amount > 0),
  due_date    date,
  inv_no      text,                             -- ใบแจ้งหนี้ของงวดนี้ (ยังไม่ลงบัญชี เหมือน D45)
  inv_date    date,
  ship_point  boolean not null default false,   -- ส่งคลังเมื่อรับงวดนี้
  created_at  timestamptz not null default now(),
  primary key (tenant_id, qu_no, seq),
  foreign key (tenant_id, qu_no) references sales_orders (tenant_id, qu_no) on delete cascade
);

alter table sales_installments enable row level security;
-- เหมือน sales_orders/sales_payments: ฝั่งบัญชีอ่านได้ด้วย · ไม่มี policy เขียน (ทางเดียวคือ RPC)
create policy sales_installments_sel on sales_installments for select
  using (tenant_id = my_tenant() and (has_cap('sales.read') or has_cap('acct.read')));
grant select, insert, update, delete on table public.sales_installments to authenticated, service_role;
create trigger audit_sales_installments after insert or update or delete on sales_installments
  for each row execute function trg_audit('qu_no');

-- การรับเงินเป็นของงวดไหน (null = รับแบบเดิม มัดจำ/ยอดค้าง/จ่ายเต็ม)
alter table sales_payments add column installment_seq integer;

-- ── งวดนี้รับเงินแล้วหรือยัง — แหล่งเดียวทั้งไฟล์ ──────────────────────────────────
--    บิลถูกยกเลิก (จากหน้าค้นบิล) = ยังไม่รับ · ไม่มีบิล (ข้อมูลผิดรูป) = ถือว่ารับแล้ว (ล็อกไว้ก่อน ปลอดภัยกว่า)
create or replace function sales_installment_paid(p_tenant uuid, p_qu_no text, p_seq integer)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from sales_payments p
      left join transactions t on t.tenant_id = p.tenant_id and t.tx_id = p.tx_id
     where p.tenant_id = p_tenant and p.qu_no = p_qu_no and p.installment_seq = p_seq
       and coalesce(t.status, 'ปกติ') <> 'ยกเลิก'
  );
$$;

-- ── ตั้ง/ปรับแผนงวด ──────────────────────────────────────────────────────────────
-- p_rows = งวดที่ยังไม่ล็อก (ใหม่ทั้งชุด) [{label, percent, amount, due_date, ship_point}]
--   ★ งวดที่ล็อก (รับแล้ว/ออกใบแจ้งหนี้แล้ว) ไม่ต้องส่งมา — คงไว้ตามเดิม แล้วต่อเลขงวดจากตัวสุดท้าย
--   ★ ส่งว่าง + ไม่มีงวดล็อก = ยกเลิกแผน (กลับเป็นจ่ายครั้งเดียวแบบเดิม)
create or replace function fn_sales_set_plan(p_qu_no text, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := my_tenant();
  v_order sales_orders%rowtype;
  v_max_locked int;
  v_locked_unpaid numeric;
  v_remain numeric;
  v_sum numeric := 0;
  v_ship int := 0;
  v_n int := 0;
  v_sent boolean;
  r jsonb;
  v_amt numeric;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if not has_cap('sales.write') then raise exception 'ไม่มีสิทธิ์แก้แผนงวด'; end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'แผนงวดไม่ถูกต้อง'; end if;

  select * into v_order from sales_orders where tenant_id = v_tenant and qu_no = p_qu_no for update;
  if not found then raise exception 'ไม่พบออเดอร์ %', p_qu_no; end if;
  if v_order.status in ('ยกเลิก', 'ปิดการขาย') then
    raise exception 'ออเดอร์ % % แล้ว — ปรับงวดไม่ได้', p_qu_no, v_order.status;
  end if;
  if exists (
    select 1 from sales_payments p
      left join transactions t on t.tenant_id = p.tenant_id and t.tx_id = p.tx_id
     where p.tenant_id = v_tenant and p.qu_no = p_qu_no and p.installment_seq is null
       and coalesce(t.status, 'ปกติ') <> 'ยกเลิก'
  ) then
    raise exception 'ออเดอร์นี้รับเงินแบบเดิม (มัดจำ/ยอดค้าง) ไปแล้ว — ใช้ปุ่มเดิมจนปิดการขาย';
  end if;
  v_sent := v_order.status in ('รอคลังจัดส่ง', 'ส่งของแล้วรอชำระยอดค้าง', 'ส่งของแล้วรอชำระเงิน');

  -- งวดที่ล็อก = รับแล้ว หรือออกใบแจ้งหนี้แล้ว · ต้องเป็นก้อนต้นแผน (เลขงวดต่อกันจาก 1)
  select max(seq) into v_max_locked from sales_installments i
   where i.tenant_id = v_tenant and i.qu_no = p_qu_no
     and (i.inv_no is not null or sales_installment_paid(v_tenant, p_qu_no, i.seq));
  if v_max_locked is not null and exists (
    select 1 from sales_installments i
     where i.tenant_id = v_tenant and i.qu_no = p_qu_no and i.seq < v_max_locked
       and i.inv_no is null and not sales_installment_paid(v_tenant, p_qu_no, i.seq)
  ) then
    raise exception 'แผนงวดเดิมผิดลำดับ (มีงวดที่ยังไม่ล็อกอยู่ก่อนงวดที่ล็อก) — ติดต่อผู้ดูแลระบบ';
  end if;

  select coalesce(sum(amount), 0) into v_locked_unpaid from sales_installments i
   where i.tenant_id = v_tenant and i.qu_no = p_qu_no and i.seq <= coalesce(v_max_locked, 0)
     and not sales_installment_paid(v_tenant, p_qu_no, i.seq);
  v_remain := round(coalesce(v_order.outstanding_balance, 0) - v_locked_unpaid, 2);

  delete from sales_installments where tenant_id = v_tenant and qu_no = p_qu_no and seq > coalesce(v_max_locked, 0);

  for r in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_n := v_n + 1;
    v_amt := round(coalesce((r->>'amount')::numeric, 0), 2);
    if v_amt <= 0 then raise exception 'งวดที่ % ยอดต้องมากกว่า 0', coalesce(v_max_locked, 0) + v_n; end if;
    if coalesce(trim(r->>'label'), '') = '' then raise exception 'ทุกงวดต้องมีชื่อ'; end if;
    if coalesce((r->>'ship_point')::boolean, false) then
      if v_sent then raise exception 'ส่งคลังไปแล้ว — ไม่ต้องเลือกจุดส่งของ'; end if;
      v_ship := v_ship + 1;
    end if;
    v_sum := v_sum + v_amt;
    insert into sales_installments(tenant_id, qu_no, seq, label, percent, amount, due_date, ship_point)
    values (v_tenant, p_qu_no, coalesce(v_max_locked, 0) + v_n, trim(r->>'label'),
            nullif(r->>'percent', '')::numeric, v_amt, nullif(r->>'due_date', '')::date,
            coalesce((r->>'ship_point')::boolean, false));
  end loop;

  if v_n = 0 and v_max_locked is not null and v_remain > 0 then
    raise exception 'ยังค้างอีก % บาท — ต้องมีอย่างน้อย 1 งวดรองรับ', v_remain;
  end if;
  if v_n > 0 and abs(v_sum - v_remain) >= 0.005 then
    raise exception 'งวดที่ยังไม่รับรวมได้ % แต่ต้องแบ่งให้ได้ % — ต้องเท่ากันพอดี', v_sum, v_remain;
  end if;
  select v_ship + count(*) into v_ship from sales_installments i
   where i.tenant_id = v_tenant and i.qu_no = p_qu_no and i.seq <= coalesce(v_max_locked, 0)
     and i.ship_point and not sales_installment_paid(v_tenant, p_qu_no, i.seq);
  if v_ship > 1 then raise exception 'จุดส่งของเลือกได้งวดเดียว'; end if;

  return jsonb_build_object('ok', true, 'locked', coalesce(v_max_locked, 0), 'rows', v_n);
end $fn$;

-- ── ใบแจ้งหนี้ของงวด (ยังไม่ลงบัญชี — เหมือนใบแจ้งหนี้มัดจำ D45) ──────────────────────
--   ★ ออกได้เฉพาะงวดถัดไปที่รับได้ (รับตามลำดับ) · เลขมาจาก fn_next_doc_no ฝั่ง server action
create or replace function fn_sales_installment_invoice(
  p_qu_no text, p_seq integer, p_inv_no text, p_inv_date date, p_due_date date
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := my_tenant();
  v_status text;
  v_next int;
  v_inst sales_installments%rowtype;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if not has_cap('sales.write') then raise exception 'ไม่มีสิทธิ์ออกใบแจ้งหนี้'; end if;
  select status into v_status from sales_orders where tenant_id = v_tenant and qu_no = p_qu_no for update;
  if not found then raise exception 'ไม่พบออเดอร์ %', p_qu_no; end if;
  if v_status in ('ยกเลิก', 'ปิดการขาย') then raise exception 'ออเดอร์ % % แล้ว', p_qu_no, v_status; end if;

  select * into v_inst from sales_installments where tenant_id = v_tenant and qu_no = p_qu_no and seq = p_seq for update;
  if not found then raise exception 'ไม่พบงวดที่ %', p_seq; end if;
  if v_inst.inv_no is not null then raise exception 'งวดที่ % ออกใบแจ้งหนี้ไปแล้ว (%)', p_seq, v_inst.inv_no; end if;
  select min(seq) into v_next from sales_installments i
   where i.tenant_id = v_tenant and i.qu_no = p_qu_no and not sales_installment_paid(v_tenant, p_qu_no, i.seq);
  if v_next is distinct from p_seq then
    raise exception 'ออกใบแจ้งหนี้ได้เฉพาะงวดถัดไป (งวดที่ %)', v_next;
  end if;
  if coalesce(trim(p_inv_no), '') = '' then raise exception 'ไม่มีเลขใบแจ้งหนี้'; end if;
  if fn_doc_no_taken(v_tenant, 'sales_inv', null, trim(p_inv_no)) then
    raise exception 'เลข % มีเอกสารใช้อยู่แล้ว', trim(p_inv_no);
  end if;

  update sales_installments set inv_no = trim(p_inv_no), inv_date = coalesce(p_inv_date, current_date),
         due_date = coalesce(p_due_date, due_date)
   where tenant_id = v_tenant and qu_no = p_qu_no and seq = p_seq;
  return jsonb_build_object('ok', true, 'inv_no', trim(p_inv_no));
end $fn$;

-- ยกเลิกใบแจ้งหนี้ของงวดที่ยังไม่รับเงิน (เพื่อปรับยอดงวด) — ระดับหัวหน้า เหมือนยกเลิกใบแจ้งหนี้มัดจำ
create or replace function fn_sales_void_installment_invoice(p_qu_no text, p_seq integer)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := my_tenant();
  v_inv text;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if not has_cap('sales.config') then raise exception 'ยกเลิกใบแจ้งหนี้ได้เฉพาะหัวหน้าฝ่ายขายขึ้นไป'; end if;
  select inv_no into v_inv from sales_installments
   where tenant_id = v_tenant and qu_no = p_qu_no and seq = p_seq for update;
  if not found then raise exception 'ไม่พบงวดที่ %', p_seq; end if;
  if v_inv is null then raise exception 'งวดที่ % ยังไม่ได้ออกใบแจ้งหนี้', p_seq; end if;
  if sales_installment_paid(v_tenant, p_qu_no, p_seq) then
    raise exception 'งวดที่ % รับเงินแล้ว — ยกเลิกใบแจ้งหนี้ไม่ได้', p_seq;
  end if;
  update sales_installments set inv_no = null, inv_date = null
   where tenant_id = v_tenant and qu_no = p_qu_no and seq = p_seq;
  return jsonb_build_object('ok', true, 'inv_no', v_inv);
end $fn$;

-- ── fn_apply_order_action — ยกจาก 20261030000099_sales_payments.sql ─────────────────
--    แก้: ตรวจลำดับงวดก่อนลงบิล · เก็บ installment_seq · ยอดงวดตามที่รับจริง + ส่วนต่างไปงวดสุดท้าย
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

-- ── fn_cancel_order — ยกจาก 20260901000058_excise_month_close.sql ──────────────────
--    แก้จุดเดียว: void บิลของทุกงวดตามแถวการรับเงินด้วย
create or replace function fn_cancel_order(p_qu_no text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  -- D91 — ซ่อนคู่ จ่าย/รับ ออกจากฟอร์ม ภส. ได้ไหม (คำถามอยู่ที่ fn_excise_months_open ที่เดียว)
  v_hide boolean := false; v_locked text[];
  v_order sales_orders%rowtype;
  v_ref text; mv record; v_before numeric; v_after numeric;
  v_reversed int := 0;
  v_tenant uuid := my_tenant();
begin
  -- 🚨 ยกเลิก = void ใบกำกับภาษีที่ออกไปแล้ว + คืนสต็อก → **ระดับหัวหน้าเท่านั้น**
  --    ใช้ sales.config (มีแต่ sales_manager กับ main) จงใจไม่ใช่ sales.write
  if not has_cap('sales.config') then raise exception 'ไม่มีสิทธิ์ยกเลิกออเดอร์ (เฉพาะหัวหน้าฝ่ายขาย)'; end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;

  select * into v_order from sales_orders
    where qu_no = p_qu_no and tenant_id = v_tenant for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบออเดอร์ ' || p_qu_no); end if;
  v_ref := coalesce(v_order.order_no, p_qu_no);

  -- 1) void รายรับที่ลงบัญชีแล้ว (deposit + balance)
  update transactions set status = 'ยกเลิก'
    where tenant_id = v_tenant
      and (idempotency_key in (v_ref, v_ref || '-balance')
           -- ★ D145 — บิลของทุกงวด (key ไม่ใช่ ref/-balance) ตามแถวการรับเงิน
           or tx_id in (select p.tx_id from sales_payments p
                         where p.tenant_id = v_tenant and p.qu_no = p_qu_no and p.tx_id is not null))
      and status <> 'ยกเลิก';

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
    insert into log_product(tenant_id, entity_id, doc_date, trans_type, product_id, amount, note, ref_no)
    select v_tenant, v_order.entity_id, current_date, 'รับ',
           li->>'product_id', (li->>'amount')::numeric,
           'คืนสต็อก: ยกเลิกออเดอร์ ' || v_ref, v_ref
    from integration_log, jsonb_array_elements(payload) li
    where tenant_id = v_tenant and action='SELL_PRODUCT'
      and idempotency_key = v_ref and status='ok';

    /*
     * D91 — ยกเลิกแล้วต้องไม่ไปกวนฟอร์มสรรพสามิต **แต่ห้ามแก้ฟอร์มที่ยื่นไปแล้ว**
     *
     * ★ ตัดสิน ณ ตอนกดยกเลิก แล้วแช่ผลไว้ในคอลัมน์ — ห้ามไปตัดสินตอนเปิดดูฟอร์ม
     *   ไม่งั้นพอเดือนนั้นถูกปิดทีหลัง แถวจะโผล่กลับมาเอง = ฟอร์มเปลี่ยนย้อนหลังอีกแบบ
     * 🚨 **เลิกถาม report_runs แล้ว** (D90 ถามผิดตาราง — นั่นคือเช็กลิสต์ ไม่ใช่ตัวล็อก)
     *   คำถามที่ถูกคือ "เดือนนั้นถูกปิดบัญชีสรรพสามิตหรือยัง" ซึ่งผู้ใช้ประกาศเอง
     * ★ คำถามอยู่ที่ fn_excise_months_open() ที่เดียว — ใช้ร่วมกับ fn_excise_recompute_hidden
     * ★ ซ่อนเป็นคู่ที่หักล้างกันพอดีเสมอ → ยอดคงเหลือบนฟอร์มยังตรงกับสต็อกจริง
     */
    v_hide := fn_excise_months_open(v_tenant, v_order.entity_id, v_ref);

    if v_hide then
      update log_product set excise_hidden = true
        where tenant_id = v_tenant and ref_no = v_ref;
    else
      -- เดือนไหนบ้างที่ปิดไปแล้ว — ส่งกลับให้หน้าจอขายบอกผู้ใช้ว่าต้องทำอะไรต่อ
      select array_agg(distinct m order by m) into v_locked
        from (
          select to_char(lp.doc_date,'YYYY-MM') as m
          from log_product lp
          where lp.tenant_id = v_tenant and lp.ref_no = v_ref
        ) t
        where exists (
          select 1 from excise_month_close c
          where c.tenant_id = v_tenant and c.entity_id = v_order.entity_id
            and c.month = t.m and c.reopened_at is null
        );
    end if;

    update integration_log set status='duplicate', message='reversed by cancel'
      where tenant_id = v_tenant and action='SELL_PRODUCT'
        and idempotency_key = v_ref and status='ok';
  end if;

  update sales_orders set status = 'ยกเลิก', outstanding_balance = 0
    where qu_no = p_qu_no and tenant_id = v_tenant;

  return jsonb_build_object(
    'ok', true, 'reversed_stock', v_reversed,
    'excise_hidden', v_hide,
    'excise_locked_months', coalesce(to_jsonb(v_locked), '[]'::jsonb));
end $$;

-- ── fn_doc_nos — ยกจาก 20260928000077_doc_numbering_phase2.sql ─────────────────────
--    แก้จุดเดียว: เลขใบเสร็จ/ใบแจ้งหนี้รายงวดนับเป็นเลขที่ใช้แล้ว (กันออกเลขซ้ำ)
create or replace function fn_doc_nos(p_tenant uuid, p_type text, p_entity text)
returns setof text language sql stable set search_path = public as $$
  select x from (
    select unnest(array[qu_no, order_no, inv_no, dep_inv_no, tax_no1, tax_no2, rcpt_no1, rcpt_no2]) as x
      from sales_orders where left(p_type, 6) = 'sales_' and tenant_id = p_tenant
    union all
    -- ★ D145 — ใบเสร็จรายงวดเก็บเลขที่แถวการรับเงิน · ใบแจ้งหนี้รายงวดเก็บที่แผนงวด
    select doc_no from sales_payments where left(p_type, 6) = 'sales_' and tenant_id = p_tenant
    union all
    select inv_no from sales_installments where left(p_type, 6) = 'sales_' and tenant_id = p_tenant
    union all
    select sale_no from bar_sale where p_type = 'bar_bill' and tenant_id = p_tenant and entity_id = p_entity
    union all
    select rcpt_no from bar_sale where p_type = 'bar_rcpt' and tenant_id = p_tenant and entity_id = p_entity
    union all
    select doc_no from wht_certificates where p_type = 'acct_wht' and tenant_id = p_tenant and entity_id = p_entity
    union all
    select batch from log_ferment where p_type = 'prod_batch' and tenant_id = p_tenant
    union all
    select batch from log_distill where p_type = 'prod_batch' and tenant_id = p_tenant
    union all
    select batch from log_ferment_draw where p_type = 'prod_batch' and tenant_id = p_tenant
    union all
    select lot_no from log_redistill where p_type = 'prod_lot' and tenant_id = p_tenant
  ) s where x is not null;
$$;

-- ── fn_mig_truncate — ยกจาก 20261030000099_sales_payments.sql ──────────────────────
--    แก้จุดเดียว: เติม sales_installments ก่อน sales_orders
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
    'sales_payments','sales_installments','sales_order_items','sales_orders','warehouse_stock','stock_moves','sale_menu',
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
