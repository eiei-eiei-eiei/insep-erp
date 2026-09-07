-- ============================================================================
-- 0061 กลั่นหลายรอบ (แช่สมุนไพรแล้วกลั่นซ้ำ) — log_redistill + log_redistill_round
--   เหตุผลการออกแบบทั้งหมดอยู่ docs/DECISIONS.md D94
--
-- 🎯 เส้นทางจริงของโรงกลั่น: หมัก → กลั่นรอบแรก (ต่อ batch) → **เทรวมถัง** →
--    ยกออกมา x ลิตร → แช่สมุนไพร → กลั่นซ้ำ → (รอบ 3, 4 ได้อีก) → ปรับดีกรี → บรรจุ
--
-- 🚨 **ห้ามแตะ `log_distill`** — กติกาเหล็ก 1 batch = 1 แถว (P3)
--    การกลั่นซ้ำเป็นงานคนละหน่วย: ยกจาก "ถังรวม" ไม่ใช่ต่อ batch (หลาย batch → 1 ล็อต)
--    ยัดเข้า log_distill เมื่อไหร่ unique(batch) พังทันที แล้วฟอร์มหักน้ำส่าซ้ำ
--
-- 🚨 ฟอร์ม ภส.๐๗-๐๒/๑(๑) **ไม่มีคอลัมน์รับการกลั่นรอบสอง** (กลุ่ม "การกลั่น" กินน้ำส่า
--    เท่านั้น · ไม่มีช่อง "โอนไปผลิตสุราอื่น" · ไม่มีช่อง "สูญเสียระหว่างผลิต")
--    → การกลั่นซ้ำถูกกลืนเข้า **ขั้นการปรุง** แล้วอธิบายด้วยหมายเหตุ (วิธีที่ผู้ใช้ไปสอบถาม
--       สรรพสามิตมา) ⇒ ตารางในไฟล์นี้เป็น **บันทึกภายใน** ไม่มีค่าไหนพิมพ์ลงฟอร์มตรง ๆ
--
-- ★ ตัวเลขที่ขึ้นฟอร์มมาจาก `log_dilute` เหมือนเดิมทุกประการ แค่ถูกเขียนโดย RPC ในไฟล์นี้
--   แยกเป็น **2 ท่อน คนละวัน** (D94):
--     ท่อน 'ยกไปปรุง'  วันเริ่มแช่   → start_vol = ยอดที่ยกออกจากถัง (คอลัมน์ "นำไปปรุง")
--     ท่อน 'ปรุงเสร็จ' วันปรับดีกรี → final_vol = ยอดพร้อมบรรจุ (ดัน "คงเหลือสุราปรุง")
--   เหตุผลที่แยก: วันตัดสมุนไพร (ฟอร์ม ๐๗-๐๑/๑) กับวันยกไปปรุง (ฟอร์ม ๐๗-๐๒/๑(๑))
--   ตกวันเดียวกัน ⇒ เจ้าหน้าที่เปิดสองใบมาเทียบแล้วเห็นภาพจบในตัว
--
-- 🚨 ท่อน 'ยกไปปรุง' ถูกเขียนตั้งแต่ **ตอนเปิดล็อต** ไม่ใช่ตอนปิดล็อต
--    ไม่งั้นระหว่างแช่ (เป็นสัปดาห์) ระบบยังคิดว่าสุรา 240 ล. ว่างอยู่ในถัง →
--    กดปรุงซ้ำได้อีกรอบ = นับสุราสองครั้ง ยอดบนฟอร์มพองโดยไม่มีอะไรฟ้อง
--
-- 🚨 **ไม่มีสุราไหลกลับเข้าถัง** — หัว/หางของรอบกลั่นซ้ำทิ้ง ไม่เก็บไปใช้ต่อ (ผู้ใช้ยืนยัน)
--    ถ้าวันหนึ่งมีลูกค้าเก็บ ต้องออกแบบใหม่ ฟอร์มไม่มีคอลัมน์รับสุราเข้าถังนอกจากการกลั่น
-- ============================================================================

