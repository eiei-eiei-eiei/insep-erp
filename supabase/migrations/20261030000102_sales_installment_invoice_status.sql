-- ─────────────────────────────────────────────────────────────────────────────
-- 0102 — แอปขาย: ใบแจ้งหนี้งวดแรกล็อกการแก้ใบเสนอราคา  (D146 · เฟส 3b ของแบ่งชำระหลายงวด)
--
-- 🎯 เฟส 3b ใบเสนอราคามีตัวแก้งวด · แก้ใบเสนอราคา = ยอดสุทธิเปลี่ยน = แผนงวดต้องคิดใหม่
--    🚨 แต่ถ้าออกใบแจ้งหนี้ของงวดไปแล้ว ใบอยู่ในมือลูกค้า ยอดงวดนั้นห้ามขยับ
-- → ออกใบแจ้งหนี้งวดแรก: 'รอคอนเฟิร์ม' → 'รอชำระมัดจำ' (สถานะเดียวกับใบแจ้งหนี้มัดจำเดิม D45)
--   fn_update_quotation รับแค่ 'รอคอนเฟิร์ม' อยู่แล้ว ⇒ DB บล็อกการแก้เอง ไม่ต้องยกฟังก์ชันนั้น
-- → ยกเลิกใบแจ้งหนี้จนไม่เหลือใบไหนและยังไม่รับเงิน → กลับ 'รอคอนเฟิร์ม' (เหมือน fn_void_deposit_invoice)
-- ★ ยกฟังก์ชันจาก 0101 ด้วยสคริปต์ + diff · signature เดิม = สิทธิ์เดิม (D99) · ไม่มีตารางใหม่
-- ─────────────────────────────────────────────────────────────────────────────

-- ── ยกจาก 20261030000101_sales_installments.sql ──
create or replace function fn_sales_installment_invoice(
  p_qu_no text, p_seq integer, p_inv_no text, p_inv_date date, p_due_date date
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := my_tenant();
  v_status text;
  v_next int;
  v_inst sales_installments%rowtype;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if not has_cap('sales.write') then raise exception 'ไม่มีสิทธิ์ออกใบแจ้งหนี้'; end if;
  select status into v_status from sales_orders where tenant_id = v_tenant and qu_no = p_qu_no for update;
  if not found then raise exception 'ไม่พบออเดอร์ %', p_qu_no; end if;
  if v_status in ('ยกเลิก', 'ปิดการขาย') then raise exception 'ออเดอร์ % % แล้ว', p_qu_no, v_status; end if;

  select * into v_inst from sales_installments where tenant_id = v_tenant and qu_no = p_qu_no and seq = p_seq for update;
  if not found then raise exception 'ไม่พบงวดที่ %', p_seq; end if;
  if v_inst.inv_no is not null then raise exception 'งวดที่ % ออกใบแจ้งหนี้ไปแล้ว (%)', p_seq, v_inst.inv_no; end if;
  select min(seq) into v_next from sales_installments i
   where i.tenant_id = v_tenant and i.qu_no = p_qu_no and not sales_installment_paid(v_tenant, p_qu_no, i.seq);
  if v_next is distinct from p_seq then
    raise exception 'ออกใบแจ้งหนี้ได้เฉพาะงวดถัดไป (งวดที่ %)', v_next;
  end if;
  if coalesce(trim(p_inv_no), '') = '' then raise exception 'ไม่มีเลขใบแจ้งหนี้'; end if;
  if fn_doc_no_taken(v_tenant, 'sales_inv', null, trim(p_inv_no)) then
    raise exception 'เลข % มีเอกสารใช้อยู่แล้ว', trim(p_inv_no);
  end if;

  update sales_installments set inv_no = trim(p_inv_no), inv_date = coalesce(p_inv_date, current_date),
         due_date = coalesce(p_due_date, due_date)
   where tenant_id = v_tenant and qu_no = p_qu_no and seq = p_seq;
  -- ★ D146 — ใบแจ้งหนี้งวดแรกออกแล้ว = แก้ใบเสนอราคาไม่ได้อีก (fn_update_quotation รับแค่ 'รอคอนเฟิร์ม')
  --   สถานะเดียวกับใบแจ้งหนี้มัดจำแบบเดิม (D45) — ใบอยู่ในมือลูกค้าแล้ว ยอดสุทธิห้ามเปลี่ยน
  update sales_orders set status = 'รอชำระมัดจำ'
   where tenant_id = v_tenant and qu_no = p_qu_no and status = 'รอคอนเฟิร์ม';
  return jsonb_build_object('ok', true, 'inv_no', trim(p_inv_no));
end $fn$;

-- ── ยกจาก 20261030000101_sales_installments.sql ──
create or replace function fn_sales_void_installment_invoice(p_qu_no text, p_seq integer)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := my_tenant();
  v_inv text;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if not has_cap('sales.config') then raise exception 'ยกเลิกใบแจ้งหนี้ได้เฉพาะหัวหน้าฝ่ายขายขึ้นไป'; end if;
  select inv_no into v_inv from sales_installments
   where tenant_id = v_tenant and qu_no = p_qu_no and seq = p_seq for update;
  if not found then raise exception 'ไม่พบงวดที่ %', p_seq; end if;
  if v_inv is null then raise exception 'งวดที่ % ยังไม่ได้ออกใบแจ้งหนี้', p_seq; end if;
  if sales_installment_paid(v_tenant, p_qu_no, p_seq) then
    raise exception 'งวดที่ % รับเงินแล้ว — ยกเลิกใบแจ้งหนี้ไม่ได้', p_seq;
  end if;
  update sales_installments set inv_no = null, inv_date = null
   where tenant_id = v_tenant and qu_no = p_qu_no and seq = p_seq;
  -- ★ D146 — ยังไม่รับเงินสักงวดและไม่เหลือใบแจ้งหนี้ใบไหน → กลับไปแก้ใบเสนอราคาได้ (เหมือน fn_void_deposit_invoice)
  update sales_orders o set status = 'รอคอนเฟิร์ม'
   where o.tenant_id = v_tenant and o.qu_no = p_qu_no and o.status = 'รอชำระมัดจำ'
     and not exists (select 1 from sales_installments i where i.tenant_id = v_tenant and i.qu_no = p_qu_no
                      and (i.inv_no is not null or sales_installment_paid(v_tenant, p_qu_no, i.seq)));
  return jsonb_build_object('ok', true, 'inv_no', v_inv);
end $fn$;

notify pgrst, 'reload schema';
