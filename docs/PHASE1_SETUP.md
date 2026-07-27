# Phase 1 — คู่มือ setup ทีละขั้น (สำหรับผู้ใช้ที่ไม่เขียนโค้ด)

> **วิธีอ่านคู่มือนี้**: ทำจากบนลงล่าง ห้ามข้าม · กล่องสีเทาแต่ละกล่อง = **1 คำสั่ง** ให้คัดลอกทั้งกล่องไปวางใน terminal แล้วกด Enter · ใต้คำสั่งจะบอกว่า "ควรเห็นอะไร" ถ้าไม่ตรงให้หยุดแล้วถาม
> ต้องมี Supabase project พร้อมแล้ว (ทำใน Phase 0) — ถ้ายังไม่มี บอกผมก่อน

---

## ขั้นที่ 0 — เปิดหน้าต่างพิมพ์คำสั่ง (PowerShell) ที่โฟลเดอร์โปรเจกต์

1. กดปุ่ม **Windows** ที่คีย์บอร์ด พิมพ์ `powershell` แล้วกด **Enter** — จะได้หน้าต่างสีน้ำเงิน/ดำ
2. คัดลอกคำสั่งนี้ไปวาง (คลิกขวาในหน้าต่าง = วาง) แล้วกด **Enter** เพื่อเข้าไปที่โฟลเดอร์โปรเจกต์:

```powershell
cd D:\insep-erp
```

ควรเห็นบรรทัดเปลี่ยนเป็นขึ้นต้นด้วย `PS D:\insep-erp>`

3. เปิดโฟลเดอร์โปรเจกต์ใน File Explorer ไว้ดูไฟล์ควบคู่กัน (ไม่บังคับ):

```powershell
explorer .
```

> ต่อจากนี้ **ทุกคำสั่งพิมพ์ในหน้าต่าง PowerShell นี้** (อย่าปิด) และต้องอยู่ที่ `PS D:\insep-erp>` เสมอ

---

## ขั้นที่ 1 — ใส่กุญแจเชื่อม Supabase (ไฟล์ .env.local)

1. สร้างไฟล์ตั้งค่าจากไฟล์ตัวอย่าง:

```powershell
Copy-Item .env.example .env.local
```

ควรเห็น: ไม่มีข้อความ error (เงียบ = สำเร็จ)

2. เปิดหน้าเว็บ Supabase dashboard หน้ากุญแจ (API keys):

```powershell
Start-Process "https://supabase.com/dashboard/project/_/settings/api"
```

เบราว์เซอร์จะเปิด → ถ้าให้ login ก็ login → เลือก project ของคุณ → จะเห็นหน้า **Project API keys**

3. เปิดไฟล์ `.env.local` ด้วย Notepad เพื่อเติมค่า:

```powershell
notepad .env.local
```

4. ในหน้าเว็บ (ข้อ 2) จะมี 3 ค่า — คัดลอกมาวางใน Notepad ให้ตรงช่อง (วางต่อหลังเครื่องหมาย `=` ไม่ต้องเว้นวรรค):

| ในเว็บ Supabase | วางลงบรรทัดใน Notepad |
|---|---|
| **Project URL** | `NEXT_PUBLIC_SUPABASE_URL=` |
| **anon public** | `NEXT_PUBLIC_SUPABASE_ANON_KEY=` |
| **service_role** (กดปุ่ม Reveal ก่อน) | `SUPABASE_SERVICE_ROLE_KEY=` |

ตัวอย่างหลังเติมเสร็จ (ค่าจริงจะยาวกว่านี้มาก):
```
NEXT_PUBLIC_SUPABASE_URL=https://abcdxyz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
```

5. กด **Ctrl+S** เพื่อบันทึก แล้วปิด Notepad

> ⛔ `service_role` คือกุญแจผีเสื้อ ห้ามส่งให้ใคร ห้ามลงโซเชียล — ไฟล์นี้ถูกกันไม่ให้ขึ้น GitHub อยู่แล้ว

---

## ขั้นที่ 2 — สร้างตารางทั้งหมดใน Supabase

