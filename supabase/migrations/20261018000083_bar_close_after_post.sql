-- ─────────────────────────────────────────────────────────────────────────────
-- 0083 — ห้ามปิดบิลเข้าวันขายที่ลงบัญชีไปแล้ว  (D115)
--
-- 🔴 **บั๊กที่แก้: บิลที่ปิดหลังกด "ลงบัญชี" ของวันนั้น ไม่เข้าบัญชีเลย**
--    ปุ่มลงบัญชีตั้งวันเริ่มเป็น "วันนี้" ⇒ กดตอนร้านยังเปิด แล้วปิดบิลต่อ
--    บิลพวกนั้นได้ business_date = วันที่ลงแล้ว → `fn_bar_post_day` ไม่มีวันหยิบอีก
--    (กันลงซ้ำ) และแถบเตือนวันค้างก็ข้ามวันนั้น (ถือว่าลงแล้ว)
--    = ยอดขาย + VAT หายจากบัญชีและ ภพ.30 โดยไม่มีอะไรฟ้อง
-- ★ ยกเลิกบิล/แก้รายการ มีด่านนี้อยู่แล้วตั้งแต่ 0065 — ขาดแค่ตอนปิดบิล
--    (`fn_bar_quick_sale` ของโหมดบูธเรียกตัวนี้ จึงได้ด่านไปด้วย)
--
-- 🚨 ยกฟังก์ชันจาก 0069 มาทั้งตัวด้วยสคริปต์ เติมเฉพาะบล็อกด่านใหม่ (กัน D79)
--    `create or replace` คงสิทธิ์เดิม (ไม่ต้อง grant/revoke ใหม่ · D99)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function fn_bar_close_sale(
  p_entity text, p_sale_no text, p_method text,
  p_business_date date, p_discount numeric default 0, p_rounding numeric default 0,
  p_discount_pct numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.write');
  v_sale bar_sale%rowtype;
  v_sub numeric;
  v_cost numeric;
  v_disc numeric;
  v_grand numeric;
  v_is_vat boolean;
  v_rcpt text;
begin
  select * into v_sale from bar_sale
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no for update;
  if not found then raise exception 'ไม่พบบิล %', p_sale_no; end if;
  if v_sale.status <> 'เปิดอยู่' then raise exception 'บิล % ไม่ได้เปิดอยู่', p_sale_no; end if;
  if coalesce(trim(p_method), '') = '' then raise exception 'ต้องเลือกวิธีรับเงิน'; end if;
  if p_business_date is null then raise exception 'ไม่รู้ว่าบิลนี้เป็นยอดของวันไหน'; end if;

  -- D115 — วันที่ลงบัญชีแล้ว ปิดบิลเข้าไม่ได้ (บิลจะไม่มีวันเข้าบัญชี)
  if exists (select 1 from bar_post
              where tenant_id = v_tenant and entity_id = p_entity
                and post_date = p_business_date and status = 'ปกติ') then
    raise exception 'ยอดวันที่ % ลงบัญชีไปแล้ว — ปิดบิลเข้าวันนั้นไม่ได้ ต้องถอนการลงบัญชีวันนั้นก่อน (แท็บแดชบอร์ด)', to_char(p_business_date, 'DD/MM/YYYY');
  end if;

  select coalesce(sum(amount), 0), coalesce(sum(cost), 0) into v_sub, v_cost
    from bar_sale_item
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no
     and voided_at is null;

  -- 🪤 ส่วนลดเกินยอด → ตัดให้เท่ากับยอด ไม่ปล่อยให้บิลติดลบ
  --    (บิลติดลบจะกลายเป็นรายรับติดลบตอนลงบัญชีรายวัน ซึ่งไม่มีใครสังเกต)
  v_disc := least(greatest(coalesce(p_discount, 0), 0), v_sub);
  v_grand := greatest(0, v_sub - v_disc) + coalesce(p_rounding, 0);

  update bar_sale set
    status = 'ปกติ', closed_at = now(), business_date = p_business_date,
    method = trim(p_method), sub_total = v_sub, discount = v_disc,
    rounding = coalesce(p_rounding, 0), grand_total = v_grand, cost_total = v_cost,
    -- ★ เก็บไว้พิมพ์บนสลิปว่า "ส่วนลดท้ายบิล 10%" · ตัวเงินยังเป็น `discount` ข้างบน
    discount_pct = nullif(least(greatest(coalesce(p_discount_pct, 0), 0), 100), 0)
  where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no;

  /**
   * ── ใบกำกับภาษีอย่างย่อ (D96 เฟส F) ──────────────────────────────────────
   * 🚨 ผู้ประกอบการจด VAT ที่ขายปลีกต้องออกใบกำกับอย่างย่อ **ทุกครั้งที่ขาย**
   *    ⇒ ออกเลขให้ตั้งแต่ตอนปิดบิล ไม่ใช่รอลูกค้าขอ (ของเดิมออกตามคำขอ ใช้กับ VAT ไม่ได้)
   * ★ กิจการที่ไม่จด VAT **พฤติกรรมเดิมทุกประการ** — ไม่ออกเลขให้ รอกดขอเหมือนเดิม
   * ★ ใช้ชุดเลข BR เดิม ไม่แยกชุดใหม่ (บิลหนึ่งมีใบเดียว เลขจึงไม่ชนกัน)
   */
  select coalesce(is_vat, false) into v_is_vat
    from entities where tenant_id = v_tenant and entity_id = p_entity;

  if coalesce(v_is_vat, false) and v_sale.rcpt_no is null then
    v_rcpt := fn_bar_next_doc('BR', p_entity);
    update bar_sale set rcpt_no = v_rcpt, rcpt_at = now()
     where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no;
  end if;

  -- สถิติลูกค้า — ★ ต้องถอยกลับตอนยกเลิกบิลด้วย (ดู fn_bar_void_sale)
  if v_sale.customer_id is not null then
    update bar_customer set
      visits = visits + 1,
      spend_total = spend_total + v_grand,
      first_seen = least(coalesce(first_seen, p_business_date), p_business_date),
      last_seen = greatest(coalesce(last_seen, p_business_date), p_business_date)
    where tenant_id = v_tenant and entity_id = p_entity and customer_id = v_sale.customer_id;
  end if;

  return jsonb_build_object('ok', true, 'sale_no', p_sale_no,
                            'sub_total', v_sub, 'grand_total', v_grand, 'cost_total', v_cost,
                            'rcpt_no', coalesce(v_rcpt, v_sale.rcpt_no), 'is_vat', coalesce(v_is_vat, false));
end $fn$;
