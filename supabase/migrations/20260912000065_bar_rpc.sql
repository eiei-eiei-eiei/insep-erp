-- ============================================================================
-- 0065 — RPC ของโมดูลบาร์/POS  (D96 · เฟส 4 ของ `docs/BAR_POS_PLAN.md`)
--
-- 🚨 **กติกาเหล็กข้อ 1 ยังบังคับอยู่**: ไฟล์นี้ห้ามแตะ `stock_product` · `log_product`
--    · `warehouse_stock` · `stock_moves` · `sale_menu` · `sales_orders` · `sales_order_items`
--    และห้ามเรียก `apply_stock_delta()` — `lib/bar/isolation.test.ts` อ่านไฟล์นี้มาตรวจ
--    ★ ข้อยกเว้นเดียวคือ `transactions` ใน `fn_bar_post_day` = **จุดเชื่อมบัญชีจุดเดียว**
--      ที่ตั้งใจให้มี (ตารางบัญชีรู้จัก entity อยู่แล้ว ไม่เกี่ยวกับเอกสารสรรพสามิต)
--
-- ── ใครคิดเลขอะไร — เส้นแบ่งที่ตั้งใจ (บทเรียน D79 "สูตรเงินมี 2 ที่") ────────
--   · `amount` ต่อบรรทัด  → **TS คิด** (`lib/bar/totals.ts` `lineAmount`) ส่งเข้ามา
--     เพราะเป็นนโยบายส่วนลด/ของแถมที่หน้าจอเป็นเจ้าของ (แพตเทิร์นเดียวกับ D86)
--   · `cost` ต่อบรรทัด    → **SQL คิด** เพราะต้องอ่าน `bar_item.cost_per_unit`
--     **ในทรานแซกชันเดียวกับที่ตัดสต็อก** ไม่งั้นได้ต้นทุนที่ล้าสมัยเมื่อมีการรับของพร้อมกัน
--     ⇒ `lib/bar/cost.ts` เป็น **ตัวพรีวิวบนจอเท่านั้น** และมีเทส tenant เทียบสองฝั่งให้ตรงกัน
--   · `sub_total`/`grand_total` → **SQL คิดจากแถวที่ตัวเองเป็นเจ้าของ** (กัน client ส่งยอดมั่ว)
--     รับมาแค่ `discount`/`rounding` ซึ่งเป็นการตัดสินใจของคน
--   · `business_date`      → **TS คิด** (`lib/bar/businessDate.ts`) ส่งเข้ามา — รอบขายเป็นค่าตั้งค่า
--     ที่อยู่ใน `app_settings` และกติกาถูกล็อกด้วย golden B6 แล้ว **ห้ามเขียนซ้ำใน SQL**
--
-- 🚨 ทุกฟังก์ชันเป็น `security definer` = bypass RLS ⇒ **ต้องเช็ค cap และ entity เอง**
--    (บทเรียน 0028→0029 · D85) → ใช้ `bar_guard()` เป็นด่านเดียวกันทุกตัว
-- 🚨 `row_count = 0` ต้องตอบ **error ภาษาไทย ไม่ใช่ ok** (D91/D93/D94)
-- ============================================================================

-- ── ด่านตรวจกลาง ────────────────────────────────────────────────────────────
create or replace function bar_guard(p_entity text, p_cap text) returns uuid
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_tenant uuid := my_tenant();
  v_ents text[] := my_entities();
begin
  if v_tenant is null then
    raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)';
  end if;
  if not has_cap(p_cap) then
    raise exception 'ไม่มีสิทธิ์ทำรายการนี้ในโมดูลบาร์';
  end if;
  if p_entity is null or p_entity = '' then
    raise exception 'ยังไม่ได้ตั้งกิจการของบาร์ — ไปตั้งที่ ตั้งค่าบาร์';
  end if;
  if not exists (select 1 from entities where tenant_id = v_tenant and entity_id = p_entity) then
    raise exception 'ไม่พบกิจการ %', p_entity;
  end if;
  if v_ents is not null and array_length(v_ents, 1) > 0 and not (p_entity = any(v_ents)) then
    raise exception 'ไม่มีสิทธิ์เข้าถึงกิจการ %', p_entity;
  end if;
  return v_tenant;
