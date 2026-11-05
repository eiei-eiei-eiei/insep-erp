-- ════════════════════════════════════════════════════════════════════════════
-- 0105 — D158: integration_log อ่านได้เฉพาะโดเมนของรายการนั้น
--
-- 🔴 เดิม (0051) `integration_log_sel` = `tenant_id = my_tenant()` อย่างเดียว ⇒ ทุกบทบาทอ่านได้ทุกแถว
--    แต่ payload ของ `POST_PAYROLL` มีชื่อ + ยอดเงินเดือนรายคน ⇒ ฝ่ายขาย/ฝ่ายบัญชี/viewer/พนักงานบาร์
--    เปิดดูเงินเดือนได้ทาง API ตรง ๆ (หน้าจอไม่โชว์ แต่ RLS คือตัวกันจริง) · เจอตอนทำ D120
-- ★ ผูกแต่ละ action กับ cap ของโดเมนตัวเอง (`integration_log_cap()`) · action ที่ไม่รู้จัก = 'admin' (main เท่านั้น)
--   ⇒ เพิ่ม action ใหม่แล้วลืมเติม = ปิดไว้ก่อน (fail-closed) ไม่ใช่เปิดให้ทุกคน
--   lib/shared/integrationLogCaps.test.ts ไล่ action ทุกตัวที่โค้ดเขียนมาเทียบกับรายการนี้
-- ★ ไม่กระทบงานเดิม: ผู้อ่านผ่าน session ผู้ใช้มีที่เดียว = หน้า "ประวัติเชื่อมระบบ" ของฝ่ายขาย
--   (RECEIVE_REVENUE / SELL_PRODUCT → sales.read) · RPC ทุกตัวที่อ่าน/เขียนตารางนี้เป็น security definer
--   · cron เตือนภาษี/สรรพสามิต/บาร์ ใช้ service role · ตารางนี้ไม่มี policy เขียน (คงเดิม)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function integration_log_cap(p_action text) returns text
language sql immutable set search_path = public as $$
  select case
    -- เงินเดือน: ลงบัญชีรายขา (ชื่อ+ยอดรายคนใน payload) · 'POST_PAYROLL_<kind>' ของ 0040 ด้วย
    when left(p_action, 12) = 'POST_PAYROLL'                          then 'pay.read'
    -- ขาย: รับเงิน/ตัดสต็อกสุรา (หน้าประวัติเชื่อมระบบของฝ่ายขายอ่าน 2 ตัวนี้)
    when p_action in ('RECEIVE_REVENUE', 'SELL_PRODUCT')              then 'sales.read'
    -- บัญชี: ต้นทุนวัตถุดิบจากบิล (D79) · จ่าย/ถอนจ่ายภาษี (D88) · เตือนกำหนดยื่นภาษี
    when p_action in ('RECEIVE_MATERIAL', 'PAY_TAX', 'UNPAY_TAX', 'TAX_REMINDER') then 'acct.read'
    -- ผลิต: เตือนงบเดือนสรรพสามิต (D92)
    when p_action = 'EXCISE_REMINDER'                                 then 'prod.read'
    -- บาร์: เตือนลงบัญชีรายวัน (D96)
    when p_action = 'BAR_POST_REMINDER'                               then 'bar.read'
    else 'admin'
  end
$$;

comment on function integration_log_cap(text) is
  'D158 — cap ที่ต้องมีถึงอ่านแถว integration_log ของ action นั้นได้ · ไม่รู้จัก = admin (main เท่านั้น)';

drop policy if exists integration_log_sel on integration_log;
create policy integration_log_sel on integration_log for select
  using (tenant_id = my_tenant() and has_cap(integration_log_cap(action)));
