-- ============================================================================
-- 0063 "ยื่นแล้ว" เป็นเหตุการณ์ของตัวเอง + วิธียื่นของกิจการ (D95)
--
-- 🔴 ต้นเรื่อง: D88 ถามผิดตาราง (ความผิดพลาดตัวเดียวกับที่ D90/D91 แก้ไปแล้วฝั่งสรรพสามิต)
--    การเตือนกำหนดยื่นภาษีถูกปิดเสียงด้วย `report_runs` ซึ่งเป็น **เช็กลิสต์ว่ากดพิมพ์แล้ว**
--    (comment ใน 0005 เขียนไว้เองว่า 'เดือนนี้สร้างครบยัง' · append-only)
--    ของจริง:
--      · กดสร้าง ภพ.30 กลางเดือนเพื่อ **ดูตัวเลข** = การเตือนงวดนั้นหายตลอดกาล
--      · เดือนที่ทุกอย่างเป็นศูนย์ยัง **ต้องยื่น ภพ.30** แต่ปุ่มจ่ายกดไม่ได้ (ไม่มียอด)
--        → ผูกการเตือนกับ "จ่ายแล้ว" ก็ไม่ได้เช่นกัน
--
-- 🪤 บทเรียนเดิมที่ยังไม่เคยตามมาเก็บฝั่งสรรพากร: **การ "พิมพ์" กับการ "ยื่น" เป็นคนละเหตุการณ์**
--    ตารางที่มีข้อมูลอยู่แล้วพอดี ไม่ได้แปลว่ามันตอบคำถามที่เรากำลังถาม
--
-- ★ ของใหม่ — ยกแพตเทิร์น `excise_month_close` (D91) มาทั้งดุ้น:
--    · ผู้ใช้ประกาศเองว่า "ยื่นแล้ว" ต่อแบบต่องวด · ถอนได้ (เติม reopened_at ไม่ลบแถว)
--    · **บันทึกจ่ายสำเร็จ = ติ๊กยื่นให้อัตโนมัติ** (จ่ายได้แปลว่ายื่นแล้ว)
--      🚨 **ไม่กลับกัน** — ติ๊กยื่นไม่ได้แปลว่าจ่ายแล้ว (เดือนยอดศูนย์ยื่นแต่ไม่ต้องจ่าย)
--    · 🚨 **`report_runs` ไม่ถูกแตะแม้บรรทัดเดียว** — ยังเป็นเช็กลิสต์ และยังเป็นเงื่อนไข
--      "ต้องสร้างแบบก่อนถึงจะจ่ายได้" ของ D88 เหมือนเดิมทุกประการ
--
-- ── backfill: ทำเฉพาะที่มีหลักฐานแน่นอน ──────────────────────────────────────
-- 🚨 backfill **เฉพาะงวดที่มีแถว `tax_payments` ที่ยังไม่ถูกถอน** = จ่ายไปแล้วจริง
--    (กฎ "จ่ายแล้ว = ยื่นแล้ว" ที่เพิ่งตกลงกัน) · **ไม่ backfill จาก `report_runs`**
--    เพราะนั่นแปลว่ากดพิมพ์เท่านั้น ซึ่งเป็นสาเหตุทั้งหมดของงานนี้
--    ผลที่ตามมาโดยตั้งใจ: งวดที่ยื่นแล้วแต่ไม่เคยจ่าย (ยอดศูนย์) จะถูกเตือนอีกครั้ง
--    จนกว่าผู้ใช้จะกดปุ่ม "ยื่นแล้ว" ครั้งแรก — ยอมรับได้ และเป็นการชี้ให้เห็นปุ่มใหม่ไปในตัว
--
-- ── entities.filing_method ───────────────────────────────────────────────────
-- D95 เพิ่มจังหวะเตือน "วันสุดท้าย" → ต้องรู้ว่าวันสุดท้าย *ของกิจการนี้* คือวันไหน
-- (ยื่นกระดาษ ภพ.30 = 15 · e-Filing = 23) · ไม่ตั้ง = ใช้กระดาษ แต่ข้อความบอกว่ายังไม่ตั้ง
-- 🚨 ใส่ CHECK ได้เพราะเป็นคอลัมน์ใหม่ (ทุกแถวเป็น null) — ต่างจากกรณี `products.liquor_type`
--    ของ D78 ที่มีข้อมูลเดิมอยู่แล้วจึงห้ามใส่ (db:push:all ลงทุก DB = ล้มทั้ง fleet)
-- ============================================================================