end $fn$;

-- ── เลขเอกสารของบาร์ — `B260912-001` / `BR260912-001` ───────────────────────
--    🪤 ใช้ **วันที่ตามเวลาไทย** ไม่ใช่ `current_date` (server เป็น UTC → เลขข้ามวันตอน 7 โมงเช้า)
--    ★ เลขเดินตาม**เวลาจริง** ส่วนบัญชีเดินตาม `business_date` — ตั้งใจให้ต่างกันได้
create or replace function fn_bar_next_doc(p_prefix text, p_entity text) returns text
language sql security definer set search_path = public as $fn$
  select p_prefix || to_char((now() at time zone 'Asia/Bangkok')::date, 'YYMMDD') || '-' ||
         lpad(next_serial(p_prefix || '-' || p_entity || '-' ||
              to_char((now() at time zone 'Asia/Bangkok')::date, 'YYMMDD'))::text, 3, '0');
$fn$;

-- ── ขยับสต็อก 1 ตัว + จดความเคลื่อนไหว (ใช้ภายในเท่านั้น) ────────────────────
--    ★ ตั้งใจ **ไม่บล็อกเมื่อติดลบ** — บาร์จริงเปิดขวดใหม่แล้วค่อยคีย์รับของทีหลังตลอด
--      ฝั่งหน้าจอเป็นคนเตือน (และสลับเป็นบล็อกได้ที่ `bar_block_negative`)
create or replace function bar_apply_move(
  p_tenant uuid, p_entity text, p_item text, p_delta numeric,
  p_reason text, p_ref text, p_note text
) returns numeric
language plpgsql security definer set search_path = public as $fn$
declare v_after numeric;
begin
  update bar_item set qty = qty + p_delta
   where tenant_id = p_tenant and entity_id = p_entity and item_id = p_item
   returning qty into v_after;
  if not found then
    raise exception 'ไม่พบวัตถุดิบ % ในบาร์', p_item;
  end if;
  insert into bar_move(tenant_id, entity_id, item_id, delta, qty_after, reason, ref_no, note)
  values (p_tenant, p_entity, p_item, p_delta, v_after, p_reason, p_ref, p_note);
  return v_after;
end $fn$;