-- ── หัวล็อต = 1 ครั้งที่ยกสุราออกจากถังไปทำ ────────────────────────────────────
--    🔴 `draw_vol` คือ **ตัวเลขเดียวในไฟล์นี้ที่ไปโผล่บนเอกสารราชการ**
--       รอบกลั่นแต่ละรอบเป็นแค่ *รายการ* ไม่ใช่ *เงื่อนไข* → เพิ่มรอบ 3, 4, 5 ไม่มีทาง
--       ไปขยับเลขบนฟอร์มโดยบังเอิญ (บทเรียน D84: else ที่กลืนของใหม่)
create table if not exists log_redistill (
  id           bigserial primary key,            -- log_* ทุกตัวยังเป็น PK เดี่ยว (0027 ไม่แตะ)
  tenant_id    uuid not null default my_tenant(),
  entity_id    text not null default my_default_entity(),
  created_at   timestamptz not null default now(),
  lot_no       text not null,                    -- S1/69 — คนละชุดเลขกับ batch (n/yy)
  product_name text not null,                    -- text ไม่ FK (เหมือน log_distill/log_dilute)
  draw_date    date not null,                    -- วันยกออกจากถัง = วันเริ่มแช่รอบแรก
  draw_vol     numeric not null,                 -- 🔴 ยอดที่ลงคอลัมน์ "นำไปปรุง" ของฟอร์ม
  draw_abv     numeric not null,                 -- ดีกรีสุราดิบตอนยกออก (ไม่ขึ้นฟอร์ม)
  dilute_date  date,                             -- วันปรับดีกรีเสร็จ (ว่าง = ล็อตยังไม่ปิด)
  water        numeric,                          -- น้ำที่เติมขั้นปรับดีกรี (0 ได้ — บางเจ้าไม่เติม)
  final_vol    numeric,                          -- ยอดพร้อมบรรจุ
  final_abv    numeric,                          -- ดีกรีพร้อมบรรจุ
  note         text,
  -- ★ คีย์เป็น (tenant, lot_no) **ไม่มี entity_id** — ต่างจาก log_distill โดยตั้งใจ
  --   เลข batch เป็นของเดิมที่ 0027 ต้องขยายเป็น "ต่อโรง" ตามข้อมูลที่มีอยู่แล้ว
  --   ส่วนเลขล็อตเป็นชุดใหม่ที่ระบบตั้งเอง (nextLotNumber อ่านทั้ง tenant) →
  --   ทำให้ตัวเดียวกันทั้ง tenant แล้ว RPC ทุกตัวหาล็อตด้วย lot_no ตัวเดียวได้แน่นอน
  --   🪤 ใส่ entity เข้าไปในคีย์ = 2 โรงมี S1/69 ได้พร้อมกัน → `select into` หยิบแถวแรก
  --      มาโดยไม่ error = แก้ล็อตผิดโรงเงียบ ๆ
  constraint lr_lot_key unique (tenant_id, lot_no)
);

comment on table log_redistill is
  'ล็อตกลั่นซ้ำ — 1 แถวต่อ 1 ครั้งที่ยกสุราออกจากถังรวมไปแช่/กลั่นซ้ำ (D94) '
  'draw_vol คือตัวเลขเดียวที่ไปโผล่บนฟอร์ม ภส.๐๗-๐๒/๑(๑) ผ่านแถว log_dilute ท่อน ยกไปปรุง';

comment on column log_redistill.draw_vol is
  '🔴 ยอดที่ยกออกจากถังสุรากลั่น = คอลัมน์ "ปริมาณที่นำไปปรุง" บนฟอร์ม '
  'ไม่ใช่ยอดหลังกลั่นซ้ำ — ใช้ยอดหลังกลั่นซ้ำเมื่อไหร่ คงเหลือสุรากลั่นบนฟอร์มพองสะสมตลอดกาล';

-- ── รอบกลั่น = รอบละ 1 แถว (รอบ 2, 3, 4… รอบแรกอยู่ที่ log_distill) ──────────────
--    soak_date ว่างได้ = รอบนี้ไม่แช่อะไร (วอดก้ากลั่น 3 รอบเพื่อความบริสุทธิ์ ไม่ใส่สมุนไพร)
create table if not exists log_redistill_round (
  id           bigserial primary key,
  tenant_id    uuid not null default my_tenant(),
  entity_id    text not null default my_default_entity(),
  created_at   timestamptz not null default now(),
  lot_no       text not null,
  round_no     int not null check (round_no >= 2),
  soak_date    date,                             -- วันเริ่มแช่ (ว่าง = รอบนี้ไม่แช่)
  distill_date date,                             -- ว่าง = ยังกลั่นรอบนี้ไม่เสร็จ
  start_vol    numeric, start_abv numeric,       -- ยอดเข้ารอบนี้
  end_vol      numeric, end_abv   numeric,       -- ยอดออกจากรอบนี้
  note         text,
  constraint lrr_round_key unique (tenant_id, lot_no, round_no),
  constraint lrr_lot_fk foreign key (tenant_id, lot_no)
    references log_redistill (tenant_id, lot_no) on delete cascade
);

