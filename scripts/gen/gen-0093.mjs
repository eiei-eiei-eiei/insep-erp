/**
 * สร้าง migration 0093 (D131 บรรทัดสูตรอ้างชุดตกแต่ง) — header เขียนเอง (ของใหม่)
 * + ยกฟังก์ชันเดิมจาก migration ล่าสุดที่นิยามแต่ละตัวมาคำต่อคำ แล้วแก้เฉพาะจุดด้วย replaceOnce (D79)
 *
 * 🚨 ห้ามพิมพ์มือ · รัน:  node scripts/gen/gen-0093.mjs
 */
import fs from "node:fs";
import path from "node:path";

const OUT_NAME = "20261026000093_bar_recipe_garnish.sql";
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
  return src.replace(from, () => to);
}

function liftLatest(name) {
  const src = latestWith(`create or replace function ${name}(`);
  const fn = lift(fs.readFileSync(src, "utf8").replace(/\r\n/g, "\n"), name);
  return { src: path.basename(src), fn };
}

let out = fs.readFileSync("scripts/gen/0093-header.sql", "utf8").replace(/\r\n/g, "\n");
const add = (title, src, fn) => {
  out += `\n-- ── ${title} ──\n-- ยก ${fn.split("(")[0].replace("create or replace function ", "")} จาก ${src}\n` + fn;
};

// ── 6. bar_menu_lines: + บรรทัดชุดตกแต่ง (ชุดที่ไม่ตัดสต็อก = ไม่มีแถว) ──────────
{
  let { src, fn } = liftLatest("bar_menu_lines");
  fn = replaceOnce(
    fn,
    `       where rs.tenant_id = p_tenant and rs.entity_id = p_entity and rs.menu_id = p_menu
    ) x`,
    `       where rs.tenant_id = p_tenant and rs.entity_id = p_entity and rs.menu_id = p_menu
      union all
      -- D131: ชุดตกแต่ง → วัตถุดิบของชุด × (จำนวนชุด × ปริมาณต่อชุด) ณ ตอนนี้
      --       ชุดที่ไม่ตัดสต็อก (item_id ว่าง) ไม่มีแถว — ไม่ใช่แถวยอด 0
      select g.item_id, rg.qty * g.qty
        from bar_recipe_garnish rg
        join bar_garnish g on g.tenant_id = rg.tenant_id and g.entity_id = rg.entity_id
                          and g.garnish_id = rg.garnish_id
       where rg.tenant_id = p_tenant and rg.entity_id = p_entity and rg.menu_id = p_menu
         and g.item_id is not null
    ) x`,
    "bar_menu_lines",
  );
  add("6. สูตรของเมนู → ขวด (+ชุดตกแต่ง)", src, fn);
}

// ── 7. fn_bar_add_lines: "มีสูตรไหม" ตัดสินจากแถวสูตร ────────────────────────
{
  let { src, fn } = liftLatest("fn_bar_add_lines");
  fn = replaceOnce(
    fn,
    `      if exists (select 1 from bar_menu_lines(v_tenant, p_entity, v_menu.menu_id)) then`,
    `      -- D131: มีสูตรไหม = มีแถวสูตร (ชุดไม่ตัดสต็อกล้วน ๆ แปลงได้ 0 ขวด แต่ยังเป็นโหมดสูตร · ตรงกับ menuMode())
      if bar_menu_has_recipe(v_tenant, p_entity, v_menu.menu_id) then`,
    "fn_bar_add_lines",
  );
  add("7. เพิ่มบรรทัดบิล (โหมดสูตรตัดสินจากแถวสูตร)", src, fn);
}

