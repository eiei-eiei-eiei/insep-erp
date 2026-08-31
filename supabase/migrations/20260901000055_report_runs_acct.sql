-- ============================================================================
-- 0055 report_runs: ฝั่งบัญชีต้องอ่าน/เขียนได้ด้วย — D88 (เจอตอนเทสเบราว์เซอร์)
--
-- 🔴 อาการที่เจอ: ล็อกอินด้วย **พนักงานบัญชี** แล้วเปิดแท็บเอกสารสรรพากร
--    · เช็กลิสต์ขึ้น "ยังไม่ได้สร้าง" ตลอดกาล ทั้งที่เจ้าของกิจการกดสร้างไปแล้ว
--    · กด "สร้าง ภพ.30 / ภงด.3-53" แล้ว **ไม่มีแถวลง `report_runs` เลย** (เงียบ ๆ)
--    · และหลังมี D88: **ปุ่มบันทึกจ่ายถูกล็อกถาวรสำหรับฝ่ายบัญชี** เพราะกฎ
--      "ต้องสร้างแบบก่อนถึงจะจ่ายได้" อ่านสถานะจากตารางนี้
--
-- 🚨 สาเหตุ (บั๊กเก่ามาตั้งแต่ 0051 / D85 — D88 แค่ทำให้เห็นชัดขึ้น):
--    `report_runs` ถูกใส่ไว้ในลูป "ตารางฝั่งผลิต" ของ 0051 → policy เป็น
--    `has_cap('prod.read')` / `has_cap('prod.write')` เท่านั้น
--    แต่ตารางนี้เก็บ **ทั้ง 2 โดเมน**: ฟอร์ม ภส. (ผลิต) และ `phor_por_30` /
--    `pnd_3_53` (บัญชี) ซึ่งเขียนจากแท็บเอกสารสรรพากรของหน้าบัญชี
--
-- 🪤 **ตระกูล D85 เป๊ะ: จัดตารางผิดโดเมน** — `rolesSql.test.ts` จับไม่ได้เพราะมันตรวจว่า
--    ตาราง cap ฝั่ง TS ตรงกับ `has_cap()` ฝั่ง SQL เท่านั้น **ไม่ได้ตรวจว่าตารางไหน
--    ควรเปิดให้ cap ไหน** · เจอได้ทางเดียวคือล็อกอินเป็นบทบาทนั้นแล้วใช้จริง
--
-- ★ เปิดกว้างแค่ไหน: `report_runs` เก็บแค่ *ชื่อรายงาน · เดือน · กิจการ · เวลา*
--   ไม่มีตัวเลขเงินหรือข้อมูลลับ → ให้คนที่เข้าได้ทั้งสองหน้าอ่าน/เขียนได้ปลอดภัย
-- ============================================================================

drop policy if exists rr_sel on report_runs;
drop policy if exists rr_w   on report_runs;
drop policy if exists report_runs_sel on report_runs;
drop policy if exists report_runs_w   on report_runs;

create policy report_runs_sel on report_runs for select
  using (tenant_id = my_tenant() and (has_cap('prod.read') or has_cap('acct.read')));

create policy report_runs_w on report_runs for all
  using (tenant_id = my_tenant() and (has_cap('prod.write') or has_cap('acct.write')))
  with check (tenant_id = my_tenant() and (has_cap('prod.write') or has_cap('acct.write')));

comment on table report_runs is
  'ประวัติการกดสร้างรายงาน — ใช้ร่วม 2 โดเมน: ฟอร์ม ภส. (ผลิต) และ ภพ.30/ภงด. (บัญชี) '
  '🚨 อย่าย้ายกลับไปอยู่ในลูป policy ของฝั่งผลิตอีก (0055 · D88)';

notify pgrst, 'reload schema';
