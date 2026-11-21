-- ============================================================================
-- 0112 ยอดที่ใช้คิดหัก ณ ที่จ่าย ต่อบิล — transactions.wht_base (D179)
--
-- ที่มา: บิลค่าทำของ + ค่าขนส่ง ผู้ขายให้หัก ณ ที่จ่ายเฉพาะค่าทำของ
--   ผู้ใช้แก้ยอดภาษีหักเองได้ แต่ระบบไม่รู้ว่า "หักจากยอดไหน" ⇒ ใบ 50ทวิ / ภงด.3/53
--   พิมพ์ "จำนวนเงินที่จ่าย" เป็นยอดก่อน VAT ทั้งบิล (รวมค่าขนส่ง) = ยอดผิดบนเอกสารราชการ
--
-- ไฟล์นี้มี 2 เรื่อง:
--   1. คอลัมน์ transactions.wht_base (null = ยอดหลังหักส่วนลดทั้งบิล = พฤติกรรมเดิม)
--      ⇒ บิลเก่าทั้งหมดได้ผลเท่าเดิมเป๊ะ ไม่ต้อง backfill
--   2. fn_save_transaction / fn_edit_transaction / fn_clear_advances รู้จักคอลัมน์นี้
--      🪤 fn_edit_transaction: payload ที่ "ไม่มี key wht_base" (connector edit_bill / client เก่า)
--         ต้องคงค่าเดิม ไม่ใช่ล้างเป็น null — ใช้ `p ? 'wht_base'`
--      ★ ไม่หัก ณ ที่จ่ายแล้ว (wht_amount = 0) ⇒ ล้าง wht_base ทิ้งเสมอ กันค่าค้าง
--
-- ★ ไม่มีตารางใหม่ (D118 ไม่ต้อง grant) · ไม่มี security definer ใหม่ (D99)
--   create or replace ลายเซ็นเดิม = grant เดิมคงอยู่ · ทั้งสามตัวยังเป็น invoker
-- ★ ไม่แตะสูตรเงินใน SQL — ยอดภาษีคิดฝั่ง client (lib/accounting/calc entryCalc) เหมือนเดิม
-- 🚨 ต้องลง DB ก่อน deploy โค้ด: TX_COLS (lib/accounting/reportLoaders) select คอลัมน์นี้
--    deploy ก่อน = หน้าบัญชีอ่านบิลไม่ได้ทั้งหน้า
-- ★ สร้างด้วย scripts/gen/gen-0112.mjs — ห้ามพิมพ์มือ (D79)
-- ============================================================================

-- ── 1. คอลัมน์ ───────────────────────────────────────────────────────────────
alter table transactions add column if not exists wht_base numeric(14,2);

do $$ begin
  alter table transactions add constraint transactions_wht_base_nonneg check (wht_base is null or wht_base >= 0);
exception when duplicate_object then null;
end $$;

comment on column transactions.wht_base is
  'D179 ยอดที่ใช้คิดหัก ณ ที่จ่าย (= จำนวนเงินที่จ่าย บน 50ทวิ / ภงด.3/53) · null = ยอดหลังหักส่วนลดทั้งบิล '
  '— อ่านผ่าน whtBaseOf() ใน lib/accounting/calc เท่านั้น';

