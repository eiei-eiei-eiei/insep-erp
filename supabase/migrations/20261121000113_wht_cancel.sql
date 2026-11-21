-- ============================================================================
-- 0113 ยกเลิกใบ 50ทวิ ที่ออกไปแล้ว (D180)
--
-- ที่มา: ใบ 50ทวิ ที่ออกด้วยยอดผิด (เช่น รวมค่าขนส่งที่ไม่ควรหัก — D179) แก้จากแอปไม่ได้เลย
--   `fn_update_wht` แก้ได้แค่ เลขที่/วันออก/ประเภทเงินได้ · `base_amount`/`wht_amount` แช่ไว้ตอนออก (D66)
--   ⇒ ผิดกติกา "ทุกจุดที่ผู้ใช้บันทึกได้ต้องแก้/ลบจากแอปได้" · ผู้ใช้ต้องใช้ SQL
--
-- ── ตัดสินใจ: "สถานะยกเลิก" ไม่ใช่ลบแถว ─────────────────────────────────────
--   🚨 ลบแถว = เลขเอกสารหลุดจาก `fn_doc_nos` ⇒ `fn_suggest_doc_no` เสนอเลขเดิมซ้ำ
--      (กฎ max+1 ของ D100 · 0077 เขียนไว้เองว่า "ใบที่ถูกลบไปแล้วก็ถูกเอาเลขกลับมาใช้ = เลขซ้ำใบที่อยู่ในมือคู่ค้า")
--   ★ เก็บแถวไว้ ⇒ เลขยังอยู่ในทะเบียน ไม่ถูกนำกลับมาใช้ · ตอบได้ว่าใครยกเลิก เมื่อไร เพราะอะไร
--   ★ ใบที่ยกเลิก **ไม่นับว่าออกแล้ว** ⇒ บิลกลับเข้าคิว "รอออก 50ทวิ" เอง (คิวอ่าน tx_ids ของใบปกติเท่านั้น)
--   ★ ไม่แก้ยอดบนใบตรง ๆ — ยอดต้องมาจากบิล (ภงด.3/53 อ่านจากบิล · D179) แก้ที่ใบอย่างเดียว
--     = ใบกับ ภงด. ได้ยอดคนละตัว ⇒ ทางเดียวคือ ยกเลิก → แก้บิล → ออกใหม่ (เลขใหม่)
--
-- ไฟล์นี้มี:
--   1. คอลัมน์ status / cancelled_at / cancelled_by / cancel_reason ของ wht_certificates
--      (CHECK ใส่ได้เพราะคอลัมน์ใหม่มี default 'ปกติ' — แถวเดิมทุกแถวผ่าน)
--   2. audit trigger ของ wht_certificates (ยังไม่เคยมี — ออก/แก้/ยกเลิกต้องตามได้ว่าใครทำ)
--   3. fn_cancel_wht — invoker (RLS `wht_w` คุม tenant + cap + กิจการ) + เช็ค cap เองเพื่อบอกเหตุผลตรง ๆ
--      · ใบพนักงาน (emp_id) ยกเลิกจากที่นี่ไม่ได้ — unique index ต่อพนักงาน/ปี + แอปเงินเดือนยังไม่รู้จักสถานะ
--      · ต้องมีเหตุผล · ยกเลิกซ้ำไม่ได้
--      · 🚨 ภงด.3/53 ของเดือนที่จ่ายบิลในใบนี้ "ยื่นแล้ว" (tax_filings ที่ยังไม่ถอน) ⇒ ต้องส่ง p_ack_filed
--        ไม่งั้นตอบ need_ack — **เตือน ไม่บล็อก** เพราะคนที่ต้องแก้ใบผิดส่วนใหญ่ยื่นไปแล้ว
--        (บล็อก = ติดตายแบบเดิม) · เดือนของบิล = coalesce(settled_on, transaction_date) ตรงกับ cashDateOf()
--        · เช็คทั้ง ภงด.3 และ 53 เพราะ ภงด. แยกแบบด้วยชื่อคู่ค้า (isCorporate) ไม่ใช่ pnd_type บนใบ
--      · ไม่แตะ transactions.payment_date — ออกใบใหม่จะเขียนทับเอง (รายงานภาษีใช้ settled_on ไม่ใช่ช่องนี้ · D123)
--   4. fn_update_wht — ใบที่ยกเลิกแล้วแก้ไม่ได้
--   5. fn_edit_transaction — ด่านย้ายกิจการ (D132) นับเฉพาะใบปกติ ⇒ ยกเลิกใบก่อนแล้วย้ายบิลได้
--
-- 🚨 ต้องลง DB ก่อน deploy โค้ด: หน้าเอกสารสรรพากร select คอลัมน์ status (deploy ก่อน = อ่านใบ 50ทวิ ไม่ได้ทั้งหน้า)
-- ★ ไม่มีตารางใหม่ (D118) · ไม่มี security definer ใหม่ (D99) · ฟังก์ชันใหม่ 1 ตัว revoke anon + grant authenticated
-- ★ สร้างด้วย scripts/gen/gen-0113.mjs — ห้ามพิมพ์มือ (D79)
-- ============================================================================

