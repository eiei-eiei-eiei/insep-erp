-- ─────────────────────────────────────────────────────────────────────────────
-- 0091 — บาร์: ห้องทดลอง (ลองชงสูตรใหม่ · ใช้ทำคอนเทนต์) (D129)
--
-- 🎯 ผู้ใช้ขอ: ที่ลองคิดสูตรใหม่/ชงถ่ายคอนเทนต์ ต้องรู้ว่าเสียทุนไปเท่าไร
--    เดิมทำได้แค่ 2 ทาง ซึ่งไม่ดีทั้งคู่: ลงเป็นบิล "แถม" (ปนยอดขาย/ใบเสร็จ) หรือ
--    นับสต็อกเหตุผล "ชิม/เทสต์" (เก็บแค่จำนวน ไม่มีตัวเงิน ต้องคิดสูตรเอง)
--
-- ── โฟลว์ที่ตกลงกับผู้ใช้ ────────────────────────────────────────────────────
-- · **ลองชง 1 ครั้ง = บันทึกสูตร + ตัดสต็อก + แช่ทุน ทีเดียว** (ผู้ใช้แก้ดีไซน์: ไม่แยก "สร้างดราฟต์"
--   กับ "กดใช้" เป็น 2 หน้า เพราะตอนเริ่มบันทึกก็คือตอนลองชงแล้ว)
--   การ์ดสูตร (`bar_lab_recipe`) มีหลายรอบ แต่ละรอบ = 1 แถวใน `bar_lab_use` ที่ `recipe_id`/`round_no` มีค่า
-- · ใช้เมนูที่มี/วัตถุดิบเดี่ยว ทำคอนเทนต์ = `bar_lab_use` ที่ไม่มี `recipe_id`
-- · หมวดตั้งเองได้ (`bar_lab_category` · ผู้ใช้เลือกแบบ ก) · หมวด `trial` (ทดลองสูตร) เป็นของระบบ
--   รอบทดลองลงหมวดนี้เสมอ (ผู้ใช้สั่ง: ไม่ต้องเปลี่ยนหมวด "ทำเพื่อทดลองเป็นหลัก คอนเทนต์แถม")
--
-- ── 🚨 กติกา ─────────────────────────────────────────────────────────────────
-- · **แช่ทุน ณ ตอนตัด** — บรรทัดเก็บ label/หน่วย/ปริมาณ/ทุน ของตอนนั้น (บรรทัดช่อง House เก็บทั้ง slot_id
--   และขวดที่ตัดจริง) · แก้สูตรรอบใหม่/เปลี่ยนขวด/ราคาวัตถุดิบขยับ ⇒ ตัวเลขเก่าไม่ขยับ (กติกา D75)
-- · **ไม่แตะบิลขาย** — ไม่มีเลขใบเสร็จ ไม่เข้ายอดขาย **ไม่ลงบัญชี** (ซื้อวัตถุดิบเข้าบาร์ลงค่าใช้จ่ายไปแล้ว
--   ลงอีก = นับซ้ำ) · แดชบอร์ดบาร์แยกบรรทัด ไม่หักจากกำไรขั้นต้นของการขาย
-- · ⛓ ไม่แตะตารางฝั่งผลิต/ขาย
-- · **ไม่มี policy เขียน** — ทุกการเขียนผ่าน RPC definer ที่ตรวจสิทธิ์เอง (แพตเทิร์น bar_post)
--   เพราะการตัดสต็อกต้องผ่าน `bar_apply_move` ที่ปิดไว้แล้ว (0073) และกติกาสิทธิ์ลบ (ต่อคน/ต่อเวลา)
--   เขียนเป็น policy ตรง ๆ ไม่ได้
-- · ลบรายการ = คืนของตาม `bar_move` จริงของรายการนั้น (`ref_no = use_id`) ไม่ใช่ตามสูตรปัจจุบัน (D127)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. เหตุผลใหม่ใน bar_move ────────────────────────────────────────────────
--    🪤 CHECK เดิมสร้างแบบ inline (ไม่มีชื่อ) — หาชื่อจริงจาก catalog แล้วค่อย drop
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.bar_move'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%reason%'
  loop
    execute format('alter table bar_move drop constraint %I', c);
  end loop;
