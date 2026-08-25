-- ============================================================================
-- 0047 audit ข้อมูลหลัก + ทำให้ trg_audit ทำงานใต้ service role ได้ — D80
--
-- 🚨 อาการ: `edit_log` มี trigger ครบทุก log_* + transactions + sales_orders + employees
--    แต่ **ไม่มีบน master เลย** → แก้ `products.liquor_type` (ตัวตัดสินว่าออกฟอร์ม ภส. ใบไหน)
--    หรือ `entities.excise_id` (เลขบนหัวเอกสารราชการ) แล้ว **ไม่เหลือร่องรอยว่าใครแก้เมื่อไหร่**
--    ขัดกับกติกาใน CLAUDE.md เอง ("ทุกจุดที่ผู้ใช้บันทึกข้อมูลได้ ต้องมี … audit edit_log")
--
--    เจอตอนเทสใช้งานจริง: ค่า `bottle_size_l` ของสินค้าเปลี่ยนระหว่างเทสแล้ว **ตามไม่ได้เลย
--    ว่าใครแก้** (สรุปทีหลังว่าเจ้าของกิจการแก้เองอยู่อีกจอ — ซึ่ง audit จะบอกได้ทันที)
--
-- 🚨 ห้ามผูกกับ `app_settings` เด็ดขาด — เก็บ `line_channel_token` อยู่ ผูกแล้วค่าลับจะถูก
--    ก๊อปลง edit_log ซึ่งเป็นคนละชั้นสิทธิ์กับที่ 0033 ตั้งใจกันไว้
-- ============================================================================

-- ── 1. trg_audit: เอา tenant จาก "แถวที่ถูกแก้" ไม่ใช่จาก "คนที่ล็อกอิน" ────────
--
-- 🪤 ของเดิมปล่อยให้ `edit_log.tenant_id` ใช้ default `my_tenant()` ซึ่งคืน null เมื่อไม่มี
--    auth.uid() → พอผูก trigger เข้ากับ `entities` แล้ว `npm run provision:tenant`
--    (service role, ไม่มี auth.uid()) จะ **ล้มทันทีที่ insert entities** เพราะ tenant_id not null
--    = รับลูกค้าใหม่ไม่ได้เลย · ตระกูลเดียวกับ D50 และ apply_stock_delta ใน 0029
--
-- ★ ตรรกะ audit เดิมทุกบรรทัด เปลี่ยนแค่ "ระบุ tenant_id จากแถวเอง"
create or replace function trg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pk_col text := tg_argv[0];
  rec jsonb;
  v_tenant uuid;
begin
  if (tg_op = 'DELETE') then rec := to_jsonb(old); else rec := to_jsonb(new); end if;
  v_tenant := coalesce(nullif(rec ->> 'tenant_id', '')::uuid, my_tenant());
  if v_tenant is null then
    -- ไม่มี tenant ให้ผูก = เขียน audit ไม่ได้ · ยอมข้ามดีกว่าทำให้ตัวงานหลักล้ม
    return null;
  end if;
  insert into edit_log (tenant_id, table_name, row_pk, action, before, after, user_id)
  values (
    v_tenant,
    tg_table_name,
    rec ->> pk_col,
    lower(tg_op),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) end,
    auth.uid()
  );
  return null;  -- after trigger
end $$;

-- ── 2. ผูก audit เข้ากับข้อมูลหลัก ────────────────────────────────────────────
-- ★ ตารางที่มีผลกับ "เลขที่ยื่นราชการ" มาก่อน: products (ฟอร์ม ภส./ปริมาตร) ·
--   entities (หัวเอกสาร/เลขภาษี/เลขสรรพสามิต) · materials/containers (บัญชีวัตถุดิบ)
--   ตามด้วยคู่ค้า/บัญชีเงิน ที่ไปโผล่บนใบกำกับภาษีและงบ
drop trigger if exists audit_products      on products;
drop trigger if exists audit_materials     on materials;
drop trigger if exists audit_containers    on containers;
drop trigger if exists audit_entities      on entities;
drop trigger if exists audit_contacts      on contacts;
drop trigger if exists audit_bank_accounts on bank_accounts;

create trigger audit_products      after insert or update or delete on products
  for each row execute function trg_audit('product_id');
create trigger audit_materials     after insert or update or delete on materials
  for each row execute function trg_audit('material_id');
create trigger audit_containers    after insert or update or delete on containers
  for each row execute function trg_audit('container_id');
create trigger audit_entities      after insert or update or delete on entities
  for each row execute function trg_audit('entity_id');
create trigger audit_contacts      after insert or update or delete on contacts
  for each row execute function trg_audit('contact_id');
create trigger audit_bank_accounts after insert or update or delete on bank_accounts
  for each row execute function trg_audit('account_id');

-- ── 3. คอนฟิกเงินเดือน — เกณฑ์พวกนี้เปลี่ยนตัวเงินที่จ่ายจริง ต้องรู้ว่าใครแก้ ────
drop trigger if exists audit_pay_rates     on pay_rates;
drop trigger if exists audit_pay_inputs    on pay_inputs;
drop trigger if exists audit_pay_variables on pay_variables;
drop trigger if exists audit_pay_post_legs on pay_post_legs;

create trigger audit_pay_rates     after insert or update or delete on pay_rates
  for each row execute function trg_audit('effective_from');
create trigger audit_pay_inputs    after insert or update or delete on pay_inputs
  for each row execute function trg_audit('code');
create trigger audit_pay_variables after insert or update or delete on pay_variables
  for each row execute function trg_audit('code');
create trigger audit_pay_post_legs after insert or update or delete on pay_post_legs
  for each row execute function trg_audit('code');

notify pgrst, 'reload schema';