-- ── 1. คอลัมน์ ───────────────────────────────────────────────────────────────
alter table wht_certificates add column if not exists status text not null default 'ปกติ';
alter table wht_certificates add column if not exists cancelled_at timestamptz;
alter table wht_certificates add column if not exists cancelled_by uuid;
alter table wht_certificates add column if not exists cancel_reason text;

do $$ begin
  alter table wht_certificates add constraint wht_certificates_status_check
    check (status in ('ปกติ', 'ยกเลิก'));
exception when duplicate_object then null;
end $$;

comment on column wht_certificates.status is
  'D180 ปกติ | ยกเลิก — ใบที่ยกเลิกไม่นับว่าออกแล้ว (บิลกลับเข้าคิวรอออก) แต่เลขยังอยู่ในทะเบียน ห้ามนำกลับมาใช้ · '
  'ยกเลิกผ่าน fn_cancel_wht เท่านั้น';

-- ── 2. audit ─────────────────────────────────────────────────────────────────
drop trigger if exists audit_wht_certificates on wht_certificates;
create trigger audit_wht_certificates after insert or update or delete on wht_certificates
  for each row execute function trg_audit('doc_no');

-- ── 3. fn_cancel_wht ─────────────────────────────────────────────────────────
create or replace function fn_cancel_wht(
  p_entity_id text, p_doc_no text, p_reason text, p_ack_filed boolean default false
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_reason text := btrim(coalesce(p_reason, ''));
  c record;
  v_filed text;
begin
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'ยังไม่ได้เข้าสู่ระบบ');
  end if;
  if not has_cap('acct.write') then
    return jsonb_build_object('ok', false, 'error', 'ไม่มีสิทธิ์ยกเลิกใบ 50ทวิ (ต้องมีสิทธิ์บันทึกบัญชี)');
  end if;
  if my_entities() is not null and not (p_entity_id = any(my_entities())) then
    return jsonb_build_object('ok', false, 'error', 'ไม่มีสิทธิ์ในกิจการ ' || coalesce(p_entity_id, ''));
  end if;
  if v_reason = '' then
    return jsonb_build_object('ok', false, 'error', 'ต้องกรอกเหตุผลที่ยกเลิก');
  end if;

  select doc_no, status, emp_id, tx_ids, cancelled_at into c
    from wht_certificates
   where tenant_id = v_tenant and entity_id = p_entity_id and doc_no = p_doc_no
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ไม่พบใบ 50ทวิ เลขที่ ' || coalesce(p_doc_no, ''));
  end if;
  if c.emp_id is not null then
    return jsonb_build_object('ok', false,
      'error', 'ใบ ' || p_doc_no || ' เป็นของพนักงาน (ออกจากแอปเงินเดือน) — ยกเลิกจากหน้านี้ไม่ได้');
  end if;
  if c.status = 'ยกเลิก' then
    return jsonb_build_object('ok', false, 'error', 'ใบ ' || p_doc_no || ' ยกเลิกไปแล้ว');
  end if;

  -- 🚨 เดือนของบิล = cashDateOf() (settled_on → transaction_date) · ภงด.3 หรือ 53 ก็นับ
  --    🪤 ต้องตรงกับ whtCertFiledPeriods() ใน lib/accounting/whtCancel.ts
  select string_agg(distinct
           case f.kind when 'pnd53' then 'ภ.ง.ด.53' else 'ภ.ง.ด.3' end || ' งวด ' || f.period,
           ', ')
    into v_filed
    from tax_filings f
   where f.tenant_id = v_tenant and f.entity_id = p_entity_id
     and f.kind in ('pnd3', 'pnd53') and f.reopened_at is null
     and f.period in (
       select to_char(coalesce(t.settled_on, t.transaction_date), 'YYYY-MM')
         from transactions t
        where t.tenant_id = v_tenant and t.tx_id = any(coalesce(c.tx_ids, '{}'))
     );
  if v_filed is not null and not coalesce(p_ack_filed, false) then
    return jsonb_build_object('ok', false, 'need_ack', true, 'filed', v_filed,
      'error', 'ยื่น ' || v_filed || ' ไปแล้ว — ยืนยันก่อนว่ารับทราบว่าต้องยื่นแบบเพิ่มเติมเอง');
  end if;

  update wht_certificates set
    status        = 'ยกเลิก',
    cancelled_at  = now(),
    cancelled_by  = auth.uid(),
    cancel_reason = v_reason
   where tenant_id = v_tenant and entity_id = p_entity_id and doc_no = p_doc_no;

  return jsonb_build_object('ok', true, 'doc_no', p_doc_no, 'tx_ids', to_jsonb(coalesce(c.tx_ids, '{}')),
                            'filed', v_filed);
