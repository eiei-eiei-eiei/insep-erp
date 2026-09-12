/**
 * สร้าง migration 0063 (D95) โดย **ยก plpgsql เดิมมาทั้งดุ้น** แล้วแทรกเฉพาะบรรทัดที่ตั้งใจ
 *  · fn_pay_tax       ← 0054 (เติมบล็อก "ติ๊กยื่นแล้วให้เอง")
 *  · fn_mig_truncate  ← migration ล่าสุดที่นิยามมัน (เติม 'tax_filings' ก่อน 'entities')
 *
 * 🚨 ห้ามพิมพ์มือ — D79 พิสูจน์แล้วว่ายก plpgsql ด้วยมือแล้วพลาด = ฟีเจอร์ไม่เคยทำงานเลย
 *    และ build/lint/test มองไม่เห็นตรรกะที่อยู่ในฐานข้อมูลเลยแม้แต่บรรทัดเดียว
 *
 * รัน:  node scripts/gen/gen-0063.mjs
 */
import fs from "node:fs";
import path from "node:path";

const OUT_NAME = "20260912000063_tax_filings.sql";

/** migration ล่าสุด (ไม่นับไฟล์ที่สคริปต์นี้สร้างเอง) ที่มีข้อความนี้ */
function latestWith(needle) {
  const dir = "supabase/migrations";
  const hit = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && f !== OUT_NAME)
    .sort()
    .reverse()
    .find((f) => fs.readFileSync(path.join(dir, f), "utf8").includes(needle));
  if (!hit) throw new Error("ไม่พบ migration ที่มี " + needle);
  return path.join(dir, hit);
}

const PAY_SRC = "supabase/migrations/20260901000054_tax_payments.sql";
/**
 * 🚨 ต้องยก `fn_mig_truncate` จาก **ไฟล์ล่าสุดที่นิยามมัน** ไม่ใช่ไฟล์ที่จำได้ว่าเคยแก้
 *    รอบแรกของ D95 ยกจาก 0058 → ตกตารางของ 0061 (`log_redistill*`) = ลบ/รีเซ็ตลูกค้าที่
 *    เคยกลั่นซ้ำไม่ได้เลย · `tenantTables.test.ts` จับได้ทันที (นี่คือเหตุผลที่เทสตัวนั้นมีอยู่)
 */
const TRUNC_SRC = latestWith("function fn_mig_truncate");
const HEADER = "scripts/gen/0063-header.sql";
const OUT = `supabase/migrations/${OUT_NAME}`;

/**
 * ยกฟังก์ชันมาทั้งดุ้น
 * 🪤 dollar-quote tag ไม่เหมือนกันทุกไฟล์ (`$$` บ้าง `$fn$` บ้าง) → อ่านจากตัวไฟล์เอง
 *    ฮาร์ดโค้ดไว้ตัวเดียวแล้วไฟล์ต้นทางเปลี่ยน tag = สคริปต์ล้มทันที ซึ่งดีกว่ายกมาผิดครึ่ง
 */
function lift(text, name) {
  const start = text.indexOf(`create or replace function ${name}(`);
  if (start < 0) throw new Error("ไม่พบ " + name);
  const tag = text.slice(start).match(/\bas (\$[A-Za-z_]*\$)/)?.[1];
  if (!tag) throw new Error("อ่าน dollar-quote tag ของ " + name + " ไม่ได้");
  const stop = `\nend ${tag};\n`;
  const end = text.indexOf(stop, start);
  if (end < 0) throw new Error("ไม่พบจุดจบของ " + name);
  return text.slice(start, end + stop.length);
}

// ── 1) fn_pay_tax: ติ๊ก "ยื่นแล้ว" ให้เองหลังบันทึกจ่ายสำเร็จ ──────────────────
let pay = lift(fs.readFileSync(PAY_SRC, "utf8"), "fn_pay_tax");

