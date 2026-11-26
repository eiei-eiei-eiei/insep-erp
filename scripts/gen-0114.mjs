// scripts/gen-0114.mjs — สร้าง migration 0114 (แก้ตามรีวิว Fable รอบ 1 · D182)
//
// ★ ยกนิยาม "ล่าสุด" ของแต่ละฟังก์ชันจากไฟล์ migration มาแบบอัตโนมัติ แล้วแทนที่ทีละจุด
//   ทุกจุดต้องเจอ **ครั้งเดียวพอดี** ไม่งั้นหยุด (กันแทนผิดที่/ฟังก์ชันเปลี่ยนไปแล้ว · D79/D85)
// ★ ไม่พิมพ์ตัวฟังก์ชันใหม่ด้วยมือ — diff ระหว่างของเดิมกับของใหม่ต้องเหลือแค่จุดที่ตั้งใจ
//
// usage: node scripts/gen-0114.mjs            → เขียน supabase/migrations/20261126000114_fable_review_fixes.sql
//        node scripts/gen-0114.mjs --diff     → พิมพ์ของเดิม/ของใหม่ไว้ที่ scripts/gen/0114-{orig,new}/ ให้ diff
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const MIG = path.join(ROOT, "supabase", "migrations");
const OUT = path.join(MIG, "20261126000114_fable_review_fixes.sql");

/** นิยามล่าสุดของฟังก์ชัน (ข้อความตั้งแต่ create … จนจบ $tag$;) */
function latestDef(name) {
  const files = fs.readdirSync(MIG).filter((f) => f.endsWith(".sql") && f < "20261126000114").sort();
  const re = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+(public\\.)?${name}\\s*\\(`, "ig");
  let last = null;
  for (const f of files) {
    const s = fs.readFileSync(path.join(MIG, f), "utf8");
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(s))) last = { f, s, idx: m.index };
  }
  if (!last) throw new Error(`ไม่พบฟังก์ชัน ${name}`);
  const after = last.s.slice(last.idx);
  const tag = after.match(/\$([a-z_]*)\$/i)[0];
  const st = after.indexOf(tag);
  const en = after.indexOf(tag, st + tag.length);
  const semi = after.indexOf(";", en);
  return { from: last.f, text: after.slice(0, semi + 1).replace(/\r\n/g, "\n") };
}

/** แทนที่ — ต้องเจอครั้งเดียวพอดี */
function sub(text, find, repl, label) {
  const n = text.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] เจอ ${n} ครั้ง (ต้อง 1): ${find.slice(0, 80)}`);
  return text.replace(find, repl);
}

const out = [];
const diffs = [];
function emit(name, header, edits) {
  const { from, text } = latestDef(name);
  let t = text;
  for (const [find, repl] of edits) t = sub(t, find, repl, name);
  diffs.push({ name, from, orig: text, next: t });
  out.push(`-- ── ${header}\n--    ยกจาก ${from} (นิยามล่าสุด) · เปลี่ยนเฉพาะจุดที่มี ★ 0114\n${t}\n`);
}

// ════════════════════════════════════════════════════════════════════════════
// R3 — "วันนี้" ตามเวลาไทย (current_date บน Supabase = UTC · 00:00–06:59 ได้วันของเมื่อวาน)
// ════════════════════════════════════════════════════════════════════════════
const TH = "(now() at time zone 'Asia/Bangkok')::date";

emit("fn_cancel_order", "R3 · แถวรับคืนสต็อกสุรา (log_product → ฟอร์ม ภส.) ลงวันที่ไทย", [
  [
    "select v_tenant, v_order.entity_id, current_date, 'รับ',",
    "select v_tenant, v_order.entity_id, v_today, 'รับ',   -- ★ 0114 R3: เดิม current_date (UTC)",
  ],
]);

emit("fn_receive_material", "R3 · รับวัตถุดิบจากบิล — วันที่ปริยายเป็นวันไทย", [
  ["coalesce(p_date, current_date), 'รับ', mid,", `coalesce(p_date, ${TH}), 'รับ', mid,   -- ★ 0114 R3`],
]);