comment on table log_redistill_round is
  'รอบกลั่นซ้ำในล็อต — จะ 1 รอบ 2 รอบ หรือ 5 รอบก็ได้ (D94) '
  'เป็นแค่รายการ ไม่มีค่าไหนถูกพิมพ์ลงฟอร์มราชการโดยตรง';

-- ── FK + index (ขึ้นต้นด้วย tenant_id เสมอ — NEXT_STEPS 4.8) ─────────────────────
alter table log_redistill drop constraint if exists log_redistill_tenant_fk;
alter table log_redistill add constraint log_redistill_tenant_fk
  foreign key (tenant_id) references tenants(id);
alter table log_redistill drop constraint if exists log_redistill_entity_fk;
alter table log_redistill add constraint log_redistill_entity_fk
  foreign key (tenant_id, entity_id) references entities (tenant_id, entity_id);

alter table log_redistill_round drop constraint if exists log_redistill_round_tenant_fk;
alter table log_redistill_round add constraint log_redistill_round_tenant_fk
  foreign key (tenant_id) references tenants(id);
alter table log_redistill_round drop constraint if exists log_redistill_round_entity_fk;
alter table log_redistill_round add constraint log_redistill_round_entity_fk
  foreign key (tenant_id, entity_id) references entities (tenant_id, entity_id);

create index if not exists lr_prod_date on log_redistill (tenant_id, product_name, draw_date);
create index if not exists lr_open on log_redistill (tenant_id, entity_id, dilute_date);
create index if not exists lrr_lot on log_redistill_round (tenant_id, lot_no, round_no);
create index if not exists log_redistill_tenant_entity_idx on log_redistill (tenant_id, entity_id);
create index if not exists log_redistill_round_tenant_entity_idx on log_redistill_round (tenant_id, entity_id);

-- ── ธงบน log_distill_run: แถวนี้เป็นค่าระหว่าง "กลั่นซ้ำ" ไหม ────────────────────
--    reuse ตารางเดิมได้เพราะ **ไม่มีฟอร์ม ภส. ใบไหนอ่าน log_distill_run เลย**
--    (productionReport รับแค่ ferment/distill/dilute/product) → ได้ timer + กราฟ +
--    หน้าประวัติเทียบหลายรอบมาทั้งชุด โดยไม่แตะชั้นที่พิมพ์เอกสารราชการ
--
-- 🚨 ธงเป็น **คอลัมน์ชัดเจน ห้ามดูจากรูปแบบชื่อว่าขึ้นต้นด้วย S**
--    (D90 — เลิกให้ระบบแกะความหมายจากข้อความที่คนแก้ได้)
--    ผู้อ่าน log_distill_run ทุกจุดต้องกรองธงนี้ ไม่งั้นล็อตจะรั่วเข้าหน้าประวัติ/กระดาน batch
alter table log_distill_run add column if not exists is_redistill boolean not null default false;
comment on column log_distill_run.is_redistill is
  'true = แถวนี้คือค่าระหว่างกลั่นซ้ำ (batch เก็บ lot_no ของ log_redistill แทนเลข batch) '
  'ผู้อ่านทุกจุดต้องกรอง — ไม่กรอง = ล็อตกลั่นซ้ำโผล่ปนกับ batch หมักในหน้าประวัติ';
create index if not exists ldr_redistill on log_distill_run (tenant_id, is_redistill, batch);

