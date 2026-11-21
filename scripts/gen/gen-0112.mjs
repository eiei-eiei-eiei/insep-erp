/**
 * สร้าง migration 0112 (D179 ยอดที่ใช้คิดหัก ณ ที่จ่าย) — ยก fn_save_transaction / fn_edit_transaction /
 * fn_clear_advances จาก migration ล่าสุดที่นิยามแต่ละตัวมาคำต่อคำ แล้วเติมคอลัมน์ wht_base
 *
 * 🚨 ห้ามพิมพ์มือ (D79) · รัน:  node scripts/gen/gen-0112.mjs
 */
import fs from "node:fs";
import path from "node:path";

const OUT_NAME = "20261121000112_wht_base.sql";
const HEADER = "scripts/gen/0112-header.sql";
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

function liftLatest(name) {
  const file = latestWith(`create or replace function ${name}(`);
  return { file: path.basename(file), fn: lift(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"), name) };
}

// ── fn_save_transaction ──────────────────────────────────────────────────────
const save = liftLatest("fn_save_transaction");
let saveFn = save.fn;
saveFn = replaceOnce(
  saveFn,
  "    base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,\n    tax_invoice_no,",
  "    base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, wht_base, net_amount,\n    tax_invoice_no,",
  "save: รายชื่อคอลัมน์",
);
saveFn = replaceOnce(
  saveFn,
  "    coalesce((p->>'wht_rate')::numeric,0), coalesce((p->>'wht_amount')::numeric,0),\n    coalesce((p->>'net_amount')::numeric,0),",
  "    coalesce((p->>'wht_rate')::numeric,0), coalesce((p->>'wht_amount')::numeric,0),\n" +
    "    -- D179: ยอดที่ใช้คิดหัก ณ ที่จ่าย · ไม่หัก = null เสมอ\n" +
    "    case when coalesce((p->>'wht_amount')::numeric,0) > 0 then nullif(p->>'wht_base','')::numeric end,\n" +
    "    coalesce((p->>'net_amount')::numeric,0),",
  "save: ค่า",
);

// ── fn_edit_transaction ──────────────────────────────────────────────────────
const edit = liftLatest("fn_edit_transaction");
let editFn = edit.fn;
editFn = replaceOnce(
  editFn,
  "    wht_amount           = coalesce((p->>'wht_amount')::numeric,0),\n",
  "    wht_amount           = coalesce((p->>'wht_amount')::numeric,0),\n" +
    "    -- D179: ไม่มี key = คงค่าเดิม (connector edit_bill / client เก่า) · ไม่หักแล้ว = ล้าง\n" +
    "    wht_base             = case when coalesce((p->>'wht_amount')::numeric,0) <= 0 then null\n" +
    "                                when p ? 'wht_base' then nullif(p->>'wht_base','')::numeric\n" +
    "                                else wht_base end,\n",
  "edit: update set",
);

// ── fn_clear_advances — บิลรายจ่ายที่ก๊อปไปกิจการปลายทางต้องพาฐานไปด้วย ─────
const clear = liftLatest("fn_clear_advances");
let clearFn = clear.fn;
clearFn = replaceOnce(
  clearFn,
  "      base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount,\n      tax_invoice_no,",
  "      base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, wht_base, net_amount,\n      tax_invoice_no,",
  "clear: รายชื่อคอลัมน์",
);
clearFn = replaceOnce(
  clearFn,
  "      r.base_amount, r.discount, r.amount_after_discount, r.vat_amount, r.wht_rate, r.wht_amount, r.net_amount,",
  "      r.base_amount, r.discount, r.amount_after_discount, r.vat_amount, r.wht_rate, r.wht_amount, r.wht_base, r.net_amount,",
  "clear: ค่า",
);

const header = fs.readFileSync(HEADER, "utf8").replace(/\r\n/g, "\n");
const out =
  header +
  `-- fn_save_transaction — ยกจาก ${save.file} คำต่อคำ + wht_base\n` +
  saveFn +
  `\n-- fn_edit_transaction — ยกจาก ${edit.file} คำต่อคำ + wht_base (ไม่มี key = คงค่าเดิม)\n` +
  editFn +
  `\n-- fn_clear_advances — ยกจาก ${clear.file} คำต่อคำ + พา wht_base ไปบิลของกิจการปลายทาง\n` +
  clearFn +
  "\nnotify pgrst, 'reload schema';\n";

fs.writeFileSync(OUT, out);
console.log("เขียน", OUT);
console.log("  save  ←", save.file);
console.log("  edit  ←", edit.file);
console.log("  clear ←", clear.file);
