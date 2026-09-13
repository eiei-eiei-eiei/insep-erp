-- ============================================================================
-- seed_bar.sql — ชุดข้อมูลทดสอบ "โมดูลบาร์/POS" · D96 · รันซ้ำได้
--   marker ลบทีเดียว: **ทุก id ขึ้นต้น 'T-'** · ชื่อมี 'ทดสอบ' → ลบด้วย cleanup_test.sql
--   ใช้: Supabase → SQL Editor → วางทั้งไฟล์ → Run
--
-- ★ **ไม่บังคับว่าต้องมี EID99** (ต่างจาก seed ตัวอื่น) — ใช้ EID99 ถ้ามี ไม่มีก็ใช้
--   กิจการหลักของ tenant นั้น · เหตุผล: การสร้างกิจการที่ 2 กินโควตา `max_entities`
--   ซึ่งเป็นของที่ขายเพิ่ม การบังคับให้มีเพื่อเทสบาร์อย่างเดียวไม่คุ้ม
--   🚨 ทุกแถวยังขึ้นต้น 'T-' เหมือนเดิม cleanup จึงลบได้ครบไม่ว่าลงที่กิจการไหน
--
-- 🪤 **บทเรียน D94 — seed ที่รันใน SQL Editor ไม่ได้**
--    ตาราง bar_* มี `tenant_id uuid default my_tenant()` ซึ่งอ่านจาก JWT
--    แต่ SQL Editor รันเป็น role `postgres` **ไม่มี JWT** → my_tenant() คืน null
--    → ชน not null · ไฟล์นี้จึงระบุ tenant เองทุกแถว แทนการพึ่ง default ของคอลัมน์
--
-- 🔴 **และเพราะไม่มี JWT ก็แปลว่า RLS ไม่กรองอะไรเลยด้วย** (เจอจริงตอนเทส 2026-09-12
--    — รอบแรก seed ไปลงผิดลูกค้าเพราะ `from entities limit 1` มองเห็นทุก tenant)
--    ⇒ ต้องกรอก `target_slug` ข้างล่างเมื่อ DB มีลูกค้าเกิน 1 เจ้า **ไฟล์นี้จะไม่เดาให้**
-- 🪤 และ `on conflict` ต้องเป็น **composite key** (0027 ผ่าตัด PK ไปแล้ว)
--    เขียน `on conflict (item_id)` เฉย ๆ จะล้มด้วย "no unique constraint matching"
--
-- ── สิ่งที่ชุดนี้ตั้งใจให้พิสูจน์ ─────────────────────────────────────────────
--   ① เมนู 3 โหมด: มีสูตร · ต้นทุนตายตัว · **ยังไม่ตั้งต้นทุน** (ต้องขึ้นแถบเตือน)
--   ② วัตถุดิบที่ **ใกล้หมด** → ขายแล้วต้องเตือน แต่ **ห้ามบล็อก**
--   ③ ขายเป็นแก้ว vs ขายทั้งขวด ใช้วัตถุดิบตัวเดียวกัน ต่างกันแค่ปริมาณ
--   ④ ลูกค้าที่ **ยินยอม** และ **ไม่ยินยอม** ให้โรงกลั่นติดต่อ (ทดสอบ CSV)
--   ⑤ ของที่ซื้อเป็นหน่วยฐานอยู่แล้ว (มะนาวเป็นลูก) → ต้องไม่โชว์ "≈ กี่ขวด"
-- ============================================================================

do $$
declare
  -- ⚙️ ═══ ตั้งค่าก่อนรัน ═══════════════════════════════════════════════════
  --    ใส่ slug ของลูกค้าที่จะเทส (ดูได้จากหน้า /platform) ระหว่างเครื่องหมายคำพูด
  --    เว้นว่างได้ **เฉพาะ DB ที่มีลูกค้าเจ้าเดียว** (เช่น DB ของเจ้าของเอง)
  --    🪤 ใช้ตัวแปร plpgsql ไม่ใช่ `\set` ของ psql — **SQL Editor ของ Supabase
  --       ไม่รองรับคำสั่ง meta ที่ขึ้นต้นด้วย backslash** (เจอจริงตอนเทส)
  v_slug   text := '';
  -- ═════════════════════════════════════════════════════════════════════════
  v_tenant uuid;
  v_entity text;
  v_n      int;
  v_list   text;
