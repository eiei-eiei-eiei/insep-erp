-- ─────────────────────────────────────────────────────────────────────────────
-- 0069 — VAT ครบวงสำหรับบาร์ที่จด VAT  (D96 · ภาค 2 เฟส F)
--
-- 🎯 ผู้ใช้ตอบว่ากิจการบาร์ "จด / อาจจะจด" ⇒ ต้องรองรับให้จบในรอบนี้
--
-- 🔴 **บั๊กที่แก้: ยอดขายบาร์หายจาก ภพ.30 ทั้งเดือนโดยไม่มีอะไรฟ้อง**
--    `taxReport()` ข้ามแถวที่ `vat_amount <= 0` ทิ้ง และของเดิม `fn_bar_post_day`
--    ไม่เคยเซ็ต `vat_amount` เลย ⇒ บาร์ที่จด VAT จะยื่นภาษีขายขาดทั้งเดือน
--
-- 🔴 **บั๊กที่แก้: ใบกำกับอย่างย่อไม่มีเลขทุกใบ**
--    ของเดิมออกเลข `BR` เมื่อลูกค้ากดขอเท่านั้น — ใช้กับ VAT ไม่ได้
--    ผู้ประกอบการจด VAT ที่ขายปลีกต้องออกใบกำกับอย่างย่อ **ทุกครั้งที่ขาย**
--    ⇒ ออกให้ตั้งแต่ตอนปิดบิล
--
-- 🚨 **กิจการที่ไม่จด VAT ต้องไม่ขยับแม้ช่องเดียว** — ทุกกิ่งใหม่อยู่ใต้ `if v_is_vat`
--    (เส้นทางนี้คือของลูกค้าที่ใช้อยู่ทุกวันนี้ · เทส tenant ล็อกทั้งสองทิศ)
--
-- ★ ราคาหน้าบาร์ **รวม VAT อยู่แล้ว** → ถอดออก ไม่ใช่บวกเข้า
--   สูตรตรงกับ `lib/bar/vat.ts` (golden B11) · base คิดด้วยการ **ลบ**
--   เพื่อการันตี base + vat = เงินที่รับจริงเป๊ะ (ไม่งั้นเลขบนใบกำกับเพี้ยน 1 สตางค์)
--
-- 🚨 ยกทั้ง 2 ฟังก์ชันมาด้วยสคริปต์ scripts/gen/gen-0069.mjs ไม่ได้พิมพ์ใหม่ (D79)
-- 🪤 `fn_bar_close_sale` **ไม่ได้เพิ่มพารามิเตอร์** จึง `create or replace` ได้ตรง ๆ
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

