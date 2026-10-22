-- ============================================================================
-- 0087 จำกัดผู้ใช้ให้เห็นเฉพาะบางกิจการ — อุดรูที่ allowed_entity_ids ยังไม่ครอบ (D120)
--
-- 🎯 โจทย์: ลูกค้า PAT&AIM ให้พนักงาน (คุณเอม) เห็นแค่บริษัท EID01
--    กิจการที่เหลือเป็นข้อมูลส่วนตัวของเจ้าของ
--
-- ★ ฐานมีอยู่แล้วตั้งแต่ 0006: profiles.allowed_entity_ids + my_entities() และ RLS ฝั่ง
--   select ของ transactions/tax/wht/employees/payroll_periods/entities กรองให้แล้ว
--   แต่ไล่ policy ล่าสุดของทุกตารางแล้วพบ 3 กลุ่มที่ยังรั่ว:
--
--   1) bank_accounts ทุกคนอ่าน/แก้ได้ทุกบัญชี — พนักงานเห็นชื่อบัญชีส่วนตัวพร้อมยอดยกมา
--      และคนที่มี acct.config แก้บัญชีส่วนตัวได้
--   2) ฝั่ง "เขียน" ของตารางลูก ไม่มีขอบเขตกิจการ (policy select กรองแล้ว แต่ for all ไม่ได้กรอง):
--      transaction_items · tax_summaries · wht_certificates · report_runs · payroll_items
--      🚨 ร้ายสุดคือ ti_w: ลบรายการสินค้าของบิลที่ตัวเองมองไม่เห็นได้ ถ้ารู้เลข tx_id
--      (DELETE ใช้ USING ของ policy for all ⇒ ผ่าน เพราะไม่มีเงื่อนไขกิจการ)
--      และ payroll_items อ่านข้ามกิจการได้ด้วย (ไม่มี entity_id ในตัว ต้องไล่ผ่านงวด)
--   3) RPC security definer ที่รับกิจการมาเอง แต่ไม่ถามว่าผู้เรียกมีสิทธิ์ในกิจการนั้น:
--      fn_pay_tax · fn_unpay_tax · fn_post_payroll · fn_unpost_payroll · fn_wht_doc_nos
--      (definer = ข้าม RLS ⇒ จ่ายภาษี/ลงบัญชีเงินเดือนเข้ากิจการที่มองไม่เห็นได้)
--      ★ fn_file_tax/fn_unfile_tax (0072) และ bar_guard (0065) มีด่านนี้อยู่แล้ว — ยกแพตเทิร์นมาใช้
--
-- 🚨 ขอบเขตที่จงใจยังไม่ครอบ: ตารางฝั่ง ผลิต/ขาย/บาร์ ไม่ได้กรองตามกิจการเลยตั้งแต่ต้น
--    (คนที่ถูกจำกัดยังเห็นข้อมูลผลิต/ขายของทุกกิจการ) — บอกบนหน้าจอตั้งค่าผู้ใช้ตรง ๆ
--    contacts ใช้ร่วมทั้ง tenant (ผู้ใช้ตกลงแล้ว — เห็นชื่อร้านแต่ไม่เห็นยอดเงิน)
-- ★ main ไม่ถูกจำกัด — แอปไม่ยอมตั้งให้ main (มีสิทธิ์ admin แก้ profile ตัวเองคืนได้อยู่แล้ว)
-- ★ ไม่มีตารางใหม่ (D118) · ไม่มี definer ใหม่ · ยกฟังก์ชันด้วย scripts/gen/gen-0087.mjs (D79)
-- ============================================================================

-- ── 1. bank_accounts — เห็น/แก้ได้เฉพาะบัญชีของกิจการที่มีสิทธิ์ ─────────────────
-- entity_ids ว่าง = บัญชีที่ใช้ร่วมทุกกิจการ → ทุกคนเห็น (ความหมายเดิมทั้งแอป)
drop policy if exists bank_accounts_sel on bank_accounts;
create policy bank_accounts_sel on bank_accounts for select
  using (tenant_id = my_tenant()
         and (my_entities() is null
              or coalesce(array_length(entity_ids, 1), 0) = 0
              or entity_ids && my_entities()));
drop policy if exists bank_accounts_w on bank_accounts;
create policy bank_accounts_w on bank_accounts for all
  using (tenant_id = my_tenant() and has_cap('acct.config')
         and (my_entities() is null
              or coalesce(array_length(entity_ids, 1), 0) = 0
              or entity_ids && my_entities()))
  with check (tenant_id = my_tenant() and has_cap('acct.config')
         and (my_entities() is null
              or coalesce(array_length(entity_ids, 1), 0) = 0
              or entity_ids <@ my_entities()));
