# Go-Live Checklist — สิ่งที่ต้องทำตอนใช้งานจริง (สะสมทุก Phase)

> รวมทุกจุดที่ระบบ "ทำงานถูกต้องแล้ว" แต่ยังต้องให้ผู้ใช้ **กรอกข้อมูลจริง / ตั้งค่าจริง** ก่อนใช้กับงานจริง
> (ตอน dev ใช้ข้อมูลทดสอบ seed — พอ cutover ต้องแทนด้วยของจริง)
> **กติกา:** ทุกครั้งที่จบ phase ให้มาเพิ่มหัวข้อของ phase นั้นที่นี่ (ดู CLAUDE.md › กติกาการทำงาน)
> เช็คช่อง `[ ]` เมื่อทำจริงแล้ว

---

## Phase 1 — Core / Auth / Storage
- [ ] **ผู้ใช้จริง**: สร้างบัญชี login ของทุกคน (หน้า ⚙️ ตั้งค่า) + ตั้ง role ให้ถูก (`main`/`sale`/`warehouse`/`viewer`)
- [ ] **กิจการจริง (`entities`)**: กรอกข้อมูลกิจการจริงทุกราย — `name`, `tax_id` (13 หลัก), `branch`, `address`, `is_vat`
      ```sql
      update entities set name='ชื่อจริง', tax_id='xxxxxxxxxxxxx', address='ที่อยู่จริง', is_vat=true where entity_id='EID01';
      ```
- [ ] **บัญชีเงินจริง (`bank_accounts`)**: ชื่อบัญชี + ยอดยกมา (`opening_balance`, `opening_date`) ให้ตรงจริง
- [ ] **ตั้งค่า (`app_settings`)**: หมวดรายรับ/รายจ่าย, อัตรา WHT, บัญชีในระบบภาษี (`tax_account`) ตามที่ใช้จริง
- [ ] **Storage**: อัปโหลด template ฟอร์ม + ฟอนต์จริงครบ (`npm run upload:templates -- docs/form --include-wh3`)

## Phase 2 — แอปผลิต / ฟอร์ม ภส.
- [ ] **เลขทะเบียนสรรพสามิต (`entities.excise_id`)** ของกิจการโรงสุราจริง (กล่อง 13-1-3 = 17 ตัวเลข บนฟอร์ม ภส.)
      → กรอกในแอปได้เลย: **ตั้งค่า → กิจการ → ช่อง "เลขทะเบียนสรรพสามิต"** (D64 — ไม่ต้องรัน SQL แล้ว)
      · พิมพ์ขีดคั่นได้ตามใบจริง (เช่น `0605567002178-1-001`) ระบบแยกลงช่องให้เอง
- [ ] **Master สินค้าจริง (`products`)**: ชื่อสุรา / ดีกรี / ขนาดขวด / **ประเภทสุรา** (`liquor_type`) / **ชนิดสุรา** (`liquor_kind`)
      — ค่าพวกนี้ขึ้นหัวฟอร์ม ภส. ต้องตรงทะเบียนจริง
- [ ] **Master วัตถุดิบจริง (`materials`)** + ภาชนะ (`containers`) — ชื่อวัตถุดิบต้องตรงเป๊ะ (ใช้ match ตอนบัญชียิงต้นทุนสุรา)
- [ ] **ฟอนต์เลข**: ค่าเริ่มต้น = อารบิก (`THSARABUN.TTF`) · ถ้าต้องการเลขไทยบนฟอร์ม เปลี่ยน `FONT_KEY` ใน `lib/pdf/excise.ts` เป็น `fonts/THSARABUNIT9.TTF`
- [ ] **ยอดยกมาผลิต**: ถ้าเริ่มใช้กลางปี ต้องใส่ log ยอดคงเหลือ ณ วันเริ่ม (วัตถุดิบ/สุราคงเหลือ) ให้รายงานต่อเนื่อง
- [ ] **pg_cron recompute stock** รายสัปดาห์ (ตั้งใน Supabase — ดู migration 0002 หมายเหตุ)
- [ ] **ตรวจ pixel-diff ฟอร์ม ภส.** กับที่เคยยื่นจริงจากระบบเดิม (เดือนที่ยื่นแล้ว) — ตรงทุก mm ก่อนยื่นจริง

## Phase 3 — แอปบัญชี
1. **รัน migration ใหม่**: `npm run db:push` (เพิ่ม `0011_accounting_rpc.sql` + `0012_wht_multientity.sql`
   — RPC บันทึก/แก้/ออก 50ทวิ · 50ทวิ **เลขรันแยกต่อกิจการ** (PK = entity_id+doc_no) + income_seq + แก้ใบย้อนหลัง)
   · จัดการหมวดหมู่/บัญชี/คู่ค้า ได้จากแท็บ **“ตั้งค่า”** ในบัญชี (ไม่ต้องแก้ใน Supabase) · เอกสารสรรพากรอยู่แท็บ
   **“เอกสารสรรพากร”** ในบัญชี
2. ~~**Env สำหรับสแกนใบเสร็จ (A15)**~~ — **ตัดฟีเจอร์ทิ้งแล้ว (D61)** ไม่ต้องตั้ง
   `ANTHROPIC_API_KEY` / `SCAN_DAILY_LIMIT` อีก · ถ้าเคยตั้งไว้ ดูหัวข้อ "หลังอัปเดต D61-D65" ท้ายไฟล์
3. **ตั้งค่าบัญชีจริง (แทน seed ทดสอบ)** — ผ่าน Supabase Table Editor หรือหน้าจัดการ (ถ้ามี):
   - `entities` — กรอก `tax_id`, `branch`, ชื่อจริงของทุกกิจการ (หัวกระดาษ ภพ.30/ภงด./50ทวิ ดึงจากนี่)
   - `bank_accounts` — บัญชีเงินจริง + `entity_ids` + `opening_balance` (ยอดยกมา ณ วันเริ่มใช้)
   - `app_settings` — `tax_account` (ชื่อบัญชีที่อยู่ในระบบภาษี), `expense_cat`/`income_cat`, `wht_rate`
     · หมวด **`ต้นทุนสุรา`** ต้องมีใน expense_cat เพื่อเปิด dropdown วัตถุดิบ + forward เข้าสต็อกผลิต (T6)
   - `contacts` — คู่ค้า/ลูกค้า พร้อม `tax_id`/`branch`/`address` (ใช้ในหัวรายงาน + 50ทวิ)
4. **เทมเพลต 50ทวิ** — ตรวจว่า `wht/wh3_template.pdf` อยู่ใน Storage bucket `pdf-templates` แล้ว
   (อัปโหลดด้วย `npm run upload:templates -- --include-wh3` ถ้ายังไม่มี — ดู Phase 1/D8)
5. **เลข 50ทวิ ต่อเนื่องจากของเดิม** — ถ้าเคยออกเลขปีนี้แล้ว (เช่นถึง 6912) ให้ seed counter ตอน migrate
   (Phase 5) หรือออกใบแรกในระบบใหม่จะเริ่มที่ 6901 → เลขซ้ำ · เลขรูปแบบ `"6901"` (ปี พ.ศ.2หลัก+ลำดับ ไม่มีขีด, ดู D17)