-- ── log_dilute: แถวนี้ถูกสร้างจากล็อตกลั่นซ้ำหรือเปล่า ──────────────────────────
--    null = แถวปรุงธรรมดาที่ผู้ใช้กรอกเอง (เดินทางเดิมทุกประการ)
--
-- 🚨 แถวที่มี redistill_lot **ห้ามให้แก้จากแท็บปรุง** — แก้ที่ล็อตทางเดียว
--    ไม่งั้นเลขในล็อตกับเลขบนฟอร์มเถียงกันโดยไม่มีอะไรฟ้อง (ตระกูล D81/D88
--    "ค่าเดียวมีสองนิยาม") · บังคับที่ server action + หน้าจอ
alter table log_dilute add column if not exists redistill_lot text;
alter table log_dilute add column if not exists redistill_leg text;
alter table log_dilute drop constraint if exists log_dilute_leg_check;
alter table log_dilute add constraint log_dilute_leg_check
  check (redistill_leg is null or redistill_leg in ('ยกไปปรุง','ปรุงเสร็จ'));

comment on column log_dilute.redistill_leg is
  'ท่อนของแถวปรุงที่มาจากล็อตกลั่นซ้ำ (D94) — ยกไปปรุง = วันเริ่มแช่ (ดัน start_vol) · '
  'ปรุงเสร็จ = วันปรับดีกรี (ดัน final_vol) · null = แถวปรุงธรรมดา';

-- ★ กันเขียนซ้ำที่ระดับ DB: 1 ล็อตมีได้ท่อนละ 1 แถวเท่านั้น (แพตเทิร์น partial unique
--   ของ tax_payments D88) — เปิด 2 แท็บกดปิดล็อตพร้อมกันก็ได้แถวเดียว
create unique index if not exists log_dilute_lot_leg
  on log_dilute (tenant_id, redistill_lot, redistill_leg)
  where redistill_lot is not null;
create index if not exists log_dilute_lot on log_dilute (tenant_id, redistill_lot);

-- ── RLS — ชุดเดียวกับตารางผลิตตัวอื่น (0051 capability) ───────────────────────────
alter table log_redistill       enable row level security;
alter table log_redistill_round enable row level security;

drop policy if exists log_redistill_sel on log_redistill;
create policy log_redistill_sel on log_redistill for select
  using (tenant_id = my_tenant() and has_cap('prod.read'));
drop policy if exists log_redistill_w on log_redistill;
create policy log_redistill_w on log_redistill for all
  using (tenant_id = my_tenant() and has_cap('prod.write'))
  with check (tenant_id = my_tenant() and has_cap('prod.write'));

drop policy if exists log_redistill_round_sel on log_redistill_round;
create policy log_redistill_round_sel on log_redistill_round for select
  using (tenant_id = my_tenant() and has_cap('prod.read'));
drop policy if exists log_redistill_round_w on log_redistill_round;
create policy log_redistill_round_w on log_redistill_round for all
  using (tenant_id = my_tenant() and has_cap('prod.write'))
  with check (tenant_id = my_tenant() and has_cap('prod.write'));

-- ── audit (0005) — ทุกจุดที่ผู้ใช้บันทึกได้ต้องมี edit_log ────────────────────────
drop trigger if exists audit_log_redistill on log_redistill;
create trigger audit_log_redistill after insert or update or delete on log_redistill
  for each row execute function trg_audit('id');
drop trigger if exists audit_log_redistill_round on log_redistill_round;
create trigger audit_log_redistill_round after insert or update or delete on log_redistill_round
  for each row execute function trg_audit('id');

-- ════════════════════════════════════════════════════════════════════════════
--  RPC — ทุกตัว SECURITY INVOKER (RLS ข้างบนบังคับ prod.write อยู่แล้ว)
--  เหตุผลที่ต้องเป็น RPC ไม่ใช่ .from().insert() หลายครั้งจากฝั่ง TS:
--    เขียนข้ามตาราง (ล็อต + log_dilute + log_material) ต้องอยู่ใน transaction เดียว
--    ล้มกลางทาง = ยอดบนฟอร์มค้างครึ่ง ๆ กลาง ๆ โดยไม่มีอะไรฟ้อง
--  🚨 แต่ **ไม่มีสูตรเงิน/ดีกรีอยู่ในนี้เลย** — ตรรกะที่ตัดสินตัวเลขอยู่ที่
--     lib/production/redistill.ts ที่มีเทสคุม (บทเรียน D79/D86: สูตรมี 2 ที่ = พังเงียบ)
-- ════════════════════════════════════════════════════════════════════════════

