-- ============================================================================
-- 0011 accounting RPC — บันทึก/แก้ transaction แบบ atomic + audit (sec 6.2)
--   fn_save_transaction   entry บิลเดี่ยว + (option) forward ต้นทุนสุรา→log_material (T6)
--   fn_save_installments  แบ่งจ่ายงวด (A6) — money math มาจาก lib splitInstallments (golden)
--   fn_save_transfer      โอนระหว่างบัญชี 2 แถว ผูก transfer_id (A7)
--   fn_settle_apar        ชำระบิลค้าง (A5) — เคลียร์ ap_ar_status + payment_date
--   fn_void_transaction   soft-delete 'ยกเลิก' ทั้งกลุ่มงวด/โอน (A14) — ห้าม hard delete
--   fn_issue_wht          ออก 50ทวิ (A9) — insert wht_certificates + เขียน payment_date
--
-- ทั้งหมด SECURITY INVOKER → RLS (tx_w/ti_w/wht_w main + entity scope) บังคับสิทธิ์
--   ยกเว้น forward ต้นทุนสุรา เรียก fn_receive_material (SECURITY DEFINER เดิม, 0010)
-- money ทุกตัวคำนวณจาก lib (client) แล้วส่งค่ามาเก็บ — เหมือน calculateSummary เดิม (client-side)
-- ============================================================================

-- tx_id 'TR-yyyyMMdd-NNNN' (reset รายวันตามวันที่สร้าง = ปัจจุบัน) — แทน getNextTxId_
create or replace function next_tx_id() returns text
language sql set search_path = public as $$
  select 'TR-' || to_char(current_date, 'YYYYMMDD') || '-' ||
         lpad(next_serial('TR-' || to_char(current_date, 'YYYYMMDD'))::text, 4, '0');
$$;

-- helper อ่านวันที่จาก jsonb (ค่าว่าง → null)
create or replace function _d(p jsonb, k text) returns date
language sql immutable as $$ select nullif(p ->> k, '')::date $$;

-- ── A3 entry: บันทึกบิลเดี่ยว + items + (option) forward ต้นทุนสุรา ─────────────
create or replace function fn_save_transaction(
  p jsonb,            -- ฟิลด์ transaction (ค่าเงินคำนวณจาก entryCalc ฝั่ง client แล้ว)
  p_items jsonb default '[]'::jsonb
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_tx_id text := next_tx_id();
  it jsonb;
  idx int := 0;
  fwd_items jsonb;
  fwd jsonb;
  warning text := null;
begin
  insert into transactions(
    tx_id, transaction_date, type, account_name, category, contact_name, description,
    base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
    tax_invoice_no, tax_invoice_date, receipt_image_url, status, entity_id,
    ap_ar_status, due_date, source
  ) values (
    v_tx_id, _d(p,'transaction_date'), p->>'type', nullif(p->>'account_name',''), p->>'category',
    p->>'contact_name', p->>'description',
    coalesce((p->>'base_amount')::numeric,0), coalesce((p->>'discount')::numeric,0),
    coalesce((p->>'amount_after_discount')::numeric,0), coalesce((p->>'vat_amount')::numeric,0),
    coalesce((p->>'wht_rate')::numeric,0), coalesce((p->>'wht_amount')::numeric,0),
    coalesce((p->>'net_amount')::numeric,0),
    nullif(p->>'tax_invoice_no',''), _d(p,'tax_invoice_date'), nullif(p->>'receipt_image_url',''),
    coalesce(nullif(p->>'status',''),'ปกติ'), p->>'entity_id',
    nullif(p->>'ap_ar_status',''), _d(p,'due_date'), coalesce(nullif(p->>'source',''),'ui')
  );

  for it in select value from jsonb_array_elements(p_items) loop
    idx := idx + 1;
    insert into transaction_items(
      item_id, tx_id, item_name, quantity, in_vat, ex_vat, total_price,
      discount_pct, discount_baht, item_category, item_job
    ) values (
      v_tx_id || '-' || lpad(idx::text,2,'0'), v_tx_id, it->>'item_name',
      coalesce((it->>'quantity')::numeric,1), coalesce((it->>'in_vat')::numeric,0),
      coalesce((it->>'ex_vat')::numeric,0), coalesce((it->>'total_price')::numeric,0),
      coalesce((it->>'discount_pct')::numeric,0), coalesce((it->>'discount_baht')::numeric,0),
      nullif(it->>'item_category',''), nullif(it->>'item_job','')
    );
  end loop;

  -- T6: forward ต้นทุนสุรา → รับวัตถุดิบเข้าสต็อกผลิต (fn_receive_material, idempotency = tx_id)
  -- คง "พฤติกรรม warning เดิม": ถ้า forward พลาด บัญชียัง commit + คืน warning (ไม่ roll back)
  if coalesce((p->>'forward_material')::boolean,false)
     and jsonb_array_length(coalesce(p_items,'[]'::jsonb)) > 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
             'material_name', it->>'item_name', 'amount', coalesce((it->>'quantity')::numeric,0))),'[]'::jsonb)
      into fwd_items from jsonb_array_elements(p_items) it;
    begin
      fwd := fn_receive_material(
        v_tx_id, _d(p,'transaction_date'),
        case when coalesce(p->>'tax_invoice_no','') <> '' and p->>'tax_invoice_no' <> '-'
             then p->>'tax_invoice_no' else v_tx_id end,
        'รับจาก ' || coalesce(nullif(p->>'contact_name',''),'ไม่ระบุชื่อ') ||
          case when coalesce(p->>'description','') <> '' then ' (' || (p->>'description') || ')' else '' end,
        fwd_items);
    exception when others then
      warning := 'บันทึกบัญชีสำเร็จ แต่รับวัตถุดิบเข้าสต็อกผลิตไม่ได้: ' || sqlerrm ||
                 ' — ตรวจชื่อวัตถุดิบ/เพิ่มใน master แล้วบันทึกรับเองในแอปผลิต';
    end;
  end if;

  return jsonb_build_object('ok', true, 'tx_id', v_tx_id, 'warning', warning);
