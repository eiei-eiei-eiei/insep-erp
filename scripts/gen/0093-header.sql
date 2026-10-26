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