end $$;
alter table bar_move add constraint bar_move_reason_check
  check (reason in ('รับเข้า','ขาย','ยกเลิกบิล','แก้บิล','ปรับยอด','เสียหาย','ชิม/เทสต์','ห้องทดลอง'));

-- ── 2. ตาราง ─────────────────────────────────────────────────────────────────
create table bar_lab_category (
  tenant_id   uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id   text not null,
  category_id text not null,
  name        text not null,
  sort        integer not null default 0,
  is_system   boolean not null default false,       -- 'trial' = ทดลองสูตร (ลบไม่ได้)
  primary key (tenant_id, entity_id, category_id),
  foreign key (tenant_id, entity_id) references entities (tenant_id, entity_id),
  constraint bar_lab_category_name_nonblank check (btrim(name) <> '')
);

create table bar_lab_recipe (
  tenant_id  uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id  text not null,
  recipe_id  text not null,
  name       text not null,
  status     text not null default 'กำลังลอง'
    check (status in ('กำลังลอง', 'ขึ้นเมนูแล้ว', 'เลิกลอง')),
  menu_id    text,                                   -- เมนูที่ส่งขึ้นขาย (ป้ายบอกทาง ไม่ใช่ FK — ลบเมนูแล้วประวัติต้องอยู่)
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (tenant_id, entity_id, recipe_id),
  foreign key (tenant_id, entity_id) references entities (tenant_id, entity_id),
  constraint bar_lab_recipe_name_nonblank check (btrim(name) <> '')
);

create table bar_lab_use (
  tenant_id     uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id     text not null,
  use_id        text not null,
  used_at       timestamptz not null default now(),
  business_date date not null,                       -- TS คิดด้วยรอบขาย (golden B6) เหมือนบิล
  category_id   text not null,
  recipe_id     text,                                -- มีค่า = รอบทดลองของสูตรนี้
  round_no      integer,
  glasses       numeric,                             -- รอบทดลอง: ชงกี่แก้ว
  event_name    text,
  note          text,
  cost_total    numeric(14,2) not null default 0,    -- 🚨 แช่ไว้ ณ ตอนตัด
  created_by    uuid default auth.uid(),
  primary key (tenant_id, entity_id, use_id),
  foreign key (tenant_id, entity_id, category_id)
    references bar_lab_category (tenant_id, entity_id, category_id) on delete restrict,
  foreign key (tenant_id, entity_id, recipe_id)
    references bar_lab_recipe (tenant_id, entity_id, recipe_id) on delete cascade,
  constraint bar_lab_use_round check ((recipe_id is null) = (round_no is null))
);
create unique index bar_lab_use_round_uq on bar_lab_use (tenant_id, entity_id, recipe_id, round_no)
  where recipe_id is not null;

create table bar_lab_use_line (
  tenant_id     uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id     text not null,
  use_id        text not null,
  line_no       integer not null,
  kind          text not null check (kind in ('สูตร', 'เมนู', 'สูตรทดลอง', 'วัตถุดิบ')),
  item_id       text,                                -- สูตร/วัตถุดิบ: ขวดที่ตัดจริง
  slot_id       text,                                -- สูตร: อ้างช่อง House (ไว้ลองรอบใหม่/ขึ้นเมนูด้วยช่องเดิม)
  menu_id       text,                                -- เมนู
  lab_recipe_id text,                                -- สูตรทดลองที่เอามาใช้ทำคอนเทนต์
  label         text not null,                       -- snapshot ชื่อ ณ ตอนตัด
  unit          text,
  qty           numeric not null,                    -- สูตร = ต่อแก้ว · เมนู/สูตรทดลอง = จำนวนแก้ว · วัตถุดิบ = หน่วยฐาน
  cost          numeric(14,2) not null default 0,    -- ทุนรวมของบรรทัด (สูตร = × จำนวนแก้วแล้ว)
  primary key (tenant_id, entity_id, use_id, line_no),
  foreign key (tenant_id, entity_id, use_id)
    references bar_lab_use (tenant_id, entity_id, use_id) on delete cascade,
  constraint bar_lab_use_line_qty_pos check (qty > 0)
);

-- 🚨 ทุก index ขึ้นต้นด้วย tenant_id
create index bar_lab_recipe_te_idx on bar_lab_recipe (tenant_id, entity_id, status);
create index bar_lab_use_te_idx    on bar_lab_use    (tenant_id, entity_id, business_date desc);
create index bar_lab_use_rec_idx   on bar_lab_use    (tenant_id, entity_id, recipe_id);

