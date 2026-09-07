-- ============================================================================
-- seed_redistill.sql — ชุดข้อมูลทดสอบ "กลั่นหลายรอบ" (D94 · migration 0061)
--   marker สำหรับลบทีเดียว: master id ขึ้นต้น 'T-' · ชื่อสุรามีคำว่า 'ทดสอบ'
--   ⚠️ วิธีใช้: Supabase → SQL Editor → **แก้ค่า v_slug บรรทัดล่าง** → วางทั้งไฟล์ → Run
--
-- 🎯 สร้างสภาพตั้งต้น: หมัก 6 batch → กลั่นรอบแรกได้ batch ละ 40 ล. @70°
--    รวมในถัง 240 ล. รอยกออกไปแช่สมุนไพรแล้วกลั่นซ้ำ (ทำต่อบนหน้าจอ — TESTING ส่วนที่ 51)
--
-- 🚨 **ไม่สร้างล็อตกลั่นซ้ำให้** โดยตั้งใจ — ประเด็นทั้งหมดของ D94 อยู่ที่ "กดผ่านหน้าจอ
--    แล้วตัวเลขบนฟอร์มถูกไหม" ยัด SQL ให้ = ข้ามด่านที่ต้องพิสูจน์พอดี
--
-- 🪤 **ทำไมต้องระบุ tenant_id/entity_id เอง ทั้งที่ตารางมี default อยู่แล้ว**
--    default คือ `my_tenant()` / `my_default_entity()` ซึ่งอ่านจาก `auth.uid()` ของ JWT
--    แต่ **SQL Editor รันเป็น role postgres ไม่มี JWT** → คืน null → ชน not null ทันที
--    (ตรวจแล้วด้วย service role: select my_tenant() = null) — seed รุ่นก่อน ๆ ตกจุดนี้
--
-- 🪤 และ `on conflict` ต้องระบุ **คีย์ประกอบ** `(tenant_id, material_id)` — 0027 ผ่าตัด PK
--    เป็น composite ไปแล้ว · ใช้คอลัมน์เดียวจะได้ 42P10 "no unique constraint matching"
-- ============================================================================

do $$
declare
  -- 🔧 แก้ตรงนี้ให้ตรงกับกิจการที่จะเทส (ดูรายชื่อ: select slug, name from tenants)
  v_slug   text := 'siamdist';
  v_tenant uuid;
  v_entity text;
  i int;
begin
  select id into v_tenant from tenants where slug = v_slug;
  if v_tenant is null then
    raise exception 'ไม่พบ tenant slug = %  (ดูรายชื่อ: select slug, name from tenants)', v_slug;
  end if;

  select entity_id into v_entity
    from entities where tenant_id = v_tenant order by is_default desc, entity_id limit 1;
  if v_entity is null then
    raise exception 'tenant % ยังไม่มีกิจการ — สร้างกิจการก่อน', v_slug;
  end if;

  -- ── ล้างของเก่าก่อน (รันซ้ำได้ · แตะเฉพาะแถวที่มี marker ทดสอบ) ────────────────
  delete from log_redistill   where tenant_id = v_tenant and product_name like '%ทดสอบ%';  -- รอบ cascade
  delete from log_dilute      where tenant_id = v_tenant and product_name like '%ทดสอบ%';
  delete from log_distill_run where tenant_id = v_tenant and product_name like '%ทดสอบ%';
  delete from log_distill     where tenant_id = v_tenant and product_name like '%ทดสอบ%';
  delete from log_ferment     where tenant_id = v_tenant and product_name like '%ทดสอบ%';
  delete from log_material    where tenant_id = v_tenant and material_id like 'T-%';

  -- ── วัตถุดิบ ────────────────────────────────────────────────────────────────
  --    🚨 สมุนไพรต้อง**ขึ้นทะเบียนวัตถุดิบ** ถึงจะตัดเข้าบัญชี ภส.๐๗-๐๑/๑ ได้
  insert into materials (tenant_id, entity_id, material_id, name, unit) values
    (v_tenant, v_entity, 'T-MAT01', 'น้ำอ้อยทดสอบ',   'ลิตร'),
    (v_tenant, v_entity, 'T-HERB1', 'จูนิเปอร์ทดสอบ', 'กก.'),
    (v_tenant, v_entity, 'T-HERB2', 'ผักชีทดสอบ',     'กก.')
  on conflict (tenant_id, material_id) do nothing;

  -- ── สินค้า: ต้องเป็น "สุรากลั่น" ไม่งั้นแท็บกลั่นซ้ำไม่ให้เลือก ────────────────
  insert into products (tenant_id, entity_id, product_id, name, degree, bottle_size_l, liquor_type, liquor_kind)
  values (v_tenant, v_entity, 'T-GIN70', 'ยินทดสอบ', 40, 0.700, 'สุรากลั่น', 'ยิน')
  on conflict (tenant_id, product_id) do update
    set name = excluded.name, degree = excluded.degree,
        bottle_size_l = excluded.bottle_size_l, liquor_type = excluded.liquor_type;

  -- ── รับวัตถุดิบเข้าคลัง (ให้ยอดคงเหลือไม่ติดลบตอนเบิก) ───────────────────────
  insert into log_material (tenant_id, entity_id, doc_date, trans_type, material_id, amount, doc_ref, note) values
    (v_tenant, v_entity, '2026-09-01', 'รับ', 'T-MAT01', 1500, 'PO-ทดสอบ', 'ซื้อเข้า (ทดสอบ)'),
    (v_tenant, v_entity, '2026-09-01', 'รับ', 'T-HERB1',   10, 'PO-ทดสอบ', 'ซื้อเข้า (ทดสอบ)'),
    (v_tenant, v_entity, '2026-09-01', 'รับ', 'T-HERB2',   10, 'PO-ทดสอบ', 'ซื้อเข้า (ทดสอบ)');

  -- ── หมัก 6 batch + เบิกวัตถุดิบ · กลั่นรอบแรก batch ละ 40 ล. @70° รวม 240 ──────
  --    ★ ค่าแรกของ material_amounts = ฐานคิดส่า (P4)
  --    ★ กติกาเหล็ก 1 batch = 1 แถว log_distill (P3) — ใส่ batch ละแถวพอดี
  for i in 1..6 loop
    insert into log_ferment (tenant_id, entity_id, ferment_date, product_name, batch,
                             container_id, container_qty, material_ids, material_amounts)
    values (v_tenant, v_entity, ('2026-09-0' || i)::date, 'ยินทดสอบ', 'T-' || i || '/69',
            null, 1, 'T-MAT01', '200');

    insert into log_material (tenant_id, entity_id, doc_date, trans_type, material_id, amount, doc_ref, note)
    values (v_tenant, v_entity, ('2026-09-0' || i)::date, 'จ่าย', 'T-MAT01', 200,
            'T-' || i || '/69', 'เบิกไปหมัก (ทดสอบ)');

    insert into log_distill (tenant_id, entity_id, distill_date, product_name, batch, vol, abv)
    values (v_tenant, v_entity, ('2026-09-1' || i)::date, 'ยินทดสอบ', 'T-' || i || '/69', 40, 70);
  end loop;

  raise notice 'seed กลั่นซ้ำเรียบร้อย (tenant=% entity=%) — ไปแท็บ กลั่นซ้ำ เลือกสุรา "ยินทดสอบ" ต้องเห็นคงเหลือ 240.00 ล.',
    v_slug, v_entity;
end $$;
