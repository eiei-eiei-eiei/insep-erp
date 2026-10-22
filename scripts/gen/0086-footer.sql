
-- ── 5. fn_clear_advances — เคลีย (บริษัทโอนคืน) ─────────────────────────────────
-- เลือกได้หลายบิล แต่ต้อง "คนจ่ายเดียวกัน + ซื้อให้กิจการเดียวกัน" (เงินคืนเป็นรายการเดียว)
-- สร้าง: บิลรายจ่ายของกิจการปลายทาง 1 ใบต่อบิลสำรองจ่าย (ภพ.30 ต้องแยกผู้ขายรายใบ)
--        + รับคืนเข้าบัญชีคนจ่าย 1 รายการ = ผลรวม
-- ★ บิลของบริษัทลงวันที่ "วันเคลีย" — วันที่บริษัทจ่ายเงินจริง (cash basis) ⇒ ภาษีซื้อเข้าเดือนนั้น
--   วันที่ใบกำกับคงตามใบจริง · เตือนที่หน้าจอเมื่อเกิน 6 เดือน (lib/accounting/advance.ts)
-- ★ INVOKER — RLS คุมว่าผู้เรียกต้องเห็นทั้งกิจการคนจ่ายและกิจการปลายทาง
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
      base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
      tax_invoice_no, tax_invoice_date, receipt_image_url, status, entity_id, payment_date, source,
      advance_clear_id, advance_src_tx
    ) values (
      v_tenant, v_new, v_date, 'รายจ่าย', p_pay_account, r.category, r.contact_name, r.contact_id, r.description,
      r.base_amount, r.discount, r.amount_after_discount, r.vat_amount, r.wht_rate, r.wht_amount, r.net_amount,
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

-- ── 6. fn_unclear_advances — ถอนการเคลียทั้งชุด ──────────────────────────────
-- ยกเลิก (soft) บิลของบริษัท + รายการรับคืน · บิลสำรองจ่ายกลับเป็น "รอเบิกคืน"
-- 🚨 acct.config (ระดับหัวหน้า) — ย้อนค่าใช้จ่าย/ภาษีซื้อของเดือนที่อาจยื่น ภพ.30 ไปแล้ว (แพตเทิร์น D88)
-- 🚨 บล็อกถ้าออกใบ 50ทวิ จากบิลของบริษัทไปแล้ว — ใบนั้นอยู่ในมือคู่ค้า ถอนแล้วจะอ้างบิลที่ถูกยกเลิก
create or replace function fn_unclear_advances(p_clear_id text) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_bills text[];
  v_cert text;
  n_void int; n_back int;
begin
  if not has_cap('acct.config') then
    return jsonb_build_object('ok', false, 'error', 'สิทธิ์ไม่พอ — ถอนการเคลียได้เฉพาะหัวหน้าบัญชีขึ้นไป');
  end if;
  if coalesce(trim(p_clear_id), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'ไม่ได้ระบุการเคลียที่จะถอน');
  end if;

  perform 1 from transactions where tenant_id = v_tenant and advance_clear_id = p_clear_id for update;

  select array_agg(tx_id) into v_bills from transactions
   where tenant_id = v_tenant and advance_clear_id = p_clear_id and type = 'รายจ่าย' and status = 'ปกติ';
  select string_agg(doc_no, ', ') into v_cert from wht_certificates
   where tenant_id = v_tenant and tx_ids && coalesce(v_bills, '{}'::text[]);
  if v_cert is not null then
    return jsonb_build_object('ok', false, 'error',
      'ออกใบ 50 ทวิ จากบิลชุดนี้ไปแล้ว (' || v_cert || ') — ถอนการเคลียไม่ได้');
  end if;

  perform set_config('app.advance_rpc', '1', true);

  update transactions set status = 'ยกเลิก'
   where tenant_id = v_tenant and advance_clear_id = p_clear_id
     and type <> 'สำรองจ่าย' and status = 'ปกติ';
  get diagnostics n_void = row_count;

  update transactions set advance_status = 'รอเบิกคืน', advance_clear_id = null
   where tenant_id = v_tenant and advance_clear_id = p_clear_id and type = 'สำรองจ่าย';
  get diagnostics n_back = row_count;

  -- 🚨 row_count = 0 ต้องตอบ error ไทย ไม่ใช่ ok (บทเรียน D93)
  if n_back = 0 then
    return jsonb_build_object('ok', false, 'error', 'ไม่พบการเคลีย ' || p_clear_id || ' (อาจถูกถอนไปแล้ว) — รีเฟรชแล้วลองใหม่');
  end if;
  return jsonb_build_object('ok', true, 'voided', n_void, 'reopened', n_back);
end $$;

-- ── 7. fn_advance_to_personal — บริษัทไม่คืนเงิน ตัดเป็นค่าใช้จ่ายของคนจ่ายเอง ────
-- ★ ใบกำกับออกในนามกิจการที่ซื้อให้ ⇒ คนจ่ายขอคืนภาษีซื้อไม่ได้
--   VAT จึงกลายเป็นต้นทุน: ยอดหลังหักส่วนลด += VAT · VAT = 0 · ยอดสุทธิ (เงินที่จ่ายจริง) เท่าเดิม
-- ★ รายการสินค้าคงเดิม (ราคาต่อหน่วยไว้ดูย้อนหลัง) — เปิดแก้บิลแล้วจะเห็นเป็นโหมดแก้ยอดเอง
create or replace function fn_advance_to_personal(p_tx_id text) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  n int;
begin
  if not has_cap('acct.write') then
    return jsonb_build_object('ok', false, 'error', 'สิทธิ์ไม่พอ — ต้องบันทึกบัญชีได้');
  end if;
  perform set_config('app.advance_rpc', '1', true);
  update transactions set
    type = 'รายจ่าย',
    base_amount = base_amount + vat_amount,
    amount_after_discount = amount_after_discount + vat_amount,
    vat_amount = 0,
    advance_status = 'ตัดเป็นส่วนตัว'
  where tenant_id = v_tenant and tx_id = p_tx_id
    and type = 'สำรองจ่าย' and status = 'ปกติ' and advance_status = 'รอเบิกคืน';
  get diagnostics n = row_count;
  if n = 0 then
    return jsonb_build_object('ok', false, 'error', 'ไม่พบบิลสำรองจ่ายที่รอเบิกคืน ' || p_tx_id || ' — รีเฟรชแล้วลองใหม่');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- invoker ทั้งสามตัว — ปิด anon ไว้ด้วย (D99: revoke ต้องระบุ anon ตรง ๆ)
revoke execute on function fn_clear_advances(text[], text, text, date) from public, anon;
revoke execute on function fn_unclear_advances(text) from public, anon;
revoke execute on function fn_advance_to_personal(text) from public, anon;
grant execute on function fn_clear_advances(text[], text, text, date) to authenticated, service_role;
grant execute on function fn_unclear_advances(text) to authenticated, service_role;
grant execute on function fn_advance_to_personal(text) to authenticated, service_role;

notify pgrst, 'reload schema';