-- ── สุราดิบคงเหลือรอปรุง ต่อชื่อสุรา — ฝาแฝดของ remainingDistillVol() (P9) ────────
--    ★ ไม่กรอง entity_id โดยตั้งใจ — ให้ตรงกับ getRemainingDistillVol() ฝั่งแอปเป๊ะ
--      (แอปกรองแค่ tenant ผ่าน RLS) · กรองข้างเดียว = ตัวเลขบนจอกับด่านใน DB ไม่ตรงกัน
create or replace function fn_raw_spirit_remaining(p_product_name text)
returns numeric
language sql stable set search_path = public as $fn$
  select greatest(
    coalesce((select sum(vol) from log_distill where product_name = p_product_name), 0)
  - coalesce((select sum(start_vol) from log_dilute where product_name = p_product_name), 0)
  , 0);
$fn$;

comment on function fn_raw_spirit_remaining(text) is
  'สุรากลั่นดิบคงเหลือรอปรุง ต่อชื่อสุรา — ฝาแฝดฝั่ง DB ของ remainingDistillVol() ใน lib/production/calc';

-- ── เดือนนี้ปิดบัญชีสรรพสามิตไปแล้วหรือยัง (0058) ──────────────────────────────
--    ใช้ **เตือน ไม่บล็อก** ตามกติกา D91 (ผู้ใช้ย้ายมาจาก Sheets ที่แก้มือได้ทุกอย่าง)
create or replace function fn_excise_month_closed(p_entity text, p_month text)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from excise_month_close
    where tenant_id = my_tenant() and entity_id = p_entity
      and month = p_month and reopened_at is null
  );
$fn$;

-- ── เปิดล็อต = ยกสุราออกจากถัง + เขียนท่อน 'ยกไปปรุง' ลงฟอร์มทันที ────────────────
--
-- 🚨 ท่อน 'ยกไปปรุง' ต้องเขียน **ตอนนี้** ไม่ใช่ตอนปิดล็อต — ระหว่างแช่เป็นสัปดาห์
--    ถ้ายังไม่หักออก ระบบจะคิดว่าสุราก้อนนี้ว่างอยู่ แล้วปล่อยให้กดปรุงซ้ำได้อีก
create or replace function fn_open_redistill_lot(
  p_lot_no text, p_product_name text, p_draw_date date,
  p_draw_vol numeric, p_draw_abv numeric,
  p_leg_note text default null,          -- ข้อความหมายเหตุที่ lotNoteText() สร้างมา
  p_note text default null
) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  v_remaining numeric;
begin
  if coalesce(p_draw_vol, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'ปริมาณที่ยกออกต้องมากกว่า 0');
  end if;

  v_remaining := fn_raw_spirit_remaining(p_product_name);
  -- 1e-6 กันเศษทศนิยมลอยตัว ไม่ใช่การผ่อนกฎ (240.00 ต้องยกได้เมื่อเหลือ 240.00 พอดี)
  if p_draw_vol > v_remaining + 0.000001 then
    return jsonb_build_object('ok', false, 'error',
      'ยกออกได้ไม่เกินสุรากลั่นคงเหลือของ "'||p_product_name||'" ('||
      to_char(v_remaining, 'FM999999990.00')||' ลิตร)');
  end if;

  insert into log_redistill(lot_no, product_name, draw_date, draw_vol, draw_abv, note)
  values (p_lot_no, p_product_name, p_draw_date, p_draw_vol, p_draw_abv, p_note);

  -- แถวที่ไปโผล่บนฟอร์ม ภส.๐๗-๐๒/๑(๑) คอลัมน์ "ปริมาณที่นำไปปรุง"
  insert into log_dilute(dilute_date, product_name, start_vol, start_abv,
                         redistill_lot, redistill_leg, note)
  values (p_draw_date, p_product_name, p_draw_vol, p_draw_abv,
          p_lot_no, 'ยกไปปรุง', p_leg_note);

  return jsonb_build_object('ok', true, 'lot_no', p_lot_no, 'remaining_before', v_remaining);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error',
    'เลขล็อต "'||p_lot_no||'" ถูกใช้ไปแล้ว');
end $fn$;

