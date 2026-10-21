-- ============================================================================
-- 0085 · grant ตารางให้ครบแบบเขียนไว้เอง (D118)
--
-- 🔴 ต้นเรื่อง: Supabase เลิกแจก grant ให้ตารางใหม่อัตโนมัติ (project เดิม: ตั้งแต่ 2026-10-30
--    · project ใหม่: เลิกไปก่อนแล้ว) แต่ 0001-0084 ไม่มี grant ตารางเลยสักบรรทัด — พึ่ง default ทั้งหมด
--    ⇒ เปิด DB ก้อนใหม่ให้ลูกค้าแล้วรัน migration ครบ = **ทุกตารางได้ permission denied**
--
-- ★ บน DB เดิม (ของเจ้าของ + proof-app) ไฟล์นี้ **ไม่เปลี่ยนอะไร** — สิทธิ์เหล่านี้มีอยู่แล้วจาก default
--   ไฟล์นี้มีไว้ให้ DB ก้อนใหม่ได้สิทธิ์เท่ากับ DB เดิม
--
-- กติกา (แหล่งเดียว: lib/shared/tableGrants.ts):
--   · ตารางแอป            → select/insert/update/delete ให้ authenticated + service_role
--   · ตารางแพลตฟอร์ม (D54) → service_role เท่านั้น 🚨 ห้ามให้ authenticated (ราคาลูกค้าแต่ละเจ้า)
--   · anon                 → **ไม่ให้ตารางไหนเลย** — คนยังไม่ล็อกอินใช้แค่วิว tenant_branding (grant ไว้แล้วใน 0030)
--     DB เดิมยังมี grant ให้ anon ค้างจาก default (RLS กันอยู่) — จงใจไม่ถอน ไม่แตะระบบที่ใช้งานจริง
--   · sequence ของคอลัมน์ bigserial → usage, select (ไม่งั้น insert แถวใหม่ล้ม) · identity ไม่ต้อง
--
-- 🚨 ตั้งแต่ไฟล์นี้ไป: migration ที่ create table ต้อง grant ในไฟล์เดียวกันเสมอ
--    (lib/shared/tableGrantsSql.test.ts ฟ้องถ้าลืม · ห้ามใช้ "on all tables" — จะเปิดตารางแพลตฟอร์มด้วย)
-- ============================================================================

