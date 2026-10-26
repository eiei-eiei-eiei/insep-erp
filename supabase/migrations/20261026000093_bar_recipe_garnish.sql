-- ─────────────────────────────────────────────────────────────────────────────
-- 0093 — บาร์: บรรทัดสูตรอ้าง "ชุดตกแต่ง" ได้ (D131)
--
-- 🎯 เดิม (D127) กดปุ่มชุดตกแต่ง = **บวกจำนวนเข้าบรรทัดวัตถุดิบ** เป็นเลขธรรมดา
--    ⇒ แก้สัดส่วนของชุดทีหลัง (มะนาว 1 ลูกได้ 7 แว่น → 8 แว่น) เมนูเดิมไม่ขยับเลย ต้องไล่แก้ทีละเมนู
--    ตอนนี้สูตรอ้าง **ตัวชุด** แบบเดียวกับที่อ้างช่องเหล้าประจำบ้าน (แพตเทิร์น `bar_recipe_slot`)
--
-- ── ตกลงกับผู้ใช้ (2026-10-26) ────────────────────────────────────────────────
-- · ตอน "สั่ง" แปลงชุดเป็นวัตถุดิบ × จำนวน **ณ ตอนนั้น** — แก้ชุด = ทุกเมนูที่อ้างเปลี่ยนตาม
--   แต่แก้วที่ขายไปแล้วห้ามขยับ (ตัดสต็อก/ต้นทุนแช่ไว้ใน bar_move/bar_sale_item ตอนสั่งอยู่แล้ว)
-- · จำนวนต่อชุดพิมพ์เป็นเศษส่วนได้ ("1/7") — เก็บทั้งตัวเลข (`qty`) และข้อความที่พิมพ์ (`qty_text`) ไว้แสดง
-- · **ชุดที่ไม่ตัดสต็อกมีได้** (วัตถุดิบว่าง — ใบมิ้นต์จากกระถาง) · บนสูตรขึ้น "(ไม่ตัดสต็อก)"
-- · เปลี่ยนวัตถุดิบของชุดเป็นหน่วยอื่น → ต้องใส่จำนวนใหม่ (หน้าจอล้างช่องให้ · RPC ตรวจซ้ำด้วย `qty_unit`)
-- · ลบชุดที่มีเมนูอ้าง = บล็อก + บอกรายชื่อเมนู (เหมือนช่องเหล้าประจำบ้าน)
-- · ไม่แตะเมนูเก่าที่บวกเลขเข้าไปตอน D127 (ผู้ใช้ลงสูตรใหม่เอง)
--
-- ── 🚨 กติกา ─────────────────────────────────────────────────────────────────
-- · ตัวแปลงสูตร → ขวด ยังมี **ที่เดียว** คือ `bar_menu_lines()` (ฝาแฝดฝั่งจอ `resolveRecipe()`)
-- · "เมนูนี้มีสูตรไหม" ตัดสินจาก**แถวสูตร** ไม่ใช่จากขวดที่แปลงได้ (`bar_menu_has_recipe`)
--   🪤 เมนูที่สูตรมีแต่ชุดไม่ตัดสต็อก แปลงได้ 0 ขวด — ถ้าใช้ `exists(bar_menu_lines)` แบบเดิม
--      SQL จะตกไปใช้ต้นทุนตายตัว ขณะที่หน้าจอบอกว่า "ระบบใช้สูตร" (สองฝั่งตัดสินคนละแบบ · D84)
-- · ⛓ ไม่แตะตารางฝั่งผลิต/ขาย
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. ชุดตกแต่ง: วัตถุดิบว่างได้ (ไม่ตัดสต็อก) + ข้อความจำนวน ──────────────────
alter table bar_garnish alter column item_id drop not null;
alter table bar_garnish alter column qty     drop not null;
alter table bar_garnish add column qty_text text;          -- ข้อความที่ผู้ใช้พิมพ์ เช่น "1/7" (ไว้แสดง · ตัวเลขจริงคือ qty)
alter table bar_garnish add constraint bar_garnish_item_qty_pair
  check ((item_id is null) = (qty is null));              -- ไม่ตัดสต็อก = ไม่มีทั้งคู่ · ตัด = ต้องมีทั้งคู่
alter table bar_garnish add constraint bar_garnish_qty_text_nonblank
  check (qty_text is null or btrim(qty_text) <> '');

-- ── 2. บรรทัดสูตรที่อ้างชุดตกแต่ง ────────────────────────────────────────────
create table bar_recipe_garnish (
  tenant_id  uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id  text not null,
  menu_id    text not null,
  garnish_id text not null,
  qty        numeric not null,                    -- จำนวน "ชุด" ต่อแก้ว (ไม่ใช่หน่วยของวัตถุดิบ)
  primary key (tenant_id, entity_id, menu_id, garnish_id),
  foreign key (tenant_id, entity_id, menu_id)
    references bar_menu (tenant_id, entity_id, menu_id) on delete cascade,
  foreign key (tenant_id, entity_id, garnish_id)
    references bar_garnish (tenant_id, entity_id, garnish_id) on delete restrict,
  constraint bar_recipe_garnish_qty_pos check (qty > 0)
);

