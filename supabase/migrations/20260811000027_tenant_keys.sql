-- ============================================================================
-- 0027 tenant keys — ผ่าตัด PK/unique ให้แยกตาม tenant (NEXT_STEPS ข้อ 4.2)
--
--   ปัญหา: คีย์ทั้งหมดตอนนี้ unique ทั้งระบบ → ลูกค้าเจ้าที่ 2 ใช้ 'EID01', 'admin',
--   'C-0001', เลขบิล 'TR-20260811-0001' ซ้ำกับเจ้าแรกไม่ได้ = ขายไม่ได้
--
--   ★ ไม่ใช้วิธีเติม prefix ลงในเลขเอกสาร เพราะเลขบนกระดาษที่ลูกค้าเห็นจะเปลี่ยนหน้าตา
--     → ใช้ composite key (tenant_id, คีย์เดิม) แทน · ลูกค้าไม่รู้สึกอะไรเลย
--
--   หลักที่ใช้ตัดสินว่าคีย์ไหนพ่วง entity_id ด้วย:
--     · master ของลูกค้า (entities/contacts/materials/products/...) = (tenant_id, คีย์)
--       → รหัสสินค้า/ลูกค้าไม่ซ้ำกันข้ามโรงของลูกค้ารายเดียวกัน (ชัดเจนกว่า และ FK เหลือ 2 คอลัมน์)
--     · ยอดคงเหลือ/เมนู/batch ที่เป็นของ "โรงนั้น" จริง ๆ = (tenant_id, entity_id, คีย์)
--       ตาม NEXT_STEPS 4.2 — สต็อกคนละโรงต้องแยกกันเด็ดขาด
--
--   ⚠️ ต่างจาก NEXT_STEPS 1 จุด: `bank_accounts` เอกสารเขียนว่า unique(entity_id, account_name)
--      แต่ตารางนี้ใช้ `entity_ids text[]` (บัญชีใช้ร่วมข้ามกิจการ — Option A ใน 0001)
--      ไม่มีคอลัมน์ entity_id เดี่ยว → ทำได้แค่ (tenant_id, account_name) ถ้าฝืนใส่ entity_id
--      จะขัดกับดีไซน์บัญชีร่วมที่ใช้อยู่จริง
--
--   ⚠️ `log_distill` = กติกาเหล็ก 1 batch = 1 แถว (ฟอร์ม ภส.๐๗-๐๒/๑(๑) หักส่าต่อแถว
--      หลายแถว = หักซ้ำ = เลขยื่นราชการผิด) → ยังคง unique อยู่ แค่ขยายขอบเขตเป็นต่อโรง
-- ============================================================================

-- ── A. ปลด FK ที่ชี้ไปคีย์ที่กำลังจะเปลี่ยน ───────────────────────────────────
alter table log_material      drop constraint if exists log_material_material_id_fkey;
alter table log_ferment       drop constraint if exists log_ferment_container_id_fkey;
alter table log_product       drop constraint if exists log_product_product_id_fkey;
alter table stock_product     drop constraint if exists stock_product_product_id_fkey;
alter table sale_menu         drop constraint if exists sale_menu_product_id_fkey;
alter table transactions      drop constraint if exists transactions_entity_id_fkey;
alter table transactions      drop constraint if exists transactions_contact_id_fkey;
alter table transaction_items drop constraint if exists transaction_items_tx_id_fkey;
alter table tax_summaries     drop constraint if exists tax_summaries_entity_id_fkey;
alter table wht_certificates  drop constraint if exists wht_certificates_entity_id_fkey;
alter table wht_certificates  drop constraint if exists wht_certificates_contact_id_fkey;
alter table report_runs       drop constraint if exists report_runs_entity_id_fkey;
alter table sales_orders      drop constraint if exists sales_orders_customer_id_fkey;
alter table sales_order_items drop constraint if exists sales_order_items_qu_no_fkey;

-- `wht_certificates.entity_id` มี default 'EID01' ติดมาแต่ 0003 — ต้องถอด
-- ไม่งั้นลูกค้าที่ไม่มีกิจการรหัส EID01 จะ insert ไม่ผ่าน FK ใหม่
alter table wht_certificates alter column entity_id drop default;
alter table wht_certificates alter column entity_id set default my_default_entity();

-- ── B. เปลี่ยน PK / unique เป็น composite ────────────────────────────────────

-- master ของลูกค้า → (tenant_id, คีย์เดิม)
alter table entities      drop constraint entities_pkey,
                          add primary key (tenant_id, entity_id);

alter table bank_accounts drop constraint bank_accounts_pkey,
                          add primary key (tenant_id, account_id);
alter table bank_accounts drop constraint bank_accounts_account_name_key,
                          add constraint bank_accounts_account_name_key
                            unique (tenant_id, account_name);

alter table contacts      drop constraint contacts_pkey,
                          add primary key (tenant_id, contact_id);

alter table materials     drop constraint materials_pkey,
                          add primary key (tenant_id, material_id);