create table if not exists tax_filings (
  id          bigserial primary key,
  tenant_id   uuid not null default my_tenant(),
  entity_id   text not null,
  kind        text not null check (kind in ('vat','pnd3','pnd53')),
  period      text not null,                    -- 'yyyy-MM' = งวดภาษี
  filed_at    timestamptz not null default now(),   -- เวลาที่กดปุ่ม
  filed_on    date,                                 -- วันที่ยื่นจริง (ผู้ใช้กรอกได้)
  filed_by    uuid,
  -- 'manual' = ผู้ใช้กดเอง · 'pay' = ระบบติ๊กให้ตอนบันทึกจ่าย
  source      text not null default 'manual' check (source in ('manual','pay')),
  note        text,
  -- ★ ถอน = เติม 3 ช่องนี้ **ไม่ลบแถว** → ตอบได้ว่าใครติ๊ก ใครถอน เมื่อไร (แพตเทิร์น D91)
  reopened_at timestamptz,
  reopened_by uuid,
  reopen_note text
);

-- FK ไป tenants — ★ **ไม่ใส่ on delete cascade** ให้เหมือนตารางอื่นทั้งระบบ
-- 🪤 ใส่ cascade = ตกตารางใน fn_mig_truncate แล้วเงียบ (D79/D82 ถูกจับได้ด้วยกลไกนี้)
alter table tax_filings drop constraint if exists tax_filings_tenant_fk;
alter table tax_filings add constraint tax_filings_tenant_fk
  foreign key (tenant_id) references tenants(id);

alter table tax_filings drop constraint if exists tax_filings_entity_id_fkey;
alter table tax_filings add constraint tax_filings_entity_id_fkey
  foreign key (tenant_id, entity_id) references entities(tenant_id, entity_id);

-- 🚨 หัวใจของการกันติ๊กซ้อน: 1 กิจการ + 1 แบบ + 1 งวด ติ๊กที่ยังไม่ถูกถอนได้ครั้งเดียว
--    (แถวที่ถอนแล้วเหลือเป็นประวัติ และไม่กันการติ๊กรอบใหม่ — เหมือน tax_payments 0054)
create unique index if not exists tax_filing_one_active
  on tax_filings (tenant_id, entity_id, kind, period) where reopened_at is null;
create index if not exists tax_filing_lookup
  on tax_filings (tenant_id, entity_id, period, kind, reopened_at);

alter table tax_filings enable row level security;

-- อ่าน: acct.read + ขอบเขตกิจการของผู้ใช้
-- 🪤 **ไม่มี policy สำหรับเขียนโดยตั้งใจ** — เขียนผ่าน RPC (definer) เท่านั้น
--    เหตุผล: `for all` ครอบ SELECT ด้วย และ policy permissive ถูก OR กัน (บทเรียน D85/0052)
create policy tax_filing_sel on tax_filings for select
  using (tenant_id = my_tenant() and has_cap('acct.read')
         and (my_entities() is null or entity_id = any(my_entities())));

comment on table tax_filings is
  'ประกาศว่า "ยื่นแบบแล้ว" ต่อกิจการต่องวด (D95) — ตัวที่ปิดการเตือนเข้า LINE · '
  '🚨 อย่าเอา report_runs กลับมาทำหน้าที่นี้อีก (นั่นคือเช็กลิสต์ว่ากดพิมพ์แล้ว ไม่ใช่ตัวบอกว่ายื่น) · '
  'เขียนผ่าน fn_file_tax / fn_unfile_tax / fn_pay_tax เท่านั้น';