6. **ตรวจ ภพ.30 ยกยอด** — เดือนแรกที่ใช้จริง `forwarded_vat_in` = 0 (ไม่มีเดือนก่อนใน `tax_summaries`)
   ถ้ามียอดยกมาจริงจากระบบเดิม ต้อง insert แถว `tax_summaries` เดือนก่อนหน้าเป็น seed

## Phase 4 — แอปขาย
1. **`supabase db push`** เพื่อรัน migration `20260720000013_sales_rpc.sql` (ขยาย CHECK ของ `app_settings` + RPC ขายทั้งหมด)
2. **ตั้งค่าบัญชี+กิจการรับรายได้ขาย (บังคับก่อนรับเงินออเดอร์)** — ใน Supabase → Table Editor → `app_settings` เพิ่ม 2 แถว:
   - `kind='sales_revenue_entity'`, `value='<entity_id ที่รายได้ขายลง เช่น EID01>'` (ต้องมีจริงใน `entities`)
   - `kind='sales_revenue_account'`, `value='<ชื่อบัญชีรับเงินขาย เช่น กสิกร insep>'` (ตรงกับ `bank_accounts.account_name` เพื่อให้เข้ายอดบัญชี)
   - ⚠️ ถ้าไม่ตั้ง `sales_revenue_entity` → กดรับเงินออเดอร์จะขึ้น error (ตั้งใจกันลืม) · เดิม hardcode "กสิกร insep" (ดู D26)
3. **LINE** (ถ้าใช้แจ้งเตือนขาย/จัดส่ง) — ตั้ง env `LINE_CHANNEL_TOKEN`, `LINE_GROUP_ID` ใน Vercel + `.env.local` (ไม่ตั้ง = ข้ามเงียบ ๆ)
4. **หัวกระดาษเอกสาร B2B** (ใบเสนอราคา/ใบกำกับ) — ตรวจ/แก้ constant `COMPANY` ใน
   `app/(app)/sales/_components/print.ts` (ชื่อบริษัท, เลขภาษี, ที่อยู่, เลขบัญชีธนาคารสำหรับโอน) ให้ตรงข้อมูลจริงล่าสุด
5. **สิทธิ์ (RLS)**: ออเดอร์/ใบเสนอราคา เขียนได้ = role `main`/`sale` · คลัง/ปรับสต็อก = `main`/`warehouse` · ยกเลิกออเดอร์ = `main`
6. **เมนูสินค้า (`sale_menu`)**: ตั้ง `category='สุรา'` + `product_id` ให้ตรง `products` เพื่อให้ตัดสต็อกผลิต + live stock ทำงาน ·
   สินค้าทั่วไปใส่ `product_id` ให้ตรง `warehouse_stock.item_code` ถ้าต้องการตัดสต็อกคลัง · `multiplier` = จำนวนหน่วยย่อยต่อหน่วยขาย (ขวด/ลัง)
7. **seed counters**: ทำอัตโนมัติใน `npm run migrate:import` (Phase 5) — seed `QU-yyMMdd`/`ORD-yyMMdd` จาก max ของ id จริง กันเลขซ้ำ
   · INV/TAX กรอกมือ (ไม่ใช้ counter) · เลข contact เป็น max-based (คำนวณจาก contacts ที่ import ตอนเพิ่มรายใหม่)

## Phase 5 — Migration (ย้ายข้อมูลจริง)

> สคริปต์ย้ายข้อมูลอยู่ใน `migration/` — รันในเครื่อง (ไม่ใช่ Vercel) ด้วย service role
> **ขั้นตอนทั้งหมดทำในเครื่องผู้ใช้** · ข้อมูลจริงอยู่ใน `migration/csv/` (gitignore — ไม่ขึ้น git)

### 5.1 เตรียมก่อนรัน (ทำครั้งเดียว)
1. **วางไฟล์ต้นทาง**: export Google Sheets 3 แอปเป็น `.xlsx` วางที่ `migration/csv/` ชื่อ
   `production.xlsx` · `accounting.xlsx` · `sales.xlsx` (ดู `migration/csv/README.md`)
