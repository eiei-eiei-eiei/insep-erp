-- ============================================================================
-- 0064 — ตารางโมดูลบาร์/POS  (D96 · เฟส 2 ของ `docs/BAR_POS_PLAN.md`)
--
-- 🚨 **กติกาเหล็กของโมดูลนี้: ห้ามแตะตารางฝั่งผลิต/ขายแม้แถวเดียว**
--    `stock_product` · `log_product` · `warehouse_stock` · `stock_moves`
--    · `sale_menu` · `sales_orders` · `sales_order_items`
--    เหตุผล: การขายเป็นแก้วไม่เกี่ยวกับเอกสารสรรพสามิตใด ๆ — โรงงานขายขาดเป็นขวด
--    ฟอร์ม ภส. จบหน้าที่ตรงนั้น · เผลอต่อท่อเมื่อไหร่ ตัวเลขบนเอกสารราชการจะขยับ
--    โดยไม่มีอะไรฟ้อง (ไฟล์นี้จึงไม่มี trigger/FK ไปตารางกลุ่มนั้นเลยสักตัว)
--
-- 🚨 **`entity_id` ของทุกตาราง `bar_*` เป็น `not null` และ *ไม่มี* default โดยตั้งใจ**
--    ต่างจากทุกตารางในระบบที่ default เป็น `my_default_entity()` — บาร์ไม่ใช่กิจการหลัก
--    มี default แล้วลืมส่ง = ของไปลงกิจการโรงกลั่นเงียบ ๆ (ตระกูล D79 `fn_receive_material`)
--    ไม่มี default = **insert ล้มเสียงดัง** ซึ่งดีกว่ามาก
--
-- ⚠️ ไฟล์นี้ยัง**ไม่มี RPC** (`fn_bar_*`) — อยู่ใน migration ถัดไป
-- ============================================================================

-- ── 1. หมวดหมู่ (แท็บในหน้าขาย) ─────────────────────────────────────────────
--    ★ แยก `category_id` ออกจาก `name` เพื่อให้เปลี่ยนชื่อหมวดได้ฟรี ไม่ต้องไล่อัปเดต bar_menu
create table bar_category (
  tenant_id   uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id   text not null,
  category_id text not null,
  name        text not null,
  sort        int  not null default 0,
  -- true = หมวด 'custom' ที่เมนูใหม่จากหน้าขายตกลงมา — เปลี่ยนชื่อได้ แต่ลบไม่ได้
  is_system   boolean not null default false,
  primary key (tenant_id, entity_id, category_id),
  foreign key (tenant_id, entity_id) references entities (tenant_id, entity_id)
);

-- ── 2. ของที่บาร์มี ─────────────────────────────────────────────────────────
--    🚨 `unit` คือ **หน่วยที่สูตรกิน ไม่ใช่หน่วยที่ซื้อ** — เหล้า 1 ขวดรับเข้าเป็น 700 (ml)
--       ทำให้ยอดคงเหลือไม่มีเศษทศนิยมของขวด · "≈ 3.2 ขวด" เป็นแค่วิธีแสดงผลบนจอ
create table bar_item (
  tenant_id     uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id     text not null,
  item_id       text not null,
  name          text not null,
  unit          text not null,                    -- 'ml' | 'ขวด' | 'ชิ้น' | 'g'
  qty           numeric not null default 0,       -- คงเหลือใน base unit
  cost_per_unit numeric(14,4) not null default 0, -- ถัวเฉลี่ยถ่วงน้ำหนัก
  pack_size     numeric,                          -- 1 หน่วยซื้อ = กี่ base unit (ขวด 700ml → 700)
  pack_label    text,                             -- 'ขวด (700 ml)'
  low_qty       numeric,                          -- เตือนของใกล้หมด
  active        boolean not null default true,
  primary key (tenant_id, entity_id, item_id),
  foreign key (tenant_id, entity_id) references entities (tenant_id, entity_id)
);

