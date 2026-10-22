/**
 * สร้าง migration 0087 (D120 จำกัดผู้ใช้ตามกิจการ) — ยก RPC definer 5 ตัวจาก migration ล่าสุด
 * ที่นิยามแต่ละตัวมาคำต่อคำ แล้วเติมแค่ด่าน "ไม่มีสิทธิ์ในกิจการ"
 *
 * 🚨 ห้ามพิมพ์มือ (D79) · รัน:  node scripts/gen/gen-0087.mjs
 */
import fs from "node:fs";
import path from "node:path";

const OUT_NAME = "20261022000087_entity_scope_gaps.sql";
const HEADER = "scripts/gen/0087-header.sql";
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

/** ตัดตั้งแต่ `create or replace function name(` ถึง dollar-quote ปิด + `;` (ใช้ได้ทั้ง plpgsql และ sql) */
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

const ENTITY_GUARD = (v) =>
  `  -- D120: definer ข้าม RLS → ต้องถามเองว่าผู้เรียกมีสิทธิ์ในกิจการนี้ไหม (แพตเทิร์น fn_file_tax 0072)\n` +
  `  if my_entities() is not null and not (${v} = any(my_entities())) then\n` +
  `    raise exception 'ไม่มีสิทธิ์ในกิจการ %', ${v};\n` +
  `  end if;\n`;

const PERIOD_GUARD =
  `  -- D120: งวดเงินเดือนผูกกิจการ — ผู้ใช้ที่ถูกจำกัดกิจการแตะงวดของกิจการอื่นไม่ได้\n` +
  `  if my_entities() is not null and not exists (\n` +
  `       select 1 from payroll_periods\n` +
  `        where tenant_id = v_tenant and period_id = p_period_id\n` +
  `          and entity_id = any(my_entities())) then\n` +
  `    raise exception 'ไม่มีสิทธิ์ในกิจการของงวด %', p_period_id;\n` +
  `  end if;\n`;

/** [ชื่อฟังก์ชัน, จุดยึด (ต้องเจอครั้งเดียว), ข้อความที่ต่อท้ายจุดยึด] */
const TARGETS = [
  [
    "fn_pay_tax",
    "  if coalesce(p_entity,'') = '' then raise exception 'ต้องระบุกิจการ — แต่ละกิจการยื่นและจ่ายแยกใบ'; end if;\n",
    ENTITY_GUARD("p_entity"),
  ],
  [
    "fn_unpay_tax",
    "    raise exception 'ต้องมีสิทธิ์ตั้งค่าหน้าบัญชีถึงจะถอนการบันทึกจ่ายภาษีได้';\n  end if;\n",
    ENTITY_GUARD("p_entity"),
  ],
  [
    "fn_post_payroll",
    "  if not has_cap('pay.write') then raise exception 'ไม่มีสิทธิ์ลงบัญชีเงินเดือน'; end if;\n",
    PERIOD_GUARD,
  ],
  [
    "fn_unpost_payroll",
    "  if not has_cap('pay.write') then raise exception 'ไม่มีสิทธิ์ถอนการลงบัญชีเงินเดือน'; end if;\n",
    PERIOD_GUARD,
  ],
  [
    "fn_wht_doc_nos",
    "     and (has_cap('acct.read') or has_cap('pay.read'))",
    "\n     -- D120: เลขที่ของกิจการที่ไม่มีสิทธิ์ = ไม่คืน (ผู้ใช้ที่ถูกจำกัดออกใบได้เฉพาะกิจการของตัวเองอยู่แล้ว)\n" +
      "     and (my_entities() is null or p_entity_id = any(my_entities()))",
  ],
];

let out = fs.readFileSync(HEADER, "utf8");
for (const [name, anchor, add] of TARGETS) {
  const src = latestWith(`create or replace function ${name}(`);
  // 🪤 ไฟล์ใน working copy อาจเป็น CRLF (git autocrlf) — จุดยึดเขียนด้วย \n
  let fn = lift(fs.readFileSync(src, "utf8").replace(/\r\n/g, "\n"), name);
  fn = replaceOnce(fn, anchor, anchor + add, name);
  out += `\n-- ยก ${name} จาก ${path.basename(src)}\n` + fn;
}
out += "\nnotify pgrst, 'reload schema';\n";
fs.writeFileSync(OUT, out);
console.log("เขียน " + OUT);
