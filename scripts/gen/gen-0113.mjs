/**
 * สร้าง migration 0113 (D180 ยกเลิกใบ 50ทวิ) — header เขียนมือ (ของใหม่ทั้งหมด) +
 * ยก fn_update_wht / fn_edit_transaction จาก migration ล่าสุดที่นิยามแต่ละตัวมาคำต่อคำ แล้วแก้เฉพาะจุด
 *
 * 🚨 ห้ามพิมพ์ฟังก์ชันเดิมใหม่ด้วยมือ (D79) · รัน:  node scripts/gen/gen-0113.mjs
 */
import fs from "node:fs";
import path from "node:path";

const OUT_NAME = "20261121000113_wht_cancel.sql";
const HEADER = "scripts/gen/0113-header.sql";
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

// ── fn_update_wht — ใบที่ยกเลิกแล้วแก้ไม่ได้ ─────────────────────────────────
const upd = liftLatest("fn_update_wht");
let updFn = upd.fn;
updFn = replaceOnce(
  updFn,
  "declare n int;\nbegin\n",
  "declare n int;\nbegin\n" +
    "  -- D180: ใบที่ยกเลิกแล้ว = เอกสารปิด · แก้เลข/วันที่/ประเภทไม่ได้ (ออกใบใหม่แทน)\n" +
    "  if exists (select 1 from wht_certificates\n" +
    "              where entity_id = p_entity_id and doc_no = p_old_doc_no and status = 'ยกเลิก') then\n" +
    "    return jsonb_build_object('ok', false, 'error', 'ใบ ' || p_old_doc_no || ' ยกเลิกแล้ว — แก้ไม่ได้');\n" +
    "  end if;\n",
  "update: ด่านใบที่ยกเลิก",
);

// ── fn_edit_transaction — ด่านย้ายกิจการนับเฉพาะใบปกติ ──────────────────────
const edit = liftLatest("fn_edit_transaction");
let editFn = edit.fn;
editFn = replaceOnce(
  editFn,
  "      from wht_certificates where tenant_id = v_tenant and p_tx_id = any(tx_ids);\n",
  "      from wht_certificates where tenant_id = v_tenant and p_tx_id = any(tx_ids)\n" +
    "       and status = 'ปกติ';   -- D180: ใบที่ยกเลิกแล้วไม่ผูกบิลไว้กับกิจการเดิม\n",
  "edit: ด่าน 50ทวิ",
);
editFn = replaceOnce(
  editFn,
  "ในนามกิจการเดิม — ย้ายกิจการไม่ได้ ให้ยกเลิกบิลแล้วบันทึกใหม่ในกิจการที่ถูก');",
  "ในนามกิจการเดิม — ย้ายกิจการไม่ได้ ให้ยกเลิกใบ 50ทวิ ก่อน (บัญชี → เอกสารสรรพากร) แล้วย้ายบิล แล้วออกใบใหม่ในกิจการที่ถูก');",
  "edit: ข้อความ",
);

const header = fs.readFileSync(HEADER, "utf8").replace(/\r\n/g, "\n");
const out =
  header +
  `-- fn_update_wht — ยกจาก ${upd.file} คำต่อคำ + ด่านใบที่ยกเลิก\n` +
  updFn +
  `\n-- fn_edit_transaction — ยกจาก ${edit.file} คำต่อคำ + ด่านย้ายกิจการนับเฉพาะใบ 50ทวิ ปกติ\n` +
  editFn +
  "\nnotify pgrst, 'reload schema';\n";

fs.writeFileSync(OUT, out);
console.log("เขียน", OUT);
console.log("  update ←", upd.file);
console.log("  edit   ←", edit.file);
