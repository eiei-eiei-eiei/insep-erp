-- ─────────────────────────────────────────────────────────────────────────────
-- 0067 — ลบบิลจากหน้าขายได้ + ชื่อหมวดตั้งต้นที่คนอ่านรู้เรื่อง  (D96 · ภาค 2 เฟส A)
--
-- 🎯 มาจากการที่ผู้ใช้ลองใช้จริงแล้วแจ้งมา 2 ข้อ:
--    1. "เปิดบิลแล้วแต่จะลบบิลออกได้ไหม"  → ฟังก์ชันมีอยู่แล้ว แต่ขอ cap สูงเกินไป
--    2. "เมนูเฉพาะกิจ หมวดระบบ คืออะไร"   → ชื่อค่าปริยายไม่ได้อธิบายตัวเอง
--
-- 🚨 ทั้งสองฟังก์ชัน **ยกมาด้วยสคริปต์จากไฟล์ล่าสุดที่นิยามมัน** ไม่ได้พิมพ์ใหม่จากความจำ
--    (บทเรียน D79: ก๊อป body ผิดรอบเดียว = ฟีเจอร์ที่เคยทำงานพังเงียบ ๆ)
--    สคริปต์: scripts/gen/gen-0067.mjs
--
-- 🚨 **ไม่มีการ UPDATE ชื่อหมวดของ tenant ที่มีอยู่แล้ว** — ลูกค้าที่ตั้งชื่อเองไปแล้ว
--    จะโดนเขียนทับ · ชื่อใหม่มีผลเฉพาะหมวดที่ยังไม่เคยถูกสร้าง
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function fn_bar_void_sale(p_entity text, p_sale_no text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  -- 🚨 ยังไม่ตัดสินสิทธิ์ตรงนี้ — ต้องอ่านสภาพบิลก่อนถึงจะรู้ว่าต้องใช้ cap ระดับไหน
  --    `bar.read` คือด่านต่ำสุดที่พอให้มองเห็นบิล · ตัวจริงเช็คอีกทีข้างล่าง
  v_tenant uuid := bar_guard(p_entity, 'bar.read');
  v_sale bar_sale%rowtype;
  v_rec record;
begin
  select * into v_sale from bar_sale
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no for update;
  if not found then raise exception 'ไม่พบบิล %', p_sale_no; end if;

  -- ── สิทธิ์ตามสภาพบิล (D96) ────────────────────────────────────────────────
  --  🐛 เดิมบังคับ `bar.config` ทุกกรณี ⇒ **พนักงานบาร์เปิดบิลผิดแล้วลบเองไม่ได้เลย**
  --     ต้องไปตามเจ้าของร้านมากดให้ ทั้งที่บิลนั้นยังไม่มีอะไรอยู่ในนั้นสักรายการ
  --  ★ เส้นแบ่งอยู่ที่ **บิลปิดไปแล้วหรือยัง** ไม่ใช่ที่จำนวนรายการ —
  --    บิลที่ปิดแล้วคือเงินที่รับมาแล้วและใบเสร็จที่อาจอยู่ในมือลูกค้า
  if v_sale.status = 'เปิดอยู่' then
    perform bar_guard(p_entity, 'bar.write');
  else
    perform bar_guard(p_entity, 'bar.config');
  end if;
  if v_sale.status = 'ยกเลิก' then raise exception 'บิล % ถูกยกเลิกไปแล้ว', p_sale_no; end if;

  if v_sale.business_date is not null and exists (
    select 1 from bar_post
     where tenant_id = v_tenant and entity_id = p_entity
       and post_date = v_sale.business_date and status = 'ปกติ'
  ) then
    raise exception 'ยอดวันที่ % ลงบัญชีไปแล้ว — ต้องถอนบัญชีวันนั้นก่อนจึงจะยกเลิกบิลได้',
                    to_char(v_sale.business_date, 'DD/MM/YYYY');
  end if;

  -- คืนสต็อกของทุกแถวที่ยังไม่ถูกยกเลิก
  for v_rec in
    select r.item_id, r.qty * si.qty as amt
      from bar_sale_item si
      join bar_recipe r on r.tenant_id = si.tenant_id and r.entity_id = si.entity_id
                       and r.menu_id = si.menu_id
     where si.tenant_id = v_tenant and si.entity_id = p_entity
       and si.sale_no = p_sale_no and si.voided_at is null
  loop
    perform bar_apply_move(v_tenant, p_entity, v_rec.item_id, v_rec.amt,
                           'ยกเลิกบิล', p_sale_no, p_reason);
  end loop;

  update bar_sale set status = 'ยกเลิก', note = coalesce(p_reason, note)
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no;

  -- 🚨 สถิติลูกค้าต้องถอย — ไม่งั้น "มากี่ครั้ง/ยอดสะสม" จะพองขึ้นทุกครั้งที่ยกเลิกบิล
  if v_sale.customer_id is not null and v_sale.status = 'ปกติ' then
    update bar_customer set
      visits = greatest(0, visits - 1),
      spend_total = greatest(0, spend_total - v_sale.grand_total)
    where tenant_id = v_tenant and entity_id = p_entity and customer_id = v_sale.customer_id;
  end if;

  return jsonb_build_object('ok', true, 'sale_no', p_sale_no);
end $fn$;

create or replace function fn_bar_save_menu(p_entity text, p_menu jsonb, p_recipe jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_id text := nullif(trim(coalesce(p_menu->>'menu_id', '')), '');
  v_cat text := coalesce(nullif(trim(coalesce(p_menu->>'category_id', '')), ''), 'custom');
  v_name text := trim(coalesce(p_menu->>'name', ''));
  v_row jsonb;                              -- 🪤 ห้ามใช้ชื่อเดียวกับ alias ของ jsonb_array_elements (D79)
begin
  if v_name = '' then raise exception 'ต้องตั้งชื่อเมนู'; end if;

  -- หมวดต้องมีจริง — 'custom' ถูกสร้างให้อัตโนมัติเพราะเป็นที่ลงจอดของเมนูใหม่จากหน้าขาย
  if not exists (select 1 from bar_category
                  where tenant_id = v_tenant and entity_id = p_entity and category_id = v_cat) then
    if v_cat = 'custom' then
      insert into bar_category(tenant_id, entity_id, category_id, name, sort, is_system)
      values (v_tenant, p_entity, 'custom', 'เมนูที่คิดหน้าบาร์', 999, true);
    else
      raise exception 'ไม่พบหมวด %', v_cat;
    end if;
  end if;

  if v_id is null then
    v_id := 'BM' || lpad(next_serial('BM-' || p_entity)::text, 4, '0');
    insert into bar_menu(tenant_id, entity_id, menu_id, name, price, fixed_cost, category_id,
                         method, glass, note, created_for)
    values (v_tenant, p_entity, v_id, v_name,
            coalesce((p_menu->>'price')::numeric, 0),
            (p_menu->>'fixed_cost')::numeric, v_cat,
            p_menu->>'method', p_menu->>'glass', p_menu->>'note', p_menu->>'created_for');
  else
    update bar_menu set
      name = v_name,
      price = coalesce((p_menu->>'price')::numeric, price),
      fixed_cost = (p_menu->>'fixed_cost')::numeric,
      category_id = v_cat,
      method = p_menu->>'method',
      glass = p_menu->>'glass',
      note = p_menu->>'note',
      created_for = p_menu->>'created_for'
    where tenant_id = v_tenant and entity_id = p_entity and menu_id = v_id;
    if not found then raise exception 'ไม่พบเมนู %', v_id; end if;
    delete from bar_recipe
     where tenant_id = v_tenant and entity_id = p_entity and menu_id = v_id;
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_recipe, '[]'::jsonb)) loop
    if coalesce((v_row->>'qty')::numeric, 0) <= 0 then
      raise exception 'ปริมาณในสูตรต้องมากกว่า 0 (%)', coalesce(v_row->>'item_id', '?');
    end if;
    insert into bar_recipe(tenant_id, entity_id, menu_id, item_id, qty)
    values (v_tenant, p_entity, v_id, v_row->>'item_id', (v_row->>'qty')::numeric);
  end loop;

  return jsonb_build_object('ok', true, 'menu_id', v_id);
end $fn$;
