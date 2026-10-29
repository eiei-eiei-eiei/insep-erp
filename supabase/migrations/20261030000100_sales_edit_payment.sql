-- ─────────────────────────────────────────────────────────────────────────────
-- 0100 — แอปขาย: แก้วิธีชำระของการรับเงินที่บันทึกไปแล้ว  (D144 · เฟส 2 ของแบ่งชำระหลายงวด)
--
-- 🎯 ผู้ใช้: ลงวิธีชำระผิด (เช่น รับโอนแต่กดเงินสด) แล้วอยากแก้ — ส่วนใหญ่แก้ก่อนส่งใบเสร็จให้ลูกค้า
--    จึงต้อง "แก้เอกสารด้วย" = พิมพ์ใบเดิมซ้ำแล้วได้วิธีใหม่ด้วยเลขเดิม (print.ts อ่านแถว sales_payments · 0099)
--    เปลี่ยนเป็นเช็คได้ (ต้องมีรายละเอียดเช็ค) · หัวหน้าฝ่ายขายขึ้นไป (sales.config)
--
-- แก้ในคำสั่งเดียว (transaction เดียว):
--   1. sales_payments.method / cheque_detail ของครั้งนั้น
--   2. บิลรายรับที่ผูกกัน: account_name (บัญชีเงินสดแยก D142 ตัดสินจากวิธีชำระ) + วงเล็บท้ายคำอธิบาย
--   3. ช่องเดิมบนออเดอร์ให้ตรงกัน (payment_method = ของครั้งล่าสุด · check_detail ช่องของป้ายนั้น)
--      ★ ช่องเดิมยังเป็นทางสำรองของใบเสร็จออเดอร์ที่ไม่มีแถว — ปล่อยให้ค้างค่าเก่า = ความจริง 2 แหล่ง (D81)
-- 🚨 ไม่แตะ ยอด · VAT · เลขเอกสาร · วันที่ · สต็อก — วิธีชำระไม่มีผลกับตัวเลขภาษีเลย (รายงานไม่กรองบัญชี D124)
-- 🚨 บัญชีปลายทางคำนวณฝั่ง server action (revenueAccountFor · แหล่งเดียวกับตอนรับเงิน) แล้วส่งมา
--    ที่นี่ตรวจว่าเป็นบัญชีที่มีจริงของลูกค้ารายนี้ (กันยิง RPC ตรงด้วยชื่อมั่ว)
-- 🚨 บิลที่ถูกยกเลิกแล้ว (ยกเลิกออเดอร์ หรือยกเลิกจากหน้าค้นบิล) แก้ไม่ได้ — บอกเหตุผล
-- ★ definer ใหม่มีด่าน my_tenant() + has_cap() ⇒ audit สิทธิ์ (D99) ผ่านตามหมวดมีด่าน · ไม่มีตารางใหม่ (D118)
-- ★ edit_log บันทึกค่าก่อน/หลังเองทั้ง 3 ตาราง (trigger audit_* มีอยู่แล้ว)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function fn_sales_edit_payment(
  p_qu_no text, p_seq integer, p_method text, p_cheque text, p_account text
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := my_tenant();
  v_pay sales_payments%rowtype;
  v_tx transactions%rowtype;
  v_method text := nullif(trim(coalesce(p_method, '')), '');
  v_cheque text := nullif(trim(coalesce(p_cheque, '')), '');
  v_account text := nullif(trim(coalesce(p_account, '')), '');
  v_last int;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if not has_cap('sales.config') then
    raise exception 'แก้วิธีชำระได้เฉพาะหัวหน้าฝ่ายขายขึ้นไป';
  end if;
  -- 🚨 ชุดเดียวกับ PAY_METHODS ใน lib/sales/payments.ts (เทสเทียบ)
  if v_method is null or not (v_method = any (array['โอนเงิน', 'เงินสด', 'บัตรเครดิต', 'เช็ค'])) then
    raise exception 'วิธีชำระไม่ถูกต้อง';
  end if;
  if v_method = 'เช็ค' and v_cheque is null then
    raise exception 'เปลี่ยนเป็นเช็ค ต้องกรอกรายละเอียดเช็คด้วย';
  end if;
  if v_method <> 'เช็ค' then v_cheque := null; end if;

  select * into v_pay from sales_payments
   where tenant_id = v_tenant and qu_no = p_qu_no and seq = p_seq for update;
  if not found then raise exception 'ไม่พบการรับเงินครั้งนี้ (อาจถูกแก้จากอีกเครื่องไปแล้ว — โหลดหน้าใหม่)'; end if;

  if v_pay.tx_id is not null then
    select * into v_tx from transactions
     where tenant_id = v_tenant and tx_id = v_pay.tx_id for update;
    if found and v_tx.status = 'ยกเลิก' then
      raise exception 'บิลรายรับ % ของครั้งนี้ถูกยกเลิกไปแล้ว — แก้วิธีชำระไม่ได้', v_pay.tx_id;
    end if;
  end if;

  if v_account is not null and not exists (
    select 1 from bank_accounts where tenant_id = v_tenant and account_name = v_account
  ) then
    raise exception 'ไม่พบบัญชี "%" ในระบบ — ตรวจที่ ตั้งค่า → กิจการ (บัญชีรับรายได้จากการขาย)', v_account;
  end if;

  -- 1) แถวการรับเงิน
  update sales_payments set method = v_method, cheque_detail = v_cheque
   where tenant_id = v_tenant and qu_no = p_qu_no and seq = p_seq;

  -- 2) บิลรายรับ — บัญชี + วงเล็บท้ายคำอธิบาย ("อ้างอิง QU: … (เงินสด)" → "(โอนเงิน)")
  if v_tx.tx_id is not null then
    update transactions set
      account_name = coalesce(v_account, account_name),
      description = case
        when coalesce(description, '') ~ '\([^()]*\)\s*$'
          then regexp_replace(description, '\([^()]*\)\s*$', '(' || v_method || ')')
        else trim(coalesce(description, '') || ' (' || v_method || ')')
      end
     where tenant_id = v_tenant and tx_id = v_tx.tx_id;
  end if;

  -- 3) ช่องเดิมบนออเดอร์
  select max(seq) into v_last from sales_payments where tenant_id = v_tenant and qu_no = p_qu_no;
  update sales_orders set
    payment_method = case when p_seq = v_last then v_method else payment_method end,
    check_detail1  = case when v_pay.label = 'มัดจำ' then v_cheque else check_detail1 end,
    check_detail2  = case when v_pay.label <> 'มัดจำ' then v_cheque else check_detail2 end
   where tenant_id = v_tenant and qu_no = p_qu_no;

  return jsonb_build_object(
    'ok', true,
    'from_method', v_pay.method,
    'from_account', v_tx.account_name,
    'to_account', coalesce(v_account, v_tx.account_name),
    'tx_id', v_tx.tx_id,
    'doc_no', v_pay.doc_no
  );
end $fn$;

notify pgrst, 'reload schema';
