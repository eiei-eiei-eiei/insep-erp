-- ============================================================================
-- 0054 ชำระภาษี: ภพ.30 · ภงด.3 · ภงด.53 — D88
--
-- 🎯 เดิม "เดือนนี้ต้องจ่ายภาษีเท่าไหร่" อ่านได้จากแบบที่สร้าง แต่ **ไม่มีที่ไหนในระบบ
--    บันทึกว่าจ่ายไปแล้ว** → เงินออกจากบัญชีจริงแต่ยอดเงินสดในแอปไม่ขยับ
--    และไม่มีอะไรกันการจ่ายซ้ำงวดเดิม
--
-- ── ขอบเขต: 3 แบบเท่านั้น ────────────────────────────────────────────────────
-- 🚨 **ห้ามเติม ภงด.1 / สปส.1-10 เข้ามาที่นี่** — โมดูลเงินเดือนลงบัญชี 2 ตัวนั้น
--    อยู่แล้วผ่าน `pay_post_legs` → `fn_post_payroll` (D67)
--    เติมทางที่ 2 = **ลงรายจ่ายซ้ำ โดยไม่มีอะไรใน DB ฟ้อง**
--
-- ── ทำไมเป็นตารางใหม่ ไม่ผูก FK ไป tax_summaries ───────────────────────────
-- 🪤 `recordTaxSummaryAction` **ลบแถวเดิมทิ้งแล้ว insert ใหม่ทุกครั้งที่กด "สร้าง ภพ.30"**
--    และหน้าจอยังมีปุ่มลบแถวนั้นด้วย → ผูก FK เมื่อไหร่ ใบจ่ายที่บันทึกไปแล้วจะขาดสาย
--    หรือยอดที่ "จ่ายไปแล้ว" เปลี่ยนตัวเองเงียบ ๆ (ตระกูล D75)
--    → **แช่ยอดไว้ในแถวของตัวเอง** (`amount` + `computed_amount`)
--
-- ── ทำไมต้องเป็น RPC ไม่ใช่เรียก fn_save_transaction ตรง ๆ ──────────────────
-- `fn_save_transaction` ไม่รับ idempotency_key และไม่รู้จักงวดภาษี → กันจ่ายซ้ำไม่ได้
-- ★ และงานนี้ **ไม่มีสูตรเงินอยู่ใน SQL เลยสักบรรทัด** (ยอดถูกส่งมาจากฝั่ง TS ที่มี
--   golden test คุม) จึงไม่ขัดกับ D79/D86 ที่ห้ามให้สูตรเงินมี 2 ที่
--
-- 🪤 กันจ่ายซ้ำด้วย **partial unique index ของตารางเอง** ไม่ใช่ `integration_log`
--    เพราะ `fn_post_payroll` ใช้ integration_log เป็นตัวกัน แล้วตอน unpost แค่เปลี่ยน
--    status เป็น 'duplicate' โดยแถวยังอยู่ → **ถอนแล้วลงใหม่ = ไม่เกิดอะไรขึ้นเลย
--    แต่ตอบ ok** (บั๊กที่ยังอยู่ในเงินเดือน — ที่นี่จงใจไม่ลอกมา)
-- ============================================================================

create table if not exists tax_payments (
  id            bigserial primary key,
  tenant_id     uuid not null default my_tenant(),
  entity_id     text not null,
  kind          text not null check (kind in ('vat','pnd3','pnd53')),
  period        text not null,                    -- 'yyyy-MM' = งวดภาษี (ไม่ใช่เดือนที่จ่าย)
  amount        numeric(14,2) not null,           -- ยอดที่จ่ายจริง (ผู้ใช้แก้ได้ก่อนกด)
  computed_amount numeric(14,2),                  -- ยอดที่ระบบคำนวณได้ ณ วันกด (ไว้ย้อนดูว่าต่างไหม)
  surcharge     numeric(14,2) not null default 0, -- เบี้ยปรับ/เงินเพิ่ม (ยื่นช้า)
  pay_date      date not null,
  account_name  text,
  category      text,
  surcharge_category text,
  contact_name  text,
  contact_id    text,
  note          text,
  tx_id            text,                          -- บิลตัวภาษี
  surcharge_tx_id  text,                          -- บิลเบี้ยปรับ (ถ้ามี)
  status        text not null default 'ปกติ' check (status in ('ปกติ','ยกเลิก')),
  created_at    timestamptz not null default now(),
  created_by    uuid,
  voided_at     timestamptz,
  voided_by     uuid
);

