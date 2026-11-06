/**
 * สร้าง migration 0107 (D160 ใบลดหนี้บางส่วน) — ยก fn_cancel_order จาก 0106 แล้วเติมด่าน 1 จุด
 * + ฟังก์ชันใหม่ fn_sales_credit_note · ด่านก่อนเขียนไฟล์: ตัวแปรใน declare ห้ามซ้ำ (บทเรียน 0106)
 * ใช้: node scripts/gen-0107.mjs
 */
import fs from "node:fs";

const DIR = "supabase/migrations";
const OUT = `${DIR}/20261106000107_sales_credit_note_partial.sql`;
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql") && f !== OUT.split("/").pop()).sort();

function lift(name, endTag) {
  const head = `function ${name}(`;
  const f = [...files].reverse().find((x) => /create (or replace )?function /.test(fs.readFileSync(`${DIR}/${x}`, "utf8")) && fs.readFileSync(`${DIR}/${x}`, "utf8").match(new RegExp(`create (or replace )?function ${name}\\(`)));
  if (!f) throw new Error(`ไม่พบ ${name}`);
  const src = fs.readFileSync(`${DIR}/${f}`, "utf8").replace(/\r\n/g, "\n");
  const s = src.search(new RegExp(`create (or replace )?function ${name}\\(`));
  const e = src.indexOf(endTag, s) + endTag.length;
  return { file: f, body: src.slice(s, e) };
}
function rep(body, a, b, label) {
  const n = body.split(a).length - 1;
  if (n !== 1) throw new Error(`${label}: ต้องเจอ 1 ครั้ง เจอ ${n} — ${a.slice(0, 70)}`);
  return body.replace(a, b);
}
function assertNoDuplicateDeclare(name, body) {
  const decl = body.slice(body.indexOf("\ndeclare\n") + 9, body.indexOf("\nbegin\n"));
  const names = decl.replace(/--[^\n]*/g, "").split(";")
    .map((s) => s.trim().match(/^([a-z_][a-z0-9_]*)\s/i)?.[1]?.toLowerCase())
    .filter(Boolean);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) throw new Error(`${name}: ตัวแปรประกาศซ้ำ ${[...new Set(dup)].join(", ")}`);
}

// 🚨 ข้อความเดียวกับ CANCEL_AFTER_PARTIAL_TEXT ใน lib/sales/creditNote.ts (เทสเทียบ)
const lib = fs.readFileSync("lib/sales/creditNote.ts", "utf8");
const CANCEL_TEXT = lib.match(/CANCEL_AFTER_PARTIAL_TEXT =\s*"([^"]+)"/)[1];

// ── 1) fn_cancel_order — ยกจากไฟล์ล่าสุด · เติมด่าน "มีใบลดหนี้บางส่วนแล้ว ห้ามยกเลิกทั้งออเดอร์" ──
const cancel = lift("fn_cancel_order", "end $$;");
let c = cancel.body.replace("create function fn_cancel_order(", "create or replace function fn_cancel_order(");
c = rep(c, "  v_ref := coalesce(v_order.order_no, p_qu_no);\n",
  "  v_ref := coalesce(v_order.order_no, p_qu_no);\n" +
  "  -- ★ D160 — มีใบลดหนี้บางส่วนแล้ว = ยกเลิกทั้งออเดอร์ไม่ได้ (คืนสต็อก/ภาษีจะซ้ำกับที่คืนไปแล้ว)\n" +
  "  --   ฝาแฝด TS: CANCEL_AFTER_PARTIAL_TEXT ใน lib/sales/creditNote.ts\n" +
  "  if exists (select 1 from sales_credit_notes cn where cn.tenant_id = v_tenant and cn.qu_no = p_qu_no and cn.kind <> 'cancel') then\n" +
  `    raise exception '${CANCEL_TEXT}';\n` +
  "  end if;\n", "cancel/guard");
assertNoDuplicateDeclare("fn_cancel_order", c);

