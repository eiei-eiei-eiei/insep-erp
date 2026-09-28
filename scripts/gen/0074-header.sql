-- ============================================================================
-- 0074 🔐 ปิดคลาส "definer ที่ใครก็เรียกได้" ให้ครบ (D99 · ต่อจาก 0073)
--
--   ★ ที่มา: 0073 พิสูจน์แล้วว่า `revoke ... from public` บน Supabase **ไม่มีผล**
--     (default privileges grant execute ให้ anon/authenticated ตรง ๆ) ⇒ ต้อง revoke
--     จาก `public, anon, authenticated` ครบ 3 ตัวเสมอ · 0073 ปิดตัวที่ไม่แตะเส้นทางสต็อก
--     ไปแล้ว (fn_mig_* · bar_apply_move) ไฟล์นี้คือส่วนที่เหลือ
--
--   1. apply_stock_delta — ปิดจาก anon/authenticated
--      🚨 ผู้เรียกคือ trg_update_stock_product ซึ่งเป็น **invoker** → revoke ตรง ๆ =
--         เขียน log_product ไม่ได้ทั้งระบบ (บันทึกผลผลิต/ขาย/ยกเลิกออเดอร์ตายหมด)
--      → พลิก trigger เป็น definer **ก่อน** ด้วย `alter function` (ไม่ยกตัวฟังก์ชันมา
--        เขียนใหม่เลย = ตรรกะ +/− ของ P2 ไม่ถูกคัดลอกหรือแตะแม้ตัวอักษรเดียว · D82/D90)
--      ★ ค่าที่ trigger ส่งต่อ (tenant/entity/product ของแถว) มาจากแถวที่ RLS ของ
--        log_product ตรวจไปแล้วตอนเขียน ⇒ ไม่เปิดช่องใหม่
--
--   2. recompute_stock_product — ปุ่ม "คำนวณสต็อกใหม่" เรียกด้วย session ผู้ใช้
--      ⇒ revoke จาก authenticated ไม่ได้ → ใส่ด่านในตัว (ยกด้วยสคริปต์ เติมแค่บล็อกด่าน)
--      ผู้เรียกที่เชื่อได้ = `auth.role()` เป็น service_role หรือ **ไม่มี JWT เลย**
--      (postgres / SQL editor / pg_cron — ปัจจุบันยังไม่ได้ติดตั้ง pg_cron ทั้ง 2 DB)
--      🪤 ไม่ใช้ "my_tenant() เป็น null" เป็นเงื่อนไขยกเว้นตามที่ triage เสนอ เพราะ anon
--         และผู้ใช้ที่ไม่มี profile ก็ได้ null ⇒ เรียกแบบไม่ส่งพารามิเตอร์ = ซ่อมทุก tenant
--      นอกนั้นต้อง: มี tenant · มี has_cap('prod.write') · p_tenant (ถ้าส่ง) = ของตัวเอง
--      ★ ตัวคำนวณไม่เปลี่ยน — ด่านแค่กันการเขียนข้ามลูกค้า / viewer สั่งเขียน
--
--   3. handle_new_user (R6) — ตัด arm ที่ 3 ของ coalesce ทิ้ง
--      `(select id from tenants where is_active limit 1)` = ผู้ใช้ที่ไม่มี metadata
--      (สร้างจาก dashboard / self-signup) ตกไปอยู่ลูกค้ารายแรกที่ active ในฐานะ viewer
--      ⇒ อ่านบิล/สูตร/ราคาของลูกค้ารายนั้นได้ · หลังแก้: ไม่มี tenant = raise (fail-closed)
--      ★ คง `my_tenant()` ไว้ (main สร้างผู้ใช้ในกิจการตัวเอง)
--
--   4. fn_audit_definer_grants() — ให้ test:tenant ถาม pg_proc ได้ (PostgREST ไม่เปิด
--      pg_catalog) · **security invoker โดยตั้งใจ** (ไม่ต้องใช้สิทธิ์ owner อ่าน pg_proc)
--      🚨 revoke ในไฟล์เดียวกัน — ลืม = แจกแผนที่ช่องโหว่ทั้งฐานให้คนถือ anon key
--         (กับดักตัวเดียวกับที่ทำให้เกิดเรื่องนี้ทั้งหมด) · เทสตรวจตัวมันเองด้วย
--
--   ★ ยก recompute_stock_product (0029) / handle_new_user (0031) มาด้วยสคริปต์
--     `scripts/gen/gen-0074.mjs` ซึ่ง assert ว่าต่างจากต้นฉบับเฉพาะบรรทัดที่ตั้งใจ
--     signature ไม่เปลี่ยน → create or replace ทับได้ ไม่เกิด overload (D69)
--     และ create or replace **คง ACL เดิม** (ต่างจาก drop+create ที่ได้ default privileges คืน)
-- ============================================================================

-- ── 1. apply_stock_delta: พลิก trigger เป็น definer ก่อน แล้วค่อยปิด ────────────
alter function trg_update_stock_product() security definer;
alter function trg_update_stock_product() set search_path = public;

revoke execute on function apply_stock_delta(uuid, text, text, numeric)
  from public, anon, authenticated;
grant  execute on function apply_stock_delta(uuid, text, text, numeric) to service_role;

-- ── 2. recompute_stock_product: ด่านในตัว ─────────────────────────────────────
