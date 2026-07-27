-- ============================================================================
-- ชุด SQL สำหรับ paste ใน Supabase Dashboard → SQL Editor (เพราะ supabase CLI ถูก
-- Windows Application Control บล็อก — ดู DECISIONS D31)
-- รวม migration 0014-0017 · รันซ้ำได้ปลอดภัย · ไม่มีการลบข้อมูล (แค่สร้าง fn/แก้ schema)
-- ============================================================================


-- ═══════════════ 20260723000014_migration_helpers ═══════════════
-- ============================================================================
-- 0014 migration helpers (Phase 5) — เครื่องมือช่วย import/reconcile เท่านั้น
--   · fn_mig_truncate()        ล้างตารางข้อมูลทั้งหมดเพื่อโหลดใหม่ทับ (rerun/cutover)
--   · fn_mig_set_triggers(b)   ปิด/เปิด user trigger (audit + stock) ตอน bulk import
--   · fn_mig_recompute_stock() สร้าง stock_product จาก log_product (เรียกหลัง import)
-- เรียกผ่าน service role เท่านั้น (supabase-js .rpc) — DDL/TRUNCATE ทำผ่าน REST ไม่ได้
-- ⚠️ ทำลายข้อมูล — grant execute ให้ service_role อย่างเดียว
-- ============================================================================

-- ล้างทุกตารางที่ migration เขียน (ไม่แตะ profiles/auth.users — user สร้างเอง)
-- CASCADE + RESTART IDENTITY: ลบตามลำดับ FK อัตโนมัติ + reset bigserial
create or replace function fn_mig_truncate() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table
    transaction_items, transactions, tax_summaries, wht_certificates, scan_log,
    log_material, log_ferment, log_distill, log_distill_run,
    log_ferment_monitor, log_dilute, log_product, stock_product,
    sales_order_items, sales_orders, warehouse_stock, stock_moves, sale_menu,
    contacts, bank_accounts, entities,
    materials, containers, products,
    app_settings, integration_log, edit_log, report_runs, counters
  restart identity cascade;
end $$;

