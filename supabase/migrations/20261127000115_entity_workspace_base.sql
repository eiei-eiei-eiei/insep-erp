-- ============================================================================
-- 0115 ทาง Y เฟส 1 — ฐาน "กิจการที่เลือกอยู่" (docs/ENTITY_WORKSPACE_SPEC.md ส่วนที่ 2 · 4 · D187)
--
-- เพิ่มอย่างเดียว ไม่แก้ของเดิม:
--   1. profiles.last_entity_id      — กิจการที่ผู้ใช้เลือกล่าสุด (ไว้ให้ connector / เปิดแอปครั้งแรก)
--   2. my_current_entity()          — "กิจการที่เลือกอยู่" ของคำขอนี้ (header → ล่าสุด → กิจการหลัก)
--   3. entity_guard(p_entity, cap)  — ด่านกลางของ definer ที่จะใช้ตั้งแต่เฟส 2 (แพตเทิร์น bar_guard)
--   4. fn_set_last_entity(p_entity) — จดกิจการที่สลับไป (เรียกจากตัวสลับบนแถบบน)
--
-- 🚫 ยังไม่มี RLS / default / RPC เดิมตัวไหนเรียกของใหม่ ⇒ ลงแล้วแอปทำงานเหมือนเดิมทุกจุด
--    (เฟส 2-5 ค่อยเปลี่ยนทีละโมดูล)
-- ★ ไม่มีตารางใหม่ (D118 ไม่เกี่ยว) · definer ใหม่ 3 ตัว: revoke public/anon + grant authenticated (D99)
--   ทุกตัวมี `my_tenant()` ใน body = ผ่านด่าน hasGuard ของ lib/shared/definerPolicy.ts
-- ============================================================================

-- ── 1. กิจการที่เลือกล่าสุด ───────────────────────────────────────────────────
-- ★ ไม่ใส่ FK ไป entities โดยตั้งใจ — ค่านี้เป็นแค่ "ความชอบ" ของผู้ใช้ และทุกจุดที่อ่าน
--   (my_current_entity) ตรวจซ้ำเสมอว่ากิจการยังอยู่ใน tenant + ในสิทธิ์ ⇒ ค่าค้าง/ผิด = ถูกข้ามเฉย ๆ
--   (ใส่ FK = fn_mig_truncate ลบกิจการไม่ได้ถ้าโปรไฟล์ยังชี้อยู่ · และ D137 กับดัก set null)
alter table profiles add column if not exists last_entity_id text;

comment on column profiles.last_entity_id is
  'D187 — กิจการที่เลือกล่าสุดบนแถบบน · ใช้เมื่อคำขอไม่มี header x-entity-id (connector / เปิดแอปครั้งแรก) · ตรวจสิทธิ์ซ้ำทุกครั้งที่อ่าน';


-- ── 2. my_current_entity() ───────────────────────────────────────────────────
-- ลำดับ: header `x-entity-id` (มาจาก cookie ของเบราว์เซอร์ ผ่าน lib/supabase/server.ts)
--        → profiles.last_entity_id → กิจการหลัก (is_default) → กิจการแรกตามรหัส
-- ทุกชั้นต้องผ่านเงื่อนไขเดียวกัน: อยู่ใน tenant ของผู้ใช้ + อยู่ในสิทธิ์ (my_entities() · D120)
--
-- 🔒 header ไม่ใช่ด่าน — ผู้ใช้ยิง PostgREST ตรงด้วย header อะไรก็ได้ ⇒ ค่าที่ไม่ผ่านเงื่อนไข
--    ถูกข้ามไปชั้นถัดไป (ไม่ใช่ error) · ไม่ล็อกอิน / ถูกจำกัดเป็น array ว่าง ⇒ null = มองไม่เห็นอะไร
-- 🪤 request.headers ไม่มีค่าเมื่อเรียกนอก PostgREST (SQL Editor / สคริปต์) ⇒ current_setting(..., true)
--    คืน null/'' → nullif กันไว้ก่อนแปลงเป็น json
create or replace function my_current_entity() returns text
language sql stable security definer set search_path = public as $$
  with ok as (
    select e.entity_id, e.is_default
    from entities e
    where e.tenant_id = my_tenant()
      and (my_entities() is null or e.entity_id = any(my_entities()))
  )
  select coalesce(
    (select ok.entity_id from ok
      where ok.entity_id = nullif(current_setting('request.headers', true), '')::json->>'x-entity-id'),
    (select ok.entity_id from ok
      where ok.entity_id = (select p.last_entity_id from profiles p where p.id = auth.uid())),
    (select ok.entity_id from ok where ok.is_default limit 1),
    (select ok.entity_id from ok order by ok.entity_id limit 1)
  );
$$;

revoke execute on function my_current_entity() from public, anon;
grant execute on function my_current_entity() to authenticated, service_role;

