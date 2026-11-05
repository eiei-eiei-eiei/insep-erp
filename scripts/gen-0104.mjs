/**
 * สร้าง migration 0104 (D156) — ยก fn_apply_order_action จาก 0101 มาทั้งตัว แล้วเติมบรรทัดเดียว
 * ★ ยกด้วยสคริปต์ไม่พิมพ์มือ (บทเรียน D79) · ตรวจว่ายกตรงก่อนเขียนไฟล์
 * ใช้: node scripts/gen-0104.mjs
 */
import fs from "node:fs";

const SRC = "supabase/migrations/20261030000101_sales_installments.sql";
const OUT = "supabase/migrations/20261105000104_sales_inv_paid_before.sql";

const src = fs.readFileSync(SRC, "utf8");
const start = src.indexOf("create or replace function fn_apply_order_action(");
const end = src.indexOf("end $$;", start) + "end $$;".length;
if (start < 0 || end < start) throw new Error("หา fn_apply_order_action ใน 0101 ไม่เจอ");
const orig = src.slice(start, end);

// ต้องเป็นไฟล์ล่าสุดที่นิยามฟังก์ชันนี้ (บทเรียน D95: ไฟล์ที่จำได้ ≠ ไฟล์ล่าสุด)
const later = fs.readdirSync("supabase/migrations").filter((f) => f > SRC.split("/").pop() && f !== OUT.split("/").pop())
  .filter((f) => fs.readFileSync(`supabase/migrations/${f}`, "utf8").includes("function fn_apply_order_action("));
if (later.length) throw new Error("มีไฟล์ที่นิยามฟังก์ชันนี้ใหม่กว่า 0101: " + later.join(", "));

const anchor = "    dep_due_date        = coalesce(_d(p_update,'depDueDate'), dep_due_date)\n";
if (orig.split(anchor).length !== 2) throw new Error("หาบรรทัด dep_due_date ไม่เจอ/เจอเกิน 1");
const lifted = orig.replace(
  anchor,
  "    dep_due_date        = coalesce(_d(p_update,'depDueDate'), dep_due_date),\n" +
    "    -- D156 — ยอดรับชำระแล้ว ณ วันออกใบแจ้งหนี้/ใบส่งสินค้า (ออเดอร์แบ่งงวด) · เขียนครั้งเดียวตอนออกเลข\n" +
    "    inv_paid_before     = coalesce((p_update->>'invPaidBefore')::numeric, inv_paid_before)\n",
);

const sql = `-- 0104 · D156 — ใบแจ้งหนี้/ใบส่งสินค้าของออเดอร์แบ่งงวด พิมพ์ซ้ำแล้วยอดต้องเท่าวันที่ออก
--
-- 🔴 เดิมตัวพิมพ์หัก "รับชำระแล้ว" ด้วย sales_orders.deposit **ปัจจุบัน** (ยอดรับรวมถึงวันนี้)
--    ⇒ ส่งของหลังงวด 1 แล้วรับครบ · พิมพ์ใบแจ้งหนี้ซ้ำ = หักทุกงวด คงค้าง 0.00 ไม่ตรงใบที่ลูกค้าถือ
-- ★ แช่ยอด ณ ตอนออกเลขใบแจ้งหนี้ (ตัวเลขบนเอกสารที่ออกแล้วต้องเป็นค่าที่แช่ไว้ · D69/D75/D90)
--   processOrder (lib/sales/orders.ts) ส่ง invPaidBefore มาเฉพาะตอนออกเลข inv_no ของออเดอร์แบ่งงวด
--   ว่าง (null) = ไม่รู้ → ตัวพิมพ์ใช้ deposit แบบเดิม (ไม่เดา)

alter table sales_orders add column if not exists inv_paid_before numeric(14,2);
comment on column sales_orders.inv_paid_before is
  'D156 — ยอดรับชำระแล้ว ณ วันออกใบแจ้งหนี้/ใบส่งสินค้า (ออเดอร์แบ่งงวด) · null = ไม่รู้ ใช้ deposit';

-- ── fn_apply_order_action — ยกจาก 20261030000101_sales_installments.sql ───────────────
--    แก้จุดเดียว: เขียน inv_paid_before (สร้างด้วย scripts/gen-0104.mjs)
${lifted}

-- ── backfill ออเดอร์แบ่งงวดที่ออกใบแจ้งหนี้ไปแล้ว ─────────────────────────────────────
-- เวลาที่ออกเลข = แถวแรกใน edit_log ที่ inv_no เปลี่ยนจากว่างเป็นมีค่า (trigger audit_sales_orders · 0005)
-- ยอดที่รับแล้ว = การรับเงินที่บันทึกไม่หลังเวลานั้น
--   ★ fn_apply_order_action แก้ออเดอร์กับเขียน sales_payments ใน transaction เดียว → now() เท่ากัน
--     ⇒ งวดที่เป็นจุดส่งของ (รับเงินพร้อมออกใบ) ถูกนับด้วย ตรงกับ processOrder
-- 🚨 หาเวลาไม่เจอ = ปล่อยว่าง (ตัวพิมพ์ใช้ deposit แบบเดิม) — ไม่เดาตัวเลข
update sales_orders o
   set inv_paid_before = (
         select coalesce(sum(p.amount), 0) from sales_payments p
          where p.tenant_id = o.tenant_id and p.qu_no = o.qu_no and p.created_at <= e.at)
  from (
    select el.tenant_id, el.row_pk, min(el.created_at) as at
      from edit_log el
     where el.table_name = 'sales_orders' and el.action = 'update'
       and coalesce(el.before ->> 'inv_no', '') = ''
       and coalesce(el.after ->> 'inv_no', '') <> ''
     group by el.tenant_id, el.row_pk
  ) e
 where e.tenant_id = o.tenant_id and e.row_pk = o.qu_no
   and o.inv_no is not null and o.inv_paid_before is null
   and exists (select 1 from sales_installments i where i.tenant_id = o.tenant_id and i.qu_no = o.qu_no);
`;

fs.writeFileSync(OUT, sql);

// ── ตรวจ: ฟังก์ชันที่เขียนลงไฟล์ ต่างจากต้นฉบับแค่บรรทัดที่ตั้งใจ ──
const outFn = fs.readFileSync(OUT, "utf8");
const s2 = outFn.indexOf("create or replace function fn_apply_order_action(");
const got = outFn.slice(s2, outFn.indexOf("end $$;", s2) + "end $$;".length);
const a = orig.split("\n"), b = got.split("\n");
const extra = b.filter((l) => !a.includes(l));
const missing = a.filter((l) => !b.includes(l));
if (missing.length !== 1 || !missing[0].includes("dep_due_date") || extra.length !== 3) {
  throw new Error("ยกฟังก์ชันไม่ตรง: missing=" + JSON.stringify(missing) + " extra=" + JSON.stringify(extra));
}
console.log("เขียน", OUT, "· ต่างจาก 0101 เฉพาะ:", extra);
