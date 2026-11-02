-- ════════════════════════════════════════════════════════════════════════════
-- 0103 — เงินเดือน: สูตรวันทำงานตั้งเอง · ตัวกรองชนิดค่าจ้าง · จำค่าจากงวดก่อน (D152)
--
-- 1. สูตรวันทำงาน = แถวใน pay_variables ที่มี work_days_for
--    ★ ใช้ตารางเดิมเพราะวิธีคิดเหมือนตัวแปรทุกอย่าง (ตัวตั้ง + ขั้น) ไม่ต้องมีเครื่องคิดชุดที่สอง
--    แยกตามชนิดค่าจ้าง: รายเดือนเต็มไม่มีแถว เพราะเงินไม่ขึ้นกับวันทำงาน
-- 2. wage_per_day = ตัวตั้งใหม่ของตัวแปร · รายวันคือค่าแรงต่อวัน · รายเดือนคือฐาน ÷ วันมาตรฐาน
--    ตัวแปรตัวเดียวจึงใช้ได้ทุกชนิดค่าจ้าง ไม่หารวันซ้ำ
-- 3. pay_components.wage_types = ตัวกรองคู่กับ group_codes · ว่าง = ทุกชนิด (ค่าเดิมไม่ขยับ)
-- 4. pay_inputs.carry_forward = คัดลอกค่าของคนเดิมจากงวดล่าสุดตอนสร้างแถวใหม่ · ค่าปริยายปิด
-- ════════════════════════════════════════════════════════════════════════════

alter table pay_variables add column if not exists work_days_for text;

alter table pay_variables drop constraint if exists pay_variables_work_days_for_check;
alter table pay_variables add constraint pay_variables_work_days_for_check
  check (work_days_for in ('monthly_prorate','daily'));

create unique index if not exists pay_variables_work_days_for_uq
  on pay_variables (tenant_id, work_days_for)
  where work_days_for is not null;

comment on column pay_variables.work_days_for is
  'ไม่ว่าง = แถวนี้คือสูตรวันทำงานของชนิดค่าจ้างนั้น · ไม่ใช่ตัวแปรที่รายการเอาไปใช้';

alter table pay_variables drop constraint if exists pay_variables_source_check;
alter table pay_variables add constraint pay_variables_source_check
  check (source in ('base_wage','prorated_base','wage_per_day','work_days_std','work_days_actual',
                    'hours_per_day','input','constant'));

alter table pay_components add column if not exists wage_types text[] not null default '{}';

alter table pay_components drop constraint if exists pay_components_wage_types_check;
alter table pay_components add constraint pay_components_wage_types_check
  check (wage_types <@ array['monthly','monthly_prorate','daily']::text[]);

comment on column pay_components.wage_types is
  'ว่าง = ทุกชนิดค่าจ้าง · ใช้คู่กับ group_codes (ต้องผ่านทั้งสองด่าน)';

alter table pay_inputs add column if not exists carry_forward boolean not null default false;

comment on column pay_inputs.carry_forward is
  'true = ตอนสร้างแถวงวดใหม่ คัดลอกค่าของคนเดิมจากงวดล่าสุด · แก้งวดเก่าทีหลังไม่ตามมา';

-- ค่าเริ่มต้นเป็นแถวจริง ลูกค้าเห็นได้ว่าตั้งอะไรไว้ และให้ผลเท่าพฤติกรรมเดิม (วันทำงาน = วันมาตรฐาน)
insert into pay_variables (tenant_id, code, name, source, steps, work_days_for, sort)
select t.id, x.code, x.name, 'work_days_std', '[]'::jsonb, x.wage, 0
  from tenants t
 cross join (values
   ('workdays_prorate', 'วันทำงาน (รายเดือนลดตามวันมาทำงาน)', 'monthly_prorate'),
   ('workdays_daily',   'วันทำงาน (รายวัน)',                 'daily')
 ) as x(code, name, wage)
on conflict do nothing;
