-- ============================================================================
-- 0004 sales — โดเมนขาย (MIGRATION_PLAN sec 2.3 + FLOW_REDESIGN sec 8)
--   ★ ไม่มีตาราง customers — ยุบเข้า contacts (0001) แล้ว (แก้ T1)
--   sale_menu · sales_orders(customer_id→contacts) · sales_order_items
--   · warehouse_stock · stock_moves
-- ============================================================================

create table sale_menu (                         -- menu_b2b 5 คอลัมน์
  id bigserial primary key,
  menu_name text not null unique,
  price numeric(14,2) not null default 0,
  category text,                                 -- 'สุรา' → trigger ตัดสต็อกผลิต
  product_id text references products(product_id), -- จุดเชื่อม ขาย→ผลิต (T4)
  multiplier numeric not null default 1
);

create table sales_orders (                      -- btbtransaction 31 คอลัมน์
  qu_no text primary key,                        -- 'QUyyMMdd-NNN'
  created_at timestamptz not null default now(),
  customer_id text references contacts(contact_id), -- ★→ contacts (ไม่ใช่ customers)
  customer_name text,                            -- snapshot ตอนสร้าง (คงไว้)
  sale_name text,
  qu_expire date,
  sub_total numeric(14,2) default 0,
  discount numeric(14,2) default 0,
  sub_discount numeric(14,2) default 0,
  vat_amount numeric(14,2) default 0,
  grand_total numeric(14,2) default 0,
  order_no text unique,                          -- 'ORDyyMMdd-NNN'
  status text not null default 'รอคอนเฟิร์ม',
  deposit numeric(14,2) default 0,
  outstanding_balance numeric(14,2) default 0,
  due_date date,
  payment_method text,
  inv_no text, tax_no1 text, tax_no2 text,
  remarks text,
  doc_date1 date, doc_date2 date,
  check_detail1 text, check_detail2 text,
  wht_percent numeric(5,2) default 0,
  wht_amount numeric(14,2) default 0,
  net_payable numeric(14,2) default 0,
  doc_to_print text, next_status text,
  category text default 'รายได้ค่าสินค้า'
);
create index so_status on sales_orders (status);

create table sales_order_items (                 -- btbsales 8 คอลัมน์
  id bigserial primary key,
  created_at timestamptz not null default now(),
  qu_no text not null references sales_orders(qu_no),
  item_name text not null,
  qty numeric not null default 0,
  price numeric(14,2) not null default 0,
  extra1 text, extra2 text                       -- ⚠️ ยืนยัน header btbsales col 0-2,7 ก่อน migrate (sec 11 ข้อ 1)
);
create index soi_qu on sales_order_items (qu_no);

create table warehouse_stock (                   -- curstock (สินค้า non-สุรา, manual adj.)
  item_code text primary key,
  item_name text,
  col2 text,                                     -- ⚠️ ยืนยัน header จริง (sec 11 ข้อ 2)
  unit text,
  qty numeric not null default 0
);

create table stock_moves (                       -- stockmove 10 คอลัมน์
  id bigserial primary key,
  created_at timestamptz not null default now(),
  item_code text, item_name text,
  qty_before numeric,
  action text,                                   -- 'IN'/'OUT'
  qty numeric, ref_no text, qty_after numeric,
  user_name text, remarks text
);