// ── 8. fn_bar_save_menu: รับบรรทัด garnish_id ────────────────────────────────
{
  let { src, fn } = liftLatest("fn_bar_save_menu");
  fn = replaceOnce(
    fn,
    `    delete from bar_recipe_slot
     where tenant_id = v_tenant and entity_id = p_entity and menu_id = v_id;
  end if;`,
    `    delete from bar_recipe_slot
     where tenant_id = v_tenant and entity_id = p_entity and menu_id = v_id;
    delete from bar_recipe_garnish
     where tenant_id = v_tenant and entity_id = p_entity and menu_id = v_id;
  end if;`,
    "fn_bar_save_menu delete",
  );
  fn = replaceOnce(
    fn,
    `      raise exception 'ปริมาณในสูตรต้องมากกว่า 0 (%)', coalesce(v_row->>'item_id', v_row->>'slot_id', '?');`,
    `      raise exception 'ปริมาณในสูตรต้องมากกว่า 0 (%)', coalesce(v_row->>'item_id', v_row->>'slot_id', v_row->>'garnish_id', '?');`,
    "fn_bar_save_menu qty msg",
  );
  fn = replaceOnce(
    fn,
    `    if nullif(v_row->>'slot_id', '') is not null then
      if nullif(v_row->>'item_id', '') is not null then`,
    `    -- D131: บรรทัดอ้าง "ชุดตกแต่ง" (garnish_id · qty = จำนวนชุดต่อแก้ว)
    if nullif(v_row->>'garnish_id', '') is not null then
      if nullif(v_row->>'item_id', '') is not null or nullif(v_row->>'slot_id', '') is not null then
        raise exception 'บรรทัดสูตรอ้างได้ทีละอย่าง — วัตถุดิบ ช่องเหล้าประจำบ้าน หรือชุดตกแต่ง';
      end if;
      if not exists (select 1 from bar_garnish
                      where tenant_id = v_tenant and entity_id = p_entity and garnish_id = v_row->>'garnish_id') then
        raise exception 'ไม่พบชุดตกแต่งในสูตร (อาจถูกลบจากอีกเครื่อง) — รีเฟรชหน้าแล้วลองใหม่';
      end if;
      insert into bar_recipe_garnish(tenant_id, entity_id, menu_id, garnish_id, qty)
      values (v_tenant, p_entity, v_id, v_row->>'garnish_id', (v_row->>'qty')::numeric);
    elsif nullif(v_row->>'slot_id', '') is not null then
      if nullif(v_row->>'item_id', '') is not null then`,
    "fn_bar_save_menu garnish branch",
  );
  add("8. บันทึกเมนู (+บรรทัดชุดตกแต่ง)", src, fn);
}

// ── 9. fn_bar_save_garnishes: ไม่ตัดสต็อกได้ · qty_text · บล็อกลบ · ตรวจหน่วย ─────
{
  let { src, fn } = liftLatest("fn_bar_save_garnishes");
  fn = replaceOnce(
    fn,
    `  v_keep text[] := '{}';
begin`,
    `  v_keep text[] := '{}';
  v_qty_text text;
  v_unit text;
  v_g record;
  v_used int;
  v_names text;
begin`,
    "fn_bar_save_garnishes declare",
  );
  fn = replaceOnce(
    fn,
    `  -- ★ ชุดตกแต่งไม่มีอะไรอ้างอิง (บวกเข้าสูตรไปแล้วเป็นเลขธรรมดา) ⇒ ลบได้เสมอ
  delete from bar_garnish
   where tenant_id = v_tenant and entity_id = p_entity and not (garnish_id = any(v_keep));`,
    `  -- D131: สูตรอ้างชุดได้แล้ว ⇒ ลบชุดที่มีเมนูอ้าง = บล็อก + บอกรายชื่อเมนู (แบบเดียวกับช่องเหล้าประจำบ้าน)
  for v_g in
    select garnish_id, name from bar_garnish
     where tenant_id = v_tenant and entity_id = p_entity and not (garnish_id = any(v_keep))
  loop
    select count(*), string_agg(m.name, ' · ' order by m.name) into v_used, v_names
      from bar_recipe_garnish rg
      join bar_menu m on m.tenant_id = rg.tenant_id and m.entity_id = rg.entity_id and m.menu_id = rg.menu_id
     where rg.tenant_id = v_tenant and rg.entity_id = p_entity and rg.garnish_id = v_g.garnish_id;
    if v_used > 0 then
      raise exception 'ลบชุดตกแต่ง % ไม่ได้ — ใช้อยู่ในสูตร % เมนู: % — เอาออกจากสูตรก่อนถึงจะลบได้',
        v_g.name, v_used, v_names;
    end if;
    delete from bar_garnish
     where tenant_id = v_tenant and entity_id = p_entity and garnish_id = v_g.garnish_id;
  end loop;`,
    "fn_bar_save_garnishes delete",
  );
  fn = replaceOnce(
    fn,
    `    if v_item is null or not exists (select 1 from bar_item
                    where tenant_id = v_tenant and entity_id = p_entity and item_id = v_item) then
      raise exception 'แถว % (%): เลือกวัตถุดิบก่อน', v_i, v_name;
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'แถว % (%): ใส่จำนวนต่อครั้งมากกว่า 0', v_i, v_name;
    end if;`,
    `    v_qty_text := nullif(btrim(coalesce(v_row->>'qty_text', '')), '');
    if v_item is null then
      -- D131: ชุดที่ไม่ตัดสต็อก (ผู้ใช้เลือก) — ไม่มีวัตถุดิบ = ไม่มีจำนวน
      v_qty := null;
      v_qty_text := null;
    else
      select unit into v_unit from bar_item
       where tenant_id = v_tenant and entity_id = p_entity and item_id = v_item;
      if not found then
        raise exception 'แถว % (%): ไม่พบวัตถุดิบ (อาจถูกลบจากอีกเครื่อง) — รีเฟรชหน้าแล้วลองใหม่', v_i, v_name;
      end if;
      if v_qty is null or v_qty <= 0 then
        raise exception 'แถว % (%): ใส่จำนวนต่อครั้งมากกว่า 0', v_i, v_name;
      end if;
      -- 🚨 จำนวนต้องพิมพ์สำหรับหน่วยของวัตถุดิบนี้ — เปลี่ยนเป็นวัตถุดิบหน่วยอื่นแล้ว "1" เดิมเปลี่ยนความหมาย
      --    (หน้าจอล้างช่องให้แล้ว · ตรงนี้กันจอที่ค้างไว้รุ่นเก่า)
      if (v_row->>'qty_unit') is distinct from v_unit then
        raise exception 'แถว % (%): วัตถุดิบใช้หน่วย % — ใส่จำนวนต่อครั้งใหม่ก่อนบันทึก', v_i, v_name, v_unit;
      end if;
    end if;`,
    "fn_bar_save_garnishes validate",
  );
  fn = replaceOnce(
    fn,
    `      insert into bar_garnish(tenant_id, entity_id, garnish_id, name, item_id, qty, sort)
      values (v_tenant, p_entity, 'GN-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
              v_name, v_item, v_qty, v_i - 1);`,
    `      insert into bar_garnish(tenant_id, entity_id, garnish_id, name, item_id, qty, qty_text, sort)
      values (v_tenant, p_entity, 'GN-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
              v_name, v_item, v_qty, v_qty_text, v_i - 1);`,
    "fn_bar_save_garnishes insert",
  );
  fn = replaceOnce(
    fn,
    `      update bar_garnish set name = v_name, item_id = v_item, qty = v_qty, sort = v_i - 1
       where tenant_id = v_tenant and entity_id = p_entity and garnish_id = v_id
         and (name, item_id, qty, sort) is distinct from (v_name, v_item, v_qty, v_i - 1);`,
    `      update bar_garnish set name = v_name, item_id = v_item, qty = v_qty, qty_text = v_qty_text, sort = v_i - 1
       where tenant_id = v_tenant and entity_id = p_entity and garnish_id = v_id
         and (name, item_id, qty, qty_text, sort) is distinct from (v_name, v_item, v_qty, v_qty_text, v_i - 1);`,
    "fn_bar_save_garnishes update",
  );
  add("9. บันทึกชุดตกแต่งทั้งชุด", src, fn);
}

