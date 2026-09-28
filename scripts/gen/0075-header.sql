-- ============================================================================
-- 0075 เลขเอกสารใช้ "วันนี้ตามเวลาไทย" (D100 เฟส 0)
--
-- 🔴 บั๊ก: เลขเอกสารฝั่งขาย (QU/ORD/INV/TAX) และรหัส TR-/TRF- ประกอบวันที่ด้วย `current_date`
--    ซึ่งบน Supabase คือเวลา **UTC** ⇒ เอกสารที่ออกช่วง 00:00–06:59 เวลาไทยได้เลขของ "เมื่อวาน"
--    (ออกตี 2 วันที่ 28 ได้ TAX260927-…) · ฝั่งบาร์เคยเจอแล้วแก้เป็น Asia/Bangkok ใน 0065
--    แต่ฝั่งขาย/บัญชีไม่ได้ตามไปแก้
--
-- ★ ขอบเขตแคบโดยตั้งใจ: แก้เฉพาะการ **ประกอบเลข** · ไม่แตะ `current_date` ที่ใช้เป็นวันที่
--    ของข้อมูล (เช่น `log_product.doc_date`) — เรื่องนั้นอยู่ในงานลงเอกสารย้อนหลัง (D100 เฟส 3)
--    ที่ต้องคิดวันที่ของเอกสาร บัญชี และฟอร์ม ภส. ไปพร้อมกัน
-- ★ ไม่ตั้ง timezone ระดับ database — เปลี่ยน `current_date` ทุกจุดทั้งฐานพร้อมกันเงียบ ๆ
--    รวมวันที่ที่ลงฟอร์มราชการ ซึ่งต้องตัดสินทีละจุด ไม่ใช่เหมาทั้งก้อน
-- ★ key ของตัวนับยังเป็นรูปแบบเดิมเป๊ะ (`QU-260928` · `TR-20260928`) แค่วันที่ถูกต้อง
-- ============================================================================

-- ── 1) วันนี้ตามเวลาไทย — จุดเดียวของทั้งระบบฝั่ง SQL ─────────────────────────────
--    ★ invoker + stable (ไม่ใช่ definer) — ไม่มีสิทธิ์อะไรให้รั่ว
create or replace function fn_today_th() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Bangkok')::date;
$$;

comment on function fn_today_th() is
  'วันนี้ตามเวลาไทย — ใช้ประกอบเลขเอกสาร (current_date บน Supabase เป็น UTC) · D100';

-- ── 2) next_tx_id / fn_next_sales_doc — ตัวเดียวกับ 0011/0013 เปลี่ยนแค่ที่มาของวันที่ ──
create or replace function next_tx_id() returns text
language sql set search_path = public as $$
  select 'TR-' || to_char(fn_today_th(), 'YYYYMMDD') || '-' ||
         lpad(next_serial('TR-' || to_char(fn_today_th(), 'YYYYMMDD'))::text, 4, '0');
$$;

-- 🚨 ยังเป็น definer ตามเดิม (0013) · นับเลขผ่าน next_serial ที่มีด่าน my_tenant()
--    ⇒ อยู่ใน DEFINER_ALLOWLIST หมวด delegates
-- 🪤 **ห้ามเรียก fn_today_th() ในตัวนี้** — ตัวตรวจหมวด delegates (D99) ยอมให้ส่งต่อได้เฉพาะ
--    ฟังก์ชันที่ปิดแล้วหรือมีด่าน · fn_today_th ไม่มีทั้งสองอย่าง ⇒ audit แดง
--    จึงเขียนนิพจน์ตรง ๆ แบบเดียวกับ fn_bar_next_doc (0065)
-- ★ create or replace (ไม่ใช่ drop+create) = สิทธิ์ execute คงเดิม ไม่ได้ default คืน (D99)
create or replace function fn_next_sales_doc(p_prefix text) returns text
language sql security definer set search_path = public as $$
  select p_prefix || to_char((now() at time zone 'Asia/Bangkok')::date,'YYMMDD') || '-' ||
         lpad(next_serial(p_prefix || '-' ||
              to_char((now() at time zone 'Asia/Bangkok')::date,'YYMMDD'))::text, 3, '0');
$$;
