-- ============================================================================
-- 0026 entity scope — เติม entity_id ฝั่งผลิต + ขาย + contacts (NEXT_STEPS ข้อ 4.2)
--   ก่อนหน้านี้ "มีแต่ฝั่งบัญชีที่รู้จัก entity" (transactions/tax_summaries/
--   wht_certificates/report_runs) → ผลิตกับขายไม่มีเลย = 2 กิจการใช้สินค้า/สต็อก/
--   batch/ลูกค้าปนกันหมด
--
--   ⚠️ ไฟล์นี้ยัง **ไม่ผูก FK ไป entities** — เพราะ 0027 จะเปลี่ยน PK ของ entities
--      เป็น (tenant_id, entity_id) → FK ต้องเป็น composite ทำใน 0027 ทีเดียว
--      (อย่าผูก FK เดี่ยวที่นี่แล้ว drop ทิ้งใน 0027 — แตะสองรอบเปล่า ๆ)
--
--   ⚠️ กิจการของเจ้าของเองมี 2 entity จริง (EID01 บริษัทจด VAT · EID02 บุคคลธรรมดา)
--      แต่ผลิต/ขายเกิดที่ EID01 เท่านั้น → ใช้ "กิจการหลัก" ต่อ tenant เป็นค่า default
-- ============================================================================

-- ── กิจการหลักต่อ tenant ─────────────────────────────────────────────────────
--    ทำให้ insert ฝั่งผลิต/ขายที่ไม่ได้ระบุ entity ยังทำงานได้เหมือนเดิม
--    (UI เลือกกิจการฝั่งผลิต/ขายเป็นงานของ 4.4 — ยังไม่ทำรอบนี้)
alter table entities add column if not exists is_default boolean not null default false;

-- หนึ่ง tenant มีกิจการหลักได้ตัวเดียว
create unique index if not exists entities_one_default
  on entities (tenant_id) where is_default;

-- ตั้งกิจการหลักให้ tenant ที่ยังไม่มี = ตัวแรกตามรหัส (ของเจ้าของเอง = EID01)
update entities e set is_default = true
where e.entity_id = (
  select e2.entity_id from entities e2
  where e2.tenant_id = e.tenant_id
  order by e2.entity_id
  limit 1
)
and not exists (
  select 1 from entities e3 where e3.tenant_id = e.tenant_id and e3.is_default
);

-- ── my_default_entity() — คู่กับ my_tenant() ─────────────────────────────────
--    stable security definer เหมือน helper ตัวอื่นใน 0006_rls.sql (NEXT_STEPS 4.8)
create or replace function my_default_entity() returns text
language sql stable security definer set search_path = public as $$
  select entity_id from entities
  where tenant_id = my_tenant() and is_default
  limit 1;
$$;

-- ── เติม entity_id ฝั่งผลิต + ขาย + contacts ─────────────────────────────────
--    ลำดับต่อตาราง: add (nullable) → backfill กิจการหลัก → not null → default
do $$
declare
  t text;
  tables text[] := array[
    -- ผลิต
    'materials','containers','products',
    'log_material','log_ferment','log_distill','log_distill_run','log_ferment_monitor',
    'log_dilute','log_product','stock_product',
    -- ขาย (sales_order_items ไม่ต้องมี — สโคปตามใบของมันเอง เหมือน transaction_items
    --       ที่ฝั่งบัญชีไม่มี entity_id มาตั้งแต่แรก · กันค่าเพี้ยนจากแม่ลูกไม่ตรงกัน)
    'sale_menu','sales_orders','warehouse_stock','stock_moves',
    -- คู่ค้า/ลูกค้า
    'contacts'
  ];
begin
  foreach t in array tables loop
    execute format('alter table %I add column if not exists entity_id text', t);

    -- backfill = กิจการหลักของ tenant นั้น (join ผ่าน tenant_id ที่ 0025 เติมไว้แล้ว)
    execute format($f$
      update %I x set entity_id = e.entity_id
      from entities e
      where e.tenant_id = x.tenant_id and e.is_default and x.entity_id is null
    $f$, t);

    execute format('alter table %I alter column entity_id set not null', t);
    execute format('alter table %I alter column entity_id set default my_default_entity()', t);

    -- index ขึ้นต้นด้วย tenant_id เสมอ (NEXT_STEPS 4.8)
    execute format('create index if not exists %I on %I (tenant_id, entity_id)',
                   t || '_tenant_entity_idx', t);
  end loop;
end $$;

comment on function my_default_entity() is
  'กิจการหลักของ tenant ที่ล็อกอินอยู่ — ใช้เป็น default ของ entity_id ฝั่งผลิต/ขาย '
  'ลูกค้าที่มีกิจการเดียว (max_entities=1) จะไม่เห็นตัวเลือกกิจการเลย';
