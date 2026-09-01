-- ============================================================================
-- 0057 ยกเลิกออเดอร์แล้วไม่ต้องไปโผล่บนฟอร์มสรรพสามิต — D90
--
-- ต้นเรื่อง (ผู้ใช้เจอตอนตรวจฟอร์มจริง): ขายแล้วยกเลิก ฟอร์ม ภส.๐๗-๐๒/๑(๒) และ ภส.๐๗-๐๔
-- จะโชว์เป็น "จ่าย 4 แล้วรับคืน 4" ซึ่งเจ้าหน้าที่สรรพสามิตต้องมานั่งกระทบยอดเอง
-- ทั้งที่สุทธิแล้วไม่มีอะไรเกิดขึ้น
--
-- 🚨 กติกาที่ห้ามพลาด: **ห้ามแก้ฟอร์มที่ออกไปแล้ว**
--    ถ้าเดือนนั้นถูกออกรายงานไปแล้ว (ยื่นได้ถึงวันที่ 15 ของเดือนถัดไป) การยกเลิกทีหลัง
--    ต้องไม่ทำให้ฟอร์มฉบับที่ยื่นไปเปลี่ยน → เก็บทั้งคู่ไว้ตามจริง
--    (ขาย ก.ย. ยื่นแล้ว · คืนของ ต.ค. → ก.ย. โชว์จ่าย · ต.ค. โชว์รับ = ความจริงทั้งคู่)
--
-- ★ ตัดสินตอน "กดยกเลิก" แล้วแช่ผลไว้ที่ excise_hidden — **ไม่ใช่ตัดสินตอนเปิดดูฟอร์ม**
--   ถ้าไปตัดสินตอนเปิดดู พอเดือนนั้นถูกออกรายงานทีหลัง แถวจะโผล่กลับมาเอง
--   = ฟอร์มเปลี่ยนย้อนหลังอีกแบบหนึ่ง ซึ่งคือสิ่งที่พยายามหลีกเลี่ยงตั้งแต่แรก
--
-- ★ ซ่อนเฉพาะ "ฟอร์ม" เท่านั้น — แถวยังอยู่ครบใน log_product · stock_product ยังคิดจากทุกแถว
--   (trigger ไม่ถูกแตะ) · หน้าสต็อก/ประวัติในแอปยังเห็นตามจริง
--
-- ★ fn_confirm_fulfillment / fn_cancel_order ด้านล่าง **ยกมาจาก 0051 ทั้งดุ้นด้วยสคริปต์**
--   เปลี่ยนเฉพาะบรรทัดที่ทำเครื่องหมาย D90 ไว้ · signature ไม่เปลี่ยน (กับดัก D69)
-- ============================================================================

alter table log_product add column if not exists ref_no text;
alter table log_product add column if not exists excise_hidden boolean not null default false;

comment on column log_product.ref_no is
  'เลขออเดอร์ขายที่ทำให้เกิดแถวนี้ (ORD…) — ใช้จับคู่ ขาย↔ยกเลิก · null = ไม่ได้มาจากการขาย';
comment on column log_product.excise_hidden is
  'true = ไม่นับในฟอร์ม ภส. (คู่ จ่าย/รับ ของออเดอร์ที่ยกเลิกก่อนออกรายงาน) — ยังนับใน stock_product ตามปกติ';

-- ── backfill ref_no ของแถวเดิม (ครั้งเดียว) ─────────────────────────────────
--    🪤 แกะจากข้อความหมายเหตุได้ครั้งนี้ครั้งเดียวเท่านั้น — ต่อไป RPC เขียนคอลัมน์ตรง ๆ
--    แถวที่ไม่ได้มาจากการขาย (บรรจุ/ปรับยอด) จะไม่ match แล้วปล่อยเป็น null ตามเดิม
update log_product
   set ref_no = substring(note from 'ORD[A-Za-z0-9]+-[0-9]+')
 where ref_no is null
   and note is not null
   and note ~ 'ORD[A-Za-z0-9]+-[0-9]+';

-- 🚨 **ไม่ backfill excise_hidden ย้อนหลัง** — ฟอร์มของเดือนที่ผ่านมาอาจถูกยื่นไปแล้ว
--    การไปซ่อนแถวเก่าตอนนี้ = แก้ฟอร์มที่ยื่นไปแล้ว ซึ่งเป็นสิ่งที่ migration นี้ตั้งใจกัน
--    (ของเก่าจึงยังโชว์คู่ จ่าย/รับ ตามเดิม · กติกาใหม่มีผลกับการยกเลิกนับจากนี้ไป)

