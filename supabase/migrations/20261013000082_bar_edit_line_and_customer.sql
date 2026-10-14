-- ============================================================================
-- 0082 · D112 — บาร์: แก้ส่วนลด/แถม ของรายการที่ส่งเข้าบิลแล้ว · เปลี่ยนลูกค้า/ชื่อของบิลที่ยังเปิด
--
-- ผู้ใช้ถาม: "เมนูที่ส่งเข้าบิลไปแล้วจะกดลด กดแถมได้ไหม" · "บิลที่เปิดไปแล้วจะมาแก้ไขลูกค้าได้ไหม"
-- เดิมรายการในบิลทำได้อย่างเดียวคือยกเลิก (fn_bar_void_line) · ลูกค้าของบิลไม่มีที่เปลี่ยนเลย
--
-- ผู้ใช้เลือก:
--   · แก้ส่วนลด/แถม = **ทุกคนที่ขายได้** (`bar.write`) เท่ากับตอนอยู่ในถาด · ทุกครั้งจดใน edit_log (audit trigger)
--   · เปลี่ยนลูกค้า = **เฉพาะบิลที่ยังเปิดอยู่** — บิลที่ปิดแล้วอาจออกใบเสร็จ/ใบกำกับใส่ชื่อเดิมไปแล้ว
--
-- 🚨 ทำเป็น RPC ไม่ใช่ให้หน้าจอ update ตรง — RLS ของ bar_sale_item เขียนได้ด้วย bar.write อยู่แล้ว
--    แต่ "ของแถม = ยอดขาย 0" เป็น**กติกาธุรกิจที่ต้องจริงใน DB เสมอ** (0066) และ "แก้ได้เฉพาะบิลที่เปิด"
--    เป็นเงื่อนไขที่ policy เขียนไม่ได้ ⇒ ด่านต้องอยู่ที่นี่ (ยิง API ตรงก็ต้องไม่รอด · หลัก D55)
-- ★ SQL **ไม่คิด amount ให้** (สูตรอยู่ที่ lib/bar/totals.ts · lineAmount) — แค่ปฏิเสธค่าที่ขัดกติกา
--   (แถมแต่ยอด ≠ 0 · ยอดติดลบ · ยอดเกินราคาเต็ม · ส่วนลดติดลบ) แล้วคิดยอดบิลใหม่จากแถวจริง
-- ★ ไม่แตะสต็อก — ของถูกตัดไปแล้วตอนส่งเข้าบิล และต้นทุนยังนับเท่าเดิม (แถมก็มีต้นทุน · D96)
-- ★ definer + `bar_guard()` = ด่านในตัว (นับเป็น "มีด่าน" ใน audit ของ D99 แบบเดียวกับ fn_bar_* ตัวอื่น)
-- ============================================================================

