-- ─────────────────────────────────────────────────────────────────────────────
-- 0092 — บาร์: ของทำเองในร้าน (ไซรัป · infused · cordial) (D130)
--
-- 🎯 ของทำเอง = วัตถุดิบตัวหนึ่งใน `bar_item` เหมือนตัวอื่น ต่างแค่**ของเข้าสต็อกด้วยการ "ทำล็อต"** แทนการซื้อ
--    ⇒ ใช้ในสูตรเมนู/ห้องทดลอง/นับสต็อกได้ทันทีโดยไม่ต้องแก้หน้าไหนเลย
--
-- ── ตกลงกับผู้ใช้ (2026-10-25) ────────────────────────────────────────────────
-- · สูตรมาตรฐานต่อ 1 ล็อต (`bar_prep` + `bar_prep_input`) เป็นแค่**แม่แบบ** แก้ได้ตลอด — มีผลกับล็อตถัดไปเท่านั้น
-- · ทำทีละน้อยได้ (0.3 ล็อต) · **ปริมาณที่ได้จริงกรอกทุกครั้ง** (ทุนต่อหน่วยขึ้นกับตัวเลขนี้ตัวเดียว)
-- · **ไม่นับค่าแรง/ค่าแก๊ส** — นับเฉพาะวัตถุดิบ (ขวดบรรจุใส่เป็นวัตถุดิบในสูตรได้เอง)
-- · **2 ปุ่ม**: ทำเสร็จแล้ว (เข้าสต็อกเลย) · เริ่มแช่ (ตัดวัตถุดิบวันเทลงโหล — สต็อกตรงของจริงตั้งแต่วันแรก
--   แล้วค่อยกด "เสร็จแล้ว" ตอนกรอง) · ยกเลิกล็อตที่ยังแช่อยู่ได้ทุกเมื่อ (คืนวัตถุดิบเป๊ะ)
-- · ยกเลิกล็อตที่เสร็จแล้ว ได้เฉพาะเมื่อ**ยังไม่มีการเคลื่อนไหวอื่นของของทำเองตัวนั้นตามหลัง**
--   (ทุนเฉลี่ยย้อนกลับเป๊ะได้แค่กรณีนี้ — มีรับของ/ขายตามหลังแล้ว ต้องแก้ด้วยนับสต็อก)
-- · อายุของ/หมดอายุ — ยกไปรอบหน้า (พร้อมน้ำผลไม้/ซอส)
--
-- ── 🚨 กติกา ─────────────────────────────────────────────────────────────────
-- · **ทุนเฉลี่ยใช้สูตรเดียวกับตอนรับของเข้า** — ตอนเสร็จ เรียก `fn_bar_receive` ตัวเดิม
--   (ที่มาของราคา "ทำเองในร้าน" ⇒ ขึ้นในประวัติราคารับของ D126 เองโดยไม่ต้องแก้หน้าจอ)
-- · ทุนล็อต**แช่ ณ ตอนตัดวัตถุดิบ** (วันเริ่ม) — วัตถุดิบขึ้นราคาทีหลัง ล็อตไม่ขยับ (D75)
-- · ใช้ของทำเองตัวอื่นในสูตรได้ · **ใช้ตัวเองไม่ได้**
-- · ไม่มี policy เขียน — เขียนผ่าน RPC definer เท่านั้น (แพตเทิร์น 0091)
-- · ⛓ ไม่แตะตารางฝั่งผลิต/ขาย · ไม่ลงบัญชี
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. เหตุผลใหม่ใน bar_move ("ทำของ" = วัตถุดิบที่ถูกใช้ทำของทำเอง) ────────────
alter table bar_move drop constraint if exists bar_move_reason_check;
alter table bar_move add constraint bar_move_reason_check
  check (reason in ('รับเข้า','ขาย','ยกเลิกบิล','แก้บิล','ปรับยอด','เสียหาย','ชิม/เทสต์','ห้องทดลอง','ทำของ'));