2. **`.env.local`** ต้องมี `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
   (service role จาก Supabase → Project Settings → API → `service_role` · ⛔ ห้าม commit / ห้ามเข้า client)
3. **`npm run db:push`** เพื่อรัน migration ใหม่ `0014`–`0017`:
   - `0014` migration helpers (`fn_mig_truncate`/`set_triggers`/`recompute` — ให้เฉพาะ service role)
   - `0015` เพิ่ม type `บันทึกภาษี` (ภาษีซื้อนำเข้า) ใน CHECK — ไม่งั้น import แถวพวกนี้จะถูกปฏิเสธ (D29)
   - `0016` คู่ค้าหลายสาขา: คลาย unique index (ชื่อ+สาขา) + `transactions.contact_id` (D30)
   - `0017` recreate RPC `fn_save_transaction`/`fn_save_installments` ให้เก็บ contact_id
4. **สร้าง user ใน Supabase Auth ก่อน** (หน้า `/settings/users` หรือ dashboard) — migration ไม่ย้ายรหัสผ่านเดิม
   (ตาราง `Users`/`inteam`/`salesteam` ข้าม — ดู D27) · role/สิทธิ์ตั้งในหน้าจัดการผู้ใช้

### 5.2 ลำดับการรัน
```bash
npm run migrate:import -- --dry        # 1) ตรวจ+ดู warning ก่อน (ไม่เขียน DB)
npm run migrate:import -- --fresh      # 2) ล้าง+โหลดจริง (rerun ได้เรื่อย ๆ ทับของเดิม)
npm run migrate:reconcile              # 3) เทียบตัวเลข PASS/FAIL
npm run migrate:split                  # 4) (ทางเลือก) เก็บ snapshot CSV รายชีทไว้อ้างอิง
```
- `--fresh` = ล้างตาราง migration ทั้งหมดก่อนโหลด (ไม่แตะ `profiles`/`auth.users`) — ใช้ตอน cutover จริงที่โหลดทับ shadow
- ไม่ใส่ `--fresh` แล้ว DB มีข้อมูลอยู่ → สคริปต์จะเตือนและหยุด (กันเขียนทับโดยไม่ตั้งใจ)

### 5.3 เทียบตัวเลขที่ **สคริปต์ทำไม่ได้ ต้องทำเอง** (sec 7.3)
- **ยอดบัญชีทุกบัญชี**: เปิดหน้าบัญชีระบบใหม่ vs `getAccountBalances` เดิม ณ วันเดียวกัน
- **PDF ราชการเดือนล่าสุดที่ยื่นแล้ว**: gen ภพ.30 + ภส.๐๗-๐๑/๑ + ๐๗-๐๒/๑ + ๐๗-๐๔/๑ จากระบบใหม่ วางเทียบกับที่ยื่นจริง — ตรงทุกช่อง
- reconcile จะพิมพ์ **pivot ยอด transactions ต่อเดือน×กิจการ×ประเภท** ให้เทียบมือกับ pivot ในชีทเดิม

### 5.4 สิ่งที่ migration ตัดสินไว้ (ดู DECISIONS D27/D28 — ถ้าข้อมูลจริงเปลี่ยน ต้องรีวิว)
- **ข้าม**: ชีท POS เก่า (menu/sales/transaction), ฟอร์ม/งบเดือน snapshot, `acc_sync_queue`, `API_Log`, `Scan_Log`, credential — เริ่ม log ใหม่หลัง cutover
- **ลูกค้า**: ยึด `Contacts` เป็น master + ดึงเฉพาะลูกค้าที่ออเดอร์อ้างแต่ยังไม่มี (โอชาฟูดแพ็ค) จาก `custdata` · remap `btbcustID (C001…)` → `contacts.contact_id`
- **contact_id ซ้ำ** (C-0008/C-0009 ในชีท) → reassign เลขใหม่เหนือ max อัตโนมัติ
- **counters** seed จาก max ของ id จริง: `TR-yyyymmdd`, `TRF-yyyymmdd`, `QU-yyMMdd`, `ORD-yyMMdd` · เลข 50ทวิ (doc_no) + contact เป็น max-based (คำนวณจากที่ import ตอนออกใบถัดไป — ไม่ต้อง seed)
- ⚠️ ถ้า reconcile ฟ้อง **stock ไม่ตรง**: รัน `runRecomputeStock` ฝั่ง GAS เดิมก่อน แล้ว export ใหม่/เทียบใหม่ (แยกว่า sheet เพี้ยนเองหรือ import ผิด)

### 5.5 Rollback (ถ้าตัดสินใจถอย — sec 8.3)
- `npm run migrate:export` → ดึงข้อมูลที่คีย์ในระบบใหม่กลับเป็น CSV ที่ `migration/export/` (gitignore) เพื่อวางกลับชีทเดิม
- GAS เดิมไม่ถูกแตะ → เปิดชีทกลับ editable + ถอด banner = กลับไปใช้ระบบเดิมได้ในไม่กี่นาที

## Phase 6 — Cutover
_(ข้ามตามที่ผู้ใช้ตัดสินใจ — ไป go-live ตรง)_

## Multi-tenant (D46-D48 · migration 0025-0032) — ต้องทำตอน setup จริง

### ก. ย้าย DB production ตามโค้ดใหม่ (ยังไม่ทำ — ดู `docs/NEXT_STEPS.md` 4.10)
- [ ] จับ snapshot / backup DB production **ก่อน**
- [ ] `supabase link` กลับไป project เดิม → ยืนยัน `cat supabase/.temp/project-ref`
      = `vmhiwlxdyhatucioalzp` (ไม่ใช่ project ทดสอบ)
- [ ] `npm run db:push` (0025-0032) — ข้อมูลเดิมทั้งหมดกลายเป็น tenant เดียวอัตโนมัติ
- [ ] `cp .env.local.production-backup .env.local` แล้ว `npm run dev` ตรวจว่าทุกอย่างเหมือนเดิม
- [ ] **ยืนยันว่าล็อกอินด้วยบัญชีเดิมได้** (รูปแบบอีเมล `<username>@insep.local` ไม่เปลี่ยน แต่ต้องพิสูจน์)
- [ ] merge `feat/multi-tenant` → `main` → push (= deploy production)

### ข. ตอนรับลูกค้าใหม่แต่ละราย
- [ ] สร้าง tenant + entity + ผู้ใช้ (ตอนนี้ใช้ `npm run seed:demo-tenant` ไปก่อน —
      provision script จริงอยู่ในงาน 4.5)
- [ ] **รหัสตั้งต้นต้องสุ่มไม่ซ้ำต่อราย** — `generateInitialPassword()` ทำให้แล้ว
      🚨 ห้ามตั้งรหัสเดียวกันให้ทุกเจ้าเด็ดขาด (ลูกค้าจะล็อกอินเข้าระบบกันเองได้ตั้งแต่วันแรก)
- [ ] ผู้ใช้ใหม่จะถูกบังคับเปลี่ยนรหัสตอนล็อกอินครั้งแรกอัตโนมัติ (0031) — บอกลูกค้าไว้ล่วงหน้า
- [ ] **ชื่อผู้ใช้ห้ามซ้ำกับลูกค้าเจ้าอื่น** (0032) — ถ้าชนจะขึ้นข้อความให้เติมชื่อโรงต่อท้าย
- [ ] ตั้งแบรนด์ใน `app_settings` (`brand_name`/`brand_color`/`logo_url`) — **ไม่ใช่ที่ตาราง `tenants`**
      (D47 ลบคอลัมน์นั้นทิ้งแล้วเพื่อไม่ให้มี 2 แหล่ง)
- [ ] ถ้าลูกค้าต้องการ **กิจการที่ 2** (add-on) — สร้าง `entities` ให้ผ่าน service role เท่านั้น
      ลูกค้าสร้างเองไม่ได้โดยตั้งใจ (RLS เปิดแค่ update)

### ค. 🚨 ก่อนรับเงินลูกค้ารายแรก
- [ ] **ทำ MFA ให้เสร็จ** (`docs/NEXT_STEPS.md` 4.0.1) — ถ้ารู้ชื่อผู้ใช้ของอีกเจ้า
      + รหัสผ่านบังเอิญตรงกัน ยังเข้าข้ามกันได้ · ปิดได้ด้วย MFA เท่านั้น
- [ ] Vercel: ใช้ **แผน Pro** (Hobby ห้ามใช้เชิงพาณิชย์) · ทีมเดียว project ไม่จำกัด
- [ ] ตั้ง wildcard domain `*.<โดเมนเรา>` ถ้าจะให้ลูกค้าเข้าผ่าน subdomain ของตัวเอง
      + ตั้ง `NEXT_PUBLIC_ROOT_DOMAIN` ให้ตรง
- [ ] เชิญบัญชี Supabase เดิมเข้า organization ของบัญชีใหม่ → ล็อกอิน CLI ครั้งเดียวเห็นทุก project
      (จำเป็นตอนต้องรัน migration ทุก DB ต่อ release — `docs/NEXT_STEPS.md` 4.9)

## 🚀 Deployment / Go-Live (ทำจริงแล้ว 2026-07-27)

- [x] **โค้ดขึ้น GitHub** — commit ทั้ง repo + push `main` → `github.com/eiei-eiei-eiei/insep-erp`
- [x] **อัป Next.js 15.1.6 → 15.5.22** (Vercel บล็อก deploy เวอร์ชันมีช่องโหว่) · build/lint/test 167 ผ่าน
- [x] **Deploy Vercel production** — โปรเจกต์ `eieieiei/insep-erp` · **URL: https://insep-erp.vercel.app** · login 200 + anon key ต่อ Supabase auth 200
- [x] **ตั้ง env ใน Vercel** (production/preview/development): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SCAN_DAILY_LIMIT`, `DEFAULT_ENTITY_ID=EID01`, `LIQUOR_ENTITY_ID=EID01`
  - ⚠️ **บทเรียน**: `.env.local` มี inline comment (` # ...`) ต่อท้าย 3 ค่า (anon/service/anthropic) — รอบแรก push ทั้ง comment ทำให้ key เสีย ต้อง re-push แบบตัด comment (dotenv ตัดให้เองตอน dev แต่สคริปต์ต้องตัดเอง)