-- ── บันทึก/แก้รอบกลั่นซ้ำ + ตัดสมุนไพรเข้าบัญชีวัตถุดิบ ───────────────────────────
--
-- 🚨 สมุนไพรลงวันที่ **เริ่มแช่ของรอบนั้น** ไม่ใช่วันกลั่น — เพื่อให้ตกวันเดียวกับแถว
--    'ยกไปปรุง' บนฟอร์มสุรา ⇒ เจ้าหน้าที่เปิด ๐๗-๐๑/๑ กับ ๐๗-๐๒/๑(๑) มาเทียบแล้วเห็นภาพจบ
--
-- 🪤 doc_ref ถูก **ตรวจรูปแบบในนี้** ไม่ใช่เชื่อค่าที่ TS ส่งมาดื้อ ๆ — ฟังก์ชันนี้ลบ
--    log_material ด้วย doc_ref ก่อนเขียนใหม่ ถ้ารับค่าอะไรก็ได้ ส่งเลข batch มา =
--    ลบวัตถุดิบที่เบิกไปหมักทิ้งทั้งชุดโดยไม่มีอะไรฟ้อง
create or replace function fn_save_redistill_round(
  p_lot_no text, p_round_no int, p_doc_ref text,
  p_soak_date date, p_distill_date date,
  p_start_vol numeric, p_start_abv numeric,
  p_end_vol numeric, p_end_abv numeric,
  p_note text default null,
  p_materials jsonb default '[]'::jsonb      -- [{"material_id":"M001","amount":2}, ...]
) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  v_lot log_redistill%rowtype;
  it jsonb;
  v_mats int := 0;
begin
  select * into v_lot from log_redistill where lot_no = p_lot_no;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ไม่พบล็อต "'||p_lot_no||'"');
  end if;
  if v_lot.dilute_date is not null then
    return jsonb_build_object('ok', false, 'error',
      'ล็อต "'||p_lot_no||'" ปิดไปแล้ว — กดถอนการปิดล็อตก่อนถึงจะแก้รอบได้');
  end if;
  if p_doc_ref is distinct from (p_lot_no || ' รอบ ' || p_round_no) then
    return jsonb_build_object('ok', false, 'error', 'เลขอ้างอิงวัตถุดิบไม่ถูกต้อง');
  end if;
  if jsonb_array_length(p_materials) > 0 and p_soak_date is null then
    return jsonb_build_object('ok', false, 'error',
      'ใส่สมุนไพรแล้วต้องระบุวันเริ่มแช่ (วันที่ตัดวัตถุดิบเข้าบัญชี ภส.๐๗-๐๑/๑)');
  end if;

  insert into log_redistill_round(lot_no, round_no, soak_date, distill_date,
                                  start_vol, start_abv, end_vol, end_abv, note)
  values (p_lot_no, p_round_no, p_soak_date, p_distill_date,
          p_start_vol, p_start_abv, p_end_vol, p_end_abv, p_note)
  on conflict (tenant_id, lot_no, round_no) do update
    set soak_date = excluded.soak_date, distill_date = excluded.distill_date,
        start_vol = excluded.start_vol, start_abv = excluded.start_abv,
        end_vol   = excluded.end_vol,   end_abv   = excluded.end_abv,
        note      = excluded.note;

  -- เขียนทับรายการสมุนไพรของรอบนี้ทั้งชุด (ลบแล้วใส่ใหม่ = แก้รายการแล้วไม่มีเศษค้าง)
  delete from log_material where doc_ref = p_doc_ref and trans_type = 'จ่าย';
  for it in select value from jsonb_array_elements(p_materials) loop
    if (it->>'material_id') is not null and (it->>'amount') is not null then
      insert into log_material(doc_date, trans_type, material_id, amount, doc_ref, note)
      values (p_soak_date, 'จ่าย', it->>'material_id', (it->>'amount')::numeric,
              p_doc_ref, 'แช่เพื่อกลั่นซ้ำ (อัตโนมัติ)');
      v_mats := v_mats + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'lot_no', p_lot_no,
                            'round_no', p_round_no, 'materials', v_mats);
end $fn$;

create or replace function fn_delete_redistill_round(p_lot_no text, p_round_no int, p_doc_ref text)
returns jsonb
language plpgsql set search_path = public as $fn$
declare
  v_lot log_redistill%rowtype;
  v_n int;
