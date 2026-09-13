/**
 * gen-0068 — ส่วนลดเป็น % (D96 ภาค 2 เฟส C)
 *
 * 🚨 กติกา D79/D91: body ของฟังก์ชันเดิม **ยกมาด้วยสคริปต์จากไฟล์ล่าสุดที่นิยามมัน**
 *    ห้ามพิมพ์ใหม่จากความจำ — ก๊อปผิดรอบเดียว ฟีเจอร์ที่เคยทำงานพังเงียบ ๆ
 */
import fs from "node:fs";
import path from "node:path";

const MIG = "supabase/migrations";
/** ★ ไฟล์ที่สคริปต์นี้เขียนเอง — ต้องตัดออกจากการค้น ไม่งั้นรันรอบสองจะยกผลลัพธ์ตัวเองมาซ้อน */
const OUT = "20260913000068_bar_discount_pct.sql";

function yank(name) {
  const files = fs.readdirSync(MIG).filter((f) => f.endsWith(".sql") && f !== OUT).sort();
  let found = null;
  for (const f of files) {
    const src = fs.readFileSync(path.join(MIG, f), "utf8");
    const head = src.indexOf("create or replace function " + name + "(");
    if (head < 0) continue;
    const tail = src.indexOf("end $fn$;", head);
    if (tail < 0) throw new Error(`หา end $fn$; ของ ${name} ใน ${f} ไม่เจอ`);
    found = { file: f, body: src.slice(head, tail + "end $fn$;".length) };
  }
  if (!found) throw new Error(`ไม่พบนิยามของ ${name}`);
  return found;
}

const addLines = yank("fn_bar_add_lines");
const closeSale = yank("fn_bar_close_sale");
const quickSale = yank("fn_bar_quick_sale");
console.error(
  `ยกมาจาก: add_lines ← ${addLines.file} · close_sale ← ${closeSale.file} · quick_sale ← ${quickSale.file}`,
);

// ── 1) fn_bar_add_lines: รับ line_discount_pct มาเก็บเป็น "คำอธิบาย"
let a = addLines.body;
const aOld = `            greatest(coalesce((v_row->>'line_discount')::numeric, 0), 0),
            v_comp,
            v_amount,
            v_cost);`;
const aNew = `            greatest(coalesce((v_row->>'line_discount')::numeric, 0), 0),
            -- 🚨 **% เป็นคำอธิบายเท่านั้น — ตัวเงินคือ line_discount ข้างบน**
            --    SQL ตั้งใจ *ไม่* คิดบาทจาก % ซ้ำ: ราคาเมนูเปลี่ยนวันหลังแล้วบิลเก่าจะขยับตาม
            --    = ยอดที่ลงบัญชีไปแล้วเพี้ยน (กติกา D75 · ตัวเงินต้องเป็นค่าที่แช่ไว้)
            nullif(least(greatest(coalesce((v_row->>'line_discount_pct')::numeric, 0), 0), 100), 0),
            v_comp,
            v_amount,
            v_cost);`;
if (!a.includes(aOld)) throw new Error("โครง insert ของ fn_bar_add_lines ไม่ตรงกับที่คาด");
a = a.split(aOld).join(aNew);
a = a.replace(
  "                              qty, price, line_discount, is_comp, amount, cost)",
  "                              qty, price, line_discount, line_discount_pct, is_comp, amount, cost)",
);
if (!a.includes("line_discount_pct, is_comp")) throw new Error("เติมคอลัมน์ใน insert ไม่สำเร็จ");

// ── 2) fn_bar_close_sale: รับ p_discount_pct แล้วแช่ลงแถว
let c = closeSale.body;
c = c.replace(
  "  p_business_date date, p_discount numeric default 0, p_rounding numeric default 0\n) returns jsonb",
  "  p_business_date date, p_discount numeric default 0, p_rounding numeric default 0,\n  p_discount_pct numeric default null\n) returns jsonb",
);
if (!c.includes("p_discount_pct numeric default null")) throw new Error("เติมพารามิเตอร์ close_sale ไม่สำเร็จ");
c = c.replace(
  "    rounding = coalesce(p_rounding, 0), grand_total = v_grand, cost_total = v_cost",
  "    rounding = coalesce(p_rounding, 0), grand_total = v_grand, cost_total = v_cost,\n    -- ★ เก็บไว้พิมพ์บนสลิปว่า \"ส่วนลดท้ายบิล 10%\" · ตัวเงินยังเป็น `discount` ข้างบน\n    discount_pct = nullif(least(greatest(coalesce(p_discount_pct, 0), 0), 100), 0)",
);
if (!c.includes("discount_pct = nullif")) throw new Error("เติม discount_pct ใน update ไม่สำเร็จ");