- [x] **ข้อมูลจริงใน Supabase ยืนยันครบ**: transactions 468 / items 725 / sales_orders 7 / log_distill 29 / contacts 35 / products 10 / entities 2 · ข้อมูลทดสอบสะอาดแล้ว (EID99=0)

### ค่าที่ต้องตั้งหลัง go-live — ✅ **ผู้ใช้ยืนยันครบแล้ว (2026-08-02)**
- [x] **`entities.excise_id` (EID01)** — กรอกเลขทะเบียนสรรพสามิต 17 หลักจริงแล้ว
- [x] **`app_settings` `sales_revenue_entity`/`sales_revenue_account`** — ตั้งแล้ว
- [~] **`bank_accounts.opening_balance` = 0 ทุกบัญชี** — **จงใจไม่ใส่** (ตัดสินโดยผู้ใช้ 2026-08-02)
      เหตุผล: ใน `transactions` มีรายการนำเงินเข้าบัญชีตั้งแต่ต้นอยู่แล้ว → ใส่ยอดยกมาอีกจะ **นับซ้ำ**
      ⚠️ ห้ามมีใครมาเติมทีหลังเพราะเห็นเป็น 0 แล้วคิดว่าลืม
- [~] ~~**`ANTHROPIC_API_KEY`**~~ — **เลิกใช้แล้ว (D61)** ต้องลบออกจาก Vercel + revoke key (ดูท้ายไฟล์)
- [x] **`LINE_CHANNEL_TOKEN`/`LINE_GROUP_ID`** — ตั้งแล้ว
- [x] **GitHub auto-deploy เชื่อมแล้ว** — push ขึ้น `main` แล้ว Vercel deploy ต่อเอง **ไม่ต้อง `vercel --prod` แล้ว**
- [x] **ล็อกอินจริง** ที่ https://insep-erp.vercel.app แล้วตรวจแต่ละแอป

### แอปผลิต — ลบ batch หมัก (D41)
- [x] **`npm run db:push` apply migration `0020_delete_ferment.sql`** (fn_delete_ferment_batch) *(apply แล้ว)* — ต้องรันก่อนปุ่มลบ batch หมักในแท็บลงหมักจะทำงาน (ไม่งั้น error `function ... does not exist`)

### ปิดงานรีวิว D42 — multi-branch + กระดาน batch + PWA (2026-08-01)
- [x] **`npm run db:push` apply migration `0021_multibranch_and_quotation_terms.sql`** *(apply แล้ว)* — ถ้ายังไม่รัน:
  - กดออก 50ทวิ จะ error (`fn_issue_wht` เปลี่ยน signature — รับ `p_contact_id` เพิ่ม)
  - สร้าง/แก้ใบเสนอราคาจะ error (คอลัมน์ `is_deposit`/`deposit_percent` ยังไม่มี)
  - `getOrders` จะ error (select คอลัมน์ใหม่)
  - migration นี้ทำ **backfill อัตโนมัติ** ให้ด้วย: เติม `contact_id` ให้รายรับขายเดิม (จาก `sales_orders.customer_id`)
    และให้ใบ 50ทวิ เก่าที่ชื่อคู่ค้าตรงกับ contact **รายเดียว** (ชื่อซ้ำหลายสาขา = ปล่อยว่าง ไม่เดา)
- [ ] **ตรวจใบ 50ทวิ เก่าที่ backfill ไม่ได้** (คู่ค้าชื่อซ้ำหลายสาขา): ถ้ามีและต้องพิมพ์ซ้ำ ให้ใส่ `contact_id` เองใน
      Supabase → ตาราง `wht_certificates` (คอลัมน์ `contact_id`) ให้ตรงสาขาที่ออกใบจริง
      · ตรวจด้วย: `select doc_no, contact_name from wht_certificates where contact_id is null;`
- [ ] **ตรวจรายรับขายเดิมที่ยังไม่มี contact_id** (ถ้ามี): `select tx_id, contact_name from transactions where source='sales' and contact_id is null;`
      — ถ้าคู่ค้ารายนั้นมีสาขาเดียวก็ไม่มีผล (fallback ชื่อได้ถูกอยู่แล้ว) · มีหลายสาขาเมื่อไหร่ค่อยเติม
- ℹ️ **ไม่ต้องตั้งค่าเพิ่ม**: กระดาน batch · checklist รายงาน · ฟอนต์ไทย (self-host ตอน build) · PWA (ติดตั้งลงโฮมสกรีนได้เลย
      — บนมือถือเปิดเว็บแล้วเลือก "เพิ่มไปยังหน้าจอโฮม") · error page ภาษาไทย

### หน้าตาใหม่ + แบรนด์ D43 (2026-08-01)
- [x] **`npm run db:push` apply migration `0022_branding.sql`** *(apply แล้ว 2026-08-02)* — เพิ่มชนิดค่า `brand_name`/`brand_color`/`logo_url`/`default_mode`
      ใน `app_settings` · migration ใส่ค่าเริ่มต้นให้เอง (ชื่อ "Insep ERP" · สีเหล็ก · โหมดสว่าง)
      ยังไม่รัน = บันทึกแบรนด์จากแท็บตั้งค่าจะ error (CHECK constraint ไม่รู้จัก kind ใหม่)
- [ ] **ตั้งแบรนด์ของกิจการ**: บัญชี → แท็บ **ตั้งค่า** → การ์ด **"แบรนด์ของกิจการ"**
      — ชื่อที่แสดงบนแถบเมนู · สีแบรนด์ (7 ชุด) · โหมดเริ่มต้น (สว่าง/มืด) · ลิงก์โลโก้ (ไม่ใส่ = ใช้ตัวอักษรแรกของชื่อ)
- [ ] **ลองสลับโหมดสว่าง/มืด** ที่ปุ่มรูปพระอาทิตย์/พระจันทร์ มุมขวาบน — ค่าจำไว้ในเบราว์เซอร์นั้น (cookie 1 ปี)
- [ ] **ตรวจเอกสารพิมพ์**: เปิดโหมดมืดแล้วสั่งพิมพ์ใบกำกับ/ภพ.30/ฟอร์ม ภส. — **ต้องยังเป็นดำบนขาว**
      (ตั้งใจไม่ให้เอกสารพิมพ์ตามธีมหน้าจอ) · ถ้าพื้นออกมาดำแปลว่ามีบั๊ก ให้แจ้ง
- ℹ️ **โลโก้**: ตอนนี้ใส่เป็น "ลิงก์" (วาง URL รูป) ยังไม่มีปุ่มอัปโหลด — ถ้าจะใช้ ให้อัปไฟล์ขึ้น Supabase Storage
      แล้ววาง public URL · แนะนำ .svg หรือ .png พื้นโปร่ง สูงประมาณ 64px

### ข้อมูลผู้ขายบนเอกสารการค้า (D44 — 2026-08-02) — ✅ ผู้ใช้แจ้งว่าทดสอบผ่านแล้ว
- [x] **`npm run db:push` apply migration `0023_entity_doc_info.sql`** — เพิ่มคอลัมน์ `name_eng`/`phone`/`bank_line`
      ในตาราง `entities` + ชนิดค่า `sales_doc_entity` ใน `app_settings`
      ⚠️ **ยังไม่รัน = หน้าขายเปิดไม่ขึ้น** (โค้ดใหม่ select คอลัมน์ที่ยังไม่มี) — ต้องรันก่อน deploy/เปิดหน้าขาย
