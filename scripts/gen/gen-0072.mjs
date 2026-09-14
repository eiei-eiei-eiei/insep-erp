/**
 * สร้าง migration 0072 (D95 รอบแก้) — ยก `fn_file_tax` จาก 0071 มาทั้งดุ้น
 * แล้วแทรกด่าน "ไม่พบกิจการ" ก่อนด่าน VAT
 *
 * 🚨 ห้ามพิมพ์มือ (D79) · รัน:  node scripts/gen/gen-0072.mjs
 */
import fs from "node:fs";
import path from "node:path";

const OUT_NAME = "20260914000072_file_tax_entity_guard.sql";
const HEADER = "scripts/gen/0072-header.sql";
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

const SRC = latestWith("function fn_file_tax(");
let fn = lift(fs.readFileSync(SRC, "utf8"), "fn_file_tax");

/**
 * แทรก **ก่อน** ด่าน VAT โดยเจตนา — ถ้าไม่มีกิจการนั้นอยู่จริง `entity_is_vat()` คืน false
 * แล้วผู้ใช้จะได้ข้อความ *"ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม"* ซึ่งเป็นเหตุผลที่ผิด
 */
const anchor = `  -- 🚨 กิจการที่ไม่ได้จด VAT ไม่มีหน้าที่ยื่น ภพ.30 → บล็อกที่ DB ด้วย (กติกาเดียวกับ 0036/0054)`;
if (!fn.includes(anchor)) throw new Error("ไม่พบจุดแทรก (ด่าน VAT) ใน fn_file_tax");
fn = fn.replace(
  anchor,
  [
    "  /*",
    "   * ไม่มีกิจการนี้อยู่จริง = ตอบเป็นภาษาไทยตั้งแต่ตรงนี้ (แพตเทิร์น fn_excise_close_month · D91)",
    "   *",
    "   * 🚨 ต้องอยู่ **ก่อน** ด่าน VAT — ไม่งั้น `entity_is_vat()` คืน false แล้วผู้ใช้ได้ข้อความ",
    "   *    *ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม* ซึ่งเป็นเหตุผลที่ผิด (ตระกูล D91/0059:",
    "   *    ด่านกันถูก แต่ประโยคพาผู้ใช้ไปแก้ผิดเรื่อง)",
    "   * ★ กรณี pnd3/pnd53 เดิมหลุดไปชน FK แล้วโยน SQLSTATE 23503 ดิบออกหน้าจอ",
    "   */",
    "  if not exists (select 1 from entities where tenant_id = v_tenant and entity_id = p_entity) then",
    "    raise exception 'ไม่พบกิจการ %', p_entity;",
    "  end if;",
    "",
    anchor,
  ].join("\n"),
);

fs.writeFileSync(
  OUT,
  [
    fs.readFileSync(HEADER, "utf8"),
    fn,
    "",
    "revoke execute on function fn_file_tax(text, text, text, date, text) from public;",
    "grant  execute on function fn_file_tax(text, text, text, date, text) to authenticated;",
    "",
    "notify pgrst, 'reload schema';",
    "",
  ].join("\n"),
);
console.log("เขียน", OUT, "แล้ว");