-- 🚨 ทุก index ขึ้นต้นด้วย tenant_id (NEXT_STEPS 4.8)
create index bar_recipe_garnish_idx on bar_recipe_garnish (tenant_id, entity_id, garnish_id);

-- RLS เท่ากับ bar_recipe / bar_recipe_slot — พนักงานบาร์สร้างเมนูจากหน้าขายได้ (bar.write)
alter table bar_recipe_garnish enable row level security;
create policy bar_recipe_garnish_sel on bar_recipe_garnish for select
  using (tenant_id = my_tenant() and has_cap('bar.read'));
create policy bar_recipe_garnish_w on bar_recipe_garnish for all
  using (tenant_id = my_tenant() and has_cap('bar.write'))
  with check (tenant_id = my_tenant() and has_cap('bar.write'));

-- grant (D118 — ตารางใหม่ต้อง grant ในไฟล์เดียวกัน)
grant select, insert, update, delete on table public.bar_recipe_garnish to authenticated, service_role;

-- audit (กฎ D80)
create trigger audit_bar_recipe_garnish after insert or update or delete on bar_recipe_garnish
  for each row execute function trg_audit('menu_id');

-- ── 3. ห้องทดลอง: บรรทัดสูตรทดลองที่อ้างชุดตกแต่ง ──────────────────────────────
--    kind 'ชุดตกแต่ง': qty = จำนวนชุดต่อแก้ว · item_id/unit = วัตถุดิบที่ตัด ณ ตอนชง (ว่าง = ไม่ตัดสต็อก)
--    garnish_qty = ปริมาณวัตถุดิบต่อ 1 ชุด ณ ตอนชง (ไว้ใช้ถ้าชุดถูกลบทีหลัง)
alter table bar_lab_use_line add column garnish_id  text;
alter table bar_lab_use_line add column garnish_qty numeric;
do $do$
declare v_con text;
begin
  -- CHECK ของ kind เขียนแบบ inline ใน 0091 (ไม่มีชื่อ) → หาชื่อจาก catalog
  for v_con in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.bar_lab_use_line'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%สูตรทดลอง%'
  loop
    execute format('alter table bar_lab_use_line drop constraint %I', v_con);
  end loop;
end $do$;
alter table bar_lab_use_line add constraint bar_lab_use_line_kind_check
  check (kind in ('สูตร', 'เมนู', 'สูตรทดลอง', 'วัตถุดิบ', 'ชุดตกแต่ง'));

-- ── 4. เมนูนี้มีสูตรไหม (ตัดสินจากแถวสูตร ไม่ใช่จากขวดที่แปลงได้) ─────────────
--    ★ invoker · ฝาแฝดฝั่งจอคือ `menuMode()` ที่ดู `recipe.length > 0`
create or replace function bar_menu_has_recipe(p_tenant uuid, p_entity text, p_menu text)
returns boolean
language sql stable set search_path = public as $fn$
  select exists (select 1 from bar_recipe r
                  where r.tenant_id = p_tenant and r.entity_id = p_entity and r.menu_id = p_menu)
      or exists (select 1 from bar_recipe_slot rs
                  where rs.tenant_id = p_tenant and rs.entity_id = p_entity and rs.menu_id = p_menu)
      or exists (select 1 from bar_recipe_garnish rg
                  where rg.tenant_id = p_tenant and rg.entity_id = p_entity and rg.menu_id = p_menu)
$fn$;

-- ── 5. ห้องทดลอง: ตัดบรรทัดชุดตกแต่ง 1 บรรทัด — INVOKER (ตัวช่วยของ definer) ──
--    ไม่แก้ `bar_lab_cut_line` ตัวเดิม (signature เดิมถูกเรียกจาก 2 ที่)
create or replace function bar_lab_cut_garnish(
  p_tenant uuid, p_entity text, p_use text, p_line int,
  p_garnish text, p_qty numeric, p_mult numeric, p_note text
) returns numeric
language plpgsql set search_path = public as $fn$
declare
  v_g bar_garnish%rowtype;
  v_iname text;
  v_unit text;
  v_cpu numeric;
  v_cost numeric := 0;
begin
  if coalesce(p_qty, 0) <= 0 then raise exception 'บรรทัดที่ %: จำนวนชุดต้องมากกว่า 0', p_line; end if;
  select * into v_g from bar_garnish
   where tenant_id = p_tenant and entity_id = p_entity and garnish_id = p_garnish;
  if not found then
    raise exception 'บรรทัดที่ %: ไม่พบชุดตกแต่ง (อาจถูกลบจากอีกเครื่อง) — รีเฟรชหน้าแล้วลองใหม่', p_line;
  end if;
  if v_g.item_id is not null then
    select i.name, i.unit, i.cost_per_unit into v_iname, v_unit, v_cpu from bar_item i
     where i.tenant_id = p_tenant and i.entity_id = p_entity and i.item_id = v_g.item_id;
    if not found then
      raise exception 'บรรทัดที่ %: ไม่พบวัตถุดิบของชุด % — รีเฟรชหน้าแล้วลองใหม่', p_line, v_g.name;
    end if;
    v_cost := round(p_qty * p_mult * v_g.qty * coalesce(v_cpu, 0), 2);
  end if;
  insert into bar_lab_use_line(tenant_id, entity_id, use_id, line_no, kind, item_id, garnish_id, garnish_qty,
                               label, unit, qty, cost)
  values (p_tenant, p_entity, p_use, p_line, 'ชุดตกแต่ง', v_g.item_id, v_g.garnish_id, v_g.qty,
          v_g.name || case when v_g.item_id is null then ' (ไม่ตัดสต็อก)'
                           else ' (' || v_iname || ' ' || coalesce(v_g.qty_text, trim_scale(v_g.qty)::text)
                                || ' ' || v_unit || ')' end,
          v_unit, p_qty, v_cost);
  if v_g.item_id is not null then
    perform bar_apply_move(p_tenant, p_entity, v_g.item_id, -(p_qty * p_mult * v_g.qty), 'ห้องทดลอง', p_use, p_note);
  end if;
  return v_cost;
