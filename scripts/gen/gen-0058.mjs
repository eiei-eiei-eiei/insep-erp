/**
 * สร้าง migration 0058 โดยยก fn_cancel_order จาก 0057 มาทั้งดุ้น แล้วแทรกเฉพาะบรรทัดที่ตั้งใจ
 * — ไม่พิมพ์มือ (บทเรียน D79: ยก plpgsql ด้วยมือแล้วพลาด = ฟีเจอร์ไม่เคยทำงานเลย)
 *
 * รัน:  node scripts/gen/gen-0058.mjs
 */
import fs from "node:fs";

const SRC = "supabase/migrations/20260901000057_excise_hide_cancelled.sql";
const TRUNC_SRC = "supabase/migrations/20260901000054_tax_payments.sql";
const OUT = "supabase/migrations/20260901000058_excise_month_close.sql";
const src = fs.readFileSync(SRC, "utf8");

function lift(text, name) {
  const start = text.indexOf(`create or replace function ${name}(`);
  if (start < 0) throw new Error("ไม่พบ " + name);
  const end = text.indexOf("\nend $$;\n", start);
  if (end < 0) throw new Error("ไม่พบจุดจบของ " + name);
  return text.slice(start, end + "\nend $$;\n".length);
}

let cancel = lift(src, "fn_cancel_order");

// ── 1) ตัวแปรใน declare: เลิกใช้ v_sale_month/v_now_month/v_reported ─────────
const aDecl = `  -- D90 — ตัวช่วยตัดสินว่าจะซ่อนคู่ จ่าย/รับ ออกจากฟอร์ม ภส. หรือไม่
  v_sale_month text; v_now_month text := to_char(current_date,'YYYY-MM'); v_reported boolean;`;
if (!cancel.includes(aDecl)) throw new Error("ไม่พบ declare ของ D90");
cancel = cancel.replace(
  aDecl,
  `  -- D91 — ซ่อนคู่ จ่าย/รับ ออกจากฟอร์ม ภส. ได้ไหม (คำถามอยู่ที่ fn_excise_months_open ที่เดียว)
  v_hide boolean := false; v_locked text[];`,
);

// ── 2) บล็อกตัดสิน: เลิกถาม report_runs → ถาม "เดือนนี้ปิดหรือยัง" ───────────
const aBlock = `    /*
     * D90 — ยกเลิกแล้วต้องไม่ไปกวนฟอร์มสรรพสามิต **แต่ห้ามแก้ฟอร์มที่ออกไปแล้ว**
     *
     * ★ ตัดสิน ณ ตอนกดยกเลิก แล้วแช่ผลไว้ในคอลัมน์ — ห้ามไปตัดสินตอนเปิดดูฟอร์ม
     *   ไม่งั้นพอเดือนนั้นถูกออกรายงานทีหลัง แถวจะโผล่กลับมาเอง = ฟอร์มเปลี่ยนย้อนหลังอีกแบบ
     * 🚨 ซ่อนได้เฉพาะเมื่อ **ทั้งเดือนที่ขายและเดือนที่ยกเลิก** ยังไม่เคยออกรายงาน ภส. เลย
     *   (ยื่นได้ถึงวันที่ 15 ของเดือนถัดไป จึงดูที่ "ออกรายงานหรือยัง" ไม่ใช่ดูปฏิทิน)
     * ★ ซ่อนเป็นคู่ที่หักล้างกันพอดีเสมอ → ยอดคงเหลือบนฟอร์มยังตรงกับสต็อกจริง
     */
    select to_char(min(doc_date),'YYYY-MM') into v_sale_month
      from log_product
      where tenant_id = v_tenant and ref_no = v_ref and trans_type <> 'รับ';

    v_reported := exists (
      select 1 from report_runs
      where tenant_id = v_tenant and entity_id = v_order.entity_id
        and report_key like 'phor\\_so\\_%'
        and month in (coalesce(v_sale_month, v_now_month), v_now_month)
    );

    if not v_reported then
      update log_product set excise_hidden = true
        where tenant_id = v_tenant and ref_no = v_ref;
    end if;`;
