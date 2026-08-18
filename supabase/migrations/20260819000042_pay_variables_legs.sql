-- ============================================================================
-- 0042 ตัวแปรกลาง + ขาลงบัญชีที่ตั้งเองได้  (ต่อจาก D66 · เหตุผลเต็มใน D67)
--
-- ปัญหาที่เจอจากการลองใช้จริงรอบแรก:
--   1. `hourly_multiplier` **ฮาร์ดโค้ดสูตรอัตราต่อชั่วโมง** ไว้ในโค้ด
--      (ค่าจ้าง ÷ วันทำงานมาตรฐาน ÷ ชั่วโมงต่อวัน) — แต่ละโรงคิดไม่เหมือนกัน
--      → ลูกค้าตั้งเองไม่ได้ = ขัดหลักการ "โค้ดเป็นกลาง เกณฑ์อยู่ใน config"
--   2. `pay_components.expense_cat` เป็น **ช่องหลอก** ใส่ไปก็ไม่มีผล
--   3. ขาลงบัญชีถูกล็อกไว้ 3 ขา (NET/SSO/WHT) ในโค้ด — บางเจ้าต้องการมากหรือน้อยกว่านั้น
--      และหมวดรายจ่ายที่ใช้ก็ไม่ได้อยู่ในรายการหมวดเดิมของเขา
--
-- 🎯 ยังยึดหลักเดิม **ไม่ทำภาษาสูตร**: ตัวแปร = "ตัวตั้ง ÷ ตัวหารไม่เกิน 2 ชั้น"
--    ที่ทุกช่องเลือกจากรายการปิด · ไม่มี parser ไม่มีลำดับตัวดำเนินการ → golden test ได้ครบ
-- ============================================================================

-- ── 1. ตัวแปรกลาง ────────────────────────────────────────────────────────────
--    คำนวณชั้นแรก แล้วให้ pay_components เอาไปคูณต่อ
--    ค่าที่ใช้เป็นตัวตั้ง/ตัวหารได้ (ชุดปิด — ใช้ชุดเดียวกันทุกช่อง):
--      base_wage        ฐานเงินเดือน/ค่าแรงของพนักงานคนนั้น
--      prorated_base    ค่าจ้างฐานหลังคิดตามวันมาทำงานแล้ว
--      work_days_std    วันทำงานมาตรฐานของ "งวดนั้น"  ← เปลี่ยนได้ทุกเดือน
--      work_days_actual วันมาทำงานจริงของคนนั้นในงวดนั้น
--      hours_per_day    ชั่วโมงทำงานต่อวัน (ค่าตั้งบริษัท)
--      input            ค่าจากช่องที่กรอกต่อคนต่องวด (อ้าง pay_inputs.code)
--      constant         ค่าคงที่
create table if not exists pay_variables (
  tenant_id uuid not null default my_tenant(),
  code      text not null,
  name      text not null,
  source      text not null default 'base_wage'
    check (source in ('base_wage','prorated_base','work_days_std','work_days_actual',
                      'hours_per_day','input','constant')),
  const_value numeric(14,4) not null default 0,
  input_key   text,
  -- ไล่หารตามลำดับ (สูงสุด 2 ชั้น): [{kind, value, inputKey}] — kind ใช้ชุดเดียวกับ source
  divisors  jsonb not null default '[]'::jsonb,
  sort      int not null default 0,
  active    boolean not null default true,
  primary key (tenant_id, code)
);

comment on table pay_variables is
  'ค่ากลางที่คำนวณชั้นแรกก่อนเอาไปคิดเป็นรายการเพิ่ม/หัก (เช่นอัตราค่าล่วงเวลาต่อชั่วโมง) '
  'ตัวตั้ง ÷ ตัวหารไม่เกิน 2 ชั้น · ทุกช่องเลือกจากรายการปิด ไม่ใช่ภาษาสูตร';

comment on column pay_variables.divisors is
  '🪤 ตัวหารที่เป็น 0 หรือหาค่าไม่ได้ ต้องถูก "ข้าม" ไม่ใช่หารแล้วได้ Infinity '
  '(เดือนที่ยังไม่กรอกชั่วโมงโอทีจะได้ตัวหาร 0 เป็นเรื่องปกติ)';

alter table pay_variables enable row level security;
drop policy if exists payvar_sel on pay_variables;
create policy payvar_sel on pay_variables for select
  using (tenant_id = my_tenant() and my_role() = 'main');
drop policy if exists payvar_w on pay_variables;
create policy payvar_w on pay_variables for all
  using (tenant_id = my_tenant() and my_role() = 'main')
  with check (tenant_id = my_tenant() and my_role() = 'main');

-- ── 2. pay_components: method 'variable' แทน 'hourly_multiplier' ─────────────
alter table pay_components add column if not exists variable_code text;

comment on column pay_components.variable_code is
  'method=variable → ยอด = ค่าตัวแปรนี้ × multiplier × ค่าจากช่องกรอก (ไม่เลือกช่องกรอก = คูณ 1)';

