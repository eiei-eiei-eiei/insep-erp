-- ============================================================================
-- 0040 โมดูลเงินเดือน (โมดูลที่ 4) — รอบที่ 1: คำนวณ → ส่งเข้าบัญชี → สลิป
--   employees · pay_inputs · pay_components · pay_rates · payroll_periods · payroll_items
--   + fn_post_payroll / fn_unpost_payroll  (เหตุผลการออกแบบทั้งหมดอยู่ docs/DECISIONS.md D66)
--
-- 🎯 หลักการของทั้งโมดูล: **โค้ดเป็นกลาง ไม่มีเกณฑ์ของบริษัทใดอยู่ในนี้**
--    ล็อกในโค้ด = ลำดับการคำนวณ + สูตรที่กฎหมายกำหนด (ภาษี/ประกันสังคม)
--    ลูกค้าตั้งเอง  = รายการเพิ่ม/หัก · กลุ่มพนักงาน · ตัวคูณ · อัตรา
--    → โรงที่คิดเบี้ยขยันแปลก ๆ ตั้งเอาเองได้ โดยไม่ต้องมีโค้ดเฉพาะเจ้า
--
-- 🚨 ข้อมูลเงินเดือนรายคนเป็นข้อมูลอ่อนไหวที่สุดในระบบ — policy `select` ของทุกตารางในไฟล์นี้
--    จำกัด `my_role() = 'main'` (ต่างจาก transactions ที่ viewer อ่านได้)
--    ไม่งั้นพนักงานขายยิง query ด้วย anon key อ่านเงินเดือนเพื่อนร่วมงานได้
-- ============================================================================

-- ── 1. ลูกจ้าง ───────────────────────────────────────────────────────────────
--    ★ ทำไมไม่ยัดเข้า `contacts`: policy contacts_w เปิดให้ role `sale` เขียน และทุกคนใน
--      tenant อ่านได้ → ฝ่ายขายจะเห็นเงินเดือนเพื่อนร่วมงาน · (ตอนทำ 50ทวิ รอบหน้า
--      ค่อยผูก contact_id เป็น optional FK ถ้าจำเป็น)
create table if not exists employees (
  tenant_id  uuid not null default my_tenant(),
  emp_id     text not null,                       -- 'EMP-001' (รันด้วย next_serial)
  entity_id  text not null default my_default_entity(),
  name       text not null,
  national_id text,                               -- เก็บเป็น text: เลข 0 นำหน้าห้ามหาย
  sso_no     text,
  address    text,
  bank_name  text,
  bank_acct  text,
  start_date date,
  end_date   date,
  group_code text,                                -- อ้าง app_settings kind='pay_group' (ไม่ FK — เป็นค่าอิสระ)
  wage_type  text not null default 'monthly'
    check (wage_type in ('monthly','monthly_prorate','daily')),
  base_wage  numeric(14,2) not null default 0,    -- เงินเดือน หรือค่าแรงต่อวัน (แล้วแต่ wage_type)
  sso_exempt boolean not null default false,
  wht_mode   text not null default 'none' check (wht_mode in ('none','fixed','auto')),
  wht_fixed  numeric(14,2) not null default 0,
  tax_allowances jsonb not null default '{}'::jsonb,  -- { "2569": { personal: 60000, ... } }
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (tenant_id, emp_id)
);

comment on column employees.tax_allowances is
  'ค่าลดหย่อนภาษีแยกตามปี พ.ศ. (จาก ล.ย.01 ที่ลูกจ้างยื่นให้นายจ้าง) '
  'แยกรายปีเพราะสิทธิ์เปลี่ยนได้ทุกปี และงวดเก่าต้องคำนวณด้วยสิทธิ์ของปีนั้น';

comment on column employees.base_wage is
  'wage_type monthly/monthly_prorate = เงินเดือน · daily = ค่าแรงต่อวัน '
  '(ค่าตำแหน่ง/เบี้ยเลี้ยงไม่อยู่ที่นี่ — เป็น pay_components เพื่อให้ติดธงว่าเข้าฐานไหนได้)';