alter table materials     drop constraint materials_name_key,
                          add constraint materials_name_key unique (tenant_id, name);

alter table containers    drop constraint containers_pkey,
                          add primary key (tenant_id, container_id);

alter table products      drop constraint products_pkey,
                          add primary key (tenant_id, product_id);

alter table counters      drop constraint counters_pkey,
                          add primary key (tenant_id, key);

alter table app_settings  drop constraint app_settings_kind_value_key,
                          add constraint app_settings_kind_value_key
                            unique (tenant_id, kind, value);

-- ผู้ใช้: ชื่อผู้ใช้ซ้ำข้ามลูกค้าได้ (auth.users.email แยกด้วย slug — ดู lib/shared/auth-domain.ts)
alter table profiles      drop constraint profiles_username_key,
                          add constraint profiles_username_key unique (tenant_id, username);

-- เอกสารบัญชี/ขาย → (tenant_id, เลขเอกสาร) · เลขบนกระดาษไม่เปลี่ยนหน้าตา
alter table transactions      drop constraint transactions_pkey,
                              add primary key (tenant_id, tx_id);
alter table transaction_items drop constraint transaction_items_pkey,
                              add primary key (tenant_id, item_id);
alter table sales_orders      drop constraint sales_orders_pkey,
                              add primary key (tenant_id, qu_no);
alter table sales_orders      drop constraint sales_orders_order_no_key,
                              add constraint sales_orders_order_no_key
                                unique (tenant_id, order_no);
alter table wht_certificates  drop constraint wht_certificates_pkey,
                              add primary key (tenant_id, entity_id, doc_no);

-- ของที่เป็น "ของโรงนั้น" จริง ๆ → พ่วง entity_id ด้วย (NEXT_STEPS 4.2)
alter table stock_product   drop constraint stock_product_pkey,
                            add primary key (tenant_id, entity_id, product_id);
alter table warehouse_stock drop constraint warehouse_stock_pkey,
                            add primary key (tenant_id, entity_id, item_code);
alter table sale_menu       drop constraint sale_menu_menu_name_key,
                            add constraint sale_menu_menu_name_key
                              unique (tenant_id, entity_id, menu_name);

-- ★★ กติกาเหล็ก: 1 batch = 1 แถว — ยังบังคับอยู่ แค่ขยายขอบเขตเป็น "ต่อโรง"
alter table log_distill     drop constraint log_distill_batch_key,
                            add constraint log_distill_batch_key
                              unique (tenant_id, entity_id, batch);

-- unique index (ไม่ใช่ constraint) → drop index แล้วสร้างใหม่
drop index if exists contacts_name_branch_norm;
create unique index contacts_name_branch_norm on contacts
  (tenant_id, lower(trim(name)), coalesce(lower(trim(branch)), ''));

drop index if exists tx_idem;
create unique index tx_idem on transactions (tenant_id, idempotency_key)
  where idempotency_key is not null;

-- idempotency ของ integration — ต้องแยกต่อลูกค้า
-- ไม่งั้นงานของลูกค้า B ที่บังเอิญได้ key ซ้ำกับ A จะถูกมองว่า "ทำไปแล้ว" แล้วเงียบหายไป
drop index if exists integration_ok_key;
create unique index integration_ok_key on integration_log
  (tenant_id, action, idempotency_key)
  where status = 'ok' and idempotency_key is not null;

-- ── C. สร้าง FK ใหม่เป็น composite ───────────────────────────────────────────
alter table log_material add constraint log_material_material_id_fkey
  foreign key (tenant_id, material_id) references materials (tenant_id, material_id);
alter table log_ferment add constraint log_ferment_container_id_fkey
  foreign key (tenant_id, container_id) references containers (tenant_id, container_id);
alter table log_product add constraint log_product_product_id_fkey
  foreign key (tenant_id, product_id) references products (tenant_id, product_id);
alter table stock_product add constraint stock_product_product_id_fkey
  foreign key (tenant_id, product_id) references products (tenant_id, product_id);
alter table sale_menu add constraint sale_menu_product_id_fkey
  foreign key (tenant_id, product_id) references products (tenant_id, product_id);

alter table transactions add constraint transactions_entity_id_fkey
  foreign key (tenant_id, entity_id) references entities (tenant_id, entity_id);
alter table transactions add constraint transactions_contact_id_fkey
  foreign key (tenant_id, contact_id) references contacts (tenant_id, contact_id);
alter table transaction_items add constraint transaction_items_tx_id_fkey
  foreign key (tenant_id, tx_id) references transactions (tenant_id, tx_id);
alter table tax_summaries add constraint tax_summaries_entity_id_fkey
  foreign key (tenant_id, entity_id) references entities (tenant_id, entity_id);
alter table wht_certificates add constraint wht_certificates_entity_id_fkey
  foreign key (tenant_id, entity_id) references entities (tenant_id, entity_id);
alter table wht_certificates add constraint wht_certificates_contact_id_fkey
  foreign key (tenant_id, contact_id) references contacts (tenant_id, contact_id);