- [ ] **กรอกข้อมูลบนเอกสาร**: บัญชี → แท็บ **ตั้งค่า** → การ์ด **"ข้อมูลบนเอกสารการค้า"**
      1. เลือก **กิจการที่ใช้ออกเอกสาร** (ถ้ามีหลายนิติบุคคล ต้องเลือกเอง ระบบไม่เดาให้)
      2. กรอก: ชื่อไทย · ชื่ออังกฤษ · สาขา · ที่อยู่ · เลขประจำตัวผู้เสียภาษี · เบอร์โทร · ช่องทางการโอนเงิน
      3. ดู **ตัวอย่างหัวกระดาษ** ใต้ฟอร์มให้ตรงกับเอกสารที่เคยพิมพ์ (เทียบกับใบเก่าที่พิมพ์ไว้ ทีละบรรทัด)
      4. กดบันทึก
      ℹ️ ค่าที่เคยฝังในโค้ด: ที่อยู่ต่อท้ายสาขาในวงเล็บ (`(สำนักงานใหญ่) …`) · บรรทัดเลขภาษีมีเบอร์โทรต่อท้ายด้วย ` | โทร: …`
      · **ช่องที่อยู่ไม่ต้องพิมพ์คำว่า "สำนักงานใหญ่"** — ระบบเติมวงเล็บให้จากช่องสาขา (ถ้าเห็นซ้ำในตัวอย่าง ให้ลบออกจากช่องที่อยู่)
      · ช่องทางการโอนเงินขึ้นบรรทัดใหม่ได้ (บรรทัด 1 = ธนาคาร+เลขบัญชี · บรรทัด 2 = ชื่อบัญชี)
- [ ] **พิมพ์เทียบของจริง**: พิมพ์ใบเสนอราคา + ใบกำกับภาษี/ใบเสร็จ ของออเดอร์เก่า 1 ใบ
      วางทับกับใบที่เคยพิมพ์จากระบบเดิม — **หัวกระดาษต้องตรงทุกบรรทัด ไม่ขยับ**
- ℹ️ ยังไม่กรอก/ยังไม่เลือกกิจการ → กดพิมพ์แล้วขึ้นเตือนให้ไปตั้งค่า (ตั้งใจ — ดีกว่าพิมพ์หัวกระดาษเปล่า)

### ปรับ UX แอปบัญชี (D35 — หน้าบันทึก/แดชบอร์ด/ค้นบิล)
- [x] **apply migration `0019_edit_transaction.sql`** ด้วย `npm run db:push` (2026-07-29 — CLI ใช้ได้แล้ว ไม่ต้องผ่าน dashboard)
      — สร้างฟังก์ชัน `fn_edit_transaction` · จำเป็นสำหรับปุ่ม "แก้ไข" ในหน้าค้นบิล
- ℹ️ อื่น ๆ ทำงานได้ทันทีหลัง deploy (ไม่ต้องตั้งค่าเพิ่ม): combobox หมวดหมู่, VAT ออโต้ตามเลขใบกำกับ, บิลล่าสุดของคู่ค้า,
      ดรอปดาวน์รายการจากประวัติ, ค้างร่าง localStorage, เลขภาษี 13 หลัก, แดชบอร์ดยอดสุทธิ

---

## แจ้งเตือน LINE ต่อกิจการ (0033 · D51) — **ต้องทำ ไม่งั้นแจ้งเตือนเงียบ**

โค้ดเลิกอ่าน `LINE_CHANNEL_TOKEN` / `LINE_GROUP_ID` จาก env แล้ว — ย้ายไปเก็บต่อกิจการใน `app_settings`
(ของเดิมทำให้ลูกค้าทุกเจ้าใน deployment เดียวกันยิงเข้ากลุ่มเดียวกันหมด = เห็นออเดอร์กัน)

- [ ] **apply migration** `npm run db:push` (0033) — ยังไม่รัน = บันทึกค่าใหม่ไม่ได้ (ติด CHECK constraint)
- [ ] **ก๊อปค่าเดิมจาก Vercel**: Vercel → Project → Settings → Environment Variables
      คัดลอกค่า `LINE_CHANNEL_TOKEN` และ `LINE_GROUP_ID` เก็บไว้ก่อน
- [ ] **กรอกในแอป**: บัญชี → แท็บ **ตั้งค่า** → การ์ด **"แจ้งเตือน LINE"** → วางทั้ง 2 ค่า → บันทึก
      (การ์ดนี้ขึ้นเฉพาะ role `main` — พนักงานคนอื่นอ่านโทเคนไม่ได้ บังคับที่ RLS ไม่ใช่แค่ซ่อนหน้าจอ)
- [ ] **ทดสอบ**: สร้างใบเสนอราคา 1 ใบ → ต้องมีข้อความเข้ากลุ่ม LINE เดิม
- [ ] **ลบ env ทิ้ง**: Vercel → ลบ `LINE_CHANNEL_TOKEN` + `LINE_GROUP_ID` (ไม่มีโค้ดอ่านแล้ว)
      แล้ว redeploy — เก็บไว้เฉย ๆ ไม่ได้ทำอะไร แต่เป็นกุญแจที่ไม่ควรค้างอยู่

> ⚠️ **ช่วงที่ยังกรอกไม่เสร็จ แจ้งเตือนจะเงียบสนิท** — ไม่ error ไม่กระทบการบันทึกข้อมูล
> (silent fail ตามกติกาเดิม) แต่ต้องรู้ตัวว่าเงียบเพราะยังไม่ตั้งค่า ไม่ใช่เพราะพัง
> 🚨 **จงใจไม่ทำ fallback ไป env** — fallback คือตัวบั๊กเอง: กิจการที่ยังไม่ตั้งค่าจะไปยิงเข้ากลุ่มของ env

---

## ตั้งแอปจัดการหลังบ้าน (D54 · migration 0035) — ทำครั้งเดียว

> หลังทำครบข้อนี้ งาน "รับลูกค้าใหม่ / เปลี่ยนแพ็กเกจ / เพิ่มกิจการ / รีเซ็ตรหัสลูกค้า"
> ทำจากหน้าจอได้หมด **ไม่ต้องเปิด terminal และไม่ต้องเขียน SQL อีก**

- [ ] `npm run db:push` (0035) — ต้องรันกับ **DB แพลตฟอร์มลูกค้า** (`tnuxrufpzeyuvwdmkojv`)
      · เช็คก่อนเสมอว่า link อยู่ที่ไหน: `cat supabase/.temp/project-ref`
- [ ] **สร้างบัญชีแอดมิน** (สคริปต์เดียวที่ยังต้องรันใน terminal — เป็นการ bootstrap ตัวเอง):
      ```
      npm run platform:grant-admin -- --env=.env.local --username=platformadmin --create
      ```
      · ⚠️ **รหัสชั่วคราวพิมพ์ครั้งเดียว** — ก๊อปเก็บทันที
      · ถ้ามีบัญชีอยู่แล้วใน DB นั้น ไม่ต้องใส่ `--create` (จะให้สิทธิ์บัญชีเดิม)
      · ถอนสิทธิ์ทีหลัง: ใส่ `--revoke` แทน `--create`
