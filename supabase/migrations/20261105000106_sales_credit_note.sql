-- ════════════════════════════════════════════════════════════════════════════
-- 0106 — D159: ใบลดหนี้ตอนยกเลิกออเดอร์ (เฟส 1 = ลดทั้งออเดอร์)
--
-- 🔴 เดิม fn_cancel_order เปลี่ยนบิลรายรับเป็น 'ยกเลิก' ⇒ ภาษีขายหายจากเดือนที่ออกใบกำกับย้อนหลัง
--    ทั้งที่งวดนั้นอาจยื่น ภพ.30 ไปแล้ว · กฎหมาย (ม.82/10 · ป.80/2542 ข้อ 5) ให้หักในเดือนที่ออกใบลดหนี้
-- ★ ใบกำกับที่มี VAT อยู่งวดที่ยื่นแล้ว/เดือนก่อน → ยกเลิกแบบเดิมไม่ได้ ต้องส่ง p_credit
--   เดือนเดียวกัน + ยังไม่ยื่น → เลือกได้ (ผู้ใช้ตัดสิน · ป.86/2542 ข้อ 25 เรียกใบเดิมคืน)
-- ★ ใบลดหนี้ = บิล type 'ลดหนี้ขาย' ลงวันที่ใบลดหนี้ + แถว sales_credit_notes (ข้อมูลพิมพ์ตาม ม.86/10)
--   บิลรายรับเดิมคงสถานะปกติ · สต็อก/ฟอร์ม ภส. ใช้ตรรกะยกเลิกเดิมทั้งหมด
-- ★ เลขชุดใหม่ sales_cn (ค่าปริยาย CN-YYMMDD-001) กันเลขซ้ำร่วมกับเอกสารขายเหมือนชุดอื่น
-- 🚨 ฟังก์ชันเดิมยกด้วย scripts/gen-0106.mjs (ตรวจไฟล์ล่าสุด + จุดแทนต้องเจอ 1 ครั้ง):
--    fn_doc_types/fn_doc_default (20260928000077_doc_numbering_phase2.sql) · fn_doc_nos (20261030000101_sales_installments.sql)
--    fn_mig_truncate (20261030000101_sales_installments.sql) · fn_cancel_order (20261030000101_sales_installments.sql)
-- 🪤 fn_cancel_order เปลี่ยนพารามิเตอร์ = ต้อง drop ก่อน ไม่งั้นเกิด overload ตัวที่ 2 (D69)
-- ════════════════════════════════════════════════════════════════════════════

alter table transactions drop constraint if exists transactions_type_check;
alter table transactions add constraint transactions_type_check
  check (type in ('รายรับ','รายจ่าย','โอนระหว่างบัญชี','เช็คราคา','บันทึกภาษี','สำรองจ่าย','รับคืนสำรองจ่าย','ลดหนี้ขาย'));

create table sales_credit_notes (
  tenant_id      uuid not null default my_tenant() references tenants(id) on delete cascade,
  cn_no          text not null,
  qu_no          text not null,
  entity_id      text not null,
  cn_date        date not null,
  reason         text not null check (reason in ('return','refund_advance','price_error','other')),
  detail         text not null default '',
  reason_text    text not null,                 -- ข้อความเหตุบนใบ (ม.86/10(6)) ประกอบที่ lib/sales/creditNote
  refs           jsonb not null,                -- ใบกำกับเดิม [{tx_id, doc_no, date, pre_vat, vat}] (ม.86/10(5))
  original_value numeric(14,2) not null,        -- มูลค่าเดิม (ก่อน VAT)
  correct_value  numeric(14,2) not null,        -- มูลค่าที่ถูกต้อง (เฟส 1 = 0)
  diff_value     numeric(14,2) not null,        -- ผลต่าง
  vat_amount     numeric(14,2) not null,        -- ภาษีของผลต่าง
  total_amount   numeric(14,2) not null,
  refund_amount  numeric(14,2) not null,        -- ยอดที่คืนจริง (หลังหัก ณ ที่จ่ายที่ลูกค้าหักไว้)
  wht_amount     numeric(14,2) not null default 0,
  refund_account text,                          -- null = ยังไม่คืน (บิลค้างจ่าย)
  tx_id          text not null,
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  primary key (tenant_id, cn_no),
  foreign key (tenant_id, qu_no) references sales_orders (tenant_id, qu_no) on delete cascade
);
create index sales_credit_notes_qu on sales_credit_notes (tenant_id, qu_no);

alter table sales_credit_notes enable row level security;
-- เหมือน sales_payments: ฝั่งบัญชีอ่านได้ด้วย · ไม่มี policy เขียน (ทางเดียวคือ fn_cancel_order)
create policy sales_credit_notes_sel on sales_credit_notes for select
  using (tenant_id = my_tenant() and (has_cap('sales.read') or has_cap('acct.read')));
