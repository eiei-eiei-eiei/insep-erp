-- ─────────────────────────────────────────────────────────────────────────────
-- 0090 — บาร์: เหล้าประจำบ้าน · ชุดตกแต่ง · วัตถุดิบใช้บ่อย (D127)
--
-- 🎯 ผู้ใช้ขอ 3 อย่างที่แตะหน้าสร้างเมนู/สูตร:
--   1. ช่องเหล้าประจำบ้าน (House Gin / House Vodka …) ชี้ขวด 1 ตัว · สูตรอ้างช่องแทนขวดยี่ห้อ
--      ตอน "สั่ง" แปลงช่อง → ขวดที่ตั้งไว้ ณ ตอนนั้น ทั้งตัดสต็อกและคิดต้นทุน · บิลเก่าไม่ขยับ
--   2. ชุดตกแต่ง (ชื่อ → วัตถุดิบ + จำนวนต่อครั้ง) — กดแล้วบวกเข้าบรรทัดของวัตถุดิบนั้น (ฝั่งจอล้วน)
--   3. วัตถุดิบใช้บ่อย (ปักหมุดเอง จัดลำดับเอง) — `bar_item.pin_sort`
--
-- ── ตัดสินแล้ว (ผู้ใช้เลือก 2026-10-24) ──────────────────────────────────────
-- · ช่อง **ต้องมีขวดตั้งแต่สร้าง** (`item_id not null`) ⇒ ไม่มีสถานะช่องว่างที่ขายแล้วต้นทุน 0 เงียบ ๆ
-- · ลบช่องที่มีสูตรอ้าง = บล็อก + บอกรายชื่อเมนู (FK restrict กันซ้ำอีกชั้น)
-- · ขวดหมด = ปล่อยติดลบ **ห้ามสลับขวดเอง** — ไม่มีตรรกะหาขวดสำรองที่ไหนเลย
--
-- ── 🚨 จุดที่ไม่ได้อยู่ในโจทย์แต่ต้องกัน ────────────────────────────────────
-- (1) **หน่วยของช่อง**: "House Gin 45" เขียนตอนขวดเป็น ml · เปลี่ยนเป็นขวดที่ตั้งหน่วยเป็น "ขวด"
--     = ตัด 45 ขวดต่อแก้วโดยไม่มีอะไรฟ้อง (อาการเดียวกับ D104) → trigger `bar_house_slot_unit_guard`
-- (2) **ยกเลิกรายการ/บิล เดิมคืนสต็อกตาม "สูตรปัจจุบัน"** ไม่ใช่ตามที่ตัดไปจริง
--     ⇒ เปลี่ยนขวดในช่องแล้วยกเลิกบิลเก่า = ของถูกคืนเข้าขวดใหม่ผิดยี่ห้อ (= บิลเก่าขยับ)
--     → `bar_move.ref_line` ผูกการตัดกับบรรทัดบิล · `bar_sale_item.moves_linked` บอกว่าบรรทัดนี้ผูกแล้ว
--       บรรทัดที่ผูกแล้ว คืนตาม bar_move จริง · บรรทัดก่อน 0090 คืนตามสูตรแบบเดิม (ไม่ขยับพฤติกรรมเก่า)
--
-- ★ แยกบรรทัดที่อ้างช่องไว้ตารางของตัวเอง (`bar_recipe_slot`) **ไม่ผ่าตัด PK ของ `bar_recipe`**
--   ⇒ สูตรเดิมทุกเมนูทำงานเหมือนเดิมเป๊ะ · ตัวรวมสองตารางมีที่เดียวคือ `bar_menu_lines()`
-- ⛓ ไม่แตะตารางฝั่งผลิต/ขายแม้แถวเดียว (lib/bar/isolation.test.ts)
--
-- 🚨 ฟังก์ชันเดิม 5 ตัวยกมาด้วย scripts/gen/gen-0090.mjs ไม่ได้พิมพ์ใหม่ (D79)
-- 🚨 create table ต้อง grant ในไฟล์เดียวกัน (D118)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. คอลัมน์ใหม่ ───────────────────────────────────────────────────────────
alter table bar_item      add column if not exists pin_sort     integer;
alter table bar_move      add column if not exists ref_line     integer;
alter table bar_sale_item add column if not exists moves_linked boolean not null default false;

