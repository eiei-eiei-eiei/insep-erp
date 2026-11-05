/**
 * สร้าง migration 0106 (D159 ใบลดหนี้) — ยกฟังก์ชันเดิมด้วยสคริปต์ แล้วแก้เฉพาะจุด (บทเรียน D79/D95)
 * ทุกฟังก์ชัน: ต้องเป็นไฟล์ล่าสุดที่นิยาม · ทุกจุดที่แทนต้องเจอพอดี 1 ครั้ง
 * ใช้: node scripts/gen-0106.mjs
 */
import fs from "node:fs";

const DIR = "supabase/migrations";
const OUT = `${DIR}/20261105000106_sales_credit_note.sql`;
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql") && f !== OUT.split("/").pop()).sort();

/** ยกนิยามล่าสุดของฟังก์ชัน (ถึงบรรทัดปิด) */
function lift(name, endTag) {
  const head = `create or replace function ${name}(`;
  const f = [...files].reverse().find((x) => fs.readFileSync(`${DIR}/${x}`, "utf8").includes(head));
  if (!f) throw new Error(`ไม่พบ ${name}`);
  const src = fs.readFileSync(`${DIR}/${f}`, "utf8").replace(/\r\n/g, "\n");
  const s = src.indexOf(head);
  const e = src.indexOf(endTag, s) + endTag.length;
  return { file: f, body: src.slice(s, e) };
}
function rep(body, a, b, label) {
  const n = body.split(a).length - 1;
  if (n !== 1) throw new Error(`${label}: ต้องเจอ 1 ครั้ง เจอ ${n} — ${a.slice(0, 70)}`);
  return body.replace(a, b);
}

// ── 1) fn_doc_types / fn_doc_default — เพิ่ม sales_cn ───────────────────────────
const types = lift("fn_doc_types", "$$;");
const typesNew = rep(types.body, "'sales_rcpt','bar_bill'", "'sales_rcpt','sales_cn','bar_bill'", "fn_doc_types");

const def = lift("fn_doc_default", "$$;");
let defNew = rep(def.body, "when p_type in ('sales_qu','sales_ord','sales_inv','sales_tax','sales_rcpt','bar_bill','bar_rcpt') then",
  "when p_type in ('sales_qu','sales_ord','sales_inv','sales_tax','sales_rcpt','sales_cn','bar_bill','bar_rcpt') then", "fn_doc_default/in");
defNew = rep(defNew, "when 'sales_tax' then 'TAX' when 'sales_rcpt' then 'RC'",
  "when 'sales_tax' then 'TAX' when 'sales_rcpt' then 'RC' when 'sales_cn' then 'CN'", "fn_doc_default/prefix");

// ── 2) fn_doc_nos — เลขใบลดหนี้นับเป็นเลขเอกสารขายที่ใช้แล้ว ─────────────────────
const nos = lift("fn_doc_nos", "$$;");
const nosNew = rep(nos.body,
  "    select doc_no from sales_payments where left(p_type, 6) = 'sales_' and tenant_id = p_tenant\n",
  "    select doc_no from sales_payments where left(p_type, 6) = 'sales_' and tenant_id = p_tenant\n" +
  "    union all\n" +
  "    -- ★ D159 — ใบลดหนี้ (เลขชุดของตัวเอง แต่กันเลขซ้ำร่วมกับเอกสารขายทุกใบเหมือนชุดอื่น)\n" +
  "    select cn_no from sales_credit_notes where left(p_type, 6) = 'sales_' and tenant_id = p_tenant\n",
  "fn_doc_nos");

// ── 3) fn_mig_truncate — ตารางใหม่ก่อน sales_orders ─────────────────────────────
const trunc = lift("fn_mig_truncate", "end $fn$;");
const truncNew = rep(trunc.body, "'sales_payments','sales_installments','sales_order_items','sales_orders'",
  "'sales_credit_notes','sales_payments','sales_installments','sales_order_items','sales_orders'", "fn_mig_truncate");

