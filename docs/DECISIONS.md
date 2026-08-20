# DECISIONS — บันทึกการตัดสินใจ/ความไม่ตรงกันระหว่าง implement

> จดทุกครั้งที่ (ก) เจอโค้ดเดิมขัดเอกสาร → ยึดโค้ดเดิม (กติกาเหล็กข้อ 5)
> (ข) ตัดสินใจ design ที่เอกสารเปิดช่องไว้ (ค) เจอ 2 เอกสารขัดกัน

## Phase 1 (2026-07-20)

### D1 — customers ยุบเข้า contacts (ไม่สร้างตาราง customers)
- **ที่มา**: FLOW_REDESIGN sec 8 ข้อ 1 (delta ทับ MIGRATION_PLAN sec 2.1/2.3) — แก้ T1 (ลูกค้า 2 ตาราง)
- **ทำ**: `contacts` เพิ่มคอลัมน์ `phone, email, credit_term, sale_name, is_export, roles text[]`;
  `sales_orders.customer_id → references contacts(contact_id)`; ไม่มี migration สร้าง `customers`
- **ผลต่อ migration (Phase 5)**: import `Contacts` ก่อน → merge `custdata` โดย match ชื่อ (normalize trim/lower)
  → พิมพ์รายงานคู่กำกวมให้ผู้ใช้เคาะก่อน commit

### D2 — formatTaxId: ยึดเวอร์ชันบัญชี (ไม่ใช่ขาย)
- **ที่มา**: MIGRATION_PLAN P0 ข้อ 4 (formatTaxId กระจาย 2 แอป คนละ signature)
- **พบ**: `accounting/Config.js` strip `['" ]` + คืน `"-"` เมื่อว่าง · `sales/Config.gs` ไม่ strip quote + คืน `""`
- **ตัดสิน**: `lib/shared/format.ts` ยึดเวอร์ชัน **บัญชี** (ใช้ในทุกรายงานภาษี/50ทวิ — robust กว่า)
  · `formatBranch` คืน object `{isHQ, text}` ตามเวอร์ชันบัญชี (รายงานพึ่ง isHQ)
- **golden test**: `lib/shared/format.test.ts` — ค่า expected สร้างจากรันฟังก์ชันเดิมตรง ๆ

### D3 — stock_product trigger ครอบ INSERT + UPDATE + DELETE
- **ที่มา**: MIGRATION_PLAN sec 2.4 เขียน trigger เฉพาะ INSERT · FLOW_REDESIGN sec 10.2 สั่งครอบ 3 op
- **ตัดสิน**: ยึด FLOW (ครอบ 3 op) — แก้/ลบ log_product จากแอปแล้ว balance ปรับเองทันที ไม่ต้อง recompute
  · ทิศทาง +/- คงกฎ P2 เป๊ะ (บวกเฉพาะ 'รับ' ที่เหลือลบหมด)
  · `apply_stock_delta` เป็น `security definer` ให้ trigger เขียน `stock_product` ทะลุ RLS ได้
- **คงไว้**: `recompute_stock_product()` + pg_cron รายสัปดาห์ เป็น safety net เดิม

### D4 — log ผลิตเขียนตรงได้โดย main (ไม่บังคับผ่าน RPC อย่างเดียว)
- **ที่มา**: MIGRATION_PLAN sec 3.2 แนะเขียน log ผลิตผ่าน RPC เท่านั้น (กันเขียน log โดยไม่อัปเดต stock)
  · FLOW sec 10 สั่งว่า main ต้องแก้/ลบ log ผลิตจากแอปได้
- **ตัดสิน**: อนุญาต `main` เขียน/แก้/ลบ log ผลิตตรงผ่าน RLS ได้ — ความสอดคล้อง stock การันตีด้วย trigger (D3)
  ที่ครอบทุก op อยู่แล้ว ไม่ว่าใครเขียน · RPC (Phase 2) ยังใช้ได้ (security definer)

### D5 — edit_log audit trigger (FLOW sec 10.3)
- เพิ่มตาราง `edit_log` + trigger กลาง `trg_audit(pk_col)` attach บน transactions, sales_orders, log_* ทุกตัว
- ทดแทน version history ของ Sheets — before/after jsonb + user_id (auth.uid())

### D6 — report_runs (FLOW sec 8 ข้อ 3)
- เพิ่มตาราง `report_runs(report_key, month, entity_id, created_at)` — ตัวช่วยกันลืมใน workspace รายงาน

### D7 — Layout = 4 workspace (ไม่ใช่ 3 route โดเมน)
- **ที่มา**: MIGRATION_PLAN sec 1.1 วาง route `/production /accounting /sales` · FLOW_REDESIGN sec 2 = 4 workspace
- **ตัดสิน**: nav ยึด FLOW (4 workspace: ผลิต/ขาย/บัญชี/รายงาน) — route ยังเป็น 3 โดเมน + `/reports` เพิ่ม
  · role คุมว่าเห็น workspace ไหน (`lib/shared/workspaces.ts`)

### D8 — ไฟล์ template อยู่ใน docs/form/ + map เป็น key ASCII ตอนอัปโหลด
- พบ template จริง + ฟอนต์ THSarabun ครบใน `docs/form/` (แบน) — สคริปต์ `upload-pdf-templates.ts` map path
- ฟอนต์ canonical = `THSARABUNIT๙.TTF` (เลขไทย) ตามที่ plan sec 5.3 ระบุ ("เลขไทย") → `fonts/THSARABUNIT9.TTF`
- ⚠️ **Supabase Storage key รับเฉพาะ ASCII** — ชื่อไฟล์ไทยขึ้น "Invalid key" → เปลี่ยน key เป็นอังกฤษ
  **Phase 2 (getPdfAsset) ต้องอ้างชื่อเหล่านี้เป๊ะ**:
  | ฟอร์ม | source (docs/form) | key ใน bucket |
  |---|---|---|
  | ภส.๐๗-๐๑/๑ | `ภส_07-01ทับ1.pdf` | `excise/pso_07-01_1.pdf` |
  | ภส.๐๗-๐๒/๑(๑) | `ภส_07-02ทับ1.pdf` | `excise/pso_07-02_1.pdf` |
  | ภส.๐๗-๐๒ ทับ12 | `ภส_07-02ทับ12.pdf` | `excise/pso_07-02_12.pdf` |
  | ภส.๐๗-๐๔/๑ | `ภส_07-04ทับ1.pdf` | `excise/pso_07-04_1.pdf` |
  | 50ทวิ (wh3) | `approve_wh3_081156.pdf` | `wht/wh3_template.pdf` |

### D9 — login แบบ username (ไม่ต้องมีอีเมลจริง) + หน้าจัดการผู้ใช้ในแอป
- **ที่มา**: ผู้ใช้ขอ login แบบไม่ผูกอีเมล + เจ้าของกดสร้าง/ให้สิทธิ์/รีเซ็ตรหัสคนอื่นได้เอง
- **ทำ**: ผูก Supabase Auth ด้วยอีเมลภายใน `<username>@insep.local` (`LOGIN_EMAIL_DOMAIN`, แผน sec 3.1)
  · หน้า login รับ username (ถ้ามี @ = ใช้เป็นอีเมลจริง) · `lib/shared/auth-domain.ts`
- **หน้า `/settings/users`** (เฉพาะ main): สร้าง user (`admin.createUser` + `email_confirm:true` = ไม่ต้องยืนยัน)
  · เปลี่ยน role · รีเซ็ตรหัสผ่านคนอื่น · ลบ — ทุก action มี `requireMain()` guard (ไม่พึ่งแค่ UI ซ่อน)
  · service role อยู่ใน `lib/supabase/admin.ts` + `import "server-only"` กันหลุด client
- **กันล็อกตัวเอง**: ห้ามลดสิทธิ์/ลบบัญชีตัวเอง
- คนแรก (owner) ยัง bootstrap ผ่าน dashboard ครั้งเดียว (chicken-and-egg) — จากนั้นจัดการในแอปได้หมด

## Phase 2 (เริ่ม 2026-07-20)

### D10 — lib/abv (P1) สกัดตาราง verbatim จาก legacy + golden 16k จุด
- `scripts/gen-abv.mjs` อ่าน `docs/legacy/production/_js_distill.html` → เขียน `lib/abv/table.ts` (verbatim)
  + `lib/abv/__golden__/abv-vectors.json` (รันฟังก์ชัน**เดิม** grid abv 0..100 × temp 0..40 step 0.5)
- **ไม่พิมพ์ตารางมือ** (กติกา P1) — เปลี่ยนจุดเดียว: header row `[,0,...` → `[null,0,...` ([0][0] ไม่ถูกใช้,
  แค่ให้ผ่าน TS/eslint no-sparse-arrays) · `lib/abv/index.ts` = port ฟังก์ชัน, golden test ผ่าน 100%
- **พฤติกรรมเดิมที่ยืนยันด้วย test** (ไม่ใช่ bug ของ port):
  - `correctAbvTo20C(0, 20) = null` — interpolation partner แถว temp=21 ช่อง abv=0 ว่าง → NaN guard คืน null
  - มุมตารางว่าง (ดีกรีต่ำ+อุณหภูมิสูง เช่น abv≤2 temp=40) → null
- ⚠️ ยังค้าง (P1 note): cell temp=2 มีค่า `50.9` ซ้ำ 2 ช่อง (ผิด pattern เพื่อนบ้าน) — port ตามเดิมไปก่อน
  ผู้ใช้ต้องเช็คกับเว็บ calal แล้วค่อยแก้พร้อมกันทั้ง 2 ระบบ (regenerate golden ด้วย)

### D11 — lib/production/calc (Block B) pure functions + tests
- port: `stockDelta` (P2), `fermVolFromAmounts`/`sumFermVolByBatch`/`volPerTank` (P4),
  `pendingBatches` (P11), `nextBatchNumber` (P12), `remainingDistillVol` + `diluteCalc` (P9)
- ค่า golden ตรวจจากรัน logic เดิมใน Node · `diluteCalc` ใช้ `Number(x.toFixed(2))` = ค่าที่เก็บเดิมเป๊ะ
  (ยืนยัน edge 5.325→5.33) · `nextBatchNumber` ใช้ `new Date().getFullYear()+543` ตามเดิม
- ⚠️ ทิศทาง stock (P2) มี 2 ที่: SQL trigger (0002, ของจริง) + `stockDelta` (lib, ไว้ preview/test UI) — logic เดียวกัน

### D12 — Block C: RPC ผลิต (0010) + data/actions
- `fn_save_ferment` (P10, invoker/RLS main): log_ferment 1 แถว + เบิกวัตถุดิบ 'จ่าย' auto · comma string
  ผ่าน `string_agg ... with ordinality` (คงลำดับ = ค่าแรกวัตถุดิบหลัก P4)
- `fn_close_batch` (P3): insert log_distill · จับ unique_violation → คืน error "ปิดไปแล้ว" (กันหักส่าซ้ำ)
- `fn_sell_product` (definer + guard main/sale): idempotency ด้วย insert integration_log 'ok' ชน unique
- `fn_receive_material` (definer + guard main): match ชื่อวัตถุดิบ trim เป๊ะ · idempotency = tx_id
- weighted-avg abv ตอนปิด batch (P8) คำนวณฝั่ง client (จะทำใน UI block E) แล้วส่ง vol/abv เข้า fn_close_batch

### convention ข้อมูลเทส (ออกแบบไว้ใช้ block seed/cleanup)
- master เทส: id prefix `T-` (T-MAT/T-CON/T-PROD) · entity เทส `EID99` (บัญชี/ขาย)
- log ผลิต: cleanup ลบ where product_id/material_id LIKE 'T-%' หรือ note LIKE '%[TEST]%' หรือ batch ในชุดเทส
- ให้ทุก seed ใส่ marker พอให้ลบทีเดียวได้ (คำสั่งลบรวมใน docs/TESTING guide)

### D13 — Block E UI + Block D รายงาน
- UI ผลิต 7 แท็บ (`_components/*Tab.tsx` + `ProductionApp`) เรียก server actions · ABV@20 auto (P1),
  ปิด batch weighted avg (P8), ปรุง C1V1=C2V2 (P9) คำนวณฝั่ง client จาก lib
- `lib/production/reports.ts` port P5/P6/P7 · golden (`scripts/gen-report-golden.mjs` รันฟังก์ชันเดิม
  จาก Reports.js บน fixture เดียวกัน) → `reports.test.ts` ผ่าน · ใช้ `ymd()` แยก y/m/d กัน timezone
  (แทน `new Date(row)` เดิมที่พึ่ง script tz GMT+7) — ผลเทียบตรง 100%
- degree ใช้ `|| ""` ตาม original (ต่างจาก `??` เฉพาะ degree=0)

### D14 — Block F: ฟอร์ม ภส. PDF (กลไก A) + ชุดเทส
- `lib/pdf/excise.ts` port fillDailyForm/fillProductionForm/fillSummaryForm + cfg ทั้ง 4 **verbatim**
  จาก `_js_reports.html` (พิกัด/reg 13-1-3/checkbox/rowFirst-Last ไม่แตะ) · ใช้ pdf-lib+fontkit จาก npm
  · template/font โหลดจาก Storage ผ่าน `getPdfAssetUrl` (signed URL) → client fetch
- template key: `excise/pso_07-01_1` `pso_07-02_1`(๑) `pso_07-02_12`(๒) `pso_07-04_1`
- **font = `fonts/THSARABUN.TTF` (เลขอารบิก)** — ผู้ใช้เลือกอารบิกแทน THSARABUNIT๙ (เลขไทย) ตาม plan sec 5.3
  (สลับได้ที่ `FONT_KEY` ใน lib/pdf/excise.ts) · upload script อัปทั้ง 2 ฟอนต์
- **เลขสรรพสามิต 17 หลัก** (กล่อง 13-1-3) — โค้ดวาดตามจำนวนหลักที่มี · seed placeholder แก้เป็น 17 หลัก
  (ของเดิม 13 หลักทำให้กลุ่ม 1+3 ว่าง) · ของจริงกรอกที่ `entities.excise_id`
- `/reports` UI (ReportsApp): เลือกกิจการ/เดือน/ฟอร์ม → gen + merge (pdf-lib) + download
- ⚠️ ยัง**ไม่ได้ pixel-diff เทียบ GAS เดิม** — เป็นขั้นตอนที่ผู้ใช้ทำตอน cutover (TESTING.md ส่วน 2.2)
- ชุดเทส: `supabase/seed/seed_test.sql` (EID99 + master T-* + scenario 2026-07) + `cleanup_test.sql`
  (ลบทีเดียวด้วย marker) + `docs/TESTING.md` step-by-step · convention marker = D12

### D15 — หน้าจัดการ master ในแอปผลิต (CRUD) + แนวทางต้นทุนสุรา→วัตถุดิบ (T6)
- เพิ่มแท็บ **จัดการข้อมูล** ในแอปผลิต: CRUD `materials`/`containers`/`products` (`MasterTab` + `master-actions.ts`
  whitelist ตาราง+pk · upsert by pk · delete จับ FK error แจ้ง "มีรายการใช้อยู่") — role main ผ่าน RLS
- **ต้นทุนสุรา→วัตถุดิบอัตโนมัติ (Phase 3, แก้ T6):** ช่องรายการหมวด "ต้นทุนสุรา" ฝั่งบัญชีจะเป็น
  **dropdown จาก `materials`** (ไม่พิมพ์ชื่อเอง → ไม่มีปัญหา match ชื่อเพี้ยนแบบเดิม) → บันทึกแล้วลง
  `log_material` อัตโนมัติ · มีปุ่ม "เพิ่มวัตถุดิบ" inline ถ้ายังไม่มีใน master · RPC `fn_receive_material` พร้อมแล้ว

## Phase 3 (เริ่ม 2026-07-21)

### D16 — lib/accounting pure functions + golden tests (A1-A13)
- `lib/accounting/calc.ts` port: `entryCalc` (A3), `itemTotal`/`itemDiscBahtFromPct` (A4), `reverseWht`,
  `taxReport` ภพ.30 (A1 + guard A2 + เช็คราคาหลุด A13), `previousVat` (ยกยอด), `whtReport` ภงด.3/53 (A10),
  `dashboardData` + pending WHT (A11) · `isCorporate`/`formatDateBE` helpers
- `lib/accounting/ledger.ts` port: `txEffect` (A7), `accountBalances` + `accountStatement` (A8)
- `lib/accounting/wht.ts` port: `nextWhtDocNo`/`whtDocPrefix` (A9), `formatDateThai`, `buildWht50PrintData`
- ค่า golden คำนวณด้วยมือจาก logic เดิม (Reports.js/Accounts.js/Wht50Tawi.js/_js_entry.html) — 34 tests ผ่าน
- **ยึดพฤติกรรมเดิมเป๊ะ**: ภพ.30 VAT รวมรอบเดียวจากยอดรวม (ไม่ sum รายแถว) · filter เดือน transaction_date
  แต่แสดง tax_invoice_date · dashboard filter ด้วย tax_invoice_date ก่อน (จงใจต่างจาก ภพ.30 — A11) ·
  ยอดบัญชีข้าม ยกเลิก+AP/AR ค้าง · เช็คราคา account ว่าง → หลุดทุกจุดอัตโนมัติ
- **settle (A5) + installments (A6)** = mutation → ไปอยู่เลเยอร์ RPC/actions (task DB migrations) ไม่ใช่ pure lib

### D17 — เลข 50ทวิ = "6901" (ไม่มีขีดกลาง) — ยึดโค้ดเดิม
- **ที่มา**: schema comment (`accounting.sql` doc_no) + MIGRATION_PLAN sec 2.2 เขียนตัวอย่าง `'69-001'`
- **พบในโค้ดจริง** (`Wht50Tawi.js getNextWhtDocNo`): `prefix + (max+1).padStart(2)` = `"69" + "01"` = **`"6901"`**
  ไม่มีขีดกลาง, ลำดับ pad ขั้นต่ำ 2 หลัก (ทะลุ 99 → `"69100"`)
