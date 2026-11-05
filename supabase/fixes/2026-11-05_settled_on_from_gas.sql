-- ════════════════════════════════════════════════════════════════════════════
-- แก้ข้อมูลครั้งเดียว (D157 · 2026-11-05) — บิลที่ย้ายมาจากระบบเดิม (GAS) ขึ้นใน statement ผิดวัน
--
-- ปัญหา: บิลค้างที่ชำระแล้วในระบบเดิมมีวันชำระอยู่ที่ payment_date แต่ statement/ยอดบัญชีอ่าน
--   settled_on (D123) ซึ่งตอนย้ายข้อมูลยังไม่มีคอลัมน์นี้ → ว่าง → ไปตกวันรายการ (วันเปิดบิล)
-- แก้: เติม settled_on = payment_date ให้บิลที่ระบุเลขไว้ด้านล่างเท่านั้น
--   · ไม่แตะวันรายการ / ยอด / VAT → ภพ.30 ไม่ขยับ · ยอดคงเหลือปัจจุบันไม่ขยับ
--   · ภงด.3/53 ใช้ settled_on ด้วย แต่บิลที่มีหัก ณ ที่จ่ายทุกใบในไฟล์นี้ วันชำระอยู่เดือนเดียวกับวันรายการ
--   · trigger audit_transactions บันทึกค่าเดิม/ค่าใหม่ลง edit_log ให้เอง
--
-- วิธีใช้: Supabase Dashboard → SQL Editor ของ "แต่ละโปรเจกต์" → วางทีละขั้น
--   🚨 ส่วน A รันในโปรเจกต์ของเจ้าของ (vmhiwlxdyhatucioalzp) · ส่วน B รันในโปรเจกต์ลูกค้า (tnuxrufpzeyuvwdmkojv)
--   ขั้น 2 อยู่ใน do $$ … $$ → ถ้าจำนวนแถวไม่ตรงที่คาด จะยกเลิกทั้งก้อนเอง (ไม่มีอะไรถูกแก้)
--   🪤 รันขั้น 2 ซ้ำหลังแก้สำเร็จแล้ว จะขึ้น error "แก้ได้ 0 แถว" — ปกติ แปลว่าแก้ไปแล้ว ไม่มีอะไรเปลี่ยน
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════ ส่วน A — DB เจ้าของ (tenant default · 1 ใบ) ════════════════

-- A1) ดูก่อน → ควรได้ 1 แถว · settled_on ว่าง · payment_date 2026-07-16
select tx_id, type, transaction_date, payment_date, settled_on, net_amount, contact_name, account_name
  from transactions
 where tenant_id = (select id from tenants where slug = 'default')
   and tx_id in ('TR-20260716-0001');

-- A2) แก้
do $$
declare n int;
begin
  update transactions set settled_on = payment_date
   where tenant_id = (select id from tenants where slug = 'default')
     and tx_id in ('TR-20260716-0001')
     and settled_on is null and payment_date is not null
     and status = 'ปกติ' and ap_ar_status is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'แก้ได้ % แถว ไม่ใช่ 1 — ยกเลิกทั้งหมด ไม่มีอะไรถูกแก้', n; end if;
  raise notice 'แก้แล้ว % แถว', n;
end $$;

-- A3) ถอนกลับ (ใช้เมื่ออยากย้อนเท่านั้น)
-- update transactions set settled_on = null
--  where tenant_id = (select id from tenants where slug = 'default')
--    and tx_id in ('TR-20260716-0001') and settled_on = payment_date;


-- ════════════════ ส่วน B — DB ลูกค้า (tenant aim · 19 ใบ) ════════════════

-- B1) ดูก่อน → ควรได้ 19 แถว · settled_on ว่างทุกแถว
select tx_id, type, transaction_date, payment_date, settled_on, net_amount, contact_name, account_name
  from transactions
 where tenant_id = (select id from tenants where slug = 'aim')
   and tx_id in (
     'TR-20260614-0001','TR-20260615-0004','TR-20260616-0008','TR-20260625-0004','TR-20260630-0002',
     'TR-20260625-0002','TR-20260625-0005','TR-20260630-0001','TR-20260630-0003','TR-20260730-0008',
     'TR-20260810-0006','TR-20260810-0007','TR-20260824-0003','TR-20260824-0004','TR-20260907-0002',
     'TR-20260914-0003','TR-20260917-0007','TR-20260917-0011','TR-20261008-0017')
 order by transaction_date;

-- B2) แก้
do $$
declare n int;
begin
  update transactions set settled_on = payment_date
   where tenant_id = (select id from tenants where slug = 'aim')
     and tx_id in (
       'TR-20260614-0001','TR-20260615-0004','TR-20260616-0008','TR-20260625-0004','TR-20260630-0002',
       'TR-20260625-0002','TR-20260625-0005','TR-20260630-0001','TR-20260630-0003','TR-20260730-0008',
       'TR-20260810-0006','TR-20260810-0007','TR-20260824-0003','TR-20260824-0004','TR-20260907-0002',
       'TR-20260914-0003','TR-20260917-0007','TR-20260917-0011','TR-20261008-0017')
     and settled_on is null and payment_date is not null
     and status = 'ปกติ' and ap_ar_status is null;
  get diagnostics n = row_count;
  if n <> 19 then raise exception 'แก้ได้ % แถว ไม่ใช่ 19 — ยกเลิกทั้งหมด ไม่มีอะไรถูกแก้', n; end if;
  raise notice 'แก้แล้ว % แถว', n;
end $$;

-- B3) ถอนกลับ (ใช้เมื่ออยากย้อนเท่านั้น)
-- update transactions set settled_on = null
--  where tenant_id = (select id from tenants where slug = 'aim')
--    and tx_id in (
--      'TR-20260614-0001','TR-20260615-0004','TR-20260616-0008','TR-20260625-0004','TR-20260630-0002',
--      'TR-20260625-0002','TR-20260625-0005','TR-20260630-0001','TR-20260630-0003','TR-20260730-0008',
--      'TR-20260810-0006','TR-20260810-0007','TR-20260824-0003','TR-20260824-0004','TR-20260907-0002',
--      'TR-20260914-0003','TR-20260917-0007','TR-20260917-0011','TR-20261008-0017')
--    and settled_on = payment_date;
