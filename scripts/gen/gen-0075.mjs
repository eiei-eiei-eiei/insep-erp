/**
 * gen-0075 — เลขเอกสารใช้ "วันนี้ตามเวลาไทย" ไม่ใช่ current_date (UTC) · D100 เฟส 0
 *
 * 🚨 กติกา D79/D91: ยก body ของฟังก์ชันเดิมมาด้วยสคริปต์จากไฟล์ล่าสุดที่นิยามมัน
 *    แล้วแทนเฉพาะ 2 บรรทัดที่ประกอบเลข TRF — ตรรกะอื่นของการโอนเงินไม่ถูกแตะแม้ตัวเดียว
 */
import fs from "node:fs";
import path from "node:path";

const MIG = "supabase/migrations";
const OUT = "20260928000075_doc_no_thai_date.sql";

function yank(name, endTag) {
  const files = fs.readdirSync(MIG).filter((f) => f.endsWith(".sql") && f !== OUT).sort();
  let found = null;
  for (const f of files) {
    // 🪤 ไฟล์ migration บางไฟล์เป็น CRLF (git autocrlf) — ทำให้เป็น LF ก่อนเทียบข้อความ
    const src = fs.readFileSync(path.join(MIG, f), "utf8").replace(/\r\n/g, "\n");
    const head = src.search(new RegExp(`create (or replace )?function ${name}\\(`));
    if (head < 0) continue;
    const tail = src.indexOf(endTag, head);
    if (tail < 0) throw new Error(`หา ${endTag} ของ ${name} ใน ${f} ไม่เจอ`);
    found = { file: f, body: src.slice(head, tail + endTag.length) };
  }
  if (!found) throw new Error(`ไม่พบนิยามของ ${name}`);
  return found;
}

const trf = yank("fn_save_transfer", "end $$;");
const OLD =
  "  v_trf := 'TRF-' || to_char(current_date,'YYYYMMDD') || '-' ||\n" +
  "           lpad(next_serial('TRF-' || to_char(current_date,'YYYYMMDD'))::text, 4, '0');";
const NEW =
  "  v_trf := 'TRF-' || to_char(fn_today_th(),'YYYYMMDD') || '-' ||\n" +
  "           lpad(next_serial('TRF-' || to_char(fn_today_th(),'YYYYMMDD'))::text, 4, '0');";
if (!trf.body.includes(OLD)) throw new Error("บรรทัดประกอบเลข TRF ไม่ตรงกับที่คาด — ห้ามเดา หยุด");
const trfBody = trf.body.replace(OLD, NEW);
if (trfBody.includes("to_char(current_date")) throw new Error("ยังเหลือ current_date ในการประกอบเลข");
console.error(`ยกมาจาก: fn_save_transfer ← ${trf.file}`);

const header = fs.readFileSync("scripts/gen/0075-header.sql", "utf8");
const out = `${header}
-- ── 3) fn_save_transfer — ยกจาก ${trf.file} · แทนแค่ 2 บรรทัดประกอบเลข TRF ───────────
${trfBody}

notify pgrst, 'reload schema';
`;
// ด่านวงเล็บ (บทเรียน D96 ภาค 2 ข้อ 4 — generator ที่ผลิต SQL ผิดรูปอันตรายกว่าพิมพ์เอง)
// ★ นับเฉพาะโค้ด — คอมเมนต์หัวข้อ "1) 2) 3)" มีวงเล็บปิดเดี่ยว ๆ โดยตั้งใจ
const code = out.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''");
const bal = [...code].reduce((n, c) => n + (c === "(" ? 1 : c === ")" ? -1 : 0), 0);
if (bal !== 0) throw new Error(`วงเล็บไม่สมดุล (${bal})`);
fs.writeFileSync(path.join(MIG, OUT), out);
console.error(`เขียน ${OUT} แล้ว`);
