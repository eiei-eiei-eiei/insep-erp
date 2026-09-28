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
-- ยกจาก 20260811000029_tenant_rpc.sql · เติมเฉพาะบล็อกด่าน
create or replace function recompute_stock_product(p_tenant uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_t uuid := coalesce(p_tenant, my_tenant());
begin
  /*
   * 🔐 ด่าน (D99 · 0074) — ผู้เรียกที่เชื่อได้ = service_role หรือ **ไม่มี JWT เลย**
   *    (postgres / SQL editor / pg_cron) → ทำตามเดิมทุกกรณี
   *    (fn_mig_recompute_stock ของ restore:tenant/import เรียกผ่าน service role)
   *    นอกนั้น (authenticated/anon) ต้องมี tenant · มี prod.write · ซ่อมได้เฉพาะของตัวเอง
   * 🪤 ห้ามใช้ "my_tenant() เป็น null" เป็นเงื่อนไขยกเว้น — anon กับผู้ใช้ที่ไม่มี profile
   *    ก็ได้ null แล้ว v_t = null แปลว่า **ซ่อมทุก tenant**
   */
  if auth.role() is not null and auth.role() <> 'service_role' then
    if my_tenant() is null then
      raise exception 'คำนวณสต็อกใหม่ไม่ได้: ไม่รู้ว่าผู้ใช้นี้อยู่กิจการไหน';
    end if;
    if not has_cap('prod.write') then
      raise exception 'ไม่มีสิทธิ์คำนวณสต็อกใหม่ (ต้องมีสิทธิ์บันทึกงานผลิต)';
    end if;
    if p_tenant is not null and p_tenant <> my_tenant() then
      raise exception 'คำนวณสต็อกของกิจการอื่นไม่ได้';
    end if;
  end if;

  insert into stock_product (tenant_id, entity_id, product_id, balance, last_updated)
  select tenant_id, entity_id, product_id, 0, now() from products
  where (v_t is null or tenant_id = v_t)
  on conflict (tenant_id, entity_id, product_id)
    do update set balance = 0, last_updated = now();

  update stock_product s
    set balance = coalesce(agg.bal, 0), last_updated = now()
  from (
    select tenant_id, entity_id, product_id,
           sum(case when trans_type = 'รับ' then amount else -amount end) as bal
    from log_product
    where (v_t is null or tenant_id = v_t)
    group by tenant_id, entity_id, product_id
  ) agg
  where s.tenant_id = agg.tenant_id
    and s.entity_id = agg.entity_id
    and s.product_id = agg.product_id
    and (v_t is null or s.tenant_id = v_t);
end $$;


-- ผู้ใช้ปุ่มซ่อมสต็อกคือ authenticated (มีด่านข้างบน) · anon ไม่มีเหตุให้เรียกเลย
revoke execute on function recompute_stock_product(uuid) from public, anon;
grant  execute on function recompute_stock_product(uuid) to authenticated, service_role;

-- ── 3. handle_new_user (R6): ไม่มี tenant = สร้างผู้ใช้ไม่ได้ ──────────────────────
-- ยกจาก 20260811000031_force_password_change.sql · ตัด arm ที่ 3 ของ coalesce ทิ้งบรรทัดเดียว
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
begin
  v_tenant := coalesce(
    nullif(new.raw_user_meta_data ->> 'tenant_id', '')::uuid,
    my_tenant()
  );

  if v_tenant is null then
    raise exception 'สร้างผู้ใช้ไม่ได้: ไม่รู้ว่าผู้ใช้นี้อยู่กิจการไหน (ส่ง tenant_id ใน user_metadata)';
  end if;

  insert into public.profiles (id, username, display_name, role, tenant_id, must_change_password)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    'viewer',
    v_tenant,
    -- สคริปต์เทส/provision ส่ง skip_password_change = true ได้เพื่อไม่ให้ติดหน้าเปลี่ยนรหัส
    coalesce((new.raw_user_meta_data ->> 'skip_password_change')::boolean, false) = false
  )
  on conflict (id) do nothing;
  return new;
end $$;


-- ── 4. fn_audit_definer_grants — ให้ test:tenant ถาม pg_proc ───────────────────────
--   security invoker โดยตั้งใจ (pg_proc / has_function_privilege อ่านได้ทุก role อยู่แล้ว
--   ไม่ต้องยืมสิทธิ์ owner) · คืนทุกฟังก์ชันใน public รวมตัวมันเอง → เทสตรวจตัวมันเองด้วย
create or replace function fn_audit_definer_grants()
returns table (
  fn text, name text, definer boolean, result_type text, takes_p_tenant boolean,
  anon boolean, authed boolean, service boolean, owner_role text, src text
)
language sql stable security invoker set search_path = public, pg_catalog as $fn$
  select p.oid::regprocedure::text,
         p.proname::text,
         p.prosecdef,
         pg_get_function_result(p.oid),
         coalesce(p.proargnames @> array['p_tenant'], false),
         has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute'),
         p.proowner::regrole::text,
         p.prosrc
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
  order by 1;
$fn$;

-- 🚨 ต้องอยู่ในไฟล์เดียวกันเสมอ — ลืม = แจกแผนที่ช่องโหว่ให้คนถือ anon key
revoke execute on function fn_audit_definer_grants() from public, anon, authenticated;
grant  execute on function fn_audit_definer_grants() to service_role;

notify pgrst, 'reload schema';
