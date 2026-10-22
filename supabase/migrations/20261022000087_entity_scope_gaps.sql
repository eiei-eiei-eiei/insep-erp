-- ============================================================================
-- 0087 จำกัดผู้ใช้ให้เห็นเฉพาะบางกิจการ — อุดรูที่ allowed_entity_ids ยังไม่ครอบ (D120)
--
-- 🎯 โจทย์: ลูกค้า PAT&AIM ให้พนักงาน (คุณเอม) เห็นแค่บริษัท EID01
--    กิจการที่เหลือเป็นข้อมูลส่วนตัวของเจ้าของ
--
-- ★ ฐานมีอยู่แล้วตั้งแต่ 0006: profiles.allowed_entity_ids + my_entities() และ RLS ฝั่ง
--   select ของ transactions/tax/wht/employees/payroll_periods/entities กรองให้แล้ว
--   แต่ไล่ policy ล่าสุดของทุกตารางแล้วพบ 3 กลุ่มที่ยังรั่ว:
--
--   1) bank_accounts ทุกคนอ่าน/แก้ได้ทุกบัญชี — พนักงานเห็นชื่อบัญชีส่วนตัวพร้อมยอดยกมา
--      และคนที่มี acct.config แก้บัญชีส่วนตัวได้
--   2) ฝั่ง "เขียน" ของตารางลูก ไม่มีขอบเขตกิจการ (policy select กรองแล้ว แต่ for all ไม่ได้กรอง):
--      transaction_items · tax_summaries · wht_certificates · report_runs · payroll_items
--      🚨 ร้ายสุดคือ ti_w: ลบรายการสินค้าของบิลที่ตัวเองมองไม่เห็นได้ ถ้ารู้เลข tx_id
--      (DELETE ใช้ USING ของ policy for all ⇒ ผ่าน เพราะไม่มีเงื่อนไขกิจการ)
--      และ payroll_items อ่านข้ามกิจการได้ด้วย (ไม่มี entity_id ในตัว ต้องไล่ผ่านงวด)
--   3) RPC security definer ที่รับกิจการมาเอง แต่ไม่ถามว่าผู้เรียกมีสิทธิ์ในกิจการนั้น:
--      fn_pay_tax · fn_unpay_tax · fn_post_payroll · fn_unpost_payroll · fn_wht_doc_nos
--      (definer = ข้าม RLS ⇒ จ่ายภาษี/ลงบัญชีเงินเดือนเข้ากิจการที่มองไม่เห็นได้)
--      ★ fn_file_tax/fn_unfile_tax (0072) และ bar_guard (0065) มีด่านนี้อยู่แล้ว — ยกแพตเทิร์นมาใช้
--
-- 🚨 ขอบเขตที่จงใจยังไม่ครอบ: ตารางฝั่ง ผลิต/ขาย/บาร์ ไม่ได้กรองตามกิจการเลยตั้งแต่ต้น
--    (คนที่ถูกจำกัดยังเห็นข้อมูลผลิต/ขายของทุกกิจการ) — บอกบนหน้าจอตั้งค่าผู้ใช้ตรง ๆ
--    contacts ใช้ร่วมทั้ง tenant (ผู้ใช้ตกลงแล้ว — เห็นชื่อร้านแต่ไม่เห็นยอดเงิน)
-- ★ main ไม่ถูกจำกัด — แอปไม่ยอมตั้งให้ main (มีสิทธิ์ admin แก้ profile ตัวเองคืนได้อยู่แล้ว)
-- ★ ไม่มีตารางใหม่ (D118) · ไม่มี definer ใหม่ · ยกฟังก์ชันด้วย scripts/gen/gen-0087.mjs (D79)
-- ============================================================================

-- ── 1. bank_accounts — เห็น/แก้ได้เฉพาะบัญชีของกิจการที่มีสิทธิ์ ─────────────────
-- entity_ids ว่าง = บัญชีที่ใช้ร่วมทุกกิจการ → ทุกคนเห็น (ความหมายเดิมทั้งแอป)
drop policy if exists bank_accounts_sel on bank_accounts;
create policy bank_accounts_sel on bank_accounts for select
  using (tenant_id = my_tenant()
         and (my_entities() is null
              or coalesce(array_length(entity_ids, 1), 0) = 0
              or entity_ids && my_entities()));