-- ── 2. ตาราง ─────────────────────────────────────────────────────────────────
create table bar_prep (
  tenant_id  uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id  text not null,
  item_id    text not null,                        -- ของทำเอง (แถวใน bar_item)
  std_yield  numeric not null,                     -- 1 ล็อตมาตรฐานได้ประมาณเท่าไร (หน่วยของ item)
  note       text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, entity_id, item_id),
  foreign key (tenant_id, entity_id, item_id)
    references bar_item (tenant_id, entity_id, item_id) on delete cascade,
  constraint bar_prep_yield_pos check (std_yield > 0)
);

create table bar_prep_input (
  tenant_id     uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id     text not null,
  item_id       text not null,                     -- ของทำเอง
  input_item_id text not null,                     -- วัตถุดิบที่ใช้ (ต่อ 1 ล็อตมาตรฐาน)
  line_no       integer not null default 0,
  qty           numeric not null,
  primary key (tenant_id, entity_id, item_id, input_item_id),
  foreign key (tenant_id, entity_id, item_id)
    references bar_prep (tenant_id, entity_id, item_id) on delete cascade,
  foreign key (tenant_id, entity_id, input_item_id)
    references bar_item (tenant_id, entity_id, item_id) on delete restrict,
  constraint bar_prep_input_qty_pos check (qty > 0),
  constraint bar_prep_input_not_self check (input_item_id <> item_id)
);

create table bar_prep_batch (
  tenant_id     uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id     text not null,
  batch_id      text not null,
  item_id       text not null,
  status        text not null default 'กำลังแช่'
    check (status in ('กำลังแช่', 'เสร็จแล้ว', 'ยกเลิก')),
  multiplier    numeric not null,                  -- กี่ล็อต (0.3 · 1 · 2)
  started_at    timestamptz not null default now(),
  start_date    date not null,                     -- วันขายตอนตัดวัตถุดิบ (TS คิดด้วยรอบขาย · B6)
  finished_at   timestamptz,
  finish_date   date,
  yield_qty     numeric,                           -- ปริมาณที่ได้จริง (ใส่ตอนเสร็จ)
  cost_total    numeric(14,2) not null default 0,  -- 🚨 แช่ ณ ตอนตัดวัตถุดิบ
  receive_id    bigint,                            -- แถวใน bar_receive ตอนเสร็จ (ไว้ยกเลิกย้อนกลับ)
  prev_qty      numeric,                           -- ยอด/ทุนของของทำเองก่อนล็อตนี้เข้า (ยกเลิกแล้วคืนค่าเป๊ะ)
  prev_cpu      numeric(14,4),
  note          text,
  created_by    uuid default auth.uid(),
  primary key (tenant_id, entity_id, batch_id),
  foreign key (tenant_id, entity_id, item_id)
    references bar_item (tenant_id, entity_id, item_id) on delete restrict,
  constraint bar_prep_batch_mult_pos check (multiplier > 0),
  constraint bar_prep_batch_done check ((status = 'เสร็จแล้ว') = (yield_qty is not null and receive_id is not null)
                                        or status = 'ยกเลิก')
);

create table bar_prep_batch_line (
  tenant_id     uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id     text not null,
  batch_id      text not null,
  line_no       integer not null,
  input_item_id text not null,
  label         text not null,                     -- snapshot ชื่อ/หน่วย ณ ตอนทำ
  unit          text,
  qty           numeric not null,                  -- ที่ใช้จริงทั้งล็อต (คูณแล้ว)
  cost          numeric(14,2) not null default 0,
  primary key (tenant_id, entity_id, batch_id, line_no),
  foreign key (tenant_id, entity_id, batch_id)
    references bar_prep_batch (tenant_id, entity_id, batch_id) on delete cascade,
  constraint bar_prep_batch_line_qty_pos check (qty > 0)
);

create index bar_prep_batch_item_idx on bar_prep_batch (tenant_id, entity_id, item_id, started_at desc);
create index bar_prep_batch_open_idx on bar_prep_batch (tenant_id, entity_id, status);

-- ── 3. RLS — อ่าน bar.read · ไม่มี policy เขียน ─────────────────────────────────
alter table bar_prep            enable row level security;
alter table bar_prep_input      enable row level security;
alter table bar_prep_batch      enable row level security;
alter table bar_prep_batch_line enable row level security;
create policy bar_prep_sel on bar_prep for select
  using (tenant_id = my_tenant() and has_cap('bar.read'));
