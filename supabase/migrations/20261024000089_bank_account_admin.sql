-- ════════════════════════════════════════════════════════════════════════════
-- 0089 — D125: จัดการบัญชีเงินจากหน้าตั้งค่า (แก้ชื่อ · ปิดใช้ · ลบ)
--
-- ที่มา: หน้าตั้งค่าบัญชีเงินเดิมทำได้อย่างเดียวคือ "พิมพ์ชื่อเดิมแล้วกดเพิ่ม" (upsert ตามชื่อ)
--   · เปลี่ยนชื่อไม่ได้เลย · ลบต้องไปทำในหน้า Supabase · ปิดบัญชีที่เลิกใช้ไม่ได้
--
-- 🚨 บิลอ้างบัญชีด้วย "ชื่อ" ไม่ใช่ id (ยกมาจากชีทเดิม · 0001) ⇒ เปลี่ยนชื่อในตารางบัญชีอย่างเดียว
--    = บิลเก่าทั้งหมดชี้ไปบัญชีที่ไม่มีอยู่ ยอดคงเหลือหาย · ต้องตามไปแก้ทุกที่ที่เก็บชื่อพร้อมกัน
--    ใน transaction เดียว: transactions · tax_payments · pay_post_legs · app_settings (7 kind)
--    🚨 รายชื่อ kind ต้องตรงกับ ACCOUNT_SETTING_KINDS ใน lib/accounting/bankAccounts.ts
--       (bankAccountsSql.test.ts อ่านไฟล์นี้มาเทียบ)
--
-- ★ ลบได้เฉพาะบัญชีที่ไม่มีอะไรอ้างถึงเลย — มีบิลแล้ว = ปิดใช้แทน (ยอด/ประวัติยังอยู่ครบ)
-- ★ เปลี่ยนชื่อ/ลบ ต้องเห็นทุกกิจการ (my_entities() is null) — ผู้ใช้ที่ถูกจำกัดกิจการ (D120)
--   มองไม่เห็นบิลของกิจการอื่นที่ใช้บัญชีร่วม จะเปลี่ยนชื่อให้คนอื่นโดยไม่รู้ตัว
-- ★ definer ทุกตัวมีด่าน my_tenant() + has_cap() ในตัว และปิดจาก anon (D99)
-- ★ ไม่มีตารางใหม่ (D118 ไม่ต้อง grant ตารางเพิ่ม)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. ปิดใช้บัญชี ──────────────────────────────────────────────────────────
alter table bank_accounts add column if not exists active boolean not null default true;
comment on column bank_accounts.active is
  'false = เลิกใช้ ไม่โผล่ในช่องเลือกบัญชีของบิลใหม่ · ยอด/ประวัติ/รายงานยังนับครบ (D125)';

-- ── 2. รายชื่อ kind ของ app_settings ที่เก็บ "ชื่อบัญชีเงิน" ─────────────────────
create or replace function fn_account_setting_kinds() returns text[]
language sql immutable set search_path = public as $$
  select array['sales_revenue_account','bar_revenue_account','bar_cash_account',
               'payroll_pay_account','payroll_sso_account','payroll_wht_account',
               'tax_account'];
$$;

-- ── 3. บัญชีไหนถูกใช้อยู่เท่าไร (ใช้ตัดสินว่าลบได้ไหม + โชว์บนจอ) ───────────────
--    definer เพราะต้องนับบิลของทุกกิจการ (RLS ของผู้ใช้ที่ถูกจำกัดจะนับขาด = ลบบัญชีที่มีบิลได้)
--    ★ คืนเฉพาะบัญชีที่ผู้ใช้มองเห็นตามกติกาเดียวกับ policy bank_accounts_sel (0087)
create or replace function fn_bank_account_usage()
returns table (account_name text, tx_count int, pay_count int, leg_count int, setting_kinds text[])
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_tenant uuid := my_tenant();
begin
  if v_tenant is null then raise exception 'ไม่พบบริษัทของผู้ใช้'; end if;
  if not has_cap('acct.config') then raise exception 'ต้องมีสิทธิ์ตั้งค่าบัญชีจึงดูข้อมูลนี้ได้'; end if;
  return query
  select b.account_name,
    (select count(*)::int from transactions t where t.tenant_id = v_tenant and t.account_name = b.account_name),
    (select count(*)::int from tax_payments p where p.tenant_id = v_tenant and p.account_name = b.account_name),
    (select count(*)::int from pay_post_legs l where l.tenant_id = v_tenant and l.account_name = b.account_name),
    coalesce((select array_agg(s.kind order by s.kind) from app_settings s
               where s.tenant_id = v_tenant and s.kind = any(fn_account_setting_kinds())
                 and s.kind <> 'tax_account' and s.value = b.account_name), '{}')
  from bank_accounts b
  where b.tenant_id = v_tenant
    and (my_entities() is null
         or coalesce(array_length(b.entity_ids, 1), 0) = 0
         or b.entity_ids && my_entities());
end $fn$;

-- ── 4. เปลี่ยนชื่อบัญชี + ตามไปแก้ทุกที่ที่อ้างชื่อเดิม ───────────────────────────
create or replace function fn_rename_bank_account(p_old text, p_new text)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := my_tenant();
  v_new text := btrim(coalesce(p_new, ''));
  n_tx int; n_pay int; n_leg int; n_set int;