-- ── เปิดบิล ─────────────────────────────────────────────────────────────────
create or replace function fn_bar_open_sale(
  p_entity text, p_tab_name text default null, p_channel text default 'บาร์',
  p_customer text default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_no text := fn_bar_next_doc('B', p_entity);
begin
  if p_customer is not null and not exists (
    select 1 from bar_customer
     where tenant_id = v_tenant and entity_id = p_entity and customer_id = p_customer
  ) then
    raise exception 'ไม่พบลูกค้า %', p_customer;
  end if;

  insert into bar_sale(tenant_id, entity_id, sale_no, status, tab_name, customer_id, channel)
  values (v_tenant, p_entity, v_no, 'เปิดอยู่', nullif(trim(coalesce(p_tab_name, '')), ''),
          p_customer, coalesce(nullif(trim(p_channel), ''), 'บาร์'));

  return jsonb_build_object('ok', true, 'sale_no', v_no);
end $fn$;

-- ── สร้าง/แก้เมนู พร้อมสูตร ในทรานแซกชันเดียว ───────────────────────────────
--    🚨 สูตรพังต้องทำให้เมนู**ไม่เกิด** ไม่งั้นจะได้เมนูโหมด "ยังไม่ตั้งต้นทุน" โผล่มา
--       โดยที่ผู้ใช้ตั้งใจใส่สูตรไว้แล้ว (แล้วกำไรจะเกินจริงโดยไม่มีใครรู้)
--    p_menu   = { menu_id?, name, price, fixed_cost?, category_id?, method?, glass?, note?, created_for? }
--    p_recipe = [{ item_id, qty }]
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
      values (v_tenant, p_entity, 'custom', 'เมนูเฉพาะกิจ', 999, true);
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

-- ── เพิ่มรายการเข้าบิล — **ตัดสต็อกทันที ณ ตอนสั่ง** ─────────────────────────
--    เหตุผล: เหล้าออกจากขวดตอนชง ไม่ใช่ตอนลูกค้าจ่าย
--    ⇒ สต็อกบนจอถูกต้องตลอดคืน · บิลที่ลูกค้าหนีไม่จ่าย ของก็หายไปจริงซึ่งถูกต้อง
--    p_items = [{ menu_id, qty, price, amount, line_discount?, is_comp? }]
--              `amount` มาจาก `lineAmount()` ฝั่ง TS (ดูหัวไฟล์)
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

    select * into v_menu from bar_menu
     where tenant_id = v_tenant and entity_id = p_entity and menu_id = v_row->>'menu_id';

    -- ต้นทุน: **คิดที่นี่เพราะต้องอ่านราคาต้นทุนในจังหวะเดียวกับที่ตัดสต็อก**
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
            coalesce((v_row->>'line_discount')::numeric, 0),
            coalesce((v_row->>'is_comp')::boolean, false),
            coalesce((v_row->>'amount')::numeric, 0),
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

-- ── ยกเลิกรายการทีละแถว — คืนสต็อก + คิดยอดใหม่ ─────────────────────────────
--    3 ระดับตามสถานะบิล (แผนข้อ 5):
--      เปิดอยู่                      → อิสระ
--      ปิดแล้ว ยังไม่ออกใบเสร็จ/ลงบัญชี → ได้ แต่ต้องพิมพ์สลิปใหม่
--      ออกใบเสร็จแล้ว **หรือ** ลงบัญชีแล้ว → 🚨 บล็อกที่ DB (ใบอยู่ในมือลูกค้า/เลขเข้าบัญชีแล้ว)
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

  -- คืนสต็อกตามสูตรของเมนูนั้น
  for v_rec in
    select r.item_id, r.qty from bar_recipe r
     where r.tenant_id = v_tenant and r.entity_id = p_entity and r.menu_id = v_item.menu_id
  loop
    perform bar_apply_move(v_tenant, p_entity, v_rec.item_id, v_rec.qty * v_item.qty,
                           'แก้บิล', p_sale_no, p_reason);
  end loop;

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

-- ── ปิดบิล ──────────────────────────────────────────────────────────────────
--    `p_business_date` มาจาก `businessDate()` ฝั่ง TS (golden B6) — **ห้ามคิดใหม่ใน SQL**
create or replace function fn_bar_close_sale(
  p_entity text, p_sale_no text, p_method text,
  p_business_date date, p_discount numeric default 0, p_rounding numeric default 0
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
    rounding = coalesce(p_rounding, 0), grand_total = v_grand, cost_total = v_cost
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

-- ── ขายเร็วที่บูธ — เปิด+เพิ่ม+ปิด ในทรานแซกชันเดียว ────────────────────────
--    ★ เขียนแถวเหมือนกันเป๊ะกับเส้นทางเปิดบิลค้าง (ไม่มีข้อมูล 2 รูปแบบให้รายงานสับสน)
create or replace function fn_bar_quick_sale(
  p_entity text, p_items jsonb, p_method text, p_business_date date,
  p_channel text default 'บาร์', p_customer text default null,
  p_discount numeric default 0, p_rounding numeric default 0
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_open jsonb := fn_bar_open_sale(p_entity, null, p_channel, p_customer);
  v_no text := v_open->>'sale_no';
begin
  perform fn_bar_add_lines(p_entity, v_no, p_items);
  return fn_bar_close_sale(p_entity, v_no, p_method, p_business_date, p_discount, p_rounding);
end $fn$;

-- ── ยกเลิกทั้งบิล — soft-void + คืนสต็อกทุกแถว + ถอยสถิติลูกค้า ─────────────
create or replace function fn_bar_void_sale(p_entity text, p_sale_no text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.config');
  v_sale bar_sale%rowtype;
  v_rec record;
begin
  select * into v_sale from bar_sale
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no for update;
  if not found then raise exception 'ไม่พบบิล %', p_sale_no; end if;
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

-- ── รับของเข้าบาร์ + อัปเดตต้นทุนถัวเฉลี่ยถ่วงน้ำหนัก ───────────────────────
--    🚨 สต็อกเดิม ≤ 0 → ใช้ราคาล็อตใหม่ล้วน · เอาสูตรถัวเฉลี่ยไปใช้กับยอดติดลบ
--       จะได้ต้นทุน**ติดลบ** แล้วกำไรพองมหาศาลโดยไม่มีอะไรฟ้อง (ตรงกับ golden B3)
create or replace function fn_bar_receive(
  p_entity text, p_item text, p_qty_pack numeric, p_qty numeric,
  p_cost_total numeric, p_date date default null,
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

  select * into v_prev from bar_item
   where tenant_id = v_tenant and entity_id = p_entity and item_id = p_item for update;
  if not found then raise exception 'ไม่พบวัตถุดิบ % ในบาร์', p_item; end if;

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

-- ── ปรับยอดตามที่นับได้จริง / ของเสีย / ชิม ─────────────────────────────────
create or replace function fn_bar_adjust(
  p_entity text, p_item text, p_qty_after numeric,
  p_reason text default 'ปรับยอด', p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_prev numeric;
begin
  if p_reason not in ('ปรับยอด', 'เสียหาย', 'ชิม/เทสต์') then
    raise exception 'เหตุผลไม่ถูกต้อง (ปรับยอด · เสียหาย · ชิม/เทสต์)';
  end if;
  if p_qty_after is null then raise exception 'ต้องระบุยอดที่นับได้'; end if;

  select qty into v_prev from bar_item
   where tenant_id = v_tenant and entity_id = p_entity and item_id = p_item for update;
  if not found then raise exception 'ไม่พบวัตถุดิบ % ในบาร์', p_item; end if;
  if v_prev = p_qty_after then
    raise exception 'ยอดเท่าเดิม (%) ไม่มีอะไรต้องปรับ', v_prev;
  end if;

  perform bar_apply_move(v_tenant, p_entity, p_item, p_qty_after - v_prev, p_reason, null, p_note);
  return jsonb_build_object('ok', true, 'before', v_prev, 'after', p_qty_after);
end $fn$;

-- ── ออกเลขใบเสร็จ — **idempotent** (มีแล้วคืนเลขเดิม ไม่ออกใหม่) ────────────
create or replace function fn_bar_issue_receipt(p_entity text, p_sale_no text)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_sale bar_sale%rowtype;
  v_no text;
begin
  select * into v_sale from bar_sale
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no for update;
  if not found then raise exception 'ไม่พบบิล %', p_sale_no; end if;
  if v_sale.rcpt_no is not null then
    return jsonb_build_object('ok', true, 'rcpt_no', v_sale.rcpt_no, 'reused', true);
  end if;
  if v_sale.status <> 'ปกติ' then
    raise exception 'ออกใบเสร็จได้เฉพาะบิลที่ปิดแล้ว (บิลนี้: %)', v_sale.status;
  end if;

  v_no := fn_bar_next_doc('BR', p_entity);
  update bar_sale set rcpt_no = v_no, rcpt_at = now()
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no;

  return jsonb_build_object('ok', true, 'rcpt_no', v_no, 'reused', false);
end $fn$;

-- ── ลงบัญชีสรุปรายวัน — จุดเชื่อมเดียวกับระบบเดิม ───────────────────────────
--    1 บิลบัญชีต่อ 1 วิธีรับเงิน · กันซ้ำด้วย partial unique index ของ bar_post เอง
--    🚨 entity มาจากค่าที่ตั้งไว้ใน `/bar` **ไม่ใช่จากคนล็อกอิน** (ตระกูล D79/0029)
create or replace function fn_bar_post_day(
  p_entity text, p_date date, p_account text, p_category text default 'รายได้บาร์'
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.config');
  v_rec record;
  v_tx text;
  v_ids text[] := '{}';
  v_totals jsonb := '{}'::jsonb;
  v_sum numeric := 0;
begin
  if p_date is null then raise exception 'ต้องระบุวันที่'; end if;
  if coalesce(trim(p_account), '') = '' then
    raise exception 'ยังไม่ได้ตั้งบัญชีรับเงินของบาร์ — ไปตั้งที่ ตั้งค่าบาร์';
  end if;
  if exists (select 1 from bar_post
              where tenant_id = v_tenant and entity_id = p_entity
                and post_date = p_date and status = 'ปกติ') then
    raise exception 'ยอดวันที่ % ลงบัญชีไปแล้ว', to_char(p_date, 'DD/MM/YYYY');
  end if;
  if not exists (select 1 from bar_sale
                  where tenant_id = v_tenant and entity_id = p_entity
                    and business_date = p_date and status = 'ปกติ') then
    raise exception 'วันที่ % ไม่มีบิลที่ปิดแล้ว ไม่มีอะไรให้ลงบัญชี', to_char(p_date, 'DD/MM/YYYY');
  end if;

  for v_rec in
    select coalesce(nullif(trim(method), ''), 'ไม่ระบุ') as m,
           count(*) as bills, sum(grand_total) as total
      from bar_sale
     where tenant_id = v_tenant and entity_id = p_entity
       and business_date = p_date and status = 'ปกติ'
     group by 1 order by 1
  loop
    v_tx := 'TR-' || to_char(p_date, 'YYYYMMDD') || '-' ||
            lpad(next_serial('TR-' || to_char(p_date, 'YYYYMMDD'))::text, 4, '0');

    insert into transactions(tenant_id, tx_id, transaction_date, type, account_name, category,
                             description, base_amount, amount_after_discount, net_amount,
                             entity_id, source)
    values (v_tenant, v_tx, p_date, 'รายรับ', p_account, p_category,
            'ยอดขายบาร์ ' || to_char(p_date, 'DD/MM/YYYY') || ' · ' || v_rec.m ||
            ' (' || v_rec.bills || ' บิล)',
            v_rec.total, v_rec.total, v_rec.total, p_entity, 'bar');

    v_ids := v_ids || v_tx;
    v_totals := v_totals || jsonb_build_object(v_rec.m,
                  jsonb_build_object('bills', v_rec.bills, 'total', v_rec.total, 'tx_id', v_tx));
    v_sum := v_sum + v_rec.total;
  end loop;

  insert into bar_post(tenant_id, entity_id, post_date, tx_ids, totals, posted_by)
  values (v_tenant, p_entity, p_date, v_ids, v_totals, auth.uid());

  return jsonb_build_object('ok', true, 'post_date', p_date, 'tx_ids', v_ids, 'total', v_sum);
end $fn$;

-- ── ถอนการลงบัญชี — soft-void ทั้งสองฝั่ง ห้ามลบแถว ─────────────────────────
create or replace function fn_bar_unpost_day(p_entity text, p_date date)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.config');
  v_post bar_post%rowtype;
  v_n int;
begin
  select * into v_post from bar_post
   where tenant_id = v_tenant and entity_id = p_entity
     and post_date = p_date and status = 'ปกติ' for update;
  if not found then
    raise exception 'วันที่ % ยังไม่ได้ลงบัญชี ไม่มีอะไรให้ถอน', to_char(p_date, 'DD/MM/YYYY');
  end if;

  update transactions set status = 'ยกเลิก'
   where tenant_id = v_tenant and tx_id = any(v_post.tx_ids) and status = 'ปกติ';
  get diagnostics v_n = row_count;

  update bar_post set status = 'ยกเลิก'
   where tenant_id = v_tenant and entity_id = p_entity and id = v_post.id;

  return jsonb_build_object('ok', true, 'post_date', p_date, 'voided_tx', v_n);
end $fn$;

notify pgrst, 'reload schema';
