-- ════════════════════════════════════════════════════════════════════════════
-- แก้ข้อมูลครั้งเดียว (D181 · 2026-11-25) — ใบเช็คราคาที่บันทึกจากระบบใหม่ ช่อง "รวม" เป็น 0
--
-- ปัญหา: แท็บเช็คราคา (PriceCheckTab) ส่ง total_price = 0 มาตลอดตั้งแต่ย้ายจาก GAS
--   (ระบบเดิมเก็บ จำนวน × ราคา) → ประวัติราคาโชว์ "รวม 0.00" · ติ๊กรวม/ส่งออก Excel ได้ 0
--   โค้ดแก้แล้วใน D181 (ใบใหม่ถูกเอง) — ไฟล์นี้แก้เฉพาะใบเก่า
-- แก้: total_price = round(จำนวน × ราคาต่อหน่วย ก่อน VAT, 2) ของบรรทัดในใบ type = 'เช็คราคา'
--   ที่ total_price = 0 อยู่ และ จำนวน × ราคา ≠ 0 เท่านั้น
--   · ไม่แตะบิลซื้อ/ขายจริงเลย (กรอง type = 'เช็คราคา')
--   · ไม่มีรายงานเงิน/ภาษี/สรรพสามิตตัวไหนอ่านช่องนี้ (ใช้แสดงผลอย่างเดียว · ใบเช็คราคายอดระดับบิล = 0)
--   · แก้ทุก tenant ใน DB นั้น — บั๊กเกิดกับทุกลูกค้าเหมือนกัน และค่าที่ถูกคิดได้จากข้อมูลของแถวนั้นเอง
--   · 🪤 ตาราง transaction_items ไม่มี audit trigger → ไม่มีแถวใน edit_log (ค่าเดิมคือ 0 ทุกแถว ดูขั้น 1)
--
-- วิธีใช้: Supabase Dashboard → SQL Editor → รันใน "ทุกโปรเจกต์" (DB เจ้าของ + DB ลูกค้า) ทีละขั้น
--   ขั้น 2 อยู่ใน do $$ … $$ → ทำทั้งก้อนหรือไม่ทำเลย
--   🪤 รันขั้น 2 ซ้ำหลังแก้แล้ว จะขึ้น "แก้แล้ว 0 แถว" — ปกติ แปลว่าไม่เหลือแถวให้แก้
-- ════════════════════════════════════════════════════════════════════════════


-- 1) ดูก่อน — จำนวนแถวที่จะถูกแก้ แยกตามลูกค้า (tenant) · ไม่มีแถว = DB นี้ไม่ต้องแก้
select tn.slug                       as tenant,
       count(*)                      as rows_to_fix,
       min(t.transaction_date)       as first_date,
       max(t.transaction_date)       as last_date
  from transaction_items i
  join transactions t on t.tx_id = i.tx_id
  join tenants tn     on tn.id   = t.tenant_id
 where t.type = 'เช็คราคา'
   and i.total_price = 0
   and round(i.quantity * i.ex_vat, 2) <> 0
 group by tn.slug
 order by tn.slug;

-- 1b) (ไม่บังคับ) ดูรายแถวก่อนแก้ — old_total ต้องเป็น 0 ทุกแถว · new_total = จำนวน × ราคา
select tn.slug as tenant, t.transaction_date, t.tx_id, i.item_id, i.item_name,
       i.quantity, i.ex_vat, i.total_price as old_total, round(i.quantity * i.ex_vat, 2) as new_total
  from transaction_items i
  join transactions t on t.tx_id = i.tx_id
  join tenants tn     on tn.id   = t.tenant_id
 where t.type = 'เช็คราคา'
   and i.total_price = 0
   and round(i.quantity * i.ex_vat, 2) <> 0
 order by tn.slug, t.transaction_date, i.item_id;


-- 2) แก้
do $$
declare n int;
begin
  update transaction_items i
     set total_price = round(i.quantity * i.ex_vat, 2)
    from transactions t
   where t.tx_id = i.tx_id
     and t.type = 'เช็คราคา'
     and i.total_price = 0
     and round(i.quantity * i.ex_vat, 2) <> 0;
  get diagnostics n = row_count;
  raise notice 'แก้แล้ว % แถว', n;
end $$;


-- 3) ตรวจหลังแก้ → ควรไม่มีแถว (ไม่เหลือใบเช็คราคาที่รวมเป็น 0 ทั้งที่มีจำนวนและราคา)
select count(*) as left_to_fix
  from transaction_items i
  join transactions t on t.tx_id = i.tx_id
 where t.type = 'เช็คราคา'
   and i.total_price = 0
   and round(i.quantity * i.ex_vat, 2) <> 0;
