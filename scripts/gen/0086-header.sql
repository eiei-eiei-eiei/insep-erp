-- ============================================================================
-- 0086 สำรองจ่าย — เจ้าของจ่ายเงินตัวเองแทนกิจการไปก่อน แล้วค่อยเบิกคืน (D119)
--
-- 🎯 โจทย์ของผู้ใช้ (ผู้ประกอบการคนเดียวที่มีทั้งบริษัทและเงินส่วนตัวในระบบเดียวกัน):
--    "ผมสำรองซื้อของให้บริษัทไป เงินออกจากบัญชีผม **ยังไม่ถือว่าบริษัทรู้ข้อมูลนี้**
--     อาจจะข้ามเดือนไปแล้ว ผมค่อยเอาบิลมาเคลียกับบริษัท บริษัทถึงโอนเงินให้ผม
--     แล้วเอาไปลงรายจ่ายต่อตามบิลที่ผมเอามาเบิก"
--
-- โฟลว์ 2 จังหวะ:
--   1) บันทึก type='สำรองจ่าย' ใน **กิจการของคนจ่าย** (ส่วนตัว) + advance_for_entity = กิจการที่ซื้อให้
--      · เงินออกจากบัญชีคนจ่ายทันที (ledger นับ)
--      · ไม่เข้าค่าใช้จ่าย/ภาษีของใครเลย — ทุกรายงานเลือกแถวด้วย type = 'รายรับ'/'รายจ่าย'
--        ตรง ๆ อยู่แล้ว (ไล่แล้ว: calc.ts ภพ.30/ภงด./แดชบอร์ด · cron เตือนภาษี) ⇒ ไม่ต้องแตะสูตร
--      · ★ กิจการที่ซื้อให้ **มองไม่เห็นบิลนี้** เพราะ RLS กรองด้วย entity_id = คนจ่าย
--        (ผู้ใช้ที่ถูกจำกัดให้เห็นแค่บริษัทจึงไม่เห็นจนกว่าจะเคลีย — ตรงกับ "บริษัทยังไม่รู้")
--   2) fn_clear_advances — บริษัทโอนคืน: สร้าง **บิลรายจ่ายของบริษัท** (ลงวันที่เคลีย
--      ⇒ ภาษีซื้อเข้า ภพ.30 เดือนที่บริษัทจ่ายจริง) + **รับคืนเข้าบัญชีคนจ่าย** 1 รายการ
--      ผลสุทธิ: บัญชีคนจ่ายกลับเท่าเดิม · บัญชีบริษัทลด · บริษัทมีค่าใช้จ่าย
--
-- 🚨 ไม่ใช้ ap_ar_status — ถ้าใช้ ระบบจะถือว่า "ยังไม่ได้จ่าย" แล้วตัดออกจากยอดเงินด้วย
--    ซึ่งผิด เงินออกจากบัญชีคนจ่ายไปแล้วจริง (ledger ข้ามแถวที่มี ap_ar_status เสมอ)
-- 🚨 ทุกจุดที่เปลี่ยนสถานะสำรองจ่าย ผ่าน RPC ในไฟล์นี้เท่านั้น — trigger trg_advance_guard
--    กันทางเข้าอื่น (แก้บิล · ยกเลิกบิล · ยิง API ตรง) ไม่ให้ทำสถานะครึ่ง ๆ กลาง ๆ
--    เช่น ยกเลิกบิลบริษัทใบเดียวแต่เงินรับคืนยังอยู่ = บัญชีส่วนตัวได้เงินฟรี
-- ★ ไม่มีตารางใหม่ (D118 ไม่ต้อง grant เพิ่ม) · ไม่มี security definer ใหม่ (D99)
-- ============================================================================

-- ── 1. คอลัมน์ ───────────────────────────────────────────────────────────────
alter table transactions
  add column if not exists advance_for_entity text,  -- สำรองจ่ายให้กิจการไหน
  add column if not exists advance_status text,      -- รอเบิกคืน / เคลียแล้ว / ตัดเป็นส่วนตัว
  add column if not exists advance_clear_id text,    -- 'ADV-yyyyMMdd-NNNN' ผูกทุกแถวของการเคลียครั้งเดียวกัน
  add column if not exists advance_src_tx text;      -- บนบิลของบริษัท: มาจากบิลสำรองจ่ายใบไหน