1. เข้าสู่ระบบ Supabase จาก terminal (จะเปิดเบราว์เซอร์ให้กดยืนยันครั้งเดียว):

```powershell
npx supabase login
```

ควรเห็น: เบราว์เซอร์เด้งขึ้น กด **Authorize** → กลับมาที่ terminal เห็นคำว่า `Finished supabase login.`

2. หา **project ref** (รหัสโปรเจกต์): ดูที่ URL ในเบราว์เซอร์ตอนอยู่หน้า dashboard จะเป็นแบบ
   `https://supabase.com/dashboard/project/`**`abcdxyzefghijkl`** — ตัวหนาคือ ref (ยาว ~20 ตัวอักษร)

3. เชื่อม terminal กับ project ของคุณ — **แก้ ` ` เป็น ref จริงของคุณ** แล้วรัน:

```powershell
npx supabase link --project-ref วางrefตรงนี้
```

ระหว่างนี้อาจถาม **database password** (รหัสที่ตั้งตอนสร้าง project) ให้พิมพ์แล้วกด Enter (ตอนพิมพ์จะไม่เห็นตัวอักษร — ปกติ)
ควรเห็น: `Finished supabase link.`

4. สร้างตารางทั้งหมด (รันไฟล์ migration 7 ไฟล์ตามลำดับ):

```powershell
npx supabase db push
```

ควรเห็น: รายชื่อไฟล์ `20260720000001_core.sql … 20260720000007_storage.sql` แล้วจบด้วย `Finished supabase db push.`

5. เปิดหน้าตารางในเว็บเพื่อตรวจ:

```powershell
Start-Process "https://supabase.com/dashboard/project/_/editor"
```

ควรเห็น: รายชื่อตารางฝั่งซ้ายเยอะ ~30 ตาราง (entities, transactions, log_distill, sales_orders, ฯลฯ)

---

## ขั้นที่ 3 — สร้างบัญชีเจ้าของกิจการ (ครั้งเดียว)

> ระบบ login ด้วย **ชื่อผู้ใช้ (username) ไม่ต้องมีอีเมลจริง** — เบื้องหลังผูกเป็น `username@insep.local`
> เจ้าของคนแรกต้องสร้างผ่าน dashboard ครั้งเดียว (ไข่กับไก่) · **หลังจากนั้นสร้าง/จัดการผู้ใช้คนอื่นในแอปได้เลย** (ดูหัวข้อท้ายไฟล์)

### 3.1 สร้างบัญชี login
1. เปิดหน้าจัดการผู้ใช้:

```powershell
Start-Process "https://supabase.com/dashboard/project/_/auth/users"
```

2. กดปุ่ม **Add user** (มุมขวาบน) → เลือก **Create new user**
3. ช่อง **Email address** ให้พิมพ์ **ชื่อผู้ใช้ + `@insep.local`** เช่น `owner@insep.local`
   (คุณจะ login ด้วยคำว่า `owner` เฉย ๆ — ส่วน `@insep.local` เป็นแค่รูปแบบเบื้องหลัง)
4. ช่อง **Password** ใส่รหัสที่จะใช้ login (จำให้ดี)
5. ⚠️ ติ๊กถูก **Auto Confirm User** ✅ **(สำคัญมาก! ถ้าไม่ติ๊ก = login ไม่ได้)**
6. กด **Create user** — ช่อง **Confirmed** ในตารางต้องไม่ว่างเปล่า

### 3.2 ปรับสิทธิ์เจ้าของเป็น main
1. เปิดหน้า SQL Editor:

```powershell
Start-Process "https://supabase.com/dashboard/project/_/sql/new"
```

2. วาง SQL นี้ — **แก้ `owner` เป็นชื่อผู้ใช้ที่ตั้งในข้อ 3.1** (ส่วนหน้า @) แล้วกด **Run**:

```sql
update profiles set role = 'main', display_name = 'เจ้าของกิจการ', allowed_entity_ids = null
where username = 'owner';
```

