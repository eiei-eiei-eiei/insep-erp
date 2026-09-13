-- ─────────────────────────────────────────────────────────────────────────────
-- 0068 — ส่วนลดเป็น %  (D96 · ภาค 2 เฟส C)
--
-- 🎯 ผู้ใช้ขอ "ส่วนลดซ่อนได้ แต่อยากให้มีส่วนลดเป็น % ด้วย"
--
-- 🚨 **ตัวเงินยังเป็นบาทเหมือนเดิมทุกประการ** — คอลัมน์ `*_pct` เป็น **คำอธิบาย**
--    ไว้พิมพ์บนสลิปว่า "ลด 10%" เท่านั้น · SQL ตั้งใจ **ไม่คิดบาทจาก % ซ้ำ**
--    เพราะราคาเมนูเปลี่ยนวันหลังแล้วส่วนลดของบิลเก่าจะขยับตาม
--    ⇒ ยอดที่ลงบัญชีไปแล้วเพี้ยนโดยไม่มีอะไรฟ้อง (กติกา D75)
--    ★ ฝั่ง TS แปลง % → บาท ที่ `lib/bar/discount.ts` (golden B10) แล้วส่งบาทมาให้
--      ⇒ **สูตรเงินยังมีที่เดียว** (บทเรียน D79 · แพตเทิร์นเดียวกับ D86)
--
-- 🪤 `fn_bar_close_sale` / `fn_bar_quick_sale` **เพิ่มพารามิเตอร์** → ต้อง drop ก่อน
--    ไม่งั้นได้ overload ตัวที่สอง แล้ว PostgREST เลือกตัวไหนก็ไม่รู้ (บทเรียน D69)
--
-- 🚨 ยกทั้ง 3 ฟังก์ชันมาด้วยสคริปต์ scripts/gen/gen-0068.mjs ไม่ได้พิมพ์ใหม่ (D79)
-- ─────────────────────────────────────────────────────────────────────────────

alter table bar_sale      add column if not exists discount_pct      numeric;
alter table bar_sale_item add column if not exists line_discount_pct numeric;

comment on column bar_sale.discount_pct is
  'ส่วนลดท้ายบิลที่ผู้ใช้กรอกเป็น % — คำอธิบายเท่านั้น ตัวเงินอยู่ที่ discount (D96)';
comment on column bar_sale_item.line_discount_pct is
  'ส่วนลดรายการที่ผู้ใช้กรอกเป็น % — คำอธิบายเท่านั้น ตัวเงินอยู่ที่ line_discount (D96)';