-- ── 3. ทะเบียนลูกค้าบาร์ ────────────────────────────────────────────────────
--    🚨 **แยกจาก `contacts` โดยตั้งใจ** — `contacts` เป็นคู่ค้า B2B ที่ใช้ร่วมกันทั้ง tenant
--       (PK ไม่มี entity_id · unique ชื่อเป็นระดับ tenant · ไม่มีโค้ดฝั่งอ่านกรอง entity เลย)
--       เอามาใช้ = พนักงานบาร์เห็นทะเบียนลูกค้าค้าส่งทั้งหมดพร้อมเลขภาษี/เครดิตเทอม
--       หลักเดียวกับที่ `employees` แยกจาก `contacts` ใน D66
create table bar_customer (
  tenant_id   uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id   text not null,
  customer_id text not null,
  name        text not null,
  nickname    text,
  phone       text,                               -- ⚠️ PDPA — ต้องมีปุ่มลบจริง
  -- 3 ช่องนี้ต้องครบถึงออกใบกำกับได้ ถ้าวันหนึ่งกิจการบาร์จด VAT
  -- ★ กติกาการกรอกอยู่ที่ lib/shared/taxCustomer.ts (golden S13) — ไม่เขียนซ้ำใน DB
  tax_id      text,
  branch      text,
  address     text,
  note        text,                               -- แพ้อะไร · ชอบแบบไหน
  tags        text[] not null default '{}',
  -- ★ ยินยอมให้โรงกลั่นติดต่อ (ผู้ใช้ตัดสิน 2026-09-10)
  -- 🚨 ค่าปริยาย false เสมอ ห้ามติ๊กมาให้ — ความยินยอมที่ติ๊กไว้ล่วงหน้าไม่ใช่ความยินยอม
  -- 🚨 ถอนได้: ติ๊กออกแล้ว consent_at ต้องถูกล้าง ไม่ใช่ค้างไว้
  consent_marketing boolean not null default false,
  consent_at  timestamptz,
  first_seen  date,
  last_seen   date,
  visits      int not null default 0,
  spend_total numeric(14,2) not null default 0,
  active      boolean not null default true,
  primary key (tenant_id, entity_id, customer_id),
  foreign key (tenant_id, entity_id) references entities (tenant_id, entity_id),
  constraint bar_customer_consent_pair
    check ((consent_marketing and consent_at is not null)
        or (not consent_marketing and consent_at is null))
);

-- ── 4. เมนู ─────────────────────────────────────────────────────────────────
--    3 โหมดต้นทุน (ดูแผนข้อ 3.1): มีสูตร → ตัดสต็อก · fixed_cost → ไม่ตัดแต่รู้ต้นทุน
--    · ไม่มีทั้งคู่ → ต้นทุน 0 + ต้องขึ้นป้ายบนจอ (ทางฉุกเฉิน ไม่ใช่ทางปกติ)
create table bar_menu (
  tenant_id   uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id   text not null,
  menu_id     text not null,
  name        text not null,
  price       numeric(14,2) not null default 0,
  fixed_cost  numeric(14,2),                      -- โหมด B · null = ไม่ใช่โหมดนี้
  category_id text not null,
  -- การ์ดสูตร — "เผื่อลูกค้ามาสั่งซ้ำจะได้เปิดดูได้ ให้จำเองคงไม่หมด"
  method      text,                               -- วิธีชง
  glass       text,                               -- แก้วที่ใช้
  note        text,
  -- 🚨 `created_for` เป็น **ป้ายบอกที่มา ไม่ใช่สิทธิ์** — ห้ามเอาไปกรองใน policy หรือ
  --    query หลัก · เมนูที่สร้างให้ลูกค้าคนหนึ่ง คนอื่นต้องสั่งได้ปกติ
  --    มันมีผลกับ "ชิปกรองรายลูกค้า" บนหน้าขายอย่างเดียว
  created_for text,
  active      boolean not null default true,
  sort        int,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, entity_id, menu_id),
  unique (tenant_id, entity_id, name),
  foreign key (tenant_id, entity_id) references entities (tenant_id, entity_id),
  -- 🚨 restrict — ลบหมวดที่ยังมีเมนูอยู่ต้องล้มเสียงดัง ไม่ใช่ปล่อยเมนูลอย
  foreign key (tenant_id, entity_id, category_id)
    references bar_category (tenant_id, entity_id, category_id) on delete restrict,
  foreign key (tenant_id, entity_id, created_for)
    references bar_customer (tenant_id, entity_id, customer_id) on delete set null
);