create policy bar_prep_input_sel on bar_prep_input for select
  using (tenant_id = my_tenant() and has_cap('bar.read'));
create policy bar_prep_batch_sel on bar_prep_batch for select
  using (tenant_id = my_tenant() and has_cap('bar.read'));
create policy bar_prep_batch_line_sel on bar_prep_batch_line for select
  using (tenant_id = my_tenant() and has_cap('bar.read'));

-- ── 4. grant (D118) ──────────────────────────────────────────────────────────
grant select, insert, update, delete on table public.bar_prep            to authenticated, service_role;
grant select, insert, update, delete on table public.bar_prep_input      to authenticated, service_role;
grant select, insert, update, delete on table public.bar_prep_batch      to authenticated, service_role;
grant select, insert, update, delete on table public.bar_prep_batch_line to authenticated, service_role;

-- ── 5. audit (D80) ───────────────────────────────────────────────────────────
create trigger audit_bar_prep       after insert or update or delete on bar_prep
  for each row execute function trg_audit('item_id');
create trigger audit_bar_prep_input after insert or update or delete on bar_prep_input
  for each row execute function trg_audit('item_id');
create trigger audit_bar_prep_batch after insert or update or delete on bar_prep_batch
  for each row execute function trg_audit('batch_id');

-- ── 6. ตัวช่วยภายใน: ทำล็อตให้เสร็จ (ใช้ทั้งจาก start แบบทำเสร็จเลย และจาก finish) ────
--    ★ ของเข้าสต็อกผ่าน fn_bar_receive ตัวเดิม = สูตรทุนเฉลี่ยมีที่เดียว (golden B3)
create or replace function bar_prep_finish_batch(
  p_tenant uuid, p_entity text, p_batch text, p_yield numeric, p_date date
) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  v_b bar_prep_batch%rowtype;
  v_item bar_item%rowtype;
  v_res jsonb;
begin
  if coalesce(p_yield, 0) <= 0 then raise exception 'ใส่ปริมาณที่ได้จริงมากกว่า 0'; end if;
  select * into v_b from bar_prep_batch
   where tenant_id = p_tenant and entity_id = p_entity and batch_id = p_batch for update;
  if not found then raise exception 'ไม่พบล็อต % (อาจถูกยกเลิกจากอีกเครื่อง)', p_batch; end if;
  if v_b.status <> 'กำลังแช่' then raise exception 'ล็อต % ไม่ได้อยู่ระหว่างแช่ (%)', p_batch, v_b.status; end if;
  select * into v_item from bar_item
   where tenant_id = p_tenant and entity_id = p_entity and item_id = v_b.item_id for update;
  v_res := fn_bar_receive(p_entity, v_b.item_id, p_yield, v_b.cost_total, null, p_date,
                          'ทำเองในร้าน', p_batch);
  update bar_prep_batch set
    status = 'เสร็จแล้ว', finished_at = now(), finish_date = p_date, yield_qty = p_yield,
    receive_id = (v_res->>'receive_id')::bigint, prev_qty = v_item.qty, prev_cpu = v_item.cost_per_unit
   where tenant_id = p_tenant and entity_id = p_entity and batch_id = p_batch;
  return v_res;
end $fn$;
revoke execute on function bar_prep_finish_batch(uuid, text, text, numeric, date) from public, anon, authenticated;
grant  execute on function bar_prep_finish_batch(uuid, text, text, numeric, date) to service_role;

-- ── 7. RPC ───────────────────────────────────────────────────────────────────

/**
 * ตั้ง/แก้ของทำเอง — p_item_id ว่าง = สร้างวัตถุดิบใหม่ใน bar_item (หน่วยฐาน = p_unit)
 * ★ แก้สูตรมาตรฐาน = แทนทั้งชุด · มีผลกับล็อตถัดไปเท่านั้น (ล็อตเก่าแช่บรรทัดไว้แล้ว)
 * ★ เปลี่ยนชื่อได้ · เปลี่ยนหน่วยที่นี่ไม่ได้ (ไปแท็บสต็อก — กติกาล็อกหน่วย D104)
 */