end $fn$;

-- 🚨 D99: ตัวช่วยของ definer — ห้ามเรียกตรงจาก client (ตัดสต็อกโดยไม่ผ่าน bar_guard)
revoke execute on function bar_lab_cut_garnish(uuid, text, text, int, text, numeric, numeric, text)
  from public, anon, authenticated;

-- ── 6. สูตรของเมนู → ขวด (+ชุดตกแต่ง) ──
-- ยก bar_menu_lines จาก 20261024000090_bar_house_spirit.sql
create or replace function bar_menu_lines(p_tenant uuid, p_entity text, p_menu text)
returns table(item_id text, qty numeric)
language sql stable set search_path = public as $fn$
  select x.item_id, sum(x.qty)
    from (
      select r.item_id, r.qty
        from bar_recipe r
       where r.tenant_id = p_tenant and r.entity_id = p_entity and r.menu_id = p_menu
      union all
      select s.item_id, rs.qty
        from bar_recipe_slot rs
        join bar_house_slot s on s.tenant_id = rs.tenant_id and s.entity_id = rs.entity_id
                             and s.slot_id = rs.slot_id
       where rs.tenant_id = p_tenant and rs.entity_id = p_entity and rs.menu_id = p_menu
      union all
      -- D131: ชุดตกแต่ง → วัตถุดิบของชุด × (จำนวนชุด × ปริมาณต่อชุด) ณ ตอนนี้
      --       ชุดที่ไม่ตัดสต็อก (item_id ว่าง) ไม่มีแถว — ไม่ใช่แถวยอด 0
      select g.item_id, rg.qty * g.qty
        from bar_recipe_garnish rg
        join bar_garnish g on g.tenant_id = rg.tenant_id and g.entity_id = rg.entity_id
                          and g.garnish_id = rg.garnish_id
       where rg.tenant_id = p_tenant and rg.entity_id = p_entity and rg.menu_id = p_menu
         and g.item_id is not null
    ) x
   group by x.item_id
$fn$;

-- ── 7. เพิ่มบรรทัดบิล (โหมดสูตรตัดสินจากแถวสูตร) ──
-- ยก fn_bar_add_lines จาก 20261024000090_bar_house_spirit.sql
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
      -- D127: สูตร = ขวดตรง + ช่องเหล้าประจำบ้านที่แปลงเป็นขวด ณ ตอนนี้ (bar_menu_lines ที่เดียว)
      -- D131: มีสูตรไหม = มีแถวสูตร (ชุดไม่ตัดสต็อกล้วน ๆ แปลงได้ 0 ขวด แต่ยังเป็นโหมดสูตร · ตรงกับ menuMode())
      if bar_menu_has_recipe(v_tenant, p_entity, v_menu.menu_id) then
        select coalesce(sum(r.qty * i.cost_per_unit), 0) into v_cost
          from bar_menu_lines(v_tenant, p_entity, v_menu.menu_id) r
          join bar_item i on i.tenant_id = v_tenant and i.entity_id = p_entity
                         and i.item_id = r.item_id;
        v_cost := round(v_cost * v_qty, 2);
      else
        v_cost := round(coalesce(v_menu.fixed_cost, 0) * v_qty, 2);
      end if;
    end if;

    v_line := v_line + 1;
    insert into bar_sale_item(tenant_id, entity_id, sale_no, line_no, menu_id, menu_name,
                              qty, price, line_discount, line_discount_pct, is_comp, amount, cost,
                              moves_linked)
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
            v_cost,
            true);     -- D127: การตัดสต็อกของบรรทัดนี้ผูก bar_move.ref_line (ยกเลิกแล้วคืนเข้าขวดที่ตัดจริง)

    -- 🚨 ตัดสต็อกตามสูตร — **ของแถมก็ตัด** (แถมแล้วเหล้าก็หายจากขวดจริง)
    -- ★ D127: ช่องเหล้าประจำบ้าน → ขวดที่ตั้งไว้ ณ ตอนสั่ง · ขวดหมด = ปล่อยติดลบ ห้ามสลับขวดเอง
    for v_rec in
      select r.item_id, r.qty from bar_menu_lines(v_tenant, p_entity, v_row->>'menu_id') r
    loop
      perform bar_apply_move(v_tenant, p_entity, v_rec.item_id, -(v_rec.qty * v_qty),
                             'ขาย', p_sale_no, null);
      -- ผูกการตัดกับบรรทัดบิล (แถวที่ bar_apply_move เพิ่งเขียนในจังหวะนี้)
      update bar_move set ref_line = v_line
       where tenant_id = v_tenant and entity_id = p_entity
         and id = currval(pg_get_serial_sequence('public.bar_move', 'id'));
    end loop;

    v_added := v_added + 1;
  end loop;

  if v_added = 0 then raise exception 'ไม่มีรายการให้เพิ่ม'; end if;
  return jsonb_build_object('ok', true, 'sale_no', p_sale_no, 'added', v_added);
