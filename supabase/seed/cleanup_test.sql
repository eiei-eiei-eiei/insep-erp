-- ============================================================================
-- cleanup_test.sql — ลบข้อมูลทดสอบทั้งหมดในทีเดียว (ทั้ง seed + ที่คีย์เองระหว่างเทส)
--   เงื่อนไข marker: entity EID99 · master id 'T-%' · product_name '%ทดสอบ%'
--   ⚠️ วิธีใช้: Supabase → SQL Editor → วางทั้งไฟล์ → Run
--   *ปลอดภัย*: แตะเฉพาะแถวที่มี marker ทดสอบ — ข้อมูลจริงไม่โดน
-- ============================================================================

-- 1) log ผลิต (ลบ log_product ก่อน — trigger จะปรับ stock ให้ แล้วเราลบ stock ทีหลังอยู่ดี)
delete from log_material        where material_id like 'T-%';
delete from log_product         where product_id like 'T-%';
delete from log_ferment         where product_name like '%ทดสอบ%';
delete from log_distill         where product_name like '%ทดสอบ%';
delete from log_dilute          where product_name like '%ทดสอบ%';
delete from log_ferment_draw    where product_name like '%ทดสอบ%';   -- D78 สุราแช่
-- D94 กลั่นซ้ำ — ★ ต้องมาก่อน log_dilute/log_material ไม่ได้ (ไม่มี FK ถึงกัน) แต่ต้องมี
--    ไม่งั้นล็อตทดสอบค้างถาวร · รอบถูกลบตาม on delete cascade
delete from log_redistill       where product_name like '%ทดสอบ%';
delete from log_ferment_monitor where product_name like '%ทดสอบ%';
delete from log_distill_run     where product_name like '%ทดสอบ%';
delete from stock_product       where product_id like 'T-%';

-- 2) log เชื่อมระบบ + audit ที่อ้างข้อมูลทดสอบ
delete from integration_log where coalesce(payload::text, '') like '%T-PROD%'
                               or coalesce(payload::text, '') like '%ทดสอบ%';
delete from edit_log where
     coalesce(after::text, '')  like any (array['%T-PROD%','%T-MAT%','%T-CON%','%ทดสอบ%','%EID99%'])
  or coalesce(before::text, '') like any (array['%T-PROD%','%T-MAT%','%T-CON%','%ทดสอบ%','%EID99%']);

-- 2.5) ขาย (Phase 4): items→orders ก่อน contacts (FK) · warehouse/stock_moves · config
delete from sales_order_items where qu_no in (select qu_no from sales_orders where customer_id like 'T-%' or customer_name like '%ทดสอบ%');
delete from integration_log where idempotency_key in (select order_no from sales_orders where customer_id like 'T-%')
                               or idempotency_key in (select order_no || '-balance' from sales_orders where customer_id like 'T-%');
delete from sales_orders    where customer_id like 'T-%' or customer_name like '%ทดสอบ%';
delete from stock_moves     where item_code like 'T-%' or remarks like '%ทดสอบ%';
delete from warehouse_stock where item_code like 'T-%';
delete from app_settings    where kind in ('sales_revenue_entity','sales_revenue_account','sales_doc_entity','pos_walkin_contact');

-- 3) บัญชี (Phase 3): certs/summaries/report_runs + items ก่อน transactions (กัน FK)
delete from tax_payments     where entity_id = 'EID99';   -- D88 ชำระภาษี (ต้องมาก่อน transactions)
delete from wht_certificates where entity_id = 'EID99';
delete from tax_summaries    where entity_id = 'EID99';
delete from report_runs      where entity_id = 'EID99';
-- D119 สำรองจ่าย: บิลที่เกิดจากการเคลียอยู่ใน **กิจการปลายทาง** (ไม่ใช่ EID99) → ตามด้วย advance_src_tx
--   🪤 ถ้าไม่ลบ บิลรายจ่ายทดสอบจะค้างในกิจการจริง แล้วโผล่ใน ภพ.30 ของกิจการนั้น
--   🪤 ต้องตามทั้งบิล seed (T-ADV-%) และบิลสำรองจ่ายที่คีย์เองจากหน้าจอใน EID99 (เลข TR- ปกติ)
delete from transaction_items where tx_id in (select tx_id from transactions
  where advance_src_tx like 'T-ADV-%'
     or advance_src_tx in (select tx_id from transactions where entity_id = 'EID99'));
delete from transactions where advance_src_tx like 'T-ADV-%'
   or advance_src_tx in (select tx_id from transactions where entity_id = 'EID99');
delete from transaction_items where tx_id in (select tx_id from transactions where entity_id = 'EID99');
delete from transactions     where entity_id = 'EID99';
delete from bank_accounts    where account_name like '%ทดสอบ%';
delete from app_settings     where value like '%ทดสอบ%';
delete from contacts         where name like '%ทดสอบ%' or contact_id like 'T-C%';