-- FK ไป tenants — ★ **ไม่ใส่ on delete cascade** ให้เหมือนตารางอื่นทั้งระบบ
-- 🪤 ใส่ cascade = ลบ tenant แล้วแถวหายให้เอง ซึ่งฟังดูดี แต่มันจะ**กลบเสียงเตือน**
--    ที่ทั้งระบบพึ่งอยู่: ตกตารางใน fn_mig_truncate แล้ว delete from tenants ต้องล้มให้เห็น
--    (ทั้ง D79 และ D82 ถูกจับได้ด้วยกลไกนี้)
alter table tax_payments drop constraint if exists tax_payments_tenant_fk;
alter table tax_payments add constraint tax_payments_tenant_fk
  foreign key (tenant_id) references tenants(id);

-- entity_id ผูก entities แบบ composite เหมือนตารางอื่นหลัง 0027
alter table tax_payments drop constraint if exists tax_payments_entity_id_fkey;
alter table tax_payments add constraint tax_payments_entity_id_fkey
  foreign key (tenant_id, entity_id) references entities(tenant_id, entity_id);

-- 🚨 หัวใจของการกันจ่ายซ้ำ: 1 กิจการ + 1 แบบ + 1 งวด มีใบจ่ายที่ยังไม่ถูกถอนได้ใบเดียว
--    (แถวที่ถอนแล้วเหลืออยู่เป็นประวัติ และไม่กันการจ่ายรอบใหม่)
create unique index if not exists tax_pay_one_active
  on tax_payments (tenant_id, entity_id, kind, period) where status = 'ปกติ';
create index if not exists tax_pay_lookup
  on tax_payments (tenant_id, entity_id, period, kind, status);

alter table tax_payments enable row level security;

-- อ่าน: acct.read + ขอบเขตกิจการของผู้ใช้
-- 🪤 **ไม่มี policy สำหรับเขียนโดยตั้งใจ** — เขียนผ่าน RPC (definer) เท่านั้น
--    เหตุผล: `for all` ครอบ SELECT ด้วย และ policy permissive ถูก OR กัน →
--    policy เขียนที่กว้างกว่าจะ**ทับเงื่อนไขขอบเขตกิจการของ policy อ่าน** (บทเรียน D85/0052)
create policy tax_pay_sel on tax_payments for select
  using (tenant_id = my_tenant() and has_cap('acct.read')
         and (my_entities() is null or entity_id = any(my_entities())));

comment on table tax_payments is
  'บันทึกการชำระภาษี ภพ.30/ภงด.3/ภงด.53 ต่อกิจการต่องวด (D88) · เขียนผ่าน fn_pay_tax/fn_unpay_tax เท่านั้น';