comment on function my_current_entity() is
  'D187 — กิจการที่เลือกอยู่ของคำขอนี้ (header x-entity-id → profiles.last_entity_id → กิจการหลัก) · ตรวจ tenant + my_entities() ทุกชั้น · ไม่ผ่าน = null';


-- ── 3. entity_guard() — ด่านกลางของ definer (ยกแพตเทิร์นจาก bar_guard 0065) ────────
-- คืน tenant_id เมื่อผ่าน · ใช้ตั้งแต่เฟส 2: definer ที่แตะตารางผลิต/ขาย/บาร์/เงินเดือน
--   ต้องเรียกตัวนี้ด้วย "กิจการที่จอแสดงอยู่" (ไม่ใช่ค่าที่คิดเองใน SQL)
-- ★ เทียบกับ my_current_entity() = ปิดเคส "แท็บเก่าค้างจอกิจการ A แต่อีกแท็บสลับเป็น B แล้ว"
--   (Q8 ทั้งเบราว์เซอร์กิจการเดียว) ⇒ บล็อกพร้อมบอกให้รีเฟรช ไม่บันทึกผิดกิจการเงียบ ๆ
-- ★ ไม่ต้องเช็ค tenant/สิทธิ์ของ p_entity แยก — my_current_entity() ผ่านเงื่อนไขนั้นมาแล้ว
--   และ p_entity ต้องเท่ากับมันพอดี
-- ฝาแฝดข้อความ TS: ENTITY_MISMATCH_HINT ใน lib/shared/entityWorkspace.ts
create or replace function entity_guard(p_entity text, p_cap text) returns uuid
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_tenant uuid := my_tenant();
  v_current text;
begin
  if v_tenant is null then
    raise exception 'ไม่รู้ว่าอยู่ลูกค้ารายไหน (ต้องล็อกอินก่อน)';
  end if;
  if p_cap is null or not has_cap(p_cap) then
    raise exception 'ไม่มีสิทธิ์ทำรายการนี้';
  end if;
  if nullif(trim(coalesce(p_entity, '')), '') is null then
    raise exception 'ไม่ได้ระบุกิจการของรายการนี้';
  end if;
  v_current := my_current_entity();
  if v_current is null then
    raise exception 'ยังไม่ได้เลือกกิจการ หรือไม่มีสิทธิ์เข้าถึงกิจการใดเลย';
  end if;
  if p_entity <> v_current then
    raise exception 'หน้านี้เป็นของกิจการ % แต่ตอนนี้คุณเลือกกิจการ % อยู่ (อาจสลับในอีกแท็บ) — รีเฟรชหน้านี้ก่อนบันทึก',
      p_entity, v_current;
  end if;
  return v_tenant;
end $fn$;

revoke execute on function entity_guard(text, text) from public, anon;
grant execute on function entity_guard(text, text) to authenticated, service_role;

comment on function entity_guard(text, text) is
  'D187 — ด่านของ definer: ล็อกอิน + มีสิทธิ์ (has_cap) + p_entity = กิจการที่เลือกอยู่ · คืน tenant_id';


-- ── 4. fn_set_last_entity() — จดกิจการที่สลับไป ──────────────────────────────
-- เรียกจาก switchEntityAction (app/(app)/actions.ts) ก่อนตั้ง cookie
-- ★ แก้ได้เฉพาะโปรไฟล์ของตัวเอง คอลัมน์เดียว · กิจการต้องอยู่ใน tenant + ในสิทธิ์ (ไม่งั้น error ดัง ๆ
--   — ต่างจาก my_current_entity ที่ข้ามเงียบ เพราะนี่คือการกดของผู้ใช้ ต้องบอกว่าทำไม่ได้)
create or replace function fn_set_last_entity(p_entity text) returns text
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := my_tenant();
  v_ok text;
begin
  if v_tenant is null then
    raise exception 'ไม่รู้ว่าอยู่ลูกค้ารายไหน (ต้องล็อกอินก่อน)';
  end if;
  select e.entity_id into v_ok
    from entities e
   where e.tenant_id = v_tenant
     and e.entity_id = p_entity
     and (my_entities() is null or e.entity_id = any(my_entities()));
  if v_ok is null then
    raise exception 'ไม่มีสิทธิ์เข้าถึงกิจการ %', coalesce(p_entity, '(ว่าง)');
  end if;
  update profiles set last_entity_id = v_ok where id = auth.uid();
  return v_ok;
end $fn$;

revoke execute on function fn_set_last_entity(text) from public, anon;
grant execute on function fn_set_last_entity(text) to authenticated, service_role;

comment on function fn_set_last_entity(text) is
  'D187 — จดกิจการที่ผู้ใช้สลับไป (profiles.last_entity_id ของตัวเอง) · ต้องอยู่ใน tenant + ในสิทธิ์';
