/**
 * สร้าง migration 0090 (D127 เหล้าประจำบ้าน/ชุดตกแต่ง/ใช้บ่อย) — ยกฟังก์ชันเดิม 5 ตัวจาก migration
 * ล่าสุดที่นิยามแต่ละตัวมาคำต่อคำ แล้วแก้เฉพาะจุดที่ต้องรู้จักช่องเหล้าประจำบ้าน
 *
 * 🚨 ห้ามพิมพ์มือ (D79) · รัน:  node scripts/gen/gen-0090.mjs
 */
import fs from "node:fs";
import path from "node:path";

const OUT_NAME = "20261024000090_bar_house_spirit.sql";
const HEADER = "scripts/gen/0090-header.sql";
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

/** [ชื่อฟังก์ชัน, [[จุดเดิม (ต้องเจอครั้งเดียว), ข้อความใหม่], …]] */
const TARGETS = [
  [
    "fn_bar_add_lines",
    [
      [
        `      if exists (select 1 from bar_recipe
                  where tenant_id = v_tenant and entity_id = p_entity and menu_id = v_menu.menu_id) then
        select coalesce(sum(r.qty * i.cost_per_unit), 0) into v_cost
          from bar_recipe r
          join bar_item i on i.tenant_id = r.tenant_id and i.entity_id = r.entity_id
                         and i.item_id = r.item_id
         where r.tenant_id = v_tenant and r.entity_id = p_entity and r.menu_id = v_menu.menu_id;`,
        `      -- D127: สูตร = ขวดตรง + ช่องเหล้าประจำบ้านที่แปลงเป็นขวด ณ ตอนนี้ (bar_menu_lines ที่เดียว)
      if exists (select 1 from bar_menu_lines(v_tenant, p_entity, v_menu.menu_id)) then
        select coalesce(sum(r.qty * i.cost_per_unit), 0) into v_cost
          from bar_menu_lines(v_tenant, p_entity, v_menu.menu_id) r
          join bar_item i on i.tenant_id = v_tenant and i.entity_id = p_entity
                         and i.item_id = r.item_id;`,
      ],
      [
        `qty, price, line_discount, line_discount_pct, is_comp, amount, cost)`,
        `qty, price, line_discount, line_discount_pct, is_comp, amount, cost,
                              moves_linked)`,
      ],
      [
        `            v_amount,
            v_cost);`,
        `            v_amount,
            v_cost,
            true);     -- D127: การตัดสต็อกของบรรทัดนี้ผูก bar_move.ref_line (ยกเลิกแล้วคืนเข้าขวดที่ตัดจริง)`,
      ],
      [
        `    for v_rec in
      select r.item_id, r.qty from bar_recipe r
       where r.tenant_id = v_tenant and r.entity_id = p_entity
         and r.menu_id = v_row->>'menu_id'
    loop
      perform bar_apply_move(v_tenant, p_entity, v_rec.item_id, -(v_rec.qty * v_qty),
                             'ขาย', p_sale_no, null);
    end loop;`,
        `    -- ★ D127: ช่องเหล้าประจำบ้าน → ขวดที่ตั้งไว้ ณ ตอนสั่ง · ขวดหมด = ปล่อยติดลบ ห้ามสลับขวดเอง
    for v_rec in
      select r.item_id, r.qty from bar_menu_lines(v_tenant, p_entity, v_row->>'menu_id') r
    loop
      perform bar_apply_move(v_tenant, p_entity, v_rec.item_id, -(v_rec.qty * v_qty),
                             'ขาย', p_sale_no, null);
      -- ผูกการตัดกับบรรทัดบิล (แถวที่ bar_apply_move เพิ่งเขียนในจังหวะนี้)
      update bar_move set ref_line = v_line
       where tenant_id = v_tenant and entity_id = p_entity
         and id = currval(pg_get_serial_sequence('public.bar_move', 'id'));
    end loop;`,
      ],
    ],
  ],
  [
    "fn_bar_void_line",
    [
      [
        `  -- คืนสต็อกตามสูตรของเมนูนั้น
  for v_rec in
    select r.item_id, r.qty from bar_recipe r
     where r.tenant_id = v_tenant and r.entity_id = p_entity and r.menu_id = v_item.menu_id
  loop
    perform bar_apply_move(v_tenant, p_entity, v_rec.item_id, v_rec.qty * v_item.qty,
                           'แก้บิล', p_sale_no, p_reason);
  end loop;`,
        `  -- คืนสต็อก — D127: บรรทัดตั้งแต่ 0090 คืน **ตามที่ตัดไปจริง** (bar_move ของบรรทัดนี้)
  --   ไม่ใช่ตามสูตร/ขวดของช่องปัจจุบัน — เปลี่ยนขวด House Gin แล้วยกเลิกบิลเก่า ต้องคืนเข้าขวดเดิม
  if v_item.moves_linked then
    for v_rec in
      select m.item_id, -sum(m.delta) as amt
        from bar_move m
       where m.tenant_id = v_tenant and m.entity_id = p_entity
         and m.ref_no = p_sale_no and m.ref_line = p_line_no and m.reason = 'ขาย'
       group by m.item_id
    loop
      if v_rec.amt <> 0 then
        perform bar_apply_move(v_tenant, p_entity, v_rec.item_id, v_rec.amt,
                               'แก้บิล', p_sale_no, p_reason);
      end if;
    end loop;
  else
    -- บรรทัดก่อน 0090 ไม่มีร่องรอยรายบรรทัด → คืนตามสูตรของเมนูนั้นแบบเดิม (พฤติกรรมเดิมไม่ขยับ)
    for v_rec in
      select r.item_id, r.qty from bar_recipe r
       where r.tenant_id = v_tenant and r.entity_id = p_entity and r.menu_id = v_item.menu_id
    loop
      perform bar_apply_move(v_tenant, p_entity, v_rec.item_id, v_rec.qty * v_item.qty,
                             'แก้บิล', p_sale_no, p_reason);
    end loop;
  end if;`,
      ],
    ],
  ],
  [
    "fn_bar_void_sale",
    [
      [
        `  -- คืนสต็อกของทุกแถวที่ยังไม่ถูกยกเลิก
`,
        `  -- คืนสต็อก — D127: บรรทัดตั้งแต่ 0090 คืน **ตามที่ตัดไปจริง** (bar_move ของบรรทัดนั้น)
  for v_rec in
    select m.item_id, -sum(m.delta) as amt
      from bar_move m
      join bar_sale_item si on si.tenant_id = m.tenant_id and si.entity_id = m.entity_id
                           and si.sale_no = m.ref_no and si.line_no = m.ref_line
     where m.tenant_id = v_tenant and m.entity_id = p_entity and m.ref_no = p_sale_no
       and m.reason = 'ขาย' and si.voided_at is null and si.moves_linked
     group by m.item_id
  loop
    if v_rec.amt <> 0 then
      perform bar_apply_move(v_tenant, p_entity, v_rec.item_id, v_rec.amt,
                             'ยกเลิกบิล', p_sale_no, p_reason);
    end if;
  end loop;

  -- คืนสต็อกของทุกแถวที่ยังไม่ถูกยกเลิก — เฉพาะบรรทัดก่อน 0090 (ไม่มีร่องรอยรายบรรทัด · คืนตามสูตรแบบเดิม)
`,
      ],
      [
        `       and si.sale_no = p_sale_no and si.voided_at is null
  loop`,
        `       and si.sale_no = p_sale_no and si.voided_at is null
       and not si.moves_linked
  loop`,
      ],
    ],
  ],
  [
    "fn_bar_save_menu",
    [
      [
        `    delete from bar_recipe
     where tenant_id = v_tenant and entity_id = p_entity and menu_id = v_id;`,
        `    delete from bar_recipe
     where tenant_id = v_tenant and entity_id = p_entity and menu_id = v_id;
    delete from bar_recipe_slot
     where tenant_id = v_tenant and entity_id = p_entity and menu_id = v_id;`,
      ],
      [
        `      raise exception 'ปริมาณในสูตรต้องมากกว่า 0 (%)', coalesce(v_row->>'item_id', '?');
    end if;
    insert into bar_recipe(tenant_id, entity_id, menu_id, item_id, qty)
    values (v_tenant, p_entity, v_id, v_row->>'item_id', (v_row->>'qty')::numeric);`,
        `      raise exception 'ปริมาณในสูตรต้องมากกว่า 0 (%)', coalesce(v_row->>'item_id', v_row->>'slot_id', '?');
    end if;
    -- D127: บรรทัดอ้าง "ช่องเหล้าประจำบ้าน" (slot_id) หรือขวดตรง (item_id) อย่างใดอย่างหนึ่ง
    if nullif(v_row->>'slot_id', '') is not null then
      if nullif(v_row->>'item_id', '') is not null then
        raise exception 'บรรทัดสูตรอ้างได้ทั้งขวดหรือช่องเหล้าประจำบ้านอย่างใดอย่างหนึ่ง';
      end if;
      if not exists (select 1 from bar_house_slot
                      where tenant_id = v_tenant and entity_id = p_entity and slot_id = v_row->>'slot_id') then
        raise exception 'ไม่พบช่องเหล้าประจำบ้านในสูตร (อาจถูกลบจากอีกเครื่อง) — รีเฟรชหน้าแล้วลองใหม่';
      end if;
      insert into bar_recipe_slot(tenant_id, entity_id, menu_id, slot_id, qty)
      values (v_tenant, p_entity, v_id, v_row->>'slot_id', (v_row->>'qty')::numeric);
    else
      insert into bar_recipe(tenant_id, entity_id, menu_id, item_id, qty)
      values (v_tenant, p_entity, v_id, v_row->>'item_id', (v_row->>'qty')::numeric);
    end if;`,
      ],
    ],
  ],
  [
    "fn_mig_truncate",
    [
      [
        `    'bar_customer_fav','bar_recipe','bar_menu','bar_category','bar_customer','bar_item',`,
        `    'bar_customer_fav','bar_recipe',
    -- ★ D127 — recipe_slot → house_slot → item · garnish → item (ลูกก่อนแม่)
    'bar_recipe_slot','bar_house_slot','bar_garnish',
    'bar_menu','bar_category','bar_customer','bar_item',`,
      ],
    ],
  ],
];

let out = fs.readFileSync(HEADER, "utf8").replace(/\r\n/g, "\n");
for (const [name, edits] of TARGETS) {
  const src = latestWith(`create or replace function ${name}(`);
  // 🪤 ไฟล์ใน working copy อาจเป็น CRLF (git autocrlf) — จุดยึดเขียนด้วย \n
  let fn = lift(fs.readFileSync(src, "utf8").replace(/\r\n/g, "\n"), name);
  for (const [from, to] of edits) fn = replaceOnce(fn, from, to, name);
  out += `\n-- ยก ${name} จาก ${path.basename(src)}\n` + fn;
}
out += `
-- 🚨 D99: fn_mig_truncate ถูกนิยามใหม่ในไฟล์นี้ → revoke ซ้ำ (from public อย่างเดียวไม่มีผลบน Supabase)
revoke execute on function fn_mig_truncate(uuid) from public, anon, authenticated;
grant  execute on function fn_mig_truncate(uuid) to service_role;

notify pgrst, 'reload schema';
`;
fs.writeFileSync(OUT, out);
console.log("เขียน " + OUT);