emit("fn_sell_product", "R3 · ตัดสต็อกขาย — วันที่ปริยายเป็นวันไทย", [
  ["values (coalesce(p_date, current_date), coalesce(p_trans_type, 'จ่าย'),", `values (coalesce(p_date, ${TH}), coalesce(p_trans_type, 'จ่าย'),   -- ★ 0114 R3`],
]);

emit("fn_sales_installment_invoice", "R3 · ใบแจ้งหนี้รายงวด — วันที่ปริยายเป็นวันไทย", [
  ["inv_date = coalesce(p_inv_date, current_date),", `inv_date = coalesce(p_inv_date, ${TH}),   -- ★ 0114 R3`],
]);

emit("fn_save_quotation", "R3 · วันหมดอายุใบเสนอราคา = วันนี้ (ไทย) + 15", [
  ["v_exp date := current_date + 15;   -- quExpire +15 วัน", `v_exp date := ${TH} + 15;   -- quExpire +15 วัน · ★ 0114 R3: เดิม current_date (UTC)`],
]);

emit("fn_save_transfer", "R3 + Y3 · โอนระหว่างบัญชี — วันไทย + ต้องระบุกิจการจริง (ไม่ใช่ 'ทุกกิจการ')", [
  ["v_date date := coalesce(p_date, current_date);", `v_date date := coalesce(p_date, ${TH});   -- ★ 0114 R3`],
  [
    "  if coalesce(p_amount,0) <= 0 then\n    return jsonb_build_object('ok', false, 'error', 'จำนวนเงินต้องมากกว่า 0'); end if;\n",
    "  if coalesce(p_amount,0) <= 0 then\n    return jsonb_build_object('ok', false, 'error', 'จำนวนเงินต้องมากกว่า 0'); end if;\n" +
      "  -- ★ 0114 Y3: เลือก \"ทุกกิจการ\" ที่แถบบนแล้วกดโอน = ส่ง 'ALL' / '' มา → FK ล้มด้วย error อังกฤษดิบ\n" +
      "  --   เงินโอนต้องอยู่กิจการใดกิจการหนึ่งเสมอ ⇒ บอกให้เลือกก่อน (ฝาแฝด TS: transferBlockedText)\n" +
      "  if coalesce(trim(p_entity),'') in ('', 'ALL') then\n" +
      "    return jsonb_build_object('ok', false, 'error', 'เลือกกิจการที่แถบด้านบนก่อน — เงินโอนต้องลงกิจการใดกิจการหนึ่ง (ตอนนี้เลือก \"ทุกกิจการ\" อยู่)'); end if;\n",
  ],
]);

// ════════════════════════════════════════════════════════════════════════════
// Y4 + R3 — 50ทวิ: เลิกฮาร์ดโค้ด EID01 · วันที่ปริยายเป็นวันไทย
// ════════════════════════════════════════════════════════════════════════════
emit("fn_issue_wht", "Y4 + R3 · ออก 50ทวิ — ไม่ระบุกิจการ = กิจการของบิล (เดิมตก EID01 เสมอ)", [
  [
    "  v_entity text := coalesce(nullif(p_entity_id,''),'EID01');\n",
    "  -- ★ 0114 Y4: เดิม coalesce(…,'EID01') — tenant ที่กิจการแรกไม่ใช่ EID01 = FK ล้ม ·\n" +
      "  --   บิลของ EID02 ที่ออกจากมุม \"ทุกกิจการ\" = ใบออกในนาม EID01 + กินเลขชุดของ EID01\n" +
      "  --   ⇒ ไม่ระบุ = กิจการของบิลในใบ (ต้องเป็นกิจการเดียวกันทุกใบ) · ไม่มีบิล (50ทวิ พนักงาน) ต้องระบุเอง\n" +
      "  v_entity text := nullif(trim(coalesce(p_entity_id,'')),'');\n" +
      "  v_bill_ents text[];\n",
  ],
  [
    "begin\n  if v_emp is not null then",
    "begin\n" +
      "  if v_entity is null or v_entity = 'ALL' then\n" +
      "    select array_agg(distinct entity_id) into v_bill_ents\n" +
      "      from transactions where tx_id = any(coalesce(p_tx_ids,'{}'));\n" +
      "    if coalesce(array_length(v_bill_ents, 1), 0) = 1 then\n" +
      "      v_entity := v_bill_ents[1];\n" +
      "    elsif coalesce(array_length(v_bill_ents, 1), 0) > 1 then\n" +
      "      return jsonb_build_object('ok', false, 'error', 'บิลในใบนี้อยู่คนละกิจการกัน — 1 ใบ 50ทวิ ออกได้ในนามกิจการเดียว');\n" +
      "    else\n" +
      "      return jsonb_build_object('ok', false, 'error', 'ไม่รู้ว่าออก 50ทวิ ในนามกิจการไหน — เลือกกิจการที่แถบด้านบนก่อน');\n" +
      "    end if;\n" +
      "  end if;\n\n" +
      "  if v_emp is not null then",
  ],
  ["values (p_doc_no, coalesce(p_issue_date, current_date), p_contact_name,", `values (p_doc_no, coalesce(p_issue_date, ${TH}), p_contact_name,   -- ★ 0114 R3\n   `],
  ["update transactions set payment_date = coalesce(p_payment_date, current_date)", `update transactions set payment_date = coalesce(p_payment_date, ${TH})   -- ★ 0114 R3`],
]);

