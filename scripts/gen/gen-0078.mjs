/**
 * gen-0078 — ลงเอกสารขายย้อนหลัง (D100 เฟส 3)
 *
 * 🚨 กติกา D79/D91: ยก fn_confirm_fulfillment จากไฟล์ล่าสุดที่นิยามมันจริง แล้วแก้เฉพาะ
 *    (1) ลายเซ็น (+p_date) (2) ด่านวันที่ (3) วันที่ของ log_product — ตรรกะตัดสต็อกไม่ถูกแตะ
 */
import fs from "node:fs";
import path from "node:path";

const MIG = "supabase/migrations";
const OUT = "20260928000078_backdate_sales.sql";

function yank(name) {
  const files = fs.readdirSync(MIG).filter((f) => f.endsWith(".sql") && f !== OUT).sort();
  let found = null;
  const re = new RegExp(`create (or replace )?function ${name}\\(`);
  for (const f of files) {
    // 🪤 ไฟล์ migration บางไฟล์เป็น CRLF (git autocrlf) — ทำให้เป็น LF ก่อนเทียบข้อความ
    const src = fs.readFileSync(path.join(MIG, f), "utf8").replace(/\r\n/g, "\n");
    const head = src.search(re);
    if (head < 0) continue;
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

const f = yank("fn_confirm_fulfillment");
let body = f.body;
const edits = [
  [
    "create or replace function fn_confirm_fulfillment(p_qu_no text, p_user text)",
    "create or replace function fn_confirm_fulfillment(p_qu_no text, p_user text, p_date date default null)",
  ],
  [
    "  v_tenant uuid := my_tenant();\nbegin",
    "  v_tenant uuid := my_tenant();\n" +
      "  -- D100 เฟส 3 — วันที่ของออกจริง (ลงฟอร์ม ภส.) · ไม่ส่ง = วันนี้ตามเวลาไทย (เดิม current_date = UTC)\n" +
      "  v_today date := (now() at time zone 'Asia/Bangkok')::date;\n" +
      "  v_ship date := coalesce(p_date, (now() at time zone 'Asia/Bangkok')::date);\n" +
      "begin",
  ],
  [
    "  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;\n",
    "  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;\n" +
      "  -- 🚨 ฟอร์ม ภส. บันทึกของที่ออกไปแล้วเท่านั้น (ฝาแฝด: shipDateError ใน lib/sales/backdate.ts)\n" +
      "  if v_ship > v_today then\n" +
      "    return jsonb_build_object('ok', false, 'error',\n" +
      "      'วันที่ส่งของเลยวันนี้ไม่ได้ — ฟอร์ม ภส. บันทึกเฉพาะของที่ออกไปแล้ว');\n" +
      "  end if;\n",
  ],
  [
    "        values (v_tenant, v_order.entity_id, current_date, v_trans_type,",
    "        values (v_tenant, v_order.entity_id, v_ship, v_trans_type,",
  ],
];
for (const [a, b] of edits) {
  if (!body.includes(a)) throw new Error("โครงของ fn_confirm_fulfillment ไม่ตรงกับที่คาด — ห้ามเดา หยุด:\n" + a);
  body = body.replace(a, b);
}
// ตรวจโค้ดจริง ไม่ใช่คำในคอมเมนต์ (คอมเมนต์ที่เพิ่งใส่อธิบายว่า "เดิม current_date")
if (/\bcurrent_date\b/.test(body.replace(/--[^\n]*/g, ""))) {
  throw new Error("ยังเหลือ current_date ใน fn_confirm_fulfillment");
}
console.error(`ยกมาจาก: fn_confirm_fulfillment ← ${f.file}`);

const header = fs.readFileSync("scripts/gen/0078-header.sql", "utf8");
const out = `${header}
-- ── 2) fn_confirm_fulfillment — ยกจาก ${f.file} · เพิ่ม p_date ────────────────────────
-- 🪤 เพิ่มพารามิเตอร์ = ลายเซ็นใหม่ → ต้อง drop ตัวเดิมก่อน ไม่งั้นได้ overload 2 ตัว (D69)
drop function if exists fn_confirm_fulfillment(text, text);
${body}

notify pgrst, 'reload schema';
`;
const code = out.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''");
const bal = [...code].reduce((n, c) => n + (c === "(" ? 1 : c === ")" ? -1 : 0), 0);
if (bal !== 0) throw new Error(`วงเล็บไม่สมดุล (${bal})`);
fs.writeFileSync(path.join(MIG, OUT), out);
console.error(`เขียน ${OUT} แล้ว`);
