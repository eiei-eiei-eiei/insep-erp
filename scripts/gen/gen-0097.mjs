/**
 * สร้าง migration 0097 (D141 Claude connector) — ยก fn_edit_transaction จาก migration ล่าสุด
 * ที่นิยามมันมาคำต่อคำ แล้วเติม 'claude' เข้ารายชื่อ source ที่ย้ายกิจการได้ (D132)
 *
 * 🚨 ห้ามพิมพ์มือ (D79) · รัน:  node scripts/gen/gen-0097.mjs
 */
import fs from "node:fs";
import path from "node:path";

const OUT_NAME = "20261028000097_claude_connector.sql";
const HEADER = "scripts/gen/0097-header.sql";
const OUT = `supabase/migrations/${OUT_NAME}`;
const NAME = "fn_edit_transaction";

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

/** ตัดตั้งแต่ `create or replace function name(` ถึง dollar-quote ปิด + `;` */
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

const srcFile = latestWith(`create or replace function ${NAME}(`);
let fn = lift(fs.readFileSync(srcFile, "utf8").replace(/\r\n/g, "\n"), NAME);

fn = replaceOnce(
  fn,
  "if coalesce(v_source, 'ui') not in ('ui', 'migration') then",
  "if coalesce(v_source, 'ui') not in ('ui', 'migration', 'claude') then",
  "รายชื่อ source ที่ย้ายได้",
);

const header = fs.readFileSync(HEADER, "utf8").replace(/\r\n/g, "\n");
const out =
  header +
  `-- fn_edit_transaction — ยกจาก ${path.basename(srcFile)} คำต่อคำ + 'claude' ในรายชื่อ source ที่ย้ายกิจการได้\n` +
  "-- 🚨 ต้องตรงกับ MOVABLE_SOURCES ใน lib/accounting/entityMove.ts (entityMove.test.ts อ่านไฟล์นี้มาเทียบ)\n" +
  "-- ★ ลายเซ็นเดิม → create or replace ได้ ไม่ต้อง drop · ยังเป็น invoker\n" +
  fn +
  "\nnotify pgrst, 'reload schema';\n";

fs.writeFileSync(OUT, out);
console.log("เขียน", OUT, "จาก", srcFile);
