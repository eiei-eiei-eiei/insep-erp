-- ============================================================================
-- 0062 หมายเหตุบนฟอร์มต้องตามทันเมื่อบันทึก/ลบรอบกลั่นซ้ำ (D94 · เจอตอนเทสในเบราว์เซอร์)
--
-- 🔴 อาการ: เปิดล็อต → หมายเหตุแถว "ยกไปปรุง" ถูกเขียนตอนนั้นว่า
--      *"ยกไปกลั่นซ้ำ S1/69 (อยู่ระหว่างดำเนินการ)"*  ← ตอนนั้นยังไม่มีรอบ จึงไม่มีคำว่า "แช่"
--    แล้วบันทึกรอบที่มีวันเริ่มแช่ + ตัดสมุนไพรเข้าบัญชี → **หมายเหตุไม่ถูกอัปเดตเลย**
--    เพราะ 0061 เขียนทับหมายเหตุเฉพาะตอน `fn_close_…` / `fn_reopen_…` เท่านั้น
--
-- 🚨 ทำไมถึงสำคัญ: ช่วง "แช่อยู่" กินเวลาเป็นสัปดาห์ = สภาพปกติที่เจ้าหน้าที่จะเห็นตอนเข้าตรวจ
--    ฟอร์ม ภส.๐๗-๐๒/๑(๑) เขียนว่า *ยกไปกลั่นซ้ำ* (ไม่มีการแช่) ขณะที่ ภส.๐๗-๐๑/๑ วันเดียวกัน
--    มีการตัดสมุนไพรอยู่ ⇒ **สองใบขัดกันเองบนกระดาษ** ซึ่งเป็นสิ่งที่การแยกท่อนตั้งใจจะแก้พอดี
--    (ตระกูล D91/0059: ตรรกะทำถูกทุกประการ ที่ผิดคือประโยคที่คนอ่านแล้วเชื่อ)
--
-- ★ ข้อความยังสร้างจาก `lotNoteText()` ฝั่ง lib ที่มีเทสคุมเหมือนเดิม — ไฟล์นี้แค่เปิดช่อง
--   ให้ส่งเข้ามาเก็บ **ห้ามประกอบประโยคใน SQL** (สูตร/ถ้อยคำมี 2 ที่เมื่อไหร่ = พังเงียบ D79/D86)
--
-- 🪤 พารามิเตอร์เพิ่ม = **ต้อง drop function ก่อน** ไม่งั้นได้ overload ตัวที่ 2
--    แล้ว PostgREST เลือกตัวไหนก็ไม่รู้ (บทเรียน D69)
-- ============================================================================

drop function if exists fn_save_redistill_round(text, int, text, date, date,
  numeric, numeric, numeric, numeric, text, jsonb);
drop function if exists fn_delete_redistill_round(text, int, text);

create or replace function fn_save_redistill_round(
  p_lot_no text, p_round_no int, p_doc_ref text,
  p_soak_date date, p_distill_date date,
  p_start_vol numeric, p_start_abv numeric,
  p_end_vol numeric, p_end_abv numeric,
  p_note text default null,
  p_materials jsonb default '[]'::jsonb,
  p_draw_note text default null            -- ★ D94/0062 — หมายเหตุแถว "ยกไปปรุง" ที่คิดใหม่แล้ว
) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  v_lot log_redistill%rowtype;
  it jsonb;
  v_mats int := 0;