// ── 3) fn_bar_quick_sale: ส่ง % ต่อให้ close_sale
let q = quickSale.body;
q = q.replace(
  "  p_discount numeric default 0, p_rounding numeric default 0\n) returns jsonb",
  "  p_discount numeric default 0, p_rounding numeric default 0,\n  p_discount_pct numeric default null\n) returns jsonb",
);
if (!q.includes("p_discount_pct numeric default null")) throw new Error("เติมพารามิเตอร์ quick_sale ไม่สำเร็จ");
q = q.replace(
  "  return fn_bar_close_sale(p_entity, v_no, p_method, p_business_date, p_discount, p_rounding);",
  "  return fn_bar_close_sale(p_entity, v_no, p_method, p_business_date, p_discount, p_rounding,\n                           p_discount_pct);",
);
if (!q.includes("p_discount_pct);")) throw new Error("ส่ง % ต่อให้ close_sale ไม่สำเร็จ");

const out = `-- ─────────────────────────────────────────────────────────────────────────────
-- 0068 — ส่วนลดเป็น %  (D96 · ภาค 2 เฟส C)
--
-- 🎯 ผู้ใช้ขอ "ส่วนลดซ่อนได้ แต่อยากให้มีส่วนลดเป็น % ด้วย"
--
-- 🚨 **ตัวเงินยังเป็นบาทเหมือนเดิมทุกประการ** — คอลัมน์ \`*_pct\` เป็น **คำอธิบาย**
--    ไว้พิมพ์บนสลิปว่า "ลด 10%" เท่านั้น · SQL ตั้งใจ **ไม่คิดบาทจาก % ซ้ำ**
--    เพราะราคาเมนูเปลี่ยนวันหลังแล้วส่วนลดของบิลเก่าจะขยับตาม
--    ⇒ ยอดที่ลงบัญชีไปแล้วเพี้ยนโดยไม่มีอะไรฟ้อง (กติกา D75)
--    ★ ฝั่ง TS แปลง % → บาท ที่ \`lib/bar/discount.ts\` (golden B10) แล้วส่งบาทมาให้
--      ⇒ **สูตรเงินยังมีที่เดียว** (บทเรียน D79 · แพตเทิร์นเดียวกับ D86)
--
-- 🪤 \`fn_bar_close_sale\` / \`fn_bar_quick_sale\` **เพิ่มพารามิเตอร์** → ต้อง drop ก่อน
--    ไม่งั้นได้ overload ตัวที่สอง แล้ว PostgREST เลือกตัวไหนก็ไม่รู้ (บทเรียน D69)
--
-- 🚨 ยกทั้ง 3 ฟังก์ชันมาด้วยสคริปต์ scripts/gen/gen-0068.mjs ไม่ได้พิมพ์ใหม่ (D79)
-- ─────────────────────────────────────────────────────────────────────────────

alter table bar_sale      add column if not exists discount_pct      numeric;
alter table bar_sale_item add column if not exists line_discount_pct numeric;

comment on column bar_sale.discount_pct is
  'ส่วนลดท้ายบิลที่ผู้ใช้กรอกเป็น % — คำอธิบายเท่านั้น ตัวเงินอยู่ที่ discount (D96)';
comment on column bar_sale_item.line_discount_pct is
  'ส่วนลดรายการที่ผู้ใช้กรอกเป็น % — คำอธิบายเท่านั้น ตัวเงินอยู่ที่ line_discount (D96)';

${a}

drop function if exists fn_bar_quick_sale(text, jsonb, text, date, text, text, numeric, numeric);
drop function if exists fn_bar_close_sale(text, text, text, date, numeric, numeric);

${c}

${q}
`;

fs.writeFileSync(path.join(MIG, OUT), out);
console.error(`เขียน ${OUT} แล้ว`);
