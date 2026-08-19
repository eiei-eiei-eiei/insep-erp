-- ============================================================================
-- 0043 เอกสารยื่นราชการของโมดูลเงินเดือน (ภงด.1 · สปส.1-10 · ภงด.1ก · 50ทวิ)
--      เหตุผลเต็มใน D69 · migration แบบ **เพิ่มของ** → ลง DB ก่อน git push
--
-- ของที่ต้องเพิ่มมีแค่ 3 อย่าง — ตัวเลขทั้งหมดอ่านจาก `payroll_items` ที่แช่ไว้แล้ว
-- (🚨 ห้ามสร้างตารางสรุปใหม่: ตัวเลขที่ยื่นราชการต้องเป็นค่าที่แช่ตอนกดบันทึกงวด
--     ไม่ใช่ค่าที่คำนวณใหม่จาก config — กับดักเดียวกับ D66 ข้อ 2)
-- ============================================================================

-- ── 1. เลขที่บัญชีนายจ้าง ประกันสังคม ────────────────────────────────────────
--    🪤 ระบบเดิมบน GAS พิมพ์ `tax_id` ลงช่องนี้ ซึ่งไม่ถูกเสมอไป — เลขที่บัญชีนายจ้าง
--       เป็นเลขคนละตัวที่ สปส. ออกให้ · แต่ถ้าไม่กรอกก็ยัง fallback เป็น tax_id
--       เหมือนเดิมเป๊ะ (ของเดิมไม่เพี้ยน · ฝั่งแอปเป็นคนตัดสินใจ fallback)
alter table entities add column if not exists sso_employer_no text;

comment on column entities.sso_employer_no is
  'เลขที่บัญชีนายจ้าง ประกันสังคม (ขึ้นหัว สปส.1-10) — ไม่กรอก = ใช้เลขประจำตัวผู้เสียภาษีแทน';

-- ── 2. 50ทวิ ของพนักงาน: ผูกใบกับ "คนคนนั้นในปีภาษีนั้น" ─────────────────────
--    ระบบเดิมกันออกซ้ำด้วยการค้นคอลัมน์ Transaction_ID = '<empId>-<ปีพ.ศ.>' ในชีต
--    ซึ่งพลาดได้ถ้ากดสองครั้งไล่กัน (อ่าน→เขียน ไม่ atomic)
--    🚨 ที่นี่ให้ **DB เป็นคนกัน** — ออกซ้ำ = ใบที่ 2 มีเลขที่คนละใบ แต่เนื้อหาเหมือนกัน
--       ลูกจ้างถือ 2 ใบไปยื่นภาษี = ปัญหาที่ตามแก้ทีหลังยาก
alter table wht_certificates add column if not exists emp_id   text;
alter table wht_certificates add column if not exists tax_year int;

comment on column wht_certificates.emp_id is
  'ใบของพนักงาน (50ทวิ เงินเดือน) — null = ใบของคู่ค้าตามปกติ · ไม่ FK ไป employees '
  'เพราะใบที่ออกไปแล้วต้องอยู่ต่อแม้ลบทะเบียนพนักงาน (เอกสารราชการที่ส่งมอบแล้ว)';

create unique index if not exists wht_cert_emp_year_uidx
  on wht_certificates (tenant_id, entity_id, emp_id, tax_year)
  where emp_id is not null;

-- ── 3. fn_issue_wht รับ emp_id / tax_year ────────────────────────────────────
--    ⚠️ recreate จาก 0021 — **พฤติกรรมเดิมทุกบรรทัดคงเดิมเป๊ะ** ฝั่งบัญชีเรียกอยู่
--       (`app/(app)/accounting/actions.ts`) ต่างแค่พารามิเตอร์ 2 ตัวท้ายที่ default null
--    ★ ตรวจใบซ้ำของพนักงาน **ก่อน** insert เพื่อให้ข้อความบอกสาเหตุตรงจุด —
--      ถ้าปล่อยให้ไปชนที่ unique index จะแยกไม่ออกว่าชนเลขที่เอกสารหรือชนใบซ้ำ
--
-- 🚨 **ต้อง drop ตัวเดิมก่อน** — `create or replace` ที่จำนวนพารามิเตอร์ต่างกัน
--    ไม่ได้แทนที่ แต่สร้าง **overload ตัวที่สอง** · พอฝั่งบัญชีเรียกด้วย 13 อาร์กิวเมนต์
--    Postgres จะแมตช์ได้ทั้งสองตัว (ตัวใหม่มี default 2 ตัว) → `function is not unique`
--    = ออก 50ทวิ ของคู่ค้าพังทันทีทั้งที่ไม่ได้แตะโค้ดฝั่งนั้นเลย
drop function if exists fn_issue_wht(text, text[], date, text, text, numeric, text, text, int, numeric, date, text, text);