ควรเห็น: `Success. 1 row(s) affected` (ถ้าได้ `0 rows` = พิมพ์ชื่อไม่ตรง ตรวจแล้วรันใหม่)

### 3.3 สร้างกิจการแรกไว้ใช้ Phase ถัดไป
วาง SQL นี้ในช่องเดิม (ลบอันเก่าออกก่อน) แก้ชื่อ/เลขภาษีเป็นของจริง แล้วกด **Run**:

```sql
insert into entities (entity_id, name, is_vat, tax_id, branch)
values ('EID01', 'ชื่อกิจการของคุณ', true, '0000000000000', 'สำนักงานใหญ่');
```

ควรเห็น: `Success. No rows returned`

---

## ขั้นที่ 4 — เปิดแอปแล้วลอง login

1. สั่งเปิดแอป (เซิร์ฟเวอร์จะรันค้างไว้ในหน้าต่างนี้):

```powershell
npm run dev
```

ควรเห็น: `▲ Next.js …` และบรรทัด `- Local:  http://localhost:3000` (ปล่อยหน้าต่างนี้รันไว้ อย่าปิด)

2. เปิดแอปในเบราว์เซอร์ (พิมพ์ที่ช่อง URL เอง หรือคลิกลิงก์นี้):
   👉 **http://localhost:3000**
3. ควรเด้งไปหน้า **เข้าสู่ระบบ** → ช่อง **ชื่อผู้ใช้** ใส่ `owner` (ชื่อจากข้อ 3.1 ไม่ต้องมี `@insep.local`) + รหัสผ่าน → กด **เข้าสู่ระบบ**
4. ควรเห็นหน้า **เลือกพื้นที่ทำงาน** มี 4 ช่อง: 🏭 ผลิต · 🛒 ขาย · 📒 บัญชี · 📄 รายงานราชการ + เมนู **⚙️ ตั้งค่า** (เฉพาะเจ้าของ)

> เมื่อทดสอบเสร็จ: กลับไปหน้าต่าง PowerShell กด **Ctrl+C** เพื่อหยุดเซิร์ฟเวอร์ (ถ้าถาม `Y/N` พิมพ์ `Y` Enter)

---

## ขั้นที่ 5 — ทดสอบว่าสิทธิ์ทำงานจริง (viewer แก้ข้อมูลไม่ได้)

นี่คือจุดสำคัญของ Phase 1 — พิสูจน์ว่าคนที่เป็น "ผู้ดูข้อมูล" เขียนข้อมูลไม่ได้แม้จะพยายาม

1. login เป็นเจ้าของ → เมนู **⚙️ ตั้งค่า** → กรอกฟอร์ม "สร้างผู้ใช้ใหม่": username `viewer1`, รหัสผ่าน, สิทธิ์ = **ผู้ดูข้อมูล (viewer)** → กด **สร้าง**
   (นี่คือการทดสอบหน้าจัดการผู้ใช้ไปในตัว) · จากนั้นหา **User UID** ของ viewer1 ได้ที่ dashboard → Authentication → Users
2. เปิด SQL Editor:

```powershell
Start-Process "https://supabase.com/dashboard/project/_/sql/new"
```

3. ทดสอบสิทธิ์: วาง SQL นี้ แก้ `วาง_UID_คนที่2` เป็น UID ของคนที่ 2 แล้วกด **Run**:

```sql
set local role authenticated;
set local request.jwt.claims to '{"sub":"วาง_UID_คนที่2","role":"authenticated"}';
insert into app_settings (kind, value) values ('expense_cat', 'ทดสอบ');
```

✅ **ผลที่ถูกต้องคือ error สีแดง**: `new row violates row-level security policy for table "app_settings"`
= viewer เขียนไม่ได้จริง (ระบบสิทธิ์ทำงานถูกต้อง) — ที่เห็น error ตรงนี้คือ "ผ่าน"

> ถ้าได้ `Success` แทน error → ผิดปกติ ให้แจ้งผม

---

## ขั้นที่ 6 — อัปโหลดฟอร์มราชการ + ฟอนต์เข้า Storage

