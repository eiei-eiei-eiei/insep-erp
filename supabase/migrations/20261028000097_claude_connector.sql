-- ============================================================================
-- 0097 Claude connector — ส่งรูปบิลในแชท Claude แล้วลงบัญชีผ่าน MCP (D141)
--
-- ที่มา: ผู้ใช้อยากถ่ายรูปบิลส่งในแอป Claude มือถือ แล้วให้ลงบัญชีให้ (ใช้เองก่อน ·
--   เผื่อรับลงบิลให้ลูกค้าทีหลัง → เปิด connector ไว้ทั้ง 2 DB ตั้งแต่แรก)
--   endpoint อยู่ที่ app/api/mcp (env CLAUDE_CONNECTOR=1) · token มาจาก Supabase OAuth 2.1 server
--   ⇒ token เป็นของผู้ใช้คนนั้นจริง ⇒ RLS/my_tenant() เดิมทำงานต่อโดยไม่ต้องแก้ policy สักตัว
--
-- ไฟล์นี้มี 2 เรื่อง:
--   1. ตาราง connector_users — ใครใช้ connector ได้ (ตารางแพลตฟอร์ม · จัดการที่หน้า /platform)
--      🚨 เปิด OAuth ไว้ทั้งก้อนลูกค้า ⇒ ไม่มีตารางนี้ = ผู้ใช้ลูกค้าคนไหนมี Claude Pro ก็ต่อเข้ามาได้
--   2. fn_edit_transaction รู้จัก source 'claude' (บิลที่ Claude บันทึก ย้ายกิจการได้เหมือนบิลคีย์มือ · D132)
--
-- ★ ไม่แตะสูตรเงิน · ไม่แตะ fn_save_transaction (รับ p->>'source' ได้อยู่แล้ว ไม่มี CHECK)
-- ★ ตารางใหม่ 1 ตัว → grant ในไฟล์นี้ (D118) · definer ใหม่ 1 ตัว อ่านอย่างเดียว (D99 หมวด readonly)
-- ★ สร้างด้วย scripts/gen/gen-0097.mjs — ห้ามพิมพ์มือ (D79)
-- ============================================================================

-- ── 1. ใครใช้ Claude connector ได้ ─────────────────────────────────────────────
--    🚨 ตารางแพลตฟอร์ม: RLS deny-all (ไม่มี policy) + revoke จาก anon/authenticated
--       เขียนได้เฉพาะหน้า /platform (service role) · ลูกค้าห้ามให้สิทธิ์กันเอง
--    ★ ไม่มี tenant_id — ผูกกับผู้ใช้ (ผู้ใช้ 1 คนอยู่ tenant เดียวเสมอ · profiles.tenant_id)
--    ★ granted_by ไม่ใส่ FK โดยตั้งใจ (ลบบัญชีแอดมินแล้วประวัติต้องยังอยู่ · แพตเทิร์น platform_admin_log)
create table if not exists connector_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid,
  note text,
  created_at timestamptz not null default now()
);

alter table connector_users enable row level security;
-- ⛔ จงใจไม่มี policy — ห้ามเพิ่ม policy ให้ตารางนี้เด็ดขาด
revoke all on table public.connector_users from anon, authenticated;
grant select, insert, update, delete on table public.connector_users to service_role;

comment on table connector_users is
  'ผู้ใช้ที่ต่อ Claude connector (app/api/mcp) ได้ — RLS deny-all เขียนได้เฉพาะ service role (หน้า /platform) '
  '⚠️ ห้ามเพิ่ม policy: ลูกค้าเขียนได้เมื่อไหร่ = ให้สิทธิ์ตัวเองใช้ connector ได้';