-- ── 2. ช่องที่กรอกต่อคนต่องวด (ลูกค้าสร้างเอง) ───────────────────────────────
create table if not exists pay_inputs (
  tenant_id uuid not null default my_tenant(),
  code      text not null,                        -- ASCII — ใช้เป็นคีย์ใน payroll_items.inputs
  label     text not null,
  unit      text,                                 -- 'ชั่วโมง' / 'วัน' / 'ครั้ง' / 'คะแนน'
  sort      int not null default 0,
  active    boolean not null default true,
  primary key (tenant_id, code)
);

-- ── 3. รายการเพิ่ม/หัก — หัวใจของความยืดหยุ่น ────────────────────────────────
--    🚨 `method` เป็น **ชุดปิด** ห้ามขยายเป็นภาษาสูตรที่ลูกค้าเขียนเอง
--       สูตรที่ลูกค้าเขียน golden test ไม่ได้ และขัดกติกาเหล็กข้อ 1
--       เจอเคสนอกเหนือ → ใช้ 'manual' (กรอกยอดเองต่อคนต่องวด) ครอบ 100% ที่เหลือ
create table if not exists pay_components (
  tenant_id uuid not null default my_tenant(),
  code      text not null,
  name      text not null,
  kind      text not null check (kind in ('earning','deduction')),
  method    text not null
    check (method in ('fixed','per_unit','percent_base','hourly_multiplier','tier_table','manual')),

  amount     numeric(14,2) not null default 0,    -- fixed / per_unit
  rate       numeric(9,4)  not null default 0,    -- percent_base (5 = 5%)
  multiplier numeric(9,4)  not null default 0,    -- hourly_multiplier (1.5 / 2 / 3)
  tiers      jsonb not null default '[]'::jsonb,  -- tier_table: [{upTo, amount}, ...]

  input_keys text[] not null default '{}',        -- อ้าง pay_inputs.code
  input_agg  text not null default 'sum' check (input_agg in ('sum','avg')),
  group_codes text[] not null default '{}',       -- ว่าง = ทุกกลุ่ม

  -- ── 4 ธงที่ตัดสินว่ารายการนี้ไหลเข้าฐานไหน ────────────────────────────────
  taxable      boolean not null default true,
  sso_base     boolean not null default false,
  ot_base      boolean not null default false,
  prorate_base boolean not null default false,

  expense_cat text,                               -- หมวดรายจ่ายตอน post เข้าบัญชี
  sort   int not null default 0,
  active boolean not null default true,
  primary key (tenant_id, code)
);

comment on column pay_components.sso_base is
  '🚨 ไม่เท่ากับ taxable — ค่าล่วงเวลา/โบนัสเข้าฐานภาษี แต่ไม่ใช่ "ค่าจ้าง" ตาม พ.ร.บ.ประกันสังคม '
  'ถ้าใช้ฐานเดียวกันทั้งสองที่ ตัวเลขที่ยื่น ภงด.1/สปส.1-10 ผิดตั้งแต่เดือนแรกโดยไม่มีอะไรฟ้อง';

comment on column pay_components.group_codes is
  'ว่าง = ทุกกลุ่ม · ตัวคูณ OT ที่ต่างกันตามกลุ่มทำได้ด้วยการสร้าง 2 แถวคนละ group_codes '
  '(คนอยู่ได้กลุ่มเดียว → รายการที่ไม่ตรงกลุ่มถูกข้าม ไม่มีทางนับซ้ำ)';

comment on column pay_components.method is
  'ชุดปิด 6 แบบ — ห้ามขยายเป็นภาษาสูตร (golden test ไม่ได้ + ขัดกติกาเหล็กข้อ 1) '
  'เคสนอกเหนือใช้ manual: กรอกยอดเองต่อคนต่องวด';

