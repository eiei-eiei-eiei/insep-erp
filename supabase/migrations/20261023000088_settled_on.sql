-- ════════════════════════════════════════════════════════════════════════════
-- 0088 — D123: วันที่เคลียบิลค้าง (settled_on)
--
-- ที่มา: บิลค้างรับ/ค้างจ่ายที่กด "ชำระ" — ยอดเงินในบัญชีเคยตัดตาม "วันที่รายการ"
--   (วันที่ออกบิล) ไม่ใช่วันที่เงินเข้า/ออกจริง ⇒ ตั้งค้างจ่าย 10/10 แล้วจ่าย 10/11
--   ยอดเงินในแอปลดตั้งแต่เดือน ต.ค. ทั้งที่ธนาคารยังไม่ขยับ
--
-- ★ ทำไมไม่ใช้ payment_date ที่มีอยู่แล้ว: ช่องนั้นถูกเขียนจาก 2 ทาง —
--   กดชำระบิลค้าง (fn_settle_apar) และ **กรอกวันที่จ่ายตอนออก 50ทวิ** (fn_issue_wht)
--   ให้ยอดเงินอ่าน payment_date = ออกใบ 50ทวิ ของบิลเงินสดธรรมดาแล้วเงินย้ายเดือนเอง
--   ⇒ คอลัมน์ใหม่ที่เขียนจากทางเดียว: "บิลนี้เคยค้าง และเคลียวันนี้"
--
-- ★ ไม่ backfill: ไม่มีข้อมูลว่าบิลไหนเคยเป็นบิลค้าง (ap_ar_status ถูกล้างเป็น null ตอนชำระ)
--   ⇒ บิลที่เคยชำระไปแล้วคงตัดยอดตามวันที่รายการเหมือนเดิม ไม่มีตัวเลขเก่าขยับ
-- 🚨 วันที่รายการ (transaction_date) ไม่ถูกแตะ — เดือนภาษี ภพ.30 ของบิลยังเป็นเดือนเดิมเสมอ
-- ════════════════════════════════════════════════════════════════════════════

alter table transactions add column if not exists settled_on date;

comment on column transactions.settled_on is
  'D123 — วันที่กดชำระบิลค้างรับ/ค้างจ่าย (เขียนโดย fn_settle_apar เท่านั้น) · '
  'ยอดเงิน/statement/ภงด.3/53 ใช้วันนี้แทนวันที่รายการ · ภพ.30 ยังใช้วันที่รายการ';

create or replace function fn_settle_apar(
  p_tx_id text, p_account_name text default null, p_payment_date date default null,
  p_tax_invoice_no text default null, p_tax_invoice_date date default null
) returns jsonb
language plpgsql set search_path = public as $$
declare
  n int;
  -- ★ วันที่ไทย ไม่ใช่ current_date (UTC) — กดชำระเที่ยงคืนถึง 7 โมงเช้าจะได้วันของเมื่อวาน (D100)
  v_date date := coalesce(p_payment_date, (now() at time zone 'Asia/Bangkok')::date);
begin
  update transactions set
    account_name    = coalesce(nullif(p_account_name,''), account_name),
    tax_invoice_no  = coalesce(nullif(p_tax_invoice_no,''), tax_invoice_no),
    tax_invoice_date= coalesce(p_tax_invoice_date, tax_invoice_date),
    ap_ar_status    = null,
    payment_date    = v_date,
    settled_on      = v_date
  where tx_id = p_tx_id and ap_ar_status is not null;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'ไม่พบบิลค้าง ' || p_tx_id); end if;
  return jsonb_build_object('ok', true);
end $$;
