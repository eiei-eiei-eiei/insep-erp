-- ============================================================================
-- cleanup_test.sql — ลบข้อมูลทดสอบทั้งหมดในทีเดียว (ทั้ง seed + ที่คีย์เองระหว่างเทส)
--   เงื่อนไข marker: entity EID99 · master id 'T-%' · product_name '%ทดสอบ%'
--
--   ⚠️ วิธีใช้: Supabase → SQL Editor → วางทั้งไฟล์ → **แก้ v_slug บรรทัดแรกของบล็อก** → Run
--
--   🚨 ลบเฉพาะ tenant ที่ระบุใน v_slug เท่านั้น (D136)
--      รุ่นก่อนไม่มีตัวกรอง tenant เลยสักบรรทัด — SQL Editor เป็น role postgres ไม่มี RLS
--      ⇒ รันบนก้อน proof-app (ที่มีลูกค้าจริงอยู่ด้วย) = ลบค่าตั้งของ**ทุกลูกค้า**
--      (เช่น `sales_revenue_*` / `pos_walkin_contact` / `bar_*` ทั้งชุด) โดยไม่มีอะไรฟ้อง
--   🚨 ทุกคำสั่ง delete ต้องมี `tenant_id = v_tenant` รวมถึงใน subquery
--      (`lib/shared/cleanupSql.test.ts` อ่านไฟล์นี้มาตรวจ — เพิ่มบรรทัดใหม่แล้วลืม = test แดง)
--   ★ ค่าเริ่มต้นของ v_slug เป็นข้อความที่ไม่มีอยู่จริง → ลืมแก้ = error ทันที ไม่ลบอะไรเลย
-- ============================================================================

do $$
declare
  v_slug   text := '<<ใส่ slug ของ tenant ทดสอบ เช่น siamdist>>';   -- ← แก้ตรงนี้
  v_tenant uuid;
  v_plat   boolean;