end $$;

revoke execute on function fn_cancel_wht(text, text, text, boolean) from public, anon;
grant execute on function fn_cancel_wht(text, text, text, boolean) to authenticated, service_role;

comment on function fn_cancel_wht(text, text, text, boolean) is
  'D180 ยกเลิกใบ 50ทวิ ของคู่ค้า (ไม่ลบแถว · เลขไม่ถูกนำกลับมาใช้) · ภงด. เดือนนั้นยื่นแล้ว = ต้องส่ง p_ack_filed';

-- ── 4-5. RPC เดิมที่ต้องรู้จักสถานะ ───────────────────────────────────────────
-- fn_update_wht — ยกจาก 20260720000012_wht_multientity.sql คำต่อคำ + ด่านใบที่ยกเลิก
create or replace function fn_update_wht(
  p_entity_id text, p_old_doc_no text, p_new_doc_no text, p_issue_date date,
  p_pnd_type text, p_income_seq int, p_income_type text
) returns jsonb
language plpgsql set search_path = public as $$
declare n int;
begin
  -- D180: ใบที่ยกเลิกแล้ว = เอกสารปิด · แก้เลข/วันที่/ประเภทไม่ได้ (ออกใบใหม่แทน)
  if exists (select 1 from wht_certificates
              where entity_id = p_entity_id and doc_no = p_old_doc_no and status = 'ยกเลิก') then
    return jsonb_build_object('ok', false, 'error', 'ใบ ' || p_old_doc_no || ' ยกเลิกแล้ว — แก้ไม่ได้');
  end if;
  update wht_certificates set
    doc_no      = coalesce(nullif(p_new_doc_no,''), doc_no),
    issue_date  = coalesce(p_issue_date, issue_date),
    pnd_type    = coalesce(nullif(p_pnd_type,''), pnd_type),
    income_seq  = coalesce(p_income_seq, income_seq),
    income_type = coalesce(p_income_type, income_type)
  where entity_id = p_entity_id and doc_no = p_old_doc_no;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'ไม่พบเอกสาร ' || p_old_doc_no); end if;
  return jsonb_build_object('ok', true, 'doc_no', coalesce(nullif(p_new_doc_no,''), p_old_doc_no));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'เลขเอกสาร ' || p_new_doc_no || ' ซ้ำในกิจการนี้');
end $$;