-- ── 5. สูตร (BOM) ───────────────────────────────────────────────────────────
create table bar_recipe (
  tenant_id uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id text not null,
  menu_id   text not null,
  item_id   text not null,
  qty       numeric not null,                     -- กิน base unit เท่าไรต่อ 1 หน่วยเมนู
  primary key (tenant_id, entity_id, menu_id, item_id),
  foreign key (tenant_id, entity_id, menu_id)
    references bar_menu (tenant_id, entity_id, menu_id) on delete cascade,
  foreign key (tenant_id, entity_id, item_id)
    references bar_item (tenant_id, entity_id, item_id) on delete restrict,
  constraint bar_recipe_qty_pos check (qty > 0)
);

-- ── 6. เมนูโปรดของลูกค้า (ปักหมุด) ──────────────────────────────────────────
create table bar_customer_fav (
  tenant_id   uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id   text not null,
  customer_id text not null,
  menu_id     text not null,
  primary key (tenant_id, entity_id, customer_id, menu_id),
  foreign key (tenant_id, entity_id, customer_id)
    references bar_customer (tenant_id, entity_id, customer_id) on delete cascade,
  foreign key (tenant_id, entity_id, menu_id)
    references bar_menu (tenant_id, entity_id, menu_id) on delete cascade
);

-- ── 7. รับของเข้าบาร์ ───────────────────────────────────────────────────────
--    ★ ราคาเป็น **ของล็อตจริง** ไม่ใช่ราคากลาง — หน้าจอเติมค่าล่าสุดมาให้
--      กดผ่านเลยก็ได้พฤติกรรมเหมือนราคากลาง (ได้ทั้งสองแบบโดยไม่ต้องมีสองโหมด)
create table bar_receive (
  tenant_id  uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id  text not null,
  id         bigserial,
  doc_date   date not null,
  item_id    text not null,
  qty_pack   numeric,                             -- รับกี่หน่วยซื้อ
  qty        numeric not null,                    -- = qty_pack × pack_size (base unit)
  cost_total numeric(14,2) not null default 0,    -- เงินที่จ่ายจริงของล็อตนี้
  source     text,
  note       text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, entity_id, id),
  foreign key (tenant_id, entity_id, item_id)
    references bar_item (tenant_id, entity_id, item_id) on delete restrict
);