-- ── วิธียื่นแบบของกิจการ ─────────────────────────────────────────────────────
alter table entities add column if not exists filing_method text;
alter table entities drop constraint if exists entities_filing_method_check;
alter table entities add constraint entities_filing_method_check
  check (filing_method is null or filing_method in ('paper','efiling'));
comment on column entities.filing_method is
  'วิธียื่นแบบภาษีของกิจการนี้: paper = กระดาษ (ภพ.30 วันที่ 15) · efiling = ออนไลน์ (วันที่ 23) · '
  'null = ยังไม่ได้ตั้ง → ระบบใช้กำหนดของกระดาษ (เร็วกว่า) และบอกในข้อความเตือนว่ายังไม่ได้ตั้ง';

-- ── backfill จากการจ่ายที่บันทึกไว้แล้ว ──────────────────────────────────────
-- ★ `where not exists` แทน `on conflict` — อ่านง่ายกว่าและไม่ต้องอ้าง index predicate
insert into tax_filings (tenant_id, entity_id, kind, period, filed_at, filed_on, filed_by, source, note)
select tp.tenant_id, tp.entity_id, tp.kind, tp.period, tp.created_at, tp.pay_date, tp.created_by, 'pay',
       'เติมย้อนหลังตอนติดตั้ง D95 — งวดนี้มีการบันทึกจ่ายอยู่ จึงถือว่ายื่นแล้ว'
from tax_payments tp
where tp.status = 'ปกติ'
  and not exists (
    select 1 from tax_filings f
    where f.tenant_id = tp.tenant_id and f.entity_id = tp.entity_id
      and f.kind = tp.kind and f.period = tp.period and f.reopened_at is null
  );

-- ── fn_file_tax — ประกาศว่ายื่นแล้ว ──────────────────────────────────────────
--
-- 🚨 definer = bypass RLS → ต้องเช็ค cap **และ** ขอบเขตกิจการเอง (บทเรียน 0028→0029)
-- 🚨 **ไม่บังคับว่าต้องกดสร้างแบบก่อน** (ต่างจาก fn_pay_tax โดยตั้งใจ) — ผู้ใช้ส่วนใหญ่
--    กรอกในเว็บ e-Filing ของสรรพากรเอง (D69) ระบบจึงไม่มีสิทธิ์บอกว่า "คุณยังไม่ได้ยื่น"
--    เพียงเพราะไม่ได้กดพิมพ์ในแอป · หน้าจอเตือนอย่างเดียว ไม่บล็อก
create or replace function fn_file_tax(
  p_kind text, p_period text, p_entity text, p_filed_on date, p_note text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_id bigint;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if not has_cap('acct.write') then raise exception 'ไม่มีสิทธิ์บันทึกการยื่นแบบ'; end if;
  if p_kind not in ('vat','pnd3','pnd53') then raise exception 'ไม่รู้จักชนิดภาษี: %', p_kind; end if;
  if coalesce(p_entity,'') = '' then raise exception 'ต้องระบุกิจการ — แต่ละกิจการยื่นแยกใบ'; end if;
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'งวดต้องเป็นรูปแบบ yyyy-MM'; end if;
  if my_entities() is not null and not (p_entity = any(my_entities())) then
    raise exception 'ไม่มีสิทธิ์ในกิจการ %', p_entity;
  end if;

  -- 🚨 กิจการที่ไม่ได้จด VAT ไม่มีหน้าที่ยื่น ภพ.30 → บล็อกที่ DB ด้วย (กติกาเดียวกับ 0036/0054)
  if p_kind = 'vat' and not entity_is_vat(v_tenant, p_entity) then
    raise exception 'กิจการนี้ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม จึงไม่มี ภพ.30 ให้ยื่น';
  end if;

  begin
    insert into tax_filings(tenant_id, entity_id, kind, period, filed_on, filed_by, source, note)
    values (v_tenant, p_entity, p_kind, p_period, p_filed_on, auth.uid(), 'manual', nullif(p_note,''))
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'งวดนี้บันทึกว่ายื่นแล้ว — ถ้าต้องแก้ ให้ถอนการบันทึกยื่นก่อน');
  end;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ── fn_unfile_tax — ถอนการบันทึกยื่น ─────────────────────────────────────────