const BILLS = `transactions t
     where t.tenant_id = v_tenant and t.status <> 'ยกเลิก' and t.vat_amount > 0
       and (t.idempotency_key in (v_ref, v_ref || '-balance')
            or t.tx_id in (select p.tx_id from sales_payments p
                            where p.tenant_id = v_tenant and p.qu_no = p_qu_no and p.tx_id is not null))`;

const partial = `create or replace function fn_sales_credit_note(p_qu_no text, p_cn jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_order sales_orders%rowtype;
  v_ref text; v_kind text; v_reason text; v_detail text; v_date date; v_acc text;
  v_pre numeric; v_vat numeric; v_total numeric; v_wht numeric; v_refund numeric;
  v_bill_pre numeric; v_bill_vat numeric; v_rem_pre numeric; v_rem_vat numeric;
  v_max_date date; v_entity text; s record;
  v_cn_no text; v_cn_tx text; v_restock boolean; v_items jsonb;
  it jsonb; v_item record; v_done numeric; v_qty numeric;
  m record; v_real numeric; v_before numeric; v_after numeric; v_liquor boolean := false;
  v_locked text[];
begin
  -- 🚨 ใบลดหนี้ = ลดภาษีขายที่ยื่นแล้ว + คืนเงิน → ระดับหัวหน้าเท่านั้น (เส้นเดียวกับยกเลิกออเดอร์ D85)
  if not has_cap('sales.config') then raise exception 'ไม่มีสิทธิ์ออกใบลดหนี้ (เฉพาะหัวหน้าฝ่ายขาย)'; end if;
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;

  select * into v_order from sales_orders where qu_no = p_qu_no and tenant_id = v_tenant for update;
  if not found then raise exception 'ไม่พบออเดอร์ %', p_qu_no; end if;
  if v_order.status <> 'ปิดการขาย' then
    raise exception 'ออกใบลดหนี้บางส่วนได้เฉพาะออเดอร์ที่ปิดการขายแล้ว';
  end if;
  v_ref := coalesce(v_order.order_no, p_qu_no);

  v_kind := p_cn->>'kind';
  if v_kind is null or v_kind <> all (array['return','discount']) then raise exception 'เลือกว่าคืนสินค้าหรือลดราคา'; end if;
  v_reason := p_cn->>'reason';
  v_detail := coalesce(trim(p_cn->>'detail'), '');
  if v_reason is null or v_reason <> all (array['return','refund_advance','price_error','other']) then
    raise exception 'เลือกเหตุที่ออกใบลดหนี้';
  end if;
  if v_reason = 'other' and v_detail = '' then raise exception 'เหตุอื่น — พิมพ์อธิบายสั้น ๆ ว่าลดหนี้เพราะอะไร'; end if;
  v_date := coalesce(nullif(p_cn->>'date', '')::date, v_today);
  if v_date > v_today then raise exception 'วันที่ใบลดหนี้ต้องไม่เป็นวันในอนาคต'; end if;

  select coalesce(sum(t.amount_after_discount), 0), coalesce(sum(t.vat_amount), 0),
         max(coalesce(t.tax_invoice_date, t.transaction_date)), min(t.entity_id)
    into v_bill_pre, v_bill_vat, v_max_date, v_entity
    from ${BILLS};
  if v_bill_vat <= 0 then raise exception 'ออเดอร์นี้ไม่มีใบกำกับภาษีให้ลดหนี้'; end if;
  if v_date < v_max_date then raise exception 'วันที่ใบลดหนี้ต้องไม่ก่อนวันที่ใบกำกับเดิม (%)', v_max_date; end if;
  if not coalesce((select e.is_vat from entities e where e.tenant_id = v_tenant and e.entity_id = v_entity), false) then
    raise exception 'กิจการที่ออกใบกำกับไม่ได้จดทะเบียน VAT แล้ว — ออกใบลดหนี้ไม่ได้';
  end if;

  -- ★ ยอดที่ยังลดได้ = ใบกำกับทุกใบ − ใบลดหนี้ที่ออกไปแล้ว (ฝาแฝด partialRemaining ใน lib/sales/creditNote.ts)
  select round(v_bill_pre - coalesce(sum(cn.diff_value), 0), 2), round(v_bill_vat - coalesce(sum(cn.vat_amount), 0), 2)
    into v_rem_pre, v_rem_vat
    from sales_credit_notes cn where cn.tenant_id = v_tenant and cn.qu_no = p_qu_no;

  -- ★ ยอดคิดที่ lib (สูตรมีที่เดียว) · ที่นี่ตรวจแค่ขอบเขตและความสอดคล้อง — ยิง API ตรงก็ไม่รอด
  v_pre := round((p_cn->>'pre')::numeric, 2);
  v_vat := round((p_cn->>'vat')::numeric, 2);
  v_total := round((p_cn->>'total')::numeric, 2);
  v_wht := round(coalesce((p_cn->>'wht')::numeric, 0), 2);
  v_refund := round((p_cn->>'refund')::numeric, 2);
  if v_pre is null or v_pre <= 0 or v_vat is null or v_vat < 0 or v_wht < 0 then
    raise exception 'ยอดใบลดหนี้ไม่ถูกต้อง';
  end if;
  if round(v_pre + v_vat, 2) <> v_total or round(v_total - v_wht, 2) <> v_refund then
    raise exception 'ยอดใบลดหนี้ไม่สอดคล้องกัน (ก่อน VAT + VAT ต้องเท่ายอดรวม)';
  end if;
  if v_pre > v_rem_pre + 0.005 or v_vat > v_rem_vat + 0.005 then
    raise exception 'ลดได้ไม่เกินยอดที่เหลือ (ก่อน VAT % · VAT %)', v_rem_pre, v_rem_vat;
  end if;

  -- รายการที่คืน: ต้องเป็นของออเดอร์นี้ และไม่เกินจำนวนที่ยังไม่ได้คืน
  v_items := '[]'::jsonb;
  if v_kind = 'return' then
    if jsonb_array_length(coalesce(p_cn->'items', '[]'::jsonb)) = 0 then raise exception 'เลือกรายการที่ลูกค้าคืน'; end if;
    -- 🚨 รายการเดียวกันซ้ำในคำขอเดียว = ด่าน "ไม่เกินที่เหลือ" ข้างล่างนับแต่ใบเก่า → คืนเกินได้
    if (select count(*) from jsonb_array_elements(p_cn->'items')) <> (select count(distinct x->>'id') from jsonb_array_elements(p_cn->'items') x) then
      raise exception 'รายการที่คืนซ้ำกัน — รวมเป็นบรรทัดเดียว';
    end if;
    for it in select value from jsonb_array_elements(p_cn->'items') loop
      v_qty := (it->>'qty')::numeric;
      select soi.id, soi.item_name, soi.qty, soi.price into v_item from sales_order_items soi
        where soi.tenant_id = v_tenant and soi.qu_no = p_qu_no and soi.id = (it->>'id')::bigint;
      if not found then raise exception 'ไม่พบรายการ % ในออเดอร์นี้', it->>'id'; end if;
      select coalesce(sum((x->>'qty')::numeric), 0) into v_done
        from sales_credit_notes cn, jsonb_array_elements(cn.items) x
       where cn.tenant_id = v_tenant and cn.qu_no = p_qu_no and (x->>'id')::bigint = v_item.id;
      if v_qty is null or v_qty <= 0 or v_done + v_qty > v_item.qty + 0.000001 then
        raise exception '%: คืนได้ไม่เกิน %', v_item.item_name, v_item.qty - v_done;
      end if;
      v_items := v_items || jsonb_build_object('id', v_item.id, 'name', v_item.item_name, 'qty', v_qty, 'price', v_item.price);
    end loop;
  end if;

  v_acc := nullif(trim(p_cn->>'refund_account'), '');
  if v_acc is not null and not exists (select 1 from bank_accounts b where b.tenant_id = v_tenant and b.account_name = v_acc) then
    raise exception 'ไม่พบบัญชี % ที่ใช้คืนเงิน', v_acc;
  end if;

  select min(t.category) as cat, min(t.contact_name) as cname, min(t.contact_id) as cid,
         coalesce(max(t.wht_rate), 0) as wrate,
         jsonb_agg(jsonb_build_object('tx_id', t.tx_id, 'doc_no', t.tax_invoice_no,
                   'date', coalesce(t.tax_invoice_date, t.transaction_date),
                   'pre_vat', t.amount_after_discount, 'vat', t.vat_amount) order by t.transaction_date, t.tx_id) as refs,
         string_agg(t.tax_invoice_no, ', ' order by t.transaction_date, t.tx_id) as nos
    into s from ${BILLS};

  v_cn_no := fn_next_doc_no('sales_cn', null, v_date);
  v_cn_tx := next_tx_id();
  insert into transactions(
    tenant_id, tx_id, transaction_date, type, account_name, category, contact_name, contact_id,
    description, base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount,
    net_amount, tax_invoice_no, tax_invoice_date, status, entity_id, ap_ar_status, idempotency_key, source
  ) values (
    v_tenant, v_cn_tx, v_date, 'ลดหนี้ขาย', v_acc, s.cat, s.cname, s.cid,
    'ใบลดหนี้ ' || v_cn_no || ' (' || case v_kind when 'return' then 'คืนสินค้า' else 'ลดราคา' end
      || ') อ้างใบกำกับ ' || coalesce(s.nos, '-') || ' (' || v_ref || ')',
    v_pre, 0, v_pre, v_vat, s.wrate, v_wht, v_refund, v_cn_no, v_date, 'ปกติ', v_entity,
    case when v_acc is null then 'AP' end, 'CN:' || v_cn_no, 'sales'
  );

  v_restock := v_kind = 'return' and coalesce((p_cn->>'restock')::boolean, false);
  insert into sales_credit_notes(tenant_id, cn_no, qu_no, entity_id, cn_date, reason, detail, reason_text,
                                 refs, original_value, correct_value, diff_value, vat_amount, total_amount,
                                 refund_amount, wht_amount, refund_account, tx_id, kind, items, restocked)
  values (v_tenant, v_cn_no, p_qu_no, v_entity, v_date, v_reason, v_detail,
          coalesce(nullif(trim(p_cn->>'reason_text'), ''), v_reason),
          s.refs, v_rem_pre, round(v_rem_pre - v_pre, 2), v_pre, v_vat, v_total, v_refund, v_wht, v_acc, v_cn_tx,
          v_kind, v_items, v_restock);

  -- ── คืนเข้าสต็อก (ผู้ใช้เลือกทุกครั้ง) — คลัง + ฟอร์ม ภส. (สุรา = รับคืน) · ใช้แผนที่เมนูเดียวกับตอนส่งของ ──
  --   ★ อ้างอิงด้วยเลขใบลดหนี้ ไม่ใช่เลขออเดอร์ → ไม่ไปปนกับคู่ จ่าย/รับ ของการยกเลิก (D90/D91)
  if v_restock then
    for it in select value from jsonb_array_elements(v_items) loop
      select sm.product_id, coalesce(sm.multiplier, 1) as mult, sm.category into m
        from sale_menu sm
       where sm.tenant_id = v_tenant and sm.entity_id = v_order.entity_id and trim(sm.menu_name) = trim(it->>'name')
       limit 1;
      if m.product_id is null or trim(m.product_id) = '' then continue; end if;
      v_real := (it->>'qty')::numeric * m.mult;
      select qty into v_before from warehouse_stock
        where item_code = trim(m.product_id) and tenant_id = v_tenant and entity_id = v_order.entity_id for update;
      if found then
        v_after := coalesce(v_before, 0) + v_real;
        update warehouse_stock set qty = v_after
          where item_code = trim(m.product_id) and tenant_id = v_tenant and entity_id = v_order.entity_id;
        insert into stock_moves(tenant_id, entity_id, item_code, item_name, qty_before, action, qty,
                                ref_no, qty_after, user_name, remarks)
        values (v_tenant, v_order.entity_id, trim(m.product_id), it->>'name', coalesce(v_before, 0), 'IN', v_real,
                v_cn_no, v_after, 'system', 'รับคืนสินค้า: ใบลดหนี้ ' || v_cn_no || ' (' || v_ref || ')');
      end if;
      if m.category = 'สุรา' and v_real > 0 then
        v_liquor := true;
        insert into log_product(tenant_id, entity_id, doc_date, trans_type, product_id, amount, note, ref_no)
        values (v_tenant, v_order.entity_id, v_date, 'รับ', trim(m.product_id), v_real,
                'รับคืนสินค้า ใบลดหนี้ ' || v_cn_no || ' (' || v_ref || ')', v_cn_no);
      end if;
    end loop;
    -- เดือนที่ปิดบัญชีสรรพสามิตไปแล้ว → บอกกลับให้หน้าจอเตือน (ไม่บล็อก · แพตเทิร์น D91)
    if v_liquor then
      select array_agg(c.month) into v_locked from excise_month_close c
       where c.tenant_id = v_tenant and c.entity_id = v_order.entity_id
         and c.month = to_char(v_date, 'YYYY-MM') and c.reopened_at is null;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'cn_no', v_cn_no,
    'excise_locked_months', coalesce(to_jsonb(v_locked), '[]'::jsonb));
end $$;`;
assertNoDuplicateDeclare("fn_sales_credit_note", partial);