-- ── fn_pay_tax ───────────────────────────────────────────────────────────────
--
-- p_payload: { accountName, category, surchargeCategory, contactName, contactId,
--              note, computedAmount, description, surchargeDescription }
create or replace function fn_pay_tax(
  p_kind      text,
  p_period    text,
  p_entity    text,
  p_date      date,
  p_amount    numeric,
  p_surcharge numeric,
  p_payload   jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_id     bigint;
  v_tx     text;
  v_sur_tx text := null;
  v_ok     boolean;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if not has_cap('acct.write') then raise exception 'ไม่มีสิทธิ์บันทึกการจ่ายภาษี'; end if;
  if p_kind not in ('vat','pnd3','pnd53') then raise exception 'ไม่รู้จักชนิดภาษี: %', p_kind; end if;
  if coalesce(p_entity,'') = '' then raise exception 'ต้องระบุกิจการ — แต่ละกิจการยื่นและจ่ายแยกใบ'; end if;
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'งวดต้องเป็นรูปแบบ yyyy-MM'; end if;
  if p_date is null then raise exception 'ต้องระบุวันที่จ่าย'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'ยอดที่จ่ายต้องมากกว่า 0'; end if;
  if coalesce(p_surcharge,0) < 0 then raise exception 'เบี้ยปรับติดลบไม่ได้'; end if;

  -- 🚨 กิจการที่ไม่ได้จด VAT ไม่มีหน้าที่ยื่น ภพ.30 → บล็อกที่ DB ด้วย ไม่ใช่แค่ซ่อนปุ่ม
  --    (กติกาเดียวกับ trigger ใบกำกับภาษีใน 0036 · ยิง API ตรงก็ไม่รอด)
  if p_kind = 'vat' and not entity_is_vat(v_tenant, p_entity) then
    raise exception 'กิจการนี้ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม จึงไม่มี ภพ.30 ให้ชำระ';
  end if;

  -- ต้องสร้างแบบของงวดนั้นก่อนถึงจะจ่ายได้ (ยอดที่จ่าย = ยอดที่ยื่นจริง)
  if p_kind = 'vat' then
    select exists(select 1 from tax_summaries
                   where tenant_id = v_tenant and entity_id = p_entity and report_month = p_period)
      into v_ok;
    if not v_ok then
      raise exception 'ยังไม่ได้สร้าง ภพ.30 ของงวด % — กดปุ่มสร้างแบบก่อน แล้วค่อยบันทึกจ่าย', p_period;
    end if;
  else
    select exists(select 1 from report_runs
                   where tenant_id = v_tenant and entity_id = p_entity
                     and month = p_period and report_key = 'pnd_3_53')
      into v_ok;
    if not v_ok then
      raise exception 'ยังไม่ได้สร้าง ภงด.3/53 ของงวด % — กดปุ่มสร้างแบบก่อน แล้วค่อยบันทึกจ่าย', p_period;
    end if;
  end if;

  -- กันจ่ายซ้ำ: ให้ unique index เป็นคนตัดสิน (ปลอดภัยกับการกดพร้อมกัน 2 หน้าต่าง)
  begin
    insert into tax_payments(
      tenant_id, entity_id, kind, period, amount, computed_amount, surcharge, pay_date,
      account_name, category, surcharge_category, contact_name, contact_id, note, created_by
    ) values (
      v_tenant, p_entity, p_kind, p_period, p_amount,
      nullif(p_payload->>'computedAmount','')::numeric, coalesce(p_surcharge,0), p_date,
      nullif(p_payload->>'accountName',''), nullif(p_payload->>'category',''),
      nullif(p_payload->>'surchargeCategory',''), nullif(p_payload->>'contactName',''),
      nullif(p_payload->>'contactId',''), nullif(p_payload->>'note',''), auth.uid()
    ) returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false,
      'error', 'งวดนี้บันทึกการจ่ายไปแล้ว — ถ้าต้องแก้ ให้ถอนการบันทึกจ่ายก่อน');
  end;

  -- บิลตัวภาษี
  -- ★ vat_amount / wht_amount = 0 เสมอ → ไม่วนกลับเข้า ภพ.30 หรือ ภงด. ของเดือนถัดไป
  --   (`taxReport`/`whtReport` คัดเฉพาะแถวที่ค่านั้น > 0 · มีเทสล็อกไว้ที่ taxPay.test.ts)
  v_tx := next_tx_id();
  insert into transactions(
    tenant_id, tx_id, transaction_date, type, account_name, category,
    contact_name, contact_id, description,
    base_amount, amount_after_discount, vat_amount, wht_amount, net_amount,
    status, entity_id, payment_date, idempotency_key, source
  ) values (
    v_tenant, v_tx, p_date, 'รายจ่าย',
    nullif(p_payload->>'accountName',''), nullif(p_payload->>'category',''),
    nullif(p_payload->>'contactName',''), nullif(p_payload->>'contactId',''),
    coalesce(nullif(p_payload->>'description',''), p_kind || ' ' || p_period),
    p_amount, p_amount, 0, 0, p_amount,
    'ปกติ', p_entity, p_date,
    'TAXPAY-' || v_id::text, 'tax'
  );

  -- 🚨 เบี้ยปรับ/เงินเพิ่มแยกบิลคนละหมวด — เป็นรายจ่ายต้องห้ามที่ต้องบวกกลับสิ้นปี
  --    รวมบิลเดียวกับตัวภาษีเมื่อไหร่ ผู้ทำบัญชีแยกออกมาไม่ได้อีกเลย
  if coalesce(p_surcharge,0) > 0 then
    v_sur_tx := next_tx_id();
    insert into transactions(
      tenant_id, tx_id, transaction_date, type, account_name, category,
      contact_name, contact_id, description,
      base_amount, amount_after_discount, vat_amount, wht_amount, net_amount,
      status, entity_id, payment_date, idempotency_key, source
    ) values (
      v_tenant, v_sur_tx, p_date, 'รายจ่าย',
      nullif(p_payload->>'accountName',''),
      coalesce(nullif(p_payload->>'surchargeCategory',''), nullif(p_payload->>'category','')),
      nullif(p_payload->>'contactName',''), nullif(p_payload->>'contactId',''),
      coalesce(nullif(p_payload->>'surchargeDescription',''), p_kind || ' ' || p_period || ' เบี้ยปรับ'),
      p_surcharge, p_surcharge, 0, 0, p_surcharge,
      'ปกติ', p_entity, p_date,
      'TAXPAY-' || v_id::text || '-SUR', 'tax'
    );
  end if;

  update tax_payments set tx_id = v_tx, surcharge_tx_id = v_sur_tx where id = v_id;

  insert into integration_log(tenant_id, action, idempotency_key, status, message, payload)
  values (v_tenant, 'PAY_TAX', v_id::text, 'ok',
          'บันทึกจ่าย ' || p_kind || ' งวด ' || p_period || ' (' || p_entity || ')',
          jsonb_build_object('amount', p_amount, 'surcharge', coalesce(p_surcharge,0), 'tx_id', v_tx));

  return jsonb_build_object('ok', true, 'id', v_id, 'tx_id', v_tx, 'surcharge_tx_id', v_sur_tx);