comment on column bar_item.pin_sort is
  'ลำดับในแถบปุ่มลัด "ใช้บ่อย" ของหน้าสร้างเมนู · null = ไม่ได้ปักหมุด (D127)';
comment on column bar_move.ref_line is
  'บรรทัดบิล (bar_sale_item.line_no) ที่การตัดสต็อกนี้เป็นของ — ยกเลิกทีหลังคืนเข้าขวดที่ตัดจริง (D127)';
comment on column bar_sale_item.moves_linked is
  'true = การตัดสต็อกของบรรทัดนี้ผูก bar_move.ref_line ไว้แล้ว (ตั้งแต่ 0090) · false = บรรทัดเก่า คืนตามสูตรปัจจุบัน';

-- ── 2. ตารางใหม่ ─────────────────────────────────────────────────────────────
create table bar_house_slot (
  tenant_id uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id text not null,
  slot_id   text not null,
  name      text not null,
  item_id   text not null,                        -- 🚨 ว่างไม่ได้ (ผู้ใช้เลือก)
  sort      integer not null default 0,
  primary key (tenant_id, entity_id, slot_id),
  foreign key (tenant_id, entity_id) references entities (tenant_id, entity_id),
  foreign key (tenant_id, entity_id, item_id)
    references bar_item (tenant_id, entity_id, item_id) on delete restrict,
  constraint bar_house_slot_name_nonblank check (btrim(name) <> '')
);

create table bar_recipe_slot (
  tenant_id uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id text not null,
  menu_id   text not null,
  slot_id   text not null,
  qty       numeric not null,                     -- หน่วยฐานของขวดที่ช่องชี้ (ล็อกด้วย trigger ข้างล่าง)
  primary key (tenant_id, entity_id, menu_id, slot_id),
  foreign key (tenant_id, entity_id, menu_id)
    references bar_menu (tenant_id, entity_id, menu_id) on delete cascade,
  foreign key (tenant_id, entity_id, slot_id)
    references bar_house_slot (tenant_id, entity_id, slot_id) on delete restrict,
  constraint bar_recipe_slot_qty_pos check (qty > 0)
);

create table bar_garnish (
  tenant_id  uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id  text not null,
  garnish_id text not null,
  name       text not null,
  item_id    text not null,                       -- 🚨 ต้องผูกวัตถุดิบเสมอ (ผู้ใช้เลือก — ชุดที่ไม่ตัดอะไรไม่ต้องมี)
  qty        numeric not null,
  sort       integer not null default 0,
  primary key (tenant_id, entity_id, garnish_id),
  foreign key (tenant_id, entity_id) references entities (tenant_id, entity_id),
  foreign key (tenant_id, entity_id, item_id)
    references bar_item (tenant_id, entity_id, item_id) on delete restrict,
  constraint bar_garnish_qty_pos check (qty > 0),
  constraint bar_garnish_name_nonblank check (btrim(name) <> '')
);

-- 🚨 ทุก index ขึ้นต้นด้วย tenant_id (NEXT_STEPS 4.8)
create index bar_house_slot_te_idx   on bar_house_slot  (tenant_id, entity_id, sort);
create index bar_house_slot_item_idx on bar_house_slot  (tenant_id, entity_id, item_id);
create index bar_recipe_slot_idx     on bar_recipe_slot (tenant_id, entity_id, slot_id);
create index bar_garnish_te_idx      on bar_garnish     (tenant_id, entity_id, sort);
create index bar_move_ref_line_idx   on bar_move        (tenant_id, entity_id, ref_no, ref_line);

