-- ============================================================================
-- 0019 accounting — fn_edit_transaction: แก้บิลเดี่ยวย้อนหลัง (ค้นบิล → ปุ่มแก้ไข)
--   เทียบ legacy TxEdit.js updateTransaction: เขียนทับ field หลัก + แทนที่ items
--   คงเดิม (ไม่แตะ): status, ap_ar_status, payment_date, po_group_id, transfer_id,
--                    source, receipt_image_url  — สถานะชำระเปลี่ยนผ่าน settle เท่านั้น
--   audit อัตโนมัติผ่าน trigger audit_transactions (before/after ลง edit_log)
--   ไม่รองรับแก้บิลกลุ่มงวด/โอน (po_group_id/transfer_id) — ให้ยกเลิกแล้วสร้างใหม่
--   ไม่ re-forward ต้นทุนสุรา (เหมือน legacy) — แก้สต็อกวัตถุดิบทำในแอปผลิต
-- SECURITY INVOKER → RLS (tx_w/ti_w main + entity scope) บังคับสิทธิ์
-- money ทุกตัวคำนวณจาก lib (client) แล้วส่งค่ามาเก็บ เหมือน fn_save_transaction
-- ============================================================================

create or replace function fn_edit_transaction(
  p_tx_id text,
  p jsonb,            -- ฟิลด์ transaction (ค่าเงินคำนวณจาก entryCalc ฝั่ง client แล้ว)
  p_items jsonb default '[]'::jsonb
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_group text;
  v_transfer text;
  it jsonb;
  idx int := 0;
  n int;
begin
  select po_group_id, transfer_id into v_group, v_transfer
    from transactions where tx_id = p_tx_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ไม่พบรายการ ' || p_tx_id);
  end if;
  if v_group is not null or v_transfer is not null then
    return jsonb_build_object('ok', false,
      'error', 'บิลนี้เป็นกลุ่มงวด/โอนระหว่างบัญชี — แก้ไม่ได้ ให้ยกเลิกแล้วสร้างใหม่');
  end if;

  update transactions set
    transaction_date     = _d(p,'transaction_date'),
    type                 = p->>'type',
    account_name         = nullif(p->>'account_name',''),
    category             = p->>'category',
    contact_name         = p->>'contact_name',
    contact_id           = nullif(p->>'contact_id',''),
    description          = p->>'description',
    base_amount          = coalesce((p->>'base_amount')::numeric,0),
    discount             = coalesce((p->>'discount')::numeric,0),
    amount_after_discount= coalesce((p->>'amount_after_discount')::numeric,0),
    vat_amount           = coalesce((p->>'vat_amount')::numeric,0),
    wht_rate             = coalesce((p->>'wht_rate')::numeric,0),
    wht_amount           = coalesce((p->>'wht_amount')::numeric,0),
    net_amount           = coalesce((p->>'net_amount')::numeric,0),
    tax_invoice_no       = nullif(p->>'tax_invoice_no',''),
    tax_invoice_date     = _d(p,'tax_invoice_date'),
    entity_id            = coalesce(nullif(p->>'entity_id',''), entity_id)
  where tx_id = p_tx_id;

  -- แทนที่ items ทั้งหมดของบิลนี้ (ลบเก่า → insert ใหม่ ด้วย id เดิม pattern {txId}-NN)
  delete from transaction_items where tx_id = p_tx_id;
  for it in select value from jsonb_array_elements(p_items) loop
    idx := idx + 1;
    insert into transaction_items(
      item_id, tx_id, item_name, quantity, in_vat, ex_vat, total_price,
      discount_pct, discount_baht, item_category, item_job
    ) values (
      p_tx_id || '-' || lpad(idx::text,2,'0'), p_tx_id, it->>'item_name',
      coalesce((it->>'quantity')::numeric,1), coalesce((it->>'in_vat')::numeric,0),
      coalesce((it->>'ex_vat')::numeric,0), coalesce((it->>'total_price')::numeric,0),
      coalesce((it->>'discount_pct')::numeric,0), coalesce((it->>'discount_baht')::numeric,0),
      nullif(it->>'item_category',''), nullif(it->>'item_job','')
    );
  end loop;

  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'tx_id', p_tx_id, 'items', idx);
end $$;
