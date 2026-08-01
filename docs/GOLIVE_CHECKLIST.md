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
- [ ] **เลขทะเบียนสรรพสามิต 17 หลัก (`entities.excise_id`)** ของกิจการโรงสุราจริง (กล่อง 13-1-3 บนฟอร์ม ภส.)
      ```sql
      update entities set excise_id='เลข17หลักจริง' where entity_id='EID01';
      ```
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
2. **Env สำหรับสแกนใบเสร็จ (A15)** — ตั้งใน Vercel (Project → Settings → Environment Variables) + `.env.local`:
   - `ANTHROPIC_API_KEY` = key จริง (⚠️ อย่าใช้ค่าเดิมในโค้ด GAS — ถือว่า leaked, สร้างใหม่)
   - `SCAN_DAILY_LIMIT` = จำนวนสแกนต่อคนต่อวัน (ไม่ตั้ง = 100)
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

## 🚀 Deployment / Go-Live (ทำจริงแล้ว 2026-07-27)

- [x] **โค้ดขึ้น GitHub** — commit ทั้ง repo + push `main` → `github.com/eiei-eiei-eiei/insep-erp`
- [x] **อัป Next.js 15.1.6 → 15.5.22** (Vercel บล็อก deploy เวอร์ชันมีช่องโหว่) · build/lint/test 167 ผ่าน
- [x] **Deploy Vercel production** — โปรเจกต์ `eieieiei/insep-erp` · **URL: https://insep-erp.vercel.app** · login 200 + anon key ต่อ Supabase auth 200
- [x] **ตั้ง env ใน Vercel** (production/preview/development): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SCAN_DAILY_LIMIT`, `DEFAULT_ENTITY_ID=EID01`, `LIQUOR_ENTITY_ID=EID01`
  - ⚠️ **บทเรียน**: `.env.local` มี inline comment (` # ...`) ต่อท้าย 3 ค่า (anon/service/anthropic) — รอบแรก push ทั้ง comment ทำให้ key เสีย ต้อง re-push แบบตัด comment (dotenv ตัดให้เองตอน dev แต่สคริปต์ต้องตัดเอง)
- [x] **ข้อมูลจริงใน Supabase ยืนยันครบ**: transactions 468 / items 725 / sales_orders 7 / log_distill 29 / contacts 35 / products 10 / entities 2 · ข้อมูลทดสอบสะอาดแล้ว (EID99=0)

### ยังเหลือ (ผู้ใช้ต้องทำ — ดูสรุปในแชท)
- [ ] **`entities.excise_id` (EID01) = null** → กรอกเลขทะเบียนสรรพสามิต 17 หลักจริง (บล็อกการพิมพ์ฟอร์ม ภส.)
- [ ] **`app_settings` ไม่มี `sales_revenue_entity`/`sales_revenue_account`** → เพิ่ม 2 แถว (EID01 + "กสิกร insep") ไม่งั้นกดรับเงินออเดอร์ error
- [ ] **`bank_accounts.opening_balance` = 0 ทุกบัญชี** → ถ้าเริ่มใช้กลางปีต้องใส่ยอดยกมาจริง
- [ ] **`ANTHROPIC_API_KEY`** ยังไม่ตั้ง (ค่าใน .env.local ว่าง) → สร้าง key ใหม่ ใส่ใน Vercel ถ้าจะใช้สแกนใบเสร็จ
- [ ] **`LINE_CHANNEL_TOKEN`/`LINE_GROUP_ID`** ว่าง → ตั้งถ้าจะใช้แจ้งเตือน
- [ ] **GitHub auto-deploy ยังไม่เชื่อม** (Vercel เชื่อม repo ตอน link ไม่สำเร็จ) → ติดตั้ง Vercel GitHub App ใน dashboard ถ้าอยาก auto-deploy ทุก push (ไม่งั้น deploy ด้วย `vercel --prod`)
- [ ] **ล็อกอินจริง** ที่ https://insep-erp.vercel.app ด้วย user `ceo` แล้วตรวจแต่ละแอป

### แอปผลิต — ลบ batch หมัก (D41)
- [ ] **`npm run db:push` apply migration `0020_delete_ferment.sql`** (fn_delete_ferment_batch) — ต้องรันก่อนปุ่มลบ batch หมักในแท็บลงหมักจะทำงาน (ไม่งั้น error `function ... does not exist`)

### ปิดงานรีวิว D42 — multi-branch + กระดาน batch + PWA (2026-08-01)
- [ ] **`npm run db:push` apply migration `0021_multibranch_and_quotation_terms.sql`** — **ต้องรันก่อนใช้งานต่อ** ไม่งั้น:
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

### ปรับ UX แอปบัญชี (D35 — หน้าบันทึก/แดชบอร์ด/ค้นบิล)
- [x] **apply migration `0019_edit_transaction.sql`** ด้วย `npm run db:push` (2026-07-29 — CLI ใช้ได้แล้ว ไม่ต้องผ่าน dashboard)
      — สร้างฟังก์ชัน `fn_edit_transaction` · จำเป็นสำหรับปุ่ม "แก้ไข" ในหน้าค้นบิล
- ℹ️ อื่น ๆ ทำงานได้ทันทีหลัง deploy (ไม่ต้องตั้งค่าเพิ่ม): combobox หมวดหมู่, VAT ออโต้ตามเลขใบกำกับ, บิลล่าสุดของคู่ค้า,
      ดรอปดาวน์รายการจากประวัติ, ค้างร่าง localStorage, เลขภาษี 13 หลัก, แดชบอร์ดยอดสุทธิ

---

## หมายเหตุถาวร
- ข้อมูลทดสอบทั้งหมดใช้ marker `EID99` / `T-*` / "ทดสอบ" → ก่อน cutover จริงรัน `supabase/seed/cleanup_test.sql` ให้สะอาด
- อย่าลืม rotate `ANTHROPIC_API_KEY` + secrets ที่เคยอยู่ในโค้ดเดิม (ถือว่า leaked แล้ว)
