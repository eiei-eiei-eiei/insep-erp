-- ============================================================================
-- 0045 สุราแช่ (เส้นทางผลิตที่ 2) — log_ferment_draw + fn_draw_fermented
--   เหตุผลการออกแบบทั้งหมดอยู่ docs/DECISIONS.md D78
--
-- 🎯 สุราแช่ไม่มีการกลั่น: หมัก → **รินน้ำสุราแช่ออกจากถัง (+ปรุงให้พร้อมบรรจุ)** → บรรจุ
--    ใช้ฟอร์ม ภส.๐๗-๐๒/๑(๑) **คนละใบ**กับสุรากลั่น (เลขฟอร์มบนหัวกระดาษเหมือนกัน แต่ตารางต่างกัน)
--
-- 🚨 ทำไมตารางใหม่ ไม่ reuse `log_distill` ที่ช่องตรงกันพอดี (batch/vol/abv/date):
--    ผู้ใช้เลือกยอมมีโค้ด 2 ที่ เพื่อให้แก้ดีเทลเฉพาะของ *การกลั่น* หรือ *การแช่*
--    ได้โดยไม่กระทบกันเอง (reuse แล้ววันหนึ่งจะแก้ไม่ได้ทั้งคู่)
--
-- 🚨 **ห้ามใส่ CHECK constraint กับ `products.liquor_type`** ที่ไฟล์นี้หรือไฟล์ไหนก็ตาม
--    ธง กลั่น/แช่ อ่านจาก `liquor_type` (= "ประเภทสุรา" ที่พิมพ์ลงหัวฟอร์มอยู่แล้ว) แต่
--    `db:push:all` ลงทุก DB รวมของลูกค้าที่เราไม่เคยเห็นข้อมูล — ใครพิมพ์ค่าอื่นไว้ =
--    migration ล้มทั้ง fleet · บังคับที่ดร็อปดาวน์บนจอ + server action เท่านั้น
-- ============================================================================

-- ── รินน้ำสุราแช่ออกจากถังหมัก (+ ปรุงให้พร้อมบรรจุ) = 1 แถวต่อ 1 ครั้งที่หมัก ──────────
--    ★★ กติกาเหล็ก 1 batch = 1 แถว (P3) — เหตุผลเดียวกับ log_distill:
--       ฟอร์มหักน้ำหมักของ batch นั้น **ทั้งก้อน** ต่อ 1 แถว · หลายแถว = หักซ้ำ = เลขยื่นราชการผิด
create table if not exists log_ferment_draw (
  id           bigserial primary key,            -- log_* ทุกตัวยังเป็น PK เดี่ยว (0027 ไม่แตะ)
  tenant_id    uuid not null default my_tenant(),
  entity_id    text not null default my_default_entity(),
  created_at   timestamptz not null default now(),
  draw_date    date not null,                    -- วันที่รินออกจากถัง = วันที่บนแถวของฟอร์ม
  product_name text not null,                    -- text ไม่ FK (เหมือน log_distill/log_dilute)
  batch        text not null,                    -- ครั้งที่หมัก n/yy
  vol          numeric not null,                 -- ปริมาณน้ำสุราแช่ที่รินได้ (ลิตร)
  abv          numeric not null,                 -- ดีกรีตอนริน
  adjust_date  date,                             -- วันที่ปรุงเสร็จ (ว่าง = วันเดียวกับ draw_date)
  water        numeric,                          -- น้ำ/ส่วนผสมที่เติม (ลิตร)
  final_vol    numeric,                          -- ยอดหลังปรุง (ว่าง = ไม่ปรุง → ใช้ vol)
  final_abv    numeric,                          -- ดีกรีหลังปรุง (ว่าง = ใช้ abv)
  note         text,
  constraint lfd_batch_key unique (tenant_id, entity_id, batch)
);

comment on table log_ferment_draw is
  'สุราแช่: รินน้ำสุราออกจากถังหมัก + ปรุงให้พร้อมบรรจุ — 1 แถวต่อ 1 ครั้งที่หมัก (unique) '
  'เพราะฟอร์ม ภส.๐๗-๐๒/๑(๑) ฉบับสุราแช่หักน้ำหมักของ batch นั้นทั้งก้อนต่อ 1 แถว';

comment on column log_ferment_draw.final_vol is
  'ยอดที่ลงคอลัมน์ "ปริมาณน้ำสุราแช่" ของฟอร์มคือยอด**หลังปรุง** (drawnVol() ใน lib/production/calc) '
  'เพราะหัวคอลัมน์เขียนว่า "ที่ผลิตได้และรอบรรจุ" และเป็นทางเดียวที่ยอดคงเหลือจะตรงกับยอดบรรจุ';

alter table log_ferment_draw
  drop constraint if exists log_ferment_draw_tenant_fk;
alter table log_ferment_draw
  add constraint log_ferment_draw_tenant_fk foreign key (tenant_id) references tenants(id);

create index if not exists lfd_batch on log_ferment_draw (tenant_id, batch);
create index if not exists lfd_prod_date on log_ferment_draw (tenant_id, product_name, draw_date);

-- ── RLS — ชุดเดียวกับ log_* ตัวอื่น (0028): อ่านได้ทุกคนใน tenant · เขียนเฉพาะ main ────
alter table log_ferment_draw enable row level security;

drop policy if exists log_ferment_draw_sel on log_ferment_draw;
create policy log_ferment_draw_sel on log_ferment_draw for select
  using (tenant_id = my_tenant());

drop policy if exists log_ferment_draw_w on log_ferment_draw;
create policy log_ferment_draw_w on log_ferment_draw for all
  using (tenant_id = my_tenant() and my_role() = 'main')
  with check (tenant_id = my_tenant() and my_role() = 'main');

-- ── audit (0005) — ทุกจุดที่ผู้ใช้บันทึกได้ต้องมี edit_log ────────────────────────────
drop trigger if exists audit_log_ferment_draw on log_ferment_draw;
create trigger audit_log_ferment_draw after insert or update or delete on log_ferment_draw
  for each row execute function trg_audit('id');

-- ── RPC: รินน้ำสุราแช่ (คู่แฝดของ fn_close_batch ใน 0010) ────────────────────────────
--    SECURITY INVOKER → RLS บังคับ main เขียนเองอยู่แล้ว
create or replace function fn_draw_fermented(
  p_date date, p_product_name text, p_batch text, p_vol numeric, p_abv numeric,
  p_adjust_date date default null, p_water numeric default null,
  p_final_vol numeric default null, p_final_abv numeric default null,
  p_note text default null
) returns jsonb
language plpgsql set search_path = public as $$
begin
  insert into log_ferment_draw(draw_date, product_name, batch, vol, abv,
                               adjust_date, water, final_vol, final_abv, note)
  values (p_date, p_product_name, p_batch, p_vol, p_abv,
          p_adjust_date, p_water, p_final_vol, p_final_abv, p_note);
  return jsonb_build_object('ok', true, 'batch', p_batch);
exception when unique_violation then
  return jsonb_build_object('ok', false,
    'error', 'ครั้งที่หมัก "'||p_batch||'" รินไปแล้ว (1 batch = 1 แถว ตามกฎ ภส.)');
end $$;