-- ── 8. บิลขาย ───────────────────────────────────────────────────────────────
--    🚨 เปิดบิลค้างได้ — สต็อกถูกตัด **ตอนสั่ง ไม่ใช่ตอนปิดบิล** (เหล้าออกจากขวดตอนชง)
create table bar_sale (
  tenant_id   uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id   text not null,
  sale_no     text not null,
  status      text not null default 'เปิดอยู่'
                check (status in ('เปิดอยู่','ปกติ','ยกเลิก')),
  tab_name    text,                               -- 'โต๊ะ 3' | 'พี่โอ๊ต'
  customer_id text,                               -- nullable เสมอ — ห้ามบล็อกการขาย
  channel     text not null default 'บาร์',        -- ป้ายที่ผู้ใช้ตั้งเอง · 🚫 ไม่พิมพ์ลงบิล
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz,
  -- วันขาย — คิดจาก closed_at + รอบขาย (bar_day_start/bar_day_end)
  -- ★ ตัดสินที่ lib/bar/businessDate.ts จุดเดียว · แก้รายบิลได้ (bar.config)
  business_date date,
  method      text,                               -- null ระหว่างเปิด
  sub_total   numeric(14,2) not null default 0,
  discount    numeric(14,2) not null default 0,   -- ส่วนลดท้ายบิล
  rounding    numeric(14,2) not null default 0,   -- ปัดเศษเงินสด (ปกติ 0)
  grand_total numeric(14,2) not null default 0,
  cost_total  numeric(14,2) not null default 0,   -- ★ แช่ไว้ ห้ามคำนวณสด (D75)
  rcpt_no     text,                               -- ใบเสร็จ — ออกเมื่อลูกค้าขอ
  rcpt_at     timestamptz,
  note        text,
  primary key (tenant_id, entity_id, sale_no),
  foreign key (tenant_id, entity_id) references entities (tenant_id, entity_id),
  foreign key (tenant_id, entity_id, customer_id)
    references bar_customer (tenant_id, entity_id, customer_id) on delete set null
);

create table bar_sale_item (
  tenant_id     uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id     text not null,
  sale_no       text not null,
  line_no       int  not null,
  menu_id       text,
  menu_name     text not null,                    -- snapshot ชื่อ ณ ตอนสั่ง
  qty           numeric not null,
  price         numeric(14,2) not null,
  line_discount numeric(14,2) not null default 0,
  -- 🚨 ของแถม: ยอดขาย 0 แต่ **ต้นทุนยังต้องนับ** ไม่งั้นแถมทั้งคืนแล้วกำไรยังสวย
  is_comp       boolean not null default false,
  amount        numeric(14,2) not null,
  cost          numeric(14,2) not null default 0, -- ★ แช่ ณ ตอน "สั่ง" ไม่ใช่ตอนปิดบิล
  added_at      timestamptz not null default now(),
  -- 🚨 soft-void — ห้ามลบแถวจริง · line_no ไม่เรียงใหม่ (audit)
  voided_at     timestamptz,
  void_reason   text,
  primary key (tenant_id, entity_id, sale_no, line_no),
  foreign key (tenant_id, entity_id, sale_no)
    references bar_sale (tenant_id, entity_id, sale_no) on delete cascade
);

-- ── 9. ความเคลื่อนไหวสต็อกทุกรายการ ─────────────────────────────────────────
create table bar_move (
  tenant_id uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id text not null,
  id        bigserial,
  moved_at  timestamptz not null default now(),
  item_id   text not null,
  delta     numeric not null,                     -- + รับเข้า / − ขาย,เสียหาย
  qty_after numeric not null,
  reason    text not null
    check (reason in ('รับเข้า','ขาย','ยกเลิกบิล','แก้บิล','ปรับยอด','เสียหาย','ชิม/เทสต์')),
  ref_no    text,
  note      text,
  primary key (tenant_id, entity_id, id),
  foreign key (tenant_id, entity_id, item_id)
    references bar_item (tenant_id, entity_id, item_id) on delete restrict
);

-- ── 10. ลงบัญชีสรุปรายวัน ───────────────────────────────────────────────────
--     ★ กันลงซ้ำด้วย **partial unique index ของตารางเอง** (แพตเทิร์น tax_payments D88)
--       🚨 จงใจไม่ลอก idempotency ของเงินเดือนมา — ตัวนั้นมีบั๊ก (ถอนแล้วลงใหม่ไม่เกิดอะไร)
create table bar_post (
  tenant_id uuid not null default my_tenant() references tenants(id) on delete cascade,
  entity_id text not null,
  id        bigserial,
  post_date date not null,
  tx_ids    text[] not null default '{}',
  totals    jsonb not null default '{}'::jsonb,
  status    text not null default 'ปกติ' check (status in ('ปกติ','ยกเลิก')),
  posted_at timestamptz not null default now(),
  posted_by uuid,
  primary key (tenant_id, entity_id, id),
  foreign key (tenant_id, entity_id) references entities (tenant_id, entity_id)
);

