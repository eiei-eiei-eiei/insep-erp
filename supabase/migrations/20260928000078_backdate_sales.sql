-- ============================================================================
-- 0078 ลงเอกสารขายย้อนหลัง (D100 เฟส 3)
--
-- 🎯 เคสจริง: ระบบล่มในวันที่ขาย → ออกใบกระดาษไปก่อน → มาลงระบบทีหลัง
--    ต้องตรงกันทั้ง 3 อย่าง: เลขเอกสาร · บัญชี/ภพ.30 · ฟอร์ม ภส.
--    · เลขตามวันที่เอกสาร — ฝั่ง TS ส่ง p_date ให้ fn_next_doc_no (มีตั้งแต่ 0076 · ไม่ต้องแก้ SQL)
--    · บัญชี — ของเดิมลง transaction_date = tax_invoice_date = วันที่ที่เลือกอยู่แล้ว
--    · 🔴 **ฟอร์ม ภส.** — `fn_confirm_fulfillment` ลง `log_product.doc_date = current_date` ตายตัว
--      (และเป็น UTC = จัดส่งช่วงเที่ยงคืน–7 โมงได้วันที่ของเมื่อวาน) → รับ p_date
--
-- ── เลขที่กรอกเอง (ใบกระดาษที่ออกไปแล้ว) ────────────────────────────────────────
--   `fn_doc_manual_check` ตรวจว่าเลขนั้นยังไม่มีเอกสารใช้ · สิทธิ์ `sales.config` (หัวหน้า) —
--   ใส่เลขใบกำกับภาษีเองเป็นเรื่องระดับหัวหน้า (แนวเดียวกับยกเลิกออเดอร์ = sales.config · D85)
--   ★ ไม่ต้องแตะตัวนับ — ตัวออกเลขคิดจากเลขมากสุดที่มีอยู่จริงทุกครั้ง (0077) เลขอัตโนมัติถัดไปจึง
--     ต่อจากเลขที่กรอกเองให้เอง
-- ============================================================================