end $fn$;

-- ── 8. บันทึกเมนู (+บรรทัดชุดตกแต่ง) ──
-- ยก fn_bar_save_menu จาก 20261024000090_bar_house_spirit.sql
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
    delete from bar_recipe_slot
     where tenant_id = v_tenant and entity_id = p_entity and menu_id = v_id;
    delete from bar_recipe_garnish
     where tenant_id = v_tenant and entity_id = p_entity and menu_id = v_id;
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_recipe, '[]'::jsonb)) loop
    if coalesce((v_row->>'qty')::numeric, 0) <= 0 then
      raise exception 'ปริมาณในสูตรต้องมากกว่า 0 (%)', coalesce(v_row->>'item_id', v_row->>'slot_id', v_row->>'garnish_id', '?');
    end if;
    -- D127: บรรทัดอ้าง "ช่องเหล้าประจำบ้าน" (slot_id) หรือขวดตรง (item_id) อย่างใดอย่างหนึ่ง
    -- D131: บรรทัดอ้าง "ชุดตกแต่ง" (garnish_id · qty = จำนวนชุดต่อแก้ว)
    if nullif(v_row->>'garnish_id', '') is not null then
      if nullif(v_row->>'item_id', '') is not null or nullif(v_row->>'slot_id', '') is not null then
        raise exception 'บรรทัดสูตรอ้างได้ทีละอย่าง — วัตถุดิบ ช่องเหล้าประจำบ้าน หรือชุดตกแต่ง';
      end if;
      if not exists (select 1 from bar_garnish
                      where tenant_id = v_tenant and entity_id = p_entity and garnish_id = v_row->>'garnish_id') then
        raise exception 'ไม่พบชุดตกแต่งในสูตร (อาจถูกลบจากอีกเครื่อง) — รีเฟรชหน้าแล้วลองใหม่';
      end if;
      insert into bar_recipe_garnish(tenant_id, entity_id, menu_id, garnish_id, qty)
      values (v_tenant, p_entity, v_id, v_row->>'garnish_id', (v_row->>'qty')::numeric);
    elsif nullif(v_row->>'slot_id', '') is not null then
      if nullif(v_row->>'item_id', '') is not null then
        raise exception 'บรรทัดสูตรอ้างได้ทั้งขวดหรือช่องเหล้าประจำบ้านอย่างใดอย่างหนึ่ง';
      end if;
      if not exists (select 1 from bar_house_slot
                      where tenant_id = v_tenant and entity_id = p_entity and slot_id = v_row->>'slot_id') then
        raise exception 'ไม่พบช่องเหล้าประจำบ้านในสูตร (อาจถูกลบจากอีกเครื่อง) — รีเฟรชหน้าแล้วลองใหม่';
      end if;
      insert into bar_recipe_slot(tenant_id, entity_id, menu_id, slot_id, qty)
      values (v_tenant, p_entity, v_id, v_row->>'slot_id', (v_row->>'qty')::numeric);
    else
      insert into bar_recipe(tenant_id, entity_id, menu_id, item_id, qty)
      values (v_tenant, p_entity, v_id, v_row->>'item_id', (v_row->>'qty')::numeric);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'menu_id', v_id);
end $fn$;