create or replace function fn_bar_edit_line(
  p_entity text, p_sale_no text, p_line_no int,
  p_line_discount numeric, p_line_discount_pct numeric, p_is_comp boolean, p_amount numeric
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_status text;
  v_item bar_sale_item%rowtype;
  v_full numeric;
  v_disc numeric := coalesce(p_line_discount, 0);
  v_comp boolean := coalesce(p_is_comp, false);
  v_sub numeric;
  v_cost numeric;
begin
  select status into v_status from bar_sale
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no for update;
  if not found then raise exception 'ไม่พบบิล %', p_sale_no; end if;
  if v_status <> 'เปิดอยู่' then
    raise exception 'บิล % ปิดไปแล้ว — แก้ส่วนลด/แถมได้เฉพาะบิลที่ยังเปิดอยู่', p_sale_no;
  end if;

  select * into v_item from bar_sale_item
   where tenant_id = v_tenant and entity_id = p_entity
     and sale_no = p_sale_no and line_no = p_line_no for update;
  if not found then raise exception 'ไม่พบรายการที่ % ในบิล %', p_line_no, p_sale_no; end if;
  if v_item.voided_at is not null then raise exception 'รายการนี้ถูกยกเลิกไปแล้ว'; end if;

  v_full := round(v_item.qty * v_item.price, 2);
  if v_disc < 0 then raise exception 'ส่วนลดติดลบไม่ได้'; end if;
  if p_line_discount_pct is not null and (p_line_discount_pct < 0 or p_line_discount_pct > 100) then
    raise exception 'ส่วนลดเป็น %% ต้องอยู่ระหว่าง 0–100';
  end if;
  -- 🚨 กติกาเดียวกับ 0066: ของแถมยอดขาย 0 เสมอ · ยอดต้องไม่ติดลบและไม่เกินราคาเต็ม
  if v_comp and coalesce(p_amount, 0) <> 0 then raise exception 'ของแถมต้องมียอดขาย 0'; end if;
  if coalesce(p_amount, 0) < 0 or coalesce(p_amount, 0) > v_full then
    raise exception 'ยอดรายการไม่ถูกต้อง (ต้องอยู่ระหว่าง 0 ถึง %)', v_full;
  end if;
  -- ยอดต้องเท่ากับราคาเต็ม − ส่วนลด (ปัด 2 ตำแหน่ง) — กันหน้าจอเก่า/ยิงตรงส่งยอดที่ไม่สัมพันธ์กับส่วนลด
  if not v_comp and abs(coalesce(p_amount, 0) - greatest(0, round(v_full - v_disc, 2))) > 0.005 then
    raise exception 'ยอดรายการไม่ตรงกับส่วนลด — รีเฟรชหน้าแล้วลองใหม่';
  end if;

  update bar_sale_item set
    line_discount = case when v_comp then 0 else v_disc end,
    line_discount_pct = case when v_comp then null else p_line_discount_pct end,
    is_comp = v_comp,
    amount = coalesce(p_amount, 0)
  where tenant_id = v_tenant and entity_id = p_entity
    and sale_no = p_sale_no and line_no = p_line_no;

  -- 🚨 ยอดบิลเขียนทับใหม่จากแถวจริง (แพตเทิร์นเดียวกับ fn_bar_void_line)
  select coalesce(sum(amount), 0), coalesce(sum(cost), 0) into v_sub, v_cost
    from bar_sale_item
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no
     and voided_at is null;

  update bar_sale s set
    sub_total = v_sub,
    discount = least(s.discount, v_sub),
    grand_total = greatest(0, v_sub - least(s.discount, v_sub)) + s.rounding,
    cost_total = v_cost
  where s.tenant_id = v_tenant and s.entity_id = p_entity and s.sale_no = p_sale_no;

  return jsonb_build_object('ok', true, 'sale_no', p_sale_no, 'sub_total', v_sub);
end $fn$;

create or replace function fn_bar_set_sale_customer(
  p_entity text, p_sale_no text, p_customer_id text, p_tab_name text
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_status text;
  v_cust text := nullif(trim(coalesce(p_customer_id, '')), '');
begin
  select status into v_status from bar_sale
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no for update;
  if not found then raise exception 'ไม่พบบิล %', p_sale_no; end if;
  if v_status <> 'เปิดอยู่' then
    raise exception 'บิล % ปิดไปแล้ว — เปลี่ยนลูกค้าได้เฉพาะบิลที่ยังเปิดอยู่', p_sale_no;
  end if;
  if v_cust is not null and not exists (
    select 1 from bar_customer
     where tenant_id = v_tenant and entity_id = p_entity and customer_id = v_cust
  ) then
    raise exception 'ไม่พบลูกค้ารายนี้ (อาจถูกลบไประหว่างนั้น) — รีเฟรชหน้าแล้วลองใหม่';
  end if;

  update bar_sale set
    customer_id = v_cust,
    tab_name = nullif(trim(coalesce(p_tab_name, '')), '')
  where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no;

  return jsonb_build_object('ok', true, 'sale_no', p_sale_no);
end $fn$;