-- ── 2. RPC ที่เขียนบิล ────────────────────────────────────────────────────────
-- fn_save_transaction — ยกจาก 20261022000086_advance_payment.sql คำต่อคำ + wht_base
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
    base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, wht_base, net_amount,
    tax_invoice_no, tax_invoice_date, receipt_image_url, status, entity_id,
    ap_ar_status, due_date, source,
    advance_for_entity
  ) values (
    v_tx_id, _d(p,'transaction_date'), p->>'type', nullif(p->>'account_name',''), p->>'category',
    p->>'contact_name', nullif(p->>'contact_id',''), p->>'description',
    coalesce((p->>'base_amount')::numeric,0), coalesce((p->>'discount')::numeric,0),
    coalesce((p->>'amount_after_discount')::numeric,0), coalesce((p->>'vat_amount')::numeric,0),
    coalesce((p->>'wht_rate')::numeric,0), coalesce((p->>'wht_amount')::numeric,0),
    -- D179: ยอดที่ใช้คิดหัก ณ ที่จ่าย · ไม่หัก = null เสมอ
    case when coalesce((p->>'wht_amount')::numeric,0) > 0 then nullif(p->>'wht_base','')::numeric end,
    coalesce((p->>'net_amount')::numeric,0),
    nullif(p->>'tax_invoice_no',''), _d(p,'tax_invoice_date'), nullif(p->>'receipt_image_url',''),
    coalesce(nullif(p->>'status',''),'ปกติ'), p->>'entity_id',
    nullif(p->>'ap_ar_status',''), _d(p,'due_date'), coalesce(nullif(p->>'source',''),'ui'),
    -- D119: สำรองจ่ายให้กิจการไหน (advance_status ตั้งโดย trigger advance_guard)
    case when p->>'type' = 'สำรองจ่าย' then nullif(p->>'advance_for_entity','') end
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

  -- T6: forward ต้นทุนสุรา → รับวัตถุดิบเข้าสต็อกผลิต (idempotency = tx_id)
  -- คง "พฤติกรรม warning เดิม": forward พลาด → บัญชียัง commit + คืน warning (ไม่ roll back)
  -- 🚨 ทุกบรรทัดของ forward ต้องอยู่ **ใน** begin/exception นี้ รวมทั้งการประกอบ fwd_items
  --    (บั๊กเดิม: select ประกอบ items อยู่ข้างนอก → error หลุดออกไปล้มทั้งบิล)
  if coalesce((p->>'forward_material')::boolean,false)
     and jsonb_array_length(coalesce(p_items,'[]'::jsonb)) > 0 then
    begin
      -- 🪤 alias ต้องไม่ชื่อซ้ำกับตัวแปร plpgsql (`it`) ไม่งั้น 42702 ambiguous
      -- 🪤 ข้ามแถวที่ไม่ได้กรอกชื่อ (buildItemInputs ปล่อยแถวที่มีแต่ราคาผ่านมาได้)
      --    ไม่งั้นชื่อว่าง 1 แถวล้ม forward ทั้งใบ
      select coalesce(jsonb_agg(jsonb_build_object(
               'material_name', row_it.value ->> 'item_name',
               'amount', coalesce((row_it.value ->> 'quantity')::numeric, 0))), '[]'::jsonb)
        into fwd_items
        from jsonb_array_elements(p_items) as row_it
        where nullif(trim(coalesce(row_it.value ->> 'item_name', '')), '') is not null;

      fwd := fn_receive_material(
        v_tx_id, _d(p,'transaction_date'),
        case when coalesce(p->>'tax_invoice_no','') <> '' and p->>'tax_invoice_no' <> '-'
             then p->>'tax_invoice_no' else v_tx_id end,
        'รับจาก ' || coalesce(nullif(p->>'contact_name',''),'ไม่ระบุชื่อ') ||
          case when coalesce(p->>'description','') <> '' then ' (' || (p->>'description') || ')' else '' end,
        fwd_items,
        nullif(p->>'entity_id',''));
    exception when others then
      warning := 'บันทึกบัญชีสำเร็จ แต่รับวัตถุดิบเข้าสต็อกผลิตไม่ได้: ' || sqlerrm ||
                 ' — ตรวจชื่อวัตถุดิบ/เพิ่มใน master แล้วบันทึกรับเองในแอปผลิต';
    end;
  end if;

  return jsonb_build_object('ok', true, 'tx_id', v_tx_id, 'warning', warning);
end $$;

-- fn_edit_transaction — ยกจาก 20261028000097_claude_connector.sql คำต่อคำ + wht_base (ไม่มี key = คงค่าเดิม)
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
    if coalesce(v_source, 'ui') not in ('ui', 'migration', 'claude') then
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
    -- D179: ไม่มี key = คงค่าเดิม (connector edit_bill / client เก่า) · ไม่หักแล้ว = ล้าง
    wht_base             = case when coalesce((p->>'wht_amount')::numeric,0) <= 0 then null
                                when p ? 'wht_base' then nullif(p->>'wht_base','')::numeric
                                else wht_base end,
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

-- fn_clear_advances — ยกจาก 20261022000086_advance_payment.sql คำต่อคำ + พา wht_base ไปบิลของกิจการปลายทาง
create or replace function fn_clear_advances(
  p_tx_ids text[], p_pay_account text, p_refund_account text default null, p_date date default null
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_date date := coalesce(p_date, fn_today_th());
  v_ids text[] := array(select distinct unnest(coalesce(p_tx_ids, '{}'::text[])));
  v_n int;
  v_payer text; v_target text; v_refund text;
  v_bad text;
  v_clear text;
  v_new text;
  v_refund_tx text;
  v_total numeric := 0;
  v_bills text[] := '{}';
  v_target_name text;
  r record;
begin
  if not has_cap('acct.write') then
    return jsonb_build_object('ok', false, 'error', 'สิทธิ์ไม่พอ — ต้องบันทึกบัญชีได้จึงจะเคลียสำรองจ่ายได้');
  end if;
  if v_tenant is null then return jsonb_build_object('ok', false, 'error', 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'); end if;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'เลือกบิลสำรองจ่ายอย่างน้อย 1 ใบ');
  end if;

  -- ล็อกแถวกันกดเคลียซ้ำพร้อมกันสองหน้าต่าง
  perform 1 from transactions where tenant_id = v_tenant and tx_id = any(v_ids) for update;

  select count(*) into v_n from transactions where tenant_id = v_tenant and tx_id = any(v_ids);
  if v_n <> array_length(v_ids, 1) then
    return jsonb_build_object('ok', false, 'error', 'ไม่พบบิลบางใบ (อาจถูกลบหรือไม่มีสิทธิ์เห็น) — รีเฟรชแล้วลองใหม่');
  end if;

  select string_agg(tx_id, ', ') into v_bad from transactions
   where tenant_id = v_tenant and tx_id = any(v_ids)
     and not (type = 'สำรองจ่าย' and status = 'ปกติ' and advance_status = 'รอเบิกคืน');
  if v_bad is not null then
    return jsonb_build_object('ok', false, 'error', 'บิลเหล่านี้ไม่ได้อยู่ในสถานะรอเบิกคืน: ' || v_bad || ' — รีเฟรชแล้วลองใหม่');
  end if;

  select min(entity_id), min(advance_for_entity) into v_payer, v_target
    from transactions where tenant_id = v_tenant and tx_id = any(v_ids);
  if exists (select 1 from transactions where tenant_id = v_tenant and tx_id = any(v_ids)
              and (entity_id <> v_payer or advance_for_entity <> v_target)) then
    return jsonb_build_object('ok', false, 'error',
      'เคลียพร้อมกันได้เฉพาะบิลที่จ่ายโดยกิจการเดียวกันและซื้อให้กิจการเดียวกัน');
  end if;

  if exists (select 1 from transactions where tenant_id = v_tenant and tx_id = any(v_ids)
              and transaction_date > v_date) then
    return jsonb_build_object('ok', false, 'error', 'วันที่เคลียต้องไม่ก่อนวันที่สำรองจ่าย');
  end if;

  -- บัญชีที่บริษัทจ่ายคืน ต้องเป็นบัญชีของกิจการปลายทาง (หรือบัญชีที่ใช้ร่วมทุกกิจการ)
  if coalesce(trim(p_pay_account), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'เลือกบัญชีที่ใช้จ่ายคืน');
  end if;
  if not exists (select 1 from bank_accounts where tenant_id = v_tenant and account_name = p_pay_account
                  and (coalesce(array_length(entity_ids, 1), 0) = 0 or v_target = any(entity_ids))) then
    return jsonb_build_object('ok', false, 'error',
      'บัญชี ' || p_pay_account || ' ไม่ใช่บัญชีของกิจการ ' || v_target);
  end if;

  -- บัญชีรับเงินคืน: ไม่ระบุ = บัญชีที่จ่ายออกไป (ถ้าทุกใบจ่ายจากบัญชีเดียวกัน)
  v_refund := nullif(trim(coalesce(p_refund_account, '')), '');
  if v_refund is null then
    select min(account_name) into v_refund from transactions where tenant_id = v_tenant and tx_id = any(v_ids)
      having count(distinct account_name) = 1;
    if v_refund is null then
      return jsonb_build_object('ok', false, 'error', 'บิลที่เลือกจ่ายจากหลายบัญชี — เลือกบัญชีที่รับเงินคืน');
    end if;
  end if;
  if not exists (select 1 from bank_accounts where tenant_id = v_tenant and account_name = v_refund
                  and (coalesce(array_length(entity_ids, 1), 0) = 0 or v_payer = any(entity_ids))) then
    return jsonb_build_object('ok', false, 'error',
      'บัญชี ' || v_refund || ' ไม่ใช่บัญชีของกิจการ ' || v_payer);
  end if;

  perform set_config('app.advance_rpc', '1', true);

  v_clear := 'ADV-' || to_char(fn_today_th(), 'YYYYMMDD') || '-' ||
             lpad(next_serial('ADV-' || to_char(fn_today_th(), 'YYYYMMDD'))::text, 4, '0');

  for r in select * from transactions where tenant_id = v_tenant and tx_id = any(v_ids)
            order by transaction_date, tx_id loop
    v_new := next_tx_id();
    insert into transactions(
      tenant_id, tx_id, transaction_date, type, account_name, category, contact_name, contact_id, description,
      base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, wht_base, net_amount,
      tax_invoice_no, tax_invoice_date, receipt_image_url, status, entity_id, payment_date, source,
      advance_clear_id, advance_src_tx
    ) values (
      v_tenant, v_new, v_date, 'รายจ่าย', p_pay_account, r.category, r.contact_name, r.contact_id, r.description,
      r.base_amount, r.discount, r.amount_after_discount, r.vat_amount, r.wht_rate, r.wht_amount, r.wht_base, r.net_amount,
      r.tax_invoice_no, r.tax_invoice_date, r.receipt_image_url, 'ปกติ', v_target, v_date, 'advance',
      v_clear, r.tx_id
    );
    insert into transaction_items(
      tenant_id, item_id, tx_id, item_name, quantity, in_vat, ex_vat, total_price,
      discount_pct, discount_baht, item_category, item_job
    )
    select v_tenant, v_new || '-' || lpad((row_number() over (order by item_id))::text, 2, '0'), v_new,
           item_name, quantity, in_vat, ex_vat, total_price, discount_pct, discount_baht, item_category, item_job
      from transaction_items where tenant_id = v_tenant and tx_id = r.tx_id;

    update transactions set advance_status = 'เคลียแล้ว', advance_clear_id = v_clear
     where tenant_id = v_tenant and tx_id = r.tx_id;

    v_total := v_total + coalesce(r.net_amount, 0);
    v_bills := v_bills || v_new;
  end loop;

  select name into v_target_name from entities where tenant_id = v_tenant and entity_id = v_target;
  v_refund_tx := next_tx_id();
  insert into transactions(
    tenant_id, tx_id, transaction_date, type, account_name, category, contact_name, description,
    net_amount, status, entity_id, payment_date, source, advance_clear_id
  ) values (
    v_tenant, v_refund_tx, v_date, 'รับคืนสำรองจ่าย', v_refund, 'รับคืนสำรองจ่าย',
    coalesce(v_target_name, v_target),
    'รับคืนสำรองจ่าย ' || array_length(v_ids, 1) || ' ใบ จาก ' || coalesce(v_target_name, v_target) || ' (' || v_clear || ')',
    v_total, 'ปกติ', v_payer, v_date, 'advance', v_clear
  );

  return jsonb_build_object('ok', true, 'clear_id', v_clear, 'bills', to_jsonb(v_bills),
                            'refund_tx', v_refund_tx, 'total', v_total, 'count', array_length(v_ids, 1));
end $$;

notify pgrst, 'reload schema';