create or replace function fn_bar_add_lines(p_entity text, p_sale_no text, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_status text;
  v_line int;
  v_row jsonb;
  v_menu bar_menu%rowtype;
  v_cost numeric;
  v_qty numeric;
  v_comp boolean;
  v_amount numeric;
  v_added int := 0;
  v_rec record;
begin
  select status into v_status from bar_sale
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no for update;
  if not found then raise exception 'ไม่พบบิล %', p_sale_no; end if;
  if v_status <> 'เปิดอยู่' then
    raise exception 'บิล % ปิดไปแล้ว เพิ่มรายการไม่ได้ — เปิดบิลใหม่แทน', p_sale_no;
  end if;

  select coalesce(max(line_no), 0) into v_line from bar_sale_item
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no;

  for v_row in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_qty := coalesce((v_row->>'qty')::numeric, 0);
    if v_qty <= 0 then raise exception 'จำนวนต้องมากกว่า 0'; end if;

    -- ★ 0066: บังคับกติกายอดขาย **ก่อน** เขียนลงตาราง
    --   · ของแถม → 0 เสมอ ไม่ว่าผู้เรียกจะส่งอะไรมา
    --   · ยอดติดลบ → 0 (บรรทัดติดลบทำให้ยอดบิลเพี้ยนแบบเงียบ)
    v_comp := coalesce((v_row->>'is_comp')::boolean, false);
    v_amount := coalesce((v_row->>'amount')::numeric, 0);
    if v_comp then v_amount := 0; end if;
    if v_amount < 0 then v_amount := 0; end if;

    select * into v_menu from bar_menu
     where tenant_id = v_tenant and entity_id = p_entity and menu_id = v_row->>'menu_id';

    -- ต้นทุน: **คิดที่นี่เพราะต้องอ่านราคาต้นทุนในจังหวะเดียวกับที่ตัดสต็อก**
    -- 🚨 ของแถมมีต้นทุนเท่าของขาย — `is_comp` ตัดแค่ยอดขาย ไม่ตัดต้นทุน
    v_cost := 0;
    if found then
      if exists (select 1 from bar_recipe
                  where tenant_id = v_tenant and entity_id = p_entity and menu_id = v_menu.menu_id) then
        select coalesce(sum(r.qty * i.cost_per_unit), 0) into v_cost
          from bar_recipe r
          join bar_item i on i.tenant_id = r.tenant_id and i.entity_id = r.entity_id
                         and i.item_id = r.item_id
         where r.tenant_id = v_tenant and r.entity_id = p_entity and r.menu_id = v_menu.menu_id;
        v_cost := round(v_cost * v_qty, 2);
      else
        v_cost := round(coalesce(v_menu.fixed_cost, 0) * v_qty, 2);
      end if;
    end if;

    v_line := v_line + 1;
    insert into bar_sale_item(tenant_id, entity_id, sale_no, line_no, menu_id, menu_name,
                              qty, price, line_discount, line_discount_pct, is_comp, amount, cost)
    values (v_tenant, p_entity, p_sale_no, v_line,
            v_row->>'menu_id',
            coalesce(nullif(trim(coalesce(v_row->>'menu_name', '')), ''), v_menu.name, 'ไม่ระบุ'),
            v_qty,
            coalesce((v_row->>'price')::numeric, 0),
            greatest(coalesce((v_row->>'line_discount')::numeric, 0), 0),
            -- 🚨 **% เป็นคำอธิบายเท่านั้น — ตัวเงินคือ line_discount ข้างบน**
            --    SQL ตั้งใจ *ไม่* คิดบาทจาก % ซ้ำ: ราคาเมนูเปลี่ยนวันหลังแล้วบิลเก่าจะขยับตาม
            --    = ยอดที่ลงบัญชีไปแล้วเพี้ยน (กติกา D75 · ตัวเงินต้องเป็นค่าที่แช่ไว้)
            nullif(least(greatest(coalesce((v_row->>'line_discount_pct')::numeric, 0), 0), 100), 0),
            v_comp,
            v_amount,
            v_cost);

    -- 🚨 ตัดสต็อกตามสูตร — **ของแถมก็ตัด** (แถมแล้วเหล้าก็หายจากขวดจริง)
    for v_rec in
      select r.item_id, r.qty from bar_recipe r
       where r.tenant_id = v_tenant and r.entity_id = p_entity
         and r.menu_id = v_row->>'menu_id'
    loop
      perform bar_apply_move(v_tenant, p_entity, v_rec.item_id, -(v_rec.qty * v_qty),
                             'ขาย', p_sale_no, null);
    end loop;

    v_added := v_added + 1;
  end loop;

  if v_added = 0 then raise exception 'ไม่มีรายการให้เพิ่ม'; end if;
  return jsonb_build_object('ok', true, 'sale_no', p_sale_no, 'added', v_added);
end $fn$;

drop function if exists fn_bar_quick_sale(text, jsonb, text, date, text, text, numeric, numeric);
drop function if exists fn_bar_close_sale(text, text, text, date, numeric, numeric);

create or replace function fn_bar_close_sale(
  p_entity text, p_sale_no text, p_method text,
  p_business_date date, p_discount numeric default 0, p_rounding numeric default 0,
  p_discount_pct numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_sale bar_sale%rowtype;
  v_sub numeric;
  v_cost numeric;
  v_disc numeric;
  v_grand numeric;
begin
  select * into v_sale from bar_sale
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no for update;
  if not found then raise exception 'ไม่พบบิล %', p_sale_no; end if;
  if v_sale.status <> 'เปิดอยู่' then raise exception 'บิล % ไม่ได้เปิดอยู่', p_sale_no; end if;
  if coalesce(trim(p_method), '') = '' then raise exception 'ต้องเลือกวิธีรับเงิน'; end if;
  if p_business_date is null then raise exception 'ไม่รู้ว่าบิลนี้เป็นยอดของวันไหน'; end if;

  select coalesce(sum(amount), 0), coalesce(sum(cost), 0) into v_sub, v_cost
    from bar_sale_item
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no
     and voided_at is null;

  -- 🪤 ส่วนลดเกินยอด → ตัดให้เท่ากับยอด ไม่ปล่อยให้บิลติดลบ
  --    (บิลติดลบจะกลายเป็นรายรับติดลบตอนลงบัญชีรายวัน ซึ่งไม่มีใครสังเกต)
  v_disc := least(greatest(coalesce(p_discount, 0), 0), v_sub);
  v_grand := greatest(0, v_sub - v_disc) + coalesce(p_rounding, 0);

  update bar_sale set
    status = 'ปกติ', closed_at = now(), business_date = p_business_date,
    method = trim(p_method), sub_total = v_sub, discount = v_disc,
    rounding = coalesce(p_rounding, 0), grand_total = v_grand, cost_total = v_cost,
    -- ★ เก็บไว้พิมพ์บนสลิปว่า "ส่วนลดท้ายบิล 10%" · ตัวเงินยังเป็น `discount` ข้างบน
    discount_pct = nullif(least(greatest(coalesce(p_discount_pct, 0), 0), 100), 0)
  where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no;

  -- สถิติลูกค้า — ★ ต้องถอยกลับตอนยกเลิกบิลด้วย (ดู fn_bar_void_sale)
  if v_sale.customer_id is not null then
    update bar_customer set
      visits = visits + 1,
      spend_total = spend_total + v_grand,
      first_seen = least(coalesce(first_seen, p_business_date), p_business_date),
      last_seen = greatest(coalesce(last_seen, p_business_date), p_business_date)
    where tenant_id = v_tenant and entity_id = p_entity and customer_id = v_sale.customer_id;
  end if;

  return jsonb_build_object('ok', true, 'sale_no', p_sale_no,
                            'sub_total', v_sub, 'grand_total', v_grand, 'cost_total', v_cost);
end $fn$;

create or replace function fn_bar_quick_sale(
  p_entity text, p_items jsonb, p_method text, p_business_date date,
  p_channel text default 'บาร์', p_customer text default null,
  p_discount numeric default 0, p_rounding numeric default 0,
  p_discount_pct numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_open jsonb := fn_bar_open_sale(p_entity, null, p_channel, p_customer);
  v_no text := v_open->>'sale_no';
begin
  perform fn_bar_add_lines(p_entity, v_no, p_items);
  return fn_bar_close_sale(p_entity, v_no, p_method, p_business_date, p_discount, p_rounding,
                           p_discount_pct);
end $fn$;
