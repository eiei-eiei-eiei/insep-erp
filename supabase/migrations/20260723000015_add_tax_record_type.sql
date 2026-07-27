-- ============================================================================
-- 0015 เพิ่ม type 'บันทึกภาษี' (ภาษีซื้อนำเข้า/ศุลกากร) — ตาม feedback ผู้ใช้ Phase 5
--   ผู้ใช้บันทึก import VAT (เคลียร์ขวดนำเข้า/ศุลกากร) เป็น type แยกจาก 'รายจ่าย'
--   พฤติกรรม (ดู DECISIONS D29):
--     · เข้า ภพ.30 ฝั่ง "ภาษีซื้อ" (lib/accounting/calc.ts taxReport)
--     · ไม่กระทบยอดบัญชี/เงินสด (ledger txEffect คืน 0 ให้ type นี้อยู่แล้ว — ไม่ต้องแก้)
-- ============================================================================

alter table transactions drop constraint if exists transactions_type_check;
alter table transactions add constraint transactions_type_check
  check (type in ('รายรับ','รายจ่าย','โอนระหว่างบัญชี','เช็คราคา','บันทึกภาษี'));