-- ── 3. RLS ───────────────────────────────────────────────────────────────────
-- · ช่อง/ชุดตกแต่ง = ค่าตั้ง → เขียนต้องมี `bar.config` (เปลี่ยนขวดในช่องกระทบต้นทุนทุกเมนู)
-- · บรรทัดสูตรที่อ้างช่อง = เท่ากับ `bar_recipe` → `bar.write` (พนักงานบาร์สร้างเมนูจากหน้าขายได้)
-- 🪤 D85/0052: `for all` ครอบ SELECT ด้วย และ OR กับ policy อ่าน — ปลอดภัยเพราะขอบเขตแถวเดียวกัน
--    และคนที่มี bar.config/bar.write มี bar.read เสมอ (roles.test.ts บังคับ invariant)
alter table bar_house_slot  enable row level security;
alter table bar_recipe_slot enable row level security;
alter table bar_garnish     enable row level security;

create policy bar_house_slot_sel on bar_house_slot for select
  using (tenant_id = my_tenant() and has_cap('bar.read'));
create policy bar_house_slot_w on bar_house_slot for all
  using (tenant_id = my_tenant() and has_cap('bar.config'))
  with check (tenant_id = my_tenant() and has_cap('bar.config'));

create policy bar_garnish_sel on bar_garnish for select
  using (tenant_id = my_tenant() and has_cap('bar.read'));
create policy bar_garnish_w on bar_garnish for all
  using (tenant_id = my_tenant() and has_cap('bar.config'))
  with check (tenant_id = my_tenant() and has_cap('bar.config'));

create policy bar_recipe_slot_sel on bar_recipe_slot for select
  using (tenant_id = my_tenant() and has_cap('bar.read'));
create policy bar_recipe_slot_w on bar_recipe_slot for all
  using (tenant_id = my_tenant() and has_cap('bar.write'))
  with check (tenant_id = my_tenant() and has_cap('bar.write'));

-- ── 4. grant (D118 — Supabase เลิกแจกสิทธิ์ตารางใหม่ให้อัตโนมัติ) ──────────────
grant select, insert, update, delete on table public.bar_house_slot  to authenticated, service_role;
grant select, insert, update, delete on table public.bar_recipe_slot to authenticated, service_role;
grant select, insert, update, delete on table public.bar_garnish     to authenticated, service_role;

-- ── 5. audit (กฎ D80) — เปลี่ยนขวดในช่อง = ต้นทุนทุกเมนูเปลี่ยน ต้องตอบได้ว่าใครเปลี่ยนเมื่อไร ──
create trigger audit_bar_house_slot  after insert or update or delete on bar_house_slot
  for each row execute function trg_audit('slot_id');
create trigger audit_bar_recipe_slot after insert or update or delete on bar_recipe_slot
  for each row execute function trg_audit('menu_id');
create trigger audit_bar_garnish     after insert or update or delete on bar_garnish
  for each row execute function trg_audit('garnish_id');

-- ── 6. 🚨 ช่องที่มีสูตรอ้าง เปลี่ยนเป็นขวดคนละหน่วยไม่ได้ ───────────────────
--    ด่านที่ DB (ยิง API ตรงก็ไม่รอด) · ฝั่งจอใช้ `slotItemChangeBlock()` บอกก่อนกด (golden B23)
--    ★ invoker — อ่านตารางด้วยสิทธิ์ผู้เรียก (คนที่แก้ช่องได้ต้องมี bar.config ⇒ อ่านได้อยู่แล้ว)
create or replace function bar_house_slot_unit_guard() returns trigger
language plpgsql set search_path = public as $fn$
declare
  v_old text;
  v_new text;
  v_used int;
begin
  if new.item_id is not distinct from old.item_id then return new; end if;
  select unit into v_old from bar_item
   where tenant_id = old.tenant_id and entity_id = old.entity_id and item_id = old.item_id;
  select unit into v_new from bar_item
   where tenant_id = new.tenant_id and entity_id = new.entity_id and item_id = new.item_id;
  if v_old is distinct from v_new then
    select count(*) into v_used from bar_recipe_slot
     where tenant_id = new.tenant_id and entity_id = new.entity_id and slot_id = new.slot_id;
    if v_used > 0 then
      raise exception 'ช่อง % ใช้อยู่ใน % เมนู — เปลี่ยนเป็นขวดหน่วย % ไม่ได้ (ขวดเดิมใช้หน่วย %) ปริมาณในสูตรจะเปลี่ยนความหมาย',
        new.name, v_used, coalesce(v_new, '?'), coalesce(v_old, '?');
    end if;
  end if;
  return new;