const anchor = "  update tax_payments set tx_id = v_tx, surcharge_tx_id = v_sur_tx where id = v_id;";
if (!pay.includes(anchor)) throw new Error("ไม่พบจุดแทรกใน fn_pay_tax");
pay = pay.replace(
  anchor,
  [
    anchor,
    "",
    "  /*",
    "   * D95 — จ่ายได้แปลว่ายื่นแล้ว → ติ๊ก tax_filings ให้เลย (source = 'pay')",
    "   *",
    "   * ★ ทิศทางเดียว: **ยื่นแล้วไม่ได้แปลว่าจ่ายแล้ว** (เดือนยอดศูนย์ยื่นแต่ไม่ต้องจ่าย)",
    "   * 🪤 `where not exists` เพราะผู้ใช้อาจกดปุ่ม 'ยื่นแล้ว' ไปก่อนหน้านี้ —",
    "   *    ปล่อยให้ unique index เด้ง unique_violation ตรงนี้ = **บิลจ่ายที่เพิ่งสร้างหายทั้งใบ**",
    "   *    (ทั้งฟังก์ชันเป็น transaction เดียว) ซึ่งคือการจ่ายที่ล้มเพราะเรื่องที่ไม่เกี่ยวกัน",
    "   * ★ ไม่แตะแถวที่ผู้ใช้ติ๊กเองไว้แล้ว — ค่าที่ผู้ใช้กรอก (วันที่ยื่นจริง/หมายเหตุ) ต้องไม่ถูกทับ",
    "   */",
    "  insert into tax_filings(tenant_id, entity_id, kind, period, filed_on, filed_by, source, note)",
    "  select v_tenant, p_entity, p_kind, p_period, p_date, auth.uid(), 'pay',",
    "         'ระบบติ๊กให้ตอนบันทึกจ่ายภาษี'",
    "  where not exists (",
    "    select 1 from tax_filings f",
    "    where f.tenant_id = v_tenant and f.entity_id = p_entity",
    "      and f.kind = p_kind and f.period = p_period and f.reopened_at is null",
    "  );",
  ].join("\n"),
);

// ── 2) fn_mig_truncate: ตารางใหม่ต้องอยู่ **ก่อน** entities (FK · บทเรียน D82) ──
let trunc = lift(fs.readFileSync(TRUNC_SRC, "utf8"), "fn_mig_truncate");

const tAnchor = `    'transaction_items','transactions','tax_summaries','tax_payments','wht_certificates',`;
if (!trunc.includes(tAnchor)) throw new Error("ไม่พบรายชื่อตารางใน fn_mig_truncate");
trunc = trunc.replace(
  tAnchor,
  `    'transaction_items','transactions','tax_summaries','tax_payments','tax_filings','wht_certificates',`,
);
if (trunc.indexOf("'tax_filings'") > trunc.indexOf("'entities'")) {
  throw new Error("tax_filings ต้องมาก่อน entities ไม่งั้นลบลูกค้าไม่ได้ (FK)");
}

const header = fs.readFileSync(HEADER, "utf8");
fs.writeFileSync(
  OUT,
  [
    header,
    pay,
    "",
    `-- ── fn_mig_truncate — ยกมาจาก ${path.basename(TRUNC_SRC)} ทั้งดุ้น เติม 'tax_filings' ──`,
    "-- 🚨 ตกตารางใหม่ = **ลบ/รีเซ็ตลูกค้าไม่ได้เลย** (ติด FK) และไฟล์สำรองขาดข้อมูลเงียบ ๆ",
    "--    `tenantTables.test.ts` ไล่อ่านไฟล์นี้มาเทียบให้",
    trunc,
    "",
    "revoke execute on function fn_mig_truncate(uuid) from public;",
    "grant  execute on function fn_mig_truncate(uuid) to service_role;",
    "",
    "notify pgrst, 'reload schema';",
    "",
  ].join("\n"),
);
console.log("เขียน", OUT, "แล้ว");