if (!cancel.includes(aBlock)) throw new Error("ไม่พบบล็อกตัดสินของ D90");
cancel = cancel.replace(
  aBlock,
  `    /*
     * D91 — ยกเลิกแล้วต้องไม่ไปกวนฟอร์มสรรพสามิต **แต่ห้ามแก้ฟอร์มที่ยื่นไปแล้ว**
     *
     * ★ ตัดสิน ณ ตอนกดยกเลิก แล้วแช่ผลไว้ในคอลัมน์ — ห้ามไปตัดสินตอนเปิดดูฟอร์ม
     *   ไม่งั้นพอเดือนนั้นถูกปิดทีหลัง แถวจะโผล่กลับมาเอง = ฟอร์มเปลี่ยนย้อนหลังอีกแบบ
     * 🚨 **เลิกถาม report_runs แล้ว** (D90 ถามผิดตาราง — นั่นคือเช็กลิสต์ ไม่ใช่ตัวล็อก)
     *   คำถามที่ถูกคือ "เดือนนั้นถูกปิดบัญชีสรรพสามิตหรือยัง" ซึ่งผู้ใช้ประกาศเอง
     * ★ คำถามอยู่ที่ fn_excise_months_open() ที่เดียว — ใช้ร่วมกับ fn_excise_recompute_hidden
     * ★ ซ่อนเป็นคู่ที่หักล้างกันพอดีเสมอ → ยอดคงเหลือบนฟอร์มยังตรงกับสต็อกจริง
     */
    v_hide := fn_excise_months_open(v_tenant, v_order.entity_id, v_ref);

    if v_hide then
      update log_product set excise_hidden = true
        where tenant_id = v_tenant and ref_no = v_ref;
    else
      -- เดือนไหนบ้างที่ปิดไปแล้ว — ส่งกลับให้หน้าจอขายบอกผู้ใช้ว่าต้องทำอะไรต่อ
      select array_agg(distinct m order by m) into v_locked
        from (
          select to_char(lp.doc_date,'YYYY-MM') as m
          from log_product lp
          where lp.tenant_id = v_tenant and lp.ref_no = v_ref
        ) t
        where exists (
          select 1 from excise_month_close c
          where c.tenant_id = v_tenant and c.entity_id = v_order.entity_id
            and c.month = t.m and c.reopened_at is null
        );
    end if;`,
);

// ── 3) return: บอกผลให้หน้าจอ ────────────────────────────────────────────────
const aRet = `  return jsonb_build_object('ok', true, 'reversed_stock', v_reversed);`;
if (!cancel.includes(aRet)) throw new Error("ไม่พบ return ของ fn_cancel_order");
cancel = cancel.replace(
  aRet,
  `  return jsonb_build_object(
    'ok', true, 'reversed_stock', v_reversed,
    'excise_hidden', v_hide,
    'excise_locked_months', coalesce(to_jsonb(v_locked), '[]'::jsonb));`,
);

// ── 4) fn_mig_truncate: ยกจาก 0054 มาทั้งดุ้น เติมตารางใหม่ ──────────────────
//    🚨 ตกตารางใหม่ = **ลบ/รีเซ็ตลูกค้าไม่ได้เลย** (ติด FK ของ tenants/entities · D79/D82)
//    ★ ต้องอยู่ **ก่อน** 'entities' เพราะมี FK ชี้ไป entities (บทเรียน 0050)
let trunc = lift(fs.readFileSync(TRUNC_SRC, "utf8"), "fn_mig_truncate");
const aTrunc = `    'report_runs',
    'entities',`;
if (!trunc.includes(aTrunc)) throw new Error("ไม่พบจุดแทรกใน fn_mig_truncate");
trunc = trunc.replace(
  aTrunc,
  `    'report_runs',
    -- ★ D91 — excise_month_close มี entity_id FK → ต้องมาก่อน entities ด้วย
    'excise_month_close',
    'entities',`,
);

const header = fs.readFileSync("scripts/gen/0058-header.sql", "utf8");
fs.writeFileSync(
  OUT,
  header +
    "\n" +
    cancel +
    "\n-- ── fn_mig_truncate — ยกมาจาก 0054 ทั้งดุ้น เติม 'excise_month_close' ─────────\n" +
    trunc +
    "\nnotify pgrst, 'reload schema';\n",
);
console.log("เขียน", OUT, "แล้ว");
