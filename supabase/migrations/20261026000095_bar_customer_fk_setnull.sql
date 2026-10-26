-- ============================================================================
-- 0095 bar — ลบลูกค้าบาร์ที่เคยมีบิล/เมนู "สร้างให้" ได้จริง (D137)
--
-- ที่มา: เทสเบราว์เซอร์ D136 — กดลบลูกค้าบาร์ (PDPA) แล้วล้มทุกครั้งที่ลูกค้าเคยมีบิล
--   error: null value in column "tenant_id" of relation "bar_menu" violates not-null constraint
--
-- สาเหตุ (0064): FK 2 ตัวเป็น composite แล้วเขียน `on delete set null` เปล่า ๆ
--     bar_menu (tenant_id, entity_id, created_for) → bar_customer ... on delete set null
--     bar_sale (tenant_id, entity_id, customer_id) → bar_customer ... on delete set null
--   🚨 `set null` ไม่ระบุคอลัมน์ = Postgres ตั้ง null **ทุกคอลัมน์ของ FK** รวม tenant_id/entity_id
--      ⇒ ชน not null ⇒ ลบลูกค้าไม่ได้เลย (ถ้าไม่ชน = บิลหลุดจาก tenant ซึ่งแย่กว่า)
--   ★ บั๊กมีมาตั้งแต่ 0064 · เทสเดิมไม่จับเพราะไม่มีเทสไหนลบลูกค้าที่มีบิล
--
-- แก้: สร้าง FK ใหม่เป็น `on delete set null (<คอลัมน์ลูกค้า>)` (Postgres 15+)
--   ⇒ ลบลูกค้า = บิล/เมนูยังอยู่ครบ · เหลือแค่ช่องลูกค้าเป็น null (ประวัติบิลขึ้น "—" ตาม D97)
--
-- ★ ชื่อ constraint เดิมเป็นชื่ออัตโนมัติ — **ไม่เดาชื่อ** หาจาก pg_constraint ด้วย
--   ตารางต้นทาง + ตารางปลายทาง + รายชื่อคอลัมน์ตามลำดับ · เจอ 0 หรือเกิน 1 = ล้มเสียงดัง
--   (ไฟล์นี้รันซ้ำได้: รอบสองจะเจอ FK ชื่อใหม่ด้วยคอลัมน์ชุดเดิม แล้วสร้างใหม่แบบเดิม)
-- ★ ไม่มีตารางใหม่ (D118 ไม่ต้อง grant) · ไม่มีฟังก์ชัน/definer ใหม่ (D99)
-- ★ การ set null ของ FK ข้าม RLS (referential action) · trigger audit (`trg_audit`) ยังทำงาน
--   และเอา tenant จากแถวซึ่งตอนนี้ไม่ถูกล้างแล้ว
-- 🚨 เทสอ่านซอร์ส lib/shared/fkSetNullSql.test.ts ล็อกว่า FK composite ที่มี tenant_id
--    ห้ามใช้ `on delete set null` โดยไม่ระบุคอลัมน์ (ทุกไฟล์ migration)
-- ============================================================================

do $do$
begin
  -- `set null (col)` มีตั้งแต่ Postgres 15 — รุ่นเก่ากว่าจะ syntax error ที่ไม่บอกเหตุผล
  if current_setting('server_version_num')::int < 150000 then
    raise exception '0095 ต้องใช้ Postgres 15 ขึ้นไป (เจอ %)', current_setting('server_version');
  end if;
end $do$;

-- ── drop FK เดิม 2 ตัว — หาด้วยตาราง + ตารางปลายทาง + คอลัมน์ตามลำดับ ──────────
do $do$
declare
  v_spec  record;
  v_names text[];
begin
  for v_spec in
    select * from (values
      ('public.bar_menu'::regclass, array['tenant_id', 'entity_id', 'created_for']),
      ('public.bar_sale'::regclass, array['tenant_id', 'entity_id', 'customer_id'])
    ) as t(tbl, cols)
  loop
    select array_agg(c.conname::text) into v_names
      from pg_constraint c
     where c.contype = 'f'
       and c.conrelid = v_spec.tbl
       and c.confrelid = 'public.bar_customer'::regclass
       and (select array_agg(a.attname::text order by k.ord)
              from unnest(c.conkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) = v_spec.cols;

    if coalesce(array_length(v_names, 1), 0) <> 1 then
      raise exception '0095: หา FK % (%) → bar_customer ได้ % ตัว (ต้องเจอ 1 ตัวพอดี) · ชื่อที่เจอ: %',
        v_spec.tbl, array_to_string(v_spec.cols, ', '),
        coalesce(array_length(v_names, 1), 0), coalesce(array_to_string(v_names, ', '), '-');
    end if;

    execute format('alter table %s drop constraint %I', v_spec.tbl, v_names[1]);
  end loop;
end $do$;

-- ── 1. bar_menu.created_for — เมนูที่ "สร้างให้" ลูกค้า ─────────────────────────
--    ลบลูกค้า = เมนูยังขายได้ตามปกติ (created_for เป็นแค่ป้ายบอกที่มา · 0064)
alter table bar_menu add constraint bar_menu_created_for_fkey
  foreign key (tenant_id, entity_id, created_for)
  references bar_customer (tenant_id, entity_id, customer_id)
  on delete set null (created_for);

-- ── 2. bar_sale.customer_id — บิลที่ผูกลูกค้า ───────────────────────────────────
--    🚨 บิลต้องอยู่ครบ (ตัวเงิน/VAT/ลงบัญชีแล้ว) · หายแค่ชื่อลูกค้า
alter table bar_sale add constraint bar_sale_customer_id_fkey
  foreign key (tenant_id, entity_id, customer_id)
  references bar_customer (tenant_id, entity_id, customer_id)
  on delete set null (customer_id);