-- D118 — grant ในไฟล์เดียวกับ create table เสมอ
grant select, insert, update, delete on table public.sales_credit_notes to authenticated, service_role;

-- ── fn_doc_types — ยกจาก 20260928000077_doc_numbering_phase2.sql · เติม sales_cn ──
create or replace function fn_doc_types() returns text[]
language sql immutable set search_path = public as $$
  select array['sales_qu','sales_ord','sales_inv','sales_tax','sales_rcpt','sales_cn','bar_bill','bar_rcpt',
               'acct_wht','prod_batch','prod_lot'];
$$;

-- ── fn_doc_default — ยกจาก 20260928000077_doc_numbering_phase2.sql · เติม sales_cn (CN) ──
create or replace function fn_doc_default(p_type text) returns jsonb
language sql immutable set search_path = public as $$
  select case
    when p_type in ('sales_qu','sales_ord','sales_inv','sales_tax','sales_rcpt','sales_cn','bar_bill','bar_rcpt') then
      jsonb_build_object('prefix', case p_type
          when 'sales_qu' then 'QU' when 'sales_ord' then 'ORD' when 'sales_inv' then 'INV'
          when 'sales_tax' then 'TAX' when 'sales_rcpt' then 'RC' when 'sales_cn' then 'CN'
          when 'bar_bill' then 'B' when 'bar_rcpt' then 'BR' end,
        'date_fmt', 'YYMMDD', 'era', 'ce', 'reset', 'day', 'digits', 3, 'sep', '-', 'num_first', false)
    -- `6901` · `69100` = ปี พ.ศ. 2 หลัก + ลำดับอย่างน้อย 2 หลัก ไม่มีตัวคั่น (golden A9)
    when p_type = 'acct_wht' then
      jsonb_build_object('prefix', '', 'date_fmt', 'YY', 'era', 'be', 'reset', 'year',
                         'digits', 2, 'sep', '', 'num_first', false)
    -- `12/69` = เลขรันหน้าปี พ.ศ. ไม่เติมศูนย์ (golden P12)
    when p_type = 'prod_batch' then
      jsonb_build_object('prefix', '', 'date_fmt', 'YY', 'era', 'be', 'reset', 'year',
                         'digits', 1, 'sep', '/', 'num_first', true)
    -- `S1/69` (D94)
    when p_type = 'prod_lot' then
      jsonb_build_object('prefix', 'S', 'date_fmt', 'YY', 'era', 'be', 'reset', 'year',
                         'digits', 1, 'sep', '/', 'num_first', true)
  end;
$$;