begin
  select * into v_lot from log_redistill where lot_no = p_lot_no;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ไม่พบล็อต "'||p_lot_no||'"');
  end if;
  if v_lot.dilute_date is not null then
    return jsonb_build_object('ok', false, 'error',
      'ล็อต "'||p_lot_no||'" ปิดไปแล้ว — กดถอนการปิดล็อตก่อน');
  end if;
  if p_doc_ref is distinct from (p_lot_no || ' รอบ ' || p_round_no) then
    return jsonb_build_object('ok', false, 'error', 'เลขอ้างอิงวัตถุดิบไม่ถูกต้อง');
  end if;

  delete from log_material where doc_ref = p_doc_ref and trans_type = 'จ่าย';
  delete from log_redistill_round where lot_no = p_lot_no and round_no = p_round_no;
  get diagnostics v_n = row_count;
  -- 🚨 D93 — ลบไม่โดนอะไรเลยต้องตอบ error ไม่ใช่ ok (ผู้ใช้จะนึกว่าลบสำเร็จ)
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error',
      'ไม่พบรอบที่ '||p_round_no||' ของล็อต "'||p_lot_no||'"');
  end if;
  return jsonb_build_object('ok', true);
end $fn$;

-- ── ปิดล็อต = ปรับดีกรีเสร็จ → เขียนท่อน 'ปรุงเสร็จ' ลงฟอร์ม ─────────────────────
create or replace function fn_close_redistill_lot(
  p_lot_no text, p_dilute_date date, p_water numeric,
  p_final_vol numeric, p_final_abv numeric,
  p_draw_note text default null,          -- หมายเหตุท่อนแรก (เขียนทับให้เล่าครบหลังปิด)
  p_final_note text default null
) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  v_lot log_redistill%rowtype;
  v_rounds int;
begin
  select * into v_lot from log_redistill where lot_no = p_lot_no;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ไม่พบล็อต "'||p_lot_no||'"');
  end if;
  if v_lot.dilute_date is not null then
    return jsonb_build_object('ok', false, 'error', 'ล็อต "'||p_lot_no||'" ปิดไปแล้ว');
  end if;
  if coalesce(p_final_vol, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'ปริมาณที่ได้ต้องมากกว่า 0');
  end if;

  -- ★ ปิดล็อตที่ไม่มีรอบกลั่นเลย = ไม่มีการกลั่นซ้ำเกิดขึ้น ควรใช้แท็บปรุงธรรมดา
  select count(*) into v_rounds
    from log_redistill_round where lot_no = p_lot_no and end_vol is not null;
  if v_rounds = 0 then
    return jsonb_build_object('ok', false, 'error',
      'ยังไม่มีรอบกลั่นซ้ำที่บันทึกผลไว้ — ปิดล็อตไม่ได้');
  end if;

  update log_redistill
     set dilute_date = p_dilute_date, water = p_water,
         final_vol = p_final_vol, final_abv = p_final_abv
   where lot_no = p_lot_no;

  insert into log_dilute(dilute_date, product_name, water, final_vol, final_abv,
                         redistill_lot, redistill_leg, note)
  values (p_dilute_date, v_lot.product_name, p_water, p_final_vol, p_final_abv,
          p_lot_no, 'ปรุงเสร็จ', p_final_note);

  if p_draw_note is not null then
    update log_dilute set note = p_draw_note
      where redistill_lot = p_lot_no and redistill_leg = 'ยกไปปรุง';
  end if;

  return jsonb_build_object('ok', true, 'lot_no', p_lot_no, 'rounds', v_rounds,
    'month_closed', fn_excise_month_closed(v_lot.entity_id, to_char(p_dilute_date, 'YYYY-MM')));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error',
    'ล็อต "'||p_lot_no||'" ถูกปิดไปแล้วจากอีกหน้าจอหนึ่ง');
end $fn$;

-- ── ถอนการปิดล็อต (แพตเทิร์น "ถอนปิดเดือน" D91 / "ถอนการปิด batch" D93) ──────────
create or replace function fn_reopen_redistill_lot(p_lot_no text, p_draw_note text default null)
returns jsonb
language plpgsql set search_path = public as $fn$
declare
  v_n int;