create unique index bar_post_once on bar_post (tenant_id, entity_id, post_date)
  where status = 'ปกติ';

-- ── 11. Index — 🚨 ทุกตัวขึ้นต้นด้วย tenant_id (NEXT_STEPS 4.8) ─────────────
create index bar_item_te_idx        on bar_item        (tenant_id, entity_id);
create index bar_category_te_idx    on bar_category    (tenant_id, entity_id, sort);
create index bar_menu_te_idx        on bar_menu        (tenant_id, entity_id, category_id);
create index bar_menu_created_for   on bar_menu        (tenant_id, entity_id, created_for);
create index bar_recipe_item_idx    on bar_recipe      (tenant_id, entity_id, item_id);
create index bar_customer_te_idx    on bar_customer    (tenant_id, entity_id, name);
create index bar_receive_te_idx     on bar_receive     (tenant_id, entity_id, doc_date desc);
create index bar_sale_open_idx      on bar_sale        (tenant_id, entity_id, status);
create index bar_sale_bdate_idx     on bar_sale        (tenant_id, entity_id, business_date desc);
create index bar_sale_cust_idx      on bar_sale        (tenant_id, entity_id, customer_id);
create index bar_sale_item_menu_idx on bar_sale_item   (tenant_id, entity_id, menu_id);
create index bar_move_te_idx        on bar_move        (tenant_id, entity_id, moved_at desc);
create index bar_post_te_idx        on bar_post        (tenant_id, entity_id, post_date desc);

-- ── 12. RLS ─────────────────────────────────────────────────────────────────
--    🪤 บทเรียน D85/0052: `for all` **ครอบ SELECT ด้วย** และ policy permissive ถูก OR กัน
--       → policy เขียนที่กว้างกว่าจะทับ policy อ่านที่แคบกว่าเงียบ ๆ
--       ที่นี่ปลอดภัยเพราะ bar.write กับ bar.read มีขอบเขต**แถว**เดียวกัน (ไม่มีเงื่อนไข
--       ระดับแถวแบบ emp_id ของ wht_certificates) และใครมี bar.write ย่อมมี bar.read เสมอ
--       (เทส `roles.test.ts` บังคับ invariant นี้ไว้)
--
--    🚨 **RLS ซ่อน "แถว" ไม่ได้ซ่อน "คอลัมน์"** — การไม่ให้พนักงานบาร์เห็นต้นทุน/กำไร
--       ทำที่ชั้น `data.ts` (ไม่ส่งคอลัมน์มาที่ client) ⇒ เป็น **กติกาความเป็นส่วนตัว
--       ระดับหน้าจอ ไม่ใช่ขอบเขตความปลอดภัยระดับ DB** — คนที่ตั้งใจยิง API ตรงยังอ่านได้
--       (กรอบเดียวกับที่ `lib/sales/customer.ts` ประกาศตัวเองไว้)
alter table bar_category     enable row level security;
alter table bar_item         enable row level security;
alter table bar_customer     enable row level security;
alter table bar_menu         enable row level security;
alter table bar_recipe       enable row level security;
alter table bar_customer_fav enable row level security;
alter table bar_receive      enable row level security;
alter table bar_sale         enable row level security;
alter table bar_sale_item    enable row level security;
alter table bar_move         enable row level security;
alter table bar_post         enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'bar_category','bar_item','bar_customer','bar_menu','bar_recipe',
    'bar_customer_fav','bar_receive','bar_sale','bar_sale_item','bar_move'
  ] loop
    execute format(
      'create policy %I on %I for select using (tenant_id = my_tenant() and has_cap(''bar.read''))',
      t || '_sel', t);
    execute format(
      'create policy %I on %I for all using (tenant_id = my_tenant() and has_cap(''bar.write''))'
      || ' with check (tenant_id = my_tenant() and has_cap(''bar.write''))',
      t || '_w', t);
  end loop;