// ── 10. fn_bar_lab_round: บรรทัด garnish_id ──────────────────────────────────
{
  let { src, fn } = liftLatest("fn_bar_lab_round");
  fn = replaceOnce(
    fn,
    `    v_total := v_total + bar_lab_cut_line(
      v_tenant, p_entity, v_use, v_i, 'สูตร',
      nullif(v_row->>'item_id', ''), nullif(v_row->>'slot_id', ''),
      (v_row->>'qty')::numeric, p_glasses, v_label || ' รอบ ' || v_round);`,
    `    if nullif(v_row->>'garnish_id', '') is not null then
      -- D131: ชุดตกแต่ง → วัตถุดิบของชุด ณ ตอนชง (ไม่ตัดสต็อก = บรรทัดทุน 0)
      v_total := v_total + bar_lab_cut_garnish(
        v_tenant, p_entity, v_use, v_i, v_row->>'garnish_id',
        (v_row->>'qty')::numeric, p_glasses, v_label || ' รอบ ' || v_round);
    else
      v_total := v_total + bar_lab_cut_line(
        v_tenant, p_entity, v_use, v_i, 'สูตร',
        nullif(v_row->>'item_id', ''), nullif(v_row->>'slot_id', ''),
        (v_row->>'qty')::numeric, p_glasses, v_label || ' รอบ ' || v_round);
    end if;`,
    "fn_bar_lab_round",
  );
  add("10. ห้องทดลอง: ชงรอบใหม่ (+ชุดตกแต่ง)", src, fn);
}

