-- ============================================================================
-- 0006 RLS — สิทธิ์จริงฝั่ง DB (MIGRATION_PLAN sec 3.2 · ปิดช่องโหว่ entity-lock UI เดิม)
--   หลักการ: อ่านจำกัดตาม allowed_entity_ids (null = ALL) · เขียนตาม role
--   viewer = อ่านอย่างเดียวทุกตาราง (DoD Phase 1 test)
-- ============================================================================

-- ── helper (security definer อ่าน profiles ของ auth.uid() — bypass RLS กัน recursion)
create or replace function my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function my_entities() returns text[]
language sql stable security definer set search_path = public as $$
  select allowed_entity_ids from profiles where id = auth.uid();
$$;

-- เปิด RLS ทุกตาราง
alter table entities            enable row level security;
alter table bank_accounts       enable row level security;
alter table profiles            enable row level security;
alter table contacts            enable row level security;
alter table app_settings        enable row level security;
alter table integration_log     enable row level security;
alter table counters            enable row level security;
alter table materials           enable row level security;
alter table containers          enable row level security;
alter table products            enable row level security;
alter table log_material        enable row level security;
alter table log_ferment         enable row level security;
alter table log_distill         enable row level security;
alter table log_distill_run     enable row level security;
alter table log_ferment_monitor enable row level security;
alter table log_dilute          enable row level security;
alter table log_product         enable row level security;
alter table stock_product       enable row level security;
alter table transactions        enable row level security;
alter table transaction_items   enable row level security;
alter table tax_summaries       enable row level security;
alter table wht_certificates    enable row level security;
alter table scan_log            enable row level security;
alter table sale_menu           enable row level security;
alter table sales_orders        enable row level security;
alter table sales_order_items   enable row level security;
alter table warehouse_stock     enable row level security;
alter table stock_moves         enable row level security;
alter table report_runs         enable row level security;
alter table edit_log            enable row level security;

-- ── profiles: เห็นของตัวเอง (+ main เห็นหมด) · แก้ได้เฉพาะ main ────────────────
create policy profiles_sel on profiles for select
  using (id = auth.uid() or my_role() = 'main');
create policy profiles_write on profiles for all
  using (my_role() = 'main') with check (my_role() = 'main');

-- ── master ส่วนกลาง: authenticated อ่านได้ · เขียนเฉพาะ main ───────────────────
--    (pattern: policy select กว้าง + policy for-all เฉพาะ main; permissive OR กัน)
create policy bank_accounts_sel on bank_accounts for select using (auth.uid() is not null);
create policy bank_accounts_w   on bank_accounts for all using (my_role()='main') with check (my_role()='main');

create policy app_settings_sel on app_settings for select using (auth.uid() is not null);
create policy app_settings_w   on app_settings for all using (my_role()='main') with check (my_role()='main');

-- contacts: main + sale เขียนได้ (บัญชี+ขายร่วมกัน — FLOW sec 2)
create policy contacts_sel on contacts for select using (auth.uid() is not null);
create policy contacts_w   on contacts for all
  using (my_role() in ('main','sale')) with check (my_role() in ('main','sale'));

-- integration_log / counters: อ่านได้ · เขียนผ่าน RPC security definer เท่านั้น (ไม่มี write policy)
create policy integration_log_sel on integration_log for select using (auth.uid() is not null);
create policy counters_sel on counters for select using (auth.uid() is not null);

-- ── entity-scoped: อ่านตาม allowed_entity_ids · เขียนเฉพาะ main ในสโคป ─────────
create policy entities_sel on entities for select
  using (my_entities() is null or entity_id = any(my_entities()));
create policy entities_w on entities for all
  using (my_role()='main') with check (my_role()='main');

create policy tx_sel on transactions for select
  using (my_entities() is null or entity_id = any(my_entities()));
create policy tx_w on transactions for all
  using (my_role()='main' and (my_entities() is null or entity_id = any(my_entities())))
  with check (my_role()='main' and (my_entities() is null or entity_id = any(my_entities())));

create policy ti_sel on transaction_items for select using (
  exists (select 1 from transactions t where t.tx_id = transaction_items.tx_id
          and (my_entities() is null or t.entity_id = any(my_entities()))));
create policy ti_w on transaction_items for all
  using (my_role()='main') with check (my_role()='main');

