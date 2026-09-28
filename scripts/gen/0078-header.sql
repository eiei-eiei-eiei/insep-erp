-- ============================================================================
-- 0078 ลงเอกสารขายย้อนหลัง (D100 เฟส 3)
--
-- 🎯 เคสจริง: ระบบล่มในวันที่ขาย → ออกใบกระดาษไปก่อน → มาลงระบบทีหลัง
--    ต้องตรงกันทั้ง 3 อย่าง: เลขเอกสาร · บัญชี/ภพ.30 · ฟอร์ม ภส.
--    · เลขตามวันที่เอกสาร — ฝั่ง TS ส่ง p_date ให้ fn_next_doc_no (มีตั้งแต่ 0076 · ไม่ต้องแก้ SQL)
--    · บัญชี — ของเดิมลง transaction_date = tax_invoice_date = วันที่ที่เลือกอยู่แล้ว
--    · 🔴 **ฟอร์ม ภส.** — `fn_confirm_fulfillment` ลง `log_product.doc_date = current_date` ตายตัว
--      (และเป็น UTC = จัดส่งช่วงเที่ยงคืน–7 โมงได้วันที่ของเมื่อวาน) → รับ p_date
--
-- ── เลขที่กรอกเอง (ใบกระดาษที่ออกไปแล้ว) ────────────────────────────────────────
--   `fn_doc_manual_check` ตรวจว่าเลขนั้นยังไม่มีเอกสารใช้ · สิทธิ์ `sales.config` (หัวหน้า) —
--   ใส่เลขใบกำกับภาษีเองเป็นเรื่องระดับหัวหน้า (แนวเดียวกับยกเลิกออเดอร์ = sales.config · D85)
--   ★ ไม่ต้องแตะตัวนับ — ตัวออกเลขคิดจากเลขมากสุดที่มีอยู่จริงทุกครั้ง (0077) เลขอัตโนมัติถัดไปจึง
--     ต่อจากเลขที่กรอกเองให้เอง
-- ============================================================================

-- ── 1) ตรวจเลขที่กรอกเอง ─────────────────────────────────────────────────────────
create or replace function fn_doc_manual_check(p_type text, p_no text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if left(coalesce(p_type, ''), 6) <> 'sales_' then
    raise exception 'กรอกเลขเองได้เฉพาะเอกสารขาย';
  end if;
  perform fn_doc_issue_guard(p_type, null);
  if not has_cap('sales.config') then
    raise exception 'กรอกเลขเอกสารเองได้เฉพาะหัวหน้าฝ่ายขาย';
  end if;
  return fn_doc_no_taken(v_tenant, p_type, fn_doc_entity_for(v_tenant, p_type, null), trim(p_no));
end $$;
