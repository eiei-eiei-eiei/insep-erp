-- ============================================================================
-- 0094 accounting — ย้ายบิลไปกิจการอื่นจากหน้าแก้ไขบิล (D132)
--
-- ที่มา: ผู้ใช้บันทึกบิลผิดกิจการแล้วแก้ไม่ได้ — fn_edit_transaction (0019) เขียน entity_id ได้
--   มาตั้งแต่แรก แต่หน้าแก้บิลไม่เคยมีช่องให้เลือก (ตระกูล D74/D77)
--   พอเปิดช่องบนจอแล้ว ฟังก์ชันนี้ต้องกันบิลที่ "ย้ายแล้วต้นทางยังอยู่ที่กิจการเดิม" เอง
--   (เป็น invoker · RLS กันแค่สิทธิ์ในกิจการ ไม่รู้ความหมายของบิล)
--
-- ย้ายกิจการได้เฉพาะบิลที่คีย์เอง (source ui/migration) และ:
--   🚨 ไม่ใช่ผลของการเคลียสำรองจ่าย (advance_clear_id / advance_src_tx) — บิลบริษัทต้องอยู่ในกิจการที่ถูกซื้อให้
--   🚨 ยังไม่ได้ออก 50ทวิ (wht_certificates.tx_ids) — ใบที่ออกไปแล้วอยู่ในนามกิจการเดิม
--   🚨 บิลสำรองจ่ายย้ายไปเป็นของกิจการที่ซื้อให้ไม่ได้ (CHECK transactions_advance_shape เด้งเป็นอังกฤษ)
--   · บิลจาก sales/payroll/tax/bar/advance ไปแก้ที่ต้นทาง (ข้อความบนจอบอกที่ lib/accounting/entityMove.ts)
-- 🚨 เงื่อนไขต้องตรงกับ lib/accounting/entityMove.ts (entityMoveSql.test.ts อ่านไฟล์นี้มาเทียบ)
-- ★ ไม่ย้ายกิจการ = เส้นทางเดิมคำต่อคำ (ด่านใหม่อยู่ใน if v_new_entity <> v_old_entity เท่านั้น)
-- ★ ลายเซ็นเดิม → create or replace ได้ ไม่ต้อง drop · ยังเป็น invoker (ไม่มี definer ใหม่ · D99)
-- ★ ไม่มีตารางใหม่ (D118 ไม่ต้อง grant)
-- ★ สร้างด้วย scripts/gen/gen-0094.mjs — ห้ามพิมพ์มือ (D79)
-- ============================================================================

-- ── fn_edit_transaction — ยกจาก 20260729000019_edit_transaction.sql คำต่อคำ + ด่านย้ายกิจการ ──
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
  -- D132: ย้ายกิจการ
  v_tenant uuid;
  v_old_entity text;
  v_new_entity text;
  v_source text;
  v_type text;
  v_adv_for text;
  v_adv_clear text;
  v_adv_src text;
  v_wht text;
begin
  select po_group_id, transfer_id,
         tenant_id, entity_id, source, type, advance_for_entity, advance_clear_id, advance_src_tx
    into v_group, v_transfer,
         v_tenant, v_old_entity, v_source, v_type, v_adv_for, v_adv_clear, v_adv_src
    from transactions where tx_id = p_tx_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ไม่พบรายการ ' || p_tx_id);
  end if;
  if v_group is not null or v_transfer is not null then
    return jsonb_build_object('ok', false,
      'error', 'บิลนี้เป็นกลุ่มงวด/โอนระหว่างบัญชี — แก้ไม่ได้ ให้ยกเลิกแล้วสร้างใหม่');
  end if;

  -- ── D132: ย้ายกิจการ — ด่านเหล่านี้ทำงานเฉพาะตอนเปลี่ยนกิจการจริง ─────────────
  -- 🚨 เงื่อนไขต้องตรงกับ entityMoveBlock()/entityMoveError() ใน lib/accounting/entityMove.ts
  v_new_entity := coalesce(nullif(p->>'entity_id',''), v_old_entity);
  if v_new_entity <> v_old_entity then
    if not exists (select 1 from entities where tenant_id = v_tenant and entity_id = v_new_entity) then
      return jsonb_build_object('ok', false, 'error', 'ไม่พบกิจการ ' || v_new_entity);
    end if;
    if v_adv_clear is not null or v_adv_src is not null then
      return jsonb_build_object('ok', false,
        'error', 'บิลที่เกิดจากการเคลียสำรองจ่าย ย้ายกิจการไม่ได้ — ใช้ปุ่ม ถอนการเคลีย ในแท็บ ลูกหนี้-เจ้าหนี้');
    end if;
    if coalesce(v_source, 'ui') not in ('ui', 'migration') then
      return jsonb_build_object('ok', false,
        'error', 'บิลนี้ระบบสร้างให้อัตโนมัติ (' || v_source || ') — ย้ายกิจการจากหน้าแก้บิลไม่ได้ ให้แก้ที่ต้นทาง');
    end if;
    select string_agg(doc_no, ', ' order by doc_no) into v_wht
      from wht_certificates where tenant_id = v_tenant and p_tx_id = any(tx_ids);
    if v_wht is not null then
      return jsonb_build_object('ok', false,
        'error', 'บิลนี้ออกใบ 50ทวิ ไปแล้ว (' || v_wht || ') ในนามกิจการเดิม — ย้ายกิจการไม่ได้ ให้ยกเลิกบิลแล้วบันทึกใหม่ในกิจการที่ถูก');
    end if;
    if v_type = 'สำรองจ่าย' and v_adv_for = v_new_entity then
      return jsonb_build_object('ok', false,
        'error', 'บิลนี้สำรองจ่ายให้ ' || v_new_entity || ' อยู่แล้ว — ย้ายไปเป็นของกิจการนั้นเองไม่ได้ ให้ยกเลิกแล้วบันทึกใหม่เป็นรายจ่าย');
    end if;
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