drop policy if exists bank_accounts_w on bank_accounts;
create policy bank_accounts_w on bank_accounts for all
  using (tenant_id = my_tenant() and has_cap('acct.config')
         and (my_entities() is null
              or coalesce(array_length(entity_ids, 1), 0) = 0
              or entity_ids && my_entities()))
  with check (tenant_id = my_tenant() and has_cap('acct.config')
         and (my_entities() is null
              or coalesce(array_length(entity_ids, 1), 0) = 0
              or entity_ids <@ my_entities()));
-- 🪤 with check ใช้ <@ (ทุกกิจการของบัญชีต้องอยู่ในสิทธิ์) ไม่ใช่ && — ไม่งั้นพนักงานเพิ่มบัญชี
--    ที่ผูก [EID01, EID02] แล้วไปโผล่ในกิจการที่ตัวเองไม่มีสิทธิ์ได้

-- ── 2. ฝั่งเขียนของตารางลูก — ขอบเขตเดียวกับฝั่งอ่าน ─────────────────────────────
drop policy if exists ti_w on transaction_items;
create policy ti_w on transaction_items for all
  using (tenant_id = my_tenant() and has_cap('acct.write')
         and exists (select 1 from transactions t
                      where t.tenant_id = transaction_items.tenant_id
                        and t.tx_id = transaction_items.tx_id
                        and (my_entities() is null or t.entity_id = any(my_entities()))))
  with check (tenant_id = my_tenant() and has_cap('acct.write')
         and exists (select 1 from transactions t
                      where t.tenant_id = transaction_items.tenant_id
                        and t.tx_id = transaction_items.tx_id
                        and (my_entities() is null or t.entity_id = any(my_entities()))));

drop policy if exists ts_w on tax_summaries;
create policy ts_w on tax_summaries for all
  using (tenant_id = my_tenant() and has_cap('acct.write')
         and (my_entities() is null or entity_id = any(my_entities())))
  with check (tenant_id = my_tenant() and has_cap('acct.write')
         and (my_entities() is null or entity_id = any(my_entities())));

-- ★ คงเงื่อนไข emp_id ของ 0052 ไว้ครบ (ฝ่ายเงินเดือนเขียนได้เฉพาะใบพนักงาน)
drop policy if exists wht_w on wht_certificates;
create policy wht_w on wht_certificates for all
  using (
    tenant_id = my_tenant()
    and (has_cap('acct.write') or (has_cap('pay.write') and emp_id is not null))
    and (my_entities() is null or entity_id = any(my_entities()))
  )
  with check (
    tenant_id = my_tenant()
    and (has_cap('acct.write') or (has_cap('pay.write') and emp_id is not null))
    and (my_entities() is null or entity_id = any(my_entities()))
  );

-- ★ คงเงื่อนไข 2 โดเมนของ 0055 ไว้ครบ (🚨 อย่าย้ายกลับไปลูปของฝั่งผลิต)
drop policy if exists report_runs_sel on report_runs;
create policy report_runs_sel on report_runs for select
  using (tenant_id = my_tenant() and (has_cap('prod.read') or has_cap('acct.read'))
         and (my_entities() is null or entity_id = any(my_entities())));
drop policy if exists report_runs_w on report_runs;
create policy report_runs_w on report_runs for all
  using (tenant_id = my_tenant() and (has_cap('prod.write') or has_cap('acct.write'))
         and (my_entities() is null or entity_id = any(my_entities())))
  with check (tenant_id = my_tenant() and (has_cap('prod.write') or has_cap('acct.write'))
         and (my_entities() is null or entity_id = any(my_entities())));

-- payroll_items ไม่มี entity_id ในตัว → ไล่ผ่านงวด (payroll_periods มี entity_id)
drop policy if exists pi_sel on payroll_items;
create policy pi_sel on payroll_items for select
  using (tenant_id = my_tenant() and has_cap('pay.read')
         and exists (select 1 from payroll_periods p
                      where p.tenant_id = payroll_items.tenant_id
                        and p.period_id = payroll_items.period_id
                        and (my_entities() is null or p.entity_id = any(my_entities()))));