// ── 4) fn_cancel_order — รับข้อมูลใบลดหนี้ (p_credit) ───────────────────────────
const cancel = lift("fn_cancel_order", "end $$;");
let c = rep(cancel.body, "create or replace function fn_cancel_order(p_qu_no text)\n",
  "create function fn_cancel_order(p_qu_no text, p_credit jsonb default null)\n", "cancel/sig");
c = rep(c, "  v_tenant uuid := my_tenant();\nbegin\n",
  "  v_tenant uuid := my_tenant();\n" +
  "  -- D159 — ใบลดหนี้\n" +
  "  v_today date := (now() at time zone 'Asia/Bangkok')::date;\n" +
  "  v_has_vat boolean; v_cn_required boolean;\n" +
  "  v_cn_no text; v_cn_date date; v_cn_tx text; v_reason text; v_detail text; v_acc text;\n" +
  "  v_min_date date; v_entity text; s record;\n" +
  "begin\n", "cancel/declare");

const STEP1 = `  -- 1) void รายรับที่ลงบัญชีแล้ว (deposit + balance)
  update transactions set status = 'ยกเลิก'
    where tenant_id = v_tenant
      and (idempotency_key in (v_ref, v_ref || '-balance')
           -- ★ D145 — บิลของทุกงวด (key ไม่ใช่ ref/-balance) ตามแถวการรับเงิน
           or tx_id in (select p.tx_id from sales_payments p
                         where p.tenant_id = v_tenant and p.qu_no = p_qu_no and p.tx_id is not null))
      and status <> 'ยกเลิก';
`;
const BILLS = `transactions t
     where t.tenant_id = v_tenant and t.status <> 'ยกเลิก'
       and (t.idempotency_key in (v_ref, v_ref || '-balance')
            or t.tx_id in (select p.tx_id from sales_payments p
                            where p.tenant_id = v_tenant and p.qu_no = p_qu_no and p.tx_id is not null))`;
