-- ============================================================================
-- 0012 50ทวิ ปรับปรุง (ตาม feedback ผู้ใช้ Phase 3)
--   · รันเลขเอกสารแยกต่อกิจการ → PK เปลี่ยนเป็น (entity_id, doc_no) (เดิม doc_no เดี่ยว)
--   · เพิ่ม income_seq (ประเภทเงินได้ 1-6) — เลือกก่อนออก, ลงแถวใน 50ทวิ ให้ตรง
--   · fn_issue_wht รับ issue_date (วันออกหนังสือ แก้ได้) + income_seq
--   · fn_update_wht — แก้ใบที่ออกแล้ว (เลขที่/วันออก/ประเภทเงินได้/pnd)
-- ============================================================================

alter table wht_certificates add column if not exists income_seq int not null default 6;

-- เปลี่ยน PK ให้เลขซ้ำข้ามกิจการได้ (คนละบริษัทรันเลขแยกกัน)
alter table wht_certificates drop constraint if exists wht_certificates_pkey;
alter table wht_certificates add primary key (entity_id, doc_no);

-- ── ออก 50ทวิ (แทนของเดิมใน 0011) — เพิ่ม income_seq, issue_date = วันออก (แก้ได้) ──
drop function if exists fn_issue_wht(text, text[], date, text, text, numeric, text, text, numeric, date, text);
create or replace function fn_issue_wht(
  p_doc_no text, p_tx_ids text[], p_issue_date date, p_contact_name text, p_address text,
  p_wht_amount numeric, p_pnd_type text, p_income_type text, p_income_seq int, p_base_amount numeric,
  p_payment_date date, p_entity_id text
) returns jsonb
language plpgsql set search_path = public as $$
declare v_entity text := coalesce(nullif(p_entity_id,''),'EID01');
begin
  insert into wht_certificates(doc_no, issue_date, contact_name, address, wht_amount,
    pnd_type, income_type, income_seq, base_amount, tx_ids, entity_id)
  values (p_doc_no, coalesce(p_issue_date, current_date), p_contact_name, p_address, p_wht_amount,
    p_pnd_type, p_income_type, coalesce(p_income_seq, 6), p_base_amount, coalesce(p_tx_ids,'{}'), v_entity);

  -- เขียนวันที่จ่าย (col W เดิม) ให้ทุก tx ที่ออกใบนี้
  update transactions set payment_date = coalesce(p_payment_date, current_date)
    where tx_id = any(coalesce(p_tx_ids,'{}'));

  return jsonb_build_object('ok', true, 'doc_no', p_doc_no);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'เลขเอกสาร ' || p_doc_no || ' ถูกใช้แล้วในกิจการนี้ ลองใหม่');
end $$;

-- ── แก้ใบที่ออกแล้ว (เลขที่/วันออก/ประเภทเงินได้/pnd) ──────────────────────────
create or replace function fn_update_wht(
  p_entity_id text, p_old_doc_no text, p_new_doc_no text, p_issue_date date,
  p_pnd_type text, p_income_seq int, p_income_type text
) returns jsonb
language plpgsql set search_path = public as $$
declare n int;
begin
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
