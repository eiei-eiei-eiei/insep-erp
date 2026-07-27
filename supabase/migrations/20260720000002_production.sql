-- ============================================================================
-- 0002 production — โดเมนผลิต (MIGRATION_PLAN sec 2.4)
--   materials · containers · products · log_* · stock_product (+trigger)
-- ============================================================================

create table materials (
  material_id text primary key,             -- 'รหัสวัตถุดิบ'
  name text not null unique,                -- RECEIVE_MATERIAL match ด้วยชื่อเป๊ะ
  unit text
);

create table containers (
  container_id text primary key,
  container_type text,
  capacity_l numeric
);

create table products (
  product_id text primary key,
  name text not null,                       -- หลาย product_id ชื่อเดียวกันได้ (รายงาน aggregate ตามชื่อ)
  degree numeric,
  bottle_size_l numeric,
  liquor_type text,                         -- หัวฟอร์ม ภส.
  liquor_kind text
);

create table log_material (                 -- Log_Material 7 คอลัมน์
  id bigserial primary key,
  created_at timestamptz not null default now(),
  doc_date date not null,
  trans_type text not null check (trans_type in
    ('รับ','จ่าย','ผลิตสินค้าอื่น','เสียหาย','อื่นๆ','อื่น ๆ')),
  material_id text not null references materials(material_id),
  amount numeric not null,
  doc_ref text,                             -- เบิกหมัก = batch
  note text
);
create index lm_mat_date on log_material (material_id, doc_date);

create table log_ferment (                  -- Log_Ferment 8 คอลัมน์
  id bigserial primary key,
  created_at timestamptz not null default now(),
  ferment_date date not null,
  product_name text not null,
  batch text not null,                      -- n/yy — หลาย row/batch ได้ (หลายถัง)
  container_id text references containers(container_id),
  container_qty numeric,
  material_ids text,                        -- comma string ตามเดิม (fidelity — อย่า normalize)
  material_amounts text                     -- ★ค่าแรก = วัตถุดิบหลัก = ฐานคิดส่า (P4)
);
create index lf_batch on log_ferment (batch);

create table log_distill (                  -- Log_Distill 6 คอลัมน์
  id bigserial primary key,
  created_at timestamptz not null default now(),
  distill_date date not null,
  product_name text not null,
  batch text not null unique,               -- ★★ กฎเหล็ก 1 batch = 1 แถว (P3)
  vol numeric not null,
  abv numeric not null                      -- ดีกรี @20°C (ปรับเทียบแล้ว)
);

create table log_distill_run (              -- Log_DistillRun 17 คอลัมน์
  id bigserial primary key,
  created_at timestamptz not null default now(),  -- ★source of truth ของ timer
  run_id text not null,
  pot_no int not null,
  batch text not null,
  product_name text,
  minute numeric,
  phase text check (phase in ('เริ่มกลั่น','หัว','กลาง','หาง','จบหม้อ')),
  abv_obs numeric, temp_spirit numeric, abv20 numeric,
  cum_vol numeric,                          -- ★สะสมต่อช่วง (reset เมื่อเปลี่ยนช่วง — P8)
  flow_rate numeric, vapor_temp numeric, pot_temp numeric, cool_temp numeric,
  note text,
  ferm_charge numeric                       -- เฉพาะแถว marker 'เริ่มกลั่น'
);
create index ldr_batch on log_distill_run (batch, pot_no);

create table log_ferment_monitor (          -- Log_FermentMonitor 9 คอลัมน์
  id bigserial primary key,
  created_at timestamptz not null default now(),
  measure_date date not null,
  measure_time text,
  batch text not null,
  product_name text,
  ph numeric, brix numeric, temp numeric, note text
);
create index lfm_batch on log_ferment_monitor (batch);

create table log_dilute (                   -- Log_Dilute 10 คอลัมน์
  id bigserial primary key,
  created_at timestamptz not null default now(),
  dilute_date date not null,
  product_name text not null,
  bottle_size text,
  start_vol numeric, start_abv numeric, water numeric,
  final_vol numeric, final_abv numeric, note text
);

create table log_product (                  -- Log_Product 6 คอลัมน์
  id bigserial primary key,
  created_at timestamptz not null default now(),
  doc_date date not null,
  trans_type text not null check (trans_type in
    ('รับ','จ่าย','จำหน่ายต่างประเทศ','แตกหักเสียหาย','เสียหาย','อื่นๆ','อื่น ๆ')),
  product_id text not null references products(product_id),
  amount numeric not null,
  note text                                 -- มี ORDxxxxxx-NNN ถ้าจากแอปขาย
);
create index lp_prod_date on log_product (product_id, doc_date);

create table stock_product (                -- running balance (materialized)
  product_id text primary key references products(product_id),
  balance numeric not null default 0,
  last_updated timestamptz not null default now()
);

-- ── Stock running balance ────────────────────────────────────────────────────
-- ทิศทาง +/- ต้องตรง isStockInbound_ เดิมเป๊ะ: บวกเฉพาะ 'รับ' ที่เหลือลบหมด (P2)

-- security definer: ให้ trigger เขียน stock_product ทะลุ RLS ได้ (คนเขียน log_product = main)
create or replace function apply_stock_delta(p_product_id text, p_delta numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into stock_product (product_id, balance, last_updated)
  values (p_product_id, p_delta, now())
  on conflict (product_id) do update
    set balance = stock_product.balance + p_delta,
        last_updated = now();
end $$;

-- trigger ครอบ INSERT + UPDATE + DELETE (FLOW_REDESIGN sec 10.2)
-- แก้จำนวน/type/product/ลบแถว = balance ปรับเองทันที ไม่ต้องกด recompute
create or replace function trg_update_stock_product() returns trigger
language plpgsql as $$
declare
  old_delta numeric := 0;
  new_delta numeric := 0;
begin
  if (tg_op in ('INSERT','UPDATE')) then
    new_delta := case when new.trans_type = 'รับ' then new.amount else -new.amount end;
  end if;
  if (tg_op in ('DELETE','UPDATE')) then
    old_delta := case when old.trans_type = 'รับ' then old.amount else -old.amount end;
  end if;

  if (tg_op = 'DELETE') then
    perform apply_stock_delta(old.product_id, -old_delta);
    return old;
  elsif (tg_op = 'INSERT') then
    perform apply_stock_delta(new.product_id, new_delta);
    return new;
  else  -- UPDATE
    if (old.product_id = new.product_id) then
      perform apply_stock_delta(new.product_id, new_delta - old_delta);
    else
      perform apply_stock_delta(old.product_id, -old_delta);
      perform apply_stock_delta(new.product_id, new_delta);
    end if;
    return new;
  end if;
end $$;

create trigger log_product_stock
  after insert or update or delete on log_product
  for each row execute function trg_update_stock_product();

-- ซ่อม/seed balance จาก log ทั้งหมด (แทน runRecomputeStock + weeklyRecomputeStock)
-- pg_cron รายสัปดาห์ตั้งใน dashboard: select cron.schedule('weekly-recompute','0 3 * * 0',
--   $$select recompute_stock_product()$$);  (ต้องเปิด extension pg_cron ก่อน)
create or replace function recompute_stock_product() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into stock_product (product_id, balance, last_updated)
  select product_id, 0, now() from products
  on conflict (product_id) do update set balance = 0, last_updated = now();

  update stock_product s
    set balance = coalesce(agg.bal, 0), last_updated = now()
  from (
    select product_id,
           sum(case when trans_type = 'รับ' then amount else -amount end) as bal
    from log_product group by product_id
  ) agg
  where s.product_id = agg.product_id;
end $$;
