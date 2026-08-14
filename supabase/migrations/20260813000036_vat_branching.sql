-- ============================================================================
-- 0036 VAT branching — บล็อกกิจการที่ไม่จด VAT ที่ระดับฐานข้อมูล (NEXT_STEPS 4.3)
--
--   `entities.is_vat` มีคอลัมน์มาตั้งแต่ 0001 แต่ไม่มีโค้ดไหนใช้เลย →
--   กิจการที่ไม่ได้จดทะเบียน VAT ยังถูกคิด VAT 7% และ **ออกใบกำกับภาษีได้**
--
--   🚨 ผู้ไม่จดทะเบียน VAT ออกใบกำกับภาษี = ความผิดตามประมวลรัษฎากร ม.86/13
--      (โทษอาญา + เบี้ยปรับ) → **ห้ามกันแค่ที่หน้าจอ** เพราะ anon key เป็นค่าสาธารณะ
--      ยิง PostgREST ตรงข้ามหน้าเว็บได้ · ต้องกันที่ DB เท่านั้นถึงจะเรียกว่ากันจริง
--
--   ใช้ trigger ไม่ใช่แก้ตัว RPC เพราะ trigger ครอบ**ทุกทางเข้า**พร้อมกัน:
--   แอป · RPC · สคริปต์ service role · PostgREST ตรง
--
--   ★ ไม่มี backfill ในไฟล์นี้ → ไม่ติดกับดัก D50 (migration ที่ backfill ต้องปิด user trigger)
--   ★ ตรวจข้อมูลจริงก่อนเขียนแล้ว: EID02 (is_vat=false) มี 0 บิล → ไม่มีข้อมูลเก่าที่ผิดกฎใหม่
-- ============================================================================

-- ── กิจการนี้จด VAT ไหม ──────────────────────────────────────────────────────
--    stable + security definer ตาม pattern ของ my_tenant()/my_role() (NEXT_STEPS 4.8)
--    → ประเมินครั้งเดียวต่อ query ไม่ใช่ต่อแถว
--    ไม่พบกิจการ = ถือว่าจด VAT (true) — fail-open โดยตั้งใจ เพราะ trigger นี้เป็นด่านห้าม
--    ไม่ใช่ด่านอนุญาต · ข้อมูลเก่าที่ยังไม่มี entity ต้องไม่ถูกบล็อกจนบันทึกอะไรไม่ได้
create or replace function entity_is_vat(p_tenant uuid, p_entity text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select e.is_vat from entities e
      where e.tenant_id = p_tenant and e.entity_id = p_entity),
    true
  );
$$;

comment on function entity_is_vat(uuid, text) is
  'กิจการนี้จดทะเบียน VAT ไหม — ใช้โดย trigger ที่กันการคิด VAT/ออกใบกำกับภาษีของผู้ไม่จด';

-- ── 1. ห้ามบันทึกรายการที่มี VAT ให้กิจการที่ไม่จด VAT ────────────────────────
create or replace function trg_block_vat_non_vat_entity() returns trigger
language plpgsql as $$
begin
  if coalesce(new.vat_amount, 0) > 0
     and not entity_is_vat(new.tenant_id, new.entity_id) then
    raise exception
      'กิจการ % ไม่ได้จดทะเบียน VAT จึงบันทึกรายการที่มี VAT ไม่ได้ (ยอด VAT ที่ส่งมา: %)',
      new.entity_id, new.vat_amount
      using hint = 'ถ้ากิจการนี้จด VAT แล้ว ให้แก้ entities.is_vat เป็น true ก่อน';
  end if;
  return new;
end $$;

drop trigger if exists block_vat_non_vat_entity on transactions;
create trigger block_vat_non_vat_entity
  before insert or update on transactions
  for each row execute function trg_block_vat_non_vat_entity();

-- ── 2. ห้ามออกเลขใบกำกับภาษีให้ออเดอร์ของกิจการที่ไม่จด VAT ───────────────────
--    ★ เช็คเฉพาะตอน "ค่าเปลี่ยน" (is distinct from old) — ไม่งั้นแถวเก่าที่มีเลขอยู่แล้ว
--      จะอัปเดตอะไรไม่ได้อีกเลย (เช่นเปลี่ยนสถานะออเดอร์ก็โดนบล็อก)
create or replace function trg_block_tax_invoice_non_vat() returns trigger
language plpgsql as $$
declare
  v_new_tax1 boolean := new.tax_no1 is not null
    and (tg_op = 'INSERT' or new.tax_no1 is distinct from old.tax_no1);
  v_new_tax2 boolean := new.tax_no2 is not null
    and (tg_op = 'INSERT' or new.tax_no2 is distinct from old.tax_no2);
begin
  if (v_new_tax1 or v_new_tax2)
     and not entity_is_vat(new.tenant_id, new.entity_id) then
    raise exception
      'กิจการ % ไม่ได้จดทะเบียน VAT จึงออกใบกำกับภาษีไม่ได้ (ผิด ประมวลรัษฎากร ม.86/13)',
      new.entity_id
      using hint = 'ผู้ไม่จด VAT ออกได้แค่ใบแจ้งหนี้ / ใบส่งสินค้า / ใบเสร็จรับเงิน';
  end if;
  return new;
end $$;

drop trigger if exists block_tax_invoice_non_vat on sales_orders;
create trigger block_tax_invoice_non_vat
  before insert or update on sales_orders
  for each row execute function trg_block_tax_invoice_non_vat();

notify pgrst, 'reload schema';