begin
  delete from log_dilute where redistill_lot = p_lot_no and redistill_leg = 'ปรุงเสร็จ';
  get diagnostics v_n = row_count;
  -- 🚨 D93 — ไม่มีอะไรให้ถอนต้องตอบ error ไทย ไม่ใช่ ok เงียบ ๆ
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error',
      'ล็อต "'||p_lot_no||'" ยังไม่ได้ปิด จึงไม่มีอะไรให้ถอน');
  end if;

  update log_redistill
     set dilute_date = null, water = null, final_vol = null, final_abv = null
   where lot_no = p_lot_no;

  if p_draw_note is not null then
    update log_dilute set note = p_draw_note
      where redistill_lot = p_lot_no and redistill_leg = 'ยกไปปรุง';
  end if;

  return jsonb_build_object('ok', true, 'lot_no', p_lot_no);
end $fn$;

-- ── ลบล็อตทั้งก้อน — ต้องเก็บกวาดครบทุกตารางที่ล็อตไปแตะ ─────────────────────────
-- 🚨 ลบล็อตแล้วลืมลบแถว log_dilute = ยอด "นำไปปรุง 240" ค้างบนฟอร์มตลอดกาล
--    โดยไม่มีล็อตให้ตามกลับ (ตระกูล D82 "ลิสต์ที่ครบไม่ได้แปลว่าเรียงถูก" — ที่นี่คือครบไหม)
create or replace function fn_delete_redistill_lot(p_lot_no text)
returns jsonb
language plpgsql set search_path = public as $fn$
declare
  v_mats int; v_runs int; v_dilu int; v_lot int;
begin
  delete from log_material
   where trans_type = 'จ่าย'
     and doc_ref in (select p_lot_no || ' รอบ ' || round_no
                       from log_redistill_round where lot_no = p_lot_no);
  get diagnostics v_mats = row_count;

  delete from log_distill_run where batch = p_lot_no and is_redistill;
  get diagnostics v_runs = row_count;

  delete from log_dilute where redistill_lot = p_lot_no;
  get diagnostics v_dilu = row_count;

  delete from log_redistill where lot_no = p_lot_no;   -- รอบถูกลบตาม (on delete cascade)
  get diagnostics v_lot = row_count;
  if v_lot = 0 then
    return jsonb_build_object('ok', false, 'error', 'ไม่พบล็อต "'||p_lot_no||'"');
  end if;

  return jsonb_build_object('ok', true, 'materials', v_mats,
                            'runs', v_runs, 'dilutes', v_dilu);
end $fn$;

-- ── fn_mig_truncate — ยกมาจาก 0058 ทั้งดุ้น เติม 2 ตารางใหม่ ────────────────────
-- 🚨 ทั้งคู่มี entity_id FK → ต้องมาก่อน 'entities' · รอบต้องมาก่อนล็อต (FK ในตัวเอง)
create or replace function fn_mig_truncate(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  t text;
  -- เรียงตามลำดับ FK (ลูกก่อนแม่) เพราะ delete ไม่ cascade เองเหมือน truncate
  tables text[] := array[
    'transaction_items','transactions','tax_summaries','tax_payments','wht_certificates',
    'log_material','log_ferment','log_distill','log_distill_run',
    'log_ferment_monitor','log_dilute','log_ferment_draw','log_product','stock_product',
    -- ★ D94 — กลั่นซ้ำ: รอบมี FK ไปล็อต · ล็อตมี entity_id FK
    'log_redistill_round','log_redistill',
    'sales_order_items','sales_orders','warehouse_stock','stock_moves','sale_menu',
    -- เงินเดือน (0040 + 0042) — ต้องมาก่อน entities ไม่งั้นติด FK
    'payroll_items','payroll_periods','employees',
    'pay_components','pay_inputs','pay_rates','pay_variables','pay_post_legs',
    'contacts','bank_accounts',
    'materials','containers','products',
    -- ★ report_runs มี entity_id FK → ต้องมาก่อน entities ด้วย (0050)
    'report_runs',
    -- ★ D91 — excise_month_close มี entity_id FK → ต้องมาก่อน entities ด้วย
    'excise_month_close',
    'entities',
    'app_settings','integration_log','edit_log','counters'
  ];
begin
  if p_tenant is null then
    raise exception 'fn_mig_truncate: ต้องระบุ tenant — ห้ามล้างข้ามลูกค้า';
  end if;
  foreach t in array tables loop
    execute format('delete from %I where tenant_id = $1', t) using p_tenant;
  end loop;
end $fn$;

notify pgrst, 'reload schema';
