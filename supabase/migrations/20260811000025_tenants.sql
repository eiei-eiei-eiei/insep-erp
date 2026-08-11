-- ============================================================================
-- 0025 tenants — ฐานของ multi-tenant (NEXT_STEPS ข้อ 4.1)
--   tenants + my_tenant() + tenant_id ทุกตาราง + index ที่ขึ้นต้นด้วย tenant_id
--
--   ★ หลักการที่ทำให้ไม่ต้องแก้ .from() 174 จุดในแอป:
--       tenant_id not null default my_tenant()   → INSERT: DB ประทับให้เอง
--       policy ... using (tenant_id = my_tenant()) → SELECT: RLS กรองให้เอง (อยู่ใน 0028)
--
--   ⚠️ กติกาเหล็กของไฟล์นี้ (NEXT_STEPS 4.8): **ทุก index ต้องขึ้นต้นด้วย tenant_id**
--      ลืมแล้วทุก query จะสแกนข้อมูลลูกค้าทุกเจ้า และจะไม่รู้ตัวจนลูกค้าเยอะ
--
--   ⚠️ default my_tenant() คืน null เมื่อไม่มี auth.uid() (service role) → not null จะฟ้องทันที
--      = ตั้งใจให้ fail closed · โค้ดที่ใช้ service role ต้องส่ง tenant_id เองทุกจุด
--      (lib/snapshot/engine.ts · settings/data · settings/users · migration/*)
--
--   ผ่าตัด PK/unique อยู่ใน 0027 · RLS อยู่ใน 0028 · RPC อยู่ใน 0029 — ไฟล์นี้ยังไม่แตะ
-- ============================================================================

-- ── ตาราง tenants ────────────────────────────────────────────────────────────
create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,                 -- ใช้เป็น subdomain + namespace ของ username
  name text not null,                        -- ชื่อลูกค้า (ใช้ภายใน)
  brand_name text,                           -- ชื่อที่โชว์บนแอป (co-brand)
  logo_url text,
  brand_color text not null default 'steel'
    check (brand_color in ('steel','copper','green','indigo','wine','teal','rust')),
  max_entities int not null default 1,       -- >1 = ซื้อ add-on หลายกิจการ (ข้อ 4.2)
  modules_enabled text[] not null default '{production,accounting,sales}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on column tenants.slug is
  'subdomain + namespace ของ username — ⚠️ ใช้แต่งหน้า/ชี้ทางเท่านั้น ห้ามใช้ตัดสินสิทธิ์เข้าถึงข้อมูล';

-- ── tenant เริ่มต้น (ข้อมูลเดิมทั้งหมดยกไปเป็นของ tenant นี้) ──────────────────
--    uuid คงที่เพื่อให้ 0026/0027 อ้างถึงได้ และ push ซ้ำได้ผลเดิม
insert into tenants (id, slug, name, brand_name)
values ('00000000-0000-0000-0000-000000000001', 'default', 'กิจการเริ่มต้น',
        coalesce((select value from app_settings where kind = 'brand_name' limit 1), 'Insep ERP'))
on conflict (id) do nothing;

-- ── profiles.tenant_id ต้องมาก่อน my_tenant() (helper อ่านจากตารางนี้) ─────────
alter table profiles add column if not exists tenant_id uuid references tenants(id);
update profiles set tenant_id = '00000000-0000-0000-0000-000000000001' where tenant_id is null;
alter table profiles alter column tenant_id set not null;

-- ── my_tenant() — แหล่งความจริงเดียวของสิทธิ์ ─────────────────────────────────
--    เขียนตาม pattern เดิมของ my_role()/my_entities() ใน 0006_rls.sql เป๊ะ:
--    stable security definer → ประเมินครั้งเดียวต่อ query ไม่ใช่ต่อแถว (NEXT_STEPS 4.8)
--
--    🚨 ห้ามเพิ่มพารามิเตอร์ให้ฟังก์ชันนี้เด็ดขาด และห้ามให้อ่านค่าจาก header/cookie/URL
--       สิทธิ์ต้องมาจาก profiles ของ auth.uid() เท่านั้น (NEXT_STEPS:181)
create or replace function my_tenant() returns uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from profiles where id = auth.uid();
$$;

-- ── เติม tenant_id ให้ทุกตาราง (ยกเว้น profiles ที่ทำไปแล้ว) ───────────────────
--    ลำดับต่อตาราง: add (nullable) → backfill → not null → default → FK → index
do $$
declare
  t text;
  tables text[] := array[
    'entities','bank_accounts','contacts','app_settings','integration_log','counters',
    'materials','containers','products',
    'log_material','log_ferment','log_distill','log_distill_run','log_ferment_monitor',
    'log_dilute','log_product','stock_product',
    'transactions','transaction_items','tax_summaries','wht_certificates','scan_log',
    'sale_menu','sales_orders','sales_order_items','warehouse_stock','stock_moves',
    'report_runs','edit_log','snapshots'
  ];
begin
  foreach t in array tables loop
    execute format('alter table %I add column if not exists tenant_id uuid', t);
    execute format(
      'update %I set tenant_id = ''00000000-0000-0000-0000-000000000001'' where tenant_id is null', t);
    execute format('alter table %I alter column tenant_id set not null', t);
    execute format('alter table %I alter column tenant_id set default my_tenant()', t);

    -- FK ไป tenants (ตั้งชื่อเองเพื่อให้ push ซ้ำได้ไม่ชน)
    if not exists (select 1 from pg_constraint where conname = t || '_tenant_fk') then
      execute format('alter table %I add constraint %I foreign key (tenant_id) references tenants(id)',
                     t, t || '_tenant_fk');
    end if;

    -- index พื้นฐาน — 0027 จะ drop ตัวที่ซ้ำซ้อนหลังทำ PK ใหม่ที่ขึ้นต้นด้วย tenant_id
    execute format('create index if not exists %I on %I (tenant_id)', t || '_tenant_idx', t);
  end loop;
end $$;

alter table profiles alter column tenant_id set default my_tenant();
create index if not exists profiles_tenant_idx on profiles (tenant_id);

-- ── สร้าง index เดิมใหม่ให้ขึ้นต้นด้วย tenant_id ──────────────────────────────
--    ของเดิมไม่มี tenant_id นำหน้า = สแกนข้ามลูกค้าทุก query (NEXT_STEPS 4.8 แถวแรก)
drop index if exists lm_mat_date;
create index lm_mat_date on log_material (tenant_id, material_id, doc_date);

drop index if exists lf_batch;
create index lf_batch on log_ferment (tenant_id, batch);

drop index if exists ldr_batch;
create index ldr_batch on log_distill_run (tenant_id, batch, pot_no);

drop index if exists lfm_batch;
create index lfm_batch on log_ferment_monitor (tenant_id, batch);

drop index if exists lp_prod_date;
create index lp_prod_date on log_product (tenant_id, product_id, doc_date);

drop index if exists tx_entity_date;
create index tx_entity_date on transactions (tenant_id, entity_id, transaction_date);

drop index if exists tx_contact;
create index tx_contact on transactions (tenant_id, contact_name);

drop index if exists tx_pogroup;
create index tx_pogroup on transactions (tenant_id, po_group_id) where po_group_id is not null;

drop index if exists tx_apar;
create index tx_apar on transactions (tenant_id, ap_ar_status) where ap_ar_status is not null;

drop index if exists tx_contact_id;
create index tx_contact_id on transactions (tenant_id, contact_id) where contact_id is not null;

drop index if exists ti_tx;
create index ti_tx on transaction_items (tenant_id, tx_id);

drop index if exists ts_month_entity;
create index ts_month_entity on tax_summaries (tenant_id, report_month, entity_id, created_at desc);

drop index if exists so_status;
create index so_status on sales_orders (tenant_id, status);

drop index if exists soi_qu;
create index soi_qu on sales_order_items (tenant_id, qu_no);

drop index if exists rr_key_month;
create index rr_key_month on report_runs (tenant_id, report_key, month, entity_id, created_at desc);

drop index if exists el_table_row;
create index el_table_row on edit_log (tenant_id, table_name, row_pk, created_at desc);

drop index if exists snapshots_created;
create index snapshots_created on snapshots (tenant_id, created_at desc);

-- ── handle_new_user: ต้องรู้ tenant ไม่งั้นสร้างผู้ใช้ไม่ได้อีกต่อไป ──────────
--   trigger นี้ทำงานตอน insert auth.users ซึ่งหน้า "จัดการผู้ใช้" เรียกผ่าน service role
--   → auth.uid() เป็น null → my_tenant() คืน null → not null ฟ้อง = สร้าง user พัง
--   ลำดับที่มา: metadata.tenant_id (แอปส่งมา) → my_tenant() (คนสร้างล็อกอินอยู่)
--             → tenant เดียวในระบบ (deployment ที่มีลูกค้าเจ้าเดียว เช่น DB ของเจ้าของเอง)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
begin
  v_tenant := coalesce(
    nullif(new.raw_user_meta_data ->> 'tenant_id', '')::uuid,
    my_tenant(),
    (select id from tenants where is_active limit 1)
  );

  if v_tenant is null then
    raise exception 'สร้างผู้ใช้ไม่ได้: ไม่รู้ว่าผู้ใช้นี้อยู่กิจการไหน (ส่ง tenant_id ใน user_metadata)';
  end if;

  insert into public.profiles (id, username, display_name, role, tenant_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    'viewer',
    v_tenant
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- ── RLS ของ tenants เอง ──────────────────────────────────────────────────────
alter table tenants enable row level security;

-- ผู้ใช้เห็นเฉพาะ tenant ของตัวเอง · แก้ไม่ได้ (เปลี่ยนผ่าน service role เท่านั้น)
-- = ลูกค้าเลื่อน max_entities/modules_enabled ให้ตัวเองไม่ได้ (ข้อ 4.2 บังคับที่ DB ไม่ใช่ UI)
create policy tenants_sel on tenants for select using (id = my_tenant());

-- ── หน้า login ต้องอ่านแบรนด์ได้ก่อนล็อกอิน (co-brand) ────────────────────────
--   RLS เป็น row-level กรองคอลัมน์ไม่ได้ → ใช้ view เปิดเฉพาะคอลัมน์แบรนด์แทน
--   ⚠️ ห้ามเพิ่มคอลัมน์อื่นของ tenants เข้า view นี้เด็ดขาด (จะหลุดให้คนนอกเห็น)
--   ที่ยอมให้หลุด: เดา slug ถูก = รู้ว่าลูกค้ารายนั้นมีตัวตน — รับได้ ไม่มีข้อมูลธุรกิจติดไป
create or replace view tenant_branding
with (security_invoker = off) as
  select slug, brand_name, logo_url, brand_color
  from tenants where is_active;

grant select on tenant_branding to anon, authenticated;