-- ── 3. RLS — อ่านด้วย bar.read · ไม่มี policy เขียน (เขียนผ่าน RPC เท่านั้น) ─────
--    ⚠️ ทุนอยู่ในคอลัมน์ — ซ่อนจากพนักงานบาร์ที่ชั้น data (ตัดตัวเลขก่อนส่ง) ไม่ใช่ RLS
--       (กรอบเดียวกับ bar_item.cost_per_unit · D96/D126)
alter table bar_lab_category enable row level security;
alter table bar_lab_recipe   enable row level security;
alter table bar_lab_use      enable row level security;
alter table bar_lab_use_line enable row level security;

create policy bar_lab_category_sel on bar_lab_category for select
  using (tenant_id = my_tenant() and has_cap('bar.read'));
create policy bar_lab_recipe_sel on bar_lab_recipe for select
  using (tenant_id = my_tenant() and has_cap('bar.read'));
create policy bar_lab_use_sel on bar_lab_use for select
  using (tenant_id = my_tenant() and has_cap('bar.read'));
create policy bar_lab_use_line_sel on bar_lab_use_line for select
  using (tenant_id = my_tenant() and has_cap('bar.read'));

-- ── 4. grant (D118) ──────────────────────────────────────────────────────────
grant select, insert, update, delete on table public.bar_lab_category to authenticated, service_role;
grant select, insert, update, delete on table public.bar_lab_recipe   to authenticated, service_role;
grant select, insert, update, delete on table public.bar_lab_use      to authenticated, service_role;
grant select, insert, update, delete on table public.bar_lab_use_line to authenticated, service_role;

-- ── 5. audit (D80) — ไม่ audit บรรทัด (เป็นรายละเอียดของรายการที่ audit อยู่แล้ว · แบบ bar_move) ──
create trigger audit_bar_lab_category after insert or update or delete on bar_lab_category
  for each row execute function trg_audit('category_id');
create trigger audit_bar_lab_recipe   after insert or update or delete on bar_lab_recipe
  for each row execute function trg_audit('recipe_id');
create trigger audit_bar_lab_use      after insert or update or delete on bar_lab_use
  for each row execute function trg_audit('use_id');

-- ── 6. ฟังก์ชันช่วย (internal · เรียกจาก RPC ข้างล่างเท่านั้น) ─────────────────

-- หมวดของระบบ — สร้างให้เองครั้งแรก (แพตเทิร์นหมวด 'custom' ของเมนู)
create or replace function bar_lab_ensure_categories(p_tenant uuid, p_entity text) returns void
language sql set search_path = public as $fn$
  insert into bar_lab_category(tenant_id, entity_id, category_id, name, sort, is_system)
  values (p_tenant, p_entity, 'trial', 'ทดลองสูตร', 0, true),
         (p_tenant, p_entity, 'content', 'ถ่ายคอนเทนต์', 1, false)
  on conflict (tenant_id, entity_id, category_id) do nothing
$fn$;
revoke execute on function bar_lab_ensure_categories(uuid, text) from public, anon, authenticated;
grant  execute on function bar_lab_ensure_categories(uuid, text) to service_role;

-- เลขรายการ/สูตร — LB0001 / LR0001 (ต่อกิจการ)
create or replace function bar_lab_next_id(p_prefix text, p_entity text) returns text
language sql set search_path = public as $fn$
  select p_prefix || lpad(next_serial(p_prefix || '-' || p_entity)::text, 4, '0')
$fn$;
revoke execute on function bar_lab_next_id(text, text) from public, anon, authenticated;
grant  execute on function bar_lab_next_id(text, text) to service_role;

/**
 * ตัดสต็อก + เขียนบรรทัด "วัตถุดิบ/สูตร" 1 บรรทัด (ทุนคิดจากต้นทุนถัวเฉลี่ย ณ ตอนนี้)
 * p_mult = จำนวนแก้ว (บรรทัดสูตร) หรือ 1 (วัตถุดิบเดี่ยว) · ★ คืนทุนที่แช่ไว้ของบรรทัด
 */