-- ── 1. ตารางแอป ─────────────────────────────────────────────────────────────
grant select, insert, update, delete on table public.entities to authenticated, service_role;
grant select, insert, update, delete on table public.bank_accounts to authenticated, service_role;
grant select, insert, update, delete on table public.app_settings to authenticated, service_role;
grant select, insert, update, delete on table public.contacts to authenticated, service_role;
grant select, insert, update, delete on table public.counters to authenticated, service_role;
grant select, insert, update, delete on table public.integration_log to authenticated, service_role;
grant select, insert, update, delete on table public.materials to authenticated, service_role;
grant select, insert, update, delete on table public.containers to authenticated, service_role;
grant select, insert, update, delete on table public.products to authenticated, service_role;
grant select, insert, update, delete on table public.log_material to authenticated, service_role;
grant select, insert, update, delete on table public.log_ferment to authenticated, service_role;
grant select, insert, update, delete on table public.log_distill to authenticated, service_role;
grant select, insert, update, delete on table public.log_distill_run to authenticated, service_role;
grant select, insert, update, delete on table public.log_ferment_monitor to authenticated, service_role;
grant select, insert, update, delete on table public.log_dilute to authenticated, service_role;
grant select, insert, update, delete on table public.log_ferment_draw to authenticated, service_role;
grant select, insert, update, delete on table public.log_product to authenticated, service_role;
grant select, insert, update, delete on table public.stock_product to authenticated, service_role;
grant select, insert, update, delete on table public.log_redistill to authenticated, service_role;
grant select, insert, update, delete on table public.log_redistill_round to authenticated, service_role;
grant select, insert, update, delete on table public.transactions to authenticated, service_role;
grant select, insert, update, delete on table public.transaction_items to authenticated, service_role;
grant select, insert, update, delete on table public.tax_summaries to authenticated, service_role;
grant select, insert, update, delete on table public.tax_payments to authenticated, service_role;
grant select, insert, update, delete on table public.tax_filings to authenticated, service_role;
grant select, insert, update, delete on table public.wht_certificates to authenticated, service_role;
grant select, insert, update, delete on table public.sale_menu to authenticated, service_role;
grant select, insert, update, delete on table public.sales_orders to authenticated, service_role;
grant select, insert, update, delete on table public.sales_order_items to authenticated, service_role;
grant select, insert, update, delete on table public.warehouse_stock to authenticated, service_role;
grant select, insert, update, delete on table public.stock_moves to authenticated, service_role;
grant select, insert, update, delete on table public.bar_category to authenticated, service_role;
grant select, insert, update, delete on table public.bar_item to authenticated, service_role;
grant select, insert, update, delete on table public.bar_customer to authenticated, service_role;
grant select, insert, update, delete on table public.bar_menu to authenticated, service_role;
grant select, insert, update, delete on table public.bar_recipe to authenticated, service_role;
grant select, insert, update, delete on table public.bar_customer_fav to authenticated, service_role;
grant select, insert, update, delete on table public.bar_receive to authenticated, service_role;
grant select, insert, update, delete on table public.bar_sale to authenticated, service_role;
grant select, insert, update, delete on table public.bar_sale_item to authenticated, service_role;
grant select, insert, update, delete on table public.bar_move to authenticated, service_role;
grant select, insert, update, delete on table public.bar_post to authenticated, service_role;
grant select, insert, update, delete on table public.pay_inputs to authenticated, service_role;
grant select, insert, update, delete on table public.pay_components to authenticated, service_role;
grant select, insert, update, delete on table public.pay_rates to authenticated, service_role;
grant select, insert, update, delete on table public.pay_variables to authenticated, service_role;
grant select, insert, update, delete on table public.pay_post_legs to authenticated, service_role;
grant select, insert, update, delete on table public.employees to authenticated, service_role;
grant select, insert, update, delete on table public.payroll_periods to authenticated, service_role;
grant select, insert, update, delete on table public.payroll_items to authenticated, service_role;
grant select, insert, update, delete on table public.report_runs to authenticated, service_role;
grant select, insert, update, delete on table public.excise_month_close to authenticated, service_role;
grant select, insert, update, delete on table public.doc_numbering to authenticated, service_role;
grant select, insert, update, delete on table public.edit_log to authenticated, service_role;
grant select, insert, update, delete on table public.profiles to authenticated, service_role;
grant select, insert, update, delete on table public.tenants to authenticated, service_role;

-- ── 2. ตารางแพลตฟอร์ม — service_role เท่านั้น ───────────────────────────────────
revoke all on table public.platform_admins from anon, authenticated;
grant select, insert, update, delete on table public.platform_admins to service_role;
revoke all on table public.platform_admin_log from anon, authenticated;
grant select, insert, update, delete on table public.platform_admin_log to service_role;
revoke all on table public.subscriptions from anon, authenticated;
grant select, insert, update, delete on table public.subscriptions to service_role;
revoke all on table public.subscription_payments from anon, authenticated;
grant select, insert, update, delete on table public.subscription_payments to service_role;