begin
  select * into v_lot from log_redistill where lot_no = p_lot_no;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ไม่พบล็อต "'||p_lot_no||'"');
  end if;
  if v_lot.dilute_date is not null then
    return jsonb_build_object('ok', false, 'error',
      'ล็อต "'||p_lot_no||'" ปิดไปแล้ว — กดถอนการปิดล็อตก่อนถึงจะแก้รอบได้');
  end if;
  if p_doc_ref is distinct from (p_lot_no || ' รอบ ' || p_round_no) then
    return jsonb_build_object('ok', false, 'error', 'เลขอ้างอิงวัตถุดิบไม่ถูกต้อง');
  end if;
  if jsonb_array_length(p_materials) > 0 and p_soak_date is null then
    return jsonb_build_object('ok', false, 'error',
      'ใส่สมุนไพรแล้วต้องระบุวันเริ่มแช่ (วันที่ตัดวัตถุดิบเข้าบัญชี ภส.๐๗-๐๑/๑)');
  end if;

  insert into log_redistill_round(lot_no, round_no, soak_date, distill_date,
                                  start_vol, start_abv, end_vol, end_abv, note)
  values (p_lot_no, p_round_no, p_soak_date, p_distill_date,
          p_start_vol, p_start_abv, p_end_vol, p_end_abv, p_note)
  on conflict (tenant_id, lot_no, round_no) do update
    set soak_date = excluded.soak_date, distill_date = excluded.distill_date,
        start_vol = excluded.start_vol, start_abv = excluded.start_abv,
        end_vol   = excluded.end_vol,   end_abv   = excluded.end_abv,
        note      = excluded.note;

  -- เขียนทับรายการสมุนไพรของรอบนี้ทั้งชุด (ลบแล้วใส่ใหม่ = แก้รายการแล้วไม่มีเศษค้าง)
  delete from log_material where doc_ref = p_doc_ref and trans_type = 'จ่าย';
  for it in select value from jsonb_array_elements(p_materials) loop
    if (it->>'material_id') is not null and (it->>'amount') is not null then
      insert into log_material(doc_date, trans_type, material_id, amount, doc_ref, note)
      values (p_soak_date, 'จ่าย', it->>'material_id', (it->>'amount')::numeric,
              p_doc_ref, 'แช่เพื่อกลั่นซ้ำ (อัตโนมัติ)');
      v_mats := v_mats + 1;
    end if;
  end loop;

  -- ★ หมายเหตุบนฟอร์มต้องตามทันทันที (แช่แล้วต้องขึ้นว่าแช่)
  if p_draw_note is not null then
    update log_dilute set note = p_draw_note
      where redistill_lot = p_lot_no and redistill_leg = 'ยกไปปรุง';
  end if;

  return jsonb_build_object('ok', true, 'lot_no', p_lot_no,
                            'round_no', p_round_no, 'materials', v_mats);
end $fn$;

create or replace function fn_delete_redistill_round(
  p_lot_no text, p_round_no int, p_doc_ref text, p_draw_note text default null
) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  v_lot log_redistill%rowtype;
  v_n int;
begin
  select * into v_lot from log_redistill where lot_no = p_lot_no;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ไม่พบล็อต "'||p_lot_no||'"');
  end if;
  if v_lot.dilute_date is not null then
    return jsonb_build_object('ok', false, 'error',
      'ล็อต "'||p_lot_no||'" ปิดไปแล้ว — กดถอนการปิดล็อตก่อน');
  end if;
  if p_doc_ref is distinct from (p_lot_no || ' รอบ ' || p_round_no) then
    return jsonb_build_object('ok', false, 'error', 'เลขอ้างอิงวัตถุดิบไม่ถูกต้อง');
  end if;

  delete from log_material where doc_ref = p_doc_ref and trans_type = 'จ่าย';
  delete from log_redistill_round where lot_no = p_lot_no and round_no = p_round_no;
  get diagnostics v_n = row_count;
  -- 🚨 D93 — ลบไม่โดนอะไรเลยต้องตอบ error ไม่ใช่ ok (ผู้ใช้จะนึกว่าลบสำเร็จ)
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error',
      'ไม่พบรอบที่ '||p_round_no||' ของล็อต "'||p_lot_no||'"');
  end if;

  -- ★ ลบรอบที่แช่อยู่รอบเดียวออก = ล็อตนี้ไม่มีการแช่แล้ว หมายเหตุต้องกลับด้วย
  if p_draw_note is not null then
    update log_dilute set note = p_draw_note
      where redistill_lot = p_lot_no and redistill_leg = 'ยกไปปรุง';
  end if;

  return jsonb_build_object('ok', true);
end $fn$;

notify pgrst, 'reload schema';