-- ── 4. อัตราที่มีวันเริ่มมีผล ─────────────────────────────────────────────────
--    🚨 ห้ามฝังอัตราพวกนี้เป็นค่าคงที่ในโค้ด — เพดานฐานค่าจ้างประกันสังคมและขั้นบันไดภาษี
--       ถูกแก้ด้วยกฎกระทรวงเป็นระยะ · ฝังแล้ววันที่กฎเปลี่ยนต้อง deploy ใหม่
--       และการเปิดดูงวดเก่าจะได้อัตราปีปัจจุบันย้อนหลังไปทับ
--    ★ นี่เป็นตารางแรกของระบบที่มีแนวคิด effective-dated (app_settings แบบ kind/value รองรับไม่ได้)
create table if not exists pay_rates (
  tenant_id      uuid not null default my_tenant(),
  effective_from date not null,
  sso_rate       numeric(9,4) not null default 5,      -- 5 = 5%
  sso_wage_min   numeric(14,2) not null default 0,
  sso_wage_max   numeric(14,2) not null default 0,
  pit_brackets   jsonb not null default '[]'::jsonb,   -- [{upTo, rate}, ...] เรียงจากน้อยไปมาก
  personal_allowance numeric(14,2) not null default 0,
  expense_rate   numeric(9,4) not null default 50,     -- 50 = 50%
  expense_cap    numeric(14,2) not null default 0,
  note           text,
  primary key (tenant_id, effective_from)
);

comment on table pay_rates is
  'ชุดอัตราตามกฎหมายที่มีผลตั้งแต่วันหนึ่ง (1 แถว = ครบทั้งชุด) '
  'เลือกแถวล่าสุดที่ effective_from <= วันสิ้นงวด — ห้ามใช้วันที่เปิดหน้าจอ '
  'ไม่งั้นเปิดดูงวดปีที่แล้วจะได้อัตราปีนี้';

-- ── 5. งวดจ่าย ───────────────────────────────────────────────────────────────
create table if not exists payroll_periods (
  tenant_id  uuid not null default my_tenant(),
  period_id  text not null,                       -- 'PR-2026-05' (ค.ศ. — เก็บ ISO ทั้งระบบ)
  entity_id  text not null default my_default_entity(),
  year       int not null,
  month      int not null check (month between 1 and 12),
  work_days_std numeric(6,2) not null,            -- ตัวหารของ monthly_prorate
  pay_date   date,
  status     text not null default 'draft' check (status in ('draft','partial','posted')),
  post_state jsonb not null default '{}'::jsonb,  -- { net:{txIds,date}, sso:{txId,date}, wht:{...} }
  created_at timestamptz not null default now(),
  primary key (tenant_id, period_id)
);

comment on column payroll_periods.post_state is
  'ขา NET/SSO/WHT post แยกอิสระ — เก็บ txId + วันที่ของแต่ละขาไว้ที่นี่ '
  'status derive จาก 3 ขา: ครบ = posted · บางส่วน = partial · ไม่มีเลย = draft';

-- ── 6. บรรทัดต่อคนต่องวด ─────────────────────────────────────────────────────
--    🪤 `computed` + `rates_snapshot` = **แช่ตัวเลขไว้ตอนกดบันทึก**
--       ห้ามคำนวณสดจาก config ตอนเปิดดู ไม่งั้นลูกค้าแก้เกณฑ์กลางปี
--       แล้วงวดที่ post/ยื่นไปแล้วจะเปลี่ยนตัวเลขย้อนหลังเงียบ ๆ
--       (กับดักตระกูลเดียวกับวันตัดรอบค่างวดใน D59)
create table if not exists payroll_items (
  -- id เป็น surrogate สำหรับ audit เท่านั้น (trg_audit เก็บ row_pk ได้คอลัมน์เดียว
  -- และ emp_id อย่างเดียวไม่ unique ข้ามงวด) — คีย์จริงคือ (tenant_id, period_id, emp_id)
  id         bigint generated always as identity,
  tenant_id  uuid not null default my_tenant(),
  period_id  text not null,
  emp_id     text not null,
  emp_name   text not null,                       -- snapshot ชื่อ ณ ตอนสร้างงวด
  group_code text,                                -- snapshot กลุ่ม (เผื่อย้ายกลุ่มทีหลัง)
  inputs     jsonb not null default '{}'::jsonb,  -- { workDays, values:{}, manual:{}, whtOverride }
  computed   jsonb not null default '{}'::jsonb,  -- ผลแจกแจงรายบรรทัดจาก lib/payroll/calc
  rates_snapshot jsonb not null default '{}'::jsonb,

  base_amount numeric(14,2) not null default 0,
  gross       numeric(14,2) not null default 0,
  sso         numeric(14,2) not null default 0,
  sso_employer numeric(14,2) not null default 0,
  wht         numeric(14,2) not null default 0,
  deductions  numeric(14,2) not null default 0,
  net         numeric(14,2) not null default 0,

  tx_id      text,                                -- tx ของขา NET (1 tx ต่อคน)
  updated_at timestamptz not null default now(),
  primary key (tenant_id, period_id, emp_id)
);