--
-- 🚨 ถอน = **acct.config** (หัวหน้าบัญชี/เจ้าของ) ไม่ใช่ acct.write — ถอนแล้วระบบ
--    กลับมาเตือนเข้ากลุ่ม LINE อีกครั้ง ซึ่งเป็นข้อความที่คนนอกฝ่ายบัญชีเห็นด้วย
-- 🚨 **ยังมีการจ่ายค้างอยู่ = ถอนไม่ได้** — จ่ายแล้วแปลว่ายื่นแล้ว ปล่อยให้สองค่านี้
--    ขัดกันเมื่อไหร่ = "ยื่นแล้ว" มีสองนิยามในระบบเดียว (ตระกูล D81/D88 ข้อ 1)
--    ★ และต้องบอกด้วยว่าต้องไปกดอะไรแทน (D83)
create or replace function fn_unfile_tax(p_kind text, p_period text, p_entity text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_n int := 0;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if not has_cap('acct.config') then
    raise exception 'ต้องมีสิทธิ์ตั้งค่าหน้าบัญชีถึงจะถอนการบันทึกยื่นได้';
  end if;
  if my_entities() is not null and not (p_entity = any(my_entities())) then
    raise exception 'ไม่มีสิทธิ์ในกิจการ %', p_entity;
  end if;

  if exists (select 1 from tax_payments
             where tenant_id = v_tenant and entity_id = p_entity
               and kind = p_kind and period = p_period and status = 'ปกติ') then
    return jsonb_build_object('ok', false,
      'error', 'งวดนี้ยังมีการบันทึกจ่ายอยู่ (จ่ายแล้ว = ยื่นแล้ว) — กด "ถอนการบันทึกจ่าย" ก่อน');
  end if;

  update tax_filings
     set reopened_at = now(), reopened_by = auth.uid(), reopen_note = nullif(p_note,'')
   where tenant_id = v_tenant and entity_id = p_entity
     and kind = p_kind and period = p_period and reopened_at is null;
  get diagnostics v_n = row_count;
  -- 🚨 ไม่มีแถวให้ถอน = ตอบ error ภาษาไทย ไม่ใช่ ok (บทเรียน D93/D94)
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'งวดนี้ยังไม่ได้บันทึกว่ายื่น');
  end if;

  return jsonb_build_object('ok', true);
end $$;

revoke execute on function fn_file_tax(text, text, text, date, text) from public;
grant  execute on function fn_file_tax(text, text, text, date, text) to authenticated;
revoke execute on function fn_unfile_tax(text, text, text, text) from public;
grant  execute on function fn_unfile_tax(text, text, text, text) to authenticated;

-- ── fn_pay_tax — ยกมาจาก 0054 ทั้งดุ้นด้วยสคริปต์ เติมเฉพาะบล็อก "ติ๊กยื่นให้เอง"
--    signature ไม่เปลี่ยน → create or replace ทับได้ ไม่เกิด overload (กับดัก D69)
-- ★ `fn_unpay_tax` **จงใจไม่แตะ** — ถอนการจ่าย (เช่น กรอกยอดผิด) ไม่ได้แปลว่าไม่ได้ยื่น
--   ถ้าจะถอนการยื่นด้วย ต้องกดปุ่มถอนยื่นอีกทีโดยเจตนา