-- แปลงของเดิม: สร้างตัวแปรที่สูตร**ตรงกับที่โค้ดเดิมฮาร์ดโค้ดไว้เป๊ะ** ให้เฉพาะ tenant ที่เคยใช้
-- → ตัวเลขที่ตั้งไว้แล้วไม่ขยับ
insert into pay_variables (tenant_id, code, name, source, divisors, sort)
select distinct c.tenant_id, 'hourly_rate', 'อัตราต่อชั่วโมง', 'base_wage',
       '[{"kind":"work_days_std"},{"kind":"hours_per_day"}]'::jsonb, 0
from pay_components c
where c.method = 'hourly_multiplier'
on conflict (tenant_id, code) do nothing;

update pay_components
   set method = 'variable', variable_code = 'hourly_rate'
 where method = 'hourly_multiplier';

alter table pay_components drop constraint if exists pay_components_method_check;
alter table pay_components add constraint pay_components_method_check
  check (method in ('fixed','per_unit','percent_base','variable','tier_table','manual'));

-- ── 3. ช่องหลอกที่ไม่เคยมีผล ────────────────────────────────────────────────
--    หมวดรายจ่ายเป็นของ "ขาลงบัญชี" ไม่ใช่ของรายการย่อย (ลงบัญชีเป็นก้อน
--    แล้วดูรายละเอียดแยกรายการ/รายคนในแท็บรายงานของโมดูลนี้แทน)
alter table pay_components drop column if exists expense_cat;

-- ── 4. ขาลงบัญชีที่ตั้งเองได้ กี่ขาก็ได้ ─────────────────────────────────────
--    เดิมล็อกไว้ 3 ขาในโค้ด (NET/SSO/WHT) · ตอนนี้เป็นข้อมูล
--
--    🚨 ขาที่ตั้งเอง **ซ้อนกันได้** — ตั้งขา "โอที" เพิ่มทั้งที่โอทีอยู่ในยอดสุทธิอยู่แล้ว
--       = ลงรายจ่ายซ้ำ และไม่มีอะไรใน DB ฟ้อง · หน้าจอตั้งค่าจึงต้องโชว์ตัวเลขคุมเสมอ
--       (ยอดรวมของขาที่ตั้งไว้ เทียบกับ ยอดที่ควรลงทั้งหมด = รวมเงินได้ + สมทบนายจ้าง)
create table if not exists pay_post_legs (
  tenant_id uuid not null default my_tenant(),
  code      text not null,                          -- ASCII เช่น 'net' / 'sso' / 'wht'
  name      text not null,                          -- ชื่อที่ขึ้นบนปุ่ม
  -- ยอดที่ขานี้ลง (ชุดปิด)
  amount_source text not null
    check (amount_source in ('net','gross','sso_employee','sso_employer','sso_total',
                             'wht','component')),
  component_code text,                              -- amount_source='component'
  -- แยกเป็น 1 รายการต่อคน หรือลงเป็นก้อนเดียว
  split_by_employee boolean not null default false,
  category    text not null,                        -- หมวดรายจ่าย (พิมพ์เอง ไม่ผูกกับ expense_cat)
  account_name text,                                -- ว่าง = ใช้บัญชีจ่ายเงินเดือนหลัก
  contact_name text,                                -- คู่ค้าบนรายการ (เช่น 'สำนักงานประกันสังคม')
  -- วันที่แนะนำ: จำนวนวันหลังสิ้นงวด (0 = ใช้วันจ่ายเงินเดือนของงวด)
  suggest_day int not null default 0,
  sort   int not null default 0,
  active boolean not null default true,
  primary key (tenant_id, code)
);

comment on column pay_post_legs.amount_source is
  'ยอดที่ขานี้ลงบัญชี — ชุดปิด · component = ยอดรวมของรายการเพิ่ม/หักตัวหนึ่ง '
  '🚨 ตั้งขาที่ยอดซ้อนกัน = ลงรายจ่ายซ้ำ (เช่น net + gross พร้อมกัน) หน้าจอต้องเตือน';

alter table pay_post_legs enable row level security;
drop policy if exists payleg_sel on pay_post_legs;
create policy payleg_sel on pay_post_legs for select
  using (tenant_id = my_tenant() and my_role() = 'main');
drop policy if exists payleg_w on pay_post_legs;
create policy payleg_w on pay_post_legs for all
  using (tenant_id = my_tenant() and my_role() = 'main')
  with check (tenant_id = my_tenant() and my_role() = 'main');

-- ── 5. fn_post_payroll รับ "รหัสขา" แทน enum 3 ตัว ──────────────────────────
--    ★ ยอดยังคำนวณที่ lib/payroll แล้วส่งค่ามาเก็บเหมือนเดิม (RPC ไม่คำนวณเงินเอง)
--    ★ status: posted = ครบทุกขาที่ยัง active · partial = ลงบางขา
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
  if my_role() <> 'main' then raise exception 'ไม่มีสิทธิ์ลงบัญชีเงินเดือน'; end if;
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

-- ── 6. ถอนการลงบัญชี — 🚨 soft-void ไม่ใช่ลบ (กติกาเหล็ก: status มีแค่ ปกติ/ยกเลิก) ──
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
  if my_role() <> 'main' then raise exception 'ไม่มีสิทธิ์ถอนการลงบัญชีเงินเดือน'; end if;

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

notify pgrst, 'reload schema';
