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

## ค้างต้องถามผู้ใช้ (ยังไม่ตัดสิน — MIGRATION_PLAN sec 11)
- ~~อีเมล login (ข้อ 9)~~ → **ตัดสินแล้ว (D9)**: username-based `<username>@insep.local`
- ~~ไฟล์ wh3 (50ทวิ)~~ → **ผู้ใช้ยืนยันว่าเป็นเทมเพลตเปล่า** — อัปโหลดด้วย `--include-wh3` เป็น `wht/wh3_template.pdf`
  · Phase 3 ต้อง verify pixel-diff กับ 50ทวิ จากระบบเดิมอีกครั้ง (ถ้าเป็นไฟล์กรอกแล้วจะเห็นตอนนั้น)