-- 4) master + กิจการทดสอบ
-- 🪤 เมนูที่ตั้งใจไม่ผูก product_id (seed_pos ข้อ ③) ต้องลบด้วยชื่อ ไม่งั้นค้างถาวร
-- 2.7) บาร์/POS (D96) — ลูกก่อนแม่: sale_item→sale · fav/recipe→menu,item · menu→category,customer
--      ★ ไม่ผูกกับ EID99 — seed_bar ลงที่กิจการไหนก็ได้ marker คือ id ขึ้นต้น 'T-'
--      🚨 ต้องลบ bar_move/bar_receive ด้วย ไม่งั้น FK ของ bar_item ค้าง
-- 🚨 **ห้ามลบด้วย `sale_no like 'B%'`** — บิลบาร์จริง**ทุกใบ**ขึ้นต้นด้วย B
--    ต้องหาบิลทดสอบจาก "มีรายการที่อ้างเมนูทดสอบ" หรือ "ผูกลูกค้าทดสอบ" เท่านั้น
create temp table if not exists _t_bar_sales on commit drop as
  select distinct sale_no from bar_sale_item where menu_id like 'T-%';
insert into _t_bar_sales
  select sale_no from bar_sale
   where (tab_name like '%ทดสอบ%' or customer_id like 'T-%')
     and sale_no not in (select sale_no from _t_bar_sales);

delete from bar_sale_item where sale_no in (select sale_no from _t_bar_sales);
delete from bar_sale      where sale_no in (select sale_no from _t_bar_sales);
-- ⚠️ **ไม่ลบ `bar_post` ที่นี่โดยตั้งใจ** — แถวนั้นผูกกับบิลใน `transactions` ที่สร้างไว้จริง
--    ลบแถวตรง ๆ = บิลบัญชีค้างอยู่โดยไม่มีอะไรชี้ถึง (เงินหลอนอยู่ในระบบ)
--    ที่ถูกคือกด **ถอนการลงบัญชี** ในแท็บแดชบอร์ดก่อน ซึ่ง soft-void ทั้งสองฝั่งให้
delete from bar_move         where item_id like 'T-%';
delete from bar_receive      where item_id like 'T-%';
delete from bar_customer_fav where customer_id like 'T-%' or menu_id like 'T-%';
-- ★ D127 — ช่องเหล้าประจำบ้าน/ชุดตกแต่งที่สร้างจากหน้าจอได้ id 'HS-'/'GN-' (ไม่ใช่ T-)
--    จึงจับด้วย "ชี้วัตถุดิบทดสอบ" หรือ "ชื่อมีคำว่า ทดสอบ" · 🚨 ต้องลบก่อน bar_item (FK restrict)
--    และลบบรรทัดสูตรที่อ้างช่องพวกนั้นก่อนตัวช่อง (FK restrict)
delete from bar_recipe_slot  where menu_id like 'T-%'
   or slot_id in (select slot_id from bar_house_slot where item_id like 'T-%' or name like '%ทดสอบ%');
delete from bar_house_slot   where item_id like 'T-%' or name like '%ทดสอบ%';
delete from bar_garnish      where item_id like 'T-%' or name like '%ทดสอบ%';
-- ★ D129 — ห้องทดลอง: รายการที่แตะวัตถุดิบ/เมนูทดสอบ หรือสูตร/งานที่ชื่อมี "ทดสอบ" (บรรทัด cascade ตามรายการ)
delete from bar_lab_use where use_id in (select use_id from bar_lab_use_line where item_id like 'T-%' or menu_id like 'T-%')
   or recipe_id in (select recipe_id from bar_lab_recipe where name like '%ทดสอบ%')
   or event_name like '%ทดสอบ%';
delete from bar_lab_recipe   where name like '%ทดสอบ%';
delete from bar_lab_category where name like '%ทดสอบ%' and not is_system;
-- ★ D130 — ของทำเอง: ตัวของทำเองได้ id 'I-…' (ไม่ใช่ T-) จึงจับด้วยชื่อที่มี "ทดสอบ"
--    ลบล็อต/สูตร/ความเคลื่อนไหว/ราคารับของ ของมันก่อน แล้วค่อยลบตัววัตถุดิบ (FK restrict)
create temp table if not exists _t_bar_prep on commit drop as
  select p.item_id from bar_prep p
    join bar_item i on i.tenant_id = p.tenant_id and i.entity_id = p.entity_id and i.item_id = p.item_id
   where i.name like '%ทดสอบ%';
delete from bar_prep_batch where item_id in (select item_id from _t_bar_prep)
   or batch_id in (select batch_id from bar_prep_batch_line where input_item_id like 'T-%');
delete from bar_prep_input where input_item_id like 'T-%';
delete from bar_prep       where item_id in (select item_id from _t_bar_prep);
delete from bar_move       where item_id in (select item_id from _t_bar_prep);
delete from bar_receive    where item_id in (select item_id from _t_bar_prep);
delete from bar_item       where item_id in (select item_id from _t_bar_prep);
delete from bar_recipe       where menu_id like 'T-%' or item_id like 'T-%';
delete from bar_menu         where menu_id like 'T-%' or name like '%ทดสอบ%';
delete from bar_customer     where customer_id like 'T-%' or name like '%ทดสอบ%';
delete from bar_item         where item_id like 'T-%';
delete from bar_category     where category_id like 'T-%';
delete from app_settings     where kind like 'bar\_%';

delete from sale_menu   where product_id like 'T-%' or menu_name like '%ทดสอบ%';
delete from products    where product_id like 'T-%';
delete from materials   where material_id like 'T-%';
delete from containers  where container_id like 'T-%';
delete from entities    where entity_id = 'EID99';

select 'ลบข้อมูลทดสอบเรียบร้อย' as result;