const sql = `-- ════════════════════════════════════════════════════════════════════════════
-- 0107 — D160: ใบลดหนี้บางส่วน (คืนบางรายการ / ลดราคา) โดยไม่ยกเลิกออเดอร์ · เฟส 2 ของ D159
--
-- ★ ผู้ใช้ตัดสิน: ออกได้เฉพาะออเดอร์ "ปิดการขาย" · เลือกรายการ+จำนวน หรือกรอกยอด · คืนเข้าสต็อกเลือกทุกครั้ง
-- ★ ยอดคิดที่ lib/sales/creditNote.ts (partialTotals) ที่เดียว · RPC ตรวจขอบเขต/ความสอดคล้องเท่านั้น
-- ★ มีใบลดหนี้บางส่วนแล้ว = ยกเลิกทั้งออเดอร์ไม่ได้ (คืนสต็อก/ภาษีซ้ำ) → ออกใบลดหนี้ส่วนที่เหลือแทน
-- 🚨 fn_cancel_order ยกจาก ${cancel.file} ด้วย scripts/gen-0107.mjs (เติมด่านจุดเดียว)
-- ════════════════════════════════════════════════════════════════════════════

alter table sales_credit_notes
  add column if not exists kind text not null default 'cancel' check (kind in ('cancel','return','discount')),
  add column if not exists items jsonb not null default '[]'::jsonb,   -- [{id, name, qty, price}] รายการที่คืน
  add column if not exists restocked boolean not null default false;    -- คืนเข้าสต็อกแล้ว (คลัง + ฟอร์ม ภส.)

comment on column sales_credit_notes.kind is
  'D160 — cancel = ยกเลิกทั้งออเดอร์ (D159) · return = คืนบางรายการ · discount = ลดราคา';

-- ── fn_cancel_order — ยกจาก ${cancel.file} · เติมด่าน "มีใบลดหนี้บางส่วนแล้ว" ──
${c}

-- ── fn_sales_credit_note — ใหม่ ──
${partial}
`;
fs.writeFileSync(OUT, sql);
const a = cancel.body.split("\n"), b = c.split("\n");
console.log("เขียน", OUT, `· fn_cancel_order (${cancel.file}) ลบ ${a.filter((l) => !b.includes(l)).length} เพิ่ม ${b.filter((l) => !a.includes(l)).length}`);