create or replace function fn_issue_wht(
  p_doc_no text, p_tx_ids text[], p_issue_date date, p_contact_name text, p_address text,
  p_wht_amount numeric, p_pnd_type text, p_income_type text, p_income_seq int, p_base_amount numeric,
  p_payment_date date, p_entity_id text, p_contact_id text default null,
  p_emp_id text default null, p_tax_year int default null
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_entity text := coalesce(nullif(p_entity_id,''),'EID01');
  v_emp    text := nullif(p_emp_id,'');
  v_exist  text;
begin
  if v_emp is not null then
    select doc_no into v_exist from wht_certificates
     where entity_id = v_entity and emp_id = v_emp and tax_year = p_tax_year
     limit 1;
    if v_exist is not null then
      return jsonb_build_object('ok', false,
        'error', 'ออก 50ทวิ ให้พนักงานคนนี้ของปีภาษีนี้ไปแล้ว (เลขที่ ' || v_exist || ')',
        'doc_no', v_exist);
    end if;
  end if;

  insert into wht_certificates(doc_no, issue_date, contact_name, contact_id, address, wht_amount,
    pnd_type, income_type, income_seq, base_amount, tx_ids, entity_id, emp_id, tax_year)
  values (p_doc_no, coalesce(p_issue_date, current_date), p_contact_name, nullif(p_contact_id,''),
    p_address, p_wht_amount,
    p_pnd_type, p_income_type, coalesce(p_income_seq, 6), p_base_amount, coalesce(p_tx_ids,'{}'),
    v_entity, v_emp, p_tax_year);

  -- เขียนวันที่จ่าย (col W เดิม) ให้ทุก tx ที่ออกใบนี้
  update transactions set payment_date = coalesce(p_payment_date, current_date)
    where tx_id = any(coalesce(p_tx_ids,'{}'));

  return jsonb_build_object('ok', true, 'doc_no', p_doc_no);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'เลขเอกสาร ' || p_doc_no || ' ถูกใช้แล้วในกิจการนี้ ลองใหม่');
end $$;

-- ── 4. 🪤 หนี้ที่ค้างจาก 0042: ตาราง `pay_variables` / `pay_post_legs` ────────
--    ไม่ได้ถูกเติมเข้า `fn_mig_truncate` ตอนสร้าง → การลบ/รีเซ็ต tenant จะทิ้งของ 2 ตารางนี้
--    ค้างไว้ แล้วไปติด FK ของ `entities` (หรือทิ้งเกณฑ์ของลูกค้าเก่าไว้ให้ลูกค้าใหม่เห็น)
--    **นี่คือกับดักตัวเดียวกับที่ D67 เพิ่งจดไว้เอง แล้วพลาดซ้ำในคอมมิตเดียวกัน**
--    → ตอกย้ำว่า checklist 6 ที่ต้องไล่ทุกครั้งที่เพิ่ม/ลบตาราง
create or replace function fn_mig_truncate(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t text;
  -- เรียงตามลำดับ FK (ลูกก่อนแม่) เพราะ delete ไม่ cascade เองเหมือน truncate
  tables text[] := array[
    'transaction_items','transactions','tax_summaries','wht_certificates',
    'log_material','log_ferment','log_distill','log_distill_run',
    'log_ferment_monitor','log_dilute','log_product','stock_product',
    'sales_order_items','sales_orders','warehouse_stock','stock_moves','sale_menu',
    -- เงินเดือน (0040 + 0042) — ต้องมาก่อน entities ไม่งั้นติด FK
    'payroll_items','payroll_periods','employees',
    'pay_components','pay_inputs','pay_rates','pay_variables','pay_post_legs',
    'contacts','bank_accounts',
    'materials','containers','products',
    'entities',
    'app_settings','integration_log','edit_log','report_runs','counters'
  ];
begin
  if p_tenant is null then
    raise exception 'fn_mig_truncate: ต้องระบุ tenant — ห้ามล้างข้ามลูกค้า';
  end if;
  foreach t in array tables loop
    execute format('delete from %I where tenant_id = $1', t) using p_tenant;
  end loop;
end $$;

notify pgrst, 'reload schema';