create policy ts_sel on tax_summaries for select
  using (my_entities() is null or entity_id = any(my_entities()));
create policy ts_w on tax_summaries for all
  using (my_role()='main') with check (my_role()='main');

create policy wht_sel on wht_certificates for select
  using (my_entities() is null or entity_id = any(my_entities()));
create policy wht_w on wht_certificates for all
  using (my_role()='main') with check (my_role()='main');

create policy scan_log_sel on scan_log for select using (my_role() in ('main','viewer'));
create policy scan_log_w on scan_log for all using (my_role()='main') with check (my_role()='main');

-- ── โดเมนผลิต: master + log อ่านได้ทุกคน · เขียนเฉพาะ main ──────────────────────
--    (log ผลิตแก้/ลบได้จากแอปโดย main — FLOW sec 10; stock_product เขียนผ่าน trigger/RPC)
create policy materials_sel on materials for select using (auth.uid() is not null);
create policy materials_w on materials for all using (my_role()='main') with check (my_role()='main');
create policy containers_sel on containers for select using (auth.uid() is not null);
create policy containers_w on containers for all using (my_role()='main') with check (my_role()='main');
create policy products_sel on products for select using (auth.uid() is not null);
create policy products_w on products for all using (my_role()='main') with check (my_role()='main');

create policy log_material_sel on log_material for select using (auth.uid() is not null);
create policy log_material_w on log_material for all using (my_role()='main') with check (my_role()='main');
create policy log_ferment_sel on log_ferment for select using (auth.uid() is not null);
create policy log_ferment_w on log_ferment for all using (my_role()='main') with check (my_role()='main');
create policy log_distill_sel on log_distill for select using (auth.uid() is not null);
create policy log_distill_w on log_distill for all using (my_role()='main') with check (my_role()='main');
create policy log_distill_run_sel on log_distill_run for select using (auth.uid() is not null);
create policy log_distill_run_w on log_distill_run for all using (my_role()='main') with check (my_role()='main');
create policy log_ferment_monitor_sel on log_ferment_monitor for select using (auth.uid() is not null);
create policy log_ferment_monitor_w on log_ferment_monitor for all using (my_role()='main') with check (my_role()='main');
create policy log_dilute_sel on log_dilute for select using (auth.uid() is not null);
create policy log_dilute_w on log_dilute for all using (my_role()='main') with check (my_role()='main');
create policy log_product_sel on log_product for select using (auth.uid() is not null);
create policy log_product_w on log_product for all using (my_role()='main') with check (my_role()='main');

-- stock_product: อ่านได้ · เขียนผ่าน apply_stock_delta/recompute (security definer) เท่านั้น
create policy stock_product_sel on stock_product for select using (auth.uid() is not null);

-- ── โดเมนขาย: main + sale (ออเดอร์) · main + warehouse (คลัง) ───────────────────
create policy sale_menu_sel on sale_menu for select using (auth.uid() is not null);
create policy sale_menu_w on sale_menu for all using (my_role()='main') with check (my_role()='main');

create policy so_sel on sales_orders for select using (auth.uid() is not null);
create policy so_w on sales_orders for all
  using (my_role() in ('main','sale')) with check (my_role() in ('main','sale'));

create policy soi_sel on sales_order_items for select using (auth.uid() is not null);
create policy soi_w on sales_order_items for all
  using (my_role() in ('main','sale')) with check (my_role() in ('main','sale'));

create policy ws_sel on warehouse_stock for select using (auth.uid() is not null);
create policy ws_w on warehouse_stock for all
  using (my_role() in ('main','warehouse')) with check (my_role() in ('main','warehouse'));

create policy sm_sel on stock_moves for select using (auth.uid() is not null);
create policy sm_w on stock_moves for all
  using (my_role() in ('main','warehouse')) with check (my_role() in ('main','warehouse'));

-- ── รายงาน/audit ───────────────────────────────────────────────────────────────
create policy rr_sel on report_runs for select using (auth.uid() is not null);
create policy rr_w on report_runs for all using (my_role()='main') with check (my_role()='main');

-- edit_log: เฉพาะ main อ่าน · เขียนผ่าน trigger security definer เท่านั้น
create policy edit_log_sel on edit_log for select using (my_role()='main');