drop policy if exists pi_w on payroll_items;
create policy pi_w on payroll_items for all
  using (tenant_id = my_tenant() and has_cap('pay.write')
         and exists (select 1 from payroll_periods p
                      where p.tenant_id = payroll_items.tenant_id
                        and p.period_id = payroll_items.period_id
                        and (my_entities() is null or p.entity_id = any(my_entities()))))
  with check (tenant_id = my_tenant() and has_cap('pay.write')
         and exists (select 1 from payroll_periods p
                      where p.tenant_id = payroll_items.tenant_id
                        and p.period_id = payroll_items.period_id
                        and (my_entities() is null or p.entity_id = any(my_entities()))));

-- ── 3. RPC security definer — ด่านกิจการ (แพตเทิร์นเดียวกับ fn_file_tax 0072) ─────
--    ยกจาก migration ล่าสุดที่นิยามแต่ละตัวมาคำต่อคำ เติมแค่ด่าน
--    ★ create or replace = สิทธิ์ execute คงเดิม ไม่ได้ default คืน (D99)

-- ยก fn_pay_tax จาก 20260914000071_tax_filings.sql
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
  -- D120: definer ข้าม RLS → ต้องถามเองว่าผู้เรียกมีสิทธิ์ในกิจการนี้ไหม (แพตเทิร์น fn_file_tax 0072)
  if my_entities() is not null and not (p_entity = any(my_entities())) then
    raise exception 'ไม่มีสิทธิ์ในกิจการ %', p_entity;
  end if;
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

  /*
   * D95 — จ่ายได้แปลว่ายื่นแล้ว → ติ๊ก tax_filings ให้เลย (source = 'pay')
   *
   * ★ ทิศทางเดียว: **ยื่นแล้วไม่ได้แปลว่าจ่ายแล้ว** (เดือนยอดศูนย์ยื่นแต่ไม่ต้องจ่าย)
   * 🪤 `where not exists` เพราะผู้ใช้อาจกดปุ่ม 'ยื่นแล้ว' ไปก่อนหน้านี้ —
   *    ปล่อยให้ unique index เด้ง unique_violation ตรงนี้ = **บิลจ่ายที่เพิ่งสร้างหายทั้งใบ**
   *    (ทั้งฟังก์ชันเป็น transaction เดียว) ซึ่งคือการจ่ายที่ล้มเพราะเรื่องที่ไม่เกี่ยวกัน
   * ★ ไม่แตะแถวที่ผู้ใช้ติ๊กเองไว้แล้ว — ค่าที่ผู้ใช้กรอก (วันที่ยื่นจริง/หมายเหตุ) ต้องไม่ถูกทับ
   */
  insert into tax_filings(tenant_id, entity_id, kind, period, filed_on, filed_by, source, note)
  select v_tenant, p_entity, p_kind, p_period, p_date, auth.uid(), 'pay',
         'ระบบติ๊กให้ตอนบันทึกจ่ายภาษี'
  where not exists (
    select 1 from tax_filings f
    where f.tenant_id = v_tenant and f.entity_id = p_entity
      and f.kind = p_kind and f.period = p_period and f.reopened_at is null
  );

  insert into integration_log(tenant_id, action, idempotency_key, status, message, payload)
  values (v_tenant, 'PAY_TAX', v_id::text, 'ok',
          'บันทึกจ่าย ' || p_kind || ' งวด ' || p_period || ' (' || p_entity || ')',
          jsonb_build_object('amount', p_amount, 'surcharge', coalesce(p_surcharge,0), 'tx_id', v_tx));

  return jsonb_build_object('ok', true, 'id', v_id, 'tx_id', v_tx, 'surcharge_tx_id', v_sur_tx);
end $$;

-- ยก fn_unpay_tax จาก 20260901000054_tax_payments.sql
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
  -- D120: definer ข้าม RLS → ต้องถามเองว่าผู้เรียกมีสิทธิ์ในกิจการนี้ไหม (แพตเทิร์น fn_file_tax 0072)
  if my_entities() is not null and not (p_entity = any(my_entities())) then
    raise exception 'ไม่มีสิทธิ์ในกิจการ %', p_entity;
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

