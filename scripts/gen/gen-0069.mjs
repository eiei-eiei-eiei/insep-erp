/**
 * gen-0069 — VAT ครบวง (D96 ภาค 2 เฟส F)
 *
 * 🚨 กติกา D79/D91: ยก body ของฟังก์ชันเดิมมาด้วยสคริปต์จากไฟล์ล่าสุดที่นิยามมัน
 */
import fs from "node:fs";
import path from "node:path";

const MIG = "supabase/migrations";
const OUT = "20260913000069_bar_vat.sql";

function yank(name) {
  const files = fs.readdirSync(MIG).filter((f) => f.endsWith(".sql") && f !== OUT).sort();
  let found = null;
  for (const f of files) {
    const src = fs.readFileSync(path.join(MIG, f), "utf8");
    const head = src.indexOf("create or replace function " + name + "(");
    if (head < 0) continue;
    const tail = src.indexOf("end $fn$;", head);
    if (tail < 0) throw new Error(`หา end $fn$; ของ ${name} ใน ${f} ไม่เจอ`);
    found = { file: f, body: src.slice(head, tail + "end $fn$;".length) };
  }
  if (!found) throw new Error(`ไม่พบนิยามของ ${name}`);
  return found;
}

const closeSale = yank("fn_bar_close_sale");
const postDay = yank("fn_bar_post_day");
console.error(`ยกมาจาก: close_sale ← ${closeSale.file} · post_day ← ${postDay.file}`);

// ── 1) fn_bar_close_sale — กิจการจด VAT ต้องได้เลขใบกำกับอย่างย่อ **ทุกใบ**
let c = closeSale.body;
{
  const old = `  v_disc numeric;
  v_grand numeric;
begin`;
  const neu = `  v_disc numeric;
  v_grand numeric;
  v_is_vat boolean;
  v_rcpt text;
begin`;
  if (!c.includes(old)) throw new Error("โครง declare ของ fn_bar_close_sale ไม่ตรงกับที่คาด");
  c = c.split(old).join(neu);
}
{
  const old = `  -- สถิติลูกค้า`;
  const neu = `  /**
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

  -- สถิติลูกค้า`;
  if (!c.includes(old)) throw new Error("ไม่พบจุดแทรกก่อนบล็อกสถิติลูกค้า");
  c = c.split(old).join(neu);
}
{
  const old = `  return jsonb_build_object('ok', true, 'sale_no', p_sale_no,
                            'sub_total', v_sub, 'grand_total', v_grand, 'cost_total', v_cost);`;
  const neu = `  return jsonb_build_object('ok', true, 'sale_no', p_sale_no,
                            'sub_total', v_sub, 'grand_total', v_grand, 'cost_total', v_cost,
                            'rcpt_no', coalesce(v_rcpt, v_sale.rcpt_no), 'is_vat', coalesce(v_is_vat, false));`;
  if (!c.includes(old)) throw new Error("ไม่พบ return ของ fn_bar_close_sale");
  c = c.split(old).join(neu);
}