- **ตัดสิน** (กติกาเหล็ก #5): ยึดโค้ดเดิม → docNo = `"6901"` · `nextWhtDocNo` port ตามนี้ + golden test คุม

### D18 — เลเยอร์ RPC บัญชี (0011) + money math อยู่ที่ lib (client)
- money ทุกตัวคำนวณจาก lib ฝั่ง client (entryCalc/splitInstallments) แล้วส่งค่ามาเก็บ — เหมือน
  calculateSummary เดิม (client-side) · RPC ทำหน้าที่ insert atomic + serial + audit เท่านั้น
- `fn_save_transaction` (invoker) เรียก `fn_receive_material` (definer เดิม 0010) สำหรับ forward
  ต้นทุนสุรา (T6) — คง "พฤติกรรม warning เดิม": forward พลาด → บัญชียัง commit + คืน warning (savepoint)
- **gate forward ต้นทุนสุรา**: `forward_material = (category='ต้นทุนสุรา')` + ช่องรายการเป็น dropdown
  จาก materials (ชื่อตรง master → fn_receive_material match ได้) — แทน gate ด้วย LIQUOR_ENTITY_ID เดิม
- tx_id/transfer_id ใช้ `next_serial` keyed ต่อวัน (`TR-<yyyymmdd>`) แทน LockService + PropertiesService

### D19 — ภพ.30/ภงด. = HTML→print, ไม่ใช่ html2canvas
- แผน sec 5.1 ระบุกลไก C = html2canvas+jsPDF · **ตัดสิน**: generate HTML (BASE_PRINT_STYLES ชุดเดิม)
  เปิดแท็บใหม่ → ผู้ใช้กด "พิมพ์/บันทึก PDF" — **เลย์เอาต์ตรง legacy 100%** เพราะใช้ HTML/CSS ชุดเดียวกัน
  (แม่นกว่าการ rasterize ด้วย html2canvas + ไม่ต้องเพิ่ม lib หนัก) · `lib/accounting/reportHtml.ts`
- ยอดตัวเลขมาจาก `taxReport`/`whtReport` (มี golden test) · ภพ.30 append `tax_summaries` ทุกครั้งที่สร้าง (เดิม)

### D20 — 50ทวิ AcroForm (กลไก B) + seq default
- `lib/pdf/wht50.ts` port `_js_wht_pdf.html` **verbatim** (field map 89 ช่อง, drawAmount บาท|สตางค์ พิกัด
  dividerX/rightX, checkbox, วันที่ออก) · pdf-lib+fontkit จาก npm · template `wht/wh3_template.pdf` + THSARABUN
- schema `wht_certificates` ไม่มีคอลัมน์ seq (ประเภทเงินได้ 1-6) → **seq default = 6 (อื่นๆ/ม.3 เตรส)**
  + `otherDesc = category` · พิมพ์ซ้ำใช้ seq 6 เช่นกัน · pndType auto จาก `isCorporate` (ภงด.53/3)
  ⚠️ ถ้าต้องการ seq อื่น (เงินเดือน/ค่าเช่า ฯลฯ) เป็นงานเพิ่มคอลัมน์ seq ภายหลัง

### D21 — แก้กลุ่มงวด (mode A/B) ยกไปทำภายหลัง
- Phase 3 มี: สร้างกลุ่มงวด (EntryTab) · ดูกลุ่ม + ชำระรายงวด (ApArTab) · ยกเลิกทั้งกลุ่ม (void)
- **updateInstallmentGroup (mode A ลบสร้างใหม่ / mode B แบ่งยอดคงเหลือ) ยังไม่พอร์ต** — ผู้ใช้แก้โดย
  void กลุ่มเดิม + สร้างใหม่ได้ (ผลลัพธ์เดียวกัน) · logic mode B (normalize) มีใน `splitInstallments` แล้วเผื่ออนาคต

### D22 — สแกนใบเสร็จ (A15) = server action + Anthropic REST
- `scanReceiptAction`: fetch `api.anthropic.com/v1/messages` model **`claude-haiku-4-5`** (legacy ใช้
  `claude-haiku-4-5-20251001`) · system/user prompt + schema JSON เดิม · ANTHROPIC_API_KEY = env (server)
- rate limit: นับ `scan_log` status='success' ต่อ user (email) ต่อวัน ≥ `SCAN_DAILY_LIMIT` (env default 100)
  — แทน Propertiesan counter เดิม · log ทุกครั้ง (success/error/rate_limit) ลง scan_log

### D23 — รอบปรับ UX ตาม feedback ผู้ใช้ (หลังเทส Phase 3) — migration 0012
1. **item เต็มแบบเดิม** (A4): entry item มี หมวดหมู่/ระบุงาน, กรอก in↔ex VAT สลับกัน, ส่วนลด % ↔ บาท
   (คิดจาก exVat×qty), carry-forward หมวด/งาน · ปุ่มแสดง/ซ่อนคอลัมน์เสริม
2. **เพิ่มคู่ค้า inline** จากหน้าบันทึก (modal → addContactAction → เลือกใช้ทันที)
3. **แท็บ “ตั้งค่า”** ในบัญชี: CRUD app_settings (หมวด/อัตรา WHT/บัญชีภาษี), bank_accounts (upsert by ชื่อ),
   contacts (เพิ่ม/แก้/ลบ) — role main · ลบ bank_account ทำผ่าน Supabase (กันลบผิด)
4. **50ทวิ รันเลขแยกต่อกิจการ** → เปลี่ยน PK `wht_certificates` เป็น `(entity_id, doc_no)` (เดิม doc_no เดี่ยว)
   · เพิ่ม `income_seq` (ประเภทเงินได้ 1-6, เลือกก่อนออก → ลงแถวในฟอร์มให้ตรง) · ฟอร์มออกให้แก้ **เลขที่/วันออก/
   วันจ่าย/ประเภทเงินได้** ได้ · ใบที่ออกแล้วมีปุ่ม **แก้ไข** (`fn_update_wht`) + **พิมพ์ซ้ำ** · ยกเลิก seq default 6 → ผู้ใช้เลือกเอง
   ⚠️ อัปเดต D20: seq เลือกได้แล้ว (ไม่ fix 6) · issueDateISO = วันออกที่กรอก (เดิม = transaction_date)
5. **ภพ.30 tax_summaries ไม่ append ซ้ำ**: สร้างเดือนเดิมซ้ำ = **replace แถวเดิม** (delete+insert ตาม report_month+entity)
   · แสดง **ภาษีซื้อยกมา** (forwarded_vat_out เดือนก่อน) ให้เช็คก่อนสร้าง · หน้า list/ลบ tax_summaries จากแอป
   ⚠️ ต่างจาก legacy ที่ append ทุกครั้ง (getPreviousVAT เดิมอ่าน created_at desc) — ผู้ใช้ขอให้ dedup
6. **ค้นบิล/ประวัติราคา**: เพิ่ม dropdown คู่ค้า · พิมพ์แล้ว**กรอง live** (ไม่ต้องกดค้น) · search ค้นแค่รายละเอียดบิล/
   ชื่อสินค้า · **ประวัติราคา filter entity จริง** (แก้บั๊ก: `searchPriceHistory` เพิ่ม `.eq(transactions.entity_id)`)
7. **ย้ายเอกสารสรรพากร (ภพ.30/ภงด./50ทวิ) เข้าแท็บ “เอกสารสรรพากร” ในบัญชี** (ใช้ entity/เดือนร่วมกับบัญชี —
   ทำงานต่อเนื่อง) · `/reports` เหลือ **ภส.๐๗ (สรรพสามิต)** อย่างเดียว · ⚠️ ต่างจาก FLOW sec 6 (T7 รวมทุกฟอร์มที่
   /reports) — ผู้ใช้เลือก workflow ต่อเนื่องในบัญชีแทน (owner override)

### D24 — คู่ค้าชนิด “ทั้งสอง” + กรอง dropdown ตาม context (ไม่แก้ schema)
- **คู่ค้า** เพิ่มชนิด **“ทั้งสอง”** (contact_type เป็น text อยู่แล้ว ไม่ต้อง migrate) · default คู่ค้าใหม่ = ทั้งสอง
  · dropdown คู่ค้าใน entry กรองตาม type: รายรับ→ลูกค้า, รายจ่าย→ผู้ขาย · **“ทั้งสอง”/เว้นว่าง = โผล่ทั้งคู่**
  (เดิม dropdown โชว์ทุกคู่ค้าไม่กรอง — คืน logic filter ตาม legacy getSettingsData col type)
- **บัญชีเงิน** dropdown (entry/โอน/settle) กรองตาม `entity_ids` ของบัญชี (ว่าง = ใช้ร่วมทุกกิจการ) — เดิมโชว์ทุกบัญชี
- **ตั้งค่า → บัญชีเงิน “กิจการที่ใช้”** เปลี่ยนเป็น checkbox หลายอัน (บางบัญชีใช้ร่วมหลาย entity) แทน multiselect

### D25 — กราฟติดตาม + หน้าประวัติเทียบหลาย batch (Phase 2 addendum)
- แท็บ ติดตามหมัก/กลั่น เพิ่มกราฟรายตัว batch · แท็บใหม่ **ประวัติ/เทียบ** overlay หลาย batch
  (เทียบหมัก Brix/pH/Temp vs วันจากเริ่มหมัก + เทียบกลั่น metric vs นาที/สะสม + สรุป Yield)
- ใช้ **SVG chart เขียนเอง** (`LineChart` categorical, `XYChart` numeric-x) — ไม่เพิ่ม dependency
  (ต่างจากเดิมที่ใช้ Chart.js CDN) · bundle ผลิต ~19KB
- `lib/production/history.ts` port สูตรจาก `_js_history.html`: fermentSummary (attenuation, ~ABV=Brix×0.55),
  distillSummary/potHearts (ค่าจบหม้อถ้ามี ไม่งั้นถ่วงน้ำหนักช่วงกลาง), equivVol/yield · unit test ผ่าน
- distill reading form เพิ่มช่อง นาทีที่/อุณหภูมิไอ (schema รองรับอยู่แล้ว) · seed เพิ่ม 2 batch มีค่าวัด+กลั่น

### D26 — แอปขาย (Phase 4)
- **docToPrint bug (sec 11 ข้อ 5) → ผู้ใช้เลือก "แก้"**: `PAY_BALANCE` ตั้ง `docToPrint='tax-invoice-balance'`,
  `FULL_PAYMENT_LATER` ตั้ง `='tax-invoice-receipt'` (โค้ดเดิมไม่ตั้ง → ใบเสร็จยอดค้างไม่ trigger พิมพ์)
  · ค่าที่ตั้งตรงกับปุ่มพิมพ์ closed-status เดิม (deposit>0→balance, credit→receipt) · lib/sales/orders.ts + golden test
- **บัญชีรับเงิน + กิจการ ของรายรับขาย (sec 11 ข้อ 3) → ทำเป็น config**: hardcode "กสิกร insep" เดิม ย้ายเป็น
  `app_settings` kind `sales_revenue_account` + `sales_revenue_entity` (ขยาย CHECK constraint) · ผู้ใช้กรอกจริงตอน go-live
  · ถ้ายังไม่ตั้ง entity → action รับเงิน error ชัดเจน (transactions.entity_id NOT NULL) — เป็น gate ตั้งใจ
- **`due_date` เก็บ ISO ไม่ใช่สตริงไทย**: เดิม (Sheets) เก็บ 'dd/MM/yyyy' พ.ศ. เป็น string · ระบบใหม่คอลัมน์เป็น `date`
  → `dueDateISO()` เก็บ ISO, `formatThaiDate()` แปลงตอนแสดง/พิมพ์ (ยึด schema ใหม่, ค่าที่แสดงเหมือนเดิม)
- **RECEIVE_REVENUE = insert ตรงใน transaction เดียว (atomic)** แทนคิว `acc_sync_queue`+trigger 1 นาที (sec 4.2) ·
  idempotency `integration_log(action='RECEIVE_REVENUE', key)` + `transactions.idempotency_key` · key = orderNo / orderNo-balance
- **SELL_PRODUCT inline ใน `fn_confirm_fulfillment`** (ไม่ cross-call `fn_sell_product`) เพราะ role warehouse ยิงเอง —
  `fn_sell_product` guard เฉพาะ main/sale · inline (DEFINER guard main/warehouse) รักษา role semantics
- **ยกเลิกออเดอร์ (FLOW sec 10.1)**: `fn_cancel_order` (role main) void รายรับ (idempotency_key) + คืน warehouse_stock
  (stock_moves IN) + คืนสต็อกผลิตสุรา (log_product 'รับ') + mark order 'ยกเลิก' — ไม่ลบประวัติ
- **หัวกระดาษพิมพ์เอกสาร B2B** (ชื่อบริษัท/เลขภาษี/บัญชีโอน) = constant `COMPANY` ใน `print.ts` (ข้อมูลบริษัทจริง คงตามเดิมเป๊ะ
  เพราะผู้ใช้พิมพ์ทุกวัน) — แก้ที่จุดเดียว ดู GOLIVE Phase 4 · ต่างจากฟอร์มราชการที่ pixel-diff (นี่คือเอกสารการค้าของบริษัทเอง)

## Phase 5 (เริ่ม 2026-07-23)

### D27 — สำรวจ .xlsx จริง 3 แอป: ชีทที่ย้าย/ข้าม + คำถามค้าง sec 11 ที่เคลียร์แล้ว
ผู้ใช้ส่ง `production.xlsx` / `accounting.xlsx` / `sales.xlsx` (วางใน `migration/csv/`, gitignore แล้ว)
สำรวจด้วย `scripts/inspect-xlsx.mjs` (devDep `xlsx`) — สรุปการตัดสินใจก่อนเขียน import script:

- **คำถามค้าง sec 11 เคลียร์จากข้อมูลจริง:**
  - #1 `btbsales` cols = `0:timestamp 1:btbcustID 2:btbcustName 3:taxinvNo 4:item.name 5:item.qty 6:item.pricexvat 7:ยอดรวมบรรทัด`
  - #2 `curstock` cols = `0:itemCode 1:itemName 2:category 3:unit 4:currentStock 5:reorderPoint` (col2 = category)
  - #10 `Log_Distill` 29 batch ไม่ซ้ำ (ต้อง verify ตอน reconcile) · `Log_DistillRun` = **0 แถว** (ผู้ใช้ยืนยัน: ไม่เคยบันทึก reading รายนาที — ปกติ ตาราง log_distill_run ว่างได้)

- **ชีทที่ข้าม (ไม่ย้าย):**
  - ผลิต: `Temp_07_*` (4) + `งบเดือน_*` (7) = พื้นที่วางฟอร์ม PDF / snapshot รายงาน (output ไม่ใช่ต้นทาง)
  - ขาย: `menu`, `sales`, `transaction` = ระบบ POS หน้าร้านเก่าก่อน B2B (**ผู้ใช้: เลิกใช้แล้ว ข้ามหมด**)
  - ขาย: `acc_sync_queue` = คิว sync เดิม (แผนยุบทิ้งแล้ว)
  - log ประวัติ: `API_Log`(ผลิต+บัญชี), `Scan_Log` = **ผู้ใช้: เริ่มใหม่ ไม่ย้าย log เก่า** (integration_log/scan_log เริ่มนับใหม่หลัง cutover)
  - credential: `Users`(บัญชี), `inteam`/`salesteam`(ขาย) = ไม่ย้าย passhash (Phase 1 มีหน้าจัดการผู้ใช้ username แล้ว)

- **custdata → ทิ้ง, ยึด `Contacts` อย่างเดียว (ผู้ใช้เปลี่ยนแนวจาก D1):**
  - custdata 1,007 แถว = **แถวเปล่าจาก checkbox** — ลูกค้าจริงมีแค่ 7 (C001-C007) ในนั้น C002/C003/C004 = ข้อมูลทดสอบ (`asdfef`/`ฟหก`/`dfadfa`)
  - ⚠️ **ID คนละ format**: ออเดอร์ (`btbtransaction`) อ้าง `C001/C005/C006/C007` แต่ `Contacts` ใช้ `C-0007/C-0005/...` → import ต้องทำ **remap ID** ให้ sales_orders ชี้ contact ที่ถูก
  - remap ที่ยืนยัน (match ด้วยชื่อ+เลขภาษี): `C001→C-0007` (ภัทรวรรณ) · `C005→C-0005` (เพ็นต้า) · `C006→C-0018` (ลูกค้าทั่วไป)
  - **`C007 บริษัท โอชาฟูดแพ็ค จำกัด` (tax 0105547129169) ไม่มีใน Contacts** แต่เป็นลูกค้าออเดอร์ล่าสุด `QU260709-001` → **ผู้ใช้เลือก: ดึงเข้า contacts อัตโนมัติจาก custdata** (contact ใหม่, remap `C007→ตัวใหม่`)
  - หมายเหตุ: custdata `C005` tax เก็บ `105526006688` (ตก 0 นำหน้า) vs Contacts `0105526006688` — เทียบด้วย normalize (ตัด/เติม 0) หรือ match ด้วยชื่อ

### แก้ D1 (Phase 5 override)
- D1 เดิม: "merge custdata เข้า contacts โดย match ชื่อ" → **เปลี่ยนเป็น**: ยึด `Contacts` เป็น master, ไม่ import custdata ยกชุด, ดึงเฉพาะ contact ที่ออเดอร์อ้างแต่ยังไม่มี (โอชาฟูดแพ็ค) + สร้าง remap ID สำหรับ sales_orders

### D28 — migration scripts (Phase 5 implementation) + จุดที่พบตอนเขียนจริง
โครง: `migration/lib/{clean,loader,client,transform}.ts` (logic กลาง) + 4 สคริปต์
`split-xlsx` / `import-csv` / `reconcile` / `export-supabase-to-csv` · npm `migrate:*` · devDep `xlsx`

- **อ่าน .xlsx ตรง (ไม่ผ่าน CSV กลาง)**: import+reconcile ใช้ `loader` อ่าน workbook แบบ **raw serial** (`cellDates:false`)
  → `clean.isoDate` ถอดวันด้วย `XLSX.SSF.parse_date_code` (tz-neutral) · split-xlsx เป็นแค่ snapshot CSV ไว้อ้างอิง
  ⚠️ **ห้ามเปิด cellDates** — จะโดน timezone เลื่อนวัน (เช่น 28 เม.ย. → 27 เม.ย. 17:00Z) เลขยื่นราชการผิด
- **พ.ศ. ใน serial**: `qu_expire` เก็บเป็น serial ปี 2569 (Thai BE) → `beToCe` (ปี>2500 ลบ 543) ในสาขา number/string
  (ปลอดภัยเพราะข้อมูลชุดนี้ไม่มีวันจริงเกินปี 2500 CE) · unit test ล็อกไว้ใน `clean.test.ts`
- **btbsales col3 = quNo** (ไม่ใช่ taxinvNo ตาม label หัวชีทที่ล้าสมัย) — ยืนยันจาก `Quotation.gs:166` (เขียน quNo ลง col3)
  → sales_order_items.qu_no = col3 · **แก้คำถามค้าง sec 11 เพิ่มเติม**
- **trigger ตอน import**: migration 0014 `fn_mig_set_triggers(false)` ปิด audit+stock trigger ตอน bulk (กัน edit_log บวม)
  → หลัง insert เปิดกลับ + `fn_mig_recompute_stock` สร้าง stock_product จาก log (ตาม plan 7.2) · **ไม่ import ชีท Stock_Product** (derive เอา)
- **rerun/overwrite**: `--fresh` → `fn_mig_truncate` (CASCADE ทุกตาราง migration ยกเว้น profiles/auth) · ไม่ใส่ --fresh + DB มีข้อมูล = หยุดเตือน
- **จุดพบในข้อมูลจริง** (audit ก่อนเขียน): tx type มีแค่ รายรับ/รายจ่าย · status ปกติ · apArStatus/entityId ว่าง→null/EID01 ·
  material/product/container FK ครบ · batch ไม่ซ้ำ · **transaction_items 2 orphan** (TR-20260517-0004, TR-20260607-0015) → skip ·
  **Entities/custdata แถวเปล่าเยอะ** (id เปล่า pre-fill) → filter ด้วยชื่อ · Settings col A `Account_List` ไม่มี kind → ข้าม
- **service role via supabase-js REST** (ไม่ใช้ direct pg) — ตรง plan sec 7.1 + pattern เดิม (upload-pdf-templates)

### D29 — type 'บันทึกภาษี' (ภาษีซื้อนำเข้า/ศุลกากร) — พบตอน migrate ไฟล์ที่ผู้ใช้แก้
- **ที่มา**: ไฟล์ accounting.xlsx รอบใหม่มี 5 แถว type "บันทึกภาษี" (เคลียร์ขวดนำเข้า/ศุลกากร VAT ~26k) ที่ไม่มีในระบบเดิม/ใหม่
- **ผู้ใช้เลือก**: เป็นภาษีซื้อ เข้า ภพ.30 แต่**ไม่กระทบเงินสด/ยอดบัญชี**
- **ทำ**: migration `0015` เพิ่ม 'บันทึกภาษี' ใน CHECK · `calc.ts taxReport` นับเป็น purchase เหมือนรายจ่าย (VAT=7% ของยอดรวม ตามกฎเดิม)
  · `ledger.txEffect` คืน 0 ให้ type นี้อยู่แล้ว → ไม่กระทบยอดบัญชีโดยไม่ต้องแก้ · golden test calc/ledger คุมไว้
- ⚠️ ยังไม่มี UI สร้าง 'บันทึกภาษี' ใหม่ในแอป (ปัจจุบันมาจาก migration เท่านั้น) — ถ้าต้องคีย์เพิ่มเองภายหลัง = เพิ่ม option ใน EntryTab

### D30 — คู่ค้าหลายสาขา (multi-branch) — พบตอน migrate (ไซมิส เทสท์ 7 สาขา)
- **ที่มา**: ลูกค้ารายเดียว เลขภาษีเดียว (`0105563164232`) มี 7 สาขา (คนละที่อยู่/เลขสาขา) ต้องออกเอกสารแยกสาขา
  · ระบบเดิมผูก contact ด้วย **ชื่อ** → ชื่อซ้ำไม่ได้ + ภพ.30/50ทวิ ดึงสาขาจาก `contactMap[ชื่อ]` = ได้สาขามั่ว (บั๊กที่ผู้ใช้เจอในระบบเก่า)
- **ผู้ใช้เลือก**: สร้างระบบหลายสาขาให้ถูกก่อน แล้วค่อย migrate
- **ทำ** (identity ย้ายจากชื่อ → contact_id):
  - `0016`: คลาย unique index `contacts` จากชื่อ → `(ชื่อ+สาขา)` · เพิ่ม `transactions.contact_id` (nullable FK → contacts)
  - `calc.ts`: `resolveContact` = ใช้ `contact_id` ก่อน แล้ว fallback ชื่อ (ภพ.30/ภงด. ได้สาขาถูก) · Tx เพิ่ม `contact_id?`
  - `data.ts loadContactMap`: key ทั้ง contact_id + name (ชื่อ = fallback ข้อมูลเก่า) · TX_COLS เพิ่ม contact_id
  - `0017`: recreate `fn_save_transaction`/`fn_save_installments` เก็บ `contact_id`
  - `EntryTab`: ชื่อคู่ค้าที่มีหลายสาขา → โผล่ dropdown เลือกสาขา → ส่ง contact_id ที่แน่นอน
  - `getWht50ContextAction`: resolve ตาม contact_id (ถ้ามี) + `.limit(1)` กัน error เมื่อชื่อซ้ำ
  - migration transform: dedup ด้วย **(ชื่อ+สาขา)** เก็บครบทุกสาขา · nameIndex คงสาขาแรกไว้ให้ฝั่งขาย remap ตามชื่อ
- **ข้อจำกัด**: รายการย้อนหลัง (source ไม่มีสาขา) → `contact_id` = null → fallback ชื่อ (สาขาเดา) · เอกสารที่ออก**ต่อจากนี้**เลือกสาขาได้ถูก
- golden test: calc.test D30 (resolve by id vs fallback name)

### D31 — supabase CLI ถูก Windows บล็อก → apply migration ผ่าน Dashboard SQL Editor
- **อาการ**: `npm run db:push` fail — `supabase.exe` รันไม่ได้ "An Application Control policy has blocked this file"
  (Windows 11 Smart App Control / Application Control บล็อก binary ที่ไม่ signed) · errno UNKNOWN/Permission denied
- **ทำ**: รวม 0014-0017 เป็น `migration/apply_migrations_0014-0017.sql` (idempotent + `notify pgrst 'reload schema'` ท้ายไฟล์)
  → ผู้ใช้ paste ใน Supabase Dashboard → SQL Editor → Run · **สำเร็จ** (verify: contact_id column + fn_mig_* เรียกได้)
- ⚠️ **schema_migrations history ไม่ถูกบันทึก** (apply มือ) — ถ้าแก้ CLI ได้ภายหลังแล้ว db:push อาจพยายาม re-apply
  → migration พวกนี้ทำ idempotent ไว้แล้ว (create or replace / if not exists / drop-if-exists)
- **migration 0016 ปรับ**: `create unique index if not exists` (รันซ้ำได้)
- **แก้แล้ว (2026-07-24)**: ผู้ใช้ปิด Windows Smart App Control → `supabase db push` ใช้ได้ · push 0013-0017 ซ้ำ
  = idempotent skip (NOTICE "already exists") ไม่กระทบ data (reconcile ยัง 26/0) · schema_migrations history ครบแล้ว
  → db:push ครั้งหน้าใช้ปกติ ไม่ต้อง paste dashboard อีก · `apply_migrations_0014-0017.sql` เก็บไว้เป็น reference เฉยๆ

### Phase 5 รันจริงสำเร็จ (2026-07-24)
- `migrate:import --fresh` เข้าครบ: 468 tx / 725 items / 116 log วัตถุดิบ / 29 batch / contacts 35 (7 สาขาไซมิส) /
  sales 7 order · recompute stock · seed counters (TR/TRF/QU/ORD)
- `migrate:reconcile` = **✅ 26/0**: row count ทุกตาราง · pivot dataset↔DB · stock=ชีท · batch unique
- **reconcile ปรับ**: ปัดรายแถวเป็น 2 ตำแหน่งก่อนรวม (ให้ตรง numeric(14,2) — sheet มี vat ทศนิยมเกิน 2 ที่ DB ปัดให้)
- **เหลือเทียบมือ** (ผู้ใช้): ยอดบัญชีทุกบัญชี + PDF ภพ.30/ภส. เดือนล่าสุด vs ที่ยื่นจริง

### D32 — warehouse ล้างทิ้ง (สุรา track ที่ production เท่านั้น) + go-live baseline (2026-07-27)
- **พบตอนใช้จริง**: `warehouse_stock`/`stock_moves` (จาก curstock/stockmove) มีแต่ **สุราท่าน้ำอ้อย (TNO3304001) วางผิดที่** + ขยะ (`df`) + แถวผี `ORD260529-001` (ไม่มีออเดอร์จริง = ตัวทำ stock เพี้ยน 348 vs 360)
- **จุดสำคัญ**: `fn_confirm_fulfillment` ตัด warehouse (ถ้า item อยู่ใน warehouse_stock) **และ** log_product (ถ้า category='สุรา') → สุราที่อยู่ทั้ง 2 ที่ = **ตัดสต็อกเบิ้ลตอนขาย**
- **ผู้ใช้ตัดสิน**: ล้าง curstock+stockmove ทั้งชีท (ธุรกิจไม่มีสินค้า non-สุรา) → สุรา track ที่ `log_product`/`stock_product` ที่เดียว (360)
  · warehouse_stock/stock_moves = feature เผื่อสินค้า non-สุราในอนาคต (ตอนนี้ว่าง)
- **แก้ UI**: `WarehouseTab` key รวม `category+itemCode` (กัน React duplicate-key เมื่อรหัสซ้ำข้ามระบบ)
- **แก้ reconcile**: ปัดรายแถว 2 ตำแหน่งก่อนรวม (ตรง numeric(14,2))
- **Phase 6 (cutover ทางการ) ข้าม** — ธุรกิจเพิ่งเริ่ม volume น้อย → soft launch: `--fresh` รอบสุดท้าย (2026-07-27, reconcile 26/0)
  = baseline ระบบจริง · **ห้าม --fresh อีก** · คีย์งานจริงในระบบใหม่ตั้งแต่นี้ · เก็บชีทเก่า read-only ไว้ archive/rollback

### D27 — ราคาขายแบบ "รวม VAT แล้ว" (VAT-inclusive) — เปลี่ยนจากระบบเดิมโดยเจตนา
- **ที่มา**: ผู้ใช้เจอ 3 ขวด (ราคาก่อน VAT 196.26) ได้ 629.99 ไม่กลม · ระบบเก่าได้ 630.01 (เก็บราคาเต็มทศนิยม
  196.2617 แต่ column ใหม่ `numeric(14,2)` ตัดเหลือ 196.26) · ผู้ใช้เลือก **"วิธี C"** = ตั้งราคารวม VAT
- **โมเดลใหม่** (`lib/sales/calc.ts`): `sale_menu.price` + ราคาตะกร้า = **ราคารวม VAT** (ที่ลูกค้าจ่ายจริง)
  - `grandIncl = Σ ราคารวม × qty` (กลมเป๊ะ · 3×210 = 630) · `grand = grandIncl − ส่วนลด(รวม VAT)`
  - ถอด VAT: `subDiscount(ก่อน VAT) = grand/1.07` · `vat = grand − subDiscount`
  - เก็บลง `sales_orders`: sub_total = grandIncl/1.07 (ก่อน VAT ก่อนลด), discount = ส่วนลดในรูปก่อน VAT
    (ให้ base−discount = subDiscount ตรงกับ path บัญชี FULL) · grand_total = grand (รวม VAT)
  - **S1 ไม่ต้องแก้** — เดิมก็ถอด VAT จากยอดรับอยู่แล้ว (accNet/1.07) → สอดคล้อง inclusive พอดี
  - **S4 (`toAccItem`) แก้**: inVat = ราคารวม, exVat = ราคา/1.07, total = exVat×qty
- **ผลกระทบ**: ต่างจากระบบเดิม (VAT-exclusive) → **ยกเว้นกติกา byte-compatible ข้อ 1 เฉพาะจุดนี้** (ผู้ใช้อนุมัติ)
  · ระบบเพิ่งเริ่มใช้ ยังไม่มีออเดอร์เก่า/ยังไม่ migrate ขาย → ไม่กระทบข้อมูลย้อนหลัง
  · golden test เขียนใหม่ (3×210=630) · print เปลี่ยนเป็น inclusive-first (line = ราคารวม, summary ถอด VAT)
- **สินค้านอกระบบ**: ผู้ใช้เลือกได้ว่าราคาที่กรอกเป็น "รวม VAT" หรือ "ก่อน VAT" (ก่อน VAT → ×1.07 เป็น inclusive ก่อนใส่ตะกร้า)
- **ไม่ต้อง migration**: ราคารวม VAT เป็นเลขกลม เก็บใน `numeric(14,2)` ได้พอดี (ไม่ต้องขยาย precision แบบวิธี B)

### D33 — Snapshot / Restore ในแอป (สำรอง/ย้อนข้อมูลทั้งระบบ)
- **ที่มา**: ผู้ใช้อยากมีปุ่ม "จับสภาพคลีน → ลองใช้เต็มที่ → ย้อนกลับ" (แทน --fresh ที่ย้อนได้แค่ baseline เดิม)
- **migration `0018`**: ตาราง `snapshots` (payload jsonb ทุกตาราง + row_counts) — **ไม่อยู่ใน fn_mig_truncate** (รอด truncate ตอน restore)
- **`lib/snapshot/engine.ts`** (server-only, admin client): dump ทุกตาราง (strip `id` bigserial — ไม่มี FK อ้าง id) · restore = fn_mig_truncate → ปิด trigger → insert ตาม FK order → เปิด trigger → recompute stock · stock_product ไม่เก็บ (recompute)
- **`/settings/data`** (main only, nav "💾 สำรองข้อมูล"): จับ/ดูรายการ/ย้อน/ลบ snapshot
- **guard (ตามที่ผู้ใช้เลือก)**: main (server verify) + **re-auth รหัสผ่านทุกครั้ง** (snapshot/restore/delete) ผ่าน signInWithPassword throwaway client (ไม่แตะ session เดิม) · **ตัดพิมพ์ยืนยันออก** (ผู้ใช้ขอแค่รหัส)
- **safety net**: restore ทำ **auto-snapshot สภาพปัจจุบันก่อนเสมอ** (is_auto) → กดผิดย้อนกลับได้ · + preview ผลกระทบ (diff row_counts) ก่อนกด
- service role อยู่ server-side (server action + `import server-only`) ไม่หลุด client · เก็บได้หลาย snapshot

### D34 — แก้บั๊ก: counter 'CONTACT' ไม่ถูก seed → เพิ่มลูกค้าชน contacts_pkey
- **อาการ**: เพิ่มลูกค้าใหม่ (ขาย/บัญชี) → `duplicate key ... contacts_pkey`
- **ต้นเหตุ**: ทั้ง `sales/actions.addContact` และ `accounting/actions.addContact` สร้าง `contact_id = 'C-' + next_serial('CONTACT')`
  แต่ migration counters seed แค่ TR/TRF/QU/ORD → **ลืม 'CONTACT'** → next_serial เริ่มที่ 1 → C-0001 ชน contact เดิม
  (แก้ความเข้าใจผิดใน D28 ที่เขียนว่า "contact เป็น max-based" — จริงๆ เป็น counter-based)
- **แก้**: (1) transform seed `CONTACT = max(C-####)` (ตอนนี้ = 35) · (2) แก้ DB live ทันที `counters.CONTACT=35` → เพิ่มถัดไป C-0036
- **BANK_ACC** (`ACC-###` ผ่าน next_serial): ไม่ชน เพราะบัญชี migrate ใช้ id เดิม (KBNK01/SCB01/CASH0x) ไม่ใช่ ACC-### → next_serial('BANK_ACC') เริ่ม 1 = ACC-001 ปลอดภัย
- ⚠️ counter 'CONTACT' อยู่ในตาราง counters (snapshot เก็บ + --fresh seed) → restore/re-run จะได้ค่าถูกต้อง
- **ตามด้วยบั๊กซ้ำ**: restore snapshot (จับก่อนแก้ counter) → โหลด counters ทับ → CONTACT กลับไปผิด
  → แก้ที่ `engine.restoreSnapshot`: หลัง restore เรียก `reseedIdCounters` คำนวณ CONTACT/BANK_ACC จาก max ข้อมูลจริงที่ restore
  (self-healing — snapshot เก่าก็ใช้ได้ ไม่ต้องจับใหม่) · fn migration `--fresh` seed CONTACT ตั้งแต่ transform อยู่แล้ว

### D35 — ปรับ UX หน้าบันทึก/แดชบอร์ด/ค้นบิล (แอปบัญชี) ตามผู้ใช้
- **ที่มา**: ผู้ใช้ขอปรับหลายจุดหลังใช้จริง (ไม่แตะสูตรเงิน/ภาษี — เฉพาะ UI + เพิ่มฟีเจอร์แก้บิล)
- **หน้าบันทึก (`EntryTab`)**:
  - หมวดหมู่ (บิล + รายการสินค้า): เปลี่ยนเป็น `input list=` (combobox พิมพ์ค้นได้) แบบเดียวกับคู่ค้า
  - ช่อง ชื่อสินค้า/หมวดหมู่/งาน ในรายการ: ดรอปดาวน์จากประวัติ (`getItemHistory` distinct จาก transaction_items สถานะปกติ)
    — โหลดตอนเข้า + **รีเฟรชหลังบันทึกทุกครั้ง** (บิลถัดไปเห็นค่าใหม่โดยไม่ต้องรีเฟรชหน้า)
  - ติ๊ก VAT **ออโต้ตามช่องเลขใบกำกับภาษี** (มีเลข→ติ๊ก, ว่าง→ไม่ติ๊ก) แต่ผู้ใช้ override เองได้ · default `hasVat=false`
  - **บิลล่าสุดของคู่ค้า** (`getRecentBillsByContact`, เทียบ legacy `getRecentTransactionsByContact`): เมื่อชื่อคู่ค้าตรงระบบ
    → โผล่แผง 5 บิลล่าสุด · กดแล้วเติม รายละเอียด+หมวดหมู่+**รายการทั้งใบ** (ปรับให้ดีกว่าเดิมที่เติมแค่ desc/หมวด)
  - **ค้างร่างที่ยังไม่บันทึก** ใน `localStorage` (`acc-entry-draft-v1`): สลับแท็บ/รีเฟรชแล้วข้อมูลไม่หาย · ล้างเมื่อบันทึกสำเร็จ
    + ปุ่ม **🗑️ ล้างฟอร์ม** (เลือกล้างเองได้ — ปลอดภัยกว่า "รีเฟรชเพื่อล้าง" ที่ผู้ใช้เสนอ เพราะกันข้อมูลหายด้วย)
  - **เลย์เอาต์**: ย้าย สรุปยอด/ออปชัน/เครื่องคิดถอด WHT ลงแถวล่าง (grid 3 คอลัมน์) → ตารางรายการสินค้าเต็มความกว้าง
    (แก้ปัญหาช่องกรอกแคบตอนเปิดคอลัมน์เสริม)
  - **จำนวนในรายการ**: type `number | ""` — กดลบเป็นช่องว่างให้กรอกใหม่ได้ (เดิมเป็น 0) · ตอนบันทึกช่องว่าง = 1
  - **เลขภาษีคู่ค้า**: บังคับ 13 หลัก (`cleanTaxId13`) ทั้ง modal หน้าบันทึก + หน้าตั้งค่า — ไม่ครบไม่ให้บันทึก (เก็บ digits ล้วน)
- **แดชบอร์ด (`DashboardTab` / `dashboardData`)**: รายรับ/รายจ่าย/กำไร แสดงด้วย **ยอดสุทธิ** (`net_amount`) แทน amount_after_discount
  — เพิ่ม `netIncome`/`netExpense` ใน dash (คง income/expense เดิมไว้ไม่ให้ golden test อื่นพัง) · อัปเดต calc.test A11
- **ค้นบิล (`BillsTab`)**: ปุ่ม **แก้ไข** → modal ฟอร์มแก้บิล → `updateTransactionAction` → `fn_edit_transaction` (migration **0019**)
  - แก้ได้เฉพาะบิลเดี่ยว รายรับ/รายจ่าย ที่ไม่ใช่กลุ่มงวด/โอน (RPC guard po_group_id/transfer_id ด้วย)
  - เขียนทับ field หลัก + แทนที่ items · **คงเดิม**: status/ap_ar_status/payment_date/po_group_id/transfer_id/source/receipt
  - **ไม่ re-forward ต้นทุนสุรา** (เหมือน legacy TxEdit.updateTransaction) — แก้สต็อกวัตถุดิบทำในแอปผลิต
  - audit อัตโนมัติผ่าน trigger `audit_transactions` (before/after → edit_log) ตามกติกา FLOW sec 10
- ✅ **apply migration 0019 ด้วย `npm run db:push` แล้ว** (2026-07-29 — supabase CLI ใช้ได้แล้ว ดู D31 ที่แก้)

### D36 — รีวิวทั้งแอป (Fable) → ชุด A (UX ลื่น) + ชุด B (กันข้อมูลผิด)
- **ที่มา**: รีวิว read-only ทั้ง 3 แอป (บันทึกใน `docs/APP_REVIEW_2026-07.md` — ไม่ push git ตามผู้ใช้) พบปัญหาอยู่ชั้น UI/data-fetch เป็นหลัก
- **ชุด A (perf/UX, commit 90c5599)**:
  - mount แท็บครั้งเดียวแล้วซ่อนด้วย CSS (lazy-once ผ่าน `visited` Set) ทั้ง 3 App → สลับแท็บ 0ms คงสถานะฟอร์ม
  - `loading.tsx` ทุก workspace (skeleton `_components/WorkspaceSkeleton`) → กดข้าม workspace ไม่ค้างจอ
  - เปิดหน้าต่างพิมพ์ **ก่อน await** ทุกจุด (ภพ.30/ภงด./50ทวิ/ใบเสนอราคา/เอกสารขาย) → กัน popup blocker มือถือ/iPad
- **ชุด B (correctness)**:
  - **P0 — query ไม่มี limit → PostgREST cap ~1000 แถวตัดเงียบ**: เพิ่ม `fetchAllTransactions`/`fetchAllOrders`
    วน `.range()` จนได้หน้าเปล่า (เลื่อนตามจำนวนจริง — ครบทุกแถวไม่ว่า max_rows เท่าใด) ใช้กับ dashboard/ยอดบัญชี/
    statement/ภพ.30/ภงด./AP-AR + ประวัติออเดอร์ · **ไม่แตะสูตร** แค่การันตีข้อมูลครบ
  - **แก้ยอดยกมาบัญชี (D23#3)**: `saveBankAccountAction` เปลี่ยนเป็น "มีชื่อ→update ตามชื่อ, ไม่มี→insert"
    (เลิก gen id ใหม่ที่ชน unique `account_name`) + SettingsTab replace แถวแทน append (กัน state ซ้ำ)
- **Freshness (แก้ผลข้างเคียงของ lazy-once)**: แท็บที่ mount ค้างไม่ refetch เอง → หลัง mutation อีกแท็บอาจเห็นเลขเก่า
  - **แก้แบบ stale-while-revalidate**: ส่ง prop `active` (แท็บนี้กำลังแสดงไหม) ให้ทุกแท็บที่โหลดข้อมูล
    (บัญชี: Dashboard/Accounts/ApAr/Bills/TaxDocs · ขาย: Orders/Warehouse/Menu/Sync) → refetch เมื่อ active
    แต่ **โชว์ข้อมูลเดิมค้างไว้ระหว่างโหลด** (`firstLoad` ref กัน loading flash หลังครั้งแรก) → ลื่น + สด
  - inactive tab ไม่ fetch → เปลี่ยนเดือน/กิจการไม่ยิง burst ทุกแท็บที่ mount ค้าง
  - **#9 cache รายการออเดอร์ค้าง**: `OrdersTab.refresh()` เรียก `itemsCache.clear()` → พิมพ์หลังแก้ใบเสนอราคาได้รายการล่าสุด
- **ยังไม่ทำ** (ชุดถัดไป): bundle 634 kB (dynamic import pdf-lib) · mobile card layout 3 หน้าหลัก · แก้/ลบ log ผลิต · resume หม้อกลั่น

### D37 — Quick wins จากรีวิว (UI/perf, ไม่แตะสูตร)
- **บั๊กพิมพ์ทศนิยม 0.03**: NumBox ครอบช่องเงินที่เหลือ — โอนเงิน (AccountsTab), ยอดยกมา (SettingsTab),
  ส่วนลด/สินค้านอกระบบ (QuotationTab), ราคาเมนู (MenuTab) · เพิ่ม NumBox เข้า `sales/ui.tsx` · + `inputMode=decimal` ใน NumInput ทั้ง 3 โดเมน
- **#3 code-split pdf-lib**: แยกค่าคงที่ path เป็น `lib/pdf/keys.ts` (WHT_TEMPLATE_KEY/FONT_KEY ไม่ดึง pdf-lib)
  + TaxDocsTab `await import("@/lib/pdf/wht50")` ตอนกดพิมพ์ → **/accounting First Load JS 635→131 kB** (wht50/excise re-export keys คงเดิม)
- **#7 กัน "ทุกกิจการ" บันทึกเข้ากิจการผิดเงียบ**: EntryTab รับ `ambiguous` → header=ALL แสดง Select บังคับเลือกกิจการ (สีเตือน) · header ปกติแสดง badge "📍 บันทึกเข้ากิจการ: EIDxx" · ใช้ `effEntity` แทน entityId ทุกจุด
- **mapDbError** (`lib/shared/dbError.ts`): แปล SQLSTATE (23505/23503/23502/42501…) เป็นไทย · แทน `fail(error.message)` ทั้ง accounting+sales actions
- **แบ่งงวด**: `listInstallmentGroups` → dropdown เลือกกลุ่มงวด (เลิกพิมพ์รหัส TR- เอง) + ปุ่ม refresh
- **เล็ก ๆ**: Ctrl+Enter บันทึก (หน้าบันทึก) · ปุ่ม ‹เดือนก่อน/ถัดไป› ข้าง month picker · searchBills เตือน "500 รายการแรก" · ซ่อนปุ่มแก้/ยกเลิกในค้นบิลเมื่อ role≠main · แทน alert() ด้วย Msg (QuotationTab) · แก้ hint 50ทวิ ล้าสมัย
- **ยังเหลือ** (ไม่ใช่ quick win): validate ไฮไลต์ช่องผิด · Enter-เพิ่มแถว (ชน datalist) · report_runs checklist UI · prefill มัดจำตอนแก้ใบเสนอราคา · mobile card layout · แก้/ลบ log ผลิต

### D38 — Mobile/tablet responsive (จากรีวิว)
- **แพทเทิร์น**: `hidden md:block` (ตาราง desktop) + `md:hidden` (การ์ด mobile) → เดสก์ท็อปไม่เปลี่ยน · การ์ดเห็นเฉพาะ < 768px
- nav + แถบแท็บทั้ง 3 แอป: `flex-wrap` → `overflow-x-auto` (เลื่อนแนวนอน ไม่ห่อสูง) + ปุ่ม `shrink-0 whitespace-nowrap`
- **card layout ต่อรายการ** (แชร์ handler เดิม สกัดปุ่มเป็น render fn): จัดการออเดอร์ (`orderActions`), ค้นบิล (`billActions`),
  รายการสินค้าหน้าบันทึก (การ์ด 2 คอลัมน์) · ปุ่ม action ใหญ่ขึ้น (ActBtn 11px→text-xs, ปุ่มค้นบิลมีขอบ)
- ใบเสนอราคา: แถบตะกร้าลอยล่างจอ (`fixed bottom lg:hidden`) — เพิ่มของแล้วเห็นยอด + กระโดดไปตะกร้า (cartRef scrollIntoView)
- **ยังเหลือ**: nav แบบ bottom-tab เต็มรูปแบบ (ตอนนี้แค่ scroll) · touch target บางจุดยังต่ำกว่า 44px

### D39 — แอปผลิต: แก้/ลบ log จากแอป (ปิดช่องกติกาเหล็ก "ทุกจุดบันทึกได้ต้องแก้/ลบได้")
- **ที่มา**: รีวิว #6 — log ผลิตแก้/ลบจากแอปไม่ได้ (พิมพ์ผิดต้องเข้า Supabase) · หลังบ้านพร้อม (RLS main + stock trigger DELETE + edit_log)
- **ติดตามหมัก** (`log_ferment_monitor`): แก้ inline (✏️) + ลบ (🗑️) ต่อแถว — `update/deleteFermentMonitorAction` · getFermentMonitor เพิ่ม `id`
- **กลั่น** (`log_distill_run`): **resume หม้ออัตโนมัติ** (แก้ #5 phantom) — เลือก batch → หม้อล่าสุดที่ยังไม่มี "จบหม้อ" = activeRun ให้เลย (ใช้ run_id เดิม ไม่แตะสูตร P8) · + ลบ reading ต่อแถว · RunRow เพิ่ม id/run_id
- **วัตถุดิบ/ปรุง/บรรจุ** (`log_material`/`log_dilute`/`log_product`): เพิ่มการ์ด "รายการล่าสุด 30" + ปุ่มลบ
  (แก้ = ลบแล้วบันทึกใหม่) — `getRecent*Action` + `delete*LogAction` · stock: log_product trigger ปรับเอง · material/dilute คิดตอนอ่าน
- **ยังไม่ทำ — FermentTab (ลงหมัก `log_ferment`)**: ลบ batch ต้องมี RPC ย้อนเบิกวัตถุดิบ + จัดการแถวลูก (monitor/distill) — เสี่ยง เลื่อนเป็นงานแยก
- **แก้ inline เต็มรูปแบบ** ของ material/dilute/product: ยังเป็น "ลบ+บันทึกใหม่" (delete พอสำหรับแก้ typo) — edit inline ทำเพิ่มได้ภายหลัง

### D40 — เก็บ loose ends จากรีวิว (quick wins 2 + mobile 2)
- **หน้าบันทึก**: Enter ในช่องตัวเลข (ไม่ใช่ช่อง datalist) = เพิ่มแถวรายการ · validate ล้มเหลว → ไฮไลต์ช่องผิดสีแดง (กิจการ/หมวดหมู่/บัญชี/รายการ) + `scrollIntoView` ไปหา (errField + refs)
- **nav bottom-tab มือถือ**: `md:hidden` fixed bottom (workspace + ตั้งค่า/สำรอง) · ลิงก์ด้านบนซ่อนบนมือถือ (`hidden md:flex`) · layout เพิ่ม `pb-24 md:pb-0`
- **EditBillModal**: เต็มจอบนมือถือ (`min-h-dvh rounded-none`) → dialog กลางจอบน `sm:` ขึ้นไป
- ครบงานจากรีวิว (ยกเว้นที่จดว่าเลื่อน: ลบ batch หมัก · edit inline log ผลิต · prefill มัดจำแก้ใบเสนอราคา · เลข INV/TAX ใน RPC)

### D41 — ลบ batch หมัก + ช่องปริมาณต่อถัง (ปิดช่องสุดท้ายกติกาเหล็ก)
- **ลบ batch หมัก** (migration **0020** `fn_delete_ferment_batch`): ในทรานแซกชันเดียว — คืนวัตถุดิบ (ลบ log_material เบิก
  `doc_ref=batch, note='เบิกไปหมัก (อัตโนมัติ)'`) → ลบ log_ferment_monitor → ลบ log_ferment ทุกถัง
  - **GUARD**: batch ที่มี `log_distill_run`/`log_distill` (กลั่นแล้ว = ข้อมูล ภส.) → บล็อก ห้ามลบ
  - SECURITY INVOKER (RLS main) · edit_log audit · UI: FermentTab การ์ด "batch ล่าสุด" + ปุ่มลบ
  - **ต้อง `npm run db:push` apply 0020 ก่อนใช้**
- **ปริมาณต่อถัง (volPerTank)**: เพิ่มช่องในลงหมัก (ดูแอปเดิม `_js_entry.html` calculateMainMaterial) — เลือกภาชนะ→เติมความจุอัตโนมัติ (แก้ได้)
  · **วัตถุดิบหลัก (แถวแรก) = ปริมาณต่อถัง × จำนวนถัง** อัตโนมัติ แก้ทับเองได้ · **ไม่เก็บเป็นคอลัมน์** (report ย้อนคำนวณจาก material หลัก/qty เหมือนเดิม — byte-compatible)
- **จบกติกาเหล็ก** "ทุกจุดบันทึกได้ต้องแก้/ลบได้" ครบทุก log แล้ว

### D42 — ปิดงานที่เหลือทั้งหมดจาก APP_REVIEW_2026-07 (multi-branch, กระดาน batch, PWA, รวม ui)
**migration 0021** (`20260801000021_multibranch_and_quotation_terms.sql`) — ต้อง `npm run db:push` ก่อนใช้

- **คู่ค้าหลายสาขาชื่อเดียวกัน (ต่อจาก D30) — audit ทั้ง repo เจอช่องโหว่ที่เหลือ 3 จุด แก้ครบ**
  1. **รายรับจากขาย ไม่เก็บ `contact_id`** (bug จริง ผลกระทบสูงสุด): `fn_apply_order_action` insert `transactions`
     โดยไม่มี contact_id → `resolveContact()` ของ ภพ.30/ภงด. fallback ชื่อ = ได้ **taxId/สาขาแรก** เสมอ
     → เลขยื่นสรรพากรผูกผิดสาขา · แก้: `RevenuePayload.contactId` (lib/sales/orders) → RPC insert `contact_id`
     + **backfill** ข้อมูลเดิมจาก `sales_orders.customer_id` ผ่าน idempotency_key · golden test เพิ่ม 2 เคส (180 เทส)
  2. **50ทวิ**: `wht_certificates` เพิ่มคอลัมน์ `contact_id` (nullable) · `fn_issue_wht` รับ `p_contact_id`
     · `DashPending.contactId` → บันทึกตอนออกใบ → **พิมพ์ซ้ำได้สาขาถูก** · ใบเก่า = null → fallback ชื่อเหมือนเดิม
     · backfill เฉพาะชื่อที่ตรงคู่ค้ารายเดียว (ชื่อซ้ำ = ไม่เดา ปล่อย null — ไม่เดาข้อมูลราชการ)
  3. **เครดิตเทอมออเดอร์**: `OrdersTab` หาลูกค้าด้วย `customerId` (fallback ชื่อ) → dueDate ไม่ผิดสาขา
     · **บิลล่าสุดของคู่ค้า** (`getRecentBillsByContact`) กรองด้วย contact_id เมื่อรู้สาขา
  - *จงใจคงไว้ตามเดิม*: ค้นบิล / ประวัติราคา / dashboard จัดกลุ่มด้วย **ชื่อ** — ผู้ใช้ค้นด้วยชื่อและอยากเห็นรวมทุกสาขา
- **ขาย — แก้ใบเสนอราคา prefill ครบ**: `sales_orders` เพิ่ม `is_deposit` / `deposit_percent` (เก็บเงื่อนไขมัดจำ)
  · prefill `saleName`/`isDeposit`/`depositPct` ตอนกดแก้ (เดิม saleName ค้างค่าเก่าแล้วทับ `sale_name` ในออเดอร์)
  · `fn_update_quotation` อัปเดต `customer_id`/`customer_name` ด้วย (เดิมเปลี่ยนลูกค้าตอนแก้แล้วถูกเมินเงียบ ๆ)
  · พิมพ์ใบเสนอราคาซ้ำได้ผู้เสนอราคา/เครดิตเทอมจริง (เดิม hardcode "" และ 0)
- **ผลิต — กระดาน batch (FLOW sec 3) + batch ร่วมข้ามแท็บ**: แท็บแรกใหม่ "กระดาน batch" (`getBatchBoard`)
  การ์ดละ batch บอกขั้น (ลงหมัก/ติดตามหมัก/กำลังกลั่น/ปิดแล้ว) + ค่าวัดล่าสุด + หม้อที่ยังไม่จบ + ปุ่มกระโดดไปแท็บที่ถูก
  · `batch` ยกเป็น state ของ `ProductionApp` แชร์ MonitorTab/DistillTab (เลือกครั้งเดียวใช้ทุกแท็บ)
- **ผลิต — แก้ inline เต็มรูปแบบ** (ปิดของที่ค้างจาก D39): `log_material`/`log_dilute`/`log_product` มีปุ่ม ✏️ แก้ในตาราง
  (`update*LogAction`) — เลิก "ลบแล้วบันทึกใหม่" · `getRecentDilutes` เพิ่มคอลัมน์ `water` ที่ขาด
- **report_runs checklist** (FLOW sec 6 — ตารางมีมาตั้งแต่ 0005 แต่ไม่เคยมี UI อ่าน): คอมโพเนนต์ร่วม
  `app/(app)/_components/ReportChecklist` แสดง ✅/⬜ + วันที่สร้างล่าสุด — ใช้ในแท็บเอกสารสรรพากร (ภพ.30/ภงด.)
  และ /reports (ภส. 4 ฟอร์ม · เพิ่ม `markExciseRunAction` ตอนสร้าง PDF สำเร็จ)
- **รวม ui.tsx 3 ชุด → `lib/shared/ui.tsx`**: ตรรกะที่ต้องเหมือนกันเสมอ (NumBox buffer ทศนิยม, Combobox คีย์บอร์ด,
  useSaver, fmt) อยู่ที่เดียว · ต่างกันแค่ `accent` (slate/amber) · ไฟล์เดิมของ 3 โดเมนเหลือ re-export → **import เดิมไม่ต้องแก้**
  · ผลพลอยได้: ผลิตได้ NumBox/Combobox ที่แก้บั๊กแล้วฟรี · production `TextInput` เดิม **ทิ้ง className ที่ส่งเข้ามา** (บั๊กเงียบ) → แก้แล้ว
- **สกัด EditBillModal ซ้ำ → `accounting/_components/billItems.ts`**: `makeItemHandlers` (in↔ex VAT, ส่วนลด %↔บาท),
  `buildItemInputs`, `useBillAmounts` (โหมดแก้ยอดเอง) ใช้ร่วม EntryTab + EditBillModal — สูตรจริงยังอยู่ `lib/accounting/calc`
  · ตัดโค้ดซ้ำ ~150 บรรทัด กัน "เลขตอนแก้ ≠ เลขตอนสร้าง"
- **เทสชั้น data-access (ที่รีวิวบอกว่าไม่มีเลย)**: ย้าย pagination เป็น `lib/shared/paginate.ts` (บริสุทธิ์ เทสได้)
  + **ตรวจยอดกับ `count: "exact"` แล้ว throw ถ้าได้ไม่ครบ** (ดีกว่าปล่อยเลขขาดขึ้น ภพ.30) · 7 เทส
  · ใช้ทั้ง `accounting/data.ts` (transactions) และ `sales/data.ts` (orders)
- **scan rate-limit ตามเวลาไทย**: `lib/shared/datetime.ts` (`bangkokDayStartUTC`) — เดิม `setHours(0,0,0,0)` บน UTC
  = โควตารีเซ็ต 7 โมงเช้าไทย · 4 เทส
- **อื่น ๆ**: `app/(app)/error.tsx` + `app/global-error.tsx` ภาษาไทย + ปุ่มลองใหม่ (เดิมจอขาว Next default)
  · ฟอนต์ไทย **self-host** ด้วย `next/font/google` Noto Sans Thai (เดิมพึ่งฟอนต์ในเครื่อง — Windows ไม่มี)
  · **PWA**: `app/manifest.ts` + `public/icon.svg|icon-192|icon-512|apple-icon` (ติดตั้งลงโฮมสกรีนได้ ยังไม่ทำ offline)
  · touch target ≥44px บนจอเล็กใน SaveButton/RowBtn/ActBtn/ปุ่มค้นบิล + แยก "ยกเลิก" ออกจาก "แก้ไข"
- **ตัดสินใจ: ไม่ย้ายการออกเลข INV/TAX เข้า RPC** (ผู้ใช้อนุมัติ) — เดิม `processOrderActionAction` gen เลขก่อนเรียก
  `fn_apply_order_action` ถ้า RPC fail เลขใบกำกับข้ามเบอร์
  - **เหตุผลที่ไม่ทำ**: `revenue.taxInvoiceNo` มาจาก `taxDocNo()` (ลำดับ taxNo2 > taxNo1 > invNo) ใน `lib/sales/orders`
    ซึ่งมี golden test คุม — ย้ายเข้า RPC ต้องเขียนลำดับนี้ซ้ำใน SQL = เสี่ยง drift กับ lib มากกว่าปัญหาที่แก้
  - **ผลที่ยอมรับ**: RPC fail (แทบไม่เกิด — เกิดเฉพาะ DB ล่ม/สิทธิ์ไม่พอ) แล้วเลขข้าม 1 เบอร์
  - **ถ้าเกิดจริงทำยังไง**: เลขที่ข้ามอธิบายกับสรรพากรได้ (เอกสารยกเลิก/ไม่ได้ใช้) — บันทึกเหตุไว้
    หรือแก้เลขในออเดอร์เองจาก Supabase (`sales_orders.inv_no/tax_no1/tax_no2`) ก่อนพิมพ์เอกสาร

### D43 — Design system "เหล็กกล้า" + white-label (เฟส 1 ของงานปรับหน้าตาเพื่อขาย)
**กติกาเต็มอยู่ที่ `docs/DESIGN_SYSTEM.md`** — ต้องอ่านก่อนแตะ UI · migration **0022** (ต้อง `npm run db:push`)

- **ที่มา**: ผู้ใช้จะขายแอปให้โรงกลั่นเจ้าอื่น → ต้องดู "เป็นสินค้า" ไม่ใช่เครื่องมือทำใช้เอง
  · เสนอ 3 ทิศทาง (คมชัด/ทองแดง/ห้องคุม) → เลือก **ห้องคุม** · เสนอต่ออีก 5 โทนสี → เลือก **เหล็กกล้า**
  · เหตุผลที่เลือกเหล็กกล้า: UI พื้นฐานเป็นเทาล้วน สีแบรนด์แตะแค่ 4 จุด → **เปลี่ยนสีให้ลูกค้าแต่ละรายได้ง่ายสุด**
- **Token (Tailwind v4 `@theme` ใน `app/globals.css`)**: page/card/nav/input/raised · line/line-soft ·
  ink/muted/faint · ok/warn/crit (×3 เฉด) · brand/on-brand/brand-soft/brand-line · grid/series/overlay/chart-1..8
  - **โหมดมืดเป็นค่าคนละชุด ไม่ใช่การกลับสี** — เขียว `#1a7f52`↔`#4fb07c` · ตัวหนังสือโหมดมืดไม่ใช่ขาวล้วน (กันล้าตาตอนคีย์บิล)
  - **สีสถานะล็อกตายทุกกิจการ** ลูกค้าเปลี่ยนไม่ได้ — "เหลือง = ค้าง" ต้องแปลเหมือนกันทุกโรงเวลาสอนงานทางโทรศัพท์
- **โหมดสว่าง/มืด**: เก็บที่ **cookie** (`insep-mode`) ไม่ใช่ localStorage → server รู้ตั้งแต่ render แรก **ไม่กะพริบขาว**
  · root layout อ่าน cookie → `<html data-mode>` · ปุ่มสลับใน nav เปลี่ยน attribute ทันทีไม่ต้องโหลดใหม่
- **white-label** (migration 0022): `brand_name` / `brand_color` / `logo_url` / `default_mode` ใน `app_settings`
  - **เก็บ "ชื่อชุดสี" ไม่ใช่ hex** — แต่ละชุดมีค่าคู่ สว่าง/มืด ที่ตรวจ contrast แล้ว (7 ชุด)
    ถ้าให้กรอก hex เอง ลูกค้าเลือกเหลืองมะนาว = ตัวหนังสือบนปุ่มอ่านไม่ออก = งานซัพพอร์ตของเรา
  - แก้จากแอปได้ที่ บัญชี → ตั้งค่า → การ์ด "แบรนด์ของกิจการ"
  - ⚠️ **กับดัก selector**: `data-mode` อยู่บน `<html>` แต่ `data-brand` อยู่บน div ใน `(app)/layout`
    (กว่าจะรู้แบรนด์ต้อง login) → `[data-mode="dark"][data-brand="x"]` **ไม่ match** ต้องเขียนคู่กับแบบลูกหลานด้วย
    · เจอตอนตรวจ computed style ในเบราว์เซอร์จริง ไม่ใช่จาก build (build ผ่านทั้งที่สีผิด)
- **ไอคอนแทนอิโมจิ** (`lib/shared/icons.tsx`): SVG เส้น 24 ตัว สืบสีจาก `currentColor` วาดเอง (ไม่เพิ่ม dependency)
  · อิโมจิเปลี่ยนหน้าตาตาม OS + ปรับสี/ขนาดไม่ได้ + ตอนเดโมขายดู "ทำเล่น"
  · เปลี่ยนเฉพาะที่เป็น **ปุ่ม/ไอคอนใช้งาน** — อิโมจิในข้อความอธิบายปล่อยไว้ (อ่านเป็นเครื่องหมายวรรคตอน)
- **sweep คลาสสีทั้งแอป**: 618 slate + ~250 สีอื่น ใน 40 ไฟล์ → token (สคริปต์แมป + เก็บตกด้วยมือ)
  · **ยกเว้นไฟล์เอกสารพิมพ์**: `print.ts`, `reportHtml.ts`, `lib/pdf/*` — ต้องดำบนขาวเสมอ
    ไม่งั้นเปิดโหมดมืดแล้วสั่งพิมพ์ = กระดาษพื้นดำ
- **ปุ่ม 7 สี → 3 ระดับ** (`OrdersTab`): เดิม amber/indigo/purple/blue/teal/slate/red = ตาลาย แยกไม่ออกว่าอันไหนสำคัญ
  → primary (ควรทำต่อ) / secondary (ทำได้) / danger (ทำลาย) · `StatusBadge` แมปสถานะเป็นความหมาย ไม่ใช่สีสุ่ม
- **กราฟ** (`lib/shared/chart.ts`): 8 สีชุดกราฟมีคู่ สว่าง/มืด · **ห้ามใช้เขียว/แดงในกราฟ** (สงวนให้สถานะ)
  · เดิม hardcode `#7c3aed` ฯลฯ ซึ่งจมพื้นในโหมดมืด
- **polish (ทำต่อทันทีในรอบเดียวกัน)**:
  - **component ตารางกลาง** `.tbl` ใน layer `components` → utility ราย cell ยังทับได้ · แปลง 33 ตารางใน 24 ไฟล์
    (+ `TableWrap`/`Empty` ใน lib/shared/ui) · ลบ `p-1/px-2 py-1/text-left` ที่เขียนซ้ำราย cell ทิ้ง
  - **อิโมจิเหลือ 5 จุดที่ตั้งใจเก็บ** (`↔` ในคอมเมนต์ 4 + `⚠️` ใน global-error ที่ใช้ inline style)
  - **radius เหลือ 3 ค่า**: rounded / rounded-lg / rounded-full (ยุบ rounded-2xl/xl 23 จุด)
  - **สีดิบเหลือ 0 บรรทัด** ในโค้ด UI (เช็คด้วย grep ที่จดไว้ใน DESIGN_SYSTEM)
  - ⚠️ **บั๊กจาก sweep ที่จับได้**: ปุ่มสแกนใบเสร็จกลายเป็น `bg-brand text-brand` = ตัวหนังสือหายไปกับพื้น
    (เกิดจาก map สีอัตโนมัติ) → เขียนสคริปต์ไล่หาคู่ bg/text ที่เป็น token เดียวกัน แล้วแก้เป็นปุ่มรอง
  - ⚠️ **บทเรียนสคริปต์**: รอบแรกใช้ `replace(/s+"/g, ...)` แบบ global ไปกิน string literal ทั้งไฟล์
    (`from "react"` → `from"react"`) — ต้อง revert แล้วเขียนใหม่ให้แก้ "ภายในค่า className" เท่านั้น
- **ยังเหลือจริง**: อัปโหลดโลโก้เข้า Storage (ผู้ใช้ยังไม่มีโลโก้ — เมื่อมีค่อยเพิ่ม bucket + ปุ่มอัปโหลด)

### D44 — เอกสารการค้าอ่านข้อมูลผู้ขายจาก DB (ปลดตัวบล็อกการขาย · migration 0023)

**ปัญหา**: `app/(app)/sales/_components/print.ts` มี constant `COMPANY` ที่ hardcode ชื่อบริษัท ที่อยู่
เลขประจำตัวผู้เสียภาษี และ **เลขบัญชีธนาคาร** ของโรงกลั่นเจ้าของโค้ด → ถ้าขายให้โรงอื่นทั้งอย่างนี้
ลูกค้าออกใบเสนอราคา/ใบกำกับภาษี/ใบเสร็จ จะได้หัวกระดาษเป็นชื่อ+บัญชีของคนอื่น
(**เงินโอนเข้าผิดบัญชี · ใบกำกับภาษีผิดนิติบุคคล = ผิดกฎหมาย**) — ฟอร์มราชการไม่กระทบเพราะอ่าน `entities` อยู่แล้ว

**ตัดสิน**:
- เก็บที่ **ตาราง `entities`** ไม่ใช่ `app_settings` — เพราะเป็นข้อมูล "ต่อนิติบุคคล" และ ภพ.30/ภงด./50ทวิ/ภส.
  อ่านตารางนี้อยู่ก่อนแล้ว → **แก้ที่เดียว หัวเอกสารทั้งระบบตรงกัน** (ถ้าแยกที่เก็บ จะเพี้ยนกันวันใดวันหนึ่งแน่)
- migration 0023 เพิ่ม 3 คอลัมน์ที่ยังไม่มี: `name_eng` · `phone` · `bank_line` (หลายบรรทัดได้)
- **กิจการไหนเป็นคนออกเอกสาร** = `app_settings.sales_doc_entity` (ค่าใหม่)
  — แยกจาก `sales_revenue_entity` (กิจการที่ลงบัญชีรับเงิน) โดยตั้งใจ: ส่วนใหญ่ตัวเดียวกัน
  แต่คนมีหลายนิติบุคคลต้องเลือกได้ว่าหัวกระดาษเป็นชื่อใคร · ไม่ได้ตั้ง → fallback `sales_revenue_entity`
- **ไม่ได้ตั้ง + มีหลายกิจการ = ไม่เดาให้** (`pickDocEntity` คืน null) → ตอนกดพิมพ์ขึ้น alert บอกให้ไปตั้งค่า
  แทนที่จะพิมพ์หัวกระดาษเปล่าหรือหัวของนิติบุคคลผิดตัว · มีกิจการเดียวถึงจะเลือกให้อัตโนมัติ
- ตรรกะ "ประกอบข้อความ" อยู่ที่ `lib/sales/company.ts` (ไม่มี HTML/DB) + golden test S9 22 เทส —
  รูปแบบทุกบรรทัดต้องเท่าของเดิม: `"(สำนักงานใหญ่) <ที่อยู่>"` · `"เลขประจำตัวผู้เสียภาษี (Tax ID): x | โทร: y"`
- ช่องว่างที่กรอกไม่ครบ **ยุบทิ้ง ไม่ทิ้งบรรทัด/ตัวคั่นค้าง** (ไม่มีชื่ออังกฤษ = ไม่มี `<br>` เปล่า ·
  ไม่มีเบอร์โทร = ไม่มี ` | ` ค้าง · ไม่มีเลขบัญชี = ไม่ขึ้นกล่อง "ช่องทางการโอนเงิน")
- UI: บัญชี → ตั้งค่า → การ์ด **"ข้อมูลบนเอกสารการค้า"** — มี **ตัวอย่างหัวกระดาษจริง** ใต้ฟอร์ม
  (เรียก `companyHeaderPreviewHtml` ตัวเดียวกับตอนพิมพ์ → เห็นอย่างไรได้อย่างนั้น พื้นขาวเสมอไม่ตามธีม)
  · จุดนี้จำเป็นเพราะที่อยู่กับสาขาถูกประกอบกัน — ถ้าที่อยู่ใน DB มีคำว่า "สำนักงานใหญ่" อยู่แล้วจะเห็นซ้ำทันที
- ค่าที่เคย hardcode **ไม่ย้ายเข้า migration** (ไม่ seed ข้อมูลบริษัทจริงลง repo ที่จะขายต่อ) → ผู้ใช้กรอกเองครั้งเดียว
- **ยังไม่ทำ**: โลโก้บนหัวเอกสาร (รอผู้ใช้มีโลโก้ก่อน — จะทำให้ layout ขยับ ต้องเทสรอบใหม่)

### D45 — ใบแจ้งหนี้ค่ามัดจำ (วางบิลก่อนรับเงิน · migration 0024)

**ปัญหา (เคสจริง)**: เสนอราคาแบบ "มัดจำ 50%" (เงื่อนไขอยู่ในหมายเหตุใบเสนอราคา) ลูกค้าขอ
**ใบแจ้งหนี้ของยอดมัดจำ** เพื่อตั้งเบิกก่อนโอน — แต่แอปมีแต่ปุ่ม "ใบแจ้งหนี้ (เต็ม)" กับ
"รับมัดจำ & ส่งคลัง" ที่สมมติว่า **เงินเข้าแล้ว** → ไม่มีทางออกเอกสารเรียกเก็บค่ามัดจำ

**ตัดสิน**:
- เพิ่ม action `ISSUE_INVOICE_DEPOSIT` + สถานะ **`รอชำระมัดจำ`** (คู่ขนานกับ `ISSUE_INVOICE_FULL`
  → `รอชำระเงิน (จ่ายเต็ม)` ที่มีอยู่แล้ว) · จากสถานะนี้กด "รับมัดจำ & ส่งคลัง" (`DEPOSIT_AND_SEND`)
  ต่อได้ตามท่อเดิมทุกบรรทัด — **ไม่แตะสูตรเงิน/ภาษี/idempotency ใด ๆ**
- **ไม่ลงบัญชี ตอนออกใบแจ้งหนี้** (`revenue: null`) — cash basis ของระบบ + จุดความรับผิด VAT
  เกิดเมื่อรับชำระ/ส่งมอบ · ใบกำกับภาษีค่ามัดจำยังออกตอนรับเงินจริงเหมือนเดิม
- **คอลัมน์ใหม่ `dep_inv_no` / `dep_inv_date` / `dep_inv_amount` / `dep_due_date`** ห้ามใช้
  `inv_no`/`doc_date1` ร่วม — สองช่องนั้นเป็นของใบแจ้งหนี้+ใบกำกับภาษีตอนส่งของ ถ้าทับ = วันที่เอกสารเพี้ยน
- เลขเอกสาร: **ชุด `INV` เดียวกัน** (ผู้ใช้เลือก) — ใบมัดจำกับใบตอนส่งของได้คนละเลข เรียงเล่มเดียว ตรวจง่าย
- **หัวเอกสารเป็น "ใบแจ้งหนี้ / Invoice" เฉย ๆ ไม่มีคำว่า "(ค่ามัดจำ)" และไม่มีบรรทัด
  "เอกสารนี้ไม่ใช่ใบกำกับภาษี"** (ผู้ใช้เลือก) — ปลอดภัยเพราะใบกำกับภาษีตาม ม.86/4 บังคับให้มีคำว่า
  "ใบกำกับภาษี" บนเอกสาร ในเมื่อไม่มีคำนั้นก็เอาไปเคลม VAT ไม่ได้อยู่แล้ว ·
  กันสับสนกับใบตอนส่งของด้วย: เลข INV คนละใบ + แถว **"ยอดชำระมัดจำ 50% สุทธิ"** +
  แถว "คงเหลือเรียกเก็บเมื่อส่งมอบสินค้า" (และใบที่สองมีแถว "หัก มัดจำรับแล้ว" อยู่แล้ว → ยอดไม่ซ้ำ)
- **ลำดับแถวสรุปยอด — ห้ามสลับ** (ผู้ใช้ถามว่าควรเอา "หัก ณ ที่จ่าย" ขึ้นก่อน "ยอดรวมทั้งสิ้น" ไหม → **ไม่**):
  `รวมเป็นเงิน (รวม VAT)` → `มูลค่าสินค้า (ก่อน VAT)` → `ภาษีมูลค่าเพิ่ม 7%` → **`ยอดรวมทั้งสิ้น`**
  → `หัก ณ ที่จ่าย x%` → `ยอดสุทธิ` → **`ยอดชำระมัดจำ x% สุทธิ`** → `คงเหลือเรียกเก็บเมื่อส่งมอบสินค้า`
  · เหตุผล: "ยอดรวมทั้งสิ้น" = มูลค่าสินค้า + VAT เสมอ (บังคับบนใบกำกับภาษี ม.86/4(5) · เป็นฐาน ภพ.30 ·
  AP ลูกค้าแมตช์กับ PO) ส่วน WHT เป็นการหักตอนจ่ายเงิน ไม่ใช่มูลค่าบิล → ถ้าเอาขึ้นก่อน
  ยอดรวมทั้งสิ้นบนใบนี้จะ **ไม่ตรงกับใบกำกับภาษีของออเดอร์เดียวกัน** ที่ออกตอนรับเงิน
  · แต่ความงงที่ผู้ใช้จับได้ถูกต้อง — เดิม `10,700 − 300 = 10,400` ไม่โผล่ที่ไหน ลูกค้าไล่ไม่ออกว่า
  ยอดมัดจำ 5,200 คิดจากอะไร → **แก้ด้วยการเติมแถว "ยอดสุทธิ"** (ขึ้นเฉพาะเมื่อมี WHT
  ไม่งั้นซ้ำกับยอดรวมทั้งสิ้น) ไม่ใช่สลับลำดับ
- ตัดวงเล็บกำกับท้ายบรรทัดบนใบนี้ตามที่ผู้ใช้ขอ: `ภาษีมูลค่าเพิ่ม 7%` (ไม่มี "(รวมในราคาแล้ว)") ·
  `ยอดชำระมัดจำ x% สุทธิ` (ไม่มี "(รวม VAT)") — **เอกสารตัวอื่นยังใช้ข้อความเดิม** (แยก branch กันอยู่
  ไม่กระทบ) ถ้าจะให้เหมือนกันทั้งระบบต้องแก้ default branch แล้วเทียบใบเก่าทุกแบบอีกรอบ
- เอกสารมีแถว **"ครบกำหนด / Due"** (เอกสารตัวอื่นไม่มี — ขึ้นเฉพาะใบที่ตั้งค่า `dueDate`)
  · default 7 วัน แก้ได้ในกล่องยืนยัน (ไม่ใช้เครดิตเทอมลูกค้า — เงื่อนไขมัดจำคนละเรื่องกับเครดิตค่าสินค้า)
- **`fn_void_deposit_invoice`** (role main) — ยกเลิกใบแจ้งหนี้มัดจำกลับเป็น `รอคอนเฟิร์ม` เพื่อแก้
  ใบเสนอราคาต่อได้ (สถานะนี้ยังไม่มีรายการบัญชี/สต็อก → ย้อนได้ปลอดภัย) · เลข INV ที่ออกไปแล้วถือว่ายกเลิก
  ไม่นำกลับมาใช้ซ้ำ · ไม่ทำแบบนี้ = ลูกค้าแก้ออเดอร์ทีต้องยกเลิกทั้งบิลแล้วคีย์ใหม่ (ผิดกติกา "แก้ได้ทุกจุด")
- ยอดมัดจำ prefill จาก `deposit_percent` ที่เก็บไว้ตั้งแต่ใบเสนอราคา (0021) — ไม่ใช่ 50% ตายตัวอีกต่อไป
- golden test S10 (9 เทส) ครอบ "ห้ามลงบัญชี / ห้ามแตะ invNo, docDate1-2, deposit, outstanding"

### D46 — ฐาน multi-tenant: tenant_id + RLS + ผ่าตัดคีย์ + subdomain (migration 0025-0032, 2026-08-11)

**ที่มา**: NEXT_STEPS ข้อ 4.1/4.2 — ระบบเป็น single-tenant เต็มตัว (`grep tenant_id` = 0 จุด)
เลือกทำก่อนงานอื่นเพราะเป็นงานเดียวในลิสต์ที่ **ยิ่งเลื่อนยิ่งแพง** (ผ่าตัด PK ตอน DB ว่างถูกกว่ามาก)

- **โครงสร้าง**: `tenants` + `my_tenant()` (pattern เดียวกับ `my_role()`/`my_entities()` เดิม)
  · `tenant_id not null default my_tenant()` ครบ 31 ตาราง → **`.from()` 174 จุดในแอปไม่ต้องแก้เลย**
  (INSERT ให้ DB ประทับเอง · SELECT ให้ RLS กรองเอง) · **ทุก index ขึ้นต้นด้วย `tenant_id`** (65 ตัว)
- **entity_id ฝั่งผลิต+ขาย+contacts** (16 ตาราง) — เดิมมีแต่ฝั่งบัญชีที่รู้จัก entity
  · `entities.is_default` + `my_default_entity()` แทน backfill `EID01` ตายตัว (กิจการเจ้าของมี 2 entity จริง)
  · **ไม่ใส่ `entity_id` ให้ `sales_order_items`** — สโคปตามใบแม่ เหมือน `transaction_items` เดิม
- **ผ่าตัด PK/unique 23 จุด** เป็น composite `(tenant_id, คีย์เดิม)` — ไม่ใช้ prefix ในเลขเอกสาร
  เพราะเลขบนกระดาษที่ลูกค้าเห็นจะเปลี่ยนหน้าตา · `log_distill.batch` (กติกาเหล็ก) ขยายเป็น `(tenant_id, entity_id, batch)`
  · ⚠️ ต่างจาก NEXT_STEPS 1 จุด: `bank_accounts` ใช้ `(tenant_id, account_name)` ไม่พ่วง entity
  เพราะตารางนี้ออกแบบเป็นบัญชีใช้ร่วมข้ามกิจการ (`entity_ids[]` — Option A ใน 0001)
- **RLS 56 policy** เขียนใหม่ทุกข้อ = `tenant_id = my_tenant()` AND เงื่อนไข role/entity เดิม
  · `my_tenant()` คืน null ตอนยังไม่ล็อกอิน → ปิดตายอัตโนมัติ ไม่ต้องเขียนเงื่อนไข anon แยก
  · `entities` เปิด **update ได้ / insert ไม่ได้** → "กิจการที่ 2" เป็น add-on ที่บังคับที่ DB (NEXT_STEPS 4.2)
    แต่ยังแก้หัวเอกสารได้ (ไม่พัง D44)
- **ตัวเลขที่ NEXT_STEPS ประเมินคลาดเคลื่อน**: ฟังก์ชันที่ต้องรื้อมี **7 ตัว ไม่ใช่ 25** —
  RPC ส่วนใหญ่เป็น `SECURITY INVOKER` อยู่แล้วโดยตั้งใจ (`0011_accounting_rpc.sql:10`) → RLS คุมให้เอง
  ที่ต้องแก้คือ definer ที่ค้นด้วยคีย์จาก caller: ถ้าไม่กรอง tenant ลูกค้า A ส่ง `qu_no` ของ B
  แล้ว **แก้/ยกเลิกออเดอร์คนอื่นได้ทั้งที่ policy ถูกทุกข้อ**

**เจอเพิ่มระหว่างทำ — ไม่มีใน NEXT_STEPS เลย:**
1. 💣 `lib/snapshot/engine.ts` ใช้ service role dump ทุกตารางแบบไม่กรอง → ลูกค้า A กด snapshot
   ได้ข้อมูลทุกเจ้า และกด restore ทับข้อมูลทุกเจ้า · `fn_mig_truncate()` ก็ truncate ทั้งตาราง
2. `resetPasswordAction`/`deleteUserAction` รับ user id ดิบจาก client ไม่เช็ค tenant
   → main ของ A รีเซ็ตรหัส/ลบผู้ใช้ของ B ได้ถ้าเดา uuid ถูก
3. storage bucket `receipts` เปิดให้ทุกคนที่ล็อกอินอ่านไฟล์ของทุกเจ้า (ยังไม่มีโค้ดอัปโหลด จึงยังไม่รั่วจริง)
   · `pdf-templates` **จงใจแชร์** — ฟอร์มราชการ+ฟอนต์เหมือนกันทุกโรง
4. 🐛 บั๊กที่สร้างเองใน 0027: `apply_stock_delta` ใช้ `my_default_entity()` → สต็อกลงกิจการหลักเสมอ
   แม้แถว `log_product` เป็นของอีกกิจการ · ที่ถูกคือเอา entity จากแถวที่ทำให้ trigger ทำงาน

**subdomain (NEXT_STEPS 4.7)** — `hostToTenantSlug()` + view `tenant_branding` ให้หน้า login
แสดงแบรนด์ลูกค้าได้ก่อนล็อกอิน (ปิดข้อ 2 ที่ค้างมาตั้งแต่ 2026-08-02 · เลือก **co-brand**)
· middleware **เขียนทับ header เสมอ** (client ยิงปลอมได้) · เดา subdomain มั่วไม่บอกว่า "ไม่พบลูกค้า"
· grep แล้ว host/slug ถูกอ่านแค่ใน middleware + 2 ไฟล์หน้า login
· ❌ **ไม่ทำ redirect เมื่อยืนผิด subdomain** — cookie เป็น host-only ข้าม subdomain แล้ว session
  ไม่ติดไป = ต้องล็อกอินซ้ำโดยไม่รู้สาเหตุ · และแบรนด์ผิดหายเองทันทีที่เข้าแอป

### D47 — แบรนด์ต้องมีแหล่งเดียว (0030, 2026-08-11)

**ผู้ใช้เจอตอนเทส**: หน้า login สองเจ้าสีต่างกันถูกต้อง แต่เข้าไปในแอปกลับเป็นสีเริ่มต้น

0025 สร้างคอลัมน์ `brand_*` บน `tenants` แล้วให้ view อ่านจากตรงนั้น ทั้งที่ทั้งแอป + UI ตั้งค่า (D43)
ใช้ `app_settings` มาแต่ต้น → **แบรนด์มี 2 แหล่งที่ไม่คุยกัน ตั้งค่าที่หนึ่งอีกที่ไม่รู้เรื่อง**

→ `app_settings` เป็นเจ้าของแหล่งเดียว · view แค่เปิดหน้าต่างให้อ่านก่อนล็อกอิน · **ลบคอลัมน์ `brand_*` บน `tenants` ทิ้ง**
⚠️ view นี้ anon อ่านได้ → whitelist เฉพาะ `brand_name`/`logo_url`/`brand_color`
(`app_settings` มีผังบัญชี/กิจการรับรายได้/อัตราภาษี ที่ต้องไม่หลุด)

**บทเรียน**: บั๊กคลาสนี้ build/lint/เทสเดิมจับไม่ได้เลย เพราะทั้งสองทาง "ทำงานได้" แค่ให้คนละคำตอบ
→ ต้องมีเทสที่**เทียบสองแหล่งเข้าหากันโดยตรง**

### D48 — รหัสผ่าน/ชื่อผู้ใช้ในโลก multi-tenant (0031 + 0032, 2026-08-11)

**ผู้ใช้จับได้ตอนเทส** และเป็นช่องโหว่ที่ **RLS ช่วยไม่ได้เลย**: ถ้าลูกค้า 2 เจ้ามีทั้งชื่อผู้ใช้และ
รหัสผ่านตรงกัน คนของเจ้าหนึ่งพิมพ์ชื่อตัวเองที่ URL ของอีกเจ้าแล้วเข้าได้ — ระบบเห็นว่าเขาเป็น
เจ้าของบัญชีนั้นจริง ๆ · พิสูจน์แล้วสองด้าน: รหัสตรงกัน = เข้าได้ · รหัสต่างกัน = `Invalid login credentials`
**URL ไม่ได้ให้สิทธิ์ รหัสที่ซ้ำกันต่างหาก**

ต้นตอจริงคือ **สคริปต์ seed ตั้งรหัสตั้งต้นเหมือนกันทุกเจ้า** — ถ้าหลุดไปอยู่ใน provision script
ลูกค้าทุกรายจะเข้าระบบกันเองได้ตั้งแต่วันแรกโดยไม่มีใครรู้ตัว

อุด 3 ชั้น:
1. **สุ่มรหัสตั้งต้นไม่ซ้ำต่อราย** (`generateInitialPassword` — ตัด `0/O/1/l/I` ออกเพราะต้องบอกทางโทรศัพท์/LINE)
2. **บังคับเปลี่ยนตอนล็อกอินครั้งแรก** (`profiles.must_change_password`) ครอบทั้งตอนสร้างผู้ใช้
   และตอนเจ้าของกดรีเซ็ตรหัสให้ · guard อยู่ใน `(app)/layout.tsx` ที่ query `profiles` อยู่แล้ว
   = ไม่เพิ่มภาระต่อ request (ทำใน middleware ต้องยิง DB ทุก request รวมไฟล์ static)
   · หน้า `/change-password` อยู่**นอกกลุ่ม `(app)`** โดยตั้งใจ — อยู่ข้างในจะโดน layout เด้งกลับไม่รู้จบ
3. **ชื่อผู้ใช้ห้ามซ้ำทั้งระบบ** (0032 — กลับจาก `(tenant_id, username)` ของ 0027)
   → พิมพ์ชื่อตัวเองที่ URL ไหนก็เข้าบัญชีตัวเอง = ปิดทางที่เกิดโดยบังเอิญ (ชื่อ `admin` ซ้ำกันเป็นเรื่องปกติ)
   · ราคาที่จ่าย: ลูกค้ารายที่ 2 ใช้ชื่อ `admin` ไม่ได้ · **ผลข้างเคียงที่ตั้งใจ: subdomain ไม่เกี่ยวกับ
   การล็อกอินอีกต่อไป** กลับไปเป็นของแต่งหน้าล้วน ๆ ตามเจตนาเดิม NEXT_STEPS:181 → ระบบง่ายลง

⚠️ **ยังไม่ปิดทุกทาง**: รู้ชื่อผู้ใช้ของอีกเจ้า + รหัสบังเอิญตรงกัน ยังเข้าได้ → **MFA เป็นเงื่อนไข
ก่อนรับลูกค้ารายแรก** (ดู NEXT_STEPS)

⚠️ **เกือบพลาด**: ตอนแรกเขียนให้ผู้ใช้เคลียร์ธงผ่าน RLS policy — แต่ **RLS จำกัดไม่ได้ว่าแก้คอลัมน์ไหนได้**
→ policy นั้นจะเปิดให้ `viewer` ตั้ง `role` ตัวเองเป็น `main` ไปด้วย (ยกระดับสิทธิ์ แย่กว่าปัญหาที่กำลังแก้)
→ ใช้ `clear_password_change_flag()` แบบ security definer ที่แตะได้คอลัมน์เดียวแทน

### D49 — ตรวจโค้ดหลังผ่าตัด PK (0027): ไม่มีจุดพัง · จุดเสี่ยงเลื่อนไปเป็นของ 4.3 (2026-08-11)

ก่อนทำขั้น 6 (ย้าย DB production มา 0032) ไล่โค้ดทั้ง repo หา query ที่พังจากการเปลี่ยน PK/unique 23 จุด
**ผล: ไม่พบจุดที่พังจริงเลย** — พิสูจน์ด้วย `tests/tenant/entity-scope.test.ts` (9 เทส ยิง Supabase จริง)
ไม่ใช่ด้วยการอ่านโค้ดอย่างเดียว เพราะ 3 ข้อแรกเป็นพฤติกรรมของ PostgREST/Postgres ที่เดาจากโค้ดไม่ได้:

1. `.upsert(row)` **ที่ไม่ระบุ `onConflict`** ยังถูกต้องกับ PK composite — PostgREST อนุมาน
   `on conflict` จาก PK ของตาราง ส่วน `tenant_id` ที่ไม่ได้ส่งไปใน payload ถูกเติมด้วย
   `default my_tenant()` → `app/(app)/production/master-actions.ts` (แท็บจัดการข้อมูล) ไม่ต้องแก้
2. `.eq(pk, id)` ตอน update/delete master **ปลอดภัย** เพราะ PK ของ master คือ `(tenant_id, คีย์)`
   **ไม่มี `entity_id`** → หนึ่งรหัสชี้ได้แถวเดียวต่อลูกค้าเสมอ ลบแล้วกิจการอื่นไม่พลอยหาย
   (เคยประเมินผิดว่าเป็นบั๊ก — PK ของ master ไม่ได้พ่วง entity เหมือน stock/เมนู/batch)
3. trigger `trg_update_stock_product` แยกยอดตามกิจการจริง · กติกาเหล็ก 1 batch = 1 แถว
   ยังบังคับอยู่ (ขอบเขตขยายเป็น "ต่อโรง" ไม่ใช่ยกเลิก)
4. ไม่มี `.single()`/`.maybeSingle()` จุดไหนวางอยู่บนคีย์ที่เลิก unique แล้ว (ไล่ครบทุกจุดใน `app/` + `lib/`)
   → ไม่มีความเสี่ยง `PGRST116`
5. `on conflict (product_id)` ของเดิมใน 0002 ถูกเขียนทับครบใน 0027:214/225 และ 0029:31/81

**จุดที่ยังไม่พัง แต่จะผิดเมื่อทำ 4.3** — บันทึกไว้ใน NEXT_STEPS 4.3 พร้อมตำแหน่งไฟล์
วันนี้ปลอดภัยเพราะ 0026 backfill ทุกแถวฝั่งผลิต/ขายเป็น**กิจการหลักตัวเดียว** และยังไม่มี UI
ให้สร้างข้อมูลผลิต/ขายในกิจการที่ 2 → หนึ่งคีย์ยังคืนแถวเดียวเสมอ
**จงใจไม่แก้ตอนนี้** เพราะแก้ให้ถูกต้องคือการออกแบบตัวเลือกกิจการฝั่งผลิต/ขาย = เนื้องานของ 4.3 เอง
แก้ครึ่ง ๆ ตอนนี้จะได้โค้ดที่กรอง entity แบบเดาไปก่อน แล้วต้องรื้อซ้ำ

### D50 — migration ที่ backfill ต้องปิด user trigger ก่อน (เจอตอนย้าย DB จริง 2026-08-12)

**อาการ**: `db push` ลง DB production ล้มที่ 0026
`null value in column "tenant_id" of relation "edit_log" violates not-null constraint`

**สาเหตุ** (ห่วงโซ่ 3 ต่อ — ไม่มีต่อไหนผิดเดี่ยว ๆ):
1. 9 ตารางผลิต/ขายมี trigger `trg_audit` (0005) เขียน `edit_log` ทุก INSERT/UPDATE/DELETE
2. 0025 ตั้ง `edit_log.tenant_id` เป็น `not null default my_tenant()`
3. 0026 สั่ง `update <ตาราง> set entity_id = ...` เพื่อ backfill → trigger ยิง → insert `edit_log`
   → ตอน migration ไม่มี `auth.uid()` → `my_tenant()` = null → ชน not null → **ล้มทั้ง migration**

**ทำไม DB ทดสอบไม่เจอ** ← จุดที่ต้องจำ: DB ทดสอบตอนรัน migration **ยังไม่มีข้อมูล**
→ UPDATE โดน 0 แถว → trigger ไม่ยิงเลย · **บั๊กชนิดนี้โผล่เฉพาะกับ DB ที่มีของจริงเท่านั้น**
→ เทสอัตโนมัติ 241 + 67 ตัวจับไม่ได้สักตัว และจะจับไม่ได้ตลอดไปถ้าไม่เปลี่ยนวิธีเทส

**แก้**: ในลูป backfill ของ 0025 + 0026 ครอบด้วย
`alter table %I disable trigger user` … UPDATE … `alter table %I enable trigger user`
- ⚠️ ต้องเป็น `user` ห้ามเป็น `all` — `all` ปิด trigger ที่บังคับ FK ด้วย
- migration ล้มกลางคัน = DDL ย้อนพร้อม transaction → trigger ไม่ค้างสถานะปิด
- โปรเจกต์มี `fn_mig_set_triggers(boolean)` (0014) ทำเรื่องนี้อยู่แล้วสำหรับ import
  แต่รายชื่อตารางตายตัวและไม่ครบชุดของ 0026 → ทำ inline ในลูปตรงกว่า

**กติกาสำหรับ migration ต่อไป**: ถ้า migration มี `UPDATE`/`INSERT` ที่แตะแถวเดิมของลูกค้า
**ต้องปิด user trigger เสมอ** — ไม่ใช่เพราะมันจะล้ม แต่เพราะ audit log จะบวมด้วยประวัติปลอม
(รอบนี้ 0025 ทิ้งขยะไว้ 674 แถว ต้องเขียนสคริปต์ตามลบทีหลัง)

**ผลลัพธ์การย้าย**: ข้อมูล 1,685 แถว 30 ตาราง **ตรงกับไฟล์สำรองเป๊ะทุกตารางหลังย้าย**
· EID01+EID02 อยู่ครบ · ผู้ใช้ `ceo` ล็อกอินเดิมได้ ไม่โดนบังคับเปลี่ยนรหัส

**สิ่งที่ช่วยชีวิต**: สำรองข้อมูลก่อนด้วย `scripts/backup-tables.ts` (เขียนใหม่รอบนี้ เพราะ
`supabase db dump` ต้องมี Docker/pg_dump ซึ่งเครื่องผู้ใช้ไม่มี) — ไฟล์สำรองกลายเป็น
**ตัวอ้างอิงในการพิสูจน์ว่าไม่มีอะไรหาย** ไม่ใช่แค่ของเผื่อกู้ · เก็บนอก repo + `.gitignore` กันซ้ำ

### D51 — LINE ต่อ tenant + ค่าลับใน `app_settings` ต้องกันที่ RLS ไม่ใช่ซ่อน UI (0033, 2026-08-12)

**ปัญหา**: `lib/line.ts` อ่านโทเคน/กลุ่มจาก **env ของ Vercel project** → ลูกค้าทุกเจ้าใน deployment
เดียวกันยิงแจ้งเตือนเข้ากลุ่ม LINE กลุ่มเดียวกันหมด · ลูกค้า ก. เห็นออเดอร์/ชื่อลูกค้า/ยอดเงินของ ข.

- **ความรุนแรงเท่า RLS รั่ว** ต่างกันแค่รั่วออกทาง LINE — และ**ไม่ต้องมีใครตั้งใจเจาะ**
  เกิดเองทันทีที่ลูกค้าเจ้าที่ 2 เข้าระบบ (ช่องโหว่รหัสผ่านยังต้องมีคนเดารหัสถูกก่อน)
- **เทส 67 ตัวจับไม่ได้** เพราะดูแต่ข้อมูลใน DB ไม่ได้ดู side effect ที่ยิงออกนอกระบบ
  → บทเรียน: **env ที่ผูกกับ deployment ทุกตัวต้องไล่ดูว่าควรเป็นค่าต่อ tenant หรือไม่**

**แก้**: ย้ายไป `app_settings` kind `line_channel_token` / `line_group_id`
· `sendLine(supabase, text)` เอา tenant จาก **session** เสมอ (ไม่รับเป็นพารามิเตอร์ — กันบั๊กชนิดเดียวกัน)
· อ่านค่าด้วย admin client เพราะ role `sale`/`warehouse` ก็ทำให้เกิดแจ้งเตือนได้ แต่อ่าน kind ลับไม่ได้
· 🚨 **ห้ามใส่ fallback ไป env** — fallback คือตัวบั๊กเอง (tenant ที่ยังไม่ตั้งค่าจะไปยิงเข้ากลุ่มของอีกเจ้า)

**จุดที่ตัดสินต่างจากที่ผู้ใช้เสนอตอนแรก**: ผู้ใช้ตั้งใจกันพนักงานด้วยการ **ซ่อนหน้าตั้งค่า**
แต่ซ่อน UI ไม่ได้กันจริง — `app_settings_sel` เดิมเปิดให้ทุกคนใน tenant อ่านทุกแถว และ
**anon key เป็นค่าสาธารณะ** พนักงานยิง PostgREST ตรงอ่านโทเคนได้อยู่ดี
→ แยก policy **ตาม kind**: ลับ = `main` เท่านั้น · ที่เหลือคงเดิม
⚠️ **ห้ามปิด select ทั้งตารางเป็น main-only** — `(app)/layout.tsx` โหลด `brand_*` ให้ **ทุก role**
ไว้วาดแถบเมนู ปิดหมดแล้วพนักงานเข้าแอปไม่ได้เลย (มีเทสคุมข้อนี้ไว้แล้ว)

**เพิ่ม kind ลับใหม่ในอนาคต = แก้ 2 ที่**: รายการใน policy (0033) + `SECRET_KINDS` ใน `lib/line.ts`

### D52 — ❌ **ไม่ทำ MFA** (ตัดสิน 2026-08-12) — อย่าเสนอซ้ำ

เดิม NEXT_STEPS 4.0.1 เขียนว่า MFA เป็น "เงื่อนไขก่อนรับลูกค้ารายแรก ห้ามข้าม" — **ผู้ใช้ตัดสินว่าไม่ทำ**
ใช้การ**เตือนลูกค้าตอนตั้งรหัสผ่าน**ว่าอย่าสะเพร่าเพราะกระทบธุรกิจตัวเองแทน

**ความเสี่ยงที่รับไว้อย่างรู้ตัว**: ลูกค้าคนละเจ้าอยู่ DB เดียวกันและล็อกอินระบบเดียวกัน
· ชื่อผู้ใช้ไม่ใช่ความลับและเดาได้ (`admin`, `owner-<slug>`) · **ถ้าลูกค้าเจ้าหนึ่งตั้งรหัสง่ายแล้วอีกเจ้าเดาถูก
= เห็นข้อมูลธุรกิจกันทั้งหมด** และลูกค้ากลุ่มนี้เป็นคู่แข่งกันเอง

**เหตุผลที่รับได้**: ต้นทุนกับลูกค้า (ต้องใช้แอป authenticator ทุกครั้งที่ล็อกอิน) และต้นทุนซัพพอร์ต
(มือถือหาย/เปลี่ยนเครื่อง = โทรหาเจ้าของระบบ) สูงเกินไปสำหรับสินค้าขนาดนี้ในตอนนี้

**ทางกลางที่ยังเปิดอยู่ ถูกกว่า MFA มาก และยังไม่ได้ทำ**: ขันเกณฑ์ `validatePassword`
(`lib/shared/password.ts`) ให้ปฏิเสธรหัสที่คาดเดาง่าย — **บังคับได้จริงโดยไม่ต้องพึ่งวินัยลูกค้า
และไม่มีต้นทุนกับลูกค้าเลย** · ยังไม่ทำ รอผู้ใช้ตัดสินรอบหน้า

> 🚨 ถ้าวันหนึ่งลูกค้ารายใหญ่ถามเรื่องความปลอดภัย ให้กลับมาอ่านข้อนี้ก่อน — คำตอบตรง ๆ คือ
> "ยังไม่มี MFA" ไม่ใช่ "ปลอดภัยเต็มที่" · ทางเลือกที่ขายได้คู่กันคือ tier แยก DB (NEXT_STEPS 4.9)

### D53 — โควตากิจการ + module flags: บังคับคนละชั้นกัน (0034, 2026-08-12)

**บริบท**: `max_entities` / `modules_enabled` มีคอลัมน์ตั้งแต่ 0025 แต่ไม่มีโค้ดไหนใช้เลยจนถึงตอนนี้

**1. 🚨 UI ห้ามผูกกับ `max_entities`** — เอกสารเดิม (NEXT_STEPS 4.2) เขียนว่า "`max_entities`=1 → ซ่อน
UI เลือกกิจการ" · **ทำตามตรง ๆ แล้วพัง**: กิจการของเจ้าของระบบเองมี EID01+EID02 อยู่จริง
แต่ `max_entities` ยัง default 1 → ซ่อนตัวเลือก = เข้าถึงข้อมูล EID02 ไม่ได้อีกเลย

| ชั้น | คุมด้วย | เหตุผล |
|---|---|---|
| ซ่อน/โชว์ตัวเลือกกิจการใน UI | **จำนวน entity ที่มีอยู่จริง** | ไม่มีทางล็อกใครออกจากข้อมูลตัวเอง |
| ขาย add-on กิจการที่ 2 | `max_entities` ตอน **สร้าง** entity | RLS ห้ามลูกค้า insert `entities` อยู่แล้ว → เลี่ยงผ่าน API ไม่ได้ |

migration 0034 ดัน `max_entities` ขึ้นให้ไม่น้อยกว่าจำนวน entity ที่มีจริง (`greatest(...)`)
เพื่อให้ข้อมูลไม่ขัดกับความจริงตั้งแต่แรก

**2. module flags บังคับที่ UI/route พอ — ไม่ต้องลง RLS**
ต่างจากโทเคน LINE (D51) ที่เป็น **ความลับ** จึงต้อง fail-closed ที่ RLS ·
โมดูลคือ **สิทธิ์ตามแพ็กเกจที่ซื้อ** ลูกค้าที่เลี่ยงไปใช้โมดูลที่ไม่ได้จ่าย = ปัญหาการเก็บเงิน
ไม่ใช่ข้อมูลใครรั่ว → `workspacesFor(role, modules)` ซ่อนเมนู + `requireModule()` กัน URL ตรง
- **`hasModule()` fail-open โดยตั้งใจ** (อ่านค่าไม่ได้ = เปิดหมด) — อ่านพลาดแล้วล็อกลูกค้าที่จ่ายเงินแล้ว
  ออกจากระบบ แย่กว่าปล่อยให้เห็นเมนูเกิน · **ตรงข้ามกับ D51 ที่ต้อง fail-closed** อย่าสับสนสองอันนี้
- **สิ่งที่ต้องบังคับที่ DB จริง ๆ คือ "ลูกค้าเลื่อนแพ็กเกจให้ตัวเองไม่ได้"** — ตาราง `tenants`
  ไม่มี policy for update ตั้งแต่ 0025 · มีเทสคุมไว้แล้ว (`tests/tenant/plan-gating.test.ts`)
  ถ้าวันหนึ่งเผลอเพิ่ม policy update บน `tenants` = gate ทั้งหมดไร้ความหมายทันที
- ⚠️ **ห้ามปิดการเชื่อมข้ามโมดูลที่ระดับ DB** — ขายแล้วลงบัญชีอัตโนมัติต้องทำงานต่อแม้ลูกค้า
  ไม่ได้ซื้อโมดูลบัญชี ไม่งั้นข้อมูลขาดหายเงียบ ๆ · แค่ไม่ให้เห็นหน้าบัญชี
- `reports` (ฟอร์ม ภส.) ผูกกับโมดูล **production** — เป็นเอกสารของโรงกลั่น
  ส่วน ภพ.30/ภงด./50ทวิ อยู่ในแท็บสรรพากรของโดเมนบัญชี

**3. provision script แยกจาก seed-demo-tenant เด็ดขาด**
`scripts/seed-demo-tenant.ts` เรียก `seedTenant()` ของ test harness ซึ่ง**ยัดข้อมูลตัวอย่าง**
("สุราทดสอบ"/ออเดอร์/บิล) → ลูกค้าจ่ายเงินต้องได้ระบบเปล่า
→ `scripts/provision-tenant.ts` เขียนแยก ไม่ import อะไรจาก `tests/` เลย (มีเทสยืนยันว่าได้ระบบเปล่าจริง)
· `scripts/add-entity.ts` = จุดบังคับโควตา · **จงใจไม่ให้สคริปต์ขยายโควตาเอง** —
การเพิ่มกิจการกับการอนุมัติว่าลูกค้าจ่ายค่า add-on แล้ว ต้องเป็นคนละการตัดสินใจ

### D54 — แอปจัดการหลังบ้าน เฟส 1 (0035, 2026-08-13)

**บริบท**: งานรับลูกค้าใหม่/เปลี่ยนแพ็กเกจต้องพิมพ์คำสั่งใน terminal + รัน SQL ใน Dashboard
ซึ่งเจ้าของระบบเขียนโค้ดไม่ได้ · และ**ไม่มีวิธีรีเซ็ตรหัสลูกค้าที่ทดสอบแล้ว** เลย
(อีเมลเป็นของปลอม `@insep.local` → ปุ่มส่งอีเมลรีเซ็ตของ Supabase ใช้ไม่ได้)
requirement เต็มอยู่ที่ `docs/ADMIN_APP_REQUIREMENTS.md`

**1. 🚨 ตารางของแพลตฟอร์มต้อง RLS deny-all + revoke grant — ข้อที่พลาดแล้วเจ็บที่สุด**

ตารางใหม่ใน Postgres ไม่มี RLS โดยปริยาย และ Supabase ตั้ง `alter default privileges … grant all
to anon, authenticated` ไว้ → **ตารางใหม่เปิดให้ใครถือ anon key ก็อ่านได้ทันที** และ anon key
เป็นค่าสาธารณะที่ฝังในหน้าเว็บลูกค้าทุกคน · ลืมข้อนี้ = ใครเป็นลูกค้า/ซื้อแพ็กเกจอะไร รั่วให้ทุกเจ้าเห็น

`platform_admins` / `platform_admin_log` จึง `enable row level security` **แล้วไม่สร้าง policy เลย**
+ `revoke all from anon, authenticated` (ชั้นสอง — ทำให้ฟ้อง permission denied ซึ่งดังกว่า "คืนว่าง")
· เทสที่คุมข้อนี้ `tests/tenant/platform-tables.test.ts` **สำคัญกว่าเทสอื่นทั้งหมดในงานนี้**

**2. กัน 3 ชั้น ไม่ใช่ชั้นเดียว**

| ชั้น | ที่อยู่ | กันอะไร |
|---|---|---|
| env `PLATFORM_ADMIN=1` | `middleware.ts` → 404 | deployment ของลูกค้าต้องไม่มีหน้านี้อยู่จริง |
| ต้องล็อกอิน | `requirePlatformAdmin()` | server action ถูกเรียกตรงจากเบราว์เซอร์ได้ |
| uuid ต้องอยู่ใน `platform_admins` | `requirePlatformAdmin()` | deployment ของแอดมินก็ยังต้องกันคนอื่นที่บังเอิญมีบัญชี |

- **ตอบ 404 ไม่ใช่ 403** — คนที่ไม่ใช่แอดมินไม่ควรรู้ว่ามีหน้านี้อยู่
  (ต่างจาก `requireModule()` ฝั่งลูกค้าที่เด้งกลับหน้าแรก เพราะลูกค้าไม่ได้ทำอะไรผิด แค่ยังไม่ได้ซื้อ)
- **ด่าน env อยู่ใน middleware ก่อน `updateSession`** — ถ้าปล่อยให้เด้งไป `/login` ก่อน
  เท่ากับบอกเป็นนัยว่ามีหน้านี้อยู่ แค่ยังไม่ได้ล็อกอิน
- `platformEnabled()` รับเฉพาะ `"1"` / `"true"` — **ห้ามเช็ค truthiness ตรง ๆ** เพราะ `"0"`/`"false"`
  เป็น string ที่ truthy (มีเทสคุมไว้)

**3. ตรรกะอยู่ที่เดียว — UI กับสคริปต์เรียกตัวเดียวกัน**
`lib/platform/provision.ts` เป็นแหล่งความจริงเดียวของ "รับลูกค้าใหม่/เพิ่มกิจการ/รีเซ็ตรหัส"
· `scripts/provision-tenant.ts` + `scripts/add-entity.ts` ถูกลดเหลือแค่ parse argument แล้วเรียกตัวนี้
· **ไฟล์นี้ห้าม `import "server-only"`** เพราะสคริปต์รันบน node ธรรมดา (แพ็กเกจนั้นจะ throw)
  → ความปลอดภัยมาจากการที่ทุกฟังก์ชัน**รับ client เข้ามา** ไม่ได้อ่าน service role key เอง

**4. รหัสชั่วคราวแสดงบนจอครั้งเดียว ห้ามเก็บลง DB**
บทเรียน 2026-08-12: รหัสถูกพิมพ์ลง terminal แล้วหายไปกับหน้าต่างที่ปิดไป
→ แผงรหัสในแอปต้อง (ก) เด่นจนมองข้ามไม่ได้ (ข) ก๊อปได้คลิกเดียว (ค) ไม่หายเองจนกดปิด
· `platform_admin_log` เก็บ **ชื่อผู้ใช้** ที่ถูกรีเซ็ต แต่**ห้ามเก็บรหัส**

**5. บัญชีแอดมินต้องมีแถว `tenants` ให้เกาะ → `tenants.is_platform`**
trigger `handle_new_user` (0025) บังคับว่าผู้ใช้ทุกคนต้องมี `tenant_id` · บัญชีแอดมินจึงต้องมี
tenant ของตัวเอง (slug `platform`, `is_active = false` เพื่อไม่โผล่ใน `tenant_branding`)
→ เพิ่มธง `is_platform` เพื่อ**กรองออกจากรายชื่อลูกค้า** ไม่งั้นตัวเองจะไปโผล่เป็นลูกค้ารายหนึ่ง
· `platform` เข้าไปอยู่ใน `RESERVED_SLUGS` ด้วย — ลูกค้าจองชื่อนี้ไม่ได้

**6. ยังไม่ทำในเฟส 1 (ตัดสินแล้ว)**
- ⚠️ **`tenants.is_active` ยังไม่บล็อกอะไรเลย** — ปิดแล้วลูกค้ายังล็อกอินใช้งานได้ปกติ
  → **จงใจไม่ใส่ปุ่มระงับลูกค้าในหน้าจอ** เพราะปุ่มที่กดแล้วไม่เกิดอะไรอันตรายกว่าไม่มีปุ่ม
  ควรทำคู่กับเฟส 2 (ตารางค่างวด) เพราะเหตุผลที่จะระงับคือค้างจ่าย
- ตารางค่างวด/เตือนอัตโนมัติ = เฟส 2/3 · ดูข้อมูล "ในระบบ" ของลูกค้าเวลาซัพพอร์ต = ยังไม่ตัดสิน

### D55 — VAT branching: กิจการที่ไม่จดทะเบียน VAT (0036, 2026-08-14 · NEXT_STEPS 4.3)

`entities.is_vat` มีคอลัมน์มาตั้งแต่ 0001 แต่**ไม่มีโค้ดไหนใช้เลย** → กิจการที่ไม่จด VAT
ยังถูกคิด VAT 7% ทุกใบและ **ออกใบกำกับภาษีได้ = ผิด ประมวลรัษฎากร ม.86/13** (โทษอาญา + เบี้ยปรับ)

**ตรวจข้อมูลจริงก่อนลงมือ**: EID01 (จด VAT) 481 บิล · **EID02 (ไม่จด VAT) 0 บิล**
→ ไม่มีข้อมูลเก่าที่ต้องแปลง · EID02 ของเจ้าของระบบเองเป็นเคสทดสอบจริงตัวแรก

**1. วิธีที่ทำให้พิสูจน์ได้ว่าของเดิมไม่ขยับ**
เพิ่มพารามิเตอร์ `isVat` **ตัวท้ายและมีค่าปริยาย `true`** ทุกฟังก์ชันที่แตะ VAT
→ **golden S1-S10 เดิมผ่านโดยไม่ต้องแก้ไฟล์เทสเลย** — นั่นคือหลักฐาน ไม่ใช่การอ่านโค้ดแล้วเชื่อ
· ใช้ตัวหาร `1 + vatRate(isVat)` แทนการเขียน branch สองชุด → ไม่มีทางที่สูตรสองทางจะเพี้ยนจากกัน
· ข้อยกเว้นเดียวที่ต้องแตะเทสเดิม: `company.test.ts` S9 เทียบทั้งอ็อบเจกต์ด้วย `toEqual`
  จึงต้องเติมฟิลด์ `isVat: true` ในค่าคาดหวัง — **ค่าของทุกฟิลด์เดิมไม่เปลี่ยน** และยังเทียบเข้มเท่าเดิม

**2. สูตรของกิจการที่ไม่จด VAT**

| | จด VAT (เดิม) | ไม่จด VAT |
|---|---|---|
| ถอด/ใส่ VAT | `÷1.07` / `×1.07` | คืนค่าเดิม |
| `quotationTotals` | เดิม | `subTotal = grandIncl` · `vatAmount = 0` · `discountEx = ส่วนลดเต็ม` |
| `reverseVatWht` | `accNet / (1 + 0.07 − r)` | **`accNet / (1 − r)`** · `vat = 0` |

★ **WHT ยังคิดเสมอ** — หัก ณ ที่จ่ายเป็นภาษีเงินได้ ไม่เกี่ยวกับการจดทะเบียน VAT
ตรวจด้วยมือ: เป็นหนี้ 100 · หัก 3% → โอนมา 97 → `97/(1−0.03) = 100` ✓

**3. 🚨 บล็อกที่ DB ไม่ใช่ที่หน้าจอ** — anon key เป็นค่าสาธารณะ ยิง PostgREST ตรงข้ามหน้าเว็บได้
→ migration 0036 ใช้ **trigger** (ไม่ใช่แก้ตัว RPC) เพราะ trigger ครอบทุกทางเข้าพร้อมกัน:
- `transactions`: `vat_amount > 0` + กิจการไม่จด VAT → `raise exception`
- `sales_orders`: ตั้ง `tax_no1`/`tax_no2` + กิจการไม่จด VAT → `raise exception`
  ★ เช็คเฉพาะตอนค่า**เปลี่ยน** (`is distinct from old`) ไม่งั้นแถวเก่าที่มีเลขอยู่แล้วจะอัปเดตอะไรไม่ได้อีกเลย
- `entity_is_vat()` fail-open (ไม่พบกิจการ = ถือว่าจด) — เป็นด่าน**ห้าม** ไม่ใช่ด่าน**อนุญาต**
  ข้อมูลที่ยังตั้งค่าไม่ครบต้องไม่ถูกบล็อกจนบันทึกอะไรไม่ได้
- เทส `tests/tenant/vat-branching.test.ts` ยิงด้วย client ผู้ใช้จริง + มี positive control

**4. หนึ่งออเดอร์ = หนึ่งสถานะ VAT** มาจาก**กิจการที่ออกเอกสาร** (`sales_doc_entity`)
⚠️ ถ้ากิจการที่ออกเอกสารกับกิจการที่รับรายได้ **สถานะ VAT ต่างกัน → ปฏิเสธเสียงดังตอนบันทึก**
ห้ามเดาข้างใดข้างหนึ่ง เพราะจะได้ใบเสนอราคาคิด VAT แต่ลงบัญชีไม่มี VAT = เพี้ยนเงียบ ๆ
· `resolveSalesVat()` อ่านจาก DB ฝั่ง server เสมอ **ห้ามรับ `isVat` จาก client** (ส่งค่าปลอมมาได้)

**5. เอกสารของผู้ไม่จด VAT**: "ใบกำกับภาษี/ใบเสร็จรับเงิน" → **"ใบเสร็จรับเงิน"**
· แถวมูลค่าก่อน VAT / ภาษีมูลค่าเพิ่ม **ไม่ render เลย** (ไม่ใช่โชว์ 0.00)
· `isVat` เกาะไปกับ `CompanyInfo` เพราะเป็นคุณสมบัติของ "ผู้ขาย" และถูกส่งเข้าทุกฟังก์ชันพิมพ์อยู่แล้ว

**6. ฝั่งบัญชี**: `EntryTab` ปิดติ๊ก "มี VAT 7%" + บังคับ `effHasVat = hasVat && entityIsVat`
(ปิดช่องติ๊กอย่างเดียวไม่พอ — ค่าค้างมาจาก draft/สแกนใบเสร็จได้)
· `TaxDocsTab` **ซ่อนเฉพาะ ภพ.30** — ★ ภงด./50ทวิ ต้องคงไว้ ผู้ไม่จด VAT ยังต้องหัก ณ ที่จ่าย
ตามกฎหมาย (ตัดทั้งแท็บ = ทำให้ลูกค้าผิดกฎหมายอีกทาง)
· ตัวคำนวณ ภพ.30 ไม่ต้องแก้ — ข้ามแถว `vat_amount <= 0` อยู่แล้ว และ trigger การันตีว่าเป็น 0 เสมอ

### D56 — ชื่อสินค้าคือ **PROOF** + ตั้งชื่อ Vercel project ตามนั้น (2026-08-17)

**ตัดสิน**: ชื่อสินค้าที่จะขาย = `PROOF` (ตัวพิมพ์ใหญ่ทั้งคำ) — คำว่า proof เป็นศัพท์ความแรงสุรา
และแปลว่า "หลักฐาน" ตรงกับงานที่ระบบทำ (เก็บหลักฐานยื่นสรรพสามิต/สรรพากร)

**แก้ 4 จุดเท่านั้น** (ที่เหลืออ่านจาก 2 ค่านี้ต่อ):
| ไฟล์ | ค่า |
|---|---|
| `lib/shared/branding.ts` | `PRODUCT_NAME` (ต่อท้าย "powered by" หน้า login) |
| `lib/shared/branding.ts` | `DEFAULT_BRANDING.name` — แบรนด์ของ tenant ที่**ยังไม่ตั้งชื่อเอง** |
| `app/layout.tsx` | `metadata.title` + `appleWebApp.title` (metadata ของ Next ต้องเป็นค่าคงที่ตอน build) |
| `app/manifest.ts` | `name` / `short_name` (ชื่อบนโฮมสกรีนตอน install PWA) |

⚠️ **ทำไมเปลี่ยน `DEFAULT_BRANDING.name` แล้วหน้าจอเจ้าของระบบไม่เปลี่ยน** — ตรวจ DB จริงก่อนแก้แล้ว:
tenant ของเจ้าของมี `app_settings.brand_name = 'Insep ERP'` เก็บอยู่ → ค่า default ในโค้ดไม่ถูกใช้
(กติกา D47: แบรนด์มีแหล่งเดียวคือ `app_settings`) · ค่านี้มีผลเฉพาะลูกค้าใหม่ที่ยังไม่ตั้งแบรนด์

**ยังไม่แตะ 2 อย่างนี้โดยตั้งใจ**:
- `LOGIN_EMAIL_DOMAIN` (default `insep.local`) — เป็นโดเมนภายในที่ใช้ประกอบอีเมลของ Supabase Auth
  **เปลี่ยน = บัญชีที่สร้างไว้แล้วทั้งหมดล็อกอินไม่ได้** · ผู้ใช้มองไม่เห็นค่านี้ ไม่มีเหตุผลทางการตลาดให้เปลี่ยน
- `description` ของ manifest/metadata แก้คำว่า "ระบบ ERP **ภายใน**โรงกลั่น" → "ระบบจัดการโรงกลั่น"
  (เหตุผลเดียวกับ `PRODUCT_TAGLINE` — คำว่า "ภายใน" เป็นคำของกิจการเจ้าของระบบ ลูกค้าอ่านแล้วงง)

**ชื่อ Vercel project** (แทนที่ชื่อสมมติใน NEXT_STEPS 10.1):
`insep-erp` (เจ้าของ · มีแล้ว) · `proof-app` (ลูกค้า) · `proof-admin` (แอดมิน · `PLATFORM_ADMIN=1`)

### D57 — `db:push:all` ลง migration ทุก DB ในคำสั่งเดียว (2026-08-17)

**ปัญหา**: พอมี 2 DB ขึ้นไป (ของเจ้าของ + ของลูกค้า) ทุกครั้งที่มี migration ใหม่ต้อง
`supabase link` → `db push` → `link` กลับ → `db push` อีกรอบ · ผู้ใช้เขียนโค้ดไม่ได้
→ ขั้นตอนยิ่งเยอะ ยิ่งมีโอกาสลง**ผิดก้อน** และมันเคยเกิดแล้วในโปรเจกต์นี้

**ตัดสิน 3 ข้อ**:

**1. ใช้ `--db-url` ไม่ใช่ `supabase link`** — `link` เขียนทับ `supabase/.temp/project-ref`
= เปลี่ยนปลายทางของ `npm run db:push` ธรรมดาไปด้วย แล้วค้างไว้แบบนั้นจนกว่าจะนึกได้
· `--db-url` ระบุปลายทางต่อคำสั่ง **ไม่แตะสถานะ link ในเครื่องเลย**

**2. 🚨 ทุก target ต้องบอก ref ได้จาก 2 แหล่ง แล้วต้องตรงกัน** (`checkTarget`)
· แหล่ง 1 = `NEXT_PUBLIC_SUPABASE_URL` ในไฟล์ env · แหล่ง 2 = ตัว connection string เอง
· ไม่ตรง = **หยุดก่อนแตะ DB** — นี่คือเหตุผลหลักที่สคริปต์นี้มีอยู่ ไม่ใช่แค่ความสะดวก
  (ก๊อป connection string ผิดก้อน = migration ของลูกค้าลงใน DB ธุรกิจตัวเอง)
· ตรวจ **ทั้งชุดให้จบก่อนเริ่มรัน** ไม่ใช่ตรวจไปรันไป — ไม่งั้นก้อนแรกลงไปแล้ว
  ก้อนสองเพิ่งพบว่าตั้งค่าผิด = fleet อยู่คนละเวอร์ชัน แก้ยากกว่าไม่ได้เริ่มเลย

**3. ปริยายคือ dry-run · ต้องพิมพ์ `--apply` ถึงจะลงจริง · เจอพังหยุดทันทีไม่ไปก้อนถัดไป**
เหตุผลของข้อหลัง: ถ้า 0037 พังที่ก้อนแรกแล้วดันไปลงก้อนสองสำเร็จ fleet จะคนละเวอร์ชัน
· รันซ้ำได้ปลอดภัย — CLI ดูประวัติจากตารางใน DB เอง ก้อนที่ลงแล้วถูกข้าม

**🪤 2 กับดักที่เจอตอนรันจริง (2026-08-17 · Supabase CLI v2.109) — อย่าเผลอ "ปรับปรุง" กลับ**:

**ก. ห้ามใช้ env `SUPABASE_DB_URL` แทน flag `--db-url`** — ดูเหมือนสะอาดกว่า (รหัสไม่โผล่ใน
process list) แต่ทดสอบแล้ว **CLI เพิกเฉยต่อ env ตัวนั้น แล้วเงียบ ๆ ไปใช้ project ที่ `supabase link`
ไว้แทน** · พิสูจน์ด้วยการชี้ env ไปพอร์ตที่ไม่มีอะไรอยู่ → CLI ตอบ "Remote database is up to date"
= ลง migration ผิดก้อนโดยไม่มีใครรู้ ซึ่งคือหายนะที่สคริปต์นี้ตั้งใจกันพอดี
· `--db-url` ตรวจแล้วว่าใช้จริง (ชี้พอร์ตเปล่า → ฟ้อง connection refused + exit 1)

**ข. ห้าม `spawnSync("npx.cmd", …)` ตรง ๆ บน Windows** — พังด้วย `EINVAL`
(Node ปิดช่องโหว่ CVE-2024-27980) · และ**ห้ามแก้ด้วย `shell: true`** เพราะเราส่ง connection
string เป็น argument ซึ่งรหัสผ่านมี percent-encoding (`%40`) → cmd.exe แปลงเป็นตัวแปรแล้วเพี้ยน
→ เรียก `npx-cli.js` ด้วย `process.execPath` ตรง ๆ (ได้ทั้งไม่พังและไม่ต้อง quote)

**ไฟล์**: `scripts/db-push-all.ts` · `scripts/lib/db-targets.ts` (+เทส 15 ตัว)
· `supabase/targets.example.json` (คอมมิต) → ก๊อปเป็น `supabase/targets.json` (**gitignore — มีรหัส DB**)
· `vitest.config.ts` เพิ่ม `scripts/**/*.test.ts` เข้า include (เดิมเทสใน `scripts/` ไม่ถูกรันเลย)

### D58 — **2 แอคเคาท์ Supabase** · โรงกลั่นของเจ้าของ = ลูกค้า tier แยก DB รายแรก (2026-08-17)

> 📌 **จดเพราะอ่านจาก repo อย่างเดียวแล้วเข้าใจผิดได้** — เห็น 2 project ref ในไฟล์ env
> แล้วสรุปว่า "แอคเคาท์เดียว 2 project" ซึ่ง**ผิด** (ผู้ช่วยเคยสรุปผิดมาแล้วจริง ๆ)

| แอคเคาท์ | เป็นเจ้าของ project | ใช้ทำอะไร | Vercel project ที่ชี้มา |
|---|---|---|---|
| **P — แพลตฟอร์ม** | `tnuxrufpzeyuvwdmkojv` | ลูกค้าทั่วไปทุกเจ้ารวมกัน (แยกด้วย RLS) | `proof-app` · `proof-admin` |
| **F — ส่วนตัว/โรงงาน** | `vmhiwlxdyhatucioalzp` | โรงกลั่นของเจ้าของระบบเอง | `insep-erp` |

**P ถูกเชิญเข้า org ของ F ในฐานะแอดมิน** → ล็อกอิน P แล้วมองเห็น/จัดการได้ทั้งสอง project

**ทำไมแยกแบบนี้**: เจ้าของระบบ**จำลองตัวเองเป็นลูกค้า tier "แยก DB"** (ข้อ 4.9 / 10.2 แบบ B —
ลูกค้าเปิด Supabase ของตัวเอง เพราะกังวลเรื่องข้อมูล แล้วเชิญเราเป็นแอดมิน)
→ ได้ซ้อมโมเดลนี้ด้วยระบบตัวเองก่อนขายจริง · เจอปัญหาเองก่อนลูกค้าเจอ

**3 ผลที่ตามมา — ต้องรู้ก่อนแตะงาน release**:

**1. 🚨 ลำดับปล่อยของต้องเป็น "migration ก่อน โค้ดทีหลัง" เสมอ**
`git push` ครั้งเดียว **ทุก Vercel project อัปเดตพร้อมกัน** แต่ DB ไม่ตามไปเอง
· โค้ดใหม่ + DB เก่า = **พัง** · โค้ดเก่า + DB ใหม่ = ทำงานได้ปกติ
→ `npm run db:push:all -- --apply` ให้จบก่อน แล้วค่อย `git push` (D57 มีไว้เพื่อข้อนี้)

**2. ลูกค้า tier นี้ถอนสิทธิ์แอดมินของเราได้ทุกเมื่อ** (บัญชีเป็นของเขา)
→ push migration ไม่ได้อีก แต่โค้ดยัง auto-deploy ต่อ = **แอปเขาพังเองในรอบ release ถัดไป**
→ ต้องเขียนในข้อตกลง: ถอนสิทธิ์ = ระบบหยุดรับอัปเดต และเราไม่รับผิดชอบผลที่ตามมา

**3. 🚫 ห้ามตั้ง `PLATFORM_ADMIN=1` บน Vercel project ของลูกค้า tier นี้เด็ดขาด**
เขาเข้า Dashboard ของ DB ตัวเองได้ → `insert into platform_admins` ให้ตัวเองได้
= หน้าจอที่ออกแบบมาคุมลูกค้าตกไปอยู่ในมือลูกค้า (ย้ำจาก NEXT_STEPS 10.2)
· ปัจจุบัน `insep-erp` ไม่ได้ตั้ง — ถูกต้องแล้ว

### D59 — ค่างวดลูกค้า + ระงับการใช้งาน + เตือนในแอป (แอปจัดการหลังบ้าน เฟส 2 · 0037, 2026-08-17)

**บริบท**: เฟส 1 (D54) ทำให้รับลูกค้าใหม่/เปลี่ยนแพ็กเกจได้จากหน้าจอ แต่ยัง**ไม่มีที่ไหนบอกว่าใครค้างจ่าย**
— ปัญหาที่ requirement เขียนไว้คือ "มีทั้งรายเดือน/รายปีปนกัน จำเองไม่ไหว"

**มติที่ผู้ใช้เคาะ**: ตัดรอบ **ตามวันที่ลูกค้าแต่ละรายเริ่ม sub** (anniversary) · รวมปุ่มระงับลูกค้าไว้ในเฟสนี้ ·
ราคาให้ระบบเสนอจากโมดูลแล้วพิมพ์ทับได้ · ตั้งค่างวดแยกจากฟอร์มรับลูกค้าใหม่ + มีกล่องเตือนคนที่ตกหล่น ·
เตือนลูกค้าในแอปเองแทนการรออีเมลของเฟส 3

**1. 🪤 วันตัดรอบต้องคำนวณจาก "จุดยึด" ไม่ใช่บวกจากค่าเดิม — กับดักที่ไม่มีใครสังเกต**

`31 ม.ค. + 1 เดือน = 28 ก.พ.` (ถูก) แต่ถ้ารอบถัดไปบวกจาก 28 ก.พ. จะได้ **28 มี.ค.**
→ วันตัดรอบเลื่อนจาก 31 เป็น 28 **ถาวร** ลูกค้าเสียวันไปเรื่อย ๆ โดยไม่มีอะไรฟ้อง
→ เก็บ `periods_paid` แล้วคำนวณ `periodEnd(started_on, cycle, n)` จากจุดยึดเสมอ
(ตรงกับที่ Postgres ทำเมื่อคูณ interval) · golden test คุมถึงรอบที่ 24

**2. `status` ไม่มีค่า `past_due` — ต่างจาก requirement เดิมโดยตั้งใจ**
เฟส 2 ไม่มี cron → ไม่มีอะไรมาพลิกค่าให้ · เก็บลง DB แล้วจะกลายเป็นค่าที่โกหก
→ **เลยกำหนดคำนวณสด** จาก `current_period_end < วันนี้` · คอลัมน์ `status` เก็บเฉพาะสถานะที่**คนกด**
(หลักเดียวกับ D54 ข้อ 6: ปุ่ม/ค่าที่ไม่มีผลจริง อันตรายกว่าไม่มี)

**3. 🚨 ระงับลูกค้า = บังคับที่ชั้นแอป **ไม่ใช่ RLS**
จุดเดียวคือ `app/(app)/layout.tsx` (ต่อคอลัมน์ในคิวรี `tenants` เดิม ไม่เพิ่ม query) → `/suspended`
- **fail-open**: เทียบ `is_active === false` เท่านั้น · อ่านไม่ได้/`null` ห้ามถือว่าถูกระงับ
  (เน็ตสะดุดทีเดียวลูกค้าที่จ่ายเงินแล้วหลุดทั้งระบบ — หลักเดียวกับ D53)
- **ข้ามเมื่อ `is_platform`**: tenant ของบัญชีแอดมินตั้ง `is_active = false` มาตั้งแต่ 0035 โดยตั้งใจ
  ไม่ข้าม = แอดมินเปิด `/` แล้วเจอหน้า "ถูกระงับ" และหลุดโฟลว์เด้งไป `/platform`
- **ห้ามตัดที่ RLS/`my_tenant()`**: ระงับเป็นเรื่องเก็บเงิน ไม่ใช่ขอบเขตความปลอดภัย · กดพลาดแล้ว
  ลูกค้าเข้าข้อมูลภาษีตัวเองไม่ได้ และ trigger/RPC ที่พึ่ง `my_tenant()` จะทำงานผิดตามไปด้วย
  · มีเทสยืนยันว่า **ลูกค้าที่ถูกระงับยังอ่านข้อมูลตัวเองได้ที่ระดับ DB**

**4. 🚨 แจ้งเตือนลูกค้า: มิเรอร์วันครบกำหนดลง `tenants` แทนการเปิด policy ให้อ่าน `subscriptions`**

ทางที่ดูง่ายกว่าคือเพิ่ม policy "ให้ลูกค้าอ่านแถวค่างวดของตัวเอง" — **ไม่ทำ** เพราะตาราง `subscriptions`
มี**ราคาที่ลูกค้าแต่ละเจ้าจ่าย** · เปิด policy ทีเดียวคือทิ้งการันตี deny-all ซึ่งเป็นชั้นที่แข็งที่สุดของงานนี้
แล้ววันหนึ่ง policy เพี้ยน = ลูกค้ารู้ว่าอีกเจ้าจ่ายถูกกว่า (พังทั้งความสัมพันธ์และอำนาจต่อรอง)

→ `tenants.billing_due_on` + `tenants.billing_notice` (ตารางที่ลูกค้าอ่านแถวตัวเองได้อยู่แล้ว)
**ไม่มีราคา ไม่มีชื่อแพ็กเกจ** · ซิงก์ด้วย **trigger** ไม่ใช่เรียกจากโค้ด (หลักเดียวกับ 0036: ครอบทุกทางเข้า
รวมถึงแก้มือใน SQL Editor) · `status` ไม่ใช่ `active` → `null` = หยุดพักแล้วต้องไม่ไปตื๊อลูกค้า
· 🚨 ห้ามเพิ่มคอลัมน์พวกนี้เข้า view `tenant_branding` (view นั้น `anon` อ่านได้ก่อน login)

**5. บันได 3 ขั้น ไม่ใช่ป๊อปอัพตั้งแต่แรก**
≤3 วัน = แถบเหลือง · เลยกำหนด = ป๊อปอัพ · ถูกระงับ = หน้า `/suspended` · ปิดแล้วจำวันละครั้งด้วย
`localStorage` (ไม่ต้องมีตาราง) · **เฉพาะ role `main`** — พนักงานเห็นแล้วทำอะไรไม่ได้ และเป็นเรื่อง
น่าอายของเจ้าของ · เกณฑ์วันมาจาก `lib/platform/billing.ts` ตัวเดียวกับฝั่งแอดมิน (`NOTICE_DAYS`=3
< `DUE_SOON_DAYS`=7 → แอดมินเห็นก่อนลูกค้าเสมอ มีเทสคุม)

> ⚠️ **ความเสี่ยงที่ออกแบบหลบไม่ได้ ต้องรู้ตัว**: ลูกค้าโอนแล้วแต่ยังไม่ได้กดบันทึก → ระบบเตือนคนที่จ่ายแล้ว
> บรรเทาด้วยถ้อยคำ ("ถ้าโอนแล้วข้ามข้อความนี้ได้เลย") + หน้าค่างวดที่เห็นรายการค้างชัด
> **ห้ามอ้างว่าไม่มีปัญหานี้** — ถ้าลูกค้าบ่น คำตอบคือ "กดบันทึกให้ไวขึ้น" ไม่ใช่ "ระบบไม่ผิด"

**6. ย้อนได้เฉพาะรายการจ่ายล่าสุด**
ตามกติกา CLAUDE.md ที่ว่าทุกจุดที่บันทึกได้ต้องมีปุ่มลบ · แต่ย้อนรายการกลางแล้ว `periods_paid`
กับประวัติจะไม่ตรงกันอีกเลย → จำกัดไว้ที่รายการบนสุด (เรียงด้วย `id` ไม่ใช่ `paid_on`
เพราะวันที่จ่ายย้อนหลังได้ — ลูกค้าโอนวันที่ 1 แต่มาบันทึกวันที่ 5)

**7. `formatDateThai` ย้ายจาก `lib/accounting/wht.ts` → `lib/shared/format.ts`**
ฝั่งลูกค้า/แพลตฟอร์มต้องใช้ด้วย · re-export ไว้ที่เดิมเพื่อให้ golden test A9 ไม่ต้องแก้แม้แต่บรรทัดเดียว
· 🪤 `export { x } from "…"` **ไม่ได้นำชื่อเข้ามาใน scope ของไฟล์** — `wht.ts` เรียกใช้เองข้างในด้วย
จึงต้อง `import` คู่กับ `export` (เจอตอนเทสแดง 2 ตัว)

### D60 — กัน DB แผนฟรีหลับ: ปิงทุกก้อนวันละครั้ง (0038, 2026-08-17)

**บริบท**: ทั้ง 2 แอคเคาท์ Supabase (D58) อยู่แผนฟรี ซึ่ง **pause โปรเจกต์ที่ไม่มีกิจกรรมใน 7 วัน**
· โดน pause แล้วแอปล่มทันทีและ**ปลุกอัตโนมัติไม่ได้** ต้องเข้า dashboard กด Restore เอง
→ ยิ่งอันตรายเมื่อขายเป็นสินค้า: DB ลูกค้าที่จ่ายเงินแล้วหลับเองเพราะเขาไปพักร้อน 1 สัปดาห์

**1. 🪤 "สัปดาห์ละครั้ง" ไม่พอ — ต้องวันละครั้ง (นี่คือสิ่งที่ผู้ใช้เข้าใจผิดตอนตั้งโจทย์)**
เอกสาร Supabase เขียนว่า *"considered inactive if it does not receive **sufficient** user database
activity over the past week"* — คำว่า *sufficient* ไม่ใช่ "≥ 1 ครั้ง" และ**ไม่มีที่ไหนประกาศเลขเกณฑ์**
· ประโยคที่ใกล้เคียงที่สุดที่เขาให้คือ *"typically a few user requests to the database each day over
the previous week is enough"* → เกณฑ์ที่เราใช้จึงเป็น **วันละ 1 รอบ รอบละ 3 request ห่างกัน 1 วินาที**
(ยิงรอบเดียวแล้วหลุดคิวรอบนั้น = ครบ 7 วันพอดี ซึ่งเป็นความเสี่ยงที่ไม่มีเหตุผลจะรับ)

**2. 🚨 pg_cron ที่ยิงตัวเองใช้ไม่ได้** — เกณฑ์คือ ***user*** requests ที่เข้ามาจากข้างนอก
งานที่ DB สั่งตัวเองไม่นับ · เป็นทางที่ดูสวยที่สุด (ไม่ต้องพึ่งใครเลย) แต่**ไม่ทำงาน** จึงจดไว้กันคิดใหม่

**3. ยิงด้วย RPC `public.ping()` + anon key ไม่ใช่ service role key**
ตารางทุกใบมี RLS/revoke คุม → ยิง `select` ด้วย anon key อาจได้ 401/แถวว่าง ซึ่ง**เถียงไม่ได้**ว่า
Supabase นับเป็น activity ให้หรือไม่ · RPC ที่คืนแค่ `now()` การันตีว่า SQL วิ่งจริงและได้ 200 เสมอ
โดยไม่ต้องเอา `SUPABASE_SERVICE_ROLE_KEY` ขึ้น GitHub · 🚨 ฟังก์ชันนี้ `anon` เรียกได้
**ห้ามเติมความสามารถใด ๆ เข้าไป** (อยากได้ health check ที่บอกมากกว่านี้ → สร้างตัวใหม่ที่ต้องล็อกอิน)

**4. GitHub Actions เป็นชั้นหลัก ไม่ใช่ Vercel Cron**
ทั้งสองทางทำได้ แต่ Vercel Hobby **เก็บ runtime log แค่ 1 ชั่วโมง** (NEXT_STEPS 10.1.1) = ปิงพังแล้ว
ไม่มีใครรู้ · GitHub **เมลหาเจ้าของ repo ทุกครั้งที่ workflow แดง** ซึ่งคือระบบแจ้งเตือนที่งานนี้ต้องมี
(ปิงที่พังเงียบ ๆ แย่กว่าไม่มีปิงเลย เพราะทำให้เราคิดว่าปลอดภัย) · และไม่ผูกกับเพดานแผน Vercel
· ชั้นสำรอง = Windows Task Scheduler เรียก `npm run db:ping:all -- --notify` (คนละผู้ให้บริการ
ล่มพร้อมกันยาก) · เวลา **08:17 น. ไทย (GitHub) กับ 20:30 น. (เครื่อง)** — ห่างกันครึ่งวันโดยเจตนา
· 🪤 GitHub **ปิด scheduled workflow เองถ้า repo ไม่มี commit 60 วัน** → ชั้นสำรองมีไว้เพื่อข้อนี้ด้วย

**5. รายชื่อ DB อยู่ใน git (`supabase/fleet.json`) ไม่ใช่ GitHub secret**
เก็บแค่ `url` + anon key ซึ่ง**ติดไปกับ bundle ฝั่ง browser อยู่แล้ว** = ไม่ใช่ความลับ
(รหัส DB/service key ยังอยู่ใน `targets.json`/env ที่ gitignore เหมือนเดิม)
เหตุผลที่เลือกทางนี้: ของที่อยู่ในเว็บ GitHub **ไม่มี diff ให้เห็น ไม่มีเทสจับได้ และลืมได้เงียบ ๆ**
→ อยู่ใน git แล้วได้ 3 อย่าง: workflow อ่านตรงไม่ต้องตั้ง secret · เพิ่มลูกค้าใหม่แก้ที่เดียว
(`npm run fleet:sync` สร้างให้จาก `targets.json` ห้ามแก้มือ) · และ **`db:push:all` ฟ้องเองถ้าลืม**
(`unpingedTargets` — เตือนแต่ไม่หยุด เพราะงานลง migration ไม่ควรถูกบล็อกด้วยเรื่องปิง)

**6. 🚨 กันคีย์ผิดช่องด้วยโค้ด ไม่ใช่ด้วยความระวัง** — `keyKind()` แกะ payload ของ JWT
(และ prefix `sb_secret_`) แล้ว **ปฏิเสธการเขียนไฟล์** ถ้าเจอ service role key ในช่อง `anonKey`
· เพราะไฟล์นี้อยู่ใน git: ก๊อปผิดช่องแล้ว push = ต้อง rotate คีย์ทุก DB ย้อนกลับไม่ได้จริง ๆ

**ไฟล์**: `supabase/migrations/20260817000038_ping.sql` · `scripts/lib/ping.ts` (+เทส 25 ตัว)
· `scripts/ping-dbs.ts` (npm `db:ping:all`) · `scripts/fleet-sync.ts` (npm `fleet:sync`)
· `supabase/fleet.json` (**คอมมิต**) · `.github/workflows/keep-db-awake.yml` · `db-push-all.ts` เพิ่มคำเตือน
· log ที่ `logs/ping.log` (gitignore ครอบด้วย `*.log` อยู่แล้ว)

> **ทางออกที่แท้จริงคืออัปเป็น Pro** (โปรเจกต์แบบจ่ายเงินไม่ถูก pause เลย) — งานชุดนี้คือสะพาน
> ระหว่างช่วงพัฒนา/ลูกค้ารายแรก · วันที่ย้ายขึ้น Pro ครบทุกก้อนแล้ว ลบ workflow กับ task ทิ้งได้เลย
> (ฟังก์ชัน `ping()` เก็บไว้ได้ ไม่มีผลข้างเคียง)

### D61 — ตัดฟีเจอร์ "สแกนใบเสร็จด้วย AI" ทิ้ง + ลบตาราง `scan_log` (0039, 2026-08-18)

**ยกเลิกมติ D22** (ที่ port `Scan.js` เดิมมาเป็น `scanReceiptAction`)

**เหตุผล**: ผู้ใช้ทดลองกับสลิป/ใบกำกับภาษีไทยของจริงแล้ว **อ่านไม่แม่นพอไม่ว่าจะถ่ายชัดแค่ไหน**
→ เข้าข่าย "ดูดีตอนสาธิต แต่ทำให้ลูกค้าผิดหวังตอนใช้จริง" · ขายของที่ตัวเองไม่เชื่อมือไม่ได้
(ตั้งใจจะตัดมาตั้งแต่ `NEXT_STEPS` 4.6 แล้ว — ปิดจริงในรอบนี้)

**ทำไมลบตาราง ไม่ใช่แค่เลิกเขียน**: `scan_log` เก็บ `user_email` ของผู้ใช้ทุกครั้งที่กดสแกน
= ข้อมูลส่วนบุคคลที่ไม่มีใครใช้ประโยชน์อีกแล้ว · ปล่อยไว้ = แบกไว้ในทุก DB ของลูกค้าเปล่า ๆ

**🪤 ลบตารางแล้วต้องไล่แก้ "รายชื่อตารางที่ hardcode" ให้ครบพร้อมกัน ไม่งั้นพังตอนรัน**:
`lib/snapshot/engine.ts` · `scripts/backup-tables.ts` · `tests/tenant/harness.ts`
· `migration/export-supabase-to-csv.ts` · `supabase/seed/cleanup_test.sql` · `migration/csv/README.md`
→ restore snapshot **เก่า** ที่ยังมีคีย์ `scan_log` ไม่พัง เพราะ engine วนตาม `SNAPSHOT_ORDER`
ไม่ได้วนตามคีย์ใน payload (คีย์ที่เกินมาถูกข้ามเอง)

**ของแถมที่ตายตาม**: `bangkokDayStartUTC` (`lib/shared/datetime.ts`) มีไว้เพื่อโควตาสแกนวันละครั้ง
อย่างเดียว → ลบพร้อมเทส 4 assertion · **`bangkokDateISO` ต้องอยู่** (ระบบเตือนค่างวดใช้)

**env ที่เลิกใช้**: `ANTHROPIC_API_KEY` · `SCAN_DAILY_LIMIT` — ผู้ใช้ต้องลบออกจาก Vercel
และ **revoke key** ที่ console เอง (ลงใน `docs/GOLIVE_CHECKLIST.md`)
· `docs/legacy/accounting/Scan.js` **คงไว้** — เป็นสำเนาระบบเดิม ไม่ใช่โค้ดที่รัน

---

### D62 — ยุบ workspace "รายงานราชการ" → แท็บในแอปผลิต (2026-08-18)

`/reports` เหลือแค่ฟอร์ม ภส.๐๗ อย่างเดียวมานานแล้ว (สรรพากร ภพ.30/ภงด./50ทวิ ย้ายเข้าแท็บ
"เอกสารสรรพากร" ของบัญชีตั้งแต่ D23#7) → เป็น workspace ทั้งอันเพื่อหน้าเดียว
และกินช่องบน bottom-tab ของมือถือ (role main เคยมีถึง 6 ช่อง)

**ผลลัพธ์**: `WORKSPACES` เหลือ 3 · ฟอร์ม ภส. = แท็บ "รายงานสรรพสามิต" (อยู่ระหว่าง "สต็อก"
กับ "จัดการข้อมูล") · **module flag/role ไม่ต้องแตะเลย** เพราะ `reports` ไม่เคยเป็นโมดูล
เป็นแค่ workspace ที่ผูกกับ `module: "production"` และเรียก `requireModule("production")` อยู่แล้ว

**🪤 3 กับดักของงานนี้**
1. **ต้องย้าย `getPdfAssetUrl` ออกก่อนลบโฟลเดอร์** — `accounting/_components/TaxDocsTab.tsx`
   import ข้ามโดเมนมาใช้ (50ทวิ ก็ต้องโหลด template จาก Storage) · ลบก่อน = **build บัญชีพัง**
   → ย้ายไป `app/(app)/actions.ts` (ไฟล์กลาง) ไม่ใช่ `production/actions.ts` (บัญชี import จากผลิต
   ก็กลิ่นเดียวกัน)
2. 🔴 **pdf-lib ต้องเป็น dynamic import** — ตอนอยู่ `/reports` ต้นทุน `pdf-lib` + `@pdf-lib/fontkit`
   ถูกกักอยู่หน้าเดียวที่คนเข้าปีละ 12 ครั้ง · ย้ายมาทั้งอย่างนั้น = **ทุกคนที่เปิดแอปผลิตต้องโหลด**
   → `await import()` ใน `generate()` เท่านั้น (แพตเทิร์นเดียวกับที่บัญชีเคยลด 635→131 kB)
   · และย้าย `ExciseKind` + `EXCISE_TEMPLATE_KEY` ไป `lib/pdf/keys.ts` (re-export กลับที่ `excise.ts`
   ให้ผู้เรียกเดิมใช้ได้เหมือนเดิม) เพราะ import ค่าคงที่จาก `excise.ts` ก็ลาก pdf-lib มาทั้งก้อน
   · ผลจริง: `/production` = **134 kB** เท่าเดิมหลังยุบเข้ามา
3. **ตัวเลือกของแท็บโหลดแบบ lazy** (`getExciseOptionsAction` ยิงตอน `active` ครั้งแรก) —
   ไม่ยัดเข้า `production/page.tsx` เพราะคนส่วนใหญ่เข้าแอปผลิตมาลงหมัก/กลั่น ไม่ได้มาออกฟอร์มราชการ

**ไฟล์**: `production/excise-data.ts` · `production/excise-actions.ts`
· `production/_components/ExciseTab.tsx` (เดิม `reports/_components/ReportsApp.tsx`)
· ลบ `app/(app)/reports/` ทั้งโฟลเดอร์ · แก้ `lib/shared/workspaces.ts` · `lib/shared/icons.tsx`
· `app/layout.tsx` + `app/manifest.ts` (คำโปรย) · `platform-manager.tsx:32` (ป้ายโมดูล)

---

### D63 — หน้าตั้งค่ากลาง `/settings` 5 แท็บ (2026-08-18)

**ปัญหาที่แก้ (ไม่ใช่แค่จัดบ้าน)**: การ์ด **แบรนด์ · ข้อมูลกิจการบนเอกสาร · แจ้งเตือน LINE**
เคยอยู่ในแท็บ "ตั้งค่า" ของ **แอปบัญชี** ซึ่งถูก `requireModule("accounting")` กั้น
→ **ลูกค้าที่ซื้อแค่โมดูลผลิต ตั้งชื่อ/สีแบรนด์ของตัวเองไม่ได้เลย** ทั้งที่แบรนด์ใช้ทั้งแอป
และ LINE ใช้ฝั่งขาย · ขณะที่ `/settings` ที่ควรเป็นหน้ากลางมีแค่ 2 หน้าโดด ๆ ไม่มี layout ร่วม

**ผัง 5 แท็บ** (แท็บเป็น **route จริง** ไม่ใช่ state — แต่ละแท็บดึงข้อมูลคนละชุด แยกหน้าจึงโหลดเฉพาะที่ใช้):

| แท็บ | route | เนื้อหา |
|---|---|---|
| กิจการ | `/settings/company` | ข้อมูลบนเอกสารการค้า + เลขสรรพสามิต + ตัวอย่างหัวกระดาษจริง |
| แบรนด์ | `/settings/branding` | ชื่อ/สี/โลโก้/โหมดสว่าง-มืดปริยาย |
| แจ้งเตือน | `/settings/notify` | LINE |
| ผู้ใช้ | `/settings/users` | เดิม |
| สำรองข้อมูล | `/settings/data` | เดิม |

**สิ่งที่ตั้งใจ *ไม่* ย้าย**: หมวดหมู่รายรับ/รายจ่าย · อัตรา WHT · บัญชีในระบบภาษี · บัญชีเงิน · คู่ค้า
— เป็นข้อมูลของโดเมนบัญชีล้วน ๆ · ย้ายไปกลางแล้วจะต้องกันด้วย module flag เพิ่มอีกชั้นโดยไม่ได้อะไรกลับมา

**🪤 กับดักที่แก้ไปพร้อมกัน — dropdown ตัวเดียวทำ 2 หน้าที่**
`CompanyDocCard` เดิมใช้ตัวเลือกกิจการตัวเดียวเป็นทั้ง "กำลังแก้กิจการไหน" และ
"กิจการไหนออกเอกสารการค้า" (`app_settings.sales_doc_entity`) · **ยังไม่พังเพราะยังไม่มีเหตุ
ให้เข้าไปแก้กิจการที่ 2** — แต่พอเพิ่มช่องเลขสรรพสามิต (D64) จะมีทันที: กรอกเลขของโรงที่สอง
แล้วกดบันทึก = **ย้ายผู้ออกใบกำกับภาษีไปเป็นนิติบุคคลอื่นเงียบ ๆ ไม่มีอะไรฟ้อง**
→ แยกเป็น `saveEntityInfoAction` กับ `saveDocEntityAction` คนละปุ่ม
· การ์ด "กิจการที่ออกเอกสารการค้า" ขึ้นเฉพาะตอนมีมากกว่า 1 กิจการ

**อื่น ๆ**: guard `role === "main"` ย้ายมาอยู่ที่ `settings/layout.tsx` ที่เดียว (เดิมซ้ำทุกหน้า)
· แถบเมนูยุบ "ตั้งค่า" + "สำรอง" เหลือรายการเดียว
· 🪤 ตั้งชื่อ loader ว่า **`settings-data.ts`** ไม่ใช่ `data.ts` เพราะจะชนกับโฟลเดอร์ `settings/data/`
  (`import "../data"` กำกวมระหว่างไฟล์กับโฟลเดอร์ — resolve ได้แต่คนอ่านสับสน)

---

### D64 — เลขทะเบียนสรรพสามิตตั้งได้จากแอป (2026-08-18)

**ที่มาเดิม (ตรวจแล้ว ไม่มี hardcode)**: `entities.excise_id` → `production/excise-data.ts`
→ `lib/production/reports.ts` → `lib/pdf/excise.ts` (แตกเป็นตัวเลขทีละช่อง 13-1-3)
· `d.company` มาจาก `entities.name` · **ไม่มีชื่อโรงงาน/ที่อยู่/เลขใบอนุญาตอื่นถูกฝังในโค้ดเลย**
(ที่เหลือเป็นข้อความบนตัวเทมเพลต PDF ที่พิมพ์มาแล้ว)

**ปัญหา**: ไม่มีที่กรอกในแอป — `GOLIVE_CHECKLIST` เคยสั่งให้รัน
`update entities set excise_id=… ` เอง ซึ่ง**ลูกค้าที่ซื้อโปรแกรมทำไม่ได้**
→ เพิ่มช่องในแท็บ ตั้งค่า → กิจการ · **ไม่ต้องมี migration** เพราะ RLS `entities_upd`
เปิดให้ `main` แก้ได้อยู่แล้ว (0028 — ตั้งใจให้แก้ข้อมูลกิจการได้ แต่ **สร้างกิจการใหม่ไม่ได้** เพราะเป็น add-on)

**🪤 ห้าม validate ให้เหลือแต่ตัวเลข** — เลขจริงมีขีดคั่น (`0605567002178-1-001`) และ
`lib/pdf/excise.ts` ทำ `replace(/\D/g,"")` เองตอนวาดลงช่องอยู่แล้ว
→ ทำได้แค่ **เตือน** ถ้านับตัวเลขแล้วไม่ได้ 17 ตัว (บล็อกการบันทึกไม่ได้ เดี๋ยวโรงที่เลขต่างรูปแบบกรอกไม่ได้)

**🚨 ไม่ใส่ช่องแก้ `is_vat` ในฟอร์มนี้โดยตั้งใจ** — การจด VAT เป็นข้อเท็จจริงทางกฎหมาย
และ trigger ฝั่ง DB ใช้ค่านี้ตัดสินว่าออกใบกำกับภาษีได้ไหม (D55) · ต้องให้เจ้าของระบบตั้งผ่านสคริปต์เท่านั้น

---

### D65 — แท็บผูกกับ URL `?tab=` + ดร็อปดาวน์แท็บย่อยบนแถบเมนู (2026-08-18)

**ปัญหา**: แท็บของทุก workspace เป็น `useState` ล้วน และประกาศแยกกันในแต่ละ App component
→ แถบเมนูไม่รู้ว่ามีแท็บอะไร · ลิงก์ตรงเข้าแท็บไม่ได้ · กด refresh เด้งกลับแท็บแรก
· จะเข้าแท็บลึก ๆ ต้องกด 2 จังหวะทุกครั้ง

**ทางแก้**: ทะเบียนกลาง `lib/shared/tabs.ts` เป็นแหล่งเดียวที่ทั้งแถบแท็บในหน้าและดร็อปดาวน์ใช้
+ hook `useTabUrl` ผูก state ↔ `?tab=<slug>`

- **`slug` เป็น ASCII** (`distill` · `excise` · `tax-docs`) — ใช้ label ไทยเป็น slug จะโดน
  percent-encode ยาวจนก๊อปลิงก์ส่งกันไม่ไหว · **`label` ยังเป็นไทยตัวเดิมเป๊ะ** เพราะ App component
  ใช้ label เป็นคีย์ของ state (`show("กลั่น")`) — เปลี่ยน label = ต้องไล่แก้ทั้งไฟล์
- 🪤 **ใช้ `history.replaceState` ไม่ใช่ `router.replace`** — router.replace ยิง RSC request ใหม่
  ทุกครั้งที่สลับแท็บ ทั้งที่ข้อมูลของหน้าไม่เปลี่ยนเลย (แท็บ mount ค้างไว้หมดอยู่แล้ว = เสียเปล่า 100%)
- 🪤 **ไม่ push เข้า history** — ไม่งั้นปุ่ม back ของเบราว์เซอร์ต้องย้อนทีละแท็บกว่าจะออกจากหน้าได้
- 🪤 ฝั่งขายยังต้อง **กรองตาม role ซ้ำตอนรับค่าจาก URL** — ไม่งั้นพนักงานคลังพิมพ์
  `?tab=manage` เข้าแท็บที่ไม่มีสิทธิ์ได้ (ข้อมูลยังปลอดภัยเพราะ RLS แต่ไม่ควรเห็นหน้าจอ)
- ดร็อปดาวน์ **เปิดด้วยคลิก ไม่ใช่ hover ล้วน** (โน้ตบุ๊กจอสัมผัส/แท็บเล็ตไม่มี hover จริง)
  · ปิดเมื่อคลิกนอก/กด Esc/เปลี่ยนหน้า
- **มือถือไม่มีดร็อปดาวน์โดยตั้งใจ** — เมนูเด้งจากขอบล่างจะบังฟอร์มที่กำลังกรอก และทุกหน้ามี
  แถบแท็บเลื่อนแนวนอนของตัวเองอยู่แล้ว

**เทส**: `lib/shared/tabs.test.ts` 16 ตัว (slug ไม่ซ้ำ · label ไม่ซ้ำ · slug เป็น ASCII ·
แปลงไป-กลับได้ครบทุกแท็บ · `navSubItems` กรอง role ฝั่งขายถูก · workspace ที่ไม่รู้จักไม่ throw)

### D66 — โมดูลเงินเดือน (โมดูลที่ 4) รอบที่ 1 (0040, 2026-08-19)

**ขอบเขตรอบนี้**: คำนวณ → ส่งเข้าบัญชี → สลิป · **ยังไม่ทำ** ภงด.1 · สปส.1-10 · 50ทวิ · ภงด.1ก

#### 🎯 มติที่ตัดสินทุกข้อในโมดูลนี้: โค้ดเป็นกลาง เกณฑ์อยู่ใน config

ที่มา: ผู้ใช้เคยเขียนแอปเงินเดือนบน GAS ให้บริษัทหนึ่ง (สูตรผ่านเทียบ Excel จริง 40/40 แถว)
แต่เกณฑ์ของบริษัทนั้นเป็น**นโยบายเฉพาะตัว** ไม่ใช่ค่ากลาง — และโมดูลนี้จะขายให้โรงอื่นด้วย

> **ไม่มีเกณฑ์ของบริษัทใดอยู่ในโค้ดหรือ seed ของสินค้าเลย** — ไม่มีคำว่า "ช่าง" "หัวหน้า"
> "เบี้ยขยัน" ที่ไหนทั้งสิ้น · บริษัทนั้นตั้งค่าเอาเองในแอปแล้วได้ตัวเลขตรงทุกบาท

- ❌ ยกเลิกไอเดียเดิมที่จะ seed preset ของบริษัทนั้นลง provision script
- ✅ golden test ใช้ **พนักงานสมมติ** + config แบบเดียวกับเขา = พิสูจน์ว่า engine ทำซ้ำได้
  🚨 **ห้ามเอาชื่อ/เงินเดือน/เลขบัตรจริงลง repo** (repo นี้จะถูกขายต่อ — เหตุผลเดียวกับที่
  ย้ายโฟลเดอร์ `clasp-AIM-*` ออกไปนอก repo แล้วเติม `.gitignore` กันซ้ำ)

#### เส้นแบ่ง: กฎหมาย (ล็อก) vs นโยบายบริษัท (ตั้งเอง)

| ล็อกในโค้ด + golden test | ตั้งค่าได้ในแอป |
|---|---|
| ลำดับการคำนวณ 7 ขั้น · ขั้นบันได PIT · วิธี annualize · สูตร สปส. | รายการเพิ่ม/หัก · กลุ่มพนักงาน · ตัวคูณ OT · ชั่วโมงต่อวัน · การปัดเศษ · อัตรา/เพดาน |

**ผังคำนวณที่ล็อกลำดับ** (`lib/payroll/calc.ts` — เปิดให้เติมเฉพาะขั้น 2 กับ 6):
ค่าจ้างฐาน → +รายการเพิ่ม → แยกฐาน (prorate/OT/ภาษี/สปส.) → −สปส. → −ภาษี → −รายการหัก → สุทธิ

#### 🎯 หัวใจ: `pay_components` + ธง 4 ตัว

รายการเพิ่ม/หัก 1 แถวต้องตอบว่าไหลเข้าฐานไหนบ้าง: `taxable` · `sso_base` · `ot_base` · `prorate_base`

🚨 **`taxable` กับ `sso_base` ไม่เท่ากัน** — ค่าล่วงเวลา/โบนัสเข้าฐานภาษี แต่ไม่ใช่ "ค่าจ้าง"
ตาม พ.ร.บ.ประกันสังคม · ใช้ฐานเดียวทั้งสองที่ = ตัวเลขที่ยื่นผิดตั้งแต่เดือนแรกโดยไม่มีอะไรฟ้อง
· `ot_base`/`prorate_base` มาจากเคสจริง: ค่าตำแหน่ง**เข้า** prorate แต่**ไม่เข้า**ฐาน OT

**ตัวคูณ OT ต่างกันตามกลุ่ม → สร้าง 2 แถวคนละ `group_codes`** ไม่ต้องมี schema ซ้อน
(คนอยู่ได้กลุ่มเดียว → รายการที่ไม่ตรงกลุ่มถูกข้าม ไม่มีทางนับซ้ำ · มีเทสคุม)

🚨 **`method` เป็นชุดปิด 6 แบบ ห้ามขยายเป็นภาษาสูตร** — สูตรที่ลูกค้าเขียนเอง golden test ไม่ได้
และขัดกติกาเหล็กข้อ 1 · เคสนอกเหนือใช้ `manual` (กรอกยอดเองต่อคนต่องวด) ครอบ 100% ที่เหลือ

#### `pay_rates` — ตารางแรกของระบบที่มีแนวคิด effective-dated

ตรวจแล้วทั้ง repo ไม่เคยมีมาก่อน (`app_settings` เป็น kind/value ธรรมดา รองรับไม่ได้)
อัตรา/เพดาน สปส. + ขั้นบันไดภาษีถูกแก้ด้วยกฎกระทรวงเป็นระยะ (ระบบ GAS เดิมตั้ง cap ไว้ 875
= 5% ของ 17,500 ไม่ใช่ 15,000 เดิม) → เลือกแถวล่าสุดที่ `effective_from <= วันสิ้นงวด`
🚨 ใช้ **วันสิ้นงวด** ไม่ใช่วันที่เปิดหน้าจอ — ไม่งั้นเปิดดูงวดปีที่แล้วได้อัตราปีนี้

#### 3 กับดักที่เจอตอนลงมือ (จดไว้ไม่ให้พลาดซ้ำ)

**1. 🚨 RPC ต้องเป็น SECURITY DEFINER ไม่ใช่ INVOKER**
ตอนออกแบบเดาว่า invoker พอ (payroll เปิดเฉพาะ main ซึ่งเขียน `transactions` ได้อยู่แล้ว)
แต่ `integration_log` **ไม่มี write policy เลย** (0028 เขียนไว้ว่า "เขียนผ่าน RPC security definer เท่านั้น")
→ invoker จะ insert idempotency ไม่ผ่านตั้งแต่บรรทัดแรก · `fn_*` ทุกตัวใน repo เป็น definer ด้วยเหตุนี้
⚠️ definer = ข้าม RLS → **ทุก statement ต้องพ่วง `tenant_id = v_tenant` ด้วยมือ** (ไล่ตรวจครบ 9 จุดแล้ว)

**2. 🪤 แช่ตัวเลขตอนกดบันทึก ห้ามคำนวณสดตอนเปิดดู**
`payroll_items.computed` + `rates_snapshot` เก็บผลเป็นค่าตายตัว · ไม่งั้นลูกค้าแก้เกณฑ์กลางปี
แล้วงวดที่ post/ยื่นไปแล้วเปลี่ยนตัวเลขย้อนหลังเงียบ ๆ (ตระกูลเดียวกับวันตัดรอบค่างวด D59)
· ล็อกการแก้ทันทีที่งวดมี post ขาใดขาหนึ่ง — ต้องถอนก่อนถึงแก้ได้

**3. 🪤 พรีวิวสดกับตอนบันทึกต้องเรียกฟังก์ชันเดียวกัน**
ระบบเดิมบน GAS เขียนสูตรเบี้ยขยันซ้ำ 2 ที่ (`40_calc.js` กับ `50_pdf.js`) ค่าตรงกันโดยบังเอิญ —
แก้เกณฑ์ที่เดียวเมื่อไหร่ ใบเบี้ยขยันจะโชว์ยอดไม่ตรงกับที่จ่ายจริง
→ ที่นี่ `PeriodTab` กับ `savePeriodLinesAction` เรียก `calcPayrollLine` ตัวเดียวกัน

#### ลงบัญชี 3 ขาแยกอิสระ (ยกโมเดลจาก GAS ที่ใช้จริงมาแล้ว)

| ขา | จำนวน tx | เมื่อไร |
|---|---|---|
| NET | 1 tx ต่อคน | วันจ่ายเงินเดือน |
| SSO | 1 tx รวม | วันนำส่ง (ลูกจ้าง+นายจ้าง) |
| WHT | 1 tx รวม | วันนำส่ง |

**ทำไมต้องแยก**: แอปเป็น cash basis · ถ้า post ยอดเต็มตอนจ่ายเงินเดือนแล้วมา post ยอดนำส่งอีก
= **นับรายจ่ายซ้ำส่วนที่หักไว้** โดยไม่มีอะไรฟ้อง · แยกแบบนี้รวมทั้งปี = ยอดเต็ม + สมทบนายจ้าง พอดี
· `type='รายจ่าย'` + `vat_amount=0`/`wht_amount=0` → ไม่โผล่ ภพ.30/ภงด.3-53 (ไม่ต้องแก้ CHECK ของ `type`)

**ถอน post = soft-void ไม่ใช่ลบ** — ระบบเดิมใช้ `deleteRow()` ลบแถวจริงในชีต · ที่นี่
`status = 'ยกเลิก'` ตามกติกาเหล็ก (ห้าม hard delete ทุกกรณี) + ปลด `integration_log` เป็น
`duplicate` เพื่อให้ post ใหม่ได้

#### สิ่งที่ตั้งใจไม่ทำ

- **ไม่ยัดลูกจ้างเข้า `contacts`** — `contacts_w` เปิดให้ role `sale` เขียน และทุกคนใน tenant
  อ่านได้ → ฝ่ายขายจะเห็นเงินเดือนเพื่อนร่วมงาน · `employees` เป็นตารางใหม่ที่ `select` เฉพาะ `main`
- **ไม่แตะ `app/(app)/sales/_components/print.ts`** — แผนเดิมจะย้าย `openPrint` มาใช้ร่วมกัน
  แต่ไฟล์นั้นคุมหน้าตาใบกำกับภาษีที่ลูกค้าเทียบกับของเดิมทีละบรรทัดมาแล้ว แตะเพื่อ "ใช้ร่วม"
  = เสี่ยงทำเอกสารการค้าขยับโดยไม่ตั้งใจ แลกไม่คุ้ม → สลิปมี `lib/payroll/slip.ts` ของตัวเอง
- **ไม่เปลี่ยน default ของ `tenants.modules_enabled`** — เงินเดือนเป็น add-on ที่ขายเพิ่ม
  ลูกค้าเดิมไม่ได้ฟรี · ผลพลอยได้: `tests/tenant/plan-gating.test.ts` ไม่พัง
- ⚠️ **ห้ามกันการเชื่อมข้ามโมดูลที่ระดับ DB** — `fn_post_payroll` ต้องทำงานได้แม้ลูกค้าไม่ได้ซื้อ
  โมดูลบัญชี (โมดูล = สิทธิ์ตามแพ็กเกจ ไม่ใช่ขอบเขตความปลอดภัย — กฎที่เขียนไว้ใน 0034)

#### ข้อจำกัดที่รู้ตัวและคงไว้ตามระบบเดิม

ภาษีแบบ auto ประมาณการจาก**ค่าจ้างประจำอย่างเดียว** ไม่รวม OT/โบนัสที่ยังไม่เกิด →
ยอดหักรายเดือนไม่ตรงกับเงินได้จริงทั้งปี · เป็นเรื่องปกติของวิธี annualized (ส่วนต่างไปจบตอน
ลูกจ้างยื่น ภงด.91 เอง) · **จงใจไม่ "ปรับปรุง" ให้ต่างจากระบบเดิม** (กติกาเหล็กข้อ 1)

**ไฟล์**: `lib/payroll/{types,calc,tax,sso,slip}.ts` + เทส 57 ตัว ·
`supabase/migrations/20260819000040_payroll.sql` · `app/(app)/payroll/` ·
ลงทะเบียนโมดูล 5 จุด (`workspaces.ts` · `tabs.ts` · `icons.tsx` · `platform-manager.tsx` · เทส)

### D67 — เงินเดือนรอบแก้: ตัวแปรกลาง · ขาลงบัญชีตั้งเอง · แท็บรายงาน (0042, 2026-08-19)

**ที่มา**: ผู้ใช้ลองใช้ของจริงหลัง D66 แล้วแจ้งกลับ 5 ข้อ + สั่งเพิ่ม 1 ข้อ
ทุกข้อชี้ไปที่**หลักการเดิมข้อเดียวกันที่ยังทำไม่สุด**: *โค้ดเป็นกลาง เกณฑ์อยู่ใน config*

#### 1. 🎯 ตัวแปรกลาง `pay_variables` แทน `method='hourly_multiplier'`

D66 เปิดให้ตั้ง "ตัวคูณ OT" ได้ก็จริง แต่ **ตัวอัตราต่อชั่วโมงยังฮาร์ดโค้ดอยู่ในโค้ด**
(ค่าจ้าง ÷ วันทำงานมาตรฐาน ÷ ชั่วโมงต่อวัน) — แต่ละโรงคิดตัวหารไม่เหมือนกัน
→ เท่ากับเกณฑ์ที่ลูกค้ามองไม่เห็นและแก้ไม่ได้ = ข้อที่ D66 ตั้งใจจะเลิกทำพอดี

ตอนนี้ตัวแปร = **ตัวตั้ง ÷ ตัวหารไม่เกิน 2 ชั้น** ทุกช่องเลือกจาก**ชุดปิด 7 อย่าง**:
`base_wage` · `prorated_base` · `work_days_std` · `work_days_actual` · `hours_per_day` · `input` · `constant`
→ `method='variable'` คิดเป็น **ค่าตัวแปร × ตัวคูณ × ค่าจากช่องกรอก**

> 🚨 **นี่ยังไม่ใช่ภาษาสูตร และห้ามขยายเป็น expression engine ในอนาคต**
> ไม่มี parser ไม่มีลำดับตัวดำเนินการ ไม่มีวงเล็บ → เส้นทางการคำนวณมีจำกัด golden test คลุมได้ครบ
> เหตุผลเดียวกับที่ `method` เป็นชุดปิด 6 แบบ (กติกาเหล็กข้อ 1) — สูตรที่ลูกค้าเขียนเองเทียบค่าไม่ได้

- ค่าที่**เปลี่ยนทุกเดือน** (วันทำงานมาตรฐานของงวด · วันมาทำงานจริง · ช่องที่กรอกต่องวด)
  เลือกเป็นตัวตั้ง/ตัวหารได้ตรง ๆ → ตัวแปรขยับตามงวดเองโดยไม่ต้องแก้อะไร
- 🪤 **ตัวหารที่ได้ 0 ต้องถูก "ข้าม" ไม่ใช่หารแล้วได้ Infinity** — เดือนที่ยังไม่กรอกชั่วโมง OT
  จะได้ตัวหาร 0 เป็นเรื่องปกติ ไม่ใช่ข้อผิดพลาด
- migration แปลงของเดิมให้เอง: สร้างตัวแปร `hourly_rate` ที่สูตร**ตรงกับที่โค้ดเดิมฮาร์ดโค้ดไว้เป๊ะ**
  เฉพาะ tenant ที่เคยใช้ `hourly_multiplier` → ตัวเลขที่ลูกค้าตั้งไว้แล้วไม่ขยับแม้แต่บาทเดียว

**🪤 พนักงานรายวันต้องมีตัวแปรอัตราของตัวเอง** — ฐานเขาเป็น "ค่าแรงต่อวัน" อยู่แล้ว
จึงหารแค่ชั่วโมงต่อวัน ไม่หารจำนวนวันซ้ำอีก · ของเดิมโค้ดซ่อน special-case ตาม `wageType`
ไว้ข้างใน = เกณฑ์ที่ลูกค้ามองไม่เห็น · มีเทสคุมว่ารายวันต้องไม่หยิบอัตราของรายเดือน
(หยิบผิดได้ 400÷30÷9 = 1.48 บาท/ชม. — **ผิดมหันต์แต่ไม่ error**)

#### 2. 🎯 ขาลงบัญชี `pay_post_legs` ตั้งเองได้ กี่ขาก็ได้

D66 ล็อก 3 ขา (NET/SSO/WHT) ไว้ในโค้ด · ผู้ใช้ยืนยัน 2 เรื่องที่เปลี่ยนการออกแบบ:
**(ก) ลงบัญชีเป็นก้อนพอ** บัญชีไม่ต้องรู้จักเบี้ยขยัน/โอที · **(ข) แต่ละเจ้าแบ่งก้อนไม่เหมือนกัน**
และ**หมวดรายจ่ายพิมพ์เอง ไม่ดึงจากรายการหมวดเดิม** (ผู้ใช้ยืนยันว่าหมวดพวกนี้ไม่ได้อยู่ในนั้นอยู่แล้ว)

ขาหนึ่ง = ยอดที่ลง (ชุดปิด 7 แบบ) + แยกรายคน/ก้อนเดียว + หมวด + บัญชีเงิน + คู่ค้า + วันที่แนะนำ

> 🚨 **กับดักใหญ่ที่สุดของการเปิดให้ตั้งขาเอง: ขาซ้อนกันได้ = ลงรายจ่ายซ้ำ
> และไม่มีอะไรใน DB ฟ้อง** (เช่นตั้งขา `gross` คู่กับ `net`, หรือตั้งขา "โอที" เพิ่ม
> ทั้งที่โอทีอยู่ในยอดสุทธิอยู่แล้ว) — ตระกูลเดียวกับที่ D66 แยก 3 ขาเพื่อกันนับซ้ำ
> เปิดให้ตั้งเองจึงเป็นการ**คืนความเสี่ยงนั้นกลับมา** ต้องมีตัวจับแทน

→ `legCoverage()` (`lib/payroll/legs.ts`) โชว์บนแท็บงวดจ่ายทุกครั้งก่อนลงบัญชี:
*ยอดรวมของขาที่ตั้งไว้* เทียบ *ยอดที่ควรลงทั้งหมด = รวมเงินได้ + สมทบนายจ้าง*
(สุทธิ + ปกส.ลูกจ้าง + ภาษี = รวมเงินได้พอดี เพราะ 2 ตัวหลังคือส่วนที่หักไว้แล้วนำส่งแทนลูกจ้าง
— เงินออกจากบริษัทเท่ากันทั้งก้อน)
**เตือนไม่บล็อก** เพราะบางเจ้าอาจตั้งใจไม่ลงบางส่วน (เช่นสมทบนายจ้างไปลงมือที่อื่น)

#### 3. ลบ `pay_components.expense_cat` — ช่องหลอก

ใส่ไปก็ไม่มีผลต่ออะไรเลย เพราะการลงบัญชีเป็น "ขา" → หมวดรายจ่ายเป็นของ**ขา** ไม่ใช่ของรายการย่อย
· ช่องที่กรอกแล้วไม่มีผลอันตรายกว่าไม่มีช่อง: ลูกค้าเชื่อว่าตั้งแล้วและไม่ไปตรวจซ้ำ

#### 4. แท็บ "รายงาน" (ผู้ใช้สั่งเอง)

เมื่อบัญชีลงเป็นก้อน บัญชีจึงไม่รู้ว่าในก้อนนั้นเป็นเงินเดือนเท่าไร OT เท่าไร คอมมิชชั่นเท่าไร
→ ดูรายละเอียดที่นี่แทน แยก**ตามรายการ × รายคน** (ได้ performance พนักงานเป็นของแถม)

★ **ไม่ต้องมีตารางใหม่** — อ่านจาก `payroll_items.computed` ที่แช่ค่าไว้ตอนกดบันทึกอยู่แล้ว
🪤 และ**ต้องอ่านจากค่าที่แช่ไว้เท่านั้น ห้ามคำนวณสดจาก config** ไม่งั้นรายงานของงวดเก่า
จะขยับตามเกณฑ์ใหม่ (กับดักเดียวกับ D66 ข้อ 2)

#### 5. UI 2 จุดที่ผู้ใช้ใช้ไม่ได้จริง

- **บัญชีเงินเป็นดร็อปดาวน์จาก `bank_accounts`** ไม่ใช่ช่องพิมพ์ — พิมพ์ผิด 1 ตัวอักษร = ลงบัญชีไม่ผ่าน
- **เช็คบ็อกซ์แทน `<select multiple>`** — native multi-select ต้องกด Ctrl ค้างถึงจะเลือกหลายอันได้
  ผู้ใช้กดแล้วได้ทีละอันตลอด (เลือกอันที่ 2 = อันแรกหลุด) โดยไม่มีอะไรบอก

#### 6. บั๊ก: รายชื่อพนักงานไม่ขึ้นหลังบันทึก

แท็บถูก **mount ค้างไว้ด้วย CSS** ตามแพตเทิร์นของทุก workspace (สลับแท็บไม่ต้องโหลดใหม่)
→ prop ที่มาจาก `router.refresh()` มาถึงช้ากว่าที่ผู้ใช้คาด ทำให้ดูเหมือนบันทึกไม่ติด
→ เก็บ state ในคอมโพเนนต์แล้วอัปเดตทันที + **ยังเรียก `router.refresh()` ต่อ** ให้ฝั่ง server ตรงกัน
(แพตเทิร์นเดียวกับการ์ดคู่ค้าในแท็บตั้งค่าของบัญชี)

#### 🪤 กับดักที่เจอตอนทำ

**RPC ต้องเป็น `security definer` ไม่ใช่ `invoker`** — เดาผิดตั้งแต่ 0040
`integration_log` **ไม่มี write policy เลย** (0028 เขียนไว้ว่า "เขียนผ่าน RPC security definer เท่านั้น")
→ invoker insert idempotency ไม่ผ่านตั้งแต่บรรทัดแรก · `fn_*` ทุกตัวใน repo เป็น definer ด้วยเหตุนี้
⚠️ definer = ข้าม RLS → **ทุก statement ต้องพ่วง `tenant_id = v_tenant` ด้วยมือ**

**🚨 ย้ายค่า enum ต้อง "ปลดกรอบ → ย้ายค่า → ใส่กรอบใหม่" — สลับลำดับไม่ได้**
0042 รอบแรกเขียน `update method='variable'` ไว้**ก่อน**สลับ CHECK constraint
→ **ล้มกลางคัน** ตอนลงจริง (`pay_components_method_check` ยังไม่รู้จักค่า `'variable'`)
· และจะสลับไปใส่ constraint ใหม่ก่อน update ก็ไม่ได้อีก เพราะ `ADD CONSTRAINT` ตรวจแถวที่มีอยู่ทันที
(ต้องใช้ `NOT VALID` ถึงจะข้าม — ซึ่งเลี่ยงดีกว่า) → ลำดับที่ถูกมีทางเดียว: **drop → update → add**

> 🪤 **สิ่งที่ทำให้บั๊กนี้อันตราย: DB ที่ยังไม่มีข้อมูลจริงจะผ่านทั้งที่ลำดับผิด**
> (update ไม่โดนแถวไหน = CHECK ไม่ถูกเรียก) · รอบนี้ **ก้อนเจ้าของผ่าน แล้วไปล้มที่ก้อนลูกค้า**
> ซึ่งมี tenant ทดสอบที่ตั้งรายการ OT ไว้จริง
> → **migration ที่แปลงข้อมูลเดิม ต้องเดาว่า "ก้อนถัดไปมีข้อมูลมากกว่าก้อนนี้" เสมอ**
> ตระกูลเดียวกับ D50 (trigger ตอน backfill) ที่ DB ทดสอบว่างจับไม่ได้เหมือนกัน
> · โชคดีที่ `db:push:all` **หยุดทันทีที่ก้อนแรกที่ล้ม ไม่ไปก้อนถัดไป** (D57) และทุก statement
> ของไฟล์นี้เขียนแบบรันซ้ำได้ (`if not exists` / `on conflict do nothing`) → รันใหม่ได้เลย
> ⚠️ ต้อง**แก้ที่ไฟล์ 0042 เอง ไม่ใช่เขียน 0043 ตามหลัง** — เพราะก้อนที่ล้มจะรัน 0042 ใหม่อยู่ดี
> (ก้อนที่ลงผ่านแล้วข้ามเอง · สถานะปลายทางของทั้งสองลำดับเหมือนกันเป๊ะ)

**`fn_mig_truncate` เป็นรายชื่อตารางที่ hardcode ไว้ใน SQL** — 0039 ลบ `scan_log` แล้วไล่แก้
รายชื่อฝั่ง TypeScript ครบ 6 ไฟล์ แต่**ลืมฟังก์ชันใน DB** → การรีเซ็ต tenant พังทั้งรายการ
· **`npm run test:tenant` เป็นตัวเดียวที่จับได้** (unit test ออฟไลน์มองไม่เห็น SQL ที่อยู่ใน DB)
· แก้แล้วใน 0041 + เติมตารางเงินเดือนเข้าลิสต์ (ไม่เติม = ลบ tenant ติด FK ของ `entities`)

> **บทเรียนที่ต้องใช้ทุกครั้งที่เพิ่ม/ลบตาราง** — ไล่ให้ครบ 6 ที่:
> `lib/snapshot/engine.ts` · `scripts/backup-tables.ts` · `tests/tenant/harness.ts` ·
> `migration/export-supabase-to-csv.ts` · `supabase/seed/cleanup_test.sql` ·
> **และ `fn_mig_truncate` ใน migration ใหม่**

**ไฟล์**: `lib/payroll/{types,calc,legs,report}.ts` + เทส · `app/(app)/payroll/` (ConfigTab · PeriodTab ·
ReportTab · EmployeesTab) · `supabase/migrations/20260819000042_pay_variables_legs.sql`

---

### D68 — ดร็อปดาวน์แท็บย่อยบนแถบเมนูไม่ขึ้น: scroll container ตัดทิ้ง (2026-08-19)

**อาการ**: กดลูกศร ▾ ข้างชื่อ workspace บนแถบเมนูด้านบนแล้ว**ไม่มีอะไรขึ้นเลย**
(ฟีเจอร์นี้มาตั้งแต่ D65 แต่ไม่มีใครเปิดดูด้วยตาจนถึงตอนนี้)

**สาเหตุ**: `<nav>` ของแถบเมนูตั้ง `overflow-x-auto` ไว้ (กันเมนูล้นบนจอแคบ)
ตาม **CSS Overflow 3**: ตั้งแกนหนึ่งเป็น `auto` แล้วอีกแกนที่เป็น `visible` จะ**คำนวณเป็น `auto` ตามไปด้วย**
→ กล่องนั้นกลายเป็น scroll container → ดร็อปดาวน์ที่วางด้วย `absolute top-full`
โผล่ต่ำกว่าความสูงของแถบเมนู จึง**ถูกตัดหายทั้งอัน** (ตัว React เปิด/ปิด state ถูกต้องมาตลอด)

**แก้**: เปลี่ยนเป็น `flex-wrap` — เมนูเยอะจนล้นให้**ตกบรรทัด** ไม่ใช่เลื่อนแนวนอน
(เมนูมีมากสุด 5 ตัวและเป็นคำไทยสั้น ๆ · จะตกบรรทัดเฉพาะช่วงกว้าง ~768–1000px เท่านั้น
· ที่ ≥1100px ยังเรียงบรรทัดเดียวเหมือนเดิมทุกประการ)

**พิสูจน์แล้วในเบราว์เซอร์จริง** (ไม่ได้เดาจากการอ่านโค้ด): ทำหน้าชั่วคราวใต้ `/login`
เรนเดอร์คอมโพเนนต์ `Nav` ตัวจริง (หน้าอื่นเข้าไม่ได้เพราะ middleware เด้งไป login) แล้ว
**สลับคลาสไปมา 2 รอบ** — ใส่ `overflow-x-auto` กลับ = กดแล้วลูกศรพลิกเป็น "เปิดอยู่"
แต่**ไม่มีเมนูโผล่** และมี **scrollbar แนวตั้งงอกที่แถบเมนู** (= หลักฐานตรง ๆ ว่ากลายเป็น
scroll container) · ใส่ `flex-wrap` = เมนู 11 แท็บโผล่ครบ · ลบหน้าชั่วคราวทิ้งแล้ว

> 🪤 **บทเรียน**: `build` / `lint` / `test` **ผ่านหมดทั้งที่ฟีเจอร์ไม่ทำงานเลย** —
> บั๊กประเภท "ของถูกวาดออกมาแล้วแต่ถูก ancestor ตัด" ไม่มีเครื่องมืออัตโนมัติตัวไหนในโปรเจกต์นี้จับได้
> ต้องเปิดดูด้วยตาอย่างเดียว · ตระกูลเดียวกับ selector trap ของ D43 ข้อ 1
> **ห้ามใส่ `overflow-*` (ที่ไม่ใช่ `visible`) กลับเข้าไปที่ `<nav>` ตัวนี้อีก** — คอมเมนต์กันไว้ในไฟล์แล้ว

---

### D69 — เงินเดือนรอบ 2: เอกสารยื่นราชการ 4 ตัว (0043, 2026-08-19)

**ทำไมถึงเป็นงานถัดไป**: รอบ 1-2 คำนวณและลงบัญชีได้ แต่**ยังยื่นราชการไม่ได้**
ซึ่งเป็นเหตุผลหลักที่โรงเล็กยอมจ่ายค่าโปรแกรม · ระบบเดิมบน GAS ทำครบทั้ง 4 ตัวแล้ว
(`D:\Pat\clasp-AIM-เงินเดือน` — นอก repo โดยเจตนา) ทุกตัวเป็นตาราง HTML → PDF ล้วน ๆ

#### 🎯 มติที่กำหนดรูปงานทั้งหมด: ผู้ใช้ **กรอกในเว็บราชการเอง**

ถามแล้ว (2026-08-19) — ไม่ได้อัปโหลดไฟล์ → ของที่คุ้มที่สุดคือ **หน้าจอที่ก๊อปตัวเลขไปกรอกได้ทันที**
ไม่ใช่ PDF สวย ๆ · แท็บจึงออกแบบรอบ "คนกรอกเว็บ": กล่องยอดรวมตัวใหญ่ + **ปุ่มคัดลอกตาราง (TSV)**
เป็นของหลัก · พิมพ์ PDF เป็นของรองไว้เก็บแฟ้ม
· **ไม่ทำไฟล์ upload e-Filing** — ต้องมีไฟล์ตัวอย่างจริงมาเทียบรูปแบบก่อน ยังไม่มี

#### 🚨 ตัดตัวกรอง "> 0" ของระบบเดิมทิ้งทั้งหมด (ผู้ใช้ทักเอง — และทักถูก)

ระบบเดิมกรอง `wht > 0` (ภงด.1/ภงด.1ก) และ `sso > 0` (สปส.1-10) ทิ้ง
ตอนร่างแผนรอบแรกยกมาทั้งดุ้นโดยอ้าง **กติกาเหล็กข้อ 5** ("ยึดโค้ดเดิม") — ซึ่ง**อ้างผิด**:

> ข้อ 1/ข้อ 5 พูดถึง **สูตรคำนวณ** ที่เทียบค่าไม่ได้ · การเลือกว่าจะ *แสดงใคร* ในรายงาน
> **ไม่ใช่สูตร** (ยอดของแต่ละคนเท่าเดิมทุกบาทไม่ว่าจะกรองหรือไม่) → เอากติกานั้นมาคุ้มไม่ได้
> **"ระบบเดิมทำแบบนี้" ไม่ใช่เหตุผล ถ้าอธิบายไม่ได้ว่าทำไมถึงถูก**

การตัดคนออกทำให้เอกสาร**ผิด** ไม่ใช่แค่ดูไม่ครบ:
- ภงด.1 / ภงด.1ก ถามจำนวน **ผู้มีเงินได้** ไม่ใช่ผู้ถูกหักภาษี
  🔴 **โรงเล็กที่ไม่มีใครถึงเกณฑ์เสียภาษีเลย → ใบแนบว่างเปล่าทั้งใบ** ทั้งที่ต้องยื่นรายชื่อ
  — และนั่นคือลูกค้ากลุ่มหลักของสินค้านี้
- สปส.1-10 หายจากแบบนำส่ง = สปส. อ่านได้ว่าคนนั้น**สิ้นสภาพผู้ประกันตน** ·
  เดือนที่ลาไม่รับค่าจ้างทั้งเดือนต้องขึ้นชื่อพร้อมเลข 0
- 50ทวิ ม.50 ทวิ ไม่ได้ยกเว้นกรณีภาษี 0 และลูกจ้างต้องใช้ไปยื่น ภงด.91 ของตัวเอง

**ข้อยกเว้นเดียวที่คงไว้** (ผู้ใช้เคาะ): คนที่ติดธง `ssoExempt` ไม่ขึ้น สปส.1-10 —
ธงนั้นแปลว่า **"ไม่ใช่ผู้ประกันตน" ไม่ใช่ "เงินสมทบเป็น 0"** และเป็นเจตนาที่ผู้ใช้ตั้งเองทีละคน
ไม่ใช่การเดาของโค้ด · **แต่คนคนนั้นยังต้องขึ้นใน ภงด.1 ตามปกติ** (คนละเรื่องกัน)

#### `taxableIncome` ต้องถูกแช่ไว้ ไม่ใช่คำนวณสด

`calc.ts` คำนวณฐานภาษีอยู่แล้วแต่ไม่ได้คืนออกมา → ไม่ถูกแช่ลง `payroll_items.computed`
ถ้าเอกสารไปไล่อ่านธง `taxable` สดจาก config ตอนออก **ลูกค้าแก้ธงกลางปีเมื่อไหร่
ตัวเลขที่ยื่นราชการไปแล้วเปลี่ยนย้อนหลังเงียบ ๆ** (กับดักเดียวกับ D66 ข้อ 2)
- แก้โดย **คืนค่าที่คำนวณอยู่แล้ว** ไม่แตะสูตรเลย → **golden test เดิม 84 ตัวผ่านโดยไม่แก้ไฟล์เทส**
  = หลักฐานว่าเส้นทางคำนวณไม่ขยับ
- งวดที่บันทึกก่อนหน้านี้ไม่มีค่านี้ → fallback เป็น `gross` **พร้อมป้ายเตือนบนหน้าจอ**
  (ตรงกับระบบเดิมพอดีเพราะที่นั่นทุกรายการติดธงภาษี — แต่ห้าม fallback เงียบ ๆ)

#### เลข 50ทวิ ของพนักงาน = **ชุดเดียวกับใบของคู่ค้า** ต่อ entity

ตรงกับระบบเดิม (ใช้ชีต `pnd3-53` ร่วมกัน) · แยกชุดเมื่อไหร่ = เลขซ้ำกันข้ามชุดในกิจการเดียว
ซึ่งกรมสรรพากรไล่ไม่ได้ · `pndType='ภ.ง.ด.1ก'` · `income_seq=1` (ม.40(1))
· ลูกจ้าง**ไม่ได้อยู่ใน `contacts`** โดยตั้งใจ (D66) → `contact_id` เป็น null
· ไม่ส่ง `tx_ids` — ใบของพนักงานไม่ผูกกับ transaction ใบใดใบหนึ่ง (ส่งไปจะไปเขียน
`payment_date` ทับรายการบัญชี ซึ่งไม่ใช่ความหมายของใบนี้)
· กันใบซ้ำด้วย **partial unique index** `(tenant_id, entity_id, emp_id, tax_year)` —
ระบบเดิมกันด้วยการค้นในชีตซึ่งไม่ atomic

#### 🪤 กับดักที่เจอตอนทำ

**1. `create or replace function` ที่จำนวนพารามิเตอร์ต่างกัน = สร้าง overload ตัวที่สอง**
`fn_issue_wht` เพิ่ม 2 พารามิเตอร์ที่มี default → ฝั่งบัญชีที่เรียกด้วย 13 อาร์กิวเมนต์
จะแมตช์ได้ทั้งสองตัว → `function is not unique` = **ออก 50ทวิ ของคู่ค้าพังทันทีทั้งที่ไม่ได้แตะโค้ดฝั่งนั้น**
→ ต้อง `drop function if exists <signature เดิม>` ก่อนเสมอ

**2. `entityId` ว่าง = เลขเอกสารซ้ำเงียบ ๆ**
ร่างแรกส่ง `entityId: ""` ให้ `nextWhtDocNo` โดยคิดว่า RPC จะ fallback ให้ →
query `.eq("entity_id","")` คืน 0 แถว → **นับเลขใหม่จาก 01 ทับใบที่มีอยู่**
และ RPC จะ fallback ไป `'EID01'` ที่ฮาร์ดโค้ดไว้ = ผิดกิจการทันทีสำหรับลูกค้ารายอื่น
→ กิจการต้องมาจาก**งวดจริง** (`payroll_periods.entity_id`) ไม่ใช่กิจการปริยายของ tenant

**3. 🔴 หนี้จาก 0042 ที่เพิ่งพลาดซ้ำกับที่ D67 เตือนไว้เอง**
0042 สร้าง `pay_variables` / `pay_post_legs` แต่**ไม่ได้ลงทะเบียนใน 6 ที่**
→ รีเซ็ต tenant จะทิ้งของ 2 ตารางนี้ค้างแล้วไปติด FK ของ `entities` · `backup:tables` ไม่สำรอง ·
snapshot/restore ไม่ครอบ · แก้ครบใน 0043 นี้แล้ว (`fn_mig_truncate` + `engine.ts` +
`backup-tables.ts` + `harness.ts`)
> **บทเรียนซ้ำสอง: checklist ที่เขียนไว้ในเอกสารไม่ช่วยถ้าไม่มีอะไรบังคับ**
> — ควรมีเทสที่เทียบรายชื่อตารางใน `information_schema` กับลิสต์ในโค้ด (ยังไม่ได้ทำ)

**ไฟล์**: `lib/payroll/{filings,filingHtml}.ts` + เทส 35 ตัว · `app/(app)/payroll/_components/FilingTab.tsx`
· `supabase/migrations/20260819000043_payroll_filings.sql` · `entities.sso_employer_no`
(กรอกที่ `/settings/company` · ไม่กรอก = ใช้เลขผู้เสียภาษีแทนเหมือนระบบเดิม)

**ยังไม่ทำ**: ไฟล์อัปโหลด e-Filing · หน้าหลักของแบบ (ทำแต่ใบแนบ) · เงินได้นอก 40(1)

---

### D70 — ตัวแปรกลาง: ตัวดำเนินการ 4 ตัว + ความละเอียดของค่า · ย้ายลำดับคอลัมน์ที่กรอก (0044, 2026-08-19)

**ที่มา**: ผู้ใช้ลองใช้จริงแล้วขอ 2 อย่าง — (1) ตัวแปรกลางเลือกได้ว่าจะ **บวก/ลบ/คูณ/หาร**
และเลือกได้ว่าเก็บค่าเป็น **จำนวนเต็มหรือทศนิยม 2 ตำแหน่ง** · (2) **ย้ายลำดับคอลัมน์**
"ช่องที่ต้องกรอกต่อคนต่องวด" ได้ (ของที่เพิ่มทีหลังไปอยู่ท้ายสุดเสมอ)

#### 🚨 ข้อ 1 ชนกับกติกาที่ D67 เขียนไว้เองว่า "ห้ามขยายเป็น expression engine" — ตรวจแล้วว่าไม่ชน

สิ่งที่กติกานั้นปกป้องจริง ๆ มี 3 ข้อ: **ไม่มี parser · ไม่มีลำดับความสำคัญของตัวดำเนินการ ·
เส้นทางคำนวณนับได้จนครบ** (= golden test คลุมได้ทุกเส้นทาง ตามกติกาเหล็กข้อ 1)
การเพิ่มตัวดำเนินการเป็น **ชุดปิด 4 ตัว ที่คิดเรียงทีละขั้น** ยังรักษาครบทั้ง 3 ข้อ
→ เป็นการ **ขยายชุดปิด ไม่ใช่สร้างภาษา**

> **เส้นที่ยังห้ามข้าม** (เขียนไว้ให้ชัดกว่าเดิม): **วงเล็บ · ตัวแปรอ้างตัวแปร ·
> สูตรที่ลูกค้าพิมพ์เป็นข้อความ** — 3 อย่างนี้เมื่อไหร่ก็ตามที่มี จะต้องมี parser ทันที
> และ "จำนวนเส้นทาง" จะกลายเป็นอนันต์ = เทียบค่าไม่ได้อีกต่อไป

**เพดานขั้นขยับจาก 2 → 3** เพราะพอมี +/− แล้ว 2 ขั้นแคบเกินสำหรับเคสจริงที่พบบ่อย:
`((ฐาน + ค่าตำแหน่ง) ÷ วันมาตรฐาน) ÷ ชม./วัน` · **เพดานยังต้องมีอยู่** เพราะเพดาน
คือสิ่งที่ทำให้เส้นทาง "นับได้จนครบ" ซึ่งเป็นเหตุผลทั้งหมดที่ยอมให้มีตัวดำเนินการ

#### 🪤 ความเสี่ยงใหม่ที่มาพร้อมตัวดำเนินการ: คนอ่านสูตรด้วยกฎคณิตศาสตร์

ระบบคิด **เรียงซ้ายไปขวาทีละขั้น** แต่สมองคนอ่าน `ฐาน − A ÷ B` เป็น `ฐาน − (A÷B)` อัตโนมัติ
ขณะที่ระบบให้ `(ฐาน − A) ÷ B` — **ตั้งเกณฑ์ผิดแบบนี้ไม่มีอะไร error ได้แค่ตัวเลขผิดทุกงวด**

→ กันด้วย `variableFormulaText()` ที่ **ใส่วงเล็บครบทุกขั้นเสมอ** แล้วโชว์ทั้งใน
ตารางรายการตัวแปร และในกล่อง **"สูตรที่จะถูกใช้จริง"** บนหน้าแก้ไข (อัปเดตสด)
· `variableWarnings()` เตือนเพิ่มเมื่อสูตร**ปน +/− กับ ×/÷** ซึ่งเป็นกรณีเดียวที่อ่านผิดได้
· **เตือนไม่บล็อก** (แพตเทิร์นเดียวกับ `legCoverage` ใน D67)

#### 🪤 หารด้วย 0 ข้าม · คูณด้วย 0 **ไม่ข้าม**

กฎเดิม "ตัวหารเป็น 0 = ข้ามขั้นนั้น" ต้องคงไว้เป๊ะ (เดือนที่ยังไม่กรอกชั่วโมงได้ตัวหาร 0 เป็นปกติ)
แต่ **ห้ามเอากฎนี้ไปใช้กับ ×** — คูณด้วย 0 ได้ 0 ซึ่งนิยามชัดเจนและถูกต้อง
ถ้าไปข้ามจะได้ค่าตั้งต้นกลับมา = **ยอดพองขึ้นเงียบ ๆ** ซึ่งอันตรายกว่า Infinity มาก
(Infinity อย่างน้อยยังเห็นว่าผิด)

#### ความเข้ากันได้กับของที่ตั้งไว้แล้ว — 2 ค่าปริยายที่ห้ามเปลี่ยน

| ค่า | ปริยาย | ถ้าเปลี่ยนจะเกิดอะไร |
|---|---|---|
| `op` ของขั้นที่ไม่ระบุ | `div` | ข้อมูลก่อน D70 ไม่มีช่องนี้ — เปลี่ยนเมื่อไหร่ อัตราของลูกค้าเดิมเพี้ยนทันที |
| `rounding` | `none` (ไม่ปัด) | ค่าเดิมเป็นความละเอียดเต็ม — ตั้ง `int` เป็นปริยายเมื่อไหร่ อัตราต่อชั่วโมงของลูกค้าทุกเจ้าขยับพร้อมกันเงียบ ๆ |

★ คอลัมน์ `divisors` ถูก **rename เป็น `steps`** (ชื่อเดิมมาจากสมัยที่หารได้อย่างเดียว)
แต่ฝั่ง TS **ยังอ่าน `divisors` ต่อไว้โดยตั้งใจ** — เพราะ golden test ชุดก่อน D70
เขียนด้วยชื่อนั้น → **ผ่านโดยไม่ต้องแก้ไฟล์เทสแม้แต่บรรทัดเดียว = หลักฐานว่าเส้นทางเดิมไม่ขยับ**

#### ด่านของ "ชุดปิด" อยู่ที่ server action ไม่ใช่ CHECK ใน DB

`savePayVariableAction` ปฏิเสธ `op` / `rounding` นอกชุด — **anon key เป็นค่าสาธารณะ
ยิง PostgREST ตรงได้** จึงต้องมีด่านฝั่ง server · ตั้งใจ**ไม่**ทำ CHECK บน jsonb
เพราะอ่านยากและบำรุงรักษาแพงกว่าที่ได้ · ค่าที่หลุดมาแบบอื่นถูกตีความเป็น `div`
ซึ่งเป็นพฤติกรรมเดิม ไม่ทำให้พัง

#### ข้อ 2 — ย้ายลำดับคอลัมน์ที่กรอก

`pay_inputs.sort` มีอยู่แล้วแต่ไม่เคยมี UI · เพิ่มปุ่ม ▲▼ + `reorderPayInputsAction`
ที่ **เขียนลำดับใหม่ทั้งชุด (0..n-1)** ไม่ใช่สลับทีละคู่ — ลำดับที่เห็นบนจอคือลำดับที่บันทึก
แม้ค่า `sort` เดิมจะซ้ำหรือข้ามเลข
🪤 เก็บลำดับเป็น state ในเครื่องด้วย เพราะแท็บถูก mount ค้างด้วย CSS → prop จาก
`router.refresh()` มาช้ากว่าที่ผู้ใช้คาด แล้วผู้ใช้จะกดซ้ำ (บั๊กตัวเดียวกับรายชื่อพนักงานใน D67)

**ไฟล์**: `lib/payroll/varText.ts` (+ เทส 19) · `lib/payroll/{calc,types}.ts` ·
`app/(app)/payroll/_components/ConfigTab.tsx` · `supabase/migrations/20260819000044_pay_variable_ops.sql`

---

### D71 — หน้าตั้งค่าการคำนวณ: แก้ 3 บั๊กที่ทำให้ตั้งค่าไม่ได้จริง + รวมกล่อง (2026-08-19)

**ที่มา**: ผู้ใช้ลองตั้งเกณฑ์จริงหลัง D70 แล้วแจ้ง 5 ข้อ — 3 ข้อเป็นบั๊กที่ทำให้**กรอกไม่ได้จริง**
· **ไม่มี migration** ในรอบนี้ (UI + ข้อความสูตรล้วน ๆ)

#### 🔴 บั๊กที่ 1 (ตัวใหญ่สุด): พิมพ์ 1 ตัวอักษรแล้วช่องหลุดโฟกัส

ผู้ใช้แจ้งว่า *"ค่าคงที่ใส่ทศนิยม 2 ตำแหน่งไม่ได้ / การพิมพ์ตัวเลขก็แปลก ๆ บอกไม่ถูก"*
ตอนแรกเดาว่าเป็นเรื่อง `NumBox` ไม่รับจุดทศนิยม — **เดาผิด** · ลองในเบราว์เซอร์แล้ววัดได้ว่า:

> พิมพ์ 1 ตัวอักษร → **โหนด `<input>` ถูกทำลายและสร้างใหม่** (`document.contains(node)` = false)
> และ **โฟกัสหลุดไปที่ `<body>`**

**สาเหตุ**: `SlotPicker` ถูกประกาศเป็น arrow function **ข้างในคอมโพเนนต์** `Variables`
→ ทุกครั้งที่ `setState` React ได้ **component type ตัวใหม่** (identity เปลี่ยน)
→ unmount + mount ใหม่ทั้งกิ่ง → state ของ `NumBox` (`raw`) และโฟกัสหายทุกคีย์
→ ต้องคลิกกลับเข้าช่องทุกตัวอักษร ทศนิยมจึงพิมพ์ไม่ได้ในทางปฏิบัติ

**แก้**: ยกออกไปประกาศระดับโมดูล · ตรวจทั้ง repo แล้ว**มีที่เดียว**
> 🪤 **กฎที่ต้องจำ: ห้ามประกาศคอมโพเนนต์ข้างในคอมโพเนนต์** — อาการไม่ใช่ error
> แต่เป็น "ฟอร์มใช้งานไม่ได้" ซึ่ง `build`/`lint`/`test` มองไม่เห็นทั้งหมด (ตระกูลเดียวกับ D68)

#### 🔴 บั๊กที่ 2: ขั้นบันไดกรอกได้ขั้นเดียว

ช่องเดียวเป็น `TextInput` ที่ **แปลงกลับไปกลับมาทุกคีย์**
(`"1=500, 2=300"` ↔ array) แล้ว `filter(upTo > 0)` ทิ้งขั้นที่ยังพิมพ์ไม่เสร็จ
→ พิมพ์คอมมาแล้วคอมมาหายทันที · **วัดจริงได้ว่าพิมพ์ `1=500, 2=300` ออกมาเป็น `1=5002300`**

**แก้**: `TierEditor` แบบ **แถวละเงื่อนไข** (`ถ้าค่าที่กรอก ≤ __ → ได้ __ บาท` + เพิ่ม/ลบ)
ไม่มีการ parse สตริงอีกเลย — และเป็นคำตอบของคำถามผู้ใช้ว่า *"ทำเป็นเงื่อนไขที่เลือกได้ว่ากี่เงื่อนไข"* ด้วย
· 🚨 **เรียงขั้นจากน้อยไปมากให้อัตโนมัติตอนบันทึก** (`sortTiers`) เพราะ `tierAmount()`
คืน**ขั้นแรก**ที่เข้าเงื่อนไข — เรียงผิดแล้วได้เงินผิดขั้นโดยไม่มีอะไรฟ้อง (มีเทสพิสูจน์ไว้)

#### บั๊กที่ 3: ข้อความแจ้งเตือนโดนป๊อปอัพบัง

`<Msg>` อยู่บนสุดของการ์ด ส่วนป๊อปอัพเป็น `fixed inset-0 z-50` → บันทึกไม่ผ่านแล้ว
ข้อความไปขึ้น**หลัง**ป๊อปอัพ · แก้โดยใส่ `<Msg>` ในป๊อปอัพเหนือแถวปุ่มด้วย (ยังคงตัวนอกไว้
สำหรับปุ่มที่อยู่นอกป๊อปอัพ เช่น ลบ/ย้ายลำดับ)

#### 🪤 ที่เจอเพิ่มระหว่างแก้ (ผู้ใช้ไม่ได้แจ้ง): ตัวคูณเริ่มต้นเป็น 0

`blankComponent()` ตั้ง `multiplier: 0` → เลือกวิธีคิด "ตัวแปรกลาง" แล้วไม่แตะตัวคูณ
= **ยอดเป็น 0 ทุกงวดเงียบ ๆ** · น่าจะเป็นสาเหตุจริงที่ผู้ใช้รู้สึกว่า "ใช้ตัวแปรเพิ่ม/หักตรง ๆ ไม่ได้"
→ เริ่มต้นเป็น **1** + เตือนถ้าตัวคูณเป็น 0

#### รวม "ตัวแปร" กับ "รายการเพิ่ม/หัก" เป็นการ์ดเดียว (ผู้ใช้เสนอ · เคาะแล้ว)

การ์ด **"สูตรและรายการคำนวณ"** — ป๊อปอัพเดียว มีตัวเลือกชนิดบนสุด (เลือกได้เฉพาะตอนสร้างใหม่
เพราะของที่บันทึกแล้วอยู่คนละตาราง ย้ายข้ามไม่ได้)

> 🚨 **ยังแยกหัวข้อ "ตัวแปร — คิดก่อน" / "รายการเพิ่ม/หัก — คิดทีหลัง" ในลิสต์**
> เพราะ `calc.ts` คิดตัวแปรที่ขั้น 3(ข) **ก่อน**รายการที่ขั้น 2/6 →
> **รายการอ้างตัวแปรได้ แต่ตัวแปรอ้างรายการไม่ได้** · ถ้าเอามาปนเป็นลิสต์เดียว
> ผู้ใช้จะคาดว่าอ้างข้ามกันได้แล้วงงว่าทำไมได้ 0 — หัวข้อกลุ่มคือสิ่งที่ทำให้ลำดับนี้ยังมองเห็น

**ตัดสินว่ารายการเพิ่ม/หัก ยังอ้างตัวแปรเหมือนเดิม ไม่มีช่องขั้นสูตรของตัวเอง** (ผู้ใช้เลือก) —
อยากได้สูตรซับซ้อนให้สร้างเป็นตัวแปรก่อนแล้วอ้าง · **ชุดการคำนวณจึงมีชุดเดียว**
= เทสครอบง่าย และของที่ตั้งไว้แล้วไม่ขยับ

#### แสดง "สูตรที่จะถูกใช้จริง" ของรายการเพิ่ม/หักด้วย

`componentFormulaText()` ครบทั้ง 6 วิธีคิด + บอกวิธีรวมหลายช่องกรอก (`+` / `เฉลี่ยกับ`)
ซึ่งเดิม**มองไม่เห็นเลยว่าตั้ง sum หรือ avg ไว้**

**ไฟล์**: `app/(app)/payroll/_components/ConfigTab.tsx` · `lib/payroll/varText.ts` (+ เทสรวม 35)
· **ไม่แตะ** `calc.ts` / `types.ts` / DB → golden test เดิมผ่านครบโดยไม่แก้ไฟล์เทส

---

### D72 — หน้าตั้งค่า: เลิกให้ผู้ใช้ตั้งรหัสเอง · ยืนยันก่อนลบ · หมวด/คู่ค้าพิมพ์เอง+มีตัวช่วย (2026-08-19)

**ไม่มี migration** — UI + server action ล้วน ๆ

#### 1. ผู้ใช้ไม่ต้องคิดรหัสเอง (`a-z 0-9 _`) อีกแล้ว

ทั้ง 4 ที่ (ช่องกรอก · ตัวแปร · รายการเพิ่ม/หัก · ขาลงบัญชี) เคยบังคับให้ตั้งรหัส ASCII เอง
ผู้ใช้บอกตรง ๆ ว่า *"สุดท้ายไม่ได้จำ"* — จริง เพราะรหัสพวกนี้เป็น**คีย์ภายใน** ไม่ใช่ของที่คนต้องอ่าน

→ `nextCode()` ใน `actions.ts` สร้างให้เอง (`in1` · `var1` · `item1` · `leg1`)
· ช่องรหัสหายจากทุกฟอร์ม และคอลัมน์รหัสหายจากตารางช่องกรอก

> 🚨 **สร้างให้เฉพาะของใหม่ · ของที่บันทึกแล้วห้ามเปลี่ยนรหัสเด็ดขาด**
> เพราะรหัสถูกอ้างจาก `pay_components.variable_code` · `input_keys[]` ·
> `pay_post_legs.component_code` และที่หนักที่สุดคือ **`payroll_items.inputs`/`computed`
> ของงวดที่แช่ค่าไว้แล้ว** → เปลี่ยนรหัสเมื่อไหร่ งวดเก่าอ่านค่าที่แช่ไว้ไม่เจอ **แล้วยอดกลายเป็น 0 เงียบ ๆ**
> (โค้ดจึงเขียนเป็น `code.trim() || await nextCode(...)` — มีรหัสอยู่แล้วใช้ของเดิมเสมอ)

#### 2. ยืนยันก่อนลบทุกจุดในหน้าตั้งค่า

เดิมมีแค่ 2 จุด (รายการเพิ่ม/หัก · ขา) ที่ถาม · กลุ่มพนักงาน/ช่องกรอก/ตัวแปร **ลบทันทีที่กด**
→ `askDelete(what, then)` ตัวกลาง ใช้ครบทั้ง 7 ปุ่ม · ข้อความมีชื่อของจริง + บอกว่ากู้คืนไม่ได้
· ยืนยันในเบราว์เซอร์แล้วว่าถามครบ 7/7

#### 3. หมวดรายจ่าย + คู่ค้าของขาลงบัญชี = พิมพ์เองได้ **และ**มีตัวเลือกให้

**เข้าใจกันผิดตั้งแต่ D67**: ตอนนั้นสรุปว่า *"หมวดรายจ่ายพิมพ์เอง ไม่ดึงจากรายการหมวดเดิม"*
แล้วทำเป็นช่องพิมพ์เปล่า ๆ · ที่ผู้ใช้ต้องการจริงคือ **ทั้งสองอย่าง** — พิมพ์ค่าใหม่ได้
แต่ต้องมีของที่เคยใช้ให้เลือกด้วย (พิมพ์เองล้วน = สะกดไม่ตรงกับหมวดเดิมแล้วรายงานแตกเป็น 2 หมวด)

→ `SuggestInput` ใน `lib/shared/ui.tsx` (`<input list>` + `<datalist>`) —
แพตเทิร์นเดียวกับช่องหมวด/คู่ค้าในแท็บบันทึกของบัญชีที่ใช้มานานแล้ว
· หมวดมาจาก `transactions.category` ที่ `type='รายจ่าย'` **+ หมวดที่ตั้งไว้ในขาแล้ว**
  (หมวดที่เพิ่งตั้งแต่ยังไม่เคยลงบัญชีจริงต้องขึ้นเป็นตัวเลือกด้วย ไม่งั้นพิมพ์ซ้ำทุกครั้ง)
· คู่ค้ามาจาก `contacts.name`

> ★ **ต่างจาก `Combobox` ที่มีอยู่เดิม**: `Combobox` เลือกได้เฉพาะที่มีในรายการ ·
> `SuggestInput` พิมพ์ค่าใหม่ได้ — ใช้กับช่องที่ค่าที่ถูกต้องไม่ได้จำกัดอยู่แค่ที่มีในระบบ

**ไฟล์**: `app/(app)/payroll/{actions,data}.ts` · `_components/ConfigTab.tsx` · `lib/shared/ui.tsx`

---

### D73 — งวดจ่ายโชว์ค่าที่แช่ไว้ · ป๊อปอัพเลิกปิดเองตอนลากคลุมข้อความ + กด Esc ได้ (2026-08-19)

**ไม่มี migration**

#### 1. 🚨 หน้างวดจ่ายเคยโชว์ค่าที่ "คิดสด" แม้กับงวดที่บันทึกไปแล้ว

ผู้ใช้ลบรายการเพิ่ม 1 ตัว แล้วพบว่า **แท็บรายงานไม่ขยับ แต่หน้างวดจ่ายเปลี่ยนทันที** —
รายงานถูกแล้ว (อ่านจาก `payroll_items.computed` ที่แช่ไว้) ส่วนหน้างวดจ่ายผิด:
`preview` ใน `PeriodTab` เรียก `calcPayrollLine()` ใหม่จาก config ปัจจุบัน**ทุกแถวเสมอ**

> กติกา "ห้ามคำนวณสด" (D66 ข้อ 2) ถูกบังคับไว้แน่นที่ชั้นข้อมูล/รายงาน/เอกสารยื่น
> แต่**หลุดที่หน้าจอของงวด** — ซึ่งเป็นหน้าที่คนดูบ่อยที่สุด และเป็นหน้าที่ใช้ตัดสินใจกดลงบัญชี

**แก้**: แยก `live` (คิดสด) ออกจาก `shown` (ค่าที่เอาไปแสดง)
- แถวที่ผู้ใช้**ยังไม่แตะ** + มีค่าแช่ไว้ → โชว์ **ค่าที่แช่ไว้** (ตรงกับรายงาน/สลิป/บัญชี)
- แถวที่ผู้ใช้**แตะช่องกรอกแล้ว** → โชว์ค่าสด (กำลังจะบันทึกใหม่ ต้องเห็นผลทันที)
- ต่างกันเมื่อไหร่ → **แถบเตือนบอกจำนวนคนที่ยอดไม่ตรง** + บอกว่ากดบันทึกแล้วจะถูกเขียนทับ
  (ไม่บล็อก — เปลี่ยนเกณฑ์แล้วอยากคิดใหม่เป็นเรื่องปกติ แต่ต้องรู้ตัว)

★ `doSave` ส่งแต่ **ค่าที่กรอก** ให้ server คำนวณเอง → การเปลี่ยนสิ่งที่ "แสดง" ไม่กระทบสิ่งที่ "บันทึก"

#### 2. 🐛 ป๊อปอัพปิดเองตอนลากคลุมข้อความ — เป็นทั้งแอป

พื้นหลังป๊อปอัพปิดด้วย `onClick` · เวลาลากคลุมข้อความในช่องกรอกแล้ว**ปล่อยเมาส์นอกช่อง**
เบราว์เซอร์ยิง `click` ไปที่ **บรรพบุรุษร่วมของ mousedown/mouseup = พื้นหลัง** → ป๊อปอัพปิดกลางคัน
งานที่พิมพ์ค้างไว้หายทันที

> 🪤 `e.target === e.currentTarget` **ไม่ช่วย** ถ้ายังใช้ `onClick` เพราะ target ของ click
> ในกรณีนี้**คือพื้นหลังจริง ๆ** → ต้องเปลี่ยนไปเช็คที่ **`onMouseDown`** ซึ่งเกิดตอนกดลง
> (ลากคลุมเริ่มที่ในช่องกรอก → mousedown target = ช่องกรอก → ไม่ปิด)

แก้ครบ **8 ป๊อปอัพ** ที่ปิดด้วยการคลิกพื้นหลังได้ (บัญชี 3 · เงินเดือน 4 · สำรองข้อมูล 1)

#### 3. กด Esc ปิดป๊อปอัพได้ (ผู้ใช้ขอ)

`<EscToClose onClose={…} />` ใน `lib/shared/ui.tsx` — วางไว้**ในป๊อปอัพ**
จะได้ผูก/ถอด listener ตามการเปิดปิดเองโดยไม่ต้องมี state เพิ่ม
· ใส่ให้เฉพาะป๊อปอัพที่ "ยกเลิกได้" (ตัวเดียวกับที่คลิกพื้นหลังแล้วปิด)
**ไม่ใส่**ให้ป๊อปอัพแจ้งเตือนค่างวด (`billing-notice`) ที่ตั้งใจให้ผู้ใช้ต้องเห็น

#### 4. หมวดรายจ่ายของขาลงบัญชี — รวม 3 แหล่ง

เดิม (D72) ดึงจาก `transactions.category` อย่างเดียว → **หมวดที่ตั้งไว้ในตั้งค่าบัญชี
แต่ยังไม่เคยใช้จริงจะไม่ขึ้น** ซึ่งเป็นเคสที่ผู้ใช้เจอพอดี
→ รวม `app_settings.kind='expense_cat'` (รายการเดียวกับที่ฝั่งบัญชีใช้) +
`transactions.category` + หมวดที่ตั้งไว้ในขาแล้ว

**ไฟล์**: `app/(app)/payroll/_components/PeriodTab.tsx` · `data.ts` · `lib/shared/ui.tsx`
· 8 ไฟล์ที่มีป๊อปอัพ · `app/(app)/accounting/_components/ui.tsx` (re-export)

---

### D74 — ชุดอัตราตามกฎหมาย: แก้/ลบได้ + ขั้นบันไดภาษีเลิกใช้ช่องข้อความ (2026-08-19)

**ไม่มี migration** — `savePayRatesAction` เป็น upsert บน `effective_from` อยู่แล้ว
และ `deletePayRatesAction` ก็มีอยู่แล้วตั้งแต่ 0040 **แค่ไม่เคยมีปุ่มให้กด**

#### สิ่งที่เพิ่ม
- ปุ่ม **แก้ / ลบ** ต่อแถวในตารางชุดอัตรา · แถวที่กำลังแก้ไฮไลต์ไว้
- หัวฟอร์มบอกสถานะชัด (`เพิ่มชุดอัตราใหม่` / `กำลังแก้ชุดที่เริ่มมีผล …`) + ปุ่ม **เลิกแก้**
- คอลัมน์ **ขั้นภาษี** บอกจำนวนขั้น (เดิมมองไม่เห็นเลยว่าชุดไหนมีกี่ขั้น)

#### 🪤 บั๊กแฝงที่เจอตอนทำ: ฟอร์มเปิดมาพร้อมข้อมูล**ชุดล่าสุด รวมวันที่**

`useState(() => config.rates[0] ?? {…})` → กด "บันทึกชุดอัตรา" ก็ **upsert ทับชุดล่าสุด**
ทั้งที่ผู้ใช้คิดว่ากำลังเพิ่มชุดใหม่ (คีย์ของตารางคือ `effective_from`)
· ที่ผ่านมาไม่มีใครเจอเพราะยังไม่มีปุ่มแก้ให้กด และมักตั้งชุดเดียวจบ
→ เริ่มที่ `blankRates()` เสมอ · จะแก้ของเดิมต้องกดปุ่ม **แก้** ให้ชัดเจน

#### 🚨 ขั้นบันไดภาษีเป็นช่องข้อความช่องเดียว — บั๊กเดียวกับ D71 เป๊ะ

`"150000=0, 300000=0.05"` ↔ array แปลงกลับไปกลับมาทุกคีย์ + `filter(upTo > 0)`
→ พิมพ์คอมมาแล้วขั้นที่ยังไม่เสร็จโดนทิ้งทันที · **ไม่มีใครเจอเพราะยังไม่มีปุ่มแก้**
→ `BracketEditor` แถวละขั้น (แพตเทิร์นเดียวกับ `TierEditor`)

> 🪤 **บทเรียน: ฟีเจอร์ที่ยังไม่มีทางเข้าถึง = บั๊กที่ยังไม่ถูกนับ**
> ทั้ง 2 บั๊กในรอบนี้ซ่อนอยู่หลัง "ไม่มีปุ่มแก้" — พอเพิ่มปุ่มเดียวก็โผล่พร้อมกัน
> ★ เวลาเปิดทางเข้าถึงของเดิม ต้องถือว่าโค้ดตรงนั้น**ยังไม่เคยถูกทดสอบ**

#### ★ อัตราภาษียังเก็บเป็นทศนิยม (0.05) เหมือนเดิม — แต่โชว์ `= 5%` ข้าง ๆ

ตั้งใจ**ไม่แปลงหน่วยที่เก็บ** — การแปลง %↔ทศนิยมทุกครั้งคือโอกาสพลาดกับเลขภาษี
(กติกาเหล็กข้อ 1) · แสดงผลอย่างเดียวก็แก้ความกำกวมได้แล้ว

#### เตือนเมื่อแก้ชุดที่**มีผลไปแล้ว**

งวดที่บันทึกไว้จะไม่ขยับ (แช่ไว้ใน `payroll_items.rates_snapshot` — D66)
แต่ถ้ากดคำนวณ&บันทึกงวดเก่าใหม่จะได้อัตราที่แก้ → แถบเตือนบอกให้เลือกว่า
*ซ่อมค่าที่กรอกผิด* (แก้ชุดเดิม) หรือ *อัตราใหม่ตามกฎกระทรวง* (เพิ่มชุดใหม่)

**ไฟล์**: `app/(app)/payroll/_components/ConfigTab.tsx` เท่านั้น

---

### D75 — ชื่อในงวดต้องเป็นชื่อปัจจุบัน · งวดร่างต้องโชว์ยอดที่คิดใหม่ (2026-08-19)

**ไม่มี migration** · ผู้ใช้แจ้ง 2 อาการหลังแก้ทะเบียนพนักงาน (เปลี่ยนชื่อ · เปลี่ยนชนิดค่าจ้าง
จากรายเดือนลดตามวัน → เต็มจำนวน · แก้ฐานเงินเดือน) แล้วเปิดงวดร่างที่เคยบันทึกไว้

#### 1. ชื่อไม่เปลี่ยน — `payroll_items.emp_name` เป็น snapshot

หน้าจอ/สลิปอ่านจาก snapshot ตรง ๆ → แก้ชื่อในทะเบียนแล้วงวดเดิมยังเป็นชื่อเก่า
(พนักงานที่เพิ่ง**เพิ่มใหม่**ขึ้นถูกเพราะ snapshot เพิ่งถูกเขียน)

**กติกาที่ตั้งใหม่ให้ทั้งโมดูล**:
> **ชื่อ = ค่าปัจจุบันเสมอ · ตัวเงิน = ค่าที่แช่ไว้เสมอ**
> ชื่อสะกดผิดต้องแก้ให้ถูกทุกที่ย้อนหลัง · แต่ยอดเงินที่ยื่น/ลงบัญชีไปแล้วห้ามขยับ

→ `nameOf()` ใช้ชื่อจากทะเบียนก่อน · snapshot เหลือเป็น **fallback** กรณีพนักงานถูกลบออกจากทะเบียน

#### 2. 🚨 "คำนวณผิด" — จริง ๆ คือ D73 เลือกโชว์เลขผิดเวอร์ชัน

สูตรไม่ผิด (golden test คลุม "รายเดือนเต็มจำนวน" อยู่แล้ว) · สิ่งที่ผิดคือ **D73 ทำเกินไป**:
เปลี่ยนให้ทุกแถวที่ "เคยบันทึกแล้วและยังไม่แตะ" โชว์ค่าที่แช่ไว้ → ผู้ใช้แก้ฐานเงินเดือน
แล้วเปิดงวดร่างมาดู เห็นยอดเดิม จึงสรุปว่าระบบคำนวณผิด

**ทางออก: เลือกตามสถานะของงวด แล้วโชว์อีกค่าคู่กันเมื่อไม่ตรง**

| งวด | โชว์ | เหตุผล |
|---|---|---|
| **ลงบัญชีแล้ว** | ค่าที่แช่ไว้ | บันทึกทางประวัติศาสตร์ · ต้องตรงกับที่ยื่น · แก้ไม่ได้อยู่แล้ว |
| **ร่าง** | ค่าที่คิดสด | ยังทำงานอยู่ — แก้เกณฑ์/ทะเบียนแล้วต้องเห็นผลทันที |

+ คอลัมน์สุทธิขึ้นบรรทัด **"บันทึกไว้ …"** ทุกแถวที่ต่าง → เห็นทั้งสองเลขพร้อมกัน
ไม่ต้องเดาว่ากำลังดูเวอร์ชันไหน (นี่คือปัญหาที่แท้จริงของทั้ง D73 และรอบนี้)
· แถบเตือนบอกสาเหตุครบทั้ง **เกณฑ์เปลี่ยน** และ **ทะเบียนพนักงานเปลี่ยน**

> 🪤 **บทเรียน: อาการ "ตัวเลขไม่ตรงกัน" แก้ด้วยการเลือกข้างไม่ได้**
> D73 เลือกข้าง "ค่าที่แช่ไว้" แล้วไปสร้างอาการใหม่ · ของแบบนี้ต้อง **แสดงทั้งสองค่า
> พร้อมบอกว่าอันไหนคืออันไหน** — ผู้ใช้ตัดสินเองได้ว่าจะกดคำนวณใหม่หรือไม่

**กฎนี้ถูกดึงออกมาเป็น `lib/payroll/periodView.ts` + เทส 10 ตัว** เพราะพลาดมา 2 รอบติด
(`shownLine()` / `differsFromStored()`) — ตอนนี้มีอะไรคุมแล้ว ไม่ใช่แค่คอมเมนต์

#### 3. 🔴 พรีวิวกับตอนบันทึก **ประกอบข้อมูลพนักงานคนละแบบ** (เจอตอนไล่หาสาเหตุข้อ 2)

หัวไฟล์ `PeriodTab` เตือนไว้ว่า "ห้ามเขียนสูตรซ้ำ 2 ที่" และก็ทำถูก — ทั้งสองฝั่งเรียก
`calcPayrollLine` ตัวเดียวกัน · **แต่ของที่ป้อนเข้าสูตรถูกประกอบแยกกัน 2 ที่** และไม่เหมือนกัน:

| | ฝั่งพรีวิว (`PeriodTab.empOf`) | ฝั่งบันทึก (`actions.calcLine`) |
|---|---|---|
| `groupCode` | `it.groupCode ?? e.groupCode` — **กลุ่มที่แช่ไว้ในแถวงวด** | `r.group_code` — **กลุ่มปัจจุบัน** |

→ ย้ายพนักงานข้ามกลุ่มหลังสร้างงวด แล้วรายการที่ให้เฉพาะกลุ่มจะเข้า/ไม่เข้าไม่ตรงกัน
= **ยอดบนจอกับยอดที่บันทึกจริงคนละตัว โดยไม่มีอะไรฟ้อง**

**แก้**: ทำ `employeeForCalc()` ตัวเดียวใน `lib/payroll/periodView.ts` แล้วให้**ทั้งสองฝั่งเรียกตัวนี้**
· ฝั่ง server เลิก query ดิบเอง → ใช้ `getEmployees()` (mapper เดียวกับหน้าจอ)
· ใช้ค่าจากทะเบียน**ปัจจุบัน**ทั้งหมด สอดคล้องกับข้อ 2

> 🪤 **บทเรียนที่ต่อจากกติกาเดิม**: "สูตรต้องมีที่เดียว" ยังไม่พอ —
> **ของที่ป้อนเข้าสูตรก็ต้องประกอบที่เดียว** ไม่งั้นสูตรเดียวกันก็ให้คนละคำตอบได้

**ไฟล์**: `lib/payroll/periodView.ts` (+เทส 14) · `app/(app)/payroll/_components/PeriodTab.tsx`
· `app/(app)/payroll/actions.ts`

---

### D76 — พ้นสภาพ/ปิดใช้งานแล้วต้องหลุดจากงวด + เอาคนออกจากงวดได้ (2026-08-19)

**ไม่มี migration** · ผู้ใช้ถามว่า *"ติ๊ก ยังทำงานอยู่ ออกแล้วยังขึ้นในงวด · ใส่วันพ้นสภาพ
ก่อนวันเปิดงวดแล้วก็ยังขึ้น"* — ตรวจแล้ว**ถูกทั้ง 2 ข้อ**

#### ช่องโหว่ที่ 1: `end_date` เป็นช่องหลอก

กรอกได้ เก็บลง DB ได้ แต่ **ไม่มีโค้ดไหนอ่านไปใช้เลย** (ตระกูลเดียวกับ
`pay_components.expense_cat` ที่ถูกลบทิ้งใน D67 — ช่องที่กรอกแล้วไม่มีผล
อันตรายกว่าไม่มีช่อง เพราะผู้ใช้เชื่อว่าตั้งแล้วและไม่ไปตรวจซ้ำ)

#### ช่องโหว่ที่ 2: กรองด้วย `active` อย่างเดียว และกรองแค่ตอน "เติมพนักงาน"

`createPeriodAction` ใช้ `.eq("active", true)` → ได้ผลเฉพาะ**การเติมครั้งใหม่**
· แถวที่ถูกเติมไปแล้ว **ค้างอยู่ตลอด** และไม่มีปุ่มเอาออก

#### กติกาที่ตั้งใหม่: **วันที่เป็นตัวตัดสิน · ธง "ยังทำงานอยู่" เป็นตัวสำรอง**

> 🪤 ใช้ธงอย่างเดียวไม่ได้ เพราะคน**ลาออกกลางเดือนยังต้องได้เงินงวดนั้น**
> แต่ผู้ใช้ติ๊กออกไปแล้วตั้งแต่วันที่เขาออก → ถ้ากรองด้วยธง เขาจะหายจากงวดที่ต้องจ่าย
> = **จ่ายเงินขาดคน** โดยไม่มีอะไรฟ้อง

| เงื่อนไข | อยู่ในงวดไหม |
|---|---|
| เริ่มงานหลังวันสิ้นงวด | ❌ |
| พ้นสภาพก่อนวันเริ่มงวด | ❌ |
| **พ้นสภาพระหว่างงวด** | ✅ ต้องจ่าย |
| ไม่มีวันพ้นสภาพ + ติ๊ก "ยังทำงานอยู่" ออก | ❌ (ออกแล้วแต่ไม่รู้วันไหน) |

→ `lib/payroll/employment.ts` (`isEmployedInPeriod` / `notInPeriodReason`) + เทส 18 ตัว

#### แถวที่ค้างอยู่แล้ว: **ไม่ลบให้เอง แต่ต้องเห็นและลบได้**

- ติดป้าย ⚠ บนชื่อ พร้อมเหตุผล (`พ้นสภาพ 2025-12-31 (ก่อนงวดนี้)`)
- ปุ่ม **เอาออก** ต่อแถว (`removePeriodLineAction`) — เฉพาะงวดร่าง · ถามยืนยันก่อน
  🚨 งวดที่ลงบัญชีแล้วห้ามลบ (ยอดที่ลง/ยื่นไปแล้วจะไม่ตรงกับงวดทันที)

> ★ **ตั้งใจไม่ลบอัตโนมัติ** — แถวอาจมีค่าที่กรอกไว้แล้ว และการที่คนหายจากงวดเอง
> โดยไม่บอกอะไร เป็นอาการที่ตรวจย้อนหลังยากกว่าการเห็นป้ายแล้วกดลบเอง

**ไฟล์**: `lib/payroll/employment.ts` (+เทส) · `app/(app)/payroll/actions.ts`
· `_components/PeriodTab.tsx`

---

## ค้างต้องถามผู้ใช้ (ยังไม่ตัดสิน — MIGRATION_PLAN sec 11)
- ~~อีเมล login (ข้อ 9)~~ → **ตัดสินแล้ว (D9)**: username-based `<username>@insep.local`
- ~~ไฟล์ wh3 (50ทวิ)~~ → **ผู้ใช้ยืนยันว่าเป็นเทมเพลตเปล่า** — อัปโหลดด้วย `--include-wh3` เป็น `wht/wh3_template.pdf`
  · Phase 3 ต้อง verify pixel-diff กับ 50ทวิ จากระบบเดิมอีกครั้ง (ถ้าเป็นไฟล์กรอกแล้วจะเห็นตอนนั้น)
