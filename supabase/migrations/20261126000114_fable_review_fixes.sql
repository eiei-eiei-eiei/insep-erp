-- ============================================================================
-- 0114 แก้ตามรีวิว Fable รอบ 1 (REVIEW_FABLE_1.md · คัดกรอง REVIEW_FABLE_1_TRIAGE.md) — D182
--
-- ★ ไฟล์นี้สร้างด้วย `node scripts/gen-0114.mjs` — ยกนิยามล่าสุดของแต่ละฟังก์ชันมาแล้วแทนที่ทีละจุด
--   (ทุกจุดต้องเจอครั้งเดียวพอดี ไม่งั้นสคริปต์หยุด) ห้ามแก้ไฟล์นี้มือ — แก้สคริปต์แล้วสร้างใหม่
-- ★ ทุกตัวเป็น create or replace (พารามิเตอร์เท่าเดิม) ⇒ สิทธิ์ execute คงเดิม ไม่ต้อง revoke ซ้ำ (D99)
--
--   R3  "วันนี้" ตามเวลาไทยใน 7 ฟังก์ชันที่ยังเหลือ current_date (UTC) — fn_cancel_order (แถว ภส.)
--       fn_receive_material · fn_sell_product · fn_sales_installment_invoice · fn_save_quotation
--       fn_save_transfer · fn_issue_wht   (ตัวอื่นแก้ไปแล้วใน 0075-0078 · D100)
--   R5  fn_delete_ferment_batch กัน batch ที่รินสุราแช่แล้ว
--   Y3  fn_save_transfer ไม่รับกิจการว่าง/'ALL'
--   Y4  fn_issue_wht เลิกฮาร์ดโค้ด 'EID01' — ใช้กิจการของบิล
--   Y5  fn_manual_stock_move กรอง tenant + กิจการ
--   Y6  fn_bar_void_line คิดส่วนลด % / ปัดเศษ ใหม่ + ยอดซื้อสะสมลูกค้า
--
-- 🚫 ไม่แตะ: R1 (กิจการเจ้าของออเดอร์ — ผู้ใช้สั่งพักไว้เป็นงานใหม่) · สูตร VAT/ภาษี/ดีกรี ไม่มีตัวไหนเปลี่ยน
-- ============================================================================

-- ── R3 · แถวรับคืนสต็อกสุรา (log_product → ฟอร์ม ภส.) ลงวันที่ไทย
--    ยกจาก 20261106000107_sales_credit_note_partial.sql (นิยามล่าสุด) · เปลี่ยนเฉพาะจุดที่มี ★ 0114
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
    select v_tenant, v_order.entity_id, v_today, 'รับ',   -- ★ 0114 R3: เดิม current_date (UTC)
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