-- ── 9. บันทึกชุดตกแต่งทั้งชุด ──
-- ยก fn_bar_save_garnishes จาก 20261024000090_bar_house_spirit.sql
create or replace function fn_bar_save_garnishes(p_entity text, p_rows jsonb)
returns jsonb
language plpgsql set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.config');
  v_row jsonb;
  v_i int := 0;
  v_id text;
  v_name text;
  v_item text;
  v_qty numeric;
  v_keep text[] := '{}';
  v_qty_text text;
  v_unit text;
  v_g record;
  v_used int;
  v_names text;
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if nullif(v_row->>'garnish_id', '') is not null then v_keep := v_keep || (v_row->>'garnish_id'); end if;
  end loop;
  -- D131: สูตรอ้างชุดได้แล้ว ⇒ ลบชุดที่มีเมนูอ้าง = บล็อก + บอกรายชื่อเมนู (แบบเดียวกับช่องเหล้าประจำบ้าน)
  for v_g in
    select garnish_id, name from bar_garnish
     where tenant_id = v_tenant and entity_id = p_entity and not (garnish_id = any(v_keep))
  loop
    select count(*), string_agg(m.name, ' · ' order by m.name) into v_used, v_names
      from bar_recipe_garnish rg
      join bar_menu m on m.tenant_id = rg.tenant_id and m.entity_id = rg.entity_id and m.menu_id = rg.menu_id
     where rg.tenant_id = v_tenant and rg.entity_id = p_entity and rg.garnish_id = v_g.garnish_id;
    if v_used > 0 then
      raise exception 'ลบชุดตกแต่ง % ไม่ได้ — ใช้อยู่ในสูตร % เมนู: % — เอาออกจากสูตรก่อนถึงจะลบได้',
        v_g.name, v_used, v_names;
    end if;
    delete from bar_garnish
     where tenant_id = v_tenant and entity_id = p_entity and garnish_id = v_g.garnish_id;
  end loop;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_i := v_i + 1;
    v_name := btrim(coalesce(v_row->>'name', ''));
    v_item := nullif(v_row->>'item_id', '');
    v_qty := (v_row->>'qty')::numeric;
    v_id := nullif(v_row->>'garnish_id', '');
    if v_name = '' then raise exception 'แถว %: ตั้งชื่อชุดตกแต่งก่อน', v_i; end if;
    v_qty_text := nullif(btrim(coalesce(v_row->>'qty_text', '')), '');
    if v_item is null then
      -- D131: ชุดที่ไม่ตัดสต็อก (ผู้ใช้เลือก) — ไม่มีวัตถุดิบ = ไม่มีจำนวน
      v_qty := null;
      v_qty_text := null;
    else
      select unit into v_unit from bar_item
       where tenant_id = v_tenant and entity_id = p_entity and item_id = v_item;
      if not found then
        raise exception 'แถว % (%): ไม่พบวัตถุดิบ (อาจถูกลบจากอีกเครื่อง) — รีเฟรชหน้าแล้วลองใหม่', v_i, v_name;
      end if;
      if v_qty is null or v_qty <= 0 then
        raise exception 'แถว % (%): ใส่จำนวนต่อครั้งมากกว่า 0', v_i, v_name;
      end if;
      -- 🚨 จำนวนต้องพิมพ์สำหรับหน่วยของวัตถุดิบนี้ — เปลี่ยนเป็นวัตถุดิบหน่วยอื่นแล้ว "1" เดิมเปลี่ยนความหมาย
      --    (หน้าจอล้างช่องให้แล้ว · ตรงนี้กันจอที่ค้างไว้รุ่นเก่า)
      if (v_row->>'qty_unit') is distinct from v_unit then
        raise exception 'แถว % (%): วัตถุดิบใช้หน่วย % — ใส่จำนวนต่อครั้งใหม่ก่อนบันทึก', v_i, v_name, v_unit;
      end if;
    end if;

    if v_id is null then
      insert into bar_garnish(tenant_id, entity_id, garnish_id, name, item_id, qty, qty_text, sort)
      values (v_tenant, p_entity, 'GN-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
              v_name, v_item, v_qty, v_qty_text, v_i - 1);
    else
      if not exists (select 1 from bar_garnish
                      where tenant_id = v_tenant and entity_id = p_entity and garnish_id = v_id) then
        raise exception 'ชุดตกแต่ง % ถูกลบจากอีกเครื่องไปแล้ว — รีเฟรชหน้าแล้วลองใหม่', v_name;
      end if;
      update bar_garnish set name = v_name, item_id = v_item, qty = v_qty, qty_text = v_qty_text, sort = v_i - 1
       where tenant_id = v_tenant and entity_id = p_entity and garnish_id = v_id
         and (name, item_id, qty, qty_text, sort) is distinct from (v_name, v_item, v_qty, v_qty_text, v_i - 1);
    end if;
  end loop;

  if exists (select 1 from bar_garnish where tenant_id = v_tenant and entity_id = p_entity
              group by lower(btrim(name)) having count(*) > 1) then
    raise exception 'มีชื่อชุดตกแต่งซ้ำกัน — ตั้งชื่อไม่ให้ซ้ำ';
  end if;
  return jsonb_build_object('ok', true, 'count', v_i);
end $fn$;

