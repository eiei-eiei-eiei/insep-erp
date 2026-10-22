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
-- ยกจาก 20260824000046_fix_forward_material.sql
create or replace function fn_save_transaction(
  p jsonb,
  p_items jsonb default '[]'::jsonb
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_tx_id text := next_tx_id();
  it jsonb;
  idx int := 0;
  fwd_items jsonb;
  fwd jsonb;
  warning text := null;
begin
  insert into transactions(
    tx_id, transaction_date, type, account_name, category, contact_name, contact_id, description,
    base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
    tax_invoice_no, tax_invoice_date, receipt_image_url, status, entity_id,
    ap_ar_status, due_date, source,
    advance_for_entity
  ) values (
    v_tx_id, _d(p,'transaction_date'), p->>'type', nullif(p->>'account_name',''), p->>'category',
    p->>'contact_name', nullif(p->>'contact_id',''), p->>'description',
    coalesce((p->>'base_amount')::numeric,0), coalesce((p->>'discount')::numeric,0),
    coalesce((p->>'amount_after_discount')::numeric,0), coalesce((p->>'vat_amount')::numeric,0),
    coalesce((p->>'wht_rate')::numeric,0), coalesce((p->>'wht_amount')::numeric,0),
    coalesce((p->>'net_amount')::numeric,0),
    nullif(p->>'tax_invoice_no',''), _d(p,'tax_invoice_date'), nullif(p->>'receipt_image_url',''),
    coalesce(nullif(p->>'status',''),'ปกติ'), p->>'entity_id',
    nullif(p->>'ap_ar_status',''), _d(p,'due_date'), coalesce(nullif(p->>'source',''),'ui'),
    -- D119: สำรองจ่ายให้กิจการไหน (advance_status ตั้งโดย trigger advance_guard)
    case when p->>'type' = 'สำรองจ่าย' then nullif(p->>'advance_for_entity','') end
  );

  for it in select value from jsonb_array_elements(p_items) loop
    idx := idx + 1;
    insert into transaction_items(
      item_id, tx_id, item_name, quantity, in_vat, ex_vat, total_price,
      discount_pct, discount_baht, item_category, item_job
    ) values (
      v_tx_id || '-' || lpad(idx::text,2,'0'), v_tx_id, it->>'item_name',
      coalesce((it->>'quantity')::numeric,1), coalesce((it->>'in_vat')::numeric,0),
      coalesce((it->>'ex_vat')::numeric,0), coalesce((it->>'total_price')::numeric,0),
      coalesce((it->>'discount_pct')::numeric,0), coalesce((it->>'discount_baht')::numeric,0),
      nullif(it->>'item_category',''), nullif(it->>'item_job','')
    );
  end loop;

  -- T6: forward ต้นทุนสุรา → รับวัตถุดิบเข้าสต็อกผลิต (idempotency = tx_id)
  -- คง "พฤติกรรม warning เดิม": forward พลาด → บัญชียัง commit + คืน warning (ไม่ roll back)
  -- 🚨 ทุกบรรทัดของ forward ต้องอยู่ **ใน** begin/exception นี้ รวมทั้งการประกอบ fwd_items
  --    (บั๊กเดิม: select ประกอบ items อยู่ข้างนอก → error หลุดออกไปล้มทั้งบิล)
  if coalesce((p->>'forward_material')::boolean,false)
     and jsonb_array_length(coalesce(p_items,'[]'::jsonb)) > 0 then
    begin
      -- 🪤 alias ต้องไม่ชื่อซ้ำกับตัวแปร plpgsql (`it`) ไม่งั้น 42702 ambiguous
      -- 🪤 ข้ามแถวที่ไม่ได้กรอกชื่อ (buildItemInputs ปล่อยแถวที่มีแต่ราคาผ่านมาได้)
      --    ไม่งั้นชื่อว่าง 1 แถวล้ม forward ทั้งใบ
      select coalesce(jsonb_agg(jsonb_build_object(
               'material_name', row_it.value ->> 'item_name',
               'amount', coalesce((row_it.value ->> 'quantity')::numeric, 0))), '[]'::jsonb)
        into fwd_items
        from jsonb_array_elements(p_items) as row_it
        where nullif(trim(coalesce(row_it.value ->> 'item_name', '')), '') is not null;

      fwd := fn_receive_material(
        v_tx_id, _d(p,'transaction_date'),
        case when coalesce(p->>'tax_invoice_no','') <> '' and p->>'tax_invoice_no' <> '-'
             then p->>'tax_invoice_no' else v_tx_id end,
        'รับจาก ' || coalesce(nullif(p->>'contact_name',''),'ไม่ระบุชื่อ') ||
          case when coalesce(p->>'description','') <> '' then ' (' || (p->>'description') || ')' else '' end,
        fwd_items,
        nullif(p->>'entity_id',''));
    exception when others then
      warning := 'บันทึกบัญชีสำเร็จ แต่รับวัตถุดิบเข้าสต็อกผลิตไม่ได้: ' || sqlerrm ||
                 ' — ตรวจชื่อวัตถุดิบ/เพิ่มใน master แล้วบันทึกรับเองในแอปผลิต';
    end;
  end if;

  return jsonb_build_object('ok', true, 'tx_id', v_tx_id, 'warning', warning);
end $$;

-- ── 5. fn_clear_advances — เคลีย (บริษัทโอนคืน) ─────────────────────────────────
-- เลือกได้หลายบิล แต่ต้อง "คนจ่ายเดียวกัน + ซื้อให้กิจการเดียวกัน" (เงินคืนเป็นรายการเดียว)
-- สร้าง: บิลรายจ่ายของกิจการปลายทาง 1 ใบต่อบิลสำรองจ่าย (ภพ.30 ต้องแยกผู้ขายรายใบ)
--        + รับคืนเข้าบัญชีคนจ่าย 1 รายการ = ผลรวม
-- ★ บิลของบริษัทลงวันที่ "วันเคลีย" — วันที่บริษัทจ่ายเงินจริง (cash basis) ⇒ ภาษีซื้อเข้าเดือนนั้น
--   วันที่ใบกำกับคงตามใบจริง · เตือนที่หน้าจอเมื่อเกิน 6 เดือน (lib/accounting/advance.ts)
-- ★ INVOKER — RLS คุมว่าผู้เรียกต้องเห็นทั้งกิจการคนจ่ายและกิจการปลายทาง
create or replace function fn_clear_advances(
  p_tx_ids text[], p_pay_account text, p_refund_account text default null, p_date date default null
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_date date := coalesce(p_date, fn_today_th());
  v_ids text[] := array(select distinct unnest(coalesce(p_tx_ids, '{}'::text[])));
  v_n int;
  v_payer text; v_target text; v_refund text;
  v_bad text;
  v_clear text;
  v_new text;
  v_refund_tx text;
  v_total numeric := 0;
  v_bills text[] := '{}';
  v_target_name text;
  r record;
begin
  if not has_cap('acct.write') then
    return jsonb_build_object('ok', false, 'error', 'สิทธิ์ไม่พอ — ต้องบันทึกบัญชีได้จึงจะเคลียสำรองจ่ายได้');
  end if;
  if v_tenant is null then return jsonb_build_object('ok', false, 'error', 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'); end if;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'เลือกบิลสำรองจ่ายอย่างน้อย 1 ใบ');
  end if;

  -- ล็อกแถวกันกดเคลียซ้ำพร้อมกันสองหน้าต่าง
  perform 1 from transactions where tenant_id = v_tenant and tx_id = any(v_ids) for update;

  select count(*) into v_n from transactions where tenant_id = v_tenant and tx_id = any(v_ids);
  if v_n <> array_length(v_ids, 1) then
    return jsonb_build_object('ok', false, 'error', 'ไม่พบบิลบางใบ (อาจถูกลบหรือไม่มีสิทธิ์เห็น) — รีเฟรชแล้วลองใหม่');
  end if;

  select string_agg(tx_id, ', ') into v_bad from transactions
   where tenant_id = v_tenant and tx_id = any(v_ids)
     and not (type = 'สำรองจ่าย' and status = 'ปกติ' and advance_status = 'รอเบิกคืน');
  if v_bad is not null then
    return jsonb_build_object('ok', false, 'error', 'บิลเหล่านี้ไม่ได้อยู่ในสถานะรอเบิกคืน: ' || v_bad || ' — รีเฟรชแล้วลองใหม่');
  end if;

  select min(entity_id), min(advance_for_entity) into v_payer, v_target
    from transactions where tenant_id = v_tenant and tx_id = any(v_ids);
  if exists (select 1 from transactions where tenant_id = v_tenant and tx_id = any(v_ids)
              and (entity_id <> v_payer or advance_for_entity <> v_target)) then
    return jsonb_build_object('ok', false, 'error',
      'เคลียพร้อมกันได้เฉพาะบิลที่จ่ายโดยกิจการเดียวกันและซื้อให้กิจการเดียวกัน');
  end if;

  if exists (select 1 from transactions where tenant_id = v_tenant and tx_id = any(v_ids)
              and transaction_date > v_date) then
    return jsonb_build_object('ok', false, 'error', 'วันที่เคลียต้องไม่ก่อนวันที่สำรองจ่าย');
  end if;

  -- บัญชีที่บริษัทจ่ายคืน ต้องเป็นบัญชีของกิจการปลายทาง (หรือบัญชีที่ใช้ร่วมทุกกิจการ)
  if coalesce(trim(p_pay_account), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'เลือกบัญชีที่ใช้จ่ายคืน');
  end if;
  if not exists (select 1 from bank_accounts where tenant_id = v_tenant and account_name = p_pay_account
                  and (coalesce(array_length(entity_ids, 1), 0) = 0 or v_target = any(entity_ids))) then
    return jsonb_build_object('ok', false, 'error',
      'บัญชี ' || p_pay_account || ' ไม่ใช่บัญชีของกิจการ ' || v_target);
  end if;

  -- บัญชีรับเงินคืน: ไม่ระบุ = บัญชีที่จ่ายออกไป (ถ้าทุกใบจ่ายจากบัญชีเดียวกัน)
  v_refund := nullif(trim(coalesce(p_refund_account, '')), '');
  if v_refund is null then
    select min(account_name) into v_refund from transactions where tenant_id = v_tenant and tx_id = any(v_ids)
      having count(distinct account_name) = 1;
    if v_refund is null then
      return jsonb_build_object('ok', false, 'error', 'บิลที่เลือกจ่ายจากหลายบัญชี — เลือกบัญชีที่รับเงินคืน');
    end if;
  end if;
  if not exists (select 1 from bank_accounts where tenant_id = v_tenant and account_name = v_refund
                  and (coalesce(array_length(entity_ids, 1), 0) = 0 or v_payer = any(entity_ids))) then
    return jsonb_build_object('ok', false, 'error',
      'บัญชี ' || v_refund || ' ไม่ใช่บัญชีของกิจการ ' || v_payer);
  end if;

  perform set_config('app.advance_rpc', '1', true);

  v_clear := 'ADV-' || to_char(fn_today_th(), 'YYYYMMDD') || '-' ||
             lpad(next_serial('ADV-' || to_char(fn_today_th(), 'YYYYMMDD'))::text, 4, '0');

  for r in select * from transactions where tenant_id = v_tenant and tx_id = any(v_ids)
            order by transaction_date, tx_id loop
    v_new := next_tx_id();
    insert into transactions(
      tenant_id, tx_id, transaction_date, type, account_name, category, contact_name, contact_id, description,
      base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,
      tax_invoice_no, tax_invoice_date, receipt_image_url, status, entity_id, payment_date, source,
      advance_clear_id, advance_src_tx
    ) values (
      v_tenant, v_new, v_date, 'รายจ่าย', p_pay_account, r.category, r.contact_name, r.contact_id, r.description,
      r.base_amount, r.discount, r.amount_after_discount, r.vat_amount, r.wht_rate, r.wht_amount, r.net_amount,
      r.tax_invoice_no, r.tax_invoice_date, r.receipt_image_url, 'ปกติ', v_target, v_date, 'advance',
      v_clear, r.tx_id
    );
    insert into transaction_items(
      tenant_id, item_id, tx_id, item_name, quantity, in_vat, ex_vat, total_price,
      discount_pct, discount_baht, item_category, item_job
    )
    select v_tenant, v_new || '-' || lpad((row_number() over (order by item_id))::text, 2, '0'), v_new,
           item_name, quantity, in_vat, ex_vat, total_price, discount_pct, discount_baht, item_category, item_job
      from transaction_items where tenant_id = v_tenant and tx_id = r.tx_id;

    update transactions set advance_status = 'เคลียแล้ว', advance_clear_id = v_clear
     where tenant_id = v_tenant and tx_id = r.tx_id;

    v_total := v_total + coalesce(r.net_amount, 0);
    v_bills := v_bills || v_new;
  end loop;

  select name into v_target_name from entities where tenant_id = v_tenant and entity_id = v_target;
  v_refund_tx := next_tx_id();
  insert into transactions(
    tenant_id, tx_id, transaction_date, type, account_name, category, contact_name, description,
    net_amount, status, entity_id, payment_date, source, advance_clear_id
  ) values (
    v_tenant, v_refund_tx, v_date, 'รับคืนสำรองจ่าย', v_refund, 'รับคืนสำรองจ่าย',
    coalesce(v_target_name, v_target),
    'รับคืนสำรองจ่าย ' || array_length(v_ids, 1) || ' ใบ จาก ' || coalesce(v_target_name, v_target) || ' (' || v_clear || ')',
    v_total, 'ปกติ', v_payer, v_date, 'advance', v_clear
  );

  return jsonb_build_object('ok', true, 'clear_id', v_clear, 'bills', to_jsonb(v_bills),
                            'refund_tx', v_refund_tx, 'total', v_total, 'count', array_length(v_ids, 1));
end $$;

-- ── 6. fn_unclear_advances — ถอนการเคลียทั้งชุด ──────────────────────────────
-- ยกเลิก (soft) บิลของบริษัท + รายการรับคืน · บิลสำรองจ่ายกลับเป็น "รอเบิกคืน"
-- 🚨 acct.config (ระดับหัวหน้า) — ย้อนค่าใช้จ่าย/ภาษีซื้อของเดือนที่อาจยื่น ภพ.30 ไปแล้ว (แพตเทิร์น D88)
-- 🚨 บล็อกถ้าออกใบ 50ทวิ จากบิลของบริษัทไปแล้ว — ใบนั้นอยู่ในมือคู่ค้า ถอนแล้วจะอ้างบิลที่ถูกยกเลิก
create or replace function fn_unclear_advances(p_clear_id text) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_bills text[];
  v_cert text;
  n_void int; n_back int;
begin
  if not has_cap('acct.config') then
    return jsonb_build_object('ok', false, 'error', 'สิทธิ์ไม่พอ — ถอนการเคลียได้เฉพาะหัวหน้าบัญชีขึ้นไป');
  end if;
  if coalesce(trim(p_clear_id), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'ไม่ได้ระบุการเคลียที่จะถอน');
  end if;

  perform 1 from transactions where tenant_id = v_tenant and advance_clear_id = p_clear_id for update;

  select array_agg(tx_id) into v_bills from transactions
   where tenant_id = v_tenant and advance_clear_id = p_clear_id and type = 'รายจ่าย' and status = 'ปกติ';
  select string_agg(doc_no, ', ') into v_cert from wht_certificates
   where tenant_id = v_tenant and tx_ids && coalesce(v_bills, '{}'::text[]);
  if v_cert is not null then
    return jsonb_build_object('ok', false, 'error',
      'ออกใบ 50 ทวิ จากบิลชุดนี้ไปแล้ว (' || v_cert || ') — ถอนการเคลียไม่ได้');
  end if;

  perform set_config('app.advance_rpc', '1', true);

  update transactions set status = 'ยกเลิก'
   where tenant_id = v_tenant and advance_clear_id = p_clear_id
     and type <> 'สำรองจ่าย' and status = 'ปกติ';
  get diagnostics n_void = row_count;

  update transactions set advance_status = 'รอเบิกคืน', advance_clear_id = null
   where tenant_id = v_tenant and advance_clear_id = p_clear_id and type = 'สำรองจ่าย';
  get diagnostics n_back = row_count;

  -- 🚨 row_count = 0 ต้องตอบ error ไทย ไม่ใช่ ok (บทเรียน D93)
  if n_back = 0 then
    return jsonb_build_object('ok', false, 'error', 'ไม่พบการเคลีย ' || p_clear_id || ' (อาจถูกถอนไปแล้ว) — รีเฟรชแล้วลองใหม่');
  end if;
  return jsonb_build_object('ok', true, 'voided', n_void, 'reopened', n_back);
end $$;

-- ── 7. fn_advance_to_personal — บริษัทไม่คืนเงิน ตัดเป็นค่าใช้จ่ายของคนจ่ายเอง ────
-- ★ ใบกำกับออกในนามกิจการที่ซื้อให้ ⇒ คนจ่ายขอคืนภาษีซื้อไม่ได้
--   VAT จึงกลายเป็นต้นทุน: ยอดหลังหักส่วนลด += VAT · VAT = 0 · ยอดสุทธิ (เงินที่จ่ายจริง) เท่าเดิม
-- ★ รายการสินค้าคงเดิม (ราคาต่อหน่วยไว้ดูย้อนหลัง) — เปิดแก้บิลแล้วจะเห็นเป็นโหมดแก้ยอดเอง
create or replace function fn_advance_to_personal(p_tx_id text) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  n int;
begin
  if not has_cap('acct.write') then
    return jsonb_build_object('ok', false, 'error', 'สิทธิ์ไม่พอ — ต้องบันทึกบัญชีได้');
  end if;
  perform set_config('app.advance_rpc', '1', true);
  update transactions set
    type = 'รายจ่าย',
    base_amount = base_amount + vat_amount,
    amount_after_discount = amount_after_discount + vat_amount,
    vat_amount = 0,
    advance_status = 'ตัดเป็นส่วนตัว'
  where tenant_id = v_tenant and tx_id = p_tx_id
    and type = 'สำรองจ่าย' and status = 'ปกติ' and advance_status = 'รอเบิกคืน';
  get diagnostics n = row_count;
  if n = 0 then
    return jsonb_build_object('ok', false, 'error', 'ไม่พบบิลสำรองจ่ายที่รอเบิกคืน ' || p_tx_id || ' — รีเฟรชแล้วลองใหม่');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- invoker ทั้งสามตัว — ปิด anon ไว้ด้วย (D99: revoke ต้องระบุ anon ตรง ๆ)
revoke execute on function fn_clear_advances(text[], text, text, date) from public, anon;
revoke execute on function fn_unclear_advances(text) from public, anon;
revoke execute on function fn_advance_to_personal(text) from public, anon;
grant execute on function fn_clear_advances(text[], text, text, date) to authenticated, service_role;
grant execute on function fn_unclear_advances(text) to authenticated, service_role;
grant execute on function fn_advance_to_personal(text) to authenticated, service_role;

notify pgrst, 'reload schema';