- [ ] **สร้าง Vercel project ของแอดมิน** (repo เดิม branch `main` เดิม — Vercel สร้างหลาย project
      จาก repo เดียวได้) ตั้งชื่อเช่น `insep-admin` · env ชี้ **DB แพลตฟอร์มลูกค้า**
      (ค่าเอาจาก `.env.local.testing-backup`) แล้วเพิ่ม
      ```
      PLATFORM_ADMIN=1
      ```
      · โครงสร้าง deployment ทั้งหมด (3 project) ดู `docs/NEXT_STEPS.md` ข้อ 10.1
- [ ] **เปิด Deployment Protection (Password) ที่ project แอดมิน** — Settings → Deployment Protection
      ล็อกชั้นนอกที่ไม่กระทบลูกค้า · เป็นตัวชดเชยที่ตรงจุดที่สุดของการตัด MFA ทิ้ง (D52)
      · 🚨 **ห้ามตั้งค่านี้ใน project ที่ลูกค้าใช้** — ตั้งเมื่อไหร่ลูกค้าจะเห็นหน้า `/platform`
        (ยังเข้าไม่ได้เพราะไม่มีชื่อใน `platform_admins` แต่ไม่ควรให้เห็นตั้งแต่แรก)
      · ไม่ตั้ง = `/platform` ตอบ **404** เหมือนไม่มีหน้านี้อยู่จริง
- [ ] ล็อกอินด้วยบัญชีแอดมิน → ตั้งรหัสใหม่ → เข้า `/platform` (ระบบพาไปให้เองหลังล็อกอิน)
- [ ] ตรวจว่า project ของลูกค้า **เปิด `/platform` แล้วได้ 404 จริง**

---

## รับลูกค้าใหม่ 1 ราย — ✅ ทำจากแอปจัดการหลังบ้านได้แล้ว (D54)

> ขั้นตอนแบบ terminal ด้านล่างยังใช้ได้อยู่ (เป็นทางสำรอง) แต่**ทางปกติคือกดจากหน้าจอ**:
> `/platform` → ปุ่ม **“รับลูกค้าใหม่”** → กรอก ชื่อย่อ/ชื่อกิจการ/สีแบรนด์/โมดูล/โควตา → สร้าง
> → **ก๊อปรหัสชั่วคราวจากแผงสีเหลืองทันที** (แสดงครั้งเดียว ปิดแล้วต้องรีเซ็ตใหม่)
>
> - เปลี่ยนแพ็กเกจ (เปิด/ปิดโมดูล) · ขยายโควตา · เพิ่มกิจการ · รีเซ็ตรหัสผู้ใช้ของลูกค้า
>   → กด **“จัดการ”** ท้ายแถวของลูกค้ารายนั้น
> - **ขยายโควตา** กับ **เพิ่มกิจการ** เป็นคนละปุ่มโดยตั้งใจ — การอนุมัติว่าลูกค้าจ่ายค่า add-on แล้ว
>   กับการสร้างกิจการ ต้องเป็นคนละการตัดสินใจ (D53)
> - ✅ **ตั้งค่างวดให้ลูกค้าใหม่ทันทีหลังสร้าง** (แท็บ **ค่างวด** → กล่องเหลือง "ยังไม่ได้ตั้งค่างวด"
>   → ปุ่มลัด) — ไม่ตั้ง = ระบบไม่รู้ว่าถึงกำหนดเก็บเงินเมื่อไหร่ และลูกค้าไม่ถูกเตือนในแอป
>   · **วันเริ่มใช้บริการ = วันตัดรอบตลอดอายุลูกค้า** ใส่ให้ตรงกับที่ตกลงกันจริง
> - ✅ **ระงับลูกค้าค้างจ่ายได้แล้ว** (D59) — แท็บค่างวด → จัดการ → "ระงับการใช้งาน"
>   · ลูกค้าเห็นหน้าแจ้งให้ติดต่อผู้ดูแล **ข้อมูลไม่ถูกลบ** · คืนสิทธิ์แล้วใช้ได้ทันที
> - ⚠️ **ลูกค้าจะถูกเตือนในแอปเองก่อนครบกำหนด 3 วัน** → ถ้าลูกค้าโอนแล้วแต่ยังไม่ได้กดบันทึก
>   เขาจะโดนเตือนทั้งที่จ่ายแล้ว · **กดบันทึกให้ไวหลังเงินเข้า** หรือปิดการเตือนรายลูกค้าที่จ่ายแบบวางบิล

### ขั้นตอนแบบ terminal (ทางสำรอง · D53 · migration 0034)

- [ ] `npm run db:push` (0034) ให้ครบทั้ง DB จริงและ project ลูกค้า
- [ ] **สร้างลูกค้า** — ชี้ `--env` ไปไฟล์ env ของ project ที่ลูกค้าจะอยู่:
      ```
      npm run provision:tenant -- --env=.env.local --slug=rongsomchai \
        --name="โรงกลั่นสมชาย" --color=copper --modules=production,accounting,sales --max-entities=1
      ```
      · `--modules` = SKU ที่ลูกค้าซื้อ (production / accounting / sales เลือกผสมได้)
      · ⚠️ **รหัสผ่านชั่วคราวพิมพ์ครั้งเดียว ไม่มีทางสั่งพิมพ์ซ้ำ** — ก๊อปเก็บทันทีก่อนปิด terminal
      · ได้ระบบเปล่า ไม่มีข้อมูลตัวอย่างติดมา (ต่างจาก `seed:demo-tenant` ที่ใส่ข้อมูลทดสอบให้)
- [ ] ส่งชื่อผู้ใช้ + รหัสชั่วคราวให้ลูกค้า — ระบบบังคับให้ตั้งรหัสใหม่เองตอนล็อกอินครั้งแรก
- [ ] **ลูกค้าต้องตั้งเองหลังเข้าระบบ**: ข้อมูลบนเอกสารการค้า · `entities.excise_id` · แจ้งเตือน LINE
- [ ] **ขาย add-on กิจการที่ 2** (฿390–590/เดือน) — เก็บเงินก่อน แล้วค่อย:
      1. ขยายโควตาใน Supabase Dashboard → SQL Editor:
         `update tenants set max_entities = 2 where slug = 'rongsomchai';`
      2. `npm run provision:add-entity -- --env=.env.local --slug=rongsomchai --entity=EID02 --name="..."`
      · สคริปต์**ปฏิเสธเองถ้าโควตาไม่พอ** — จงใจไม่ให้ขยายโควตาอัตโนมัติ
        (การเพิ่มกิจการกับการอนุมัติว่าจ่ายเงินแล้ว ต้องเป็นคนละการตัดสินใจ)
- [ ] **เปลี่ยนแพ็กเกจทีหลัง** (ลูกค้าซื้อโมดูลเพิ่ม) — SQL Editor:
      `update tenants set modules_enabled = '{production,accounting,sales}' where slug = '...';`
      · ลูกค้าเห็นเมนูใหม่ทันทีที่รีเฟรช · **ลูกค้าแก้ค่านี้เองไม่ได้** (ตาราง `tenants` ไม่มี policy update)