-- ── ตัวฉันใช้ connector ได้ไหม ─────────────────────────────────────────────────
--    endpoint ถามทุกครั้งที่เรียกเครื่องมือ (ไม่ใช่ครั้งเดียวตอนล็อกอิน) ⇒ ถอนสิทธิ์แล้วหยุดทันที
--    แม้ token ที่ Claude ถืออยู่ยังไม่หมดอายุ
--    🚨 ต้องเช็คการระงับลูกค้าด้วย: การระงับบังคับที่ app/(app)/layout.tsx ไม่ใช่ RLS (D59)
--       และ connector ไม่ผ่าน layout ⇒ ไม่เช็คตรงนี้ = ลูกค้าค้างค่างวดยังบันทึกบิลผ่าน Claude ได้
--    ★ must_change_password: ยังไม่ได้ตั้งรหัสเอง (รหัสชั่วคราวจากแอดมิน) = ยังไม่ให้ใช้
--    ★ definer เพราะ connector_users ปิดสนิท · อ่านอย่างเดียว · ตอบได้แค่เรื่องของ auth.uid() เอง
create or replace function connector_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from connector_users c
      join profiles p on p.id = c.user_id
      join tenants t on t.id = p.tenant_id
     where c.user_id = auth.uid()
       and t.is_active
       and not t.is_platform
       and not p.must_change_password
  );
$$;

revoke execute on function connector_allowed() from public, anon;
grant execute on function connector_allowed() to authenticated, service_role;