end $$;

-- ── A6 installments: บันทึกหลายงวด (ทุกงวด = บิลค้าง AP/AR) ─────────────────────
-- p_rows = ผลจาก splitInstallments (lib) แต่ละงวด {base, vat_amount, wht_rate, wht_amount,
--          net_amount, installment_no, installment_total, due_date, description}
create or replace function fn_save_installments(
  p jsonb,            -- header: transaction_date, type, category, contact_name, entity_id
  p_rows jsonb,
  p_items jsonb default '[]'::jsonb
) returns jsonb
language plpgsql set search_path = public as $$
declare
  r jsonb; it jsonb;
  v_tx_id text;
  v_group text := null;
  ap_status text := case when p->>'type' = 'รายรับ' then 'AR' else 'AP' end;
  idx int := 0; n int := 0;
begin
  for r in select value from jsonb_array_elements(p_rows) loop
    v_tx_id := next_tx_id();
    if v_group is null then v_group := v_tx_id; end if;   -- งวดแรก = po_group_id
    n := n + 1;
    insert into transactions(
      tx_id, transaction_date, type, account_name, category, contact_name, description,
      base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
      status, entity_id, ap_ar_status, po_group_id, installment_no, installment_total, due_date, source
    ) values (
      v_tx_id, _d(p,'transaction_date'), p->>'type', '', p->>'category', p->>'contact_name',
      r->>'description',
      coalesce((r->>'base')::numeric,0), 0, coalesce((r->>'base')::numeric,0),
      coalesce((r->>'vat_amount')::numeric,0), coalesce((r->>'wht_rate')::numeric,0),
      coalesce((r->>'wht_amount')::numeric,0), coalesce((r->>'net_amount')::numeric,0),
      'ปกติ', p->>'entity_id', ap_status, v_group,
      (r->>'installment_no')::int, (r->>'installment_total')::int, _d(r,'due_date'), 'ui'
    );
  end loop;

  -- items แนบงวดแรก (poGroupId) — ใช้ค้นประวัติราคาได้
  for it in select value from jsonb_array_elements(p_items) loop
    idx := idx + 1;
    insert into transaction_items(
      item_id, tx_id, item_name, quantity, in_vat, ex_vat, total_price,
      discount_pct, discount_baht, item_category, item_job
    ) values (
      v_group || '-' || lpad(idx::text,2,'0'), v_group, it->>'item_name',
      coalesce((it->>'quantity')::numeric,1), coalesce((it->>'in_vat')::numeric,0),
      coalesce((it->>'ex_vat')::numeric,0), coalesce((it->>'total_price')::numeric,0),
      coalesce((it->>'discount_pct')::numeric,0), coalesce((it->>'discount_baht')::numeric,0),
      nullif(it->>'item_category',''), nullif(it->>'item_job','')
    );
  end loop;

  return jsonb_build_object('ok', true, 'po_group_id', v_group, 'count', n);