end $fn$;

create trigger bar_house_slot_unit_guard before update of item_id on bar_house_slot
  for each row execute function bar_house_slot_unit_guard();

-- ── 7. สูตรของเมนู = ขวดตรง + ช่องที่แปลงเป็นขวดแล้ว (รวมยอดต่อขวด) ──────────
--    🚨 **ที่เดียว** ที่รวมสองตาราง — fn_bar_add_lines ใช้ทั้งคิดต้นทุนและตัดสต็อก
--    ฝั่งจอมีฝาแฝดคือ `resolveRecipe()` (golden B23) ต้องแปลงแบบเดียวกันเป๊ะ
--    ★ invoker (ไม่ข้าม RLS เอง) — ถูกเรียกจาก definer ก็ทำงานด้วยสิทธิ์ของ definer ตัวนั้น
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
    ) x
   group by x.item_id
$fn$;

-- ── 8. บันทึกค่าตั้งทั้งชุด (การ์ดในแท็บตั้งค่าบาร์) — INVOKER ────────────────
--    ★ ไม่ใช่ definer: สิทธิ์จริงคือ RLS (`bar.config`) · `bar_guard` ให้ข้อความไทย + ด่านสิทธิ์กิจการ
--    ★ ทั้งชุดเป็น transaction เดียว — แถวไหนล้ม ไม่มีแถวไหนเปลี่ยน (แพตเทิร์น D103)

create or replace function fn_bar_save_house_slots(p_entity text, p_slots jsonb)
returns jsonb
language plpgsql set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.config');
  v_row jsonb;                              -- 🪤 ห้ามใช้ชื่อเดียวกับ alias ของ jsonb_array_elements (D79)
  v_i int := 0;
  v_id text;
  v_name text;
  v_item text;
  v_keep text[] := '{}';
  v_s record;
  v_used int;
  v_names text;
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb)) loop
    if nullif(v_row->>'slot_id', '') is not null then v_keep := v_keep || (v_row->>'slot_id'); end if;
  end loop;

  -- ลบช่องที่ไม่อยู่ในชุดใหม่ — มีสูตรอ้าง = บล็อก + บอกรายชื่อเมนู (ผู้ใช้เลือก)
  for v_s in
    select slot_id, name from bar_house_slot
     where tenant_id = v_tenant and entity_id = p_entity and not (slot_id = any(v_keep))
  loop
    select count(*), string_agg(m.name, ' · ' order by m.name) into v_used, v_names
      from bar_recipe_slot rs
      join bar_menu m on m.tenant_id = rs.tenant_id and m.entity_id = rs.entity_id and m.menu_id = rs.menu_id
     where rs.tenant_id = v_tenant and rs.entity_id = p_entity and rs.slot_id = v_s.slot_id;
    if v_used > 0 then
      raise exception 'ลบช่อง % ไม่ได้ — ใช้อยู่ในสูตร % เมนู: % — เอาออกจากสูตรก่อนถึงจะลบได้',
        v_s.name, v_used, v_names;
    end if;
    delete from bar_house_slot
     where tenant_id = v_tenant and entity_id = p_entity and slot_id = v_s.slot_id;
  end loop;

  for v_row in select * from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb)) loop
    v_i := v_i + 1;
    v_name := btrim(coalesce(v_row->>'name', ''));
    v_item := nullif(v_row->>'item_id', '');
    v_id := nullif(v_row->>'slot_id', '');
    if v_name = '' then raise exception 'แถว %: ตั้งชื่อช่องก่อน', v_i; end if;
    -- 🚨 ช่องว่างไม่มีอยู่จริง (ผู้ใช้เลือก) — ไม่งั้นขายแล้วต้นทุน 0 เงียบ ๆ
    if v_item is null then raise exception 'แถว % (%): เลือกขวดของช่องนี้ก่อน', v_i, v_name; end if;
    if not exists (select 1 from bar_item
                    where tenant_id = v_tenant and entity_id = p_entity and item_id = v_item) then
      raise exception 'แถว % (%): ไม่พบขวดที่เลือก (อาจถูกลบจากอีกเครื่อง) — รีเฟรชหน้าแล้วลองใหม่', v_i, v_name;
    end if;

    if v_id is null then
      insert into bar_house_slot(tenant_id, entity_id, slot_id, name, item_id, sort)
      values (v_tenant, p_entity, 'HS-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
              v_name, v_item, v_i - 1);
    else
      if not exists (select 1 from bar_house_slot
                      where tenant_id = v_tenant and entity_id = p_entity and slot_id = v_id) then
        raise exception 'ช่อง % ถูกลบจากอีกเครื่องไปแล้ว — รีเฟรชหน้าแล้วลองใหม่', v_name;
      end if;
      -- เขียนเฉพาะแถวที่เปลี่ยน — ไม่งั้นประวัติการแก้ไขรกด้วยแถวที่ไม่ได้แตะ
      update bar_house_slot set name = v_name, item_id = v_item, sort = v_i - 1
       where tenant_id = v_tenant and entity_id = p_entity and slot_id = v_id
         and (name, item_id, sort) is distinct from (v_name, v_item, v_i - 1);
    end if;
  end loop;

  if exists (select 1 from bar_house_slot where tenant_id = v_tenant and entity_id = p_entity
              group by lower(btrim(name)) having count(*) > 1) then
    raise exception 'มีชื่อช่องซ้ำกัน — ตั้งชื่อไม่ให้ซ้ำ';
  end if;
  return jsonb_build_object('ok', true, 'count', v_i);