-- ยก fn_post_payroll จาก 20260827000051_roles_caps.sql
create or replace function fn_post_payroll(
  p_period_id text,
  p_kind      text,      -- รหัสขา (pay_post_legs.code)
  p_date      date,
  p_payload   jsonb      -- { entityId, accountName, category, contactName, description,
                         --   amount, lines:[{empId, contactName, description, amount}] }
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_dup boolean := false;
  v_state jsonb;
  v_tx_id text;
  v_tx_ids text[] := '{}';
  v_legs int;
  ln jsonb;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if not has_cap('pay.write') then raise exception 'ไม่มีสิทธิ์ลงบัญชีเงินเดือน'; end if;
  -- D120: งวดเงินเดือนผูกกิจการ — ผู้ใช้ที่ถูกจำกัดกิจการแตะงวดของกิจการอื่นไม่ได้
  if my_entities() is not null and not exists (
       select 1 from payroll_periods
        where tenant_id = v_tenant and period_id = p_period_id
          and entity_id = any(my_entities())) then
    raise exception 'ไม่มีสิทธิ์ในกิจการของงวด %', p_period_id;
  end if;
  if coalesce(p_kind,'') = '' then raise exception 'ต้องระบุขาที่จะลงบัญชี'; end if;
  if p_date is null then raise exception 'ต้องระบุวันที่ลงบัญชี'; end if;

  select post_state into v_state from payroll_periods
   where tenant_id = v_tenant and period_id = p_period_id;   -- ★ กันแตะงวดของลูกค้าเจ้าอื่น
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบงวด ' || p_period_id); end if;

  v_state := coalesce(v_state, '{}'::jsonb);
  if v_state ? p_kind then
    return jsonb_build_object('ok', false, 'error', 'งวดนี้ลงบัญชีขานี้ไปแล้ว — ต้องถอนก่อนถึงจะลงใหม่ได้');
  end if;

  -- idempotency: insert ก่อนแล้วจับ unique_violation (ปลอดภัยกับ race — แพตเทิร์นจาก 0029)
  begin
    insert into integration_log(tenant_id, action, idempotency_key, status, message, payload)
    values (v_tenant, 'POST_PAYROLL', p_period_id || '-' || p_kind, 'ok',
            'ลงบัญชีเงินเดือน ' || p_period_id || ' (' || p_kind || ')', p_payload);
  exception when unique_violation then
    v_dup := true;
  end;

  if not v_dup then
    if jsonb_array_length(coalesce(p_payload->'lines','[]'::jsonb)) > 0 then
      -- แยกรายคน → ตรวจกับสลิปได้ทีละใบ
      for ln in select value from jsonb_array_elements(p_payload->'lines') loop
        if coalesce((ln->>'amount')::numeric, 0) <> 0 then
          v_tx_id := next_tx_id();
          insert into transactions(
            tenant_id, tx_id, transaction_date, type, account_name, category, contact_name,
            description, base_amount, amount_after_discount, net_amount,
            status, entity_id, payment_date, idempotency_key, source
          ) values (
            v_tenant, v_tx_id, p_date, 'รายจ่าย',
            nullif(p_payload->>'accountName',''), p_payload->>'category', ln->>'contactName',
            ln->>'description',
            (ln->>'amount')::numeric, (ln->>'amount')::numeric, (ln->>'amount')::numeric,
            'ปกติ', p_payload->>'entityId', p_date,
            p_period_id || '-' || p_kind || '-' || (ln->>'empId'), 'payroll'
          );
          v_tx_ids := v_tx_ids || v_tx_id;
          update payroll_items set tx_id = v_tx_id
           where tenant_id = v_tenant and period_id = p_period_id and emp_id = ln->>'empId';
        end if;
      end loop;
    else
      if coalesce((p_payload->>'amount')::numeric, 0) = 0 then
        return jsonb_build_object('ok', false, 'error', 'ยอดเป็นศูนย์ ไม่ต้องลงบัญชี');
      end if;
      v_tx_id := next_tx_id();
      insert into transactions(
        tenant_id, tx_id, transaction_date, type, account_name, category, contact_name,
        description, base_amount, amount_after_discount, net_amount,
        status, entity_id, payment_date, idempotency_key, source
      ) values (
        v_tenant, v_tx_id, p_date, 'รายจ่าย',
        nullif(p_payload->>'accountName',''), p_payload->>'category', p_payload->>'contactName',
        p_payload->>'description',
        (p_payload->>'amount')::numeric, (p_payload->>'amount')::numeric, (p_payload->>'amount')::numeric,
        'ปกติ', p_payload->>'entityId', p_date,
        p_period_id || '-' || p_kind, 'payroll'
      );
      v_tx_ids := array[v_tx_id];
    end if;

    v_state := v_state || jsonb_build_object(
      p_kind, jsonb_build_object('txIds', to_jsonb(v_tx_ids), 'date', p_date)
    );
    select count(*) into v_legs from pay_post_legs where tenant_id = v_tenant and active;
    update payroll_periods set
      post_state = v_state,
      status = case when (select count(*) from jsonb_object_keys(v_state)) >= greatest(v_legs, 1)
                    then 'posted' else 'partial' end
     where tenant_id = v_tenant and period_id = p_period_id;
  end if;

  return jsonb_build_object('ok', true, 'duplicate', v_dup, 'tx_ids', to_jsonb(v_tx_ids));
end $$;

-- ยก fn_unpost_payroll จาก 20260827000051_roles_caps.sql
create or replace function fn_unpost_payroll(p_period_id text, p_kind text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_state jsonb;
  v_ids jsonb;
  v_n int := 0;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if not has_cap('pay.write') then raise exception 'ไม่มีสิทธิ์ถอนการลงบัญชีเงินเดือน'; end if;
  -- D120: งวดเงินเดือนผูกกิจการ — ผู้ใช้ที่ถูกจำกัดกิจการแตะงวดของกิจการอื่นไม่ได้
  if my_entities() is not null and not exists (
       select 1 from payroll_periods
        where tenant_id = v_tenant and period_id = p_period_id
          and entity_id = any(my_entities())) then
    raise exception 'ไม่มีสิทธิ์ในกิจการของงวด %', p_period_id;
  end if;

  select post_state into v_state from payroll_periods
   where tenant_id = v_tenant and period_id = p_period_id;
  if v_state is null then return jsonb_build_object('ok', false, 'error', 'ไม่พบงวด ' || p_period_id); end if;
  if not (v_state ? p_kind) then
    return jsonb_build_object('ok', false, 'error', 'ขานี้ยังไม่ได้ลงบัญชี');
  end if;

  v_ids := v_state -> p_kind -> 'txIds';
  update transactions set status = 'ยกเลิก'
   where tenant_id = v_tenant
     and tx_id in (select jsonb_array_elements_text(coalesce(v_ids, '[]'::jsonb)));
  get diagnostics v_n = row_count;

  update integration_log set status = 'duplicate', message = 'ถอนการลงบัญชีเงินเดือน'
   where tenant_id = v_tenant and action = 'POST_PAYROLL'
     and idempotency_key = p_period_id || '-' || p_kind and status = 'ok';

  update payroll_items set tx_id = null
   where tenant_id = v_tenant and period_id = p_period_id
     and tx_id in (select jsonb_array_elements_text(coalesce(v_ids, '[]'::jsonb)));

  v_state := v_state - p_kind;
  update payroll_periods set
    post_state = v_state,
    status = case when v_state = '{}'::jsonb then 'draft' else 'partial' end
   where tenant_id = v_tenant and period_id = p_period_id;

  return jsonb_build_object('ok', true, 'voided', v_n);
end $$;

-- ยก fn_wht_doc_nos จาก 20260827000051_roles_caps.sql
create or replace function fn_wht_doc_nos(p_entity_id text)
returns setof text
language sql stable security definer set search_path = public as $$
  select doc_no from wht_certificates
   where tenant_id = my_tenant()
     and entity_id = p_entity_id
     and (has_cap('acct.read') or has_cap('pay.read'))
     -- D120: เลขที่ของกิจการที่ไม่มีสิทธิ์ = ไม่คืน (ผู้ใช้ที่ถูกจำกัดออกใบได้เฉพาะกิจการของตัวเองอยู่แล้ว)
     and (my_entities() is null or p_entity_id = any(my_entities()));
$$;

notify pgrst, 'reload schema';