-- ปิด/เปิด user trigger บนตารางที่ import (audit_* + stock) — กัน edit_log บวมตอน bulk
-- + ให้ stock_product สร้างทีเดียวด้วย recompute (แทน trigger ยิงราย row)
create or replace function fn_mig_set_triggers(p_enable boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  t text;
  tbls text[] := array[
    'transactions','sales_orders',
    'log_material','log_ferment','log_distill','log_distill_run',
    'log_ferment_monitor','log_dilute','log_product'
  ];
begin
  foreach t in array tbls loop
    if p_enable then
      execute format('alter table %I enable trigger user', t);
    else
      execute format('alter table %I disable trigger user', t);
    end if;
  end loop;
end $$;

-- wrapper ให้เรียก recompute ผ่าน rpc ได้ (recompute_stock_product มีใน 0002 แล้ว)
create or replace function fn_mig_recompute_stock() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform recompute_stock_product();
end $$;

-- จำกัดสิทธิ์: อันตราย — เฉพาะ service_role (migration script) เท่านั้น
revoke execute on function fn_mig_truncate()            from public;
revoke execute on function fn_mig_set_triggers(boolean) from public;
revoke execute on function fn_mig_recompute_stock()     from public;
grant  execute on function fn_mig_truncate()            to service_role;
grant  execute on function fn_mig_set_triggers(boolean) to service_role;
grant  execute on function fn_mig_recompute_stock()     to service_role;

-- ═══════════════ 20260723000015_add_tax_record_type ═══════════════
-- ============================================================================
-- 0015 เพิ่ม type 'บันทึกภาษี' (ภาษีซื้อนำเข้า/ศุลกากร) — ตาม feedback ผู้ใช้ Phase 5
--   ผู้ใช้บันทึก import VAT (เคลียร์ขวดนำเข้า/ศุลกากร) เป็น type แยกจาก 'รายจ่าย'
--   พฤติกรรม (ดู DECISIONS D29):
--     · เข้า ภพ.30 ฝั่ง "ภาษีซื้อ" (lib/accounting/calc.ts taxReport)
--     · ไม่กระทบยอดบัญชี/เงินสด (ledger txEffect คืน 0 ให้ type นี้อยู่แล้ว — ไม่ต้องแก้)
-- ============================================================================

alter table transactions drop constraint if exists transactions_type_check;
alter table transactions add constraint transactions_type_check
  check (type in ('รายรับ','รายจ่าย','โอนระหว่างบัญชี','เช็คราคา','บันทึกภาษี'));

-- ═══════════════ 20260723000016_contact_multibranch ═══════════════
-- ============================================================================
-- 0016 คู่ค้าหลายสาขา (multi-branch) — ตาม feedback ผู้ใช้ Phase 5 (D30)
--   ลูกค้ารายเดียว (เลขภาษีเดียว) มีหลายสาขา ต้องออกเอกสารแยกสาขา
--   ระบบเดิมผูกด้วย "ชื่อ" → ชื่อซ้ำไม่ได้ + ภพ.30/50ทวิ ได้สาขามั่ว (บั๊กเดิม)
--   แก้: identity = contact_id · transaction เก็บ contact_id ระบุสาขาที่แน่นอน
-- ============================================================================

-- คลาย unique index: จากชื่ออย่างเดียว → (ชื่อ + สาขา) เพื่อให้ชื่อซ้ำต่างสาขาได้
-- (ยังกันซ้ำจริง = ชื่อเดียวกัน+สาขาเดียวกัน)
drop index if exists contacts_name_norm;
create unique index if not exists contacts_name_branch_norm
  on contacts (lower(trim(name)), coalesce(lower(trim(branch)), ''));

-- transaction อ้างสาขาที่แน่นอนด้วย contact_id (null = ข้อมูลเก่า/ยังไม่ระบุ → fallback ชื่อ)
alter table transactions add column if not exists contact_id text references contacts(contact_id);
create index if not exists tx_contact_id on transactions (contact_id) where contact_id is not null;

-- ═══════════════ 20260723000017_rpc_contact_id ═══════════════
-- ============================================================================
-- 0017 RPC รองรับ contact_id (multi-branch, D30) — recreate 2 ฟังก์ชันจาก 0011
--   fn_save_transaction / fn_save_installments: เก็บ contact_id (ระบุสาขาที่แน่นอน)
--   เพิ่มแค่คอลัมน์ contact_id ในการ insert — logic อื่นคงเดิมเป๊ะ
-- ============================================================================

create or replace function fn_save_transaction(
  p jsonb,
  p_items jsonb default '[]'::jsonb
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_tx_id text := next_tx_id();
  it jsonb;
  idx int := 0;
  fwd_items jsonb;
  fwd jsonb;
  warning text := null;
begin
  insert into transactions(
    tx_id, transaction_date, type, account_name, category, contact_name, contact_id, description,
    base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
    tax_invoice_no, tax_invoice_date, receipt_image_url, status, entity_id,
    ap_ar_status, due_date, source
  ) values (
    v_tx_id, _d(p,'transaction_date'), p->>'type', nullif(p->>'account_name',''), p->>'category',
    p->>'contact_name', nullif(p->>'contact_id',''), p->>'description',
    coalesce((p->>'base_amount')::numeric,0), coalesce((p->>'discount')::numeric,0),
    coalesce((p->>'amount_after_discount')::numeric,0), coalesce((p->>'vat_amount')::numeric,0),
    coalesce((p->>'wht_rate')::numeric,0), coalesce((p->>'wht_amount')::numeric,0),
    coalesce((p->>'net_amount')::numeric,0),
    nullif(p->>'tax_invoice_no',''), _d(p,'tax_invoice_date'), nullif(p->>'receipt_image_url',''),
    coalesce(nullif(p->>'status',''),'ปกติ'), p->>'entity_id',
    nullif(p->>'ap_ar_status',''), _d(p,'due_date'), coalesce(nullif(p->>'source',''),'ui')
  );

  for it in select value from jsonb_array_elements(p_items) loop
    idx := idx + 1;
    insert into transaction_items(
      item_id, tx_id, item_name, quantity, in_vat, ex_vat, total_price,
      discount_pct, discount_baht, item_category, item_job
    ) values (
      v_tx_id || '-' || lpad(idx::text,2,'0'), v_tx_id, it->>'item_name',
      coalesce((it->>'quantity')::numeric,1), coalesce((it->>'in_vat')::numeric,0),
      coalesce((it->>'ex_vat')::numeric,0), coalesce((it->>'total_price')::numeric,0),
      coalesce((it->>'discount_pct')::numeric,0), coalesce((it->>'discount_baht')::numeric,0),
      nullif(it->>'item_category',''), nullif(it->>'item_job','')
    );
  end loop;

  if coalesce((p->>'forward_material')::boolean,false)
     and jsonb_array_length(coalesce(p_items,'[]'::jsonb)) > 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
             'material_name', it->>'item_name', 'amount', coalesce((it->>'quantity')::numeric,0))),'[]'::jsonb)
      into fwd_items from jsonb_array_elements(p_items) it;
    begin
      fwd := fn_receive_material(
        v_tx_id, _d(p,'transaction_date'),
        case when coalesce(p->>'tax_invoice_no','') <> '' and p->>'tax_invoice_no' <> '-'
             then p->>'tax_invoice_no' else v_tx_id end,
        'รับจาก ' || coalesce(nullif(p->>'contact_name',''),'ไม่ระบุชื่อ') ||
          case when coalesce(p->>'description','') <> '' then ' (' || (p->>'description') || ')' else '' end,
        fwd_items);
    exception when others then
      warning := 'บันทึกบัญชีสำเร็จ แต่รับวัตถุดิบเข้าสต็อกผลิตไม่ได้: ' || sqlerrm ||
                 ' — ตรวจชื่อวัตถุดิบ/เพิ่มใน master แล้วบันทึกรับเองในแอปผลิต';
    end;
  end if;

  return jsonb_build_object('ok', true, 'tx_id', v_tx_id, 'warning', warning);
