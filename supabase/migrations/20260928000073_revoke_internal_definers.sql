-- ============================================================================
-- 0073 🚨 ปิดประตู definer ภายใน 4 ตัวที่ anon/authenticated เรียกได้ (D99 · ฉุกเฉิน)
--
--   ไฟล์นี้เป็น GRANT/REVOKE ล้วน — ไม่มี create/alter/drop function แม้แต่บรรทัดเดียว
--   ตรรกะทุกตัวคงเดิมทุกตัวอักษร
--
--   ต้นเรื่อง: probe `has_function_privilege` บน DB จริงทั้ง 2 ก้อน (2026-09-28) พบว่า
--   definer ทั้ง 52 ตัวเรียกได้จาก `anon` และ `authenticated` — revoke ทุกบรรทัดใน
--   โฟลเดอร์นี้ **ไม่มีผลเลย** เพราะ Supabase ตั้ง default privileges ไว้ว่า
--     alter default privileges in schema public grant execute on functions
--       to anon, authenticated, service_role;
--   = grant ให้ 2 role นี้ "ตรง ๆ" ตอนสร้างฟังก์ชัน · `revoke ... from public`
--   ถอนได้แค่สิทธิ์ของกลุ่ม PUBLIC ส่วนที่ grant ตรง ๆ ยังอยู่ครบ
--   🪤 migration_helpers.sql (0014) เขียนคอมเมนต์ว่า "grant execute ให้ service_role
--      อย่างเดียว" — คอมเมนต์ประกาศเจตนาที่โค้ดไม่ได้ทำ แล้วรอดสายตามาเพราะ revoke รันผ่าน
--
--   ตัวที่หนักที่สุด: fn_mig_set_triggers(false) ไม่ต้องรู้ uuid ไม่ต้องล็อกอิน
--   (anon key อยู่ใน bundle ฝั่ง browser) ยิงครั้งเดียว = trigger สต็อก+audit ดับ
--   ทั้งฐานของทุกลูกค้า (ฉากเดียวกับที่ D82 เขียนไว้)
--
--   ผู้เรียกที่ตรวจแล้ว (อ่าน prosrc จาก DB จริงทั้ง 2 ก้อน ไม่ใช่จากไฟล์):
--     fn_mig_*        → scripts/restore-tenant.ts · migration/import-csv.ts · tests/tenant
--                       (service role ทั้งหมด) · ไม่มีฟังก์ชันใดใน DB เรียก
--     bar_apply_move  → fn_bar_add_lines/adjust/receive/void_line/void_sale
--                       ทั้ง 5 เป็น security definer (รันในสิทธิ์ owner → เรียกต่อได้)
--
--   🚨 จงใจไม่ใส่ในไฟล์นี้:
--     apply_stock_delta — ผู้เรียกคือ trg_update_stock_product ซึ่งเป็น invoker
--       revoke ตรง ๆ = เขียน log_product ไม่ได้ทั้งระบบ · ต้องพลิก trigger เป็น definer ก่อน
--       → 0074 (ห้ามมัดการแตะเส้นทางสต็อกเข้ากับ push ฉุกเฉิน)
--     recompute_stock_product — ปุ่มซ่อมสต็อกเรียกด้วย session ผู้ใช้ → ด่านในตัว (0074)
--
--   ⚠️ รันผ่าน ≠ ปิดแล้ว — หลังลงต้องรัน probe has_function_privilege ซ้ำทุก DB
-- ============================================================================

revoke execute on function fn_mig_set_triggers(boolean) from public, anon, authenticated;
grant  execute on function fn_mig_set_triggers(boolean) to service_role;

revoke execute on function fn_mig_truncate(uuid) from public, anon, authenticated;
grant  execute on function fn_mig_truncate(uuid) to service_role;

revoke execute on function fn_mig_recompute_stock(uuid) from public, anon, authenticated;
grant  execute on function fn_mig_recompute_stock(uuid) to service_role;

revoke execute on function bar_apply_move(uuid, text, text, numeric, text, text, text)
  from public, anon, authenticated;
grant  execute on function bar_apply_move(uuid, text, text, numeric, text, text, text)
  to service_role;

notify pgrst, 'reload schema';
