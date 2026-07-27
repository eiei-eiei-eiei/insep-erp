-- ============================================================================
-- 0017 RPC รองรับ contact_id (multi-branch, D30) — recreate 2 ฟังก์ชันจาก 0011
--   fn_save_transaction / fn_save_installments: เก็บ contact_id (ระบุสาขาที่แน่นอน)
--   เพิ่มแค่คอลัมน์ contact_id ในการ insert — logic อื่นคงเดิมเป๊ะ
-- ============================================================================

create or replace function fn_save_transaction(
  p jsonb,
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
    tx_id, transaction_date, type, account_name, category, contact_name, contact_id, description,
    base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
    tax_invoice_no, tax_invoice_date, receipt_image_url, status, entity_id,
    ap_ar_status, due_date, source
  ) values (
    v_tx_id, _d(p,'transaction_date'), p->>'type', nullif(p->>'account_name',''), p->>'category',
    p->>'contact_name', nullif(p->>'contact_id',''), p->>'description',
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

create or replace function fn_save_installments(
  p jsonb,
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
    if v_group is null then v_group := v_tx_id; end if;
    n := n + 1;
    insert into transactions(
      tx_id, transaction_date, type, account_name, category, contact_name, contact_id, description,
      base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
      status, entity_id, ap_ar_status, po_group_id, installment_no, installment_total, due_date, source
    ) values (
      v_tx_id, _d(p,'transaction_date'), p->>'type', '', p->>'category', p->>'contact_name',
      nullif(p->>'contact_id',''), r->>'description',
      coalesce((r->>'base')::numeric,0), 0, coalesce((r->>'base')::numeric,0),
      coalesce((r->>'vat_amount')::numeric,0), coalesce((r->>'wht_rate')::numeric,0),
      coalesce((r->>'wht_amount')::numeric,0), coalesce((r->>'net_amount')::numeric,0),
      'ปกติ', p->>'entity_id', ap_status, v_group,
      (r->>'installment_no')::int, (r->>'installment_total')::int, _d(r,'due_date'), 'ui'
    );
  end loop;

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
