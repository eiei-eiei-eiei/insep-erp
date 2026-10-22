/**
 * สร้าง migration 0086 (D119 สำรองจ่าย) — ยก `fn_save_transaction` จาก migration ล่าสุดที่นิยามมัน
 * มาคำต่อคำ แล้วเติมแค่คอลัมน์ advance_for_entity ใน insert
 *
 * 🚨 ห้ามพิมพ์มือ (D79 — บั๊กใน fn_save_transaction เคยถูกก๊อปต่อข้ามไฟล์จนอยู่ในระบบข้ามปี)
 * รัน:  node scripts/gen/gen-0086.mjs
 */
import fs from "node:fs";
import path from "node:path";

const OUT_NAME = "20261022000086_advance_payment.sql";
const HEADER = "scripts/gen/0086-header.sql";
const FOOTER = "scripts/gen/0086-footer.sql";
const OUT = `supabase/migrations/${OUT_NAME}`;

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

/** แทนข้อความที่ต้องเจอ **ครั้งเดียวพอดี** — เจอ 0 หรือ >1 = หยุด (ดีกว่าแทนผิดที่เงียบ ๆ) */
function replaceOnce(src, from, to, what) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`${what}: ต้องเจอ 1 ครั้ง แต่เจอ ${n}`);
  return src.replace(from, to);
}

const SRC = latestWith("create or replace function fn_save_transaction(");
let fn = lift(fs.readFileSync(SRC, "utf8"), "fn_save_transaction");

fn = replaceOnce(
  fn,
  "    ap_ar_status, due_date, source\n  ) values (",
  "    ap_ar_status, due_date, source,\n    advance_for_entity\n  ) values (",
  "คอลัมน์ insert",
);
fn = replaceOnce(
  fn,
  "    nullif(p->>'ap_ar_status',''), _d(p,'due_date'), coalesce(nullif(p->>'source',''),'ui')\n  );",
  "    nullif(p->>'ap_ar_status',''), _d(p,'due_date'), coalesce(nullif(p->>'source',''),'ui'),\n" +
    "    -- D119: สำรองจ่ายให้กิจการไหน (advance_status ตั้งโดย trigger advance_guard)\n" +
    "    case when p->>'type' = 'สำรองจ่าย' then nullif(p->>'advance_for_entity','') end\n  );",
  "ค่า insert",
);

const out =
  fs.readFileSync(HEADER, "utf8") +
  `-- ยกจาก ${path.basename(SRC)}\n` +
  fn +
  fs.readFileSync(FOOTER, "utf8");
fs.writeFileSync(OUT, out);
console.log(`เขียน ${OUT} (ยก fn_save_transaction จาก ${path.basename(SRC)})`);