// ════════════════════════════════════════════════════════════════════════════
// Y5 — ปรับสต็อกคลังขายด้วยมือ: คีย์ครบ (tenant, entity, item_code)
// ════════════════════════════════════════════════════════════════════════════
emit("fn_manual_stock_move", "Y5 · ปรับสต็อกคลังขาย — กรองกิจการ (เดิมเขียนทับทุกกิจการที่ item_code ซ้ำ)", [
  [
    "  v_before numeric; v_name text; v_after numeric; v_action text;\nbegin\n",
    "  v_before numeric; v_name text; v_after numeric; v_action text;\n" +
      "  -- ★ 0114 Y5: PK คือ (tenant, entity, item_code) แต่เดิมหา/แก้ด้วย item_code อย่างเดียว\n" +
      "  --   ⇒ 2 กิจการที่มีรหัสเดียวกัน ถูกเขียนทับพร้อมกันด้วยเลขของแถวที่ select เจอก่อน\n" +
      "  --   ใช้กิจการเดียวกับที่ออเดอร์ใช้ (sales_orders.entity_id default = my_default_entity())\n" +
      "  --   🪤 ถ้าวันหน้าออเดอร์เลือกกิจการได้ (งานค้าง R1) ตัวนี้ต้องตามไปด้วย\n" +
      "  v_tenant uuid := my_tenant();\n" +
      "  v_entity text := my_default_entity();\n" +
      "begin\n" +
      "  if v_tenant is null or v_entity is null then\n" +
      "    return jsonb_build_object('ok', false, 'error', 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'); end if;\n",
  ],
  [
    "select qty, item_name into v_before, v_name from warehouse_stock where item_code = v_code for update;",
    "select qty, item_name into v_before, v_name from warehouse_stock\n" +
      "   where tenant_id = v_tenant and entity_id = v_entity and item_code = v_code for update;   -- ★ 0114 Y5",
  ],
  [
    "update warehouse_stock set qty = v_after where item_code = v_code;",
    "update warehouse_stock set qty = v_after\n   where tenant_id = v_tenant and entity_id = v_entity and item_code = v_code;   -- ★ 0114 Y5",
  ],
  [
    "insert into stock_moves(item_code, item_name, qty_before, action, qty, ref_no, qty_after, user_name, remarks)\n  values (v_code,",
    "-- ★ 0114 Y5: ระบุ tenant/กิจการตรง ๆ (เดิมพึ่ง default ของคอลัมน์)\n  insert into stock_moves(tenant_id, entity_id, item_code, item_name, qty_before, action, qty, ref_no, qty_after, user_name, remarks)\n  values (v_tenant, v_entity, v_code,",
  ],
]);