const STEP1_NEW = `  -- ★ D159 — ใบกำกับที่มี VAT ของออเดอร์นี้: อยู่งวดที่ยื่น ภพ.30 แล้ว หรือเดือนก่อน = ห้ามยกเลิกแบบเดิม
  --   (ภาษีขายจะหายจากงวดเดิมย้อนหลัง) ต้องออกใบลดหนี้ · ฝาแฝด TS: cancelMode() ใน lib/sales/creditNote.ts
  select exists (select 1 from ${BILLS} and t.vat_amount > 0),
         exists (select 1 from ${BILLS} and t.vat_amount > 0
                   and (to_char(t.transaction_date, 'YYYY-MM') <> to_char(v_today, 'YYYY-MM')
                        or exists (select 1 from tax_filings f
                                    where f.tenant_id = v_tenant and f.entity_id = t.entity_id and f.kind = 'vat'
                                      and f.period = to_char(t.transaction_date, 'YYYY-MM') and f.reopened_at is null)))
    into v_has_vat, v_cn_required;

  if p_credit is null then
    if v_cn_required then
      raise exception 'ออเดอร์นี้มีใบกำกับภาษีในเดือนก่อน หรือเดือนที่ยื่น ภ.พ.30 แล้ว — ยกเลิกแบบเดิมจะทำให้ภาษีขายหายจากงวดเดิม ต้องออกใบลดหนี้';
    end if;
${STEP1}  else
    -- ── ออกใบลดหนี้ (ม.86/10) · บิลรายรับเดิมคงสถานะปกติ ⇒ ภพ.30 งวดเดิมไม่ขยับ ──
    if not v_has_vat then raise exception 'ออเดอร์นี้ไม่มีใบกำกับภาษีให้ลดหนี้ — ยกเลิกแบบเดิมได้เลย'; end if;
    v_reason := p_credit->>'reason';
    v_detail := coalesce(trim(p_credit->>'detail'), '');
    if v_reason is null or v_reason <> all (array['return','refund_advance','price_error','other']) then
      raise exception 'เลือกเหตุที่ออกใบลดหนี้';
    end if;
    if v_reason = 'other' and v_detail = '' then raise exception 'เหตุอื่น — พิมพ์อธิบายสั้น ๆ ว่าลดหนี้เพราะอะไร'; end if;
    v_cn_date := coalesce(nullif(p_credit->>'date', '')::date, v_today);
    if v_cn_date > v_today then raise exception 'วันที่ใบลดหนี้ต้องไม่เป็นวันในอนาคต'; end if;
    select max(coalesce(t.tax_invoice_date, t.transaction_date)), min(t.entity_id) into v_min_date, v_entity
      from ${BILLS} and t.vat_amount > 0;
    if v_cn_date < v_min_date then raise exception 'วันที่ใบลดหนี้ต้องไม่ก่อนวันที่ใบกำกับเดิม (%)', v_min_date; end if;
    if not coalesce((select e.is_vat from entities e where e.tenant_id = v_tenant and e.entity_id = v_entity), false) then
      raise exception 'กิจการที่ออกใบกำกับไม่ได้จดทะเบียน VAT แล้ว — ออกใบลดหนี้ไม่ได้';
    end if;
    v_acc := nullif(trim(p_credit->>'refund_account'), '');
    if v_acc is not null and not exists (select 1 from bank_accounts b where b.tenant_id = v_tenant and b.account_name = v_acc) then
      raise exception 'ไม่พบบัญชี % ที่ใช้คืนเงิน', v_acc;
    end if;

    -- ★ ยอด = ผลรวมของที่บันทึกไว้ในบิลเดิมตรง ๆ (ไม่ถอด VAT ใหม่ — สูตรเงินมีที่เดียว)
    select coalesce(sum(t.base_amount), 0) as base, coalesce(sum(t.discount), 0) as disc,
           coalesce(sum(t.amount_after_discount), 0) as pre, coalesce(sum(t.vat_amount), 0) as vat,
           coalesce(max(t.wht_rate), 0) as wrate, coalesce(sum(t.wht_amount), 0) as wht,
           coalesce(sum(t.net_amount), 0) as net,
           min(t.category) as cat, min(t.contact_name) as cname, min(t.contact_id) as cid,
           jsonb_agg(jsonb_build_object('tx_id', t.tx_id, 'doc_no', t.tax_invoice_no,
                     'date', coalesce(t.tax_invoice_date, t.transaction_date),
                     'pre_vat', t.amount_after_discount, 'vat', t.vat_amount) order by t.transaction_date, t.tx_id) as refs,
           string_agg(t.tax_invoice_no, ', ' order by t.transaction_date, t.tx_id) as nos
      into s from ${BILLS} and t.vat_amount > 0;

    v_cn_no := fn_next_doc_no('sales_cn', null, v_cn_date);
    v_cn_tx := next_tx_id();
    insert into transactions(
      tenant_id, tx_id, transaction_date, type, account_name, category, contact_name, contact_id,
      description, base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount,
      net_amount, tax_invoice_no, tax_invoice_date, status, entity_id, ap_ar_status, idempotency_key, source
    ) values (
      v_tenant, v_cn_tx, v_cn_date, 'ลดหนี้ขาย', v_acc, s.cat, s.cname, s.cid,
      'ใบลดหนี้ ' || v_cn_no || ' อ้างใบกำกับ ' || coalesce(s.nos, '-') || ' (ยกเลิก ' || v_ref || ')',
      s.base, s.disc, s.pre, s.vat, s.wrate, s.wht, s.net, v_cn_no, v_cn_date, 'ปกติ', v_entity,
      case when v_acc is null then 'AP' end, 'CN:' || v_ref, 'sales'
    );
    insert into sales_credit_notes(tenant_id, cn_no, qu_no, entity_id, cn_date, reason, detail, reason_text,
                                   refs, original_value, correct_value, diff_value, vat_amount, total_amount,
                                   refund_amount, wht_amount, refund_account, tx_id)
    values (v_tenant, v_cn_no, p_qu_no, v_entity, v_cn_date, v_reason, v_detail,
            coalesce(nullif(trim(p_credit->>'reason_text'), ''), v_reason),
            s.refs, s.pre, 0, s.pre, s.vat, round(s.pre + s.vat, 2), s.net, s.wht, v_acc, v_cn_tx);
  end if;
`;
c = rep(c, STEP1, STEP1_NEW, "cancel/step1");
c = rep(c, "    'ok', true, 'reversed_stock', v_reversed,\n",
  "    'ok', true, 'reversed_stock', v_reversed, 'cn_no', v_cn_no,\n", "cancel/return");