end $$;

-- ── A7 transfer: 2 แถว (ออก/เข้า) ผูก transfer_id ────────────────────────────
create or replace function fn_save_transfer(
  p_from text, p_to text, p_amount numeric, p_date date,
  p_note text default '', p_entity text default null
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_trf text;
  v_from_id text; v_to_id text;
  v_date date := coalesce(p_date, current_date);
  v_note text := coalesce(trim(p_note),'');
begin
  if coalesce(p_from,'')='' or coalesce(p_to,'')='' then
    return jsonb_build_object('ok', false, 'error', 'กรุณาระบุบัญชีต้นทางและปลายทาง'); end if;
  if p_from = p_to then
    return jsonb_build_object('ok', false, 'error', 'บัญชีต้นทางและปลายทางต้องไม่ใช่บัญชีเดียวกัน'); end if;
  if coalesce(p_amount,0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'จำนวนเงินต้องมากกว่า 0'); end if;

  v_trf := 'TRF-' || to_char(current_date,'YYYYMMDD') || '-' ||
           lpad(next_serial('TRF-' || to_char(current_date,'YYYYMMDD'))::text, 4, '0');
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

-- ── A5 settle: เคลียร์บิลค้าง → เข้ารายงาน/ยอดเงินตามวัน transaction_date เดิม ──────
create or replace function fn_settle_apar(
  p_tx_id text, p_account_name text default null, p_payment_date date default null,
  p_tax_invoice_no text default null, p_tax_invoice_date date default null
) returns jsonb
language plpgsql set search_path = public as $$
declare n int;
begin
  update transactions set
    account_name    = coalesce(nullif(p_account_name,''), account_name),
    tax_invoice_no  = coalesce(nullif(p_tax_invoice_no,''), tax_invoice_no),
    tax_invoice_date= coalesce(p_tax_invoice_date, tax_invoice_date),
    ap_ar_status    = null,
    payment_date    = coalesce(p_payment_date, current_date)
  where tx_id = p_tx_id and ap_ar_status is not null;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'ไม่พบบิลค้าง ' || p_tx_id); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ── A14 void: soft-delete ทั้งกลุ่มงวด / ทั้งคู่โอน / เดี่ยว ──────────────────────
create or replace function fn_void_transaction(p_tx_id text) returns jsonb
language plpgsql set search_path = public as $$
declare v_group text; v_transfer text; n int;
begin
  select po_group_id, transfer_id into v_group, v_transfer from transactions where tx_id = p_tx_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบรายการ ' || p_tx_id); end if;

  if v_group is not null then
    update transactions set status = 'ยกเลิก' where po_group_id = v_group and status <> 'ยกเลิก';
  elsif v_transfer is not null then
    update transactions set status = 'ยกเลิก' where transfer_id = v_transfer and status <> 'ยกเลิก';
  else
    update transactions set status = 'ยกเลิก' where tx_id = p_tx_id and status <> 'ยกเลิก';
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'count', n);
end $$;

-- ── A9 issue 50ทวิ: insert wht_certificates + เขียน payment_date ลง transactions ────
-- p_doc_no คำนวณจาก lib nextWhtDocNo (ฝั่ง client) → doc_no unique PK กัน race
create or replace function fn_issue_wht(
  p_doc_no text, p_tx_ids text[], p_issue_date date, p_contact_name text, p_address text,
  p_wht_amount numeric, p_pnd_type text, p_income_type text, p_base_amount numeric,
  p_payment_date date, p_entity_id text
) returns jsonb
language plpgsql set search_path = public as $$
begin
  insert into wht_certificates(doc_no, issue_date, contact_name, address, wht_amount,
    pnd_type, income_type, base_amount, tx_ids, entity_id)
  values (p_doc_no, coalesce(p_issue_date, current_date), p_contact_name, p_address, p_wht_amount,
    p_pnd_type, p_income_type, p_base_amount, coalesce(p_tx_ids,'{}'), coalesce(nullif(p_entity_id,''),'EID01'));

  -- เขียนวันที่จ่าย (col W เดิม) ให้ทุก tx ที่ออกใบนี้
  update transactions set payment_date = coalesce(p_payment_date, current_date)
    where tx_id = any(coalesce(p_tx_ids,'{}'));

  return jsonb_build_object('ok', true, 'doc_no', p_doc_no);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'เลขเอกสาร ' || p_doc_no || ' ถูกใช้แล้ว ลองใหม่');
end $$;