// ════════════════════════════════════════════════════════════════════════════
// R5 — ลบ batch หมักที่รินสุราแช่ไปแล้ว
// ════════════════════════════════════════════════════════════════════════════
emit("fn_delete_ferment_batch", "R5 · ลบ batch หมัก — กันฝั่งสุราแช่ (รินแล้ว) ให้เท่าฝั่งกลั่น", [
  [
    "  -- คืนวัตถุดิบ: ลบแถวเบิกอัตโนมัติ",
    "  -- ★ 0114 R5: ฝั่งสุราแช่ (D78) batch จบที่ \"ริน\" ไม่ใช่ \"กลั่น\" — เดิมไม่กัน ⇒ ลบผ่าน\n" +
      "  --   แล้ว log_ferment_draw ลอยค้าง: ฟอร์ม ภส.๐๗-๐๒/๑(๑) ฉบับสุราแช่หักน้ำหมักของ batch ที่ไม่มีบันทึกหมัก\n" +
      "  --   และ ๐๗-๐๑/๑ เสียแถวจ่ายวัตถุดิบ (สองข้างไม่สมมาตรแบบ D80-C2) · ข้อความบนจอคู่กัน: FermentTab.tsx\n" +
      "  if exists (select 1 from log_ferment_draw where batch = p_batch) then\n" +
      "    return jsonb_build_object('ok', false,\n" +
      "      'error', 'batch \"' || p_batch || '\" รินสุราแช่ไปแล้ว ลบไม่ได้ (มีข้อมูล ภส.) — ถ้าต้องแก้จริงให้ลบรายการรินในแท็บ \"รินน้ำสุราแช่\" ก่อน');\n" +
      "  end if;\n\n" +
      "  -- คืนวัตถุดิบ: ลบแถวเบิกอัตโนมัติ",
  ],
]);

// ════════════════════════════════════════════════════════════════════════════
// Y6 — ยกเลิกรายการในบิลบาร์ที่ปิดแล้ว: คิดส่วนลด % และปัดเศษใหม่ + สถิติลูกค้า
// ════════════════════════════════════════════════════════════════════════════
emit("fn_bar_void_line", "Y6 · ยกเลิกรายการบิลบาร์ — ส่วนลด % / ปัดเศษ คิดจากยอดใหม่ · ยอดซื้อสะสมลูกค้าถอยตาม", [
  [
    "  v_sub numeric;\n  v_cost numeric;\nbegin\n",
    "  v_sub numeric;\n  v_cost numeric;\n" +
      "  -- ★ 0114 Y6\n  v_disc numeric; v_after numeric; v_round numeric; v_grand numeric; v_round_cash boolean;\n" +
      "begin\n",
  ],
  [
    "  update bar_sale s set\n    sub_total = v_sub,\n    discount = least(s.discount, v_sub),\n    grand_total = greatest(0, v_sub - least(s.discount, v_sub)) + s.rounding,\n    cost_total = v_cost\n  where s.tenant_id = v_tenant and s.entity_id = p_entity and s.sale_no = p_sale_no;\n",
    "  -- ★ 0114 Y6 — เดิม: discount = least(เดิม, ยอดใหม่) · grand = … + rounding **เดิม**\n" +
      "  --   ⇒ ส่วนลด 10% ค้างเป็นบาทเดิม (ป้าย 10% ไม่ตรงกับบาท) · ยอดลงท้ายไม่กลมทั้งที่เปิดปัดเศษ\n" +
      "  --   · ยกเลิกหมดทั้งบิลเหลือ grand = rounding (เช่น 0.25)\n" +
      "  --   ใหม่ (ผู้ใช้ตัดสิน 2026-11-26): ลด % → คิดจากยอดใหม่ · ลดเป็นบาท → คงบาทเดิม (ไม่เกินยอด)\n" +
      "  --   ปัดเศษ → คิดใหม่จากค่าตั้ง bar_round_cash ปัจจุบัน (ตัวเดียวกับที่จอขายใช้) — ฝาแฝด TS: barTotals()\n" +
      "  v_disc := case when v_sale.discount_pct is not null\n" +
      "                 then round(v_sub * least(v_sale.discount_pct, 100) / 100, 2)\n" +
      "                 else v_sale.discount end;\n" +
      "  v_disc := least(greatest(coalesce(v_disc, 0), 0), v_sub);\n" +
      "  v_after := greatest(0, v_sub - v_disc);\n" +
      "  select exists (select 1 from app_settings\n" +
      "                  where tenant_id = v_tenant and kind = 'bar_round_cash' and value = '1')\n" +
      "    into v_round_cash;\n" +
      "  -- 🪤 บิลที่ยังเปิดอยู่ไม่ปัด (ยังไม่ได้ปิดบิล — fn_bar_close_sale คิดทั้งก้อนใหม่ตอนปิดเอง)\n" +
      "  v_round := case when v_round_cash and v_sale.status = 'ปกติ' then round(v_after) - v_after else 0 end;\n" +
      "  v_grand := v_after + v_round;\n\n" +
      "  update bar_sale s set\n    sub_total = v_sub,\n    discount = v_disc,\n    rounding = v_round,\n    grand_total = v_grand,\n    cost_total = v_cost\n  where s.tenant_id = v_tenant and s.entity_id = p_entity and s.sale_no = p_sale_no;\n\n" +
      "  -- ★ 0114 Y6: ยอดซื้อสะสมลูกค้าถอยตามส่วนที่หายไป — ไม่งั้นยกเลิกทั้งบิลทีหลัง (fn_bar_void_sale\n" +
      "  --   หักด้วย grand_total ใหม่) จะเหลือยอดค้างเท่ารายการที่ยกเลิกไปก่อนหน้า\n" +
      "  if v_sale.status = 'ปกติ' and v_sale.customer_id is not null then\n" +
      "    update bar_customer set spend_total = greatest(0, spend_total - (v_sale.grand_total - v_grand))\n" +
      "     where tenant_id = v_tenant and entity_id = p_entity and customer_id = v_sale.customer_id;\n" +
      "  end if;\n",
  ],
]);