create or replace function fn_bar_post_day(
  p_entity text, p_date date, p_account text, p_category text default 'รายได้บาร์'
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.config');
  v_rec record;
  v_tx text;
  v_ids text[] := '{}';
  v_totals jsonb := '{}'::jsonb;
  v_sum numeric := 0;
  v_is_vat boolean;
  v_base numeric;
  v_vat numeric;
  v_docs text;
begin
  if p_date is null then raise exception 'ต้องระบุวันที่'; end if;
  if coalesce(trim(p_account), '') = '' then
    raise exception 'ยังไม่ได้ตั้งบัญชีรับเงินของบาร์ — ไปตั้งที่ ตั้งค่าบาร์';
  end if;
  if exists (select 1 from bar_post
              where tenant_id = v_tenant and entity_id = p_entity
                and post_date = p_date and status = 'ปกติ') then
    raise exception 'ยอดวันที่ % ลงบัญชีไปแล้ว', to_char(p_date, 'DD/MM/YYYY');
  end if;
  if not exists (select 1 from bar_sale
                  where tenant_id = v_tenant and entity_id = p_entity
                    and business_date = p_date and status = 'ปกติ') then
    raise exception 'วันที่ % ไม่มีบิลที่ปิดแล้ว ไม่มีอะไรให้ลงบัญชี', to_char(p_date, 'DD/MM/YYYY');
  end if;

  select coalesce(is_vat, false) into v_is_vat
    from entities where tenant_id = v_tenant and entity_id = p_entity;

  for v_rec in
    select coalesce(nullif(trim(method), ''), 'ไม่ระบุ') as m,
           count(*) as bills, sum(grand_total) as total,
           min(rcpt_no) as first_doc, max(rcpt_no) as last_doc
      from bar_sale
     where tenant_id = v_tenant and entity_id = p_entity
       and business_date = p_date and status = 'ปกติ'
     group by 1 order by 1
  loop
    /**
     * ── ช่องภาษี (D96 เฟส F) ────────────────────────────────────────────────
     * 🚨 `taxReport()` ของ ภพ.30 ใช้ **`amount_after_discount` เป็นฐานก่อนภาษี**
     *    แล้วคิด 7% จากผลรวม · และ **ข้ามแถวที่ `vat_amount <= 0` ทิ้ง**
     *    ⇒ เดิมเขียนยอดรวมลงทุกช่องและไม่เซ็ต vat_amount
     *      = **ยอดขายบาร์หายจาก ภพ.30 ทั้งเดือนโดยไม่มีอะไรฟ้อง**
     * ★ ราคาหน้าบาร์รวม VAT อยู่แล้ว จึงต้อง **ถอดออก** ไม่ใช่บวกเข้า
     *   สูตรตรงกับ `lib/bar/vat.ts` (golden B11) และ base คิดด้วยการ **ลบ**
     *   เพื่อการันตี base + vat = ยอดที่รับจริงเป๊ะ
     */
    if (v_is_vat) then
      v_vat  := round(v_rec.total * 7 / 107, 2);
      v_base := round(v_rec.total - v_vat, 2);
    else
      v_vat  := 0;
      v_base := v_rec.total;
    end if;

    -- ช่วงเลขใบกำกับอย่างย่อของวันนั้น — ภพ.30 ต้องอ้างอิงเอกสารได้
    v_docs := case
                when not v_is_vat or v_rec.first_doc is null then null
                when v_rec.first_doc = v_rec.last_doc then v_rec.first_doc
                else v_rec.first_doc || ' ถึง ' || v_rec.last_doc
              end;
    v_tx := 'TR-' || to_char(p_date, 'YYYYMMDD') || '-' ||
            lpad(next_serial('TR-' || to_char(p_date, 'YYYYMMDD'))::text, 4, '0');

    insert into transactions(tenant_id, tx_id, transaction_date, type, account_name, category,
                             description, base_amount, amount_after_discount, vat_amount, net_amount,
                             tax_invoice_no, tax_invoice_date, entity_id, source)
    values (v_tenant, v_tx, p_date, 'รายรับ', p_account, p_category,
            'ยอดขายบาร์ ' || to_char(p_date, 'DD/MM/YYYY') || ' · ' || v_rec.m ||
            ' (' || v_rec.bills || ' บิล)',
            v_base, v_base, v_vat, v_rec.total,
            v_docs, case when v_docs is null then null else p_date end,
            p_entity, 'bar');

    v_ids := v_ids || v_tx;
    v_totals := v_totals || jsonb_build_object(v_rec.m,
                  jsonb_build_object('bills', v_rec.bills, 'total', v_rec.total, 'tx_id', v_tx,
                                     'base', v_base, 'vat', v_vat, 'docs', v_docs));
    v_sum := v_sum + v_rec.total;
  end loop;

  insert into bar_post(tenant_id, entity_id, post_date, tx_ids, totals, posted_by)
  values (v_tenant, p_entity, p_date, v_ids, v_totals, auth.uid());

  return jsonb_build_object('ok', true, 'post_date', p_date, 'tx_ids', v_ids, 'total', v_sum);
end $fn$;
