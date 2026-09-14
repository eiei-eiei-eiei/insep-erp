-- ============================================================================
-- 0072 fn_file_tax ต้องตอบเป็นภาษาไทยเมื่อไม่พบกิจการ (D95 — เจอตอนรัน test:tenant)
--
-- 🔴 ต้นเรื่อง: เทส `tests/tenant/tax-filings.test.ts` ข้อ "ข้าม tenant ไม่ได้" แดง
--    แต่ไล่ดูแล้ว **เทสเขียนผิดเอง ไม่ใช่บั๊กของโค้ด**: harness ตั้งใจให้ tenant ทั้งสอง
--    ใช้ `EID01` เหมือนกัน (พิสูจน์ composite PK) ⇒ B ยิงด้วย `A.entityId` = ยิงด้วย
--    **กิจการของตัวเอง** จึงสำเร็จอย่างถูกต้อง · การกันข้าม tenant ทำงานอยู่แล้วโดย
--    `v_tenant := my_tenant()` (ผู้เรียกระบุ tenant เองไม่ได้เลย)
--
-- ★ แต่การไล่สาเหตุเปิดโปงจุดที่ควรแก้จริง: **`fn_file_tax` ไม่เคยตรวจว่ากิจการมีอยู่จริง**
--    ต่างจาก `fn_excise_close_month` (D91) ที่ตรวจแล้วตอบ 'ไม่พบกิจการ %'
--    ยิง entity ที่ไม่มีในกิจการของตัวเอง จะได้ 2 อาการ ซึ่ง**แย่ทั้งคู่**:
--      · p_kind = 'vat'  → `entity_is_vat()` คืน false → เด้ง *"กิจการนี้ไม่ได้จดทะเบียน
--        ภาษีมูลค่าเพิ่ม"* ซึ่ง **บอกเหตุผลผิด** (ความจริงคือไม่มีกิจการนี้)
--        🪤 ตระกูล D91/0059 — ด่านกันถูก แต่ประโยคที่ผู้ใช้อ่านแล้วไปแก้ผิดเรื่อง
--      · p_kind = 'pnd3' → หลุดไปชน FK แล้วโยน SQLSTATE 23503 ดิบภาษาอังกฤษออกหน้าจอ
--
-- 🚨 **ต้องเป็น migration ใหม่ ไม่ใช่แก้ 0071** — 0071 ลง DB ไปแล้ว
--    (`supabase db push` ไม่รันไฟล์ที่บันทึกว่ารันแล้วซ้ำ ⇒ แก้ไฟล์เดิม = ไม่มีผลกับ DB
--    ที่ลงไปแล้ว แต่ผ่านบนเครื่องที่ยังไม่ลง = หลุดจากกันเงียบ ๆ)
--
-- ★ ยก `fn_file_tax` จาก 0071 มาทั้งดุ้นด้วยสคริปต์ `scripts/gen/gen-0072.mjs`
--   signature ไม่เปลี่ยน → `create or replace` ทับได้ ไม่เกิด overload (กับดัก D69)
-- ============================================================================

create or replace function fn_file_tax(
  p_kind text, p_period text, p_entity text, p_filed_on date, p_note text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := my_tenant();
  v_id bigint;
begin
  if v_tenant is null then raise exception 'ไม่รู้ว่าอยู่กิจการไหน (ต้องล็อกอินก่อน)'; end if;
  if not has_cap('acct.write') then raise exception 'ไม่มีสิทธิ์บันทึกการยื่นแบบ'; end if;
  if p_kind not in ('vat','pnd3','pnd53') then raise exception 'ไม่รู้จักชนิดภาษี: %', p_kind; end if;
  if coalesce(p_entity,'') = '' then raise exception 'ต้องระบุกิจการ — แต่ละกิจการยื่นแยกใบ'; end if;
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'งวดต้องเป็นรูปแบบ yyyy-MM'; end if;
  if my_entities() is not null and not (p_entity = any(my_entities())) then
    raise exception 'ไม่มีสิทธิ์ในกิจการ %', p_entity;
  end if;

  /*
   * ไม่มีกิจการนี้อยู่จริง = ตอบเป็นภาษาไทยตั้งแต่ตรงนี้ (แพตเทิร์น fn_excise_close_month · D91)
   *
   * 🚨 ต้องอยู่ **ก่อน** ด่าน VAT — ไม่งั้น `entity_is_vat()` คืน false แล้วผู้ใช้ได้ข้อความ
   *    *ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม* ซึ่งเป็นเหตุผลที่ผิด (ตระกูล D91/0059:
   *    ด่านกันถูก แต่ประโยคพาผู้ใช้ไปแก้ผิดเรื่อง)
   * ★ กรณี pnd3/pnd53 เดิมหลุดไปชน FK แล้วโยน SQLSTATE 23503 ดิบออกหน้าจอ
   */
  if not exists (select 1 from entities where tenant_id = v_tenant and entity_id = p_entity) then
    raise exception 'ไม่พบกิจการ %', p_entity;
  end if;

  -- 🚨 กิจการที่ไม่ได้จด VAT ไม่มีหน้าที่ยื่น ภพ.30 → บล็อกที่ DB ด้วย (กติกาเดียวกับ 0036/0054)
  if p_kind = 'vat' and not entity_is_vat(v_tenant, p_entity) then
    raise exception 'กิจการนี้ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม จึงไม่มี ภพ.30 ให้ยื่น';
  end if;

  begin
    insert into tax_filings(tenant_id, entity_id, kind, period, filed_on, filed_by, source, note)
    values (v_tenant, p_entity, p_kind, p_period, p_filed_on, auth.uid(), 'manual', nullif(p_note,''))
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'งวดนี้บันทึกว่ายื่นแล้ว — ถ้าต้องแก้ ให้ถอนการบันทึกยื่นก่อน');
  end;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;


revoke execute on function fn_file_tax(text, text, text, date, text) from public;
grant  execute on function fn_file_tax(text, text, text, date, text) to authenticated;

notify pgrst, 'reload schema';