-- ── FK composite (ตามแพตเทิร์น 0027) ─────────────────────────────────────────
alter table employees        drop constraint if exists employees_entity_id_fkey;
alter table employees        add constraint employees_entity_id_fkey
  foreign key (tenant_id, entity_id) references entities (tenant_id, entity_id);
alter table payroll_periods  drop constraint if exists payroll_periods_entity_id_fkey;
alter table payroll_periods  add constraint payroll_periods_entity_id_fkey
  foreign key (tenant_id, entity_id) references entities (tenant_id, entity_id);
alter table payroll_items    drop constraint if exists payroll_items_period_fkey;
alter table payroll_items    add constraint payroll_items_period_fkey
  foreign key (tenant_id, period_id) references payroll_periods (tenant_id, period_id) on delete cascade;
alter table payroll_items    drop constraint if exists payroll_items_emp_fkey;
alter table payroll_items    add constraint payroll_items_emp_fkey
  foreign key (tenant_id, emp_id) references employees (tenant_id, emp_id);

-- ── index — ★ ทุกตัวขึ้นต้นด้วย tenant_id (กติกา 0025) ───────────────────────
--    PK ขึ้นต้นด้วย tenant_id อยู่แล้ว จึงเพิ่มเฉพาะเส้นทางที่ query จริงต้องใช้
create index if not exists emp_active on employees (tenant_id, entity_id, active);
create index if not exists pp_month   on payroll_periods (tenant_id, entity_id, year, month);
create index if not exists pi_emp     on payroll_items (tenant_id, emp_id);

-- ── RLS — 🚨 select เฉพาะ main (ข้อมูลเงินเดือนรายคน) ────────────────────────
alter table employees        enable row level security;
alter table pay_inputs       enable row level security;
alter table pay_components   enable row level security;
alter table pay_rates        enable row level security;
alter table payroll_periods  enable row level security;
alter table payroll_items    enable row level security;

-- ตารางที่มี entity_id → พ่วง entity scope ด้วย
drop policy if exists employees_sel on employees;
create policy employees_sel on employees for select
  using (tenant_id = my_tenant() and my_role() = 'main'
         and (my_entities() is null or entity_id = any(my_entities())));
drop policy if exists employees_w on employees;
create policy employees_w on employees for all
  using (tenant_id = my_tenant() and my_role() = 'main'
         and (my_entities() is null or entity_id = any(my_entities())))
  with check (tenant_id = my_tenant() and my_role() = 'main'
         and (my_entities() is null or entity_id = any(my_entities())));

drop policy if exists pp_sel on payroll_periods;
create policy pp_sel on payroll_periods for select
  using (tenant_id = my_tenant() and my_role() = 'main'
         and (my_entities() is null or entity_id = any(my_entities())));
drop policy if exists pp_w on payroll_periods;
create policy pp_w on payroll_periods for all
  using (tenant_id = my_tenant() and my_role() = 'main'
         and (my_entities() is null or entity_id = any(my_entities())))
  with check (tenant_id = my_tenant() and my_role() = 'main'
         and (my_entities() is null or entity_id = any(my_entities())));

-- ตารางลูก/ตาราง config (ไม่มี entity_id) → สโคปแค่ tenant + role
drop policy if exists pi_sel on payroll_items;
create policy pi_sel on payroll_items for select
  using (tenant_id = my_tenant() and my_role() = 'main');
drop policy if exists pi_w on payroll_items;
create policy pi_w on payroll_items for all
  using (tenant_id = my_tenant() and my_role() = 'main')
  with check (tenant_id = my_tenant() and my_role() = 'main');

drop policy if exists payin_sel on pay_inputs;
create policy payin_sel on pay_inputs for select
  using (tenant_id = my_tenant() and my_role() = 'main');
