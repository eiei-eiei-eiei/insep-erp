-- ============================================================================
-- 0060 production — fn_reopen_distill_batch: ถอนการปิด batch กลั่น
--
-- 🚨 ปิดช่องสุดท้ายของกติกา "ทุกจุดที่บันทึกได้ต้องแก้/ลบได้จากแอป" (CLAUDE.md)
--    `log_distill` เป็นตารางเดียวของแอปผลิตที่ **ไม่มีทั้ง update และ delete
--    อยู่ที่ไหนเลยในโค้ดเบส** → กรอกปริมาณ/ดีกรีพลาดแล้วกดปิด batch =
--    ตัวเลขบนฟอร์ม ภส.๐๗-๐๒/๑(๑) ผิดถาวร แก้ได้ทางเดียวคือยิง SQL
--    (เจอตอนเทสลูกค้าใหม่จากศูนย์ 2026-09-06)
--
-- 🪤 อาการซ้อน: พอปิด batch แล้ว batch หายจากดร็อปดาวน์แท็บกลั่น →
--    ตารางค่าที่บันทึก (ซึ่ง**มี**ปุ่มลบรายแถวอยู่แล้ว) ไม่ถูก render อีก
--    = ปุ่มที่มีอยู่กลายเป็นปุ่มที่กดไม่ถึง (ตระกูล D74/D77)
--
-- ── ทำไมเป็น "ถอนการปิด" ไม่ใช่ "แก้ตัวเลขตรง ๆ" ────────────────────────────
-- แก้ตัวเลขในแถวที่ปิดแล้วได้ = ตัวเลข ภส. ขยับโดยไม่มีร่องรอยว่ามาจากไหน
-- ถอนการปิดแล้วปิดใหม่ = ผู้ใช้เห็นค่าที่บันทึกระหว่างกลั่นอีกครั้ง แล้วสรุปใหม่
-- จากของจริง · เป็นจังหวะเดียวกับที่เคยตัดสินใจครั้งแรก (แพตเทิร์นเดียวกับ
-- "ถอนปิดเดือน" ของ D91)
--
-- ★ SECURITY INVOKER → RLS ยังทำงาน (แพตเทิร์นเดียวกับ fn_delete_ferment_batch 0020)
-- ★ `audit_log_distill` (0005) จับ delete ให้อยู่แล้ว → ค่าเดิมไปโผล่ที่
--   ตั้งค่า → ประวัติการแก้ไข ดูย้อนได้ว่าใครถอน เมื่อไร ค่าเดิมเท่าไร
--
-- 🚨 ต้องมี `prod.config` (ระดับหัวหน้า) — เหตุผลเดียวกับที่ D91 ให้ปิด/ถอนเดือน
--    เป็น config: มันคือการแตะตัวเลขที่ใช้ยื่นราชการ ไม่ใช่การคีย์งานประจำวัน
--
-- 🪤 **ไม่บล็อกเมื่อปรุง/บรรจุไปแล้ว** — `log_dilute` และ `log_product`
--    ไม่มีคอลัมน์อ้าง batch เลย (ผูกกับ *ชื่อสุรา* เท่านั้น) จะเช็คก็เช็คไม่ได้จริง
--    การเดาแล้วบล็อกผิดแย่กว่าปล่อยผ่านแล้วเตือน → ฝั่งหน้าจอเป็นคนเตือน
--    (กติกาเดียวกับทั้งแอป: เตือนแล้วให้คนตัดสิน)
-- ============================================================================

create or replace function fn_reopen_distill_batch(p_batch text) returns jsonb
language plpgsql set search_path = public as $$
declare r record; n int;
begin
  if coalesce(p_batch, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'ไม่ระบุ batch');
  end if;

  if not has_cap('prod.config') then
    return jsonb_build_object('ok', false,
      'error', 'ถอนการปิด batch ต้องใช้สิทธิ์หัวหน้าฝ่ายผลิต (ตัวเลขนี้ใช้ยื่นสรรพสามิต)');
  end if;

  select * into r from log_distill where batch = p_batch;
  if not found then
    return jsonb_build_object('ok', false,
      'error', 'ไม่พบ batch "' || p_batch || '" ที่ปิดไว้');
  end if;

  -- ค่าเดิมถูกเก็บโดย trigger audit_log_distill (0005) ก่อนหายไป
  delete from log_distill where batch = p_batch;
  get diagnostics n = row_count;
  if n = 0 then
    -- RLS ปัดตก (ไม่ใช่ tenant นี้ / ไม่มีสิทธิ์ลบ) — ห้ามตอบ ok
    return jsonb_build_object('ok', false, 'error', 'ลบไม่สำเร็จ — สิทธิ์ไม่พอหรือไม่ใช่ข้อมูลของกิจการนี้');
  end if;

  return jsonb_build_object('ok', true, 'batch', p_batch,
    'vol', r.vol, 'abv', r.abv, 'date', r.distill_date);
end $$;

comment on function fn_reopen_distill_batch(text) is
  'ถอนการปิด batch กลั่น — ลบแถว log_distill เพื่อให้ batch กลับเข้าคิวกลั่นและปิดใหม่ได้ '
  '🚨 ค่าเดิมอยู่ใน edit_log (trigger audit_log_distill) · ต้องมี prod.config';

notify pgrst, 'reload schema';