alter table report_runs add constraint report_runs_entity_id_fkey
  foreign key (tenant_id, entity_id) references entities (tenant_id, entity_id);
alter table sales_orders add constraint sales_orders_customer_id_fkey
  foreign key (tenant_id, customer_id) references contacts (tenant_id, contact_id);
alter table sales_order_items add constraint sales_order_items_qu_no_fkey
  foreign key (tenant_id, qu_no) references sales_orders (tenant_id, qu_no);

-- entity_id ที่ 0026 เติมไว้ — ผูก FK ได้แล้วเพราะ entities มี PK ใหม่แล้ว
-- (0026 จงใจไม่ผูก เพราะตอนนั้น PK ยังเป็น entity_id เดี่ยว)
do $$
declare
  t text;
  tables text[] := array[
    'materials','containers','products',
    'log_material','log_ferment','log_distill','log_distill_run','log_ferment_monitor',
    'log_dilute','log_product','stock_product',
    'sale_menu','sales_orders','warehouse_stock','stock_moves',
    'contacts'
  ];
begin
  foreach t in array tables loop
    if not exists (select 1 from pg_constraint where conname = t || '_entity_fk') then
      execute format(
        'alter table %I add constraint %I foreign key (tenant_id, entity_id)
           references entities (tenant_id, entity_id)', t, t || '_entity_fk');
    end if;
  end loop;
end $$;

-- ── D. แก้ on-conflict ที่พังเพราะ PK เปลี่ยน ────────────────────────────────
--   ต้องอยู่ไฟล์เดียวกับที่เปลี่ยน PK — ไม่งั้น DB จะค้างในสภาพเรียกฟังก์ชันไม่ได้
--   (ส่วนการ scope tenant ในตรรกะของฟังก์ชันทั้ง 25 ตัว อยู่ใน 0029)

-- เลขรันเอกสาร: ★ tenant มาจาก my_tenant() ไม่ใช่จาก caller
--   ถ้าเชื่อ p_key ที่ caller ส่งมา ลูกค้า A จะยิงกินเลขรันของ B ได้ (ฟังก์ชันนี้ security definer)
create or replace function next_serial(p_key text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v bigint;
  v_tenant uuid := my_tenant();
begin
  if v_tenant is null then
    raise exception 'next_serial: ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)';
  end if;

  insert into counters (tenant_id, key, value) values (v_tenant, p_key, 1)
  on conflict (tenant_id, key) do update set value = counters.value + 1
  returning value into v;
  return v;
end $$;

-- สต็อกสินค้า: PK เป็น (tenant_id, entity_id, product_id) แล้ว
create or replace function apply_stock_delta(p_product_id text, p_delta numeric)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_entity text := my_default_entity();
begin
  if v_tenant is null or v_entity is null then
    raise exception 'apply_stock_delta: ไม่รู้ว่าอยู่กิจการไหน';
  end if;

  insert into stock_product (tenant_id, entity_id, product_id, balance, last_updated)
  values (v_tenant, v_entity, p_product_id, p_delta, now())
  on conflict (tenant_id, entity_id, product_id) do update
    set balance = stock_product.balance + p_delta,
        last_updated = now();
end $$;

-- ซ่อม/seed balance — คิดแยกต่อ (tenant, entity) แล้ว
create or replace function recompute_stock_product() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into stock_product (tenant_id, entity_id, product_id, balance, last_updated)
  select tenant_id, entity_id, product_id, 0, now() from products
  on conflict (tenant_id, entity_id, product_id)
    do update set balance = 0, last_updated = now();

  update stock_product s
    set balance = coalesce(agg.bal, 0), last_updated = now()
  from (
    select tenant_id, entity_id, product_id,
           sum(case when trans_type = 'รับ' then amount else -amount end) as bal
    from log_product group by tenant_id, entity_id, product_id
  ) agg
  where s.tenant_id = agg.tenant_id
    and s.entity_id = agg.entity_id
    and s.product_id = agg.product_id;
end $$;

-- ── E. เก็บกวาด index ที่ซ้ำซ้อนกับ PK ใหม่ ──────────────────────────────────
--   0025 เติม index (tenant_id) ให้ทุกตาราง · ตารางที่ตอนนี้ PK ขึ้นต้นด้วย tenant_id แล้ว
--   ไม่ต้องมีอีก (Postgres ใช้ index ของ PK แทนได้) — ลดภาระตอนเขียน
drop index if exists entities_tenant_idx;
drop index if exists bank_accounts_tenant_idx;
drop index if exists contacts_tenant_idx;
drop index if exists materials_tenant_idx;
drop index if exists containers_tenant_idx;
drop index if exists products_tenant_idx;
drop index if exists counters_tenant_idx;
drop index if exists transactions_tenant_idx;
drop index if exists transaction_items_tenant_idx;
drop index if exists sales_orders_tenant_idx;
drop index if exists wht_certificates_tenant_idx;
drop index if exists stock_product_tenant_idx;
drop index if exists warehouse_stock_tenant_idx;

notify pgrst, 'reload schema';
