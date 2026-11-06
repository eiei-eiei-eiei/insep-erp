-- ════════════════════════════════════════════════════════════════════════════
-- 0107 — D160: ใบลดหนี้บางส่วน (คืนบางรายการ / ลดราคา) โดยไม่ยกเลิกออเดอร์ · เฟส 2 ของ D159
--
-- ★ ผู้ใช้ตัดสิน: ออกได้เฉพาะออเดอร์ "ปิดการขาย" · เลือกรายการ+จำนวน หรือกรอกยอด · คืนเข้าสต็อกเลือกทุกครั้ง
-- ★ ยอดคิดที่ lib/sales/creditNote.ts (partialTotals) ที่เดียว · RPC ตรวจขอบเขต/ความสอดคล้องเท่านั้น
-- ★ มีใบลดหนี้บางส่วนแล้ว = ยกเลิกทั้งออเดอร์ไม่ได้ (คืนสต็อก/ภาษีซ้ำ) → ออกใบลดหนี้ส่วนที่เหลือแทน
-- 🚨 fn_cancel_order ยกจาก 20261105000106_sales_credit_note.sql ด้วย scripts/gen-0107.mjs (เติมด่านจุดเดียว)
-- ════════════════════════════════════════════════════════════════════════════

alter table sales_credit_notes
  add column if not exists kind text not null default 'cancel' check (kind in ('cancel','return','discount')),
  add column if not exists items jsonb not null default '[]'::jsonb,   -- [{id, name, qty, price}] รายการที่คืน
  add column if not exists restocked boolean not null default false;    -- คืนเข้าสต็อกแล้ว (คลัง + ฟอร์ม ภส.)

comment on column sales_credit_notes.kind is
  'D160 — cancel = ยกเลิกทั้งออเดอร์ (D159) · return = คืนบางรายการ · discount = ลดราคา';

-- ── fn_cancel_order — ยกจาก 20261105000106_sales_credit_note.sql · เติมด่าน "มีใบลดหนี้บางส่วนแล้ว" ──
create or replace function fn_cancel_order(p_qu_no text, p_credit jsonb default null)
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
  -- ★ D160 — มีใบลดหนี้บางส่วนแล้ว = ยกเลิกทั้งออเดอร์ไม่ได้ (คืนสต็อก/ภาษีจะซ้ำกับที่คืนไปแล้ว)
  --   ฝาแฝด TS: CANCEL_AFTER_PARTIAL_TEXT ใน lib/sales/creditNote.ts
  if exists (select 1 from sales_credit_notes cn where cn.tenant_id = v_tenant and cn.qu_no = p_qu_no and cn.kind <> 'cancel') then
    raise exception 'ออเดอร์นี้มีใบลดหนี้บางส่วนแล้ว — ยกเลิกทั้งออเดอร์ไม่ได้ (สต็อกและภาษีจะคืนซ้ำ) ให้กด ออกใบลดหนี้ สำหรับส่วนที่เหลือแทน';
  end if;

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