begin
  v_slug := nullif(trim(v_slug), '');
  -- 🚨 **จุดที่พลาดแล้วอันตรายที่สุดของไฟล์นี้** (เจอจริงตอนเทส 2026-09-12)
  --    SQL Editor และ service role **ไม่มี JWT ⇒ RLS ไม่กรองอะไรเลย**
  --    → `select … from entities limit 1` มองเห็น**ทุก tenant** แล้วหยิบมาแบบสุ่ม
  --    → seed ไปลงในข้อมูล**ลูกค้าจริง**ได้ โดยไม่มีอะไรฟ้อง
  --    ⇒ มีลูกค้าเกิน 1 เจ้าเมื่อไหร่ **ต้องบังคับให้ระบุ ห้ามเดา**
  --    (หลักเดียวกับที่ `fn_mig_truncate` บังคับ `p_tenant` ห้าม null)
  if v_slug is null then
    select count(*) into v_n from tenants where coalesce(is_platform, false) = false;
    if v_n > 1 then
      select string_agg(slug, ' · ' order by slug) into v_list
        from tenants where coalesce(is_platform, false) = false;
      raise exception
        'DB นี้มีลูกค้า % เจ้า — ต้องระบุว่าจะลงที่ไหน  ▶ แก้ค่า v_slug ข้างบนเป็นหนึ่งใน: %',
        v_n, v_list;
    end if;
    select id into v_tenant from tenants where coalesce(is_platform, false) = false limit 1;
  else
    select id into v_tenant from tenants where slug = v_slug;
    if v_tenant is null then raise exception 'ไม่พบลูกค้า slug = %', v_slug; end if;
  end if;

  if v_tenant is null then
    raise exception 'ไม่พบลูกค้าใน DB นี้เลย — ต้อง provision tenant ก่อน';
  end if;

  -- ใช้ EID99 ถ้ามี (จาก seed_sales) ไม่งั้นใช้กิจการหลัก — **ในขอบเขต tenant นั้นเท่านั้น**
  select entity_id into v_entity
    from entities where tenant_id = v_tenant and entity_id = 'EID99';
  if v_entity is null then
    select entity_id into v_entity
      from entities where tenant_id = v_tenant
      order by is_default desc nulls last, entity_id limit 1;
  end if;
  if v_entity is null then
    raise exception 'ลูกค้ารายนี้ยังไม่มีกิจการเลย';
  end if;

  -- ── หมวดเมนู ───────────────────────────────────────────────────────────────
  --    ★ 'custom' ต้องมีเสมอ (is_system) เพราะเมนูใหม่จากหน้าขายตกลงหมวดนี้
  insert into bar_category (tenant_id, entity_id, category_id, name, sort, is_system) values
    (v_tenant, v_entity, 'T-cocktail', 'ค็อกเทล (ทดสอบ)', 1, false),
    (v_tenant, v_entity, 'T-shot',     'ช็อต (ทดสอบ)',     2, false),
    (v_tenant, v_entity, 'T-bottle',   'ขายทั้งขวด (ทดสอบ)', 3, false),
    (v_tenant, v_entity, 'T-food',     'กับแกล้ม (ทดสอบ)',  4, false),
    (v_tenant, v_entity, 'custom',     'เมนูเฉพาะกิจ',      99, true)
  on conflict (tenant_id, entity_id, category_id) do update
    set name = excluded.name, sort = excluded.sort;

  -- ── วัตถุดิบ ───────────────────────────────────────────────────────────────
  --    🚨 หน่วยคือหน่วยที่ **สูตรกิน** ไม่ใช่หน่วยที่ซื้อ — เหล้าเป็น ml ไม่ใช่ขวด
  --       (เก็บเป็นขวดเมื่อไหร่ ขาย 1 แก้วแล้วสต็อกกลายเป็นเศษทศนิยมของขวดทันที)
  insert into bar_item (tenant_id, entity_id, item_id, name, unit, qty, cost_per_unit,
                        pack_size, pack_label, low_qty, active) values
    -- ③ ตัวนี้ใช้ทั้งขายเป็นแก้ว (30 ml) และขายทั้งขวด (700 ml)
    (v_tenant, v_entity, 'T-BGIN',  'จินทดสอบ',      'ml',  2100, 1.2000, 700, 'ขวด (700 ml)',  350, true),
    (v_tenant, v_entity, 'T-BVER',  'เวอร์มุททดสอบ', 'ml',   750, 0.8000, 750, 'ขวด (750 ml)',  150, true),
    -- ② ใกล้หมด: เหลือ 60 แต่เกณฑ์เตือน 200 → ต้องขึ้น "ใกล้หมด" และเตือนตอนขาย
    (v_tenant, v_entity, 'T-BCAM',  'คัมพารีทดสอบ',  'ml',    60, 2.5000, 700, 'ขวด (700 ml)',  200, true),
    -- ⑤ ซื้อเป็นลูกอยู่แล้ว → ไม่มี pack_size → หน้าจอต้องไม่โชว์ "≈ กี่ขวด"
    (v_tenant, v_entity, 'T-BLIM',  'มะนาวทดสอบ',    'ลูก',    12, 5.0000, null, null,           3,  true),
    (v_tenant, v_entity, 'T-BSODA', 'โซดาทดสอบ',     'ขวด',    24, 12.0000, null, 'ขวด',          6,  true)
  on conflict (tenant_id, entity_id, item_id) do update
    set name = excluded.name, unit = excluded.unit, qty = excluded.qty,
        cost_per_unit = excluded.cost_per_unit, pack_size = excluded.pack_size,
        pack_label = excluded.pack_label, low_qty = excluded.low_qty, active = true;

  -- ── ลูกค้า ─────────────────────────────────────────────────────────────────
  --    ④ คนหนึ่งยินยอม คนหนึ่งไม่ยินยอม → ส่งออก CSV ต้องได้แค่คนเดียว
  --    🚨 CHECK `bar_customer_consent_pair` บังคับว่า ยินยอม=true ต้องมี consent_at
  insert into bar_customer (tenant_id, entity_id, customer_id, name, nickname, phone, note,
                            consent_marketing, consent_at, active) values
    (v_tenant, v_entity, 'T-BC01', 'พี่โอ๊ต (ทดสอบ)', 'โอ๊ต', '0812345678',
     'ไม่กินหวาน · ชอบเปรี้ยวจัด', true, now(), true),
    (v_tenant, v_entity, 'T-BC02', 'คุณเมย์ (ทดสอบ)', 'เมย์', '0899999999',
     'แพ้ถั่ว', false, null, true)
  on conflict (tenant_id, entity_id, customer_id) do update
    set name = excluded.name, nickname = excluded.nickname, phone = excluded.phone,
        note = excluded.note, consent_marketing = excluded.consent_marketing,
        consent_at = excluded.consent_at, active = true;

  -- ── เมนู 3 โหมด ────────────────────────────────────────────────────────────
  insert into bar_menu (tenant_id, entity_id, menu_id, name, price, fixed_cost, category_id,
                        method, glass, note, created_for, active, sort) values
    -- โหมด A: มีสูตร → ตัดสต็อก · ต้นทุน = 30×1.2 + 30×0.8 + 30×2.5 = 135
    (v_tenant, v_entity, 'T-BM01', 'Negroni ทดสอบ', 260, null, 'T-cocktail',
     'stir 30 วิ · เสิร์ฟบนน้ำแข็งก้อนใหญ่ · บิดเปลือกส้ม', 'rocks',
     'ของพี่โอ๊ต — ลดเวอร์มุท', 'T-BC01', true, 1),
    -- ③ ขายทั้งขวด: item เดียวกับข้างบน ต่างแค่ปริมาณ (ได้ฟรีจากโครงสูตร)
    (v_tenant, v_entity, 'T-BM02', 'จินทดสอบ (ขวด)', 1200, null, 'T-bottle',
     null, null, null, null, true, 2),
    (v_tenant, v_entity, 'T-BM03', 'จินช็อตทดสอบ', 120, null, 'T-shot', null, 'shot', null, null, true, 3),
    -- โหมด B: ต้นทุนตายตัว → ไม่ตัดสต็อก แต่กำไรถูกต้อง (กับแกล้มที่ BOM ไม่คุ้มจะคีย์)
    (v_tenant, v_entity, 'T-BM04', 'ถั่วทอดทดสอบ', 80, 35, 'T-food', null, null, null, null, true, 4),
    -- ① โหมด C: ยังไม่ตั้งต้นทุน → ต้องขึ้นแถบเตือนและป้ายบนแถว
    (v_tenant, v_entity, 'T-BM05', 'ค็อกเทลลับทดสอบ', 300, null, 'custom',
     null, null, 'ยังไม่ได้จดสูตร', null, true, 5)
  on conflict (tenant_id, entity_id, menu_id) do update
    set name = excluded.name, price = excluded.price, fixed_cost = excluded.fixed_cost,
        category_id = excluded.category_id, method = excluded.method, glass = excluded.glass,
        note = excluded.note, created_for = excluded.created_for, active = true;

  -- ── สูตร ───────────────────────────────────────────────────────────────────
  delete from bar_recipe where tenant_id = v_tenant and entity_id = v_entity and menu_id like 'T-BM%';
  insert into bar_recipe (tenant_id, entity_id, menu_id, item_id, qty) values
    (v_tenant, v_entity, 'T-BM01', 'T-BGIN', 30),
    (v_tenant, v_entity, 'T-BM01', 'T-BVER', 30),
    (v_tenant, v_entity, 'T-BM01', 'T-BCAM', 30),
    (v_tenant, v_entity, 'T-BM02', 'T-BGIN', 700),
    (v_tenant, v_entity, 'T-BM03', 'T-BGIN', 45);
  -- ★ T-BM04 ไม่มีสูตรโดยตั้งใจ (โหมดต้นทุนตายตัว) · T-BM05 ไม่มีทั้งคู่ (โหมดยังไม่ตั้ง)

  -- ── เมนูโปรดที่ปักหมุดไว้ ──────────────────────────────────────────────────
  insert into bar_customer_fav (tenant_id, entity_id, customer_id, menu_id) values
    (v_tenant, v_entity, 'T-BC01', 'T-BM01')
  on conflict (tenant_id, entity_id, customer_id, menu_id) do nothing;

  -- ── ค่าตั้งค่าของบาร์ ──────────────────────────────────────────────────────
  --    🚨 `bar_promptpay_id` เป็นเบอร์ทดสอบ — **ต้องเปลี่ยนเป็นเบอร์จริงก่อนใช้งานจริง**
  --       และสแกนยืนยันชื่อบัญชีปลายทางด้วยตาหนึ่งครั้ง (เลขผิด = เงินเข้าคนอื่นเงียบ ๆ)
  delete from app_settings where tenant_id = v_tenant and kind like 'bar\_%';  -- เฉพาะ tenant นี้
  insert into app_settings (tenant_id, kind, value, sort) values
    (v_tenant, 'bar_entity',          v_entity,      90),
    (v_tenant, 'bar_promptpay_type',  'mobile',      91),
    (v_tenant, 'bar_promptpay_id',    '0812345678',  92),
    (v_tenant, 'bar_day_start',       '18:00',       93),
    (v_tenant, 'bar_day_end',         '03:00',       94),
    (v_tenant, 'bar_round_cash',      '0',           95),
    (v_tenant, 'bar_block_negative',  '0',           96),
    (v_tenant, 'bar_receipt_footer',  'ขอบคุณครับ (ทดสอบ)', 97),
    (v_tenant, 'bar_channels',        'บูธทดสอบ Craft Fest', 98),
    (v_tenant, 'bar_channels',        'งานทดสอบวันเกิด',     99);

  raise notice 'seed_bar เสร็จ — กิจการ %, tenant %', v_entity, v_tenant;
end $$;

-- ── ยืนยันว่าลงครบ ──────────────────────────────────────────────────────────
select 'หมวด'      as ของ, count(*) as จำนวน from bar_category where category_id like 'T-%'
union all select 'วัตถุดิบ',   count(*) from bar_item     where item_id     like 'T-%'
union all select 'เมนู',       count(*) from bar_menu     where menu_id     like 'T-%'
union all select 'บรรทัดสูตร', count(*) from bar_recipe   where menu_id     like 'T-%'
union all select 'ลูกค้า',     count(*) from bar_customer where customer_id like 'T-%';
-- ควรได้: หมวด 5 · วัตถุดิบ 5 · เมนู 5 · บรรทัดสูตร 5 · ลูกค้า 2
