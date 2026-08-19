-- ============================================================================
-- 0044 ตัวแปรกลาง: เลือกตัวดำเนินการได้ (+ − × ÷) + เลือกความละเอียดของค่า
--      เหตุผลเต็มใน D70 · migration แบบ **เพิ่มของ** → ลง DB ก่อน git push
--
-- 🚨 ที่เพิ่ม + − × เข้ามาจากเดิมที่มีแต่ ÷ **ไม่ได้แปลว่ากติกา "ห้ามทำภาษาสูตร"
--    (D66/D67) ถูกยกเลิก** — สิ่งที่กติกานั้นปกป้องคือ
--      1. ไม่มี parser        2. ไม่มีลำดับความสำคัญของตัวดำเนินการ
--      3. เส้นทางคำนวณนับได้จนครบ → golden test คลุมได้หมด
--    การขยาย "ชุดปิด" ยังรักษาครบทั้ง 3 ข้อ · เส้นที่ยังห้ามข้ามคือ
--    **วงเล็บ · ตัวแปรอ้างตัวแปร · สูตรที่ลูกค้าพิมพ์เป็นข้อความ**
-- ============================================================================

-- ── 1. เปลี่ยนชื่อคอลัมน์ให้ตรงความจริง ──────────────────────────────────────
--    ชื่อ `divisors` มาจากสมัยที่หารได้อย่างเดียว · ตอนนี้เป็น "ขั้นการคำนวณ"
--    ★ เป็นการ rename ล้วน ๆ ข้อมูลเดิมไม่ถูกแตะ (แต่ละสมาชิกยังเป็น {kind,value,inputKey}
--      ซึ่งฝั่งโค้ดตีความว่า op='div' เมื่อไม่มีช่อง op → ตัวเลขของลูกค้าเดิมไม่ขยับ)
--    🪤 ต้องกันด้วย DO block: `alter ... rename` ไม่มี `if exists` สำหรับกรณีเปลี่ยนไปแล้ว
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'pay_variables' and column_name = 'divisors'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'pay_variables' and column_name = 'steps'
  ) then
    alter table pay_variables rename column divisors to steps;
  end if;
end $$;

comment on column pay_variables.steps is
  'ขั้นการคำนวณต่อจากตัวตั้ง: [{op,kind,value,inputKey}] — op ∈ add|sub|mul|div '
  '🚨 คิดเรียงซ้ายไปขวาทีละขั้น **ไม่มีลำดับความสำคัญของตัวดำเนินการ** '
  '(ฐาน − A ÷ B = ((ฐาน − A) ÷ B) ไม่ใช่ ฐาน − (A ÷ B)) หน้าจอต้องโชว์วงเล็บตามลำดับจริง '
  '★ ไม่มี op = div (ข้อมูลก่อน D70) — ค่าปริยายนี้ห้ามเปลี่ยน';

-- ── 2. ความละเอียดของค่าที่ตัวแปรเก็บ ───────────────────────────────────────
--    🪤 ค่าปริยาย 'none' = ไม่ปัดเลย (พฤติกรรมเดิม) — **ห้ามเปลี่ยนค่าปริยาย**
--       เปลี่ยนเมื่อไหร่ = อัตราต่อชั่วโมงที่ลูกค้าทุกเจ้าตั้งไว้แล้วขยับพร้อมกันเงียบ ๆ
alter table pay_variables add column if not exists rounding text not null default 'none';

alter table pay_variables drop constraint if exists pay_variables_rounding_check;
alter table pay_variables add constraint pay_variables_rounding_check
  check (rounding in ('none','int','dec2'));

comment on column pay_variables.rounding is
  'none = ไม่ปัด (ค่าเต็มความละเอียด · ค่าปริยายและพฤติกรรมเดิม) · int = จำนวนเต็ม · dec2 = ทศนิยม 2 ตำแหน่ง';

-- ★ ไม่ได้ใส่ CHECK ตรวจค่า `op` ใน jsonb โดยตั้งใจ — ตรวจ jsonb ด้วย CHECK อ่านยาก
--   และบำรุงรักษาแพงกว่าที่ได้ · ด่านจริงคือ `savePayVariableAction` ที่ปฏิเสธ op นอกชุดปิด
--   (ค่าที่หลุดเข้ามาแบบอื่นจะถูกตีความเป็น div ซึ่งเป็นพฤติกรรมเดิม ไม่ทำให้พัง)

notify pgrst, 'reload schema';
