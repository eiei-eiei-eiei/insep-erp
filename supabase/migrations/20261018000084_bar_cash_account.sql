-- ─────────────────────────────────────────────────────────────────────────────
-- 0084 — บาร์: บัญชีเงินสดแยก  (D116)
--
-- 🎯 ผู้ใช้: เงินสดของบาร์เก็บไว้หมุนในร้าน ไม่ได้ฝากธนาคาร
--    เดิมทุกวิธีรับเงินลงบัญชีเดียว (bar_revenue_account) ⇒ ยอดธนาคารในแอปสูงกว่าเงินจริงทุกคืน
--    → kind ใหม่ 'bar_cash_account' · บิลรายรับของวิธี "เงินสด" ลงบัญชีนั้น ที่เหลือลงบัญชีหลัก
--    ไม่ตั้ง = พฤติกรรมเดิมทุกตัวอักษร
--
-- 🪤 app_settings.kind เป็น CHECK whitelist ที่เขียนทับทั้งก้อน — ยกรายชื่อเดิมจาก 0070 มาครบ (D80)
--    (สิทธิ์: ขึ้นต้น bar_ → app_setting_cap() ให้ bar.config อยู่แล้ว ไม่ต้องแก้)
-- 🚨 fn_bar_post_day ยกจาก 0069 ด้วยสคริปต์ แก้เฉพาะการเลือกบัญชี (กัน D79)
--    signature เดิม ⇒ create or replace คงสิทธิ์เดิม (D99) · ภพ.30 ไม่ขยับ (ฐาน/VAT คิดเหมือนเดิม)
--    แต่ 🚨 บัญชีเงินสดต้องถูกนับเข้าระบบภาษี ไม่งั้นยอดเงินสดหายจาก ภพ.30 — หน้าตั้งค่าบาร์เตือน
-- ─────────────────────────────────────────────────────────────────────────────

alter table app_settings drop constraint if exists app_settings_kind_check;
alter table app_settings add constraint app_settings_kind_check
  check (kind in ('expense_cat','income_cat','wht_rate','tax_account',
                  'sales_revenue_account','sales_revenue_entity','sales_doc_entity',
                  'brand_name','brand_color','logo_url','default_mode',
                  'line_channel_token','line_group_id',
                  -- เงินเดือน (0040)
                  'pay_group',
                  'payroll_entity','payroll_pay_account','payroll_sso_account',
                  'payroll_wht_account','payroll_hours_per_day','payroll_rounding',
                  -- D80: หมวดที่จุดชนวนรับวัตถุดิบเข้าสต็อกผลิต (list — มีได้หลายแถว)
                  'material_forward_cat',
                  -- D86: ลูกค้าปริยายของหน้าขายหน้าร้าน (contact_id · แถวเดียว)
                  'pos_walkin_contact',
                  -- ★ D96 — บาร์/POS
                  'bar_entity','bar_revenue_account','bar_income_cat',
                  'bar_promptpay_type','bar_promptpay_id',
                  'bar_channels',                       -- list — ป้ายช่องทาง/งาน ตั้งชื่อเอง
                  'bar_day_start','bar_day_end',        -- รอบขาย · เท่ากัน = ไม่ได้ตั้งรอบ
                  'bar_round_cash','bar_block_negative',
                  'bar_receipt_footer',
                  -- ★ ผังหน้าตาบิล — **JSON ก้อนเดียว** ไม่แตกเป็น kind ละสวิตช์
                  --   เพราะทุกสวิตช์ใหม่จะกลายเป็น migration ใหม่ (กับดัก D80)
                  'bar_receipt_layout',
                  -- ★ D116 — บัญชีเงินสดของบาร์ (แถวเดียว · ไม่ตั้ง = ใช้ bar_revenue_account)
                  'bar_cash_account'));