end $fn$;

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
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if nullif(v_row->>'garnish_id', '') is not null then v_keep := v_keep || (v_row->>'garnish_id'); end if;
  end loop;
  -- ★ ชุดตกแต่งไม่มีอะไรอ้างอิง (บวกเข้าสูตรไปแล้วเป็นเลขธรรมดา) ⇒ ลบได้เสมอ
  delete from bar_garnish
   where tenant_id = v_tenant and entity_id = p_entity and not (garnish_id = any(v_keep));

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_i := v_i + 1;
    v_name := btrim(coalesce(v_row->>'name', ''));
    v_item := nullif(v_row->>'item_id', '');
    v_qty := (v_row->>'qty')::numeric;
    v_id := nullif(v_row->>'garnish_id', '');
    if v_name = '' then raise exception 'แถว %: ตั้งชื่อชุดตกแต่งก่อน', v_i; end if;
    if v_item is null or not exists (select 1 from bar_item
                    where tenant_id = v_tenant and entity_id = p_entity and item_id = v_item) then
      raise exception 'แถว % (%): เลือกวัตถุดิบก่อน', v_i, v_name;
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'แถว % (%): ใส่จำนวนต่อครั้งมากกว่า 0', v_i, v_name;
    end if;

    if v_id is null then
      insert into bar_garnish(tenant_id, entity_id, garnish_id, name, item_id, qty, sort)
      values (v_tenant, p_entity, 'GN-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
              v_name, v_item, v_qty, v_i - 1);
    else
      if not exists (select 1 from bar_garnish
                      where tenant_id = v_tenant and entity_id = p_entity and garnish_id = v_id) then
        raise exception 'ชุดตกแต่ง % ถูกลบจากอีกเครื่องไปแล้ว — รีเฟรชหน้าแล้วลองใหม่', v_name;
      end if;
      update bar_garnish set name = v_name, item_id = v_item, qty = v_qty, sort = v_i - 1
       where tenant_id = v_tenant and entity_id = p_entity and garnish_id = v_id
         and (name, item_id, qty, sort) is distinct from (v_name, v_item, v_qty, v_i - 1);
    end if;
  end loop;

  if exists (select 1 from bar_garnish where tenant_id = v_tenant and entity_id = p_entity
              group by lower(btrim(name)) having count(*) > 1) then
    raise exception 'มีชื่อชุดตกแต่งซ้ำกัน — ตั้งชื่อไม่ให้ซ้ำ';
  end if;
  return jsonb_build_object('ok', true, 'count', v_i);
end $fn$;