comment on column transactions.advance_for_entity is
  'type=สำรองจ่าย: กิจการที่ซื้อให้ (entity_id = กิจการของคนจ่าย) · หลังตัดเป็นส่วนตัวคงไว้เป็นประวัติ';
comment on column transactions.advance_clear_id is
  'การเคลียสำรองจ่ายครั้งเดียวกัน = บิลสำรองจ่าย + บิลรายจ่ายของกิจการปลายทาง + รายการรับคืน · ถอนทีเดียวทั้งชุด';

alter table transactions drop constraint if exists transactions_type_check;
alter table transactions add constraint transactions_type_check
  check (type in ('รายรับ','รายจ่าย','โอนระหว่างบัญชี','เช็คราคา','บันทึกภาษี','สำรองจ่าย','รับคืนสำรองจ่าย'));

alter table transactions drop constraint if exists transactions_advance_status_check;
alter table transactions add constraint transactions_advance_status_check
  check (advance_status in ('รอเบิกคืน','เคลียแล้ว','ตัดเป็นส่วนตัว'));

-- รูปร่างของแถวสำรองจ่าย
-- 🪤 ทุกเงื่อนไขต้อง coalesce — CHECK ที่ได้ค่า null ถือว่า "ผ่าน" (ไม่ใช่ตก)
-- ★ ข้อมูลเดิมผ่านหมด: ไม่มีแถว type สำรองจ่าย และ advance_status ของทุกแถวยังเป็น null
alter table transactions drop constraint if exists transactions_advance_shape;
alter table transactions add constraint transactions_advance_shape check (
  case
    when type = 'สำรองจ่าย' then
      coalesce(advance_status, '') in ('รอเบิกคืน','เคลียแล้ว')
      and coalesce(advance_for_entity, '') <> ''
      and advance_for_entity <> entity_id
      and ap_ar_status is null
      and coalesce(account_name, '') <> ''
      and (advance_status <> 'เคลียแล้ว' or advance_clear_id is not null)
    else advance_status is null or advance_status = 'ตัดเป็นส่วนตัว'
  end
);

alter table transactions drop constraint if exists transactions_advance_for_entity_fkey;
alter table transactions add constraint transactions_advance_for_entity_fkey
  foreign key (tenant_id, advance_for_entity) references entities (tenant_id, entity_id);

-- ★ ทุก index ขึ้นต้นด้วย tenant_id (กติกา 0025)
create index if not exists tx_advance_pending on transactions (tenant_id, entity_id)
  where advance_status = 'รอเบิกคืน';
create index if not exists tx_advance_clear on transactions (tenant_id, advance_clear_id)
  where advance_clear_id is not null;

-- ── 2. ด่าน VAT ของกิจการไม่จด VAT (0036) — บิลสำรองจ่ายต้องดูกิจการที่ซื้อให้ ───
-- 🪤 ใบกำกับภาษีของบิลสำรองจ่ายออกในนาม "กิจการที่ซื้อให้" ไม่ใช่คนจ่าย
--    ถ้ายังดู entity_id: (ก) เงินส่วนตัวที่ไม่จด VAT สำรองจ่ายบิลที่มี VAT ให้บริษัทไม่ได้เลย
--    (ข) กลับกัน คนจ่ายที่จด VAT จะบันทึก VAT ให้กิจการปลายทางที่ไม่จดได้ แล้วไปโผล่ตอนเคลีย
-- ★ create or replace = trigger เดิมเรียกตัวใหม่เลย ไม่ต้องสร้าง trigger ใหม่
create or replace function trg_block_vat_non_vat_entity() returns trigger
language plpgsql as $$
declare
  v_entity text := case when new.type = 'สำรองจ่าย'
                        then coalesce(new.advance_for_entity, new.entity_id)
                        else new.entity_id end;
begin
  if coalesce(new.vat_amount, 0) > 0
     and not entity_is_vat(new.tenant_id, v_entity) then
    raise exception
      'กิจการ % ไม่ได้จดทะเบียน VAT จึงบันทึกรายการที่มี VAT ไม่ได้ (ยอด VAT ที่ส่งมา: %)',
      v_entity, new.vat_amount
      using hint = 'ถ้ากิจการนี้จด VAT แล้ว ให้แก้ entities.is_vat เป็น true ก่อน';
  end if;
  return new;
end $$;

