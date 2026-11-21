-- ============================================================================
-- 0112 ยอดที่ใช้คิดหัก ณ ที่จ่าย ต่อบิล — transactions.wht_base (D179)
--
-- ที่มา: บิลค่าทำของ + ค่าขนส่ง ผู้ขายให้หัก ณ ที่จ่ายเฉพาะค่าทำของ
--   ผู้ใช้แก้ยอดภาษีหักเองได้ แต่ระบบไม่รู้ว่า "หักจากยอดไหน" ⇒ ใบ 50ทวิ / ภงด.3/53
--   พิมพ์ "จำนวนเงินที่จ่าย" เป็นยอดก่อน VAT ทั้งบิล (รวมค่าขนส่ง) = ยอดผิดบนเอกสารราชการ
--
-- ไฟล์นี้มี 2 เรื่อง:
--   1. คอลัมน์ transactions.wht_base (null = ยอดหลังหักส่วนลดทั้งบิล = พฤติกรรมเดิม)
--      ⇒ บิลเก่าทั้งหมดได้ผลเท่าเดิมเป๊ะ ไม่ต้อง backfill
--   2. fn_save_transaction / fn_edit_transaction / fn_clear_advances รู้จักคอลัมน์นี้
--      🪤 fn_edit_transaction: payload ที่ "ไม่มี key wht_base" (connector edit_bill / client เก่า)
--         ต้องคงค่าเดิม ไม่ใช่ล้างเป็น null — ใช้ `p ? 'wht_base'`
--      ★ ไม่หัก ณ ที่จ่ายแล้ว (wht_amount = 0) ⇒ ล้าง wht_base ทิ้งเสมอ กันค่าค้าง
--
-- ★ ไม่มีตารางใหม่ (D118 ไม่ต้อง grant) · ไม่มี security definer ใหม่ (D99)
--   create or replace ลายเซ็นเดิม = grant เดิมคงอยู่ · ทั้งสามตัวยังเป็น invoker
-- ★ ไม่แตะสูตรเงินใน SQL — ยอดภาษีคิดฝั่ง client (lib/accounting/calc entryCalc) เหมือนเดิม
-- 🚨 ต้องลง DB ก่อน deploy โค้ด: TX_COLS (lib/accounting/reportLoaders) select คอลัมน์นี้
--    deploy ก่อน = หน้าบัญชีอ่านบิลไม่ได้ทั้งหน้า
-- ★ สร้างด้วย scripts/gen/gen-0112.mjs — ห้ามพิมพ์มือ (D79)
-- ============================================================================

-- ── 1. คอลัมน์ ───────────────────────────────────────────────────────────────
alter table transactions add column if not exists wht_base numeric(14,2);

do $$ begin
  alter table transactions add constraint transactions_wht_base_nonneg check (wht_base is null or wht_base >= 0);
exception when duplicate_object then null;
end $$;

comment on column transactions.wht_base is
  'D179 ยอดที่ใช้คิดหัก ณ ที่จ่าย (= จำนวนเงินที่จ่าย บน 50ทวิ / ภงด.3/53) · null = ยอดหลังหักส่วนลดทั้งบิล '
  '— อ่านผ่าน whtBaseOf() ใน lib/accounting/calc เท่านั้น';

-- ── 2. RPC ที่เขียนบิล ────────────────────────────────────────────────────────