create or replace function bar_lab_cut_line(
  p_tenant uuid, p_entity text, p_use text, p_line int, p_kind text,
  p_item text, p_slot text, p_qty numeric, p_mult numeric, p_note text
) returns numeric
language plpgsql set search_path = public as $fn$
declare
  v_item text := p_item;
  v_label text;
  v_unit text;
  v_cpu numeric;
  v_cost numeric;
  v_slot_name text;
begin
  if coalesce(p_qty, 0) <= 0 then raise exception 'บรรทัดที่ %: ปริมาณต้องมากกว่า 0', p_line; end if;
  if p_slot is not null then
    select s.item_id, s.name into v_item, v_slot_name from bar_house_slot s
     where s.tenant_id = p_tenant and s.entity_id = p_entity and s.slot_id = p_slot;
    if not found then
      raise exception 'บรรทัดที่ %: ไม่พบช่องเหล้าประจำบ้าน (อาจถูกลบจากอีกเครื่อง) — รีเฟรชหน้าแล้วลองใหม่', p_line;
    end if;
  end if;
  select i.name, i.unit, i.cost_per_unit into v_label, v_unit, v_cpu from bar_item i
   where i.tenant_id = p_tenant and i.entity_id = p_entity and i.item_id = v_item;
  if not found then
    raise exception 'บรรทัดที่ %: ไม่พบวัตถุดิบ (อาจถูกลบจากอีกเครื่อง) — รีเฟรชหน้าแล้วลองใหม่', p_line;
  end if;
  v_cost := round(p_qty * p_mult * coalesce(v_cpu, 0), 2);
  insert into bar_lab_use_line(tenant_id, entity_id, use_id, line_no, kind, item_id, slot_id, label, unit, qty, cost)
  values (p_tenant, p_entity, p_use, p_line, p_kind, v_item, p_slot,
          case when p_slot is not null then v_slot_name || ' (' || v_label || ')' else v_label end,
          v_unit, p_qty, v_cost);
  -- ขวดหมด = ปล่อยติดลบ ห้ามสลับขวดเอง (D127)
  perform bar_apply_move(p_tenant, p_entity, v_item, -(p_qty * p_mult), 'ห้องทดลอง', p_use, p_note);
  return v_cost;
end $fn$;
revoke execute on function bar_lab_cut_line(uuid, text, text, int, text, text, text, numeric, numeric, text)
  from public, anon, authenticated;
grant  execute on function bar_lab_cut_line(uuid, text, text, int, text, text, text, numeric, numeric, text)
  to service_role;

-- ── 7. RPC ───────────────────────────────────────────────────────────────────

/**
 * ลองชง 1 รอบ — สูตรใหม่ (p_recipe_id ว่าง → สร้างการ์ด) หรือรอบถัดไปของสูตรเดิม
 * ★ ทั้งหมดเป็น transaction เดียว: การ์ด + รายการ + บรรทัด + ตัดสต็อก
 */
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
    v_total := v_total + bar_lab_cut_line(
      v_tenant, p_entity, v_use, v_i, 'สูตร',
      nullif(v_row->>'item_id', ''), nullif(v_row->>'slot_id', ''),
      (v_row->>'qty')::numeric, p_glasses, v_label || ' รอบ ' || v_round);
  end loop;

  update bar_lab_use set cost_total = round(v_total, 2)
   where tenant_id = v_tenant and entity_id = p_entity and use_id = v_use;
  return jsonb_build_object('ok', true, 'recipe_id', v_recipe, 'use_id', v_use, 'round_no', v_round,
                            'cost', round(v_total, 2));
end $fn$;

/**
 * ใช้เมนูที่มี / สูตรทดลอง / วัตถุดิบเดี่ยว — ถ่ายคอนเทนต์ และหมวดอื่น ๆ
 * p_menus [{menu_id, qty}] · p_recipes [{recipe_id, qty}] (ใช้สูตรรอบล่าสุด) · p_items [{item_id, qty}]
 */
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
    if exists (select 1 from bar_menu_lines(v_tenant, p_entity, v_menu.menu_id)) then
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
      select l.item_id, l.slot_id, l.qty from bar_lab_use_line l
       where l.tenant_id = v_tenant and l.entity_id = p_entity and l.use_id = v_last and l.kind = 'สูตร'
       order by l.line_no
    loop
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