begin
  select id, is_platform into v_tenant, v_plat from tenants where slug = v_slug;
  if v_tenant is null then
    raise exception 'ไม่พบ tenant "%" — แก้ v_slug บรรทัดแรกของบล็อกให้เป็น slug ของ tenant ทดสอบก่อน', v_slug;
  end if;
  if v_plat then
    raise exception 'tenant "%" เป็น tenant ของแพลตฟอร์ม — ห้ามใช้สคริปต์นี้', v_slug;
  end if;

  -- 1) log ผลิต (ลบ log_product ก่อน — trigger จะปรับ stock ให้ แล้วเราลบ stock ทีหลังอยู่ดี)
  delete from log_material        where tenant_id = v_tenant and material_id like 'T-%';
  delete from log_product         where tenant_id = v_tenant and product_id like 'T-%';
  delete from log_ferment         where tenant_id = v_tenant and product_name like '%ทดสอบ%';
  delete from log_distill         where tenant_id = v_tenant and product_name like '%ทดสอบ%';
  delete from log_dilute          where tenant_id = v_tenant and product_name like '%ทดสอบ%';
  delete from log_ferment_draw    where tenant_id = v_tenant and product_name like '%ทดสอบ%';   -- D78 สุราแช่
  -- D94 กลั่นซ้ำ — ★ ต้องมาก่อน log_dilute/log_material ไม่ได้ (ไม่มี FK ถึงกัน) แต่ต้องมี
  --    ไม่งั้นล็อตทดสอบค้างถาวร · รอบถูกลบตาม on delete cascade
  delete from log_redistill       where tenant_id = v_tenant and product_name like '%ทดสอบ%';
  delete from log_ferment_monitor where tenant_id = v_tenant and product_name like '%ทดสอบ%';
  delete from log_distill_run     where tenant_id = v_tenant and product_name like '%ทดสอบ%';
  delete from stock_product       where tenant_id = v_tenant and product_id like 'T-%';

  -- 2) log เชื่อมระบบ + audit ที่อ้างข้อมูลทดสอบ
  delete from integration_log where tenant_id = v_tenant
    and (coalesce(payload::text, '') like '%T-PROD%' or coalesce(payload::text, '') like '%ทดสอบ%');
  delete from edit_log where tenant_id = v_tenant and (
       coalesce(after::text, '')  like any (array['%T-PROD%','%T-MAT%','%T-CON%','%ทดสอบ%','%EID99%'])
    or coalesce(before::text, '') like any (array['%T-PROD%','%T-MAT%','%T-CON%','%ทดสอบ%','%EID99%']));

  -- 2.5) ขาย (Phase 4): items→orders ก่อน contacts (FK) · warehouse/stock_moves · config
  delete from sales_order_items where tenant_id = v_tenant and qu_no in (
    select qu_no from sales_orders where tenant_id = v_tenant and (customer_id like 'T-%' or customer_name like '%ทดสอบ%'));
  delete from integration_log where tenant_id = v_tenant and (
       idempotency_key in (select order_no from sales_orders where tenant_id = v_tenant and customer_id like 'T-%')
    or idempotency_key in (select order_no || '-balance' from sales_orders where tenant_id = v_tenant and customer_id like 'T-%'));
  delete from sales_orders    where tenant_id = v_tenant and (customer_id like 'T-%' or customer_name like '%ทดสอบ%');
  delete from stock_moves     where tenant_id = v_tenant and (item_code like 'T-%' or remarks like '%ทดสอบ%');
  delete from warehouse_stock where tenant_id = v_tenant and item_code like 'T-%';
  delete from app_settings    where tenant_id = v_tenant
    and kind in ('sales_revenue_entity','sales_revenue_account','sales_doc_entity','pos_walkin_contact');

  -- 3) บัญชี (Phase 3): certs/summaries/report_runs + items ก่อน transactions (กัน FK)
  delete from tax_payments     where tenant_id = v_tenant and entity_id = 'EID99';   -- D88 ชำระภาษี (ต้องมาก่อน transactions)
  delete from wht_certificates where tenant_id = v_tenant and entity_id = 'EID99';
  delete from tax_summaries    where tenant_id = v_tenant and entity_id = 'EID99';
  delete from report_runs      where tenant_id = v_tenant and entity_id = 'EID99';
  -- D119 สำรองจ่าย: บิลที่เกิดจากการเคลียอยู่ใน **กิจการปลายทาง** (ไม่ใช่ EID99) → ตามด้วย advance_src_tx
  --   🪤 ถ้าไม่ลบ บิลรายจ่ายทดสอบจะค้างในกิจการจริง แล้วโผล่ใน ภพ.30 ของกิจการนั้น
  --   🪤 ต้องตามทั้งบิล seed (T-ADV-%) และบิลสำรองจ่ายที่คีย์เองจากหน้าจอใน EID99 (เลข TR- ปกติ)
  delete from transaction_items where tenant_id = v_tenant and tx_id in (
    select tx_id from transactions where tenant_id = v_tenant and (
         advance_src_tx like 'T-ADV-%'
      or advance_src_tx in (select tx_id from transactions where tenant_id = v_tenant and entity_id = 'EID99')));
  delete from transactions where tenant_id = v_tenant and (
       advance_src_tx like 'T-ADV-%'
    or advance_src_tx in (select tx_id from transactions where tenant_id = v_tenant and entity_id = 'EID99'));
  -- D132 — บิลสำรองจ่ายในกิจการอื่นที่ "สำรองจ่ายให้ EID99" (ยังไม่เคลีย) อ้าง EID99 ผ่าน advance_for_entity
  --   🪤 ไม่ลบ = ลบ entities EID99 ตอนท้ายไม่ผ่าน (FK)
  delete from transaction_items where tenant_id = v_tenant and tx_id in (
    select tx_id from transactions where tenant_id = v_tenant and (entity_id = 'EID99' or advance_for_entity = 'EID99'));
  delete from transactions     where tenant_id = v_tenant and (entity_id = 'EID99' or advance_for_entity = 'EID99');
  delete from bank_accounts    where tenant_id = v_tenant and account_name like '%ทดสอบ%';
  delete from app_settings     where tenant_id = v_tenant and value like '%ทดสอบ%';
  delete from contacts         where tenant_id = v_tenant and (name like '%ทดสอบ%' or contact_id like 'T-C%');

  -- 4) master + กิจการทดสอบ
  -- 🪤 เมนูที่ตั้งใจไม่ผูก product_id (seed_pos ข้อ ③) ต้องลบด้วยชื่อ ไม่งั้นค้างถาวร
  -- 2.7) บาร์/POS (D96) — ลูกก่อนแม่: sale_item→sale · fav/recipe→menu,item · menu→category,customer
  --      ★ ไม่ผูกกับ EID99 — seed_bar ลงที่กิจการไหนก็ได้ marker คือ id ขึ้นต้น 'T-'
  --      🚨 ต้องลบ bar_move/bar_receive ด้วย ไม่งั้น FK ของ bar_item ค้าง
  -- 🚨 **ห้ามลบด้วย `sale_no like 'B%'`** — บิลบาร์จริง**ทุกใบ**ขึ้นต้นด้วย B
  --    ต้องหาบิลทดสอบจาก "มีรายการที่อ้างเมนูทดสอบ" หรือ "ผูกลูกค้าทดสอบ" เท่านั้น
  create temp table if not exists _t_bar_sales on commit drop as
    select distinct sale_no from bar_sale_item where tenant_id = v_tenant and menu_id like 'T-%';
  insert into _t_bar_sales
    select sale_no from bar_sale
     where tenant_id = v_tenant
       and (tab_name like '%ทดสอบ%' or customer_id like 'T-%')
       and sale_no not in (select sale_no from _t_bar_sales);

  delete from bar_sale_item where tenant_id = v_tenant and sale_no in (select sale_no from _t_bar_sales);
  delete from bar_sale      where tenant_id = v_tenant and sale_no in (select sale_no from _t_bar_sales);
  -- ⚠️ **ไม่ลบ `bar_post` ที่นี่โดยตั้งใจ** — แถวนั้นผูกกับบิลใน `transactions` ที่สร้างไว้จริง
  --    ลบแถวตรง ๆ = บิลบัญชีค้างอยู่โดยไม่มีอะไรชี้ถึง (เงินหลอนอยู่ในระบบ)
  --    ที่ถูกคือกด **ถอนการลงบัญชี** ในแท็บแดชบอร์ดก่อน ซึ่ง soft-void ทั้งสองฝั่งให้
  delete from bar_move         where tenant_id = v_tenant and item_id like 'T-%';
  delete from bar_receive      where tenant_id = v_tenant and item_id like 'T-%';
  delete from bar_customer_fav where tenant_id = v_tenant and (customer_id like 'T-%' or menu_id like 'T-%');
  -- ★ D127 — ช่องเหล้าประจำบ้าน/ชุดตกแต่งที่สร้างจากหน้าจอได้ id 'HS-'/'GN-' (ไม่ใช่ T-)
  --    จึงจับด้วย "ชี้วัตถุดิบทดสอบ" หรือ "ชื่อมีคำว่า ทดสอบ" · 🚨 ต้องลบก่อน bar_item (FK restrict)
  --    และลบบรรทัดสูตรที่อ้างช่องพวกนั้นก่อนตัวช่อง (FK restrict)
  delete from bar_recipe_slot  where tenant_id = v_tenant and (menu_id like 'T-%'
     or slot_id in (select slot_id from bar_house_slot where tenant_id = v_tenant and (item_id like 'T-%' or name like '%ทดสอบ%')));
  delete from bar_house_slot   where tenant_id = v_tenant and (item_id like 'T-%' or name like '%ทดสอบ%');
  -- ★ D131 — บรรทัดสูตรที่อ้างชุดตกแต่งทดสอบ (FK restrict) ต้องลบก่อนตัวชุด
  delete from bar_recipe_garnish where tenant_id = v_tenant and (menu_id like 'T-%'
     or garnish_id in (select garnish_id from bar_garnish where tenant_id = v_tenant and (item_id like 'T-%' or name like '%ทดสอบ%')));
  delete from bar_garnish      where tenant_id = v_tenant and (item_id like 'T-%' or name like '%ทดสอบ%');
  -- ★ D129 — ห้องทดลอง: รายการที่แตะวัตถุดิบ/เมนูทดสอบ หรือสูตร/งานที่ชื่อมี "ทดสอบ" (บรรทัด cascade ตามรายการ)
  delete from bar_lab_use where tenant_id = v_tenant and (
       use_id in (select use_id from bar_lab_use_line where tenant_id = v_tenant and (item_id like 'T-%' or menu_id like 'T-%'))
    or recipe_id in (select recipe_id from bar_lab_recipe where tenant_id = v_tenant and name like '%ทดสอบ%')
    or event_name like '%ทดสอบ%');
  delete from bar_lab_recipe   where tenant_id = v_tenant and name like '%ทดสอบ%';
  delete from bar_lab_category where tenant_id = v_tenant and name like '%ทดสอบ%' and not is_system;
  -- ★ D130 — ของทำเอง: ตัวของทำเองได้ id 'I-…' (ไม่ใช่ T-) จึงจับด้วยชื่อที่มี "ทดสอบ"
  --    ลบล็อต/สูตร/ความเคลื่อนไหว/ราคารับของ ของมันก่อน แล้วค่อยลบตัววัตถุดิบ (FK restrict)
  create temp table if not exists _t_bar_prep on commit drop as
    select p.item_id from bar_prep p
      join bar_item i on i.tenant_id = p.tenant_id and i.entity_id = p.entity_id and i.item_id = p.item_id
     where p.tenant_id = v_tenant and i.name like '%ทดสอบ%';
  delete from bar_prep_batch where tenant_id = v_tenant and (item_id in (select item_id from _t_bar_prep)
     or batch_id in (select batch_id from bar_prep_batch_line where tenant_id = v_tenant and input_item_id like 'T-%'));
  delete from bar_prep_input where tenant_id = v_tenant and input_item_id like 'T-%';
  delete from bar_prep       where tenant_id = v_tenant and item_id in (select item_id from _t_bar_prep);
  delete from bar_move       where tenant_id = v_tenant and item_id in (select item_id from _t_bar_prep);
  delete from bar_receive    where tenant_id = v_tenant and item_id in (select item_id from _t_bar_prep);
  delete from bar_item       where tenant_id = v_tenant and item_id in (select item_id from _t_bar_prep);
  delete from bar_recipe       where tenant_id = v_tenant and (menu_id like 'T-%' or item_id like 'T-%');
  delete from bar_menu         where tenant_id = v_tenant and (menu_id like 'T-%' or name like '%ทดสอบ%');
  -- 🪤 D136 — FK ของ bar_menu.created_for / bar_sale.customer_id เป็น `on delete set null` แบบ composite
  --    ⇒ Postgres ตั้ง tenant_id เป็น null ด้วย แล้วชน not null (ลบลูกค้าที่เคยมีบิล/มีเมนูสร้างให้ไม่ได้)
  --    ล้างการอ้างอิงเองก่อน — สคริปต์นี้ต้องใช้ได้ทั้งก่อนและหลังลง migration ที่แก้ FK
  --    ★ D137: 0095 แก้ FK เป็น `set null (created_for)` / `set null (customer_id)` แล้ว
  --      ⇒ หลังลง 0095 สองบรรทัดนี้ไม่จำเป็น (FK ทำเอง) แต่**เก็บไว้** ให้ DB ที่ยังไม่ลง 0095 ใช้ได้
  --      ผลเหมือนกันทุกประการ (ล้างแค่ช่องลูกค้า · บิล/เมนูยังอยู่) ⇒ รันซ้ำบน DB ไหนก็ไม่ต่าง
  update bar_menu set created_for = null where tenant_id = v_tenant and created_for in (
    select customer_id from bar_customer where tenant_id = v_tenant and (customer_id like 'T-%' or name like '%ทดสอบ%'));
  update bar_sale set customer_id = null where tenant_id = v_tenant and customer_id in (
    select customer_id from bar_customer where tenant_id = v_tenant and (customer_id like 'T-%' or name like '%ทดสอบ%'));
  delete from bar_customer     where tenant_id = v_tenant and (customer_id like 'T-%' or name like '%ทดสอบ%');
  delete from bar_item         where tenant_id = v_tenant and item_id like 'T-%';
  delete from bar_category     where tenant_id = v_tenant and category_id like 'T-%';
  delete from app_settings     where tenant_id = v_tenant and kind like 'bar\_%';

  delete from sale_menu   where tenant_id = v_tenant and (product_id like 'T-%' or menu_name like '%ทดสอบ%');
  delete from products    where tenant_id = v_tenant and product_id like 'T-%';
  delete from materials   where tenant_id = v_tenant and material_id like 'T-%';
  delete from containers  where tenant_id = v_tenant and container_id like 'T-%';
  delete from entities    where tenant_id = v_tenant and entity_id = 'EID99';

  raise notice 'ลบข้อมูลทดสอบของ tenant % เรียบร้อย', v_slug;
end $$;

select 'ลบข้อมูลทดสอบเรียบร้อย (เฉพาะ tenant ที่ระบุใน v_slug)' as result;