> ⚠️ **กิจการที่ไม่จด VAT ยังใช้ไม่ได้จริง** — งาน 4.3 ยังไม่ทำ ระบบยังคิด VAT 7% ทุกกิจการ
> และยังออกใบกำกับภาษีได้ ซึ่ง**ผิดกฎหมายถ้ากิจการไม่จด VAT** · `add-entity.ts` เตือนตอนใช้ `--no-vat` แล้ว

---

## กิจการที่ไม่จดทะเบียน VAT (D55 · migration 0036)

- [ ] `npm run db:push` (0036) ทั้ง DB จริงและ project ลูกค้า
- [ ] ตั้ง `entities.is_vat = false` ให้กิจการนั้น (สร้างใหม่ใช้ `--no-vat` · ของเดิมแก้ที่ Supabase Dashboard)
- [ ] **ตรวจว่า `sales_doc_entity` กับ `sales_revenue_entity` มีสถานะ VAT ตรงกัน**
      (บัญชี → ตั้งค่า) ไม่ตรง = กดบันทึกใบเสนอราคาไม่ได้ ระบบจะเตือนให้ไปแก้ก่อน
- [ ] เทสตาม `docs/TESTING.md` ส่วนที่ 30 — **โดยเฉพาะข้อ 1** (กิจการที่จด VAT ต้องไม่ขยับ)

> ⚠️ **ระบบบล็อกที่ฐานข้อมูล**: กิจการที่ `is_vat = false` จะบันทึกรายการที่มี VAT ไม่ได้
> และออกเลขใบกำกับภาษีไม่ได้ **ต่อให้ยิงผ่าน API ตรง** (ผู้ไม่จด VAT ออกใบกำกับภาษี = ผิด ม.86/13)
> · ถ้าลูกค้าจดทะเบียน VAT ภายหลัง → แก้ `is_vat = true` แล้วใช้ได้ทันที ไม่ต้อง deploy

---

## ตั้ง `db:push:all` — ลง migration ทุก DB ในคำสั่งเดียว (D57) · ทำครั้งเดียว

ทำครั้งเดียวจบ หลังจากนั้นทุก migration ใหม่ใช้คำสั่งเดียว ไม่ต้อง `supabase link` สลับไปมาอีก

- [ ] ก๊อป `supabase/targets.example.json` → `supabase/targets.json`
- [ ] **หา connection string ของแต่ละ DB**: Supabase Dashboard → เลือก project →
      ปุ่ม **Connect** ด้านบน → แท็บ **Connection String** → เลือก **Session pooler**
      → ก๊อป URI มาใส่ช่อง `dbUrl`
- [ ] แทน `[YOUR-PASSWORD]` ด้วยรหัสผ่าน DB จริง (คนละตัวกับรหัสล็อกอิน Supabase —
      ถ้าจำไม่ได้: Settings → Database → **Reset database password**)
      ⚠️ รหัสมีอักขระพิเศษ (`@ / : # ?`) ต้องแปลงเป็น percent-encoding
      → ตั้งรหัสเป็น **ตัวอักษรกับตัวเลขล้วน** ง่ายกว่ามาก
- [ ] `npm run db:push:all` (โหมดดูอย่างเดียว) — ต้องขึ้น ✅ ทุกก้อน ไม่มี ⚠️
- [ ] ต่อไปเวลาลงจริง: `npm run db:push:all -- --apply --backup="D:/insep-erp-backup/<วันที่>"`

> 🚨 `supabase/targets.json` **มีรหัสผ่าน DB อยู่ข้างใน** — `.gitignore` กันไว้แล้ว
> แต่ถ้าย้ายเครื่อง/ก๊อปโฟลเดอร์ ต้องระวังไม่ให้ไฟล์นี้หลุดไปกับ zip
>
> ✅ สคริปต์จะ**หยุดก่อนแตะ DB** ถ้าไฟล์ env กับ connection string ชี้คนละ project
> (กันเคสก๊อปผิดก้อน = migration ลูกค้าลงใน DB ธุรกิจตัวเอง)

---

## กัน DB แผนฟรีหลับ (D60 · migration 0038) · ทำครั้งเดียว

> แผนฟรี pause โปรเจกต์ที่ไม่มีกิจกรรมใน **7 วัน** · โดนแล้วแอปล่มและ**ต้องกด Restore เองใน dashboard**
> → ปิงวันละครั้งจาก 2 ชั้น: GitHub Actions (หลัก) + Task Scheduler ในเครื่อง (สำรอง)

**ขั้นที่ 1 — ลงฟังก์ชัน `ping()` ให้ทุก DB**
- [ ] `npm run db:push:all` (ดูก่อน — ต้องเห็น `0038_ping` ค้างอยู่ทุกก้อน)
- [ ] `npm run db:push:all -- --apply`
- [ ] `npm run db:ping:all` → ต้องขึ้น ✅ ทุกก้อน พร้อมเวลาใน DB

**ขั้นที่ 2 — เปิดชั้นหลัก (GitHub Actions)**
- [ ] `git add -A && git commit && git push` (workflow กับ `supabase/fleet.json` ต้องขึ้น git ก่อนถึงจะทำงาน)
- [ ] GitHub → repo → แท็บ **Actions** → เลือก **keep Supabase awake** → ปุ่ม **Run workflow** →
      รอ ~1 นาที ต้องขึ้นติ๊กเขียว (กดเข้าไปดู log ควรเห็น ✅ ทุกก้อน)
- [ ] ตรวจว่าจะได้รับเมลเวลาพัง: GitHub → รูปโปรไฟล์ → Settings → **Notifications** →
      หัวข้อ **Actions** → ติ๊ก **Send notifications for failed workflows only** (+ ใส่อีเมลที่อ่านจริง)
- [ ] ตรวจว่าอีเมลของ **ทั้ง 2 แอคเคาท์ Supabase** (D58) เข้าเมลที่คุณอ่าน — Supabase ส่งเตือน
      ล่วงหน้า ~1 สัปดาห์ก่อน pause ซึ่งเป็นตะแกรงชั้นสุดท้าย

**ขั้นที่ 3 — เปิดชั้นสำรอง (Windows Task Scheduler)** · วางทั้งก้อนใน PowerShell
- [ ] ```powershell
      $act = New-ScheduledTaskAction -Execute "C:\Program Files\nodejs\npm.cmd" -Argument "run db:ping:all -- --notify" -WorkingDirectory "D:\insep-erp"
      $trg = New-ScheduledTaskTrigger -Daily -At 20:30
      $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
      Register-ScheduledTask -TaskName "PROOF - ping Supabase" -Action $act -Trigger $trg -Settings $set -Description "กัน Supabase แผนฟรีหลับ (ชั้นสำรองของ GitHub Actions) - D60"
      ```
- [ ] ทดสอบเดี๋ยวนั้น: `Start-ScheduledTask -TaskName "PROOF - ping Supabase"` แล้วเปิดดู `logs\ping.log`
      → ต้องมีบรรทัดใหม่ขึ้นท้ายไฟล์ว่า `OK`
- [ ] ลบทิ้งเมื่อไม่ใช้: `Unregister-ScheduledTask -TaskName "PROOF - ping Supabase" -Confirm:$false`