end $$;

-- bar_post — อ่านได้ด้วย bar.read แต่ **ไม่มี policy เขียน** เขียนผ่าน RPC definer เท่านั้น
-- (หลักเดียวกับ excise_month_close ของ D91 — การลงบัญชีต้องผ่านด่านที่ตรวจเงื่อนไขครบ)
create policy bar_post_sel on bar_post for select
  using (tenant_id = my_tenant() and has_cap('bar.read'));

-- ── 13. audit — ข้อมูลหลักและตัวเงินต้องตามรอยได้ (กฎ D80) ───────────────────
--     ★ ไม่ audit `bar_move` (เป็น log อยู่แล้ว) · ไม่ audit `bar_post` (เขียนผ่าน RPC ที่จดเอง)
--     🪤 `trg_audit` เอา tenant จากแถวเอง (D80) — ผูกกับตารางที่ service role เขียนได้ปลอดภัย
create trigger audit_bar_category  after insert or update or delete on bar_category
  for each row execute function trg_audit('category_id');
create trigger audit_bar_item      after insert or update or delete on bar_item
  for each row execute function trg_audit('item_id');
create trigger audit_bar_menu      after insert or update or delete on bar_menu
  for each row execute function trg_audit('menu_id');
create trigger audit_bar_recipe    after insert or update or delete on bar_recipe
  for each row execute function trg_audit('menu_id');
create trigger audit_bar_customer  after insert or update or delete on bar_customer
  for each row execute function trg_audit('customer_id');
create trigger audit_bar_sale      after insert or update or delete on bar_sale
  for each row execute function trg_audit('sale_no');
create trigger audit_bar_sale_item after insert or update or delete on bar_sale_item
  for each row execute function trg_audit('sale_no');

-- ── 14. app_settings — ค่าตั้งค่าของบาร์ ─────────────────────────────────────
--    🪤 **กับดัก D80**: `kind` เป็น CHECK whitelist ที่ `create ... check` เขียนทับทั้งก้อน
--       ⇒ ต้องยกรายชื่อเดิมทั้งหมดจาก 0053 มาครบ แล้วค่อยเติมของใหม่
--       เติมในโค้ด TypeScript อย่างเดียวไม่พอ — insert จะติด constraint
alter table app_settings drop constraint if exists app_settings_kind_check;
alter table app_settings add constraint app_settings_kind_check
  check (kind in ('expense_cat','income_cat','wht_rate','tax_account',
                  'sales_revenue_account','sales_revenue_entity','sales_doc_entity',
                  'brand_name','brand_color','logo_url','default_mode',
                  'line_channel_token','line_group_id',
                  -- เงินเดือน (0040)
                  'pay_group',
                  'payroll_entity','payroll_pay_account','payroll_sso_account',
                  'payroll_wht_account','payroll_hours_per_day','payroll_rounding',
                  -- D80: หมวดที่จุดชนวนรับวัตถุดิบเข้าสต็อกผลิต (list — มีได้หลายแถว)
                  'material_forward_cat',
                  -- D86: ลูกค้าปริยายของหน้าขายหน้าร้าน (contact_id · แถวเดียว)
                  'pos_walkin_contact',
                  -- ★ D96 — บาร์/POS
                  'bar_entity','bar_revenue_account','bar_income_cat',
                  'bar_promptpay_type','bar_promptpay_id',
                  'bar_channels',                       -- list — ป้ายช่องทาง/งาน ตั้งชื่อเอง
                  'bar_day_start','bar_day_end',        -- รอบขาย · เท่ากัน = ไม่ได้ตั้งรอบ
                  'bar_round_cash','bar_block_negative',
                  'bar_receipt_footer'));

