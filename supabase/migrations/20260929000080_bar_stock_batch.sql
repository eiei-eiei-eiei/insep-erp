-- 0080 · บาร์: รับของ / ปรับยอด ทีละหลายรายการ แล้วบันทึกทีเดียว (D103)
--
-- 🎯 ของเดิมกด 1 ครั้ง = 1 รายการ = 1 รอบ network + โหลดหน้าใหม่ทั้งหน้า
--    รับของจากโรงกลั่น 10 อย่าง = รอ 10 รอบ
--
-- ── ทำไมเป็นตัวห่อ ไม่ใช่เขียนตรรกะใหม่ ───────────────────────────────────
-- · วนเรียก `fn_bar_receive` / `fn_bar_adjust` ตัวเดิมทีละแถว
--   ⇒ สูตรถัวเฉลี่ยต้นทุน (golden B3) · การเขียน `bar_move` · ด่านสิทธิ์ `bar_guard`
--     **มีที่เดียวเหมือนเดิม** (บทเรียน D79/D86: สูตรเงินห้ามมี 2 ที่)
-- · 🚨 **ทั้งชุดเป็น transaction เดียว** — แถวไหนล้ม ทุกแถวย้อนกลับหมด
--   ⇒ ไม่มีสภาพ "รับเข้าไป 6 จาก 10 แล้วไม่รู้ว่าตัวไหนเข้า"
--   ข้อความ error บอกเลขแถว + ชื่อวัตถุดิบ ให้แก้แล้วกดใหม่ทั้งชุดได้เลย
-- · ★ **SECURITY INVOKER** — ตัวห่อไม่ข้าม RLS เอง สิทธิ์จริงอยู่ที่ `bar_guard` ในตัวที่ถูกเรียก
--   ⇒ ไม่เพิ่ม definer ตัวใหม่ให้ต้องปิดประตู (D99)
-- · ไม่แตะตารางฝั่งผลิต/ขาย (กติกาเหล็กข้อ 1 ของโมดูลบาร์ · D96)

create or replace function fn_bar_receive_batch(
  p_entity text, p_rows jsonb,
  p_date date default null, p_source text default null, p_note text default null
) returns jsonb
language plpgsql security invoker set search_path = public as $fn$
declare
  v_row jsonb;
  v_i int := 0;
  v_name text;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'ไม่มีรายการให้รับเข้า';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    begin
      perform fn_bar_receive(
        p_entity,
        v_row->>'item',
        (v_row->>'qty')::numeric,
        coalesce((v_row->>'cost_total')::numeric, 0),
        (v_row->>'qty_pack')::numeric,
        p_date, p_source, p_note
      );
    exception when others then
      select name into v_name from bar_item where entity_id = p_entity and item_id = v_row->>'item';
      raise exception 'แถว % (%): %', coalesce((v_row->>'row')::int, v_i), coalesce(v_name, v_row->>'item'), sqlerrm;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'count', v_i);
end $fn$;

create or replace function fn_bar_adjust_batch(p_entity text, p_rows jsonb)
returns jsonb
language plpgsql security invoker set search_path = public as $fn$
declare
  v_row jsonb;
  v_i int := 0;
  v_name text;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'ไม่มีรายการให้ปรับยอด';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    begin
      perform fn_bar_adjust(
        p_entity,
        v_row->>'item',
        (v_row->>'qty_after')::numeric,
        coalesce(v_row->>'reason', 'ปรับยอด'),
        nullif(v_row->>'note', '')
      );
    exception when others then
      select name into v_name from bar_item where entity_id = p_entity and item_id = v_row->>'item';
      raise exception 'แถว % (%): %', coalesce((v_row->>'row')::int, v_i), coalesce(v_name, v_row->>'item'), sqlerrm;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'count', v_i);
end $fn$;

notify pgrst, 'reload schema';

-- ตัวห่อเป็น invoker และตัวที่ถูกเรียกมีด่านครบแล้ว — ปิด anon ไว้ด้วยเพื่อความเรียบร้อย
-- 🚨 ต้องระบุ anon ตรง ๆ (`from public` อย่างเดียวไม่มีผลบน Supabase · D99)
revoke execute on function fn_bar_receive_batch(text, jsonb, date, text, text) from public, anon;
revoke execute on function fn_bar_adjust_batch(text, jsonb) from public, anon;
grant execute on function fn_bar_receive_batch(text, jsonb, date, text, text) to authenticated;
grant execute on function fn_bar_adjust_batch(text, jsonb) to authenticated;