> `StartWhenAvailable` = ถ้าเครื่องปิด/หลับตอน 20:30 มันจะ**ยิงชดเชยให้เองหลังเปิดเครื่อง** ·
> `WakeToRun` (ปลุกเครื่องมายิง) ตั้งให้แล้วแต่ **อย่าพึ่งพา** — นโยบายพลังงาน/Modern Standby/แบต
> ทำให้ไม่ชัวร์ · จะมีหน้าต่างดำแวบ ~2 วินาที และ**เด้งหน้าต่างเตือนเฉพาะตอนปิงไม่ผ่าน**

**🪤 ทุกครั้งที่รับลูกค้าที่แยก DB (ทำ 4 ขั้นนี้ให้ครบ)**
- [ ] เติมบล็อกใหม่ใน `supabase/targets.json`
- [ ] `npm run db:push:all -- --apply` (DB ใหม่ต้องมี `ping()` ด้วย)
- [ ] `npm run fleet:sync` แล้ว `git add supabase/fleet.json && git commit && git push`
      ← **ลืมข้อนี้ = DB ลูกค้าหลับใน 7 วัน** · `db:push:all` จะขึ้น ⚠️ เตือนให้ถ้าลืม
- [ ] สร้าง Vercel project + ตั้ง env (NEXT_STEPS 10.1) — ไม่เกี่ยวกับการปิง

**🪤 ถ้าหยุดพัฒนายาว ๆ**: GitHub ปิด scheduled workflow เองเมื่อ repo ไม่มี commit **60 วัน**
(มีเมลเตือนก่อน) → เข้าแท็บ Actions กด enable ใหม่ · ระหว่างนั้นชั้นสำรองในเครื่องยังทำงานอยู่

> **ทางออกจริงคืออัป Supabase เป็น Pro** — โปรเจกต์แบบจ่ายเงินไม่ถูก pause เลย
> วันนั้นลบ workflow + task ทิ้งได้ (ฟังก์ชัน `ping()` เก็บไว้ได้ ไม่มีผลข้างเคียง)

---

## หมายเหตุถาวร
- ข้อมูลทดสอบทั้งหมดใช้ marker `EID99` / `T-*` / "ทดสอบ" → ก่อน cutover จริงรัน `supabase/seed/cleanup_test.sql` ให้สะอาด
- secrets ที่เคยอยู่ในโค้ด GAS เดิมถือว่า leaked แล้ว — rotate ให้หมด · `ANTHROPIC_API_KEY` ไม่ต้อง rotate แล้ว **ให้ revoke ทิ้ง** เพราะเลิกใช้ (D61)

## หลังอัปเดต D61-D65 (2026-08-18) — สิ่งที่ผู้ใช้ต้องทำเอง

- [ ] **ลง migration 0039 ทุก DB ก่อน `git push`** (ลบตาราง `scan_log`)
      ```bash
      npm run db:push:all -- --apply
      ```
      🚨 ลำดับต้องเป็น `db:push:all` ก่อนแล้วค่อย push โค้ด เสมอ (D58)
- [ ] **`npm run test:tenant`** — ต้องผ่านหลังลง 0039 (ก่อนหน้านั้น harness ยังนับ `scan_log` อยู่)
- [ ] **ลบ env 2 ตัวออกจาก Vercel ทุก project**: `ANTHROPIC_API_KEY` · `SCAN_DAILY_LIMIT`
      แล้ว **revoke key** ที่ console.anthropic.com (ไม่ใช่แค่ลบออกจาก Vercel)
      · ลบออกจาก `.env.local` / `.env.local.*-backup` ในเครื่องด้วย
- [ ] **กรอกเลขทะเบียนสรรพสามิตในแอป** — ตั้งค่า → กิจการ (ค่าเดิมใน DB ยังอยู่ ไม่ต้องกรอกซ้ำ
      ถ้าเคยตั้งไว้แล้ว · เข้าไปดูเพื่อยืนยันว่าขึ้นถูกตัว)
- [ ] **ตรวจว่าเมนู “สำรอง” ไม่หายไปไหน** — กลายเป็นแท็บใน ตั้งค่า → สำรองข้อมูล แล้ว
- [ ] **พิมพ์ฟอร์ม ภส. เทียบของเดิม** — แท็บใหม่ ผลิต → รายงานสรรพสามิต
      ต้องได้ไฟล์ที่วางทับกับที่ออกจาก `/reports` เดิมได้ทุกช่อง (กติกาเหล็กข้อ 3)

## หลังอัปเดต D66 (โมดูลเงินเดือน · 2026-08-19) — สิ่งที่ผู้ใช้ต้องทำเอง

- [ ] **ลง migration 0040 ทุก DB ก่อน `git push`** — รอบนี้เป็น migration แบบ **เพิ่มของ**
      จึงต้อง DB ก่อนโค้ดเสมอ (ต่างจาก 0039 ที่เป็นการลบ)
      ```bash
      npm run db:push:all -- --apply
      ```
- [ ] **`npm run test:tenant`** — ต้องผ่านหลังลง 0040
- [ ] **เปิดโมดูลเงินเดือนให้ลูกค้าที่ซื้อ** ที่หน้า `/platform` (ไม่ได้เปิดให้อัตโนมัติ —
      เป็น add-on ที่ขายเพิ่ม ลูกค้าเดิมจึงไม่ได้ฟรี)
- [ ] **ตั้งค่าก่อนใช้งานจริง** ที่ เงินเดือน → ตั้งค่าการคำนวณ (ระบบเปล่า ไม่มี preset ให้):
      1. **ชุดอัตรา** + วันที่เริ่มมีผล — 🚨 **ตรวจกับประกาศจริงก่อนใช้ยื่น** ระบบไม่อัปเดตให้เอง
         (อัตรา/เพดานประกันสังคม · ขั้นบันไดภาษี · ค่าลดหย่อนส่วนตัว)
      2. **กลุ่มพนักงาน** (ถ้าคิดค่าล่วงเวลาหรือเบี้ยต่างกันตามกลุ่ม)
      3. **ช่องที่ต้องกรอกต่อคนต่องวด** (ชั่วโมง OT · วันลา · จำนวนครั้งที่มาสาย ฯลฯ)
      4. **รายการเพิ่ม/หัก** พร้อม **ธง 4 ตัว** — 🚨 ติดธงผิดระหว่างฐานภาษีกับฐานประกันสังคม
         = ตัวเลขที่ยื่นผิดตั้งแต่เดือนแรกโดยไม่มีอะไรฟ้อง
      5. **บัญชีเงินที่ใช้จ่ายเงินเดือน / นำส่ง** (ชื่อต้องตรงกับในแอปบัญชี)
      6. **ชั่วโมงทำงานต่อวัน** และ **การปัดเศษ** ให้ตรงกับที่ใช้จริง
- [ ] **เทียบงวดแรกกับวิธีเดิมทีละคน** ก่อนใช้จ่ายจริง — ถ้าเคยคำนวณด้วย Excel/ระบบอื่น
      ให้รันคู่ขนาน 1 งวดแล้วเทียบทุกบรรทัด (นี่คือด่านเดียวที่จับได้ว่าตั้งค่าครบหรือยัง)
