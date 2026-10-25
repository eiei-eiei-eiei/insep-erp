/**
 * สร้าง migration 0091 (D129 ห้องทดลองบาร์) — header เขียนเอง (ของใหม่ทั้งหมด)
 * + ยก fn_mig_truncate จาก migration ล่าสุดที่นิยามมันมาคำต่อคำ แล้วเติมตารางใหม่ (D79)
 *
 * 🚨 ห้ามพิมพ์มือ · รัน:  node scripts/gen/gen-0091.mjs
 */
import fs from "node:fs";
import path from "node:path";

const OUT_NAME = "20261025000091_bar_lab.sql";
const OUT = `supabase/migrations/${OUT_NAME}`;

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

function lift(text, name) {
  const start = text.indexOf(`create or replace function ${name}(`);
  if (start < 0) throw new Error("ไม่พบ " + name);
  const m = text.slice(start).match(/\bas (\$[A-Za-z_]*\$)/);
  if (!m) throw new Error("อ่าน dollar-quote tag ของ " + name + " ไม่ได้");
  const bodyStart = start + m.index + m[0].length;
  const close = text.indexOf(m[1], bodyStart);
  if (close < 0) throw new Error("ไม่พบจุดจบของ " + name);
  const semi = text.indexOf(";", close);
  return text.slice(start, semi + 1) + "\n";
}

function replaceOnce(src, from, to, what) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`${what}: ต้องเจอ 1 ครั้ง แต่เจอ ${n}`);
  return src.replace(from, to);
}

let out = fs.readFileSync("scripts/gen/0091-header.sql", "utf8").replace(/\r\n/g, "\n");
const src = latestWith("create or replace function fn_mig_truncate(");
let fn = lift(fs.readFileSync(src, "utf8").replace(/\r\n/g, "\n"), "fn_mig_truncate");
fn = replaceOnce(
  fn,
  `    'bar_sale_item','bar_sale','bar_post','bar_move','bar_receive',`,
  `    -- ★ D129 — ห้องทดลอง: บรรทัด → รายการ → สูตร/หมวด (ลูกก่อนแม่ · หมวด FK ไป entities)
    'bar_lab_use_line','bar_lab_use','bar_lab_recipe','bar_lab_category',
    'bar_sale_item','bar_sale','bar_post','bar_move','bar_receive',`,
  "fn_mig_truncate",
);
out += `\n-- ยก fn_mig_truncate จาก ${path.basename(src)}\n` + fn;
out += `
-- 🚨 D99: fn_mig_truncate ถูกนิยามใหม่ในไฟล์นี้ → revoke ซ้ำ
revoke execute on function fn_mig_truncate(uuid) from public, anon, authenticated;
grant  execute on function fn_mig_truncate(uuid) to service_role;

notify pgrst, 'reload schema';
`;
fs.writeFileSync(OUT, out);
console.log("เขียน " + OUT);