// ── 11. fn_bar_lab_use: สูตรทดลองรอบล่าสุดรวมบรรทัดชุดตกแต่ง ────────────────────
{
  let { src, fn } = liftLatest("fn_bar_lab_use");
  fn = replaceOnce(
    fn,
    `  v_item text;
  v_note text`,
    `  v_item text;
  v_per numeric;
  v_note text`,
    "fn_bar_lab_use declare",
  );
  fn = replaceOnce(
    fn,
    `    if exists (select 1 from bar_menu_lines(v_tenant, p_entity, v_menu.menu_id)) then`,
    `    if bar_menu_has_recipe(v_tenant, p_entity, v_menu.menu_id) then   -- D131 (ตรงกับ fn_bar_add_lines)`,
    "fn_bar_lab_use menu mode",
  );
  fn = replaceOnce(
    fn,
    `      select l.item_id, l.slot_id, l.qty from bar_lab_use_line l
       where l.tenant_id = v_tenant and l.entity_id = p_entity and l.use_id = v_last and l.kind = 'สูตร'
       order by l.line_no
    loop
      -- ช่อง House → ขวดที่ช่องชี้ตอนนี้ · ช่องถูกลบไปแล้ว → ขวดที่ตัดในรอบนั้น
      v_item := coalesce((select s.item_id from bar_house_slot s
                           where s.tenant_id = v_tenant and s.entity_id = p_entity and s.slot_id = v_rec.slot_id),
                         v_rec.item_id);`,
    `      select l.kind, l.item_id, l.slot_id, l.garnish_id, l.garnish_qty, l.qty from bar_lab_use_line l
       where l.tenant_id = v_tenant and l.entity_id = p_entity and l.use_id = v_last
         and l.kind in ('สูตร', 'ชุดตกแต่ง')
       order by l.line_no
    loop
      if v_rec.kind = 'ชุดตกแต่ง' then
        -- D131: ชุดตกแต่ง → วัตถุดิบ × ปริมาณต่อชุด **ณ ตอนนี้** · ชุดถูกลบไปแล้ว → ค่าที่จำไว้ตอนชงรอบนั้น
        if exists (select 1 from bar_garnish g
                    where g.tenant_id = v_tenant and g.entity_id = p_entity and g.garnish_id = v_rec.garnish_id) then
          select g.item_id, g.qty into v_item, v_per from bar_garnish g
           where g.tenant_id = v_tenant and g.entity_id = p_entity and g.garnish_id = v_rec.garnish_id;
        else
          v_item := v_rec.item_id;
          v_per := v_rec.garnish_qty;
        end if;
        continue when v_item is null or v_per is null;     -- ชุดที่ไม่ตัดสต็อก
        v_cost := v_cost + coalesce((select i.cost_per_unit from bar_item i
                                      where i.tenant_id = v_tenant and i.entity_id = p_entity
                                        and i.item_id = v_item), 0) * v_rec.qty * v_per * v_qty;
        perform bar_apply_move(v_tenant, p_entity, v_item, -(v_rec.qty * v_per * v_qty), 'ห้องทดลอง', v_use, v_note);
        continue;
      end if;
      -- ช่อง House → ขวดที่ช่องชี้ตอนนี้ · ช่องถูกลบไปแล้ว → ขวดที่ตัดในรอบนั้น
      v_item := coalesce((select s.item_id from bar_house_slot s
                           where s.tenant_id = v_tenant and s.entity_id = p_entity and s.slot_id = v_rec.slot_id),
                         v_rec.item_id);`,
    "fn_bar_lab_use recipe loop",
  );
  add("11. ห้องทดลอง: บันทึกการใช้ (สูตรทดลองรวมชุดตกแต่ง)", src, fn);
}

// ── 12. fn_mig_truncate ──────────────────────────────────────────────────────
{
  let { src, fn } = liftLatest("fn_mig_truncate");
  fn = replaceOnce(
    fn,
    `    'bar_recipe_slot','bar_house_slot','bar_garnish',`,
    `    -- ★ D131 — บรรทัดสูตรที่อ้างชุดตกแต่ง ต้องมาก่อน bar_garnish (FK restrict)
    'bar_recipe_garnish',
    'bar_recipe_slot','bar_house_slot','bar_garnish',`,
    "fn_mig_truncate",
  );
  add("12. ลบข้อมูลทั้ง tenant", src, fn);
}

out += `
-- 🚨 D99: fn_mig_truncate ถูกนิยามใหม่ในไฟล์นี้ → revoke ซ้ำ
revoke execute on function fn_mig_truncate(uuid) from public, anon, authenticated;
grant  execute on function fn_mig_truncate(uuid) to service_role;

notify pgrst, 'reload schema';
`;
fs.writeFileSync(OUT, out);
console.log("เขียน " + OUT);