drop policy if exists payin_w on pay_inputs;
create policy payin_w on pay_inputs for all
  using (tenant_id = my_tenant() and my_role() = 'main')
  with check (tenant_id = my_tenant() and my_role() = 'main');

drop policy if exists paycomp_sel on pay_components;
create policy paycomp_sel on pay_components for select
  using (tenant_id = my_tenant() and my_role() = 'main');
drop policy if exists paycomp_w on pay_components;
create policy paycomp_w on pay_components for all
  using (tenant_id = my_tenant() and my_role() = 'main')
  with check (tenant_id = my_tenant() and my_role() = 'main');

drop policy if exists payrate_sel on pay_rates;
create policy payrate_sel on pay_rates for select
  using (tenant_id = my_tenant() and my_role() = 'main');
drop policy if exists payrate_w on pay_rates;
create policy payrate_w on pay_rates for all
  using (tenant_id = my_tenant() and my_role() = 'main')
  with check (tenant_id = my_tenant() and my_role() = 'main');

-- ── audit ────────────────────────────────────────────────────────────────────
drop trigger if exists audit_employees on employees;
create trigger audit_employees after insert or update or delete on employees
  for each row execute function trg_audit('emp_id');
drop trigger if exists audit_payroll_items on payroll_items;
create trigger audit_payroll_items after insert or update or delete on payroll_items
  for each row execute function trg_audit('id');
drop trigger if exists audit_pay_components on pay_components;
create trigger audit_pay_components after insert or update or delete on pay_components
  for each row execute function trg_audit('code');

-- ── app_settings kind ใหม่ ───────────────────────────────────────────────────
--    ⚠️ ต้องยกรายการเดิมจาก 0033 มาครบ — constraint นี้เขียนทับทั้งก้อน
--       ตกไปตัวเดียว = ค่าที่ลูกค้าตั้งไว้อยู่แล้วบันทึกไม่ได้อีก
alter table app_settings drop constraint if exists app_settings_kind_check;
alter table app_settings add constraint app_settings_kind_check
  check (kind in ('expense_cat','income_cat','wht_rate','tax_account',
                  'sales_revenue_account','sales_revenue_entity','sales_doc_entity',
                  'brand_name','brand_color','logo_url','default_mode',
                  'line_channel_token','line_group_id',
                  -- เงินเดือน (0040)
                  'pay_group',                 -- list: กลุ่มพนักงานที่ลูกค้าตั้งเอง
                  'payroll_entity','payroll_pay_account','payroll_sso_account',
                  'payroll_wht_account','payroll_hours_per_day','payroll_rounding'));

-- ── เลขพนักงาน ───────────────────────────────────────────────────────────────
create or replace function next_emp_id() returns text
language sql set search_path = public as $$
  select 'EMP-' || lpad(next_serial('EMP')::text, 4, '0');
$$;