create index if not exists log_product_ref on log_product (tenant_id, ref_no) where ref_no is not null;

create or replace function fn_confirm_fulfillment(p_qu_no text, p_user text)
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
begin
  if not has_cap('sales.write') then raise exception 'ไม่มีสิทธิ์จัดส่ง'; end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;

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
        values (v_tenant, v_order.entity_id, current_date, v_trans_type,
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

create or replace function fn_cancel_order(p_qu_no text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  -- D90 — ตัวช่วยตัดสินว่าจะซ่อนคู่ จ่าย/รับ ออกจากฟอร์ม ภส. หรือไม่
  v_sale_month text; v_now_month text := to_char(current_date,'YYYY-MM'); v_reported boolean;
  v_order sales_orders%rowtype;
  v_ref text; mv record; v_before numeric; v_after numeric;
  v_reversed int := 0;
  v_tenant uuid := my_tenant();
begin
  -- 🚨 ยกเลิก = void ใบกำกับภาษีที่ออกไปแล้ว + คืนสต็อก → **ระดับหัวหน้าเท่านั้น**
  --    ใช้ sales.config (มีแต่ sales_manager กับ main) จงใจไม่ใช่ sales.write
  if not has_cap('sales.config') then raise exception 'ไม่มีสิทธิ์ยกเลิกออเดอร์ (เฉพาะหัวหน้าฝ่ายขาย)'; end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;

  select * into v_order from sales_orders
    where qu_no = p_qu_no and tenant_id = v_tenant for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบออเดอร์ ' || p_qu_no); end if;
  v_ref := coalesce(v_order.order_no, p_qu_no);

  -- 1) void รายรับที่ลงบัญชีแล้ว (deposit + balance)
  update transactions set status = 'ยกเลิก'
    where tenant_id = v_tenant
      and idempotency_key in (v_ref, v_ref || '-balance') and status <> 'ยกเลิก';

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
     * D90 — ยกเลิกแล้วต้องไม่ไปกวนฟอร์มสรรพสามิต **แต่ห้ามแก้ฟอร์มที่ออกไปแล้ว**
     *
     * ★ ตัดสิน ณ ตอนกดยกเลิก แล้วแช่ผลไว้ในคอลัมน์ — ห้ามไปตัดสินตอนเปิดดูฟอร์ม
     *   ไม่งั้นพอเดือนนั้นถูกออกรายงานทีหลัง แถวจะโผล่กลับมาเอง = ฟอร์มเปลี่ยนย้อนหลังอีกแบบ
     * 🚨 ซ่อนได้เฉพาะเมื่อ **ทั้งเดือนที่ขายและเดือนที่ยกเลิก** ยังไม่เคยออกรายงาน ภส. เลย
     *   (ยื่นได้ถึงวันที่ 15 ของเดือนถัดไป จึงดูที่ "ออกรายงานหรือยัง" ไม่ใช่ดูปฏิทิน)
     * ★ ซ่อนเป็นคู่ที่หักล้างกันพอดีเสมอ → ยอดคงเหลือบนฟอร์มยังตรงกับสต็อกจริง
     */
    select to_char(min(doc_date),'YYYY-MM') into v_sale_month
      from log_product
      where tenant_id = v_tenant and ref_no = v_ref and trans_type <> 'รับ';

    v_reported := exists (
      select 1 from report_runs
      where tenant_id = v_tenant and entity_id = v_order.entity_id
        and report_key like 'phor\_so\_%'
        and month in (coalesce(v_sale_month, v_now_month), v_now_month)
    );

    if not v_reported then
      update log_product set excise_hidden = true
        where tenant_id = v_tenant and ref_no = v_ref;
    end if;

    update integration_log set status='duplicate', message='reversed by cancel'
      where tenant_id = v_tenant and action='SELL_PRODUCT'
        and idempotency_key = v_ref and status='ok';
  end if;

  update sales_orders set status = 'ยกเลิก', outstanding_balance = 0
    where qu_no = p_qu_no and tenant_id = v_tenant;

  return jsonb_build_object('ok', true, 'reversed_stock', v_reversed);
end $$;

notify pgrst, 'reload schema';
