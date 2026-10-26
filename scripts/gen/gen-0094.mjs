/**
 * สร้าง migration 0094 (D132 ย้ายบิลไปกิจการอื่น) — ยก fn_edit_transaction จาก migration ล่าสุด
 * ที่นิยามมันมาคำต่อคำ แล้วเติมแค่ด่าน "ย้ายกิจการ"
 *
 * 🚨 ห้ามพิมพ์มือ (D79) · รัน:  node scripts/gen/gen-0094.mjs
 */
import fs from "node:fs";
import path from "node:path";

const OUT_NAME = "20261026000094_edit_tx_entity.sql";
const HEADER = "scripts/gen/0094-header.sql";
const OUT = `supabase/migrations/${OUT_NAME}`;
const NAME = "fn_edit_transaction";

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

const srcFile = latestWith(`create or replace function ${NAME}(`);
let fn = lift(fs.readFileSync(srcFile, "utf8"), NAME);

fn = replaceOnce(
  fn,
  "  n int;\nbegin\n",
  "  n int;\n" +
    "  -- D132: ย้ายกิจการ\n" +
    "  v_tenant uuid;\n" +
    "  v_old_entity text;\n" +
    "  v_new_entity text;\n" +
    "  v_source text;\n" +
    "  v_type text;\n" +
    "  v_adv_for text;\n" +
    "  v_adv_clear text;\n" +
    "  v_adv_src text;\n" +
    "  v_wht text;\n" +
    "begin\n",
  "declare",
);

fn = replaceOnce(
  fn,
  "  select po_group_id, transfer_id into v_group, v_transfer\n    from transactions where tx_id = p_tx_id;\n",
  "  select po_group_id, transfer_id,\n" +
    "         tenant_id, entity_id, source, type, advance_for_entity, advance_clear_id, advance_src_tx\n" +
    "    into v_group, v_transfer,\n" +
    "         v_tenant, v_old_entity, v_source, v_type, v_adv_for, v_adv_clear, v_adv_src\n" +
    "    from transactions where tx_id = p_tx_id;\n",
  "select",
);

const GUARD =
  "\n" +
  "  -- ── D132: ย้ายกิจการ — ด่านเหล่านี้ทำงานเฉพาะตอนเปลี่ยนกิจการจริง ─────────────\n" +
  "  -- 🚨 เงื่อนไขต้องตรงกับ entityMoveBlock()/entityMoveError() ใน lib/accounting/entityMove.ts\n" +
  "  v_new_entity := coalesce(nullif(p->>'entity_id',''), v_old_entity);\n" +
  "  if v_new_entity <> v_old_entity then\n" +
  "    if not exists (select 1 from entities where tenant_id = v_tenant and entity_id = v_new_entity) then\n" +
  "      return jsonb_build_object('ok', false, 'error', 'ไม่พบกิจการ ' || v_new_entity);\n" +
  "    end if;\n" +
  "    if v_adv_clear is not null or v_adv_src is not null then\n" +
  "      return jsonb_build_object('ok', false,\n" +
  "        'error', 'บิลที่เกิดจากการเคลียสำรองจ่าย ย้ายกิจการไม่ได้ — ใช้ปุ่ม ถอนการเคลีย ในแท็บ ลูกหนี้-เจ้าหนี้');\n" +
  "    end if;\n" +
  "    if coalesce(v_source, 'ui') not in ('ui', 'migration') then\n" +
  "      return jsonb_build_object('ok', false,\n" +
  "        'error', 'บิลนี้ระบบสร้างให้อัตโนมัติ (' || v_source || ') — ย้ายกิจการจากหน้าแก้บิลไม่ได้ ให้แก้ที่ต้นทาง');\n" +
  "    end if;\n" +
  "    select string_agg(doc_no, ', ' order by doc_no) into v_wht\n" +
  "      from wht_certificates where tenant_id = v_tenant and p_tx_id = any(tx_ids);\n" +
  "    if v_wht is not null then\n" +
  "      return jsonb_build_object('ok', false,\n" +
  "        'error', 'บิลนี้ออกใบ 50ทวิ ไปแล้ว (' || v_wht || ') ในนามกิจการเดิม — ย้ายกิจการไม่ได้ ให้ยกเลิกบิลแล้วบันทึกใหม่ในกิจการที่ถูก');\n" +
  "    end if;\n" +
  "    if v_type = 'สำรองจ่าย' and v_adv_for = v_new_entity then\n" +
  "      return jsonb_build_object('ok', false,\n" +
  "        'error', 'บิลนี้สำรองจ่ายให้ ' || v_new_entity || ' อยู่แล้ว — ย้ายไปเป็นของกิจการนั้นเองไม่ได้ ให้ยกเลิกแล้วบันทึกใหม่เป็นรายจ่าย');\n" +
  "    end if;\n" +
  "  end if;\n";

fn = replaceOnce(
  fn,
  "      'error', 'บิลนี้เป็นกลุ่มงวด/โอนระหว่างบัญชี — แก้ไม่ได้ ให้ยกเลิกแล้วสร้างใหม่');\n  end if;\n",
  "      'error', 'บิลนี้เป็นกลุ่มงวด/โอนระหว่างบัญชี — แก้ไม่ได้ ให้ยกเลิกแล้วสร้างใหม่');\n  end if;\n" + GUARD,
  "guard",
);

const out =
  fs.readFileSync(HEADER, "utf8") +
  `-- ── fn_edit_transaction — ยกจาก ${path.basename(srcFile)} คำต่อคำ + ด่านย้ายกิจการ ──\n` +
  fn;
fs.writeFileSync(OUT, out);
console.log("เขียน", OUT, "จาก", srcFile);