end $$;

-- ── fn_unpay_tax ─────────────────────────────────────────────────────────────
--
-- 🚨 ถอน = **acct.config** (หัวหน้าบัญชี/เจ้าของ) ไม่ใช่ acct.write
--    เพราะถอนแล้วบิลกลายเป็น 'ยกเลิก' → ยอดเงินสดของกิจการขยับย้อนหลัง
-- ★ ไม่ลบบิลทิ้ง (soft-void) เหมือนทุกที่ในระบบ
create or replace function fn_unpay_tax(p_kind text, p_period text, p_entity text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_id     bigint;
  v_tx     text;
  v_sur    text;
  v_n      int := 0;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if not has_cap('acct.config') then
    raise exception 'ต้องมีสิทธิ์ตั้งค่าหน้าบัญชีถึงจะถอนการบันทึกจ่ายภาษีได้';
  end if;

  select id, tx_id, surcharge_tx_id into v_id, v_tx, v_sur
    from tax_payments
   where tenant_id = v_tenant and entity_id = p_entity
     and kind = p_kind and period = p_period and status = 'ปกติ';
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'งวดนี้ยังไม่มีการบันทึกจ่าย');
  end if;

  update transactions set status = 'ยกเลิก'
   where tenant_id = v_tenant and tx_id in (v_tx, v_sur) and status <> 'ยกเลิก';
  get diagnostics v_n = row_count;

  update tax_payments set status = 'ยกเลิก', voided_at = now(), voided_by = auth.uid()
   where id = v_id;

  insert into integration_log(tenant_id, action, idempotency_key, status, message, payload)
  values (v_tenant, 'UNPAY_TAX', v_id::text, 'ok',
          'ถอนการบันทึกจ่าย ' || p_kind || ' งวด ' || p_period || ' (' || p_entity || ')',
          jsonb_build_object('tx_id', v_tx, 'voided', v_n));

  return jsonb_build_object('ok', true, 'voided', v_n);
end $$;

revoke execute on function fn_pay_tax(text, text, text, date, numeric, numeric, jsonb) from public;
grant  execute on function fn_pay_tax(text, text, text, date, numeric, numeric, jsonb) to authenticated;
revoke execute on function fn_unpay_tax(text, text, text) from public;
grant  execute on function fn_unpay_tax(text, text, text) to authenticated;

-- ── fn_mig_truncate — ยกมาจาก 0050 ทั้งดุ้น เติม 'tax_payments' ───────────────
-- 🚨 ตกตารางใหม่ = **ลบ/รีเซ็ตลูกค้าไม่ได้เลย** (ติด FK ของ tenants/entities)
--    และไฟล์สำรองจะขาดข้อมูลเงียบ ๆ · `tenantTables.test.ts` ไล่อ่านไฟล์นี้มาเทียบให้
-- ★ tax_payments มี entity_id FK → ต้องอยู่ **ก่อน** 'entities' (บทเรียน report_runs · D82)
create or replace function fn_mig_truncate(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t text;
  -- เรียงตามลำดับ FK (ลูกก่อนแม่) เพราะ delete ไม่ cascade เองเหมือน truncate
  tables text[] := array[
    'transaction_items','transactions','tax_summaries','tax_payments','wht_certificates',
    'log_material','log_ferment','log_distill','log_distill_run',
    'log_ferment_monitor','log_dilute','log_ferment_draw','log_product','stock_product',
    'sales_order_items','sales_orders','warehouse_stock','stock_moves','sale_menu',
    -- เงินเดือน (0040 + 0042) — ต้องมาก่อน entities ไม่งั้นติด FK
    'payroll_items','payroll_periods','employees',
    'pay_components','pay_inputs','pay_rates','pay_variables','pay_post_legs',
    'contacts','bank_accounts',
    'materials','containers','products',
    -- ★ report_runs มี entity_id FK → ต้องมาก่อน entities ด้วย (0050)
    'report_runs',
    'entities',
    'app_settings','integration_log','edit_log','counters'
  ];
begin
  if p_tenant is null then
    raise exception 'fn_mig_truncate: ต้องระบุ tenant — ห้ามล้างข้ามลูกค้า';
  end if;
  foreach t in array tables loop
    execute format('delete from %I where tenant_id = $1', t) using p_tenant;
  end loop;
end $$;

revoke execute on function fn_mig_truncate(uuid) from public;
grant  execute on function fn_mig_truncate(uuid) to service_role;

notify pgrst, 'reload schema';
