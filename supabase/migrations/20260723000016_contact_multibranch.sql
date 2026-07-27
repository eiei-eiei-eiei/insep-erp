-- ============================================================================
-- 0016 คู่ค้าหลายสาขา (multi-branch) — ตาม feedback ผู้ใช้ Phase 5 (D30)
--   ลูกค้ารายเดียว (เลขภาษีเดียว) มีหลายสาขา ต้องออกเอกสารแยกสาขา
--   ระบบเดิมผูกด้วย "ชื่อ" → ชื่อซ้ำไม่ได้ + ภพ.30/50ทวิ ได้สาขามั่ว (บั๊กเดิม)
--   แก้: identity = contact_id · transaction เก็บ contact_id ระบุสาขาที่แน่นอน
-- ============================================================================

-- คลาย unique index: จากชื่ออย่างเดียว → (ชื่อ + สาขา) เพื่อให้ชื่อซ้ำต่างสาขาได้
-- (ยังกันซ้ำจริง = ชื่อเดียวกัน+สาขาเดียวกัน)
drop index if exists contacts_name_norm;
create unique index if not exists contacts_name_branch_norm
  on contacts (lower(trim(name)), coalesce(lower(trim(branch)), ''));

-- transaction อ้างสาขาที่แน่นอนด้วย contact_id (null = ข้อมูลเก่า/ยังไม่ระบุ → fallback ชื่อ)
alter table transactions add column if not exists contact_id text references contacts(contact_id);
create index if not exists tx_contact_id on transactions (contact_id) where contact_id is not null;
