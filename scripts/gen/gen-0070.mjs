/**
 * gen-0070 — เปิดให้เก็บผังหน้าตาบิล (D96 ภาค 2 เฟส G)
 *
 * 🪤 **กับดัก D80**: `app_settings.kind` เป็น CHECK whitelist ที่ **เขียนทับทั้งก้อน**
 *    เติมชื่อใหม่ในโค้ด TypeScript อย่างเดียวไม่พอ — insert จะติด constraint
 *    และถ้ายกรายชื่อเดิมมาไม่ครบ **ค่าที่ลูกค้าตั้งไว้แล้วจะ insert ไม่ได้อีกเลย**
 * ⇒ ยกรายชื่อจาก **ไฟล์ล่าสุดที่นิยาม constraint นี้** ด้วยสคริปต์ ไม่พิมพ์มือ (D79/D91)
 */
import fs from "node:fs";
import path from "node:path";

const MIG = "supabase/migrations";
const OUT = "20260914000070_bar_receipt_layout.sql";

/** หาไฟล์ล่าสุดที่ประกาศ `app_settings_kind_check` แล้วดึงรายชื่อ kind ออกมา */
function yankKinds() {
  const files = fs.readdirSync(MIG).filter((f) => f.endsWith(".sql") && f !== OUT).sort();
  let found = null;
  for (const f of files) {
    const src = fs.readFileSync(path.join(MIG, f), "utf8");
    const head = src.indexOf("add constraint app_settings_kind_check");
    if (head < 0) continue;
    const open = src.indexOf("check (kind in (", head);
    if (open < 0) throw new Error(`${f}: เจอ constraint แต่หา check (kind in ( ไม่เจอ`);
    /**
     * 🐛 **บั๊กที่ทำ migration แรกพัง** — เดิมเริ่มนับวงเล็บ *หลัง* คำว่า `kind in`
     *    ⇒ ตัวที่นับว่า "ปิดครบ" คือวงเล็บของ `in (` ไม่ใช่ของ `check (`
     *    ได้ SQL ที่ **ขาดวงเล็บปิด 1 ตัว** → `db push` ล้ม และ (ที่แย่กว่า)
     *    ถ้าไม่ได้อ่าน error จะนึกว่าลงไปแล้ว แล้วไปงงว่าทำไมบันทึกค่าไม่ได้
     * ⇒ เริ่มนับจากหลังคำว่า `check` เพื่อให้ตัวแรกที่นับคือวงเล็บของ `check (`
     */
    let depth = 0;
    let end = -1;
    for (let i = open + "check".length; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end < 0) throw new Error(`${f}: หาวงเล็บปิดของรายชื่อ kind ไม่เจอ`);
    found = { file: f, body: src.slice(open, end + 1) };
  }
  if (!found) throw new Error("ไม่พบ app_settings_kind_check ในไฟล์ migration ไหนเลย");
  return found;
}

const kinds = yankKinds();
console.error(`ยกรายชื่อ kind มาจาก: ${kinds.file}`);

const NEW_KIND = "'bar_receipt_layout'";
if (kinds.body.includes(NEW_KIND)) throw new Error("bar_receipt_layout มีอยู่แล้ว — ไม่ต้องทำ migration นี้");

// เติมชื่อใหม่ต่อท้ายก่อนวงเล็บปิดสุดท้าย
const body = kinds.body.replace(
  /'bar_receipt_footer'\)\)$/,
  "'bar_receipt_footer',\n                  -- ★ ผังหน้าตาบิล — **JSON ก้อนเดียว** ไม่แตกเป็น kind ละสวิตช์\n                  --   เพราะทุกสวิตช์ใหม่จะกลายเป็น migration ใหม่ (กับดัก D80)\n                  'bar_receipt_layout'))",
);
if (body === kinds.body) throw new Error("หาจุดต่อท้ายรายชื่อ kind ไม่เจอ — โครงเปลี่ยนไป");

// นับว่ายกมาครบ (กันยกมาขาดแล้วค่าเดิม insert ไม่ได้)
const count = (s) => (s.match(/'[a-z_]+'/g) ?? []).length;
console.error(`รายชื่อ kind: เดิม ${count(kinds.body)} → ใหม่ ${count(body)}`);
if (count(body) !== count(kinds.body) + 1) throw new Error("จำนวน kind ไม่ได้เพิ่มขึ้น 1 พอดี — หยุดก่อน");

const out = `-- ─────────────────────────────────────────────────────────────────────────────
-- 0070 — ผังหน้าตาบิลที่ผู้ใช้จัดเอง  (D96 · ภาค 2 เฟส G)
--
-- 🎯 ผู้ใช้ขอ "อยากให้ customize บิลเองได้" — เรียงบล็อก · เปิด/ปิดบรรทัด ·
--    ข้อความหัว-ท้าย · ขนาดกระดาษ · โลโก้
--
-- 🚨 เก็บเป็น **JSON ก้อนเดียว** ใน kind \`bar_receipt_layout\`
--    ไม่แตกเป็น kind ละสวิตช์ เพราะ \`app_settings.kind\` เป็น CHECK whitelist
--    ⇒ ทุกสวิตช์ใหม่จะกลายเป็น migration ใหม่ (กับดัก D80)
--
-- 🚨 รายชื่อ kind ยกมาด้วยสคริปต์ scripts/gen/gen-0070.mjs จากไฟล์ล่าสุดที่นิยาม
--    constraint นี้ (${kinds.file}) — **ยกมาขาดแม้ชื่อเดียว = ค่าที่ลูกค้าตั้งไว้แล้ว
--    insert ไม่ได้อีกเลย** และไม่มีอะไรฟ้องจนกว่าจะมีคนกดบันทึก
--
-- ★ ไม่ต้องแตะ \`app_setting_cap()\` — กฎ \`bar\\_%\` → \`bar.config\` ของ 0064 ครอบให้แล้ว
-- ─────────────────────────────────────────────────────────────────────────────

alter table app_settings drop constraint if exists app_settings_kind_check;
alter table app_settings add constraint app_settings_kind_check
  ${body};
`;

/**
 * 🚨 ด่านสุดท้าย — นับวงเล็บของ SQL จริง (ไม่นับในคอมเมนต์)
 *    บั๊กวงเล็บขาดหนึ่งตัวทำให้ผู้ใช้รัน migration แล้วล้ม แล้วมาเจอปลายทาง
 *    เป็นข้อความ "ค่าที่กรอกไม่ถูกต้อง" ที่ไม่ได้บอกอะไรเลยว่าต้นตออยู่ไหน
 */
{
  const sqlOnly = out.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  let o = 0, c = 0;
  for (const ch of sqlOnly) { if (ch === "(") o++; else if (ch === ")") c++; }
  if (o !== c) throw new Error(`วงเล็บไม่สมดุล: เปิด ${o} ปิด ${c} — ไม่เขียนไฟล์`);
}

fs.writeFileSync(path.join(MIG, OUT), out);
console.error(`เขียน ${OUT} แล้ว`);
