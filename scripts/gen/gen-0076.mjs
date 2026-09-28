/**
 * gen-0076 — ตั้งรูปแบบเลขเอกสารเองได้ (D100 เฟส 1)
 *
 * 🚨 กติกา D79/D91/D95: ยก fn_mig_truncate จาก **ไฟล์ล่าสุดที่นิยามมันจริง** (ค้นเอง ไม่ใช้ความจำ)
 *    แล้วเติม 'doc_numbering' ก่อน 'entities' (มี FK ไป entities — ลบทีหลัง = ลบลูกค้าไม่ได้ · D82)
 */
import fs from "node:fs";
import path from "node:path";

const MIG = "supabase/migrations";
const OUT = "20260928000076_doc_numbering.sql";

function yank(name) {
  const files = fs.readdirSync(MIG).filter((f) => f.endsWith(".sql") && f !== OUT).sort();
  let found = null;
  const re = new RegExp(`create (or replace )?function ${name}\\(`);
  for (const f of files) {
    // 🪤 ไฟล์ migration บางไฟล์เป็น CRLF (git autocrlf) — ทำให้เป็น LF ก่อนเทียบข้อความ
    const src = fs.readFileSync(path.join(MIG, f), "utf8").replace(/\r\n/g, "\n");
    const head = src.search(re);
    if (head < 0) continue;
    // อ่าน dollar-quote tag จากตัวฟังก์ชันเอง (0071 ใช้ $fn$ · ไฟล์เก่าใช้ $$)
    const tag = src.slice(head).match(/as (\$[a-z]*\$)/)?.[1];
    if (!tag) throw new Error(`หา dollar-quote ของ ${name} ใน ${f} ไม่เจอ`);
    const endTag = `end ${tag};`;
    const tail = src.indexOf(endTag, head);
    if (tail < 0) throw new Error(`หา ${endTag} ของ ${name} ใน ${f} ไม่เจอ`);
    found = { file: f, body: src.slice(head, tail + endTag.length) };
  }
  if (!found) throw new Error(`ไม่พบนิยามของ ${name}`);
  return found;
}

const trunc = yank("fn_mig_truncate");
const OLD = "    'excise_month_close',\n    'entities',";
const NEW =
  "    'excise_month_close',\n" +
  "    -- ★ D100 — doc_numbering มี entity_id FK → ต้องมาก่อน entities ด้วย\n" +
  "    'doc_numbering',\n" +
  "    'entities',";
if (!trunc.body.includes(OLD)) throw new Error("โครงลิสต์ของ fn_mig_truncate ไม่ตรงกับที่คาด — ห้ามเดา หยุด");
if (trunc.body.includes("'doc_numbering'")) throw new Error("มี doc_numbering อยู่แล้ว?");
const truncBody = trunc.body.replace(OLD, NEW);
console.error(`ยกมาจาก: fn_mig_truncate ← ${trunc.file}`);

const header = fs.readFileSync("scripts/gen/0076-header.sql", "utf8");
const out = `${header}
-- ── 12) fn_mig_truncate — ยกจาก ${trunc.file} · เติม doc_numbering ก่อน entities ────────
${truncBody}

-- 🚨 D99: revoke ต้องครอบ anon/authenticated เสมอ (from public อย่างเดียวไม่มีผลบน Supabase)
revoke execute on function fn_mig_truncate(uuid) from public, anon, authenticated;
grant  execute on function fn_mig_truncate(uuid) to service_role;

notify pgrst, 'reload schema';
`;
// ด่านวงเล็บ — นับเฉพาะโค้ด (คอมเมนต์หัวข้อ "1) 2)" มีวงเล็บปิดเดี่ยวโดยตั้งใจ)
const code = out.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''");
const bal = [...code].reduce((n, c) => n + (c === "(" ? 1 : c === ")" ? -1 : 0), 0);
if (bal !== 0) throw new Error(`วงเล็บไม่สมดุล (${bal})`);
fs.writeFileSync(path.join(MIG, OUT), out);
console.error(`เขียน ${OUT} แล้ว`);