/**
 * ลบรายการ (รอบทดลอง/รายการคอนเทนต์) — คืนของตามที่ตัดไปจริง (bar_move ของรายการนี้)
 * 🚨 สิทธิ์: คนที่ลงเอง ลบได้ภายใน 12 ชั่วโมง (ชงผิด/กดซ้ำ) · นอกนั้นต้อง bar.config (ลบย้อนหลัง)
 * ★ ลบรอบสุดท้ายของสูตร = ลบการ์ดสูตรด้วย (ลงผิดตั้งแต่แรก) — หน้าจอบอกก่อนกด
 */
create or replace function fn_bar_lab_delete_use(p_entity text, p_use_id text)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_use bar_lab_use%rowtype;
  v_rec record;
  v_recipe_gone boolean := false;
begin
  select * into v_use from bar_lab_use
   where tenant_id = v_tenant and entity_id = p_entity and use_id = p_use_id for update;
  if not found then raise exception 'ไม่พบรายการ % (อาจถูกลบไปแล้ว)', p_use_id; end if;
  if not (v_use.created_by = auth.uid() and v_use.used_at > now() - interval '12 hours') then
    perform bar_guard(p_entity, 'bar.config');
  end if;

  for v_rec in
    select m.item_id, -sum(m.delta) as amt from bar_move m
     where m.tenant_id = v_tenant and m.entity_id = p_entity and m.ref_no = p_use_id and m.reason = 'ห้องทดลอง'
     group by m.item_id
  loop
    if v_rec.amt <> 0 then
      perform bar_apply_move(v_tenant, p_entity, v_rec.item_id, v_rec.amt, 'ห้องทดลอง', p_use_id,
                             'ลบรายการ ' || p_use_id);
    end if;
  end loop;

  delete from bar_lab_use where tenant_id = v_tenant and entity_id = p_entity and use_id = p_use_id;

  if v_use.recipe_id is not null and not exists (
    select 1 from bar_lab_use where tenant_id = v_tenant and entity_id = p_entity and recipe_id = v_use.recipe_id
  ) then
    delete from bar_lab_recipe where tenant_id = v_tenant and entity_id = p_entity and recipe_id = v_use.recipe_id;
    v_recipe_gone := true;
  end if;
  return jsonb_build_object('ok', true, 'recipe_deleted', v_recipe_gone);
end $fn$;

/** แก้โน้ต/ชื่องานของรายการ — ชิมแล้วค่อยเขียนโน้ต (ลำดับจริง: ชงก่อน ชิมทีหลัง) */
create or replace function fn_bar_lab_update_use(p_entity text, p_use_id text, p_note text, p_event text)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v_tenant uuid := bar_guard(p_entity, 'bar.write');
begin
  update bar_lab_use set note = nullif(btrim(coalesce(p_note, '')), ''),
                         event_name = nullif(btrim(coalesce(p_event, '')), '')
   where tenant_id = v_tenant and entity_id = p_entity and use_id = p_use_id;
  if not found then raise exception 'ไม่พบรายการ % (อาจถูกลบไปแล้ว)', p_use_id; end if;
  return jsonb_build_object('ok', true);
end $fn$;

/** เปลี่ยนชื่อ/สถานะการ์ดสูตร (เลิกลอง · กลับมาลองต่อ) */
create or replace function fn_bar_lab_update_recipe(p_entity text, p_recipe_id text, p_name text, p_status text)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v_tenant uuid := bar_guard(p_entity, 'bar.write');
begin
  if btrim(coalesce(p_name, '')) = '' then raise exception 'ชื่อสูตรว่างไม่ได้'; end if;
  update bar_lab_recipe set name = btrim(p_name), status = p_status
   where tenant_id = v_tenant and entity_id = p_entity and recipe_id = p_recipe_id;
  if not found then raise exception 'ไม่พบสูตรนี้ (อาจถูกลบจากอีกเครื่อง)'; end if;
  return jsonb_build_object('ok', true);
end $fn$;

/**
 * ส่งขึ้นเมนูขาย — สร้างเมนูด้วย fn_bar_save_menu ตัวเดิม (สูตรที่ผู้ใช้เลือกรอบ/แก้แล้วบนจอ)
 * แล้วผูกการ์ดสูตรกับเมนู ★ transaction เดียว: เมนูไม่เกิด = การ์ดไม่เปลี่ยนสถานะ
 */