create or replace function fn_bar_post_day(
  p_entity text, p_date date, p_account text, p_category text default 'รายได้บาร์'
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.config');
  v_rec record;
  v_tx text;
  v_ids text[] := '{}';
  v_totals jsonb := '{}'::jsonb;
  v_sum numeric := 0;
  v_is_vat boolean;
  v_base numeric;
  v_vat numeric;
  v_docs text;
  v_cash text;
  v_acc text;
begin
  if p_date is null then raise exception 'ต้องระบุวันที่'; end if;
  if coalesce(trim(p_account), '') = '' then
    raise exception 'ยังไม่ได้ตั้งบัญชีรับเงินของบาร์ — ไปตั้งที่ ตั้งค่าบาร์';
  end if;
  if exists (select 1 from bar_post
              where tenant_id = v_tenant and entity_id = p_entity
                and post_date = p_date and status = 'ปกติ') then
    raise exception 'ยอดวันที่ % ลงบัญชีไปแล้ว', to_char(p_date, 'DD/MM/YYYY');
  end if;
  if not exists (select 1 from bar_sale
                  where tenant_id = v_tenant and entity_id = p_entity
                    and business_date = p_date and status = 'ปกติ') then
    raise exception 'วันที่ % ไม่มีบิลที่ปิดแล้ว ไม่มีอะไรให้ลงบัญชี', to_char(p_date, 'DD/MM/YYYY');
  end if;

  -- D116 — บัญชีเงินสดแยก (ไม่ตั้ง = ลงบัญชีหลัก p_account เหมือนเดิม)
  select nullif(trim(value), '') into v_cash
    from app_settings where tenant_id = v_tenant and kind = 'bar_cash_account' limit 1;

  select coalesce(is_vat, false) into v_is_vat
    from entities where tenant_id = v_tenant and entity_id = p_entity;

  for v_rec in
    select coalesce(nullif(trim(method), ''), 'ไม่ระบุ') as m,
           count(*) as bills, sum(grand_total) as total,
           min(rcpt_no) as first_doc, max(rcpt_no) as last_doc
      from bar_sale
     where tenant_id = v_tenant and entity_id = p_entity
       and business_date = p_date and status = 'ปกติ'
     group by 1 order by 1
  loop
    /**
     * ── ช่องภาษี (D96 เฟส F) ────────────────────────────────────────────────
     * 🚨 `taxReport()` ของ ภพ.30 ใช้ **`amount_after_discount` เป็นฐานก่อนภาษี**
     *    แล้วคิด 7% จากผลรวม · และ **ข้ามแถวที่ `vat_amount <= 0` ทิ้ง**
     *    ⇒ เดิมเขียนยอดรวมลงทุกช่องและไม่เซ็ต vat_amount
     *      = **ยอดขายบาร์หายจาก ภพ.30 ทั้งเดือนโดยไม่มีอะไรฟ้อง**
     * ★ ราคาหน้าบาร์รวม VAT อยู่แล้ว จึงต้อง **ถอดออก** ไม่ใช่บวกเข้า
     *   สูตรตรงกับ `lib/bar/vat.ts` (golden B11) และ base คิดด้วยการ **ลบ**
     *   เพื่อการันตี base + vat = ยอดที่รับจริงเป๊ะ
     */
    if (v_is_vat) then
      v_vat  := round(v_rec.total * 7 / 107, 2);
      v_base := round(v_rec.total - v_vat, 2);
    else
      v_vat  := 0;
      v_base := v_rec.total;
    end if;

    -- ช่วงเลขใบกำกับอย่างย่อของวันนั้น — ภพ.30 ต้องอ้างอิงเอกสารได้
    v_docs := case
                when not v_is_vat or v_rec.first_doc is null then null
                when v_rec.first_doc = v_rec.last_doc then v_rec.first_doc
                else v_rec.first_doc || ' ถึง ' || v_rec.last_doc
              end;
    v_acc := case when v_rec.m = 'เงินสด' and v_cash is not null then v_cash else p_account end;
    v_tx := 'TR-' || to_char(p_date, 'YYYYMMDD') || '-' ||
            lpad(next_serial('TR-' || to_char(p_date, 'YYYYMMDD'))::text, 4, '0');

    insert into transactions(tenant_id, tx_id, transaction_date, type, account_name, category,
                             description, base_amount, amount_after_discount, vat_amount, net_amount,
                             tax_invoice_no, tax_invoice_date, entity_id, source)
    values (v_tenant, v_tx, p_date, 'รายรับ', v_acc, p_category,
            'ยอดขายบาร์ ' || to_char(p_date, 'DD/MM/YYYY') || ' · ' || v_rec.m ||
            ' (' || v_rec.bills || ' บิล)',
            v_base, v_base, v_vat, v_rec.total,
            v_docs, case when v_docs is null then null else p_date end,
            p_entity, 'bar');

    v_ids := v_ids || v_tx;
    v_totals := v_totals || jsonb_build_object(v_rec.m,
                  jsonb_build_object('bills', v_rec.bills, 'total', v_rec.total, 'tx_id', v_tx, 'account', v_acc,
                                     'base', v_base, 'vat', v_vat, 'docs', v_docs));
    v_sum := v_sum + v_rec.total;
  end loop;

  insert into bar_post(tenant_id, entity_id, post_date, tx_ids, totals, posted_by)
  values (v_tenant, p_entity, p_date, v_ids, v_totals, auth.uid());

  return jsonb_build_object('ok', true, 'post_date', p_date, 'tx_ids', v_ids, 'total', v_sum);
end $fn$;