-- fn_edit_transaction — ยกจาก 20261121000112_wht_base.sql คำต่อคำ + ด่านย้ายกิจการนับเฉพาะใบ 50ทวิ ปกติ
create or replace function fn_edit_transaction(
  p_tx_id text,
  p jsonb,            -- ฟิลด์ transaction (ค่าเงินคำนวณจาก entryCalc ฝั่ง client แล้ว)
  p_items jsonb default '[]'::jsonb
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_group text;
  v_transfer text;
  it jsonb;
  idx int := 0;
  n int;
  -- D132: ย้ายกิจการ
  v_tenant uuid;
  v_old_entity text;
  v_new_entity text;
  v_source text;
  v_type text;
  v_adv_for text;
  v_adv_clear text;
  v_adv_src text;
  v_wht text;
begin
  select po_group_id, transfer_id,
         tenant_id, entity_id, source, type, advance_for_entity, advance_clear_id, advance_src_tx
    into v_group, v_transfer,
         v_tenant, v_old_entity, v_source, v_type, v_adv_for, v_adv_clear, v_adv_src
    from transactions where tx_id = p_tx_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ไม่พบรายการ ' || p_tx_id);
  end if;
  if v_group is not null or v_transfer is not null then
    return jsonb_build_object('ok', false,
      'error', 'บิลนี้เป็นกลุ่มงวด/โอนระหว่างบัญชี — แก้ไม่ได้ ให้ยกเลิกแล้วสร้างใหม่');
  end if;

  -- ── D132: ย้ายกิจการ — ด่านเหล่านี้ทำงานเฉพาะตอนเปลี่ยนกิจการจริง ─────────────
  -- 🚨 เงื่อนไขต้องตรงกับ entityMoveBlock()/entityMoveError() ใน lib/accounting/entityMove.ts
  v_new_entity := coalesce(nullif(p->>'entity_id',''), v_old_entity);
  if v_new_entity <> v_old_entity then
    if not exists (select 1 from entities where tenant_id = v_tenant and entity_id = v_new_entity) then
      return jsonb_build_object('ok', false, 'error', 'ไม่พบกิจการ ' || v_new_entity);
    end if;
    if v_adv_clear is not null or v_adv_src is not null then
      return jsonb_build_object('ok', false,
        'error', 'บิลที่เกิดจากการเคลียสำรองจ่าย ย้ายกิจการไม่ได้ — ใช้ปุ่ม ถอนการเคลีย ในแท็บ ลูกหนี้-เจ้าหนี้');
    end if;
    if coalesce(v_source, 'ui') not in ('ui', 'migration', 'claude') then
      return jsonb_build_object('ok', false,
        'error', 'บิลนี้ระบบสร้างให้อัตโนมัติ (' || v_source || ') — ย้ายกิจการจากหน้าแก้บิลไม่ได้ ให้แก้ที่ต้นทาง');
    end if;
    select string_agg(doc_no, ', ' order by doc_no) into v_wht
      from wht_certificates where tenant_id = v_tenant and p_tx_id = any(tx_ids)
       and status = 'ปกติ';   -- D180: ใบที่ยกเลิกแล้วไม่ผูกบิลไว้กับกิจการเดิม
    if v_wht is not null then
      return jsonb_build_object('ok', false,
        'error', 'บิลนี้ออกใบ 50ทวิ ไปแล้ว (' || v_wht || ') ในนามกิจการเดิม — ย้ายกิจการไม่ได้ ให้ยกเลิกใบ 50ทวิ ก่อน (บัญชี → เอกสารสรรพากร) แล้วย้ายบิล แล้วออกใบใหม่ในกิจการที่ถูก');
    end if;
    if v_type = 'สำรองจ่าย' and v_adv_for = v_new_entity then
      return jsonb_build_object('ok', false,
        'error', 'บิลนี้สำรองจ่ายให้ ' || v_new_entity || ' อยู่แล้ว — ย้ายไปเป็นของกิจการนั้นเองไม่ได้ ให้ยกเลิกแล้วบันทึกใหม่เป็นรายจ่าย');
    end if;
  end if;

  update transactions set
    transaction_date     = _d(p,'transaction_date'),
    type                 = p->>'type',
    account_name         = nullif(p->>'account_name',''),
    category             = p->>'category',
    contact_name         = p->>'contact_name',
    contact_id           = nullif(p->>'contact_id',''),
    description          = p->>'description',
    base_amount          = coalesce((p->>'base_amount')::numeric,0),
    discount             = coalesce((p->>'discount')::numeric,0),
    amount_after_discount= coalesce((p->>'amount_after_discount')::numeric,0),
    vat_amount           = coalesce((p->>'vat_amount')::numeric,0),
    wht_rate             = coalesce((p->>'wht_rate')::numeric,0),
    wht_amount           = coalesce((p->>'wht_amount')::numeric,0),
    -- D179: ไม่มี key = คงค่าเดิม (connector edit_bill / client เก่า) · ไม่หักแล้ว = ล้าง
    wht_base             = case when coalesce((p->>'wht_amount')::numeric,0) <= 0 then null
                                when p ? 'wht_base' then nullif(p->>'wht_base','')::numeric
                                else wht_base end,
    net_amount           = coalesce((p->>'net_amount')::numeric,0),
    tax_invoice_no       = nullif(p->>'tax_invoice_no',''),
    tax_invoice_date     = _d(p,'tax_invoice_date'),
    entity_id            = coalesce(nullif(p->>'entity_id',''), entity_id)
  where tx_id = p_tx_id;

  -- แทนที่ items ทั้งหมดของบิลนี้ (ลบเก่า → insert ใหม่ ด้วย id เดิม pattern {txId}-NN)
  delete from transaction_items where tx_id = p_tx_id;
  for it in select value from jsonb_array_elements(p_items) loop
    idx := idx + 1;
    insert into transaction_items(
      item_id, tx_id, item_name, quantity, in_vat, ex_vat, total_price,
      discount_pct, discount_baht, item_category, item_job
    ) values (
      p_tx_id || '-' || lpad(idx::text,2,'0'), p_tx_id, it->>'item_name',
      coalesce((it->>'quantity')::numeric,1), coalesce((it->>'in_vat')::numeric,0),
      coalesce((it->>'ex_vat')::numeric,0), coalesce((it->>'total_price')::numeric,0),
      coalesce((it->>'discount_pct')::numeric,0), coalesce((it->>'discount_baht')::numeric,0),
      nullif(it->>'item_category',''), nullif(it->>'item_job','')
    );
  end loop;

  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'tx_id', p_tx_id, 'items', idx);
end $$;

notify pgrst, 'reload schema';
