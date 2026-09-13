/**
 * gen-0067 — ยกฟังก์ชันเดิมมาจาก **ไฟล์ล่าสุดที่นิยามมันจริง** แล้วแก้เฉพาะจุด
 *
 * 🚨 กติกา D79/D91: ห้ามพิมพ์ body ใหม่จากความจำ — ยกด้วยสคริปต์แล้ว diff เทียบ
 */
import fs from "node:fs";
import path from "node:path";

const MIG = "supabase/migrations";
/** ★ ไฟล์ที่สคริปต์นี้เขียนเอง — ต้องตัดออกจากการค้น ไม่งั้นรันรอบสองจะยกผลลัพธ์ตัวเองมาซ้อน */
const OUT = "20260913000067_bar_void_and_labels.sql";

/** หาไฟล์ล่าสุดที่มี `create or replace function <name>(` แล้วคืน body ทั้งก้อน */
function yank(name) {
  const files = fs.readdirSync(MIG).filter((f) => f.endsWith(".sql") && f !== OUT).sort();
  let found = null;
  for (const f of files) {
    const src = fs.readFileSync(path.join(MIG, f), "utf8");
    const head = src.indexOf("create or replace function " + name + "(");
    if (head < 0) continue;
    // จบที่ `end $fn$;` ตัวแรกหลังหัวฟังก์ชัน (ทุกตัวในโมดูลบาร์ใช้ tag $fn$)
    const tail = src.indexOf("end $fn$;", head);
    if (tail < 0) throw new Error(`หา end $fn$; ของ ${name} ใน ${f} ไม่เจอ`);
    found = { file: f, body: src.slice(head, tail + "end $fn$;".length) };
  }
  if (!found) throw new Error(`ไม่พบนิยามของ ${name} ในไฟล์ migration ไหนเลย`);
  return found;
}

const voidSale = yank("fn_bar_void_sale");
const saveMenu = yank("fn_bar_save_menu");
console.error(`ยกมาจาก: fn_bar_void_sale ← ${voidSale.file} · fn_bar_save_menu ← ${saveMenu.file}`);

// ── 1) fn_bar_void_sale: cap ตามสภาพบิล แทนที่จะบังคับ bar.config ตายตัว
let v = voidSale.body;
const vOld = `declare
  v_tenant uuid := bar_guard(p_entity, 'bar.config');
  v_sale bar_sale%rowtype;
  v_rec record;
begin
  select * into v_sale from bar_sale
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no for update;
  if not found then raise exception 'ไม่พบบิล %', p_sale_no; end if;`;
const vNew = `declare
  -- 🚨 ยังไม่ตัดสินสิทธิ์ตรงนี้ — ต้องอ่านสภาพบิลก่อนถึงจะรู้ว่าต้องใช้ cap ระดับไหน
  --    \`bar.read\` คือด่านต่ำสุดที่พอให้มองเห็นบิล · ตัวจริงเช็คอีกทีข้างล่าง
  v_tenant uuid := bar_guard(p_entity, 'bar.read');
  v_sale bar_sale%rowtype;
  v_rec record;
begin
  select * into v_sale from bar_sale
   where tenant_id = v_tenant and entity_id = p_entity and sale_no = p_sale_no for update;
  if not found then raise exception 'ไม่พบบิล %', p_sale_no; end if;

  -- ── สิทธิ์ตามสภาพบิล (D96) ────────────────────────────────────────────────
  --  🐛 เดิมบังคับ \`bar.config\` ทุกกรณี ⇒ **พนักงานบาร์เปิดบิลผิดแล้วลบเองไม่ได้เลย**
  --     ต้องไปตามเจ้าของร้านมากดให้ ทั้งที่บิลนั้นยังไม่มีอะไรอยู่ในนั้นสักรายการ
  --  ★ เส้นแบ่งอยู่ที่ **บิลปิดไปแล้วหรือยัง** ไม่ใช่ที่จำนวนรายการ —
  --    บิลที่ปิดแล้วคือเงินที่รับมาแล้วและใบเสร็จที่อาจอยู่ในมือลูกค้า
  if v_sale.status = 'เปิดอยู่' then
    perform bar_guard(p_entity, 'bar.write');
  else
    perform bar_guard(p_entity, 'bar.config');
  end if;`;
if (!v.includes(vOld)) throw new Error("โครง fn_bar_void_sale ไม่ตรงกับที่คาด — หยุดก่อน");
v = v.split(vOld).join(vNew);

// ── 2) fn_bar_save_menu: ชื่อหมวดตั้งต้นใหม่ (สร้างใหม่เท่านั้น ไม่ไล่แก้ของเดิม)
let m = saveMenu.body;
const mOld = "values (v_tenant, p_entity, 'custom', 'เมนูเฉพาะกิจ', 999, true);";
const mNew = "values (v_tenant, p_entity, 'custom', 'เมนูที่คิดหน้าบาร์', 999, true);";
if (!m.includes(mOld)) throw new Error("ไม่พบบรรทัดสร้างหมวด custom ใน fn_bar_save_menu");
m = m.split(mOld).join(mNew);

const out = `-- ─────────────────────────────────────────────────────────────────────────────
-- 0067 — ลบบิลจากหน้าขายได้ + ชื่อหมวดตั้งต้นที่คนอ่านรู้เรื่อง  (D96 · ภาค 2 เฟส A)
--
-- 🎯 มาจากการที่ผู้ใช้ลองใช้จริงแล้วแจ้งมา 2 ข้อ:
--    1. "เปิดบิลแล้วแต่จะลบบิลออกได้ไหม"  → ฟังก์ชันมีอยู่แล้ว แต่ขอ cap สูงเกินไป
--    2. "เมนูเฉพาะกิจ หมวดระบบ คืออะไร"   → ชื่อค่าปริยายไม่ได้อธิบายตัวเอง
--
-- 🚨 ทั้งสองฟังก์ชัน **ยกมาด้วยสคริปต์จากไฟล์ล่าสุดที่นิยามมัน** ไม่ได้พิมพ์ใหม่จากความจำ
--    (บทเรียน D79: ก๊อป body ผิดรอบเดียว = ฟีเจอร์ที่เคยทำงานพังเงียบ ๆ)
--    สคริปต์: scripts/gen/gen-0067.mjs
--
-- 🚨 **ไม่มีการ UPDATE ชื่อหมวดของ tenant ที่มีอยู่แล้ว** — ลูกค้าที่ตั้งชื่อเองไปแล้ว
--    จะโดนเขียนทับ · ชื่อใหม่มีผลเฉพาะหมวดที่ยังไม่เคยถูกสร้าง
-- ─────────────────────────────────────────────────────────────────────────────

${v}

${m}
`;

fs.writeFileSync(path.join(MIG, OUT), out);
console.error("เขียน 20260913000067_bar_void_and_labels.sql แล้ว");