create or replace function fn_bar_lab_promote(p_entity text, p_recipe_id text, p_menu jsonb, p_recipe jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_res jsonb;
begin
  if not exists (select 1 from bar_lab_recipe
                  where tenant_id = v_tenant and entity_id = p_entity and recipe_id = p_recipe_id) then
    raise exception 'ไม่พบสูตรนี้ (อาจถูกลบจากอีกเครื่อง) — รีเฟรชหน้าแล้วลองใหม่';
  end if;
  v_res := fn_bar_save_menu(p_entity, p_menu, p_recipe);
  update bar_lab_recipe set status = 'ขึ้นเมนูแล้ว', menu_id = v_res->>'menu_id'
   where tenant_id = v_tenant and entity_id = p_entity and recipe_id = p_recipe_id;
  return v_res;
end $fn$;

/** เพิ่มหมวดจากหน้าบันทึก (กลางกองถ่าย ไม่ต้องเดินไปหน้าตั้งค่า) — bar.write · ชื่อซ้ำ = คืนหมวดเดิม */
create or replace function fn_bar_lab_add_category(p_entity text, p_name text)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_name text := btrim(coalesce(p_name, ''));
  v_id text;
begin
  if v_name = '' then raise exception 'ตั้งชื่อหมวดก่อน'; end if;
  perform bar_lab_ensure_categories(v_tenant, p_entity);
  select category_id into v_id from bar_lab_category
   where tenant_id = v_tenant and entity_id = p_entity and lower(btrim(name)) = lower(v_name);
  if v_id is null then
    v_id := bar_lab_next_id('LC', p_entity);
    insert into bar_lab_category(tenant_id, entity_id, category_id, name, sort)
    values (v_tenant, p_entity, v_id, v_name,
            (select coalesce(max(sort), 0) + 1 from bar_lab_category
              where tenant_id = v_tenant and entity_id = p_entity));
  end if;
  return jsonb_build_object('ok', true, 'category_id', v_id);
end $fn$;

/**
 * แก้หมวดทั้งชุด (การ์ดในตั้งค่าบาร์) — bar.config · ลำดับ = ลำดับในลิสต์ · ตัวที่หายไป = ลบ
 * 🚨 ลบหมวดระบบไม่ได้ · ลบหมวดที่มีรายการไม่ได้ (บอกจำนวน) · ชื่อซ้ำไม่ได้
 */
create or replace function fn_bar_lab_save_categories(p_entity text, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.config');
  v_row jsonb;
  v_i int := 0;
  v_keep text[] := '{}';
  v_c record;
  v_n int;
begin
  perform bar_lab_ensure_categories(v_tenant, p_entity);
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    v_keep := v_keep || (v_row->>'category_id');
  end loop;
  for v_c in
    select category_id, name, is_system from bar_lab_category
     where tenant_id = v_tenant and entity_id = p_entity and not (category_id = any(v_keep))
  loop
    if v_c.is_system then raise exception 'หมวด % เป็นหมวดของระบบ ลบไม่ได้ (เปลี่ยนชื่อได้)', v_c.name; end if;
    select count(*) into v_n from bar_lab_use
     where tenant_id = v_tenant and entity_id = p_entity and category_id = v_c.category_id;
    if v_n > 0 then raise exception 'ลบหมวด % ไม่ได้ — มีรายการอยู่ % รายการ', v_c.name, v_n; end if;
    delete from bar_lab_category
     where tenant_id = v_tenant and entity_id = p_entity and category_id = v_c.category_id;
  end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    v_i := v_i + 1;
    if btrim(coalesce(v_row->>'name', '')) = '' then raise exception 'แถว %: ชื่อหมวดว่างไม่ได้', v_i; end if;
    update bar_lab_category set name = btrim(v_row->>'name'), sort = v_i - 1
     where tenant_id = v_tenant and entity_id = p_entity and category_id = v_row->>'category_id'
       and (name, sort) is distinct from (btrim(v_row->>'name'), v_i - 1);
  end loop;
  if exists (select 1 from bar_lab_category where tenant_id = v_tenant and entity_id = p_entity
              group by lower(btrim(name)) having count(*) > 1) then
    raise exception 'มีชื่อหมวดซ้ำกัน — ตั้งชื่อไม่ให้ซ้ำ';
  end if;
  return jsonb_build_object('ok', true);
end $fn$;