const sql = `-- ════════════════════════════════════════════════════════════════════════════
-- 0106 — D159: ใบลดหนี้ตอนยกเลิกออเดอร์ (เฟส 1 = ลดทั้งออเดอร์)
--
-- 🔴 เดิม fn_cancel_order เปลี่ยนบิลรายรับเป็น 'ยกเลิก' ⇒ ภาษีขายหายจากเดือนที่ออกใบกำกับย้อนหลัง
--    ทั้งที่งวดนั้นอาจยื่น ภพ.30 ไปแล้ว · กฎหมาย (ม.82/10 · ป.80/2542 ข้อ 5) ให้หักในเดือนที่ออกใบลดหนี้
-- ★ ใบกำกับที่มี VAT อยู่งวดที่ยื่นแล้ว/เดือนก่อน → ยกเลิกแบบเดิมไม่ได้ ต้องส่ง p_credit
--   เดือนเดียวกัน + ยังไม่ยื่น → เลือกได้ (ผู้ใช้ตัดสิน · ป.86/2542 ข้อ 25 เรียกใบเดิมคืน)
-- ★ ใบลดหนี้ = บิล type 'ลดหนี้ขาย' ลงวันที่ใบลดหนี้ + แถว sales_credit_notes (ข้อมูลพิมพ์ตาม ม.86/10)
--   บิลรายรับเดิมคงสถานะปกติ · สต็อก/ฟอร์ม ภส. ใช้ตรรกะยกเลิกเดิมทั้งหมด
-- ★ เลขชุดใหม่ sales_cn (ค่าปริยาย CN-YYMMDD-001) กันเลขซ้ำร่วมกับเอกสารขายเหมือนชุดอื่น
-- 🚨 ฟังก์ชันเดิมยกด้วย scripts/gen-0106.mjs (ตรวจไฟล์ล่าสุด + จุดแทนต้องเจอ 1 ครั้ง):
--    fn_doc_types/fn_doc_default (${types.file}) · fn_doc_nos (${nos.file})
--    fn_mig_truncate (${trunc.file}) · fn_cancel_order (${cancel.file})
-- 🪤 fn_cancel_order เปลี่ยนพารามิเตอร์ = ต้อง drop ก่อน ไม่งั้นเกิด overload ตัวที่ 2 (D69)
-- ════════════════════════════════════════════════════════════════════════════

alter table transactions drop constraint if exists transactions_type_check;
alter table transactions add constraint transactions_type_check
  check (type in ('รายรับ','รายจ่าย','โอนระหว่างบัญชี','เช็คราคา','บันทึกภาษี','สำรองจ่าย','รับคืนสำรองจ่าย','ลดหนี้ขาย'));

create table sales_credit_notes (
  tenant_id      uuid not null default my_tenant() references tenants(id) on delete cascade,
  cn_no          text not null,
  qu_no          text not null,
  entity_id      text not null,
  cn_date        date not null,
  reason         text not null check (reason in ('return','refund_advance','price_error','other')),
  detail         text not null default '',
  reason_text    text not null,                 -- ข้อความเหตุบนใบ (ม.86/10(6)) ประกอบที่ lib/sales/creditNote
  refs           jsonb not null,                -- ใบกำกับเดิม [{tx_id, doc_no, date, pre_vat, vat}] (ม.86/10(5))
  original_value numeric(14,2) not null,        -- มูลค่าเดิม (ก่อน VAT)
  correct_value  numeric(14,2) not null,        -- มูลค่าที่ถูกต้อง (เฟส 1 = 0)
  diff_value     numeric(14,2) not null,        -- ผลต่าง
  vat_amount     numeric(14,2) not null,        -- ภาษีของผลต่าง
  total_amount   numeric(14,2) not null,
  refund_amount  numeric(14,2) not null,        -- ยอดที่คืนจริง (หลังหัก ณ ที่จ่ายที่ลูกค้าหักไว้)
  wht_amount     numeric(14,2) not null default 0,
  refund_account text,                          -- null = ยังไม่คืน (บิลค้างจ่าย)
  tx_id          text not null,
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  primary key (tenant_id, cn_no),
  foreign key (tenant_id, qu_no) references sales_orders (tenant_id, qu_no) on delete cascade
);
create index sales_credit_notes_qu on sales_credit_notes (tenant_id, qu_no);

alter table sales_credit_notes enable row level security;
-- เหมือน sales_payments: ฝั่งบัญชีอ่านได้ด้วย · ไม่มี policy เขียน (ทางเดียวคือ fn_cancel_order)
create policy sales_credit_notes_sel on sales_credit_notes for select
  using (tenant_id = my_tenant() and (has_cap('sales.read') or has_cap('acct.read')));
-- D118 — grant ในไฟล์เดียวกับ create table เสมอ
grant select, insert, update, delete on table public.sales_credit_notes to authenticated, service_role;

-- ── fn_doc_types — ยกจาก ${types.file} · เติม sales_cn ──
${typesNew}

-- ── fn_doc_default — ยกจาก ${def.file} · เติม sales_cn (CN) ──
${defNew}

-- ── fn_doc_nos — ยกจาก ${nos.file} · เติมเลขใบลดหนี้ ──
${nosNew}

-- ── fn_mig_truncate — ยกจาก ${trunc.file} · เติม sales_credit_notes ก่อน sales_orders ──
${truncNew}
-- 🚨 D99: fn_mig_truncate ถูกนิยามใหม่ในไฟล์นี้ → revoke ซ้ำ (revoke from public อย่างเดียวไม่มีผลบน Supabase)
revoke execute on function fn_mig_truncate(uuid) from public, anon, authenticated;

-- ── fn_cancel_order — ยกจาก ${cancel.file} · เติมใบลดหนี้ (p_credit) ──
drop function if exists fn_cancel_order(text);
${c}
`;
/**
 * 🪤 ด่านก่อนเขียนไฟล์: ตัวแปรใน declare ห้ามซ้ำ (รอบแรกเพิ่ม v_locked ทับตัวเดิมของ D91
 *    → db push ล้มด้วย "duplicate declaration" · เทส TS มองไม่เห็นเพราะ plpgsql คอมไพล์ตอนลง DB)
 */