-- ── 10. ห้องทดลอง: ชงรอบใหม่ (+ชุดตกแต่ง) ──
-- ยก fn_bar_lab_round จาก 20261025000091_bar_lab.sql
create or replace function fn_bar_lab_round(
  p_entity text, p_recipe_id text, p_name text, p_glasses numeric,
  p_lines jsonb, p_note text, p_business_date date
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_recipe text := nullif(trim(coalesce(p_recipe_id, '')), '');
  v_status text;
  v_round int;
  v_use text;
  v_row jsonb;                              -- 🪤 ห้ามชื่อชนกับ alias ของ jsonb_array_elements (D79)
  v_i int := 0;
  v_total numeric := 0;
  v_label text;
begin
  if coalesce(p_glasses, 0) <= 0 then raise exception 'จำนวนแก้วต้องมากกว่า 0'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'ใส่สูตรอย่างน้อย 1 บรรทัดก่อนกดชง';
  end if;
  perform bar_lab_ensure_categories(v_tenant, p_entity);

  if v_recipe is null then
    if btrim(coalesce(p_name, '')) = '' then raise exception 'ตั้งชื่อสูตรก่อน (ชื่อชั่วคราวก็ได้)'; end if;
    v_recipe := bar_lab_next_id('LR', p_entity);
    insert into bar_lab_recipe(tenant_id, entity_id, recipe_id, name)
    values (v_tenant, p_entity, v_recipe, btrim(p_name));
  else
    select status into v_status from bar_lab_recipe
     where tenant_id = v_tenant and entity_id = p_entity and recipe_id = v_recipe for update;
    if not found then raise exception 'ไม่พบสูตรนี้ (อาจถูกลบจากอีกเครื่อง) — รีเฟรชหน้าแล้วลองใหม่'; end if;
    if v_status = 'เลิกลอง' then
      raise exception 'สูตรนี้เลิกลองไปแล้ว — กด กลับมาลองต่อ ที่การ์ดสูตรก่อน';
    end if;
  end if;

  select coalesce(max(round_no), 0) + 1 into v_round from bar_lab_use
   where tenant_id = v_tenant and entity_id = p_entity and recipe_id = v_recipe;
  v_use := bar_lab_next_id('LB', p_entity);
  select name into v_label from bar_lab_recipe
   where tenant_id = v_tenant and entity_id = p_entity and recipe_id = v_recipe;

  insert into bar_lab_use(tenant_id, entity_id, use_id, business_date, category_id, recipe_id, round_no, glasses, note)
  values (v_tenant, p_entity, v_use, p_business_date, 'trial', v_recipe, v_round, p_glasses,
          nullif(btrim(coalesce(p_note, '')), ''));

  for v_row in select * from jsonb_array_elements(p_lines) loop
    v_i := v_i + 1;
    if nullif(v_row->>'garnish_id', '') is not null then
      -- D131: ชุดตกแต่ง → วัตถุดิบของชุด ณ ตอนชง (ไม่ตัดสต็อก = บรรทัดทุน 0)
      v_total := v_total + bar_lab_cut_garnish(
        v_tenant, p_entity, v_use, v_i, v_row->>'garnish_id',
        (v_row->>'qty')::numeric, p_glasses, v_label || ' รอบ ' || v_round);
    else
      v_total := v_total + bar_lab_cut_line(
        v_tenant, p_entity, v_use, v_i, 'สูตร',
        nullif(v_row->>'item_id', ''), nullif(v_row->>'slot_id', ''),
        (v_row->>'qty')::numeric, p_glasses, v_label || ' รอบ ' || v_round);
    end if;
  end loop;

  update bar_lab_use set cost_total = round(v_total, 2)
   where tenant_id = v_tenant and entity_id = p_entity and use_id = v_use;
  return jsonb_build_object('ok', true, 'recipe_id', v_recipe, 'use_id', v_use, 'round_no', v_round,
                            'cost', round(v_total, 2));
end $fn$;

-- ── 11. ห้องทดลอง: บันทึกการใช้ (สูตรทดลองรวมชุดตกแต่ง) ──
-- ยก fn_bar_lab_use จาก 20261025000091_bar_lab.sql
create or replace function fn_bar_lab_use(
  p_entity text, p_category_id text, p_event text, p_note text,
  p_menus jsonb, p_recipes jsonb, p_items jsonb, p_business_date date
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_use text;
  v_row jsonb;
  v_rec record;
  v_menu bar_menu%rowtype;
  v_i int := 0;
  v_total numeric := 0;
  v_qty numeric;
  v_cost numeric;
  v_last text;
  v_rname text;
  v_item text;
  v_per numeric;
  v_note text := coalesce(nullif(btrim(coalesce(p_event, '')), ''), 'ห้องทดลอง');
begin
  perform bar_lab_ensure_categories(v_tenant, p_entity);
  if not exists (select 1 from bar_lab_category
                  where tenant_id = v_tenant and entity_id = p_entity and category_id = p_category_id) then
    raise exception 'ไม่พบหมวดนี้ (อาจถูกลบจากอีกเครื่อง) — รีเฟรชหน้าแล้วลองใหม่';
  end if;
  if jsonb_array_length(coalesce(p_menus, '[]')) + jsonb_array_length(coalesce(p_recipes, '[]'))
     + jsonb_array_length(coalesce(p_items, '[]')) = 0 then
    raise exception 'ยังไม่ได้เลือกเมนูหรือวัตถุดิบ';
  end if;

  v_use := bar_lab_next_id('LB', p_entity);
  insert into bar_lab_use(tenant_id, entity_id, use_id, business_date, category_id, event_name, note)
  values (v_tenant, p_entity, v_use, p_business_date, p_category_id,
          nullif(btrim(coalesce(p_event, '')), ''), nullif(btrim(coalesce(p_note, '')), ''));

  -- เมนูที่ขายอยู่ — ทุน/ตัดสต็อกตามสูตร ณ ตอนนี้ (bar_menu_lines · แปลงช่อง House แล้ว · D127)
  for v_row in select * from jsonb_array_elements(coalesce(p_menus, '[]')) loop
    v_i := v_i + 1;
    v_qty := (v_row->>'qty')::numeric;
    if coalesce(v_qty, 0) <= 0 then raise exception 'บรรทัดที่ %: จำนวนต้องมากกว่า 0', v_i; end if;
    select * into v_menu from bar_menu
     where tenant_id = v_tenant and entity_id = p_entity and menu_id = v_row->>'menu_id';
    if not found then raise exception 'บรรทัดที่ %: ไม่พบเมนู — รีเฟรชหน้าแล้วลองใหม่', v_i; end if;
    v_cost := 0;
    if bar_menu_has_recipe(v_tenant, p_entity, v_menu.menu_id) then   -- D131 (ตรงกับ fn_bar_add_lines)
      select coalesce(sum(r.qty * i.cost_per_unit), 0) into v_cost
        from bar_menu_lines(v_tenant, p_entity, v_menu.menu_id) r
        join bar_item i on i.tenant_id = v_tenant and i.entity_id = p_entity and i.item_id = r.item_id;
      for v_rec in select r.item_id, r.qty from bar_menu_lines(v_tenant, p_entity, v_menu.menu_id) r loop
        perform bar_apply_move(v_tenant, p_entity, v_rec.item_id, -(v_rec.qty * v_qty), 'ห้องทดลอง', v_use, v_note);
      end loop;
    else
      v_cost := coalesce(v_menu.fixed_cost, 0);   -- ต้นทุนตายตัว: ไม่ตัดสต็อก (กติกาเดียวกับตอนขาย)
    end if;
    v_cost := round(v_cost * v_qty, 2);
    insert into bar_lab_use_line(tenant_id, entity_id, use_id, line_no, kind, menu_id, label, qty, cost)
    values (v_tenant, p_entity, v_use, v_i, 'เมนู', v_menu.menu_id, v_menu.name, v_qty, v_cost);
    v_total := v_total + v_cost;
  end loop;

  -- สูตรทดลอง — ใช้สูตรของรอบล่าสุด (บรรทัดช่อง House แปลงเป็นขวด ณ ตอนนี้)
  for v_row in select * from jsonb_array_elements(coalesce(p_recipes, '[]')) loop
    v_i := v_i + 1;
    v_qty := (v_row->>'qty')::numeric;
    if coalesce(v_qty, 0) <= 0 then raise exception 'บรรทัดที่ %: จำนวนต้องมากกว่า 0', v_i; end if;
    select r.name into v_rname from bar_lab_recipe r
     where r.tenant_id = v_tenant and r.entity_id = p_entity and r.recipe_id = v_row->>'recipe_id';
    if not found then raise exception 'บรรทัดที่ %: ไม่พบสูตรทดลอง — รีเฟรชหน้าแล้วลองใหม่', v_i; end if;
    select u.use_id into v_last from bar_lab_use u
     where u.tenant_id = v_tenant and u.entity_id = p_entity and u.recipe_id = v_row->>'recipe_id'
     order by u.round_no desc limit 1;
    if v_last is null then raise exception 'บรรทัดที่ %: สูตร % ยังไม่มีรอบที่ชง', v_i, v_rname; end if;
    v_cost := 0;
    for v_rec in
      select l.kind, l.item_id, l.slot_id, l.garnish_id, l.garnish_qty, l.qty from bar_lab_use_line l
       where l.tenant_id = v_tenant and l.entity_id = p_entity and l.use_id = v_last
         and l.kind in ('สูตร', 'ชุดตกแต่ง')
       order by l.line_no
    loop
      if v_rec.kind = 'ชุดตกแต่ง' then
        -- D131: ชุดตกแต่ง → วัตถุดิบ × ปริมาณต่อชุด **ณ ตอนนี้** · ชุดถูกลบไปแล้ว → ค่าที่จำไว้ตอนชงรอบนั้น
        if exists (select 1 from bar_garnish g
                    where g.tenant_id = v_tenant and g.entity_id = p_entity and g.garnish_id = v_rec.garnish_id) then
          select g.item_id, g.qty into v_item, v_per from bar_garnish g
           where g.tenant_id = v_tenant and g.entity_id = p_entity and g.garnish_id = v_rec.garnish_id;
        else
          v_item := v_rec.item_id;
          v_per := v_rec.garnish_qty;
        end if;
        continue when v_item is null or v_per is null;     -- ชุดที่ไม่ตัดสต็อก
        v_cost := v_cost + coalesce((select i.cost_per_unit from bar_item i
                                      where i.tenant_id = v_tenant and i.entity_id = p_entity
                                        and i.item_id = v_item), 0) * v_rec.qty * v_per * v_qty;
        perform bar_apply_move(v_tenant, p_entity, v_item, -(v_rec.qty * v_per * v_qty), 'ห้องทดลอง', v_use, v_note);
        continue;
      end if;
      -- ช่อง House → ขวดที่ช่องชี้ตอนนี้ · ช่องถูกลบไปแล้ว → ขวดที่ตัดในรอบนั้น
      v_item := coalesce((select s.item_id from bar_house_slot s
                           where s.tenant_id = v_tenant and s.entity_id = p_entity and s.slot_id = v_rec.slot_id),
                         v_rec.item_id);
      -- 🪤 ใช้ subquery + coalesce ไม่ใช้ SELECT INTO — ไม่เจอแถว = SELECT INTO เขียน NULL ทับยอดสะสม
      v_cost := v_cost + coalesce((select i.cost_per_unit from bar_item i
                                    where i.tenant_id = v_tenant and i.entity_id = p_entity
                                      and i.item_id = v_item), 0) * v_rec.qty * v_qty;
      perform bar_apply_move(v_tenant, p_entity, v_item, -(v_rec.qty * v_qty), 'ห้องทดลอง', v_use, v_note);
    end loop;
    v_cost := round(v_cost, 2);
    insert into bar_lab_use_line(tenant_id, entity_id, use_id, line_no, kind, lab_recipe_id, label, qty, cost)
    values (v_tenant, p_entity, v_use, v_i, 'สูตรทดลอง', v_row->>'recipe_id', v_rname, v_qty, v_cost);
    v_total := v_total + v_cost;
  end loop;

  -- วัตถุดิบเดี่ยว (เทจินเปล่าถ่ายขวด · มะนาวจัดฉาก)
  for v_row in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    v_i := v_i + 1;
    v_total := v_total + bar_lab_cut_line(v_tenant, p_entity, v_use, v_i, 'วัตถุดิบ',
      nullif(v_row->>'item_id', ''), null, (v_row->>'qty')::numeric, 1, v_note);
  end loop;

  update bar_lab_use set cost_total = round(v_total, 2)
   where tenant_id = v_tenant and entity_id = p_entity and use_id = v_use;
  return jsonb_build_object('ok', true, 'use_id', v_use, 'cost', round(v_total, 2));
end $fn$;

-- ── 12. ลบข้อมูลทั้ง tenant ──
-- ยก fn_mig_truncate จาก 20261025000092_bar_prep.sql
create or replace function fn_mig_truncate(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  t text;
  -- เรียงตามลำดับ FK (ลูกก่อนแม่) เพราะ delete ไม่ cascade เองเหมือน truncate
  tables text[] := array[
    'transaction_items','transactions','tax_summaries','tax_payments','tax_filings','wht_certificates',
    'log_material','log_ferment','log_distill','log_distill_run',
    'log_ferment_monitor','log_dilute','log_ferment_draw','log_product','stock_product',
    -- ★ D94 — กลั่นซ้ำ: รอบมี FK ไปล็อต · ล็อตมี entity_id FK
    'log_redistill_round','log_redistill',
    'sales_order_items','sales_orders','warehouse_stock','stock_moves','sale_menu',
    -- ★ D96 — บาร์/POS · ลูกก่อนแม่:
    --   sale_item→sale · fav→customer,menu · recipe→menu,item · menu→category,customer
    --   receive/move→item · sale→customer
    -- ★ D129 — ห้องทดลอง: บรรทัด → รายการ → สูตร/หมวด (ลูกก่อนแม่ · หมวด FK ไป entities)
    'bar_lab_use_line','bar_lab_use','bar_lab_recipe','bar_lab_category',
    -- ★ D130 — ของทำเอง: บรรทัดล็อต → ล็อต → วัตถุดิบในสูตร → ของทำเอง (ทั้งหมดก่อน bar_item)
    'bar_prep_batch_line','bar_prep_batch','bar_prep_input','bar_prep',
    'bar_sale_item','bar_sale','bar_post','bar_move','bar_receive',
    'bar_customer_fav','bar_recipe',
    -- ★ D127 — recipe_slot → house_slot → item · garnish → item (ลูกก่อนแม่)
    -- ★ D131 — บรรทัดสูตรที่อ้างชุดตกแต่ง ต้องมาก่อน bar_garnish (FK restrict)
    'bar_recipe_garnish',
    'bar_recipe_slot','bar_house_slot','bar_garnish',
    'bar_menu','bar_category','bar_customer','bar_item',
    -- เงินเดือน (0040 + 0042) — ต้องมาก่อน entities ไม่งั้นติด FK
    'payroll_items','payroll_periods','employees',
    'pay_components','pay_inputs','pay_rates','pay_variables','pay_post_legs',
    'contacts','bank_accounts',
    'materials','containers','products',
    -- ★ report_runs มี entity_id FK → ต้องมาก่อน entities ด้วย (0050)
    'report_runs',
    -- ★ D91 — excise_month_close มี entity_id FK → ต้องมาก่อน entities ด้วย
    'excise_month_close',
    -- ★ D100 — doc_numbering มี entity_id FK → ต้องมาก่อน entities ด้วย
    'doc_numbering',
    'entities',
    'app_settings','integration_log','edit_log','counters'
  ];
begin
  if p_tenant is null then
    raise exception 'fn_mig_truncate: ต้องระบุ tenant — ห้ามล้างข้ามลูกค้า';
  end if;
  foreach t in array tables loop
    execute format('delete from %I where tenant_id = $1', t) using p_tenant;
  end loop;
end $fn$;

-- 🚨 D99: fn_mig_truncate ถูกนิยามใหม่ในไฟล์นี้ → revoke ซ้ำ
revoke execute on function fn_mig_truncate(uuid) from public, anon, authenticated;
grant  execute on function fn_mig_truncate(uuid) to service_role;

notify pgrst, 'reload schema';