-- 🪤 with check ใช้ <@ (ทุกกิจการของบัญชีต้องอยู่ในสิทธิ์) ไม่ใช่ && — ไม่งั้นพนักงานเพิ่มบัญชี
--    ที่ผูก [EID01, EID02] แล้วไปโผล่ในกิจการที่ตัวเองไม่มีสิทธิ์ได้

-- ── 2. ฝั่งเขียนของตารางลูก — ขอบเขตเดียวกับฝั่งอ่าน ─────────────────────────────
drop policy if exists ti_w on transaction_items;
create policy ti_w on transaction_items for all
  using (tenant_id = my_tenant() and has_cap('acct.write')
         and exists (select 1 from transactions t
                      where t.tenant_id = transaction_items.tenant_id
                        and t.tx_id = transaction_items.tx_id
                        and (my_entities() is null or t.entity_id = any(my_entities()))))
  with check (tenant_id = my_tenant() and has_cap('acct.write')
         and exists (select 1 from transactions t
                      where t.tenant_id = transaction_items.tenant_id
                        and t.tx_id = transaction_items.tx_id
                        and (my_entities() is null or t.entity_id = any(my_entities()))));

drop policy if exists ts_w on tax_summaries;
create policy ts_w on tax_summaries for all
  using (tenant_id = my_tenant() and has_cap('acct.write')
         and (my_entities() is null or entity_id = any(my_entities())))
  with check (tenant_id = my_tenant() and has_cap('acct.write')
         and (my_entities() is null or entity_id = any(my_entities())));

-- ★ คงเงื่อนไข emp_id ของ 0052 ไว้ครบ (ฝ่ายเงินเดือนเขียนได้เฉพาะใบพนักงาน)
drop policy if exists wht_w on wht_certificates;
create policy wht_w on wht_certificates for all
  using (
    tenant_id = my_tenant()
    and (has_cap('acct.write') or (has_cap('pay.write') and emp_id is not null))
    and (my_entities() is null or entity_id = any(my_entities()))
  )
  with check (
    tenant_id = my_tenant()
    and (has_cap('acct.write') or (has_cap('pay.write') and emp_id is not null))
    and (my_entities() is null or entity_id = any(my_entities()))
  );

-- ★ คงเงื่อนไข 2 โดเมนของ 0055 ไว้ครบ (🚨 อย่าย้ายกลับไปลูปของฝั่งผลิต)
drop policy if exists report_runs_sel on report_runs;
create policy report_runs_sel on report_runs for select
  using (tenant_id = my_tenant() and (has_cap('prod.read') or has_cap('acct.read'))
         and (my_entities() is null or entity_id = any(my_entities())));
drop policy if exists report_runs_w on report_runs;
create policy report_runs_w on report_runs for all
  using (tenant_id = my_tenant() and (has_cap('prod.write') or has_cap('acct.write'))
         and (my_entities() is null or entity_id = any(my_entities())))
  with check (tenant_id = my_tenant() and (has_cap('prod.write') or has_cap('acct.write'))
         and (my_entities() is null or entity_id = any(my_entities())));

-- payroll_items ไม่มี entity_id ในตัว → ไล่ผ่านงวด (payroll_periods มี entity_id)
drop policy if exists pi_sel on payroll_items;
create policy pi_sel on payroll_items for select
  using (tenant_id = my_tenant() and has_cap('pay.read')
         and exists (select 1 from payroll_periods p
                      where p.tenant_id = payroll_items.tenant_id
                        and p.period_id = payroll_items.period_id
                        and (my_entities() is null or p.entity_id = any(my_entities()))));
drop policy if exists pi_w on payroll_items;
create policy pi_w on payroll_items for all
  using (tenant_id = my_tenant() and has_cap('pay.write')
         and exists (select 1 from payroll_periods p
                      where p.tenant_id = payroll_items.tenant_id
                        and p.period_id = payroll_items.period_id
                        and (my_entities() is null or p.entity_id = any(my_entities()))))
  with check (tenant_id = my_tenant() and has_cap('pay.write')
         and exists (select 1 from payroll_periods p
                      where p.tenant_id = payroll_items.tenant_id
                        and p.period_id = payroll_items.period_id
                        and (my_entities() is null or p.entity_id = any(my_entities()))));

-- ── 3. RPC security definer — ด่านกิจการ (แพตเทิร์นเดียวกับ fn_file_tax 0072) ─────
--    ยกจาก migration ล่าสุดที่นิยามแต่ละตัวมาคำต่อคำ เติมแค่ด่าน
--    ★ create or replace = สิทธิ์ execute คงเดิม ไม่ได้ default คืน (D99)