const header = `-- ============================================================================
-- 0114 แก้ตามรีวิว Fable รอบ 1 (REVIEW_FABLE_1.md · คัดกรอง REVIEW_FABLE_1_TRIAGE.md) — D182
--
-- ★ ไฟล์นี้สร้างด้วย \`node scripts/gen-0114.mjs\` — ยกนิยามล่าสุดของแต่ละฟังก์ชันมาแล้วแทนที่ทีละจุด
--   (ทุกจุดต้องเจอครั้งเดียวพอดี ไม่งั้นสคริปต์หยุด) ห้ามแก้ไฟล์นี้มือ — แก้สคริปต์แล้วสร้างใหม่
-- ★ ทุกตัวเป็น create or replace (พารามิเตอร์เท่าเดิม) ⇒ สิทธิ์ execute คงเดิม ไม่ต้อง revoke ซ้ำ (D99)
--
--   R3  "วันนี้" ตามเวลาไทยใน 7 ฟังก์ชันที่ยังเหลือ current_date (UTC) — fn_cancel_order (แถว ภส.)
--       fn_receive_material · fn_sell_product · fn_sales_installment_invoice · fn_save_quotation
--       fn_save_transfer · fn_issue_wht   (ตัวอื่นแก้ไปแล้วใน 0075-0078 · D100)
--   R5  fn_delete_ferment_batch กัน batch ที่รินสุราแช่แล้ว
--   Y3  fn_save_transfer ไม่รับกิจการว่าง/'ALL'
--   Y4  fn_issue_wht เลิกฮาร์ดโค้ด 'EID01' — ใช้กิจการของบิล
--   Y5  fn_manual_stock_move กรอง tenant + กิจการ
--   Y6  fn_bar_void_line คิดส่วนลด % / ปัดเศษ ใหม่ + ยอดซื้อสะสมลูกค้า
--
-- 🚫 ไม่แตะ: R1 (กิจการเจ้าของออเดอร์ — ผู้ใช้สั่งพักไว้เป็นงานใหม่) · สูตร VAT/ภาษี/ดีกรี ไม่มีตัวไหนเปลี่ยน
-- ============================================================================

`;

fs.writeFileSync(OUT, header + out.join("\n"));
console.log("wrote", path.relative(ROOT, OUT));

if (process.argv.includes("--diff")) {
  const dir = path.join(ROOT, "scripts", "gen");
  for (const k of ["0114-orig", "0114-new"]) fs.mkdirSync(path.join(dir, k), { recursive: true });
  for (const d of diffs) {
    fs.writeFileSync(path.join(dir, "0114-orig", `${d.name}.sql`), d.orig + "\n");
    fs.writeFileSync(path.join(dir, "0114-new", `${d.name}.sql`), d.next + "\n");
  }
  console.log("diff: git diff --no-index scripts/gen/0114-orig scripts/gen/0114-new");
}