-- ── 1) ตรวจเลขที่กรอกเอง ─────────────────────────────────────────────────────────
create or replace function fn_doc_manual_check(p_type text, p_no text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if left(coalesce(p_type, ''), 6) <> 'sales_' then
    raise exception 'กรอกเลขเองได้เฉพาะเอกสารขาย';
  end if;
  perform fn_doc_issue_guard(p_type, null);
  if not has_cap('sales.config') then
    raise exception 'กรอกเลขเอกสารเองได้เฉพาะหัวหน้าฝ่ายขาย';
  end if;
  return fn_doc_no_taken(v_tenant, p_type, fn_doc_entity_for(v_tenant, p_type, null), trim(p_no));
end $$;

-- ── 2) fn_confirm_fulfillment — ยกจาก 20260901000057_excise_hide_cancelled.sql · เพิ่ม p_date ────────────────────────
-- 🪤 เพิ่มพารามิเตอร์ = ลายเซ็นใหม่ → ต้อง drop ตัวเดิมก่อน ไม่งั้นได้ overload 2 ตัว (D69)
drop function if exists fn_confirm_fulfillment(text, text);
create or replace function fn_confirm_fulfillment(p_qu_no text, p_user text, p_date date default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order sales_orders%rowtype;
  v_next text; v_is_export boolean := false; v_trans_type text;
  it record;
  v_real numeric; v_before numeric; v_after numeric;
  v_liquor jsonb := '[]'::jsonb;
  v_summary jsonb := '[]'::jsonb;
  v_dup boolean := false; v_warning text := null;
  li jsonb;
  v_tenant uuid := my_tenant();
  -- D100 เฟส 3 — วันที่ของออกจริง (ลงฟอร์ม ภส.) · ไม่ส่ง = วันนี้ตามเวลาไทย (เดิม current_date = UTC)
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_ship date := coalesce(p_date, (now() at time zone 'Asia/Bangkok')::date);
begin
  if not has_cap('sales.write') then raise exception 'ไม่มีสิทธิ์จัดส่ง'; end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  -- 🚨 ฟอร์ม ภส. บันทึกของที่ออกไปแล้วเท่านั้น (ฝาแฝด: shipDateError ใน lib/sales/backdate.ts)
  if v_ship > v_today then
    return jsonb_build_object('ok', false, 'error',
      'วันที่ส่งของเลยวันนี้ไม่ได้ — ฟอร์ม ภส. บันทึกเฉพาะของที่ออกไปแล้ว');
  end if;

  select * into v_order from sales_orders
    where qu_no = p_qu_no and tenant_id = v_tenant and status = 'รอคลังจัดส่ง' for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ออเดอร์นี้ถูกจัดส่งไปแล้ว หรือไม่พบข้อมูลในระบบ');
  end if;
  v_next := coalesce(v_order.next_status, 'ส่งของแล้ว');

  select coalesce(is_export,false) into v_is_export from contacts
    where contact_id = v_order.customer_id and tenant_id = v_tenant;
  v_trans_type := case when v_is_export then 'จำหน่ายต่างประเทศ' else 'จ่าย' end;

  for it in
    select soi.item_name, soi.qty,
           sm.category, sm.product_id, coalesce(sm.multiplier,1) as multiplier
    from sales_order_items soi
    left join sale_menu sm on sm.tenant_id = soi.tenant_id
                          and sm.entity_id = v_order.entity_id
                          and trim(sm.menu_name) = trim(soi.item_name)
    where soi.qu_no = p_qu_no and soi.tenant_id = v_tenant
  loop
    if it.product_id is null or trim(it.product_id) = '' then continue; end if;
    v_real := it.qty * it.multiplier;

    select qty into v_before from warehouse_stock
      where item_code = trim(it.product_id)
        and tenant_id = v_tenant and entity_id = v_order.entity_id;
    if found then
      v_after := coalesce(v_before,0) - v_real;
      update warehouse_stock set qty = v_after
        where item_code = trim(it.product_id)
          and tenant_id = v_tenant and entity_id = v_order.entity_id;
      insert into stock_moves(tenant_id, entity_id, item_code, item_name, qty_before, action, qty,
                              ref_no, qty_after, user_name, remarks)
      values (v_tenant, v_order.entity_id, trim(it.product_id),
              (select item_name from warehouse_stock
                 where item_code = trim(it.product_id)
                   and tenant_id = v_tenant and entity_id = v_order.entity_id),
              coalesce(v_before,0), 'OUT', v_real, coalesce(v_order.order_no, p_qu_no),
              v_after, p_user, 'จัดส่งออเดอร์ B2B');
      v_summary := v_summary || jsonb_build_object(
        'name', (select coalesce(item_name, it.item_name) from warehouse_stock
                   where item_code = trim(it.product_id)
                     and tenant_id = v_tenant and entity_id = v_order.entity_id),
        'remaining', v_after);
    end if;

    if it.category = 'สุรา' and v_real > 0 then
      v_liquor := v_liquor || jsonb_build_object('product_id', trim(it.product_id), 'amount', v_real);
    end if;
  end loop;

  if jsonb_array_length(v_liquor) > 0 then
    begin
      insert into integration_log(tenant_id, action, idempotency_key, status, message, payload)
      values (v_tenant, 'SELL_PRODUCT', coalesce(v_order.order_no, p_qu_no), 'ok', 'ตัดสต็อกขาย', v_liquor);
      for li in select value from jsonb_array_elements(v_liquor) loop
        -- D90 — เก็บเลขออเดอร์ลงคอลัมน์จริง แทนการให้รายงานไปแกะจากข้อความหมายเหตุ
      insert into log_product(tenant_id, entity_id, doc_date, trans_type, product_id, amount, note, ref_no)
        values (v_tenant, v_order.entity_id, v_ship, v_trans_type,
                li->>'product_id', (li->>'amount')::numeric,
                'ลูกค้า: ' || coalesce(v_order.customer_name,'') || ' (' || coalesce(v_order.order_no, p_qu_no) || ')',
                coalesce(v_order.order_no, p_qu_no));
      end loop;
    exception when unique_violation then
      v_dup := true;   -- เคยตัดสต็อกผลิตของ order นี้แล้ว → ข้าม (retry ปลอดภัย)
    end;
  end if;

  update sales_orders set status = v_next where qu_no = p_qu_no and tenant_id = v_tenant;

  return jsonb_build_object('ok', true, 'newStatus', v_next, 'duplicate', v_dup,
    'warning', v_warning, 'summary', v_summary,
    'customerName', v_order.customer_name, 'orderNo', coalesce(v_order.order_no, p_qu_no));
end $$;

notify pgrst, 'reload schema';