// ── 2) fn_bar_post_day — เขียนช่องภาษีให้ ภพ.30 มองเห็น
let d = postDay.body;
{
  const old = `  v_ids text[] := '{}';
  v_totals jsonb := '{}'::jsonb;
  v_sum numeric := 0;
begin`;
  const neu = `  v_ids text[] := '{}';
  v_totals jsonb := '{}'::jsonb;
  v_sum numeric := 0;
  v_is_vat boolean;
  v_base numeric;
  v_vat numeric;
  v_docs text;
begin`;
  if (!d.includes(old)) throw new Error("โครง declare ของ fn_bar_post_day ไม่ตรงกับที่คาด");
  d = d.split(old).join(neu);
}
{
  const old = `  for v_rec in
    select coalesce(nullif(trim(method), ''), 'ไม่ระบุ') as m,
           count(*) as bills, sum(grand_total) as total
      from bar_sale
     where tenant_id = v_tenant and entity_id = p_entity
       and business_date = p_date and status = 'ปกติ'
     group by 1 order by 1
  loop`;
  const neu = `  select coalesce(is_vat, false) into v_is_vat
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
     * 🚨 \`taxReport()\` ของ ภพ.30 ใช้ **\`amount_after_discount\` เป็นฐานก่อนภาษี**
     *    แล้วคิด 7% จากผลรวม · และ **ข้ามแถวที่ \`vat_amount <= 0\` ทิ้ง**
     *    ⇒ เดิมเขียนยอดรวมลงทุกช่องและไม่เซ็ต vat_amount
     *      = **ยอดขายบาร์หายจาก ภพ.30 ทั้งเดือนโดยไม่มีอะไรฟ้อง**
     * ★ ราคาหน้าบาร์รวม VAT อยู่แล้ว จึงต้อง **ถอดออก** ไม่ใช่บวกเข้า
     *   สูตรตรงกับ \`lib/bar/vat.ts\` (golden B11) และ base คิดด้วยการ **ลบ**
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
              end;`;
  if (!d.includes(old)) throw new Error("ไม่พบลูปรวมยอดของ fn_bar_post_day");
  d = d.split(old).join(neu);
}
{
  const old = `    insert into transactions(tenant_id, tx_id, transaction_date, type, account_name, category,
                             description, base_amount, amount_after_discount, net_amount,
                             entity_id, source)
    values (v_tenant, v_tx, p_date, 'รายรับ', p_account, p_category,
            'ยอดขายบาร์ ' || to_char(p_date, 'DD/MM/YYYY') || ' · ' || v_rec.m ||
            ' (' || v_rec.bills || ' บิล)',
            v_rec.total, v_rec.total, v_rec.total, p_entity, 'bar');`;
  const neu = `    insert into transactions(tenant_id, tx_id, transaction_date, type, account_name, category,
                             description, base_amount, amount_after_discount, vat_amount, net_amount,
                             tax_invoice_no, tax_invoice_date, entity_id, source)
    values (v_tenant, v_tx, p_date, 'รายรับ', p_account, p_category,
            'ยอดขายบาร์ ' || to_char(p_date, 'DD/MM/YYYY') || ' · ' || v_rec.m ||
            ' (' || v_rec.bills || ' บิล)',
            v_base, v_base, v_vat, v_rec.total,
            v_docs, case when v_docs is null then null else p_date end,
            p_entity, 'bar');`;
  if (!d.includes(old)) throw new Error("ไม่พบ insert transactions ของ fn_bar_post_day");
  d = d.split(old).join(neu);
}
{
  const old = `    v_totals := v_totals || jsonb_build_object(v_rec.m,
                  jsonb_build_object('bills', v_rec.bills, 'total', v_rec.total, 'tx_id', v_tx));`;
  const neu = `    v_totals := v_totals || jsonb_build_object(v_rec.m,
                  jsonb_build_object('bills', v_rec.bills, 'total', v_rec.total, 'tx_id', v_tx,
                                     'base', v_base, 'vat', v_vat, 'docs', v_docs));`;
  if (!d.includes(old)) throw new Error("ไม่พบการสะสม v_totals");
  d = d.split(old).join(neu);
}

const out = `-- ─────────────────────────────────────────────────────────────────────────────
-- 0069 — VAT ครบวงสำหรับบาร์ที่จด VAT  (D96 · ภาค 2 เฟส F)
--
-- 🎯 ผู้ใช้ตอบว่ากิจการบาร์ "จด / อาจจะจด" ⇒ ต้องรองรับให้จบในรอบนี้
--
-- 🔴 **บั๊กที่แก้: ยอดขายบาร์หายจาก ภพ.30 ทั้งเดือนโดยไม่มีอะไรฟ้อง**
--    \`taxReport()\` ข้ามแถวที่ \`vat_amount <= 0\` ทิ้ง และของเดิม \`fn_bar_post_day\`
--    ไม่เคยเซ็ต \`vat_amount\` เลย ⇒ บาร์ที่จด VAT จะยื่นภาษีขายขาดทั้งเดือน
--
-- 🔴 **บั๊กที่แก้: ใบกำกับอย่างย่อไม่มีเลขทุกใบ**
--    ของเดิมออกเลข \`BR\` เมื่อลูกค้ากดขอเท่านั้น — ใช้กับ VAT ไม่ได้
--    ผู้ประกอบการจด VAT ที่ขายปลีกต้องออกใบกำกับอย่างย่อ **ทุกครั้งที่ขาย**
--    ⇒ ออกให้ตั้งแต่ตอนปิดบิล
--
-- 🚨 **กิจการที่ไม่จด VAT ต้องไม่ขยับแม้ช่องเดียว** — ทุกกิ่งใหม่อยู่ใต้ \`if v_is_vat\`
--    (เส้นทางนี้คือของลูกค้าที่ใช้อยู่ทุกวันนี้ · เทส tenant ล็อกทั้งสองทิศ)
--
-- ★ ราคาหน้าบาร์ **รวม VAT อยู่แล้ว** → ถอดออก ไม่ใช่บวกเข้า
--   สูตรตรงกับ \`lib/bar/vat.ts\` (golden B11) · base คิดด้วยการ **ลบ**
--   เพื่อการันตี base + vat = เงินที่รับจริงเป๊ะ (ไม่งั้นเลขบนใบกำกับเพี้ยน 1 สตางค์)
--
-- 🚨 ยกทั้ง 2 ฟังก์ชันมาด้วยสคริปต์ scripts/gen/gen-0069.mjs ไม่ได้พิมพ์ใหม่ (D79)
-- 🪤 \`fn_bar_close_sale\` **ไม่ได้เพิ่มพารามิเตอร์** จึง \`create or replace\` ได้ตรง ๆ
-- ─────────────────────────────────────────────────────────────────────────────

${c}

${d}
`;

fs.writeFileSync(path.join(MIG, OUT), out);
console.error(`เขียน ${OUT} แล้ว`);
