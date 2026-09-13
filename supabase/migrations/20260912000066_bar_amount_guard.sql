-- ============================================================================
-- 0066 — ยอดขายต่อบรรทัดต้องเป็นจริงเสมอ ไม่ว่าใครเรียก  (D96)
--
-- 🎯 **เจอจากการเขียนเทส tenant ของ 0065** — ตัวเทสเองส่ง `amount = 260` มาพร้อม
--    `is_comp = true` (เพราะ helper ในเทสเขียนพลาด ใช้ชื่อคีย์ผิด) แล้ว **SQL รับไว้เฉย ๆ**
--    ⇒ ได้แถวของแถมที่มียอดขาย 260 = **รายได้และกำไรพองขึ้นโดยไม่มีอะไรฟ้อง**
--
-- 🚨 บั๊กอยู่ในเทส ไม่ได้อยู่ในโค้ดจริง — แต่สิ่งที่มันเปิดโปงคือของจริง:
--    0065 เขียนไว้ว่า "`amount` ให้ TS คิด" ซึ่งถูกต้องในแง่**นโยบายส่วนลด**
--    แต่ "ของแถมยอดขาย 0" ไม่ใช่นโยบายหน้าจอ มันเป็น**กติกาธุรกิจ**
--    ⇒ ต้องเป็นจริงในฐานข้อมูลเสมอ ไม่ว่าผู้เรียกจะส่งอะไรมา
--    (ตระกูลเดียวกับ D55 ที่ย้ายด่าน ม.86/13 มาไว้ที่ DB เพราะ "ยิง API ตรงก็ต้องไม่รอด")
--
-- ★ นี่ **ไม่ใช่การย้ายสูตรมาไว้ใน SQL** — SQL ไม่ได้คิด `amount` ให้
--   มันแค่ปฏิเสธค่าที่ขัดกับกติกา (ของแถม → 0 · ยอดติดลบ → 0)
--
-- 🪤 ยก `fn_bar_add_lines` มาจาก **0065 ซึ่งเป็นไฟล์ล่าสุดที่นิยามมัน** ทั้งดุ้น
--    `create or replace` เขียนทับทั้งตัว — ยกจากไฟล์ที่จำได้ว่าเคยแก้ = ตกของที่เพิ่งเติมไป
-- ============================================================================

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
                              qty, price, line_discount, is_comp, amount, cost)
    values (v_tenant, p_entity, p_sale_no, v_line,
            v_row->>'menu_id',
            coalesce(nullif(trim(coalesce(v_row->>'menu_name', '')), ''), v_menu.name, 'ไม่ระบุ'),
            v_qty,
            coalesce((v_row->>'price')::numeric, 0),
            greatest(coalesce((v_row->>'line_discount')::numeric, 0), 0),
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

-- ── `p_qty_pack` ให้มีค่าปริยาย — ของบางอย่างซื้อเป็นหน่วยฐานอยู่แล้ว (มะนาวเป็นลูก) ──
--    🪤 เจอตอนเขียนเทส: ลืมส่งพารามิเตอร์ที่ไม่มี default → PostgREST หาฟังก์ชันไม่เจอเลย
--       (`PGRST202`) ซึ่งอ่านแล้วเหมือน "ยังไม่ได้ลง migration" ทั้งที่ลงแล้ว
--
-- 🚨 **ต้อง drop ก่อน create — สองเหตุผลที่ต่างกันและสำคัญทั้งคู่**
--    1. พารามิเตอร์ที่มี default ต้องอยู่**ท้ายสุด** → ต้องสลับ `p_qty_pack` ไปหลัง `p_cost_total`
--    2. Postgres ระบุฟังก์ชันด้วย **ชนิด** ไม่ใช่ชื่อพารามิเตอร์ — สลับแล้วชนิดยังเป็น
--       `(text,text,numeric,numeric,numeric,date,text,text)` เหมือนเดิมเป๊ะ
--       ⇒ `create or replace` จะล้มด้วย "cannot change name of input parameter"
--         (ไม่ใช่สร้าง overload ตัวที่ 2 แบบ D69 — คนละอาการ แต่ทางแก้เดียวกัน)
drop function if exists fn_bar_receive(text, text, numeric, numeric, numeric, date, text, text);

create or replace function fn_bar_receive(
  p_entity text, p_item text, p_qty numeric, p_cost_total numeric,
  p_qty_pack numeric default null, p_date date default null,
  p_source text default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_prev bar_item%rowtype;
  v_new_cost numeric;
  v_id bigint;
begin
  if coalesce(p_qty, 0) <= 0 then raise exception 'จำนวนที่รับต้องมากกว่า 0'; end if;
  if coalesce(p_cost_total, 0) < 0 then raise exception 'ราคาที่จ่ายติดลบไม่ได้'; end if;

  select * into v_prev from bar_item
   where tenant_id = v_tenant and entity_id = p_entity and item_id = p_item for update;
  if not found then raise exception 'ไม่พบวัตถุดิบ % ในบาร์', p_item; end if;

  -- 🚨 สต็อกเดิม ≤ 0 → ใช้ราคาล็อตใหม่ล้วน · เอาสูตรถัวเฉลี่ยไปใช้กับยอดติดลบ
  --    จะได้ต้นทุน**ติดลบ** แล้วกำไรพองมหาศาลโดยไม่มีอะไรฟ้อง (ตรงกับ golden B3)
  if v_prev.qty > 0 then
    v_new_cost := round((v_prev.qty * v_prev.cost_per_unit + coalesce(p_cost_total, 0))
                        / (v_prev.qty + p_qty), 4);
  else
    v_new_cost := round(coalesce(p_cost_total, 0) / p_qty, 4);
  end if;

  insert into bar_receive(tenant_id, entity_id, doc_date, item_id, qty_pack, qty,
                          cost_total, source, note)
  values (v_tenant, p_entity,
          coalesce(p_date, (now() at time zone 'Asia/Bangkok')::date),
          p_item, p_qty_pack, p_qty, coalesce(p_cost_total, 0), p_source, p_note)
  returning id into v_id;

  update bar_item set cost_per_unit = v_new_cost
   where tenant_id = v_tenant and entity_id = p_entity and item_id = p_item;

  perform bar_apply_move(v_tenant, p_entity, p_item, p_qty, 'รับเข้า', v_id::text, p_source);

  return jsonb_build_object('ok', true, 'receive_id', v_id, 'cost_per_unit', v_new_cost);
end $fn$;

notify pgrst, 'reload schema';