-- ── 3. ด่านกันสถานะสำรองจ่ายครึ่ง ๆ กลาง ๆ ─────────────────────────────────────
-- ผ่านได้เฉพาะ: (ก) service role / ไม่มี JWT (restore · import · SQL Editor ของเจ้าของ)
--               (ข) RPC ในไฟล์นี้ ที่ตั้งธง app.advance_rpc ไว้ใน transaction ของตัวเอง
-- ★ ไม่ใช่ด่านความปลอดภัย (ข้อมูลของ tenant ตัวเอง · RLS ยังคุมอยู่) — เป็นด่านความสอดคล้อง
--   ธงตั้งได้เฉพาะในฟังก์ชัน SQL · PostgREST ไม่เปิด set_config ให้เรียกเป็น RPC
create or replace function trg_advance_guard() returns trigger
language plpgsql as $$
begin
  if coalesce(auth.role(), '') in ('', 'service_role')
     or coalesce(current_setting('app.advance_rpc', true), '') = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.type = 'รับคืนสำรองจ่าย' or new.advance_clear_id is not null or new.advance_src_tx is not null
       or coalesce(new.advance_status, '') in ('เคลียแล้ว','ตัดเป็นส่วนตัว') then
      raise exception 'รายการรับคืนสำรองจ่าย/ผลของการเคลีย สร้างได้จากปุ่มเคลียในแท็บลูกหนี้-เจ้าหนี้เท่านั้น';
    end if;
    -- บิลสำรองจ่ายเกิดใหม่ = รอเบิกคืนเสมอ (ไม่ต้องให้ผู้เรียกส่งมา)
    if new.type = 'สำรองจ่าย' then new.advance_status := 'รอเบิกคืน'; end if;
    return new;
  end if;

  -- UPDATE
  if old.type is distinct from new.type
     and (old.type in ('สำรองจ่าย','รับคืนสำรองจ่าย') or new.type in ('สำรองจ่าย','รับคืนสำรองจ่าย')) then
    raise exception 'เปลี่ยนประเภทของบิลสำรองจ่ายตรง ๆ ไม่ได้ — ใช้ปุ่ม เคลีย หรือ ตัดเป็นค่าใช้จ่ายส่วนตัว ในแท็บลูกหนี้-เจ้าหนี้';
  end if;
  if new.advance_status is distinct from old.advance_status
     or new.advance_clear_id is distinct from old.advance_clear_id
     or new.advance_src_tx is distinct from old.advance_src_tx
     or new.advance_for_entity is distinct from old.advance_for_entity then
    raise exception 'ข้อมูลสำรองจ่ายแก้ได้จากแท็บลูกหนี้-เจ้าหนี้เท่านั้น';
  end if;
  if old.type = 'สำรองจ่าย' and old.advance_status = 'เคลียแล้ว' then
    raise exception 'บิลสำรองจ่าย % เคลียแล้ว — ถอนการเคลียก่อนจึงแก้หรือยกเลิกได้', old.tx_id;
  end if;
  if old.type = 'รับคืนสำรองจ่าย' then
    raise exception 'รายการรับคืนสำรองจ่าย % แก้หรือยกเลิกตรง ๆ ไม่ได้ — ใช้ปุ่ม ถอนการเคลีย ในแท็บลูกหนี้-เจ้าหนี้', old.tx_id;
  end if;
  -- บิลของบริษัทที่เกิดจากการเคลีย: แก้รายละเอียดได้ แต่ยกเลิกใบเดียวไม่ได้
  -- (ยกเลิกใบเดียว = บริษัทไม่มีค่าใช้จ่ายแล้ว แต่เงินรับคืนยังเข้าบัญชีคนจ่ายอยู่)
  if old.advance_clear_id is not null and old.status = 'ปกติ' and new.status = 'ยกเลิก' then
    raise exception 'รายการ % เกิดจากการเคลียสำรองจ่าย (%) — ยกเลิกทีละใบไม่ได้ ใช้ปุ่ม ถอนการเคลีย ในแท็บลูกหนี้-เจ้าหนี้',
      old.tx_id, old.advance_clear_id;
  end if;
  return new;
end $$;

drop trigger if exists advance_guard on transactions;
create trigger advance_guard
  before insert or update on transactions
  for each row execute function trg_advance_guard();

-- ── 4. fn_save_transaction — ยกจาก 0046 คำต่อคำ เติมแค่ advance_for_entity ─────
--    (สร้างด้วย scripts/gen/gen-0086.mjs — ห้ามพิมพ์มือ D79)