ไฟล์ต้นฉบับอยู่ใน `docs/form/` แล้ว — สคริปต์เปลี่ยนชื่อปลายทางเป็นอังกฤษให้อัตโนมัติ
(Supabase Storage ไม่รับชื่อไฟล์ภาษาไทย) และรวมไฟล์ wh3 (ยืนยันแล้วว่าเป็นเทมเพลตเปล่า)

1. ถ้าเซิร์ฟเวอร์ยังรันอยู่จากขั้นที่ 4 ให้กด **Ctrl+C** หยุดก่อน (จะได้พิมพ์คำสั่งได้)
2. รันคำสั่งอัปโหลด (มี `--include-wh3` เพราะยืนยัน wh3 แล้ว):

```powershell
npm run upload:templates -- docs/form --include-wh3
```

ควรเห็น: `✓ …TTF → fonts/…`, `✓ ภส_07-… → excise/pso_07-…`, `✓ …wh3… → wht/wh3_template.pdf` แล้วสรุป `อัปโหลด 6`

3. เปิดหน้า Storage ตรวจ:

```powershell
Start-Process "https://supabase.com/dashboard/project/_/storage/buckets/pdf-templates"
```

ควรเห็น: โฟลเดอร์ `fonts/` `excise/` `wht/` มีไฟล์อยู่ข้างใน

---

## 📇 การเพิ่ม/จัดการผู้ใช้คนอื่น (พนักงานขาย/คลัง/คนดูข้อมูล) — ทำในแอปได้เลย

login เป็นเจ้าของ → เมนู **⚙️ ตั้งค่า** (มุมขวาบน) → หน้า **จัดการผู้ใช้** ทำได้ทั้งหมดโดย**ไม่ต้องแตะ SQL/dashboard**:

- **สร้างผู้ใช้ใหม่**: กรอก username (เช่น `sale1`) + ชื่อแสดงผล + รหัสผ่าน + เลือกสิทธิ์ → กด **สร้าง**
  → พนักงานคนนั้น login ได้ทันทีด้วย username นั้น (ไม่ต้องมีอีเมลจริง ไม่ต้องยืนยันอะไร)
- **เปลี่ยนสิทธิ์**: เลือก role ใหม่จาก dropdown ในแถวนั้น (บันทึกทันที)
- **รีเซ็ตรหัสผ่านให้คนอื่น**: กดปุ่ม **รีเซ็ตรหัส** → พิมพ์รหัสใหม่
- **ลบผู้ใช้**: กดปุ่ม **ลบ** (ลบบัญชีตัวเองไม่ได้ กันล็อกตัวเองออก)

สิทธิ์ (role): `main` เจ้าของ (ทำได้ทุกอย่าง + จัดการผู้ใช้) · `sale` ฝ่ายขาย · `warehouse` คลัง · `viewer` ดูอย่างเดียว

---

## ✅ เช็กลิสต์ Phase 1 (ทำครบทุกข้อ = เสร็จ)

- [ ] ขั้น 1 — ใส่ค่าใน `.env.local` ครบ 3 บรรทัด
- [ ] ขั้น 2 — `npx supabase db push` สำเร็จ + เห็นตารางครบในเว็บ
- [ ] ขั้น 3 — สร้าง user + profile (role main) + entity EID01
- [ ] ขั้น 4 — login เข้าเห็น 4 พื้นที่ทำงาน
- [ ] ขั้น 5 — viewer เขียนไม่ได้ (เห็น error RLS = ผ่าน)
- [ ] ขั้น 6 — อัปโหลด template เข้า Storage สำเร็จ

> โค้ดฝั่งโปรแกรม (`npm run build`, `npm run lint`, `npm run test`) ผมรันผ่านครบแล้ว
> เหลือแค่ 6 ขั้นข้างบนที่ต้องทำบนเครื่อง/บัญชี Supabase ของคุณเอง — ทำเสร็จแล้วบอกผม เริ่ม Phase 2 (แอปผลิต) ต่อได้เลย
