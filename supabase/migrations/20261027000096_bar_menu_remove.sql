-- ============================================================================
-- 0096 bar — ลบ/ปิดใช้เมนูบาร์ (D138)
--
-- ที่มา: เทสเบราว์เซอร์ D137 เจอว่าแอปบาร์ **ลบเมนูไม่ได้ และปิดใช้ก็ไม่ได้** — `bar_menu.active`
--   มีคอลัมน์และหน้าขายกรองอยู่แล้ว แต่ไม่มีปุ่ม/action ตั้งค่า (ตระกูล D74/D77) ⇒ เมนูที่สร้างผิด
--   หรือเลิกขายค้างบนหน้าขายตลอดไป (ขัดกติกา CLAUDE.md: ทุกจุดที่บันทึกได้ต้องแก้/ลบได้)
--
-- ผู้ใช้ตัดสิน (แพตเทิร์นบัญชีเงิน D125):
--   · เมนูที่**ไม่เคยขาย/ไม่เคยใช้ทำคอนเทนต์** ลบทิ้งได้ (สร้างผิด/พิมพ์ผิด) — สิทธิ์ `bar.config`
--   · เมนูที่เคยขายแล้ว **ปิดใช้ได้อย่างเดียว** (ซ่อนจากหน้าขาย · เปิดคืนได้) — สิทธิ์ `bar.write`
--     ปิดใช้ = update คอลัมน์ `active` ตรง (RLS update ของ bar.write) ไม่ต้องมี RPC
--
-- 🚨 ทำไมเมนูที่เคยขายห้ามลบ: บิลก่อน 0090 ไม่มี `bar_move.ref_line` → ยกเลิกทีหลังจะคืนสต็อก
--    "ตามสูตรปัจจุบัน" (D127) · ลบเมนู = สูตรหายตาม cascade = ยกเลิกบิลแล้วสต็อกไม่คืนเงียบ ๆ
--    และสถิติต่อเมนูบนแดชบอร์ดต่อกันไม่ติด
-- 🚨 แยก policy: เดิม `bar_menu_w for all` ⇒ bar.write ลบเมนูตรงผ่าน API ได้ ข้ามด่าน "ไม่เคยขาย"
--    → insert/update คงให้ bar.write · **ไม่มี policy delete** ลบได้ทางเดียวคือ fn_bar_delete_menu
--    (แพตเทิร์น bar_post/lab — การเขียนที่ต้องตรวจเงื่อนไขไปผ่าน RPC definer · D91)
--    ★ FK action (cascade/set null จากตารางอื่น) ไม่ผ่าน RLS — ไม่กระทบ 0095
-- ★ ไม่มีตารางใหม่ (D118 ไม่ต้อง grant) · definer ใหม่ 1 ตัวมีด่าน bar_guard (D99 audit ผ่านตามหมวด guard)
-- ============================================================================

-- ── 1. policy ของ bar_menu ──────────────────────────────────────────────────
drop policy if exists bar_menu_w on bar_menu;
create policy bar_menu_ins on bar_menu for insert
  with check (tenant_id = my_tenant() and has_cap('bar.write'));
create policy bar_menu_upd on bar_menu for update
  using (tenant_id = my_tenant() and has_cap('bar.write'))
  with check (tenant_id = my_tenant() and has_cap('bar.write'));
-- ไม่มี policy delete โดยตั้งใจ — ดูหัวไฟล์

-- ── 2. เมนูที่ "เคยถูกใช้" (ขายในบิล หรือใช้ทำคอนเทนต์ในห้องทดลอง) ───────────────
--  ★ invoker + language sql — อ่านผ่าน RLS ของผู้เรียก (bar.read) ไม่ต้องเปิดสิทธิ์พิเศษ
--  ★ คืนรหัสไม่ซ้ำ ไม่ใช่แถวบิล — กันลิมิต 1000 แถวของ PostgREST (D82)
--  🚨 นับ**ทุกสถานะ**รวมบิล/รายการที่ยกเลิกแล้ว — ยกเลิกแล้วก็ยังเป็นประวัติที่อ้างเมนูอยู่
--  🚨 เงื่อนไข "เคยถูกใช้" ต้องตรงกับใน fn_bar_delete_menu ข้างล่าง (เทสอ่านไฟล์นี้เทียบ)
create or replace function bar_menu_used_ids(p_entity text)
returns setof text
language sql stable security invoker set search_path = public as $fn$
  select distinct i.menu_id from bar_sale_item i
   where i.tenant_id = my_tenant() and i.entity_id = p_entity and i.menu_id is not null
  union
  select distinct l.menu_id from bar_lab_use_line l
   where l.tenant_id = my_tenant() and l.entity_id = p_entity and l.menu_id is not null
$fn$;

-- ── 3. ลบเมนู ───────────────────────────────────────────────────────────────
create or replace function fn_bar_delete_menu(p_entity text, p_menu_id text)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid := bar_guard(p_entity, 'bar.config');
  v_menu bar_menu%rowtype;
  v_sold int;
  v_lab int;
  v_cards int;
begin
  select * into v_menu from bar_menu
   where tenant_id = v_tenant and entity_id = p_entity and menu_id = p_menu_id for update;
  if not found then raise exception 'ไม่พบเมนูนี้ (อาจถูกลบจากอีกเครื่องไปแล้ว)'; end if;

  select count(*) into v_sold from bar_sale_item
   where tenant_id = v_tenant and entity_id = p_entity and menu_id = p_menu_id;
  select count(*) into v_lab from bar_lab_use_line
   where tenant_id = v_tenant and entity_id = p_entity and menu_id = p_menu_id;
  if v_sold > 0 or v_lab > 0 then
    raise exception 'เมนู "%" เคยขายหรือเคยใช้ทำคอนเทนต์แล้ว (% รายการ) — ลบไม่ได้เพราะบิลเก่าต้องอ้างสูตรนี้ตอนยกเลิก · ใช้ปุ่ม ปิดใช้ แทน (ซ่อนจากหน้าขาย เปิดคืนได้)',
      v_menu.name, v_sold + v_lab;
  end if;

  -- การ์ดสูตรห้องทดลองที่ส่งขึ้นเมนูนี้ → กลับไปเป็น "กำลังลอง" (menu_id เป็นป้ายบอกทาง ไม่ใช่ FK · 0091)
  update bar_lab_recipe set status = 'กำลังลอง', menu_id = null
   where tenant_id = v_tenant and entity_id = p_entity and menu_id = p_menu_id;
  get diagnostics v_cards = row_count;

  -- สูตร/ช่องเหล้าประจำบ้าน/ชุดตกแต่ง/เมนูโปรดของลูกค้า ลบตาม on delete cascade
  delete from bar_menu where tenant_id = v_tenant and entity_id = p_entity and menu_id = p_menu_id;

  return jsonb_build_object('ok', true, 'name', v_menu.name, 'lab_cards_reset', v_cards);
end $fn$;

notify pgrst, 'reload schema';