-- ── 3. sequence ของคอลัมน์ bigserial ───────────────────────────────────────────
grant usage, select on sequence public.app_settings_id_seq to authenticated, service_role;
grant usage, select on sequence public.integration_log_id_seq to authenticated, service_role;
grant usage, select on sequence public.log_material_id_seq to authenticated, service_role;
grant usage, select on sequence public.log_ferment_id_seq to authenticated, service_role;
grant usage, select on sequence public.log_distill_id_seq to authenticated, service_role;
grant usage, select on sequence public.log_distill_run_id_seq to authenticated, service_role;
grant usage, select on sequence public.log_ferment_monitor_id_seq to authenticated, service_role;
grant usage, select on sequence public.log_dilute_id_seq to authenticated, service_role;
grant usage, select on sequence public.log_product_id_seq to authenticated, service_role;
grant usage, select on sequence public.tax_summaries_id_seq to authenticated, service_role;
grant usage, select on sequence public.sale_menu_id_seq to authenticated, service_role;
grant usage, select on sequence public.sales_order_items_id_seq to authenticated, service_role;
grant usage, select on sequence public.stock_moves_id_seq to authenticated, service_role;
grant usage, select on sequence public.report_runs_id_seq to authenticated, service_role;
grant usage, select on sequence public.edit_log_id_seq to authenticated, service_role;
grant usage, select on sequence public.log_ferment_draw_id_seq to authenticated, service_role;
grant usage, select on sequence public.tax_payments_id_seq to authenticated, service_role;
grant usage, select on sequence public.excise_month_close_id_seq to authenticated, service_role;
grant usage, select on sequence public.log_redistill_id_seq to authenticated, service_role;
grant usage, select on sequence public.log_redistill_round_id_seq to authenticated, service_role;
grant usage, select on sequence public.bar_receive_id_seq to authenticated, service_role;
grant usage, select on sequence public.bar_move_id_seq to authenticated, service_role;
grant usage, select on sequence public.bar_post_id_seq to authenticated, service_role;
grant usage, select on sequence public.tax_filings_id_seq to authenticated, service_role;

-- ── 4. fn_audit_table_grants — ให้ db:audit-grants / test:tenant ถามสิทธิ์จริงจาก DB ──────
--   security invoker โดยตั้งใจ (has_table_privilege อ่านได้ทุก role อยู่แล้ว)
--   ★ วนจาก pg_class เอง → ตารางที่สร้างในอนาคตถูกตรวจอัตโนมัติ (ตารางที่ไม่อยู่ในรายชื่อ = ฟ้อง)
create or replace function fn_audit_table_grants()
returns table (
  name text, kind text, owner_table text, rls boolean,
  anon text[], authed text[], service text[]
)
language sql stable security invoker set search_path = public, pg_catalog as $fn$
  with rel as (
    select c.oid, c.relname::text as name,
           case c.relkind when 'r' then 'table' when 'p' then 'table' when 'v' then 'view' when 'S' then 'sequence' end as kind,
           case when c.relkind in ('r','p') then c.relrowsecurity end as rls,
           (select t.relname::text
              from pg_depend d join pg_class t on t.oid = d.refobjid
             where c.relkind = 'S' and d.objid = c.oid and d.classid = 'pg_class'::regclass
               and d.refclassid = 'pg_class'::regclass and d.deptype in ('a','i')
             limit 1) as owner_table,
           c.relkind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p','v','S')
  ),
  privs(p) as (values ('select'), ('insert'), ('update'), ('delete'), ('usage'))
  select r.name, r.kind, r.owner_table, r.rls,
    array(select p from privs where case when r.relkind = 'S'
            then p in ('select','usage') and has_sequence_privilege('anon', r.oid, p)
            else p <> 'usage' and has_table_privilege('anon', r.oid, p) end),
    array(select p from privs where case when r.relkind = 'S'
            then p in ('select','usage') and has_sequence_privilege('authenticated', r.oid, p)
            else p <> 'usage' and has_table_privilege('authenticated', r.oid, p) end),
    array(select p from privs where case when r.relkind = 'S'
            then p in ('select','usage') and has_sequence_privilege('service_role', r.oid, p)
            else p <> 'usage' and has_table_privilege('service_role', r.oid, p) end)
  from rel r
  order by 2, 1;
$fn$;

-- 🚨 ต้องอยู่ในไฟล์เดียวกันเสมอ (บทเรียน D99: revoke from public อย่างเดียวไม่มีผลบน Supabase)
revoke execute on function fn_audit_table_grants() from public, anon, authenticated;
grant  execute on function fn_audit_table_grants() to service_role;

notify pgrst, 'reload schema';
