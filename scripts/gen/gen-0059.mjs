/**
 * 0059 — dry-run ของ fn_excise_recompute_hidden ต้องบอก **ทิศทาง** ไม่ใช่แค่จำนวน
 * ยกฟังก์ชันจาก 0058 มาทั้งดุ้นแล้วแทรกตัวนับ — ไม่พิมพ์มือ (D79)
 */
import fs from "node:fs";

const SRC = "supabase/migrations/20260901000058_excise_month_close.sql";
const OUT = "supabase/migrations/20260901000059_recompute_direction.sql";
const src = fs.readFileSync(SRC, "utf8");

const start = src.indexOf("create or replace function fn_excise_recompute_hidden(");
if (start < 0) throw new Error("ไม่พบ fn_excise_recompute_hidden");
const end = src.indexOf("\nend $fn$;\n", start);
if (end < 0) throw new Error("ไม่พบจุดจบของฟังก์ชัน");
let fn = src.slice(start, end + "\nend $fn$;\n".length);

const aDecl = `  r record; v_want boolean; v_changed int := 0; v_n int;`;
if (!fn.includes(aDecl)) throw new Error("ไม่พบ declare");
fn = fn.replace(aDecl, `  r record; v_want boolean; v_changed int := 0; v_n int;
  -- D91b — แยกตามทิศทาง: จะซ่อนเพิ่ม กี่คู่ · จะเอากลับมาแสดง กี่คู่
  v_to_hide int := 0; v_to_show int := 0;`);

const aCount = `    if v_n > 0 then v_changed := v_changed + 1; end if;`;
if (!fn.includes(aCount)) throw new Error("ไม่พบตัวนับ");
fn = fn.replace(aCount, `    if v_n > 0 then
      v_changed := v_changed + 1;
      if v_want then v_to_hide := v_to_hide + 1; else v_to_show := v_to_show + 1; end if;
    end if;`);

const aRet = `  return jsonb_build_object('ok', true, 'changed', v_changed, 'dry', p_dry);`;
if (!fn.includes(aRet)) throw new Error("ไม่พบ return");
fn = fn.replace(aRet, `  return jsonb_build_object('ok', true, 'changed', v_changed,
                            'to_hide', v_to_hide, 'to_show', v_to_show, 'dry', p_dry);`);

const header = `-- ============================================================================
-- 0059 คำนวณการซ่อนใหม่ต้องบอก "ทิศทาง" ไม่ใช่แค่จำนวน — D91 (เจอตอนเทสเบราว์เซอร์)
--
-- 🔴 อาการ: เปิดเดือน ต.ค. ที่มีคู่ จ่าย/รับ ซึ่ง**ถูกซ่อนอยู่** แต่เดือนที่ขาย (ก.ย.) ปิดไปแล้ว
--    หน้าจอขึ้นว่า *"มีคู่ … ที่ยังแสดงบนฟอร์ม — กดเพื่อเอาออก"*
--    ซึ่งเป็น **คำโกหกที่กลับด้านกับความจริงพอดี**: คู่นั้นถูกซ่อนอยู่ และการกดจะทำให้มัน
--    **กลับมาแสดง** (ถูกต้องแล้ว เพราะฟอร์ม ก.ย. ที่ยื่นไปมีแถวนั้นอยู่)
--
-- 🚨 สาเหตุ: dry-run คืนแค่ \`changed\` = "จะเปลี่ยนกี่คู่" ซึ่งเป็นเลขที่ไม่มีทิศทาง
--    แล้วฝั่งหน้าจอ **เดาเอาเองว่าทิศทางคือ 'ซ่อนเพิ่ม' เสมอ** ทั้งที่ recompute
--    ตั้งใจให้เป็นสองทาง (set ทั้ง true และ false) มาตั้งแต่ 0058
--
-- 🪤 บทเรียน (ตระกูล D81): **ตัวเลขที่ไม่มีทิศทาง ห้ามเอาไปแต่งประโยคที่มีทิศทาง**
--    ตรรกะฝั่ง DB ถูกตั้งแต่แรก (พิสูจน์แล้วว่าคู่ข้ามเดือนไม่ถูกซ่อนครึ่งเดียว)
--    ที่ผิดคือ "คำอธิบาย" ซึ่งผู้ใช้อ่านแล้วตัดสินใจกดปุ่ม
--
-- ★ ยกฟังก์ชันจาก 0058 มาทั้งดุ้นด้วยสคริปต์ \`scripts/gen/gen-0059.mjs\` · signature ไม่เปลี่ยน
--   → create or replace ทับได้ ไม่เกิด overload (กับดัก D69)
-- ============================================================================

`;

// ── fn_excise_reopen_month: ส่งทิศทางต่อออกไปด้วย ────────────────────────────
//    ไม่งั้นข้อความหลัง "ถอนปิดเดือน" ก็ยังเป็นตัวเลขไร้ทิศทางเหมือนเดิม
const rs = src.indexOf("create or replace function fn_excise_reopen_month(");
if (rs < 0) throw new Error("ไม่พบ fn_excise_reopen_month");
const re = src.indexOf("\nend $fn$;\n", rs);
let reopen = src.slice(rs, re + "\nend $fn$;\n".length);

const aRDecl = "  v_n int; v_changed int;";
if (!reopen.includes(aRDecl)) throw new Error("ไม่พบ declare ของ reopen");
reopen = reopen.replace(aRDecl, "  v_n int; v_rc jsonb;");

const aRCall = [
  "  v_changed := (fn_excise_recompute_hidden(p_entity, p_month, false) ->> 'changed')::int;",
  "  return jsonb_build_object('ok', true, 'changed', v_changed);",
].join("\n");
if (!reopen.includes(aRCall)) throw new Error("ไม่พบจุดเรียก recompute ของ reopen");
reopen = reopen.replace(
  aRCall,
  [
    "  v_rc := fn_excise_recompute_hidden(p_entity, p_month, false);",
    "  return jsonb_build_object('ok', true,",
    "    'changed', (v_rc ->> 'changed')::int,",
    "    'to_hide', (v_rc ->> 'to_hide')::int,",
    "    'to_show', (v_rc ->> 'to_show')::int);",
  ].join("\n"),
);

fs.writeFileSync(OUT, header + fn + "\n" + reopen + "\nnotify pgrst, 'reload schema';\n");
console.log("เขียน", OUT, "แล้ว");