end $$;

create or replace function fn_save_installments(
  p jsonb,
  p_rows jsonb,
  p_items jsonb default '[]'::jsonb
) returns jsonb
language plpgsql set search_path = public as $$
declare
  r jsonb; it jsonb;
  v_tx_id text;
  v_group text := null;
  ap_status text := case when p->>'type' = 'รายรับ' then 'AR' else 'AP' end;
  idx int := 0; n int := 0;
begin
  for r in select value from jsonb_array_elements(p_rows) loop
    v_tx_id := next_tx_id();
    if v_group is null then v_group := v_tx_id; end if;
    n := n + 1;
    insert into transactions(
      tx_id, transaction_date, type, account_name, category, contact_name, contact_id, description,
      base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
      status, entity_id, ap_ar_status, po_group_id, installment_no, installment_total, due_date, source
    ) values (
      v_tx_id, _d(p,'transaction_date'), p->>'type', '', p->>'category', p->>'contact_name',
      nullif(p->>'contact_id',''), r->>'description',
      coalesce((r->>'base')::numeric,0), 0, coalesce((r->>'base')::numeric,0),
      coalesce((r->>'vat_amount')::numeric,0), coalesce((r->>'wht_rate')::numeric,0),
      coalesce((r->>'wht_amount')::numeric,0), coalesce((r->>'net_amount')::numeric,0),
      'ปกติ', p->>'entity_id', ap_status, v_group,
      (r->>'installment_no')::int, (r->>'installment_total')::int, _d(r,'due_date'), 'ui'
    );
  end loop;

  for it in select value from jsonb_array_elements(p_items) loop
    idx := idx + 1;
    insert into transaction_items(
      item_id, tx_id, item_name, quantity, in_vat, ex_vat, total_price,
      discount_pct, discount_baht, item_category, item_job
    ) values (
      v_group || '-' || lpad(idx::text,2,'0'), v_group, it->>'item_name',
      coalesce((it->>'quantity')::numeric,1), coalesce((it->>'in_vat')::numeric,0),
      coalesce((it->>'ex_vat')::numeric,0), coalesce((it->>'total_price')::numeric,0),
      coalesce((it->>'discount_pct')::numeric,0), coalesce((it->>'discount_baht')::numeric,0),
      nullif(it->>'item_category',''), nullif(it->>'item_job','')
    );
  end loop;

  return jsonb_build_object('ok', true, 'po_group_id', v_group, 'count', n);
end $$;

-- บังคับ PostgREST รีเฟรช schema cache (ให้เห็น fn/คอลัมน์ใหม่ทันที)
notify pgrst, 'reload schema';