function assertNoDuplicateDeclare(name, body) {
  const decl = body.slice(body.indexOf("\ndeclare\n") + 9, body.indexOf("\nbegin\n"));
  const names = decl.replace(/--[^\n]*/g, "").split(";")
    .map((s) => s.trim().match(/^([a-z_][a-z0-9_]*)\s/i)?.[1]?.toLowerCase())
    .filter(Boolean);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) throw new Error(`${name}: ตัวแปรประกาศซ้ำ ${[...new Set(dup)].join(", ")}`);
}
assertNoDuplicateDeclare("fn_cancel_order", c);
assertNoDuplicateDeclare("fn_mig_truncate", truncNew);

fs.writeFileSync(OUT, sql);
console.log("เขียน", OUT);
for (const [n, o, x] of [["fn_doc_types", types, typesNew], ["fn_doc_default", def, defNew], ["fn_doc_nos", nos, nosNew], ["fn_mig_truncate", trunc, truncNew], ["fn_cancel_order", cancel, c]]) {
  const a = o.body.split("\n"), b = x.split("\n");
  console.log(`  ${n} (${o.file}): ลบ ${a.filter((l) => !b.includes(l)).length} บรรทัด · เพิ่ม ${b.filter((l) => !a.includes(l)).length} บรรทัด`);
}
