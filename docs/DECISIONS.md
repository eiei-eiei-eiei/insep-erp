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

## ค้างต้องถามผู้ใช้ (ยังไม่ตัดสิน — MIGRATION_PLAN sec 11)
- ~~อีเมล login (ข้อ 9)~~ → **ตัดสินแล้ว (D9)**: username-based `<username>@insep.local`
- ~~ไฟล์ wh3 (50ทวิ)~~ → **ผู้ใช้ยืนยันว่าเป็นเทมเพลตเปล่า** — อัปโหลดด้วย `--include-wh3` เป็น `wht/wh3_template.pdf`
  · Phase 3 ต้อง verify pixel-diff กับ 50ทวิ จากระบบเดิมอีกครั้ง (ถ้าเป็นไฟล์กรอกแล้วจะเห็นตอนนั้น)