-- ── R3 · รับวัตถุดิบจากบิล — วันที่ปริยายเป็นวันไทย
--    ยกจาก 20260827000051_roles_caps.sql (นิยามล่าสุด) · เปลี่ยนเฉพาะจุดที่มี ★ 0114
create or replace function fn_receive_material(
  p_idempotency_key text, p_date date, p_doc_ref text, p_note text, p_items jsonb,
  p_entity text default null      -- ★ ใหม่: กิจการของบิล (null = กิจการหลักของคนล็อกอิน)
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  mid text;
  n int := 0;
  v_tenant uuid := my_tenant();
  v_entity text := coalesce(nullif(p_entity, ''), my_default_entity());
  v_name text;
begin
  if not has_cap('acct.write') then
    raise exception 'ไม่มีสิทธิ์บันทึกรับวัตถุดิบ';
  end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if v_entity is null then raise exception 'ไม่รู้ว่าจะรับวัตถุดิบเข้ากิจการไหน'; end if;

  begin
    insert into integration_log(tenant_id, action, idempotency_key, status, payload)
    values (v_tenant, 'RECEIVE_MATERIAL', p_idempotency_key, 'ok', p_items);
  exception when unique_violation then
    return jsonb_build_object('duplicate', true);
  end;

  for it in select value from jsonb_array_elements(p_items) loop
    v_name := nullif(trim(coalesce(it ->> 'material_name', '')), '');
    if v_name is not null and (it ->> 'amount') is not null then
      -- match ด้วยชื่อเป๊ะ (trim) เหมือนเดิม — ห้าม fuzzy · จำกัดใน tenant + กิจการของบิล
      select material_id into mid from materials
        where tenant_id = v_tenant and entity_id = v_entity and trim(name) = v_name
        limit 1;
      if mid is null then
        -- อยู่คนละกิจการ = คนละเรื่องกับสะกดผิด ต้องบอกให้ต่างกัน ไม่งั้นผู้ใช้ไล่หาผิดทาง
        if exists (select 1 from materials where tenant_id = v_tenant and trim(name) = v_name) then
          raise exception 'วัตถุดิบ ''%'' มีอยู่ แต่คนละกิจการกับบิล (บิลลงกิจการ %)', v_name, v_entity;
        end if;
        raise exception 'ไม่พบชื่อวัตถุดิบ ''%'' กรุณาตรวจการสะกด', v_name;
      end if;
      insert into log_material(tenant_id, entity_id, doc_date, trans_type, material_id, amount, doc_ref, note)
      values (v_tenant, v_entity, coalesce(p_date, (now() at time zone 'Asia/Bangkok')::date), 'รับ', mid,   -- ★ 0114 R3
              (it ->> 'amount')::numeric, p_doc_ref, coalesce(p_note, 'รับจากระบบจัดซื้อ'));
      n := n + 1;
    end if;
  end loop;

  return jsonb_build_object('duplicate', false, 'count', n);
end $$;

-- ── R3 · ตัดสต็อกขาย — วันที่ปริยายเป็นวันไทย
--    ยกจาก 20260827000051_roles_caps.sql (นิยามล่าสุด) · เปลี่ยนเฉพาะจุดที่มี ★ 0114
create or replace function fn_sell_product(
  p_idempotency_key text, p_date date, p_trans_type text, p_note text, p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it jsonb; n int := 0; v_tenant uuid := my_tenant();
begin
  if not has_cap('sales.write') then
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
      values (coalesce(p_date, (now() at time zone 'Asia/Bangkok')::date), coalesce(p_trans_type, 'จ่าย'),   -- ★ 0114 R3
              it->>'product_id', (it->>'amount')::numeric, p_note);
      n := n + 1;
    end if;
  end loop;

  return jsonb_build_object('duplicate', false, 'count', n);
end $$;

-- ── R3 · ใบแจ้งหนี้รายงวด — วันที่ปริยายเป็นวันไทย
--    ยกจาก 20261030000102_sales_installment_invoice_status.sql (นิยามล่าสุด) · เปลี่ยนเฉพาะจุดที่มี ★ 0114
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

  update sales_installments set inv_no = trim(p_inv_no), inv_date = coalesce(p_inv_date, (now() at time zone 'Asia/Bangkok')::date),   -- ★ 0114 R3
         due_date = coalesce(p_due_date, due_date)
   where tenant_id = v_tenant and qu_no = p_qu_no and seq = p_seq;
  -- ★ D146 — ใบแจ้งหนี้งวดแรกออกแล้ว = แก้ใบเสนอราคาไม่ได้อีก (fn_update_quotation รับแค่ 'รอคอนเฟิร์ม')
  --   สถานะเดียวกับใบแจ้งหนี้มัดจำแบบเดิม (D45) — ใบอยู่ในมือลูกค้าแล้ว ยอดสุทธิห้ามเปลี่ยน
  update sales_orders set status = 'รอชำระมัดจำ'
   where tenant_id = v_tenant and qu_no = p_qu_no and status = 'รอคอนเฟิร์ม';
  return jsonb_build_object('ok', true, 'inv_no', trim(p_inv_no));
end $fn$;

-- ── R3 · วันหมดอายุใบเสนอราคา = วันนี้ (ไทย) + 15
--    ยกจาก 20260801000021_multibranch_and_quotation_terms.sql (นิยามล่าสุด) · เปลี่ยนเฉพาะจุดที่มี ★ 0114
create or replace function fn_save_quotation(p jsonb, p_items jsonb default '[]'::jsonb)
returns jsonb
language plpgsql set search_path = public as $$
declare
  v_qu text := fn_next_sales_doc('QU');
  v_ord text := fn_next_sales_doc('ORD');
  v_exp date := (now() at time zone 'Asia/Bangkok')::date + 15;   -- quExpire +15 วัน · ★ 0114 R3: เดิม current_date (UTC)
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

-- ── R3 + Y3 · โอนระหว่างบัญชี — วันไทย + ต้องระบุกิจการจริง (ไม่ใช่ 'ทุกกิจการ')
--    ยกจาก 20260928000075_doc_no_thai_date.sql (นิยามล่าสุด) · เปลี่ยนเฉพาะจุดที่มี ★ 0114
create or replace function fn_save_transfer(
  p_from text, p_to text, p_amount numeric, p_date date,
  p_note text default '', p_entity text default null
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_trf text;
  v_from_id text; v_to_id text;
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Bangkok')::date);   -- ★ 0114 R3
  v_note text := coalesce(trim(p_note),'');
begin
  if coalesce(p_from,'')='' or coalesce(p_to,'')='' then
    return jsonb_build_object('ok', false, 'error', 'กรุณาระบุบัญชีต้นทางและปลายทาง'); end if;
  if p_from = p_to then
    return jsonb_build_object('ok', false, 'error', 'บัญชีต้นทางและปลายทางต้องไม่ใช่บัญชีเดียวกัน'); end if;
  if coalesce(p_amount,0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'จำนวนเงินต้องมากกว่า 0'); end if;
  -- ★ 0114 Y3: เลือก "ทุกกิจการ" ที่แถบบนแล้วกดโอน = ส่ง 'ALL' / '' มา → FK ล้มด้วย error อังกฤษดิบ
  --   เงินโอนต้องอยู่กิจการใดกิจการหนึ่งเสมอ ⇒ บอกให้เลือกก่อน (ฝาแฝด TS: transferBlockedText)
  if coalesce(trim(p_entity),'') in ('', 'ALL') then
    return jsonb_build_object('ok', false, 'error', 'เลือกกิจการที่แถบด้านบนก่อน — เงินโอนต้องลงกิจการใดกิจการหนึ่ง (ตอนนี้เลือก "ทุกกิจการ" อยู่)'); end if;

  v_trf := 'TRF-' || to_char(fn_today_th(),'YYYYMMDD') || '-' ||
           lpad(next_serial('TRF-' || to_char(fn_today_th(),'YYYYMMDD'))::text, 4, '0');
  v_from_id := next_tx_id();
  v_to_id := next_tx_id();

  insert into transactions(tx_id, transaction_date, type, account_name, category, contact_name,
    description, net_amount, tax_invoice_date, status, transfer_id, entity_id, source)
  values
    (v_from_id, v_date, 'โอนระหว่างบัญชี', p_from, 'โอนระหว่างบัญชี', '',
     'โอนออกไป [' || p_to || ']' || case when v_note<>'' then ' · '||v_note else '' end,
     -p_amount, v_date, 'ปกติ', v_trf, coalesce(p_entity,''), 'ui'),
    (v_to_id, v_date, 'โอนระหว่างบัญชี', p_to, 'โอนระหว่างบัญชี', '',
     'รับโอนจาก [' || p_from || ']' || case when v_note<>'' then ' · '||v_note else '' end,
     p_amount, v_date, 'ปกติ', v_trf, coalesce(p_entity,''), 'ui');

  return jsonb_build_object('ok', true, 'transfer_id', v_trf, 'tx_id_from', v_from_id, 'tx_id_to', v_to_id);
end $$;

-- ── Y4 + R3 · ออก 50ทวิ — ไม่ระบุกิจการ = กิจการของบิล (เดิมตก EID01 เสมอ)
--    ยกจาก 20260819000043_payroll_filings.sql (นิยามล่าสุด) · เปลี่ยนเฉพาะจุดที่มี ★ 0114
create or replace function fn_issue_wht(
  p_doc_no text, p_tx_ids text[], p_issue_date date, p_contact_name text, p_address text,
  p_wht_amount numeric, p_pnd_type text, p_income_type text, p_income_seq int, p_base_amount numeric,
  p_payment_date date, p_entity_id text, p_contact_id text default null,
  p_emp_id text default null, p_tax_year int default null
) returns jsonb
language plpgsql set search_path = public as $$
declare
  -- ★ 0114 Y4: เดิม coalesce(…,'EID01') — tenant ที่กิจการแรกไม่ใช่ EID01 = FK ล้ม ·
  --   บิลของ EID02 ที่ออกจากมุม "ทุกกิจการ" = ใบออกในนาม EID01 + กินเลขชุดของ EID01
  --   ⇒ ไม่ระบุ = กิจการของบิลในใบ (ต้องเป็นกิจการเดียวกันทุกใบ) · ไม่มีบิล (50ทวิ พนักงาน) ต้องระบุเอง
  v_entity text := nullif(trim(coalesce(p_entity_id,'')),'');
  v_bill_ents text[];
  v_emp    text := nullif(p_emp_id,'');
  v_exist  text;
begin
  if v_entity is null or v_entity = 'ALL' then
    select array_agg(distinct entity_id) into v_bill_ents
      from transactions where tx_id = any(coalesce(p_tx_ids,'{}'));
    if coalesce(array_length(v_bill_ents, 1), 0) = 1 then
      v_entity := v_bill_ents[1];
    elsif coalesce(array_length(v_bill_ents, 1), 0) > 1 then
      return jsonb_build_object('ok', false, 'error', 'บิลในใบนี้อยู่คนละกิจการกัน — 1 ใบ 50ทวิ ออกได้ในนามกิจการเดียว');
    else
      return jsonb_build_object('ok', false, 'error', 'ไม่รู้ว่าออก 50ทวิ ในนามกิจการไหน — เลือกกิจการที่แถบด้านบนก่อน');
    end if;
  end if;

  if v_emp is not null then
    select doc_no into v_exist from wht_certificates
     where entity_id = v_entity and emp_id = v_emp and tax_year = p_tax_year
     limit 1;
    if v_exist is not null then
      return jsonb_build_object('ok', false,
        'error', 'ออก 50ทวิ ให้พนักงานคนนี้ของปีภาษีนี้ไปแล้ว (เลขที่ ' || v_exist || ')',
        'doc_no', v_exist);
    end if;
  end if;

  insert into wht_certificates(doc_no, issue_date, contact_name, contact_id, address, wht_amount,
    pnd_type, income_type, income_seq, base_amount, tx_ids, entity_id, emp_id, tax_year)
  values (p_doc_no, coalesce(p_issue_date, (now() at time zone 'Asia/Bangkok')::date), p_contact_name,   -- ★ 0114 R3
    nullif(p_contact_id,''),
    p_address, p_wht_amount,
    p_pnd_type, p_income_type, coalesce(p_income_seq, 6), p_base_amount, coalesce(p_tx_ids,'{}'),
    v_entity, v_emp, p_tax_year);

  -- เขียนวันที่จ่าย (col W เดิม) ให้ทุก tx ที่ออกใบนี้
  update transactions set payment_date = coalesce(p_payment_date, (now() at time zone 'Asia/Bangkok')::date)   -- ★ 0114 R3
    where tx_id = any(coalesce(p_tx_ids,'{}'));

  return jsonb_build_object('ok', true, 'doc_no', p_doc_no);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'เลขเอกสาร ' || p_doc_no || ' ถูกใช้แล้วในกิจการนี้ ลองใหม่');
end $$;

-- ── Y5 · ปรับสต็อกคลังขาย — กรองกิจการ (เดิมเขียนทับทุกกิจการที่ item_code ซ้ำ)
--    ยกจาก 20260720000013_sales_rpc.sql (นิยามล่าสุด) · เปลี่ยนเฉพาะจุดที่มี ★ 0114
create or replace function fn_manual_stock_move(p jsonb, p_user text)
returns jsonb
language plpgsql set search_path = public as $$
declare
  v_code text := p->>'itemCode';
  v_qty numeric := coalesce((p->>'qty')::numeric,0);
  v_type text := p->>'actionType';
  v_before numeric; v_name text; v_after numeric; v_action text;
  -- ★ 0114 Y5: PK คือ (tenant, entity, item_code) แต่เดิมหา/แก้ด้วย item_code อย่างเดียว
  --   ⇒ 2 กิจการที่มีรหัสเดียวกัน ถูกเขียนทับพร้อมกันด้วยเลขของแถวที่ select เจอก่อน
  --   ใช้กิจการเดียวกับที่ออเดอร์ใช้ (sales_orders.entity_id default = my_default_entity())
  --   🪤 ถ้าวันหน้าออเดอร์เลือกกิจการได้ (งานค้าง R1) ตัวนี้ต้องตามไปด้วย
  v_tenant uuid := my_tenant();
  v_entity text := my_default_entity();
begin
  if v_tenant is null or v_entity is null then
    return jsonb_build_object('ok', false, 'error', 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'); end if;
  select qty, item_name into v_before, v_name from warehouse_stock
   where tenant_id = v_tenant and entity_id = v_entity and item_code = v_code for update;   -- ★ 0114 Y5
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบรหัสสินค้านี้ในฐานข้อมูล (warehouse_stock)'); end if;

  v_action := v_type;
  if v_type = 'IN' then v_after := coalesce(v_before,0) + abs(v_qty);
  elsif v_type = 'OUT' then v_after := coalesce(v_before,0) - abs(v_qty);
  elsif v_type = 'ADJUST' then
    v_after := coalesce(v_before,0) + v_qty;
    v_action := case when v_qty >= 0 then 'ADJUST_IN' else 'ADJUST_OUT' end;
  else return jsonb_build_object('ok', false, 'error', 'ประเภทไม่ถูกต้อง'); end if;

  update warehouse_stock set qty = v_after
   where tenant_id = v_tenant and entity_id = v_entity and item_code = v_code;   -- ★ 0114 Y5
  -- ★ 0114 Y5: ระบุ tenant/กิจการตรง ๆ (เดิมพึ่ง default ของคอลัมน์)
  insert into stock_moves(tenant_id, entity_id, item_code, item_name, qty_before, action, qty, ref_no, qty_after, user_name, remarks)
  values (v_tenant, v_entity, v_code, v_name, coalesce(v_before,0), v_action, abs(v_qty), nullif(p->>'refNo',''), v_after, p_user, nullif(p->>'remarks',''));

  return jsonb_build_object('ok', true, 'newStock', v_after);
end $$;

-- ── R5 · ลบ batch หมัก — กันฝั่งสุราแช่ (รินแล้ว) ให้เท่าฝั่งกลั่น
--    ยกจาก 20260731000020_delete_ferment.sql (นิยามล่าสุด) · เปลี่ยนเฉพาะจุดที่มี ★ 0114
create or replace function fn_delete_ferment_batch(p_batch text) returns jsonb
language plpgsql set search_path = public as $$
declare n_ferment int; n_mat int; n_mon int;
begin
  if coalesce(p_batch, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'ไม่ระบุ batch');
  end if;

  -- guard: กลั่นไปแล้ว = มีข้อมูลกลั่น/ปิด batch (ภส.) → ห้ามลบ กันข้อมูลราชการหาย
  if exists (select 1 from log_distill_run where batch = p_batch)
     or exists (select 1 from log_distill where batch = p_batch) then
    return jsonb_build_object('ok', false,
      'error', 'batch "' || p_batch || '" กลั่นไปแล้ว ลบไม่ได้ (มีข้อมูลกลั่น/ภส.) — ถ้าต้องแก้จริงให้ลบค่ากลั่นในแท็บกลั่นก่อน');
  end if;

  -- ★ 0114 R5: ฝั่งสุราแช่ (D78) batch จบที่ "ริน" ไม่ใช่ "กลั่น" — เดิมไม่กัน ⇒ ลบผ่าน
  --   แล้ว log_ferment_draw ลอยค้าง: ฟอร์ม ภส.๐๗-๐๒/๑(๑) ฉบับสุราแช่หักน้ำหมักของ batch ที่ไม่มีบันทึกหมัก
  --   และ ๐๗-๐๑/๑ เสียแถวจ่ายวัตถุดิบ (สองข้างไม่สมมาตรแบบ D80-C2) · ข้อความบนจอคู่กัน: FermentTab.tsx
  if exists (select 1 from log_ferment_draw where batch = p_batch) then
    return jsonb_build_object('ok', false,
      'error', 'batch "' || p_batch || '" รินสุราแช่ไปแล้ว ลบไม่ได้ (มีข้อมูล ภส.) — ถ้าต้องแก้จริงให้ลบรายการรินในแท็บ "รินน้ำสุราแช่" ก่อน');
  end if;

  -- คืนวัตถุดิบ: ลบแถวเบิกอัตโนมัติของ batch นี้ (สต็อกวัตถุดิบคิดตอนอ่าน → คืนเอง)
  delete from log_material where doc_ref = p_batch and note = 'เบิกไปหมัก (อัตโนมัติ)';
  get diagnostics n_mat = row_count;

  -- ลบค่าติดตามหมักของ batch (ถ้ามี)
  delete from log_ferment_monitor where batch = p_batch;
  get diagnostics n_mon = row_count;

  -- ลบ batch หมัก (ครอบทุกถัง)
  delete from log_ferment where batch = p_batch;
  get diagnostics n_ferment = row_count;

  if n_ferment = 0 then
    return jsonb_build_object('ok', false, 'error', 'ไม่พบ batch ' || p_batch);
  end if;
  return jsonb_build_object('ok', true, 'ferment', n_ferment, 'material', n_mat, 'monitor', n_mon);
end $$;

-- ── Y6 · ยกเลิกรายการบิลบาร์ — ส่วนลด % / ปัดเศษ คิดจากยอดใหม่ · ยอดซื้อสะสมลูกค้าถอยตาม
--    ยกจาก 20261024000090_bar_house_spirit.sql (นิยามล่าสุด) · เปลี่ยนเฉพาะจุดที่มี ★ 0114
create or replace function fn_bar_void_line(
  p_entity text, p_sale_no text, p_line_no int, p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_sale bar_sale%rowtype;
  v_item bar_sale_item%rowtype;
  v_rec record;
  v_sub numeric;
  v_cost numeric;
  -- ★ 0114 Y6
  v_disc numeric; v_after numeric; v_round numeric; v_grand numeric; v_round_cash boolean;
begin
  select * into v_sale from bar_sale
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no for update;
  if not found then raise exception 'ไม่พบบิล %', p_sale_no; end if;
  if v_sale.status = 'ยกเลิก' then raise exception 'บิล % ถูกยกเลิกไปแล้ว', p_sale_no; end if;

  if v_sale.rcpt_no is not null then
    raise exception 'บิลนี้ออกใบเสร็จเลขที่ % ไปแล้ว แก้รายการไม่ได้ — ต้องยกเลิกทั้งบิลแล้วออกใหม่', v_sale.rcpt_no;
  end if;
  if v_sale.business_date is not null and exists (
    select 1 from bar_post
     where tenant_id = v_tenant and entity_id = p_entity
       and post_date = v_sale.business_date and status = 'ปกติ'
  ) then
    raise exception 'ยอดวันที่ % ลงบัญชีไปแล้ว — ต้องถอนบัญชีวันนั้นก่อนจึงจะแก้รายการได้',
                    to_char(v_sale.business_date, 'DD/MM/YYYY');
  end if;

  select * into v_item from bar_sale_item
   where tenant_id = v_tenant and entity_id = p_entity
     and sale_no = p_sale_no and line_no = p_line_no for update;
  if not found then raise exception 'ไม่พบรายการที่ % ในบิล %', p_line_no, p_sale_no; end if;
  if v_item.voided_at is not null then raise exception 'รายการนี้ถูกยกเลิกไปแล้ว'; end if;

  update bar_sale_item set voided_at = now(), void_reason = p_reason
   where tenant_id = v_tenant and entity_id = p_entity
     and sale_no = p_sale_no and line_no = p_line_no;

  -- คืนสต็อก — D127: บรรทัดตั้งแต่ 0090 คืน **ตามที่ตัดไปจริง** (bar_move ของบรรทัดนี้)
  --   ไม่ใช่ตามสูตร/ขวดของช่องปัจจุบัน — เปลี่ยนขวด House Gin แล้วยกเลิกบิลเก่า ต้องคืนเข้าขวดเดิม
  if v_item.moves_linked then
    for v_rec in
      select m.item_id, -sum(m.delta) as amt
        from bar_move m
       where m.tenant_id = v_tenant and m.entity_id = p_entity
         and m.ref_no = p_sale_no and m.ref_line = p_line_no and m.reason = 'ขาย'
       group by m.item_id
    loop
      if v_rec.amt <> 0 then
        perform bar_apply_move(v_tenant, p_entity, v_rec.item_id, v_rec.amt,
                               'แก้บิล', p_sale_no, p_reason);
      end if;
    end loop;
  else
    -- บรรทัดก่อน 0090 ไม่มีร่องรอยรายบรรทัด → คืนตามสูตรของเมนูนั้นแบบเดิม (พฤติกรรมเดิมไม่ขยับ)
    for v_rec in
      select r.item_id, r.qty from bar_recipe r
       where r.tenant_id = v_tenant and r.entity_id = p_entity and r.menu_id = v_item.menu_id
    loop
      perform bar_apply_move(v_tenant, p_entity, v_rec.item_id, v_rec.qty * v_item.qty,
                             'แก้บิล', p_sale_no, p_reason);
    end loop;
  end if;

  -- 🚨 ยอดบิลต้องถูกเขียนทับใหม่จากแถวที่ยังอยู่ ไม่ใช่ปล่อยยอดเดิมค้าง
  select coalesce(sum(amount), 0), coalesce(sum(cost), 0) into v_sub, v_cost
    from bar_sale_item
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no
     and voided_at is null;

  -- ★ 0114 Y6 — เดิม: discount = least(เดิม, ยอดใหม่) · grand = … + rounding **เดิม**
  --   ⇒ ส่วนลด 10% ค้างเป็นบาทเดิม (ป้าย 10% ไม่ตรงกับบาท) · ยอดลงท้ายไม่กลมทั้งที่เปิดปัดเศษ
  --   · ยกเลิกหมดทั้งบิลเหลือ grand = rounding (เช่น 0.25)
  --   ใหม่ (ผู้ใช้ตัดสิน 2026-11-26): ลด % → คิดจากยอดใหม่ · ลดเป็นบาท → คงบาทเดิม (ไม่เกินยอด)
  --   ปัดเศษ → คิดใหม่จากค่าตั้ง bar_round_cash ปัจจุบัน (ตัวเดียวกับที่จอขายใช้) — ฝาแฝด TS: barTotals()
  v_disc := case when v_sale.discount_pct is not null
                 then round(v_sub * least(v_sale.discount_pct, 100) / 100, 2)
                 else v_sale.discount end;
  v_disc := least(greatest(coalesce(v_disc, 0), 0), v_sub);
  v_after := greatest(0, v_sub - v_disc);
  select exists (select 1 from app_settings
                  where tenant_id = v_tenant and kind = 'bar_round_cash' and value = '1')
    into v_round_cash;
  -- 🪤 บิลที่ยังเปิดอยู่ไม่ปัด (ยังไม่ได้ปิดบิล — fn_bar_close_sale คิดทั้งก้อนใหม่ตอนปิดเอง)
  v_round := case when v_round_cash and v_sale.status = 'ปกติ' then round(v_after) - v_after else 0 end;
  v_grand := v_after + v_round;

  update bar_sale s set
    sub_total = v_sub,
    discount = v_disc,
    rounding = v_round,
    grand_total = v_grand,
    cost_total = v_cost
  where s.tenant_id = v_tenant and s.entity_id = p_entity and s.sale_no = p_sale_no;

  -- ★ 0114 Y6: ยอดซื้อสะสมลูกค้าถอยตามส่วนที่หายไป — ไม่งั้นยกเลิกทั้งบิลทีหลัง (fn_bar_void_sale
  --   หักด้วย grand_total ใหม่) จะเหลือยอดค้างเท่ารายการที่ยกเลิกไปก่อนหน้า
  if v_sale.status = 'ปกติ' and v_sale.customer_id is not null then
    update bar_customer set spend_total = greatest(0, spend_total - (v_sale.grand_total - v_grand))
     where tenant_id = v_tenant and entity_id = p_entity and customer_id = v_sale.customer_id;
  end if;

  return jsonb_build_object('ok', true, 'sale_no', p_sale_no, 'sub_total', v_sub);
end $fn$;