begin
  if v_tenant is null then raise exception 'ไม่พบบริษัทของผู้ใช้'; end if;
  if not has_cap('acct.config') then raise exception 'ต้องมีสิทธิ์ตั้งค่าบัญชีจึงเปลี่ยนชื่อบัญชีได้'; end if;
  if my_entities() is not null then
    raise exception 'ผู้ใช้ที่ถูกจำกัดให้เห็นบางกิจการเปลี่ยนชื่อบัญชีไม่ได้ (บัญชีอาจถูกใช้ในบิลของกิจการอื่นที่มองไม่เห็น) — ให้ผู้ที่เห็นทุกกิจการเป็นคนเปลี่ยน';
  end if;
  if v_new = '' then raise exception 'กรอกชื่อบัญชีใหม่'; end if;
  if v_new = p_old then return jsonb_build_object('changed', false); end if;
  if not exists (select 1 from bank_accounts where tenant_id = v_tenant and account_name = p_old) then
    raise exception 'ไม่พบบัญชี "%"', p_old;
  end if;
  if exists (select 1 from bank_accounts where tenant_id = v_tenant and account_name = v_new) then
    raise exception 'มีบัญชีชื่อ "%" อยู่แล้ว — ตั้งชื่ออื่น', v_new;
  end if;

  -- 🪤 trigger advance_guard (0086) ห้ามแก้บิลสำรองจ่ายที่เคลียแล้ว/รายการรับคืนตรง ๆ
  --    การเปลี่ยนชื่อบัญชีไม่ได้แตะสถานะสำรองจ่ายเลย จึงผ่านด่านแบบเดียวกับ RPC ของ 0086
  perform set_config('app.advance_rpc', '1', true);

  update bank_accounts set account_name = v_new where tenant_id = v_tenant and account_name = p_old;
  update transactions  set account_name = v_new where tenant_id = v_tenant and account_name = p_old;
  get diagnostics n_tx = row_count;
  update tax_payments  set account_name = v_new where tenant_id = v_tenant and account_name = p_old;
  get diagnostics n_pay = row_count;
  update pay_post_legs set account_name = v_new where tenant_id = v_tenant and account_name = p_old;
  get diagnostics n_leg = row_count;
  -- ★ unique (tenant, kind, value) — ถ้ามีแถวชื่อใหม่ค้างอยู่แล้วใน kind เดียวกัน ให้แถวเดิมหายไป
  update app_settings s set value = v_new
   where s.tenant_id = v_tenant and s.kind = any(fn_account_setting_kinds()) and s.value = p_old
     and not exists (select 1 from app_settings d
                      where d.tenant_id = v_tenant and d.kind = s.kind and d.value = v_new);
  get diagnostics n_set = row_count;
  delete from app_settings
   where tenant_id = v_tenant and kind = any(fn_account_setting_kinds()) and value = p_old;

  perform set_config('app.advance_rpc', '', true);
  return jsonb_build_object('changed', true, 'tx', n_tx, 'payments', n_pay, 'legs', n_leg, 'settings', n_set);
end $fn$;

-- ── 5. ลบบัญชี — เฉพาะที่ไม่มีอะไรอ้างถึง ─────────────────────────────────────────
create or replace function fn_delete_bank_account(p_name text)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := my_tenant();
  n_tx int; n_pay int; n_leg int; v_kinds text[];
begin
  if v_tenant is null then raise exception 'ไม่พบบริษัทของผู้ใช้'; end if;
  if not has_cap('acct.config') then raise exception 'ต้องมีสิทธิ์ตั้งค่าบัญชีจึงลบบัญชีได้'; end if;
  if my_entities() is not null then
    raise exception 'ผู้ใช้ที่ถูกจำกัดให้เห็นบางกิจการลบบัญชีไม่ได้ — ให้ผู้ที่เห็นทุกกิจการเป็นคนลบ';
  end if;
  if not exists (select 1 from bank_accounts where tenant_id = v_tenant and account_name = p_name) then
    raise exception 'ไม่พบบัญชี "%"', p_name;
  end if;

  select count(*) into n_tx  from transactions  where tenant_id = v_tenant and account_name = p_name;
  select count(*) into n_pay from tax_payments  where tenant_id = v_tenant and account_name = p_name;
  select count(*) into n_leg from pay_post_legs where tenant_id = v_tenant and account_name = p_name;
  if n_tx + n_pay > 0 then
    raise exception 'บัญชี "%" มีรายการอยู่ % รายการ — ลบไม่ได้ (บิลเก่าจะหาบัญชีไม่เจอ) ใช้ปุ่ม ปิดใช้ แทน', p_name, n_tx + n_pay;
  end if;
  if n_leg > 0 then
    raise exception 'บัญชี "%" ถูกตั้งเป็นบัญชีของขาลงบัญชีเงินเดือน — เปลี่ยนที่ เงินเดือน → ตั้งค่า ก่อน', p_name;
  end if;
  select array_agg(kind) into v_kinds from app_settings
   where tenant_id = v_tenant and kind = any(fn_account_setting_kinds()) and kind <> 'tax_account' and value = p_name;
  if v_kinds is not null then
    raise exception 'บัญชี "%" ถูกตั้งค่าใช้อยู่ (%) — เปลี่ยนการตั้งค่านั้นก่อน', p_name, array_to_string(v_kinds, ', ');
  end if;

  delete from app_settings where tenant_id = v_tenant and kind = 'tax_account' and value = p_name;
  delete from bank_accounts where tenant_id = v_tenant and account_name = p_name;
  return jsonb_build_object('deleted', true);
end $fn$;

-- ── 6. สิทธิ์ (D99: revoke from public อย่างเดียวไม่มีผลบน Supabase) ────────────────
revoke execute on function fn_bank_account_usage()                from public, anon;
revoke execute on function fn_rename_bank_account(text, text)      from public, anon;
revoke execute on function fn_delete_bank_account(text)            from public, anon;
grant execute on function fn_bank_account_usage()              to authenticated, service_role;
grant execute on function fn_rename_bank_account(text, text)   to authenticated, service_role;
grant execute on function fn_delete_bank_account(text)         to authenticated, service_role;