-- ── 2. บิลจาก Claude ย้ายกิจการได้ (D132) ──────────────────────────────────────
-- fn_edit_transaction — ยกจาก 20261026000094_edit_tx_entity.sql คำต่อคำ + 'claude' ในรายชื่อ source ที่ย้ายกิจการได้
-- 🚨 ต้องตรงกับ MOVABLE_SOURCES ใน lib/accounting/entityMove.ts (entityMove.test.ts อ่านไฟล์นี้มาเทียบ)
-- ★ ลายเซ็นเดิม → create or replace ได้ ไม่ต้อง drop · ยังเป็น invoker
create or replace function fn_edit_transaction(
  p_tx_id text,
  p jsonb,            -- ฟิลด์ transaction (ค่าเงินคำนวณจาก entryCalc ฝั่ง client แล้ว)
  p_items jsonb default '[]'::jsonb
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_group text;
  v_transfer text;
  it jsonb;
  idx int := 0;
  n int;
  -- D132: ย้ายกิจการ
  v_tenant uuid;
  v_old_entity text;
  v_new_entity text;
  v_source text;
  v_type text;
  v_adv_for text;
  v_adv_clear text;
  v_adv_src text;
  v_wht text;
begin
  select po_group_id, transfer_id,
         tenant_id, entity_id, source, type, advance_for_entity, advance_clear_id, advance_src_tx
    into v_group, v_transfer,
         v_tenant, v_old_entity, v_source, v_type, v_adv_for, v_adv_clear, v_adv_src
    from transactions where tx_id = p_tx_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ไม่พบรายการ ' || p_tx_id);
  end if;
  if v_group is not null or v_transfer is not null then
    return jsonb_build_object('ok', false,
      'error', 'บิลนี้เป็นกลุ่มงวด/โอนระหว่างบัญชี — แก้ไม่ได้ ให้ยกเลิกแล้วสร้างใหม่');
  end if;

  -- ── D132: ย้ายกิจการ — ด่านเหล่านี้ทำงานเฉพาะตอนเปลี่ยนกิจการจริง ─────────────
  -- 🚨 เงื่อนไขต้องตรงกับ entityMoveBlock()/entityMoveError() ใน lib/accounting/entityMove.ts
  v_new_entity := coalesce(nullif(p->>'entity_id',''), v_old_entity);
  if v_new_entity <> v_old_entity then
    if not exists (select 1 from entities where tenant_id = v_tenant and entity_id = v_new_entity) then
      return jsonb_build_object('ok', false, 'error', 'ไม่พบกิจการ ' || v_new_entity);
    end if;
    if v_adv_clear is not null or v_adv_src is not null then
      return jsonb_build_object('ok', false,
        'error', 'บิลที่เกิดจากการเคลียสำรองจ่าย ย้ายกิจการไม่ได้ — ใช้ปุ่ม ถอนการเคลีย ในแท็บ ลูกหนี้-เจ้าหนี้');
    end if;
    if coalesce(v_source, 'ui') not in ('ui', 'migration', 'claude') then
      return jsonb_build_object('ok', false,
        'error', 'บิลนี้ระบบสร้างให้อัตโนมัติ (' || v_source || ') — ย้ายกิจการจากหน้าแก้บิลไม่ได้ ให้แก้ที่ต้นทาง');
    end if;
    select string_agg(doc_no, ', ' order by doc_no) into v_wht
      from wht_certificates where tenant_id = v_tenant and p_tx_id = any(tx_ids);
    if v_wht is not null then
      return jsonb_build_object('ok', false,
        'error', 'บิลนี้ออกใบ 50ทวิ ไปแล้ว (' || v_wht || ') ในนามกิจการเดิม — ย้ายกิจการไม่ได้ ให้ยกเลิกบิลแล้วบันทึกใหม่ในกิจการที่ถูก');
    end if;
    if v_type = 'สำรองจ่าย' and v_adv_for = v_new_entity then
      return jsonb_build_object('ok', false,
        'error', 'บิลนี้สำรองจ่ายให้ ' || v_new_entity || ' อยู่แล้ว — ย้ายไปเป็นของกิจการนั้นเองไม่ได้ ให้ยกเลิกแล้วบันทึกใหม่เป็นรายจ่าย');
    end if;
  end if;

  update transactions set
    transaction_date     = _d(p,'transaction_date'),
    type                 = p->>'type',
    account_name         = nullif(p->>'account_name',''),
    category             = p->>'category',
    contact_name         = p->>'contact_name',
    contact_id           = nullif(p->>'contact_id',''),
    description          = p->>'description',
    base_amount          = coalesce((p->>'base_amount')::numeric,0),
    discount             = coalesce((p->>'discount')::numeric,0),
    amount_after_discount= coalesce((p->>'amount_after_discount')::numeric,0),
    vat_amount           = coalesce((p->>'vat_amount')::numeric,0),
    wht_rate             = coalesce((p->>'wht_rate')::numeric,0),
    wht_amount           = coalesce((p->>'wht_amount')::numeric,0),
    net_amount           = coalesce((p->>'net_amount')::numeric,0),
    tax_invoice_no       = nullif(p->>'tax_invoice_no',''),
    tax_invoice_date     = _d(p,'tax_invoice_date'),
    entity_id            = coalesce(nullif(p->>'entity_id',''), entity_id)
  where tx_id = p_tx_id;

  -- แทนที่ items ทั้งหมดของบิลนี้ (ลบเก่า → insert ใหม่ ด้วย id เดิม pattern {txId}-NN)
  delete from transaction_items where tx_id = p_tx_id;
  for it in select value from jsonb_array_elements(p_items) loop
    idx := idx + 1;
    insert into transaction_items(
      item_id, tx_id, item_name, quantity, in_vat, ex_vat, total_price,
      discount_pct, discount_baht, item_category, item_job
    ) values (
      p_tx_id || '-' || lpad(idx::text,2,'0'), p_tx_id, it->>'item_name',
      coalesce((it->>'quantity')::numeric,1), coalesce((it->>'in_vat')::numeric,0),
      coalesce((it->>'ex_vat')::numeric,0), coalesce((it->>'total_price')::numeric,0),
      coalesce((it->>'discount_pct')::numeric,0), coalesce((it->>'discount_baht')::numeric,0),
      nullif(it->>'item_category',''), nullif(it->>'item_job','')
    );
  end loop;

  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'tx_id', p_tx_id, 'items', idx);
end $$;

notify pgrst, 'reload schema';
