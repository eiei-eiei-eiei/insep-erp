-- ============================================================================
-- 0020 production — fn_delete_ferment_batch: ลบ batch หมัก + คืนวัตถุดิบอัตโนมัติ
--   ปิดช่องสุดท้ายของกติกา "ทุกจุดบันทึกได้ต้องแก้/ลบได้" (FLOW sec 10.1)
--   ตอนลงหมัก fn_save_ferment เบิกวัตถุดิบ (log_material 'จ่าย' doc_ref=batch) ด้วย
--   → ลบต้องคืนด้วย ไม่งั้นสต็อกวัตถุดิบค้างผิด
--   GUARD: batch ที่กลั่นแล้ว (มี log_distill_run/log_distill = ข้อมูล ภส.) ห้ามลบ
--   SECURITY INVOKER → RLS (main เท่านั้น) · edit_log เก็บ audit อัตโนมัติทุก delete
-- ============================================================================

create or replace function fn_delete_ferment_batch(p_batch text) returns jsonb
language plpgsql set search_path = public as $$
declare n_ferment int; n_mat int; n_mon int;
begin
  if coalesce(p_batch, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'ไม่ระบุ batch');
  end if;

  -- guard: กลั่นไปแล้ว = มีข้อมูลกลั่น/ปิด batch (ภส.) → ห้ามลบ กันข้อมูลราชการหาย
  if exists (select 1 from log_distill_run where batch = p_batch)
     or exists (select 1 from log_distill where batch = p_batch) then
    return jsonb_build_object('ok', false,
      'error', 'batch "' || p_batch || '" กลั่นไปแล้ว ลบไม่ได้ (มีข้อมูลกลั่น/ภส.) — ถ้าต้องแก้จริงให้ลบค่ากลั่นในแท็บกลั่นก่อน');
  end if;

  -- คืนวัตถุดิบ: ลบแถวเบิกอัตโนมัติของ batch นี้ (สต็อกวัตถุดิบคิดตอนอ่าน → คืนเอง)
  delete from log_material where doc_ref = p_batch and note = 'เบิกไปหมัก (อัตโนมัติ)';
  get diagnostics n_mat = row_count;

  -- ลบค่าติดตามหมักของ batch (ถ้ามี)
  delete from log_ferment_monitor where batch = p_batch;
  get diagnostics n_mon = row_count;

  -- ลบ batch หมัก (ครอบทุกถัง)
  delete from log_ferment where batch = p_batch;
  get diagnostics n_ferment = row_count;

  if n_ferment = 0 then
    return jsonb_build_object('ok', false, 'error', 'ไม่พบ batch ' || p_batch);
  end if;
  return jsonb_build_object('ok', true, 'ferment', n_ferment, 'material', n_mat, 'monitor', n_mon);
end $$;