-- ── fn_sales_credit_note — ใหม่ ──
create or replace function fn_sales_credit_note(p_qu_no text, p_cn jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_order sales_orders%rowtype;
  v_ref text; v_kind text; v_reason text; v_detail text; v_date date; v_acc text;
  v_pre numeric; v_vat numeric; v_total numeric; v_wht numeric; v_refund numeric;
  v_bill_pre numeric; v_bill_vat numeric; v_rem_pre numeric; v_rem_vat numeric;
  v_max_date date; v_entity text; s record;
  v_cn_no text; v_cn_tx text; v_restock boolean; v_items jsonb;
  it jsonb; v_item record; v_done numeric; v_qty numeric;
  m record; v_real numeric; v_before numeric; v_after numeric; v_liquor boolean := false;
  v_locked text[];
begin
  -- 🚨 ใบลดหนี้ = ลดภาษีขายที่ยื่นแล้ว + คืนเงิน → ระดับหัวหน้าเท่านั้น (เส้นเดียวกับยกเลิกออเดอร์ D85)
  if not has_cap('sales.config') then raise exception 'ไม่มีสิทธิ์ออกใบลดหนี้ (เฉพาะหัวหน้าฝ่ายขาย)'; end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;

  select * into v_order from sales_orders where qu_no = p_qu_no and tenant_id = v_tenant for update;
  if not found then raise exception 'ไม่พบออเดอร์ %', p_qu_no; end if;
  if v_order.status <> 'ปิดการขาย' then
    raise exception 'ออกใบลดหนี้บางส่วนได้เฉพาะออเดอร์ที่ปิดการขายแล้ว';
  end if;
  v_ref := coalesce(v_order.order_no, p_qu_no);

  v_kind := p_cn->>'kind';
  if v_kind is null or v_kind <> all (array['return','discount']) then raise exception 'เลือกว่าคืนสินค้าหรือลดราคา'; end if;
  v_reason := p_cn->>'reason';
  v_detail := coalesce(trim(p_cn->>'detail'), '');
  if v_reason is null or v_reason <> all (array['return','refund_advance','price_error','other']) then
    raise exception 'เลือกเหตุที่ออกใบลดหนี้';
  end if;
  if v_reason = 'other' and v_detail = '' then raise exception 'เหตุอื่น — พิมพ์อธิบายสั้น ๆ ว่าลดหนี้เพราะอะไร'; end if;
  v_date := coalesce(nullif(p_cn->>'date', '')::date, v_today);
  if v_date > v_today then raise exception 'วันที่ใบลดหนี้ต้องไม่เป็นวันในอนาคต'; end if;

  select coalesce(sum(t.amount_after_discount), 0), coalesce(sum(t.vat_amount), 0),
         max(coalesce(t.tax_invoice_date, t.transaction_date)), min(t.entity_id)
    into v_bill_pre, v_bill_vat, v_max_date, v_entity
    from transactions t
     where t.tenant_id = v_tenant and t.status <> 'ยกเลิก' and t.vat_amount > 0
       and (t.idempotency_key in (v_ref, v_ref || '-balance')
            or t.tx_id in (select p.tx_id from sales_payments p
                            where p.tenant_id = v_tenant and p.qu_no = p_qu_no and p.tx_id is not null));
  if v_bill_vat <= 0 then raise exception 'ออเดอร์นี้ไม่มีใบกำกับภาษีให้ลดหนี้'; end if;
  if v_date < v_max_date then raise exception 'วันที่ใบลดหนี้ต้องไม่ก่อนวันที่ใบกำกับเดิม (%)', v_max_date; end if;
  if not coalesce((select e.is_vat from entities e where e.tenant_id = v_tenant and e.entity_id = v_entity), false) then
    raise exception 'กิจการที่ออกใบกำกับไม่ได้จดทะเบียน VAT แล้ว — ออกใบลดหนี้ไม่ได้';
  end if;

  -- ★ ยอดที่ยังลดได้ = ใบกำกับทุกใบ − ใบลดหนี้ที่ออกไปแล้ว (ฝาแฝด partialRemaining ใน lib/sales/creditNote.ts)
  select round(v_bill_pre - coalesce(sum(cn.diff_value), 0), 2), round(v_bill_vat - coalesce(sum(cn.vat_amount), 0), 2)
    into v_rem_pre, v_rem_vat
    from sales_credit_notes cn where cn.tenant_id = v_tenant and cn.qu_no = p_qu_no;

  -- ★ ยอดคิดที่ lib (สูตรมีที่เดียว) · ที่นี่ตรวจแค่ขอบเขตและความสอดคล้อง — ยิง API ตรงก็ไม่รอด
  v_pre := round((p_cn->>'pre')::numeric, 2);
  v_vat := round((p_cn->>'vat')::numeric, 2);
  v_total := round((p_cn->>'total')::numeric, 2);
  v_wht := round(coalesce((p_cn->>'wht')::numeric, 0), 2);
  v_refund := round((p_cn->>'refund')::numeric, 2);
  if v_pre is null or v_pre <= 0 or v_vat is null or v_vat < 0 or v_wht < 0 then
    raise exception 'ยอดใบลดหนี้ไม่ถูกต้อง';
  end if;
  if round(v_pre + v_vat, 2) <> v_total or round(v_total - v_wht, 2) <> v_refund then
    raise exception 'ยอดใบลดหนี้ไม่สอดคล้องกัน (ก่อน VAT + VAT ต้องเท่ายอดรวม)';
  end if;
  if v_pre > v_rem_pre + 0.005 or v_vat > v_rem_vat + 0.005 then
    raise exception 'ลดได้ไม่เกินยอดที่เหลือ (ก่อน VAT % · VAT %)', v_rem_pre, v_rem_vat;
  end if;

  -- รายการที่คืน: ต้องเป็นของออเดอร์นี้ และไม่เกินจำนวนที่ยังไม่ได้คืน
  v_items := '[]'::jsonb;
  if v_kind = 'return' then
    if jsonb_array_length(coalesce(p_cn->'items', '[]'::jsonb)) = 0 then raise exception 'เลือกรายการที่ลูกค้าคืน'; end if;
    -- 🚨 รายการเดียวกันซ้ำในคำขอเดียว = ด่าน "ไม่เกินที่เหลือ" ข้างล่างนับแต่ใบเก่า → คืนเกินได้
    if (select count(*) from jsonb_array_elements(p_cn->'items')) <> (select count(distinct x->>'id') from jsonb_array_elements(p_cn->'items') x) then
      raise exception 'รายการที่คืนซ้ำกัน — รวมเป็นบรรทัดเดียว';
    end if;
    for it in select value from jsonb_array_elements(p_cn->'items') loop
      v_qty := (it->>'qty')::numeric;
      select soi.id, soi.item_name, soi.qty, soi.price into v_item from sales_order_items soi
        where soi.tenant_id = v_tenant and soi.qu_no = p_qu_no and soi.id = (it->>'id')::bigint;
      if not found then raise exception 'ไม่พบรายการ % ในออเดอร์นี้', it->>'id'; end if;
      select coalesce(sum((x->>'qty')::numeric), 0) into v_done
        from sales_credit_notes cn, jsonb_array_elements(cn.items) x
       where cn.tenant_id = v_tenant and cn.qu_no = p_qu_no and (x->>'id')::bigint = v_item.id;
      if v_qty is null or v_qty <= 0 or v_done + v_qty > v_item.qty + 0.000001 then
        raise exception '%: คืนได้ไม่เกิน %', v_item.item_name, v_item.qty - v_done;
      end if;
      v_items := v_items || jsonb_build_object('id', v_item.id, 'name', v_item.item_name, 'qty', v_qty, 'price', v_item.price);
    end loop;
  end if;

  v_acc := nullif(trim(p_cn->>'refund_account'), '');
  if v_acc is not null and not exists (select 1 from bank_accounts b where b.tenant_id = v_tenant and b.account_name = v_acc) then
    raise exception 'ไม่พบบัญชี % ที่ใช้คืนเงิน', v_acc;
  end if;

  select min(t.category) as cat, min(t.contact_name) as cname, min(t.contact_id) as cid,
         coalesce(max(t.wht_rate), 0) as wrate,
         jsonb_agg(jsonb_build_object('tx_id', t.tx_id, 'doc_no', t.tax_invoice_no,
                   'date', coalesce(t.tax_invoice_date, t.transaction_date),
                   'pre_vat', t.amount_after_discount, 'vat', t.vat_amount) order by t.transaction_date, t.tx_id) as refs,
         string_agg(t.tax_invoice_no, ', ' order by t.transaction_date, t.tx_id) as nos
    into s from transactions t
     where t.tenant_id = v_tenant and t.status <> 'ยกเลิก' and t.vat_amount > 0
       and (t.idempotency_key in (v_ref, v_ref || '-balance')
            or t.tx_id in (select p.tx_id from sales_payments p
                            where p.tenant_id = v_tenant and p.qu_no = p_qu_no and p.tx_id is not null));

  v_cn_no := fn_next_doc_no('sales_cn', null, v_date);
  v_cn_tx := next_tx_id();
  insert into transactions(
    tenant_id, tx_id, transaction_date, type, account_name, category, contact_name, contact_id,
    description, base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount,
    net_amount, tax_invoice_no, tax_invoice_date, status, entity_id, ap_ar_status, idempotency_key, source
  ) values (
    v_tenant, v_cn_tx, v_date, 'ลดหนี้ขาย', v_acc, s.cat, s.cname, s.cid,
    'ใบลดหนี้ ' || v_cn_no || ' (' || case v_kind when 'return' then 'คืนสินค้า' else 'ลดราคา' end
      || ') อ้างใบกำกับ ' || coalesce(s.nos, '-') || ' (' || v_ref || ')',
    v_pre, 0, v_pre, v_vat, s.wrate, v_wht, v_refund, v_cn_no, v_date, 'ปกติ', v_entity,
    case when v_acc is null then 'AP' end, 'CN:' || v_cn_no, 'sales'
  );

  v_restock := v_kind = 'return' and coalesce((p_cn->>'restock')::boolean, false);
  insert into sales_credit_notes(tenant_id, cn_no, qu_no, entity_id, cn_date, reason, detail, reason_text,
                                 refs, original_value, correct_value, diff_value, vat_amount, total_amount,
                                 refund_amount, wht_amount, refund_account, tx_id, kind, items, restocked)
  values (v_tenant, v_cn_no, p_qu_no, v_entity, v_date, v_reason, v_detail,
          coalesce(nullif(trim(p_cn->>'reason_text'), ''), v_reason),
          s.refs, v_rem_pre, round(v_rem_pre - v_pre, 2), v_pre, v_vat, v_total, v_refund, v_wht, v_acc, v_cn_tx,
          v_kind, v_items, v_restock);

  -- ── คืนเข้าสต็อก (ผู้ใช้เลือกทุกครั้ง) — คลัง + ฟอร์ม ภส. (สุรา = รับคืน) · ใช้แผนที่เมนูเดียวกับตอนส่งของ ──
  --   ★ อ้างอิงด้วยเลขใบลดหนี้ ไม่ใช่เลขออเดอร์ → ไม่ไปปนกับคู่ จ่าย/รับ ของการยกเลิก (D90/D91)
  if v_restock then
    for it in select value from jsonb_array_elements(v_items) loop
      select sm.product_id, coalesce(sm.multiplier, 1) as mult, sm.category into m
        from sale_menu sm
       where sm.tenant_id = v_tenant and sm.entity_id = v_order.entity_id and trim(sm.menu_name) = trim(it->>'name')
       limit 1;
      if m.product_id is null or trim(m.product_id) = '' then continue; end if;
      v_real := (it->>'qty')::numeric * m.mult;
      select qty into v_before from warehouse_stock
        where item_code = trim(m.product_id) and tenant_id = v_tenant and entity_id = v_order.entity_id for update;
      if found then
        v_after := coalesce(v_before, 0) + v_real;
        update warehouse_stock set qty = v_after
          where item_code = trim(m.product_id) and tenant_id = v_tenant and entity_id = v_order.entity_id;
        insert into stock_moves(tenant_id, entity_id, item_code, item_name, qty_before, action, qty,
                                ref_no, qty_after, user_name, remarks)
        values (v_tenant, v_order.entity_id, trim(m.product_id), it->>'name', coalesce(v_before, 0), 'IN', v_real,
                v_cn_no, v_after, 'system', 'รับคืนสินค้า: ใบลดหนี้ ' || v_cn_no || ' (' || v_ref || ')');
      end if;
      if m.category = 'สุรา' and v_real > 0 then
        v_liquor := true;
        insert into log_product(tenant_id, entity_id, doc_date, trans_type, product_id, amount, note, ref_no)
        values (v_tenant, v_order.entity_id, v_date, 'รับ', trim(m.product_id), v_real,
                'รับคืนสินค้า ใบลดหนี้ ' || v_cn_no || ' (' || v_ref || ')', v_cn_no);
      end if;
    end loop;
    -- เดือนที่ปิดบัญชีสรรพสามิตไปแล้ว → บอกกลับให้หน้าจอเตือน (ไม่บล็อก · แพตเทิร์น D91)
    if v_liquor then
      select array_agg(c.month) into v_locked from excise_month_close c
       where c.tenant_id = v_tenant and c.entity_id = v_order.entity_id
         and c.month = to_char(v_date, 'YYYY-MM') and c.reopened_at is null;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'cn_no', v_cn_no,
    'excise_locked_months', coalesce(to_jsonb(v_locked), '[]'::jsonb));
end $$;
