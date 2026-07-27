-- ============================================================================
-- 0003 accounting — โดเมนบัญชี (MIGRATION_PLAN sec 2.2)
--   transactions · transaction_items · tax_summaries · wht_certificates · scan_log
-- account_name/contact_name เก็บเป็น string (Option A) — จงใจไม่แปลงเป็น FK
-- ============================================================================

create table transactions (
  tx_id text primary key,                       -- 'TR-yyyyMMdd-NNNN'
  created_at timestamptz not null default now(),
  transaction_date date not null,
  type text not null check (type in ('รายรับ','รายจ่าย','โอนระหว่างบัญชี','เช็คราคา')),
  account_name text,                            -- ว่าง = บิลตั้งค้าง/เช็คราคา (ห้าม NOT NULL)
  category text,
  contact_name text,
  description text,
  base_amount numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  amount_after_discount numeric(14,2) not null default 0,
  vat_amount numeric(14,2) not null default 0,
  wht_rate numeric(5,2) not null default 0,
  wht_amount numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,
  tax_invoice_no text,
  tax_invoice_date date,
  receipt_image_url text,                       -- → Supabase Storage URL
  status text not null default 'ปกติ' check (status in ('ปกติ','ยกเลิก')),
  transfer_id text,                             -- 'TRF-yyyyMMdd-NNNN'
  entity_id text not null references entities(entity_id),
  ap_ar_status text check (ap_ar_status in ('AP','AR')),  -- null = settled/ปกติ
  payment_date date,
  po_group_id text,
  installment_no int,
  installment_total int,
  due_date date,
  idempotency_key text,                         -- แทน API_Log scan
  source text not null default 'ui'             -- 'ui'/'sales'/'migration'
);
create unique index tx_idem on transactions (idempotency_key) where idempotency_key is not null;
create index tx_entity_date on transactions (entity_id, transaction_date);
create index tx_contact on transactions (contact_name);
create index tx_pogroup on transactions (po_group_id) where po_group_id is not null;
create index tx_apar on transactions (ap_ar_status) where ap_ar_status is not null;

create table transaction_items (                -- Transaction_Items 11 คอลัมน์
  item_id text primary key,                     -- '{txId}-NN'
  tx_id text not null references transactions(tx_id),
  item_name text not null,
  quantity numeric not null default 1,
  in_vat numeric(14,2) not null default 0,
  ex_vat numeric(14,2) not null default 0,
  total_price numeric(14,2) not null default 0, -- หลังหักส่วนลด item ก่อน VAT
  discount_pct numeric(7,3) not null default 0,
  discount_baht numeric(14,2) not null default 0,
  item_category text,
  item_job text
);
create index ti_tx on transaction_items (tx_id);

create table tax_summaries (                    -- append ทุกครั้งที่ generate ภพ.30
  id bigserial primary key,
  report_month text not null,                   -- 'yyyy-MM'
  total_sales_amount numeric(14,2), total_sales_vat numeric(14,2),
  total_purchase_amount numeric(14,2), total_purchase_vat numeric(14,2),
  forwarded_vat_in numeric(14,2), net_payable numeric(14,2),
  forwarded_vat_out numeric(14,2),
  entity_id text references entities(entity_id),
  created_at timestamptz not null default now()
);
create index ts_month_entity on tax_summaries (report_month, entity_id, created_at desc);

create table wht_certificates (                 -- pnd3-53 → ทะเบียน 50ทวิ
  doc_no text primary key,                      -- '69-001' (running ต่อปี พ.ศ.)
  issue_date date not null,
  contact_name text,
  address text,
  wht_amount numeric(14,2),
  pnd_type text,                                -- 'ภงด.3'/'ภงด.53'
  income_type text, base_amount numeric(14,2),
  tx_ids text[] not null default '{}',          -- comma-separated เดิม → array
  entity_id text not null default 'EID01' references entities(entity_id)
);

create table scan_log (                         -- Scan_Log 5 คอลัมน์ + rate limit
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_email text, status text, confidence text, error_message text
);