-- ── 15. app_setting_cap() — ยกมาจาก 0053 ทั้งดุ้น เติมกฎของบาร์ ──────────────
--    🪤 **กับดัก D86**: ค่าปริยายคือ `'admin'` → ไม่ประกาศไว้ = คนที่ควรตั้งได้ตั้งไม่ได้
create or replace function app_setting_cap(k text) returns text
language sql immutable set search_path = public as $fn$
  select case
    when k = 'pay_group' or k like 'payroll\_%' then 'pay.config'
    when k in ('expense_cat','income_cat','wht_rate','tax_account','material_forward_cat')
      then 'acct.config'
    when k = 'pos_walkin_contact' then 'sales.config'
    -- ★ D96 — ทุกค่าที่ขึ้นต้น bar_ เป็นของเจ้าของบาร์
    when k like 'bar\_%' then 'bar.config'
    -- ที่เหลือเป็นค่าระดับกิจการ: แบรนด์ · โทเคน LINE · กิจการที่ออกเอกสาร · บัญชีรับรายได้
    -- → หน้าตั้งค่ากลาง ซึ่งเป็นของ main เท่านั้น
    else 'admin'
  end;
$fn$;

-- ── 16. fn_mig_truncate — ยกมาจาก 0061 ทั้งดุ้น เติมตารางของบาร์ ─────────────
--    🚨 **จุดที่พลาดมาแล้ว 3 รอบติด (D67 · D69 · D78) และ build/lint/test ไม่ฟ้องเลย**
--       ตกตาราง = ลบ/รีเซ็ตลูกค้าไม่ได้ (ติด FK ของ tenants)
--       เรียงผิด = ล้มตอนลบ `entities` (บั๊ก D82 · "ลิสต์ที่ครบ ไม่ได้แปลว่าเรียงถูก")
--       ทุกตาราง `bar_*` มี entity_id ⇒ **ต้องมาก่อน `entities` ทั้งหมด**
create or replace function fn_mig_truncate(p_tenant uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  t text;
  -- เรียงตามลำดับ FK (ลูกก่อนแม่) เพราะ delete ไม่ cascade เองเหมือน truncate
  tables text[] := array[
    'transaction_items','transactions','tax_summaries','tax_payments','wht_certificates',
    'log_material','log_ferment','log_distill','log_distill_run',
    'log_ferment_monitor','log_dilute','log_ferment_draw','log_product','stock_product',
    -- ★ D94 — กลั่นซ้ำ: รอบมี FK ไปล็อต · ล็อตมี entity_id FK
    'log_redistill_round','log_redistill',
    'sales_order_items','sales_orders','warehouse_stock','stock_moves','sale_menu',
    -- ★ D96 — บาร์/POS · ลูกก่อนแม่:
    --   sale_item→sale · fav→customer,menu · recipe→menu,item · menu→category,customer
    --   receive/move→item · sale→customer
    'bar_sale_item','bar_sale','bar_post','bar_move','bar_receive',
    'bar_customer_fav','bar_recipe','bar_menu','bar_category','bar_customer','bar_item',
    -- เงินเดือน (0040 + 0042) — ต้องมาก่อน entities ไม่งั้นติด FK
    'payroll_items','payroll_periods','employees',
    'pay_components','pay_inputs','pay_rates','pay_variables','pay_post_legs',
    'contacts','bank_accounts',
    'materials','containers','products',
    -- ★ report_runs มี entity_id FK → ต้องมาก่อน entities ด้วย (0050)
    'report_runs',
    -- ★ D91 — excise_month_close มี entity_id FK → ต้องมาก่อน entities ด้วย
    'excise_month_close',
    'entities',
    'app_settings','integration_log','edit_log','counters'
  ];
begin
  if p_tenant is null then
    raise exception 'fn_mig_truncate: ต้องระบุ tenant — ห้ามล้างข้ามลูกค้า';
  end if;
  foreach t in array tables loop
    execute format('delete from %I where tenant_id = $1', t) using p_tenant;
  end loop;
end $fn$;

notify pgrst, 'reload schema';
