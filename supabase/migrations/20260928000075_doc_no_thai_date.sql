-- ============================================================================
-- 0075 เลขเอกสารใช้ "วันนี้ตามเวลาไทย" (D100 เฟส 0)
--
-- 🔴 บั๊ก: เลขเอกสารฝั่งขาย (QU/ORD/INV/TAX) และรหัส TR-/TRF- ประกอบวันที่ด้วย `current_date`
--    ซึ่งบน Supabase คือเวลา **UTC** ⇒ เอกสารที่ออกช่วง 00:00–06:59 เวลาไทยได้เลขของ "เมื่อวาน"
--    (ออกตี 2 วันที่ 28 ได้ TAX260927-…) · ฝั่งบาร์เคยเจอแล้วแก้เป็น Asia/Bangkok ใน 0065
--    แต่ฝั่งขาย/บัญชีไม่ได้ตามไปแก้
--
-- ★ ขอบเขตแคบโดยตั้งใจ: แก้เฉพาะการ **ประกอบเลข** · ไม่แตะ `current_date` ที่ใช้เป็นวันที่
--    ของข้อมูล (เช่น `log_product.doc_date`) — เรื่องนั้นอยู่ในงานลงเอกสารย้อนหลัง (D100 เฟส 3)
--    ที่ต้องคิดวันที่ของเอกสาร บัญชี และฟอร์ม ภส. ไปพร้อมกัน
-- ★ ไม่ตั้ง timezone ระดับ database — เปลี่ยน `current_date` ทุกจุดทั้งฐานพร้อมกันเงียบ ๆ
--    รวมวันที่ที่ลงฟอร์มราชการ ซึ่งต้องตัดสินทีละจุด ไม่ใช่เหมาทั้งก้อน
-- ★ key ของตัวนับยังเป็นรูปแบบเดิมเป๊ะ (`QU-260928` · `TR-20260928`) แค่วันที่ถูกต้อง
-- ============================================================================

-- ── 1) วันนี้ตามเวลาไทย — จุดเดียวของทั้งระบบฝั่ง SQL ─────────────────────────────
--    ★ invoker + stable (ไม่ใช่ definer) — ไม่มีสิทธิ์อะไรให้รั่ว
create or replace function fn_today_th() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Bangkok')::date;
$$;

comment on function fn_today_th() is
  'วันนี้ตามเวลาไทย — ใช้ประกอบเลขเอกสาร (current_date บน Supabase เป็น UTC) · D100';

-- ── 2) next_tx_id / fn_next_sales_doc — ตัวเดียวกับ 0011/0013 เปลี่ยนแค่ที่มาของวันที่ ──
create or replace function next_tx_id() returns text
language sql set search_path = public as $$
  select 'TR-' || to_char(fn_today_th(), 'YYYYMMDD') || '-' ||
         lpad(next_serial('TR-' || to_char(fn_today_th(), 'YYYYMMDD'))::text, 4, '0');
$$;

-- 🚨 ยังเป็น definer ตามเดิม (0013) · นับเลขผ่าน next_serial ที่มีด่าน my_tenant()
--    ⇒ อยู่ใน DEFINER_ALLOWLIST หมวด delegates
-- 🪤 **ห้ามเรียก fn_today_th() ในตัวนี้** — ตัวตรวจหมวด delegates (D99) ยอมให้ส่งต่อได้เฉพาะ
--    ฟังก์ชันที่ปิดแล้วหรือมีด่าน · fn_today_th ไม่มีทั้งสองอย่าง ⇒ audit แดง
--    จึงเขียนนิพจน์ตรง ๆ แบบเดียวกับ fn_bar_next_doc (0065)
-- ★ create or replace (ไม่ใช่ drop+create) = สิทธิ์ execute คงเดิม ไม่ได้ default คืน (D99)
create or replace function fn_next_sales_doc(p_prefix text) returns text
language sql security definer set search_path = public as $$
  select p_prefix || to_char((now() at time zone 'Asia/Bangkok')::date,'YYMMDD') || '-' ||
         lpad(next_serial(p_prefix || '-' ||
              to_char((now() at time zone 'Asia/Bangkok')::date,'YYMMDD'))::text, 3, '0');
$$;

-- ── 3) fn_save_transfer — ยกจาก 20260720000011_accounting_rpc.sql · แทนแค่ 2 บรรทัดประกอบเลข TRF ───────────
create or replace function fn_save_transfer(
  p_from text, p_to text, p_amount numeric, p_date date,
  p_note text default '', p_entity text default null
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_trf text;
  v_from_id text; v_to_id text;
  v_date date := coalesce(p_date, current_date);
  v_note text := coalesce(trim(p_note),'');
begin
  if coalesce(p_from,'')='' or coalesce(p_to,'')='' then
    return jsonb_build_object('ok', false, 'error', 'กรุณาระบุบัญชีต้นทางและปลายทาง'); end if;
  if p_from = p_to then
    return jsonb_build_object('ok', false, 'error', 'บัญชีต้นทางและปลายทางต้องไม่ใช่บัญชีเดียวกัน'); end if;
  if coalesce(p_amount,0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'จำนวนเงินต้องมากกว่า 0'); end if;

  v_trf := 'TRF-' || to_char(fn_today_th(),'YYYYMMDD') || '-' ||
           lpad(next_serial('TRF-' || to_char(fn_today_th(),'YYYYMMDD'))::text, 4, '0');
  v_from_id := next_tx_id();
  v_to_id := next_tx_id();

  insert into transactions(tx_id, transaction_date, type, account_name, category, contact_name,
    description, net_amount, tax_invoice_date, status, transfer_id, entity_id, source)
  values
    (v_from_id, v_date, 'โอนระหว่างบัญชี', p_from, 'โอนระหว่างบัญชี', '',
     'โอนออกไป [' || p_to || ']' || case when v_note<>'' then ' · '||v_note else '' end,
     -p_amount, v_date, 'ปกติ', v_trf, coalesce(p_entity,''), 'ui'),
    (v_to_id, v_date, 'โอนระหว่างบัญชี', p_to, 'โอนระหว่างบัญชี', '',
     'รับโอนจาก [' || p_from || ']' || case when v_note<>'' then ' · '||v_note else '' end,
     p_amount, v_date, 'ปกติ', v_trf, coalesce(p_entity,''), 'ui');

  return jsonb_build_object('ok', true, 'transfer_id', v_trf, 'tx_id_from', v_from_id, 'tx_id_to', v_to_id);
end $$;

notify pgrst, 'reload schema';