-- วัตถุดิบใช้บ่อย — รับลำดับ item_id ทั้งชุด · ตัวที่ไม่อยู่ในลำดับ = ถอดหมุด
create or replace function fn_bar_save_pins(p_entity text, p_items jsonb)
returns jsonb
language plpgsql set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.config');
  v_ids text[] := array(select jsonb_array_elements_text(coalesce(p_items, '[]'::jsonb)));
  v_i int;
begin
  if (select count(*) from bar_item
       where tenant_id = v_tenant and entity_id = p_entity and item_id = any(v_ids))
     <> coalesce(array_length(v_ids, 1), 0) then
    raise exception 'มีวัตถุดิบที่ถูกลบจากอีกเครื่อง (หรือเลือกซ้ำ) — รีเฟรชหน้าแล้วลองใหม่';
  end if;
  update bar_item set pin_sort = null
   where tenant_id = v_tenant and entity_id = p_entity
     and pin_sort is not null and not (item_id = any(v_ids));
  for v_i in 1 .. coalesce(array_length(v_ids, 1), 0) loop
    update bar_item set pin_sort = v_i - 1
     where tenant_id = v_tenant and entity_id = p_entity and item_id = v_ids[v_i]
       and pin_sort is distinct from v_i - 1;
  end loop;
  return jsonb_build_object('ok', true, 'count', coalesce(array_length(v_ids, 1), 0));
end $fn$;

-- ยก fn_bar_add_lines จาก 20260913000068_bar_discount_pct.sql
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
      if exists (select 1 from bar_menu_lines(v_tenant, p_entity, v_menu.menu_id)) then
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