-- ============================================================================
-- fn_post_payroll — ส่งรายจ่ายของงวดเข้าบัญชี (3 ขาแยกอิสระ)
--
-- โมเดล 3 ขา (ยกมาจากระบบเดิมที่ใช้จริงมาแล้ว — เข้ากับ cash basis พอดี):
--   NET  1 tx ต่อคน   วันจ่ายเงินเดือน   = ยอดสุทธิรายคน
--   SSO  1 tx รวม     วันนำส่ง          = เงินสมทบลูกจ้าง + นายจ้าง
--   WHT  1 tx รวม     วันนำส่ง          = ภาษีหัก ณ ที่จ่ายรวมทั้งงวด
-- → รวมทั้งปี = ยอดเต็ม + สมทบนายจ้าง พอดี **ไม่นับซ้ำ** และไม่ต้องมีบัญชีหนี้สิน
--   (ถ้า post ยอดเต็มตอนจ่ายเงินเดือน แล้วมา post ยอดนำส่งอีก = นับซ้ำส่วนที่หักไว้)
--
-- 🚨 ต้องเป็น SECURITY DEFINER — ไม่ใช่ INVOKER อย่างที่เดาไว้ตอนออกแบบ
--   `integration_log` **ไม่มี write policy เลย** (0028: "เขียนผ่าน RPC security definer เท่านั้น")
--   → invoker จะ insert idempotency ไม่ผ่านตั้งแต่บรรทัดแรก · fn_* ทุกตัวใน repo เป็น definer ด้วยเหตุนี้
--   ⚠️ definer = ข้าม RLS → **ทุก statement ต้องพ่วง tenant_id = v_tenant ด้วยมือ ห้ามลืมแม้บรรทัดเดียว**
--      (ลืมตอน select = อ่านงวดของลูกค้าเจ้าอื่น · ลืมตอน update = ทับข้อมูลเขา)
-- ★ เงินคำนวณที่ lib/payroll แล้วส่งค่าเข้ามาเก็บ — ฟังก์ชันนี้ไม่คำนวณเงินเอง
--   (กฎเดียวกับ 0013: money ทุกตัวมาจาก lib)
-- ============================================================================
create or replace function fn_post_payroll(
  p_period_id text,
  p_kind      text,      -- 'NET' | 'SSO' | 'WHT'
  p_date      date,
  p_payload   jsonb      -- { entityId, accountName, category, contactName, description, amount,
                         --   lines:[{empId, contactName, description, amount}] }  (lines เฉพาะ NET)
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_dup boolean := false;
  v_period payroll_periods%rowtype;
  v_state jsonb;
  v_tx_id text;
  v_tx_ids text[] := '{}';
  ln jsonb;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if my_role() <> 'main' then raise exception 'ไม่มีสิทธิ์ลงบัญชีเงินเดือน'; end if;
  if p_kind not in ('NET','SSO','WHT') then raise exception 'ประเภทการลงบัญชีไม่ถูกต้อง: %', p_kind; end if;
  if p_date is null then raise exception 'ต้องระบุวันที่ลงบัญชี'; end if;

  select * into v_period from payroll_periods
   where tenant_id = v_tenant and period_id = p_period_id;   -- ★ กันแตะงวดของลูกค้าเจ้าอื่น
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบงวด ' || p_period_id); end if;

  v_state := coalesce(v_period.post_state, '{}'::jsonb);
  if v_state ? lower(p_kind) then
    return jsonb_build_object('ok', false, 'error', 'งวดนี้ลงบัญชีส่วนนี้ไปแล้ว — ต้องถอนก่อนถึงจะลงใหม่ได้');
  end if;

  -- idempotency: insert ก่อนแล้วจับ unique_violation (ปลอดภัยกับ race — แพตเทิร์นจาก 0029)
  begin
    insert into integration_log(tenant_id, action, idempotency_key, status, message, payload)
    values (v_tenant, 'POST_PAYROLL_' || p_kind, p_period_id || '-' || p_kind, 'ok',
            'ลงบัญชีเงินเดือน ' || p_period_id || ' (' || p_kind || ')', p_payload);
  exception when unique_violation then
    v_dup := true;
  end;

  if not v_dup then
    if p_kind = 'NET' then
      -- 1 tx ต่อคน → ตามยอดขึ้นบัญชีรายคน ตรวจกับสลิปได้ทีละใบ
      for ln in select value from jsonb_array_elements(coalesce(p_payload->'lines','[]'::jsonb)) loop
        if coalesce((ln->>'amount')::numeric, 0) <> 0 then
          v_tx_id := next_tx_id();
          insert into transactions(
            tenant_id, tx_id, transaction_date, type, account_name, category, contact_name,
            description, base_amount, amount_after_discount, net_amount,
            status, entity_id, payment_date, idempotency_key, source
          ) values (
            v_tenant, v_tx_id, p_date, 'รายจ่าย',
            nullif(p_payload->>'accountName',''), p_payload->>'category', ln->>'contactName',
            ln->>'description',
            (ln->>'amount')::numeric, (ln->>'amount')::numeric, (ln->>'amount')::numeric,
            'ปกติ', p_payload->>'entityId', p_date,
            p_period_id || '-NET-' || (ln->>'empId'), 'payroll'
          );
          v_tx_ids := v_tx_ids || v_tx_id;
          update payroll_items set tx_id = v_tx_id
           where tenant_id = v_tenant and period_id = p_period_id and emp_id = ln->>'empId';
        end if;
      end loop;
    else
      -- SSO / WHT → 1 tx รวมทั้งงวด (นำส่งเป็นก้อนเดียวอยู่แล้ว)
      if coalesce((p_payload->>'amount')::numeric, 0) = 0 then
        return jsonb_build_object('ok', false, 'error', 'ยอดเป็นศูนย์ ไม่ต้องลงบัญชี');
      end if;
      v_tx_id := next_tx_id();
      insert into transactions(
        tenant_id, tx_id, transaction_date, type, account_name, category, contact_name,
        description, base_amount, amount_after_discount, net_amount,
        status, entity_id, payment_date, idempotency_key, source
      ) values (
        v_tenant, v_tx_id, p_date, 'รายจ่าย',
        nullif(p_payload->>'accountName',''), p_payload->>'category', p_payload->>'contactName',
        p_payload->>'description',
        (p_payload->>'amount')::numeric, (p_payload->>'amount')::numeric, (p_payload->>'amount')::numeric,
        'ปกติ', p_payload->>'entityId', p_date,
        p_period_id || '-' || p_kind, 'payroll'
      );
      v_tx_ids := array[v_tx_id];
    end if;

    v_state := v_state || jsonb_build_object(
      lower(p_kind), jsonb_build_object('txIds', to_jsonb(v_tx_ids), 'date', p_date)
    );
    update payroll_periods set
      post_state = v_state,
      status = case when (v_state ? 'net') and (v_state ? 'sso') and (v_state ? 'wht')
                    then 'posted' else 'partial' end
     where tenant_id = v_tenant and period_id = p_period_id;
  end if;

  return jsonb_build_object('ok', true, 'duplicate', v_dup, 'tx_ids', to_jsonb(v_tx_ids));
end $$;

-- ============================================================================
-- fn_unpost_payroll — ถอนการลงบัญชีของขาหนึ่ง
--
-- 🚨 **soft-void ไม่ใช่ลบ** — ระบบเดิมใน GAS ใช้ deleteRow() ลบแถวจริงในชีต
--    ที่นี่ transactions.status มีแค่ 'ปกติ'/'ยกเลิก' และกติกาเหล็กห้าม hard delete
--    ทุกกรณี (ต้องตรวจย้อนหลังได้ว่าเคยลงอะไรแล้วถอนเมื่อไหร่ — audit จับให้เอง)
-- ★ ปลด integration_log เป็น 'duplicate' เพื่อให้ post ใหม่ได้ (แพตเทิร์นจาก fn_cancel_order)
-- ============================================================================
create or replace function fn_unpost_payroll(p_period_id text, p_kind text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_state jsonb;
  v_ids jsonb;
  v_n int := 0;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if my_role() <> 'main' then raise exception 'ไม่มีสิทธิ์ถอนการลงบัญชีเงินเดือน'; end if;

  select post_state into v_state from payroll_periods
   where tenant_id = v_tenant and period_id = p_period_id;
  if v_state is null then return jsonb_build_object('ok', false, 'error', 'ไม่พบงวด ' || p_period_id); end if;
  if not (v_state ? lower(p_kind)) then
    return jsonb_build_object('ok', false, 'error', 'ส่วนนี้ยังไม่ได้ลงบัญชี');
  end if;

  v_ids := v_state -> lower(p_kind) -> 'txIds';
  update transactions set status = 'ยกเลิก'
   where tenant_id = v_tenant
     and tx_id in (select jsonb_array_elements_text(coalesce(v_ids, '[]'::jsonb)));
  get diagnostics v_n = row_count;

  update integration_log set status = 'duplicate', message = 'ถอนการลงบัญชีเงินเดือน'
   where tenant_id = v_tenant and action = 'POST_PAYROLL_' || p_kind
     and idempotency_key = p_period_id || '-' || p_kind and status = 'ok';

  if p_kind = 'NET' then
    update payroll_items set tx_id = null
     where tenant_id = v_tenant and period_id = p_period_id;
  end if;

  v_state := v_state - lower(p_kind);
  update payroll_periods set
    post_state = v_state,
    status = case when v_state = '{}'::jsonb then 'draft' else 'partial' end
   where tenant_id = v_tenant and period_id = p_period_id;

  return jsonb_build_object('ok', true, 'voided', v_n);
end $$;

notify pgrst, 'reload schema';
