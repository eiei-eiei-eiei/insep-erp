-- ════════════════════════════════════════════════════════════════════════════
-- 0110 — ใบเสนอราคา: นับฉบับแก้ไข (D168)
--
-- ที่มา: แก้ใบเสนอราคาแล้วเลข QU เดิม (ถูกต้อง — ใบเสนอราคาไม่ใช่เอกสารภาษี ไม่มีกติกาเรื่องเลข)
--   แต่ถ้าส่งใบแรกให้ลูกค้าไปแล้ว ลูกค้าจะถือ 2 ใบ เลขเดียวกัน ราคาต่างกัน แยกไม่ออกว่าตกลงที่ใบไหน
--   ⇒ ใบที่พิมพ์ต้องบอกว่าเป็น "ฉบับแก้ไขครั้งที่ N" และลงวันที่ของฉบับนั้น
--
-- ★ นับเฉพาะเมื่อ "สิ่งที่พิมพ์บนใบ" เปลี่ยนจริง (กดแก้แล้วบันทึกโดยไม่เปลี่ยนอะไร = ไม่นับ)
--   เทียบลายนิ้วมือของ หัวออเดอร์ + รายการ + แผนงวด ก่อน/หลัง
--   🪤 แผนงวดบันทึกด้วย RPC อีกตัวหลัง fn_update_quotation (D146) ⇒ ปิดรอบด้วย
--      fn_quotation_close_revision หลังบันทึกแผนเสร็จ ไม่งั้นแก้แค่เงื่อนไขงวดแล้วไม่ถูกนับ
-- ★ นับเฉพาะทางแก้ใบเสนอราคา · ปรับงวดหลังลูกค้าตกลงแล้ว (PlanPanel) ไม่ใช่ฉบับแก้ไขของข้อเสนอ
-- 🚨 ไม่แตะยอดเงิน/สูตร/สถานะ — เพิ่มคอลัมน์ 2 ตัว + ฟังก์ชันอ่านอย่างเดียว 1 ตัว + ตัวปิดรอบ 1 ตัว
--    fn_update_quotation ยกจาก 0021 ทั้งตัว เพิ่มแค่บรรทัด v_fp + คืน fp_before
-- ════════════════════════════════════════════════════════════════════════════

alter table sales_orders add column if not exists qu_rev integer not null default 0;
alter table sales_orders add column if not exists qu_rev_on date;  -- วันที่ของฉบับล่าสุด (เวลาไทย) · null = ยังไม่เคยแก้

-- ลายนิ้วมือของสิ่งที่พิมพ์บนใบเสนอราคา (invoker · RLS กรอง tenant เอง)
create or replace function fn_quotation_fingerprint(p_qu_no text)
returns text
language sql stable set search_path = public as $$
  select md5(jsonb_build_object(
    'o', (select to_jsonb(x) from (
            select customer_id, customer_name, sale_name, sub_total, discount, sub_discount, vat_amount,
                   grand_total, net_payable, wht_percent, wht_amount, remarks, category, is_deposit, deposit_percent
            from sales_orders where qu_no = p_qu_no) x),
    'i', coalesce((select jsonb_agg(jsonb_build_array(item_name, qty, price) order by id)
                   from sales_order_items where qu_no = p_qu_no), '[]'::jsonb),
    'p', coalesce((select jsonb_agg(jsonb_build_array(label, percent, amount, due_date, ship_point) order by seq)
                   from sales_installments where qu_no = p_qu_no), '[]'::jsonb)
  )::text)
$$;

create or replace function fn_update_quotation(p_qu_no text, p jsonb, p_items jsonb default '[]'::jsonb)
returns jsonb
language plpgsql set search_path = public as $$
declare v_status text; it jsonb; v_fp text;
begin
  select status into v_status from sales_orders where qu_no = p_qu_no for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบใบเสนอราคา ' || p_qu_no); end if;
  if v_status <> 'รอคอนเฟิร์ม' then
    return jsonb_build_object('ok', false, 'error', 'แก้ไขไม่ได้ — สถานะปัจจุบันคือ "' || v_status || '"');
  end if;
  -- D168 — ลายนิ้วมือก่อนแก้ (ผู้เรียกส่งกลับมาที่ fn_quotation_close_revision หลังบันทึกแผนงวด)
  v_fp := fn_quotation_fingerprint(p_qu_no);

  update sales_orders set
    customer_id = coalesce(nullif(p->>'customer_id',''), customer_id),
    customer_name = coalesce(nullif(p->>'customer_name',''), customer_name),
    sale_name = coalesce(nullif(p->>'sale_name',''), sale_name),
    sub_total = coalesce((p->>'sub_total')::numeric,0),
    discount = coalesce((p->>'discount')::numeric,0),
    sub_discount = coalesce((p->>'sub_discount')::numeric,0),
    vat_amount = coalesce((p->>'vat_amount')::numeric,0),
    grand_total = coalesce((p->>'grand_total')::numeric,0),
    outstanding_balance = coalesce(nullif(p->>'net_payable','')::numeric, (p->>'grand_total')::numeric, 0),
    remarks = nullif(p->>'remarks',''),
    wht_percent = coalesce((p->>'wht_percent')::numeric,0),
    wht_amount = coalesce((p->>'wht_amount')::numeric,0),
    net_payable = coalesce(nullif(p->>'net_payable','')::numeric, (p->>'grand_total')::numeric, 0),
    category = coalesce(nullif(p->>'category',''),'รายได้ค่าสินค้า'),
    is_deposit = coalesce((p->>'is_deposit')::boolean, is_deposit),
    deposit_percent = coalesce((p->>'deposit_percent')::numeric, deposit_percent)
  where qu_no = p_qu_no;

  delete from sales_order_items where qu_no = p_qu_no;
  for it in select value from jsonb_array_elements(p_items) loop
    insert into sales_order_items(qu_no, item_name, qty, price)
    values (p_qu_no, it->>'name', coalesce((it->>'qty')::numeric,0), coalesce((it->>'price')::numeric,0));
  end loop;

  return jsonb_build_object('ok', true, 'qu_no', p_qu_no, 'fp_before', v_fp);
end $$;

-- ปิดรอบการแก้: เนื้อหาบนใบเปลี่ยนจริง → ฉบับแก้ไข +1 และลงวันที่วันนี้ (เวลาไทย)
create or replace function fn_quotation_close_revision(p_qu_no text, p_fp_before text)
returns jsonb
language plpgsql set search_path = public as $$
declare v_rev integer;
begin
  select qu_rev into v_rev from sales_orders where qu_no = p_qu_no for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'ไม่พบใบเสนอราคา ' || p_qu_no); end if;
  if p_fp_before is null or fn_quotation_fingerprint(p_qu_no) = p_fp_before then
    return jsonb_build_object('ok', true, 'rev', v_rev, 'changed', false);
  end if;
  update sales_orders
     set qu_rev = qu_rev + 1, qu_rev_on = (now() at time zone 'Asia/Bangkok')::date
   where qu_no = p_qu_no
  returning qu_rev into v_rev;
  return jsonb_build_object('ok', true, 'rev', v_rev, 'changed', true);
end $$;