-- ยก fn_bar_void_line จาก 20260912000065_bar_rpc.sql
create or replace function fn_bar_void_line(
  p_entity text, p_sale_no text, p_line_no int, p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_sale bar_sale%rowtype;
  v_item bar_sale_item%rowtype;
  v_rec record;
  v_sub numeric;
  v_cost numeric;
begin
  select * into v_sale from bar_sale
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no for update;
  if not found then raise exception 'ไม่พบบิล %', p_sale_no; end if;
  if v_sale.status = 'ยกเลิก' then raise exception 'บิล % ถูกยกเลิกไปแล้ว', p_sale_no; end if;

  if v_sale.rcpt_no is not null then
    raise exception 'บิลนี้ออกใบเสร็จเลขที่ % ไปแล้ว แก้รายการไม่ได้ — ต้องยกเลิกทั้งบิลแล้วออกใหม่', v_sale.rcpt_no;
  end if;
  if v_sale.business_date is not null and exists (
    select 1 from bar_post
     where tenant_id = v_tenant and entity_id = p_entity
       and post_date = v_sale.business_date and status = 'ปกติ'
  ) then
    raise exception 'ยอดวันที่ % ลงบัญชีไปแล้ว — ต้องถอนบัญชีวันนั้นก่อนจึงจะแก้รายการได้',
                    to_char(v_sale.business_date, 'DD/MM/YYYY');
  end if;

  select * into v_item from bar_sale_item
   where tenant_id = v_tenant and entity_id = p_entity
     and sale_no = p_sale_no and line_no = p_line_no for update;
  if not found then raise exception 'ไม่พบรายการที่ % ในบิล %', p_line_no, p_sale_no; end if;
  if v_item.voided_at is not null then raise exception 'รายการนี้ถูกยกเลิกไปแล้ว'; end if;

  update bar_sale_item set voided_at = now(), void_reason = p_reason
   where tenant_id = v_tenant and entity_id = p_entity
     and sale_no = p_sale_no and line_no = p_line_no;

  -- คืนสต็อก — D127: บรรทัดตั้งแต่ 0090 คืน **ตามที่ตัดไปจริง** (bar_move ของบรรทัดนี้)
  --   ไม่ใช่ตามสูตร/ขวดของช่องปัจจุบัน — เปลี่ยนขวด House Gin แล้วยกเลิกบิลเก่า ต้องคืนเข้าขวดเดิม
  if v_item.moves_linked then
    for v_rec in
      select m.item_id, -sum(m.delta) as amt
        from bar_move m
       where m.tenant_id = v_tenant and m.entity_id = p_entity
         and m.ref_no = p_sale_no and m.ref_line = p_line_no and m.reason = 'ขาย'
       group by m.item_id
    loop
      if v_rec.amt <> 0 then
        perform bar_apply_move(v_tenant, p_entity, v_rec.item_id, v_rec.amt,
                               'แก้บิล', p_sale_no, p_reason);
      end if;
    end loop;
  else
    -- บรรทัดก่อน 0090 ไม่มีร่องรอยรายบรรทัด → คืนตามสูตรของเมนูนั้นแบบเดิม (พฤติกรรมเดิมไม่ขยับ)
    for v_rec in
      select r.item_id, r.qty from bar_recipe r
       where r.tenant_id = v_tenant and r.entity_id = p_entity and r.menu_id = v_item.menu_id
    loop
      perform bar_apply_move(v_tenant, p_entity, v_rec.item_id, v_rec.qty * v_item.qty,
                             'แก้บิล', p_sale_no, p_reason);
    end loop;
  end if;

  -- 🚨 ยอดบิลต้องถูกเขียนทับใหม่จากแถวที่ยังอยู่ ไม่ใช่ปล่อยยอดเดิมค้าง
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

-- ยก fn_bar_void_sale จาก 20260913000067_bar_void_and_labels.sql
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

  -- คืนสต็อก — D127: บรรทัดตั้งแต่ 0090 คืน **ตามที่ตัดไปจริง** (bar_move ของบรรทัดนั้น)
  for v_rec in
    select m.item_id, -sum(m.delta) as amt
      from bar_move m
      join bar_sale_item si on si.tenant_id = m.tenant_id and si.entity_id = m.entity_id
                           and si.sale_no = m.ref_no and si.line_no = m.ref_line
     where m.tenant_id = v_tenant and m.entity_id = p_entity and m.ref_no = p_sale_no
       and m.reason = 'ขาย' and si.voided_at is null and si.moves_linked
     group by m.item_id
  loop
    if v_rec.amt <> 0 then
      perform bar_apply_move(v_tenant, p_entity, v_rec.item_id, v_rec.amt,
                             'ยกเลิกบิล', p_sale_no, p_reason);
    end if;
  end loop;

  -- คืนสต็อกของทุกแถวที่ยังไม่ถูกยกเลิก — เฉพาะบรรทัดก่อน 0090 (ไม่มีร่องรอยรายบรรทัด · คืนตามสูตรแบบเดิม)
  for v_rec in
    select r.item_id, r.qty * si.qty as amt
      from bar_sale_item si
      join bar_recipe r on r.tenant_id = si.tenant_id and r.entity_id = si.entity_id
                       and r.menu_id = si.menu_id
     where si.tenant_id = v_tenant and si.entity_id = p_entity
       and si.sale_no = p_sale_no and si.voided_at is null
       and not si.moves_linked
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

-- ยก fn_bar_save_menu จาก 20260913000067_bar_void_and_labels.sql
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
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_recipe, '[]'::jsonb)) loop
    if coalesce((v_row->>'qty')::numeric, 0) <= 0 then
      raise exception 'ปริมาณในสูตรต้องมากกว่า 0 (%)', coalesce(v_row->>'item_id', v_row->>'slot_id', '?');
    end if;
    -- D127: บรรทัดอ้าง "ช่องเหล้าประจำบ้าน" (slot_id) หรือขวดตรง (item_id) อย่างใดอย่างหนึ่ง
    if nullif(v_row->>'slot_id', '') is not null then
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

-- ยก fn_mig_truncate จาก 20260928000076_doc_numbering.sql
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
    'bar_sale_item','bar_sale','bar_post','bar_move','bar_receive',
    'bar_customer_fav','bar_recipe',
    -- ★ D127 — recipe_slot → house_slot → item · garnish → item (ลูกก่อนแม่)
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

-- 🚨 D99: fn_mig_truncate ถูกนิยามใหม่ในไฟล์นี้ → revoke ซ้ำ (from public อย่างเดียวไม่มีผลบน Supabase)
revoke execute on function fn_mig_truncate(uuid) from public, anon, authenticated;
grant  execute on function fn_mig_truncate(uuid) to service_role;

notify pgrst, 'reload schema';