create or replace function fn_bar_prep_save(
  p_entity text, p_item_id text, p_name text, p_unit text, p_std_yield numeric,
  p_inputs jsonb, p_note text
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_id text := nullif(trim(coalesce(p_item_id, '')), '');
  v_name text := btrim(coalesce(p_name, ''));
  v_row jsonb;
  v_i int := 0;
begin
  if v_name = '' then raise exception 'ตั้งชื่อของทำเองก่อน'; end if;
  if coalesce(p_std_yield, 0) <= 0 then raise exception '1 ล็อตได้ประมาณเท่าไร — ใส่มากกว่า 0'; end if;
  if jsonb_array_length(coalesce(p_inputs, '[]'::jsonb)) = 0 then
    raise exception 'ใส่วัตถุดิบที่ใช้อย่างน้อย 1 บรรทัด';
  end if;
  if exists (select 1 from bar_item where tenant_id = v_tenant and entity_id = p_entity
              and lower(btrim(name)) = lower(v_name) and item_id is distinct from v_id) then
    raise exception 'มีวัตถุดิบชื่อ "%" อยู่แล้ว — ตั้งชื่อไม่ให้ซ้ำ', v_name;
  end if;

  if v_id is null then
    if btrim(coalesce(p_unit, '')) = '' then raise exception 'ระบุหน่วย (ml / g)'; end if;
    v_id := 'I-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    insert into bar_item(tenant_id, entity_id, item_id, name, unit, active)
    values (v_tenant, p_entity, v_id, v_name, btrim(p_unit), true);
    insert into bar_prep(tenant_id, entity_id, item_id, std_yield, note)
    values (v_tenant, p_entity, v_id, p_std_yield, nullif(btrim(coalesce(p_note, '')), ''));
  else
    if not exists (select 1 from bar_prep where tenant_id = v_tenant and entity_id = p_entity and item_id = v_id) then
      raise exception 'ไม่พบของทำเองนี้ (อาจถูกลบจากอีกเครื่อง) — รีเฟรชหน้าแล้วลองใหม่';
    end if;
    update bar_item set name = v_name
     where tenant_id = v_tenant and entity_id = p_entity and item_id = v_id and name <> v_name;
    update bar_prep set std_yield = p_std_yield, note = nullif(btrim(coalesce(p_note, '')), '')
     where tenant_id = v_tenant and entity_id = p_entity and item_id = v_id;
    delete from bar_prep_input where tenant_id = v_tenant and entity_id = p_entity and item_id = v_id;
  end if;

  for v_row in select * from jsonb_array_elements(p_inputs) loop
    v_i := v_i + 1;
    if (v_row->>'item_id') = v_id then
      raise exception 'บรรทัดที่ %: ใช้ % ในสูตรของตัวเองไม่ได้', v_i, v_name;
    end if;
    if coalesce((v_row->>'qty')::numeric, 0) <= 0 then raise exception 'บรรทัดที่ %: ปริมาณต้องมากกว่า 0', v_i; end if;
    if not exists (select 1 from bar_item where tenant_id = v_tenant and entity_id = p_entity
                    and item_id = v_row->>'item_id') then
      raise exception 'บรรทัดที่ %: ไม่พบวัตถุดิบ (อาจถูกลบจากอีกเครื่อง)', v_i;
    end if;
    insert into bar_prep_input(tenant_id, entity_id, item_id, input_item_id, line_no, qty)
    values (v_tenant, p_entity, v_id, v_row->>'item_id', v_i, (v_row->>'qty')::numeric);
  end loop;
  return jsonb_build_object('ok', true, 'item_id', v_id);
end $fn$;

/** ลบของทำเอง — ได้เฉพาะที่ยังไม่เคยทำล็อต (เคยทำแล้ว = ปิดใช้ที่แท็บวัตถุดิบแทน · ประวัติต้องอยู่) */
create or replace function fn_bar_prep_delete(p_entity text, p_item_id text)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v_tenant uuid := bar_guard(p_entity, 'bar.write');
begin
  if exists (select 1 from bar_prep_batch where tenant_id = v_tenant and entity_id = p_entity and item_id = p_item_id) then
    raise exception 'ของทำเองนี้เคยทำล็อตแล้ว ลบไม่ได้ — ปิดใช้ที่ส่วน วัตถุดิบ → แก้ไข แทน (ประวัติล็อตต้องอยู่)';
  end if;
  delete from bar_prep where tenant_id = v_tenant and entity_id = p_entity and item_id = p_item_id;
  -- 🪤 วัตถุดิบที่สูตรเมนูอ้างอยู่ / มีความเคลื่อนไหว จะติด FK — ข้อความไทยจาก mapDbError (ลบไม่ได้ มีรายการอ้างอิง)
  delete from bar_item where tenant_id = v_tenant and entity_id = p_entity and item_id = p_item_id;
  return jsonb_build_object('ok', true);
end $fn$;

/**
 * เริ่มทำล็อต — ตัดวัตถุดิบ + แช่ทุน ทันที
 * p_yield มีค่า = ทำเสร็จแล้ว เข้าสต็อกเลย (ปุ่ม 1) · ว่าง = เริ่มแช่ ยังไม่ได้ของ (ปุ่ม 2)
 * p_inputs = ปริมาณที่ใช้จริงทั้งล็อต (คูณจำนวนล็อตแล้วบนจอ · แก้ได้)
 */
create or replace function fn_bar_prep_start(
  p_entity text, p_item_id text, p_multiplier numeric, p_inputs jsonb,
  p_yield numeric, p_note text, p_business_date date
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_batch text;
  v_row jsonb;
  v_i int := 0;
  v_total numeric := 0;
  v_name text;
  v_unit text;
  v_cpu numeric;
  v_qty numeric;
  v_res jsonb;
begin
  if coalesce(p_multiplier, 0) <= 0 then raise exception 'จำนวนล็อตต้องมากกว่า 0'; end if;
  if jsonb_array_length(coalesce(p_inputs, '[]'::jsonb)) = 0 then raise exception 'ไม่มีวัตถุดิบที่ใช้'; end if;
  if not exists (select 1 from bar_prep where tenant_id = v_tenant and entity_id = p_entity and item_id = p_item_id) then
    raise exception 'ไม่พบของทำเองนี้ — รีเฟรชหน้าแล้วลองใหม่';
  end if;
  v_batch := bar_lab_next_id('PB', p_entity);
  insert into bar_prep_batch(tenant_id, entity_id, batch_id, item_id, multiplier, start_date, note)
  values (v_tenant, p_entity, v_batch, p_item_id, p_multiplier, p_business_date,
          nullif(btrim(coalesce(p_note, '')), ''));

  for v_row in select * from jsonb_array_elements(p_inputs) loop
    v_i := v_i + 1;
    v_qty := (v_row->>'qty')::numeric;
    if coalesce(v_qty, 0) <= 0 then raise exception 'บรรทัดที่ %: ปริมาณต้องมากกว่า 0', v_i; end if;
    if (v_row->>'item_id') = p_item_id then raise exception 'บรรทัดที่ %: ใช้ของทำเองตัวนี้ในล็อตของตัวเองไม่ได้', v_i; end if;
    select i.name, i.unit, i.cost_per_unit into v_name, v_unit, v_cpu from bar_item i
     where i.tenant_id = v_tenant and i.entity_id = p_entity and i.item_id = v_row->>'item_id';
    if not found then raise exception 'บรรทัดที่ %: ไม่พบวัตถุดิบ (อาจถูกลบจากอีกเครื่อง)', v_i; end if;
    insert into bar_prep_batch_line(tenant_id, entity_id, batch_id, line_no, input_item_id, label, unit, qty, cost)
    values (v_tenant, p_entity, v_batch, v_i, v_row->>'item_id', v_name, v_unit, v_qty,
            round(v_qty * coalesce(v_cpu, 0), 2));
    v_total := v_total + round(v_qty * coalesce(v_cpu, 0), 2);
    -- ขวดไม่พอ = ปล่อยติดลบ เหมือนตอนขาย
    perform bar_apply_move(v_tenant, p_entity, v_row->>'item_id', -v_qty, 'ทำของ', v_batch, null);
  end loop;

  update bar_prep_batch set cost_total = round(v_total, 2)
   where tenant_id = v_tenant and entity_id = p_entity and batch_id = v_batch;

  if p_yield is not null then
    v_res := bar_prep_finish_batch(v_tenant, p_entity, v_batch, p_yield, p_business_date);
  end if;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'cost', round(v_total, 2),
                            'finished', p_yield is not null,
                            'cost_per_unit', v_res->'cost_per_unit');
end $fn$;

/** แช่เสร็จแล้ว — กรอกปริมาณที่ได้จริง → ของเข้าสต็อก (ทุนเฉลี่ยกับของเดิม) */
create or replace function fn_bar_prep_finish(p_entity text, p_batch_id text, p_yield numeric, p_business_date date)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_res jsonb;
begin
  v_res := bar_prep_finish_batch(v_tenant, p_entity, p_batch_id, p_yield, p_business_date);
  return jsonb_build_object('ok', true, 'batch_id', p_batch_id, 'cost_per_unit', v_res->'cost_per_unit');
end $fn$;

/**
 * ยกเลิกล็อต
 * · กำลังแช่ → คืนวัตถุดิบตามที่ตัดจริงได้ทุกเมื่อ
 * · เสร็จแล้ว → 🚨 ได้เฉพาะเมื่อของทำเองตัวนี้ยังไม่มีการเคลื่อนไหวอื่นตามหลังล็อตนี้
 *   (คืนยอด + ทุนเฉลี่ยกลับค่าก่อนล็อตเข้าเป๊ะ · ลบแถวราคาในประวัติรับของ) · มีตามหลังแล้ว = แก้ด้วยนับสต็อก
 */
create or replace function fn_bar_prep_cancel(p_entity text, p_batch_id text)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_b bar_prep_batch%rowtype;
  v_in_id bigint;
  v_last bigint;
  v_rec record;
begin
  select * into v_b from bar_prep_batch
   where tenant_id = v_tenant and entity_id = p_entity and batch_id = p_batch_id for update;
  if not found then raise exception 'ไม่พบล็อต %', p_batch_id; end if;
  if v_b.status = 'ยกเลิก' then raise exception 'ล็อต % ถูกยกเลิกไปแล้ว', p_batch_id; end if;

  if v_b.status = 'เสร็จแล้ว' then
    select id into v_in_id from bar_move
     where tenant_id = v_tenant and entity_id = p_entity and item_id = v_b.item_id
       and reason = 'รับเข้า' and ref_no = v_b.receive_id::text;
    select max(id) into v_last from bar_move
     where tenant_id = v_tenant and entity_id = p_entity and item_id = v_b.item_id;
    if v_in_id is null or v_last is distinct from v_in_id then
      raise exception 'ยกเลิกล็อต % ไม่ได้ — มีการใช้/รับ/นับ ของตัวนี้ตามหลังไปแล้ว ทุนเฉลี่ยย้อนกลับเป๊ะไม่ได้ · แก้ยอดด้วย นับสต็อก แทน', p_batch_id;
    end if;
    perform bar_apply_move(v_tenant, p_entity, v_b.item_id, -v_b.yield_qty, 'ทำของ', p_batch_id, 'ยกเลิกล็อต');
    update bar_item set cost_per_unit = v_b.prev_cpu
     where tenant_id = v_tenant and entity_id = p_entity and item_id = v_b.item_id;
    delete from bar_receive where tenant_id = v_tenant and entity_id = p_entity and id = v_b.receive_id;
  end if;

  -- คืนวัตถุดิบตามที่ตัดไปจริง (ไม่ใช่ตามสูตรมาตรฐานปัจจุบัน · D127)
  for v_rec in
    select m.item_id, -sum(m.delta) as amt from bar_move m
     where m.tenant_id = v_tenant and m.entity_id = p_entity and m.ref_no = p_batch_id
       and m.reason = 'ทำของ' and m.item_id <> v_b.item_id
     group by m.item_id
  loop
    if v_rec.amt <> 0 then
      perform bar_apply_move(v_tenant, p_entity, v_rec.item_id, v_rec.amt, 'ทำของ', p_batch_id, 'ยกเลิกล็อต');
    end if;
  end loop;

  update bar_prep_batch set status = 'ยกเลิก', receive_id = null
   where tenant_id = v_tenant and entity_id = p_entity and batch_id = p_batch_id;
  return jsonb_build_object('ok', true);
end $fn$;