-- ── fn_doc_nos — ยกจาก 20261030000101_sales_installments.sql · เติมเลขใบลดหนี้ ──
create or replace function fn_doc_nos(p_tenant uuid, p_type text, p_entity text)
returns setof text language sql stable set search_path = public as $$
  select x from (
    select unnest(array[qu_no, order_no, inv_no, dep_inv_no, tax_no1, tax_no2, rcpt_no1, rcpt_no2]) as x
      from sales_orders where left(p_type, 6) = 'sales_' and tenant_id = p_tenant
    union all
    -- ★ D145 — ใบเสร็จรายงวดเก็บเลขที่แถวการรับเงิน · ใบแจ้งหนี้รายงวดเก็บที่แผนงวด
    select doc_no from sales_payments where left(p_type, 6) = 'sales_' and tenant_id = p_tenant
    union all
    -- ★ D159 — ใบลดหนี้ (เลขชุดของตัวเอง แต่กันเลขซ้ำร่วมกับเอกสารขายทุกใบเหมือนชุดอื่น)
    select cn_no from sales_credit_notes where left(p_type, 6) = 'sales_' and tenant_id = p_tenant
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

-- ── fn_mig_truncate — ยกจาก 20261030000101_sales_installments.sql · เติม sales_credit_notes ก่อน sales_orders ──
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
    'sales_credit_notes','sales_payments','sales_installments','sales_order_items','sales_orders','warehouse_stock','stock_moves','sale_menu',
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
-- 🚨 D99: fn_mig_truncate ถูกนิยามใหม่ในไฟล์นี้ → revoke ซ้ำ (revoke from public อย่างเดียวไม่มีผลบน Supabase)
revoke execute on function fn_mig_truncate(uuid) from public, anon, authenticated;

-- ── fn_cancel_order — ยกจาก 20261030000101_sales_installments.sql · เติมใบลดหนี้ (p_credit) ──
drop function if exists fn_cancel_order(text);
create function fn_cancel_order(p_qu_no text, p_credit jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  -- D91 — ซ่อนคู่ จ่าย/รับ ออกจากฟอร์ม ภส. ได้ไหม (คำถามอยู่ที่ fn_excise_months_open ที่เดียว)
  v_hide boolean := false; v_locked text[];
  v_order sales_orders%rowtype;
  v_ref text; mv record; v_before numeric; v_after numeric;
  v_reversed int := 0;
  v_tenant uuid := my_tenant();
  -- D159 — ใบลดหนี้
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_has_vat boolean; v_cn_required boolean;
  v_cn_no text; v_cn_date date; v_cn_tx text; v_reason text; v_detail text; v_acc text;
  v_min_date date; v_entity text; s record;
begin
  -- 🚨 ยกเลิก = void ใบกำกับภาษีที่ออกไปแล้ว + คืนสต็อก → **ระดับหัวหน้าเท่านั้น**
  --    ใช้ sales.config (มีแต่ sales_manager กับ main) จงใจไม่ใช่ sales.write
  if not has_cap('sales.config') then raise exception 'ไม่มีสิทธิ์ยกเลิกออเดอร์ (เฉพาะหัวหน้าฝ่ายขาย)'; end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;

  select * into v_order from sales_orders
    where qu_no = p_qu_no and tenant_id = v_tenant for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบออเดอร์ ' || p_qu_no); end if;
  v_ref := coalesce(v_order.order_no, p_qu_no);

  -- ★ D159 — ใบกำกับที่มี VAT ของออเดอร์นี้: อยู่งวดที่ยื่น ภพ.30 แล้ว หรือเดือนก่อน = ห้ามยกเลิกแบบเดิม
  --   (ภาษีขายจะหายจากงวดเดิมย้อนหลัง) ต้องออกใบลดหนี้ · ฝาแฝด TS: cancelMode() ใน lib/sales/creditNote.ts
  select exists (select 1 from transactions t
     where t.tenant_id = v_tenant and t.status <> 'ยกเลิก'
       and (t.idempotency_key in (v_ref, v_ref || '-balance')
            or t.tx_id in (select p.tx_id from sales_payments p
                            where p.tenant_id = v_tenant and p.qu_no = p_qu_no and p.tx_id is not null)) and t.vat_amount > 0),
         exists (select 1 from transactions t
     where t.tenant_id = v_tenant and t.status <> 'ยกเลิก'
       and (t.idempotency_key in (v_ref, v_ref || '-balance')
            or t.tx_id in (select p.tx_id from sales_payments p
                            where p.tenant_id = v_tenant and p.qu_no = p_qu_no and p.tx_id is not null)) and t.vat_amount > 0
                   and (to_char(t.transaction_date, 'YYYY-MM') <> to_char(v_today, 'YYYY-MM')
                        or exists (select 1 from tax_filings f
                                    where f.tenant_id = v_tenant and f.entity_id = t.entity_id and f.kind = 'vat'
                                      and f.period = to_char(t.transaction_date, 'YYYY-MM') and f.reopened_at is null)))
    into v_has_vat, v_cn_required;

  if p_credit is null then
    if v_cn_required then
      raise exception 'ออเดอร์นี้มีใบกำกับภาษีในเดือนก่อน หรือเดือนที่ยื่น ภ.พ.30 แล้ว — ยกเลิกแบบเดิมจะทำให้ภาษีขายหายจากงวดเดิม ต้องออกใบลดหนี้';
    end if;
  -- 1) void รายรับที่ลงบัญชีแล้ว (deposit + balance)
  update transactions set status = 'ยกเลิก'
    where tenant_id = v_tenant
      and (idempotency_key in (v_ref, v_ref || '-balance')
           -- ★ D145 — บิลของทุกงวด (key ไม่ใช่ ref/-balance) ตามแถวการรับเงิน
           or tx_id in (select p.tx_id from sales_payments p
                         where p.tenant_id = v_tenant and p.qu_no = p_qu_no and p.tx_id is not null))
      and status <> 'ยกเลิก';
  else
    -- ── ออกใบลดหนี้ (ม.86/10) · บิลรายรับเดิมคงสถานะปกติ ⇒ ภพ.30 งวดเดิมไม่ขยับ ──
    if not v_has_vat then raise exception 'ออเดอร์นี้ไม่มีใบกำกับภาษีให้ลดหนี้ — ยกเลิกแบบเดิมได้เลย'; end if;
    v_reason := p_credit->>'reason';
    v_detail := coalesce(trim(p_credit->>'detail'), '');
    if v_reason is null or v_reason <> all (array['return','refund_advance','price_error','other']) then
      raise exception 'เลือกเหตุที่ออกใบลดหนี้';
    end if;
    if v_reason = 'other' and v_detail = '' then raise exception 'เหตุอื่น — พิมพ์อธิบายสั้น ๆ ว่าลดหนี้เพราะอะไร'; end if;
    v_cn_date := coalesce(nullif(p_credit->>'date', '')::date, v_today);
    if v_cn_date > v_today then raise exception 'วันที่ใบลดหนี้ต้องไม่เป็นวันในอนาคต'; end if;
    select max(coalesce(t.tax_invoice_date, t.transaction_date)), min(t.entity_id) into v_min_date, v_entity
      from transactions t
     where t.tenant_id = v_tenant and t.status <> 'ยกเลิก'
       and (t.idempotency_key in (v_ref, v_ref || '-balance')
            or t.tx_id in (select p.tx_id from sales_payments p
                            where p.tenant_id = v_tenant and p.qu_no = p_qu_no and p.tx_id is not null)) and t.vat_amount > 0;
    if v_cn_date < v_min_date then raise exception 'วันที่ใบลดหนี้ต้องไม่ก่อนวันที่ใบกำกับเดิม (%)', v_min_date; end if;
    if not coalesce((select e.is_vat from entities e where e.tenant_id = v_tenant and e.entity_id = v_entity), false) then
      raise exception 'กิจการที่ออกใบกำกับไม่ได้จดทะเบียน VAT แล้ว — ออกใบลดหนี้ไม่ได้';
    end if;
    v_acc := nullif(trim(p_credit->>'refund_account'), '');
    if v_acc is not null and not exists (select 1 from bank_accounts b where b.tenant_id = v_tenant and b.account_name = v_acc) then
      raise exception 'ไม่พบบัญชี % ที่ใช้คืนเงิน', v_acc;
    end if;

    -- ★ ยอด = ผลรวมของที่บันทึกไว้ในบิลเดิมตรง ๆ (ไม่ถอด VAT ใหม่ — สูตรเงินมีที่เดียว)
    select coalesce(sum(t.base_amount), 0) as base, coalesce(sum(t.discount), 0) as disc,
           coalesce(sum(t.amount_after_discount), 0) as pre, coalesce(sum(t.vat_amount), 0) as vat,
           coalesce(max(t.wht_rate), 0) as wrate, coalesce(sum(t.wht_amount), 0) as wht,
           coalesce(sum(t.net_amount), 0) as net,
           min(t.category) as cat, min(t.contact_name) as cname, min(t.contact_id) as cid,
           jsonb_agg(jsonb_build_object('tx_id', t.tx_id, 'doc_no', t.tax_invoice_no,
                     'date', coalesce(t.tax_invoice_date, t.transaction_date),
                     'pre_vat', t.amount_after_discount, 'vat', t.vat_amount) order by t.transaction_date, t.tx_id) as refs,
           string_agg(t.tax_invoice_no, ', ' order by t.transaction_date, t.tx_id) as nos
      into s from transactions t
     where t.tenant_id = v_tenant and t.status <> 'ยกเลิก'
       and (t.idempotency_key in (v_ref, v_ref || '-balance')
            or t.tx_id in (select p.tx_id from sales_payments p
                            where p.tenant_id = v_tenant and p.qu_no = p_qu_no and p.tx_id is not null)) and t.vat_amount > 0;

    v_cn_no := fn_next_doc_no('sales_cn', null, v_cn_date);
    v_cn_tx := next_tx_id();
    insert into transactions(
      tenant_id, tx_id, transaction_date, type, account_name, category, contact_name, contact_id,
      description, base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount,
      net_amount, tax_invoice_no, tax_invoice_date, status, entity_id, ap_ar_status, idempotency_key, source
    ) values (
      v_tenant, v_cn_tx, v_cn_date, 'ลดหนี้ขาย', v_acc, s.cat, s.cname, s.cid,
      'ใบลดหนี้ ' || v_cn_no || ' อ้างใบกำกับ ' || coalesce(s.nos, '-') || ' (ยกเลิก ' || v_ref || ')',
      s.base, s.disc, s.pre, s.vat, s.wrate, s.wht, s.net, v_cn_no, v_cn_date, 'ปกติ', v_entity,
      case when v_acc is null then 'AP' end, 'CN:' || v_ref, 'sales'
    );
    insert into sales_credit_notes(tenant_id, cn_no, qu_no, entity_id, cn_date, reason, detail, reason_text,
                                   refs, original_value, correct_value, diff_value, vat_amount, total_amount,
                                   refund_amount, wht_amount, refund_account, tx_id)
    values (v_tenant, v_cn_no, p_qu_no, v_entity, v_cn_date, v_reason, v_detail,
            coalesce(nullif(trim(p_credit->>'reason_text'), ''), v_reason),
            s.refs, s.pre, 0, s.pre, s.vat, round(s.pre + s.vat, 2), s.net, s.wht, v_acc, v_cn_tx);
  end if;

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
    'ok', true, 'reversed_stock', v_reversed, 'cn_no', v_cn_no,
    'excise_hidden', v_hide,
    'excise_locked_months', coalesce(to_jsonb(v_locked), '[]'::jsonb));
end $$;
