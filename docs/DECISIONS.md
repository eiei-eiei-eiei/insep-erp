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

### D77 — หน้าแก้ไขบิลต้องกรอก หมวดหมู่/งาน ของรายการได้ (2026-08-22)

**ไม่มี migration · ไม่แตะ RPC/server action/ชั้นสูตรเงิน** · ผู้ใช้แจ้งว่า *"ลืมบันทึกว่าเป็นของงานไหน
จะไปกดแก้ไขเพื่อบันทึกย้อนหลังแต่ไม่มีช่องให้กรอก"*

#### ของครบทุกชั้น ขาดแค่ช่องบนจอ

| ชั้น | สถานะก่อนแก้ |
|---|---|
| คอลัมน์ `transaction_items.item_category` / `item_job` | ✅ มีตั้งแต่ migration แรก |
| RPC `fn_edit_transaction` | ✅ เขียน 2 คอลัมน์นี้อยู่แล้ว |
| payload `buildItemInputs()` | ✅ ส่ง 2 ค่านี้อยู่แล้ว |
| `EditBillModal` โหลดค่าเดิมเข้า state | ✅ โหลดอยู่แล้ว |
| **ช่องกรอกบนหน้าจอ** | ❌ **ไม่มี** |

> 🚨 **ช่องที่ DB/RPC/payload รองรับครบ แต่ไม่มีช่องกรอกบนจอ = ฟีเจอร์ที่ไม่มีอยู่จริงสำหรับผู้ใช้**
> ตระกูลเดียวกับ D74 *"ฟีเจอร์ที่ยังไม่มีทางเข้าถึง = บั๊กที่ยังไม่ถูกนับ"*
> อาการนี้ตรวจด้วย build/lint/test ไม่เจอเลย เพราะค่าที่โหลดมา**รอด round-trip** กลับลง DB ครบทุกครั้ง
> (แก้บิลกี่รอบข้อมูลก็ไม่หาย) — ดูเหมือนทุกอย่างทำงานถูก จนกว่าจะมีคนอยาก *แก้* ค่านั้นจริง ๆ
> · แถวที่เพิ่มใหม่ในหน้าแก้ไขยิ่งหนักกว่า: `emptyItem()` ให้ค่าว่างแล้ว**เติมไม่ได้เลยตลอดกาล**

#### โชว์ตลอด ไม่ซ่อนหลัง toggle (ต่างจาก EntryTab)

`EntryTab` ซ่อน หมวด/งาน/ส่วนลด ไว้หลังปุ่ม "แสดงคอลัมน์เสริม" (`showOpt`) เพราะเป็นฟอร์มคีย์งานประจำวัน
แต่หน้าแก้ไขบิลคือ**โฟลว์ซ่อมข้อมูลย้อนหลัง** — สิ่งที่ต้องกรอกคือของที่ลืม ถ้ายังต้องกดเปิดก่อนถึงเห็น
ก็ยังหาไม่เจออยู่ดี (หน้าแก้ไขโชว์ ลด%/ลดบาท ตลอดอยู่แล้วโดยไม่มี toggle — ทำให้สอดคล้องกัน)
· ตารางจาก 8 → 10 คอลัมน์ จึงขยายโมดัล `sm:max-w-3xl` → `sm:max-w-5xl`

#### ปุ่ม "เติมทุกแถว"

เคสจริงคือ**ทั้งบิลเป็นงานเดียวกัน** — ไล่พิมพ์ทีละแถวช้าและพิมพ์เพี้ยนได้ (`งาน A` ≠ `งานA` = คนละงานในรายงาน)
· ปุ่ม **disabled เมื่อช่องว่าง** — กันกดพลาดแล้วล้างค่าที่มีอยู่ทั้งบิลเป็นค่าว่าง
· เป็น state ในฟอร์มเท่านั้น ยังไม่เขียนจนกด *บันทึกการแก้ไข* (กดผิดปิดโมดัลทิ้งได้)

#### 🪤 id ของ `<datalist>` ห้ามซ้ำข้ามแท็บ

แท็บในแอปบัญชีถูก **mount ค้างไว้พร้อมกัน** (`BillsTab` รับ prop `active` แทนการ unmount)
ถ้าใช้ id เดิมของ `EntryTab` (`hist-item-cats` / `hist-item-jobs`) เบราว์เซอร์จะผูก `list=`
เข้ากับ element **แรกที่เจอใน DOM** → ดรอปดาวน์ในหน้าแก้ไขไปโชว์ค่าของอีกแท็บ
**โดยไม่มี error หรือ warning ฟ้องเลย** → ใช้ `edit-item-cats` / `edit-item-jobs`
(หน้าแก้ไขมีแบบอย่างอยู่แล้ว: `edit-cat-list`, `edit-contact-list`)

#### อื่น ๆ

- การ์ด **ดู** (อ่านอย่างเดียว) เพิ่มคอลัมน์ **งาน** ด้วย — ไล่ตรวจย้อนหลังว่าบิลไหนยังไม่ได้ใส่งาน
  โดยไม่ต้องเปิดหน้าแก้ไขทีละใบ
- `addItem()` ก๊อปหมวด/งานจากแถวสุดท้าย (เหมือน `EntryTab`) — `emptyItem(cat, job)` รับอาร์กิวเมนต์อยู่แล้ว
- ดรอปดาวน์ใช้ `getItemHistoryAction(entId)` ตัวเดิม (ประวัติเฉพาะบิลสถานะ `ปกติ`)
  · `entId` รู้ค่าหลังโหลดบิลเสร็จ จึงแยกเป็น effect ผูกกับ `entId`

**ไฟล์**: `app/(app)/accounting/_components/BillsTab.tsx` (ไฟล์เดียว) · build/lint/test **566** ผ่านเท่าเดิม

---

### D78 — สุราแช่: เส้นทางผลิตที่ 2 + ฟอร์ม ภส.๐๗-๐๒/๑(๑) ฉบับสุราแช่ (0045, 2026-08-24)

กฎหมายปัจจุบันให้ขอใบอนุญาตผลิตได้ทั้ง **สุรากลั่น** และ **สุราแช่** ในโรงเดียว
สุราแช่ไม่มีการกลั่น และใช้**ฟอร์มบัญชีผลิตคนละใบ** (ผู้ใช้เก็บพิกัดฟอร์มมาให้ครบ 33 จุด)
· เบียร์เป็นสุราแช่ชนิดหนึ่งแต่ใช้อีกฟอร์ม — **ตัดออกจากรอบนี้**

#### ⚠️ เลขฟอร์มบนหัวกระดาษชนกันสนิท

ทั้งสองใบพิมพ์ **ภส.๐๗-๐๒/๑(๑)** เท่ากันเป๊ะ แต่เป็นกระดาษคนละแบบ (กลั่น 19 คอลัมน์ 13 แถว ·
แช่ 14 คอลัมน์ 17 แถว) → `ExciseKind` แยกเป็น `0702_1` / `0702_1_chae` · template แยก key ·
บนจอเรียกว่า **"บัญชีผลิตสุรากลั่น" / "บัญชีผลิตสุราแช่"** ไม่ใช้เลขฟอร์มเป็นตัวแยกให้ผู้ใช้เลือก

#### 1. ตารางใหม่ `log_ferment_draw` (ไม่ reuse `log_distill`)

`log_distill` มีช่องตรงกับที่ฟอร์มสุราแช่ต้องการ**พอดีทั้ง 4 ช่อง** (batch/vol/abv/date) — reuse ได้เลย
แต่**ผู้ใช้เลือกตารางใหม่**: ยอมมีโค้ด 2 ที่ทำเรื่องคล้ายกัน เพื่อแลกกับการที่วันหนึ่งจะแก้ดีเทล
เฉพาะของ *การกลั่น* หรือ *การแช่* ได้โดยไม่กระทบกันเอง

> ★★ **กติกาเหล็ก 1 batch = 1 แถว ยกมาใช้ด้วย** (`unique (tenant_id, entity_id, batch)`)
> เหตุผลเหมือน `log_distill` เป๊ะ: ฟอร์มหักน้ำหมักของ batch นั้น**ทั้งก้อน**ต่อ 1 แถว
> รินซ้ำ = หักซ้ำ = เลขยื่นราชการผิด · RPC `fn_draw_fermented` แปลง `unique_violation`
> เป็นข้อความไทย เหมือน `fn_close_batch`

#### 2. ธง กลั่น/แช่ = `products.liquor_type` ตัวเดิม (ไม่เพิ่มคอลัมน์)

`liquor_type` คือช่อง "ประเภทสุรา" ที่**พิมพ์ลงหัวฟอร์ม ภส. อยู่แล้ว**ทั้ง 4 ใบ และตามกฎหมาย
มีแค่ 2 ค่านี้จริง → ไม่ต้องมีธงซ้อนอีกตัว · บนจอเปลี่ยนเป็น**ดร็อปดาวน์ชุดปิด** (`LIQUOR_PROCESS`)

> 🚨 **ห้ามใส่ CHECK constraint กับคอลัมน์นี้** — `db:push:all` ลงทุก DB รวมของลูกค้าที่เราไม่เคย
> เห็นข้อมูล ใครพิมพ์ค่าอื่นไว้ = migration ล้มทั้ง fleet → บังคับที่ดร็อปดาวน์ + เตือนบนจอเท่านั้น
>
> 🚨 **ห้าม default เป็นสุรากลั่น** เมื่อค่าว่าง/ไม่รู้จัก — เดาแล้วออกฟอร์ม**ผิดใบ**โดยไม่มีอะไรฟ้อง
> แท็บรายงานสรรพสามิตขึ้นแถบแดงบอกชื่อสินค้าที่ยังไม่ได้ตั้ง แล้ว**ไม่ออกฟอร์มบัญชีผลิตให้**
> (ฟอร์มวัตถุดิบ/สุราขวด/งบเดือนยังออกได้ตามปกติ — ไม่ต้องรู้ประเภท)
>
> 🪤 ดร็อปดาวน์ต้องเก็บ**ค่าเดิมที่ไม่อยู่ในชุด**ไว้เป็น option `(ค่าเดิม)` ไม่งั้นเปิดหน้าแก้แล้ว
> ค่าที่ลูกค้าพิมพ์เองไว้ก่อนหายเงียบ ๆ กลายเป็นค่าแรกของชุด · 🪤 รายงานรวมยอดตาม **ชื่อสุรา**
> ถ้าชื่อเดียวกันมีหลายแถวประเภทไม่ตรงกัน = เดาไม่ได้ → เตือนอีกแถบ

#### 3. ขั้นปรุงอยู่ในแถวเดียวกับการริน — และยอดที่ลงฟอร์มคือยอด**หลังปรุง**

ผู้ใช้ยืนยันว่าสุราแช่**มี**ขั้นเติมน้ำ/น้ำตาล/ปรับดีกรีก่อนบรรจุ แต่ฟอร์ม**ไม่มีคอลัมน์รองรับขั้นปรุง**
→ เก็บ `vol/abv` (ตอนริน) + `final_vol/final_abv/water/adjust_date` (หลังปรุง) ไว้แถวเดียวกัน

> 🚨 **ต้องลงยอดหลังปรุง** ไม่ใช่ยอดตอนริน — หัวคอลัมน์เขียนว่า *"ที่ผลิตได้**และรอบรรจุ**"*
> และเป็นทางเดียวที่ยอดคงเหลือจะตรงกับยอดบรรจุ (ริน 160 ปรุงเป็น 200 แล้วบรรจุ 200
> ถ้าลง 160 → ช่องคงเหลือติดลบ) · **ยังต้องให้ผู้ใช้ยืนยันกับเจ้าหน้าที่สรรพสามิต**
> → รวมการตัดสินใจนี้ไว้ที่ `drawnVol()` / `drawnAbv()` ใน `lib/production/calc.ts` **จุดเดียว**
> ตอบมาว่าอย่างไรก็แก้ที่นั่นที่เดียว
>
> 🪤 ปล่อยให้สุราแช่ลงแท็บ **ปรุง/ปรับดีกรี** ได้ด้วย = ปรุงถูกนับ 2 ที่ (`log_dilute` +
> `log_ferment_draw`) ยอดพองโดยไม่มีอะไรฟ้อง → `DiluteTab` ตัดสินค้าประเภทสุราแช่ออกจากดร็อปดาวน์

#### 4. ซ่อนแท็บของเส้นทางที่โรงนี้ไม่ได้ทำ — ตัดสินจาก**สินค้าจริง**

`SubTab.process` + `tabsFor(ws, role, processes)` · โรงที่มีแต่สุรากลั่นไม่เห็นแท็บ "รินน้ำสุราแช่"
และกลับกัน · หลักเดียวกับ D51 (**ห้ามผูกกับธงแพ็กเกจ ตัดสินจากข้อมูลจริง**)

> 🪤 **เซ็ตว่าง (ยังไม่มีสินค้า) = โชว์ครบ** ไม่งั้นระบบเปล่าที่เพิ่งรับลูกค้าใหม่จะไม่มีแท็บให้กดเลย
> 🪤 ต้องกรอง**ทั้งสองที่** — `ProductionApp` (แถบแท็บ) และ `navSubItems` ผ่าน `layout.tsx` → `Nav`
> ทำที่เดียวแล้วดร็อปดาวน์บนแถบเมนูจะลิงก์ไปแท็บที่ถูกซ่อน กดแล้วเด้งกลับแท็บแรก (ตระกูล D68)

#### 5. บั๊ก 2 จุดที่โผล่มาเพราะเส้นทางที่ 2 (ไม่ได้อยู่ในแผนตอนแรก)

- `getPendingBatches()` ตัดสิน "batch ค้าง" จาก `log_distill` **อย่างเดียว**
  → batch ของสุราแช่ที่รินแล้วจะค้างในรายการ "รอกลั่น" **ตลอดกาล**
- `getBatchBoard()` คิด stage จากหม้อกลั่น/`log_distill`
  → การ์ดของ batch สุราแช่ค้างที่ "ลงหมัก" ถาวร → เพิ่ม stage **"รินน้ำสุราแล้ว"** + ธง `fermented`

> ทั้งคู่คือ **ตรรกะที่ถูกต้องตราบใดที่มีเส้นทางเดียว** — เพิ่มเส้นทางที่ 2 เมื่อไหร่ต้องไล่หาทุกจุดที่
> ถามว่า "จบหรือยัง" แล้วดูจาก `log_distill`

#### 6. ช่องหมายเหตุต้องคุมความกว้าง

ช่องกว้าง 64 จุด แต่ `note` มี**ข้อความที่ผู้ใช้พิมพ์เอง**ปนอยู่ = ยาวไม่จำกัด
วัดจริงแล้วข้อความปรุงแบบเดิม (`"ปรุงปรับดีกรี 9 ได้ปริมาณ 200.00 ลิตร"`) ที่ 6.5 จุด กว้าง 66.7
→ จบที่ x 826.4 (เลยขอบช่อง) และถ้ามีวันที่ปรุงด้วยจะจบที่ 851.9 = **ไหลออกนอกขอบกระดาษ 841.8**

→ ข้อความอัตโนมัติสั้นลงเป็น `"ปรุง 26/05/69 9° ได้ 200.00 ล."` **และ** เพิ่ม `fit()` ใน
`fillFermentedForm` (ย่อฟอนต์ลงถึง 5 จุด → ยังไม่พอค่อยตัดท้ายด้วย …) ผูกกับ `cols.note.maxW`

#### สิ่งที่ตั้งใจ **ไม่** ทำ

- **ไม่ refactor `lib/pdf/excise.ts`** ที่มี helper ซ้ำ 3 ชุด (`txt`/`right`/`center`/`drawCol`)
  → duplicate เป็นชุดที่ 4 · ไฟล์นี้อยู่ใต้กติกาเหล็กข้อ 3 ฟอร์ม 4 ใบเดิมต้องได้ผลไบต์เดิมเป๊ะ
  การจัดบ้านเพื่อความสวยงาม = แก้โค้ดที่วาดฟอร์มราชการ 3 ใบพร้อมกัน ไม่คุ้มความเสี่ยง
- **ไม่แตะ `productionReport`** แม้แต่บรรทัดเดียว — golden test เดิมผ่านโดยไม่แก้ไฟล์เทสและไม่แก้
  `__golden__/reports.json` = หลักฐานว่าเส้นทางสุรากลั่นไม่ขยับ (เทคนิคเดียวกับ D55/D69/D70)
- **ไม่มี golden จากระบบเดิม** เพราะแอป GAS เดิมทำแต่สุรากลั่น → ค่าที่คาดหวังเป็นตัวเลขกลม
  ที่ตกลงกับผู้ใช้ไว้ วางเป็น fixture ในไฟล์เทสเลย (`fermented.test.ts`) ไม่ใช่ `__golden__/*.json`
  จะได้อ่านคู่กับค่าที่คาดหวังในที่เดียว
- **ช่อง ☐ โรงขนาดกลาง** เก็บพิกัดไว้ใน CFG แล้ว แต่ยังติ๊ก "ขนาดเล็ก" เป็นค่าปริยายเหมือนฟอร์ม
  เดิมทั้ง 4 ใบ — จะสลับได้ต้องมีช่อง "ขนาดโรงงาน" ใน `entities` ก่อน **ยังไม่มีจึงไม่เดา**

#### ตัวเลขที่ผูกกับเทส (ตรวจกับฟอร์มด้วยตาได้)

| วันที่ | เหตุการณ์ | น้ำหมักคงเหลือ | สุราแช่คงเหลือ |
|---|---|---|---|
| 3 พ.ค. | หมัก 11/69 · 2 ถัง × 100 | 200 | 0 |
| 8 พ.ค. | หมัก 12/69 · 1 ถัง × 100 | 300 | 0 |
| 24 พ.ค. | ริน 11/69 ได้ 160 @12° → ปรุงเป็น 200 @9° | **100** (หักทั้งก้อน 200) | 200 |
| 28 พ.ค. | บรรจุ 0.75 × 200 ขวด = 150 ล. | 100 | **50** |
| | รวมเดือนนี้ | น้ำหมัก 300 · น้ำสุราแช่ 200 · บรรจุ 150 | |

**ไฟล์หลัก**: migration `0045` · `lib/production/calc.ts` + `reports.ts` (`fermentedReport`) ·
`lib/pdf/excise.ts` (`CFG_0702_1_CHAE` + `fillFermentedForm`) · `lib/shared/tabs.ts` ·
`app/(app)/production/_components/DrawTab.tsx` (ใหม่) · `data.ts`/`actions.ts`/`excise-data.ts` ·
`BoardTab`/`MasterTab`/`ExciseTab`/`DiluteTab` · `layout.tsx`+`nav.tsx` ·
พิกัดฟอร์ม `docs/form/พิกัด_ภส07-02ทับ11_สุราแช่.md` · seed `supabase/seed/seed_fermented.sql`
· build/lint/test **593** ผ่าน

---

### D79 — ต้นทุนสุรา (บัญชี) → วัตถุดิบ (ผลิต) ไม่เคยทำงานเลยสักครั้ง (0046, 2026-08-24)

**ที่มา**: ผู้ใช้แจ้งว่า *"ลงรายจ่ายจากแอปบัญชี เป็นต้นทุนสุรา มีวัตถุดิบจากฝั่งผลิตให้เลือก
แต่พอมาดูที่ผลิต-วัตถุดิบ ไม่มีรายการล่าสุดขึ้นให้ และออกรายงานเพื่อเช็ค ก็ไม่ขึ้นในรายงาน"*

#### สาเหตุจริง: alias ใน SQL ชนชื่อตัวแปร plpgsql

```sql
declare it jsonb;                                   -- ตัวแปรลูป
...
select ... from jsonb_array_elements(p_items) it;   -- ← alias ชื่อเดียวกัน
```

PostgreSQL ตอบ `42702 column reference "it" is ambiguous` และบรรทัดนี้อยู่ **นอก**
บล็อก `begin/exception` ที่ตั้งใจดักไว้ → error หลุดออกไป abort ทั้งฟังก์ชัน

> 🚨 **ไม่ใช่แค่ forward พลาด — บิลบัญชีไม่ถูกบันทึกด้วยซ้ำ**
> เพราะ `fn_save_transaction` ทั้งตัวถูก roll back

บั๊กนี้เกิดตั้งแต่ `0011` แล้วถูก **ก๊อปยกบล็อกต่อไปใน `0017`** → เส้นทางนี้
**ไม่เคยทำงานสำเร็จเลยสักครั้งตั้งแต่เปิดระบบ** · หลักฐานตรงจาก DB จริง:
`integration_log` ไม่มีแถว `RECEIVE_MATERIAL` แม้แต่แถวเดียว และ `transactions`
ไม่มีบิลหมวด `ต้นทุนสุรา` สักใบตั้งแต่ migrate มา

> 🪤 **ตรรกะที่อยู่ในฐานข้อมูล ไม่มี build/lint/test ตัวไหนมองเห็น**
> `npm run build` / `lint` / `test` ผ่านหมด 100% มาตลอดทั้งที่ฟีเจอร์ตายสนิท
> — ตระกูลเดียวกับ D68 (ดร็อปดาวน์ไม่ขึ้นเพราะ `overflow-x-auto`) และ D74/D77
> (*"ฟีเจอร์ที่ยังไม่มีทางเข้าถึง = บั๊กที่ยังไม่ถูกนับ"*)
> **ชั้นเดียวที่จับได้คือ `npm run test:tenant`** ที่ยิง Supabase จริง

#### บั๊กที่เจอเพิ่มระหว่างซ่อม (เจอเพราะทางเดินถูกเปิดครั้งแรก)

1. **ของไปลงผิดกิจการ** — `fn_receive_material` insert `log_material` โดยไม่ระบุ `entity_id`
   → ตกไปที่ default `my_default_entity()` = **กิจการหลักเสมอ** แม้บิลจะลงกิจการที่ 2
   · ตระกูลเดียวกับบั๊ก `apply_stock_delta` ที่ 0029 แก้ไปแล้ว:
   **เอา entity จาก "แถว/เอกสาร" ไม่ใช่จาก "คนที่ล็อกอิน"**
   → เพิ่มพารามิเตอร์ `p_entity` (🪤 พารามิเตอร์เพิ่ม = ต้อง `drop function` ก่อน
   ไม่งั้นได้ overload ตัวที่ 2 — บทเรียนเดิมจาก D69)
   · master วัตถุดิบอยู่คนละกิจการ → **แจ้งคนละข้อความกับ "สะกดผิด"** ไม่งั้นผู้ใช้ไล่หาผิดทาง
2. **แถวที่กรอกแต่ราคา ไม่กรอกชื่อ ล้ม forward ทั้งใบ** — `buildItemInputs` ปล่อยแถว
   `itemName || exVat` ผ่านมา → ชื่อว่าง 1 แถวทำให้ทั้งบิลไม่ได้รับวัตถุดิบ · กรองชื่อว่างทิ้งก่อนส่ง
3. **warning ขึ้นเป็นสีเขียว** — `setMsg({ ok: true, text: warning })` ทำให้ข้อความ
   *"บันทึกบัญชีสำเร็จ แต่รับวัตถุดิบเข้าสต็อกผลิตไม่ได้"* หน้าตาเหมือนสำเร็จทุกประการ
   → เพิ่มระดับ `warn` (เหลือง) ใน `Msg`/`useSaver`
   · 🚨 **บันทึกได้บางส่วน ≠ สำเร็จ** ห้ามใช้สีเดียวกันเด็ดขาด
4. **`fn_mig_truncate` ตก `log_ferment_draw` (0045) และ `snapshots` (0018)** — ทั้งคู่มี FK
   มาที่ `tenants` แบบไม่ cascade → **ลบ/รีเซ็ตลูกค้าล้มทันที**
   · `log_ferment_draw` เจอจริงตอนรันเทสรอบนี้ · `snapshots` เป็นระเบิดเวลาแบบเดียวกัน
   ที่รอให้ลูกค้าเคยกด "สำรองข้อมูล" สักครั้งก่อนถึงจะระเบิด
   · `SNAPSHOT_ORDER` และ `backup-tables` ก็ตก `log_ferment_draw` เหมือนกัน
   = **สำรอง/ย้อนข้อมูลแล้วข้อมูลสุราแช่หายเงียบ ๆ ไม่มี error**

#### กันพลาดซ้ำ: รายชื่อตารางมีแหล่งเดียว + เทสไล่ให้

รายชื่อ "ตารางที่มี `tenant_id`" ถูกก๊อปไว้ 4 ที่ (`fn_mig_truncate` ใน SQL · `SNAPSHOT_ORDER` ·
`backup-tables` · `TENANT_TABLES` ของ harness) และ **พลาดมาแล้ว 3 รอบติด**
(D67 ลืม `pay_*` · D69 ลืม `pay_variables`/`pay_post_legs` · D78 ลืม `log_ferment_draw`)
— จดกับดักไว้ใน DECISIONS ทั้ง 2 รอบแล้วก็ยังพลาดรอบที่ 3

→ `lib/shared/tenantTables.ts` เป็นแหล่งเดียว + `tenantTables.test.ts` **อ่านอีก 4 ที่เป็นข้อความ**
มาเทียบ (รวม **ไฟล์ SQL** ด้วย — ชั้นที่ unit test ปกติมองไม่เห็น) · เพิ่มตารางใหม่แล้วลืม
= `npm run test` แดงทันที ไม่ต้องพึ่งความจำอีก

#### ที่ไม่ได้แก้ (ตั้งใจ)

- **หมวดหมู่ที่จุดชนวนยังฮาร์ดโค้ดว่า `"ต้นทุนสุรา"`** — ผังบัญชีจริงของผู้ใช้ใช้คำว่า
  `"ค่าต้นทุนสินค้า"` และไม่มี `"ต้นทุนสุรา"` ในลิสต์หมวดหมู่รายจ่ายเลย (แอปแอบเติมเป็น
  ตัวเลือกใน `<datalist>` ให้พิมพ์เลือกได้) → **รอผู้ใช้ตัดสิน** ว่าจะเติมหมวดนี้เข้าลิสต์
  หรือให้ตั้งค่าได้ว่าหมวดไหนเป็นตัวจุดชนวน · เดาแทนไม่ได้ เพราะกระทบทุก tenant
- **`fn_save_installments` ยัง forward ไม่ได้** — ซื้อวัตถุดิบแบบแบ่งงวดต้องบันทึกรับ
  ในแอปผลิตเอง (ฝั่ง UI ก็ไม่ได้ส่งธงมาด้วย) — เหมือนเดิม ไม่ได้ถอยหลัง

**ไฟล์หลัก**: migration `0046` · `lib/shared/tenantTables.ts` (+เทส) · `lib/shared/ui.tsx`
(`UiMsg` + `Msg` ระดับ warn) · `app/(app)/accounting/_components/EntryTab.tsx` ·
`lib/snapshot/engine.ts` · `scripts/backup-tables.ts` ·
`tests/tenant/forward-material.test.ts` (ใหม่ · 5 เทส) · ชุดเทส `docs/TESTING.md` ส่วนที่ 37
· build/lint/test **598** + `test:tenant` **134** ผ่าน

---

### D80 — บั๊กที่เจอจากการ "ใช้แอปจริงแบบลูกค้าใหม่" ในเบราว์เซอร์ (0047, 2026-08-25)

**ที่มา**: ผู้ใช้ให้ไล่ใช้แอปตั้งแต่ตั้งค่าจนจบทุกลูปในเบราว์เซอร์จริง — วิธีเดียวกับที่ผู้ใช้เจอ D79 เอง
เจอเพิ่ม 7 ข้อ **โดยที่ build/lint/test เดิมผ่านหมด 100%** ทุกข้อ

> 🪤 บทเรียนรวบยอดของรอบนี้: **ชั้นที่เทสอัตโนมัติมองไม่เห็นมี 2 ชั้น** — ตรรกะที่อยู่ใน DB (D79)
> และ *ช่องว่างระหว่างสิ่งที่ระบบทำได้กับสิ่งที่ผู้ใช้กดถึง* (D74/D77/D80) · ทั้งสองชั้นต้องมีคนใช้จริงถึงเจอ

---

#### A1 · ชื่อพนักงานบนเอกสารยื่นราชการเป็นชื่อเก่า

**อาการ**: ใบแนบ ภ.ง.ด.1 แถวแรกพิมพ์ `นายรัง` คู่กับเลขบัตร `1-0303-00492-83-7` ซึ่งเป็นของ
`นายอำนวย ตระกูลทุม` → **ชื่อกับเลขประจำตัวเป็นคนละคนบนแบบที่ยื่นสรรพากร**

**สาเหตุ**: อ่าน `payroll_items.emp_name` (snapshot) ก่อนชื่อปัจจุบัน = สลับข้างจากกติกา D75
(*"ชื่อ = ค่าปัจจุบันเสมอ · ตัวเงิน = ค่าที่แช่ไว้เสมอ"*) · D69 เขียนก่อน D75 กติกาใหม่จึงกวาดไม่ถึง
· กระจายอยู่ 5 จุด: `pnd1Rows` · `sso110Rows` · `pnd1kRows` · 50ทวิ ใน `FilingTab` ·
`getPayrollReportSource` (ตัวหลังไม่ join `employees` เลย = ไม่มีชื่อปัจจุบันให้ใช้ด้วยซ้ำ)

**แก้**: `empDisplayName(emps, empId, snapshot)` ตัวเดียวใน `lib/payroll/filings.ts` — ทะเบียน > snapshot > ว่าง
· เหตุผลเดียวกับที่ D75 ดึง `periodView.ts` ออกมา: กฎนี้พลาดแล้ว 2 รอบเพราะกระจายหลายที่

- 🪤 **ข้อยกเว้นเดียว — 50ทวิ ที่ออกไปแล้ว** ใช้ `wht_certificates.contact_name` (ชื่อ ณ วันออก)
  ใบนั้นอยู่ในมือพนักงานจริง พิมพ์ซ้ำต้องได้ข้อความเดิมเป๊ะ ไม่งั้นเอกสารเลขเดียวกันชื่อไม่ตรงกัน 2 ใบ
- 🚨 **เทสเดิมล็อกพฤติกรรมผิดไว้**: `filings.test.ts` มีเคส *"เปลี่ยนนามสกุลกลางปี → ใช้ชื่อล่าสุด"*
  ที่ยืนยันว่า snapshot ล่าสุดชนะ — คอมเมนต์ในโค้ดเจตนาถูก (*"เอกสารสิ้นปีควรเป็นชื่อปัจจุบัน"*)
  แต่หยิบผิดตัว · แก้เทสให้ยืนยันว่าทะเบียนชนะ + เพิ่มเคส "พนักงานถูกลบ → ตกไปใช้ snapshot"

#### A2 · ข้อมูลหลักแก้ได้โดยไม่มีประวัติ + `edit_log` ไม่มีที่ให้ดู

**สองครึ่งที่ต้องมาคู่กัน** — ลง trigger อย่างเดียวได้ข้อมูลที่เปิดดูไม่ได้ = สร้างบั๊ก D74/D77 ขึ้นมาเอง

1. **ไม่มี trigger บน master**: `products` (ตัวตัดสินว่าออกฟอร์ม ภส. ใบไหน + ตัวคูณปริมาตร) ·
   `entities` (เลขภาษี/เลขสรรพสามิตบนหัวเอกสารราชการ) · `materials`/`containers`/`contacts`/`bank_accounts`
   → เพิ่ม trigger ครบ + คอนฟิกเงินเดือน (`pay_rates`/`pay_inputs`/`pay_variables`/`pay_post_legs`)
   ซึ่งเปลี่ยนตัวเงินที่จ่ายจริง
2. **`edit_log` ไม่มีทางดูจากแอปเลยแม้แต่หน้าเดียว** — ถูกอ้างถึงแค่ในข้อความบนจอ
   (หน้าแก้บิลเขียนว่า *"การแก้จะถูกบันทึกใน edit_log"*) = **บอกว่าเก็บไว้ แต่ไม่บอกว่าดูที่ไหน**
   ข้อมูลที่สะสมอยู่แล้ว ~2,200 แถวเปิดได้ทางเดียวคือ Supabase dashboard
   → หน้าใหม่ **ตั้งค่า → ประวัติการแก้ไข** (RLS `edit_log_sel` = main + กรอง tenant มีอยู่แล้วตั้งแต่ 0028)

- 🚨 **ห้ามผูก audit กับ `app_settings`** — เก็บ `line_channel_token` อยู่ ผูกแล้วค่าลับถูกก๊อปลง edit_log
  ซึ่งเป็นคนละชั้นสิทธิ์กับที่ 0033 ตั้งใจกันไว้ (มีเทสยืนยันว่าต้องไม่มีแถว)
- 🪤 **`trg_audit` ต้องเอา tenant จากแถวเอง** (`rec ->> 'tenant_id'`) ไม่ใช่พึ่ง default `my_tenant()`
  ของ `edit_log` — ไม่งั้นพอผูกกับ `entities` แล้ว `provision:tenant` (service role, ไม่มี `auth.uid()`)
  **ล้มทันทีที่ insert entities** = รับลูกค้าใหม่ไม่ได้เลย · ตระกูลเดียวกับ D50 / `apply_stock_delta` (0029)
  · ไม่มี tenant ให้ผูก → ข้าม audit แทนที่จะทำให้งานหลักล้ม
- **หน้าประวัติ = ดูอย่างเดียว + คัดลอกค่าเก่า** (ผู้ใช้เลือกเอง) · 🚨 **ไม่มีปุ่มเขียนทับ DB โดยตั้งใจ**
  กดผิดคือทับข้อมูลจริง และต้องคิดเรื่อง FK/trigger/สต็อกครบทุกตาราง — ย้อนของจริงใช้ snapshot
- 🚨 **ห้ามเทดัมพ์ JSON ดิบลงจอ** — ผู้ใช้อ่านโค้ดไม่ได้ และแถว `transactions` มี ~28 คอลัมน์
  → `changedFields()` โชว์เฉพาะช่องที่ต่างจริง พร้อมชื่อไทย · `rawBefore()` คืน**ค่าดิบ** ให้ปุ่มคัดลอก
  (ก๊อป `—` หรือ `ใช่` ไปวางในช่องกรอกไม่ได้)
- `AUDITED_TABLES` ใน `lib/shared/tenantTables.ts` + เทส**ไล่อ่าน `create trigger audit_…` จากไฟล์ SQL**
  มาเทียบ — เพิ่ม trigger แล้วลืมเติมลิสต์ = ผู้ใช้กรองหาไม่เจอทั้งที่ระบบบันทึกไว้

**ไฟล์หลัก**: migration `0047` · `lib/payroll/filings.ts` (`empDisplayName`) · `app/(app)/payroll/data.ts` ·
`FilingTab.tsx` · `lib/shared/editLog.ts` (+เทส 11) · `lib/shared/tenantTables.ts` (`TABLE_LABEL_TH`/`AUDITED_TABLES`) ·
`app/(app)/settings/history/page.tsx` + `_components/HistoryCard.tsx` · `tests/tenant/audit-master.test.ts` (ใหม่ 5 เทส)
· build/lint/test **616** + `test:tenant` **139** ผ่าน

#### B1 · ไม่มีหน้าจอตั้ง "กิจการ/บัญชีที่รับรายได้ขาย" → ลูกค้าใหม่ปิดการขายใบแรกไม่ได้

**อาการ**: กด *รับมัดจำ & ส่งคลัง* แล้วตัน — *"ยังไม่ได้ตั้งค่ากิจการรับรายได้ขาย
(app_settings sales_revenue_entity) — ดู GOLIVE_CHECKLIST Phase 4"*

**สาเหตุ**: ไล่โค้ดแล้ว **ไม่มีที่ไหนเขียน `sales_revenue_entity` / `sales_revenue_account` เลยสักจุด**
ทั้งระบบ — ตั้งได้ทางเดียวคือยิง SQL · และข้อความ error ยังชี้ให้ไปเปิด**ไฟล์เอกสาร**
แทนที่จะบอกว่ากดที่ไหน (ตระกูล D74/D77)

**แก้**: การ์ดที่ 3 ในหน้า **ตั้งค่า → กิจการ** + `saveSalesRevenueAction`
· บัญชีเป็น**ดร็อปดาวน์จาก `bank_accounts`** ไม่ให้พิมพ์เอง (ชื่อต้องตรงเป๊ะ ฝั่งขายเขียนลง
`transactions.account_name` ตรง ๆ) · กิจการเดียว = เลือกให้เลย (หลัก D53)
· 🪤 **แยก action ออกจาก `saveDocEntityAction` เด็ดขาด** — "กิจการที่ออกเอกสาร" กับ
"กิจการที่รับเงิน" คนละเรื่อง รวมเป็นดร็อปดาวน์เดียวเมื่อไหร่ = แก้อันหนึ่งอีกอันย้ายตามเงียบ ๆ (D63)
· ข้อความ error ฝั่งขายชี้มาที่การ์ดนี้แล้ว

#### B2 · หมวดหมู่ที่จุดชนวน "รับวัตถุดิบเข้าสต็อกผลิต" ตั้งเองได้ (migration `0048`)

เดิมฮาร์ดโค้ด `"ต้นทุนสุรา"` แต่ผังบัญชีจริงของผู้ใช้ไม่มีคำนี้ (แอปแอบเติมเป็นตัวเลือกใน `<datalist>`
ให้พิมพ์เลือกได้) — หมวดที่ใช้จริงคือ `"ค่าต้นทุนสินค้า"` ซึ่งไม่จุดชนวนอะไรเลย

- app_settings kind ใหม่ `material_forward_cat` (หลายแถวได้) · **ค่าปริยาย `"วัตถุดิบผลิตสุรา"`**
  (ผู้ใช้เลือกเอง — เปลี่ยนจากของเดิม)
- **ไม่มีแถว = ใช้ค่าปริยายในโค้ด** (`lib/accounting/forwardCats.ts`) → ไม่ต้อง seed ให้ลูกค้าเดิม
  · เปลี่ยนค่าปริยายปลอดภัยเพราะเส้นทางนี้ไม่เคยทำงานสำเร็จเลยก่อน `0046` = ไม่มีข้อมูลเดิมที่พึ่งคำเดิม
- 🪤 **`app_settings.kind` เป็น CHECK whitelist** — เพิ่ม kind ในโค้ดอย่างเดียวไม่พอ ผู้ใช้กดเพิ่มแล้ว
  เด้ง *"ค่าที่กรอกไม่ถูกต้องตามที่ระบบกำหนด"* (เจอจริงตอนเทส) → ต้องมี migration และ
  **ยกรายชื่อเดิมมาครบทุกตัว** เพราะ constraint เขียนทับทั้งก้อน
- 🚨 **บั๊กที่เกิดระหว่างแก้เอง แล้วจับได้ตอนเทส**: ตอนแรกส่ง "ค่าที่มีผลจริง" (ที่เติมค่าปริยายแล้ว)
  เข้า ChipList → หน้าจอโชว์ `วัตถุดิบผลิตสุรา` เป็น chip เหมือนบันทึกไว้แล้ว
  พอผู้ใช้ **เพิ่มหมวดที่ 2** ระบบมีแถวจริง 1 แถว → ค่าปริยาย**หลุดทันทีโดยไม่มีอะไรฟ้อง**
  ทั้งที่ chip ยังอยู่บนจอ · ตระกูลเดียวกับ D74 (*ฟอร์มเปิดมาพร้อมค่าที่ยังไม่ได้บันทึก*)
  → แยก `forwardCatsSet` (ที่ตั้งเอง) ออกจาก `forwardCats` (ที่มีผล) · ว่าง = ขึ้นข้อความเหลือง
  *"ยังไม่ได้ตั้ง — ระบบใช้ … ให้ก่อน · เพิ่มเองแล้วจะใช้เฉพาะที่เพิ่ม"*
  🪤 **ค่าปริยายที่คำนวณในโค้ด ห้ามแสดงปนกับค่าที่ผู้ใช้บันทึกไว้จริงในช่องที่แก้ได้**

**ไฟล์หลัก**: migration `0048` · `lib/accounting/forwardCats.ts` (+เทส 4) ·
`app/(app)/settings/actions.ts` + `settings-data.ts` + `_components/CompanyCard.tsx` ·
`app/(app)/accounting/data.ts` + `_components/{EntryTab,BillsTab,SettingsTab}.tsx` · `app/(app)/sales/actions.ts`
· build/lint/test **620** ผ่าน

#### C1 · ขนาดขวดกรอกเป็นมิลลิลิตรได้เงียบ ๆ → ปริมาตรบนฟอร์ม ภส. ผิดพันเท่า

คอลัมน์เขียนว่า **ขนาดขวด (ล.)** อยู่แล้ว แต่คนคิดเป็น "330 มล." เป็นธรรมชาติ · ระบบรับ `330` ไปตรง ๆ
แล้ว **ภส.๐๗-๐๒/๑(๒) คิดลิตร = จำนวนขวด × ขนาดขวด** → บรรจุ 113 ขวด รายงาน **37,290 ลิตร**
แทน 79.1 ลิตร บนเอกสารที่ยื่นสรรพสามิต

**ผู้ใช้ตัดสิน: เตือนอย่างเดียว ไม่แปลงค่าให้** — แปลงอัตโนมัติเสี่ยงกว่า (ถังใหญ่ 20 ล. จะโดนหารด้วย)
และการไม่แตะค่าที่ผู้ใช้กรอก = ไม่มีทางแปลงผิดให้เงียบ ๆ

- `bottleSizeWarn()` เตือนเมื่อ > 5 (ไม่มีขวดขายปลีกใหญ่กว่านี้) · ข้อความบอกตัวเลขจริงและค่าที่ควรกรอก
- โชว์ทั้งตอนเพิ่ม · ตอนแก้ · **และบนแถวที่ยังไม่ได้กดแก้** — ไม่งั้นของเดิมที่ผิดอยู่แล้วจะไม่มีวันถูกเห็น
- แถบเตือนรวมในแท็บ **รายงานสรรพสามิต** ด้วย เพราะที่นั่นคือจุดที่เลขผิดกลายเป็นเอกสารจริง
- `Field.warn?: (v) => string | null` ใน `MasterTab` — เป็น hook กลาง เตือนช่องอื่นได้ในอนาคต

#### C2 · แท็บ "กลั่น" ยอมให้เลือก batch ของสุราแช่

ปิด batch ได้จริงด้วย → ได้แถวใน `log_distill` ของสินค้าสุราแช่ = ยอดไปโผล่ในฟอร์ม
**บัญชีผลิตสุรากลั่น** ผิดใบ โดยไม่มีอะไรเตือน (ฝั่งแท็บ "รินน้ำสุราแช่" กรองถูกอยู่แล้วตั้งแต่ D78
— ขาดแค่ด้านนี้ ทำให้สองข้างไม่สมมาตร)

- ติดธง `fermented` ต่อ batch ใน `getPendingBatches` (map ชื่อสุรา → `products.liquor_type`
  ด้วย `isFermented()` — วิธีเดียวกับ `getBatchBoard`) แล้ว **กรองที่ `DistillTab`**
- 🪤 **ห้ามกรองใน `getPendingBatches` ตรง ๆ** — ฟังก์ชันนี้ใช้ร่วมกับแท็บ **ติดตามหมัก**
  (คอมเมนต์ในไฟล์บอกไว้: *"ใช้หน้ากลั่น/monitor"*) และ batch สุราแช่ก็ต้องวัด pH/Brix ได้
- 🪤 `liquor_type` **ว่าง = ไม่ซ่อน** — การซ่อนก็เป็นการเดาเหมือนกัน ปล่อยให้แถบเตือนแดงในแท็บ
  รายงานสรรพสามิต (D78) จัดการ

#### C3 · คอลัมน์ Yield ขึ้น "—" ตลอดกาล

คอลัมน์ `log_distill_run.ferm_charge` มี · `startDistillRunAction` **รับพารามิเตอร์ `fermCharge`
และเขียนลงแถว "เริ่มกลั่น" อยู่แล้ว** · `distillSummary` อ่านค่านี้ · golden test มี
— **แต่หน้าจอไม่เคยส่งค่านี้เลยสักครั้ง** (grep เจอ 0 ครั้งใน `DistillTab`) ตระกูล D74/D77 อีกตัว

- เพิ่มช่อง **"น้ำหมักที่เข้าหม้อ (ล.) — ไม่บังคับ"** ไว้ **คู่ปุ่ม "+ เริ่มหม้อใหม่"**
  ★ ไม่ใช่ในฟอร์มบันทึกค่า เพราะแถว "เริ่มกลั่น" ถูกสร้างตอนกดปุ่มนั้น และเป็นจังหวะที่ผู้ใช้
  รู้ปริมาณน้ำหมักที่เทเข้าหม้อพอดี
- โชว์คอลัมน์ "น้ำหมักเข้าหม้อ" ในตารางค่าที่บันทึก (จะได้เห็นว่ากรอกไปแล้วหรือยัง)
- ไม่กรอกก็กลั่นได้ตามปกติ — แค่ Yield ว่าง (บอกไว้ใต้ช่อง)

**ไฟล์หลัก**: `app/(app)/production/_components/{MasterTab,ExciseTab,DistillTab}.tsx` ·
`app/(app)/production/data.ts` (`getPendingBatches` ติดธง `fermented`) · `_components/types.ts`
· build/lint/test **620** ผ่าน

---

### D81 — เอกสารยื่นราชการนับงวดร่างเข้าไปด้วย ทั้งที่หน้าจอเขียนว่าไม่นับ (2026-08-25)

**ที่มา**: เทสในเบราว์เซอร์ด้วยสกิล `/browser-qa` — เจอบนหน้าเดียวกันว่า **คำกำกับประกาศกฎหนึ่ง
แต่โค้ดทำอีกอย่าง** · บรรทัดใต้ช่องเลือกเอกสารเขียนว่า *"ตัวเลขมาจากงวดที่ กดคำนวณ & บันทึกแล้ว
เท่านั้น — **งวดร่างยังไม่นับ**"* แต่ `getFilingYear`/`getFilingPeriod` ดึง `payroll_items`
ด้วย `.like("period_id", …)` เฉย ๆ **ไม่มีเงื่อนไขสถานะงวดเลยสักบรรทัด**

หลักฐานจาก tenant ทดสอบ:

| งวด | สถานะ | คน | เงินได้ | ภาษี |
|---|---|---|---|---|
| PR-2026-01 | **draft** | 8 | 217,049 | 1,685 |
| PR-2026-02 | **draft** | 8 | 226,838 | 1,685 |
| PR-2026-03 | **draft** | 8 | 226,424 | 1,685 |
| PR-2026-08 | posted | 9 | 254,860 | 3,270 |
| **รวมทุกงวด** | | | **925,171** | **8,325** |

หน้า ภ.ง.ด.1ก แสดง **925,171 / 8,325** เป๊ะ = **งวดร่าง 3 งวดคิดเป็น 72% ของยอดทั้งปี**
· เลือกงวดร่างออกใบแนบ ภ.ง.ด.1 รายเดือนได้เต็มใบด้วย · ใบ 50ทวิ ที่ยื่นให้ลูกจ้างก็ใช้ยอดชุดเดียวกัน

> 🪤 ตระกูล D73/D75 — **อาการไม่ใช่สูตรผิด แต่เป็นการเลือกชุดข้อมูลผิด**
> สูตรทุกตัวใน `filings.ts` ถูกหมด · golden test 28 ตัวผ่านหมดมาตลอด · build/lint/test ไม่มีทางจับได้
> เพราะฟังก์ชันบริสุทธิ์ได้ input อะไรมาก็คิดถูกตาม — **คนที่เลือก input คือ `data.ts` ซึ่งไม่มีเทสคุม**

**แก้**: กฎอยู่ที่เดียวใน `lib/payroll/filings.ts` — `countsForFiling(status)` + `keepFiledItems()`
เรียกจาก 3 ที่ (server รายเดือน · server รายปี · ดร็อปดาวน์บนจอ) แบบเดียวกับ `periodView.ts` (D75)
และ `empDisplayName()` (D80) — กฎที่พลาดแล้วต้องถูกดึงออกมาเป็นฟังก์ชันพร้อมเทส

- 🚨 **`draft` ไม่นับ** — `post_state = {}` = ยังไม่ลงบัญชีสักขา = ยังไม่เกิดการจ่ายจริง
- 🪤 **`partial` ต้องนับ (ผู้ใช้เคาะ)** — ลงยอดสุทธิแล้วแต่ยังไม่ลงขา WHT คือสภาพปกติของคน
  *ที่กำลังจะยื่น* ภ.ง.ด.1 · ตัดออกเมื่อไหร่ = งวดที่จ่ายเงินให้ลูกจ้างไปแล้วจริงหายจาก
  **แบบที่ใช้นำส่งภาษีของงวดนั้นเอง** ซึ่งผิดหนักกว่าบั๊กที่ตั้งใจจะแก้
- 🚨 **ห้ามข้ามงวดเงียบ ๆ** → `<DraftNote>` แถบเหลืองบอกจำนวน+ชื่อเดือนที่ข้าม · ไม่งั้นผู้ใช้เห็น
  ยอดปีในแท็บ **รายงาน** (นับทุกงวดที่บันทึกไว้) ไม่ตรงกับแท็บ **เอกสารยื่น** แล้วไล่หาสาเหตุไม่เจอ
  (บทเรียน D75: ต่างกันได้ แต่ต้องบอกว่าอันไหนคืออันไหน)
- **แท็บรายงานไม่แตะ** — คำกำกับของมันถูกอยู่แล้ว (*"งวดร่างที่ยังไม่บันทึกจะไม่โผล่"*)
  และเป็นรายงานภายในที่ควรเห็นงวดร่าง
- **ใบ 50ทวิ คิดใหม่ทุกแถว (ผู้ใช้เคาะ)** — ตอนตัดสินใจ `wht_certificates` ยังว่างทั้ง tenant
  จึงไม่มีใบจริงได้รับผลกระทบ · ถ้าอนาคตมีใบที่ออกก่อนแก้บั๊กนี้ ยอดบนจอกับกระดาษจะต่างกัน
  ข้อมูลเดิมยังอยู่ครบใน `wht_certificates.base_amount` ถ้าจะโชว์เทียบทีหลัง
- ด่านกันที่ `getFilingPeriod` คืน `items: []` แต่**ยังคืน `period`** เพื่อให้จอบอกเหตุผลได้

#### 🔴 เจอเพิ่มระหว่างเทส — เอกสารรายเดือนใช้ข้อมูล**ทั้งปี**ชั่วขณะ

สลับชนิดเอกสารจากรายปี (ภ.ง.ด.1ก / 50ทวิ) กลับรายเดือน → React ฟ้อง duplicate key
`EMP-0002`…`EMP-0009` ครบทุกคนที่มีหลายงวด (ไม่ฟ้อง `EMP-0001` เพราะมีงวดเดียว จึงไม่ซ้ำ)
= ใบแนบ ภ.ง.ด.1 ของเดือนเดียวถูก render ด้วย **33 แถวของทั้งปี** อยู่ 1 เฟรม · **ทำซ้ำได้ 100%**

**สาเหตุ**: `setLoading(true)` อยู่**ข้างใน** `load()` ซึ่งถูกเรียกจาก `useEffect` = *หลัง* render
ที่ `doc` เปลี่ยนไปแล้ว → เฟรมนั้น `doc` เป็นรายเดือนแต่ `items` ยังเป็นชุดทั้งปี

**แก้**: `loadedKey` ที่ถูกเซ็ต**พร้อมข้อมูล** แล้ว gate ด้วย `ready = !loading && loadedKey === key`
🪤 **กันทั้งคลาส** — ผูก *ข้อมูล* กับ *ข้อมูลนี้เป็นของอะไร* ไว้ด้วยกัน เช็ค `loading` อย่างเดียวไม่พอ
· ความเสี่ยงจริงคือกด **คัดลอกตาราง / พิมพ์ PDF** ในจังหวะนั้น = ได้เอกสารยื่นที่ยอดผิด

**ไฟล์หลัก**: `lib/payroll/filings.ts` (`countsForFiling` · `keepFiledItems` · +เทส 9) ·
`app/(app)/payroll/data.ts` (`getFilingPeriod` · `getFilingYear` +`draftPeriodIds`) ·
`_components/FilingTab.tsx` (ดร็อปดาวน์ · คำกำกับ · `<DraftNote>` · `ready`)
· **ไม่มี migration** · ไม่แตะชั้นสูตร — **golden test เดิม 28 ตัวผ่านโดยไม่แก้ไฟล์เทส**
· build/lint/test **629** ผ่าน · ชุดเทส `docs/TESTING.md` ส่วนที่ 39

---

### D82 — เลิก snapshot ในแอป เปลี่ยนเป็นดาวน์โหลดเก็บเอง (0049, 2026-08-25)

**ที่มา**: ผู้ใช้ถามว่า *"snapshot แล้วย้อนข้อมูล จะกระทบลูกค้าคนอื่นไหม หรือแยกเจ้าใครเจ้ามัน"*
→ ไล่โค้ดแล้วพบว่า **ฝั่งข้อมูลแยกครบทุกบรรทัด** (dump/restore/truncate/recompute มี `tenant_id`
ทุกจุด · `tenantId` มาจาก session ไคลเอนต์ปลอมไม่ได้ · `fn_mig_truncate` ถึงกับ raise exception
ถ้าไม่ส่ง tenant) **แต่มีผลข้างเคียง 1 อย่างที่กระทบข้ามลูกค้าจริง**

🚨 `restoreSnapshot()` เรียก **`fn_mig_set_triggers(false)`** ซึ่ง **ไม่มีพารามิเตอร์ tenant**
เพราะ Postgres สั่ง `alter table … disable trigger` ได้ระดับ**ตาราง**เท่านั้น
→ ปิด trigger 9 ตาราง **ทั้งฐานข้อมูล กระทบทุกลูกค้าที่อยู่ก้อนเดียวกัน**:

1. `edit_log` ของเจ้าอื่นไม่บันทึก — แก้อะไรตอนนั้นไม่เหลือร่องรอย
2. 🔴 **stock trigger ไม่ทำงาน** → เจ้าอื่นบันทึกบรรจุ/จ่ายตอนนั้น `stock_product` ไม่ขยับ
   และ**ไม่มีอะไรมาคำนวณให้ทีหลัง** (recompute ยิงเฉพาะ tenant ที่กดย้อน)
   = **สต็อกผิดถาวรเงียบ ๆ** แล้วไปโผล่บนฟอร์ม ภส.
3. process ตายกลางทาง (Vercel timeout / lambda kill) → `try/finally` ช่วยเฉพาะตอน throw ปกติ
   **ถ้าโดน kill trigger ค้างปิดทั้ง DB ตลอดไป**

> 🪤 **บทเรียนของรอบนี้: โค้ดขัดกับกติกาที่ตัวเองเขียนไว้**
> comment ของ `fn_mig_set_triggers` ใน `0029` เขียนกำกับเองว่า *"ใช้ตอน provision ลูกค้าใหม่
> เท่านั้น **ห้ามรันบนระบบที่มีคนใช้อยู่**"* — แต่ restore คือ**ปุ่มที่ลูกค้ากดเองได้ตลอดเวลา**
> · เขียนคำเตือนไว้ข้างฟังก์ชันไม่พอ ต้องดูด้วยว่า *ใครเรียกมันได้บ้าง*

**ผู้ใช้ตัดสิน: ตัดระบบ snapshot ในแอปทิ้งทั้งก้อน** เปลี่ยนเป็นปุ่มดาวน์โหลดให้ลูกค้าเก็บไฟล์เอง

| เรื่อง | เคาะว่า |
|---|---|
| ทางกลับเมื่อลูกค้าทำข้อมูลพัง | **ผ่านเรา** — ลูกค้าส่งไฟล์มา เจ้าของรัน `npm run restore:tenant` · ปุ่มอันตรายไม่อยู่ในมือลูกค้า |
| รูปแบบไฟล์ | **2 ปุ่มแยกกัน** — `.json` (ครบทุกตัวอักษร ใช้ย้อนได้จริง) · `.xlsx` (เปิด Excel อ่าน/ส่งบัญชี) |
| ตาราง `snapshots` | **drop ทิ้ง** — ของเก่า 2 ก้อนใน DB เจ้าของ (`start`/`allset` ก.ค.) ไม่เอาแล้ว |

- ★ **ผลพลอยได้**: หลังลบ `engine.ts` ผู้เรียก `fn_mig_set_triggers` ที่เหลือมี**ที่เดียว**คือ
  `migration/import-csv.ts` ซึ่งรันตอน cutover บนระบบเปล่า = ตรงตามกติกาที่เขียนไว้พอดี
  (จึง**เก็บฟังก์ชันไว้** ไม่ต้อง drop) · และเลิกเก็บ payload เป็น jsonb ใน DB = คืนโควตาแผนฟรี
- 🚨 **กับดักที่เกือบพลาด**: `fn_mig_truncate` **มี `'snapshots'` อยู่ในลิสต์** (0046) —
  drop ตารางแล้วไม่แก้ = `delete from snapshots` พังทันที = **ลบ/รีเซ็ตลูกค้าไม่ได้เลย**
  ตระกูล D79 เป๊ะ ๆ · `tenantTables.test.ts` ที่ไล่อ่าน SQL มาเทียบคือชั้นที่จับได้
- 🚨 **สคริปต์ restore ห้ามแตะ `fn_mig_set_triggers`** — นั่นคือสิ่งที่งานนี้ตั้งใจกำจัด
  ปล่อย trigger ทำงานปกติ · สต็อกยังถูกเพราะเรียก `fn_mig_recompute_stock` ปิดท้าย
  · `edit_log` จะมีแถวเพิ่มจากการ restore ซึ่ง**ควรมี** (ย้อนข้อมูลทั้งระบบคือเหตุการณ์ที่ต้อง audit ที่สุด)
- 🚨 **ไฟล์ต้องผูก `tenant.id` + `slug`** — สคริปต์ปฏิเสธเองถ้าเอาไฟล์ลูกค้า A ไปลงลูกค้า B
  (ต้อง `--tenant=<uuid>` ยืนยันเจตนาถึงจะข้ามได้) · dry-run เป็นค่าปริยาย ต้อง `--apply` ถึงลงจริง (แบบ D57)
- 🪤 **PostgREST คืนแค่ 1000 แถวเงียบ ๆ** — action ต้องวน `.range()` เหมือน `backup-tables.ts`
  ไฟล์สำรองที่ขาดแถวคือไฟล์ที่ *ดูเหมือนใช้ได้* จนถึงวันที่ต้องใช้จริง
- 🚨 **Excel กินศูนย์นำหน้า** — `tax_id`/`national_id`/`excise_id`/`sso_no` ต้องบังคับเป็นข้อความ
  ไม่งั้น `0105558123456` → `105558123456` หรือ `1.05559E+11` = เลขบนไฟล์ที่ส่งให้บัญชีผิด
  · คอลัมน์ jsonb ต้อง `JSON.stringify` ไม่ใช่ `[object Object]`
- 🔴 **`xlsx` ต้อง `await import()`** ในตัว handler — static import = ทุกคนที่เปิดหน้าตั้งค่าโหลด
  SheetJS ตาม (บทเรียนเดียวกับ pdf-lib ใน D61)
- 🪤 **`RESTORE_SKIP` ตัดเฉพาะตอนเอากลับ ไม่ใช่ตอนสำรอง** — `stock_product`/`profiles`
  ยังอยู่ในไฟล์ (ลูกค้าต้องได้ข้อมูลตัวเองครบ) แค่ไม่เขียนกลับเข้า DB
  (`stock_product` คำนวณใหม่ · `profiles` ผูก `auth.users` แตะแล้วเซสชันพัง) · มีเทสคุมทั้งสองด้าน
- 🚨 **ต้องบอกผู้ใช้ตรง ๆ บนจอ** ว่าไฟล์นี้กดกลับเองไม่ได้ + มีข้อมูลเงินเดือน/เลขบัตร ให้เก็บให้ดี
- 🔴 **เจอตอนเปิดไฟล์จริง**: `counters` · `integration_log` · `edit_log` **ไม่มีชื่อไทยใน `TABLE_LABEL_TH`**
  → 3 ชีตใน Excel ขึ้นชื่อตารางดิบให้ลูกค้าอ่าน ซึ่งผิดกฎที่เขียนไว้หัวบล็อกนั้นเอง
  (*"ผู้ใช้ไม่ได้เขียนโค้ด ห้ามโชว์ชื่อตารางดิบ ๆ"*) · ก่อน D82 ไม่เคยโผล่เพราะชื่อไทยใช้แค่ใน
  ดร็อปดาวน์หน้าประวัติการแก้ไข → เติมชื่อ + เทสไล่ว่า **ทุกตารางใน `EXPORT_TABLES` ต้องมีชื่อไทยและห้ามซ้ำ**
  — ไม่ใช่ปล่อยให้เดาเอาเองว่ายังย้อนได้เหมือนเดิม

#### 🔴 เจอเพิ่ม 2 ข้อ ตอนทดสอบทางกลับด้วยข้อมูลจริง (migration `0050`)

**1. `fn_mig_truncate` ลบ `entities` ก่อน `report_runs` → ลบ/รีเซ็ต/ย้อนข้อมูลล้มทันที**

```
rpc fn_mig_truncate: update or delete on table "entities" violates
foreign key constraint "report_runs_entity_id_fkey" on table "report_runs"
```

`report_runs.entity_id` ผูก FK ไป `entities` ตั้งแต่ `0027` แต่ในลิสต์ของ `fn_mig_truncate`
มันอยู่**หลัง** `'entities'` = ลบแม่ก่อนลูก · **บั๊กนี้มีมาตั้งแต่ `0029` ก๊อปต่อถึง `0046`/`0049`**

- 🔴 ผลจริง: **ลบ/รีเซ็ตลูกค้าจากหน้าแอดมินไม่ได้เลย ถ้าลูกค้ารายนั้นเคยกดออกฟอร์ม ภส. สักครั้ง**
- 🪤 **ทำไม `test:tenant` ไม่จับ**: tenant ที่เทสสร้างขึ้นมาไม่เคยมีแถวใน `report_runs`
  → FK ไม่มีอะไรให้ละเมิด · เจอตอนเอาข้อมูลของ tenant จริงที่มี 7 แถวกลับ
- 🚨 **บทเรียน: ลิสต์ที่ "ครบ" ไม่ได้แปลว่า "เรียงถูก"** — `tenantTables.test.ts` เดิมตรวจแค่ว่า
  **ชื่อครบทุกตาราง** ไม่เคยตรวจ**ลำดับ** → เพิ่ม `ENTITY_SCOPED_TABLES` + เทสว่า
  ทุกตารางที่มี `entity_id` ต้องถูกลบก่อน `entities` (พิสูจน์แล้วว่าเทสนี้ฟ้อง `0049` และผ่าน `0050`)
- ★ plpgsql rollback ทั้งก้อน — ตอนล้มไม่มีข้อมูลเสียหายแม้แต่แถวเดียว (ตรวจแล้ว)

**2. เลขรันนิ่งเอกสาร "ถอยหลัง" หลัง restore**

`reseedIdCounters` (ยกมาจาก `engine.ts` เดิม) ตั้ง counter = **max ของข้อมูลที่เหลืออยู่** เฉย ๆ
→ ทดสอบจริงเห็น `TR-20260825` ถอย **5 → 1** และ `BANK_ACC` **2 → 1**

- 🚨 **เอกสารที่ออกไปหลังวันสำรอง (แล้วถูกล้างตอน restore) จะปล่อยเลขกลับมาให้ใช้ซ้ำ**
  = ใบกำกับภาษี/ใบเสร็จ **เลขเดียวกันสองใบคนละเนื้อหา** ซึ่งเป็นปัญหากับสรรพากรจริง
- แก้: อ่าน counter **ก่อน** `fn_mig_truncate` เก็บเป็น "พื้น" แล้วใช้ค่าสูงสุดของ 3 ทาง —
  ค่าก่อน restore · ค่าในไฟล์ · max จากข้อมูลที่ใส่กลับ
- 🪤 ครอบคีย์ที่คำนวณจากข้อมูลไม่ได้ด้วย (`EMP` · `INV-…` · `TAX-…`) ซึ่งเดิมพึ่งค่าในไฟล์อย่างเดียว
- ทดสอบแล้ว: ตั้ง `BANK_ACC=9` `EMP=15` `TR-20260825=7` ให้สูงกว่าไฟล์ → restore → **คงค่าเดิมทั้งสามตัว**

**ผลทดสอบทางกลับ (ข้อมูลจริงของ tenant `demoprov`)**

| ตรวจ | ผล |
|---|---|
| dry-run | เทียบจำนวนแถวครบ 38 ตาราง · **ไม่แตะ DB เลยสักแถว** ✓ |
| ลบบิล 1 ใบ + `log_dilute` + `log_product` แล้ว restore | ข้อมูล**กลับครบทุกตาราง**เท่าเดิมเป๊ะ ✓ |
| สต็อกหลัง restore | `TESTDISL` = 89 (113 − 24) · `TESTSHAREL` = 128 — `fn_mig_recompute_stock` ถูกต้อง ✓ |
| 🚨 **tenant อื่นในก้อนเดียวกัน** (`default`/`platform`/`rongkhor`/`rongkor`) | **ไม่ขยับสักแถว** ✓ ← เหตุผลทั้งหมดของงานนี้ |
| `edit_log` | 252 → 385 (+133 = จำนวนแถวของตารางที่มี audit trigger) — **ตั้งใจให้เป็นแบบนี้** |
| ไฟล์ผิดกิจการ / ไม่มี tenant / ไม่ใช่ไฟล์ระบบ | ปฏิเสธทั้ง 3 แบบ **ก่อนแตะ DB** ✓ |

**รอบที่ 2 — ทิศทางที่รอบแรกยังไม่ได้พิสูจน์: ของที่เกิด*หลัง*วันสำรอง ต้องหายไป**

> รอบแรกทดสอบแค่ "ลบของออก → restore → กลับมา" ซึ่งเป็นทิศทางตรงข้ามกับการใช้งานจริง
> (*ลูกค้าทำงานมา 3 วันแล้วพัง อยากย้อนกลับไปวันจันทร์*) · ถ้า truncate ลบไม่ครบ ผลคือ
> **ข้อมูลเก่ากับใหม่ปนกัน** ซึ่งแย่กว่าไม่ restore เลย และเงียบสนิท

| ตรวจ | ผล |
|---|---|
| สร้างชุดที่ 1 ผ่านแอปจริง (บิล+2 รายการ · batch+เบิกวัตถุดิบ) → **ผู้ใช้กดดาวน์โหลดเอง** | ไฟล์ 745.1 KB มีของชุดที่ 1 ครบทุกชิ้น ✓ |
| สร้างชุดที่ 2 เพิ่มหลังสำรอง แล้ว restore | **ชุดที่ 2 หายเกลี้ยงทั้งแถวแม่และแถวลูก** (บิล+รายการ · batch+การเบิก) ✓ |
| ชุดที่ 1 หลัง restore | อยู่ครบเป๊ะ ทั้งยอด ฿1,800 และรายการลูก 2 แถว ✓ |
| จำนวนแถวเทียบไฟล์ | ตรงทุกตาราง (ยกเว้น `stock_product`/`profiles`/`edit_log` ตามออกแบบ) ✓ |
| 🚨 เลขรันนิ่ง | `TR-20260825` **คงที่ 9** ทั้งที่ในไฟล์เป็น 8 = ไม่ถอย ✓ |
| tenant อื่น 4 เจ้า | ไม่ขยับสักแถว ✓ |

**ไฟล์หลัก**: migration `0049` (drop table) + `0050` (fix ลำดับ truncate) ·
**ลบ** `lib/snapshot/engine.ts` · `lib/export/tenantExport.ts` (+เทส 20) ·
`lib/shared/download.ts` (ยกออกจาก `ExciseTab`) · `app/(app)/settings/data/{actions.ts,_components/data-manager.tsx}` ·
`scripts/restore-tenant.ts` (npm `restore:tenant`) · `lib/shared/tenantTables.ts` (`snapshots` ออก · `SNAPSHOT_SKIP`→`RESTORE_SKIP`)
· `ENTITY_SCOPED_TABLES` + เทสลำดับ truncate · build/lint/test **656** + `test:tenant` **138** ผ่าน · **ผู้ใช้ดาวน์โหลดไฟล์จริงทั้ง 2 แบบแล้ว ตรวจผ่าน** (JSON 578.7 KB · XLSX 709.2 KB · 38 ตาราง 445 แถว ตรงกับ DB ทุกตาราง · เลขภาษี/เลขบัตรเป็น `type=s` ครบ) · ชุดเทส `docs/TESTING.md` ส่วนที่ 40

---

### D83 — ปุ่มที่ถูก disable ต้องบอกว่า "ยังขาดอะไร" (2026-08-26 · ไม่มี migration)

**อาการ**: ตอนเทสด้วย `/browser-qa` ติดที่ปุ่ม **ออกใบเสนอราคา (A4)** ซึ่งเทาอยู่เฉย ๆ
เงื่อนไขจริงคือ

```
disabled={pending || items.length === 0 || !selCustId || !saleName.trim()}
```

ขาดอย่างใดอย่างหนึ่งใน 3 อย่าง (ลูกค้า · รายการในตะกร้า · **ผู้เสนอราคา**) ปุ่มก็เทาเหมือนกันหมด
ช่อง "ผู้เสนอราคา" อยู่ล่างสุดของการ์ดตะกร้า ไม่มีดาว ไม่มีคำว่าจำเป็น → **ผู้ใช้ใหม่นึกว่าปุ่มเสีย**

🪤 **ตระกูลเดียวกับ D74/D77/D80** — *ระบบทำได้ แต่ผู้ใช้ไม่รู้ว่าต้องทำอะไรต่อ* ·
`build`/`lint`/`test` ผ่านหมดทุกข้อ เพราะโค้ดทำงานถูกตามที่เขียนไว้เป๊ะ
**ชั้นเดียวที่จับได้คือมีคนเปิดหน้าจอแล้วงง**

**สิ่งที่ทำ**: `missingLabels()` / `missingText()` ใน `lib/shared/forms.ts` (+เทส 5) และ
`<MissingHint>` ใน `lib/shared/ui.tsx` (re-export ผ่าน barrel ทั้ง 3 โดเมน) — ขึ้นข้อความสีเหลือง
ใต้ปุ่มว่า *"ยังกรอกไม่ครบ: ลูกค้า · ผู้เสนอราคา"* · ครบแล้วไม่ render อะไรเลย (ไม่ใช่ช่องว่างค้าง)

🚨 **`<MissingHint>` เป็นแค่คำอธิบาย ไม่ใช่ตัวตัดสินว่าบันทึกได้หรือไม่** — เงื่อนไข `disabled=`
ของปุ่มยังเป็นตัวจริง (และ server action ยัง validate ซ้ำ) · จงใจ**ไม่**ผูกสองที่เข้าด้วยกันเป็นตัวเดียว
เพราะการรวมจะทำให้เกิดสภาพ *"ปุ่มกดไม่ได้แต่บอกว่าครบแล้ว"* ตอนมีคนแก้ข้างเดียวไม่ได้ยากเลย —
ยอมเขียนซ้ำ 2 บรรทัดดีกว่า (แลกกับความเสี่ยงที่ข้อความไม่ตรงกับปุ่ม ซึ่งเห็นได้ทันทีบนจอ)

**ไล่ทั้งแอปแล้ว** — `disabled=` ทั้งหมด 32 จุด แยกเป็น 3 กลุ่ม:

| กลุ่ม | ทำอะไร | ที่ไหน |
|---|---|---|
| ปุ่มบันทึกที่รอหลายช่อง | เพิ่ม `<MissingHint>` | QuotationTab · DrawTab · FermentTab · DiluteTab · MaterialTab · ProductTab · MonitorTab · BrandingCard · CompanyCard (3 การ์ด) |
| ปิดเพราะ**กฎ** ไม่ใช่ช่องว่าง | เพิ่ม `title=` | MasterTab (รหัสเป็น PK แก้ไม่ได้) · users-manager (ลบตัวเองไม่ได้) · BillsTab (ปุ่ม "เติมทุกแถว" ว่าง = จะไปล้างค่าเดิม) |
| **มีคำอธิบายอยู่แล้ว — ไม่แตะ** | — | PeriodTab (มีแถบ `locked` / `!rates` / `Empty` ครบ) · EntryTab (VAT + บัญชีตั้งค้าง เขียนบอกในบรรทัดเดียวกัน) · platform-manager (`quotaFull` มีบรรทัดใต้ปุ่ม) · QuotationTab เมนูสินค้า ("เลือกลูกค้าก่อน…" / ป้าย "หมด") · ConfigTab (▲▼ สุดขอบ) · data-manager (ช่องรหัสอยู่เหนือปุ่มพอดี) |

🪤 **กับดักตอนแก้**: การ์ดฝั่งตั้งค่าวาง `SaveButton` ไว้ใน `div.flex flex-wrap items-end` —
แปะ `<MissingHint>` ต่อท้ายตรง ๆ มันจะกลายเป็น flex item **ข้างปุ่ม** ไม่ใช่ใต้ปุ่ม
ต้องย้ายออกไปนอก `</div>` ของแถว

**ไฟล์**: `lib/shared/forms.ts` + `forms.test.ts` (ใหม่) · `lib/shared/ui.tsx` (`MissingHint`) ·
barrel `ui.tsx` 3 โดเมน · 12 component · build/lint/test **661** ผ่าน · ชุดเทส `docs/TESTING.md` ส่วนที่ 41

---

### D84 — หน้าแอดมินโชว์ชื่อโมดูลผิด: ลูกค้าที่ซื้อ "เงินเดือน" ขึ้นเป็น "ขาย" (2026-08-26 · ไม่มี migration)

**อาการ**: ตาราง *ลูกค้าทั้งหมด* ที่ `/platform` โชว์ `demoprov` เป็น **"ผลิต · บัญชี · ขาย · ขาย"**
— คำว่า "ขาย" ซ้ำ 2 อัน · ตรวจที่ DB แล้ว `modules_enabled = [production, accounting, sales, payroll]`
คือข้อมูลถูก **หน้าจอแปลผิด**

**สาเหตุ** — `app/(platform)/platform/_components/platform-manager.tsx` เขียนไว้ว่า

```tsx
{m === "production" ? "ผลิต" : m === "accounting" ? "บัญชี" : "ขาย"}
```

เขียนตอน D54 ซึ่งตอนนั้นมี **3 โมดูล** → `sales` เป็น else ที่ถูกต้องพอดี
พอ **D66 เพิ่มโมดูลที่ 4 `payroll`** มันตกเข้า else เดียวกัน กลายเป็น "ขาย" เงียบ ๆ

🪤 **ternary ไล่เช็ค key คือ `else` ที่กลืนของใหม่ทุกอันที่ยังไม่มีใครรู้จัก** — ต่างจาก
`Record<Key, string>` ที่ TypeScript บังคับให้ครบ · ในไฟล์เดียวกัน**มี `MODULE_LABEL` ที่ถูกต้องครบ 4 ตัวอยู่แล้ว**
แต่ใช้เฉพาะในช่องติ๊กเลือก (ซึ่งจึงถูกมาตลอด) — **ความจริง 2 แหล่งในไฟล์เดียว แหล่งหนึ่งถูกอัปเดต อีกแหล่งไม่**

🚨 **ผลกระทบไม่ใช่แค่ป้ายเพี้ยน** — นี่คือหน้าจอที่ใช้ตอบคำถาม *"ลูกค้ารายนี้ซื้ออะไรไว้"*
ก่อนคุยเรื่องต่อสัญญา/เก็บเงิน · อ่านผิดแล้วเก็บเงินผิดแพ็กเกจ หรือบอกลูกค้าว่าไม่มีโมดูลที่เขาจ่ายไปแล้ว
· ★ ตัวคุมสิทธิ์จริง (`workspacesFor`/`requireModule`) ใช้ key ไม่ได้ใช้ป้าย → **สิทธิ์ของลูกค้าไม่เคยผิด**
เสียแค่ฝั่งที่มนุษย์อ่าน

**สิ่งที่ทำ**: ย้ายชื่อโมดูลไป `lib/shared/workspaces.ts` เป็น `MODULE_LABEL: Record<ModuleKey, string>`
(อยู่บ้านเดียวกับ `MODULES`) → **เพิ่มโมดูลใหม่แล้วลืมเติมชื่อ = build ไม่ผ่าน** ไม่ใช่ขึ้นผิดบนจอ ·
ฝั่งหน้าแอดมินเหลือ `moduleLabel(m, withNote)` ตัวเดียวใช้ทั้งตารางและช่องติ๊ก ·
คำต่อท้าย *"(+ ฟอร์ม ภส.)"* แยกเป็น `MODULE_NOTE` เพราะป้ายในตารางต้องสั้น

**เทสที่เพิ่ม** (`lib/shared/workspaces.test.ts` +4 → รวม 18):
ครบทุก key · **ชื่อห้ามซ้ำกัน** (ซ้ำ = มีโมดูลถูกกลืนไปเป็นชื่ออีกตัว ซึ่งคืออาการของบั๊กนี้เป๊ะ) ·
ตรงกับ label ของ workspace · และเคสตรง ๆ ว่า `payroll` ต้องเป็น "เงินเดือน"

**ไฟล์**: `lib/shared/workspaces.ts` (`MODULE_LABEL`) · `workspaces.test.ts` (+4) ·
`app/(platform)/platform/_components/platform-manager.tsx` · build/lint/test **665** ผ่าน ·
ยืนยันบนหน้าจอจริงแล้ว: `demoprov` ขึ้น ผลิต · บัญชี · ขาย · **เงินเดือน** · ชุดเทส `docs/TESTING.md` ส่วนที่ 42

---

### D85 — บทบาท 4 ตัว → 9 ตัว + สิทธิ์แบบ capability (0051, 2026-08-27)

**เหตุ**: ผู้ใช้ต้องการจ้างพนักงานบัญชี/ฝ่ายขายมาใช้ระบบจริง แต่โครงเดิม **กัน "แก้" แน่นหนา
แต่แทบไม่กัน "ดู" เลย** — `policy select` ส่วนใหญ่เขียนว่า `using (auth.uid() is not null)`
= ใครล็อกอินในกิจการนั้นก็อ่านได้หมด ทั้งบิลบัญชีทุกใบ · ราคาทุน · สูตรการผลิต ·
ประวัติราคาขายลูกค้าทุกราย (กันจริงมีแค่โมดูลเงินเดือนกับ `edit_log`)

**บทบาทใหม่ 9 ตัว** — 2 มิติ: *โดเมนไหน* × *ตั้งค่าได้ไหม*

| key | ชื่อไทย | ได้อะไร |
|---|---|---|
| `main` | เจ้าของกิจการ | ทุกอย่าง (เหมือนเดิมเป๊ะ) |
| `viewer` | ผู้ดูข้อมูล | ดูผลิต+ขาย+บัญชี · แก้ไม่ได้ · **ไม่เห็นเงินเดือน** |
| `sales_manager` | หัวหน้าฝ่ายขาย/คลัง | ขาย+คลัง+จัดการข้อมูลหน้าขาย **+ ยกเลิกออเดอร์** |
| `sales` | ฝ่ายขาย/คลัง | ขาย+คลัง · ตั้งค่าไม่ได้ · **ยกเลิกไม่ได้** |
| `finance_manager` | ผู้จัดการการเงิน | บัญชี+เงินเดือน รวมตั้งค่าทั้งสอง |
| `accounting_manager` | หัวหน้าบัญชี | บัญชี+ตั้งค่าบัญชี |
| `accounting` | พนักงานบัญชี | บัญชี · ตั้งค่าไม่ได้ |
| `payroll_manager` | หัวหน้าฝ่ายบุคคล | เงินเดือน+ตั้งค่าการคำนวณ |
| `payroll` | พนักงานเงินเดือน | เงินเดือน · ตั้งค่าไม่ได้ |

`sale`/`warehouse` **ยุบเป็น `sales`** (ผู้ใช้ตัดสิน: คนขายกับคนคลังเป็นคนเดียวกัน)
🚨 คนที่เคยเป็น `warehouse` **ได้สิทธิ์เพิ่ม** (ออกใบเสนอราคาได้)

#### ทำไมเป็น capability ไม่ใช่รายชื่อ role

`my_role() = 'main'` ถูกก๊อปไว้ **150 จุดใน 15 ไฟล์ migration** → เพิ่มบทบาทใหม่ = ไล่แก้ทุกจุด
และลืมจุดไหนก็ไม่มีอะไรฟ้อง **กลไกเดียวกับที่ทำให้ D84 เกิด**

ตอนนี้ทุกที่ถามว่า *"ทำสิ่งนี้ได้ไหม"* ไม่ใช่ *"เป็นใคร"* — cap 12 ตัว
(`prod/acct/sales/pay` × `read/write/config` + `admin`)

★ ประกาศเป็น `Record<Role, …>` ทั้ง `ROLE_CAPS` / `ROLE_LABEL` / `ROLE_HINT` →
**เพิ่มบทบาทใหม่แล้วลืมกำหนดสิทธิ์ = build ไม่ผ่าน** (ต่อยอดบทเรียน D84)

#### 🚨 ตารางสิทธิ์มี 2 ฝั่งที่ต้องตรงกันเสมอ

`ROLE_CAPS` (`lib/shared/roles.ts`) คุมว่าหน้าจอโชว์อะไร · `has_cap()` (SQL) คือ**ตัวจริงที่บังคับ**
หลุดจากกันแล้ว**ไม่มี error ให้เห็นทั้งคู่**:
- TS ใจกว้างกว่า DB → เห็นเมนู กดเข้าไปหน้าว่าง/บันทึกไม่ได้
- DB ใจกว้างกว่า TS → **มีสิทธิ์เกินที่ตั้งใจโดยไม่มีใครรู้** (อันตรายกว่า)

→ `rolesSql.test.ts` **อ่าน SQL เป็นข้อความมาเทียบกับตาราง TS** (ชั้นเดียวกับ `tenantTables.test.ts`
ที่ D79 ใช้จับ `fn_mig_truncate`) + เทสว่า regex แมตช์อะไรจริง ไม่ใช่ผ่านฟรี

#### 🪤 กับดักที่เจอตอนทำ

**1. `prod.read` เกือบทำหน้าที่ 2 อย่างปนกัน** — ตอนแรกให้ฝ่ายขายถือ `prod.read` เพื่ออ่าน
แคตตาล็อกสินค้า แต่ cap เดียวกันนี้คือตัวตัดสินว่า *"เห็นเมนูผลิตไหม"* → ฝ่ายขายจะเห็นหน้าผลิตโผล่มา
**แก้ที่ policy ของตารางนั้นแทน**: `products`/`stock_product` เปิดให้ `prod.read` **หรือ** `sales.read`
ส่วน `materials`/`log_*` (สูตร/ค่าดีกรี) ยังปิดสนิท

**2. RPC 8 ตัวเป็น `security definer` → bypass RLS ทั้งหมด** ต้องเช็คสิทธิ์เอง
(บทเรียน 0028→0029: policy ถูกครบแต่ลืม RPC = ยิง action ตรงแล้วผ่าน)
ตัวฟังก์ชันรวม ~473 บรรทัด → **ยกมาด้วยสคริปต์ `scripts/gen-0051.mjs`** ไม่ได้พิมพ์มือ
สคริปต์ throw ทันทีถ้าบรรทัดเช็คเดิมไม่ตรงหรือเจอมากกว่า 1 ครั้ง
★ `fn_save_transaction`/`fn_edit_transaction`/`fn_issue_wht` **ไม่ต้องแตะ** — เป็น invoker
ถูกกั้นด้วย policy อยู่แล้ว (ตรวจแล้วทีละตัว ไม่ได้เดา)

**3. อ่านข้ามโดเมน 3 จุด — แก้ที่โค้ด ไม่ใช่เปิด policy กว้าง**

| จุด | ปัญหา | ทำอะไร |
|---|---|---|
| เงินเดือนอ่าน `transactions.category` ทำดร็อปดาวน์ | เปิดให้ = **บิลทุกใบรั่ว** (RLS เป็น row-level คุมรายคอลัมน์ไม่ได้) | ปล่อยให้ RLS คืน `[]` เอง — เหลือหมวดจาก `app_settings` + ขาที่ตั้งไว้ (ยังครบตาม D73) · `finance_manager` เห็นครบเพราะมี `acct.read` |
| `nextEmpWhtDocNoAction` อ่าน `doc_no` ทุกใบ | เลข 50ทวิ พนักงาน**ชุดเดียวกับคู่ค้า** (D69) แต่ policy ให้เห็นแค่ใบพนักงาน → **ออกเลขซ้ำกับใบที่ยื่นสรรพากรไปแล้ว** | RPC `fn_wht_doc_nos()` คืน**เฉพาะเลขที่** ไม่คืนชื่อ/ยอด · สูตรตั้งเลขยังอยู่ที่ `nextWhtDocNo()` ที่มี golden test |
| บัญชีอ่าน `materials` | ดร็อปดาวน์รับวัตถุดิบ (D79) | เปิด select ให้ `acct.read` — เป็นรายชื่อ ไม่ใช่ต้นทุน (ต้นทุนอยู่ใน `transactions`) |

**4. `wht_certificates` เก็บใบของคู่ค้ากับพนักงานปนกัน** → แยกด้วย **คอลัมน์** ไม่ใช่แยกตาราง:
`acct.read` เห็นหมด · `pay.read` เห็นเฉพาะ `emp_id is not null`

**5. 🚨 `$` ใน heredoc ของ shell โดนกลืนเป็น `# DECISIONS — บันทึกการตัดสินใจ/ความไม่ตรงกันระหว่าง implement

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

### D77 — หน้าแก้ไขบิลต้องกรอก หมวดหมู่/งาน ของรายการได้ (2026-08-22)

**ไม่มี migration · ไม่แตะ RPC/server action/ชั้นสูตรเงิน** · ผู้ใช้แจ้งว่า *"ลืมบันทึกว่าเป็นของงานไหน
จะไปกดแก้ไขเพื่อบันทึกย้อนหลังแต่ไม่มีช่องให้กรอก"*

#### ของครบทุกชั้น ขาดแค่ช่องบนจอ

| ชั้น | สถานะก่อนแก้ |
|---|---|
| คอลัมน์ `transaction_items.item_category` / `item_job` | ✅ มีตั้งแต่ migration แรก |
| RPC `fn_edit_transaction` | ✅ เขียน 2 คอลัมน์นี้อยู่แล้ว |
| payload `buildItemInputs()` | ✅ ส่ง 2 ค่านี้อยู่แล้ว |
| `EditBillModal` โหลดค่าเดิมเข้า state | ✅ โหลดอยู่แล้ว |
| **ช่องกรอกบนหน้าจอ** | ❌ **ไม่มี** |

> 🚨 **ช่องที่ DB/RPC/payload รองรับครบ แต่ไม่มีช่องกรอกบนจอ = ฟีเจอร์ที่ไม่มีอยู่จริงสำหรับผู้ใช้**
> ตระกูลเดียวกับ D74 *"ฟีเจอร์ที่ยังไม่มีทางเข้าถึง = บั๊กที่ยังไม่ถูกนับ"*
> อาการนี้ตรวจด้วย build/lint/test ไม่เจอเลย เพราะค่าที่โหลดมา**รอด round-trip** กลับลง DB ครบทุกครั้ง
> (แก้บิลกี่รอบข้อมูลก็ไม่หาย) — ดูเหมือนทุกอย่างทำงานถูก จนกว่าจะมีคนอยาก *แก้* ค่านั้นจริง ๆ
> · แถวที่เพิ่มใหม่ในหน้าแก้ไขยิ่งหนักกว่า: `emptyItem()` ให้ค่าว่างแล้ว**เติมไม่ได้เลยตลอดกาล**

#### โชว์ตลอด ไม่ซ่อนหลัง toggle (ต่างจาก EntryTab)

`EntryTab` ซ่อน หมวด/งาน/ส่วนลด ไว้หลังปุ่ม "แสดงคอลัมน์เสริม" (`showOpt`) เพราะเป็นฟอร์มคีย์งานประจำวัน
แต่หน้าแก้ไขบิลคือ**โฟลว์ซ่อมข้อมูลย้อนหลัง** — สิ่งที่ต้องกรอกคือของที่ลืม ถ้ายังต้องกดเปิดก่อนถึงเห็น
ก็ยังหาไม่เจออยู่ดี (หน้าแก้ไขโชว์ ลด%/ลดบาท ตลอดอยู่แล้วโดยไม่มี toggle — ทำให้สอดคล้องกัน)
· ตารางจาก 8 → 10 คอลัมน์ จึงขยายโมดัล `sm:max-w-3xl` → `sm:max-w-5xl`

#### ปุ่ม "เติมทุกแถว"

เคสจริงคือ**ทั้งบิลเป็นงานเดียวกัน** — ไล่พิมพ์ทีละแถวช้าและพิมพ์เพี้ยนได้ (`งาน A` ≠ `งานA` = คนละงานในรายงาน)
· ปุ่ม **disabled เมื่อช่องว่าง** — กันกดพลาดแล้วล้างค่าที่มีอยู่ทั้งบิลเป็นค่าว่าง
· เป็น state ในฟอร์มเท่านั้น ยังไม่เขียนจนกด *บันทึกการแก้ไข* (กดผิดปิดโมดัลทิ้งได้)

#### 🪤 id ของ `<datalist>` ห้ามซ้ำข้ามแท็บ

แท็บในแอปบัญชีถูก **mount ค้างไว้พร้อมกัน** (`BillsTab` รับ prop `active` แทนการ unmount)
ถ้าใช้ id เดิมของ `EntryTab` (`hist-item-cats` / `hist-item-jobs`) เบราว์เซอร์จะผูก `list=`
เข้ากับ element **แรกที่เจอใน DOM** → ดรอปดาวน์ในหน้าแก้ไขไปโชว์ค่าของอีกแท็บ
**โดยไม่มี error หรือ warning ฟ้องเลย** → ใช้ `edit-item-cats` / `edit-item-jobs`
(หน้าแก้ไขมีแบบอย่างอยู่แล้ว: `edit-cat-list`, `edit-contact-list`)

#### อื่น ๆ

- การ์ด **ดู** (อ่านอย่างเดียว) เพิ่มคอลัมน์ **งาน** ด้วย — ไล่ตรวจย้อนหลังว่าบิลไหนยังไม่ได้ใส่งาน
  โดยไม่ต้องเปิดหน้าแก้ไขทีละใบ
- `addItem()` ก๊อปหมวด/งานจากแถวสุดท้าย (เหมือน `EntryTab`) — `emptyItem(cat, job)` รับอาร์กิวเมนต์อยู่แล้ว
- ดรอปดาวน์ใช้ `getItemHistoryAction(entId)` ตัวเดิม (ประวัติเฉพาะบิลสถานะ `ปกติ`)
  · `entId` รู้ค่าหลังโหลดบิลเสร็จ จึงแยกเป็น effect ผูกกับ `entId`

**ไฟล์**: `app/(app)/accounting/_components/BillsTab.tsx` (ไฟล์เดียว) · build/lint/test **566** ผ่านเท่าเดิม

---

### D78 — สุราแช่: เส้นทางผลิตที่ 2 + ฟอร์ม ภส.๐๗-๐๒/๑(๑) ฉบับสุราแช่ (0045, 2026-08-24)

กฎหมายปัจจุบันให้ขอใบอนุญาตผลิตได้ทั้ง **สุรากลั่น** และ **สุราแช่** ในโรงเดียว
สุราแช่ไม่มีการกลั่น และใช้**ฟอร์มบัญชีผลิตคนละใบ** (ผู้ใช้เก็บพิกัดฟอร์มมาให้ครบ 33 จุด)
· เบียร์เป็นสุราแช่ชนิดหนึ่งแต่ใช้อีกฟอร์ม — **ตัดออกจากรอบนี้**

#### ⚠️ เลขฟอร์มบนหัวกระดาษชนกันสนิท

ทั้งสองใบพิมพ์ **ภส.๐๗-๐๒/๑(๑)** เท่ากันเป๊ะ แต่เป็นกระดาษคนละแบบ (กลั่น 19 คอลัมน์ 13 แถว ·
แช่ 14 คอลัมน์ 17 แถว) → `ExciseKind` แยกเป็น `0702_1` / `0702_1_chae` · template แยก key ·
บนจอเรียกว่า **"บัญชีผลิตสุรากลั่น" / "บัญชีผลิตสุราแช่"** ไม่ใช้เลขฟอร์มเป็นตัวแยกให้ผู้ใช้เลือก

#### 1. ตารางใหม่ `log_ferment_draw` (ไม่ reuse `log_distill`)

`log_distill` มีช่องตรงกับที่ฟอร์มสุราแช่ต้องการ**พอดีทั้ง 4 ช่อง** (batch/vol/abv/date) — reuse ได้เลย
แต่**ผู้ใช้เลือกตารางใหม่**: ยอมมีโค้ด 2 ที่ทำเรื่องคล้ายกัน เพื่อแลกกับการที่วันหนึ่งจะแก้ดีเทล
เฉพาะของ *การกลั่น* หรือ *การแช่* ได้โดยไม่กระทบกันเอง

> ★★ **กติกาเหล็ก 1 batch = 1 แถว ยกมาใช้ด้วย** (`unique (tenant_id, entity_id, batch)`)
> เหตุผลเหมือน `log_distill` เป๊ะ: ฟอร์มหักน้ำหมักของ batch นั้น**ทั้งก้อน**ต่อ 1 แถว
> รินซ้ำ = หักซ้ำ = เลขยื่นราชการผิด · RPC `fn_draw_fermented` แปลง `unique_violation`
> เป็นข้อความไทย เหมือน `fn_close_batch`

#### 2. ธง กลั่น/แช่ = `products.liquor_type` ตัวเดิม (ไม่เพิ่มคอลัมน์)

`liquor_type` คือช่อง "ประเภทสุรา" ที่**พิมพ์ลงหัวฟอร์ม ภส. อยู่แล้ว**ทั้ง 4 ใบ และตามกฎหมาย
มีแค่ 2 ค่านี้จริง → ไม่ต้องมีธงซ้อนอีกตัว · บนจอเปลี่ยนเป็น**ดร็อปดาวน์ชุดปิด** (`LIQUOR_PROCESS`)

> 🚨 **ห้ามใส่ CHECK constraint กับคอลัมน์นี้** — `db:push:all` ลงทุก DB รวมของลูกค้าที่เราไม่เคย
> เห็นข้อมูล ใครพิมพ์ค่าอื่นไว้ = migration ล้มทั้ง fleet → บังคับที่ดร็อปดาวน์ + เตือนบนจอเท่านั้น
>
> 🚨 **ห้าม default เป็นสุรากลั่น** เมื่อค่าว่าง/ไม่รู้จัก — เดาแล้วออกฟอร์ม**ผิดใบ**โดยไม่มีอะไรฟ้อง
> แท็บรายงานสรรพสามิตขึ้นแถบแดงบอกชื่อสินค้าที่ยังไม่ได้ตั้ง แล้ว**ไม่ออกฟอร์มบัญชีผลิตให้**
> (ฟอร์มวัตถุดิบ/สุราขวด/งบเดือนยังออกได้ตามปกติ — ไม่ต้องรู้ประเภท)
>
> 🪤 ดร็อปดาวน์ต้องเก็บ**ค่าเดิมที่ไม่อยู่ในชุด**ไว้เป็น option `(ค่าเดิม)` ไม่งั้นเปิดหน้าแก้แล้ว
> ค่าที่ลูกค้าพิมพ์เองไว้ก่อนหายเงียบ ๆ กลายเป็นค่าแรกของชุด · 🪤 รายงานรวมยอดตาม **ชื่อสุรา**
> ถ้าชื่อเดียวกันมีหลายแถวประเภทไม่ตรงกัน = เดาไม่ได้ → เตือนอีกแถบ

#### 3. ขั้นปรุงอยู่ในแถวเดียวกับการริน — และยอดที่ลงฟอร์มคือยอด**หลังปรุง**

ผู้ใช้ยืนยันว่าสุราแช่**มี**ขั้นเติมน้ำ/น้ำตาล/ปรับดีกรีก่อนบรรจุ แต่ฟอร์ม**ไม่มีคอลัมน์รองรับขั้นปรุง**
→ เก็บ `vol/abv` (ตอนริน) + `final_vol/final_abv/water/adjust_date` (หลังปรุง) ไว้แถวเดียวกัน

> 🚨 **ต้องลงยอดหลังปรุง** ไม่ใช่ยอดตอนริน — หัวคอลัมน์เขียนว่า *"ที่ผลิตได้**และรอบรรจุ**"*
> และเป็นทางเดียวที่ยอดคงเหลือจะตรงกับยอดบรรจุ (ริน 160 ปรุงเป็น 200 แล้วบรรจุ 200
> ถ้าลง 160 → ช่องคงเหลือติดลบ) · **ยังต้องให้ผู้ใช้ยืนยันกับเจ้าหน้าที่สรรพสามิต**
> → รวมการตัดสินใจนี้ไว้ที่ `drawnVol()` / `drawnAbv()` ใน `lib/production/calc.ts` **จุดเดียว**
> ตอบมาว่าอย่างไรก็แก้ที่นั่นที่เดียว
>
> 🪤 ปล่อยให้สุราแช่ลงแท็บ **ปรุง/ปรับดีกรี** ได้ด้วย = ปรุงถูกนับ 2 ที่ (`log_dilute` +
> `log_ferment_draw`) ยอดพองโดยไม่มีอะไรฟ้อง → `DiluteTab` ตัดสินค้าประเภทสุราแช่ออกจากดร็อปดาวน์

#### 4. ซ่อนแท็บของเส้นทางที่โรงนี้ไม่ได้ทำ — ตัดสินจาก**สินค้าจริง**

`SubTab.process` + `tabsFor(ws, role, processes)` · โรงที่มีแต่สุรากลั่นไม่เห็นแท็บ "รินน้ำสุราแช่"
และกลับกัน · หลักเดียวกับ D51 (**ห้ามผูกกับธงแพ็กเกจ ตัดสินจากข้อมูลจริง**)

> 🪤 **เซ็ตว่าง (ยังไม่มีสินค้า) = โชว์ครบ** ไม่งั้นระบบเปล่าที่เพิ่งรับลูกค้าใหม่จะไม่มีแท็บให้กดเลย
> 🪤 ต้องกรอง**ทั้งสองที่** — `ProductionApp` (แถบแท็บ) และ `navSubItems` ผ่าน `layout.tsx` → `Nav`
> ทำที่เดียวแล้วดร็อปดาวน์บนแถบเมนูจะลิงก์ไปแท็บที่ถูกซ่อน กดแล้วเด้งกลับแท็บแรก (ตระกูล D68)

#### 5. บั๊ก 2 จุดที่โผล่มาเพราะเส้นทางที่ 2 (ไม่ได้อยู่ในแผนตอนแรก)

- `getPendingBatches()` ตัดสิน "batch ค้าง" จาก `log_distill` **อย่างเดียว**
  → batch ของสุราแช่ที่รินแล้วจะค้างในรายการ "รอกลั่น" **ตลอดกาล**
- `getBatchBoard()` คิด stage จากหม้อกลั่น/`log_distill`
  → การ์ดของ batch สุราแช่ค้างที่ "ลงหมัก" ถาวร → เพิ่ม stage **"รินน้ำสุราแล้ว"** + ธง `fermented`

> ทั้งคู่คือ **ตรรกะที่ถูกต้องตราบใดที่มีเส้นทางเดียว** — เพิ่มเส้นทางที่ 2 เมื่อไหร่ต้องไล่หาทุกจุดที่
> ถามว่า "จบหรือยัง" แล้วดูจาก `log_distill`

#### 6. ช่องหมายเหตุต้องคุมความกว้าง

ช่องกว้าง 64 จุด แต่ `note` มี**ข้อความที่ผู้ใช้พิมพ์เอง**ปนอยู่ = ยาวไม่จำกัด
วัดจริงแล้วข้อความปรุงแบบเดิม (`"ปรุงปรับดีกรี 9 ได้ปริมาณ 200.00 ลิตร"`) ที่ 6.5 จุด กว้าง 66.7
→ จบที่ x 826.4 (เลยขอบช่อง) และถ้ามีวันที่ปรุงด้วยจะจบที่ 851.9 = **ไหลออกนอกขอบกระดาษ 841.8**

→ ข้อความอัตโนมัติสั้นลงเป็น `"ปรุง 26/05/69 9° ได้ 200.00 ล."` **และ** เพิ่ม `fit()` ใน
`fillFermentedForm` (ย่อฟอนต์ลงถึง 5 จุด → ยังไม่พอค่อยตัดท้ายด้วย …) ผูกกับ `cols.note.maxW`

#### สิ่งที่ตั้งใจ **ไม่** ทำ

- **ไม่ refactor `lib/pdf/excise.ts`** ที่มี helper ซ้ำ 3 ชุด (`txt`/`right`/`center`/`drawCol`)
  → duplicate เป็นชุดที่ 4 · ไฟล์นี้อยู่ใต้กติกาเหล็กข้อ 3 ฟอร์ม 4 ใบเดิมต้องได้ผลไบต์เดิมเป๊ะ
  การจัดบ้านเพื่อความสวยงาม = แก้โค้ดที่วาดฟอร์มราชการ 3 ใบพร้อมกัน ไม่คุ้มความเสี่ยง
- **ไม่แตะ `productionReport`** แม้แต่บรรทัดเดียว — golden test เดิมผ่านโดยไม่แก้ไฟล์เทสและไม่แก้
  `__golden__/reports.json` = หลักฐานว่าเส้นทางสุรากลั่นไม่ขยับ (เทคนิคเดียวกับ D55/D69/D70)
- **ไม่มี golden จากระบบเดิม** เพราะแอป GAS เดิมทำแต่สุรากลั่น → ค่าที่คาดหวังเป็นตัวเลขกลม
  ที่ตกลงกับผู้ใช้ไว้ วางเป็น fixture ในไฟล์เทสเลย (`fermented.test.ts`) ไม่ใช่ `__golden__/*.json`
  จะได้อ่านคู่กับค่าที่คาดหวังในที่เดียว
- **ช่อง ☐ โรงขนาดกลาง** เก็บพิกัดไว้ใน CFG แล้ว แต่ยังติ๊ก "ขนาดเล็ก" เป็นค่าปริยายเหมือนฟอร์ม
  เดิมทั้ง 4 ใบ — จะสลับได้ต้องมีช่อง "ขนาดโรงงาน" ใน `entities` ก่อน **ยังไม่มีจึงไม่เดา**

#### ตัวเลขที่ผูกกับเทส (ตรวจกับฟอร์มด้วยตาได้)

| วันที่ | เหตุการณ์ | น้ำหมักคงเหลือ | สุราแช่คงเหลือ |
|---|---|---|---|
| 3 พ.ค. | หมัก 11/69 · 2 ถัง × 100 | 200 | 0 |
| 8 พ.ค. | หมัก 12/69 · 1 ถัง × 100 | 300 | 0 |
| 24 พ.ค. | ริน 11/69 ได้ 160 @12° → ปรุงเป็น 200 @9° | **100** (หักทั้งก้อน 200) | 200 |
| 28 พ.ค. | บรรจุ 0.75 × 200 ขวด = 150 ล. | 100 | **50** |
| | รวมเดือนนี้ | น้ำหมัก 300 · น้ำสุราแช่ 200 · บรรจุ 150 | |

**ไฟล์หลัก**: migration `0045` · `lib/production/calc.ts` + `reports.ts` (`fermentedReport`) ·
`lib/pdf/excise.ts` (`CFG_0702_1_CHAE` + `fillFermentedForm`) · `lib/shared/tabs.ts` ·
`app/(app)/production/_components/DrawTab.tsx` (ใหม่) · `data.ts`/`actions.ts`/`excise-data.ts` ·
`BoardTab`/`MasterTab`/`ExciseTab`/`DiluteTab` · `layout.tsx`+`nav.tsx` ·
พิกัดฟอร์ม `docs/form/พิกัด_ภส07-02ทับ11_สุราแช่.md` · seed `supabase/seed/seed_fermented.sql`
· build/lint/test **593** ผ่าน

---

### D79 — ต้นทุนสุรา (บัญชี) → วัตถุดิบ (ผลิต) ไม่เคยทำงานเลยสักครั้ง (0046, 2026-08-24)

**ที่มา**: ผู้ใช้แจ้งว่า *"ลงรายจ่ายจากแอปบัญชี เป็นต้นทุนสุรา มีวัตถุดิบจากฝั่งผลิตให้เลือก
แต่พอมาดูที่ผลิต-วัตถุดิบ ไม่มีรายการล่าสุดขึ้นให้ และออกรายงานเพื่อเช็ค ก็ไม่ขึ้นในรายงาน"*

#### สาเหตุจริง: alias ใน SQL ชนชื่อตัวแปร plpgsql

```sql
declare it jsonb;                                   -- ตัวแปรลูป
...
select ... from jsonb_array_elements(p_items) it;   -- ← alias ชื่อเดียวกัน
```

PostgreSQL ตอบ `42702 column reference "it" is ambiguous` และบรรทัดนี้อยู่ **นอก**
บล็อก `begin/exception` ที่ตั้งใจดักไว้ → error หลุดออกไป abort ทั้งฟังก์ชัน

> 🚨 **ไม่ใช่แค่ forward พลาด — บิลบัญชีไม่ถูกบันทึกด้วยซ้ำ**
> เพราะ `fn_save_transaction` ทั้งตัวถูก roll back

บั๊กนี้เกิดตั้งแต่ `0011` แล้วถูก **ก๊อปยกบล็อกต่อไปใน `0017`** → เส้นทางนี้
**ไม่เคยทำงานสำเร็จเลยสักครั้งตั้งแต่เปิดระบบ** · หลักฐานตรงจาก DB จริง:
`integration_log` ไม่มีแถว `RECEIVE_MATERIAL` แม้แต่แถวเดียว และ `transactions`
ไม่มีบิลหมวด `ต้นทุนสุรา` สักใบตั้งแต่ migrate มา

> 🪤 **ตรรกะที่อยู่ในฐานข้อมูล ไม่มี build/lint/test ตัวไหนมองเห็น**
> `npm run build` / `lint` / `test` ผ่านหมด 100% มาตลอดทั้งที่ฟีเจอร์ตายสนิท
> — ตระกูลเดียวกับ D68 (ดร็อปดาวน์ไม่ขึ้นเพราะ `overflow-x-auto`) และ D74/D77
> (*"ฟีเจอร์ที่ยังไม่มีทางเข้าถึง = บั๊กที่ยังไม่ถูกนับ"*)
> **ชั้นเดียวที่จับได้คือ `npm run test:tenant`** ที่ยิง Supabase จริง

#### บั๊กที่เจอเพิ่มระหว่างซ่อม (เจอเพราะทางเดินถูกเปิดครั้งแรก)

1. **ของไปลงผิดกิจการ** — `fn_receive_material` insert `log_material` โดยไม่ระบุ `entity_id`
   → ตกไปที่ default `my_default_entity()` = **กิจการหลักเสมอ** แม้บิลจะลงกิจการที่ 2
   · ตระกูลเดียวกับบั๊ก `apply_stock_delta` ที่ 0029 แก้ไปแล้ว:
   **เอา entity จาก "แถว/เอกสาร" ไม่ใช่จาก "คนที่ล็อกอิน"**
   → เพิ่มพารามิเตอร์ `p_entity` (🪤 พารามิเตอร์เพิ่ม = ต้อง `drop function` ก่อน
   ไม่งั้นได้ overload ตัวที่ 2 — บทเรียนเดิมจาก D69)
   · master วัตถุดิบอยู่คนละกิจการ → **แจ้งคนละข้อความกับ "สะกดผิด"** ไม่งั้นผู้ใช้ไล่หาผิดทาง
2. **แถวที่กรอกแต่ราคา ไม่กรอกชื่อ ล้ม forward ทั้งใบ** — `buildItemInputs` ปล่อยแถว
   `itemName || exVat` ผ่านมา → ชื่อว่าง 1 แถวทำให้ทั้งบิลไม่ได้รับวัตถุดิบ · กรองชื่อว่างทิ้งก่อนส่ง
3. **warning ขึ้นเป็นสีเขียว** — `setMsg({ ok: true, text: warning })` ทำให้ข้อความ
   *"บันทึกบัญชีสำเร็จ แต่รับวัตถุดิบเข้าสต็อกผลิตไม่ได้"* หน้าตาเหมือนสำเร็จทุกประการ
   → เพิ่มระดับ `warn` (เหลือง) ใน `Msg`/`useSaver`
   · 🚨 **บันทึกได้บางส่วน ≠ สำเร็จ** ห้ามใช้สีเดียวกันเด็ดขาด
4. **`fn_mig_truncate` ตก `log_ferment_draw` (0045) และ `snapshots` (0018)** — ทั้งคู่มี FK
   มาที่ `tenants` แบบไม่ cascade → **ลบ/รีเซ็ตลูกค้าล้มทันที**
   · `log_ferment_draw` เจอจริงตอนรันเทสรอบนี้ · `snapshots` เป็นระเบิดเวลาแบบเดียวกัน
   ที่รอให้ลูกค้าเคยกด "สำรองข้อมูล" สักครั้งก่อนถึงจะระเบิด
   · `SNAPSHOT_ORDER` และ `backup-tables` ก็ตก `log_ferment_draw` เหมือนกัน
   = **สำรอง/ย้อนข้อมูลแล้วข้อมูลสุราแช่หายเงียบ ๆ ไม่มี error**

#### กันพลาดซ้ำ: รายชื่อตารางมีแหล่งเดียว + เทสไล่ให้

รายชื่อ "ตารางที่มี `tenant_id`" ถูกก๊อปไว้ 4 ที่ (`fn_mig_truncate` ใน SQL · `SNAPSHOT_ORDER` ·
`backup-tables` · `TENANT_TABLES` ของ harness) และ **พลาดมาแล้ว 3 รอบติด**
(D67 ลืม `pay_*` · D69 ลืม `pay_variables`/`pay_post_legs` · D78 ลืม `log_ferment_draw`)
— จดกับดักไว้ใน DECISIONS ทั้ง 2 รอบแล้วก็ยังพลาดรอบที่ 3

→ `lib/shared/tenantTables.ts` เป็นแหล่งเดียว + `tenantTables.test.ts` **อ่านอีก 4 ที่เป็นข้อความ**
มาเทียบ (รวม **ไฟล์ SQL** ด้วย — ชั้นที่ unit test ปกติมองไม่เห็น) · เพิ่มตารางใหม่แล้วลืม
= `npm run test` แดงทันที ไม่ต้องพึ่งความจำอีก

#### ที่ไม่ได้แก้ (ตั้งใจ)

- **หมวดหมู่ที่จุดชนวนยังฮาร์ดโค้ดว่า `"ต้นทุนสุรา"`** — ผังบัญชีจริงของผู้ใช้ใช้คำว่า
  `"ค่าต้นทุนสินค้า"` และไม่มี `"ต้นทุนสุรา"` ในลิสต์หมวดหมู่รายจ่ายเลย (แอปแอบเติมเป็น
  ตัวเลือกใน `<datalist>` ให้พิมพ์เลือกได้) → **รอผู้ใช้ตัดสิน** ว่าจะเติมหมวดนี้เข้าลิสต์
  หรือให้ตั้งค่าได้ว่าหมวดไหนเป็นตัวจุดชนวน · เดาแทนไม่ได้ เพราะกระทบทุก tenant
- **`fn_save_installments` ยัง forward ไม่ได้** — ซื้อวัตถุดิบแบบแบ่งงวดต้องบันทึกรับ
  ในแอปผลิตเอง (ฝั่ง UI ก็ไม่ได้ส่งธงมาด้วย) — เหมือนเดิม ไม่ได้ถอยหลัง

**ไฟล์หลัก**: migration `0046` · `lib/shared/tenantTables.ts` (+เทส) · `lib/shared/ui.tsx`
(`UiMsg` + `Msg` ระดับ warn) · `app/(app)/accounting/_components/EntryTab.tsx` ·
`lib/snapshot/engine.ts` · `scripts/backup-tables.ts` ·
`tests/tenant/forward-material.test.ts` (ใหม่ · 5 เทส) · ชุดเทส `docs/TESTING.md` ส่วนที่ 37
· build/lint/test **598** + `test:tenant` **134** ผ่าน

---

### D80 — บั๊กที่เจอจากการ "ใช้แอปจริงแบบลูกค้าใหม่" ในเบราว์เซอร์ (0047, 2026-08-25)

**ที่มา**: ผู้ใช้ให้ไล่ใช้แอปตั้งแต่ตั้งค่าจนจบทุกลูปในเบราว์เซอร์จริง — วิธีเดียวกับที่ผู้ใช้เจอ D79 เอง
เจอเพิ่ม 7 ข้อ **โดยที่ build/lint/test เดิมผ่านหมด 100%** ทุกข้อ

> 🪤 บทเรียนรวบยอดของรอบนี้: **ชั้นที่เทสอัตโนมัติมองไม่เห็นมี 2 ชั้น** — ตรรกะที่อยู่ใน DB (D79)
> และ *ช่องว่างระหว่างสิ่งที่ระบบทำได้กับสิ่งที่ผู้ใช้กดถึง* (D74/D77/D80) · ทั้งสองชั้นต้องมีคนใช้จริงถึงเจอ

---

#### A1 · ชื่อพนักงานบนเอกสารยื่นราชการเป็นชื่อเก่า

**อาการ**: ใบแนบ ภ.ง.ด.1 แถวแรกพิมพ์ `นายรัง` คู่กับเลขบัตร `1-0303-00492-83-7` ซึ่งเป็นของ
`นายอำนวย ตระกูลทุม` → **ชื่อกับเลขประจำตัวเป็นคนละคนบนแบบที่ยื่นสรรพากร**

**สาเหตุ**: อ่าน `payroll_items.emp_name` (snapshot) ก่อนชื่อปัจจุบัน = สลับข้างจากกติกา D75
(*"ชื่อ = ค่าปัจจุบันเสมอ · ตัวเงิน = ค่าที่แช่ไว้เสมอ"*) · D69 เขียนก่อน D75 กติกาใหม่จึงกวาดไม่ถึง
· กระจายอยู่ 5 จุด: `pnd1Rows` · `sso110Rows` · `pnd1kRows` · 50ทวิ ใน `FilingTab` ·
`getPayrollReportSource` (ตัวหลังไม่ join `employees` เลย = ไม่มีชื่อปัจจุบันให้ใช้ด้วยซ้ำ)

**แก้**: `empDisplayName(emps, empId, snapshot)` ตัวเดียวใน `lib/payroll/filings.ts` — ทะเบียน > snapshot > ว่าง
· เหตุผลเดียวกับที่ D75 ดึง `periodView.ts` ออกมา: กฎนี้พลาดแล้ว 2 รอบเพราะกระจายหลายที่

- 🪤 **ข้อยกเว้นเดียว — 50ทวิ ที่ออกไปแล้ว** ใช้ `wht_certificates.contact_name` (ชื่อ ณ วันออก)
  ใบนั้นอยู่ในมือพนักงานจริง พิมพ์ซ้ำต้องได้ข้อความเดิมเป๊ะ ไม่งั้นเอกสารเลขเดียวกันชื่อไม่ตรงกัน 2 ใบ
- 🚨 **เทสเดิมล็อกพฤติกรรมผิดไว้**: `filings.test.ts` มีเคส *"เปลี่ยนนามสกุลกลางปี → ใช้ชื่อล่าสุด"*
  ที่ยืนยันว่า snapshot ล่าสุดชนะ — คอมเมนต์ในโค้ดเจตนาถูก (*"เอกสารสิ้นปีควรเป็นชื่อปัจจุบัน"*)
  แต่หยิบผิดตัว · แก้เทสให้ยืนยันว่าทะเบียนชนะ + เพิ่มเคส "พนักงานถูกลบ → ตกไปใช้ snapshot"

#### A2 · ข้อมูลหลักแก้ได้โดยไม่มีประวัติ + `edit_log` ไม่มีที่ให้ดู

**สองครึ่งที่ต้องมาคู่กัน** — ลง trigger อย่างเดียวได้ข้อมูลที่เปิดดูไม่ได้ = สร้างบั๊ก D74/D77 ขึ้นมาเอง

1. **ไม่มี trigger บน master**: `products` (ตัวตัดสินว่าออกฟอร์ม ภส. ใบไหน + ตัวคูณปริมาตร) ·
   `entities` (เลขภาษี/เลขสรรพสามิตบนหัวเอกสารราชการ) · `materials`/`containers`/`contacts`/`bank_accounts`
   → เพิ่ม trigger ครบ + คอนฟิกเงินเดือน (`pay_rates`/`pay_inputs`/`pay_variables`/`pay_post_legs`)
   ซึ่งเปลี่ยนตัวเงินที่จ่ายจริง
2. **`edit_log` ไม่มีทางดูจากแอปเลยแม้แต่หน้าเดียว** — ถูกอ้างถึงแค่ในข้อความบนจอ
   (หน้าแก้บิลเขียนว่า *"การแก้จะถูกบันทึกใน edit_log"*) = **บอกว่าเก็บไว้ แต่ไม่บอกว่าดูที่ไหน**
   ข้อมูลที่สะสมอยู่แล้ว ~2,200 แถวเปิดได้ทางเดียวคือ Supabase dashboard
   → หน้าใหม่ **ตั้งค่า → ประวัติการแก้ไข** (RLS `edit_log_sel` = main + กรอง tenant มีอยู่แล้วตั้งแต่ 0028)

- 🚨 **ห้ามผูก audit กับ `app_settings`** — เก็บ `line_channel_token` อยู่ ผูกแล้วค่าลับถูกก๊อปลง edit_log
  ซึ่งเป็นคนละชั้นสิทธิ์กับที่ 0033 ตั้งใจกันไว้ (มีเทสยืนยันว่าต้องไม่มีแถว)
- 🪤 **`trg_audit` ต้องเอา tenant จากแถวเอง** (`rec ->> 'tenant_id'`) ไม่ใช่พึ่ง default `my_tenant()`
  ของ `edit_log` — ไม่งั้นพอผูกกับ `entities` แล้ว `provision:tenant` (service role, ไม่มี `auth.uid()`)
  **ล้มทันทีที่ insert entities** = รับลูกค้าใหม่ไม่ได้เลย · ตระกูลเดียวกับ D50 / `apply_stock_delta` (0029)
  · ไม่มี tenant ให้ผูก → ข้าม audit แทนที่จะทำให้งานหลักล้ม
- **หน้าประวัติ = ดูอย่างเดียว + คัดลอกค่าเก่า** (ผู้ใช้เลือกเอง) · 🚨 **ไม่มีปุ่มเขียนทับ DB โดยตั้งใจ**
  กดผิดคือทับข้อมูลจริง และต้องคิดเรื่อง FK/trigger/สต็อกครบทุกตาราง — ย้อนของจริงใช้ snapshot
- 🚨 **ห้ามเทดัมพ์ JSON ดิบลงจอ** — ผู้ใช้อ่านโค้ดไม่ได้ และแถว `transactions` มี ~28 คอลัมน์
  → `changedFields()` โชว์เฉพาะช่องที่ต่างจริง พร้อมชื่อไทย · `rawBefore()` คืน**ค่าดิบ** ให้ปุ่มคัดลอก
  (ก๊อป `—` หรือ `ใช่` ไปวางในช่องกรอกไม่ได้)
- `AUDITED_TABLES` ใน `lib/shared/tenantTables.ts` + เทส**ไล่อ่าน `create trigger audit_…` จากไฟล์ SQL**
  มาเทียบ — เพิ่ม trigger แล้วลืมเติมลิสต์ = ผู้ใช้กรองหาไม่เจอทั้งที่ระบบบันทึกไว้

**ไฟล์หลัก**: migration `0047` · `lib/payroll/filings.ts` (`empDisplayName`) · `app/(app)/payroll/data.ts` ·
`FilingTab.tsx` · `lib/shared/editLog.ts` (+เทส 11) · `lib/shared/tenantTables.ts` (`TABLE_LABEL_TH`/`AUDITED_TABLES`) ·
`app/(app)/settings/history/page.tsx` + `_components/HistoryCard.tsx` · `tests/tenant/audit-master.test.ts` (ใหม่ 5 เทส)
· build/lint/test **616** + `test:tenant` **139** ผ่าน

#### B1 · ไม่มีหน้าจอตั้ง "กิจการ/บัญชีที่รับรายได้ขาย" → ลูกค้าใหม่ปิดการขายใบแรกไม่ได้

**อาการ**: กด *รับมัดจำ & ส่งคลัง* แล้วตัน — *"ยังไม่ได้ตั้งค่ากิจการรับรายได้ขาย
(app_settings sales_revenue_entity) — ดู GOLIVE_CHECKLIST Phase 4"*

**สาเหตุ**: ไล่โค้ดแล้ว **ไม่มีที่ไหนเขียน `sales_revenue_entity` / `sales_revenue_account` เลยสักจุด**
ทั้งระบบ — ตั้งได้ทางเดียวคือยิง SQL · และข้อความ error ยังชี้ให้ไปเปิด**ไฟล์เอกสาร**
แทนที่จะบอกว่ากดที่ไหน (ตระกูล D74/D77)

**แก้**: การ์ดที่ 3 ในหน้า **ตั้งค่า → กิจการ** + `saveSalesRevenueAction`
· บัญชีเป็น**ดร็อปดาวน์จาก `bank_accounts`** ไม่ให้พิมพ์เอง (ชื่อต้องตรงเป๊ะ ฝั่งขายเขียนลง
`transactions.account_name` ตรง ๆ) · กิจการเดียว = เลือกให้เลย (หลัก D53)
· 🪤 **แยก action ออกจาก `saveDocEntityAction` เด็ดขาด** — "กิจการที่ออกเอกสาร" กับ
"กิจการที่รับเงิน" คนละเรื่อง รวมเป็นดร็อปดาวน์เดียวเมื่อไหร่ = แก้อันหนึ่งอีกอันย้ายตามเงียบ ๆ (D63)
· ข้อความ error ฝั่งขายชี้มาที่การ์ดนี้แล้ว

#### B2 · หมวดหมู่ที่จุดชนวน "รับวัตถุดิบเข้าสต็อกผลิต" ตั้งเองได้ (migration `0048`)

เดิมฮาร์ดโค้ด `"ต้นทุนสุรา"` แต่ผังบัญชีจริงของผู้ใช้ไม่มีคำนี้ (แอปแอบเติมเป็นตัวเลือกใน `<datalist>`
ให้พิมพ์เลือกได้) — หมวดที่ใช้จริงคือ `"ค่าต้นทุนสินค้า"` ซึ่งไม่จุดชนวนอะไรเลย

- app_settings kind ใหม่ `material_forward_cat` (หลายแถวได้) · **ค่าปริยาย `"วัตถุดิบผลิตสุรา"`**
  (ผู้ใช้เลือกเอง — เปลี่ยนจากของเดิม)
- **ไม่มีแถว = ใช้ค่าปริยายในโค้ด** (`lib/accounting/forwardCats.ts`) → ไม่ต้อง seed ให้ลูกค้าเดิม
  · เปลี่ยนค่าปริยายปลอดภัยเพราะเส้นทางนี้ไม่เคยทำงานสำเร็จเลยก่อน `0046` = ไม่มีข้อมูลเดิมที่พึ่งคำเดิม
- 🪤 **`app_settings.kind` เป็น CHECK whitelist** — เพิ่ม kind ในโค้ดอย่างเดียวไม่พอ ผู้ใช้กดเพิ่มแล้ว
  เด้ง *"ค่าที่กรอกไม่ถูกต้องตามที่ระบบกำหนด"* (เจอจริงตอนเทส) → ต้องมี migration และ
  **ยกรายชื่อเดิมมาครบทุกตัว** เพราะ constraint เขียนทับทั้งก้อน
- 🚨 **บั๊กที่เกิดระหว่างแก้เอง แล้วจับได้ตอนเทส**: ตอนแรกส่ง "ค่าที่มีผลจริง" (ที่เติมค่าปริยายแล้ว)
  เข้า ChipList → หน้าจอโชว์ `วัตถุดิบผลิตสุรา` เป็น chip เหมือนบันทึกไว้แล้ว
  พอผู้ใช้ **เพิ่มหมวดที่ 2** ระบบมีแถวจริง 1 แถว → ค่าปริยาย**หลุดทันทีโดยไม่มีอะไรฟ้อง**
  ทั้งที่ chip ยังอยู่บนจอ · ตระกูลเดียวกับ D74 (*ฟอร์มเปิดมาพร้อมค่าที่ยังไม่ได้บันทึก*)
  → แยก `forwardCatsSet` (ที่ตั้งเอง) ออกจาก `forwardCats` (ที่มีผล) · ว่าง = ขึ้นข้อความเหลือง
  *"ยังไม่ได้ตั้ง — ระบบใช้ … ให้ก่อน · เพิ่มเองแล้วจะใช้เฉพาะที่เพิ่ม"*
  🪤 **ค่าปริยายที่คำนวณในโค้ด ห้ามแสดงปนกับค่าที่ผู้ใช้บันทึกไว้จริงในช่องที่แก้ได้**

**ไฟล์หลัก**: migration `0048` · `lib/accounting/forwardCats.ts` (+เทส 4) ·
`app/(app)/settings/actions.ts` + `settings-data.ts` + `_components/CompanyCard.tsx` ·
`app/(app)/accounting/data.ts` + `_components/{EntryTab,BillsTab,SettingsTab}.tsx` · `app/(app)/sales/actions.ts`
· build/lint/test **620** ผ่าน

#### C1 · ขนาดขวดกรอกเป็นมิลลิลิตรได้เงียบ ๆ → ปริมาตรบนฟอร์ม ภส. ผิดพันเท่า

คอลัมน์เขียนว่า **ขนาดขวด (ล.)** อยู่แล้ว แต่คนคิดเป็น "330 มล." เป็นธรรมชาติ · ระบบรับ `330` ไปตรง ๆ
แล้ว **ภส.๐๗-๐๒/๑(๒) คิดลิตร = จำนวนขวด × ขนาดขวด** → บรรจุ 113 ขวด รายงาน **37,290 ลิตร**
แทน 79.1 ลิตร บนเอกสารที่ยื่นสรรพสามิต

**ผู้ใช้ตัดสิน: เตือนอย่างเดียว ไม่แปลงค่าให้** — แปลงอัตโนมัติเสี่ยงกว่า (ถังใหญ่ 20 ล. จะโดนหารด้วย)
และการไม่แตะค่าที่ผู้ใช้กรอก = ไม่มีทางแปลงผิดให้เงียบ ๆ

- `bottleSizeWarn()` เตือนเมื่อ > 5 (ไม่มีขวดขายปลีกใหญ่กว่านี้) · ข้อความบอกตัวเลขจริงและค่าที่ควรกรอก
- โชว์ทั้งตอนเพิ่ม · ตอนแก้ · **และบนแถวที่ยังไม่ได้กดแก้** — ไม่งั้นของเดิมที่ผิดอยู่แล้วจะไม่มีวันถูกเห็น
- แถบเตือนรวมในแท็บ **รายงานสรรพสามิต** ด้วย เพราะที่นั่นคือจุดที่เลขผิดกลายเป็นเอกสารจริง
- `Field.warn?: (v) => string | null` ใน `MasterTab` — เป็น hook กลาง เตือนช่องอื่นได้ในอนาคต

#### C2 · แท็บ "กลั่น" ยอมให้เลือก batch ของสุราแช่

ปิด batch ได้จริงด้วย → ได้แถวใน `log_distill` ของสินค้าสุราแช่ = ยอดไปโผล่ในฟอร์ม
**บัญชีผลิตสุรากลั่น** ผิดใบ โดยไม่มีอะไรเตือน (ฝั่งแท็บ "รินน้ำสุราแช่" กรองถูกอยู่แล้วตั้งแต่ D78
— ขาดแค่ด้านนี้ ทำให้สองข้างไม่สมมาตร)

- ติดธง `fermented` ต่อ batch ใน `getPendingBatches` (map ชื่อสุรา → `products.liquor_type`
  ด้วย `isFermented()` — วิธีเดียวกับ `getBatchBoard`) แล้ว **กรองที่ `DistillTab`**
- 🪤 **ห้ามกรองใน `getPendingBatches` ตรง ๆ** — ฟังก์ชันนี้ใช้ร่วมกับแท็บ **ติดตามหมัก**
  (คอมเมนต์ในไฟล์บอกไว้: *"ใช้หน้ากลั่น/monitor"*) และ batch สุราแช่ก็ต้องวัด pH/Brix ได้
- 🪤 `liquor_type` **ว่าง = ไม่ซ่อน** — การซ่อนก็เป็นการเดาเหมือนกัน ปล่อยให้แถบเตือนแดงในแท็บ
  รายงานสรรพสามิต (D78) จัดการ

#### C3 · คอลัมน์ Yield ขึ้น "—" ตลอดกาล

คอลัมน์ `log_distill_run.ferm_charge` มี · `startDistillRunAction` **รับพารามิเตอร์ `fermCharge`
และเขียนลงแถว "เริ่มกลั่น" อยู่แล้ว** · `distillSummary` อ่านค่านี้ · golden test มี
— **แต่หน้าจอไม่เคยส่งค่านี้เลยสักครั้ง** (grep เจอ 0 ครั้งใน `DistillTab`) ตระกูล D74/D77 อีกตัว

- เพิ่มช่อง **"น้ำหมักที่เข้าหม้อ (ล.) — ไม่บังคับ"** ไว้ **คู่ปุ่ม "+ เริ่มหม้อใหม่"**
  ★ ไม่ใช่ในฟอร์มบันทึกค่า เพราะแถว "เริ่มกลั่น" ถูกสร้างตอนกดปุ่มนั้น และเป็นจังหวะที่ผู้ใช้
  รู้ปริมาณน้ำหมักที่เทเข้าหม้อพอดี
- โชว์คอลัมน์ "น้ำหมักเข้าหม้อ" ในตารางค่าที่บันทึก (จะได้เห็นว่ากรอกไปแล้วหรือยัง)
- ไม่กรอกก็กลั่นได้ตามปกติ — แค่ Yield ว่าง (บอกไว้ใต้ช่อง)

**ไฟล์หลัก**: `app/(app)/production/_components/{MasterTab,ExciseTab,DistillTab}.tsx` ·
`app/(app)/production/data.ts` (`getPendingBatches` ติดธง `fermented`) · `_components/types.ts`
· build/lint/test **620** ผ่าน

---

### D81 — เอกสารยื่นราชการนับงวดร่างเข้าไปด้วย ทั้งที่หน้าจอเขียนว่าไม่นับ (2026-08-25)

**ที่มา**: เทสในเบราว์เซอร์ด้วยสกิล `/browser-qa` — เจอบนหน้าเดียวกันว่า **คำกำกับประกาศกฎหนึ่ง
แต่โค้ดทำอีกอย่าง** · บรรทัดใต้ช่องเลือกเอกสารเขียนว่า *"ตัวเลขมาจากงวดที่ กดคำนวณ & บันทึกแล้ว
เท่านั้น — **งวดร่างยังไม่นับ**"* แต่ `getFilingYear`/`getFilingPeriod` ดึง `payroll_items`
ด้วย `.like("period_id", …)` เฉย ๆ **ไม่มีเงื่อนไขสถานะงวดเลยสักบรรทัด**

หลักฐานจาก tenant ทดสอบ:

| งวด | สถานะ | คน | เงินได้ | ภาษี |
|---|---|---|---|---|
| PR-2026-01 | **draft** | 8 | 217,049 | 1,685 |
| PR-2026-02 | **draft** | 8 | 226,838 | 1,685 |
| PR-2026-03 | **draft** | 8 | 226,424 | 1,685 |
| PR-2026-08 | posted | 9 | 254,860 | 3,270 |
| **รวมทุกงวด** | | | **925,171** | **8,325** |

หน้า ภ.ง.ด.1ก แสดง **925,171 / 8,325** เป๊ะ = **งวดร่าง 3 งวดคิดเป็น 72% ของยอดทั้งปี**
· เลือกงวดร่างออกใบแนบ ภ.ง.ด.1 รายเดือนได้เต็มใบด้วย · ใบ 50ทวิ ที่ยื่นให้ลูกจ้างก็ใช้ยอดชุดเดียวกัน

> 🪤 ตระกูล D73/D75 — **อาการไม่ใช่สูตรผิด แต่เป็นการเลือกชุดข้อมูลผิด**
> สูตรทุกตัวใน `filings.ts` ถูกหมด · golden test 28 ตัวผ่านหมดมาตลอด · build/lint/test ไม่มีทางจับได้
> เพราะฟังก์ชันบริสุทธิ์ได้ input อะไรมาก็คิดถูกตาม — **คนที่เลือก input คือ `data.ts` ซึ่งไม่มีเทสคุม**

**แก้**: กฎอยู่ที่เดียวใน `lib/payroll/filings.ts` — `countsForFiling(status)` + `keepFiledItems()`
เรียกจาก 3 ที่ (server รายเดือน · server รายปี · ดร็อปดาวน์บนจอ) แบบเดียวกับ `periodView.ts` (D75)
และ `empDisplayName()` (D80) — กฎที่พลาดแล้วต้องถูกดึงออกมาเป็นฟังก์ชันพร้อมเทส

- 🚨 **`draft` ไม่นับ** — `post_state = {}` = ยังไม่ลงบัญชีสักขา = ยังไม่เกิดการจ่ายจริง
- 🪤 **`partial` ต้องนับ (ผู้ใช้เคาะ)** — ลงยอดสุทธิแล้วแต่ยังไม่ลงขา WHT คือสภาพปกติของคน
  *ที่กำลังจะยื่น* ภ.ง.ด.1 · ตัดออกเมื่อไหร่ = งวดที่จ่ายเงินให้ลูกจ้างไปแล้วจริงหายจาก
  **แบบที่ใช้นำส่งภาษีของงวดนั้นเอง** ซึ่งผิดหนักกว่าบั๊กที่ตั้งใจจะแก้
- 🚨 **ห้ามข้ามงวดเงียบ ๆ** → `<DraftNote>` แถบเหลืองบอกจำนวน+ชื่อเดือนที่ข้าม · ไม่งั้นผู้ใช้เห็น
  ยอดปีในแท็บ **รายงาน** (นับทุกงวดที่บันทึกไว้) ไม่ตรงกับแท็บ **เอกสารยื่น** แล้วไล่หาสาเหตุไม่เจอ
  (บทเรียน D75: ต่างกันได้ แต่ต้องบอกว่าอันไหนคืออันไหน)
- **แท็บรายงานไม่แตะ** — คำกำกับของมันถูกอยู่แล้ว (*"งวดร่างที่ยังไม่บันทึกจะไม่โผล่"*)
  และเป็นรายงานภายในที่ควรเห็นงวดร่าง
- **ใบ 50ทวิ คิดใหม่ทุกแถว (ผู้ใช้เคาะ)** — ตอนตัดสินใจ `wht_certificates` ยังว่างทั้ง tenant
  จึงไม่มีใบจริงได้รับผลกระทบ · ถ้าอนาคตมีใบที่ออกก่อนแก้บั๊กนี้ ยอดบนจอกับกระดาษจะต่างกัน
  ข้อมูลเดิมยังอยู่ครบใน `wht_certificates.base_amount` ถ้าจะโชว์เทียบทีหลัง
- ด่านกันที่ `getFilingPeriod` คืน `items: []` แต่**ยังคืน `period`** เพื่อให้จอบอกเหตุผลได้

#### 🔴 เจอเพิ่มระหว่างเทส — เอกสารรายเดือนใช้ข้อมูล**ทั้งปี**ชั่วขณะ

สลับชนิดเอกสารจากรายปี (ภ.ง.ด.1ก / 50ทวิ) กลับรายเดือน → React ฟ้อง duplicate key
`EMP-0002`…`EMP-0009` ครบทุกคนที่มีหลายงวด (ไม่ฟ้อง `EMP-0001` เพราะมีงวดเดียว จึงไม่ซ้ำ)
= ใบแนบ ภ.ง.ด.1 ของเดือนเดียวถูก render ด้วย **33 แถวของทั้งปี** อยู่ 1 เฟรม · **ทำซ้ำได้ 100%**

**สาเหตุ**: `setLoading(true)` อยู่**ข้างใน** `load()` ซึ่งถูกเรียกจาก `useEffect` = *หลัง* render
ที่ `doc` เปลี่ยนไปแล้ว → เฟรมนั้น `doc` เป็นรายเดือนแต่ `items` ยังเป็นชุดทั้งปี

**แก้**: `loadedKey` ที่ถูกเซ็ต**พร้อมข้อมูล** แล้ว gate ด้วย `ready = !loading && loadedKey === key`
🪤 **กันทั้งคลาส** — ผูก *ข้อมูล* กับ *ข้อมูลนี้เป็นของอะไร* ไว้ด้วยกัน เช็ค `loading` อย่างเดียวไม่พอ
· ความเสี่ยงจริงคือกด **คัดลอกตาราง / พิมพ์ PDF** ในจังหวะนั้น = ได้เอกสารยื่นที่ยอดผิด

**ไฟล์หลัก**: `lib/payroll/filings.ts` (`countsForFiling` · `keepFiledItems` · +เทส 9) ·
`app/(app)/payroll/data.ts` (`getFilingPeriod` · `getFilingYear` +`draftPeriodIds`) ·
`_components/FilingTab.tsx` (ดร็อปดาวน์ · คำกำกับ · `<DraftNote>` · `ready`)
· **ไม่มี migration** · ไม่แตะชั้นสูตร — **golden test เดิม 28 ตัวผ่านโดยไม่แก้ไฟล์เทส**
· build/lint/test **629** ผ่าน · ชุดเทส `docs/TESTING.md` ส่วนที่ 39

---

### D82 — เลิก snapshot ในแอป เปลี่ยนเป็นดาวน์โหลดเก็บเอง (0049, 2026-08-25)

**ที่มา**: ผู้ใช้ถามว่า *"snapshot แล้วย้อนข้อมูล จะกระทบลูกค้าคนอื่นไหม หรือแยกเจ้าใครเจ้ามัน"*
→ ไล่โค้ดแล้วพบว่า **ฝั่งข้อมูลแยกครบทุกบรรทัด** (dump/restore/truncate/recompute มี `tenant_id`
ทุกจุด · `tenantId` มาจาก session ไคลเอนต์ปลอมไม่ได้ · `fn_mig_truncate` ถึงกับ raise exception
ถ้าไม่ส่ง tenant) **แต่มีผลข้างเคียง 1 อย่างที่กระทบข้ามลูกค้าจริง**

🚨 `restoreSnapshot()` เรียก **`fn_mig_set_triggers(false)`** ซึ่ง **ไม่มีพารามิเตอร์ tenant**
เพราะ Postgres สั่ง `alter table … disable trigger` ได้ระดับ**ตาราง**เท่านั้น
→ ปิด trigger 9 ตาราง **ทั้งฐานข้อมูล กระทบทุกลูกค้าที่อยู่ก้อนเดียวกัน**:

1. `edit_log` ของเจ้าอื่นไม่บันทึก — แก้อะไรตอนนั้นไม่เหลือร่องรอย
2. 🔴 **stock trigger ไม่ทำงาน** → เจ้าอื่นบันทึกบรรจุ/จ่ายตอนนั้น `stock_product` ไม่ขยับ
   และ**ไม่มีอะไรมาคำนวณให้ทีหลัง** (recompute ยิงเฉพาะ tenant ที่กดย้อน)
   = **สต็อกผิดถาวรเงียบ ๆ** แล้วไปโผล่บนฟอร์ม ภส.
3. process ตายกลางทาง (Vercel timeout / lambda kill) → `try/finally` ช่วยเฉพาะตอน throw ปกติ
   **ถ้าโดน kill trigger ค้างปิดทั้ง DB ตลอดไป**

> 🪤 **บทเรียนของรอบนี้: โค้ดขัดกับกติกาที่ตัวเองเขียนไว้**
> comment ของ `fn_mig_set_triggers` ใน `0029` เขียนกำกับเองว่า *"ใช้ตอน provision ลูกค้าใหม่
> เท่านั้น **ห้ามรันบนระบบที่มีคนใช้อยู่**"* — แต่ restore คือ**ปุ่มที่ลูกค้ากดเองได้ตลอดเวลา**
> · เขียนคำเตือนไว้ข้างฟังก์ชันไม่พอ ต้องดูด้วยว่า *ใครเรียกมันได้บ้าง*

**ผู้ใช้ตัดสิน: ตัดระบบ snapshot ในแอปทิ้งทั้งก้อน** เปลี่ยนเป็นปุ่มดาวน์โหลดให้ลูกค้าเก็บไฟล์เอง

| เรื่อง | เคาะว่า |
|---|---|
| ทางกลับเมื่อลูกค้าทำข้อมูลพัง | **ผ่านเรา** — ลูกค้าส่งไฟล์มา เจ้าของรัน `npm run restore:tenant` · ปุ่มอันตรายไม่อยู่ในมือลูกค้า |
| รูปแบบไฟล์ | **2 ปุ่มแยกกัน** — `.json` (ครบทุกตัวอักษร ใช้ย้อนได้จริง) · `.xlsx` (เปิด Excel อ่าน/ส่งบัญชี) |
| ตาราง `snapshots` | **drop ทิ้ง** — ของเก่า 2 ก้อนใน DB เจ้าของ (`start`/`allset` ก.ค.) ไม่เอาแล้ว |

- ★ **ผลพลอยได้**: หลังลบ `engine.ts` ผู้เรียก `fn_mig_set_triggers` ที่เหลือมี**ที่เดียว**คือ
  `migration/import-csv.ts` ซึ่งรันตอน cutover บนระบบเปล่า = ตรงตามกติกาที่เขียนไว้พอดี
  (จึง**เก็บฟังก์ชันไว้** ไม่ต้อง drop) · และเลิกเก็บ payload เป็น jsonb ใน DB = คืนโควตาแผนฟรี
- 🚨 **กับดักที่เกือบพลาด**: `fn_mig_truncate` **มี `'snapshots'` อยู่ในลิสต์** (0046) —
  drop ตารางแล้วไม่แก้ = `delete from snapshots` พังทันที = **ลบ/รีเซ็ตลูกค้าไม่ได้เลย**
  ตระกูล D79 เป๊ะ ๆ · `tenantTables.test.ts` ที่ไล่อ่าน SQL มาเทียบคือชั้นที่จับได้
- 🚨 **สคริปต์ restore ห้ามแตะ `fn_mig_set_triggers`** — นั่นคือสิ่งที่งานนี้ตั้งใจกำจัด
  ปล่อย trigger ทำงานปกติ · สต็อกยังถูกเพราะเรียก `fn_mig_recompute_stock` ปิดท้าย
  · `edit_log` จะมีแถวเพิ่มจากการ restore ซึ่ง**ควรมี** (ย้อนข้อมูลทั้งระบบคือเหตุการณ์ที่ต้อง audit ที่สุด)
- 🚨 **ไฟล์ต้องผูก `tenant.id` + `slug`** — สคริปต์ปฏิเสธเองถ้าเอาไฟล์ลูกค้า A ไปลงลูกค้า B
  (ต้อง `--tenant=<uuid>` ยืนยันเจตนาถึงจะข้ามได้) · dry-run เป็นค่าปริยาย ต้อง `--apply` ถึงลงจริง (แบบ D57)
- 🪤 **PostgREST คืนแค่ 1000 แถวเงียบ ๆ** — action ต้องวน `.range()` เหมือน `backup-tables.ts`
  ไฟล์สำรองที่ขาดแถวคือไฟล์ที่ *ดูเหมือนใช้ได้* จนถึงวันที่ต้องใช้จริง
- 🚨 **Excel กินศูนย์นำหน้า** — `tax_id`/`national_id`/`excise_id`/`sso_no` ต้องบังคับเป็นข้อความ
  ไม่งั้น `0105558123456` → `105558123456` หรือ `1.05559E+11` = เลขบนไฟล์ที่ส่งให้บัญชีผิด
  · คอลัมน์ jsonb ต้อง `JSON.stringify` ไม่ใช่ `[object Object]`
- 🔴 **`xlsx` ต้อง `await import()`** ในตัว handler — static import = ทุกคนที่เปิดหน้าตั้งค่าโหลด
  SheetJS ตาม (บทเรียนเดียวกับ pdf-lib ใน D61)
- 🪤 **`RESTORE_SKIP` ตัดเฉพาะตอนเอากลับ ไม่ใช่ตอนสำรอง** — `stock_product`/`profiles`
  ยังอยู่ในไฟล์ (ลูกค้าต้องได้ข้อมูลตัวเองครบ) แค่ไม่เขียนกลับเข้า DB
  (`stock_product` คำนวณใหม่ · `profiles` ผูก `auth.users` แตะแล้วเซสชันพัง) · มีเทสคุมทั้งสองด้าน
- 🚨 **ต้องบอกผู้ใช้ตรง ๆ บนจอ** ว่าไฟล์นี้กดกลับเองไม่ได้ + มีข้อมูลเงินเดือน/เลขบัตร ให้เก็บให้ดี
- 🔴 **เจอตอนเปิดไฟล์จริง**: `counters` · `integration_log` · `edit_log` **ไม่มีชื่อไทยใน `TABLE_LABEL_TH`**
  → 3 ชีตใน Excel ขึ้นชื่อตารางดิบให้ลูกค้าอ่าน ซึ่งผิดกฎที่เขียนไว้หัวบล็อกนั้นเอง
  (*"ผู้ใช้ไม่ได้เขียนโค้ด ห้ามโชว์ชื่อตารางดิบ ๆ"*) · ก่อน D82 ไม่เคยโผล่เพราะชื่อไทยใช้แค่ใน
  ดร็อปดาวน์หน้าประวัติการแก้ไข → เติมชื่อ + เทสไล่ว่า **ทุกตารางใน `EXPORT_TABLES` ต้องมีชื่อไทยและห้ามซ้ำ**
  — ไม่ใช่ปล่อยให้เดาเอาเองว่ายังย้อนได้เหมือนเดิม

#### 🔴 เจอเพิ่ม 2 ข้อ ตอนทดสอบทางกลับด้วยข้อมูลจริง (migration `0050`)

**1. `fn_mig_truncate` ลบ `entities` ก่อน `report_runs` → ลบ/รีเซ็ต/ย้อนข้อมูลล้มทันที**

```
rpc fn_mig_truncate: update or delete on table "entities" violates
foreign key constraint "report_runs_entity_id_fkey" on table "report_runs"
```

`report_runs.entity_id` ผูก FK ไป `entities` ตั้งแต่ `0027` แต่ในลิสต์ของ `fn_mig_truncate`
มันอยู่**หลัง** `'entities'` = ลบแม่ก่อนลูก · **บั๊กนี้มีมาตั้งแต่ `0029` ก๊อปต่อถึง `0046`/`0049`**

- 🔴 ผลจริง: **ลบ/รีเซ็ตลูกค้าจากหน้าแอดมินไม่ได้เลย ถ้าลูกค้ารายนั้นเคยกดออกฟอร์ม ภส. สักครั้ง**
- 🪤 **ทำไม `test:tenant` ไม่จับ**: tenant ที่เทสสร้างขึ้นมาไม่เคยมีแถวใน `report_runs`
  → FK ไม่มีอะไรให้ละเมิด · เจอตอนเอาข้อมูลของ tenant จริงที่มี 7 แถวกลับ
- 🚨 **บทเรียน: ลิสต์ที่ "ครบ" ไม่ได้แปลว่า "เรียงถูก"** — `tenantTables.test.ts` เดิมตรวจแค่ว่า
  **ชื่อครบทุกตาราง** ไม่เคยตรวจ**ลำดับ** → เพิ่ม `ENTITY_SCOPED_TABLES` + เทสว่า
  ทุกตารางที่มี `entity_id` ต้องถูกลบก่อน `entities` (พิสูจน์แล้วว่าเทสนี้ฟ้อง `0049` และผ่าน `0050`)
- ★ plpgsql rollback ทั้งก้อน — ตอนล้มไม่มีข้อมูลเสียหายแม้แต่แถวเดียว (ตรวจแล้ว)

**2. เลขรันนิ่งเอกสาร "ถอยหลัง" หลัง restore**

`reseedIdCounters` (ยกมาจาก `engine.ts` เดิม) ตั้ง counter = **max ของข้อมูลที่เหลืออยู่** เฉย ๆ
→ ทดสอบจริงเห็น `TR-20260825` ถอย **5 → 1** และ `BANK_ACC` **2 → 1**

- 🚨 **เอกสารที่ออกไปหลังวันสำรอง (แล้วถูกล้างตอน restore) จะปล่อยเลขกลับมาให้ใช้ซ้ำ**
  = ใบกำกับภาษี/ใบเสร็จ **เลขเดียวกันสองใบคนละเนื้อหา** ซึ่งเป็นปัญหากับสรรพากรจริง
- แก้: อ่าน counter **ก่อน** `fn_mig_truncate` เก็บเป็น "พื้น" แล้วใช้ค่าสูงสุดของ 3 ทาง —
  ค่าก่อน restore · ค่าในไฟล์ · max จากข้อมูลที่ใส่กลับ
- 🪤 ครอบคีย์ที่คำนวณจากข้อมูลไม่ได้ด้วย (`EMP` · `INV-…` · `TAX-…`) ซึ่งเดิมพึ่งค่าในไฟล์อย่างเดียว
- ทดสอบแล้ว: ตั้ง `BANK_ACC=9` `EMP=15` `TR-20260825=7` ให้สูงกว่าไฟล์ → restore → **คงค่าเดิมทั้งสามตัว**

**ผลทดสอบทางกลับ (ข้อมูลจริงของ tenant `demoprov`)**

| ตรวจ | ผล |
|---|---|
| dry-run | เทียบจำนวนแถวครบ 38 ตาราง · **ไม่แตะ DB เลยสักแถว** ✓ |
| ลบบิล 1 ใบ + `log_dilute` + `log_product` แล้ว restore | ข้อมูล**กลับครบทุกตาราง**เท่าเดิมเป๊ะ ✓ |
| สต็อกหลัง restore | `TESTDISL` = 89 (113 − 24) · `TESTSHAREL` = 128 — `fn_mig_recompute_stock` ถูกต้อง ✓ |
| 🚨 **tenant อื่นในก้อนเดียวกัน** (`default`/`platform`/`rongkhor`/`rongkor`) | **ไม่ขยับสักแถว** ✓ ← เหตุผลทั้งหมดของงานนี้ |
| `edit_log` | 252 → 385 (+133 = จำนวนแถวของตารางที่มี audit trigger) — **ตั้งใจให้เป็นแบบนี้** |
| ไฟล์ผิดกิจการ / ไม่มี tenant / ไม่ใช่ไฟล์ระบบ | ปฏิเสธทั้ง 3 แบบ **ก่อนแตะ DB** ✓ |

**รอบที่ 2 — ทิศทางที่รอบแรกยังไม่ได้พิสูจน์: ของที่เกิด*หลัง*วันสำรอง ต้องหายไป**

> รอบแรกทดสอบแค่ "ลบของออก → restore → กลับมา" ซึ่งเป็นทิศทางตรงข้ามกับการใช้งานจริง
> (*ลูกค้าทำงานมา 3 วันแล้วพัง อยากย้อนกลับไปวันจันทร์*) · ถ้า truncate ลบไม่ครบ ผลคือ
> **ข้อมูลเก่ากับใหม่ปนกัน** ซึ่งแย่กว่าไม่ restore เลย และเงียบสนิท

| ตรวจ | ผล |
|---|---|
| สร้างชุดที่ 1 ผ่านแอปจริง (บิล+2 รายการ · batch+เบิกวัตถุดิบ) → **ผู้ใช้กดดาวน์โหลดเอง** | ไฟล์ 745.1 KB มีของชุดที่ 1 ครบทุกชิ้น ✓ |
| สร้างชุดที่ 2 เพิ่มหลังสำรอง แล้ว restore | **ชุดที่ 2 หายเกลี้ยงทั้งแถวแม่และแถวลูก** (บิล+รายการ · batch+การเบิก) ✓ |
| ชุดที่ 1 หลัง restore | อยู่ครบเป๊ะ ทั้งยอด ฿1,800 และรายการลูก 2 แถว ✓ |
| จำนวนแถวเทียบไฟล์ | ตรงทุกตาราง (ยกเว้น `stock_product`/`profiles`/`edit_log` ตามออกแบบ) ✓ |
| 🚨 เลขรันนิ่ง | `TR-20260825` **คงที่ 9** ทั้งที่ในไฟล์เป็น 8 = ไม่ถอย ✓ |
| tenant อื่น 4 เจ้า | ไม่ขยับสักแถว ✓ |

**ไฟล์หลัก**: migration `0049` (drop table) + `0050` (fix ลำดับ truncate) ·
**ลบ** `lib/snapshot/engine.ts` · `lib/export/tenantExport.ts` (+เทส 20) ·
`lib/shared/download.ts` (ยกออกจาก `ExciseTab`) · `app/(app)/settings/data/{actions.ts,_components/data-manager.tsx}` ·
`scripts/restore-tenant.ts` (npm `restore:tenant`) · `lib/shared/tenantTables.ts` (`snapshots` ออก · `SNAPSHOT_SKIP`→`RESTORE_SKIP`)
· `ENTITY_SCOPED_TABLES` + เทสลำดับ truncate · build/lint/test **656** + `test:tenant` **138** ผ่าน · **ผู้ใช้ดาวน์โหลดไฟล์จริงทั้ง 2 แบบแล้ว ตรวจผ่าน** (JSON 578.7 KB · XLSX 709.2 KB · 38 ตาราง 445 แถว ตรงกับ DB ทุกตาราง · เลขภาษี/เลขบัตรเป็น `type=s` ครบ) · ชุดเทส `docs/TESTING.md` ส่วนที่ 40

---

### D83 — ปุ่มที่ถูก disable ต้องบอกว่า "ยังขาดอะไร" (2026-08-26 · ไม่มี migration)

**อาการ**: ตอนเทสด้วย `/browser-qa` ติดที่ปุ่ม **ออกใบเสนอราคา (A4)** ซึ่งเทาอยู่เฉย ๆ
เงื่อนไขจริงคือ

```
disabled={pending || items.length === 0 || !selCustId || !saleName.trim()}
```

ขาดอย่างใดอย่างหนึ่งใน 3 อย่าง (ลูกค้า · รายการในตะกร้า · **ผู้เสนอราคา**) ปุ่มก็เทาเหมือนกันหมด
ช่อง "ผู้เสนอราคา" อยู่ล่างสุดของการ์ดตะกร้า ไม่มีดาว ไม่มีคำว่าจำเป็น → **ผู้ใช้ใหม่นึกว่าปุ่มเสีย**

🪤 **ตระกูลเดียวกับ D74/D77/D80** — *ระบบทำได้ แต่ผู้ใช้ไม่รู้ว่าต้องทำอะไรต่อ* ·
`build`/`lint`/`test` ผ่านหมดทุกข้อ เพราะโค้ดทำงานถูกตามที่เขียนไว้เป๊ะ
**ชั้นเดียวที่จับได้คือมีคนเปิดหน้าจอแล้วงง**

**สิ่งที่ทำ**: `missingLabels()` / `missingText()` ใน `lib/shared/forms.ts` (+เทส 5) และ
`<MissingHint>` ใน `lib/shared/ui.tsx` (re-export ผ่าน barrel ทั้ง 3 โดเมน) — ขึ้นข้อความสีเหลือง
ใต้ปุ่มว่า *"ยังกรอกไม่ครบ: ลูกค้า · ผู้เสนอราคา"* · ครบแล้วไม่ render อะไรเลย (ไม่ใช่ช่องว่างค้าง)

🚨 **`<MissingHint>` เป็นแค่คำอธิบาย ไม่ใช่ตัวตัดสินว่าบันทึกได้หรือไม่** — เงื่อนไข `disabled=`
ของปุ่มยังเป็นตัวจริง (และ server action ยัง validate ซ้ำ) · จงใจ**ไม่**ผูกสองที่เข้าด้วยกันเป็นตัวเดียว
เพราะการรวมจะทำให้เกิดสภาพ *"ปุ่มกดไม่ได้แต่บอกว่าครบแล้ว"* ตอนมีคนแก้ข้างเดียวไม่ได้ยากเลย —
ยอมเขียนซ้ำ 2 บรรทัดดีกว่า (แลกกับความเสี่ยงที่ข้อความไม่ตรงกับปุ่ม ซึ่งเห็นได้ทันทีบนจอ)

**ไล่ทั้งแอปแล้ว** — `disabled=` ทั้งหมด 32 จุด แยกเป็น 3 กลุ่ม:

| กลุ่ม | ทำอะไร | ที่ไหน |
|---|---|---|
| ปุ่มบันทึกที่รอหลายช่อง | เพิ่ม `<MissingHint>` | QuotationTab · DrawTab · FermentTab · DiluteTab · MaterialTab · ProductTab · MonitorTab · BrandingCard · CompanyCard (3 การ์ด) |
| ปิดเพราะ**กฎ** ไม่ใช่ช่องว่าง | เพิ่ม `title=` | MasterTab (รหัสเป็น PK แก้ไม่ได้) · users-manager (ลบตัวเองไม่ได้) · BillsTab (ปุ่ม "เติมทุกแถว" ว่าง = จะไปล้างค่าเดิม) |
| **มีคำอธิบายอยู่แล้ว — ไม่แตะ** | — | PeriodTab (มีแถบ `locked` / `!rates` / `Empty` ครบ) · EntryTab (VAT + บัญชีตั้งค้าง เขียนบอกในบรรทัดเดียวกัน) · platform-manager (`quotaFull` มีบรรทัดใต้ปุ่ม) · QuotationTab เมนูสินค้า ("เลือกลูกค้าก่อน…" / ป้าย "หมด") · ConfigTab (▲▼ สุดขอบ) · data-manager (ช่องรหัสอยู่เหนือปุ่มพอดี) |

🪤 **กับดักตอนแก้**: การ์ดฝั่งตั้งค่าวาง `SaveButton` ไว้ใน `div.flex flex-wrap items-end` —
แปะ `<MissingHint>` ต่อท้ายตรง ๆ มันจะกลายเป็น flex item **ข้างปุ่ม** ไม่ใช่ใต้ปุ่ม
ต้องย้ายออกไปนอก `</div>` ของแถว

**ไฟล์**: `lib/shared/forms.ts` + `forms.test.ts` (ใหม่) · `lib/shared/ui.tsx` (`MissingHint`) ·
barrel `ui.tsx` 3 โดเมน · 12 component · build/lint/test **661** ผ่าน · ชุดเทส `docs/TESTING.md` ส่วนที่ 41

---

### D84 — หน้าแอดมินโชว์ชื่อโมดูลผิด: ลูกค้าที่ซื้อ "เงินเดือน" ขึ้นเป็น "ขาย" (2026-08-26 · ไม่มี migration)

**อาการ**: ตาราง *ลูกค้าทั้งหมด* ที่ `/platform` โชว์ `demoprov` เป็น **"ผลิต · บัญชี · ขาย · ขาย"**
— คำว่า "ขาย" ซ้ำ 2 อัน · ตรวจที่ DB แล้ว `modules_enabled = [production, accounting, sales, payroll]`
คือข้อมูลถูก **หน้าจอแปลผิด**

**สาเหตุ** — `app/(platform)/platform/_components/platform-manager.tsx` เขียนไว้ว่า

```tsx
{m === "production" ? "ผลิต" : m === "accounting" ? "บัญชี" : "ขาย"}
```

เขียนตอน D54 ซึ่งตอนนั้นมี **3 โมดูล** → `sales` เป็น else ที่ถูกต้องพอดี
พอ **D66 เพิ่มโมดูลที่ 4 `payroll`** มันตกเข้า else เดียวกัน กลายเป็น "ขาย" เงียบ ๆ

🪤 **ternary ไล่เช็ค key คือ `else` ที่กลืนของใหม่ทุกอันที่ยังไม่มีใครรู้จัก** — ต่างจาก
`Record<Key, string>` ที่ TypeScript บังคับให้ครบ · ในไฟล์เดียวกัน**มี `MODULE_LABEL` ที่ถูกต้องครบ 4 ตัวอยู่แล้ว**
แต่ใช้เฉพาะในช่องติ๊กเลือก (ซึ่งจึงถูกมาตลอด) — **ความจริง 2 แหล่งในไฟล์เดียว แหล่งหนึ่งถูกอัปเดต อีกแหล่งไม่**

🚨 **ผลกระทบไม่ใช่แค่ป้ายเพี้ยน** — นี่คือหน้าจอที่ใช้ตอบคำถาม *"ลูกค้ารายนี้ซื้ออะไรไว้"*
ก่อนคุยเรื่องต่อสัญญา/เก็บเงิน · อ่านผิดแล้วเก็บเงินผิดแพ็กเกจ หรือบอกลูกค้าว่าไม่มีโมดูลที่เขาจ่ายไปแล้ว
· ★ ตัวคุมสิทธิ์จริง (`workspacesFor`/`requireModule`) ใช้ key ไม่ได้ใช้ป้าย → **สิทธิ์ของลูกค้าไม่เคยผิด**
เสียแค่ฝั่งที่มนุษย์อ่าน

**สิ่งที่ทำ**: ย้ายชื่อโมดูลไป `lib/shared/workspaces.ts` เป็น `MODULE_LABEL: Record<ModuleKey, string>`
(อยู่บ้านเดียวกับ `MODULES`) → **เพิ่มโมดูลใหม่แล้วลืมเติมชื่อ = build ไม่ผ่าน** ไม่ใช่ขึ้นผิดบนจอ ·
ฝั่งหน้าแอดมินเหลือ `moduleLabel(m, withNote)` ตัวเดียวใช้ทั้งตารางและช่องติ๊ก ·
คำต่อท้าย *"(+ ฟอร์ม ภส.)"* แยกเป็น `MODULE_NOTE` เพราะป้ายในตารางต้องสั้น

**เทสที่เพิ่ม** (`lib/shared/workspaces.test.ts` +4 → รวม 18):
ครบทุก key · **ชื่อห้ามซ้ำกัน** (ซ้ำ = มีโมดูลถูกกลืนไปเป็นชื่ออีกตัว ซึ่งคืออาการของบั๊กนี้เป๊ะ) ·
ตรงกับ label ของ workspace · และเคสตรง ๆ ว่า `payroll` ต้องเป็น "เงินเดือน"

**ไฟล์**: `lib/shared/workspaces.ts` (`MODULE_LABEL`) · `workspaces.test.ts` (+4) ·
`app/(platform)/platform/_components/platform-manager.tsx` · build/lint/test **665** ผ่าน ·
ยืนยันบนหน้าจอจริงแล้ว: `demoprov` ขึ้น ผลิต · บัญชี · ขาย · **เงินเดือน** · ชุดเทส `docs/TESTING.md` ส่วนที่ 42

---

** — migration ล้มที่ statement 68
(`syntax error at or near "$"`) · แล้วตอนแก้ก็เจอกับดักซ้อน: **`String.replace()` แปลง `$`
ในสตริงแทนที่เป็น `# DECISIONS — บันทึกการตัดสินใจ/ความไม่ตรงกันระหว่าง implement

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

### D77 — หน้าแก้ไขบิลต้องกรอก หมวดหมู่/งาน ของรายการได้ (2026-08-22)

**ไม่มี migration · ไม่แตะ RPC/server action/ชั้นสูตรเงิน** · ผู้ใช้แจ้งว่า *"ลืมบันทึกว่าเป็นของงานไหน
จะไปกดแก้ไขเพื่อบันทึกย้อนหลังแต่ไม่มีช่องให้กรอก"*

#### ของครบทุกชั้น ขาดแค่ช่องบนจอ

| ชั้น | สถานะก่อนแก้ |
|---|---|
| คอลัมน์ `transaction_items.item_category` / `item_job` | ✅ มีตั้งแต่ migration แรก |
| RPC `fn_edit_transaction` | ✅ เขียน 2 คอลัมน์นี้อยู่แล้ว |
| payload `buildItemInputs()` | ✅ ส่ง 2 ค่านี้อยู่แล้ว |
| `EditBillModal` โหลดค่าเดิมเข้า state | ✅ โหลดอยู่แล้ว |
| **ช่องกรอกบนหน้าจอ** | ❌ **ไม่มี** |

> 🚨 **ช่องที่ DB/RPC/payload รองรับครบ แต่ไม่มีช่องกรอกบนจอ = ฟีเจอร์ที่ไม่มีอยู่จริงสำหรับผู้ใช้**
> ตระกูลเดียวกับ D74 *"ฟีเจอร์ที่ยังไม่มีทางเข้าถึง = บั๊กที่ยังไม่ถูกนับ"*
> อาการนี้ตรวจด้วย build/lint/test ไม่เจอเลย เพราะค่าที่โหลดมา**รอด round-trip** กลับลง DB ครบทุกครั้ง
> (แก้บิลกี่รอบข้อมูลก็ไม่หาย) — ดูเหมือนทุกอย่างทำงานถูก จนกว่าจะมีคนอยาก *แก้* ค่านั้นจริง ๆ
> · แถวที่เพิ่มใหม่ในหน้าแก้ไขยิ่งหนักกว่า: `emptyItem()` ให้ค่าว่างแล้ว**เติมไม่ได้เลยตลอดกาล**

#### โชว์ตลอด ไม่ซ่อนหลัง toggle (ต่างจาก EntryTab)

`EntryTab` ซ่อน หมวด/งาน/ส่วนลด ไว้หลังปุ่ม "แสดงคอลัมน์เสริม" (`showOpt`) เพราะเป็นฟอร์มคีย์งานประจำวัน
แต่หน้าแก้ไขบิลคือ**โฟลว์ซ่อมข้อมูลย้อนหลัง** — สิ่งที่ต้องกรอกคือของที่ลืม ถ้ายังต้องกดเปิดก่อนถึงเห็น
ก็ยังหาไม่เจออยู่ดี (หน้าแก้ไขโชว์ ลด%/ลดบาท ตลอดอยู่แล้วโดยไม่มี toggle — ทำให้สอดคล้องกัน)
· ตารางจาก 8 → 10 คอลัมน์ จึงขยายโมดัล `sm:max-w-3xl` → `sm:max-w-5xl`

#### ปุ่ม "เติมทุกแถว"

เคสจริงคือ**ทั้งบิลเป็นงานเดียวกัน** — ไล่พิมพ์ทีละแถวช้าและพิมพ์เพี้ยนได้ (`งาน A` ≠ `งานA` = คนละงานในรายงาน)
· ปุ่ม **disabled เมื่อช่องว่าง** — กันกดพลาดแล้วล้างค่าที่มีอยู่ทั้งบิลเป็นค่าว่าง
· เป็น state ในฟอร์มเท่านั้น ยังไม่เขียนจนกด *บันทึกการแก้ไข* (กดผิดปิดโมดัลทิ้งได้)

#### 🪤 id ของ `<datalist>` ห้ามซ้ำข้ามแท็บ

แท็บในแอปบัญชีถูก **mount ค้างไว้พร้อมกัน** (`BillsTab` รับ prop `active` แทนการ unmount)
ถ้าใช้ id เดิมของ `EntryTab` (`hist-item-cats` / `hist-item-jobs`) เบราว์เซอร์จะผูก `list=`
เข้ากับ element **แรกที่เจอใน DOM** → ดรอปดาวน์ในหน้าแก้ไขไปโชว์ค่าของอีกแท็บ
**โดยไม่มี error หรือ warning ฟ้องเลย** → ใช้ `edit-item-cats` / `edit-item-jobs`
(หน้าแก้ไขมีแบบอย่างอยู่แล้ว: `edit-cat-list`, `edit-contact-list`)

#### อื่น ๆ

- การ์ด **ดู** (อ่านอย่างเดียว) เพิ่มคอลัมน์ **งาน** ด้วย — ไล่ตรวจย้อนหลังว่าบิลไหนยังไม่ได้ใส่งาน
  โดยไม่ต้องเปิดหน้าแก้ไขทีละใบ
- `addItem()` ก๊อปหมวด/งานจากแถวสุดท้าย (เหมือน `EntryTab`) — `emptyItem(cat, job)` รับอาร์กิวเมนต์อยู่แล้ว
- ดรอปดาวน์ใช้ `getItemHistoryAction(entId)` ตัวเดิม (ประวัติเฉพาะบิลสถานะ `ปกติ`)
  · `entId` รู้ค่าหลังโหลดบิลเสร็จ จึงแยกเป็น effect ผูกกับ `entId`

**ไฟล์**: `app/(app)/accounting/_components/BillsTab.tsx` (ไฟล์เดียว) · build/lint/test **566** ผ่านเท่าเดิม

---

### D78 — สุราแช่: เส้นทางผลิตที่ 2 + ฟอร์ม ภส.๐๗-๐๒/๑(๑) ฉบับสุราแช่ (0045, 2026-08-24)

กฎหมายปัจจุบันให้ขอใบอนุญาตผลิตได้ทั้ง **สุรากลั่น** และ **สุราแช่** ในโรงเดียว
สุราแช่ไม่มีการกลั่น และใช้**ฟอร์มบัญชีผลิตคนละใบ** (ผู้ใช้เก็บพิกัดฟอร์มมาให้ครบ 33 จุด)
· เบียร์เป็นสุราแช่ชนิดหนึ่งแต่ใช้อีกฟอร์ม — **ตัดออกจากรอบนี้**

#### ⚠️ เลขฟอร์มบนหัวกระดาษชนกันสนิท

ทั้งสองใบพิมพ์ **ภส.๐๗-๐๒/๑(๑)** เท่ากันเป๊ะ แต่เป็นกระดาษคนละแบบ (กลั่น 19 คอลัมน์ 13 แถว ·
แช่ 14 คอลัมน์ 17 แถว) → `ExciseKind` แยกเป็น `0702_1` / `0702_1_chae` · template แยก key ·
บนจอเรียกว่า **"บัญชีผลิตสุรากลั่น" / "บัญชีผลิตสุราแช่"** ไม่ใช้เลขฟอร์มเป็นตัวแยกให้ผู้ใช้เลือก

#### 1. ตารางใหม่ `log_ferment_draw` (ไม่ reuse `log_distill`)

`log_distill` มีช่องตรงกับที่ฟอร์มสุราแช่ต้องการ**พอดีทั้ง 4 ช่อง** (batch/vol/abv/date) — reuse ได้เลย
แต่**ผู้ใช้เลือกตารางใหม่**: ยอมมีโค้ด 2 ที่ทำเรื่องคล้ายกัน เพื่อแลกกับการที่วันหนึ่งจะแก้ดีเทล
เฉพาะของ *การกลั่น* หรือ *การแช่* ได้โดยไม่กระทบกันเอง

> ★★ **กติกาเหล็ก 1 batch = 1 แถว ยกมาใช้ด้วย** (`unique (tenant_id, entity_id, batch)`)
> เหตุผลเหมือน `log_distill` เป๊ะ: ฟอร์มหักน้ำหมักของ batch นั้น**ทั้งก้อน**ต่อ 1 แถว
> รินซ้ำ = หักซ้ำ = เลขยื่นราชการผิด · RPC `fn_draw_fermented` แปลง `unique_violation`
> เป็นข้อความไทย เหมือน `fn_close_batch`

#### 2. ธง กลั่น/แช่ = `products.liquor_type` ตัวเดิม (ไม่เพิ่มคอลัมน์)

`liquor_type` คือช่อง "ประเภทสุรา" ที่**พิมพ์ลงหัวฟอร์ม ภส. อยู่แล้ว**ทั้ง 4 ใบ และตามกฎหมาย
มีแค่ 2 ค่านี้จริง → ไม่ต้องมีธงซ้อนอีกตัว · บนจอเปลี่ยนเป็น**ดร็อปดาวน์ชุดปิด** (`LIQUOR_PROCESS`)

> 🚨 **ห้ามใส่ CHECK constraint กับคอลัมน์นี้** — `db:push:all` ลงทุก DB รวมของลูกค้าที่เราไม่เคย
> เห็นข้อมูล ใครพิมพ์ค่าอื่นไว้ = migration ล้มทั้ง fleet → บังคับที่ดร็อปดาวน์ + เตือนบนจอเท่านั้น
>
> 🚨 **ห้าม default เป็นสุรากลั่น** เมื่อค่าว่าง/ไม่รู้จัก — เดาแล้วออกฟอร์ม**ผิดใบ**โดยไม่มีอะไรฟ้อง
> แท็บรายงานสรรพสามิตขึ้นแถบแดงบอกชื่อสินค้าที่ยังไม่ได้ตั้ง แล้ว**ไม่ออกฟอร์มบัญชีผลิตให้**
> (ฟอร์มวัตถุดิบ/สุราขวด/งบเดือนยังออกได้ตามปกติ — ไม่ต้องรู้ประเภท)
>
> 🪤 ดร็อปดาวน์ต้องเก็บ**ค่าเดิมที่ไม่อยู่ในชุด**ไว้เป็น option `(ค่าเดิม)` ไม่งั้นเปิดหน้าแก้แล้ว
> ค่าที่ลูกค้าพิมพ์เองไว้ก่อนหายเงียบ ๆ กลายเป็นค่าแรกของชุด · 🪤 รายงานรวมยอดตาม **ชื่อสุรา**
> ถ้าชื่อเดียวกันมีหลายแถวประเภทไม่ตรงกัน = เดาไม่ได้ → เตือนอีกแถบ

#### 3. ขั้นปรุงอยู่ในแถวเดียวกับการริน — และยอดที่ลงฟอร์มคือยอด**หลังปรุง**

ผู้ใช้ยืนยันว่าสุราแช่**มี**ขั้นเติมน้ำ/น้ำตาล/ปรับดีกรีก่อนบรรจุ แต่ฟอร์ม**ไม่มีคอลัมน์รองรับขั้นปรุง**
→ เก็บ `vol/abv` (ตอนริน) + `final_vol/final_abv/water/adjust_date` (หลังปรุง) ไว้แถวเดียวกัน

> 🚨 **ต้องลงยอดหลังปรุง** ไม่ใช่ยอดตอนริน — หัวคอลัมน์เขียนว่า *"ที่ผลิตได้**และรอบรรจุ**"*
> และเป็นทางเดียวที่ยอดคงเหลือจะตรงกับยอดบรรจุ (ริน 160 ปรุงเป็น 200 แล้วบรรจุ 200
> ถ้าลง 160 → ช่องคงเหลือติดลบ) · **ยังต้องให้ผู้ใช้ยืนยันกับเจ้าหน้าที่สรรพสามิต**
> → รวมการตัดสินใจนี้ไว้ที่ `drawnVol()` / `drawnAbv()` ใน `lib/production/calc.ts` **จุดเดียว**
> ตอบมาว่าอย่างไรก็แก้ที่นั่นที่เดียว
>
> 🪤 ปล่อยให้สุราแช่ลงแท็บ **ปรุง/ปรับดีกรี** ได้ด้วย = ปรุงถูกนับ 2 ที่ (`log_dilute` +
> `log_ferment_draw`) ยอดพองโดยไม่มีอะไรฟ้อง → `DiluteTab` ตัดสินค้าประเภทสุราแช่ออกจากดร็อปดาวน์

#### 4. ซ่อนแท็บของเส้นทางที่โรงนี้ไม่ได้ทำ — ตัดสินจาก**สินค้าจริง**

`SubTab.process` + `tabsFor(ws, role, processes)` · โรงที่มีแต่สุรากลั่นไม่เห็นแท็บ "รินน้ำสุราแช่"
และกลับกัน · หลักเดียวกับ D51 (**ห้ามผูกกับธงแพ็กเกจ ตัดสินจากข้อมูลจริง**)

> 🪤 **เซ็ตว่าง (ยังไม่มีสินค้า) = โชว์ครบ** ไม่งั้นระบบเปล่าที่เพิ่งรับลูกค้าใหม่จะไม่มีแท็บให้กดเลย
> 🪤 ต้องกรอง**ทั้งสองที่** — `ProductionApp` (แถบแท็บ) และ `navSubItems` ผ่าน `layout.tsx` → `Nav`
> ทำที่เดียวแล้วดร็อปดาวน์บนแถบเมนูจะลิงก์ไปแท็บที่ถูกซ่อน กดแล้วเด้งกลับแท็บแรก (ตระกูล D68)

#### 5. บั๊ก 2 จุดที่โผล่มาเพราะเส้นทางที่ 2 (ไม่ได้อยู่ในแผนตอนแรก)

- `getPendingBatches()` ตัดสิน "batch ค้าง" จาก `log_distill` **อย่างเดียว**
  → batch ของสุราแช่ที่รินแล้วจะค้างในรายการ "รอกลั่น" **ตลอดกาล**
- `getBatchBoard()` คิด stage จากหม้อกลั่น/`log_distill`
  → การ์ดของ batch สุราแช่ค้างที่ "ลงหมัก" ถาวร → เพิ่ม stage **"รินน้ำสุราแล้ว"** + ธง `fermented`

> ทั้งคู่คือ **ตรรกะที่ถูกต้องตราบใดที่มีเส้นทางเดียว** — เพิ่มเส้นทางที่ 2 เมื่อไหร่ต้องไล่หาทุกจุดที่
> ถามว่า "จบหรือยัง" แล้วดูจาก `log_distill`

#### 6. ช่องหมายเหตุต้องคุมความกว้าง

ช่องกว้าง 64 จุด แต่ `note` มี**ข้อความที่ผู้ใช้พิมพ์เอง**ปนอยู่ = ยาวไม่จำกัด
วัดจริงแล้วข้อความปรุงแบบเดิม (`"ปรุงปรับดีกรี 9 ได้ปริมาณ 200.00 ลิตร"`) ที่ 6.5 จุด กว้าง 66.7
→ จบที่ x 826.4 (เลยขอบช่อง) และถ้ามีวันที่ปรุงด้วยจะจบที่ 851.9 = **ไหลออกนอกขอบกระดาษ 841.8**

→ ข้อความอัตโนมัติสั้นลงเป็น `"ปรุง 26/05/69 9° ได้ 200.00 ล."` **และ** เพิ่ม `fit()` ใน
`fillFermentedForm` (ย่อฟอนต์ลงถึง 5 จุด → ยังไม่พอค่อยตัดท้ายด้วย …) ผูกกับ `cols.note.maxW`

#### สิ่งที่ตั้งใจ **ไม่** ทำ

- **ไม่ refactor `lib/pdf/excise.ts`** ที่มี helper ซ้ำ 3 ชุด (`txt`/`right`/`center`/`drawCol`)
  → duplicate เป็นชุดที่ 4 · ไฟล์นี้อยู่ใต้กติกาเหล็กข้อ 3 ฟอร์ม 4 ใบเดิมต้องได้ผลไบต์เดิมเป๊ะ
  การจัดบ้านเพื่อความสวยงาม = แก้โค้ดที่วาดฟอร์มราชการ 3 ใบพร้อมกัน ไม่คุ้มความเสี่ยง
- **ไม่แตะ `productionReport`** แม้แต่บรรทัดเดียว — golden test เดิมผ่านโดยไม่แก้ไฟล์เทสและไม่แก้
  `__golden__/reports.json` = หลักฐานว่าเส้นทางสุรากลั่นไม่ขยับ (เทคนิคเดียวกับ D55/D69/D70)
- **ไม่มี golden จากระบบเดิม** เพราะแอป GAS เดิมทำแต่สุรากลั่น → ค่าที่คาดหวังเป็นตัวเลขกลม
  ที่ตกลงกับผู้ใช้ไว้ วางเป็น fixture ในไฟล์เทสเลย (`fermented.test.ts`) ไม่ใช่ `__golden__/*.json`
  จะได้อ่านคู่กับค่าที่คาดหวังในที่เดียว
- **ช่อง ☐ โรงขนาดกลาง** เก็บพิกัดไว้ใน CFG แล้ว แต่ยังติ๊ก "ขนาดเล็ก" เป็นค่าปริยายเหมือนฟอร์ม
  เดิมทั้ง 4 ใบ — จะสลับได้ต้องมีช่อง "ขนาดโรงงาน" ใน `entities` ก่อน **ยังไม่มีจึงไม่เดา**

#### ตัวเลขที่ผูกกับเทส (ตรวจกับฟอร์มด้วยตาได้)

| วันที่ | เหตุการณ์ | น้ำหมักคงเหลือ | สุราแช่คงเหลือ |
|---|---|---|---|
| 3 พ.ค. | หมัก 11/69 · 2 ถัง × 100 | 200 | 0 |
| 8 พ.ค. | หมัก 12/69 · 1 ถัง × 100 | 300 | 0 |
| 24 พ.ค. | ริน 11/69 ได้ 160 @12° → ปรุงเป็น 200 @9° | **100** (หักทั้งก้อน 200) | 200 |
| 28 พ.ค. | บรรจุ 0.75 × 200 ขวด = 150 ล. | 100 | **50** |
| | รวมเดือนนี้ | น้ำหมัก 300 · น้ำสุราแช่ 200 · บรรจุ 150 | |

**ไฟล์หลัก**: migration `0045` · `lib/production/calc.ts` + `reports.ts` (`fermentedReport`) ·
`lib/pdf/excise.ts` (`CFG_0702_1_CHAE` + `fillFermentedForm`) · `lib/shared/tabs.ts` ·
`app/(app)/production/_components/DrawTab.tsx` (ใหม่) · `data.ts`/`actions.ts`/`excise-data.ts` ·
`BoardTab`/`MasterTab`/`ExciseTab`/`DiluteTab` · `layout.tsx`+`nav.tsx` ·
พิกัดฟอร์ม `docs/form/พิกัด_ภส07-02ทับ11_สุราแช่.md` · seed `supabase/seed/seed_fermented.sql`
· build/lint/test **593** ผ่าน

---

### D79 — ต้นทุนสุรา (บัญชี) → วัตถุดิบ (ผลิต) ไม่เคยทำงานเลยสักครั้ง (0046, 2026-08-24)

**ที่มา**: ผู้ใช้แจ้งว่า *"ลงรายจ่ายจากแอปบัญชี เป็นต้นทุนสุรา มีวัตถุดิบจากฝั่งผลิตให้เลือก
แต่พอมาดูที่ผลิต-วัตถุดิบ ไม่มีรายการล่าสุดขึ้นให้ และออกรายงานเพื่อเช็ค ก็ไม่ขึ้นในรายงาน"*

#### สาเหตุจริง: alias ใน SQL ชนชื่อตัวแปร plpgsql

```sql
declare it jsonb;                                   -- ตัวแปรลูป
...
select ... from jsonb_array_elements(p_items) it;   -- ← alias ชื่อเดียวกัน
```

PostgreSQL ตอบ `42702 column reference "it" is ambiguous` และบรรทัดนี้อยู่ **นอก**
บล็อก `begin/exception` ที่ตั้งใจดักไว้ → error หลุดออกไป abort ทั้งฟังก์ชัน

> 🚨 **ไม่ใช่แค่ forward พลาด — บิลบัญชีไม่ถูกบันทึกด้วยซ้ำ**
> เพราะ `fn_save_transaction` ทั้งตัวถูก roll back

บั๊กนี้เกิดตั้งแต่ `0011` แล้วถูก **ก๊อปยกบล็อกต่อไปใน `0017`** → เส้นทางนี้
**ไม่เคยทำงานสำเร็จเลยสักครั้งตั้งแต่เปิดระบบ** · หลักฐานตรงจาก DB จริง:
`integration_log` ไม่มีแถว `RECEIVE_MATERIAL` แม้แต่แถวเดียว และ `transactions`
ไม่มีบิลหมวด `ต้นทุนสุรา` สักใบตั้งแต่ migrate มา

> 🪤 **ตรรกะที่อยู่ในฐานข้อมูล ไม่มี build/lint/test ตัวไหนมองเห็น**
> `npm run build` / `lint` / `test` ผ่านหมด 100% มาตลอดทั้งที่ฟีเจอร์ตายสนิท
> — ตระกูลเดียวกับ D68 (ดร็อปดาวน์ไม่ขึ้นเพราะ `overflow-x-auto`) และ D74/D77
> (*"ฟีเจอร์ที่ยังไม่มีทางเข้าถึง = บั๊กที่ยังไม่ถูกนับ"*)
> **ชั้นเดียวที่จับได้คือ `npm run test:tenant`** ที่ยิง Supabase จริง

#### บั๊กที่เจอเพิ่มระหว่างซ่อม (เจอเพราะทางเดินถูกเปิดครั้งแรก)

1. **ของไปลงผิดกิจการ** — `fn_receive_material` insert `log_material` โดยไม่ระบุ `entity_id`
   → ตกไปที่ default `my_default_entity()` = **กิจการหลักเสมอ** แม้บิลจะลงกิจการที่ 2
   · ตระกูลเดียวกับบั๊ก `apply_stock_delta` ที่ 0029 แก้ไปแล้ว:
   **เอา entity จาก "แถว/เอกสาร" ไม่ใช่จาก "คนที่ล็อกอิน"**
   → เพิ่มพารามิเตอร์ `p_entity` (🪤 พารามิเตอร์เพิ่ม = ต้อง `drop function` ก่อน
   ไม่งั้นได้ overload ตัวที่ 2 — บทเรียนเดิมจาก D69)
   · master วัตถุดิบอยู่คนละกิจการ → **แจ้งคนละข้อความกับ "สะกดผิด"** ไม่งั้นผู้ใช้ไล่หาผิดทาง
2. **แถวที่กรอกแต่ราคา ไม่กรอกชื่อ ล้ม forward ทั้งใบ** — `buildItemInputs` ปล่อยแถว
   `itemName || exVat` ผ่านมา → ชื่อว่าง 1 แถวทำให้ทั้งบิลไม่ได้รับวัตถุดิบ · กรองชื่อว่างทิ้งก่อนส่ง
3. **warning ขึ้นเป็นสีเขียว** — `setMsg({ ok: true, text: warning })` ทำให้ข้อความ
   *"บันทึกบัญชีสำเร็จ แต่รับวัตถุดิบเข้าสต็อกผลิตไม่ได้"* หน้าตาเหมือนสำเร็จทุกประการ
   → เพิ่มระดับ `warn` (เหลือง) ใน `Msg`/`useSaver`
   · 🚨 **บันทึกได้บางส่วน ≠ สำเร็จ** ห้ามใช้สีเดียวกันเด็ดขาด
4. **`fn_mig_truncate` ตก `log_ferment_draw` (0045) และ `snapshots` (0018)** — ทั้งคู่มี FK
   มาที่ `tenants` แบบไม่ cascade → **ลบ/รีเซ็ตลูกค้าล้มทันที**
   · `log_ferment_draw` เจอจริงตอนรันเทสรอบนี้ · `snapshots` เป็นระเบิดเวลาแบบเดียวกัน
   ที่รอให้ลูกค้าเคยกด "สำรองข้อมูล" สักครั้งก่อนถึงจะระเบิด
   · `SNAPSHOT_ORDER` และ `backup-tables` ก็ตก `log_ferment_draw` เหมือนกัน
   = **สำรอง/ย้อนข้อมูลแล้วข้อมูลสุราแช่หายเงียบ ๆ ไม่มี error**

#### กันพลาดซ้ำ: รายชื่อตารางมีแหล่งเดียว + เทสไล่ให้

รายชื่อ "ตารางที่มี `tenant_id`" ถูกก๊อปไว้ 4 ที่ (`fn_mig_truncate` ใน SQL · `SNAPSHOT_ORDER` ·
`backup-tables` · `TENANT_TABLES` ของ harness) และ **พลาดมาแล้ว 3 รอบติด**
(D67 ลืม `pay_*` · D69 ลืม `pay_variables`/`pay_post_legs` · D78 ลืม `log_ferment_draw`)
— จดกับดักไว้ใน DECISIONS ทั้ง 2 รอบแล้วก็ยังพลาดรอบที่ 3

→ `lib/shared/tenantTables.ts` เป็นแหล่งเดียว + `tenantTables.test.ts` **อ่านอีก 4 ที่เป็นข้อความ**
มาเทียบ (รวม **ไฟล์ SQL** ด้วย — ชั้นที่ unit test ปกติมองไม่เห็น) · เพิ่มตารางใหม่แล้วลืม
= `npm run test` แดงทันที ไม่ต้องพึ่งความจำอีก

#### ที่ไม่ได้แก้ (ตั้งใจ)

- **หมวดหมู่ที่จุดชนวนยังฮาร์ดโค้ดว่า `"ต้นทุนสุรา"`** — ผังบัญชีจริงของผู้ใช้ใช้คำว่า
  `"ค่าต้นทุนสินค้า"` และไม่มี `"ต้นทุนสุรา"` ในลิสต์หมวดหมู่รายจ่ายเลย (แอปแอบเติมเป็น
  ตัวเลือกใน `<datalist>` ให้พิมพ์เลือกได้) → **รอผู้ใช้ตัดสิน** ว่าจะเติมหมวดนี้เข้าลิสต์
  หรือให้ตั้งค่าได้ว่าหมวดไหนเป็นตัวจุดชนวน · เดาแทนไม่ได้ เพราะกระทบทุก tenant
- **`fn_save_installments` ยัง forward ไม่ได้** — ซื้อวัตถุดิบแบบแบ่งงวดต้องบันทึกรับ
  ในแอปผลิตเอง (ฝั่ง UI ก็ไม่ได้ส่งธงมาด้วย) — เหมือนเดิม ไม่ได้ถอยหลัง

**ไฟล์หลัก**: migration `0046` · `lib/shared/tenantTables.ts` (+เทส) · `lib/shared/ui.tsx`
(`UiMsg` + `Msg` ระดับ warn) · `app/(app)/accounting/_components/EntryTab.tsx` ·
`lib/snapshot/engine.ts` · `scripts/backup-tables.ts` ·
`tests/tenant/forward-material.test.ts` (ใหม่ · 5 เทส) · ชุดเทส `docs/TESTING.md` ส่วนที่ 37
· build/lint/test **598** + `test:tenant` **134** ผ่าน

---

### D80 — บั๊กที่เจอจากการ "ใช้แอปจริงแบบลูกค้าใหม่" ในเบราว์เซอร์ (0047, 2026-08-25)

**ที่มา**: ผู้ใช้ให้ไล่ใช้แอปตั้งแต่ตั้งค่าจนจบทุกลูปในเบราว์เซอร์จริง — วิธีเดียวกับที่ผู้ใช้เจอ D79 เอง
เจอเพิ่ม 7 ข้อ **โดยที่ build/lint/test เดิมผ่านหมด 100%** ทุกข้อ

> 🪤 บทเรียนรวบยอดของรอบนี้: **ชั้นที่เทสอัตโนมัติมองไม่เห็นมี 2 ชั้น** — ตรรกะที่อยู่ใน DB (D79)
> และ *ช่องว่างระหว่างสิ่งที่ระบบทำได้กับสิ่งที่ผู้ใช้กดถึง* (D74/D77/D80) · ทั้งสองชั้นต้องมีคนใช้จริงถึงเจอ

---

#### A1 · ชื่อพนักงานบนเอกสารยื่นราชการเป็นชื่อเก่า

**อาการ**: ใบแนบ ภ.ง.ด.1 แถวแรกพิมพ์ `นายรัง` คู่กับเลขบัตร `1-0303-00492-83-7` ซึ่งเป็นของ
`นายอำนวย ตระกูลทุม` → **ชื่อกับเลขประจำตัวเป็นคนละคนบนแบบที่ยื่นสรรพากร**

**สาเหตุ**: อ่าน `payroll_items.emp_name` (snapshot) ก่อนชื่อปัจจุบัน = สลับข้างจากกติกา D75
(*"ชื่อ = ค่าปัจจุบันเสมอ · ตัวเงิน = ค่าที่แช่ไว้เสมอ"*) · D69 เขียนก่อน D75 กติกาใหม่จึงกวาดไม่ถึง
· กระจายอยู่ 5 จุด: `pnd1Rows` · `sso110Rows` · `pnd1kRows` · 50ทวิ ใน `FilingTab` ·
`getPayrollReportSource` (ตัวหลังไม่ join `employees` เลย = ไม่มีชื่อปัจจุบันให้ใช้ด้วยซ้ำ)

**แก้**: `empDisplayName(emps, empId, snapshot)` ตัวเดียวใน `lib/payroll/filings.ts` — ทะเบียน > snapshot > ว่าง
· เหตุผลเดียวกับที่ D75 ดึง `periodView.ts` ออกมา: กฎนี้พลาดแล้ว 2 รอบเพราะกระจายหลายที่

- 🪤 **ข้อยกเว้นเดียว — 50ทวิ ที่ออกไปแล้ว** ใช้ `wht_certificates.contact_name` (ชื่อ ณ วันออก)
  ใบนั้นอยู่ในมือพนักงานจริง พิมพ์ซ้ำต้องได้ข้อความเดิมเป๊ะ ไม่งั้นเอกสารเลขเดียวกันชื่อไม่ตรงกัน 2 ใบ
- 🚨 **เทสเดิมล็อกพฤติกรรมผิดไว้**: `filings.test.ts` มีเคส *"เปลี่ยนนามสกุลกลางปี → ใช้ชื่อล่าสุด"*
  ที่ยืนยันว่า snapshot ล่าสุดชนะ — คอมเมนต์ในโค้ดเจตนาถูก (*"เอกสารสิ้นปีควรเป็นชื่อปัจจุบัน"*)
  แต่หยิบผิดตัว · แก้เทสให้ยืนยันว่าทะเบียนชนะ + เพิ่มเคส "พนักงานถูกลบ → ตกไปใช้ snapshot"

#### A2 · ข้อมูลหลักแก้ได้โดยไม่มีประวัติ + `edit_log` ไม่มีที่ให้ดู

**สองครึ่งที่ต้องมาคู่กัน** — ลง trigger อย่างเดียวได้ข้อมูลที่เปิดดูไม่ได้ = สร้างบั๊ก D74/D77 ขึ้นมาเอง

1. **ไม่มี trigger บน master**: `products` (ตัวตัดสินว่าออกฟอร์ม ภส. ใบไหน + ตัวคูณปริมาตร) ·
   `entities` (เลขภาษี/เลขสรรพสามิตบนหัวเอกสารราชการ) · `materials`/`containers`/`contacts`/`bank_accounts`
   → เพิ่ม trigger ครบ + คอนฟิกเงินเดือน (`pay_rates`/`pay_inputs`/`pay_variables`/`pay_post_legs`)
   ซึ่งเปลี่ยนตัวเงินที่จ่ายจริง
2. **`edit_log` ไม่มีทางดูจากแอปเลยแม้แต่หน้าเดียว** — ถูกอ้างถึงแค่ในข้อความบนจอ
   (หน้าแก้บิลเขียนว่า *"การแก้จะถูกบันทึกใน edit_log"*) = **บอกว่าเก็บไว้ แต่ไม่บอกว่าดูที่ไหน**
   ข้อมูลที่สะสมอยู่แล้ว ~2,200 แถวเปิดได้ทางเดียวคือ Supabase dashboard
   → หน้าใหม่ **ตั้งค่า → ประวัติการแก้ไข** (RLS `edit_log_sel` = main + กรอง tenant มีอยู่แล้วตั้งแต่ 0028)

- 🚨 **ห้ามผูก audit กับ `app_settings`** — เก็บ `line_channel_token` อยู่ ผูกแล้วค่าลับถูกก๊อปลง edit_log
  ซึ่งเป็นคนละชั้นสิทธิ์กับที่ 0033 ตั้งใจกันไว้ (มีเทสยืนยันว่าต้องไม่มีแถว)
- 🪤 **`trg_audit` ต้องเอา tenant จากแถวเอง** (`rec ->> 'tenant_id'`) ไม่ใช่พึ่ง default `my_tenant()`
  ของ `edit_log` — ไม่งั้นพอผูกกับ `entities` แล้ว `provision:tenant` (service role, ไม่มี `auth.uid()`)
  **ล้มทันทีที่ insert entities** = รับลูกค้าใหม่ไม่ได้เลย · ตระกูลเดียวกับ D50 / `apply_stock_delta` (0029)
  · ไม่มี tenant ให้ผูก → ข้าม audit แทนที่จะทำให้งานหลักล้ม
- **หน้าประวัติ = ดูอย่างเดียว + คัดลอกค่าเก่า** (ผู้ใช้เลือกเอง) · 🚨 **ไม่มีปุ่มเขียนทับ DB โดยตั้งใจ**
  กดผิดคือทับข้อมูลจริง และต้องคิดเรื่อง FK/trigger/สต็อกครบทุกตาราง — ย้อนของจริงใช้ snapshot
- 🚨 **ห้ามเทดัมพ์ JSON ดิบลงจอ** — ผู้ใช้อ่านโค้ดไม่ได้ และแถว `transactions` มี ~28 คอลัมน์
  → `changedFields()` โชว์เฉพาะช่องที่ต่างจริง พร้อมชื่อไทย · `rawBefore()` คืน**ค่าดิบ** ให้ปุ่มคัดลอก
  (ก๊อป `—` หรือ `ใช่` ไปวางในช่องกรอกไม่ได้)
- `AUDITED_TABLES` ใน `lib/shared/tenantTables.ts` + เทส**ไล่อ่าน `create trigger audit_…` จากไฟล์ SQL**
  มาเทียบ — เพิ่ม trigger แล้วลืมเติมลิสต์ = ผู้ใช้กรองหาไม่เจอทั้งที่ระบบบันทึกไว้

**ไฟล์หลัก**: migration `0047` · `lib/payroll/filings.ts` (`empDisplayName`) · `app/(app)/payroll/data.ts` ·
`FilingTab.tsx` · `lib/shared/editLog.ts` (+เทส 11) · `lib/shared/tenantTables.ts` (`TABLE_LABEL_TH`/`AUDITED_TABLES`) ·
`app/(app)/settings/history/page.tsx` + `_components/HistoryCard.tsx` · `tests/tenant/audit-master.test.ts` (ใหม่ 5 เทส)
· build/lint/test **616** + `test:tenant` **139** ผ่าน

#### B1 · ไม่มีหน้าจอตั้ง "กิจการ/บัญชีที่รับรายได้ขาย" → ลูกค้าใหม่ปิดการขายใบแรกไม่ได้

**อาการ**: กด *รับมัดจำ & ส่งคลัง* แล้วตัน — *"ยังไม่ได้ตั้งค่ากิจการรับรายได้ขาย
(app_settings sales_revenue_entity) — ดู GOLIVE_CHECKLIST Phase 4"*

**สาเหตุ**: ไล่โค้ดแล้ว **ไม่มีที่ไหนเขียน `sales_revenue_entity` / `sales_revenue_account` เลยสักจุด**
ทั้งระบบ — ตั้งได้ทางเดียวคือยิง SQL · และข้อความ error ยังชี้ให้ไปเปิด**ไฟล์เอกสาร**
แทนที่จะบอกว่ากดที่ไหน (ตระกูล D74/D77)

**แก้**: การ์ดที่ 3 ในหน้า **ตั้งค่า → กิจการ** + `saveSalesRevenueAction`
· บัญชีเป็น**ดร็อปดาวน์จาก `bank_accounts`** ไม่ให้พิมพ์เอง (ชื่อต้องตรงเป๊ะ ฝั่งขายเขียนลง
`transactions.account_name` ตรง ๆ) · กิจการเดียว = เลือกให้เลย (หลัก D53)
· 🪤 **แยก action ออกจาก `saveDocEntityAction` เด็ดขาด** — "กิจการที่ออกเอกสาร" กับ
"กิจการที่รับเงิน" คนละเรื่อง รวมเป็นดร็อปดาวน์เดียวเมื่อไหร่ = แก้อันหนึ่งอีกอันย้ายตามเงียบ ๆ (D63)
· ข้อความ error ฝั่งขายชี้มาที่การ์ดนี้แล้ว

#### B2 · หมวดหมู่ที่จุดชนวน "รับวัตถุดิบเข้าสต็อกผลิต" ตั้งเองได้ (migration `0048`)

เดิมฮาร์ดโค้ด `"ต้นทุนสุรา"` แต่ผังบัญชีจริงของผู้ใช้ไม่มีคำนี้ (แอปแอบเติมเป็นตัวเลือกใน `<datalist>`
ให้พิมพ์เลือกได้) — หมวดที่ใช้จริงคือ `"ค่าต้นทุนสินค้า"` ซึ่งไม่จุดชนวนอะไรเลย

- app_settings kind ใหม่ `material_forward_cat` (หลายแถวได้) · **ค่าปริยาย `"วัตถุดิบผลิตสุรา"`**
  (ผู้ใช้เลือกเอง — เปลี่ยนจากของเดิม)
- **ไม่มีแถว = ใช้ค่าปริยายในโค้ด** (`lib/accounting/forwardCats.ts`) → ไม่ต้อง seed ให้ลูกค้าเดิม
  · เปลี่ยนค่าปริยายปลอดภัยเพราะเส้นทางนี้ไม่เคยทำงานสำเร็จเลยก่อน `0046` = ไม่มีข้อมูลเดิมที่พึ่งคำเดิม
- 🪤 **`app_settings.kind` เป็น CHECK whitelist** — เพิ่ม kind ในโค้ดอย่างเดียวไม่พอ ผู้ใช้กดเพิ่มแล้ว
  เด้ง *"ค่าที่กรอกไม่ถูกต้องตามที่ระบบกำหนด"* (เจอจริงตอนเทส) → ต้องมี migration และ
  **ยกรายชื่อเดิมมาครบทุกตัว** เพราะ constraint เขียนทับทั้งก้อน
- 🚨 **บั๊กที่เกิดระหว่างแก้เอง แล้วจับได้ตอนเทส**: ตอนแรกส่ง "ค่าที่มีผลจริง" (ที่เติมค่าปริยายแล้ว)
  เข้า ChipList → หน้าจอโชว์ `วัตถุดิบผลิตสุรา` เป็น chip เหมือนบันทึกไว้แล้ว
  พอผู้ใช้ **เพิ่มหมวดที่ 2** ระบบมีแถวจริง 1 แถว → ค่าปริยาย**หลุดทันทีโดยไม่มีอะไรฟ้อง**
  ทั้งที่ chip ยังอยู่บนจอ · ตระกูลเดียวกับ D74 (*ฟอร์มเปิดมาพร้อมค่าที่ยังไม่ได้บันทึก*)
  → แยก `forwardCatsSet` (ที่ตั้งเอง) ออกจาก `forwardCats` (ที่มีผล) · ว่าง = ขึ้นข้อความเหลือง
  *"ยังไม่ได้ตั้ง — ระบบใช้ … ให้ก่อน · เพิ่มเองแล้วจะใช้เฉพาะที่เพิ่ม"*
  🪤 **ค่าปริยายที่คำนวณในโค้ด ห้ามแสดงปนกับค่าที่ผู้ใช้บันทึกไว้จริงในช่องที่แก้ได้**

**ไฟล์หลัก**: migration `0048` · `lib/accounting/forwardCats.ts` (+เทส 4) ·
`app/(app)/settings/actions.ts` + `settings-data.ts` + `_components/CompanyCard.tsx` ·
`app/(app)/accounting/data.ts` + `_components/{EntryTab,BillsTab,SettingsTab}.tsx` · `app/(app)/sales/actions.ts`
· build/lint/test **620** ผ่าน

#### C1 · ขนาดขวดกรอกเป็นมิลลิลิตรได้เงียบ ๆ → ปริมาตรบนฟอร์ม ภส. ผิดพันเท่า

คอลัมน์เขียนว่า **ขนาดขวด (ล.)** อยู่แล้ว แต่คนคิดเป็น "330 มล." เป็นธรรมชาติ · ระบบรับ `330` ไปตรง ๆ
แล้ว **ภส.๐๗-๐๒/๑(๒) คิดลิตร = จำนวนขวด × ขนาดขวด** → บรรจุ 113 ขวด รายงาน **37,290 ลิตร**
แทน 79.1 ลิตร บนเอกสารที่ยื่นสรรพสามิต

**ผู้ใช้ตัดสิน: เตือนอย่างเดียว ไม่แปลงค่าให้** — แปลงอัตโนมัติเสี่ยงกว่า (ถังใหญ่ 20 ล. จะโดนหารด้วย)
และการไม่แตะค่าที่ผู้ใช้กรอก = ไม่มีทางแปลงผิดให้เงียบ ๆ

- `bottleSizeWarn()` เตือนเมื่อ > 5 (ไม่มีขวดขายปลีกใหญ่กว่านี้) · ข้อความบอกตัวเลขจริงและค่าที่ควรกรอก
- โชว์ทั้งตอนเพิ่ม · ตอนแก้ · **และบนแถวที่ยังไม่ได้กดแก้** — ไม่งั้นของเดิมที่ผิดอยู่แล้วจะไม่มีวันถูกเห็น
- แถบเตือนรวมในแท็บ **รายงานสรรพสามิต** ด้วย เพราะที่นั่นคือจุดที่เลขผิดกลายเป็นเอกสารจริง
- `Field.warn?: (v) => string | null` ใน `MasterTab` — เป็น hook กลาง เตือนช่องอื่นได้ในอนาคต

#### C2 · แท็บ "กลั่น" ยอมให้เลือก batch ของสุราแช่

ปิด batch ได้จริงด้วย → ได้แถวใน `log_distill` ของสินค้าสุราแช่ = ยอดไปโผล่ในฟอร์ม
**บัญชีผลิตสุรากลั่น** ผิดใบ โดยไม่มีอะไรเตือน (ฝั่งแท็บ "รินน้ำสุราแช่" กรองถูกอยู่แล้วตั้งแต่ D78
— ขาดแค่ด้านนี้ ทำให้สองข้างไม่สมมาตร)

- ติดธง `fermented` ต่อ batch ใน `getPendingBatches` (map ชื่อสุรา → `products.liquor_type`
  ด้วย `isFermented()` — วิธีเดียวกับ `getBatchBoard`) แล้ว **กรองที่ `DistillTab`**
- 🪤 **ห้ามกรองใน `getPendingBatches` ตรง ๆ** — ฟังก์ชันนี้ใช้ร่วมกับแท็บ **ติดตามหมัก**
  (คอมเมนต์ในไฟล์บอกไว้: *"ใช้หน้ากลั่น/monitor"*) และ batch สุราแช่ก็ต้องวัด pH/Brix ได้
- 🪤 `liquor_type` **ว่าง = ไม่ซ่อน** — การซ่อนก็เป็นการเดาเหมือนกัน ปล่อยให้แถบเตือนแดงในแท็บ
  รายงานสรรพสามิต (D78) จัดการ

#### C3 · คอลัมน์ Yield ขึ้น "—" ตลอดกาล

คอลัมน์ `log_distill_run.ferm_charge` มี · `startDistillRunAction` **รับพารามิเตอร์ `fermCharge`
และเขียนลงแถว "เริ่มกลั่น" อยู่แล้ว** · `distillSummary` อ่านค่านี้ · golden test มี
— **แต่หน้าจอไม่เคยส่งค่านี้เลยสักครั้ง** (grep เจอ 0 ครั้งใน `DistillTab`) ตระกูล D74/D77 อีกตัว

- เพิ่มช่อง **"น้ำหมักที่เข้าหม้อ (ล.) — ไม่บังคับ"** ไว้ **คู่ปุ่ม "+ เริ่มหม้อใหม่"**
  ★ ไม่ใช่ในฟอร์มบันทึกค่า เพราะแถว "เริ่มกลั่น" ถูกสร้างตอนกดปุ่มนั้น และเป็นจังหวะที่ผู้ใช้
  รู้ปริมาณน้ำหมักที่เทเข้าหม้อพอดี
- โชว์คอลัมน์ "น้ำหมักเข้าหม้อ" ในตารางค่าที่บันทึก (จะได้เห็นว่ากรอกไปแล้วหรือยัง)
- ไม่กรอกก็กลั่นได้ตามปกติ — แค่ Yield ว่าง (บอกไว้ใต้ช่อง)

**ไฟล์หลัก**: `app/(app)/production/_components/{MasterTab,ExciseTab,DistillTab}.tsx` ·
`app/(app)/production/data.ts` (`getPendingBatches` ติดธง `fermented`) · `_components/types.ts`
· build/lint/test **620** ผ่าน

---

### D81 — เอกสารยื่นราชการนับงวดร่างเข้าไปด้วย ทั้งที่หน้าจอเขียนว่าไม่นับ (2026-08-25)

**ที่มา**: เทสในเบราว์เซอร์ด้วยสกิล `/browser-qa` — เจอบนหน้าเดียวกันว่า **คำกำกับประกาศกฎหนึ่ง
แต่โค้ดทำอีกอย่าง** · บรรทัดใต้ช่องเลือกเอกสารเขียนว่า *"ตัวเลขมาจากงวดที่ กดคำนวณ & บันทึกแล้ว
เท่านั้น — **งวดร่างยังไม่นับ**"* แต่ `getFilingYear`/`getFilingPeriod` ดึง `payroll_items`
ด้วย `.like("period_id", …)` เฉย ๆ **ไม่มีเงื่อนไขสถานะงวดเลยสักบรรทัด**

หลักฐานจาก tenant ทดสอบ:

| งวด | สถานะ | คน | เงินได้ | ภาษี |
|---|---|---|---|---|
| PR-2026-01 | **draft** | 8 | 217,049 | 1,685 |
| PR-2026-02 | **draft** | 8 | 226,838 | 1,685 |
| PR-2026-03 | **draft** | 8 | 226,424 | 1,685 |
| PR-2026-08 | posted | 9 | 254,860 | 3,270 |
| **รวมทุกงวด** | | | **925,171** | **8,325** |

หน้า ภ.ง.ด.1ก แสดง **925,171 / 8,325** เป๊ะ = **งวดร่าง 3 งวดคิดเป็น 72% ของยอดทั้งปี**
· เลือกงวดร่างออกใบแนบ ภ.ง.ด.1 รายเดือนได้เต็มใบด้วย · ใบ 50ทวิ ที่ยื่นให้ลูกจ้างก็ใช้ยอดชุดเดียวกัน

> 🪤 ตระกูล D73/D75 — **อาการไม่ใช่สูตรผิด แต่เป็นการเลือกชุดข้อมูลผิด**
> สูตรทุกตัวใน `filings.ts` ถูกหมด · golden test 28 ตัวผ่านหมดมาตลอด · build/lint/test ไม่มีทางจับได้
> เพราะฟังก์ชันบริสุทธิ์ได้ input อะไรมาก็คิดถูกตาม — **คนที่เลือก input คือ `data.ts` ซึ่งไม่มีเทสคุม**

**แก้**: กฎอยู่ที่เดียวใน `lib/payroll/filings.ts` — `countsForFiling(status)` + `keepFiledItems()`
เรียกจาก 3 ที่ (server รายเดือน · server รายปี · ดร็อปดาวน์บนจอ) แบบเดียวกับ `periodView.ts` (D75)
และ `empDisplayName()` (D80) — กฎที่พลาดแล้วต้องถูกดึงออกมาเป็นฟังก์ชันพร้อมเทส

- 🚨 **`draft` ไม่นับ** — `post_state = {}` = ยังไม่ลงบัญชีสักขา = ยังไม่เกิดการจ่ายจริง
- 🪤 **`partial` ต้องนับ (ผู้ใช้เคาะ)** — ลงยอดสุทธิแล้วแต่ยังไม่ลงขา WHT คือสภาพปกติของคน
  *ที่กำลังจะยื่น* ภ.ง.ด.1 · ตัดออกเมื่อไหร่ = งวดที่จ่ายเงินให้ลูกจ้างไปแล้วจริงหายจาก
  **แบบที่ใช้นำส่งภาษีของงวดนั้นเอง** ซึ่งผิดหนักกว่าบั๊กที่ตั้งใจจะแก้
- 🚨 **ห้ามข้ามงวดเงียบ ๆ** → `<DraftNote>` แถบเหลืองบอกจำนวน+ชื่อเดือนที่ข้าม · ไม่งั้นผู้ใช้เห็น
  ยอดปีในแท็บ **รายงาน** (นับทุกงวดที่บันทึกไว้) ไม่ตรงกับแท็บ **เอกสารยื่น** แล้วไล่หาสาเหตุไม่เจอ
  (บทเรียน D75: ต่างกันได้ แต่ต้องบอกว่าอันไหนคืออันไหน)
- **แท็บรายงานไม่แตะ** — คำกำกับของมันถูกอยู่แล้ว (*"งวดร่างที่ยังไม่บันทึกจะไม่โผล่"*)
  และเป็นรายงานภายในที่ควรเห็นงวดร่าง
- **ใบ 50ทวิ คิดใหม่ทุกแถว (ผู้ใช้เคาะ)** — ตอนตัดสินใจ `wht_certificates` ยังว่างทั้ง tenant
  จึงไม่มีใบจริงได้รับผลกระทบ · ถ้าอนาคตมีใบที่ออกก่อนแก้บั๊กนี้ ยอดบนจอกับกระดาษจะต่างกัน
  ข้อมูลเดิมยังอยู่ครบใน `wht_certificates.base_amount` ถ้าจะโชว์เทียบทีหลัง
- ด่านกันที่ `getFilingPeriod` คืน `items: []` แต่**ยังคืน `period`** เพื่อให้จอบอกเหตุผลได้

#### 🔴 เจอเพิ่มระหว่างเทส — เอกสารรายเดือนใช้ข้อมูล**ทั้งปี**ชั่วขณะ

สลับชนิดเอกสารจากรายปี (ภ.ง.ด.1ก / 50ทวิ) กลับรายเดือน → React ฟ้อง duplicate key
`EMP-0002`…`EMP-0009` ครบทุกคนที่มีหลายงวด (ไม่ฟ้อง `EMP-0001` เพราะมีงวดเดียว จึงไม่ซ้ำ)
= ใบแนบ ภ.ง.ด.1 ของเดือนเดียวถูก render ด้วย **33 แถวของทั้งปี** อยู่ 1 เฟรม · **ทำซ้ำได้ 100%**

**สาเหตุ**: `setLoading(true)` อยู่**ข้างใน** `load()` ซึ่งถูกเรียกจาก `useEffect` = *หลัง* render
ที่ `doc` เปลี่ยนไปแล้ว → เฟรมนั้น `doc` เป็นรายเดือนแต่ `items` ยังเป็นชุดทั้งปี

**แก้**: `loadedKey` ที่ถูกเซ็ต**พร้อมข้อมูล** แล้ว gate ด้วย `ready = !loading && loadedKey === key`
🪤 **กันทั้งคลาส** — ผูก *ข้อมูล* กับ *ข้อมูลนี้เป็นของอะไร* ไว้ด้วยกัน เช็ค `loading` อย่างเดียวไม่พอ
· ความเสี่ยงจริงคือกด **คัดลอกตาราง / พิมพ์ PDF** ในจังหวะนั้น = ได้เอกสารยื่นที่ยอดผิด

**ไฟล์หลัก**: `lib/payroll/filings.ts` (`countsForFiling` · `keepFiledItems` · +เทส 9) ·
`app/(app)/payroll/data.ts` (`getFilingPeriod` · `getFilingYear` +`draftPeriodIds`) ·
`_components/FilingTab.tsx` (ดร็อปดาวน์ · คำกำกับ · `<DraftNote>` · `ready`)
· **ไม่มี migration** · ไม่แตะชั้นสูตร — **golden test เดิม 28 ตัวผ่านโดยไม่แก้ไฟล์เทส**
· build/lint/test **629** ผ่าน · ชุดเทส `docs/TESTING.md` ส่วนที่ 39

---

### D82 — เลิก snapshot ในแอป เปลี่ยนเป็นดาวน์โหลดเก็บเอง (0049, 2026-08-25)

**ที่มา**: ผู้ใช้ถามว่า *"snapshot แล้วย้อนข้อมูล จะกระทบลูกค้าคนอื่นไหม หรือแยกเจ้าใครเจ้ามัน"*
→ ไล่โค้ดแล้วพบว่า **ฝั่งข้อมูลแยกครบทุกบรรทัด** (dump/restore/truncate/recompute มี `tenant_id`
ทุกจุด · `tenantId` มาจาก session ไคลเอนต์ปลอมไม่ได้ · `fn_mig_truncate` ถึงกับ raise exception
ถ้าไม่ส่ง tenant) **แต่มีผลข้างเคียง 1 อย่างที่กระทบข้ามลูกค้าจริง**

🚨 `restoreSnapshot()` เรียก **`fn_mig_set_triggers(false)`** ซึ่ง **ไม่มีพารามิเตอร์ tenant**
เพราะ Postgres สั่ง `alter table … disable trigger` ได้ระดับ**ตาราง**เท่านั้น
→ ปิด trigger 9 ตาราง **ทั้งฐานข้อมูล กระทบทุกลูกค้าที่อยู่ก้อนเดียวกัน**:

1. `edit_log` ของเจ้าอื่นไม่บันทึก — แก้อะไรตอนนั้นไม่เหลือร่องรอย
2. 🔴 **stock trigger ไม่ทำงาน** → เจ้าอื่นบันทึกบรรจุ/จ่ายตอนนั้น `stock_product` ไม่ขยับ
   และ**ไม่มีอะไรมาคำนวณให้ทีหลัง** (recompute ยิงเฉพาะ tenant ที่กดย้อน)
   = **สต็อกผิดถาวรเงียบ ๆ** แล้วไปโผล่บนฟอร์ม ภส.
3. process ตายกลางทาง (Vercel timeout / lambda kill) → `try/finally` ช่วยเฉพาะตอน throw ปกติ
   **ถ้าโดน kill trigger ค้างปิดทั้ง DB ตลอดไป**

> 🪤 **บทเรียนของรอบนี้: โค้ดขัดกับกติกาที่ตัวเองเขียนไว้**
> comment ของ `fn_mig_set_triggers` ใน `0029` เขียนกำกับเองว่า *"ใช้ตอน provision ลูกค้าใหม่
> เท่านั้น **ห้ามรันบนระบบที่มีคนใช้อยู่**"* — แต่ restore คือ**ปุ่มที่ลูกค้ากดเองได้ตลอดเวลา**
> · เขียนคำเตือนไว้ข้างฟังก์ชันไม่พอ ต้องดูด้วยว่า *ใครเรียกมันได้บ้าง*

**ผู้ใช้ตัดสิน: ตัดระบบ snapshot ในแอปทิ้งทั้งก้อน** เปลี่ยนเป็นปุ่มดาวน์โหลดให้ลูกค้าเก็บไฟล์เอง

| เรื่อง | เคาะว่า |
|---|---|
| ทางกลับเมื่อลูกค้าทำข้อมูลพัง | **ผ่านเรา** — ลูกค้าส่งไฟล์มา เจ้าของรัน `npm run restore:tenant` · ปุ่มอันตรายไม่อยู่ในมือลูกค้า |
| รูปแบบไฟล์ | **2 ปุ่มแยกกัน** — `.json` (ครบทุกตัวอักษร ใช้ย้อนได้จริง) · `.xlsx` (เปิด Excel อ่าน/ส่งบัญชี) |
| ตาราง `snapshots` | **drop ทิ้ง** — ของเก่า 2 ก้อนใน DB เจ้าของ (`start`/`allset` ก.ค.) ไม่เอาแล้ว |

- ★ **ผลพลอยได้**: หลังลบ `engine.ts` ผู้เรียก `fn_mig_set_triggers` ที่เหลือมี**ที่เดียว**คือ
  `migration/import-csv.ts` ซึ่งรันตอน cutover บนระบบเปล่า = ตรงตามกติกาที่เขียนไว้พอดี
  (จึง**เก็บฟังก์ชันไว้** ไม่ต้อง drop) · และเลิกเก็บ payload เป็น jsonb ใน DB = คืนโควตาแผนฟรี
- 🚨 **กับดักที่เกือบพลาด**: `fn_mig_truncate` **มี `'snapshots'` อยู่ในลิสต์** (0046) —
  drop ตารางแล้วไม่แก้ = `delete from snapshots` พังทันที = **ลบ/รีเซ็ตลูกค้าไม่ได้เลย**
  ตระกูล D79 เป๊ะ ๆ · `tenantTables.test.ts` ที่ไล่อ่าน SQL มาเทียบคือชั้นที่จับได้
- 🚨 **สคริปต์ restore ห้ามแตะ `fn_mig_set_triggers`** — นั่นคือสิ่งที่งานนี้ตั้งใจกำจัด
  ปล่อย trigger ทำงานปกติ · สต็อกยังถูกเพราะเรียก `fn_mig_recompute_stock` ปิดท้าย
  · `edit_log` จะมีแถวเพิ่มจากการ restore ซึ่ง**ควรมี** (ย้อนข้อมูลทั้งระบบคือเหตุการณ์ที่ต้อง audit ที่สุด)
- 🚨 **ไฟล์ต้องผูก `tenant.id` + `slug`** — สคริปต์ปฏิเสธเองถ้าเอาไฟล์ลูกค้า A ไปลงลูกค้า B
  (ต้อง `--tenant=<uuid>` ยืนยันเจตนาถึงจะข้ามได้) · dry-run เป็นค่าปริยาย ต้อง `--apply` ถึงลงจริง (แบบ D57)
- 🪤 **PostgREST คืนแค่ 1000 แถวเงียบ ๆ** — action ต้องวน `.range()` เหมือน `backup-tables.ts`
  ไฟล์สำรองที่ขาดแถวคือไฟล์ที่ *ดูเหมือนใช้ได้* จนถึงวันที่ต้องใช้จริง
- 🚨 **Excel กินศูนย์นำหน้า** — `tax_id`/`national_id`/`excise_id`/`sso_no` ต้องบังคับเป็นข้อความ
  ไม่งั้น `0105558123456` → `105558123456` หรือ `1.05559E+11` = เลขบนไฟล์ที่ส่งให้บัญชีผิด
  · คอลัมน์ jsonb ต้อง `JSON.stringify` ไม่ใช่ `[object Object]`
- 🔴 **`xlsx` ต้อง `await import()`** ในตัว handler — static import = ทุกคนที่เปิดหน้าตั้งค่าโหลด
  SheetJS ตาม (บทเรียนเดียวกับ pdf-lib ใน D61)
- 🪤 **`RESTORE_SKIP` ตัดเฉพาะตอนเอากลับ ไม่ใช่ตอนสำรอง** — `stock_product`/`profiles`
  ยังอยู่ในไฟล์ (ลูกค้าต้องได้ข้อมูลตัวเองครบ) แค่ไม่เขียนกลับเข้า DB
  (`stock_product` คำนวณใหม่ · `profiles` ผูก `auth.users` แตะแล้วเซสชันพัง) · มีเทสคุมทั้งสองด้าน
- 🚨 **ต้องบอกผู้ใช้ตรง ๆ บนจอ** ว่าไฟล์นี้กดกลับเองไม่ได้ + มีข้อมูลเงินเดือน/เลขบัตร ให้เก็บให้ดี
- 🔴 **เจอตอนเปิดไฟล์จริง**: `counters` · `integration_log` · `edit_log` **ไม่มีชื่อไทยใน `TABLE_LABEL_TH`**
  → 3 ชีตใน Excel ขึ้นชื่อตารางดิบให้ลูกค้าอ่าน ซึ่งผิดกฎที่เขียนไว้หัวบล็อกนั้นเอง
  (*"ผู้ใช้ไม่ได้เขียนโค้ด ห้ามโชว์ชื่อตารางดิบ ๆ"*) · ก่อน D82 ไม่เคยโผล่เพราะชื่อไทยใช้แค่ใน
  ดร็อปดาวน์หน้าประวัติการแก้ไข → เติมชื่อ + เทสไล่ว่า **ทุกตารางใน `EXPORT_TABLES` ต้องมีชื่อไทยและห้ามซ้ำ**
  — ไม่ใช่ปล่อยให้เดาเอาเองว่ายังย้อนได้เหมือนเดิม

#### 🔴 เจอเพิ่ม 2 ข้อ ตอนทดสอบทางกลับด้วยข้อมูลจริง (migration `0050`)

**1. `fn_mig_truncate` ลบ `entities` ก่อน `report_runs` → ลบ/รีเซ็ต/ย้อนข้อมูลล้มทันที**

```
rpc fn_mig_truncate: update or delete on table "entities" violates
foreign key constraint "report_runs_entity_id_fkey" on table "report_runs"
```

`report_runs.entity_id` ผูก FK ไป `entities` ตั้งแต่ `0027` แต่ในลิสต์ของ `fn_mig_truncate`
มันอยู่**หลัง** `'entities'` = ลบแม่ก่อนลูก · **บั๊กนี้มีมาตั้งแต่ `0029` ก๊อปต่อถึง `0046`/`0049`**

- 🔴 ผลจริง: **ลบ/รีเซ็ตลูกค้าจากหน้าแอดมินไม่ได้เลย ถ้าลูกค้ารายนั้นเคยกดออกฟอร์ม ภส. สักครั้ง**
- 🪤 **ทำไม `test:tenant` ไม่จับ**: tenant ที่เทสสร้างขึ้นมาไม่เคยมีแถวใน `report_runs`
  → FK ไม่มีอะไรให้ละเมิด · เจอตอนเอาข้อมูลของ tenant จริงที่มี 7 แถวกลับ
- 🚨 **บทเรียน: ลิสต์ที่ "ครบ" ไม่ได้แปลว่า "เรียงถูก"** — `tenantTables.test.ts` เดิมตรวจแค่ว่า
  **ชื่อครบทุกตาราง** ไม่เคยตรวจ**ลำดับ** → เพิ่ม `ENTITY_SCOPED_TABLES` + เทสว่า
  ทุกตารางที่มี `entity_id` ต้องถูกลบก่อน `entities` (พิสูจน์แล้วว่าเทสนี้ฟ้อง `0049` และผ่าน `0050`)
- ★ plpgsql rollback ทั้งก้อน — ตอนล้มไม่มีข้อมูลเสียหายแม้แต่แถวเดียว (ตรวจแล้ว)

**2. เลขรันนิ่งเอกสาร "ถอยหลัง" หลัง restore**

`reseedIdCounters` (ยกมาจาก `engine.ts` เดิม) ตั้ง counter = **max ของข้อมูลที่เหลืออยู่** เฉย ๆ
→ ทดสอบจริงเห็น `TR-20260825` ถอย **5 → 1** และ `BANK_ACC` **2 → 1**

- 🚨 **เอกสารที่ออกไปหลังวันสำรอง (แล้วถูกล้างตอน restore) จะปล่อยเลขกลับมาให้ใช้ซ้ำ**
  = ใบกำกับภาษี/ใบเสร็จ **เลขเดียวกันสองใบคนละเนื้อหา** ซึ่งเป็นปัญหากับสรรพากรจริง
- แก้: อ่าน counter **ก่อน** `fn_mig_truncate` เก็บเป็น "พื้น" แล้วใช้ค่าสูงสุดของ 3 ทาง —
  ค่าก่อน restore · ค่าในไฟล์ · max จากข้อมูลที่ใส่กลับ
- 🪤 ครอบคีย์ที่คำนวณจากข้อมูลไม่ได้ด้วย (`EMP` · `INV-…` · `TAX-…`) ซึ่งเดิมพึ่งค่าในไฟล์อย่างเดียว
- ทดสอบแล้ว: ตั้ง `BANK_ACC=9` `EMP=15` `TR-20260825=7` ให้สูงกว่าไฟล์ → restore → **คงค่าเดิมทั้งสามตัว**

**ผลทดสอบทางกลับ (ข้อมูลจริงของ tenant `demoprov`)**

| ตรวจ | ผล |
|---|---|
| dry-run | เทียบจำนวนแถวครบ 38 ตาราง · **ไม่แตะ DB เลยสักแถว** ✓ |
| ลบบิล 1 ใบ + `log_dilute` + `log_product` แล้ว restore | ข้อมูล**กลับครบทุกตาราง**เท่าเดิมเป๊ะ ✓ |
| สต็อกหลัง restore | `TESTDISL` = 89 (113 − 24) · `TESTSHAREL` = 128 — `fn_mig_recompute_stock` ถูกต้อง ✓ |
| 🚨 **tenant อื่นในก้อนเดียวกัน** (`default`/`platform`/`rongkhor`/`rongkor`) | **ไม่ขยับสักแถว** ✓ ← เหตุผลทั้งหมดของงานนี้ |
| `edit_log` | 252 → 385 (+133 = จำนวนแถวของตารางที่มี audit trigger) — **ตั้งใจให้เป็นแบบนี้** |
| ไฟล์ผิดกิจการ / ไม่มี tenant / ไม่ใช่ไฟล์ระบบ | ปฏิเสธทั้ง 3 แบบ **ก่อนแตะ DB** ✓ |

**รอบที่ 2 — ทิศทางที่รอบแรกยังไม่ได้พิสูจน์: ของที่เกิด*หลัง*วันสำรอง ต้องหายไป**

> รอบแรกทดสอบแค่ "ลบของออก → restore → กลับมา" ซึ่งเป็นทิศทางตรงข้ามกับการใช้งานจริง
> (*ลูกค้าทำงานมา 3 วันแล้วพัง อยากย้อนกลับไปวันจันทร์*) · ถ้า truncate ลบไม่ครบ ผลคือ
> **ข้อมูลเก่ากับใหม่ปนกัน** ซึ่งแย่กว่าไม่ restore เลย และเงียบสนิท

| ตรวจ | ผล |
|---|---|
| สร้างชุดที่ 1 ผ่านแอปจริง (บิล+2 รายการ · batch+เบิกวัตถุดิบ) → **ผู้ใช้กดดาวน์โหลดเอง** | ไฟล์ 745.1 KB มีของชุดที่ 1 ครบทุกชิ้น ✓ |
| สร้างชุดที่ 2 เพิ่มหลังสำรอง แล้ว restore | **ชุดที่ 2 หายเกลี้ยงทั้งแถวแม่และแถวลูก** (บิล+รายการ · batch+การเบิก) ✓ |
| ชุดที่ 1 หลัง restore | อยู่ครบเป๊ะ ทั้งยอด ฿1,800 และรายการลูก 2 แถว ✓ |
| จำนวนแถวเทียบไฟล์ | ตรงทุกตาราง (ยกเว้น `stock_product`/`profiles`/`edit_log` ตามออกแบบ) ✓ |
| 🚨 เลขรันนิ่ง | `TR-20260825` **คงที่ 9** ทั้งที่ในไฟล์เป็น 8 = ไม่ถอย ✓ |
| tenant อื่น 4 เจ้า | ไม่ขยับสักแถว ✓ |

**ไฟล์หลัก**: migration `0049` (drop table) + `0050` (fix ลำดับ truncate) ·
**ลบ** `lib/snapshot/engine.ts` · `lib/export/tenantExport.ts` (+เทส 20) ·
`lib/shared/download.ts` (ยกออกจาก `ExciseTab`) · `app/(app)/settings/data/{actions.ts,_components/data-manager.tsx}` ·
`scripts/restore-tenant.ts` (npm `restore:tenant`) · `lib/shared/tenantTables.ts` (`snapshots` ออก · `SNAPSHOT_SKIP`→`RESTORE_SKIP`)
· `ENTITY_SCOPED_TABLES` + เทสลำดับ truncate · build/lint/test **656** + `test:tenant` **138** ผ่าน · **ผู้ใช้ดาวน์โหลดไฟล์จริงทั้ง 2 แบบแล้ว ตรวจผ่าน** (JSON 578.7 KB · XLSX 709.2 KB · 38 ตาราง 445 แถว ตรงกับ DB ทุกตาราง · เลขภาษี/เลขบัตรเป็น `type=s` ครบ) · ชุดเทส `docs/TESTING.md` ส่วนที่ 40

---

### D83 — ปุ่มที่ถูก disable ต้องบอกว่า "ยังขาดอะไร" (2026-08-26 · ไม่มี migration)

**อาการ**: ตอนเทสด้วย `/browser-qa` ติดที่ปุ่ม **ออกใบเสนอราคา (A4)** ซึ่งเทาอยู่เฉย ๆ
เงื่อนไขจริงคือ

```
disabled={pending || items.length === 0 || !selCustId || !saleName.trim()}
```

ขาดอย่างใดอย่างหนึ่งใน 3 อย่าง (ลูกค้า · รายการในตะกร้า · **ผู้เสนอราคา**) ปุ่มก็เทาเหมือนกันหมด
ช่อง "ผู้เสนอราคา" อยู่ล่างสุดของการ์ดตะกร้า ไม่มีดาว ไม่มีคำว่าจำเป็น → **ผู้ใช้ใหม่นึกว่าปุ่มเสีย**

🪤 **ตระกูลเดียวกับ D74/D77/D80** — *ระบบทำได้ แต่ผู้ใช้ไม่รู้ว่าต้องทำอะไรต่อ* ·
`build`/`lint`/`test` ผ่านหมดทุกข้อ เพราะโค้ดทำงานถูกตามที่เขียนไว้เป๊ะ
**ชั้นเดียวที่จับได้คือมีคนเปิดหน้าจอแล้วงง**

**สิ่งที่ทำ**: `missingLabels()` / `missingText()` ใน `lib/shared/forms.ts` (+เทส 5) และ
`<MissingHint>` ใน `lib/shared/ui.tsx` (re-export ผ่าน barrel ทั้ง 3 โดเมน) — ขึ้นข้อความสีเหลือง
ใต้ปุ่มว่า *"ยังกรอกไม่ครบ: ลูกค้า · ผู้เสนอราคา"* · ครบแล้วไม่ render อะไรเลย (ไม่ใช่ช่องว่างค้าง)

🚨 **`<MissingHint>` เป็นแค่คำอธิบาย ไม่ใช่ตัวตัดสินว่าบันทึกได้หรือไม่** — เงื่อนไข `disabled=`
ของปุ่มยังเป็นตัวจริง (และ server action ยัง validate ซ้ำ) · จงใจ**ไม่**ผูกสองที่เข้าด้วยกันเป็นตัวเดียว
เพราะการรวมจะทำให้เกิดสภาพ *"ปุ่มกดไม่ได้แต่บอกว่าครบแล้ว"* ตอนมีคนแก้ข้างเดียวไม่ได้ยากเลย —
ยอมเขียนซ้ำ 2 บรรทัดดีกว่า (แลกกับความเสี่ยงที่ข้อความไม่ตรงกับปุ่ม ซึ่งเห็นได้ทันทีบนจอ)

**ไล่ทั้งแอปแล้ว** — `disabled=` ทั้งหมด 32 จุด แยกเป็น 3 กลุ่ม:

| กลุ่ม | ทำอะไร | ที่ไหน |
|---|---|---|
| ปุ่มบันทึกที่รอหลายช่อง | เพิ่ม `<MissingHint>` | QuotationTab · DrawTab · FermentTab · DiluteTab · MaterialTab · ProductTab · MonitorTab · BrandingCard · CompanyCard (3 การ์ด) |
| ปิดเพราะ**กฎ** ไม่ใช่ช่องว่าง | เพิ่ม `title=` | MasterTab (รหัสเป็น PK แก้ไม่ได้) · users-manager (ลบตัวเองไม่ได้) · BillsTab (ปุ่ม "เติมทุกแถว" ว่าง = จะไปล้างค่าเดิม) |
| **มีคำอธิบายอยู่แล้ว — ไม่แตะ** | — | PeriodTab (มีแถบ `locked` / `!rates` / `Empty` ครบ) · EntryTab (VAT + บัญชีตั้งค้าง เขียนบอกในบรรทัดเดียวกัน) · platform-manager (`quotaFull` มีบรรทัดใต้ปุ่ม) · QuotationTab เมนูสินค้า ("เลือกลูกค้าก่อน…" / ป้าย "หมด") · ConfigTab (▲▼ สุดขอบ) · data-manager (ช่องรหัสอยู่เหนือปุ่มพอดี) |

🪤 **กับดักตอนแก้**: การ์ดฝั่งตั้งค่าวาง `SaveButton` ไว้ใน `div.flex flex-wrap items-end` —
แปะ `<MissingHint>` ต่อท้ายตรง ๆ มันจะกลายเป็น flex item **ข้างปุ่ม** ไม่ใช่ใต้ปุ่ม
ต้องย้ายออกไปนอก `</div>` ของแถว

**ไฟล์**: `lib/shared/forms.ts` + `forms.test.ts` (ใหม่) · `lib/shared/ui.tsx` (`MissingHint`) ·
barrel `ui.tsx` 3 โดเมน · 12 component · build/lint/test **661** ผ่าน · ชุดเทส `docs/TESTING.md` ส่วนที่ 41

---

### D84 — หน้าแอดมินโชว์ชื่อโมดูลผิด: ลูกค้าที่ซื้อ "เงินเดือน" ขึ้นเป็น "ขาย" (2026-08-26 · ไม่มี migration)

**อาการ**: ตาราง *ลูกค้าทั้งหมด* ที่ `/platform` โชว์ `demoprov` เป็น **"ผลิต · บัญชี · ขาย · ขาย"**
— คำว่า "ขาย" ซ้ำ 2 อัน · ตรวจที่ DB แล้ว `modules_enabled = [production, accounting, sales, payroll]`
คือข้อมูลถูก **หน้าจอแปลผิด**

**สาเหตุ** — `app/(platform)/platform/_components/platform-manager.tsx` เขียนไว้ว่า

```tsx
{m === "production" ? "ผลิต" : m === "accounting" ? "บัญชี" : "ขาย"}
```

เขียนตอน D54 ซึ่งตอนนั้นมี **3 โมดูล** → `sales` เป็น else ที่ถูกต้องพอดี
พอ **D66 เพิ่มโมดูลที่ 4 `payroll`** มันตกเข้า else เดียวกัน กลายเป็น "ขาย" เงียบ ๆ

🪤 **ternary ไล่เช็ค key คือ `else` ที่กลืนของใหม่ทุกอันที่ยังไม่มีใครรู้จัก** — ต่างจาก
`Record<Key, string>` ที่ TypeScript บังคับให้ครบ · ในไฟล์เดียวกัน**มี `MODULE_LABEL` ที่ถูกต้องครบ 4 ตัวอยู่แล้ว**
แต่ใช้เฉพาะในช่องติ๊กเลือก (ซึ่งจึงถูกมาตลอด) — **ความจริง 2 แหล่งในไฟล์เดียว แหล่งหนึ่งถูกอัปเดต อีกแหล่งไม่**

🚨 **ผลกระทบไม่ใช่แค่ป้ายเพี้ยน** — นี่คือหน้าจอที่ใช้ตอบคำถาม *"ลูกค้ารายนี้ซื้ออะไรไว้"*
ก่อนคุยเรื่องต่อสัญญา/เก็บเงิน · อ่านผิดแล้วเก็บเงินผิดแพ็กเกจ หรือบอกลูกค้าว่าไม่มีโมดูลที่เขาจ่ายไปแล้ว
· ★ ตัวคุมสิทธิ์จริง (`workspacesFor`/`requireModule`) ใช้ key ไม่ได้ใช้ป้าย → **สิทธิ์ของลูกค้าไม่เคยผิด**
เสียแค่ฝั่งที่มนุษย์อ่าน

**สิ่งที่ทำ**: ย้ายชื่อโมดูลไป `lib/shared/workspaces.ts` เป็น `MODULE_LABEL: Record<ModuleKey, string>`
(อยู่บ้านเดียวกับ `MODULES`) → **เพิ่มโมดูลใหม่แล้วลืมเติมชื่อ = build ไม่ผ่าน** ไม่ใช่ขึ้นผิดบนจอ ·
ฝั่งหน้าแอดมินเหลือ `moduleLabel(m, withNote)` ตัวเดียวใช้ทั้งตารางและช่องติ๊ก ·
คำต่อท้าย *"(+ ฟอร์ม ภส.)"* แยกเป็น `MODULE_NOTE` เพราะป้ายในตารางต้องสั้น

**เทสที่เพิ่ม** (`lib/shared/workspaces.test.ts` +4 → รวม 18):
ครบทุก key · **ชื่อห้ามซ้ำกัน** (ซ้ำ = มีโมดูลถูกกลืนไปเป็นชื่ออีกตัว ซึ่งคืออาการของบั๊กนี้เป๊ะ) ·
ตรงกับ label ของ workspace · และเคสตรง ๆ ว่า `payroll` ต้องเป็น "เงินเดือน"

**ไฟล์**: `lib/shared/workspaces.ts` (`MODULE_LABEL`) · `workspaces.test.ts` (+4) ·
`app/(platform)/platform/_components/platform-manager.tsx` · build/lint/test **665** ผ่าน ·
ยืนยันบนหน้าจอจริงแล้ว: `demoprov` ขึ้น ผลิต · บัญชี · ขาย · **เงินเดือน** · ชุดเทส `docs/TESTING.md` ส่วนที่ 42

---

 ตัวเดียว** ต้องใช้ callback · ★ ล้มแบบนี้ไม่เสียหาย —
Supabase CLI รันใน transaction, รายงาน "ลงสำเร็จ 0 ก้อน" และสำรองข้อมูลเสร็จก่อนแล้ว

**6. เทสที่ผ่านเพราะ "ไม่มีข้อมูล" ไม่ใช่เพราะ "สิทธิ์ถูก"** — เขียน
`expect(...).toBeGreaterThanOrEqual(0)` ไว้ ซึ่งผ่านเสมอ · จับได้ตอนรันจริงเพราะ
**main เองก็อ่าน `employees` ได้ 0 แถว** (harness ไม่ได้ seed เงินเดือน)
→ seed ข้อมูลเงินเดือนในเทส แล้วเปลี่ยนเป็น `toBeGreaterThan(0)`
🪤 **"อ่านไม่ได้" ในโลก RLS = คืนลิสต์ว่าง ไม่ใช่ error** — เทสที่ assert ว่า `error` ไม่ null
จะผ่านทั้งที่ข้อมูลรั่ว ต้อง assert **จำนวนแถว**

#### เส้นที่ตัดสินไว้ (ห้ามเปลี่ยนโดยไม่ถามเจ้าของกิจการ)

- 🚨 **ยกเลิกออเดอร์ / ยกเลิกใบแจ้งหนี้มัดจำ = `sales.config`** (หัวหน้าเท่านั้น) จงใจไม่ใช่
  `sales.write` — การยกเลิกคือ **void ใบกำกับภาษีที่ออกไปแล้ว + คืนสต็อก**
  · ฝั่ง UI แยกธง `canCancel` ออกจาก `canWrite` และ RPC เช็คซ้ำอีกชั้น
- 🚨 **ตั้งค่ากลาง (`/settings`) = `admin` = `main` เท่านั้น** — มีจัดการผู้ใช้ + ดาวน์โหลดข้อมูล
  ทั้งกิจการรวมเงินเดือน/เลขบัตร
- 🚨 **`app_settings` แยกสิทธิ์เขียนตาม `kind`** ผ่าน `app_setting_cap()` — ไม่งั้นหัวหน้าฝ่ายบุคคล
  แก้สีแบรนด์ได้ · และ **ห้ามปิด select ทั้งตาราง** เพราะ layout โหลด `brand_*` ให้ทุกบทบาท
  (กติกา 0033 ยกมาทั้งดุ้น — โทเคน LINE ยังอ่านได้เฉพาะ main)
- `toRole()` **fallback เป็น `viewer` ห้ามเป็น `main`** — ต่างจากธงโมดูลที่ fail-open
  เพราะนี่คือขอบเขตความปลอดภัย อ่านค่าพลาดต้องปิด ไม่ใช่เปิด
  · และรับค่าเก่า `sale`/`warehouse` ไว้ด้วย กันช่วง deploy คาบเกี่ยว


#### 🔴 รอบเทสในเบราว์เซอร์ทีละบทบาท — เจอบั๊กที่เทสอัตโนมัติทั้งหมดมองไม่เห็น 2 ตัว

ผู้ใช้สลับ `profiles.role` ทีละค่า (มีผลทันทีโดยไม่ต้องล็อกอินใหม่ — โค้ดอ่าน role ทุก request)
แล้ว Claude ขับเทสต่อจนครบ **9/9 บทบาท** · **`build`/`lint`/`test` เดิมผ่านหมดทั้ง 2 บั๊ก**

**1. ทะเบียนแท็บกรองสิทธิ์ถูก แต่หน้าจอไม่ได้เรียกตัวกรอง**

พนักงานบัญชีเห็นแท็บ *ตั้งค่า* และเปิดผ่าน `?tab=settings` ได้จริง ทั้งที่ `ACCOUNTING_TABS`
กำหนด `cap: "acct.config"` ไว้ถูกแล้ว — เพราะ:

| หน้าจอ | ของเดิม |
|---|---|
| `AccountingApp` | `ACCOUNTING_TABS.map(t => t.label)` — **ไม่เรียก `tabsFor()` เลย** |
| `PayrollApp` | เหมือนกัน · แถมไม่เคยรับ `role` เข้ามาด้วยซ้ำ |
| `ProductionApp` | เรียก `tabsFor()` แต่ **ฮาร์ดโค้ด `"main"`** → ทุกคนได้สิทธิ์ของเจ้าของ |
| `SalesApp` | ✅ ถูกอยู่แล้ว (กรอง role มาตั้งแต่ก่อน D85) |

🪤 **ตระกูล D68/D74 เป๊ะ — ของมีครบทุกชั้น ขาดชั้นที่เอามาใช้จริง**
· แก้: ทั้ง 3 หน้าเรียก `tabsFor(role)` + กันยัดแท็บผ่าน URL (`TABS.includes()` ก่อน `setTab`)
· เทสกันซ้ำ: `tabs.test.ts` **อ่านซอร์สของทั้ง 4 App มาตรวจ** 4 ข้อ — เรียก `tabsFor` ไหม ·
  map จากทะเบียนดิบหรือเปล่า · ฮาร์ดโค้ด role ไหม · กรองแท็บจาก URL หรือยัง
  (ยืนยันแล้วว่า regex จับโค้ดเก่าได้จริง ไม่ใช่ผ่านฟรี)

**2. 🚨 `for all` ครอบ SELECT ด้วย → ใบ 50ทวิ ของคู่ค้ารั่วให้ฝ่ายเงินเดือน (migration 0052)**

`wht_sel` เขียนถูกแล้วว่าฝ่ายเงินเดือนเห็นเฉพาะแถวที่ `emp_id` ไม่ว่าง **แต่** `wht_w` เป็น
`for all` ซึ่ง**ครอบ SELECT ด้วย** และ policy แบบ permissive ถูก **OR กัน**
→ `has_cap('pay.write')` เปิดอ่านทุกแถวทับ policy ที่แคบกว่า
= พนักงานเงินเดือนเห็นว่ากิจการจ่ายค่าบริการให้คู่ค้ารายไหนเท่าไหร่

🪤 **บทเรียนทั่วไป: `for all` ไม่ได้แปลว่า "สิทธิ์เขียน" — มันคือทุก command รวม select**
เขียน policy อ่านให้แคบไม่พอ ถ้ายังมี policy `for all` ที่กว้างกว่าบนตารางเดียวกัน
· ไล่เช็คทุกตารางแล้ว — ที่เหลือ**รอดโดยบังเอิญ** เพราะบทบาทที่มี `.write` มี `.read`
  ของโดเมนเดียวกันเสมอ · `wht_certificates` ตัวเดียวที่เงื่อนไขอ่านมีมิติเพิ่ม (`emp_id`)
  ที่ฝั่งเขียนไม่มี → **ยกเงื่อนไขไปฝั่งเขียนด้วย** (ถูกกว่าเดิมเชิงธุรกิจ: ฝ่ายเงินเดือน
  ไม่ควรแก้ใบของคู่ค้าอยู่แล้ว)
· เทสกันซ้ำ 2 ชั้น: `rolesSql.test.ts` อ่าน SQL มาตรวจว่าเงื่อนไขอยู่ครบทั้ง 2 policy ·
  `role-caps.test.ts` ใส่ใบคู่ค้าจริงแล้วยิง DB

**3. 🟡 ข้อความบอกสิทธิ์เขียนชื่อบทบาทไว้ตายตัว**

- หน้าบัญชีขึ้นว่า *"บทบาท **viewer** — ดูได้อย่างเดียว (การบันทึก/แก้ไข**ต้องเป็น main**)"*
  → ผิด 2 อย่าง: ตอนนี้มีอีก 3 บทบาทที่บันทึกได้ · และโชว์ค่าดิบแทนชื่อไทย
- หน้าขายเช็ค `boot.role === "viewer"` ตายตัว → บังเอิญถูกวันนี้ แต่เพิ่มบทบาทอ่านอย่างเดียว
  ตัวใหม่แล้วแถบจะไม่ขึ้น
- แก้: ตัดสินจาก **cap** และแสดง `ROLE_LABEL` เสมอ

🪤 **เขียนชื่อบทบาทไว้ในข้อความบนจอ = คำโกหกที่รอวันเกิด** (ตระกูล D84)

#### ★ พิสูจน์ทั้ง 2 ทิศทาง ไม่ใช่แค่ "ซ่อนหมดแล้วผ่าน"

กับดักที่ตั้งใจหลบ: ถ้ากรองแรงเกินจนซ่อนหมดทุกคน เทสฝั่ง "ต้องไม่เห็น" จะผ่านหมดโดยไม่ฟ้อง

| สิ่งที่วัด | ฝั่งปิด | ฝั่งเปิด (ต้องพิสูจน์ด้วย) |
|---|---|---|
| แท็บตั้งค่าโดเมน | `accounting`/`payroll` ไม่เห็น | manager ทั้ง 3 **เห็นและเพิ่ม/ลบค่าได้จริง** |
| ปุ่มยกเลิกออเดอร์ | `sales` ไม่มี | `sales_manager` **ยกเลิกได้จริง** (สถานะใน DB เป็น `ยกเลิก`) |
| ใบ 50ทวิ คู่ค้า | ฝ่ายเงินเดือนมองไม่เห็นแถว | **เลขยังเดินต่อถูก** 6905 → 6906 ผ่าน `fn_wht_doc_nos` |
| หมวดรายจ่ายเงินเดือน | `payroll` เห็น 5 | `finance_manager` เห็น 6 (ต่างที่ `ค่าต้นทุนสินค้า` ซึ่งมาจากบิลจริงเท่านั้น) |

**ผลรวม**: build/lint/test **731** · `test:tenant` **188** · เทสในเบราว์เซอร์ครบ 9/9 บทบาท
· ชุดเทส `docs/TESTING.md` ส่วนที่ 43


**ไฟล์**: `lib/shared/roles.ts` (ใหม่ · `Role`/`ROLE_LABEL` ย้ายมาจาก `workspaces.ts` แล้ว re-export ต่อ) ·
`lib/shared/guard.ts` (`requireCap()` ที่หัวทุก page) · `roles.test.ts` +28 · `rolesSql.test.ts` +18 ·
`workspaces.ts`/`tabs.ts` เปลี่ยนจาก `roles[]` เป็น `cap` · migration **0051** (~880 บรรทัด) ·
`scripts/gen-0051.mjs` · `tests/tenant/role-caps.test.ts` +50 · `harness.seedUser()` ·
migration **0052** (อุดรูรั่ว `for all`) · `tabs.test.ts` +16 (อ่านซอร์ส 4 App) ·
build/lint/test **731** + `test:tenant` **188** ผ่าน · ชุดเทส `docs/TESTING.md` ส่วนที่ 43

### D86 — ขายหน้าร้าน (POS): กดครั้งเดียวจบ (0053, 2026-08-31)

**ต้นเรื่อง (ผู้ใช้)**: ขายหน้าโรงงานให้ลูกค้าขาจร 1-2 ลังบ่อย ๆ ซึ่งไม่ต้องเสนอราคา ไม่ต้องวางบิล
ไม่ต้องรอคลังแพ็ค แต่โฟลว์เดิมบังคับเดิน **3 หน้าจอเสมอ** (สร้างใบเสนอราคา → จัดการออเดอร์ *รับเต็ม & ส่งคลัง*
→ คลังจัดส่ง *ยืนยันจัดส่ง*) — ราว 12 คลิกต่อบิล 300 บาท

**สิ่งที่พบตอนสำรวจ — โฟลว์นี้มีครบอยู่แล้ว แค่กระจายอยู่ 3 หน้าจอ**

| ของที่ต้องการ | มีอยู่แล้วที่ไหน |
|---|---|
| เอกสาร "ใบกำกับภาษี/ใบเสร็จรับเงิน/ใบส่งสินค้า" | docType `tax-invoice-receipt-do` (`print.ts`) — `FULL_PAYMENT_AND_SEND` ตั้ง `docToPrint` เป็นตัวนี้อยู่แล้ว |
| ลงบัญชีรายรับ + idempotency | `fn_apply_order_action` (RECEIVE_REVENUE) |
| ตัดคลังทั่วไป + สต็อกสุราเข้าฟอร์ม ภส. | `fn_confirm_fulfillment` (`warehouse_stock`/`stock_moves` + `log_product` `'จ่าย'`) |
| ยกเลิก/คืนของ | `fn_cancel_order` (void บิล + คืนทั้ง 2 ระบบสต็อก) |

→ **งานนี้จึงเป็นการรวบโฟลว์ ไม่ใช่การเขียนตรรกะการเงินใหม่** — ชั้นสูตร (กติกาเหล็กข้อ 1) ไม่ถูกแตะเลย
`lib/sales/calc.ts` ไม่ได้แก้แม้บรรทัดเดียว และ golden S1-S10 ผ่านโดยไม่แก้ไฟล์เทส

**มติ 8 ข้อ (ผู้ใช้ตัดสิน 2026-08-31)**

1. **ลูกค้าขาจร = contact กลาง "ลูกค้าทั่วไป"** ใช้ซ้ำทุกบิล · ขอใบกำกับเต็มรูปเมื่อไหร่ค่อยเลือก/เพิ่มลูกค้ารายนั้น
   🚨 **"กรอกทับ" ต้องเป็น `contacts` จริง ไม่ใช่พิมพ์ลอย ๆ** — ที่อยู่/เลขภาษีบนใบกำกับอ่านจาก
   `contactMap` ใน `data.ts` (`sales_orders` ไม่ได้เก็บ 2 ช่องนี้) พิมพ์ลอย ๆ = เอกสารขึ้น "-"
   ★ **ชื่อไม่ได้ถูกฮาร์ดโค้ดที่ไหนเลย** — `app_settings.pos_walkin_contact` เก็บ **`contact_id`**
   (ตั้งใจ เพื่อให้เปลี่ยนชื่อลูกค้าทีหลังแล้วยังชี้ถูก) · คำว่า "ลูกค้าทั่วไป" เป็นแค่ข้อความบนจอ
   → ลูกค้าแต่ละเจ้าตั้งชื่อคู่ค้ารายนี้เป็นอะไรก็ได้ ระบบไม่สนใจ
2. **เอกสาร A4 ตัวเดิม** ไม่ทำสลิป 80mm (จะต้องทำเทมเพลตใหม่ + ถ้าจะออก "ใบกำกับอย่างย่อ" มีเงื่อนไขทางกฎหมายอีกชั้น)
3. **บัญชีรับเงินใช้ `sales_revenue_account` เดิม** ไม่เพิ่มค่าตั้งใหม่
4. **สินค้า: เฉพาะเมนูที่ผูก `product_id`** · สต็อกไม่พอ = **เตือน ไม่บล็อก**
5. **เรียก RPC เดิม 3 จังหวะต่อกัน ไม่เขียน RPC ก้อนเดียว** (เหตุผลด้านล่าง)
6. แท็บใหม่ในแอปขาย (`?tab=pos`) ไม่ทำ route แยก
7. กรอกได้แค่ **ส่วนลดท้ายบิล + ช่องทางชำระ** · ไม่มีแก้ราคา ไม่มี WHT (มีมาก = กดช้า ผิดวัตถุประสงค์)
8. **ขายผิดยังต้องให้หัวหน้ายกเลิก** (`sales.config`) — การยกเลิก = void ใบกำกับภาษีที่ออกไปแล้ว

**🔴 เลขประจำตัวผู้เสียภาษี — บังคับ 13 หลักทุกกรณี จึงสร้าง "ลูกค้าทั่วไป" ไม่ได้เลย**

`AddCustomerModal` บังคับ `/^\d{13}$/` ตั้งแต่ก่อน D86 → ลูกค้าขาจรที่ไม่มีเลขภาษีสร้างผ่านหน้าจอไม่ได้
**และผลพลอยได้ที่ไม่มีใครเคยสังเกต: ลูกค้าส่งออก (`is_export`) ก็สร้างไม่ได้เหมือนกัน**
ทั้งที่ฟอร์มมีเช็คบ็อกซ์ Export อยู่ — ผู้ซื้อต่างชาติไม่มีเลขภาษีไทย
(ใน `seed_sales.sql` ถึงต้องสร้างลูกค้าส่งออกด้วย SQL · ตระกูล D74 — ฟีเจอร์ที่ไม่มีทางเข้าถึง)

**มติ (ผู้ใช้เลือก)**: เช็คบ็อกซ์ **"ไม่มีเลขประจำตัวผู้เสียภาษี"** · ไม่ติ๊ก = บังคับ 13 หลักเหมือนเดิม
→ **คุณภาพข้อมูลฝั่ง B2B ไม่ตก** (การปลดล็อกทั้งระบบจะทำให้พนักงานเผลอสร้างคู่ค้า B2B ไม่มีเลขภาษี
แล้วออกใบกำกับเต็มรูปที่ข้อมูลผู้ซื้อไม่ครบตาม ม.86/4)

🪤 **`isExport` ผ่อนกฎอย่างเดียว ไม่ล้างช่อง · `noTaxId` ซ่อนช่องและบันทึกเป็นค่าว่าง** — ต่างกันโดยตั้งใจ
ลูกค้าที่ซื้อไปส่งออกอาจเป็น**นิติบุคคลไทยที่มีเลขภาษีจริง** ถ้าติ๊ก Export แล้วซ่อนช่องไปเลย
= บังคับให้ข้อมูลจริงหาย

🪤 **ติ๊ก "ไม่มีเลขภาษี" → สาขาเป็นค่าว่างด้วย** ไม่ใช่ `สำนักงานใหญ่` — คนเดินเข้ามาซื้อ 2 ลัง
ไม่มีสำนักงานใหญ่/สาขา · `branchLabel("")` คืน `""` → เอกสารไม่พิมพ์วงเล็บสาขา (ถ้าปล่อยเป็น
`สำนักงานใหญ่` ใบกำกับจะขึ้น *"- (สำนักงานใหญ่)"* ซึ่งอ่านแล้วขัดกันเอง)

**ช่องเลขภาษีบนเอกสารยังพิมพ์ `-` ตามเดิม** (พฤติกรรมปัจจุบันของ `customerBox` สำหรับคู่ค้าทุกรายที่ไม่มีเลข)
— ไม่แตะ เพราะการเปลี่ยนจะกระทบใบที่ออกไปแล้วให้หน้าตาไม่เหมือนเดิม

🐛 **เจอเพิ่มระหว่างทำ**: เลือก "สาขา" แล้วไม่กรอกเลข → โค้ดเดิมตรวจ **ค่าหลัง `padStart`**
ทำให้ `""` กลายเป็น `"00000"` ซึ่งผ่าน `/^\d{5}$/` ไปเงียบ ๆ แล้วพิมพ์ *"(สาขาที่ 00000)"*
ลงใบกำกับภาษี (00000 คือรหัสของ**สำนักงานใหญ่** ไม่ใช่สาขา) → เปลี่ยนไปตรวจ**ค่าที่ผู้ใช้พิมพ์**

★ กติกาทั้งหมดถูกดึงออกจาก JSX ไปไว้ที่ `lib/sales/customer.ts` + golden **S13** 17 เทส —
เพราะกฎกลายเป็น "บังคับ **เว้นแต่** A หรือ B" ที่มี 3 ตัวแปรพันกัน ซึ่งพังเงียบง่ายมากถ้าฝังใน component
🚨 เป็นกติกา **คุณภาพข้อมูล ไม่ใช่ขอบเขตความปลอดภัย** — `saveCustomerAction` ไม่ได้ตรวจ
และ DB ยอมให้ `tax_id` ว่างมาตั้งแต่แรก (ยิง API ตรงก็ผ่าน) จงใจไม่ไปขันที่ DB
เพราะจะทำให้ข้อมูลเดิมที่ import มาบันทึกทับไม่ได้

**🔴 บั๊ก 2 ตัวที่เจอทันทีตอนผู้ใช้ลองใช้จริงครั้งแรก (build/lint/test เดิมผ่านหมด)**

**(1) ปุ่ม "ตั้งเป็นลูกค้าทั่วไป" หายไปตอนที่ผู้ใช้กำลังหามันอยู่**
เงื่อนไขเดิมคือ `{canConfig && custId && custId !== walkinId && (<button/>)}` → ตอนเปิดการ์ดตั้งค่า
ครั้งแรก `custId` ยังว่าง **ปุ่มจึงไม่ถูก render เลย** เหลือแต่ "เพิ่มลูกค้าใหม่" ผู้ใช้จึงกดอันนั้น
แล้วเจอแต่ฟอร์มที่มีเช็คบ็อกซ์เลขภาษี — หาไม่เจอว่าจะตั้งลูกค้าทั่วไปตรงไหน
🚨 **ตระกูล D83 เป๊ะ ๆ แต่กลับด้าน**: D83 แก้ "ปุ่มเทาโดยไม่บอกเหตุผล" ส่วนอันนี้คือ
**ซ่อนปุ่มไปเลย ซึ่งแย่กว่า** — ปุ่มเทายังบอกว่ามีอยู่ · ปุ่มที่หายไปคือฟีเจอร์ที่ไม่มีอยู่จริงสำหรับผู้ใช้
→ **render เสมอแล้ว `disabled`** + `<MissingHint>` บอกว่ายังไม่ได้เลือกลูกค้า
· แยก `setupMode` (ยังไม่เคยตั้ง) ออกจาก "เปลี่ยนลูกค้าเฉพาะบิลนี้" เพราะการ์ดเดียวทำ 2 หน้าที่
คนละเจตนา (กับดัก D63) — คำอธิบายและปุ่มเปลี่ยนตามโหมด
· เพิ่มคู่ค้าใหม่ตอน `setupMode` → **ตั้งเป็นลูกค้าทั่วไปให้เลย** ไม่ต้องไปกดปุ่มที่เพิ่งโผล่อีกที

**(2) "ขายแล้วบิลไม่เข้าบัญชี" — จริง ๆ เข้าแล้ว แต่ไปโผล่แถวที่ 9**
ตรวจ DB แล้วพบว่าบันทึกครบถูกต้องทุกอย่าง (`TR-…` · `RECEIVE_REVENUE` + `SELL_PRODUCT` = ok)
สาเหตุคือ `searchBills` เรียงด้วย **`transaction_date` อย่างเดียว ไม่มีตัวตัดสินรอง** →
บิลที่ลงวันเดียวกันออกมาแบบ**ไม่กำหนดลำดับ** · วันนั้นมีบิลเงินเดือน 8 ใบลงวันเดียวกัน
บิลขายที่เพิ่งกดจึงไปแทรกกลางกอง แล้วผู้ใช้สรุปว่า "ไม่ได้บันทึก"
→ เพิ่ม `.order("created_at", { ascending: false })` เป็นตัวตัดสินรอง
🪤 **บทเรียน: "บันทึกแล้วต้องเห็นทันทีว่าบันทึกสำเร็จ" เป็นส่วนหนึ่งของฟีเจอร์ ไม่ใช่เรื่องความสวยงาม** —
ลำดับที่ไม่กำหนดแน่นอนทำให้ผู้ใช้เชื่อว่าข้อมูลหาย แล้วอาจกดขายซ้ำจนได้บิลซ้ำจริง ๆ
⚠️ **ที่ยังไม่แก้**: `searchBills` ทิ้ง `error` (`const { data } = await q`) → query พังเมื่อไหร่
ผู้ใช้เห็นเป็น "ไม่มีข้อมูล" ไม่ใช่ error (ตระกูลเดียวกับ D85 "อ่านไม่ได้ = ลิสต์ว่าง")

**ทำไมไม่ทำ RPC ก้อนเดียวให้มันอะตอมมิก**

ทำได้และ "ปลอดภัยกว่า" ในแง่ transaction — แต่ต้องยกตรรกะเลขเอกสาร (`neededSerials` + `taxDocNo`)
และการถอด VAT/WHT ไปเขียนใน SQL อีกชุด = **สูตรเงินมี 2 ที่** ซึ่งเป็นกลไกเดียวกับ **D79**
(`fn_save_transaction` ที่ก๊อปต่อจาก 0011 ไป 0017 แล้วพังเงียบมาเป็นปี)

ราคาที่จ่ายแทน: ล้มกลางทางแล้วได้ "สำเร็จบางส่วน" — ยอมรับได้เพราะ **ทุกสถานะกลางเป็นสถานะที่ถูกต้อง
ของโฟลว์เดิมและมีหน้าจอรองรับอยู่แล้ว**:
- ล้มหลังจังหวะ ① → ออเดอร์ค้าง `รอคอนเฟิร์ม` → ทำต่อ/ยกเลิกได้ที่แท็บจัดการออเดอร์
- ล้มหลังจังหวะ ② → ออเดอร์ค้าง `รอคลังจัดส่ง` → กดยืนยันจัดส่งได้ที่แท็บคลัง

🚨 **จังหวะ ③ ล้ม = ขายและลงบัญชีสำเร็จแล้วแต่สต็อกยังไม่ขยับ → ห้ามขึ้นสีเขียว**
ใช้ระดับ `warn` (เหลือง) ของ `Msg`/`useSaver` พร้อมบอกเลขออเดอร์และแท็บที่ต้องไปกดต่อ (บทเรียน D79)

**สิ่งที่ต้อง refactor (ไม่ใช่เขียนใหม่)**

`processOrderActionAction` และ `saveQuotationAction` ถูกผ่าออกเป็นแกน `applyOrderActionCore` /
`saveQuotationCore` ที่ **ไม่ยิง LINE ไม่ revalidate** แล้วให้ตัวเดิมเป็น wrapper บาง ๆ
→ จุดที่อ่าน config · `resolveSalesVat` · `neededSerials` · `processOrder` **ยังมีที่เดียว**
· POS ยิง **LINE ข้อความเดียวต่อบิล** (ไม่ใช่ 3 ข้อความจาก 3 จังหวะ)

**🔴 บั๊กเก่าที่เจอระหว่างทำ — กิจการไม่จด VAT ออกใบเสร็จแล้วได้เอกสาร "ไม่มีเลขที่"**

`neededSerials()` ตัด `tax1`/`tax2` ทิ้งเมื่อ `isVat === false` (ถูกต้องตาม ม.86/13) แต่
`FULL_PAYMENT_AND_SEND` / `FULL_PAYMENT_LATER` ในเส้นทางจด VAT มี `inv: false` อยู่แล้ว
เพราะไปใช้เลข TAX → **พอตัด tax ทิ้งจึงไม่ได้เลขอะไรเลยสักชุด**
- `doc.docNo = order.taxNo1` เป็นสตริงว่าง = ใบเสร็จรับเงินไม่มีเลขที่
- `taxDocNo()` คืน `"-"` → `transactions.tax_invoice_no = "-"`

มีมาตั้งแต่ **D55** · ไม่มีใครเจอเพราะกิจการของผู้ใช้จด VAT · **POS ชนเต็ม ๆ เพราะการขายสด
คือเคสหลักของโรงเล็กที่ไม่จด VAT** → แก้แบบขอบเขตแคบ: ไม่จด VAT + action ที่ออกใบเสร็จ + ยังไม่มี `invNo`
→ ให้เลขชุด `INV` · ฝั่งพิมพ์ `doc.docNo = order.taxNo1 || order.invNo`

★ **เส้นทางจด VAT ไม่ขยับเลย** (`taxNo1` มีเสมอ `||` จึงไม่เคยตกไปข้างขวา) — golden เดิมผ่านโดยไม่แก้ไฟล์เทส
⚠️ **ที่ยังไม่แก้**: `PAY_BALANCE` ของกิจการไม่จด VAT ที่มี `invNo` แล้ว ใบเสร็จยอดค้างจะใช้เลขซ้ำกับใบแจ้งหนี้
— ต้องมีช่องเลขที่ 2 (schema) ถึงจะแก้จริง · ไม่ใช่เส้นทางของ POS และไม่ถอยหลังจากเดิม (เดิมไม่มีเลขเลย)
⚠️ `tax-invoice-deposit` ก็ยังไม่มีเลขในเส้นทางไม่จด VAT — จงใจไม่แตะ เพราะใบชุดนั้นพิมพ์คู่กับ
`invoice` ที่ใช้ `invNo` อยู่แล้ว ใส่ fallback ไปจะได้ **เอกสาร 2 ใบเลขเดียวกันในการพิมพ์ครั้งเดียว** ซึ่งแย่กว่า

**กับดักที่เจอตอนทำ**

- 🪤 `app_settings.kind` เป็น **CHECK whitelist ที่เขียนทับทั้งก้อน** — ต้องยกรายชื่อเดิมมาครบ (บทเรียน D80)
- 🪤 `app_setting_cap()` ค่าปริยายคือ `admin` → ไม่ประกาศ = หัวหน้าฝ่ายขายตั้งลูกค้าทั่วไปเองไม่ได้
  ต้อง `create or replace` ยกฟังก์ชันจาก 0051 มาทั้งดุ้นแล้วเติมบรรทัดเดียว
- 🪤 unique ของ `app_settings` เป็น `(tenant_id, kind, value)` **ไม่ใช่ `(tenant_id, kind)`** →
  upsert ทับค่าเดิมไม่ได้ ต้องใช้แพตเทิร์น *ลบก่อนแล้ว insert* แบบที่ `settings/actions.ts` ใช้
- 🪤 `bangkokDateISO()` — server เป็น UTC · ใช้ `new Date()` ตรง ๆ จะได้วันก่อนหน้าในช่วงเช้ามืดของไทย
- 🪤 **เมนูที่ไม่ผูก `product_id` ถูก `fn_confirm_fulfillment` ข้ามเงียบ ๆ** (`continue` ที่ไม่เซ็ต `v_warning`)
  → POS ไม่โชว์เมนูพวกนี้ **แต่ต้องบอกว่าซ่อนไปกี่ตัวและซ่อนทำไม** (D83 — ของที่หายไปต้องมีคำอธิบาย)
- 🪤 `stockShortages` จับคู่ด้วย `trim(ชื่อ)` **ให้ตรงกับที่ SQL join** — ใช้กติกาคนละแบบเมื่อไหร่
  หน้าจอจะเตือนสินค้าตัวหนึ่งแต่ DB ไปตัดอีกตัวหนึ่ง
- 🪤 `stockQty = null` (ยังไม่มีแถวสต็อก) → **ไม่เตือน** — ไม่รู้ ≠ ไม่มี · เดาว่าเป็น 0 แล้วทุกบิลขึ้นเตือน
  จนคนเลิกอ่าน = คำเตือนที่ตายแล้ว
- ★ `AddCustomerModal` ถูกย้ายออกจาก `QuotationTab` มาเป็น `CustomerFields.tsx` เพื่อใช้ร่วมกัน —
  ก๊อปไปอีกชุด = กติกาตรวจเลขภาษี 13 หลัก/เลขสาขา 5 หลัก มี 2 ที่ (ตระกูล D84)

**ข้อจำกัดที่คงไว้โดยตั้งใจ**

- 🚨 **ขายย้อนวันไม่ได้** — `fn_confirm_fulfillment` เขียน `log_product.doc_date = current_date`
  ไม่ใช่วันที่ผู้ใช้เลือก → ย้อนวันแล้ววันบนฟอร์ม ภส. ไม่ตาม = เลขที่ยื่นราชการเพี้ยน
  ต้องการย้อนวันให้ใช้โฟลว์ B2B เดิม (บอกไว้บนหน้าจอแล้ว)
- ออเดอร์ยังใช้ `entity_id = my_default_entity()` เหมือน B2B วันนี้ — ไม่ถอยหลัง แต่ไม่ได้แก้ (งาน 4.3)
- กดรัวสองที = 2 บิล (idempotency key มาจากเลข ORD ที่ต่างกัน) → กันด้วย `disabled` ระหว่าง pending
  เหมือนที่เหลือทั้งแอป

**ไฟล์**: migration **0053** · `lib/sales/pos.ts` + `pos.test.ts` (golden **S12** 15 เทส) ·
`lib/sales/customer.ts` + `customer.test.ts` (golden **S13** 17 เทส) ·
`app/(app)/sales/_components/PosTab.tsx` · `CustomerFields.tsx` (ย้ายมาจาก QuotationTab) ·
`actions.ts` (`saveQuotationCore`/`applyOrderActionCore`/`posSaleAction`/`savePosWalkinContactAction`) ·
`data.ts` (+`posWalkinId`/`userName`) · `types.ts` · `print.ts` (docNo fallback) ·
`lib/sales/orders.ts` (`neededSerials` ไม่จด VAT) · `lib/shared/tabs.ts` + `tabs.test.ts` ·
`supabase/seed/seed_pos.sql` + `cleanup_test.sql` · build/lint/test **766** ผ่าน ·
ชุดเทส `docs/TESTING.md` ส่วนที่ 44

---

### D87 — เปิด `/platform` บน deployment ของโรงกลั่นเจ้าของเอง (2026-08-31 · ไม่มี migration · ไม่มีโค้ดเปลี่ยน)

**ต้นเรื่อง (ผู้ใช้)**: อยากเข้าหน้าจัดการหลังบ้านจาก Vercel project `insep-erp` ที่โรงกลั่นใช้ทำงานจริง
เพื่อเปิด/ปิดโมดูล · ขยายโควตากิจการ · รีเซ็ตรหัสผู้ใช้ของตัวเอง โดยไม่ต้องยิง SQL

**ตัดสิน: ตั้ง `PLATFORM_ADMIN=1` บน `insep-erp` เลย ไม่แยก project**

แก้ตารางใน `docs/NEXT_STEPS.md` ข้อ 10.1 ที่เดิมเขียนว่า project นี้ "ไม่ตั้ง"

| project | ชี้ DB | `PLATFORM_ADMIN` | เหตุผล |
|---|---|---|---|
| `insep-erp` | `vmhiwlxdyhatucioalzp` (ของเจ้าของ) | **`=1`** ✅ | โรงกลั่นเป็นของเจ้าของระบบเอง · ผู้ใช้ยืนยันว่าไม่แจกบัญชีแอดมินให้พนักงาน |
| `proof-app` (ลูกค้า) | `tnuxrufpzeyuvwdmkojv` | ❌ **ห้ามตั้ง** | กติกาเดิมไม่เปลี่ยน — ลูกค้าต้องไม่รู้ว่ามีหน้าคุมลูกค้าอยู่ |

**ข้อแลกเปลี่ยนที่รับไว้แล้ว** — พนักงานในโรงที่มีบัญชีอยู่ เปิด `/platform` จะเจอ**หน้าล็อกอิน/404 ของ Next.js**
แทน `Not Found` ดิบจาก middleware = รู้ว่ามีหน้านี้อยู่ · เข้าไม่ได้จริงเพราะติดด่าน `platform_admins`
🚨 **เหตุผลที่รับได้เฉพาะที่นี่: `insep-erp` ชี้ DB ของโรงกลั่นเอง → `/platform` เห็นแค่ tenant ตัวเอง
ไม่ใช่หน้าจอที่คุมลูกค้าคนอื่น** (`requirePlatformAdmin()` คืน service-role client ของ DB ที่ env ชี้เท่านั้น)
ถ้าวันหนึ่ง `insep-erp` ถูกย้ายไปชี้ DB ลูกค้า ต้องถอด flag นี้ทันที

**🪤 กับดักที่เจอจริงตอนตั้ง — 404 มี 2 ตัวที่หน้าตาต่างกันแต่แยกไม่ออกถ้าไม่รู้**

| ตัวไหน | เกิดเมื่อ | หน้าจอที่เห็น |
|---|---|---|
| `middleware.ts:11` | env ไม่ติด | ตัวหนังสือดิบ `Not Found` ล้วน ๆ |
| `lib/platform/auth.ts:50` | env ติดแล้ว แต่ uuid ไม่อยู่ใน `platform_admins` | หน้า 404 มาตรฐานของ Next.js |

→ วิธีแยกที่เร็วที่สุดคือ **ยิงตอนยังไม่ล็อกอิน**: `curl -o /dev/null -w "%{http_code} %{redirect_url}"`
ได้ `307 → /login` = env ทำงานแล้วแน่นอน (middleware ตอบ 404 ก่อนถึง `updateSession` เสมอถ้า flag ไม่ติด)

**🪤 สาเหตุจริงของ 404 รอบนี้: สคริปต์ให้สิทธิ์ลง DB ผิดก้อน**
`platform:grant-admin` ใช้ `--env=.env.local` เป็นค่าปริยาย และไฟล์นั้นชี้ **DB ลูกค้า** (`tnuxr…`)
ส่วน `insep-erp` ชี้ `vmhiw…` → ต้องสั่ง `--env=.env.local.production-backup` เสมอ
🚨 **สคริปต์พิมพ์ ref ของ project ที่บรรทัดแรก — ดูให้ตรงก่อนกด**

**🪤 บัญชีแอดมินต้องเป็นคนละบัญชีกับที่ใช้ทำงานประจำ**
`app/(app)/page.tsx:26` เด้ง platform admin ไป `/platform` ทุกครั้งที่ล็อกอิน → ให้สิทธิ์บัญชีเมน
= เข้าหน้าเลือกพื้นที่ทำงาน (ผลิต/บัญชี/ขาย) ไม่ได้อีกเลย · ใช้บัญชีแยก (`insepadmin`)

**🪤 session ที่ค้างอยู่ตัดสินก่อนเสมอ** — ล็อกอินค้างด้วยยูสเซอร์เมนแล้วเปิด `/platform` จะได้ 404 ทันที
ไม่มีทางไปถึงหน้า login ให้สลับบัญชี → ต้องออกจากระบบก่อน หรือเปิดหน้าต่าง incognito แยก

### D88 — ชำระภาษี: ปุ่มเดียวจบ + เตือนกำหนดยื่นเข้า LINE (0054, 2026-08-31)

**ต้นเรื่อง (ผู้ใช้)**: "เดือนไหนต้องจ่ายภาษี อยากมีปุ่มกดจ่ายแล้วบันทึกรายจ่ายให้เลย"
พร้อมคำถามเปิดว่าจะตั้งค่ายังไง (จ่ายใคร หมวดอะไร จากบัญชีไหน) และกิจการไม่จด VAT จะเป็นยังไง

**สิ่งที่ขาดอยู่จริง ๆ**: ยอดที่ต้องจ่ายคำนวณได้อยู่แล้ว แต่ **ไม่มีที่ไหนในระบบบันทึกว่าจ่ายไปแล้ว**
→ เงินออกจากบัญชีจริงแต่ยอดเงินสดในแอปไม่ขยับ · ไม่มีอะไรกันจ่ายซ้ำงวดเดิม · ไม่มีใครรู้ว่าเดือนไหนยังไม่ได้จ่าย

---

#### ★ สิ่งแรกที่ต้องรู้ก่อนแตะงานนี้: **ภาษี 2 ตัวมี "ปุ่มจ่าย" อยู่แล้ว**

`ภงด.1` (ภาษีเงินเดือน) และ `สปส.1-10` (ประกันสังคม) ถูกบันทึกจ่ายผ่าน **ขาลงบัญชี**
(`pay_post_legs` → `fn_post_payroll`) มาตั้งแต่ **D67**

🚨 **เติมปุ่มจ่าย 2 ตัวนี้ที่หน้าบัญชีอีก = ลงรายจ่ายซ้ำ และไม่มีอะไรใน DB ฟ้อง**
(กลไกเดียวกับที่ `legCoverage()` ของ D67 ถูกสร้างมาเตือน)
→ ขอบเขตงานนี้จึงเหลือ **3 แบบที่หน้าบัญชีเป็นเจ้าของจริง ๆ**: ภพ.30 · ภงด.3 · ภงด.53
มีเทสล็อกไว้ใน `taxPay.test.ts` ว่ารายชื่อต้องเป็น 3 ตัวนี้เป๊ะ

★ **ภงด.3 กับ ภงด.53 เป็นคนละแบบ ยื่นแยก จ่ายแยก** → 2 แถว 2 ใบเสมอ (จุดที่พลาดกันบ่อย)
แต่ตอน**เตือน**รวมเป็นบรรทัดเดียว (ครบกำหนดวันเดียวกัน สร้างจากปุ่มเดียวกัน)

---

#### 🚨 กับดักที่ทำให้ต้องแช่ยอดไว้ในแถวของตัวเอง ห้ามผูก FK ไป `tax_summaries`

`recordTaxSummaryAction` (`app/(app)/accounting/actions.ts:346`) **ลบแถวเดิมทิ้งแล้ว insert ใหม่
ทุกครั้งที่กด "สร้าง ภพ.30"** และหน้าจอยังมีปุ่มลบแถวนั้นให้ผู้ใช้กดเองอีก

→ ผูก FK เมื่อไหร่ ใบจ่ายที่บันทึกไปแล้วจะขาดสาย หรือยอดที่ "จ่ายไปแล้ว" เปลี่ยนตัวเองเงียบ ๆ
→ `tax_payments` เก็บ `amount` (ที่จ่ายจริง) **และ** `computed_amount` (ที่ระบบคำนวณ ณ วันกด) ไว้ในแถวตัวเอง
(ตระกูล D75 — ตัวเงินต้องเป็นค่าที่แช่ไว้ ไม่ใช่ค่าที่คิดใหม่ทุกครั้งที่เปิดดู)

---

#### 🚨 ไม่ลอก idempotency ของเงินเดือนมา เพราะมันมีบั๊กอยู่

`fn_post_payroll` กันซ้ำด้วยการ insert `integration_log` แล้วจับ `unique_violation`
แต่ตอน `fn_unpost_payroll` แค่เปลี่ยน `status` เป็น `'duplicate'` โดย**แถวยังอยู่**
→ **ถอนแล้วลงใหม่ = ไม่เกิดอะไรขึ้นเลย แต่ฟังก์ชันตอบ `ok:true`** (เงินเดือนยังมีอาการนี้อยู่)

ที่นี่กันซ้ำด้วย **partial unique index ของตารางเอง**:
`unique (tenant_id, entity_id, kind, period) where status = 'ปกติ'`
→ ถอนแล้ว (`status='ยกเลิก'`) แถวเก่าเหลือเป็นประวัติ และ**ไม่กันการจ่ายรอบใหม่**
(45.6 ข้อ 4 ในไกด์เทสมีไว้พิสูจน์ข้อนี้โดยเฉพาะ)

---

#### คำตอบของคำถามที่ผู้ใช้ถามมา

| คำถาม | ตัดสิน |
|---|---|
| ตั้งค่าจ่ายใคร/หมวดไหน/บัญชีไหน | **ไม่ทำหน้าตั้งค่าเพิ่ม** — ป๊อปอัพจ่ายคือที่ตั้งค่า แล้ว**จำค่าที่ใช้ครั้งก่อน**ของแบบนั้นมาเติมให้รอบถัดไป (อ่านจากแถวล่าสุดใน `tax_payments`) · ครั้งแรกเติมค่าปริยายจาก `lib/accounting/taxPay` |
| ต้องกดสร้างแบบก่อนไหม | **ใช่ ทั้ง 3 แบบ** — ยอดที่จ่ายต้องเป็นยอดที่ยื่นจริง · บล็อกที่ DB ด้วย (ยิง API ตรงก็ไม่รอด) |
| เบี้ยปรับ/เงินเพิ่ม | **แยกบิลคนละหมวดเสมอ** — เป็นรายจ่ายต้องห้ามที่ต้องบวกกลับตอนคำนวณภาษีเงินได้สิ้นปี รวมหมวดแล้วผู้ทำบัญชีแยกออกมาไม่ได้อีกเลย |
| ใครกดได้ | จ่าย = `acct.write` · **ถอน = `acct.config`** (ถอนแล้วยอดเงินสดขยับย้อนหลัง) |
| คนไปยกเลิกบิลจากหน้าค้นบิล | **แสดงความจริง ไม่ซ่อนและไม่แก้ให้เอง** — อ่าน `transactions.status` มาด้วย ขึ้นป้ายแดง *บิลถูกยกเลิก* แล้วเปิดให้กดจ่ายใหม่ |
| กิจการไม่จด VAT | แถว ภพ.30 **หายไปเลย** ไม่ใช่โชว์แล้วเทา (ไม่มีหน้าที่ยื่นจริง ๆ · D55) · **ภงด.3/53 ยังต้องมีครบ** |
| ขอคืน VAT | **ยังไม่ทำ** (ผู้ใช้ยังไม่มีเคส) — เดือนที่ภาษีซื้อเกินยังยกไปเดือนหน้าเหมือนเดิม |

**คำถามที่ผู้ใช้ถามท้ายสุด — ตอบพร้อมหลักฐานในโค้ด**
> "ถ้าวันหนึ่งภาษีขายเกิน พอกดจ่าย เดือนถัดไปก็เริ่มที่ 0 ให้ ถูกต้องไหม"

**ถูกต้อง แต่ไม่ได้เกิดจากการกดจ่าย** — `taxReport()` (`lib/accounting/calc.ts:330`) คำนวณ
`forwardedVatOut = netPayable < 0 ? |netPayable| : 0` → เดือนที่ต้องจ่าย ยอดยกไปเป็น **0 ตั้งแต่ตอนกดสร้าง ภพ.30**
เดือนถัดไป `previousVat()` จึงอ่านได้ 0 เอง · ปุ่มจ่ายไม่แตะยอดยกไปเลยแม้แต่นิดเดียว
🪤 **นัยที่ตามมา: จ่ายไม่ครบก็ไม่ทำให้ส่วนที่ค้างกลายเป็นเครดิตเดือนหน้า** (ถูกตามหลักภาษี — ที่ค้างคือหนี้ ไม่ใช่เครดิต)

---

#### 🪤 บิลจ่ายภาษีต้องไม่วนกลับเข้ารายงานของเดือนถัดไป

`taxReport` คัดเฉพาะแถว `vat_amount > 0` · `whtReport` คัดเฉพาะ `wht_amount > 0`
→ บิลจ่ายภาษีที่ตั้ง 2 ค่านี้เป็น 0 จึงหลุดทั้งคู่โดยอัตโนมัติ **แต่ไม่มีอะไรบังคับให้เป็นแบบนั้นตลอดไป**
→ ล็อกไว้ใน `fn_pay_tax` (hardcode 0) + ข้อ 45.3 ของไกด์เทสให้ไปสร้าง ภพ.30 เดือนถัดไปมาดูด้วยตา

---

#### เตือนกำหนดยื่นเข้า LINE (ผู้ใช้ขอเพิ่มระหว่างคุย)

เช็กลิสต์ในแอปช่วยได้เฉพาะตอนเปิดแอป — ไม่ได้เข้าเลยทั้งเดือน = เลยกำหนดแล้วค่อยรู้

| เรื่อง | ตัดสิน |
|---|---|
| ช่องทาง | กลุ่ม LINE เดียวกับแอปขาย (`app_settings` ต่อ tenant · D51) |
| เวลา | ล่วงหน้า **3 วัน** จากกำหนดยื่น**กระดาษ** (ภพ.30 วันที่ 15 · ภงด. วันที่ 7 ของเดือนถัดไป) |
| เนื้อหา | 🚨 **ไม่บอกยอดเงิน** (ผู้ใช้สั่ง) — บอกแค่ต้องยื่นอะไร ภายในวันไหน · บอกกำหนด e-Filing ด้วยเสมอ เพราะระบบไม่รู้ว่ากิจการนี้ยื่นแบบไหน (เขียนข้างเดียวแล้วผิด = คำโกหกบนจอ ตระกูล D85) |
| ใครได้ | ภพ.30 = **ทุกเดือนที่จด VAT แม้ไม่มียอด** (ผู้จดทะเบียนต้องยื่นทุกเดือน) · ภงด. = เฉพาะเดือนที่มีการหักจริง · กดสร้างแบบแล้ว = เงียบ |
| กันซ้ำ | `integration_log` action `TAX_REMINDER` key `<entity>-<vat|wht>-<period>` → **ครั้งเดียวต่อแบบต่องวด ตลอดกาล** |

🪤 **ส่งก่อน แล้วค่อยจด** — จดก่อนส่งแล้วส่งพลาด = เตือนหายไปเลย (วันเตือนผ่านไปแล้ว ไม่มีรอบสอง)
ส่งก่อนแล้วจดพลาด = อย่างมากได้ข้อความซ้ำถ้ามีการยิง cron ซ้ำวันเดียวกัน → เลือกอย่างหลัง
→ `sendLineToTenant()` จึง **คืน boolean** ต่างจาก `sendLine()` เดิมที่ silent fail เสมอ

🚨 **`sendLineToTenant(tenantId, …)` เป็นข้อยกเว้นเดียวของกติกา "tenant ต้องมาจาก session เสมอ"** (0033)
เพราะ cron ไม่มีใครล็อกอินให้ถาม → ผู้เรียก**ต้องไล่ `tenantId` มาจากแถวในตาราง `tenants` เอง**
ห้ามรับจาก query string/body/header เด็ดขาด (หลุด = คนนอกสั่งยิงข้อความเข้ากลุ่มลูกค้ารายไหนก็ได้)

🪤 **middleware เด้ง request ที่ไม่มี session ไป `/login`** → ถ้าไม่ยกเว้น `/api/cron/*`
cron จะได้ **200 พร้อม HTML ของหน้า login** = งานเงียบหายโดยไม่มี error ให้เห็น
→ ยกเว้นใน `middleware.ts` แล้วให้ route ตรวจ `CRON_SECRET` เอง · **ไม่ตั้ง secret = ตอบ 503 ปิดตาย ไม่ใช่เปิดฟรี**

🚨 **ไม่เลื่อนวันหยุดราชการให้** — ระบบไม่มีปฏิทินวันหยุดไทย
การเดาว่าเลื่อนไปวันทำการถัดไปแล้วเตือนช้าลง อันตรายกว่าเตือนเร็วไป 1-2 วัน (กติกาเดียวกับ D78: ไม่รู้ ≠ เดาให้)

---

#### ที่จงใจไม่ทำ (อย่าเผลอ "ปรับปรุง")

- **ไม่ทำ RPC ที่คำนวณยอดภาษีเองใน SQL** — ยอดถูกส่งมาจากฝั่ง TS ที่มี golden test คุม
  ให้ SQL คิดเองเมื่อไหร่ = **สูตรเงินมี 2 ที่** (กลไกที่ทำให้ D79 เกิด)
- **ไม่มี policy สำหรับเขียน `tax_payments`** — เขียนผ่าน RPC (definer) เท่านั้น
  🚨 เหตุผล: `for all` ครอบ SELECT ด้วย และ policy permissive ถูก **OR** กัน → policy เขียนที่กว้างกว่า
  จะทับเงื่อนไขขอบเขตกิจการของ policy อ่าน (บทเรียน D85/0052 ที่ใบ 50ทวิ ของคู่ค้ารั่วให้ฝ่ายเงินเดือน)
- **ไม่ผูก `disabled=` ของปุ่มเข้ากับ `blocked` ให้เป็นตัวเดียวกัน** — `blocked` เป็นแค่คำอธิบาย
  ตัวจริงคือ `canPay()` ที่ทั้งหน้าจอและ server action เรียก (กติกา D83)

#### ข้อจำกัดที่รับไว้แล้ว (ยังไม่แก้ — จดไว้กันคนมาเจอแล้วตกใจ)

- ผู้ใช้ **แก้ยอดบิลจ่ายภาษี**จากหน้าค้นบิลได้ แล้ว `tax_payments.amount` จะไม่ตาม
  (ตรวจแค่ `status`) — เลือกไม่ล็อกบิลไว้ เพราะกติกาเหล็กของ repo คือทุกอย่างต้องแก้จากแอปได้
- ยกเลิก**เฉพาะบิลเบี้ยปรับ** จากหน้าค้นบิล การ์ดจะยังขึ้น "จ่ายแล้ว" (ดูแค่บิลตัวภาษี)


#### 🔬 เทสในเบราว์เซอร์จริง (2026-08-31 · tenant `demoprov` · งวด ก.ย. 2569)

**build/lint/test ผ่านหมดก่อนเทส แล้วยัง เจอบั๊ก 4 ตัว** (2 ตัวเป็นทางตันที่ผู้ใช้เดินเข้าไปแล้วออกไม่ได้)
สร้างบิลจริงผ่านหน้าจอ 5 ใบ แล้วไล่ทุกลูปจนจบ

**🔴 (1) บิลถูกยกเลิกจากหน้าค้นบิล = ทางตัน กดอะไรไม่ได้เลยทั้งแถว**

หน้าจอเขียนว่า *"ถือว่ายังไม่ได้จ่าย กดบันทึกจ่ายใหม่ได้"* + ปุ่มกดได้จริง → กดแล้วเด้งแดง
*"งวดนี้บันทึกการจ่ายไปแล้ว"* และ **ปุ่มถอนการบันทึกจ่ายก็หายไปด้วย** (เงื่อนไขเดิม `done = payment && !billVoided`)

🚨 สาเหตุ: **"จ่ายแล้ว" มี 2 นิยามที่ไม่ตรงกัน** — ฝั่งหน้าจอถือว่าบิลถูกยกเลิก = ยังไม่จ่าย
แต่ฝั่ง DB กันด้วย partial unique index ที่ดูแค่ `tax_payments.status` ซึ่งยังเป็น `'ปกติ'`
(ตระกูล D81: หน้าจอประกาศกฎหนึ่ง โค้ดทำอีกอย่าง)

แก้: `canPay` เป็น false เมื่อมีแถวจ่ายอยู่ **ไม่ว่าบิลจะถูกยกเลิกหรือไม่** · เพิ่ม `canUnpay()`
ที่ **รวมกรณีบิลถูกยกเลิก** (นั่นคือทางออกเดียว) · ข้อความบอกขั้นตอนตรง ๆ ว่าต้องถอนก่อน
🪤 **ทุกครั้งที่ปิดปุ่ม ต้องตอบให้ได้ว่า "แล้วผู้ใช้ต้องกดอะไรแทน"** — ไม่มีคำตอบ = ทางตัน

**🔴 (2) เตือน ภงด. ไม่เคยทำงานเลยใน 5 จาก 12 เดือน — และเงียบสนิท**

`const to = \`${months[0]}-31\`` → เดือนที่มี 30 วันได้ `2026-11-31` ซึ่ง**ไม่มีอยู่จริง**
→ Postgres คืน `22008 date/time field value out of range` → `data` เป็น `null` →
`whtSet` ว่าง → **ไม่เตือน ภงด. เลยทั้งเดือน** (เม.ย./มิ.ย./ก.ย./พ.ย./ก.พ.)
และโค้ดไม่ได้อ่าน `error` เลย จึงไม่มีอะไรฟ้อง

🪤 **`-31` ต่อท้ายเดือนคือกับดักคลาสสิก** — ปลายช่วงต้องเป็น "วันที่ 1 ของเดือนถัดไป + `lt`"
🚨 **อ่านไม่ได้ ≠ ไม่มีข้อมูล** — ต้องรายงาน error ออกมา ไม่ใช่ปล่อยผ่านเป็นเซตว่าง
(ตระกูลเดียวกับ D85 ที่ "อ่านไม่ได้ใน RLS = ลิสต์ว่าง ไม่ใช่ error")

**🟡 (3) ยอด "ยกไปเดือนหน้า" โชว์ค่าที่คำนวณสด ทั้งที่ค่าที่มีผลจริงคือค่าที่แช่ไว้**

เดือน ส.ค. ยื่นไว้ยกไป **658.46** (และเดือน ก.ย. ก็อ่านค่านี้ไปเป็น "ภาษีซื้อยกมา" จริง ๆ)
แต่บนจอขึ้น **629.02** เพราะคำนวณสดจากบิลปัจจุบัน (มีบิล POS เพิ่มเข้ามาหลังวันที่ยื่น)
→ เลขในการ์ดไม่ตรงกับตาราง *ประวัติยอด ภพ.30* ที่อยู่ในหน้าเดียวกัน
(ตระกูล D75 เป๊ะ — **ตัวเงินต้องเป็นค่าที่แช่ไว้เสมอ**) → เพิ่ม `summaryCarry` เข้า input

**🟡 (4) ข้อความ "ต่างจากยอดที่ยื่นไว้" โผล่ทั้งที่ยังไม่เคยยื่น**

เดือนที่ยังไม่กดสร้าง ภพ.30: `amount` = 0 · `live` = 391.54 → `drifted` เป็น true
→ ขึ้นว่า *"ต่างจากยอดที่ยื่นไว้ (มีการแก้บิลหลังสร้าง ภพ.30)"* ทั้งที่**ไม่เคยสร้างเลยสักครั้ง**
และป้ายขึ้น *"ไม่มียอด"* คู่กับ *"ยอดต้องชำระ 0.00"* ทั้งที่มียอด 391.54 รออยู่

แก้: `drifted` เป็นจริงได้เฉพาะเมื่อ `filed` · เพิ่มป้ายสถานะ **`ยังไม่ได้สร้างแบบ`**
และเปลี่ยนบรรทัดยอดเป็น *"ยอดจากบิลตอนนี้ … — กดสร้างแบบเพื่อยืนยันยอดที่จะยื่นและจ่าย"*
★ ย้ายการตัดสินป้ายไปไว้ใน `badge` ของ lib (มีเทสคุม) แทนที่จะเขียน ternary ซ้อนใน component
(บทเรียน D84 — ternary ไล่เช็คใน component คือที่ที่ของใหม่ตกหล่นเงียบ ๆ)

**🔴 (5) พนักงานบัญชีอ่าน/เขียน `report_runs` ไม่ได้เลย — บั๊กเก่าจาก D85 (migration 0055)**

ล็อกอินเป็น `testaccounting` แล้วพบว่า:
· เช็กลิสต์ขึ้น *"ยังไม่ได้สร้าง"* ตลอดกาล ทั้งที่เจ้าของกิจการกดสร้างไปแล้ว
· กดสร้างแบบ → **ไม่มีแถวลง `report_runs` เลย** และไม่มี error ให้เห็น
· และเพราะ D88 ผูกกฎ *"ต้องสร้างแบบก่อนถึงจะจ่ายได้"* กับตารางนี้ →
  **ปุ่มบันทึกจ่ายถูกล็อกถาวรสำหรับทุกบทบาทฝ่ายบัญชี**

🚨 สาเหตุ: migration **0051** (D85) ใส่ `report_runs` ไว้ในลูป *"ตารางฝั่งผลิต"*
→ policy เป็น `has_cap(prod.read)` / `prod.write` เท่านั้น
แต่ตารางนี้เก็บ **2 โดเมนปนกัน**: ฟอร์ม ภส. (ผลิต) + `phor_por_30`/`pnd_3_53` (บัญชี)

🪤 **`rolesSql.test.ts` จับไม่ได้** — มันตรวจว่า `ROLE_CAPS` ตรงกับ `has_cap()` เท่านั้น
**ไม่ได้ตรวจว่าตารางไหนควรเปิดให้ cap ไหน** · เจอได้ทางเดียวคือล็อกอินเป็นบทบาทนั้นแล้วใช้จริง
(เหตุผลเดียวกับที่ D85 ต้องไล่เทสครบ 9 บทบาท)

🪤 **บั๊กซ้อนที่เจอตอนแก้**: `markReportRunAction` คืน error มาให้อยู่แล้ว แต่ `TaxDocsTab`
**ไม่เคยอ่านค่าที่คืนมา** และฝั่ง ภงด. ยังติ๊กเช็กลิสต์เองใน client (`setRuns(...)`)
→ DB ปฏิเสธการเขียน แต่หน้าจอขึ้นว่า "สร้างล่าสุด วันนี้" = **หน้าจอโกหกทับบั๊กอีกชั้น**
→ อ่านผลจริงแล้วขึ้นข้อความระดับ **warn (เหลือง)** ว่า *"ออกรายงานแล้ว แต่ติ๊กเช็กลิสต์ไม่สำเร็จ"*
· เลิกติ๊กเองฝั่ง client เปลี่ยนเป็นอ่านกลับจากเซิร์ฟเวอร์ (🚨 **สำเร็จบางส่วน ≠ สำเร็จ** · D79/D86)

**ที่พิสูจน์แล้วว่าถูก (2 ทิศทาง ไม่ใช่แค่ซ่อนแล้วผ่าน)**

| เรื่อง | หลักฐาน |
|---|---|
| เงินออกจริง | ยอด *บัญชีทดสอบ* สิ้น ก.ย. −284,725.00 → สิ้น ต.ค. −285,116.54 = **ต่างกัน 391.54 พอดี** |
| บิลไม่วนกลับเข้ารายงาน | สร้าง ภพ.30 ของ **ต.ค.** แล้วภาษีซื้อ = **0.00** · ภงด. ค้างออกใบ = **0 ใบ** |
| ยกไป → เริ่มใหม่ที่ 0 | งวด ก.ย. `ต้องชำระ 391.54` · `ยกไป 0.00` → งวด ต.ค. `ยกมา 0.00` |
| กันจ่ายซ้ำ | เปิด 2 แท็บ · แท็บที่ค้างกดจ่าย → เด้งแดง **ไม่มีบิลใบที่ 2** |
| เบี้ยปรับแยกใบ | ได้ 2 บิล: `ภงด.3 งวด ก.ย. 2569` 300 (*ภาษีหัก ณ ที่จ่ายนำส่ง*) + 20 (*เบี้ยปรับ/เงินเพิ่มภาษี*) |
| ★ ถอนแล้วจ่ายใหม่ได้จริง | ถอน → บิลเป็น `ยกเลิก` → จ่ายใหม่ได้ **บิลใหม่จริง** (กับดักที่ `fn_post_payroll` ยังติดอยู่) |
| ไม่จด VAT | EID02 → เช็กลิสต์เหลือ 1 · การ์ดเหลือ 2 แถว · **แถว ภพ.30 หายไปเลย** · ภงด. ครบ |
| cron | 12/10 → ภพ.30 งวด ก.ย. · 4/11 → **ภงด.3/53 บรรทัดเดียว** · งวดที่สร้างแบบแล้วเงียบ · ยิงซ้ำไม่ส่งซ้ำ · ไม่มี header = **401** (ไม่ใช่ HTML หน้า login) |

**ยังไม่ได้พิสูจน์ในรอบนี้** (บอกไว้ตรง ๆ)
· **ยิง LINE จริง** — ยังไม่มี tenant ไหนตั้งโทเคนไว้ · เทสได้แค่ `?dry=1` + ด่าน 401
  (การกันส่งซ้ำพิสูจน์ด้วยการใส่แถว `integration_log` เองแล้วยิงซ้ำ → เงียบตามคาด)
· **หน้ากระดาษ PDF ของแบบ** — เบราว์เซอร์ที่ใช้เทสบล็อกหน้าต่างพิมพ์

**🪤 ข้อสังเกตด้านความเร็ว (ไม่ใช่บั๊ก แต่ต้องรู้)**: การ์ดโหลดใหม่ ~2-4 วินาที เพราะ
`getTaxPayBoard` ดึง `transactions` **ทั้ง tenant** เหมือนที่รายงานภาษีตัวอื่นทำอยู่แล้ว
ทุกครั้งที่จ่าย/ถอน 1 ครั้งจะโหลดใหม่ 1 รอบ — โตขึ้นเมื่อไหร่ต้องกลับมาดูตามข้อ 4.8 ของ NEXT_STEPS

**ไฟล์**: `lib/accounting/taxPay.ts` (golden **A17** 35 เทส) · `lib/accounting/taxReminder.ts` (golden **A18** 17 เทส) ·
`app/(app)/accounting/_components/TaxPayCard.tsx` · `app/api/cron/tax-reminder/route.ts` ·
migration **0054** · seed `supabase/seed/seed_taxpay.sql` · ชุดเทส `docs/TESTING.md` ส่วนที่ 46


### D89 — อ่านข้อมูลไม่สำเร็จต้องฟ้อง + เลขใบเสร็จของผู้ไม่จด VAT (0056, 2026-09-01)

**ต้นเรื่อง**: ของค้าง 2 ข้อที่แจ้งผู้ใช้ไว้ตรง ๆ ตอนจบ D86 แล้วผู้ใช้สั่งให้ทำต่อ

---

## ข้อ 1 — "query พังแล้วผู้ใช้เห็นเป็น *ไม่มีข้อมูล*"

ต้นเรื่องคือ `searchBills` ทิ้ง `error` แต่พอไล่จริงพบว่าเป็น**แพตเทิร์นทั่วทั้งชั้นอ่าน — 82 จุด ใน 6 ไฟล์**
(accounting 18 · payroll 19 · production 21 · sales 12 · excise 8 · settings 4)

🚨 **จุดที่หนักที่สุดไม่ได้อยู่ในบัญชี/ขาย** (ซึ่งเป็นขอบเขตที่ผู้ใช้เลือกไว้ตอนแรก) →
เอาข้อมูลนี้กลับไปถามใหม่ แล้วเปลี่ยนเป็น **เรียงตามความอันตราย ข้ามโดเมน**:

| จุด | ผลเมื่อพังเงียบ ๆ |
|---|---|
| `production/excise-data.ts` (6 จุด) | **ฟอร์ม ภส. ที่ยื่นสรรพสามิตขาดแถว / ยอดเป็น 0** แล้วยื่นออกไปโดยไม่มีใครรู้ |
| `payroll/data.ts:452,461` · `accounting/data.ts:494` · `payroll/actions.ts` (`fn_wht_doc_nos`) | `existingDocNos` ว่าง → **ออกเลข 50ทวิ ซ้ำเลขเดิมที่อยู่ในมือคู่ค้า/พนักงานแล้ว** |
| `payroll/data.ts:418` | **ภงด.1 / สปส.1-10 ยื่นขาดพนักงาน** |
| `accounting/data.ts` `getTaxReportBundle` | ภาษีซื้อยกมาหายทั้งก้อน → **ยอด ภพ.30 ที่ยื่นผิด** |
| `getTaxPayBoard` (D88 เพิ่งเพิ่มมา) | `tax_payments` ว่าง → `canPay` กลับเป็น true → **จ่ายภาษีซ้ำ** |
| `production/data.ts:67` | `log_ferment` ว่าง → **เลข batch วนกลับไป 1 → ชน batch เดิม** (กติกาเหล็ก 1 batch = 1 แถว) |
| `getBalances`/`getStatement` | ยอดยกมาหาย → ยอดคงเหลือทุกบัญชีและ running balance ผิด |
| `lib/platform/billing-db.ts` | ลูกค้าที่จ่ายแล้วขึ้นว่า "ยังไม่ได้ตั้งค่างวด" · `periods_paid` รีเซ็ตเป็น 1 |

★ **บทเรียนนี้ถูกจดไว้ในโปรเจกต์แล้ว 2 รอบ** — D85 (*"อ่านไม่ได้ใน RLS = ลิสต์ว่าง ไม่ใช่ error"*)
และ D88 บั๊กที่ 2 (*cron เตือน ภงด. ไม่เคยทำงานใน 5/12 เดือนเพราะ `2026-11-31` แล้วไม่มีใครอ่าน `error`*)
→ งานนี้คือ **ทำให้กติกาที่จดไว้แล้วมีผลจริงทั้งระบบ ไม่ใช่ค้นพบเรื่องใหม่**
🪤 **จดบทเรียนไว้ไม่ได้แปลว่าแก้แล้ว** — ต้องมีกลไกที่ทำให้ทำผิดซ้ำไม่ได้ ถึงจะนับว่าปิด

### กลไก

**`mustRead()` ใน `lib/shared/dbError.ts`** — ยึดแพตเทิร์น `fetchAllRows` (`lib/shared/paginate.ts`)
ที่ throw อยู่แล้วพร้อมเหตุผลว่า *"ถ้าได้ไม่ครบให้ throw ดีกว่าปล่อยเลขผิดไปขึ้นรายงานภาษี"*
· รับ `label` ต่อจุดเรียก → ผู้ใช้รู้ว่า **อะไร** โหลดไม่สำเร็จ
🪤 **`data: null` ที่ไม่มี error ต้องไม่ throw** — `.maybeSingle()` ไม่เจอแถวเป็นเรื่องปกติ คนละเรื่องกับ "พัง"

**ขยาย `mapDbError`** — SQLSTATE ที่ map ไว้เป็นของฝั่ง**เขียน**ล้วน (`23505` ซ้ำ · `23503` FK …)
โค้ดที่เจอตอน**อ่าน**พังไม่มีสักตัว จึงตกไป `default` แล้วขึ้นอังกฤษดิบให้ผู้ใช้ที่เขียนโค้ดไม่ได้
→ เพิ่ม `42P01` ตารางไม่มี · `42703` คอลัมน์ไม่มี · **`22008` วันที่ไม่ถูกต้อง (เคสจริงของ D88)**
· `57014` timeout · `PGRST103`

### 🚩 กฎเหล็กของงานนี้: แก้ data กับ UI ต้องมาคู่กันเสมอ

ทุกแท็บโหลดผ่าน read-action ใน `useEffect` **ไม่ใช่** server component
และทั้งแอปมี `.catch()` อยู่ **จุดเดียว** (`print.ts` เรื่องฟอนต์)

> **ทำให้ `data.ts` throw โดยไม่แก้ UI คู่กัน = หน้าค้างที่ "กำลังโหลด…" ตลอดกาล ซึ่งแย่กว่าลิสต์ว่างเดิม**
> (`setLoading(false)` อยู่ใน `.then` ที่ไม่มีวันถูกเรียก · `app/(app)/error.tsx` จับ unhandled rejection ไม่ได้)

**`useRead()` + `<LoadError>` ใน `lib/shared/ui.tsx`**
- เก็บข้อมูลก้อนล่าสุดไว้ **ไม่ล้างทิ้งตอน error** — คนที่กำลังดูอยู่ต้องไม่เสียของ
- `loading` เฉพาะครั้งแรก · รอบถัดไปโชว์ของเดิมค้าง (คงพฤติกรรมเดิมของทุกแท็บ)
- 🪤 **Next.js ปิดบังข้อความ error ของ server action ใน production** (เหลือแต่ digest)
  → แสดงข้อความไทยของเราเอง **อย่าพยายามโชว์ข้อความจากเซิร์ฟเวอร์**
- ★ แท็บที่ `refresh()` ถูกปุ่มบันทึกเรียกด้วย (ขาย 4 แท็บ · เงินเดือน 2) คง `refresh()` ไว้แล้วเติม
  `.catch` + `<LoadError>` แทน — บังคับให้เข้า hook จะต้องรื้อ callback ของปุ่มบันทึกไปด้วยโดยไม่จำเป็น

### 🚨 จุดที่ตั้งใจ **ไม่** แตะ (ทนพังโดยเจตนา)

| จุด | เหตุผล |
|---|---|
| `accounting/data.ts` `if (!so.error)` | ลูกค้าที่ไม่ได้ซื้อโมดูลขายอ่าน `sales_orders` ไม่ได้ตาม RLS · throw = หน้าลูกหนี้-เจ้าหนี้พังทั้งหน้าสำหรับคนที่ซื้อแค่บัญชี · **มีเทสล็อกไว้** |
| `profiles.role` ทุกจุด · `lib/shared/guard.ts` | fail-closed → `viewer` |
| `lib/shared/tenant-plan.ts` | fail-open → `ALL_MODULES` **โดยตั้งใจ** (ธงแพ็กเกจ ไม่ใช่ขอบเขตความปลอดภัย) |
| `lib/line.ts` | silent fail ตามกติกา CLAUDE.md |
| `getTaxPayBoard` `is_vat ?? true` | fail-open ให้ตรงกับ `entity_is_vat()` ฝั่ง SQL (0036) — **ห้ามเปลี่ยนข้างเดียว** |

⚠️ `loadTaxAccounts` มี fallback `["บัญชีบริษัท"]` ที่**ดูปลอดภัยแต่ไม่ใช่** — โรงที่ตั้งชื่อบัญชีอื่น
จะถูกกรองออกหมดจน ภพ.30 = 0 → จุดนี้ **ต้อง throw** (อยู่ในกลุ่มที่แก้แล้ว)
🪤 บทเรียน: **fallback ที่ดูสมเหตุสมผลคือที่ซ่อนตัวได้ดีที่สุด** — ต้องถามว่า
"ค่าปริยายนี้ทำให้ผลลัพธ์*ผิด*ได้ไหม" ไม่ใช่แค่ "มีค่าปริยายไหม"

### เทสที่กันไม่ให้กลับมา

`lib/shared/readGuard.test.ts` — **อ่านซอร์สจริงมาตรวจ** ว่าไฟล์ชั้นอ่านที่ไล่แล้วไม่เหลือ
`const { data } =` ที่ไม่ผ่าน `mustRead` · ALLOW มีได้เฉพาะจุดที่เขียนเหตุผลกำกับ
· ★ **พิสูจน์แล้วว่าจับได้จริง** — ใส่บรรทัดที่ทิ้ง error กลับเข้าไปแล้วเทสแดงทันที
+ ข้อ "ไฟล์ต้องเรียก `mustRead` จริง" กันเทสผ่านเพราะไม่มี query เลย

---

## ข้อ 2 — เลขใบเสร็จของกิจการที่ไม่จด VAT (migration 0056)

D86 แก้ไปครึ่งเดียว (เส้นทางจ่ายเต็ม) ไล่ดูรอบนี้พบว่าเหลือ **2 จุด ไม่ใช่จุดเดียว**:
ใบเสร็จค่ามัดจำได้เลข**ว่าง** (`print.ts` อ่าน `taxNo1` ที่ผู้ไม่จด VAT ห้ามมี)
· ใบเสร็จยอดค้าง**ซ้ำเลขใบแจ้งหนี้** (fallback ไป `invNo`)

**โมเดล: `rcpt_no1`/`rcpt_no2` เป็นคู่ขนานของ `tax_no1`/`tax_no2`** — ช่องรับเงินมี 2 ช่องเท่ากันทั้งสองโลก
ต่างแค่คอลัมน์ที่ไปลง และผู้ไม่จด VAT ใช้เลขชุด `INV`

| เอกสาร | จด VAT | ไม่จด VAT |
|---|---|---|
| ใบแจ้งหนี้ / ใบส่งของ | `inv_no` | `inv_no` |
| ใบแจ้งหนี้ค่ามัดจำ | `dep_inv_no` | `dep_inv_no` |
| ใบเสร็จรับเงินครั้งแรก | `tax_no1` | **`rcpt_no1`** |
| ใบเสร็จรับเงินยอดค้าง | `tax_no2` | **`rcpt_no2`** |

🚨 **ไม่แก้ trigger `block_tax_invoice_non_vat` (0036) ให้ผู้ไม่จด VAT ใส่ `tax_no*` ได้** —
นั่นคือด่านกฎหมาย ม.86/13 ที่ตั้งใจให้แข็ง · คอลัมน์ใหม่เป็นคนละช่องจึงไม่โดน trigger
· มีเทสคู่ positive/negative ใน `tests/tenant/vat-branching.test.ts` ยืนยันว่า
**ตั้ง `rcpt_no*` ได้ แต่ `tax_no*` ยังถูกปฏิเสธเหมือนเดิม**

🪤 `neededSerials` สาขาไม่จด VAT **ต้องคิดจาก `order.rcptNo*` ไม่ใช่ `taxNo*`** — `taxNo*` ว่างเสมอ
(trigger ห้ามใส่) ถ้าเผลอดูช่องเดิมจะเป็น "ยังไม่มีเลข" ตลอดกาล = **ขอเลขใหม่ทุกครั้งที่กด กินเลขรันฟรี**

★ **D86 เคยแก้ด้วยการ "ยืมช่อง `inv`"** ให้ใบเสร็จจ่ายเต็ม — รอบนี้ถอดออกเพราะใบเสร็จมีช่องของตัวเองแล้ว
· เทสที่ล็อกกลไกยืมช่องไว้ถูกแก้พร้อมกัน (เป็นเทสที่ล็อก *วิธีแก้ชั่วคราว* ไม่ใช่ *พฤติกรรมที่ถูก*)
· `print.ts` คง `|| order.invNo` ท้ายโซ่ไว้ให้ใบเก่าที่ออกก่อน D89 พิมพ์ซ้ำได้เลขเดิม

**หลักฐานว่าเส้นทางจด VAT ไม่ขยับ**: `neededSerials` ถูกรื้อเป็นโมเดล "ช่องรับเงิน 2 ช่อง"
→ เพิ่ม **ตารางล็อกครบทั้ง 7 action** ใน `orders.test.ts` (ค่าที่คัดจากพฤติกรรมก่อน D89 ทุกช่อง)
ซึ่งแข็งแรงกว่า "เทสเดิมไม่ถูกแก้" · golden S1-S10 · A17 · A18 ผ่านโดยไม่แก้ไฟล์เทส

**migration 0056** ยก `fn_apply_order_action` จาก `0051:447` มา**ด้วยสคริปต์ ไม่พิมพ์มือ**
(กันบทเรียน D79) แล้ว `diff` เทียบกับต้นฉบับเพื่อยืนยันว่าต่างแค่ 3 บรรทัดที่ตั้งใจ
· signature ไม่เปลี่ยน → `create or replace` ทับได้ ไม่เกิด overload (กับดัก D69)

---

**ไฟล์**: migration **0056** · `lib/shared/dbError.ts` (+`mustRead` +SQLSTATE ฝั่งอ่าน) + `dbError.test.ts` (15) ·
`lib/shared/ui.tsx` (+`useRead` +`<LoadError>`) · `lib/shared/readGuard.test.ts` (5 · อ่านซอร์ส) ·
data 5 ไฟล์ + `accounting/actions.ts` + `payroll/actions.ts` + `lib/platform/billing-db.ts` ·
แท็บ 12 ตัวใน 4 โดเมน · `lib/sales/orders.ts` + `calc.ts` (`taxDocNo` chain) + `orders.test.ts` ·
`app/(app)/sales/actions.ts` · `print.ts` · `types.ts` · `PosTab.tsx` · `tests/tenant/vat-branching.test.ts` ·
build/lint/test **845** ผ่าน · ชุดเทส `docs/TESTING.md` ส่วนที่ 45

**ที่ตั้งใจไม่ทำรอบนี้** (จดใน NEXT_STEPS): ชั้นอ่านของ production ส่วนติดตาม/กราฟ · `settings-data.ts`
· `payroll` ส่วนรายชื่อ/งวด (เงียบแล้วแค่ลิสต์ว่าง ไม่ทำให้เอกสารราชการหรือเลขที่ผิด)
· `useSaver` ไม่มี try/catch (ฝั่งเขียน คนละเรื่อง) · `fn_pay_tax`/`fn_unpay_tax` ไม่เช็ค `my_entities()`

---

### D90 — ยกเลิกออเดอร์แล้วต้องไม่ไปโผล่บนฟอร์มสรรพสามิต (0057, 2026-09-01)

**ต้นเรื่อง**: ผู้ใช้เอา PDF ฟอร์ม ภส. 5 ใบที่ได้จากรอบเทสไปตรวจกับตาตัวเอง แล้วทักว่า
ตัวเลขบน **ภส.๐๗-๐๒/๑(๒)** และ **ภส.๐๗-๐๔** ไม่ตรงกับที่ควรเป็น — เพราะออเดอร์ที่ยกเลิกไป
ถูกแสดงเป็น *จ่าย 4 ขวด* แล้ว *รับคืน 4 ขวด* ครบคู่ ทั้งที่สุทธิแล้วไม่มีอะไรเกิดขึ้นเลย

ตอนนั้นผมอธิบายว่านั่นคือพฤติกรรมที่ถูกต้อง (บันทึกตามจริง) — **ผู้ใช้ไม่เห็นด้วย และผู้ใช้ถูก**:
เอกสารชุดนี้ไม่ได้มีไว้เล่าเหตุการณ์ แต่มีไว้ให้เจ้าหน้าที่สรรพสามิตกระทบยอด
แถวที่หักล้างกันเองในวันเดียวกันจึงเป็น *เสียงรบกวนที่ทำให้คนอ่านต้องมานั่งไล่ว่าตกลงขายไปเท่าไร*

> 🚩 **บทเรียนของงานนี้ไม่ใช่เรื่องโค้ด** — "บันทึกตามจริงทุกแถว" เป็นกติกาที่ถูกสำหรับ *ฐานข้อมูล*
> แต่ **ฟอร์มที่ยื่นราชการไม่ใช่ฐานข้อมูล มันคือเอกสารที่มีคนต้องอ่านแล้วเชื่อ**
> ผมเอากติกาของชั้นข้อมูลไปตอบคำถามของชั้นเอกสาร แล้วยืนยันว่าถูกทั้งที่ผู้ใช้ทักแล้ว

---

**กติกาที่ผู้ใช้ตัดสิน — ตัดสินจาก "ออกรายงานไปหรือยัง" ไม่ใช่ "เดือนเดียวกันไหม"**

ผมเสนอกฎ "ยกเลิกในเดือนเดียวกัน = ซ่อน" ผู้ใช้แก้ให้เป็น:

> *"ถ้าของเดือนนั้นยังไม่ออกรายงานก็ไม่เป็นไร ถ้าออกรายงานแล้วให้ถือว่าสรุปบัญชีสุราไปแล้ว
> การยกเลิกจะไม่แก้ไขฟอร์มที่ออกไปแล้ว … เพราะรายงานสรรพสามิตส่งได้ภายในวันที่ 15 ของเดือนถัดไป"*

ซึ่งถูกกว่าที่ผมเสนอชัด ๆ — ยกเลิกวันที่ 3 ต.ค. ของบิลเดือน ก.ย. **ยังทัน**ถ้ายังไม่ได้ยื่น
กฎตามปฏิทินจะบังคับให้แถวโผล่ทั้งที่แก้ทันสบาย ๆ · แหล่งความจริงคือ `report_runs` ที่มีอยู่แล้ว
(ตารางเช็กลิสต์ฟอร์มรายเดือนจาก D42) ไม่ต้องสร้างสถานะใหม่

🚨 **ตัดสิน ณ ตอนกดยกเลิก แล้วแช่ผลไว้ในคอลัมน์ — ห้ามไปตัดสินตอนเปิดดูฟอร์ม**
ถ้าคิดสดตอน render พอเดือนนั้นถูกออกรายงาน*ทีหลัง* แถวที่หายไปแล้วจะโผล่กลับมาเอง
= ฟอร์มเปลี่ยนย้อนหลังอีกแบบหนึ่ง ซึ่งคือสิ่งที่กฎข้อนี้ตั้งใจกันตั้งแต่แรก
(ตระกูลเดียวกับ D75 *ตัวเงินต้องเป็นค่าที่แช่ไว้เสมอ* และ D69 *`taxableIncome` ต้องแช่ใน `computed`*)

**ดูทั้งเดือนที่ขายและเดือนที่ยกเลิก** — ขาย ก.ย. ยื่น ก.ย. แล้ว คืนของ ต.ค. → ต้องโชว์ทั้งคู่
(ก.ย. โชว์จ่าย · ต.ค. โชว์รับ = ความจริงของทั้งสองเดือน) จึงเช็ค `month in (v_sale_month, v_now_month)`

---

**ขอบเขต — ซ่อนเฉพาะ "ฟอร์ม" ห้ามลามไปสต็อก**

`excise_hidden` ถูกอ่านที่เดียวคือชั้นที่ประกอบฟอร์ม ภส. (`production/excise-data.ts`)
🚨 **`stock_product` ยังคิดจากทุกแถวเหมือนเดิม — trigger ไม่ถูกแตะแม้แต่บรรทัดเดียว**
ถ้าเผลอกรองที่ trigger ด้วย ของจะหายจากสต็อกจริงโดยไม่มีอะไรฟ้อง (บทเรียน D82 เป๊ะ ๆ)
หน้าสต็อก/ประวัติในแอปก็ยังเห็นครบตามจริง — ผู้ใช้ต้องตามรอยของตัวเองได้เสมอ

★ **ซ่อนเป็นคู่ที่หักล้างกันพอดีเสมอ** (`ref_no` เดียวกันทั้งขาขายและขาคืน) → ยอดคงเหลือบนฟอร์ม
ยังตรงกับสต็อกจริงทุกกรณี ต่อให้ซ่อนไปกี่คู่ก็ตาม · พิสูจน์ในเบราว์เซอร์แล้ว: รับ 6→5 · จ่าย 6→5 · **สุทธิเท่าเดิม**

---

**`ref_no` — เลิกให้รายงานไปแกะเลขออเดอร์จากข้อความหมายเหตุ**

ของเดิมจับคู่ขาย↔ยกเลิกได้ทางเดียวคืออ่านสตริง `'ลูกค้า: … (ORD…)'` กับ `'คืนสต็อก: ยกเลิกออเดอร์ …'`
🪤 **หมายเหตุมีข้อความที่ผู้ใช้แก้ได้ปนอยู่** (กับดักเดียวกับที่ D78 เจอเรื่องความกว้างกระดาษ)
→ คอลัมน์ `log_product.ref_no` เขียนโดย RPC ทั้งสองฝั่ง · backfill จากหมายเหตุ **ครั้งเดียวตอนติดตั้ง**

🚨 **ไม่ backfill `excise_hidden` ย้อนหลัง** — ฟอร์มของเดือนที่ผ่านมาอาจยื่นไปแล้ว
การไปซ่อนแถวเก่าตอนติดตั้ง migration = แก้ฟอร์มที่ยื่นไปแล้ว ซึ่งเป็นสิ่งที่งานนี้ตั้งใจกัน
ของเก่าจึงยังโชว์คู่ จ่าย/รับ ตามเดิม · กฎใหม่มีผลกับการยกเลิกนับจากนี้ไปเท่านั้น
(มีเทสนับจำนวน `update log_product set excise_hidden` ในไฟล์ SQL ว่าต้องมี **จุดเดียว** คือในตัว RPC)

---

**เทสที่อ่านซอร์ส/SQL จริงมาตรวจ** (`lib/production/exciseHidden.test.ts` · 9 เทส)

กติกานี้กระจายอยู่ 2 ฝั่งที่ TypeScript มองไม่ทะลุถึงกัน — `fn_cancel_order` แช่ค่า · `excise-data.ts` เชื่อค่า
**หลุดฝั่งใดฝั่งหนึ่งไม่มี error ทั้งคู่ ฟอร์มก็แค่ผิดเงียบ ๆ** จึงใช้ชั้นเดียวกับ `tenantTables.test.ts` (D79)
และ `rolesSql.test.ts` (D85): เทสไล่อ่านไฟล์จริงมาเทียบ

| เทสล็อกอะไร | พังแล้วเกิดอะไร |
|---|---|
| ทุกจุดที่อ่าน `log_product` ในฟอร์ม ภส. ต้องผ่าน `exciseLogProduct()` | เพิ่มฟอร์มใบที่ 6 แล้วลืมกรอง = ใบเดียวในชุดที่ตัวเลขไม่ตรงกับเพื่อน |
| `production/data.ts` ต้อง **ไม่** มีคำว่า `excise_hidden` | กรองลามไปหน้าสต็อก = ยอดในแอปไม่ตรง `stock_product` |
| migration ต้องไม่แตะ trigger สต็อก | ของหายจากสต็อกจริง |
| มี `update … excise_hidden` **จุดเดียว** | มีคน backfill ย้อนหลัง = แก้ฟอร์มที่ยื่นแล้ว |
| RPC ทั้งสองตัวเขียน `ref_no` | จับคู่ไม่ได้ ซ่อนข้างเดียว = **ยอดคงเหลือบนฟอร์มเพี้ยน** |

---

**พิสูจน์ในเบราว์เซอร์ 2 ทิศทาง — เดือนเดียวกัน สินค้าเดียวกัน ต่างกันแค่เงื่อนไขเดียว**

| ออเดอร์ | ตอนกดยกเลิก | ผล | ถูกไหม |
|---|---|---|---|
| `ORD260901-003` | เดือนนั้น**ออกรายงานแล้ว** | `excise_hidden = false` ทั้งคู่ | ✅ ฟอร์มที่ยื่นไปไม่ขยับ |
| `ORD260901-004` | เดือนนั้น**ยังไม่ออกรายงาน** | `excise_hidden = true` ทั้งคู่ | ✅ หายจากฟอร์ม |

ปิดลูปถึงตัวเลขที่ออกจากโค้ดจริง — payload ที่ป้อนเข้า pdf-lib ของ **ภส.๐๗-๐๒/๑(๒)** วันที่ 1 ก.ย.
คืน `รับ 5 · จ่าย 5 · คงเหลือ 88` อ้างอิง `ORD260901-001, -002, -003` โดย **ไม่มี -004 ปรากฏที่ใดเลยในก้อนข้อมูล**
· และ `stock_product` เทียบกับผลรวมของ `log_product` **ทุกแถวรวมที่ซ่อน** ยังตรงทุกสินค้า

---

**ไฟล์**: migration **0057** (ยก `fn_confirm_fulfillment`/`fn_cancel_order` จาก 0051 มาด้วยสคริปต์
`gen-0057.mjs` — ไม่พิมพ์มือ · signature ไม่เปลี่ยน) · `app/(app)/production/excise-data.ts`
(+`exciseLogProduct()` ที่อ่าน `log_product` แทน 4 จุดเดิม) · `lib/production/exciseHidden.test.ts` (9) ·
build/lint/test **854** ผ่าน · ชุดเทส `docs/TESTING.md` ส่วนที่ 47

---

### D91 — ปิดเดือนสรรพสามิต: แยก "เช็กลิสต์" ออกจาก "ตัวล็อก" (0058, 2026-09-01)

**ต้นเรื่อง**: D90 เพิ่งจบไปไม่กี่ชั่วโมง ผู้ใช้ทักว่ากติกาที่วางไว้ใช้กับการทำงานจริงไม่ได้

> *"บัญชีที่ไม่ใช่งบเดือน อาจจะมีการกดออกรายงานอยู่ตลอด เพราะหากสรรพสามิตเข้ามาตรวจ
> ทางโรงงานก็ต้องมีเอกสารรายวันให้ดูว่าตรงกับความเป็นจริงไหม"*

D90 ตัดสินว่าจะซ่อนคู่ จ่าย/รับ ของออเดอร์ที่ยกเลิกไหม โดยดูว่าเดือนนั้นมีแถวใน `report_runs`
หรือยัง — **ซึ่งเป็นตารางผิดตัว** และโค้ดฟ้องตัวเองอยู่แล้ว: `report_runs` ถูกสร้างมาเป็น
**เช็กลิสต์** (comment ที่ `0005` และ `ExciseTab.tsx:13` เขียนไว้เองว่า *"เดือนนี้สร้างครบยัง"*)
เป็น append-only ตั้งใจให้มีหลายแถวต่อเดือน (index `created_at desc`)

ของจริง: **บัญชีประจำวัน** (๐๗-๐๑/๑ · ๐๗-๐๒/๑(๑) · ๐๗-๐๒/๑(๒)) ต้องพิมพ์เก็บไว้ให้เจ้าหน้าที่
ตรวจได้ตลอด → `report_runs` มีแถวแทบทุกวัน → **การยกเลิกบิลถูกล็อกตลอดกาล** ทั้งที่
**งบเดือน (๐๗-๐๔) ซึ่งเป็นใบที่ *ยื่น* จริง ยังไม่ได้ส่งด้วยซ้ำ** (ยื่นได้ถึงวันที่ 15 ของเดือนถัดไป)

> 🚩 **บทเรียน: ตารางเดียวทำสองหน้าที่** (ตระกูล D84 ชื่อโมดูล · D63 ดร็อปดาวน์กิจการ)
> การกด **"พิมพ์"** กับการ **"ยื่น"** เป็นคนละเหตุการณ์ เอาอย่างหนึ่งไปแทนอีกอย่างไม่ได้
> · และ 🪤 **ตารางที่มีข้อมูลอยู่แล้วพอดี ไม่ได้แปลว่ามันตอบคำถามที่เรากำลังถาม** —
> `report_runs` "ดูเข้าท่า" เพราะมันมีทั้ง entity · month · ชนิดฟอร์ม ครบพอดี
> แต่ความหมายของแถวคือ *กดปุ่มแล้ว* ไม่ใช่ *ยื่นแล้ว*

---

**สิ่งที่ผู้ใช้เลือก (จาก 3 แนวทางที่เขาเสนอมาเอง)**

ผู้ใช้เสนอ 3 ทาง: (1) ปุ่มคืนค่า (2) ดูงบเดือนอย่างเดียว (3) พรีวิว → คอนเฟิร์มปิดเดือน
แล้วถามว่าอันไหนดี · ผมเสนอ **ข้อ 3 เป็นแกน โดยกลืนข้อ 1 เข้าไปเป็นการถอนปิด**
และเหตุผลของข้อ 2 คือคำอธิบายว่าทำไมการปิดถึงเป็น **ธงเดียวต่อเดือนต่อกิจการ** ไม่ใช่ล็อกรายฟอร์ม

| | ทำไมเดี่ยว ๆ ไม่พอ |
|---|---|
| ① ปุ่มคืนค่า | คงจุดชนวนที่ผิดไว้ → กลายเป็นปุ่มที่ต้อง **กดเป็นกิจวัตร** 🪤 ปุ่มที่ต้องกดเป็นกิจวัตรคือปุ่มที่วันหนึ่งจะลืมกด แล้วตัวเลขผิดเงียบ ๆ · และแยกไม่ออกระหว่าง *ยังไม่เคยยื่น* กับ *ยื่นแล้วแต่กดล้าง* |
| ② ดูงบเดือน | จุดชนวนถูกขึ้น (๐๗-๐๔ คือใบที่ยื่นจริง) แต่ยังถือว่า **"พิมพ์ = ยื่น"** → กดดูงบเดือนกลางเดือนเพื่อเช็กตัวเลข = ล็อกทันที **งบเดือนกลายเป็นฟอร์มที่ห้ามกดดูเล่น** |
| ③ ปิดเดือน | ย้ายการล็อกจาก *ผลข้างเคียงของการกดพิมพ์* → **การกระทำที่ผู้ใช้ตั้งใจประกาศเอง** ระบบเลิกเดา |

---

**โมเดล**

`report_runs` **กลับไปเป็นเช็กลิสต์อย่างเดียว** — กดพิมพ์กี่ครั้งก็ได้ ไม่ล็อกอะไรทั้งนั้น
ตัวล็อกจริงคือตารางใหม่ `excise_month_close` (กิจการ · เดือน · ปิดเมื่อไร · ใครปิด · หมายเหตุ · `totals`)

- **หนึ่งแถวต่อรอบการปิด** — ถอนปิด = เติม `reopened_at` **ไม่ลบแถว** → เห็นประวัติว่าปิด/ถอนกี่รอบ ใครทำ
- **partial unique index** `where reopened_at is null` กันปิดซ้อน (แพตเทิร์นเดียวกับ `tax_payments` D88)
- **ไม่มี policy สำหรับเขียน** เขียนผ่าน RPC (definer) เท่านั้น — `for all` ครอบ SELECT
  และ policy permissive ถูก OR กัน (บทเรียน D85/0052)
- 🚨 **RLS อ่านเป็น `prod.read` ไม่ใช่ `prod.read or acct.read`** — ★ ต่างจาก `report_runs` ที่
  0055 ต้องเปิดให้บัญชีด้วย **เพราะตารางนั้นเก็บ 2 โดเมนปนกัน** ส่วนตารางนี้เป็นเรื่องฟอร์ม ภส.
  โดเมนเดียว · เขียนเหตุผลกำกับไว้ในไฟล์กันคนก๊อป 0055 มาโดยไม่ดูบริบท

**คำถามอยู่ที่เดียว** — `fn_excise_months_open(tenant, entity, ref)` ถูกเรียกทั้งจาก `fn_cancel_order`
และ `fn_excise_recompute_hidden` · กฎเดียวกันเขียนสองที่แล้วหลุดจากกัน = ไม่มี error ทั้งคู่ (D79/D85)

🚨 **คู่ จ่าย/รับ ข้ามเดือนได้** (ขาย ก.ย. ยกเลิก ต.ค.) → ต้องเปิดครบ **ทุกเดือนที่แถวแตะ**
ซ่อนข้างเดียว = ยอดคงเหลือบนฟอร์มเพี้ยน ซึ่ง **แย่กว่าไม่ซ่อนเลย**
★ และไล่เดือนจาก **แถวจริง** ไม่ใช่ `current_date` แบบ D90 (ค่าตรงกันตอนยกเลิก แต่ผิดตอนคำนวณใหม่ทีหลัง)

---

**สองกฎที่กลับด้านกัน — ทั้งคู่ถูกต้อง**

| | ทำอะไร | ทำไม |
|---|---|---|
| **ถอนปิดเดือน** | คำนวณการซ่อนใหม่ทันที (`excise_hidden := months_open`) ทั้ง true และ false | นี่คือ "ปุ่มคืนค่า" ที่ผู้ใช้ขอ — ถอนแล้วต้องคำนวณให้เลย ไม่ใช่ให้ไปกดอีกปุ่ม |
| **ปิดเดือน** | 🚨 **ห้ามคำนวณใหม่เด็ดขาด** | คู่ที่ซ่อนไว้ตอนเดือนยังเปิด ต้องซ่อนต่อ — ของไม่เคยออกจากโรงจริง ฟอร์มที่กำลังจะยื่นต้องไม่มีมัน · ถ้าเผลอเรียก recompute ตอนปิด แถวจะโผล่กลับมาบนฟอร์มที่กำลังจะยื่นพอดี |

**ยังคงตัดสิน ณ ตอนกดยกเลิกแล้วแช่ผลไว้ในคอลัมน์** (กติกาของ D90 ที่ยังถูก) — ไม่ใช่คิดสดตอนเปิดดูฟอร์ม
ไม่งั้นพอเดือนนั้นถูกปิด*ทีหลัง* แถวที่หายไปแล้วจะโผล่กลับมาเอง = ฟอร์มเปลี่ยนย้อนหลังอีกแบบ

---

**`totals` — เก็บอะไร และ *ไม่* เก็บอะไร**

เก็บ **ผลรวมข้อมูลขาเข้าฟอร์ม** (`log_product` เฉพาะแถวที่ไม่ถูกซ่อน · `log_material` · `log_distill`
· `log_ferment_draw`) 🚨 **ไม่ใช่สำเนาแบบที่ยื่น** — เรนเดอร์ครบทุกใบตอนปิดเดือนต้องเรียกหลายสิบครั้ง
ส่วนผลรวมขาเข้าจับได้ทุกความเปลี่ยนแปลงที่จะทำให้ฟอร์มขยับ ด้วย query เดียว
· บนจอเรียกให้ตรงว่า *"ต่างจากตอนปิดเดือน"* ไม่ใช่ *"ต่างจากที่ยื่น"*

`driftSummary()` คืนลิสต์ว่างเสมอเมื่อยังไม่เคยปิด — 🪤 บทเรียน D88 ข้อ 4 (ข้อความ
*"ต่างจากยอดที่ยื่นไว้"* เคยโผล่ทั้งที่ยังไม่เคยยื่น)

---

**ขอบเขต — สิ่งที่ **ไม่** ทำโดยตั้งใจ**

- 🚨 **ไม่แตะ `report_runs`** เลยแม้แต่บรรทัดเดียว — D88 ใช้เป็นเงื่อนไข *"ต้องสร้างแบบก่อนถึงจะจ่ายภาษีได้"*
  (`lib/accounting/taxPay.ts` · `taxReminder.ts` · `/api/cron/tax-reminder`) คนละโดเมน คนละเรื่อง
- 🚨 **ไม่ backfill อะไรทั้งสิ้น** — ไม่มีบันทึกว่าเดือนไหนยื่นจริง การไล่ปิด/ซ่อนย้อนหลังให้เอง
  = แก้ฟอร์มที่อาจยื่นไปแล้ว → เปิดปุ่ม **คำนวณใหม่ตามจริง** ให้กดเป็นรายเดือนโดยเห็นจำนวนคู่ที่กระทบก่อน
- **ปิดเดือนไม่บล็อกการแก้ข้อมูล** (ผู้ใช้ตัดสิน) — เตือนอย่างเดียว ตามกติกา CLAUDE.md ที่ว่า
  ผู้ใช้ย้ายมาจาก Sheets ที่แก้มือได้ทุกอย่าง ห้ามทำให้ความสามารถนั้นหาย
- **trigger สต็อกไม่ถูกแตะ** · `excise_hidden` ยังถูกอ่านที่ `exciseLogProduct()` ที่เดียว

---

**`prod.config` — cap ที่หายไปตั้งแต่ D85**

ตอนเขียนพบว่า `CAPS` มี `acct/sales/pay × read/write/config` ครบ แต่ฝั่งผลิตมีแค่ `read/write`
(เพราะยังไม่มีบทบาท "หัวหน้าฝ่ายผลิต") → เติม `prod.config` เข้า `CAPS`
★ **`has_cap()` ฝั่ง SQL ไม่ต้องแก้เลย** เพราะ `main → true` ทุก cap และบทบาทอื่นไม่มีชื่อนี้ในลิสต์
→ `rolesSql.test.ts` (ฝาแฝด TS ↔ SQL) ผ่านโดยไม่แก้ไฟล์เทส
· เหตุผลที่ใช้ `*.config` ไม่ใช่ `*.write`: ยึดตามที่ D85 วางไว้แล้วว่า **ยกเลิกออเดอร์ = `sales.config`**
(ระดับหัวหน้า ไม่ใช่งานประจำวัน) — ปิดเดือนสรรพสามิตเป็นการกระทำระดับเดียวกันเป๊ะ

---

**เทส**

`lib/production/monthClose.ts` + เทส 19 — ★ ป้าย/ข้อความทุกตัวตัดสินใน lib ที่มีเทสคุม
**ห้ามตัดสินในคอมโพเนนต์** (D84/D88 ข้อ 4)

`lib/production/exciseHidden.test.ts` — เทสที่ล็อกกติกา D90 ด้วย `report_runs` **ถูกแก้ให้ล็อกกติกาใหม่**
(เป็นเทสที่ล็อก *ที่มาของคำตอบ* ซึ่งเปลี่ยนไปจริง ไม่ใช่เทสที่ล็อกพฤติกรรมถูกแล้วมาแก้ให้ผ่าน)
เพิ่มข้อที่จับได้ว่า: `fn_cancel_order` ต้องไม่ query `report_runs` · cancel กับ recompute ต้องเรียก
ฟังก์ชันคำถามตัวเดียวกัน · **ปิดเดือนต้องไม่เรียก recompute** · ไม่มี backfill ระดับ migration ·
ตารางใหม่ต้องอยู่ก่อน `entities` ใน `fn_mig_truncate`

`tests/tenant/excise-month-close.test.ts` — 🔴 **ชั้นเดียวที่เห็นตรรกะใน plpgsql** (D79)
รวมข้อที่เป็นต้นเรื่องตรง ๆ: *กดสร้างรายงานแล้วยกเลิก → ต้องยังซ่อนได้*

---

**ไฟล์**: migration **0058** (ยก `fn_cancel_order` จาก 0057 + `fn_mig_truncate` จาก 0054 มาด้วย
สคริปต์ `scripts/gen/gen-0058.mjs` — ไม่พิมพ์มือ · signature ไม่เปลี่ยน · `diff` เทียบแล้วต่างเฉพาะ
บล็อกที่ตั้งใจ) · `lib/production/monthClose.ts` + `.test.ts` (19) · `lib/shared/roles.ts`
(+`prod.config` +`rolesWithCap`/`capHolderText`) · `lib/shared/tenantTables.ts` (+3 ที่)
· `ExciseTab.tsx` (การ์ดปิดเดือน — **อยู่นอก `ReportChecklist` เพราะบัญชีใช้คอมโพเนนต์ตัวเดียวกัน**)
· `excise-actions.ts` (+4 action) · `OrdersTab.tsx` + `sales/actions.ts` (ส่งเดือนที่ล็อกกลับมาเป็น `warn`)
· build/lint/test **882** ผ่าน · ชุดเทส `docs/TESTING.md` ส่วนที่ 48

🪤 **เจอระหว่างทาง**: `\_` ใน template literal ของ JS ถูกกลืน backslash ทิ้ง → สคริปต์ยก RPC
หาบล็อกเดิมไม่เจอ (ตระกูลเดียวกับ `$` ใน heredoc ของ D85) — สคริปต์ throw ให้เห็นทันที
ซึ่งเป็นเหตุผลที่ยกด้วยสคริปต์แทนการพิมพ์มือตั้งแต่แรก

---

**🔴 บั๊กที่เจอตอนเทสในเบราว์เซอร์ (migration 0059) — ตรรกะถูก แต่คำอธิบายกลับด้าน**

เปิดเดือน ต.ค. ที่มีคู่ จ่าย/รับ ซึ่ง**ถูกซ่อนอยู่** แต่เดือนที่ขาย (ก.ย.) ปิดไปแล้ว หน้าจอขึ้นว่า

> *"มีคู่ จ่าย/รับ ของบิลที่ยกเลิก 1 คู่ **ที่ยังแสดงบนฟอร์ม** … กด "คำนวณใหม่ตามจริง" **เพื่อเอาออก**"*

**กลับด้านกับความจริงพอดี** — คู่นั้นถูกซ่อนอยู่ และการกดจะทำให้มัน **กลับมาแสดง**
(ซึ่งถูกต้อง เพราะฟอร์ม ก.ย. ที่ยื่นไปแล้วมีแถวนั้นอยู่) · กดยืนยันแล้ว: **ตรรกะทำถูกทุกประการ
ที่ผิดคือประโยคที่ผู้ใช้อ่านแล้วตัดสินใจกดปุ่ม**

🚨 สาเหตุ: dry-run คืนแค่ `changed` = *"จะเปลี่ยนกี่คู่"* ซึ่งเป็นตัวเลข**ไร้ทิศทาง**
แล้วฝั่งหน้าจอ **เดาเอาเองว่าทิศทางคือ "ซ่อนเพิ่ม" เสมอ** ทั้งที่ `fn_excise_recompute_hidden`
ตั้งใจให้เป็นสองทาง (set ทั้ง true และ false) มาตั้งแต่ 0058 — ความสามารถสองทางนั้นเขียนไว้เอง
ในคอมเมนต์ของฟังก์ชัน แต่ค่าที่ส่งออกมากลับบีบเหลือมิติเดียว

> 🪤 **ตัวเลขที่ไม่มีทิศทาง ห้ามเอาไปแต่งประโยคที่มีทิศทาง**
> ตระกูล D81 (หน้าจอประกาศกฎหนึ่ง โค้ดทำอีกอย่าง) แต่กลับด้าน: รอบนี้ *โค้ดถูก คำอธิบายผิด*
> ซึ่งอันตรายพอกัน เพราะสิ่งที่ผู้ใช้ทำต่อคือกดปุ่มตามที่ประโยคบอก
> ★ และ **build/lint/test เดิมผ่านหมด** — เทสที่มีอยู่ตรวจว่า `pendingHideText(3)` พูดถึง "3 คู่"
> ซึ่งถูกตามที่เขียน · ไม่มีอะไรตรวจว่า *ทิศทางที่ประโยคบอก ตรงกับทิศทางที่ปุ่มจะทำจริงไหม*

**แก้**: `to_hide` / `to_show` แยกกันตั้งแต่ชั้น SQL (ทั้ง dry-run และ `fn_excise_reopen_month`)
→ `pendingRecomputeText()` / `recomputeResultText()` พูดตามทิศจริง
(*"เอาออกจากฟอร์ม N คู่"* / *"เอากลับมาแสดง N คู่"* · เกิดพร้อมกันสองทิศก็บอกครบ)
· เทส +8 รวมข้อที่ล็อกว่า **ห้ามพูดว่า "เพื่อเอาออก" เมื่อทิศเป็นการเอากลับมาแสดง**
และข้อที่อ่านซอร์สหน้าจอมาตรวจว่า **ต้องไม่เหลือ `pendingHide` ให้เดาทิศทางเอง**

**✅ เทสในเบราว์เซอร์ครบทุกข้อของส่วนที่ 48** (บนข้อมูลจริงของ tenant ทดสอบ):
กดพิมพ์ 10 ครั้งแล้วยกเลิก → ยังซ่อนได้ (ข้อที่เป็นต้นเรื่อง) · ปิดเดือนแล้วยกเลิก → ไม่ซ่อน
พร้อมแถบเหลืองบอกว่าใครต้องกดอะไร · ปิดเดือนไม่ไปแหย่คู่ที่ซ่อนไว้ก่อนหน้า · ถอนปิดแล้วคำนวณใหม่ทันที
· ปิดใหม่ได้และประวัติครบทุกรอบพร้อมหมายเหตุ · drift ขึ้นเมื่อข้อมูลขยับหลังปิด และไม่ขึ้นเมื่อยังไม่เคยปิด
· **คู่ข้ามเดือนไม่ถูกซ่อนครึ่งเดียวทั้งสองทิศ** · สุทธิ `log_product` เท่ากันเสมอ · `stock_product` ตรงทุกสินค้า

**ไฟล์เพิ่ม**: migration **0059** (+ `scripts/gen/gen-0059.mjs`) · build/lint/test **890** · `test:tenant` **207**


---

### D92 — เตือนกำหนดยื่นงบเดือนสรรพสามิตเข้า LINE (ไม่มี migration, 2026-09-01)

**ต้นเรื่อง**: D91 ทำปุ่ม **ปิดเดือน** เสร็จแล้ว ผู้ใช้ขอต่อทันทีว่า
*"หากยังไม่คอนเฟิร์มงบเดือนภายในก่อน 3 วันของวันที่ 15 ของเดือนถัดไปให้เตือน"*
— เหตุผลเดียวกับ D88 เป๊ะ: **เช็กลิสต์กับปุ่มช่วยได้เฉพาะตอนที่เปิดแอป**
ไม่ได้เข้าเลยทั้งเดือนก็เลยกำหนดยื่นแล้วค่อยรู้

★ **งานนี้คือการเพิ่มผู้เข้าร่วมรายที่สอง ไม่ใช่สร้างระบบใหม่** — cron route · `CRON_SECRET` ·
`sendLineToTenant()` · กันซ้ำด้วย `integration_log` มีครบแล้วจาก D88
· **ไม่ต้องมี migration**: `integration_log.action` เป็น text อิสระ (ไม่มี CHECK) และ unique index
เป็น `(tenant_id, action, idempotency_key)` แยกต่อลูกค้าอยู่แล้วตั้งแต่ 0027

---

**มติที่ผู้ใช้ตัดสิน — แยกเป็นคนละข้อความ ไม่รวมกับของสรรพากร**

ข้อสังเกตที่ทำให้ต้องถาม: **ภพ.30 ครบกำหนดยื่นกระดาษวันที่ 15 เหมือนงบเดือนสรรพสามิตเป๊ะ**
→ วันเตือน (วันที่ 12) **ชนกันทุกเดือน** ตลอดไป

| | เหตุผล |
|---|---|
| ✅ แยก 2 ข้อความ | **คนละกรม และคนละสิ่งที่ต้องไปกด** (สรรพากร → สร้างแบบ · สรรพสามิต → ปิดเดือน) รวมกันแล้วท้ายข้อความจะมีคำสั่ง 2 อัน ซึ่งอ่านยากกว่า · และ **ไม่ต้องแตะโค้ด D88 ที่เทสผ่านแล้ว** |
| ❌ รวมข้อความเดียว | เห็นทุกอย่างในที่เดียว แต่ต้องยกตรรกะประกอบข้อความของ D88 มาแก้ด้วย |

---

**เตือนใคร — `entities.excise_id` คือธง "โรงสุราที่ต้องยื่น"**

คอลัมน์นี้ถูกเขียนกำกับไว้ใน schema ตั้งแต่ `0001` ว่า *"เฉพาะโรงสุรา"* → เป็นสัญญาณที่ตรงที่สุด
ว่ากิจการไหนมีหน้าที่ยื่นงบเดือน และ**ผู้ใช้คุมเองได้**
★ หลักเดียวกับ ภพ.30 ที่ D88 เตือน **ทุกเดือนที่จด VAT แม้เดือนนั้นไม่มียอด** —
โรงสุราต้องยื่นงบเดือนทุกเดือน ไม่ผลิตก็ต้องยื่น

🔴 **ผลข้างเคียงที่ต้องมีทางออก**: ไม่กรอกเลข = **ไม่ได้รับการเตือนเลย** ซึ่งเป็นความเงียบที่
ผู้ใช้ไม่มีทางรู้เอง (เจอจริงตอนเทส: ลูกค้า 2 รายที่ซื้อโมดูลผลิตยังไม่ได้กรอกเลขสรรพสามิต)
→ การ์ดปิดเดือนขึ้นบรรทัดเหลืองบอกตรง ๆ ว่า *ยังไม่ได้กรอกเลขสรรพสามิต → จะไม่เตือน
(กรอกที่ ตั้งค่า → กิจการ)* · 🚨 **ทุกครั้งที่ระบบไม่ทำอะไรให้ ต้องบอกว่าทำไม**

---

**🚨 จุดเสี่ยงที่สุดของงานนี้ — `continue` ของงานเก่าจะกลืนงานใหม่**

บล็อกเตือนภาษีของ D88 ใช้ `continue` **4 จุด** (ไม่มีกิจการ · อ่าน wht ไม่ได้ · ไม่มีอะไรต้องเตือน ·
ส่งไปแล้ว) — เอางานสรรพสามิตไปต่อท้ายในลูปเดียวกันเฉย ๆ
**`continue` เหล่านั้นจะข้ามงานใหม่ไปด้วยเงียบ ๆ** และ TypeScript มองไม่เห็นเลยแม้แต่นิดเดียว

→ แยกเป็น `taxPart()` / `excisePart()` ในไฟล์เดียวกัน เรียกต่อกันตามธงโมดูลของแต่ละราย
(`accounting` / `production` แยกกัน — ลูกค้าที่ซื้อแค่ผลิตต้องได้เตือนงบเดือน
ลูกค้าที่ซื้อแค่บัญชีต้องได้เตือนภาษีเหมือนเดิม)
· มีเทสอ่านซอร์สจริงล็อกไว้ว่าต้องเป็นฟังก์ชันแยก และ insert ต้องอยู่**หลัง** `sendLineToTenant`

🪤 **เทสข้อ "ส่งก่อนจด" เขียนพลาดรอบแรกแล้วผ่านด้วยเหตุผลผิด** — ค้น `EXCISE_REMINDER_ACTION,`
ทั้งไฟล์แล้วเจอ**บรรทัด import**ก่อน ทำให้ลำดับถูกโดยบังเอิญ → แก้เป็นตัดเฉพาะตัว `excisePart`
มาตรวจ · **เทสที่ผ่านโดยไม่ได้ตรวจอะไร อันตรายกว่าไม่มีเทส เพราะมันสร้างความมั่นใจปลอม**

---

**กติกาที่ยกมาจาก D88 ทั้งดุ้น**

- 🚨 **ไม่บอกยอดเงิน** — กลุ่ม LINE มีคนที่ไม่ควรเห็นตัวเลขของกิจการ
- 🚨 **ส่งก่อน แล้วค่อยจด** — จดก่อนแล้วส่งพลาด = เตือนหายตลอดกาล (วันเตือนผ่านไปแล้ว ไม่มีรอบสอง)
- 🚨 **ไม่เลื่อนวันหยุดราชการให้** (ไม่มีปฏิทิน · เตือนเร็วไปดีกว่าเดาแล้วช้า)
- 🚨 **อ่าน `error` ทุกจุด** (D89) — อ่านสถานะปิดเดือนไม่ได้แล้วเดาว่า "ยังไม่ปิด"
  = **สแปมเตือนทั้งที่ปิดไปแล้ว** → รายงาน error แล้วข้าม ไม่ใช่เงียบ
- `tenantId` มาจากตาราง `tenants` เท่านั้น ห้ามรับจากคำขอ

**สิ่งที่ตั้งใจทำต่างจาก D88**

- **บอกวันเดียว** ไม่มีวันยื่นออนไลน์ — ภพ.30 รู้ทั้ง 2 วัน แต่ของสรรพสามิตไม่รู้ **และไม่เดา**
- **จำนวนวันในหัวข้อความคิดจาก `leadDays`** ไม่ฮาร์ดโค้ด (ของ D88 ฮาร์ดโค้ด `"อีก 3 วัน"` ไว้ —
  จดลง NEXT_STEPS ไม่แก้รอบนี้ เพราะจะทำให้ golden A18 ขยับโดยไม่จำเป็น)

---

**ย้ายตัวช่วยวันที่ไปบ้านกลาง**

`nextMonth` / `prevMonth` / `thaiDay` เกิดใน `lib/accounting/taxPay.ts` (D88) แต่ฝั่งผลิตต้องใช้ชุดเดียวกัน
🚨 **ห้ามให้ `lib/production` import `lib/accounting`** → ย้ายไป `lib/shared/period.ts`
(พร้อม `shiftDaysISO` ที่ถอด logic ซ้ำออกจาก `remindDateOf`) แล้ว **`taxPay.ts` re-export ต่อ**
→ ไฟล์อื่นที่ import จากที่นั่นไม่ต้องแก้สักบรรทัด
· 🚩 **golden A17 (35) + A18 (17) ผ่านโดยไม่แก้ไฟล์เทส** = หลักฐานว่าย้ายแล้วพฤติกรรมไม่ขยับ

---

**✅ พิสูจน์ด้วย dry-run ของ cron จริง** (`?dry=1&date=…` — ไม่ส่งเข้า LINE แต่บอกครบว่าจะส่งอะไรให้ใคร)

| วันที่ทดสอบ | ผลที่ได้ |
|---|---|
| `2026-09-12` | ✅ *"งบเดือน (ภส.๐๗-๐๔) งวด ส.ค. 2569 — ยื่นภายใน 15 ก.ย."* |
| `2026-10-12` (งวด ก.ย. **ปิดเดือนแล้ว**) | ✅ เงียบ — **แต่ฝั่งภาษียังยิงครบ 3 ราย** (พิสูจน์ว่า 2 งานเป็นอิสระกันจริง) |
| `2026-09-11` / `2026-09-13` | ✅ ไม่มีอะไรเลย |
| `2027-01-12` (ข้ามปี) | ✅ *"งวด ธ.ค. 2569 — ยื่นภายใน 15 ม.ค."* |
| **ถอนปิดเดือน ก.ย. แล้วยิง `2026-10-12` ซ้ำ** | ✅ **กลับมาเตือน** — วันเดิมที่เคยเงียบ |
| จดว่าส่งแล้วใน `integration_log` แล้วยิงซ้ำ | ✅ ไม่ส่งซ้ำ |
| บนจอ | ✅ *"ระบบจะเตือนเข้ากลุ่ม LINE วันที่ 12 ต.ค. (ครบกำหนดยื่น 15 ต.ค.)"* ขึ้นเฉพาะตอนเดือนยังไม่ปิด |

---

**ไฟล์**: `lib/production/exciseReminder.ts` + `.test.ts` (24) · `lib/shared/period.ts` ·
`lib/accounting/taxPay.ts` (ย้าย + re-export) · `app/api/cron/tax-reminder/route.ts`
(แยก `taxPart`/`excisePart`) · `ExciseTab.tsx` (บรรทัดบอกสถานะการเตือน)
· **`vercel.json` ไม่ต้องแก้** (route เดิม cron เดิม `CRON_SECRET` ตัวเดิม)
· build/lint/test **914** ผ่าน · ชุดเทส `docs/TESTING.md` ส่วนที่ 49

---

---

### D93 — เทส "ลูกค้าใหม่จากศูนย์" ครบวง เจอบั๊ก 8 ตัวที่ build/lint/test เดิมผ่านหมด (0060, 2026-09-06)

**ต้นเรื่อง**: ผู้ใช้สั่งให้เทสในเบราว์เซอร์ 3 ก้อน (POS · เงินเดือน · ลูกค้าใหม่จากศูนย์)
โดย**เน้นก้อนสุดท้าย** และสั่งว่า *"ต้องวางแผนโฟลว์ให้ดีก่อน ให้เสมือนมีลูกค้ามาซื้อแล้วใช้งานจริง"*
→ วางเป็น 5 ช่วง เล่นเป็น 2 ตัวละคร (เจ้าของระบบ ↔ ลูกค้าที่เพิ่งจ่ายเงิน)
ล้างข้อมูลทดสอบเก่าทิ้งทั้งหมดก่อน (ลบ tenant `demoprov`/`rongkor`/`rongkhor` เหลือ auth user คนเดียว)
แล้วรับลูกค้าใหม่ 2 ราย: `siamdist` (ครบ 4 โมดูล · จด VAT) และ `banphrao` (ผลิตอย่างเดียว · ไม่จด VAT)

> 🚩 **ข้อพิสูจน์เดียวที่ทั้งงานนี้ต้องการ**: ลูกค้าใหม่ไปถึง *ขายใบแรก + ออกฟอร์ม ภส. เดือนแรก*
> **โดยไม่ต้องยิง SQL แม้แต่ครั้งเดียว** — ทุกจุดที่ต้องแตะ terminal คือบั๊กระดับ D80-B1

**ผลรวม**: ✅ ผ่าน — แต่ระหว่างทางเจอบั๊ก **8 ตัว** ที่ `build`/`lint`/`test` เดิมผ่านหมด 100% ทุกตัว

---

#### 1. 🔴🔴 `is_vat` ตั้งไม่ได้เลยทั้งระบบ

`provisionTenant` ฮาร์ดโค้ด `is_vat: true` และ **`update` บน `entities` มีอยู่ที่เดียวในทั้งโค้ดเบส**
คือ `saveEntityInfoAction` ซึ่งไม่มีคอลัมน์นี้ ⇒ **กิจการแรกของทุก tenant ถูกตรึงเป็น "จด VAT" ตลอดกาล**

🚨 **ทำไมหนักกว่าบั๊ก "ไม่มีหน้าจอให้ตั้ง" ทั่วไป** — ทั้งหมดของ D55 คือการบล็อกที่ DB
ไม่ให้ผู้ไม่จด VAT ออกใบกำกับภาษี (ผิด ม.86/13) และ trigger นั้นยิงเมื่อ `is_vat = false` เท่านั้น
⇒ **ไม่มีลูกค้ารายไหนไปถึงสถานะนั้นได้ = ด่านกฎหมายที่สร้างไว้ไม่เคยทำงานกับลูกค้าจริงเลย**

🪤 **ทางออกที่คอมเมนต์ในโค้ดชี้ไว้เองไม่มีอยู่จริง** — `settings/actions.ts` เขียนว่า
*"ต้องให้เจ้าของระบบตั้งผ่านสคริปต์เท่านั้น"* แต่ `provision:add-entity --no-vat` เป็น `insert`
**เพิ่มกิจการใหม่อย่างเดียว แก้ของเดิมไม่ได้** · และ `banphrao` โควตา 1/1 เต็มแล้วด้วยซ้ำ

**แก้**: `setEntityVat()` ใน `lib/platform/provision.ts` = **จุดเดียวของทั้งระบบที่แก้ `is_vat` ได้**
· ช่อง "กิจการแรกจดทะเบียน VAT" ในฟอร์มรับลูกค้าใหม่ · ปุ่มสลับต่อกิจการในหน้าจัดการ (confirm บอกผลกระทบ)
· `npm run provision:tenant --no-vat` (ชื่อธงเดียวกับ `add-entity` เพื่อไม่ต้องจำ 2 แบบ)
· `isVat` เป็น field **บังคับ** ใน `NewTenantInput` → เพิ่มที่เรียกใหม่แล้วลืมตัดสิน = **build ไม่ผ่าน** (แนว D84)
· 🚨 **จงใจไม่ย้ายไปหน้าตั้งค่าฝั่งลูกค้า** — เจตนาเดิมของ D55 ยังถูก: ลูกค้าติ๊กผิด = ออกใบกำกับภาษีทั้งที่ไม่มีสิทธิ์
· เทสอ่านซอร์สจริง 4 ข้อ รวมข้อ**ทิศตรงข้าม**ที่ล็อกว่า `saveEntityInfoAction` ต้องไม่มี `is_vat` โผล่มา

---

#### 2. 🔴🔴 fallback `"บัญชีบริษัท"` ทำให้ทั้งโมดูลบัญชีของลูกค้าใหม่เป็นศูนย์

`loadTaxAccounts()` ไม่มีแถว `tax_account` → เติมชื่อตายตัว `"บัญชีบริษัท"` ⇒ บิลของลูกค้าที่ตั้งชื่อ
บัญชีเองถูกกรองทิ้งหมด · กระทบ **แดชบอร์ด · ยอดบัญชี · ภพ.30 · ภงด. · cron เตือนยื่นภาษี** พร้อมกัน

**เห็นกับตาบนข้อมูลจริง**: ลูกค้าตั้งชื่อบัญชี `กสิกร ออมทรัพย์` ขายจริง 700 บาท →
แดชบอร์ด **0.00 ทุกช่อง** · ภพ.30 *"ยอดจากบิลตอนนี้ 0.00 บาท"* · **ไม่มีอะไรบนจอบอกว่าทำไม**

🪤 **D89 เคยเขียนคอมเมนต์เตือน fallback ตัวนี้ไว้แล้วว่า "ดูปลอดภัยแต่ไม่ใช่" — แต่ไม่ได้แก้**
⇒ **เขียนเตือนไว้ ≠ แก้แล้ว** (บทเรียนเดียวกับ D89 ที่บอกว่า "จดไว้ไม่ได้แปลว่าแก้แล้ว")

🚩 **พิสูจน์ก่อนแก้ว่าปลอดภัย** — DB ของเจ้าของตั้ง `tax_account` ไว้ครบ 3 บัญชี
(`บัญชีบริษัท` · `บัญชีเงินสดบริษัท` · `กสิกร insep`) จากบัญชีเงินทั้งหมด 7 อัน (คัดบัญชีส่วนตัว 4 อันออก
โดยตั้งใจ) ⇒ **ค่า fallback ไม่เคยถูกใช้กับข้อมูลจริง** การแก้พฤติกรรมตอน "ยังไม่ได้ตั้ง"
จึงขยับตัวเลขที่ใช้ยื่นภาษีของเจ้าของไม่ได้เลย (กติกาเหล็กข้อ 1)

**แก้**: `lib/accounting/taxAccounts.ts` — **ไม่ได้ตั้ง = นับทุกบัญชีเงินในระบบ** (ไม่ใช่เดาชื่อ)
· กฎตัวเดียวใช้ทั้งแอปและ cron (หลุดจากกัน = เตือนเดือนที่ไม่ต้องยื่น หรือเงียบในเดือนที่ต้องยื่น)
· แยก `taxAccountsSet` (ที่ตั้งเอง) ออกจากค่าที่มีผล ตามแพตเทิร์น D80 — ของเดิมโชว์ค่าปริยายเป็น
**chip ที่มีปุ่ม ✕** ทั้งที่ไม่มีแถวใน DB → กดลบขึ้น **"ลบแล้ว" สีเขียว แล้วรีเฟรชมันกลับมา**
· golden **A19** 5 เทส · ผลทันทีหลังแก้: แดชบอร์ดขึ้น **รายรับ 700.00 · ภาษีขาย 45.79**

---

#### 3. 🔴 `log_distill` ไม่มีทาง แก้/ลบ เลยทั้งโค้ดเบส (migration 0060)

ผู้ใช้ถามเองระหว่างเทสว่า *"ถ้าผู้ใช้กรอกพลาดแบบนี้จะทำยังไง ระบบมีให้แก้ไหม"* — ไล่ทุกตารางแล้วพบว่า
`log_distill` เป็น**ตารางเดียวของแอปผลิตที่ไม่มีทั้ง `update` และ `delete`** ทั้งที่ `vol`/`abv` ในนั้น
พิมพ์ลงฟอร์ม **ภส.๐๗-๐๒/๑(๑)** ที่ยื่นสรรพสามิต ⇒ กรอกผิดแล้วกดปิด batch = แก้ได้ทางเดียวคือยิง SQL

🪤 **อาการซ้อน**: พอปิด batch แล้ว batch **หายจากดร็อปดาวน์แท็บกลั่น** → ตารางค่าที่บันทึก
(ซึ่ง **มี** ปุ่มลบรายแถวอยู่แล้วตั้งแต่แรก) ไม่ถูก render อีก = **ปุ่มที่มีอยู่กลายเป็นปุ่มที่กดไม่ถึง**
(ตระกูล D74/D77 — ของมีครบทุกชั้น ขาดชั้นที่ผู้ใช้เอื้อมถึง)

**แก้**: `fn_reopen_distill_batch` + ปุ่ม **"ถอนการปิด batch"** (แพตเทิร์นเดียวกับ *ถอนปิดเดือน* D91)

- **ไม่ทำเป็น "แก้ตัวเลขตรง ๆ"** — จะทำให้เลข ภส. ขยับโดยไม่มีร่องรอยว่ามาจากไหน ·
  ถอนแล้วปิดใหม่บังคับให้ผู้ใช้ดูค่าที่บันทึกระหว่างกลั่นอีกครั้ง = จังหวะเดียวกับที่เคยตัดสินใจครั้งแรก
- `SECURITY INVOKER` (RLS ยังทำงาน · แพตเทิร์นเดียวกับ `fn_delete_ferment_batch` 0020)
  \+ ต้องมี **`prod.config`** (ระดับหัวหน้า เพราะแตะตัวเลขที่ใช้ยื่นราชการ — เหตุผลเดียวกับ D91)
- 🚨 `row_count = 0` ต้องตอบ **error ไทย ไม่ใช่ ok** (RLS ปัดตกเงียบ ๆ = บอกผู้ใช้ว่าสำเร็จทั้งที่ไม่ได้ลบ)
- ★ **ค่าเดิมไม่หาย** — trigger `audit_log_distill` (มีมาตั้งแต่ 0005) เก็บลง `edit_log`
  → ดูย้อนได้ที่ **ตั้งค่า → ประวัติการแก้ไข** (พิสูจน์แล้ว: `before` มี `vol: 12, abv: 38, batch: 1/69`)
- 🪤 **จงใจไม่บล็อกเมื่อปรุง/บรรจุไปแล้ว** — `log_dilute`/`log_product` **ไม่มีคอลัมน์อ้าง batch เลย**
  (ผูกกับ *ชื่อสุรา* เท่านั้น) จะเช็คก็เช็คไม่ได้จริง · **เดาแล้วบล็อกผิดแย่กว่าปล่อยผ่านแล้วเตือน**
  → กล่องยืนยันเป็นคนเตือน (กติกาเดียวกับทั้งแอป: เตือนแล้วให้คนตัดสิน)

---

#### 4. 🔴 ลำดับด่าน — ลูกค้าที่ถูกระงับโดนบังคับตั้งรหัสใหม่ก่อนรู้ว่าเข้าไม่ได้

`(app)/layout.tsx` เช็ค `must_change_password` **ก่อน** `is_active` ⇒ ลูกค้าค้างค่างวดที่ถูกระงับ
และเพิ่งถูกรีเซ็ตรหัส จะถูกบังคับ **คิดรหัสใหม่ กรอก 2 ช่อง กดบันทึก แล้วค่อยเจอหน้า "บัญชีถูกระงับ"**

🚩 **เจ้าของกิจการเป็นคนชี้เอง** และเหตุผลที่ให้มาถูกกว่าที่ผมเสนอ:
*"ลูกค้าค้างจ่ายนานเกิน → ล็อกอินด้วยรหัสตัวเอง → ไปหน้า suspended → ติดต่อผม → จ่ายเงิน →
ผมปลดล็อกให้ · ทำไมจะต้องให้ตั้งรหัสผ่านใหม่"* — เส้นทางจริงไม่มีจังหวะไหนต้องตั้งรหัสใหม่เลย

**แก้**: สลับให้ด่านระงับมาก่อน · เทส `lib/shared/suspendOrder.test.ts` **อ่านซอร์สมาตรวจลำดับ**
เพราะ layout เป็น server component ที่เรียก `redirect()` — เทสตรง ๆ ไม่ได้ และ **สลับ 2 บรรทัดนี้กลับ
TypeScript มองไม่เห็นเลย** (ชั้นเดียวกับ `tenantTables.test.ts` / `rolesSql.test.ts`)
· 🚨 คงเงื่อนไข `is_active === false` (ไม่ใช่ falsy) + ยกเว้น tenant แพลตฟอร์ม — **fail-open** ตาม D53

---

#### 5. 🟡 เช็กลิสต์ ภส. นับใบที่หน้าจอเดียวกันไม่ยอมให้ออก

หน้าเดียวกันกรอง **สองมาตรฐาน**: กล่องเลือกรายการด้านล่างกรองด้วย `productNamesFermented.length > 0`
(ถูกมาตั้งแต่ D78) แต่เช็กลิสต์ด้านบนเป็น array ตายตัว 5 ใบ ⇒ โรงกลั่นล้วนขึ้น **"0/5 ยังไม่ครบ" ตลอดกาล**
และแถบ *"ยังสร้างฟอร์มไม่ครบ (0/5 ใบ)"* ตอนปิดเดือนก็โกหกตาม

**แก้**: `visibleExciseForms()` ใน `lib/production/calc.ts` + เทส 4 ข้อ — ติดธง `needs` ต่อใบ
แล้วกรองด้วยสัญญาณเดียวกับกล่องด้านล่าง · 🪤 **ยังไม่มีสินค้าสักประเภท = โชว์ครบ ไม่เดา**
(กติกา D78: การซ่อนก็คือการเดา) · พิสูจน์บนจอ: **0/5 → 0/4** และใบสุราแช่หายไป

---

#### 6-8. 🟡 ประโยคที่ขัดกับสิ่งที่หน้าจอทำ (3 จุด)

| จุด | อาการ |
|---|---|
| `PeriodTab.tsx:421` | คำกำกับ *"ตัวเลขบนตารางคือผลคำนวณสด"* แสดง**ทุกกรณี** แม้บนงวดที่ลงบัญชีแล้วซึ่งโชว์ค่าที่แช่ไว้ → คนที่เพิ่งแก้เกณฑ์แล้วมาเปิดงวดที่ยื่นไปแล้วจะสรุปผิดว่า *เกณฑ์ใหม่ให้ผลเท่าเดิม* → `tableCaption()` ใน `periodView.ts` + เทสที่ล็อกว่า **ประโยคกับตัวเลขต้องตัดสินด้วยธง `locked` ตัวเดียวกัน** |
| `PosTab.tsx:278` | `custId === walkinId` ตอนว่างทั้งคู่คือ `"" === ""` → **true** ⇒ ปุ่มขึ้น title *"รายนี้เป็นลูกค้าทั่วไปอยู่แล้ว"* ทั้งที่เหตุผลจริงคือยังไม่ได้เลือกใคร |
| `billing-notice.tsx` | *"ถ้าโอนแล้วข้ามข้อความนี้ได้เลย"* — ผู้ใช้ทักว่าดูไม่ดี · ยกโทนมาจากหน้า `/suspended` ที่เขียนไว้ดีอยู่แล้ว → *"ชำระแล้วข้อความนี้จะหายเองเมื่อผู้ดูแลระบบบันทึกรายการ"* และ *"ถ้าชำระแล้ว อาจเป็นเพราะยังบันทึกรายการไม่ทัน — แจ้งผู้ดูแลระบบพร้อมหลักฐานการโอนได้"* |

★ ทั้งสามข้อเป็นตระกูลเดียวกับบั๊กที่แก้ใน **0059 (D91)**: **ตรรกะถูกทุกประการ ที่ผิดคือประโยคที่ผู้ใช้อ่านแล้วสรุป**

---

#### ↩️ ข้อที่ **ถอน** — ไม่ใช่บั๊กของแอป

รายงานไปก่อนหน้าว่า *"เพิ่มลูกค้าทั่วไปแล้วระบบไม่ตั้งให้"* (การ์ดเขียนเองว่า *ระบบจะตั้งให้เลย*)
→ กดผ่าน UI จริงแล้ว **ทำงานถูกต้อง** (ขึ้น *"ตั้งลูกค้าทั่วไปแล้ว"* · DB ได้ `pos_walkin_contact`)
สาเหตุจริงคือเครื่องมือเทสยัดค่าเข้าฟอร์มด้วย JS setter ทำให้ React state ไม่ครบ `onAdded` เลยไม่ทำงาน

🪤 **บทเรียนของการเทสเอง**: ตอนรายงานครั้งแรกเขียนกำกับว่า *"ยังไม่ฟันธงสาเหตุ"* ไว้ ซึ่งถูกแล้ว —
**อาการที่เกิดจากเครื่องมือ กับบั๊กจริง หน้าตาเหมือนกันทุกประการ** ต้องกดผ่าน UI จริงก่อนจึงสรุปได้

---

#### สิ่งที่พิสูจน์แล้วว่ายังทำงานถูก (ไม่ใช่ของที่ไม่ได้ตรวจ)

| เส้นทาง | หลักฐาน |
|---|---|
| POS ครบลูป | ขาย 2 ขวด → บิล `TR-…-0001` (841.12+58.88) · `log_product` · สต็อก 88→86 · `integration_log` 2 action ok |
| multiplier | ขาย 1 ลัง → ตัด **12 ขวด** (0 → −12) |
| ยกเลิกออเดอร์ 2 ทิศทาง (D90/D91/0059) | เดือนปิด → **ไม่ซ่อน** + ข้อความบอกทิศถูก · ถอนปิดเดือน → *"เอาออกจากฟอร์ม 1 คู่"* · เดือนเปิด → ซ่อนทันทีเป็นคู่ · **สต็อกกลับมาเท่าเดิมเป๊ะ** |
| `RECEIVE_MATERIAL` (D79) | ลงบิลซื้อหมวด *วัตถุดิบผลิตสุรา* → `log_material` เกิดเอง · `entity_id` ถูกกิจการ |
| ABV correction (กติกาเหล็กข้อ 2) | อ่าน 42% ที่ 30°C → **ดีกรี@20 = 38.00%** |
| 1 batch = 1 แถว | *"ปิด batch 1/69 แล้ว (log_distill 1 แถว)"* |
| D81 (ภ.ง.ด.1ก) | **254,860** ไม่ใช่ 925,171 · แถบเหลืองบอกชื่อ 3 เดือนที่ข้าม |
| 34.6 | เปลี่ยน ชม./วัน 9→8 → งวดที่ลงบัญชีแล้ว **ไม่ขยับแม้บาทเดียว** · งวดร่างขยับ + แถบ *"มี 5 คนที่ยอดยังไม่ตรงกับที่บันทึกไว้"* |
| **44.8 ใบเสร็จผู้ไม่จด VAT** (ค้างมาตั้งแต่ D86) | `rcpt_no1 = INV260906-001` **มีเลขจริง** · `tax_no1 = null` · ยอด 350 **ไม่ถอด VAT** · หัวเอกสารพลิกเป็น *ใบเสร็จรับเงิน* · **บิลเก่าที่ออกตอนยังจด VAT ไม่ถูกแก้ย้อนหลัง** |

---

**ไฟล์**: `lib/platform/provision.ts` (+`setEntityVat`) · `lib/accounting/taxAccounts.ts` + `.test.ts` (A19) ·
`lib/production/calc.ts` (+`visibleExciseForms`) · `lib/payroll/periodView.ts` (+`tableCaption`) ·
`lib/shared/suspendOrder.test.ts` · `app/(app)/layout.tsx` · `app/(app)/accounting/data.ts` ·
`app/(app)/production/{actions,data}.ts` + `DistillTab`/`ExciseTab` · `app/(platform)/platform/*` ·
`app/api/cron/tax-reminder/route.ts` · `scripts/provision-tenant.ts` ·
migration **0060** · build/lint/test **933** ผ่าน · ชุดเทส `docs/TESTING.md` ส่วนที่ **50**

### D94 — กลั่นหลายรอบ: แช่สมุนไพรแล้วกลั่นซ้ำ (0061, 2026-09-07)

**โจทย์จากผู้ใช้**: เหล้าบางตัวต้องกลั่น 2 รอบ — รอบแรกกลั่นจากน้ำอ้อยหมักต่อ batch → **เทรวมถัง** →
ยกออกมา x ลิตร → แช่สมุนไพร → กลั่นซ้ำ → ปรับดีกรี → บรรจุ · เจ้าอื่นอาจกลั่น 3 รอบ (วอดก้า ไม่ใส่สมุนไพร)

**เช็คให้แล้วว่าฟอร์มไม่รองรับจริง**: ภส.๐๗-๐๒/๑(๑) มี 19 คอลัมน์ · ยอดคงเหลือ 3 ถังไหลเป็นสายเดียว ·
กลุ่ม "การกลั่น" รับ input เป็น **น้ำส่า** เท่านั้น · ไม่มีคอลัมน์ "โอนไปผลิตสุราอื่น" หรือ "สูญเสียระหว่างผลิต"
⇒ เขียนการกลั่นรอบสองลงกระดาษใบนี้ไม่ได้เชิงโครงสร้าง

**🚩 ปัญหาที่ผู้ใช้ยังไม่ได้พูดถึง และเป็นโจทย์จริงของงาน**: ถ้าลงฟอร์มว่า *กลั่นได้ 240* แล้วปรุงจาก *180*
(ยอดหลังกลั่นซ้ำ) → **คงเหลือสุรากลั่นบนฟอร์มพองขึ้น 60 ล. ทุกรอบการผลิต ตลอดกาล** โดยไม่มีอะไรฟ้อง
→ ทางออก: **กลืนการกลั่นซ้ำเข้าขั้น "การปรุง"** แล้วอธิบายด้วยหมายเหตุ (วิธีที่ผู้ใช้ไปสอบถามสรรพสามิตมา)

**🔄 ผมเสนอผิดแล้วผู้ใช้แก้ให้ 1 รอบ**: ผมเสนอ *แถวปรุงแถวเดียววันปรับดีกรี* → ผู้ใช้เลือก **แยก 2 ท่อน**
เพราะบรรทัด "นำไปปรุง 240" (ฟอร์มสุรา) กับบรรทัดตัดสมุนไพร (ฟอร์มวัตถุดิบ) **ตกวันเดียวกัน ยันกันเอง**
เจ้าหน้าที่เปิดสองใบมาเทียบแล้วเห็นภาพจบในตัว — เหตุผลที่ดีกว่าของผม และ**ตอบคำถามที่ค้างไปในตัว**
ว่าการใส่สมุนไพรลงแช่ = จุดเริ่มของการปรุง

**🚩 ข้อมูลที่ผู้ใช้ให้แล้วเปลี่ยนน้ำหนักการตัดสินใจ**: บัญชีประจำวัน**ไม่ได้ส่ง**สรรพสามิต เป็นเอกสารให้ดู
ตอนเข้าตรวจโรงงาน · ใบที่ยื่นจริงคือ **งบเดือน** ซึ่งเช็คแล้วว่า `summaryReport` อ่านแค่ `logMaterial`+`logProduct`
⇒ **การแยกบรรทัดไม่มีผลกับงบเดือนแม้แต่ช่องเดียว** และอาการ "ตัดวัตถุดิบเดือนนี้ ผลิตเดือนหน้า"
เป็นสภาพปกติของโรงอยู่แล้ว (น้ำอ้อยก็เป็นแบบนี้)

## โครงสร้าง

`log_redistill` (หัวล็อต · 1 ครั้งที่ยกสุราออกจากถัง) + `log_redistill_round` (รอบละแถว · cascade)

- 🔴 **`draw_vol` คือตัวเลขเดียวที่ไปโผล่บนเอกสารราชการ** — รอบเป็นแค่*รายการ* ไม่ใช่*เงื่อนไข*
  ⇒ เพิ่มรอบ 3, 4, 5 ไม่มีทางไปขยับเลขบนฟอร์มโดยบังเอิญ (บทเรียน D84: else ที่กลืนของใหม่)
- 🚨 **ห้ามแตะ `log_distill`** — กติกาเหล็ก 1 batch = 1 แถว · กลั่นซ้ำเป็นงานคนละหน่วย (หลาย batch → 1 ล็อต)
- ★ คีย์ล็อตเป็น `(tenant, lot_no)` **ไม่มี entity** ต่างจาก `log_distill` โดยตั้งใจ — เลข batch เป็นของเดิม
  ที่ 0027 ต้องขยายเป็น "ต่อโรง" ตามข้อมูลที่มีอยู่ ส่วนเลขล็อตเป็นชุดใหม่ที่ระบบตั้งเอง
  🪤 ใส่ entity ในคีย์ = 2 โรงมี `S1/69` พร้อมกันได้ → `select into` หยิบแถวแรกโดยไม่ error = แก้ผิดโรงเงียบ ๆ
- 🚨 ท่อน **'ยกไปปรุง' เขียนตอนเปิดล็อต ไม่ใช่ตอนปิด** — ระหว่างแช่เป็นสัปดาห์ ถ้ายังไม่หัก
  ระบบจะคิดว่าสุราก้อนนั้นว่างอยู่ แล้วปล่อยให้กดปรุงซ้ำได้อีก = **นับสุราสองครั้ง**
  ★ ผลพลอยได้: `remainingDistillVol` (P9 · golden) **ถูกต้องเองโดยไม่ต้องแก้ `calc.ts` เลย**
- 🚨 ธง `log_distill_run.is_redistill` เป็น**คอลัมน์ชัดเจน ห้ามดูจากรูปแบบชื่อว่าขึ้นต้นด้วย S** (D90)
  reuse ตารางเดิมได้เพราะ **ไม่มีฟอร์ม ภส. ใบไหนอ่าน `log_distill_run` เลย** → ได้ timer+กราฟ+หน้าประวัติฟรี
- สมุนไพร → `log_material` `'จ่าย'` `doc_ref = "S1/69 รอบ 2"` **วันเดียวกับวันเริ่มแช่**
  ⇒ ขึ้นฟอร์ม ภส.๐๗-๐๑/๑ เองโดย**ไม่แตะ `materialReport`** · 🪤 RPC **ตรวจรูปแบบ doc_ref ซ้ำ**
  เพราะมันลบ `log_material` ด้วยค่านั้น — รับค่าอะไรก็ได้แล้วส่งเลข batch มา = ลบวัตถุดิบที่เบิกไปหมักทิ้ง

## 🔴 เจอบั๊กเก่าระหว่างทาง 2 ตัว

1. **`hasActivity` ตก `diluFinalVol`** ([reports.ts](../lib/production/reports.ts)) — วันที่มีแต่ `final_vol`
   จะถูกข้ามทั้งวัน แล้วยอด "คงเหลือสุราปรุง" กระโดดบนบรรทัดวันหลังโดยไม่มีอะไรอธิบาย
   · เดิมไปไม่ถึงเพราะ `final_vol > 0` แปลว่า `start_vol > 0` เสมอ — **การแยกท่อนคือสิ่งที่ทำให้เอื้อมถึงครั้งแรก**
   · ★ ข้อมูลเก่าทุกแถวค่าไม่เปลี่ยน ⇒ **golden P5/P6/P7 ผ่านโดยไม่แก้ไฟล์เทส**
2. **ช่องหมายเหตุไม่มีตัวคุมความกว้างเลย** — วัดจาก template จริง: ช่องกว้าง **60.4 pt**
   (เส้นแบ่งคอลัมน์ที่ x=819.1 − จุดเริ่ม 758.7 · **ไม่ใช่ขอบกระดาษ 841.8**) แต่ข้อความอัตโนมัติเดิม
   *"ปรุงปรับดีกรี 40 ได้ปริมาณ 292.50 ลิตร"* = **69.0 pt ล้นเส้นอยู่แล้ว 8.6 pt**
   · D78 ใส่ `fit()` ให้เฉพาะฟอร์ม**สุราแช่** ฝั่งสุรากลั่นวาดตรง ๆ มาตลอด
   · ผู้ใช้เลือก **ขึ้นบรรทัดที่ 2 ห้ามตัดประโยค** → `lib/pdf/noteFit.ts` (wrap ตามช่องว่าง → ย่อฟอนต์ → ธง overflow)
   · 🪤 **รอบแรกวางผิด**: จัด 2 บรรทัด "กึ่งกลางรอบ baseline" → บรรทัดล่างทะลุเส้นตาราง
     เพราะ **baseline ของฟอร์มนี้อยู่สูงจากเส้นล่างแค่ 2.59 pt** (ต่ำจากเส้นบน 9.89)
     ⇒ ต้องคิดจาก**กรอบช่อง** ไม่ใช่จาก baseline · เทสล็อกทั้งทิศถูกและอาการเดิม
   · ★ 1 บรรทัดที่พอดีอยู่แล้ว คืนขนาด+baseline เดิมเป๊ะ ⇒ แถวเดิมที่เคยพิมพ์ถูกไม่ขยับ
   · 🚩 **พิสูจน์ด้วยการเรนเดอร์ PDF จริงส่งให้ผู้ใช้ดูด้วยตา 2 รอบ** — build/lint/test มองไม่เห็นเรื่องนี้เลย

## จุดที่จงใจทำ

- แท็บ **กลั่นซ้ำ** โชว์คู่กับเส้นทางสุรากลั่นเสมอ — ไม่มีธงไหนบอกได้ว่าโรงนี้กลั่นซ้ำไหม **การซ่อนก็คือการเดา**
- แถวปรุงจากล็อต **แก้/ลบที่แท็บปรุงไม่ได้** (ปุ่มเทา + title บอกว่าไปกดที่ไหน — ซ่อนปุ่มแย่กว่าปุ่มเทา D86)
  เปิดสองทาง = วันหนึ่งมีคนแก้ 240 เป็น 180 แล้วเลขในล็อตกับเลขบนฟอร์มเถียงกัน (D81/D88)
- **เตือน ไม่บล็อก** ทุกจุด: รอบไม่ต่อเนื่อง · ปิดเดือนทั้งที่มีล็อตค้าง (ผู้ใช้ย้ายมาจาก Sheets)
- `lotsPendingAtMonthEnd()` เตือนบนการ์ดปิดเดือน — ช่วง *กลั่นซ้ำเสร็จแต่ยังไม่ปรับดีกรี* คือช่วงเดียวที่
  บัญชีห่างจากของจริง 🪤 **ยังไม่กลั่น ณ สิ้นเดือน = ไม่เตือน** (สุรานอนอยู่ในถังแช่ครบ ตรงกับบัญชีพอดี)
- คำว่า "แช่" ในหมายเหตุ **ตัดสินจาก `soak_date` จริง ไม่ฮาร์ดโค้ด** — วอดก้า 3 รอบไม่ใส่สมุนไพร
  เขียนว่า "ยกไปแช่" ก็เป็นคำโกหกบนเอกสารราชการ
- ถอนการปิดล็อต / ลบล็อต มีครบ (แพตเทิร์น *ถอนปิดเดือน* D91 / *ถอนปิด batch* D93)
  🚨 `row_count = 0` ตอบ error ไทย ไม่ใช่ ok เงียบ ๆ

## ยังต้องยืนยันกับสรรพสามิต (ผู้ใช้ยังไม่เคยยื่นจริง)

1. บรรทัด "นำไปปรุง 240" ที่ไม่มีผลผลิตในเดือนนั้น รับได้ไหม
2. แอลกอฮอล์บริสุทธิ์หายไป ~30% ในขั้นปรุง ต้องมีเอกสารประกอบเพิ่มไหม
3. มีแบบฟอร์มเฉพาะสำหรับโรงที่กลั่นซ้ำหรือเปล่า
★ จุดตัดสิน "แยกกี่แถว" อยู่ที่ `dilutePlan()` **จุดเดียว** พลิกได้โดยไม่ต้องรื้อ (แพตเทิร์น `drawnVol()` D78)

---

## ✅ เทสในเบราว์เซอร์จริงแล้ว — เจอบั๊ก 2 ตัวที่ build/lint/test เดิมผ่านหมด (migration 0062)

เทสบน tenant `siamdist` ครบ 10 ข้อของ TESTING ส่วนที่ 51 · **ข้อพิสูจน์หลักผ่าน**:
ฟอร์ม ภส. แถว 28/09/69 ช่อง *นำไปปรุง* = **240** (ไม่ใช่ 180) · คงเหลือสุรากลั่นปลายเดือน **0** ·
ภส.๐๗-๐๑/๑ ตัดสมุนไพร **28/09/69** เลขอ้างอิง `S1/69 รอบ 2` = **วันเดียวกัน ยันกันเองข้ามสองฟอร์ม** ·
เพิ่มรอบที่ 3 แล้วตัวเลขเดือน ก.ย. **ไม่ขยับสักช่อง** · แถววันปรับดีกรีขึ้นบนฟอร์มจริง (บั๊ก `hasActivity`)

### 🔴 บั๊ก 1 — หมายเหตุบนฟอร์มไม่ตามทันตอน "แช่อยู่"

เปิดล็อต → หมายเหตุถูกเขียนตอนนั้นว่า *"ยกไปกลั่นซ้ำ S1/69"* (ยังไม่มีรอบ จึงไม่มีคำว่าแช่)
แล้วบันทึกรอบที่มีวันเริ่มแช่ + ตัดสมุนไพร → **หมายเหตุไม่ถูกอัปเดตเลย** เพราะ 0061 เขียนทับ
เฉพาะตอน close/reopen

🚨 ช่วง "แช่อยู่" กินเวลาเป็นสัปดาห์ = **สภาพปกติที่เจ้าหน้าที่จะเห็นตอนเข้าตรวจ** ⇒ ฟอร์มสุราเขียนว่า
*ไม่ได้แช่* ขณะที่ฟอร์มวัตถุดิบวันเดียวกันตัดสมุนไพรอยู่ = **สองใบขัดกันเองบนกระดาษ**
ซึ่งเป็นสิ่งที่การแยกท่อนตั้งใจจะแก้พอดี (ตระกูล D91/0059 — ตรรกะถูก ประโยคที่คนอ่านผิด)

→ **0062**: `fn_save_redistill_round` / `fn_delete_redistill_round` รับ `p_draw_note` แล้วเขียนทับ
🪤 พารามิเตอร์เพิ่ม = **ต้อง `drop function` ก่อน** ไม่งั้นได้ overload ตัวที่ 2 (D69) ·
★ ข้อความยังสร้างจาก `lotNoteText()` ฝั่ง lib เหมือนเดิม **ห้ามประกอบประโยคใน SQL** ·
🚩 พิสูจน์ 2 ทิศทาง: บันทึกรอบที่แช่ → *"ยกไปแช่สมุนไพรและกลั่นซ้ำ"* · ลบรอบนั้นออก → กลับเป็น *"ยกไปกลั่นซ้ำ"*

### 🟡 บั๊ก 2 — "หายระหว่างทาง 100.00%" ทั้งที่ยังไม่มีอะไรหาย

การ์ดสรุปโชว์ % ที่หายทันทีที่เปิดล็อต (ยังไม่บันทึกผลรอบไหนเลย) → `lpaOut = 0` ⇒ คิดออกมาเป็น 100%
**ตัวเลขที่ไม่จริงและน่าตกใจ** ทั้งที่ของยังอยู่ในถังครบ → `lpaLossPct` เป็น `number | null`
คืน `null` เมื่อยังไม่มีอะไรให้เทียบ · หน้าจอโชว์ `—`

### 🪤 เจอตอนเตรียมเทส (ไม่ใช่บั๊กแอป แต่เป็นบั๊กในของที่ส่งมอบ)

`seed_redistill.sql` รันใน SQL Editor **ไม่ได้** — insert อาศัย default `my_tenant()`/`my_default_entity()`
ซึ่งอ่านจาก JWT แต่ SQL Editor รันเป็น role `postgres` ไม่มี JWT → คืน `null` → ชน not null
(ยืนยันด้วย service role: `select my_tenant()` = null) · และ `on conflict (material_id)` ก็ผิด
เพราะ 0027 ผ่าตัด PK เป็น composite ไปแล้ว → ต้องเป็น `(tenant_id, material_id)`
★ **seed รุ่นก่อน ๆ มีปัญหาเดียวกัน** (ยังไม่แก้ในรอบนี้ — จดไว้ที่ NEXT_STEPS)

### ✅ ที่พิสูจน์แล้วว่าถูก

ด่านกันยกออกเกินคงเหลือ (300 > 240 → error ไทย ไม่มีแถวเกิด) · คงเหลือ 240 → **0 ทันทีที่เปิดล็อต**
(ท่อน 'ยกไปปรุง' เขียนตอนเปิดจริง) · ABV correction 67%@25°C → **65.30** · ค่าระหว่างกลั่นซ้ำ**ไม่รั่ว**
ไปปนกับ batch หมัก (หน้าประวัติแยกการ์ด *เทียบการกลั่นซ้ำ* · กระดาน batch สะอาด) ·
แถวปรุง 2 ท่อนที่แท็บปรุง**เป็นปุ่มเทาทั้งคู่** พร้อม tooltip · แถวปรุงเดิมของลูกค้ายังแก้/ลบได้ปกติ ·
เตือนก่อนปิดเดือน 2 ทิศ (ต.ค. เตือน 140 ล. · **ก.ย. ไม่เตือน** เพราะสุรายังนอนในถังแช่ครบ) ·
ลบล็อตเก็บกวาดครบ 4 ตาราง (คงเหลือกลับมา 240 · จูนิเปอร์กลับมา 10) · `edit_log` มี audit ครบ

---

**ไฟล์**: migration **0061** + **0062** · `lib/production/redistill.ts` + `.test.ts` (50) ·
`lib/production/redistillReport.test.ts` (8) · `lib/pdf/noteFit.ts` + `.test.ts` (13) ·
`lib/pdf/excise.ts` (คุมกรอบช่องหมายเหตุ) · `lib/production/reports.ts` (2 จุด) ·
`lib/shared/tabs.ts` · `lib/shared/tenantTables.ts` · `lib/export/tenantExport.ts` ·
`app/(app)/production/{data,actions,excise-data}.ts` + `RedistillTab`/`DiluteTab`/`ExciseTab`/`HistoryTab`/`ProductionApp` ·
`scripts/{backup-tables,sample-redistill-pdf}.ts` · `tests/tenant/harness.ts` ·
build/lint/test **1004** ผ่าน · ชุดเทส `docs/TESTING.md` ส่วนที่ **51**

### D95 — "ยื่นแล้ว" เป็นเหตุการณ์ของตัวเอง + 3 จังหวะเตือน + วิธียื่นของกิจการ (0071, 2026-09-12)

**ต้นเรื่อง — ผู้ใช้ถามว่าอะไรคือทริกเกอร์ของการเตือน แล้วชี้ปัญหา 3 ข้อซึ่งถูกทั้งหมด**

1. **ผูกการเตือนกับปุ่มชำระภาษีไม่ได้** — เดือนที่ทุกอย่างเป็นศูนย์ `taxDueBoard()` ตอบว่า
   *"เดือนนี้ไม่มีภาษีต้องชำระ"* และ `canPay()` เป็น false **แต่ ภพ.30 ยังต้องยื่นทุกเดือน**
   ⇒ เอา "จ่ายแล้ว" มาเป็นตัวปิดเสียงเมื่อไหร่ เดือนยอดศูนย์จะถูกเตือนไม่มีวันหยุด
2. 🔴 **"กดออกรายงานแล้วแต่ยังไม่ได้ยื่น ระบบเลยไม่เตือน"** — นี่คือความผิดพลาดเชิงออกแบบ
   **ตัวเดียวกับที่ D90/D91 แก้ไปแล้วฝั่งสรรพสามิต แต่ยังค้างอยู่ฝั่งสรรพากร**:
   D88 เอา `report_runs` (เช็กลิสต์ *กดพิมพ์แล้ว* · comment ใน 0005 เขียนไว้เอง) ไปตอบคำถาม
   *"ยื่นแล้วหรือยัง"* ⇒ กดสร้าง ภพ.30 กลางเดือนเพื่อ**ดูตัวเลข** = การเตือนงวดนั้นหายตลอดกาล
   🪤 **ตารางที่มีข้อมูลอยู่แล้วพอดี ไม่ได้แปลว่ามันตอบคำถามที่เรากำลังถาม** (ยกจาก D91 ทั้งประโยค)
3. **ส.ค. ไม่มีเตือน ภงด.3/53** — ตรวจแล้ว **ไม่ใช่บั๊ก**: เดือนนั้นไม่มียอดหัก ณ ที่จ่าย
   จึงไม่มีหน้าที่ยื่น (ผู้ใช้ยืนยันเอง) · เกณฑ์ที่ cron ใช้ตรงกับ `whtReport()` ทุกข้อ

**ที่ทำ**

- ตาราง **`tax_filings`** — ผู้ใช้ประกาศเองว่ายื่นแล้ว ต่อแบบต่องวด · ถอนได้ (เติม `reopened_at`
  **ไม่ลบแถว**) · partial unique index `where reopened_at is null` · **ไม่มี policy เขียน**
  เขียนผ่าน RPC definer เท่านั้น — ยกแพตเทิร์น `excise_month_close` (D91) มาทั้งดุ้น
- 🚨 **`report_runs` ไม่ถูกแตะแม้บรรทัดเดียว** — ยังเป็นเช็กลิสต์ และยังเป็นเงื่อนไข
  *"ต้องสร้างแบบก่อนถึงจะจ่ายได้"* ของ D88 เหมือนเดิม · เปลี่ยนแค่ **คนที่ถูกถามว่ายื่นหรือยัง**
- **จ่ายแล้ว = ยื่นแล้ว** (ผู้ใช้เลือก) → `fn_pay_tax` ติ๊ก `tax_filings` ให้เอง `source='pay'`
  🚨 **ทิศทางเดียว** — ติ๊กยื่นไม่ได้แปลว่าจ่ายแล้ว · และ `fn_unpay_tax` **จงใจไม่ถอนการยื่น**
  (ถอนจ่ายเพราะกรอกยอดผิด ไม่ได้แปลว่าไม่ได้ยื่น)
  🪤 บล็อกที่เติมใช้ `where not exists` **ห้ามปล่อยให้ unique index เด้ง** — ทั้งฟังก์ชันเป็น
  transaction เดียว ⇒ ผู้ใช้ที่ติ๊กยื่นเองไว้ก่อนแล้วมากดจ่าย จะ**เสียบิลจ่ายทั้งใบ**
- **3 จังหวะแทน 1** (`pre` ล่วงหน้า 3 วัน · `due` วันสุดท้าย · `late` วันถัดมา **ครั้งเดียว ไม่วนซ้ำ**)
  — ของเดิมยิงวันเดียวแล้วจดกันซ้ำ ⇒ **พลาดวันนั้น = งวดนั้นเงียบตลอดกาล**
  🚨 เจตนาที่ไม่ทำ: วนเตือนทุกสัปดาห์หลังเลยกำหนด — ข้อความที่ถูกปัดทิ้งจนเป็นนิสัย
  จะพาข้อความสำคัญไปด้วย (ผู้ใช้เห็นด้วยกับเหตุผลนี้)
  🪤 `leadDays = 0` ทำให้ pre ชนกับ due → ตัดวันซ้ำ เก็บจังหวะที่หนักกว่า (ไม่ยิง 2 ข้อความวันเดียว)
- 🚨 **1 ข้อความต่อ 1 จังหวะ** — หัวข้อความ ("อีก 3 วัน" / "วันนี้วันสุดท้าย" / "เลยกำหนดแล้ว")
  ต้องตรงกับทุกบรรทัดข้างใน · รวมคนละจังหวะไว้ด้วยกัน = หัวข้อความโกหกบรรทัดใดบรรทัดหนึ่งเสมอ
  (ตระกูล D91/0059) → `sendByStage()` ตัวเดียวใช้ทั้งงานสรรพากรและสรรพสามิต
- **`entities.filing_method`** (`paper` / `efiling`) ตั้งที่ **ตั้งค่า → กิจการ** — ตัดสินว่า
  "วันสุดท้าย" ของกิจการนี้คือวันไหน (ภพ.30: 15 หรือ 23) ⇒ เลิกบอก 2 กำหนดทุกเดือน
  ซึ่งมีอันหนึ่งที่ไม่เกี่ยวกับกิจการนี้เลยเสมอ
  🚨 **ไม่ตั้ง = ใช้กำหนดกระดาษ (เร็วกว่า) แต่ต้องบอกในข้อความว่ายังไม่ได้ตั้งและตั้งที่ไหน**
  หลักเดียวกับ "ไม่เลื่อนวันหยุดราชการให้" (D88) — เตือนเร็วไปดีกว่าเดาแล้วช้า ·
  ★ อยู่ในฟอร์มเดียวกับข้อมูลกิจการได้เพราะเป็นข้อมูล**ของกิจการที่กำลังแก้**จริง ๆ
  (ต่างจาก `sales_doc_entity` ที่ D63 ต้องแยก action) · 🚨 **ไม่แตะ `is_vat`** (เจตนา D55/D93)
- **ฝั่งสรรพสามิตได้ 3 จังหวะด้วย** — งบเดือนไม่มี e-Filing → วันสุดท้ายคือ 15 เสมอ
  ไม่มีตัวเลือกวิธียื่น (ไม่รู้ **และไม่เดา** — กติกา D92)
- 🚨 **key กันส่งซ้ำของจังหวะ `pre` ต้องเป็นรูปแบบเดิมเป๊ะ** ทั้ง 2 งาน — ลูกค้ามีแถวจดไว้แล้ว
  ใน `integration_log` เปลี่ยนรูปแบบ = งวดที่เคยเตือนแล้วถูกส่งซ้ำทั้งชุด · จังหวะใหม่ต่อท้าย `-due`/`-late`
- **backfill เฉพาะจาก `tax_payments` ที่ยังไม่ถูกถอน** (จ่ายแล้ว = ยื่นแล้ว)
  🚨 **ไม่ backfill จาก `report_runs`** เพราะนั่นแปลว่ากดพิมพ์ ซึ่งคือสาเหตุทั้งหมดของงานนี้
  ⇒ ผลที่ตามมา**โดยตั้งใจ**: งวดที่ยื่นแล้วแต่ไม่เคยจ่าย (ยอดศูนย์) จะถูกเตือนอีกครั้ง
  จนกว่าจะกดปุ่ม "ยื่นแล้ว" ครั้งแรก — ยอมรับได้ และเป็นการชี้ให้เห็นปุ่มใหม่ไปในตัว
- UI: การ์ดเปลี่ยนชื่อเป็น **"ยื่นและชำระภาษี"** · **2 ป้ายต่อแถว** (ยื่นแล้วยัง / จ่ายแล้วยัง)
  🚨 ยัดสองคำถามลงป้ายเดียว = ป้ายที่ตอบไม่ตรงคำถามใดคำถามหนึ่งเสมอ (ตระกูล D84) ·
  ปุ่ม "ยื่นแล้ว" **กดได้แม้ปุ่มจ่ายเทา** (นี่คือข้อ 1 ของผู้ใช้) · บรรทัดบอกวันที่จะถูกเตือน
- 🚨 **ไม่บังคับว่าต้องกดสร้างแบบก่อนถึงจะติ๊กยื่นได้** (ต่างจาก `fn_pay_tax` โดยตั้งใจ) —
  ผู้ใช้กรอกในเว็บ e-Filing เองเป็นปกติ (D69) ระบบไม่มีสิทธิ์บอกว่า "คุณยังไม่ได้ยื่น"
  เพียงเพราะไม่ได้กดพิมพ์ในแอป → **เตือน ไม่บล็อก**
- 🚨 **ถอนการยื่นไม่ได้ขณะยังมีการจ่ายค้าง** — จ่ายแล้วแปลว่ายื่นแล้ว ปล่อยให้ขัดกันเมื่อไหร่
  = "ยื่นแล้ว" มีสองนิยามในระบบเดียว (ตระกูล D81/D88 ข้อ 1) · และบอกว่าต้องกดอะไรก่อน (D83)
- สิทธิ์: ติ๊กยื่น = `acct.write` · **ถอน = `acct.config`** (ถอนแล้วระบบกลับไปเตือนคนทั้งกลุ่ม LINE)

**🔴 เจอระหว่างทาง — เทสจับได้ทันที**

ยก `fn_mig_truncate` มาจาก **0058** ตามที่จำได้ว่าเคยแก้ → ตกตารางของ 0061 (`log_redistill*`)
= ลบ/รีเซ็ตลูกค้าที่เคยกลั่นซ้ำไม่ได้เลย · `tenantTables.test.ts` (D79) ฟ้องทันที
→ สคริปต์ `gen-0071.mjs` เปลี่ยนไป**ค้นหาไฟล์ล่าสุดที่นิยามฟังก์ชันเอง** และอ่าน dollar-quote tag
จากไฟล์ (`$$` บ้าง `$fn$` บ้าง) แทนการฮาร์ดโค้ด 🪤 **"ไฟล์ที่เราจำได้ว่าแก้ล่าสุด" ไม่เท่ากับ
"ไฟล์ล่าสุดที่นิยามมัน"**

**ชั้นเทสที่เพิ่ม** — กติกาของงานนี้อยู่ 3 ที่ที่ TS มองไม่ทะลุถึงกัน (cron / plpgsql / lib)
หลุดข้างใดข้างหนึ่ง**ไม่มี error ทั้งคู่** → `taxFiling.test.ts` **อ่านซอร์ส cron + ไฟล์ SQL จริง**
มาตรวจ (ชั้นเดียวกับ `exciseHidden.test.ts` D90 / `rolesSql.test.ts` D85) ข้อที่ล็อกไว้:
cron ต้องไม่ query `report_runs` · ต้องอ่าน `error` · `fn_pay_tax` ต้อง insert `tax_filings` ·
`fn_unpay_tax` ต้องไม่แตะ · ห้าม backfill จาก `report_runs` · ไม่มี policy เขียน ·
🪤 ตรวจ **การ query จริง** ไม่ใช่คำในไฟล์ — ไม่งั้นเทสห้ามเขียนคอมเมนต์ที่จำเป็นที่สุดของงานนี้

---

**ไฟล์**: migration **0071** (สร้างด้วย `node scripts/gen/gen-0071.mjs` · header ที่
`scripts/gen/0071-header.sql`) · `lib/accounting/taxFiling.ts` + `.test.ts` (golden **A20** 35) ·
`lib/accounting/{taxPay,taxReminder}.ts` (+ เทส A18 ปรับ) · `lib/shared/period.ts` (`DUE_STAGES`
บ้านกลาง — 🚨 `lib/production` ห้าม import `lib/accounting`) · `lib/production/exciseReminder.ts` ·
`lib/shared/tenantTables.ts` · `lib/export/tenantExport.ts` · `scripts/backup-tables.ts` ·
`app/api/cron/tax-reminder/route.ts` · `app/(app)/accounting/{data,actions}.ts` + `TaxPayCard` ·
`app/(app)/settings/{settings-data,actions}.ts` + `CompanyCard` · `tests/tenant/tax-filings.test.ts` ·
build/lint/test **1410** ผ่าน · ชุดเทส `docs/TESTING.md` ส่วนที่ **54**

#### รอบแก้หลังรัน `test:tenant` (migration 0072, 2026-09-14)

**เทสแดง 1 ข้อ — แต่เป็นเทสที่เขียนผิดเอง ไม่ใช่บั๊กของโค้ด**

ข้อ *"ข้าม tenant ไม่ได้"* ยิง `fn_file_tax` ด้วย `A.entityId` จาก tenant B แล้ว assert ว่าต้องล้มเหลว
แต่ `harness.ts` **ตั้งใจ**ให้ทั้งสอง tenant ใช้ `EID01` เหมือนกัน (พิสูจน์ composite PK ของ 0027)
⇒ B ยิงด้วยค่านั้น = ยิงด้วย **กิจการของตัวเอง** ซึ่งต้องสำเร็จ
🪤 **คำเตือนเรื่องนี้เขียนอยู่ใน `harness.ts` บรรทัด 74-76 อยู่แล้ว** (*"ห้ามใช้ทดสอบการยิงข้าม tenant
— เรียกไปจะไปโดนของตัวเอง แล้วสำเร็จ ทำให้เทสไม่ได้ทดสอบอะไรเลย"*) — ผมไม่ได้อ่านตอนเขียน
🚨 **เทสที่แดงด้วยเหตุผลผิด อันตรายพอกับเทสที่เขียวด้วยเหตุผลผิด** (บทเรียน D85/D92)

การกันข้าม tenant **ทำงานถูกอยู่แล้ว** — `v_tenant := my_tenant()` ผู้เรียกระบุ tenant เองไม่ได้เลย
→ เขียนเทสใหม่ให้พิสูจน์ของจริง: ชื่อกิจการซ้ำกันข้าม tenant แล้วแถวต้องไม่ไหลไปหากัน
(**นับแถวฝั่ง A ก่อน/หลัง** ไม่ใช่แค่ดูว่า B สำเร็จไหม)

**★ แต่การไล่สาเหตุเปิดโปงจุดที่ควรแก้จริง (0072)**

`fn_file_tax` **ไม่เคยตรวจว่ากิจการมีอยู่จริง** ต่างจาก `fn_excise_close_month` ของ D91
ยิงรหัสกิจการผิดได้ 2 อาการ ซึ่งแย่ทั้งคู่:
- `p_kind = 'vat'` → `entity_is_vat()` คืน false → เด้ง *"กิจการนี้ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม"*
  ซึ่ง **บอกเหตุผลผิด** แล้วผู้ใช้ไปแก้ผิดเรื่อง (ตระกูล D91/0059 — ด่านกันถูก ประโยคผิด)
- `p_kind = 'pnd3'` → หลุดไปชน FK แล้วโยน **SQLSTATE 23503 ดิบภาษาอังกฤษ** ออกหน้าจอ

→ ด่าน `ไม่พบกิจการ %` **ก่อน**ด่าน VAT (ยกจาก 0071 ด้วย `scripts/gen/gen-0072.mjs` · diff เหลือเฉพาะบล็อกที่เติม)

🚨 **ต้องเป็น migration ใหม่ ไม่ใช่แก้ไฟล์ 0071** — 0071 ลง DB ไปแล้ว · `supabase db push`
ไม่รันไฟล์ที่บันทึกว่ารันแล้วซ้ำ ⇒ แก้ไฟล์เดิม = **ไม่มีผลกับ DB ที่ลงไปแล้ว แต่ผ่านบนเครื่องที่ยังไม่ลง**
= สองฝั่งหลุดจากกันเงียบ ๆ

**🪤 เทสที่เพิ่มเพื่อล็อกลำดับด่าน ก็ยังเขียนผิดรอบแรก**

ตรวจลำดับด้วย `fn.indexOf("entity_is_vat")` → ไปจับคำที่อยู่ใน**คอมเมนต์อธิบายด่านนั้นเอง**
(คอมเมนต์เขียนว่า *"ไม่งั้น `entity_is_vat()` คืน false"*) ⇒ เทสแดงทั้งที่ลำดับในโค้ดถูก
★ **กับดักตัวเดียวกับข้อ *"cron ต้องไม่ query report_runs"* ในไฟล์เดียวกันนี้เอง** —
⇒ ตรวจ **โค้ดจริง** (`raise exception 'ไม่พบกิจการ` / `not entity_is_vat(`) ไม่ใช่คำในไฟล์

---

**ไฟล์**: migration **0072** (`scripts/gen/{0072-header.sql,gen-0072.mjs}`) ·
`tests/tenant/tax-filings.test.ts` (เขียนข้อ ④ ใหม่ 2 ทิศ) · `lib/accounting/taxFiling.test.ts`
(+1 ข้อ ล็อกลำดับด่าน) · test **1411** ผ่าน

**ผลหลังลง 0072 ทุก DB**: `npm run test:tenant` เขียวหมด — **12 ไฟล์ / 294 ข้อ**
โดย `tax-filings.test.ts` มี **18 ข้อ** (ข้อที่เคยแดงถูกเขียนใหม่เป็น 2 ข้อ จึงเพิ่มจาก 17)

🪤 **ผมอ่านผลลัพธ์ vitest ผิดแล้วรายงานผู้ใช้ผิด** — บอกไปว่า "17/17 ผ่าน" ทั้งที่บรรทัด
`Test Files 12 passed` คือจำนวน**ไฟล์เทส** ส่วนจำนวนข้ออยู่บรรทัด `Tests 294 passed`
(ผู้ใช้ทักเอง: *"เป็น 12 passes ไม่ใช่ 17 แบบที่คุณบอก"*) ⇒ เลขที่รายงานต้องมาจากบรรทัดที่ตรงกับ
สิ่งที่กำลังพูดถึง ไม่ใช่เลขแรกที่เห็น

### D96 — โมดูลบาร์/POS หน้าร้าน (0063-0070, 2026-09-10 → 2026-09-14)

> เอกสารแผนเต็ม: `docs/BAR_POS_PLAN.md` (ภาค 1 = ข้อ 0-20 · ภาค 2 = ข้อ 21-38)
> ชุดเทส: `docs/TESTING.md` ส่วนที่ **53**

**ต้นเรื่อง**: เจ้าของโรงกลั่นเปิดบาร์ชิมของตัวเอง — ขายเป็น *แก้ว* หน้าร้านและตามงานอีเวนต์
ซึ่งเป็นคนละหน่วยและคนละเอกสารกับการขายส่งเป็นขวดที่โมดูล `sales` ทำอยู่

---

### ⛓ กติกาเหล็กข้อ 1 ของโมดูลนี้ — `/bar` ห้ามแตะตารางฝั่งผลิต/ขายแม้แถวเดียว

โรงงานขายขาดเป็นขวดให้บาร์ → ฟอร์ม ภส. จบหน้าที่ตรงนั้น
การแบ่งขายเป็นแก้วต่อจากนั้น **ไม่เกี่ยวกับเอกสารราชการใด ๆ**

🚨 เผลอต่อท่อเข้า `stock_product` / `log_product` เมื่อไหร่ **ตัวเลขบนเอกสารที่ยื่นสรรพสามิต
จะขยับโดยไม่มีอะไรฟ้อง** — ความผิดพลาดที่แพงที่สุดที่ระบบนี้ทำได้

🪤 การเผลอเขียน `.from("stock_product")` ในโค้ดบาร์ **`build`/`lint`/`test` ปกติผ่านหมด**
เพราะมันเป็นโค้ดที่ถูกต้องทุกประการ *แค่ผิดที่*
⇒ `lib/bar/isolation.test.ts` **อ่านซอร์สทั้งโมดูลมาตรวจ** (ชั้นเดียวกับ `tenantTables.test.ts` D79 ·
`rolesSql.test.ts` D85 · `exciseHidden.test.ts` D90)

บาร์มีคลังของตัวเอง (`bar_item` · `bar_move`) และ **รับของเข้าด้วยการซื้อจากโรง** เหมือนลูกค้าคนหนึ่ง

---

### โครงสร้าง

| ชั้น | ของที่เพิ่ม |
|---|---|
| โมดูลที่ **5** | คีย์ `bar` · cap `bar.read` / `bar.write` / `bar.config` · role ใหม่ `bar` = พนักงานบาร์ |
| ตาราง (0064) | `bar_item` `bar_category` `bar_menu` `bar_recipe` `bar_customer` `bar_customer_fav` `bar_receive` `bar_sale` `bar_sale_item` `bar_move` `bar_post` |
| RPC (0065-0070) | เปิด/ปิดบิล · ขายเร็ว · void · ออกใบเสร็จ · ลง/ถอนบัญชีรายวัน — **definer ทุกตัว เช็ค cap + entity เอง** (บทเรียน 0028→0029 · D85) |
| `lib/bar/` | 15 ไฟล์ตรรกะบริสุทธิ์ + golden **B1-B14** |
| หน้าจอ | `/bar` 5 แท็บ: ขาย · คลัง · เมนู · ประวัติ · ตั้งค่า |

---

### 🚨 ตัดสต็อกบาร์ ณ ตอน "สั่ง" ไม่ใช่ตอน "ปิดบิล"

ของถูกรินใส่แก้วตอนสั่ง — ลูกค้าเดินหนีไม่จ่ายก็ไม่มีเหล้ากลับมาในขวด
รอปิดบิลค่อยตัด = สต็อกบนจอโกหกตลอดทั้งคืนที่มีบิลค้าง

### 🪤 บิลข้ามเที่ยงคืน — วันขายไม่ใช่วันตามปฏิทิน

บาร์ปิดตีสอง ⇒ บิลที่เปิด 23:40 กับ 00:20 เป็น *คืนเดียวกัน*
→ `bar_day_start` / `bar_day_end` + `lib/bar/businessDate.ts` (golden **B2**)
★ ตั้งเท่ากัน = ไม่ได้ตั้งรอบ ⇒ ใช้วันปฏิทิน (ไม่เดาให้)

---

## ภาค 2 — ผู้ใช้เอาไปใช้จริงแล้วแจ้งกลับ 8 ข้อ (2026-09-13 → 09-14)

> *"ที่ผมมองว่าหนักที่สุดคือโฟลวในการใช้แท็บขาย คุยกันก่อนครับว่าจะปรับยังไง"*

**เปลี่ยนเลข decision**: โมดูลนี้เขียนกำกับว่า `D95` ทั่วทั้งโค้ด แต่ `D95` ถูกใช้ไปแล้วบนอีก branch
⇒ ไล่แทนเป็น **D96** ก่อน merge (🪤 แทนแบบตาบอดไม่ได้ — ต้องเว้นข้อความที่อ้าง decision อื่นจริง ๆ)

### 🔴 บั๊กที่มีอยู่แล้วในของที่ส่งมอบรอบแรก — 10 ตัว · `build`/`lint`/`test` เดิมผ่านหมดทุกตัว

| # | อาการ | ต้นเหตุ | ตระกูล |
|---|---|---|---|
| B-1 | **ตะกร้าและส่วนลดข้ามบิลกันได้** — ลดให้โต๊ะ 3 ไป 50 แล้วไปปิดโต๊ะ 5 → โต๊ะ 5 ได้ลด 50 โดยไม่มีอะไรบนจอบอก | `cart`/`discount` เป็น state ระดับหน้า แต่ `saleNo` สลับได้ | **เงินผิดเงียบ ๆ** |
| B-2 | *"บันทึกแล้วเพิ่มเข้าบิล"* ไม่เข้าบิล | บันทึกสำเร็จจริง แต่ `addToCart(id)` ค้น `data.menus` ของรอบก่อน → หาไม่เจอ → `return` เงียบ | stale closure |
| B-3 | **ปุ่มลงบัญชีรายวันกดยังไงก็ไม่ผ่าน** — บอกให้ *"ไปตั้งที่แท็บตั้งค่าบาร์"* แต่แท็บนั้นไม่มีช่องนั้น | ทุกชั้นมีครบ ขาดแค่ช่องกรอก | **D93-B1 เป๊ะ** · D74/D77 |
| B-4 | **ยอดบาร์จะหายจาก ภพ.30 ทั้งเดือน** | `fn_bar_post_day` ไม่เซ็ต `vat_amount` และ `calc.ts` มี `if (vat_amount <= 0) continue` | ยื่นภาษีขายขาด |
| B-5 | หน้ารวมแอปโชว์การ์ดบาร์เป็น**รูปกุญแจ** เหมือนยังไม่ได้ซื้อ | `WORKSPACE_ICON` ไม่มีคีย์ `bar` → ตกไป `?? IconLock` · ประกาศเป็น `Record<string,…>` TS เลยไม่ฟ้อง | **D84 เป๊ะ** |
| B-6 | **เลข 0 ค้างในช่องตัวเลข ลบไม่ออก** (16 จุด) | บาร์ใช้ `<input type=number>` ดิบ ทั้งที่ระบบมี `NumBox` + `blankZero` อยู่แล้ว | ของมีอยู่แล้วแต่ไม่ได้หยิบมาใช้ |
| B-7 | **เปิดบิลผิดแล้วลบไม่ได้จากหน้าขาย** | RPC มี แต่ปุ่มอยู่แท็บประวัติ + บังคับ `bar.config` | ปุ่มมีแต่กดไม่ถึง (D93) |
| B-8 | ช่องเลือกวัตถุดิบถูกช่องตัวเลขกลืน | แถวเดียวยัด 3 อย่าง | — |
| B-9 | *"เมนูเฉพาะกิจ" / "หมวดระบบ"* ไม่มีใครเข้าใจ | ป้ายบอกสถานะแต่ไม่บอกความหมาย | ประโยคผิด (D91/0059) |
| B-10 | **ปุ่มโล้น** — เช็คบิล · แสดง QR · พิมพ์ซ้ำ · ลูกค้าขอใบเสร็จ เป็นสี่เหลี่ยมเทาเหมือนกันหมด | ไม่ได้ยึด `DESIGN_SYSTEM.md` | — |

🚨 **B-3 มีรูซ้อน**: `passesTaxGuard()` กรองด้วย `taxAccounts.has(account_name)` (กฎที่ D93 ตั้งไว้)
⇒ ต่อให้เซ็ต `vat_amount` ถูกแล้ว ถ้าบัญชีที่บาร์เลือกไม่ได้ถูกติ๊กว่า *นับเข้า ภพ.30* ยอดก็ยังหายอยู่ดี
→ การ์ดตั้งค่าบัญชีของบาร์ **อ่านสถานะนั้นมาแสดง** + เตือนเหลืองพร้อมบอกว่าไปติ๊กที่ไหน
(🚨 *ทุกครั้งที่ระบบไม่ทำอะไรให้ ต้องบอกว่าทำไม* — D92)

---

### 🎯 งานหลัก: รื้อโฟลว์แท็บขาย

**วินิจฉัย**: หน้าเดิมยัด *เลือกเมนู · ตะกร้ารอส่ง · บิลที่สั่งแล้ว · ส่วนลด · เก็บเงิน* ไว้ในคอลัมน์เดียวกัน
แถวในตะกร้าขึ้นทั้ง จำนวน/ส่วนลด/ชื่อเมนู ปนกัน ⇒ ผู้ใช้อ่านไม่ออกว่าอะไรสั่งไปแล้วอะไรยังไม่สั่ง
🪤 **ออกแบบมาสำหรับจอมือถือ แต่คนใช้จริงใช้บนคอม** — และผู้ใช้ยืนยันว่าบนคอมก็ยังไม่สะดวก

**ผังใหม่**: 3 โซนจริงบนจอกว้าง · ถาดติดขอบล่างบนจอแคบ
· แถวในถาดเหลือ `[− จำนวน +]  ชื่อเมนู  ราคา  ⋯`
· ส่วนลดย้ายเข้าเมนู `⋯` (ผู้ใช้สั่งว่า *"ส่วนลดซ่อนได้"*)
· **จอเก็บเงินแยกออกมาเป็นหน้าของตัวเอง**

🚨 **คงจังหวะ "ส่งเข้าบิล" ไว้ตามที่ผู้ใช้สั่ง** — ไม่รวบเป็นกดครั้งเดียวยิงเข้าบิลทันที
(บาร์เทนเดอร์กดเมนูผิดระหว่างชง ต้องมีจังหวะแก้ก่อนของถูกตัดสต็อก)

**แก้ B-1 ให้ถาวร**: `trays: Record<saleNo, CartLine[]>` + `discounts: Record<saleNo, DiscountInput>`
⇒ ตะกร้าเป็นของ *บิล* ไม่ใช่ของ *หน้าจอ* · โหมดบูธใช้คีย์ `__booth__` ของตัวเอง

🐛 **บั๊กที่เกิดจากการรื้อเองแล้วจับได้ตอนเทส**: หลังส่งเข้าบิลแล้วปุ่มเก็บเงินขึ้น **0.00**
เพราะยอดรวมคิดจากถาดอย่างเดียว ⇒ ต้องรวม `[...billLines, ...tray]` (และ `rounding` ก็คิดจากยอดผิดตาม)

---

### เฟส C — ส่วนลดเป็น % (migration 0068)

🚩 **แปลง % เป็นบาทให้เสร็จ *ก่อน* เข้า `barTotals()`** ⇒ ชั้นสูตรไม่ถูกแตะเลยแม้บรรทัดเดียว
**golden B4 (ลำดับการคิดส่วนลด) ผ่านโดยไม่แก้ไฟล์เทส** — นี่คือหลักฐาน ไม่ใช่คำกล่าวอ้าง
เก็บ `discount_pct` / `line_discount_pct` แยกจากยอดบาท (รู้ว่าผู้ใช้ *ตั้งใจ* ลดกี่ % ไม่ใช่แค่ผลลัพธ์)

### เฟส D — โหมดบูธ (ไม่มี migration)

ขายตามงานอีเวนต์: ไม่มีโต๊ะ ไม่มีบิลค้าง — กดเมนู → เก็บเงิน → จบ
🐛 เจอ **คำที่ขัดกับสิ่งที่หน้าจอทำ 2 จุด** (ตระกูล D91/0059 — ตรรกะถูก ประโยคผิด)

### เฟส E — ลงบัญชีได้จริงเป็นครั้งแรก (ไม่มี migration)

ผู้ใช้ถามเองว่า *"ขายแล้วควรไปบันทึกที่แอปบัญชีด้วยไหม ตอนนี้ผมเช็คแล้วไม่บันทึก"* ⇒ **B-3 ปลดล็อก**

**ยืนยันของเดิมว่ายังถูก: ลงบัญชีเป็น *สรุปรายวัน* ไม่ใช่ทีละบิล**
บาร์ออกบิล 60-80 ใบต่อคืน ใบละ 200 บาท — ลงทีละใบ = สมุดบัญชีจมกับแถวที่ไม่มีใครอ่าน

**ผู้ใช้เลือกทาง ข.**: คงปุ่มลงบัญชีเองไว้ **แต่เพิ่มแถบตามเก็บ + เตือน LINE**
🪤 *ปุ่มที่ต้องกดเป็นกิจวัตร คือปุ่มที่วันหนึ่งจะลืมกด* (D91) — และบาร์ลืมง่ายกว่าเพราะปิดร้านตีสอง
- golden **B12** `unpostedDays()` — 🚨 **ไม่นับวันที่ยังขายอยู่** (`d >= currentDay`) ไม่งั้นเตือนทุกวันตั้งแต่ยังไม่ปิดร้าน
- golden **B13** `barReminderMessage()` — 🚨 **ไม่บอกยอดเงิน** (ยกกติกามาจาก D88/D92 ทั้งดุ้น)
- 🔴 **เจอรูในตัวกรอง tenant ของ cron**: ลูกค้าที่ซื้อ *เฉพาะบาร์* ถูกตัดทิ้งตั้งแต่บรรทัดแรก
  ⇒ ขยายเป็น `|| mods.includes("bar")` และแยก `barPart()` ออกจาก `taxPart()`/`excisePart()`
  🪤 เอางานใหม่ไปต่อท้ายลูปเดิมที่มี `continue` = **ถูกข้ามเงียบ ๆ และ TypeScript มองไม่เห็น** (D92)

### เฟส F — VAT ครบวง (migration 0069)

ผู้ใช้ตอบว่าบาร์ **"จด / อาจจะจด"** VAT ⇒ อยู่ในขอบเขตรอบนี้

- 🚨 **ราคาหน้าบาร์เป็นราคารวม VAT อยู่แล้ว** — ถอดย้อนกลับ ไม่ใช่บวกเพิ่ม
  golden **B11** `vatFromGross()` คิด `base` ด้วยการ **ลบ** ⇒ `base + vat === gross` เป๊ะทุกยอด
  (ทดสอบไล่ทีละสตางค์ตั้งแต่ 0.01 ถึง 5,000 บาท)
- 🔴 **ใบกำกับภาษีอย่างย่อต้องออก *ทุกใบ* ไม่ใช่ออกตามคำขอ** — เดิมมีปุ่ม *ลูกค้าขอใบเสร็จ*
  ⇒ กิจการที่จด VAT ได้เลข `BR…` **ตั้งแต่ปิดบิล** และปุ่มขอทีหลังหายไป
- หัวเอกสารพลิกเป็น *ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ* + บรรทัดยอดก่อนภาษี/ภาษี 7%
- 🚩 **พิสูจน์ ภพ.30 สองทิศบนข้อมูลจริง** โดยเปลี่ยนแค่การลงบัญชีของวันเดียว:
  ลงบัญชีไว้ = **71.17** → ถอน = **0.00** พร้อมข้อความ *"ต่างจากยอดที่ยื่นไว้"* → ลงใหม่ = กลับมา **71.17**
  (ก่อน 0069 ยอดนี้เป็น 0 ตลอดเพราะ `vat_amount` ไม่เคยถูกเซ็ต)
- 🔄 **เทสเดิมแดง ซึ่งถูกต้อง** — เทส idempotency ของการออกใบเสร็จพึ่งค่าเริ่มต้นของ harness
  ⇒ แก้ให้ **ตั้ง `is_vat = false` ให้ชัด**
  🚨 *เทสที่ผลลัพธ์ขึ้นกับค่าที่ไม่ได้ตั้งเอง คือเทสที่วันหนึ่งจะแดงโดยไม่มีใครรู้ว่าทำไม*
- ⏳ **ใบกำกับภาษีเต็มรูปยังไม่ทำ** (แผนข้อ 25.4 · แยกเป็นเฟส F2) — ต้องกันบิลพวกนั้นออกจาก
  ยอดรวมรายวันของ `fn_bar_post_day` ไม่งั้นนับซ้ำ

### เฟส G — customize บิล (migration 0070)

ผังบิลเป็น **JSON ก้อนเดียว** ใน `app_settings.kind = 'bar_receipt_layout'`
🪤 ไม่แตกเป็น kind ละสวิตช์ เพราะ `kind` เป็น CHECK whitelist ที่ต้องเขียนทับทั้งก้อน (D80)
⇒ ทุกสวิตช์ใหม่จะกลายเป็น migration ใหม่

★ **การตัดสินใจนี้จ่ายคืนทันทีในวันเดียวกัน** — ผู้ใช้สั่งกลางเฟสว่าโลโก้ต้องแยกจากแบรนด์
(POS อาจขายในนาม EID02 ซึ่งคนละแบรนด์กับโรงกลั่น) ⇒ ย้าย `logoUrl` เข้าไปในผัง
**ไม่ต้องมี migration เพิ่มแม้แต่ไฟล์เดียว**

- golden **B14** (35 เทส) — `Record<BlockKey,…>` บังคับความครบ (D84) ·
  บล็อกที่ผังเก่าไม่รู้จัก **ต่อท้ายเสมอ** ⇒ เพิ่มบล็อกใหม่แล้วไม่หายจากกระดาษของลูกค้าเดิม
- 🚨 บรรทัดที่กฎหมายบังคับเมื่อ `is_vat = true` **ปิดไม่ได้ และต้องบอกว่าทำไม** (เทาพร้อมเหตุผล — D86)
- 🚨 **พรีวิวเรนเดอร์ด้วย `receiptHtml()` ตัวเดียวกับที่พิมพ์จริง** — ห้ามวาดจำลอง
  *พรีวิวที่ไม่ตรงกระดาษแย่กว่าไม่มีพรีวิว*
- ตัวแปรในข้อความเป็น **ชุดปิด** · ตัวที่ไม่รู้จัก **คงข้อความเดิม ห้ามพิมพ์ `undefined`**
  (ยกกติกา *ห้ามทำภาษาสูตร* มาจาก D67/D70)
- 58 มม. ⇒ เนื้อ 48 มม. แต่ **QR ไม่ต่ำกว่า 25 มม. เสมอ** (สแกนไม่ติด = ลูกค้าโอนไม่ได้)

---

### 🐛 บั๊กที่เจอระหว่างภาค 2 ซึ่งกลไกเดิมไม่มีทางจับได้

**① `window.confirm()` ถูกเบราว์เซอร์ปิดกั้น ⇒ ปุ่มลบดูเหมือนเสีย**

นี่คือข้อ *"ยังกดลบบิลที่เปิดค้างไว้ไม่ได้"* ที่ผู้ใช้แจ้งมาเป็นข้อแรก
โค้ดถูกทุกบรรทัด แต่ `confirm()` คืน `false` ทันทีโดยไม่แสดงอะไร ⇒ **กดแล้วไม่มีอะไรเกิดขึ้นเลย**
→ `useConfirm()` (ป๊อปอัพในแอป) ใน `lib/shared/ui.tsx` · ⏳ ยังเหลือ `window.confirm()` อีก ~24 ไฟล์นอกบาร์ → `NEXT_STEPS`

**② `bg-surface` / `bg-surface-2` ไม่ใช่ token ที่มีอยู่จริง (54 จุด)**

Tailwind เจอคลาสที่ไม่รู้จักแล้ว **ไม่ error ไม่ warn — ไม่ output อะไรเลย**
⇒ การ์ด/ป๊อปอัพพื้นหลังใส = *"การ์ดเพิ่มเมนูอ่านตัวหนังสือยาก"* ที่ผู้ใช้แจ้ง
🚩 กันซ้ำด้วย `lib/shared/tokens.test.ts` — อ่าน `--color-*` จาก `globals.css` มาเป็นรายชื่อจริง
แล้วสแกน `.tsx` ทุกไฟล์ · **พิสูจน์แล้วว่าจับได้** โดยใส่ `bg-surface` กลับเข้าไปหนึ่งจุดแล้วเทสแดง

**③ `inputCls` มี `w-full` ⇒ ความกว้างที่ผู้เรียกกำหนดไม่มีผลเลย**

`<TextInput className="w-24">` ไม่เคยแคบลงสักครั้ง เพราะ `w-full` มาทีหลังในสตริง
⇒ นี่คือ *"ช่องเลือกวัตถุดิบเล็กโดนช่องตัวเลขกลืน"* (B-8)
แก้ในบาร์ด้วย wrapper div + จดคำเตือนไว้ข้าง `inputCls`
⏳ พบคลาส `w-*` ที่ตายแล้วอีก ~30 จุดในผลิต/ขาย/เงินเดือน/บัญชี → `NEXT_STEPS`

**④ migration 0070 รอบแรกวงเล็บขาดหนึ่งตัว**

`gen-0070.mjs` เริ่มนับวงเล็บที่ `open + "check (kind in".length`
⇒ ตัวที่นับว่าปิดครบคือวงเล็บของ `in (` ไม่ใช่ของ `check (`
🚨 **อาการปลายทางไม่ชี้ไปที่ต้นเหตุเลย** — `db push` ล้ม แล้วผู้ใช้ไปเจอข้อความ
*"ค่าที่กรอกไม่ถูกต้องตามที่ระบบกำหนด"* ตอนกดบันทึกผัง ซึ่งอ่านแล้วนึกว่าฟอร์มกรอกผิด
⇒ แก้จุดเริ่มนับ **และเพิ่มด่านนับวงเล็บก่อนเขียนไฟล์** (ไม่สมดุล = `throw` ไม่เขียนไฟล์)
🪤 *สคริปต์ generator ที่ผลิต SQL ผิดรูป อันตรายกว่าพิมพ์เอง* เพราะดูน่าเชื่อถือกว่า
และรันซ้ำได้ผลเดิมทุกครั้ง — ต้องมีด่านตรวจในตัวมันเอง

**⑤ `npm run build` ขณะ dev server รันอยู่ ทำให้ `.next` พัง** (เครื่องมือ ไม่ใช่โค้ด)

dev เสิร์ฟ 404 ให้ CSS ของตัวเอง ⇒ หน้าจอโล้นทั้งแอป
วิธีเดียว: หยุด dev → `rm -rf .next` → `build` → เปิด dev ใหม่

---


### ✅ เทสเฟส G ในเบราว์เซอร์หลัง 0070 ลง DB — เจอบั๊กอีก 3 ตัว

`build`/`lint`/`test` เดิมผ่านหมดทั้งสามตัว

**⑥ 🔴 เหตุผลที่ "ปิดไม่ได้" ผูกกับ VAT แทนที่จะผูกกับชุดที่ล็อกจริง**

การ์ดตั้งค่าแต่งประโยคเองว่า `isVat ? "ใบกำกับภาษีต้องมี" : "ไม่มีแล้วไม่ใช่บิล"`
⇒ กิจการที่จด VAT เห็น **ชื่อร้าน · รายการที่สั่ง · ยอดรวม** (ล็อกด้วย `ALWAYS_ON`
ไม่เกี่ยวกับ VAT เลย) ขึ้นเหตุผลว่า *"ใบกำกับภาษีต้องมี"*

🚨 **ล็อกถูกตัว ปิดไม่ได้จริง ตรรกะไม่ผิดแม้แต่นิดเดียว — ที่ผิดคือประโยคที่ผู้ใช้อ่านแล้วสรุป**
คนที่อ่านแล้วเข้าใจว่า *"ถ้าเลิกจด VAT ก็เอาชื่อร้านออกได้"* กำลังเข้าใจผิด (ตระกูล D91/0059)

→ `lockReason()` ย้ายไปตัดสินใน `lib/bar/layout.ts` · `locked()` คำนวณจากตัวนี้ตัวเดียว
จึงหลุดจากกันไม่ได้ · เทส**อ่านซอร์สการ์ด**ว่าต้องไม่เหลือสตริง `"ปิดไม่ได้ —"`
🚩 พิสูจน์ว่ายามจับได้จริงโดยเอาโค้ดเดิมใส่กลับหนึ่งจุดแล้วเทสแดงทันที

**⑦ 🟡 พิมพ์ข้อความหัวบิลแล้วไม่มีอะไรเกิดขึ้น และไม่มีอะไรอธิบาย**

`headText` อยู่ใน `DEFAULT_OFF` (ถูกตามที่ออกแบบ) แต่คนที่พิมพ์ข้อความลงไป
เห็นพรีวิวนิ่งสนิทจะสรุปว่าช่องนี้เสีย 🚨 *ทุกครั้งที่ระบบไม่ทำอะไรให้ ต้องบอกว่าทำไม* (D92)
→ `filledButOff()` + บรรทัดเหลืองบอกว่าบล็อกไหนปิดอยู่และต้องไปติ๊กที่ไหน

**⑧ 🟡 กดปุ่มแทรกตัวแปรแล้วพิมพ์ต่อ ตัวอักษรไปโผล่หัวช่อง**

`insertToken` ต่อท้ายข้อความแล้วไม่คืนโฟกัสเอง เบราว์เซอร์คืนให้หลัง re-render
โดยเคอร์เซอร์อยู่ตำแหน่ง 0 ⇒ พิมพ์ `A` → แทรก → พิมพ์ `B` ได้ **`BA{ยอด}`**
🚨 ข้อความนี้ถูกพิมพ์ลงบิลจริงทุกใบ → คืนโฟกัส + `setSelectionRange` ไปท้ายช่อง (ได้ `A{ยอด}B`)

### 🚩 พิสูจน์บนจอจริงครบทุกข้อ (เฟส G)

บันทึกผังได้จริง (เคยขึ้น *"ค่าที่กรอกไม่ถูกต้อง"*) · **รีเฟรชแล้วค่ายังอยู่ครบ** —
กระดาษ 58 · บล็อกที่ปิด · ลำดับที่สลับ · ข้อความ · ลิงก์โลโก้ (ก่อนแก้ 0070 เด้งกลับ 80 ทุกครั้ง) ·
เหตุผลที่ปิดไม่ได้ 3 + 4 บรรทัดตรงกับ `ALWAYS_ON`/`VAT_REQUIRED` พอดี ·
▼ เลื่อนบรรทัด**บนกระดาษจริง** ไม่ใช่แค่ในลิสต์ · `{ชื่อร้าน}`/`{เลขบิล}` แทนค่าถูก ·
🚨 ตัวแปรสะกดผิด `{ยอดด}` ขึ้นตามเดิม **ไม่มีคำว่า `undefined`** ·
โลโก้ได้ `<img>` บนกระดาษจริง · 58 มม. ⇒ เนื้อ **48.0 มม. · QR 25.0 มม.** (พื้นล่างทำงาน) ·
🚨 **สวิตช์ QR เปิดอยู่ แต่ใบที่จ่ายแล้วไม่มี QR** — `receipt.ts` ยังตัดสินจุดเดียว ·
ทางกลับ: ปิดสวิตช์ → QR หายจากใบแจ้งรายการด้วย

★ **คืนค่าการตั้งค่าของ tenant กลับเป็นค่าปริยายแล้วหลังเทสเสร็จ**
🚨 เทสบน tenant จริงแล้วไม่เก็บกวาด = ผู้ใช้ไปเปิดร้านด้วยกระดาษ 58 มม. กับโลโก้ทดสอบ

---

### 🚫 จงใจไม่ทำ

- **ไม่ต่อท่อสต็อกบาร์เข้าฝั่งผลิต/ขาย** (กติกาเหล็กข้างบน)
- **ไม่ลงบัญชีทีละบิล** — สรุปรายวันเท่านั้น
- **ไม่ทำใบกำกับภาษีเต็มรูป** ในรอบนี้ (เฟส F2)
- **ไม่ทำท่ออัปโหลด/แปลงโลโก้เป็น 1-bit** — ผู้ใช้ตอบว่ายังไม่มีโลโก้
  ⇒ ทำท่อแปลงภาพตอนนี้คือเขียนของที่ยังทดสอบกับของจริงไม่ได้ · รอบนี้เป็นช่องกรอกลิงก์ + คำเตือน
- **ไม่ใช้ drag เรียงบล็อก** — ทัชสกรีนชนกับการเลื่อนหน้า และ D70 แก้โจทย์นี้ด้วย ▲▼ ไปแล้ว

---

**ไฟล์**: migration **0063-0070** · `lib/bar/` (15 ไฟล์ + golden **B1-B14**) ·
`lib/bar/isolation.test.ts` (เทสกติกาเหล็ก) · `lib/shared/tokens.test.ts` ·
`lib/shared/ui.tsx` (`useConfirm`) · `lib/shared/icons.tsx` (`IconGlass` + `WORKSPACE_ICON` เป็น `Record`) ·
`lib/shared/{roles,tabs,workspaces,tenantTables}.ts` · `app/(app)/bar/**` (5 แท็บ) ·
`app/api/cron/tax-reminder/route.ts` (`barPart`) · `supabase/seed/seed_bar.sql` ·
`tests/tenant/bar-rpc.test.ts` · `scripts/gen/gen-006{7,8,9}.mjs` + `gen-0070.mjs` ·
test **1356** + `test:tenant` **275** (บาร์ 55) ผ่าน · ชุดเทส `docs/TESTING.md` ส่วนที่ **53**

### D97 — บาร์: ชื่อร้านกรอกเอง · ตัดตราชำระแล้ว · คืนค่าเริ่มต้น · เพิ่มลูกค้าจากหน้าขาย (2026-09-14)

**ไม่มี migration** — ผังบิลเก็บเป็น **JSON ก้อนเดียว** ตั้งแต่ 0070 ⇒ เพิ่มช่อง `shopName`
ไม่ต้องแตะ DB แม้ไฟล์เดียว (★ การตัดสินใจของเฟส G จ่ายคืนเป็นครั้งที่สอง)

#### 1. 🚨 ชื่อร้านบนหัวบิล ≠ ชื่อกิจการ
เดิมกระดาษพิมพ์ `seller.name` ซึ่งมาจาก `entities.name` = **ชื่อทางทะเบียน**
("บริษัท … จำกัด" / ชื่อ-นามสกุลเจ้าของ) ซึ่งลูกค้าหน้าบาร์ไม่รู้จัก และแก้ไม่ได้จากฝั่งบาร์เลย
— ชื่อกิจการเป็นของโมดูลบัญชี แก้ที่นั่นแล้วกระทบเอกสารอีกสามโมดูล

⇒ `ReceiptLayout.shopName` + `shopNameOf()` · **ค่าว่าง = ใช้ชื่อกิจการ** (กระดาษต้องมีชื่อเสมอ ·
`shopName` อยู่ใน `ALWAYS_ON`) · ตัวแปร `{ชื่อร้าน}` ในข้อความหัว/ท้ายบิลเปลี่ยนตามด้วย
(กดแทรกตัวแปรแล้วต้องได้ชื่อเดียวกับที่ตาเห็นข้างบน)

🚨 **แต่ชื่อทะเบียนหายไปเฉย ๆ ไม่ได้** — ใบกำกับภาษีอย่างย่อต้องมีชื่อผู้ประกอบการ
⇒ `legalNameLine()` พิมพ์ชื่อทะเบียนเป็นบรรทัดเล็กใต้ชื่อร้าน **เฉพาะกิจการที่จด VAT
และตั้งชื่อร้านต่างจากทะเบียน** · ไม่จด VAT / ชื่อตรงกัน = ไม่พิมพ์ซ้ำ
★ ตัดสินใน lib ตัวเดียว แล้ว **การ์ดตั้งค่าเรียกตัวเดียวกันมาอธิบายบนจอ** —
เขียนเงื่อนไขซ้ำที่หน้าจอ = คำอธิบายกับกระดาษหลุดจากกันได้ (ตระกูล D91/0059)

#### 2. 🚫 ตัดตรา "ชำระแล้ว · เงินสด · 13/09/2569 23:50" ออก (ผู้ใช้สั่ง)
ทั้งใบที่จ่ายแล้วและใบเสร็จ — ใบเสร็จบอกในตัวอยู่แล้วว่ารับเงินแล้ว

🚨 **แต่ "บิลนี้ถูกยกเลิก" ต้องอยู่ต่อ** ไม่งั้นใบที่ยกเลิกแล้วพิมพ์ออกมาหน้าตาเหมือนใบปกติ
⇒ บล็อก `paidStamp` → **`voidStamp`** (เปลี่ยนชื่อคีย์ ไม่ใช่เปลี่ยนความหมายของคีย์เดิม —
คีย์เดียวสองความหมายคือกับดัก D63/D84) · ผังเก่าที่บันทึกไว้มี `paidStamp` จะถูกกรองทิ้ง
แล้ว `resolveLayout()` เติม `voidStamp` กลับตามลำดับปริยาย (กติกาเหล็กข้อ 1 ของเฟส G)
· ย้ายเข้า `ALWAYS_ON` พร้อม `ALWAYS_ON_REASON` เฉพาะราย — เหตุผลต้องเป็นของตัวเอง
("บิลที่ถูกยกเลิกต้องบอกบนกระดาษ") ไม่ใช่ "ไม่มีแล้วไม่ใช่บิล" ที่ไม่จริงสำหรับคีย์นี้

★ ผลพลอยได้: `ReceiptInput.method` **ไม่มีใครอ่านแล้ว** → ตัดทิ้งพร้อมผู้เรียก 3 จุด
(ปล่อยไว้ = ช่องหลอกแบบ `employees.end_date` ของ D76)

#### 3. ปุ่มคืนค่าเริ่มต้นของรูปแบบบิล
`defaultLayout()` มีอยู่แล้ว ขาดแค่ปุ่ม · ถามยืนยันด้วย `useConfirm()`
🪤 **ไม่ใช่ `window.confirm()`** — เบราว์เซอร์บล็อกแล้วคืน `false` เงียบ ๆ จนกลายเป็น
ปุ่มที่กดแล้วไม่มีอะไรเกิดขึ้น (บั๊กที่เจอมาแล้วใน D96 ภาค 2)
★ ป๊อปอัพบอกด้วยว่า **ยังไม่มีผลจนกว่าจะกด "บันทึกการตั้งค่า"** — การ์ดนี้ไม่เซฟเอง

#### 4. 🪤 คำชี้ทางที่ชี้กลับมาที่ตัวเอง
`promptPayError()` ต่อท้ายว่า *"— ไปตั้งที่ ตั้งค่าบาร์"* ทุกครั้ง ⇒ **บนหน้าตั้งค่าบาร์เอง**
ข้อความนี้บอกให้ผู้ใช้เดินไปยังที่ที่เขายืนอยู่แล้ว (ผู้ใช้ทักเองว่า *"มันตลก"*)
⇒ `promptPayError(target, { showWhere })` **ปริยายไม่ต่อ** · หน้าขายส่ง `true`
★ ประโยคยังอยู่ใน lib ที่เดียว (`PROMPTPAY_WHERE`) — หน้าจอไม่แต่งประโยคเอง
· เทสล็อกสองทิศ: ไม่ส่ง = ต้อง **ไม่มี** คำว่า "ไปตั้งที่" · ส่ง = ต้องมี

#### 5. เพิ่มลูกค้าได้จากแท็บขาย (ผู้ใช้สั่ง)
เดิมต้องสลับไปแท็บลูกค้ากลางบิล แล้วกลับมาหาในดร็อปดาวน์เอง
⇒ ปุ่ม **＋** ข้างช่องเลือกลูกค้าทั้ง 2 จุด (โหมดบูธ · เปิดบิลใหม่) ·
บันทึกแล้ว **เลือกคนที่เพิ่งเพิ่มให้เอง** จาก `customer_id` ที่ action คืนมา

🚨 **ใช้ฟอร์มตัวเดียวกับแท็บลูกค้า** — `CustomerModal` ถูกแยกออกมาเป็นไฟล์ของตัวเอง
ก๊อปฟอร์มมาวางแล้วตัดช่องความยินยอม PDPA ออกเพื่อ "ให้เร็ว" = เก็บเบอร์ลูกค้าโดยไม่มี
ความยินยอม (บทเรียน `billItems` ของ D42: เลิกก๊อป 3 ชุด)
🪤 บันทึกไม่สำเร็จ = **ฟอร์มยังเปิดอยู่พร้อมข้อความบอกเหตุ** ไม่ใช่ปิดเงียบแล้วไม่มีลูกค้าเพิ่ม

#### 6. ชื่อลูกค้าบนจอ — `ชื่อเล่น (ชื่อจริง)` เหมือนกันทุกจุด + ปิดช่องโหว่ 2 จุด

ผู้ใช้ถามว่าชื่อ/ชื่อเล่นแสดงที่ไหนยังไง — ไล่ดูแล้วพบว่า **ลูกค้าคนเดียวมีชื่อ 3 แบบ
ใน 3 หน้าจอที่ห่างกันไม่ถึงหนึ่งจอ**: ดร็อปดาวน์ใช้ `nickname || name` ·
ชิปกรองเมนูกับแดชบอร์ดใช้ `name` · ทะเบียนลูกค้าใช้ `name (nickname)` (กลับด้านกับดร็อปดาวน์)

⇒ `lib/bar/customerName.ts` (golden **B15**) · `customerLabel()` / `customerNameParts()`
🚨 **ไม่มีวงเล็บว่างเด็ดขาด** — ผู้ใช้บอกเองว่าลูกค้าทั่วไปจะพิมพ์ชื่อเล่นลงช่อง *ชื่อ*
ไปเลยเพราะไม่ขอใบกำกับ ⇒ **ช่องชื่อเล่นว่างคือสภาพปกติ ไม่ใช่ข้อมูลขาด**
· ชื่อเล่นซ้ำชื่อจริง = แสดงครั้งเดียว · ไม่มีอะไรเลย = คืนค่าว่าง
(**ห้ามคืน "—"/"ไม่ระบุ"** — คำแทนขึ้นกับบริบทของแต่ละหน้าจอ ไม่ใช่ของฟังก์ชัน)

🚨 **บนกระดาษยังเป็นชื่อจริงล้วนเหมือนเดิมทุกใบ** — "พี่โอ๊ต" ไม่ใช่คู่สัญญาของใคร
🚩 การเผลอเอา `customerLabel()` ไปใช้ตอนประกอบเอกสารคือโค้ดที่ **ถูกทุกบรรทัด แค่ผิดที่**
(build/lint/test ผ่านหมด แต่ใบกำกับพิมพ์ชื่อผู้ซื้อเป็น "พี่โอ๊ต (สมชาย ใจดี)")
⇒ เทสอ่านซอร์ส: `receipt.ts`/`print80.ts` ห้ามรู้จักไฟล์นี้ · และบล็อก `buyer:` ที่ส่งเข้า
`buildReceipt()` ต้องเป็น `name: cust.name` — ตรวจ**โค้ดจริง** ไม่ใช่คำในไฟล์
(ชั้นเดียวกับ `isolation.test.ts` D96 / `tenantTables.test.ts` D79 · กับดัก D92/D95)

**🔴 ช่องโหว่ที่ปิดไปด้วย 2 จุด** (เจอจากคำถามของผู้ใช้ ไม่ใช่จากเทส):
1. **แท็บประวัติไม่มีคอลัมน์ลูกค้าเลย** ทั้งที่บิลเก็บ `customer_id` ไว้ครบ ⇒ ย้อนดูว่า
   "คืนนั้นลูกค้าคนนี้กินอะไร" จากแท็บที่ควรตอบเรื่องนี้ที่สุดไม่ได้
   ★ ลูกค้าที่ถูกลบตาม PDPA แล้ว ขึ้น "—" ตามจริง ไม่เดาชื่อ
2. **ป้ายบิลที่เปิดอยู่บอกแต่ชื่อโต๊ะ** — ผูกลูกค้าไว้ตอนเปิดบิลแล้วไม่มีอะไรบนจอบอกว่า
   บิลนี้ของใคร ต้องกดเข้าบิลแล้วมองหาชิป *"เฉพาะของ …"* ถึงจะรู้ว่าเลือกผิดคน
   🚨 = **ใบเสร็จออกผิดชื่อโดยไม่มีอะไรฟ้องเลยสักจุด**

#### 8. 🪤 เปลี่ยนชื่อคีย์ = ย้ายบล็อกบนกระดาษของลูกค้าโดยไม่ได้ตั้งใจ (เจอตอนเทสบนจอ)

`paidStamp` → `voidStamp` ทำให้คีย์เก่าใน `app_settings` ถูก**ทิ้ง** แล้วคีย์ใหม่ถูก**เติมต่อท้าย**
ตามกติกาเหล็กข้อ 1 ⇒ ตราบิลยกเลิกไปโผล่ **ใต้ข้อความท้ายบิล** บนกระดาษของลูกค้าที่เคยจัดผังไว้
(เห็นกับตาในผังจริงของ tenant ทดสอบ — เรียงถูกทุกอย่างยกเว้นบล็อกที่ผมเพิ่งเปลี่ยนชื่อ)

🚨 **กติกา "เติมคีย์ที่ขาดต่อท้าย" มีไว้รับ*บล็อกใหม่* ไม่ใช่รับ*บล็อกที่ถูกเปลี่ยนชื่อ*** —
บล็อกใหม่ไม่มีตำแหน่งเดิมให้รักษา แต่บล็อกที่เปลี่ยนชื่อมี และตำแหน่งนั้นเป็นของลูกค้า
⇒ ตาราง `RENAMED` + `readKey()` ใน `resolveLayout()` แปลงชื่อเก่าก่อนกรอง
· ใช้ทั้งกับ `order` และ `off` · เทสล็อกว่าตำแหน่งต้องไม่ขยับ

#### 7. ป๊อปอัพคืนค่าเริ่มต้น — ทำให้เหมือนป๊อปอัพยืนยันตัวอื่นในแอป
ของรอบแรกเป็นหัวข้อบอกเล่า + คำอธิบาย 2 ย่อหน้าที่ไล่ชื่อทุกอย่างในการ์ด
**และปุ่มยืนยันเป็นสีแดงระดับ danger** ทั้งที่ไม่มีอะไรถูกลบจริง
(ข้อ 55.4 ที่ผู้ใช้เทสเอง — รีเฟรชแล้วค่าเก่ากลับมา — เป็นคนพิสูจน์ว่ามันย้อนได้)
⇒ หัวข้อเป็นคำถามสั้นเหมือน *"ลบลูกค้ารายนี้?"* · คำอธิบาย 2 บรรทัด · **ปุ่มสีปกติ**
🪤 *ระดับความน่ากลัวของปุ่มต้องตรงกับความเสียหายจริง* — ทำให้ทุกอย่างเป็นสีแดงไว้ก่อน
แปลว่าวันที่แดงจริง ๆ จะไม่มีใครหยุดอ่าน

---

**ไฟล์**: `lib/bar/{layout,receipt,print80,promptpay}.ts` + เทส · `lib/bar/customerName.ts` + golden **B15** ·
`app/(app)/bar/_components/{ReceiptLayoutCard,PosTab,HistoryTab,CustomerTab,DashboardTab}.tsx` ·
`app/(app)/bar/_components/CustomerModal.tsx` (ไฟล์ใหม่ — แยกจาก `CustomerTab`) ·
test **1427** ผ่าน · ชุดเทส `docs/TESTING.md` ส่วนที่ **55**

### D98 — โหมดกรอกราคา "รวม VAT" ฝั่งบัญชี: เลิกถอด VAT ต่อหน่วยก่อนคูณ (ไม่มี migration, 2026-09-14)

**ผู้ใช้จับได้เองจากการกรอกบิลซื้อจริง** — ใส่ 16 ชิ้น ราคารวม VAT ชิ้นละ 75 แล้วยอดไม่ตรง
ใบของผู้ขาย จึงลองใส่ 1 ชิ้น ราคา 1,200 แล้วตรงพอดี และสรุปสาเหตุมาเองว่า
*"เข้าใจว่าระบบเราคิดที่ถอดแวทต่อชิ้นแล้วเอามาคูณจำนวนทำให้ไม่ตรง"* — **ถูกทุกประการ**

#### 1. อาการและสาเหตุ
`exVatFromInVat(75)` = `round2(75/1.07)` = **70.09** (ค่าจริง 70.0934579…) แล้ว
`itemTotal()` คูณ 16 ⇒ เศษที่ปัดทิ้งต่อหน่วย 0.0034579 × 16 **หายไป 5.5 สตางค์**

| วิธี | ฐาน | VAT | รวม |
|---|---|---|---|
| เดิม — ถอดต่อหน่วย → ปัด → คูณ | 1,121.44 | 78.50 | **1,199.94** ❌ |
| ถอดที่ยอดรวม แล้ว VAT = ฐาน×7% | 1,121.50 | **78.51** | **1,200.01** ❌ |
| **ที่เลือก** — VAT = รวม×7/107, ฐาน = รวม − VAT | **1,121.50** | **78.50** | **1,200.00** ✅ |

★ ค่าจริงไม่ปัด: ฐาน 1,121.4953… · VAT 78.5047… ⇒ ปัดแล้วคือ 1,121.50 / 78.50 พอดี

#### 2. 🚨 หลักที่ยึด (และเหตุผลที่ไม่ใช่แค่ "ปัดให้แม่นขึ้น")
1. **ฐานภาษี = เงินทั้งก้อนที่จ่าย/รับจริง × 100/107** (ม.79 — ฐานภาษีคือ *มูลค่าทั้งหมด
   ที่ผู้ประกอบการได้รับ* ซึ่งคือ 1,200 ไม่ใช่ 75) ราคา/หน่วยที่ถอดออกมาเป็นเพียง**ค่าที่แสดง**
   ไม่ใช่ฐาน ⇒ **ห้ามปัดก่อนคูณ**
2. **ปัดครั้งเดียวที่ยอดซึ่งปรากฏบนเอกสาร** — หลักเดียวกับที่ repo นี้ใช้กับ ภพ.30 อยู่แล้ว
   (*VAT รวม = round(Σยอด × 7/100) จากยอดรวม ไม่ sum vat รายแถว*)
3. **ราคารวม VAT ต้องคิด VAT เป็นเศษเหลือ** (`VAT = รวม − ฐาน`) ไม่ใช่ `ฐาน × 7%`
   เพราะฐานถูกปัดไปแล้ว คูณต่อจะพาความคลาดเคลื่อนเข้าไปอีกชั้น — นั่นคือที่มาของ 1,200.01

#### 3. 🚨 ทำไมต้องเป็น "โหมด" ไม่ใช่แก้สูตรเดิมทับ
เส้นทางเดิม **ถูกอยู่แล้ว** สำหรับบิลที่ตั้งราคาแบบไม่รวม VAT (ฝั่งขายของเราเอง): ฐานคือ
qty×ราคา แล้วบวก 7% — ไม่มีอะไรให้ถอด · แก้ทับ = พังของที่ถูกอยู่ ⇒ `vatMode: "ex" | "in"`
ค่าปริยาย `"ex"` ⇒ 🚩 **golden A3/A4 เดิมผ่านโดยไม่แก้ไฟล์เทส** (หลักฐานว่าเส้นทางเดิมไม่ขยับ)
และเทสข้อ *ไม่ส่ง vatMode ต้องเท่ากับส่ง "ex" เป๊ะ* ล็อกไว้อีกชั้น

#### 4. 🚨 ไม่เขียนสูตรถอด VAT ชุดที่สอง
`vatFromGross()` มีอยู่แล้วที่ `lib/bar/vat.ts` (golden **B11** · D96 เฟส F) และคิดด้วยการ
**ลบ** อยู่แล้วพอดี ⇒ ย้ายไป `lib/shared/vat.ts` แล้วให้ `lib/bar/vat.ts` re-export ต่อ
(แพตเทิร์น `lib/shared/period.ts` ของ D92) 🚨 ห้ามให้ `lib/accounting` import `lib/bar` ข้ามโดเมน
★ **golden B11 ผ่านโดยไม่แก้ไฟล์เทส** = พิสูจน์ว่าการย้ายไม่กระทบบาร์

#### 5. 🚨 ไม่ติ๊ก "มี VAT" = ไม่มีอะไรให้ถอด → ตกกลับ `"ex"` เสมอ
`effectiveVatMode(mode, hasVat)` ⇒ กิจการไม่จด VAT และบิลไม่มีภาษี **ได้ยอดเท่าเดิมทุกบาท**
🪤 คนที่กรอกช่องรวม VAT แล้วลืมติ๊ก ต้องได้ข้อความบอก ไม่ใช่เงียบ → `vatModeWarn()`
(*ทุกครั้งที่ระบบไม่ทำตามที่ผู้ใช้น่าจะคาด ต้องบอกว่าทำไม* — D92) · **เตือน ไม่บล็อก**

#### 6. 🚨 ไม่ต้องมี migration — ถามว่า "โหมดไหนได้ยอดที่บันทึกไว้"
หน้าแก้บิลไม่รู้ว่าบิลเก่ากรอกด้วยโหมดไหน → แทนที่จะเพิ่มคอลัมน์แล้วต้อง `db:push:all`
ทั้ง fleet เพื่อเก็บธงตัวเดียว ใช้ `detectVatMode()` คำนวณทั้งสองโหมดแล้วดูว่าอันไหน
ตรงกับ `amount_after_discount`/`vat_amount`/`wht_amount` ที่บันทึกไว้ — **นี่ไม่ใช่การเดา**
🪤 เข้าทั้งคู่ (บิลไม่มีเศษ เช่น 2×100) หรือไม่เข้าเลย → `"ex"` เสมอ (ค่าปริยาย = พฤติกรรมเดิม)
🪤 ต้องตัดสินโหมด **ก่อน** เช็ค `odd` ไม่งั้นบิลที่กรอกแบบรวม VAT จะถูกมองว่า "ยอดไม่ตรงสูตร"
แล้วเด้งเข้าโหมดแก้ยอดเองทุกครั้งที่เปิดมาแก้

#### 7. 🚨 `total_price` รายบรรทัดต้องบวกได้เท่ายอดก่อน VAT ของบิลเป๊ะ
โหมด `"in"` ยอดบรรทัดที่กรอกเป็นยอด*รวม VAT* แต่คอลัมน์ `transaction_items.total_price`
เก็บยอด*ก่อน VAT* (โผล่ในการ์ด "ดู" และแท็บประวัติราคา) → `allocateExTotals()` ถอดรายบรรทัด
แล้วเกลี่ยเศษลง**บรรทัดยอดใหญ่สุด** (คลาดเป็นสัดส่วนน้อยสุด) 🪤 ปล่อยให้ต่างกันสักสตางค์ =
เลข 2 ตัวที่ควรตรงกันแล้วไม่ตรง ผู้ใช้จะสรุปว่าข้อมูลเพี้ยน (ตระกูล D81/D88)

#### 8. โหมดเป็นของ **บิล** ไม่ใช่ของแถว
ใบของผู้ขายตั้งราคาแบบเดียวทั้งใบ · ถ้าให้แต่ละแถวมีโหมดของตัวเอง ยอดรวมบิลจะเป็นผลบวก
ของเลขคนละหน่วย (รวม VAT ปนไม่รวม VAT) ซึ่งไม่มีความหมาย · โหมดสลับเองเมื่อผู้ใช้พิมพ์
ช่องไหน **แต่ต้องเห็นบนจอและกดเปลี่ยนได้** (`VatModeCard` — คอมโพเนนต์เดียวใช้ทั้ง 2 ฟอร์ม
ตามคำเตือนในหัวไฟล์ `billItems.ts` ที่ห้ามก๊อป) · สลับโหมดต้องคิดส่วนลดบาททุกแถวใหม่ด้วย
🪤 ไม่คิดใหม่ = ส่วนลด % บนจอกับยอดส่วนลดบาทที่ใช้จริงไม่ตรงกันเงียบ ๆ

#### 9. 🚨 ประโยคบนจอตัดสินใน lib ที่มีเทสคุม
`lineTotalHeader()` / `itemsHintText()` / `vatModeWarn()` — หัวคอลัมน์ "รวม" เปลี่ยนความหมาย
ตามโหมด (ก่อน VAT / รวม VAT) และคำกำกับเดิมเขียนว่า *ส่วนลดคิดจากราคาไม่รวม VAT* ซึ่งจะ
กลายเป็นคำโกหกในโหมดใหม่ · ห้ามแต่งประโยคในคอมโพเนนต์ (D84/D88/D91: **ตรรกะถูกแต่ประโยคผิด
อันตรายพอกัน เพราะผู้ใช้อ่านประโยคแล้วทำตาม**)

#### 10. ✅ ตรวจแล้วว่าฝั่งขาย **ไม่ใช่บั๊ก** — ไม่แตะ
`toAccItem()` (golden S4) ก็ `round2(priceIncl/1.07)` แล้วคูณ qty เหมือนกัน **แต่**ยอดของบิล
ฝั่งขายไม่ได้มาจากผลบวกรายการ — มาจาก `reverseVatWht(accNet, …)` ที่ถอดจาก**ยอดสุทธิทั้งก้อน**
อยู่แล้ว ⇒ ตัวเลขบัญชี/ภาษีถูกต้องทุกตัว เหลือแค่ `total_price` รายบรรทัดที่อาจคลาดระดับสตางค์
ซึ่งเป็นคอลัมน์แสดงผล · แก้ = ต้องแก้ golden S4 โดยไม่มีตัวเลขภาษีตัวไหนผิด ⇒ **ไม่คุ้ม ไม่แตะ**

#### 11. ✅ เทสในเบราว์เซอร์จริงแล้ว (2026-09-14 · tenant `siamdist`)
เดินครบทุกข้อของไกด์เทสส่วนที่ 56 บนหน้าจอจริง **ไม่เจอบั๊กในงานนี้เลย** — รายละเอียดตัวเลข
อยู่ที่ `docs/TESTING.md` 56.7 · จุดที่พิสูจน์ได้ชัดที่สุด 3 ข้อ:
1. **1,200.00 vs 1,199.94** — สลับโหมดไปกลับได้เลขของทั้งสองเส้นทางเป๊ะบนจอเดียวกัน
2. **ไล่ถึง ภพ.30** (ไกด์เทสเดิมหยุดแค่หน้าบันทึก) — ภาษีซื้อ 259.07 · ยกไป 89.76 ครบถ้วน
3. **เปิดบิลที่กรอกแบบรวม VAT มาแก้แล้วไม่เด้งโหมดแก้ยอดเอง** = `detectVatMode()` ทำงานจริง

🔴 **เจอบั๊กนี้นอนอยู่ในข้อมูลจริง**: บิล `ซื้อข้าวเหนียวลงหมัก` (ข้าวเหนียว 50 × 30 รวม VAT)
บันทึกไว้ **1,500.14** ทั้งที่ผู้ขายเก็บ **1,500.00** — เกิน 14 สตางค์ · **ไม่แก้ให้เอง**
(เป็นข้อมูลที่ผู้ใช้บันทึกไว้ การแก้ตัวเลขบิลย้อนหลังต้องเป็นการตัดสินใจของเขา)

⚠️ **เจอเรื่องที่ไม่เกี่ยวกับงานนี้**: เซสชันหมดอายุ → ทุก workspace ค้างที่ "กำลังโหลด…"
ตลอดไปโดยไม่เด้งไป login → จดไว้ที่ `docs/NEXT_STEPS.md`
🪤 **อาการหน้าตาเหมือนบั๊กของงานที่เพิ่งแก้เป๊ะ** — ต้อง `git stash` งานทั้งชุดออกเพื่อพิสูจน์
ว่าไม่ใช่ ก่อนจะไล่หาสาเหตุจริง

#### สิ่งที่ไม่ได้ทำ (ตั้งใจ)
- **ไม่เปลี่ยนสูตร `entryCalc` เส้นทาง "ex"** แม้บรรทัดเดียว (กติกาเหล็กข้อ 1)
- **ไม่แตะ `round2()`** — `1121.5 × 3% = 33.644999…` → 33.64 เป็นพฤติกรรมของระบบเดิม
- **ไม่เก็บโหมดลง DB** (ดูข้อ 6) · **ไม่แตะฝั่งขาย/บาร์/สูตร ภพ.30**

### D99 — definer ที่ใครก็เรียกได้: `revoke from public` ไม่มีผลบน Supabase (0073-0074, 2026-09-28)

**ต้นเรื่อง**: รีวิวภายนอก `REVIEW_FABLE_1.md` ข้อ R2 (definer 3 ตัวรับ `p_tenant` แต่ไม่ revoke)
และ R6 (`handle_new_user` ตกไป tenant แรกที่ active) · คัดกรองแล้วใน `REVIEW_FABLE_1_TRIAGE.md`

#### 1. 🔴 ข้อค้นพบหลัก — revoke ทุกบรรทัดใน repo ก่อน 0073 **ไม่มีผลเลย**
Supabase ตั้ง default privileges ของ schema `public` ไว้ 2 ชุด (ของ `postgres` และ `supabase_admin`)
ให้ grant execute แก่ `anon` และ `authenticated` **ตรง ๆ** ตอนสร้างฟังก์ชัน
`revoke ... from public` ถอนได้แค่สิทธิ์ของกลุ่ม PUBLIC ⇒ 2 role นั้นยังเรียกได้ครบ
- หลักฐานในเทสของเราเองมีมาตลอด: `fn_excise_months_open` ถูก revoke from public ใน 0058
  แต่ `excise-month-close.test.ts` เรียกด้วย session ผู้ใช้แล้วสำเร็จ — เทสเขียว ไม่มีใครสะดุด
- ยืนยันด้วย probe `has_function_privilege` (อ่านอย่างเดียว) บน DB จริงทั้ง 2 ก้อน:
  **definer ทุกตัวเรียกได้จาก anon และ authenticated** (51 ตัวใน DB เจ้าของ · 52 ใน proof-app
  ซึ่งมี `rls_auto_enable` เพิ่ม — ดูข้อ 8) รวม `fn_mig_truncate(uuid)`,
  `fn_mig_set_triggers(boolean)`, `fn_mig_recompute_stock(uuid)`
- ตัวที่หนักที่สุด: `fn_mig_set_triggers(false)` **ไม่ต้องรู้ uuid ไม่ต้องล็อกอิน**
  (anon key อยู่ใน bundle ฝั่ง browser + `supabase/fleet.json`) ยิงครั้งเดียว = trigger
  สต็อก+audit ดับทั้งฐานของทุกลูกค้า (ฉากเดียวกับที่ D82 เขียนไว้)
- 🪤 **คอมเมนต์ที่ประกาศเจตนาที่โค้ดไม่ได้ทำ**: `0014_migration_helpers.sql:7` เขียนว่า
  *"grant execute ให้ service_role **อย่างเดียว**"* — ไฟล์มี `grant ... to service_role` จริง
  แต่คำว่า *อย่างเดียว* ไม่เคยเป็นจริง (ไม่มีการถอนจาก anon/authenticated) แล้วรอดสายตา
  มาได้เพราะ revoke **รันผ่าน** · บทเรียน: *รันผ่าน ≠ มีผล* ต้องถามสถานะจริงหลังลงเสมอ
- รายงานต้นทางนับ definer ที่รับ `p_tenant` ได้ 3 ตัว — ของจริงมี **7** (+ `fn_mig_truncate`,
  `fn_mig_recompute_stock`, `entity_is_vat`, `fn_excise_months_open`)

#### 2. แยกเป็น 2 migration — ฉุกเฉินต้องไม่ผูกกับงานที่ยังคุยไม่จบ (ผู้ใช้สั่ง)
- **0073 (ลงแล้ว ฉุกเฉิน)** GRANT/REVOKE ล้วน ไม่แตะตรรกะ: `fn_mig_set_triggers` ·
  `fn_mig_truncate` · `fn_mig_recompute_stock` · `bar_apply_move` →
  `revoke from public, anon, authenticated` + `grant service_role`
  ★ ก่อนลงไล่ `prosrc` จาก DB จริง: ผู้เรียก `bar_apply_move` 5 ตัวเป็น definer ทั้งหมด ·
  ไม่มีฟังก์ชันใดใน DB เรียก `fn_mig_*` · 🚨 **หลังลงรัน probe ซ้ำทั้ง 2 ก้อน** (anon/authenticated
  = false · service_role = true) ก่อนบอกว่าปิดแล้ว
- **0074** ส่วนที่แตะเส้นทางสต็อก + R6 + เครื่องมือตรวจ (ด้านล่าง)
- 🚨 **ห้ามมัดการแตะเส้นทางสต็อกเข้ากับ push ฉุกเฉิน**

#### 3. `apply_stock_delta` — พลิก trigger เป็น definer **ก่อน** แล้วค่อยปิด
ผู้เรียกคนเดียวคือ `trg_update_stock_product` ซึ่งเป็น **invoker** ⇒ revoke ตรง ๆ =
insert/update/delete บน `log_product` เด้ง permission denied ทั้งระบบ
→ `alter function trg_update_stock_product() security definer` + `set search_path = public`
★ **ใช้ `ALTER` ไม่ยกตัวฟังก์ชันมาเขียนใหม่** = ตรรกะ +/− ของ P2 ไม่ถูกคัดลอกแม้ตัวอักษรเดียว
(เปลี่ยนแค่ระดับสิทธิ์ ตามกติกา D82/D90) · ค่าที่ trigger ส่งต่อมาจากแถวที่ RLS ตรวจไปแล้ว

#### 4. `recompute_stock_product` — คงเรียกได้ (ปุ่มซ่อมสต็อก) แต่มีด่านในตัว
- ผู้เรียกที่เชื่อได้ = `auth.role()` เป็น `service_role` หรือ **ไม่มี JWT เลย**
  (postgres / SQL editor / pg_cron) → ทำตามเดิม (`fn_mig_recompute_stock` ของ restore/import)
- นอกนั้นต้อง: มี `my_tenant()` · มี `has_cap('prod.write')` (viewer เคยสั่งได้) · `p_tenant` ถ้าส่ง
  ต้องเท่ากับ `my_tenant()` · revoke จาก `anon`
- 🔄 **ต่างจากที่ triage เสนอ**: triage ให้ยกเว้น "เมื่อ `my_tenant()` เป็น null" แต่ anon และ
  ผู้ใช้ที่ไม่มี profile ก็ได้ null ⇒ เรียกแบบไม่ส่งพารามิเตอร์ = `v_t` null = **ซ่อมทุก tenant**
- ยกด้วย `scripts/gen/gen-0074.mjs` ซึ่ง **assert** ว่าถอดบล็อกด่านออกแล้วได้ต้นฉบับจาก 0029 เป๊ะ
- UI: ปุ่มในแท็บสต็อกเทาสำหรับบทบาทที่ไม่มี `prod.write` พร้อมบอกว่าใครกดได้ (`capHolderText`)

#### 5. R6 `handle_new_user` — ตัด arm ที่ 3 ของ coalesce
`(select id from tenants where is_active limit 1)` ทิ้ง · คง `my_tenant()` ไว้ ⇒ ไม่มี tenant = raise
(fail-closed) · ไล่แล้วว่าทุกจุดที่ `createUser` ส่ง `tenant_id` ครบ (provision · หน้าผู้ใช้ ·
grant-platform-admin · harness เทส) · ผลข้างเคียงที่ตั้งใจ: กด Add user จาก Supabase dashboard
จะได้ *Database error creating new user* · ★ คอมเมนต์ใน `settings/users/actions.ts` ที่ว่า
*"ไม่ส่ง = สร้างไม่ได้"* ซึ่งเคยเป็นคำโกหก กลายเป็นความจริง
⏳ **Email signup บน hosted ต้องเช็คที่ dashboard เอง** (`config.toml` มีผลแค่ local)

#### 6. เทส — ชั้นที่พิสูจน์ถามสิทธิ์จริง ไม่ใช่อ่านไฟล์
- `fn_audit_definer_grants()` (0074) คืนทุกฟังก์ชันใน public + สิทธิ์ anon/authenticated/
  service_role + `prosrc` · **security invoker โดยตั้งใจ** · 🚨 revoke ในไฟล์เดียวกัน
  (ลืม = แจกแผนที่ช่องโหว่) · เทสตรวจตัวมันเองด้วย
- `tests/tenant/definer-grants.test.ts` วนจาก pg_proc ⇒ ฟังก์ชันในอนาคตถูกครอบอัตโนมัติ ·
  เหตุผลที่ต้องเป็นชั้นนี้: **drop + create ใหม่ (D69) = ได้ default privileges คืนเงียบ ๆ**
  ขณะที่ไฟล์ SQL ยังมีบรรทัด revoke ครบ — เทสอ่านไฟล์จะยังเขียว
- กฎ: definer **ทุกตัว** (ไม่ใช่แค่ 7 ตัวที่รับ p_tenant — "อีก ~40 ตัวมีด่านของตัวเอง" เป็น
  คำกล่าวอ้าง ไม่ใช่สิ่งที่พิสูจน์แล้ว) ต้อง (ก) ปิดจาก anon+authenticated หรือ (ข) มี
  `my_tenant()` / `has_cap(` / `*_guard(` ใน body (ตัดคอมเมนต์+สตริงก่อน) หรือ (ค) อยู่ใน
  allowlist ที่ **ตรวจตัวเองได้** · definer ที่รับ `p_tenant` เข้มกว่า: ต้องปิด หรืออ่านอย่างเดียว
  หรืออยู่ใน `P_TENANT_GUARDED`
- allowlist (`lib/shared/definerPolicy.ts`) 3 หมวด: **readonly** (ไม่มีคำสั่งเขียน + ไม่เรียก
  ฟังก์ชันอื่นนอกหมวด) · **self** (แตะแค่ `profiles` และแก้ได้เฉพาะ `where id = auth.uid()`) ·
  **delegates** (ไม่เขียนเอง และทุกตัวที่เรียกต่อต้องปิดหรือมีด่าน) ⇒ วันไหนมีคนเติมคำสั่งเขียน
  เข้าไปในตัวที่ allowlist ไว้ เทสแดงทันที · มีเทสกันชื่อค้างใน allowlist ด้วย
- probe ก่อนออกแบบ: 12 ตัวไม่ผ่านกฎ (ข) — **อ่าน body ครบทุกตัว ไม่มีตัวไหนเป็นรูจริง**
  (`fn_bar_quick_sale` ไม่เขียนเอง ส่งต่อให้ 3 ตัวที่มีด่าน · `my_*`/`has_cap` อ่าน profile ตัวเอง ฯลฯ)
- 🚨 **ห้ามพิสูจน์ด้วยการยิงฟังก์ชันที่ปิดไว้เป็น anon** — ถ้าด่านไม่แน่น การทดสอบคือการก่อ
  ความเสียหาย · ยิงจริงแค่ `recompute_stock_product` (ผลลัพธ์ถูกต้องเสมอ) และ
  `fn_audit_definer_grants` (อ่านอย่างเดียว)
- ชั้นเสริม `lib/shared/definerGrantsSql.test.ts`: ตั้งแต่ 0073 revoke ทุกบรรทัดต้องครอบ `anon` ·
  ตัวใน `MUST_CLOSED_DEFINERS` ต้องถูก revoke ในไฟล์ที่ไม่เก่ากว่าการนิยามล่าสุด ·
  **พิสูจน์แล้วว่าจับได้** (แก้ 0074 ให้เหลือ `from public` → แดง 2 ข้อ → generate คืน → เขียว)

- 🪤 **กฎ ข. (มีคำว่า my_tenant() ใน body) ไม่พอสำหรับตัวที่รับ p_tenant** — recompute ก่อน 0074
  มี `coalesce(p_tenant, my_tenant())` จึงผ่านกฎ ข. ทั้งที่รับ tenant ของใครก็ได้ ⇒ ตัวใน
  `P_TENANT_GUARDED` ต้อง **เทียบ** `p_tenant <> my_tenant()` จริง และปิดจาก anon (เจอระหว่างเขียนเทส)
- ตัวตรวจอยู่ใน `lib/shared/definerPolicy.ts` **แหล่งเดียว** ใช้ทั้ง test:tenant และ
  `npm run db:audit-grants` (ให้ผู้ใช้รันเองหลังลง migration ทุกครั้ง · ใช้ service role key
  ที่มีอยู่แล้ว **ไม่เพิ่มที่อยู่ใหม่ให้รหัส DB**) · unit test ด้วยข้อมูลสังเคราะห์ 16 ข้อ (คู่ผ่าน/แดงทุกข้อ)
- ★ **พิสูจน์กับข้อมูลจริงก่อนลง 0074**: รันตัวตรวจกับ pg_proc ของทั้ง 2 DB (อ่านอย่างเดียว)
  → ฟ้อง **เฉพาะ** `apply_stock_delta` · `recompute_stock_product` · `fn_audit_definer_grants` (ยังไม่มี)
  ไม่มีตัวอื่นใน definer ทั้งหมด ⇒ กฎกับ allowlist พอดีกับ body จริง
- ★ **หลังลง 0074 (ผลจริงจาก `db:audit-grants`)**: definer 52 ตัว (เจ้าของ) / 53 ตัว (proof-app) ·
  ปิดจาก anon+authenticated 5 ตัว · ผ่านทุกกฎทั้ง 2 ก้อน
  - ทำไมเพิ่มจาก 51/52 → 52/53: `trg_update_stock_product` เพิ่งถูกพลิกเป็น definer (ข้อ 3)
  - ทำไม 2 ก้อนต่างกัน 1: `rls_auto_enable()` มีเฉพาะ proof-app (ข้อ 8)
  - ทำไมปิด 5 ไม่ใช่ 6 ตาม `MUST_CLOSED_DEFINERS`: `fn_audit_definer_grants` เป็น **invoker**
    จึงไม่ถูกนับเป็น definer แต่ปิดจาก anon/authenticated เหมือนกัน (test:tenant ตรวจแยกข้อ)
  - 🪤 ตัวเลข "52 ตัว" ที่จดไว้ตอนแรกนับผิด — รวมแถว `trg_update_stock_product` ที่ตอนนั้นยังเป็น
    invoker เข้าไปด้วย (probe แรกคัดแถวด้วย `prosecdef or proname in (...)`) · แก้เป็นตัวเลขจริงแล้ว

#### 7. 🪤 กับดักจับคำ — เทสเดิมแดงเพราะ 0073
`tenantTables.test.ts` หาไฟล์ที่นิยาม `fn_mig_truncate` ด้วย `includes("function fn_mig_truncate")`
แต่ `revoke execute on function fn_mig_truncate(uuid)` ก็มีคำนั้น → หยิบ 0073 ที่ไม่มีตัวฟังก์ชัน
→ แดง 5 ข้อ (DB ไม่มีปัญหา) · แก้เป็นจับ `create [or replace] function` · กับดักเดียวกันแฝงอยู่ใน
`rolesSql.test.ts` (`has_cap`) และ `taxFiling.test.ts` (`fn_file_tax`) → แก้ไปพร้อมกัน
(`redistill.test.ts` ไม่โดน — เลือกไฟล์จากชื่อไฟล์)

#### 8. จงใจไม่ทำ / เลื่อน
- `fn_excise_months_open` — อยู่ใน allowlist หมวด readonly · **เหตุผล: ไม่มีผู้เรียกในแอปเลย
  (มีแต่ใน SQL ด้วยกัน) และอ่านอย่างเดียว** — ไม่ใช่เพราะเทสเรียกอยู่ (เทสไม่ใช่เหตุผลของการคงรู)
- `entity_is_vat` — allowlist readonly · ผู้เรียกคือ trigger **invoker** 2 ตัว (ด่าน ม.86/13 บน
  `transactions`/`sales_orders`) · คืน boolean ที่เป็นข้อมูลสาธารณะ เขียนอะไรไม่ได้
  ⇒ ไม่คุ้มเอาด่านกฎหมายไปเสี่ยง (ถ้าจะปิด ใช้วิธีเดียวกับข้อ 3)
- **ไม่แก้ default privileges** — ถ้าแก้ RPC invoker ทุกตัวที่แอปเรียกต้อง grant ทีละตัว
  (ลืม = แอปพังเงียบ ๆ) และ postgres แก้ default ACL ของ `supabase_admin` ไม่ได้อยู่ดี
  ⇒ ให้เทส pg_proc เป็นตัวกัน
- `rls_auto_enable()` (มีเฉพาะ proof-app · ไม่มีในไฟล์ใดใน repo) — owner = `postgres` แต่เป็น
  ฟังก์ชันของ event trigger `ensure_rls` (ddl_command_end) ที่เปิด RLS ให้ตารางใหม่ใน public เอง
  ⇒ **ไม่ drop** (drop = ตารางใหม่ใน proof-app ไม่ถูกเปิด RLS) · เรียกแบบ RPC ไม่ได้อยู่แล้ว
- ⚠️ **pg_cron ไม่ได้ติดตั้งทั้ง 2 DB** (`cron.job` ไม่มี) — บรรทัด *"pg_cron weekly"* ใน CLAUDE.md
  ไม่ตรงความจริง · ด่านใน recompute รองรับไว้แล้วถ้าจะติดตั้งทีหลัง (ไม่มี JWT = ผ่าน)

### D100 — ตั้งรูปแบบเลขเอกสารเองได้ + เลขเอกสารใช้วันที่ไทย (0075-0076, 2026-09-28)

**ต้นเรื่อง**: ผู้ใช้ขอให้ "ทุกจุดที่รันเลข" ตั้งเองได้ — ตัวอักษรนำหน้า · รันตามวัน/เดือน/ทั้งปี ฯลฯ
ไล่แล้วมีเลขรันอัตโนมัติ **19 ชุด ด้วยกลไก 3 แบบปนกัน** (`counters` · หาเลขมากสุด+1 · ค่าจากเวลา)

#### ขอบเขตที่ผู้ใช้ตัดสิน (เสนอเป็นทางเลือกก่อน · ผู้ใช้เลือกทาง ค)
- **ทาง ค** = ช่องเลือกชุดปิด (แบบทาง ก) + ตัวอย่างสด "ใบถัดไปจะเป็น …" · ไม่ใช่แม่แบบที่พิมพ์เอง (ทาง ข)
  เหตุผลเดียวกับที่ไม่ทำภาษาสูตร (D67/D70): พิมพ์แม่แบบผิด = ลืม `{####}` แล้วเลขซ้ำทุกใบ
- **กลุ่ม A (เอกสารที่ลูกค้า/ราชการเห็น) + กลุ่ม B (batch/ล็อต)** เท่านั้น · 🚫 **ไม่ทำกลุ่ม C**
  (รหัสภายใน `TR-`/`C-`/`EMP-`/`PR-YYYY-MM` ฯลฯ — เป็นกุญแจที่ตารางอื่นอ้าง ไม่มีใครเห็น
  และ `PR-2026-09` ใช้ปีเดือนเป็นตัวรหัส)
- **ชนเลขที่ออกแล้ว = บล็อก** · **ใบเสร็จผู้ไม่จด VAT แยกชุด `RC`** (เดิมยืมชุด INV · D89)
  · **บาร์ไม่ลงย้อนหลังในรอบนี้** · **ลงย้อนหลัง (เฟส 3) ทำทั้ง 2 แบบ**: เลือกวันที่แล้วระบบออกเลข
  ของวันนั้น + พิมพ์เลขบนกระดาษช่วงระบบล่มเอง — และต้องลากวันที่บัญชี + ฟอร์ม ภส. ไปด้วยกัน
  (แก้แค่เลขบนเอกสาร = สองใบขัดกันเอง · D86 จดไว้ว่า *ขายย้อนวันไม่ได้*)

#### เฟส 0 (0075) — 🔴 เลขเอกสารฝั่งขาย/บัญชีใช้วันที่ UTC
`fn_next_sales_doc` / `next_tx_id` / `fn_save_transfer` ประกอบเลขด้วย `current_date` = **UTC** บน Supabase
⇒ ใบที่ออก 00:00–06:59 เวลาไทยได้เลขของเมื่อวาน · บาร์เคยเจอแล้วแก้ใน 0065 แต่ฝั่งอื่นไม่ได้ตามไปแก้
- `fn_today_th()` (invoker) · ยก `fn_save_transfer` ด้วยสคริปต์ `gen-0075.mjs` แทนแค่ 2 บรรทัดประกอบเลข
- 🚨 **ไม่ตั้ง timezone ระดับ database** — จะเปลี่ยน `current_date` ทุกจุดพร้อมกันเงียบ ๆ รวมวันที่ที่ลง
  ฟอร์มราชการ (`log_product.doc_date` ก็เป็น UTC — ⏳ ยกไปเฟส 3 ที่ต้องคิดวันที่ทั้งชุด)
- 🪤 `fn_next_sales_doc` **ห้ามเรียก `fn_today_th()`** — เป็น definer หมวด delegates (D99) ส่งต่อได้เฉพาะ
  ฟังก์ชันที่ปิดแล้ว/มีด่าน · fn_today_th ไม่มีทั้งคู่ ⇒ ตัวตรวจแดง → เขียนนิพจน์ตรง ๆ แบบ 0065

#### เฟส 1 (0076) — ตัวออกเลขตัวเดียว
- ตาราง `doc_numbering` 1 แถวต่อ (กิจการ, ชนิด) · **ไม่มีแถว = รูปแบบเดิม** · ไม่มี policy เขียน
  (เขียนผ่าน RPC · บทเรียน D85/0052) · 🚫 **ไม่มี CHECK บน doc_type** (บทเรียน D80) · audit ด้วย `trg_audit`
- `fn_next_doc_no(ชนิด, กิจการ, วันที่)` จุดเดียว · `fn_next_sales_doc`/`fn_bar_next_doc` กลายเป็นตัวส่งต่อ
  ⇒ **ผู้เรียกเดิมทุกจุด (fn_save_quotation · บาร์ 3 ตัว) ไม่ต้องแก้แม้บรรทัดเดียว**
- 🚨 **การจัดรูปเลขอยู่ใน SQL ที่เดียว** (`fn_doc_no_format`) · ตัวอย่างบนหน้าตั้งค่าเรียก RPC ที่ใช้ตัวเดียวกัน
  แบบไม่กินเลข — **ไม่มีสำเนาฝั่ง TS** (พรีวิวที่ไม่ตรงของจริงแย่กว่าไม่มีพรีวิว · D96)
- 🚨 **ข้ามเลขที่มีเอกสารใช้อยู่แล้วเสมอ** (`fn_doc_no_taken`) = ตัวกันเลขซ้ำตัวจริง ครอบ 3 ทาง:
  เปลี่ยนรูปแบบแล้วชนของเก่า · restore แล้วตัวนับถอยหลัง (D82 — `restore-tenant.ts` แกะเลขด้วย regex
  รูปแบบเดิม ใช้กับรูปแบบที่ตั้งเองไม่ได้) · เลขที่พิมพ์เองดักข้างหน้า
  ★ ฝั่งขายตรวจ **ทุกช่องเลขของออเดอร์** (qu/order/inv/dep_inv/tax1/tax2/rcpt1/rcpt2) — เลข INV ที่
  ใบเสร็จเคยยืมไป (D89) จึงไม่มีทางถูกออกซ้ำ
- ★ **ไม่ตั้งค่า = key ตัวนับเดิมเป๊ะ** (`QU-260928` ระดับ tenant · `B-EID01-260928`) เลขลูกค้าเดิมเดินต่อ
  · ตั้งค่าแล้ว = key ใหม่ `doc|ชนิด|กิจการ|prefix|รอบ` **แยกกิจการเสมอ** (ปิดข้อ 2 ของการไล่ต้นเรื่อง)
  · ใส่ prefix ใน key: เปลี่ยนตัวนำหน้า = ชุดใหม่ · เปลี่ยนจำนวนหลัก/ตัวคั่น = ชุดเดิมเดินต่อ
- 🪤 **เปลี่ยนรูปแบบกลางรอบต้องเดินต่อจากตัวนับเดิม** ไม่ใช่เริ่ม 1 — ไม่งั้นวันเดียวมี `001` กับ `0001`
  คนละใบ (สตริงไม่ซ้ำ ตัวกันเลขซ้ำจึงไม่จับ แต่เป็น "เลขที่ 1" สองใบในสายตาคน) · ตอนบันทึกคัดลอกค่า
  ตัวนับของรอบนี้ไป key ใหม่ถ้ายังไม่มี · อยากเริ่มใหม่ = กรอก "เลขถัดไป" เอง
- 🚨 รูปแบบที่ทำให้เลขซ้ำ **บันทึกไม่ได้** (`fn_doc_cfg_error`): เริ่มนับใหม่ทุกวันแต่ในเลขไม่มีวัน ฯลฯ
  · ฝาแฝดฝั่ง TS `allowedResets()` ใช้ปิดตัวเลือกบนจอ · `test:tenant` เทียบครบ 28 คู่
- 🪤 **ไม่ใช้ `lpad` ตรง ๆ กับเลขรัน** — `lpad('1000',3)` = `'100'` (ตัดทิ้ง) · ของเดิมจะออกเลขซ้ำเมื่อเกิน 999
  ใบต่อวัน · ตัวใหม่ยาวเกินจำนวนหลัก = ปล่อยยาวตามจริง
- 🔴 **เจอระหว่างทาง**: `sales/actions.ts` ขอเลข INV/TAX **ทิ้ง `error`** 5 จุด → ออกเลขไม่ได้แล้วได้ `null`
  = เอกสารไม่มีเลขที่โดยไม่มีอะไรฟ้อง (ตระกูล D89) · ตอนนี้ตัวออกเลขมีด่านที่ raise ได้จริง จึงรวมเป็น
  `nextDoc()` ตัวเดียวที่หยุดทั้งรายการ · เทสอ่านซอร์สล็อกว่ามี rpc จุดเดียวและอ่าน error
- สิทธิ์: ตั้งค่า = `admin` · ออกเลข = `sales.write` / `bar_guard(entity,'bar.write')` · helper ที่รับ
  `p_tenant` เป็น invoker + revoke `public, anon, authenticated` (D99)
- 🪤 **generator เจอไฟล์ migration เป็น CRLF** (git autocrlf) → หาบล็อกเดิมไม่เจอแล้ว throw ให้เห็นทันที
  (ด่าน "ห้ามเดา หยุด" ทำงานตามออกแบบ) → normalize เป็น LF ก่อนเทียบ · ด่านนับวงเล็บต้องตัดคอมเมนต์ก่อน
  (หัวข้อ "1) 2)" มีวงเล็บปิดเดี่ยว ๆ)
- 🪤 **build ขณะเซสชันอื่นรัน dev อยู่** (บทเรียน D96: `.next` พัง) → build จากสำเนาบนไดรฟ์เดียวกัน
  + junction `node_modules` · 🪤 junction **ข้ามไดรฟ์** (C:→D:) ทำ webpack แปลง path เพี้ยน build ล้ม

#### เฟส 2 (0077) — 50ทวิ · batch · ล็อต + 🔴 เปลี่ยนกฎเลขถัดไปเป็น "มากกว่าเลขที่มีอยู่เสมอ"
- 🔴 **เจอข้อบกพร่องของกฎ 0076 ตอนออกแบบเฟส 2 (ก่อนลง DB)**: "ตัวนับ + ข้ามเลขที่มีอยู่" เริ่มนับจาก 1
  เมื่อชุดเลขยังไม่มีตัวนับ แล้ว **เติมช่องว่าง** — ผู้ใช้พิมพ์ 50ทวิ `6907` เอง ของเดิม (max+1) เสนอ `6908`
  แต่กฎ 0076 จะเสนอ `6901` = ใบที่ลงวันที่ทีหลังได้เลขน้อยกว่า บนเอกสารที่ยื่นสรรพากร · และใบที่ถูกลบ
  จะถูกเอาเลขกลับมาใช้ = เลขซ้ำใบที่อยู่ในมือคู่ค้า (ข้อความ "ค่าปริยาย = ของเดิมเป๊ะ" ก็จะไม่จริง)
- ★ **กฎใหม่: เลขถัดไป = max(ตัวนับ, เลขมากสุดที่มีเอกสารใช้อยู่ในรอบนี้) + 1** ใช้กับทุกชนิดรวมขาย/บาร์
  · หา "เลขในรอบนี้" ด้วย regex ที่ประกอบจากรูปแบบ (`fn_doc_no_regex`) — **ทำได้เพราะเลือกทาง ค**
    (ชุดปิด) ถ้าเป็นแม่แบบพิมพ์เอง (ทาง ข) จะประกอบ regex ที่เชื่อได้ไม่ได้ · ส่วนวันที่ที่ละเอียดกว่ารอบ
    เป็น wildcard (รอบรายปี + เลขมีเดือน = ทุกเดือนนับรวม)
  · ได้ครบ: ไม่เติมช่องว่าง · ไม่ซ้ำ · เรียงตามเวลา · **ค่าปริยายเท่า max+1 ของเดิมเป๊ะ** (test:tenant เทียบกับ
    `nextWhtDocNo`/`nextBatchNumber`/`nextLotNumber` ตัวเดิมโดยตรง) · restore ไม่ถอยหลัง
  · ⇒ **ไม่ต้อง seed ตัวนับจากข้อมูลเก่า** (อ่านจากเอกสารจริงทุกครั้ง) — ตัดขั้น seed ที่ร่างไว้ทิ้ง
  · 🪤 **ตัวคั่นใน regex เป็นอะไรก็ได้ในชุด `- / .`** — เปลี่ยนแค่ตัวคั่นกลางเดือนต้องเดินเลขต่อ
    ไม่งั้นมี "เลขที่ 1" สองใบ (`IV6909-0001` กับ `IV6909/0001`) · เปลี่ยน prefix = ชุดใหม่โดยตั้งใจ
  · ทะเบียนเลขที่มีอยู่รวมเป็น **`fn_doc_nos` ที่เดียว** (ใช้ทั้งกันซ้ำและหา max) — เดิม `fn_doc_no_taken`
    มีรายชื่อตารางของตัวเอง
  · "เลขถัดไป" ที่ตั้งเอง **ต้องมากกว่าเลขล่าสุดของรอบนี้** (ไม่ใช่แค่ไม่ชน) — ต่ำกว่า = ออกเลขย้อนลำดับ → บล็อก
- **ชนิดใหม่** `acct_wht` (`6901` · แยกกิจการ · ใบคู่ค้า+ใบพนักงานชุดเดียวกัน D69 · สิทธิ์ `acct.write` หรือ
  `pay.write`) · `prod_batch` (`12/69` · เลขรัน**หน้า**ปี · ตรวจทั้ง log_ferment/log_distill/log_ferment_draw)
  · `prod_lot` (`S1/69`) — batch/ล็อตใช้ร่วมทั้ง tenant (ของเดิมคิดจากทุกแถว) → เก็บรูปแบบใต้กิจการหลัก
- **`fn_suggest_doc_no` เสนอเลขโดยไม่กินเลข** — 3 ชนิดนี้เป็นเลขที่เติมในฟอร์มแล้วผู้ใช้แก้ได้ (ของเดิม)
  ⇒ เปิดฟอร์มแล้วปิดทิ้งไม่ทำให้เลขโดด · batch ยังพิมพ์เองได้ตามเดิม
- ด่านสิทธิ์ของการขอเลขรวมเป็น `fn_doc_issue_guard` ที่เดียว (ออกเลข + เสนอเลข)
- 🚨 แอปเลิกหาเลขถัดไปเองฝั่ง TS ทั้ง 4 จุด (บัญชี · เงินเดือน · batch · ล็อต) — ไม่งั้นรูปแบบที่ตั้งไว้
  ไม่มีผล = หน้าจอบอกอย่างหนึ่ง แอปทำอีกอย่าง (ตระกูล D81) · เทสอ่านซอร์สล็อกไว้ · ฟังก์ชันเดิมใน lib
  คงไว้เป็น **สเปกของรูปแบบเดิม** (golden A9/P12 + เทียบใน test:tenant) · `getRedistillLotNos` ลบทิ้ง (ไม่มีผู้เรียก)

#### 0079 — แก้ "เลขล่าสุด" ของ 0077 (test:tenant แดง 2 ข้อหลังลง DB)
- 🔴 0077 นิยาม "เลขล่าสุด" = เลขมากสุดของ **เอกสารที่บันทึกแล้ว** อย่างเดียว แต่เลขที่แจกไปแล้วไม่ได้อยู่ใน
  เอกสารเสมอ (ขอเลขแล้วบันทึกล้มกลางทาง) → (1) เปลี่ยนรูปแบบกลางรอบแล้วเลขเริ่ม 1 ใหม่ (2) ตั้ง "เลขถัดไป"
  ทับเลขที่แจกไปแล้วได้ · 🪤 **ผมตัดขั้น "ยกตัวนับเมื่อเปลี่ยนรูปแบบ" ของ 0076 ทิ้งใน 0077 เพราะคิดว่าเลขจาก
  เอกสารครอบแล้ว — ครอบไม่หมด** ⇒ เอกสาร ≠ เลขที่แจกไป
- แก้: `fn_doc_last_n` = max(ตัวนับ, เลขมากสุดในเอกสาร) ใช้ทั้งพรีวิว/บันทึก/ตัวเลขบนจอ + คืนขั้นยกตัวนับ
  · ตัวออกเลขไม่ต้องแก้ (คิด greatest อยู่แล้ว) · เป็นไฟล์ใหม่ ไม่แก้ 0077 ที่ลงแล้ว (D95)
- เทสอ่านไฟล์ล็อกทั้งสองจุดเพิ่ม 2 ข้อ

#### เฟส 3 (0078) — ลงเอกสารขายย้อนหลัง (ระบบล่มในวันที่ขาย)
- 🎯 ต้องตรงกันทั้ง 3 อย่าง: **เลขเอกสาร · บัญชี/ภพ.30 · ฟอร์ม ภส.** — ผู้ใช้เลือกให้ทำทั้ง (ก) เลือกวันที่
  แล้วระบบออกเลขของวันนั้น และ (ข) กรอกเลขที่เขียนบนใบกระดาษไปแล้ว
- ★ **ไล่แล้วพบว่าครึ่งหนึ่งมีอยู่แล้ว**: หน้าจัดการออเดอร์มีช่อง "วันที่ออกเอกสาร / วันที่รับเงิน" และบัญชีลง
  `transaction_date = tax_invoice_date = วันที่นั้น` ถูกอยู่แล้ว — **ที่ผิดคือเลข**: ขอเลขด้วยวันที่กดบันทึก
  ⇒ ใบกำกับลงวันที่ 25 แต่เลขเป็น `TAX260928-…` (เลขกับวันที่บนใบเดียวกันขัดกันเอง)
  → ขอเลขผ่าน `fn_next_doc_no(ชนิด, null, docDate)` (มี p_date ตั้งแต่ 0076 · ไม่ต้องแก้ SQL)
- 🔴 **เจอเพิ่ม**: `processOrder` ตกไปใช้ `today()` ของ server (UTC) เมื่อไม่ได้ส่งวันที่ → ส่ง docDate ที่
  ตัดสินแล้วเข้าไปเสมอ · และ **`fn_confirm_fulfillment` ลง `log_product.doc_date = current_date` ตายตัว**
  (= ฟอร์ม ภส. ไม่มีทางย้อนวันได้ และเป็น UTC ด้วย) → รับ `p_date` (ยกฟังก์ชันด้วย `gen-0078.mjs`
  แก้ 3 จุด diff ยืนยัน · 🪤 เพิ่มพารามิเตอร์ = drop ตัวเดิมก่อน D69) · 🚨 **ล่วงหน้าไม่ได้** ตรวจ 2 ชั้น
- **เลขที่กรอกเอง**: `fn_doc_manual_check` (definer · สิทธิ์ `sales.config` = หัวหน้า แนวเดียวกับยกเลิกออเดอร์
  D85) ตรวจว่าเลขยังไม่มีเอกสารใช้ · ★ **ตรวจเลขที่กรอกให้ผ่านก่อน แล้วค่อยขอเลขอัตโนมัติ** — ล้มที่เลขกรอก
  = ไม่กินเลขรันฟรี · ★ ไม่ต้องแตะตัวนับ: กฎ 0077 คิดจากเลขมากสุดที่มีอยู่ → เลขอัตโนมัติถัดไปต่อจากเลขที่กรอกเอง
  · 🚨 กรอกเลขให้ใบที่ครั้งนี้ไม่ได้ออก = ปฏิเสธพร้อมเหตุผล **ห้ามทิ้งค่าที่พิมพ์เงียบ ๆ** (D92)
- **ช่องไหนโชว์**: `manualNoFields()` ใช้ `neededSerials` ตัวเดียวกับ server ดูทั้งโลกจด/ไม่จด VAT แล้ว AND
  (หน้าจอไม่รู้สถานะ VAT) · เทสไล่ทุก action × สถานะเลขของออเดอร์ว่าตรงกับเลขที่ server จะออกจริง
- UI: ช่องวันที่ขึ้นคำอธิบายเหลืองเมื่อย้อนหลัง/ล่วงหน้า (`docDateNote`) · กล่อง *ออกใบกระดาษไปแล้ว* เทาสำหรับคนที่
  ไม่มีสิทธิ์พร้อมบอกว่าใครทำได้ (ไม่ซ่อน · D86) · หน้าคลังเปลี่ยน `window.confirm()` เป็นกล่องในแอป (D96)
  พร้อมช่อง **วันที่ส่งของ** · ขายหน้าร้านมีกล่อง *ลงรายการย้อนหลัง* ซ่อนไว้ปริยาย (ขายปกติยังกดครั้งเดียวจบ)
  · ประโยคทุกตัวอยู่ใน `lib/sales/backdate.ts` (มีเทสคุม · ห้ามแต่งในคอมโพเนนต์ D91)
- 🚫 **จงใจไม่ทำ**: บาร์ (ผู้ใช้ตกลง) · เลขใบเสนอราคา/ออเดอร์ยังเป็นของวันนี้ (เอกสารภายใน ไม่ใช่เอกสารภาษี)
  · ไม่บล็อกเมื่อเดือนนั้นยื่นแบบ/ปิดเดือนแล้ว — **เตือนอย่างเดียว** (ผู้ใช้ย้ายมาจาก Sheets · D91 ปิดเดือน
  ไม่บล็อกการแก้ข้อมูล · การ์ดปิดเดือนขึ้น "ต่างจากยอดที่ยื่นไว้" ให้อยู่แล้ว)
- 🪤 **เจอระหว่างทำ**: แก้ไฟล์ผ่าน heredoc → template literal ของ node **กินแบ็กสแลชใน regex** (`\b` กลายเป็น
  อักขระ backspace ที่มองไม่เห็น · Edit ก็หาข้อความไม่เจอ) → เขียนบล็อกลงไฟล์แยกด้วย Write แล้วประกบ
  + ไล่ตรวจอักขระควบคุมในทุกไฟล์ที่แตะ (ตระกูล `$` ใน heredoc ของ D85)

#### ✅ เทสในเบราว์เซอร์จริง (2026-09-28 · tenant `siamdist` · DB proof-app · 0075-0079 ลงครบ + test:tenant ผ่าน)
- **ตัวเลขถูกทุกตัว (เทียบ DB)**: ลงย้อนหลัง 25/09 ผ่านหน้าออเดอร์ → `INV260925-001` · `TAX260925-001` ·
  บัญชี `transaction_date = tax_invoice_date = 25/09` · คลังส่งของย้อนหลัง → `log_product.doc_date = 25/09`
  (ครบ 3 อย่างวันเดียวกัน) · วันส่งของ = พรุ่งนี้ → แดงและปุ่มกดไม่ได้ · เลขกรอกเองที่ซ้ำ → ปฏิเสธ ไม่มีอะไร
  ขยับ · เลขกรอกเองใหม่ → `INV260925-800`/`TAX260925-900` · **ขายหน้าร้านย้อนหลังได้ `TAX260925-901`
  ต่อจากเลขที่กรอกเอง** (กฎ 0077/0079 บนข้อมูลจริง) · ตัวอย่างบนจอ `IV6909-0001` = เลขที่ออกจริง ·
  เลขถัดไป = 1 ถูกบล็อก · batch `2/69` → ปีหน้า `1/70` → รูปแบบใหม่ `B2569-001` ขึ้นฟอร์มลงหมักทันที
- 🟡 **เจอประโยคบนจอไม่ตรงความจริง 4 จุด (แก้แล้ว · ไม่มี migration · ตัวเลขไม่ผิดสักตัว)** — ตระกูล D91/0059:
  1. ท้ายหน้าขายหน้าร้านยังเขียน *"ขายย้อนวันไม่ได้"* (D86) ขัดกับกล่องลงย้อนหลังที่อยู่เหนือมันพอดี
  2. คำเตือนลงย้อนหลังบอก *"บัญชี และ ภพ.30 จะเป็นของวันนั้น"* ทุก action รวมขั้นออกใบแจ้งหนี้/ส่งเครดิตที่
     ยังไม่ลงบัญชี → `actionPostsRevenue()` แหล่งเดียว ใช้ทั้งประโยคและด่าน `needsRevenue` ฝั่ง server
  3. *"เลขล่าสุดที่ออกไปแล้ว: 19"* หลังตั้งเลขถัดไปเป็น 20 — ค่านั้นรวมเลขที่ **ข้าม** ไปด้วย (0079)
     → *"เลขใหม่จะต่อจาก N เสมอ (เลขล่าสุดที่ใช้หรือข้ามไปแล้วในรอบนี้)"* · ⏳ ข้อความ raise ใน SQL
     (`fn_doc_numbering_save`) ยังใช้คำเดิม — ไปถึงได้เฉพาะยิง API ตรง เพราะหน้าจอบล็อกก่อน · ไม่คุ้มทำ migration
  4. หน้าประวัติการแก้ไข: uuid ใน *แก้โดย* (ซ้ำคอลัมน์ ใครแก้) · ค่าเป็นรหัสดิบ `be/month/YYMM/sales_inv` ·
     บันทึกแค่เลขถัดไปขึ้น *"แก้ไข 0"* → SKIP `updated_by` · แปลงค่าตาม **ตาราง** (`VALUE_LABEL_BY_TABLE`
     ใช้ป้ายชุดเดียวกับหน้าตั้งค่า) · `rowPkLabel()` · ศูนย์ช่อง = "—"
- ⚠️ **ผมพลาดตอนเก็บกวาด**: สคริปต์ยกเลิกออเดอร์เลือกการ์ดกว้างเกินไป → ยกเลิก `ORD260906-001`/`-002`
  (ข้อมูลรอบเทส D93) ไปด้วย · ระบบย้อนครบตามโฟลว์ยกเลิก (บิล · สต็อก +3 · ซ่อนแถว ภส. 06/09) ·
  **ผู้ใช้ตัดสินไม่กู้** (tenant ทดสอบ) · 🪤 บทเรียน: สคริปต์ที่กดปุ่มทำลายข้อมูลต้องจับการ์ดด้วยเลขที่แน่นอน
  และหยุดเมื่อไม่เจอ ห้ามวนหา "การ์ดที่มีปุ่มยกเลิก" แบบกว้าง ๆ
- ⏳ ไม่ได้เทสในเบราว์เซอร์: หน้ากระดาษ PDF (ป๊อปอัพถูกบล็อก) · ฟอร์ม 50ทวิ (`siamdist` ไม่มีบิลหัก ณ ที่จ่าย ·
  test:tenant ครอบแล้ว) · กล่องกรอกเลขเองเทาสำหรับพนักงานขาย (test:tenant ครอบฝั่งสิทธิ์)
- 🪤 นอกขอบเขต: ปุ่มยกเลิกออเดอร์ยังใช้ `window.confirm()` (อยู่ในงานค้าง *ไล่เช็คกล่องยืนยันทั้งแอป*)
- **ภาคต่อ (2026-10-05 · ไม่มี migration) — ย้ายตัวเลือกกิจการลงการ์ดของตัวเอง**: ผู้ใช้ถามว่าตัวเลือกกิจการบนสุดของหน้า
  *ตั้งค่า → เลขเอกสาร* "เลือกทำไม ส่งผลอะไร" — 🪤 **คำตอบจริงคือมีผลแค่การ์ดบาร์** (เอกสารขายออกในนามกิจการเดียว ·
  batch/ล็อตใช้ร่วมทุกกิจการ) แต่ตัวเลือกวางอยู่หัวหน้า = ดูเหมือนคุมทั้งหน้า และ 50ทวิ (ซึ่งรันแยกกิจการจริง) ไม่มีตัวเลือกเลย
  → `DOC_GROUPS[].entityParam` (`"bar" | "wht"`) · การ์ดที่รันแยกกิจการมีตัวเลือกของตัวเอง ผูก URL แยกกัน `?bar=` / `?wht=`
  (เปลี่ยนการ์ดหนึ่งไม่กระทบอีกการ์ด) · ค่าปริยาย: บาร์ = `bar_entity` · 50ทวิ = กิจการหลัก (`is_default`) ไม่ใช่ "กิจการแรกในรายชื่อ" ·
  มีกิจการเดียว = ไม่โชว์ตัวเลือกและไม่โชว์คำอธิบาย "เลือกกิจการด้านล่าง" · เทสล็อกว่าทุกกลุ่ม `perEntity` ต้องมี `entityParam` ไม่ซ้ำกัน
  (เพิ่มกลุ่มแยกกิจการใหม่แล้วลืม = เทสแดง) · ⏳ ยังไม่ได้เทสในเบราว์เซอร์ (session หลุด · `siamdist` มีกิจการเดียว ตัวเลือกไม่โผล่อยู่แล้ว)
- **แก้ข้อมูลครั้งเดียวที่ผู้ใช้รันเองใน SQL Editor (2026-10-05)**: ใบกำกับยอดค้าง `TAX261002-001` → `TAX2610-001`
  (เปลี่ยนรอบรันเป็นรายเดือนหลังออกไปแล้ว 1 ใบ) · ลบ `INV261005-001` + รีเซ็ตตัวนับ `INV-261005` · 🚨 **ผู้ใช้ปฏิเสธปุ่ม
  "ยกเลิกยอดค้างย้อนกลับไปก่อนจ่าย"** — เคสเฉพาะ แก้ที่ DB ครั้งเดียวดีกว่าเพิ่มปุ่มที่ย้อนเอกสารภาษีได้

### D101 — บาร์: จัดลำดับหมวดเมนูด้วย ▲▼ + ช่องแก้ชื่อหมวดมีปุ่มบันทึก (ไม่มี migration, 2026-09-28)

ผู้ใช้ถามว่าหน้า *จัดการหมวด* แก้ชื่อ/เรียงลำดับได้ไหม → ไล่แล้ว:
- **เรียงลำดับ: ไม่มีทางทำเลย** ทั้งที่ `bar_category.sort` มี · หน้าขายเรียงตามค่านี้ · action รับ `sort` ได้
  — ขาดแค่ปุ่ม (ตระกูล D74/D77) → ▲▼ ต่อแถว (ไม่ใช่ลาก — D70) · `reorderCategoriesAction(ids)` เขียนทั้งชุดเป็น 0,1,2,…
  เฉพาะแถวที่เปลี่ยน
- 🪤 **sort ของหมวดใหม่ = "จำนวนหมวด" ที่หน้าจอส่งมา** → เคยลบหมวดแล้ว เลขชนกับหมวดที่มีอยู่ และ `order("sort")`
  ไม่มีตัวตัดสินรอง = ลำดับสลับไปมาเอง (บทเรียน D86) → server คิด max+1 เอง + `.order("category_id")` เป็นตัวตัดสินรอง
  · การเรียงใหม่ครั้งแรกล้างเลขซ้ำของข้อมูลเก่าไปในตัว (ไม่ต้อง backfill)
- 🚨 ชุด id ที่ส่งมาต้องตรงกับ DB พอดี (`sameCategorySet`) — อีกเครื่องเพิ่ม/ลบหมวดระหว่างนั้น = ตอบ error ให้รีเฟรช ไม่เดา
- **แก้ชื่อ: ทำได้อยู่แล้วแต่ไม่มีใครรู้** — บันทึกเองตอน blur ไม่มีปุ่ม ไม่มีคำบอก → `CategoryName` (ประกาศ**นอก**
  editor — D71) ปุ่ม บันทึก/เลิกแก้ + "ยังไม่ได้บันทึก" สีเหลืองโผล่เมื่อชื่อต่าง · Enter บันทึก · Esc เลิกแก้
  · เลิกบันทึกตอน blur (ปุ่ม + blur = ยิงซ้ำ 2 รอบเมื่อกดปุ่ม)
- แก้ชื่อ**ไม่แตะ sort** อีกต่อไป (เดิมส่ง `sort: c.sort` กลับไปทุกครั้ง — ถูกโดยบังเอิญ)
- ตรรกะลำดับอยู่ `lib/bar/categoryOrder.ts` + เทส 16 (golden **B16**)


### D102 — เครื่องคิดเลขดีกรี@20°C แบบลอยในแท็บปรุง (ไม่มี migration, 2026-09-29)
- เดิมแปลงดีกรีตามอุณหภูมิได้เฉพาะในการ์ดบันทึกค่าระหว่างกลั่น (แท็บกลั่น/กลั่นซ้ำ) ซึ่งต้องมี batch/ล็อตที่กำลังกลั่น
  → เช็คดีกรีตอนปรับดีกรีก่อนบรรจุไม่ได้
- `AbvCalcCard` (การ์ดบนสุดของแท็บ **ปรุง/ปรับดีกรี**) — กรอกดีกรีที่อ่าน + อุณหภูมิ → ดีกรี@20°C สด ๆ
  · ★ เรียก `correctAbvTo20C` ตัวเดิม **ไม่มีสูตรชุดที่สอง** (ไม่แตะ `lib/abv` · golden ABV ผ่านโดยไม่แก้ไฟล์เทส)
  · นอกช่วงตาราง → "นอกช่วงตาราง" (ไม่เดาค่า) · **ไม่บันทึกอะไรลง DB**
  · ปุ่ม **ใช้เป็นดีกรีตั้งต้น C1** เติมค่าลงฟอร์มปรุงผ่าน `recalc` (ให้ V2/น้ำคำนวณตาม) · เทาเมื่อยังไม่มีผล

### D103 — บาร์: รับของ / ปรับยอด / เพิ่มวัตถุดิบ ทีละหลายรายการ บันทึกทีเดียว (0080, 2026-09-29)

ผู้ใช้แจ้งว่าบันทึกทีละตัวแล้วรอระบบทีละรอบเสียเวลามาก (รับของจากโรงกลั่น 10 อย่าง = กด 10 ครั้ง ·
แต่ละครั้งโหลดหน้าทั้งหน้าใหม่)
- **3 การ์ดเป็นตารางหลายแถว + ปุ่มบันทึกปุ่มเดียว** · พิมพ์แถวสุดท้ายแล้วต่อแถวว่างให้เอง · ✕ ลบแถว ·
  ตัวเลือกวัตถุดิบซ่อนตัวที่แถวอื่นเลือกไปแล้ว · แก้วัตถุดิบรายตัวยังใช้ป๊อปอัพเดิม
- 🚨 **ทั้งชุดเข้าหมดหรือไม่เข้าเลย** — `fn_bar_receive_batch`/`fn_bar_adjust_batch` (0080) วนเรียก
  `fn_bar_receive`/`fn_bar_adjust` ตัวเดิมใน transaction เดียว ⇒ สูตรถัวเฉลี่ยต้นทุน (B3) · `bar_move` ·
  `bar_guard` **ยังมีที่เดียว** (ไม่เขียนสูตรชุดที่สอง · D79/D86) · error บอก **เลขแถวบนจอ + ชื่อวัตถุดิบ**
  (ส่ง `row` ไปใน payload — แถวว่างถูกข้ามก่อนส่ง เลขลำดับใน SQL จึงไม่ตรงกับจอ)
  ★ **SECURITY INVOKER** ⇒ ไม่มี definer ตัวใหม่ให้ต้องปิดประตู (D99) · revoke anon + grant authenticated
- เพิ่มวัตถุดิบ = insert คำสั่งเดียว · 🪤 รหัส `I-<เวลา>-<แถว>` (ทั้งชุดได้ `Date.now()` เดียวกัน ไม่ต่อเลขแถว = ชนกันเอง)
  · 🚨 ตรวจชื่อซ้ำกับของเดิม (DB ไม่มี unique ชื่อ — ซ้ำแล้วรับของผิดตัวไปตลอด) ทั้งจอและ server
- กติกาแถวอยู่ `lib/bar/stockBatch.ts` golden **B17** (21 เทส): แถวว่าง = ข้ามเงียบ · 🚨 **กรอกครึ่งแถว = error
  พร้อมเลขแถว ไม่ใช่ข้ามเงียบ** (ผู้ใช้นึกว่าบันทึกครบแต่ของหายไป 1 ตัว) · ตัวเดียวกันซ้ำในชุด = error ·
  ปรับยอด: ยอดเท่าเดิม = ข้าม (บอกจำนวน) ไม่ใช่ error · 0 คือยอดจริง
- ปรับยอดมีปุ่ม **นับทั้งร้าน** เติมทุกรายการที่ยังใช้อยู่ด้วยยอดปัจจุบัน แก้เฉพาะตัวที่ไม่ตรง ·
  ★ ไม่ทับแถวที่กรอกไว้ ⇒ ไม่ต้องถามยืนยัน
- รับของ: "ซื้อจาก" เป็นค่ากลางของทั้งชุด (ส่วนใหญ่ซื้อที่เดียวกันทั้งรอบ) · รวมยอดเงินบนปุ่ม (เฉพาะคนที่เห็นต้นทุน)
- 🪤 key แถวต้องคงที่ (ไม่ใช่ index) — `NumBox` เก็บ buffer เอง ลบแถวกลางแล้วค่าแถวที่ลบค้างในแถวถัดไป
- 🪤 error ของป๊อปอัพเพิ่มวัตถุดิบแสดง**ในป๊อปอัพ** (D71)
- ลบ `receiveAction`/`adjustAction` ตัวเดี่ยวทิ้ง (ไม่มีผู้เรียกแล้ว) · RPC ตัวเดี่ยวยังอยู่ (ตัวห่อเรียกใช้)
- ✅ **ลง 0080 ครบ 2 DB แล้ว** (`db:audit-grants` ผ่าน) · **เทสเบราว์เซอร์ครบ 61.1-61.4** (siamdist · proof-app):
  เพิ่ม 3 ตัวในครั้งเดียว (รหัส `I-…-1/-2/-3` ไม่ชน) · ชื่อซ้ำของเดิม/กรอกขนาดไม่ตั้งชื่อ → บล็อกพร้อมเลขแถว ·
  รับ 2 ขวด 1,000 บาท → 1,400 ml ต้นทุน 0.7143 · กรอกครึ่งแถว → บล็อก · นับทั้งร้าน 8 แถวเท่าเดิมหมด → ปุ่มล็อก ·
  ลบแถวกลางแล้วค่าแถวอื่นไม่เลื่อน · 🚩 **2 แท็บ**: แถว 1 ล้มที่ DB → **แถว 2 ไม่เข้า** (bar_move ไม่มีแถว · ยอดยัง 0)
- 🔴 **เจอตอนเทส 1 ข้อ (แก้แล้ว)**: ชุดล้มแล้วหน้าจอไม่โหลดข้อมูลใหม่ → คอลัมน์ "ระบบเก็บอยู่" ยังเป็นค่าเก่า
  กดใหม่ก็ล้มซ้ำแบบเดิมไม่รู้จบ → `run()` ในแท็บคลังโหลดข้อมูลใหม่**แม้ล้ม** (แถวที่กรอกอยู่ใน state ของการ์ด ไม่หาย)
  ⇒ พิสูจน์แล้ว: หลังล้ม แถวที่ชนกลายเป็น "เท่าเดิม" เอง ปุ่มลดเป็น "1 รายการ" กดแล้วผ่าน
  🪤 *ตอนออกแบบ "ทั้งชุดหรือไม่เลย" คิดถึงแต่ฝั่ง DB — ลืมว่าผู้ใช้ต้องมีทางเดินต่อหลังล้ม*
- 🟡 ลิงก์ "＋ เพิ่มแถว" ในการ์ดปรับยอดติดกับปุ่มบันทึกบรรทัดเดียวกัน → `block`
- 📝 ข้อมูลเดิมของ siamdist ที่เห็นระหว่างเทส (**ไม่ได้แตะ**): `โซดาทดสอบ` ยอด **−276 ขวด** (ตัดสต็อกตอนขายเกินของที่รับเข้า
  — ยอดติดลบยอมให้เกิดโดยออกแบบ D96 แต่ค่านี้ควรมีคนดู)

### D104 — บาร์: นับสต็อกทั้งร้านแบบแสดงครบ · กรอกเป็นหน่วยซื้อได้ · แก้วัตถุดิบทุกรายการทีเดียว (ไม่มี migration, 2026-09-30)

มาจากคำถามว่ามะนาว/เลม่อนที่คั้นน้ำควรเก็บเป็นลูกหรือ ml → ตอบว่า **ml** (สูตรค็อกเทลใช้ ml · ต้นทุนต่อแก้ว
ตามผลผลิตจริง) แล้วตั้ง "1 หน่วยซื้อ = กี่ ml" ⇒ ต้องนับสต็อกเป็นลูกได้ ผู้ใช้สั่ง 3 ข้อ + เลือก ก ก ก:
- **การ์ดนับสต็อกแสดงวัตถุดิบครบทุกรายการเสมอ** (ตัวที่เลิกใช้โผล่เฉพาะเมื่อยังมียอดค้าง) · **ช่องว่าง = ใช้ค่าในระบบ**
  (ข้าม) · 0 = นับแล้วหมด · ตัด "นับทั้งร้าน"/ตัวเลือกวัตถุดิบรายแถวทิ้ง · ค่าที่กรอกเก็บตาม itemId ไม่ใช่ลำดับ
  ★ ยังเป็นตัวห่อ 0080 ตัวเดิม (ทั้งชุดเข้าหมดหรือไม่เข้าเลย)
- **เลือกหน่วยที่กรอกได้ทีละแถว** (ลูก/ขวด ↔ ml) แปลงด้วย `packSize` · ระบบเก็บหน่วยฐานเสมอ · โชว์ "= 480 ml" ก่อนบันทึก
  🪤 `toBase` ปัด 4 ตำแหน่ง (2.4 × 700 = 1680.0000000000002)
  🚨 เปลี่ยนเหตุผล/ใส่หมายเหตุแต่ไม่กรอกยอด = error (ตั้งใจบันทึกบางอย่าง ข้ามเงียบ = ของหาย)
- **ค่าเตือนเหลือน้อยกรอกเป็นหน่วยซื้อได้** (ข้อ 1 ก) · 🪤 แปลงกลับเป็นหน่วยซื้อตอนแสดงเฉพาะเมื่อหารลงตัว ≤ 2 ตำแหน่ง
  (100 ml ของขวด 700 = 0.142857… ขวด คงเป็น ml) · ตารางหลักเพิ่มคอลัมน์ "เตือนเมื่อเหลือ"
- **โหมด "แก้ไข" ของตารางวัตถุดิบ** แก้ทุกแถวแล้วบันทึกทีเดียว · ส่งเฉพาะแถวที่เปลี่ยน · `updateItemsAction` = upsert คำสั่งเดียว
  🚨 ไม่ส่ง qty/cost (PostgREST SET เฉพาะคอลัมน์ที่ส่ง) · 🚨 upsert บน id ที่ไม่มี = insert เงียบ ๆ → server ตรวจ id ก่อน ·
  ลบป๊อปอัพแก้รายตัว + `saveItemAction` (ไม่ให้มีสองทาง)
- 🚨 **หน่วยที่สูตรใช้ล็อกเมื่อยอด ≠ 0 หรืออยู่ในสูตร** (ข้อ 2 ก) · `unitLockReason()` บอกว่าต้องทำอะไรก่อน · ตรวจซ้ำฝั่ง
  server (หน้าจอเปิดค้างขณะอีกเครื่องรับของเข้า) — เดิมป๊อปอัพแก้หน่วยได้เสมอ = วอดก้า 1,400 ml กลายเป็น 1,400 ขวดเงียบ ๆ
- 🪤 **เจอตอนเทส (แก้แล้ว)**: ชื่อซ้ำฟ้องทั้งแถวที่แก้และแถวที่ไม่ได้แตะ ⇒ **ข้อมูลเก่าที่มีชื่อซ้ำอยู่แล้วจะล็อกโหมดแก้ไขทั้งตารางตลอดไป**
  → ฟ้องเฉพาะแถวที่เปลี่ยนชื่อ (ทั้งจอและ server) · ข้อความ "แถว N" ในการ์ดนับไม่มีเลขแถวให้เทียบ → เพิ่มคอลัมน์ # ·
  ป๊อปอัพเพิ่มวัตถุดิบไม่โชว์ "= … ml" → เพิ่ม · ตัวที่เลิกใช้ยังขึ้นป้าย "ใกล้หมด" ในตาราง (แถบเตือนด้านบนกรองแล้ว) → กรองเหมือนกัน
- ข้อ 3 ก: ขวดเปิดกรอกทศนิยมเอง (2.4 ขวด) ไม่ทำช่องคู่ ขวดเต็ม+ml
- golden **B17** เพิ่มเป็น 44 เทส · ✅ **เทสเบราว์เซอร์แล้ว** (siamdist): 1.5 ขวด → 1,050 ml · 12 ลูก × 40 → 480 ml ·
  เตือน 5 ลูก → 200 ml · 1 ขวด → 700 ml แล้วป้ายใกล้หมดหายเองเมื่อยอด 1,050 · หน่วยล็อกพร้อมเหตุผล แล้วปลดเองเมื่อนับเป็น 0 ·
  ใบมิ้นต์ g → ml ได้ (ยอด 0 ไม่อยู่ในสูตร) · เก็บกวาด: นับ QA 4 ตัวเป็น 0 ในครั้งเดียว + ตั้งเลิกใช้ในโหมดแก้ไขครั้งเดียว

### D105 — แอปขาย: คัดลอกเอกสารเป็นภาพ / แชร์ไป LINE · เลิกเปิดหน้าพิมพ์เอง (ไม่มี migration, 2026-10-10)

ผู้ใช้ขอ: ออกบิลแล้วส่งให้ลูกค้าทาง LINE ได้เลย ไม่ต้องเซฟ PDF ก่อน · ตัดสินแล้ว: **ไม่เปิดหน้าพิมพ์เอง** · **เฉพาะแอปขาย** (บาร์ยังไม่ทำ)
- หน้าต่างเอกสารแสดงเอกสารเป็นแผ่นกระดาษ + แถบบน **พิมพ์ · แชร์ X จาก Y รูป** + แถบต่อหน้า **ช่องติ๊ก · คัดลอกเป็นภาพ · แชร์หน้านี้**
  ทุกชิ้นคลาส `no-print` (ไม่ติดไปบนกระดาษ)
- 🚨 **ภาพถ่ายจาก DOM ชุดเดียวกับที่พิมพ์** (`.a4-container` ของ print.ts) ไม่มีเอกสารเวอร์ชันภาพแยก · 1 ภาพ = 1 `.a4-container`
  (ต้นฉบับ/สำเนา คนละภาพ) · library `html-to-image` (npm · `await import()` บทเรียน D61) · pixelRatio 2
- 🪤 **เมนูแชร์ของมือถือเอารูปออกทีหลังไม่ได้** (ส่งไปกี่ไฟล์ได้กี่ไฟล์) ⇒ เลือกด้วยช่องติ๊กก่อน · ปุ่มบอกจำนวนเสมอ
- 🪤 โค้ดรันในหน้าต่างแอปแต่จับ DOM ของ popup ⇒ clipboard/share/File/URL ต้องเรียกผ่าน `w` ของ popup (ไม่งั้น "Document is not focused")
- 🪤 แชร์ต้องเรียกในจังหวะกด ⇒ **แปลงภาพเตรียมไว้ตั้งแต่เปิดหน้าต่าง** ไม่ใช่ตอนกด · คัดลอกส่ง Promise เข้า `ClipboardItem` (Safari ยอมแบบนี้)
- คัดลอกไม่ได้ ⇒ ดาวน์โหลด .png แทน **พร้อมบอกว่าทำแทน** · แปลงภาพไม่สำเร็จ ⇒ บอกว่ายังพิมพ์ได้ · ปุ่มเทาพร้อมเหตุผล (D83)
- ส่งแต่ไฟล์ ไม่ใส่ title/text (บางแอปบน Android ทิ้งรูปไปส่งแต่ข้อความ)
- สีของแถบปุ่มเป็น hex ใน `VIEWER_HEAD` **โดยตั้งใจ** — หน้าต่างเอกสารอยู่นอกแอป ไม่มี token/ธีม (กติกาเดียวกับ print.ts:
  เอกสารต้องดำบนขาวเสมอ แม้แอปเปิดโหมดมืด) · ไม่ใช่ข้อยกเว้นของกติกา "ห้ามสีดิบใน component"
- 🚫 **ยังไม่ทำกับบิลบาร์/POS หน้าร้าน** (ผู้ใช้เลือก "เอาแค่แอปขายก่อน") — จดไว้ใน NEXT_STEPS
- 🔄 **ผู้ใช้เทสแล้วทัก: ภาพสั้นเกิน** (สูงเท่าเนื้อหา) → แผ่นบนจอ `min-height: 297mm` = ภาพ**สัดส่วน A4 เป๊ะ** (1588×2246 · 1.414) เหมือนกระดาษ ·
  เนื้อหาเกินหน้าเดียวนิดเดียว ย่อด้วย smart scale เดียวกับตอนพิมพ์ (ใส่ zoom ให้ `.a4-container` บนจอด้วย) · เกินมาก = ภาพยาวลงตามเนื้อหา
- smart scale (ย่อให้พอดี A4) ย้ายไปอยู่ใน `@media print` · บนจอ `.a4-container` กว้าง 190mm เท่ากระดาษ ⇒ วัดได้ค่าเดียวกับตอนพิมพ์
- ประโยคบนปุ่ม/เหตุผลปุ่มเทา/ชื่อไฟล์ ตัดสินใน `lib/sales/docImage.ts` (เทส 14) — ย้ายไป `lib/shared/` ใน D106
- 🔴 **ผู้ใช้เทสบนมือถือจริง (Samsung · Chrome) แล้วพัง — build/lint/test และเทสบนคอมผ่านหมด**:
  ค้าง "กำลังเตรียมภาพ 1/1…" ตลอดกาล → คัดลอกไม่ติด แชร์เทาค้าง · เปิดซ้ำหลายรอบ = แท็บพัง "Aw, Snap!"
  สาเหตุ: html-to-image เรียก `requestAnimationFrame` แบบ global = ของ**หน้าต่างแอป** · บนมือถือ popup เป็นแท็บใหม่
  แท็บแอปถูกซ่อน และ**แท็บที่ซ่อนไม่ยิง rAF เลย** · บนคอม popup เป็นหน้าต่างแยก แท็บแอปยังมองเห็น จึงไม่เคยเจอ
  🪤 *โค้ดที่รันในหน้าต่างหนึ่งแต่ทำงานกับอีกหน้าต่าง ต้องถามว่า "หน้าต่างที่โค้ดรันอยู่ ยังมองเห็นอยู่ไหม"*
  → `lib/shared/popupFrames.ts` ยืม rAF ของหน้าต่างเอกสารระหว่างแปลงภาพ (คืนตัวเดิมเป๊ะเมื่อจบ · หน้าต่างปิด = ใช้ของเดิม) เทส 5
  + 🚨 **ห้ามค้างเงียบอีก**: เกิน 45 วิ/หน้า = ล้มเหลวพร้อมบอก (จับเวลาด้วย timer ของหน้าต่างเอกสาร) · หน้าต่างปิด = หยุดงาน
  + เหตุผลปุ่มแชร์เทาเป็น**ตัวหนังสือบนจอ** (มือถือไม่มีการชี้เมาส์ค้าง `title` มองไม่เห็น)
  · กด back แล้วหน้าเอกสารปิด = พฤติกรรมปกติของแท็บที่เปิดด้วย window.open บน Android
- ✅ **ผู้ใช้เทสบนมือถือ Samsung · Chrome หลังแก้แล้ว: คัดลอกภาพและแชร์ได้** (2026-10-10)

### D106 — บาร์: คัดลอกบิลเป็นภาพ / แชร์ · เลิกเปิดหน้าพิมพ์เอง (ไม่มี migration, 2026-10-11)

ต่อจาก D105 (ค้างไว้ใน NEXT_STEPS) · ผู้ใช้เลือก **ไม่เด้งหน้าพิมพ์เอง เหมือนแอปขาย** (ผมเสนอให้คงเด้งเองเพื่อความเร็ว RawBT — ผู้ใช้ไม่เลือก)
- 🚨 **ตัวแสดงเอกสารมีชุดเดียว**: ย้าย `docViewer` จาก `app/(app)/sales/_components` → `lib/shared/docViewer.ts` และ `docImage` → `lib/shared/`
  ต่างกันแค่ 2 อย่างที่ผู้เรียกส่งเข้ามา: `pageSelector` (ขาย `.a4-container` · บาร์ `.rc-page`) และ CSS ของแผ่น `viewerHead(sheetCss, viewport)`
  · `lib/bar/print80View.test.ts` อ่านซอร์สทั้งโปรเจกต์ว่า `.dv-bar {` ถูกนิยามที่เดียว (กันก๊อปไปอีกชุด)
- แผ่นบิลบนจอ `receiptSheetCss(paper)` กว้างเท่าม้วน (80/58 มม.) ขอบข้างเท่าส่วนที่เครื่องพิมพ์ไม่ถึง · ความสูงตามเนื้อหา (ม้วนไม่มีขอบล่าง)
  🚨 อยู่ใน `@media screen` ทั้งก้อน — `receiptCss()` ที่พิมพ์ลงกระดาษไม่ถูกแตะ (เทสล็อก) · body ของ receiptCss กว้างแค่ส่วนที่พิมพ์ได้
  → บนจอคืนความกว้างให้แถบปุ่ม แล้วย้ายไปคุมที่แผ่น
- ภาพละเอียด **3 เท่า** (กระดาษแคบ 302 px) → 906 px · QR พร้อมเพย์ติดมาในภาพคม (ลูกค้าสแกนจากรูปในแอปธนาคารได้)
- หน้าเดียว (บิลบาร์เสมอ) = **ไม่มีช่องติ๊ก** (ติ๊กออกแล้วแชร์ไม่ได้ = กับดักเปล่า ๆ) · ใช้ทั้งขายและบาร์
- `openPrint80` รับ `{ docNo, paper }` เพิ่ม (ชื่อไฟล์ + ขนาดแผ่น) · ผูกแถบหลัง load (เช็ค `readyState` ด้วย — document.write บางเบราว์เซอร์ยิง load ก่อนผูก)
- 🪤 โลโก้จากโฮสต์ที่ไม่เปิด CORS → html-to-image ข้ามรูปนั้น (ภาพไม่มีโลโก้ แต่ไม่ล้ม) · กระดาษที่พิมพ์ไม่กระทบ
- `isolation.test.ts` ของบาร์ยังผ่าน (บาร์ import แค่ `lib/shared` ไม่แตะตารางขาย/ผลิต)
- ✅ เทสเบราว์เซอร์ (จำลองแท็บแอปถูกซ่อน = rAF ไม่ยิง): พิมพ์ซ้ำจากประวัติบิล · ใบแจ้งรายการ + QR จากหน้าขาย · ไม่เด้งพิมพ์เอง · ปุ่มพิมพ์ทำงาน ·
  เอกสารขาย A4 ไม่ถอย (794×1123 · 2 หน้ามีช่องติ๊ก)
- 🟡 เจอระหว่างเทส (ไม่เกี่ยวกับงานนี้): hydration mismatch ลำดับเมนูในแท็บขายของบาร์ → **แก้แล้วใน D107**

### D107 — บาร์: ลำดับเมนูในแท็บขายไม่ตรงกันระหว่างเซิร์ฟเวอร์กับเบราว์เซอร์ (ไม่มี migration, 2026-10-11)

เจอตอนเทส D106 — React ฟ้อง *Hydration failed* ที่ตะแกรงเมนูแท็บขาย (dev ขึ้น "1 Issue")
- 🪤 **วินิจฉัยผิดรอบแรก**: ผมบอกผู้ใช้ว่าเป็นเพราะ `localeCompare(…, "th")` ของ Node กับ Chrome เรียงไทยปนอังกฤษต่างกัน
  — **พิสูจน์แล้วว่าไม่จริง** (ทั้งคู่ให้ผลเดียวกันเป๊ะ) · *อย่าบอกสาเหตุก่อนพิสูจน์ แม้จะฟังสมเหตุสมผล*
- 🔴 **สาเหตุจริง: ตัวเปรียบเทียบใน `sortMenusForGrid()` วนเป็นวง** — คู่ เฉพาะกิจ↔เฉพาะกิจ เทียบด้วยล่าสุด/ชื่อ
  แต่คู่อื่นทั้งหมด (รวม เฉพาะกิจ↔ปกติ) เทียบด้วยเลข `sort` (เฉพาะกิจส่วนใหญ่ไม่มีเลข = 0)
  ⇒ ข้อมูลจริง: เมรัย(0) < Negroni(1) < ค็อกเทลลับ(5) < เมรัย(ตามชื่อ) · ตัวเรียงที่ไม่มีคำตอบเดียว =
  **ผลขึ้นกับเครื่องยนต์ JS** — V8 ของ Node 24 กับ Chrome 152 ให้ลำดับต่างกัน (ทำซ้ำได้ทั้งสองฝั่ง)
  · ผลข้างเคียงที่หนักกว่า hydration: ตะแกรง "ทั้งหมด" **สลับที่เองเมื่อเพิ่มเมนู**
- → **กลุ่มก่อน แล้วค่อยเกณฑ์ในกลุ่ม**: เมนูปกติก่อน (sort → ชื่อ) · เมนูเฉพาะกิจไว้ท้าย (ล่าสุด → ความถี่ → ชื่อ) · ตัดสินสุดท้ายด้วย `menuId`
  🚨 ห้ามกลับไปเทียบข้ามกลุ่มด้วยเกณฑ์ของกลุ่มใดกลุ่มหนึ่ง
- เทสใหม่ 5 ข้อใน golden B9 รวม **สลับลำดับข้อมูลเข้าครบ 5,040 แบบต้องได้ผลเดียว** (ข้อมูลจริงที่พัง) ·
  🚩 **พิสูจน์แล้วว่าเทสจับได้**: รันกับโค้ดเดิม = แดง 4 ข้อ · ของเดิมใน B9 ผ่านโดยไม่แก้ไฟล์เทส
- ผลที่ผู้ใช้เห็น: แท็บ "ทั้งหมด" เมนูเฉพาะกิจย้ายไปอยู่ท้ายเสมอ (เดิมแทรกปนข้างบนแบบไม่แน่นอน) · หน้าหมวดเดี่ยวไม่เปลี่ยน
- ✅ เทสเบราว์เซอร์: HTML จากเซิร์ฟเวอร์กับที่เบราว์เซอร์วาด **ลำดับเดียวกันเป๊ะ** · รีโหลดแล้วไม่มี hydration error ใหม่
- ตรวจจุดอื่นที่เรียงชื่อแล้ว: `MenuTab`/`HistoryCard` ใช้เกณฑ์เดียว (ไม่วน) · `data.ts` 2 ที่เรียงฝั่งเซิร์ฟเวอร์อย่างเดียว — ไม่ต้องแก้

### D108 — บาร์: จัดลำดับเมนูบนหน้าขายเอง ▲▼ แยกกันต่อหน้า (0081, 2026-10-11)

ผู้ใช้ขอ: เอาเมนูที่คนสั่งบ่อยมาไว้บนสุด กดถนัด ไม่ต้องเลื่อนหา · ผู้ใช้เลือก **จัดเองทั้งหมด** (ไม่ให้ระบบเรียงตามยอดขาย —
ตำแหน่งขยับเองทำให้บาร์เทนเดอร์กดผิดตอนชงเร็ว ๆ) และ **แต่ละหน้าตั้งแยกกัน ไม่มีผลต่อกัน**
- ★ `bar_menu.sort` **มีอยู่แล้ว หน้าขายก็เรียงตามมันอยู่แล้ว แต่ไม่มีที่ไหนเขียนเลยสักจุด** (ตระกูล D74/D77/D101)
- ★ **ไม่ต้องมีตารางใหม่**: ลำดับในหมวด = `sort` เดิม (เมนูหนึ่งอยู่ได้หมวดเดียว ⇒ แต่ละหมวดเป็นชุดที่ไม่ทับกัน
  ไม่มีทางกระทบกันอยู่แล้ว) · หน้า "ทั้งหมด" = คอลัมน์ใหม่ `sort_all` (migration **0081**)
  🚨 backfill `sort_all = sort` (ไม่งั้นวันลง migration หน้า "ทั้งหมด" ของทุกเจ้าเรียงใหม่เองทั้งหน้า) · ปิด user trigger ระหว่าง backfill (D50)
- คอลัมน์ตัดสินที่ `orderColumn()` ที่เดียว · `sortMenusForGrid(…, view)` หน้า "ทั้งหมด" ใช้ sortAll · หมวดใช้ sort
- 🔄 **ลำดับว่าง = ต่อท้าย** (เดิมว่าง = 0 = ขึ้นก่อน) ⇒ เมนูใหม่ไม่แทรกบนสุดของที่จัดไว้ · ★ เมนูที่สร้างจากหน้าจอ
  ไม่เคยมีเลขเลย ⇒ ลูกค้าที่ยังไม่เคยจัด (ว่างทุกตัว) ยังเรียงตามชื่อเหมือนเดิม · 🪤 `Infinity − Infinity = NaN` ห้ามลบกันตรง ๆ
- UI: แท็บเมนู → **จัดลำดับบนหน้าขาย** · เลือกหน้า · ⤒ ▲ ▼ · **ยอดขาย 30 วันข้างชื่อ (ช่วยตัดสินใจ ไม่ได้ใช้เรียง)** ·
  แก้ในจอแล้วกด **บันทึกลำดับ** ทีเดียว + เลิกแก้ · 🪤 เปลี่ยนหน้าระหว่างแก้ = ลำดับหายเงียบ ๆ → ช่องเลือกหน้าล็อกจนกว่าจะบันทึก/เลิกแก้
- 🚨 **เมนูเฉพาะกิจจัดไม่ได้** (เรียงตามสั่งล่าสุด D96/D107 · อยู่ท้ายหน้า "ทั้งหมด" เสมอ) — เลือกหมวดนี้แล้ว**บอกเหตุผล** ไม่ใช่ซ่อน
- server `reorderMenusAction` เขียนผ่าน RLS เดิม (`bar.write`) แบบเดียวกับเรียงหมวด D101 · ไม่มี RPC ใหม่ ⇒ ไม่มี definer ใหม่
  · `menuOrderError()` ตรวจ: มีจริง · ไม่ซ้ำ · อยู่หน้านั้นจริง · ไม่ใช่เฉพาะกิจ (ไม่บังคับครบชุด — เมนูใหม่จากอีกเครื่องต่อท้ายเอง)
- ยอดขาย 30 วัน: `fetchAllRows` (🪤 1,000 แถว D82) · ไม่นับบรรทัด/บิลที่ยกเลิก · อ่านไม่ได้ = บอก แต่ยังจัดลำดับได้
- golden **B18** `lib/bar/menuOrder.test.ts` 19 เทส · ✅ ลง DB ครบ 2 ก้อน (สำรองก่อนลง) · `db:audit-grants` ผ่าน
- ✅ เทสเบราว์เซอร์: ⤒ ถั่วทอดขึ้นบนสุด → บันทึก → หน้าขาย "ทั้งหมด" ขึ้นก่อนจริง + server/เบราว์เซอร์ลำดับเดียวกัน ·
  ช่องเลือกหน้าล็อกระหว่างแก้ · หมวดเฉพาะกิจขึ้นเหตุผล · คืนลำดับเดิมของ tenant ทดสอบแล้ว

### D109 — บาร์: จัดการหมวดบันทึกทีเดียว · ลบหมวดถามก่อน · แถวจัดลำดับเมนูชื่อยาว (ไม่มี migration, 2026-10-11)

ผู้ใช้แจ้งหลังใช้ D108 จริงบนมือถือ 3 ข้อ:
- 🐛 **แถวจัดลำดับเมนูชื่อยาวจัดบรรทัดแปลก** — ทั้งแถวเป็น `flex-wrap` ⇒ ชื่อยาวตกลงบรรทัดใหม่ทั้งก้อน ปุ่มค้างบรรทัดบนเปล่า ๆ
  ป้ายหมวด/ยอดขายลอยไปมาตามความยาวชื่อ → ปุ่มเป็นคอลัมน์กว้างคงที่ทางซ้าย · ชื่อกินที่ที่เหลือแล้วตัดบรรทัด**ในคอลัมน์ตัวเอง**
  · หมวด + ยอดขายเป็นบรรทัดเล็กใต้ชื่อ 🪤 *build/lint/test มองไม่เห็นเลย — ข้อมูลทดสอบชื่อสั้นทุกตัว ต้องดูบนจอจริงกับชื่อจริง*
- **จัดการหมวดบันทึกทีเดียว** (ผู้ใช้ขอ + ถามว่ารวมปุ่มบันทึกชื่อเข้าด้วยเหมาะไหม → ผมแนะนำรวม เพราะเป็นงาน "จัดหมวด" ชุดเดียว)
  เดิม ▲▼ บันทึกทุกคลิก (รอระบบทุกครั้ง) + แก้ชื่อมีปุ่มบันทึกรายหมวด → ลำดับ + ชื่อแก้ในจอแล้วกด **บันทึก** ปุ่มเดียว
  · `saveCategoriesAction` **แทน** `reorderCategoriesAction` และสาขาแก้ชื่อใน `saveCategoryAction` (เหลือเพิ่มอย่างเดียว) —
  ทางเดียว ไม่ให้มีสองทาง (D81) · ลบคอมโพเนนต์ `CategoryName` · `categoryEditsError`/`categoryNameUpdates` ใน lib ใช้ทั้งจอและ server
  🪤 **เพิ่ม/ลบหมวดยังทำงานทันทีแล้วโหลดใหม่ ⇒ ที่แก้ค้างจะหายเงียบ ๆ** → ระหว่างยังไม่บันทึก ปุ่มเพิ่ม/ลบกดไม่ได้ + บอกเหตุผลบนจอ
- **ลบหมวดถามยืนยันก่อน** (ผู้ใช้ถาม) — `useConfirm` (ห้าม window.confirm · D96) · ปุ่มแดงเพราะลบจริงเอาคืนไม่ได้ (D97: ความน่ากลัวต้องตรงความเสียหายจริง)
  · หมวดที่ยังมีเมนู: แทนปุ่มด้วยเหตุผล "ลบไม่ได้จนกว่าจะย้ายเมนูออก" ไม่ต้องกดแล้วรอ server ตอบ error
- ✅ เทสเบราว์เซอร์: ชื่อยาวตัดบรรทัดในคอลัมน์ ปุ่มตรงแนว · เลื่อน+เปลี่ยนชื่อแล้วบันทึกครั้งเดียว รีโหลดแล้วอยู่ครบ ·
  เพิ่ม/ลบถูกล็อกระหว่างแก้ · ลบ → กล่องยืนยัน → ยกเลิกแล้วยังอยู่ / ยืนยันแล้วหาย (หมวดทดสอบถูกลบทิ้งแล้ว ลำดับเดิมไม่ขยับ)

### D110 — บาร์: เพิ่มเมนู พิมพ์ค้นวัตถุดิบได้ + ต้นทุนตามสูตร + ราคาแนะนำ (ไม่มี migration, 2026-10-12)

ผู้ใช้ขอ: ตอนเพิ่มเมนูใหม่ (ทั้งหน้าขายและแท็บเมนู & สูตร) เลือกวัตถุดิบด้วยการพิมพ์แล้วขึ้นตัวเลือก (ไล่หาในรายการยาวยาก)
+ ใส่สูตรแล้วคำนวณต้นทุนและเสนอราคาขาย · ผู้ใช้เลือก: **ต้นทุน 30%** · **ตั้ง % ในหน้าเพิ่มเมนูเอง** (เครื่องจำค่าล่าสุด) · **ปัดขึ้นหลัก 10**
- 🚨 **ช่องสูตรเคยมี 2 ชุดที่ก๊อปกันมา** (หน้าขายไม่มีปุ่มลบบรรทัด และไม่โชว์ต้นทุน) → `RecipeEditor` ชุดเดียวใช้ทั้งสองหน้า
  ต้นทุนที่เคยคำนวณสดในคอมโพเนนต์ (`previewCost`) ย้ายไป lib (กติกา: logic เงินอยู่ใน lib)
- ช่องวัตถุดิบเป็น `<datalist>` (พิมพ์แล้วเบราว์เซอร์ขึ้นตัวเลือก ใช้ได้ทั้งคอม/มือถือ ไม่ต้องเขียน combobox เอง) · id จาก `useId()` (D77)
  🚨 `matchItem()` **ไม่เดาจากคำบางส่วน** — "จิน" ตรงหลายขวด เลือกให้เองตัวไหนก็ตัดสต็อกผิดขวดเงียบ ๆ → ไม่ตรง = บอกว่ายังไม่ได้เลือก
  · ข้อความที่พิมพ์เก็บใน `RecipeDraftRow.text` (ยังไม่ตรง = itemId ว่าง แต่ข้อความไม่หาย)
- 🚨 **ราคาหน้าบาร์รวม VAT อยู่แล้ว** (D96/B11) ⇒ % ต้นทุนเทียบ**ยอดก่อน VAT** · ร้านจด VAT: ราคาแนะนำ = ต้นทุน ÷ % × 1.07
  (ลืมข้อนี้ = เมนูทุกตัวของร้านที่จด VAT ได้ % ต้นทุนจริงสูงกว่าเป้า ~7% เงียบ ๆ) · หน้าจอบอกด้วยว่าคิดแบบนี้
- **ปัดขึ้นเสมอ** (ปัดลง = % จริงเกินเป้า) · เทสไล่หลายต้นทุน×VAT ว่าราคาที่ได้ทำให้ % จริงไม่เกินเป้า · ตัดเศษทศนิยมก่อนปัด (60÷30% ต้องได้ 200 ไม่ใช่ 210)
- ราคาแนะนำ**ไม่เขียนทับราคาเอง** — ปุ่ม "ใช้ราคานี้" · โชว์ % ต้นทุนจริงและกำไรที่ราคาที่กรอกอยู่ · วัตถุดิบที่ยังไม่มีต้นทุน = เตือนว่าต่ำกว่าจริง
- ต้นทุนเห็นเฉพาะ `bar.config` (stripCost เดิม) — ไม่มีสิทธิ์ = **บอก**ว่าเห็นเฉพาะผู้มีสิทธิ์ตั้งค่าบาร์ (ไม่ซ่อนเงียบ ๆ)
- โหมดต้นทุนตายตัว (อาหาร) ได้ราคาแนะนำด้วย (`PriceSuggest` ตัวเดียวกัน)
- % เก็บใน localStorage (ค่าสะดวกต่อเครื่อง ไม่ใช่ข้อมูลร้าน · ผู้ใช้เลือก) · ห่อ try/catch · ไม่มี = 30
- golden **B19** `lib/bar/menuPricing.test.ts` 16 เทส
- ✅ เทสเบราว์เซอร์ (tenant จด VAT): จิน 45 ml = 54.00 → แนะนำ 200 · + เวอร์มุท 30 ml = 78.00 → 280 กด "ใช้ราคานี้" → ราคา 280 ต้นทุน 29.8% ·
  ตั้ง 25% → 340 และหน้าขายจำ 25% (54 → 240) · พิมพ์ "จิน" เฉย ๆ = ขึ้น "ยังไม่ได้เลือก" · ไม่ได้บันทึกเมนูทดสอบ · คืนค่า % ของเครื่องแล้ว
  ⚠️ **ป๊อปอัพตัวเลือกของ datalist เป็น UI ของเบราว์เซอร์ เครื่องมือเทสกดไม่ได้** — ทดสอบด้วยการใส่ข้อความเต็มแทน ผู้ใช้ต้องลองกดเลือกจริงบนมือถือ

### D111 — บาร์: ชิป "ดูเฉพาะเมนูของ…" นับครบ 3 ทาง · แสดง/แก้ "สร้างให้" · ค้นเมนูด้วยชื่อลูกค้า (ไม่มี migration, 2026-10-12)

มาจากคำถามผู้ใช้ 2 ข้อ: *"ติ๊กเฉพาะของ [ลูกค้า] แล้วมีผลอะไร ตอนแรกเข้าใจว่าเมนูที่เพิ่มใหม่จะเป็นของลูกค้าคนนั้น"* และ *"ดูตรงไหนว่าเมนูสร้างให้ใคร"*
- 🪤 **ป้าย "เฉพาะของ X" ทำให้ผู้ใช้เข้าใจผิดจริง** ว่าติ๊กแล้วเมนูใหม่จะเป็นของ X — ที่จริงเป็นแค่ตัวกรองการแสดงผล
  (เมนูใหม่จากบิลที่ผูกลูกค้า = `createdFor` ของคนนั้นเสมอ ไม่เกี่ยวกับชิป) → ป้าย **"ดูเฉพาะเมนูของ X"** + บรรทัดอธิบายว่านับจากอะไร
  และ "แค่กรองการแสดงผล ลูกค้าคนอื่นยังสั่งได้" · ประโยคอยู่ใน `lib/bar/menuFilter.ts` (`customerChipLabel` / `CUSTOMER_CHIP_HINT`)
- 🔴 **ชิปทำงานไม่ครบ** — `customerMenuIds()` ออกแบบไว้ 3 ทาง (สร้างให้ · ของโปรด · เคยสั่ง) แต่หน้าขายส่งแค่ menus + **บิลที่ยังเปิดอยู่**
  ⇒ **ของโปรดที่ปักหมุดในแท็บลูกค้าไม่เคยมีผลกับชิปเลย** · บิลที่ปิดแล้วไม่นับ (ตระกูล D74/D77: lib พร้อม หน้าจอไม่ส่งข้อมูลเข้า)
  → `getCustomerMenusAction` (ของโปรด + เคยสั่งจากบิลที่ปิดแล้ว **ย้อนหลัง 90 วัน** ผู้ใช้เลือก) · ไม่นับบิล/บรรทัดที่ยกเลิก
  ★ โหลด**เฉพาะตอนเปิดชิป และเฉพาะลูกค้าคนนั้น** (ไม่ใส่ bootstrap — ประวัติทุกลูกค้า 90 วันหนักเกิน) · `.in()` ทีละ 150 บิล (URL ยาว)
  · อ่านไม่ได้ = บอกบนจอ ชิปยังใช้ข้อมูลที่มี (D89)
- 🔴 **"สร้างให้ใคร" ไม่มีหน้าจอไหนแสดงเลย** และแก้ไม่ได้ (หน้าแก้เมนูส่งค่าเดิมกลับไปเงียบ ๆ) — สร้างจากบิลผิดคน = ติดถาวร
  → ตารางเมนูขึ้น "สร้างให้: ชื่อ" (รูปแบบชื่อ D97) · หน้าแก้เมนูมีดร็อปดาวน์ **สร้างให้ลูกค้า** + "— ไม่ได้สร้างให้ใคร —" + คำอธิบายว่าเป็นแค่ป้ายบอกที่มา
  · FK `on delete set null` ⇒ ลบลูกค้าแล้วไม่มีค่าค้าง
- ช่องค้นในแท็บเมนูค้นด้วยชื่อลูกค้าที่สร้างให้ได้ (`searchMenus(…, extra)`)
- golden B9 +5 เทส · ✅ เทสเบราว์เซอร์: ตาราง "สร้างให้" 3 เมนู · ค้น "เมย์" ได้ 2 เมนู · เปลี่ยน "เทส" เป็นโอ๊ตแล้วบันทึก → ตาราง/ค้นหาตาม → คืนเป็นเมย์แล้ว ·
  ชิปของเมย์ (โหมดบูธ ไม่เขียนข้อมูล): เดิมได้ 2 เมนู → ตอนนี้ได้ **จินทดสอบ (ขวด)** เพิ่มจากบิลที่ปิดแล้ว 13 ก.ย. · คืนค่าโหมดบูธของเครื่องแล้ว

### D112 — บาร์: มือถือเลือกเมนูไม่บัง · แก้ส่วนลด/แถมหลังส่งเข้าบิล · เปลี่ยนลูกค้าของบิลที่ยังเปิด (0082, 2026-10-14)

ผู้ใช้แจ้ง/ถาม 3 ข้อ (ใช้บนมือถือจริง):
- 🐛 **แตะเมนูแล้วแผงถาดเด้งขึ้นบังเมนู** ต้องกดย่อลงทุกครั้งก่อนเลือกตัวถัดไป — `addToCart` สั่ง `setSheet(true)` ทุกครั้ง
  → ไม่เปิดแผงเอง · ผู้ใช้เลือก: **ตัวเลขบนการ์ด** (วงกลม "3" + กรอบสี) + **แถบล่างกะพริบ "+ ชื่อเมนู"** ครู่หนึ่ง
  ★ คงจังหวะ "ส่งเข้าบิล" ในแผงตามเดิม (D96 — ตรวจก่อนของถูกตัดสต็อก) · จอกว้างไม่เปลี่ยน (แผงเห็นตลอดอยู่แล้ว)
  🐛 เจอตอนเทส (แก้แล้ว): สีกะพริบรอบแรก `bg-brand-soft` **โปร่ง** → การ์ดเมนูข้างหลังทะลุแถบ ⇒ พื้นทึบเสมอ กะพริบด้วยกรอบ ·
  ข้อความ 3 ก้อนบีบกันจนตัดบรรทัดทุกก้อน ⇒ ระหว่างกะพริบชื่อเมนูแทนที่ชื่อบิล + truncate
- **แก้ส่วนลด (บาท/%) / แถม ของรายการที่ส่งเข้าบิลแล้ว** — เดิมทำได้อย่างเดียวคือยกเลิก · ผู้ใช้เลือก **ทุกคนที่ขายได้** (`bar.write`)
  🚨 ทำเป็น RPC `fn_bar_edit_line` ไม่ใช่ update ตรง — RLS เขียนได้อยู่แล้ว แต่ "แถม = ยอด 0" (0066) กับ "เฉพาะบิลที่เปิด" ต้องจริงใน DB
  ★ SQL ไม่คิด amount (สูตรที่ `lineAmount`) แค่ปฏิเสธค่าที่ขัด: แถมแต่ยอด ≠ 0 · ยอดไม่ตรงราคาเต็ม−ส่วนลด · ติดลบ/เกินราคาเต็ม
  ★ server คิดยอดจาก qty/ราคา **ใน DB** ไม่เชื่อจอ (`resolveLine` + `lineAmount` ตัวเดียวกับตอนส่ง) · ยอดบิลคิดใหม่จากแถวจริง (แพตเทิร์น void_line)
  · **ไม่แตะสต็อก** (ตัดไปแล้วตอนส่ง) · ต้นทุนของแถมยังนับ · audit trigger เดิมจดทุกครั้ง
- **เปลี่ยนลูกค้า/ชื่อบิล** ของบิลที่ยังเปิด — เดิมเปลี่ยนไม่ได้เลย · ผู้ใช้เลือก **เฉพาะบิลที่ยังเปิด** (บิลที่ปิดอาจออกใบเสร็จใส่ชื่อเดิมไปแล้ว)
  RPC `fn_bar_set_sale_customer` · ลูกค้าไม่มีจริง = error ไทย · เอาลูกค้าออกได้ · สลับบิลแล้วฟอร์มปิดเอง (กันแก้ผิดบิล)
- คอมโพเนนต์ใหม่แยกไฟล์ `BilledLines.tsx` (PosTab ~1,500 บรรทัดแล้ว)
- ⚠️ ลง DB: `db:push:all` ล้มเพราะ**เน็ตไม่มี IPv6** (direct DB ของ Supabase เป็น IPv6 อย่างเดียว · IPv4 ใช้ได้) — ไม่มีอะไรถูกลง ·
  ผู้ใช้ลงเองแล้ว · ยืนยันด้วย `db:audit-grants` (definer +2 ทั้ง 2 ก้อน · ผ่าน)
- 🪤 **เจอระเบิดเวลาในเทสเก่า**: `excise-month-close.test.ts` ฮาร์ดโค้ด "2026-09"/"2026-10" ขณะที่ `fn_cancel_order` ลงแถวคืนด้วย `current_date`
  → ผ่านตลอด ก.ย. พอขึ้น ต.ค. แถวคืนทุกใบไปตก NEXT ได้ 4 คู่แทน 1 · **ระบบไม่ได้พัง เทสผูกกับวันที่รัน** → คิดเดือนจากวันนี้ (UTC)
  🪤 *เทสที่ฮาร์ดโค้ดวันที่ขณะที่โค้ดใช้วันปัจจุบัน = เทสที่ผ่านจนถึงวันที่ปฏิทินเปลี่ยนเดือน*
- `tokens.test.ts` เพิ่ม `inset` (`ring-inset` เป็นคำของ Tailwind ไม่ใช่สี — false positive)
- test **1659** + `test:tenant` **350** (bar +5) · ✅ เทสเบราว์เซอร์: มือถือ 375px ไม่เด้ง/ตัวเลข/กะพริบ · ลด 10 → 250 · แถม → 0 · คืนเป็น 260 ·
  เปลี่ยนเป็น "โต๊ะทดสอบ"/เมย์ → ชิปบิล+ลิงก์+ตัวกรองเมนูตาม · คืนค่าเดิมแล้ว · ถาดทดสอบลบแล้ว

## ค้างต้องถามผู้ใช้ (ยังไม่ตัดสิน — MIGRATION_PLAN sec 11)
- ~~อีเมล login (ข้อ 9)~~ → **ตัดสินแล้ว (D9)**: username-based `<username>@insep.local`
- ~~ไฟล์ wh3 (50ทวิ)~~ → **ผู้ใช้ยืนยันว่าเป็นเทมเพลตเปล่า** — อัปโหลดด้วย `--include-wh3` เป็น `wht/wh3_template.pdf`
  · Phase 3 ต้อง verify pixel-diff กับ 50ทวิ จากระบบเดิมอีกครั้ง (ถ้าเป็นไฟล์กรอกแล้วจะเห็นตอนนั้น)

### D113 — บัญชี: ช่องราคาช่องเดียว เลือก รวม/ไม่รวม VAT ที่ปุ่มอย่างเดียว (ไม่มี migration, 2026-10-17)

- **ที่มา**: ผู้ใช้ทักว่าฟอร์มรายการมีช่อง *รวม VAT* + ช่อง *ไม่รวม VAT* + ปุ่มเลือกโหมด (D98) = ซ้ำซ้อน
- **ทำ**: เหลือช่องราคาช่องเดียว หัวช่องบอกความหมายตามปุ่ม (`unitPriceHeader`) · ทั้ง EntryTab และ EditBillModal (ใช้ `makeItemHandlers` ตัวเดียวกัน)
- 🚨 **ไม่แตะสูตรเงิน**: `entryCalc` อ่านแค่คอลัมน์ของโหมดที่มีผล (`unitPriceOf`) อยู่แล้ว · state/DB ยังเก็บครบทั้ง `ex_vat`/`in_vat` (ประวัติราคา/เช็คราคาอ่านทั้งคู่) · คอลัมน์ที่ไม่ได้พิมพ์เติมด้วย `inVatFromExVat`/`exVatFromInVat` ตัวเดิม (`priceFromInput`) ⇒ ยอดเท่ากับตอนมี 2 ช่องแล้วพิมพ์ช่องเดียวกันเป๊ะ · golden A3/A4/A21 เดิมผ่านโดยไม่แก้ไฟล์เทส
- **สลับปุ่ม = ตัวเลขในช่องคงเดิม เปลี่ยนแค่ความหมาย** (ผู้ใช้เลือก) → `reinterpretPrice` · ส่วนลดบาทคิดใหม่ทุกแถวเหมือนเดิม
- 🪤 ช่องแสดงตาม **โหมดที่ผู้ใช้เลือก** (`vatMode`) ไม่ใช่โหมดที่มีผล (`effVatMode`) — ไม่งั้นเอาติ๊ก VAT ออกแล้วตัวเลขบนจอเปลี่ยนเองโดยไม่ได้แตะ
- เลิก "พิมพ์ช่องไหน = สลับโหมดเอง" (มีช่องเดียวแล้ว) · แก้ประโยค `itemsHintText`/`vatModeWarn` ให้ตรงกับหน้าจอใหม่
- golden A21 (D113) 4 เทส · ชุดเทส `docs/TESTING.md` ส่วนที่ 71

### D114 — บัญชี: ค่าที่ล้าง/คงไว้หลังบันทึก + วันที่ใบกำกับตามเลขที่ใบกำกับ (ไม่มี migration, 2026-10-18)

- **ที่มา**: ผู้ใช้ถามว่าหลังบันทึก ค่าไหนล้าง/คงไว้ แล้วเหมาะไหม · ไล่แล้วพบว่า `resetItems()` ล้างเฉพาะรายการ/เลขใบกำกับ/VAT แต่ปล่อยค่าที่ติดไปบิลถัดไปแล้วผิดเงียบ ๆ
- 🚨 **ล้างเพิ่ม**: ตั้งค้าง (AP/AR) + วันครบกำหนด · แบ่งงวด + ตารางงวด (บิลจ่ายสดกลายเป็นหนี้ค้าง → cash basis ข้าม → ยอดเงินสดไม่ขยับ) · หัก ณ ที่จ่าย + อัตรา (ไหลเข้า ภงด.3/53 · เดิมติ๊ก VAT ถูกล้างแต่ WHT ไม่ถูกล้าง) · วันที่ใบกำกับ (เดิมล้างเลขแต่ค้างวันที่)
- **คงไว้ (ผู้ใช้เห็นด้วย)**: ประเภท · หมวด · บัญชี · คู่ค้า/สาขา · กิจการ · วันที่รายการ · **ปุ่ม รวม/ไม่รวม VAT** (เดิมกลับเป็น ex ทุกใบ — เลือกผิด = ยอดต่าง 7% เห็นบนจอทันที)
- **วันที่รายการค้างข้ามวัน**: ร่างเก็บ `savedOn` · เปิดฟอร์มวันอื่นและไม่มีบิลค้างกรอก → กลับเป็นวันนี้ · มีบิลค้าง → คง (อาจตั้งใจลงย้อนหลัง) · `shouldRefreshDraftDate()`
- **วันที่ใบกำกับอัตโนมัติ (ผู้ใช้สั่ง · คล้ายติ๊ก VAT)**: กรอกเลขขณะวันที่ว่าง → วันที่รายการ · ลบเลขจนว่าง → วันที่ว่าง · มีวันที่อยู่แล้วไม่เขียนทับ · แก้วันที่รายการแล้ววันที่ใบกำกับเดินตามเฉพาะตอนยังเท่าวันที่รายการเดิม · ใช้ทั้งฟอร์มบันทึกและฟอร์มแก้บิล
- กติกาอยู่ `lib/accounting/entryForm.ts` + เทส 6 ข้อ · ไม่แตะสูตรเงิน · ชุดเทส `docs/TESTING.md` ส่วนที่ 72

### D115 — บาร์: แดชบอร์ดตารางรายวัน + ห้ามปิดบิลเข้าวันที่ลงบัญชีแล้ว (0083, 2026-10-18)

- **ที่มา**: ผู้ใช้ขอรีวิวแดชบอร์ดบาร์ และบอกว่า "งง" กับการลงบัญชียอดขายรายวัน
- 🔴 **บั๊ก (0083)**: ปุ่มลงบัญชีตั้งวันเริ่มเป็นวันนี้ ⇒ กดตอนร้านยังเปิด แล้วปิดบิลต่อ → บิลได้ business_date ที่ลงแล้ว → `fn_bar_post_day` ไม่หยิบอีก (กันลงซ้ำ) + แถบวันค้างข้าม = **ยอดขาย+VAT หายจากบัญชีและ ภพ.30 เงียบ ๆ** · ยกเลิก/แก้รายการมีด่านนี้ตั้งแต่ 0065 ขาดแค่ `fn_bar_close_sale` (quick_sale เรียกตัวนี้ ได้ด่านไปด้วย) · ยกฟังก์ชันจาก 0069 ด้วยสคริปต์ + diff เหลือแค่บล็อกด่าน · `create or replace` คงสิทธิ์ (D99)
- **ความงง**: กล่อง "แยกตามวิธีรับเงิน" ในการ์ดลงบัญชีเป็นยอด**ทั้งช่วง** ไม่ใช่ของวันที่จะลง · ช่องวันที่ตัวเลขเปลี่ยนสดแต่ข้อมูลเป็นของช่วงเดิมจนกด ดูยอด (ขยายช่วงแล้วยอดขาดเงียบ ๆ)
- **รื้อ**: ตารางรายวัน 1 แถว/วันขาย (บิล · ยอด · แยกวิธีรับเงินของวันนั้น · กำไร · ปุ่มลง/ถอน) แทนช่องเลือกวัน · แถบวันค้างขึ้นบนสุด · ปุ่มช่วงสำเร็จรูป + โหลดเองเมื่อเปลี่ยนช่วง · ตัวเลขโชว์เฉพาะเมื่อข้อมูลเป็นของช่วงที่เห็น (`loadedKey` · D81) · KPI 4 ช่อง + ▲▼ เทียบช่วงก่อนยาวเท่ากัน (ช่วงก่อนเป็น 0 = ไม่แสดง ไม่ใช่ +100%) · เมนูขายดีเรียง จำนวน/ยอด/กำไร
- 🚨 "วันนี้" = **วันขายปัจจุบันตามรอบ** (`businessDate`) ไม่ใช่วันปฏิทิน · ลงบัญชีวันขายปัจจุบันต้องถามยืนยันก่อน (`postConfirmText` · บอกจำนวนบิลเปิด)
- **ไม่ทำในรอบนี้ (4.6)**: บัญชีแยกต่อวิธีรับเงิน — ตอนนี้ทุกวิธีลงบัญชีเดียวกัน (`bar_revenue_account`) · ในแอป QR กับ โอนเงิน ทำงานเหมือนกันทุกอย่าง (ขึ้น QR พร้อมเพย์ทั้งคู่) ต่างแค่ป้าย · รอผู้ใช้ตัดสิน
- `lib/bar/dashDays.ts` golden **B20** · ชุดเทส `docs/TESTING.md` ส่วนที่ 73 + `tests/tenant/bar-rpc.test.ts` ข้อ D115

### D116 — บาร์: ปุ่มรับเงินเหลือ เงินสด · โอน/QR + บัญชีเงินสดแยก (0084, 2026-10-18)

- **ที่มา**: ผู้ใช้ถามว่า QR กับโอนเงินต่างกันยังไง · ตอบข้อ 4.6 ของ D115 ว่า **เงินสดเก็บหมุนในร้าน** และ **ไม่รับบัตร**
- ในแอป "โอนเงิน" กับ "QR" ทำงานเหมือนกันทุกอย่าง (ขึ้น QR พร้อมเพย์ทั้งคู่ · ลงบัญชีเดียว) ต่างแค่ป้าย ⇒ รวมเป็น **โอน/QR** · ตัด **บัตรเครดิต** · `lib/bar/payMethods.ts` แหล่งเดียว
- 🚨 บิลเก่าคงป้ายเดิม ไม่แก้ย้อนหลัง · ทุกป้ายที่ไม่ใช่เงินสดลงบัญชีหลักเหมือนเดิม
- **บัญชีเงินสดแยก (0084)**: kind ใหม่ `bar_cash_account` (CHECK whitelist ยกจาก 0070 ครบ + นับวงเล็บก่อนเขียนไฟล์) · `fn_bar_post_day` เลือกบัญชีต่อวิธี: เงินสด + ตั้งไว้ → บัญชีเงินสด · นอกนั้น → `p_account` · **ไม่ตั้ง = พฤติกรรมเดิมทุกตัวอักษร** · signature เดิม (create or replace คงสิทธิ์ · D99) · ยกฟังก์ชันด้วยสคริปต์ + diff (D79) · ฐาน/VAT ไม่ขยับ
- 🚨 บัญชีเงินสดต้องถูกนับเข้าระบบภาษี ไม่งั้นยอดเงินสดหายจาก ภพ.30 (กติกา D93) → `TaxAccountWarn` เตือนทั้ง 2 ช่อง
- แดชบอร์ดบอกล่วงหน้าว่าแต่ละวิธีลงบัญชีไหน (`accountForMethod` — เทสอ่าน SQL มาเทียบคำว่าเงินสด + kind)
- golden **B21** · ชุดเทส `docs/TESTING.md` ส่วนที่ 74 + `tests/tenant/bar-rpc.test.ts` ข้อ D116

### D117 — บัญชี: Enter เพิ่มรายการ + คอลัมน์เสริมแสดงตลอด (ไม่มี migration, 2026-10-20)

- **ที่มา**: ผู้ใช้ขอให้กด Enter ระหว่างกรอกรายการสินค้าแล้วเพิ่มรายการได้ (Ctrl+Enter = บันทึกเหมือนเดิม) และเลิกซ่อนคอลัมน์เสริม
- เดิมมี Enter = เพิ่มแถวอยู่แล้ว แต่ **ยกเว้นช่องที่มี datalist** (ชื่อรายการ/หมวด/งาน) และ select วัตถุดิบ ⇒ กด Enter ในช่องชื่อ (ช่องที่คนกดบ่อยสุด) ไม่ทำอะไรเลย · และเพิ่มแถวแล้ว **เคอร์เซอร์ค้างแถวเดิม**
- → ทุก input/select ใน `[data-item-row]` · เพิ่มแล้วโฟกัสช่องชื่อของแถวใหม่ (ตาราง/การ์ดมือถือ render คู่กัน เลือกตัวที่มองเห็น) · Shift/IME/นอกแถว ไม่เพิ่ม · `isAddRowKey()` ใน `lib/accounting/entryForm.ts` + เทส
- 🪤 Enter ตอนเลือกชื่อจาก datalist บางเบราว์เซอร์ = เลือก + เพิ่มแถว — ยอมรับ (ค่าที่เลือกไม่หาย · แถวว่างไม่ถูกบันทึก)
- 🚨 คำกำกับคีย์ลัดย้ายออกจาก `itemsHintText()` เพราะฟอร์มแก้บิลใช้ข้อความเดียวกันแต่ **ไม่มีคีย์ลัดนี้** (เดิมบอกผู้ใช้ผิด) → `ITEM_KEYS_HINT` แสดงเฉพาะฟอร์มบันทึก + เทสล็อก
- คอลัมน์ หมวดหมู่/งาน/ลด %/ลด บาท แสดงตลอด ตัดปุ่มซ่อน (ฟอร์มแก้บิลแสดงตลอดอยู่แล้วตั้งแต่ D77)
- ชุดเทส `docs/TESTING.md` ส่วนที่ 75

### D118 — grant ตารางแบบเขียนเอง: Supabase เลิกแจก grant ให้ตารางใหม่ (0085, 2026-10-21)

- **ที่มา**: เมล Supabase (2026-09-23 + "Final notice" 2026-10-20 · github.com/orgs/supabase/discussions/45329) — ตั้งแต่ **2026-10-30** ตาราง/วิว/sequence ที่สร้างใหม่ใน `public` ไม่ได้ grant ให้ `anon`/`authenticated`/`service_role` อัตโนมัติ · project ใหม่เลิกแจกไปก่อนแล้ว (ตั้งแต่ราว 30 พ.ค. 2026) · ตารางเดิมไม่กระทบ · ฟังก์ชันไม่เปลี่ยน
- 🔴 migration 0001-0084 **ไม่มี grant ตารางเลยสักบรรทัด** (62 `create table` พึ่ง default) ⇒ (1) ตารางใหม่ที่ลืม grant = permission denied ทุก DB โดย build/lint/test ผ่านหมด (2) **เปิด DB ก้อนใหม่ให้ลูกค้าแล้วรัน migration = ทุกตารางเข้าไม่ได้ แอปใช้ไม่ได้ทั้งระบบ**
- **0085**: grant ทีละตาราง (ไม่ใช่ `on all tables`) ตามกลุ่มใน `lib/shared/tableGrants.ts`
  - ตารางแอป 56 ตัว (`TENANT_TABLES` + `tenants`) → select/insert/update/delete ให้ authenticated + service_role
  - ตารางแพลตฟอร์ม 4 ตัว (D54/D59) → service_role เท่านั้น 🚨 grant เหมาทั้ง schema = ราคาลูกค้าแต่ละเจ้ารั่ว (เหลือ RLS ชั้นเดียว)
  - sequence ของ bigserial 24 ตัว → usage, select (ขาด = insert ล้ม) · identity ไม่ต้อง
  - **anon ไม่ได้ตารางไหนเลย** — ไล่โค้ดแล้ว คนยังไม่ล็อกอินใช้แค่วิว `tenant_branding` (definer view · grant ไว้ใน 0030) · cron ใช้ service role
  - ★ บน DB เดิมไฟล์นี้ไม่เปลี่ยนสิทธิ์อะไร (มีจาก default อยู่แล้ว) · grant ที่ anon ค้างจาก default บน DB เดิม **จงใจไม่ถอน** (RLS กันอยู่ · ไม่แตะระบบที่ใช้งานจริง) ⇒ DB ใหม่แน่นกว่า DB เดิมเรื่อง anon โดยตั้งใจ
- **กันลืม 2 ชั้น** (แพตเทิร์น D99): `lib/shared/tableGrantsSql.test.ts` อ่านไฟล์ SQL — ตารางที่มีอยู่ต้องถูกจัดกลุ่ม · ตารางใหม่หลัง 0085 ต้อง grant **ในไฟล์เดียวกับ create** · sequence ครบ · ห้าม grant ตารางแพลตฟอร์มให้ anon/authenticated · ห้าม `on all tables` · ห้าม grant ให้ anon (พิสูจน์แล้วว่าแดงเมื่อลบ grant ออก) + `fn_audit_table_grants()` (invoker · ปิดจาก anon/authenticated ในไฟล์เดียวกัน) ถาม pg_class จริง → `npm run db:audit-grants` + `tests/tenant/table-grants.test.ts` ตรวจ RLS เปิดทุกตารางด้วย (grant เปิดประตูแล้ว RLS ปิด = ทุกคนอ่านได้ทุกแถว)
- 🪤 **identity ไม่ใช่ serial**: `payroll_items.id` เป็น `generated always as identity` — Postgres ไม่ตรวจสิทธิ์ sequence ของ identity ตอน insert ⇒ ไม่ต้อง grant · แต่ตัวตรวจ DB รอบแรกนับรวมแล้วจะฟ้องผิดบน DB ก้อนใหม่ (DB เดิมผ่านเพราะได้ grant จาก default — เจอจากเลข `sequence 27` ที่ไม่ตรงกับ 24 ที่นับไว้) → `IDENTITY_APP_TABLES` + เทสอ่านไฟล์ SQL เทียบรายชื่อ
- ⏳ **ยังต้องพิสูจน์บน Supabase project ใหม่จริง 1 รอบ** ก่อนรับลูกค้าที่เปิด DB ก้อนใหม่ (ไฟล์ SQL + DB เดิมพิสูจน์ไม่ได้ว่า project ใหม่ไม่มีค่าตั้งต้นอื่นที่ต่าง)
- ชุดเทส `docs/TESTING.md` ส่วนที่ 76

### D119 — สำรองจ่าย: จ่ายเงินตัวเองแทนกิจการอื่นไปก่อน แล้วค่อยเบิกคืน (0086, 2026-10-22)

- **ที่มา**: ลูกค้ารายใหม่ (PAT&AIM — บริษัท + กิจการส่วนตัว 8 ก้อนในระบบเดียว) ใช้ประเภท `สำรองจ่าย` ในแอป GAS เดิม แต่ proof ไม่มี (CHECK ปฏิเสธ) · ผู้ใช้ขอให้ทำก่อนย้ายข้อมูล เพราะ *"เหมาะกับผู้ประกอบการคนเดียวที่บางทีใช้เงินส่วนตัวออกให้บริษัทไปก่อน"*
- 🎯 **ความหมายที่ผู้ใช้กำหนด (ต่างจากแอปเดิม)**: *"เงินออกจากบัญชีผม **ยังไม่ถือว่าบริษัทรู้ข้อมูลนี้** อาจข้ามเดือน ผมค่อยเอาบิลมาเคลีย บริษัทถึงโอนเงินให้ผม แล้วเอาไปลงรายจ่ายต่อ"* ⇒ ผมเสนอรอบแรกให้ลงค่าใช้จ่าย/ภาษีซื้อของบริษัททันที **ผู้ใช้แก้** — บริษัทรับรู้ตอนจ่ายจริงเท่านั้น
- **โฟลว์**: (1) บิล type `สำรองจ่าย` อยู่ใน**กิจการของคนจ่าย** + `advance_for_entity` = กิจการที่ซื้อให้ · เงินออกจากบัญชีคนจ่ายทันที · ไม่เข้าค่าใช้จ่าย/ภาษีของใคร (2) `fn_clear_advances` = บริษัทโอนคืน → **บิลรายจ่ายของบริษัทลงวันที่เคลีย** (ภาษีซื้อเข้า ภพ.30 เดือนนั้น · วันที่ใบกำกับคงตามใบจริง) 1 ใบต่อบิล + **รับคืนเข้าบัญชีคนจ่าย** 1 รายการ · ทุกแถวผูกด้วย `advance_clear_id`
- ★ **ไม่แตะสูตรเลย** — ไล่แล้วทุกรายงาน (ภพ.30 · ภงด. · แดชบอร์ด · cron เตือนภาษี) เลือกแถวด้วย `type === 'รายรับ'/'รายจ่าย'` ตรง ๆ ⇒ ประเภทใหม่ไม่หลุดเข้าไปเอง · golden A1-A21 ผ่านโดยไม่แก้ไฟล์เทส · แก้แค่ ledger (`cashDirection()` จุดเดียว ใช้ทั้งยอดคงเหลือและ statement)
- 🚨 **ไม่ใช้ `ap_ar_status`** — ledger ข้ามแถวที่มีค่านี้เสมอ ⇒ ยอดเงินบัญชีคนจ่ายจะไม่ลดทั้งที่เงินออกไปแล้วจริง
- ★ **"บริษัทยังไม่รู้" ได้มาฟรีจาก RLS** — บิลอยู่ใน entity ของคนจ่าย ผู้ใช้ที่ถูกจำกัดให้เห็นแค่บริษัท (`allowed_entity_ids`) จึงไม่เห็นจนกว่าจะเคลีย (เทสใน `test:tenant` ทั้ง 2 ทิศ)
- 🪤 **ด่าน VAT ของ 0036 ต้องดูกิจการที่ซื้อให้** — ใบกำกับออกในนามบริษัท ถ้ายังดู `entity_id`: เงินส่วนตัว (ไม่จด VAT) สำรองจ่ายบิลที่มี VAT ไม่ได้เลย และกลับกันจะบันทึก VAT ให้กิจการที่ไม่จดได้ · UI ฟอร์มบันทึกก็ตัดสินช่อง VAT จากกิจการที่ซื้อให้
- 🚨 **trigger `advance_guard` กันสถานะครึ่ง ๆ กลาง ๆ จากทุกทางเข้า** (แก้บิล · ยกเลิกบิล · ยิง API ตรง): ยกเลิกบิลบริษัทใบเดียวไม่ได้ (= บัญชีส่วนตัวได้เงินคืนฟรี) · แก้/ยกเลิกสำรองจ่ายที่เคลียแล้วไม่ได้ · แก้รายการรับคืนไม่ได้ · สร้างรายการรับคืนเองไม่ได้ · เปลี่ยนประเภทไป/กลับไม่ได้ ⇒ ต้องใช้ปุ่มในแท็บลูกหนี้-เจ้าหนี้ (RPC ตั้งธง `app.advance_rpc` ใน transaction ของตัวเอง) · ★ **ยกเว้น service role / ไม่มี JWT** ไม่งั้น `restore:tenant` และสคริปต์ย้ายข้อมูลใช้ไม่ได้ (เทสไว้)
- **คำตอบของผู้ใช้ 4 ข้อ**: (1) ใบกำกับเก่ากว่า 6 เดือนนับจากเดือนที่ออก (ม.82/3) → **เตือนเหลือง ไม่บล็อก** · (2) บริษัทไม่คืนเงิน → **ตัดเป็นค่าใช้จ่ายส่วนตัว** (`fn_advance_to_personal` · VAT รวมเป็นต้นทุนเพราะใบออกในนามบริษัท · เงินที่จ่ายจริงเท่าเดิม · ทำแล้วกลับไม่ได้ แต่แก้/ยกเลิกบิลได้) · (3) **เคลียทีละบิลเต็มจำนวน** ไม่มีเบิกบางส่วน · (4) คนจ่ายเป็นกิจการอื่นที่ไม่ใช่ส่วนตัว — ผู้ใช้บอกไม่ควรเกิดแต่รองรับไว้ไม่ผิด ⇒ ระบบดูแค่ว่าเป็นคนละกิจการ · ❌ ทางปิดที่ 3 "ได้เงินคืนจากคู่ค้า" ผู้ใช้ไม่เอา
- **เคลียหลายใบพร้อมกัน** ได้เฉพาะ (คนจ่าย, กิจการปลายทาง) เดียวกัน · บัญชีรับคืนปริยาย = บัญชีที่จ่ายออก ถ้าทุกใบจ่ายจากบัญชีเดียว (ไม่งั้นต้องเลือก — ไม่เดา) · บัญชีจ่ายคืนต้องเป็นของกิจการปลายทาง · บัญชีรับคืนต้องเป็นของคนจ่าย · วันเคลียต้องไม่ก่อนวันสำรองจ่าย
- **ถอนการเคลีย = `acct.config`** (ย้อนภาษีซื้อของเดือนที่อาจยื่นไปแล้ว — แพตเทิร์น D88) · soft-void บิลบริษัท+รับคืน · บล็อกถ้าออก 50ทวิ จากบิลชุดนั้นไปแล้ว · `row_count = 0` ตอบ error ไทย (D93)
- 🪤 **ประวัติราคาจะนับรายการซ้ำ** (สำรองจ่าย + บิลที่คัดลอกไป) → ตัดสำรองจ่ายที่เคลียแล้วออก
- 🪤 **cleanup_test ต้องตามบิลที่เกิดจากการเคลีย** — อยู่ในกิจการปลายทาง ไม่ใช่ EID99 · ไม่ลบ = บิลทดสอบค้างใน ภพ.30 ของกิจการจริง → ลบด้วย `advance_src_tx like 'T-ADV-%'`
- ⚠️ **ข้อสังเกตที่ไม่ได้แก้ (พฤติกรรมเดิมทั้งระบบ)**: แดชบอร์ดเลือกเดือนด้วย `tax_invoice_date || transaction_date` แต่ ภพ.30 ใช้ `transaction_date` ⇒ บิลที่เคลียข้ามเดือนจะขึ้นแดชบอร์ดเดือนที่ออกใบกำกับ แต่ขึ้น ภพ.30 เดือนที่เคลีย
- ⚠️ หมวดจุดชนวนรับวัตถุดิบ (D79/D80) **ไม่ forward ตอนเคลีย** — สำรองจ่ายซื้อวัตถุดิบผลิตสุราให้โรง ต้องลงรับวัตถุดิบเองในแอปผลิต (ยังไม่มีลูกค้าใช้ทางนี้)
- `fn_save_transaction` ยกจาก 0046 ด้วย `scripts/gen/gen-0086.mjs` + diff (เพิ่มแค่ `advance_for_entity`) · ไม่มีตารางใหม่ (D118) · ไม่มี definer ใหม่ (D99) · RPC 3 ตัวเป็น invoker + revoke anon
- ✅ 0086 ลงครบ 2 DB (2026-10-22) · audit ผ่าน · `test:tenant` **375** (`advance.test.ts` 19 ข้อผ่านรอบแรก รวม 2 ทิศของด่าน VAT · staff ที่เห็นแค่บริษัทมองไม่เห็นบิลสำรองจ่าย · ยกเลิกบิลบริษัทใบเดียวถูกบล็อก · service role ผ่านด่าน)
- ✅ **เทสเบราว์เซอร์ครบ 77.1-77.7 (2026-10-22 · siamdist) ไม่เจอบั๊ก** · ตัวเลขเทียบเองคู่ขนานตรงทุกจุด: รอเบิกคืน 14,445.00 / VAT 945.00 · เคลีย 2 ใบ ⇒ ภพ.30 ต.ค. ภาษีซื้อ 735.00 และ ก.ย. คงที่ 98.14 · ยอดรวมทุกบัญชีเท่าเดิมเป๊ะ 42,372.93 (เงินแค่ย้ายข้าง) · ถอนการเคลีย ⇒ 3 แถวยกเลิก + ภพ.30 ต.ค. กลับเป็น 0 · ตัดเป็นส่วนตัว ⇒ แดชบอร์ด ก.พ. รายจ่าย 2,140 VAT 0 · ประวัติราคาไม่นับซ้ำ · แก้แค่ช่องว่างก่อน "—" ในแถบเหลือง
  - 🪤 ข้อที่ 77.1 "ไม่เลือกกิจการปลายทาง" ทำไม่ได้เมื่อมี 2 กิจการ (ตัวเลือกเดียว เลือกให้เอง) — ถูกต้อง แก้ไกด์เทสแล้ว
  - ⚠️ ของเดิม (ไม่ใช่งานนี้): ปุ่มยกเลิกบิลในแท็บค้นบิลยังใช้ `window.confirm()` ซึ่งบางเบราว์เซอร์บล็อกเงียบ ๆ (บทเรียน D96)
- ⏳ ผู้ใช้ขอให้ทำต่อ: แดชบอร์ดเลือกเดือนคนละวันที่กับ ภพ.30 (ดู NEXT_STEPS 0.-12)
- golden **A22** (`lib/accounting/advance.test.ts` 24 เทส) · `tests/tenant/advance.test.ts` · ชุดเทส `docs/TESTING.md` ส่วนที่ 77 + `supabase/seed/seed_advance.sql`

### D120 — จำกัดผู้ใช้ให้เห็นเฉพาะบางกิจการ: หน้าจอ + อุดรู 3 กลุ่ม (0087, 2026-10-22)

- **ที่มา**: ลูกค้า PAT&AIM ให้พนักงาน (คุณเอม) เห็นแค่บริษัท EID01 · กิจการที่เหลือเป็นข้อมูลส่วนตัวของเจ้าของ · ผู้ใช้บอกเอง *"ถ้ายุ่งยากเกินก็ไม่เป็นไร"*
- ★ **ฐานมีอยู่แล้วตั้งแต่ 0006** (`profiles.allowed_entity_ids` + `my_entities()` + RLS ฝั่งอ่านของบิล/ภาษี/50ทวิ/พนักงาน/งวด/กิจการ) แต่ **ไม่มีหน้าจอตั้งค่าเลย** (ตั้งได้ทางเดียวคือ SQL — ตระกูล D74/D80)
- 🔴 **ไล่ policy ล่าสุดของทุกตาราง + definer ทุกตัวแล้วพบรู 3 กลุ่ม** (ทั้งหมด build/lint/test มองไม่เห็น):
  1. `bank_accounts` ทุกคนอ่านได้ทุกบัญชี — พนักงานเห็นชื่อบัญชีส่วนตัวพร้อมยอดยกมา · ผู้มี acct.config แก้บัญชีส่วนตัวได้
  2. **ฝั่งเขียนของตารางลูกไม่กรองกิจการ** ทั้งที่ฝั่งอ่านกรองแล้ว — 🚨 `ti_w` ทำให้ **ลบรายการสินค้าของบิลที่ตัวเองมองไม่เห็นได้** ถ้ารู้เลข tx_id (DELETE ใช้ USING ของ `for all`) · `ts_w` `wht_w` `report_runs` ก็เช่นกัน · และ `payroll_items` **อ่านข้ามกิจการได้** (ไม่มี entity_id ในตัว ต้องไล่ผ่านงวด)
  3. **definer 5 ตัวรับกิจการมาเองแต่ไม่ถามสิทธิ์**: `fn_pay_tax` `fn_unpay_tax` `fn_post_payroll` `fn_unpost_payroll` `fn_wht_doc_nos` ⇒ จ่ายภาษี/ลงบัญชีเงินเดือนเข้ากิจการที่มองไม่เห็นได้ · ★ `fn_file_tax` (0072) และ `bar_guard` (0065) มีด่านแล้ว — ยกแพตเทิร์นมา
- 🪤 `bank_accounts_w` with check ใช้ **`<@`** ไม่ใช่ `&&` — ไม่งั้นพนักงานเพิ่มบัญชีที่ผูก [EID01, EID02] แล้วไปโผล่ในกิจการที่ไม่มีสิทธิ์
- 🚨 **ห้ามบันทึก array ว่าง** — RLS ตีความว่าไม่เห็นอะไรเลย แต่ `bar_guard` ตีความว่าเห็นทุกกิจการ (สองชั้นขัดกัน) → action บล็อก · 🪤 **เลือกครบทุกกิจการ = เก็บเป็น null** ไม่ใช่ลิสต์ครบ (ไม่งั้นเพิ่มกิจการใหม่แล้วผู้ใช้มองไม่เห็นเงียบ ๆ)
- 🚨 **main จำกัดไม่ได้** (มีสิทธิ์ admin แก้ profile ตัวเองคืนได้ = ภาพลวง) · เลื่อนเป็น main ⇒ ล้างค่าจำกัดให้เอง · จำกัดตัวเองไม่ได้
- 🚨 **ขอบเขตที่จงใจยังไม่ครอบ และบอกบนจอตรง ๆ**: ตาราง ผลิต/ขาย/บาร์ ไม่ได้กรองกิจการเลยตั้งแต่ต้น (บาร์มีด่านแค่ตอนเขียน) · `contacts` ใช้ร่วม (ผู้ใช้ตกลงแล้ว) ⇒ ข้อความครอบ/ไม่ครอบอยู่ใน `lib/shared/entityScope.ts` จุดเดียว 🪤 รอบแรกผมเขียน "บาร์" ไว้ฝั่งครอบ แล้วไล่ policy พบว่าตารางบาร์อ่านข้ามกิจการได้ ⇒ ย้ายข้าง (**ห้ามเขียนเกินความจริงบนหน้าตั้งค่าสิทธิ์** — เจ้าของจะเข้าใจผิดว่าข้อมูลปลอดภัย)
- ⚠️ **เจอแต่ไม่ได้แก้ (นอกขอบเขต)**: `integration_log` อ่านได้ทุกบทบาทใน tenant และ payload ของ `POST_PAYROLL` มีชื่อ+ยอดเงินเดือนรายคน ⇒ ฝ่ายขายอ่านเงินเดือนได้ (รูตระกูล D85 · ไม่เกี่ยวกับการจำกัดกิจการ)
- ฟังก์ชันยกด้วย `scripts/gen/gen-0087.mjs` + diff (เติมแค่ด่าน) 🪤 ไฟล์ migration ใน working copy เป็น **CRLF** — จุดยึดหาไม่เจอจนกว่าจะ normalize · ไม่มีตารางใหม่ (D118) · ไม่มี definer ใหม่ (D99)
- ตรวจแล้ว 2026-10-22: **ยังไม่มีผู้ใช้คนไหนถูกจำกัดทั้ง 2 DB** ⇒ 0087 ไม่กระทบใครตอนลง
- ✅ 0087 ลงครบ 2 DB (2026-10-22) · audit ผ่าน · `test:tenant` **395** · `entity-restrict.test.ts` 20 ข้อผ่าน 🪤 รอบแรก 2 ข้อที่ "ต้องถูกบล็อก" ไม่มีคู่เทียบ (เพิ่มบัญชีผูก 2 กิจการ · ออก 50ทวิ ในนามกิจการอื่น) อาจแดงด้วยเหตุผลอื่นแล้วผ่านโดยไม่ได้พิสูจน์อะไร → เติม positive control แถวเดียวกันแต่ผูกกิจการของตัวเอง ผ่านทั้งคู่ (บทเรียน D92)
- `lib/shared/entityScope.test.ts` 26 ข้อ (รวมอ่าน SQL 0087 มาตรวจว่าด่านครบทุกจุดที่ประกาศ) · `tests/tenant/entity-restrict.test.ts` · ชุดเทส `docs/TESTING.md` ส่วนที่ 78

### D121 — ย้ายลูกค้า PAT&AIM จากแอป GAS (บัญชี + เงินเดือน) เข้า proof (สคริปต์ · ไม่มี migration, 2026-10-22)

- **ที่มา**: ลูกค้ารายใหม่ใช้แอป GAS 2 ตัว (`D:\Pat\clasp-AIM-บัญชี` · `clasp-AIM-เงินเดือน`) · ข้อมูลส่งมาเป็น `D:\Pat\PAT&AIM.xlsx` (ชีทจัดซื้อเป็นขยะ ไม่ย้าย) · ปลายทาง DB ก้อนลูกค้า (proof-app)
- **ตัวสคริปต์**: `migration/aim/` — `transform.ts` (บัญชี) · `payroll.ts` (เงินเดือน) · `apply.ts` (ลง DB) · `import-aim.ts` (CLI: dry-run ปริยาย · `--apply --env=… --tenant=<slug>` ลงจริง)
- 🚨 **ข้อมูล/ค่าตั้งเฉพาะลูกค้าอยู่นอก repo เสมอ** (D66): `D:\Pat\aim-import-config.json` — ชื่อบัญชีใหม่ · คู่โอน · นโยบาย VAT · `legLinks` · โค้ดใน repo ไม่มีชื่อ/ยอด/เลขภาษีของลูกค้าเลย (เทสใช้ข้อมูลสมมติ)
- **ตัดสินกับผู้ใช้ (2026-10-22)**:
  - ชื่อบัญชี: ของ EID01 = ชื่อเดิม + " เอม" · ใช้แค่ส่วนตัว = ชื่อเดิม + " ส่วนตัว" (ยกเว้น SCB02 → "ไทยพาณิชย์ ส่วนตัว" · CHOUW คงเดิม)
  - **ภพ.30: ไม่แก้สูตร proof** แอปเดิมนับบิลค้าง AR/AP และบิลไม่มีบัญชีเข้า ภพ.30 · proof ข้าม (cash basis) ⇒ dry-run **ลิสต์บิลที่ทำให้ต่าง 11 ใบพร้อมวิธีแก้รายใบ** ให้ผู้ใช้ไปตามแก้ในแอป (แก้สูตร = กระทบลูกค้ารายอื่น) ★ กดรับ/จ่ายชำระแล้วบิลยังอยู่เดือนเดิม (`fn_settle_apar` ไม่แตะวันที่รายการ) ⇒ เดือนนั้นกลับมาตรงกับที่ยื่นเอง
  - **บิลมี VAT ในกิจการไม่จด VAT** (113 ใบ · EID05/06/07/08): รวม VAT เป็นต้นทุน (ยอดที่จ่ายจริงเท่าเดิม) — ไม่งั้นชน trigger ม.86/13 ของ D55
  - เงินทดรองพนักงาน 2,000 = **โอนระหว่างบัญชี** (ไม่ใช่สำรองจ่าย+รายได้)
  - สถานะ "รอเคลีย" เดิม → สำรองจ่าย (D119) · กิจการผู้จ่าย = กิจการแรกของบัญชีที่ไม่ใช่กิจการปลายทาง
- **เงินเดือน — แปลงเกณฑ์ที่ฝังในโค้ดเดิมเป็น config** (ชุดเดียวกับ golden fixture ใน `lib/payroll/calc.test.ts`): กลุ่ม `ช่าง` (OT ×1.5 · เบี้ยขยัน) / `หัวหน้า` (OT ×1.0) · ตัวแปร `hourly_rate` = ฐาน ÷ วันในเดือน ÷ 9 · ค่าตำแหน่ง prorate แต่ไม่เข้าฐาน OT · เบี้ยขยัน = ขั้นบันไดวันลา + เฉลี่ยคะแนนหัวหน้า · `allowSSO` ของ ล.ย.01 เดิมไม่มีช่องเฉพาะ → รวมเข้า "อื่น ๆ"
  - 🚩 **พิสูจน์ด้วยการให้ engine ของ proof คิดทุกบรรทัดใหม่** (ไม่ใช่ลอกตัวเลขเดิมมาวาง): **72/72 บรรทัดตรงทุกช่อง** (ค่าจ้าง/OT/เบี้ยขยัน/รวม/สปส./ภาษี/สุทธิ) · ยอดรวมต่องวดตรงกับบิลในบัญชีทุกขาที่มีบิล · ไม่ตรงแม้บรรทัดเดียว = สคริปต์ไม่ยอมลง
  - 🚨 **งวด ม.ค.–เม.ย. แอปเดิมเป็น "draft"** ทั้งที่จ่ายจริงแล้ว (จ่ายนอกแอป) ⇒ ลงเป็นร่าง = ภ.ง.ด.1ก ปี 2569 ขาด 4 เดือนเงียบ ๆ (D81 นับเฉพาะงวดที่ลงบัญชีแล้ว) → ติดครบ 3 ขาแบบ **ไม่มีบิล** (`txIds: []` + `imported`) **ไม่สร้างรายจ่ายย้อนหลังให้** · พิสูจน์แล้ว ภ.ง.ด.1ก จาก DB = เงินได้รวม/ภาษีรวมของแอปเดิมเป๊ะ
  - งวด พ.ค.: แอปเดิมอ้างบิล `TRS-20260627-*` ที่ไม่มีในบัญชีแล้ว (ถูกลบ) → ติดขาแบบไม่มีบิล · **ใส่ txIds เฉพาะบิลที่ย้ายมาจริง** (ถอนทีหลัง = ยกเลิกเฉพาะบิลที่ชี้)
  - ขาที่แอปเดิมไม่ได้ลงแต่จ่ายจริงด้วยบิลที่คีย์เอง (ประกันสังคม พ.ค./มิ.ย. ยอดตรงเป๊ะ) → **dry-run ชี้ให้ดู ไม่ผูกให้เอง** · ผูกด้วย `legLinks` ในไฟล์ค่าตั้ง ⇒ ขานั้นไม่มีปุ่มให้กดลงซ้ำ (ไม่ผูก = ลงรายจ่ายซ้ำ ไม่มีอะไรฟ้อง)
  - ขาลงบัญชี 3 ขา หมวด/คู่ค้าตรงบิลเดิม (`เงินเดือน` แยกรายคน · `ประกันสังคม` · `ภาษีหัก ณ ที่จ่าย`) · คงรหัสพนักงานเดิม `EMP-00x` (ตัวนับ EMP = 8 → คนใหม่ได้ `EMP-0009`)
- **การลง DB** (`apply.ts`):
  - ลงได้เฉพาะเมื่อรายงานสะอาดทั้งหมด (ไม่มีจุดค้างตัดสิน · ยอดคงเหลือตรงทุกบัญชี · เงินเดือนตรงทุกบรรทัด)
  - ด่านก่อนลง: ต้องเป็นลูกค้าที่**เพิ่งรับ**ที่ `/platform` (โมดูล บัญชี+เงินเดือน · โควตากิจการ ≥ 9 · กิจการหลัก EID01 · ตารางที่จะลงว่างหมด) — กันลงซ้ำ
  - 🚨 **ห้าม `fn_mig_set_triggers`** (ปิด trigger ทั้ง DB ที่มีลูกค้าเจ้าอื่นใช้อยู่ · D82) → ปล่อย trigger ทำงาน แล้วลบแถว audit ของการย้าย (tenant นี้ · ไม่มีผู้ใช้ · ช่วงเวลาที่รัน) ⇒ หน้าประวัติการแก้ไขไม่จมด้วยแถว "เพิ่ม" นับพัน
  - 🚨 **ล้มกลางทาง = ย้อนกลับเองทั้งหมด** ด้วย `wipeImported()` ที่ลบเฉพาะของที่สคริปต์ลง · **ห้าม `fn_mig_truncate`** (ลบกิจการ EID01 + แบรนด์ของ provisioning ด้วย)
  - 🪤 ค่าปริยาย `my_default_entity()` อ่านจาก JWT → service role ได้ null ชน not null (`contacts` ล้มรอบแรกของการลองจริง → ระบบย้อนกลับเองถูกต้อง) → เติม `entity_id` กิจการหลักให้ตารางที่มีค่าปริยายนี้
  - หลังลง อ่านกลับนับทุกตาราง (insert ไม่ error ≠ ครบ)
- ✅ **ลองจริงกับ tenant ชั่วคราว `zz-test-aimtrial` บน proof-app แล้วลบทิ้ง** (2026-10-22): ลงครบ 16 ตาราง (ธุรกรรม 895 · รายการ 1,775 · บรรทัดเงินเดือน 72) · อ่านจาก DB กลับมาคิดใหม่: ยอดคงเหลือตรง 10/10 บัญชี · ภพ.30 ต่างเฉพาะ 11 บิลที่ลิสต์ไว้ · ภ.ง.ด.1ก ตรงแอปเดิม · edit_log 0 แถว · สำรองจ่าย 2 ใบ "รอเบิกคืน"
- ✅ **ลงจริงเข้า tenant `aim` บน proof-app แล้ว (2026-10-22)** ด้วยไฟล์ชุดใหม่ที่ผู้ใช้โหลดมาอีกรอบ (ธุรกรรม 902 · รายการ 1,785 · VAT รวมเป็นต้นทุน 116 ใบ) · dry-run สะอาดก่อนลง · อ่านกลับจาก DB: ยอดคงเหลือตรง 10/10 · ภพ.30 ต่างเฉพาะ 11 บิลที่ลิสต์ไว้ · ภ.ง.ด.1ก 1,968,631 / 15,165 ตรงแอปเดิม · edit_log เหลือ 1 แถว (การสร้าง EID01 ของ provisioning ไม่ใช่ของการย้าย)
- ⏳ ยังไม่ได้ทำ: เทสเบราว์เซอร์ในชื่อเจ้าของลูกค้า (`docs/TESTING.md` 79.4) · ภาษีหัก ณ ที่จ่าย มิ.ย./ก.ค. 1,685 ยังไม่มีบิล (แอปเดิมก็ไม่ได้ลง — ต้องถามลูกค้าว่าจ่ายแล้วหรือยัง) · ปุ่มแก้ชื่อย่อ/ชื่อลูกค้าที่หน้า `/platform` (ผู้ใช้ขอ — ทำหลังย้าย · เปลี่ยนแค่แถว `tenants`)
- เทส: `migration/aim/payroll.test.ts` (ข้อมูลสมมติ · สถานะงวด + config ต่อครบ) · ชุดเทส `docs/TESTING.md` ส่วนที่ 79

### D122 — แก้ชื่อย่อ/ชื่อลูกค้าได้จากหน้า `/platform` (ไม่มี migration, 2026-10-22)

- **ที่มา**: ผู้ใช้รับลูกค้า `aim` แล้วพบว่าแก้ชื่อย่อ/ชื่อกิจการทีหลังไม่ได้ · ขอให้แก้ได้ *"โดยที่ข้อมูลรายละเอียดของกิจการหรือการตั้งค่าอื่นๆยังเหมือนเดิม"*
- **ทำไมปลอดภัย**: ทุกตารางผูกลูกค้าด้วย `tenants.id` (uuid) — ไม่มีตารางไหนเก็บ slug · ชื่อผู้ใช้ไม่ผูก slug ตั้งแต่ D48 (ชื่อไม่ซ้ำทั้งระบบ) · แบรนด์ที่ลูกค้าเห็นอยู่ `app_settings.brand_name` แยกจาก `tenants.name` (D47) ⇒ `renameTenant()` **update แถว `tenants` แถวเดียว** (เทสอ่านซอร์สล็อกว่าฟังก์ชันไม่ `.from()` ตารางอื่น)
- กติกาชื่อย่อ/ชื่อเป็นตัวเดียวกับตอนรับลูกค้า (`validateTenantIdentity()` — `validateNewTenant` เรียกตัวนี้ ไม่เขียนซ้ำ) · ห้ามซ้ำลูกค้ารายอื่น (เช็คก่อน + unique index อีกชั้น) · ห้ามแก้ tenant แพลตฟอร์ม · อ่านไม่สำเร็จ = error (D89) · ไม่เปลี่ยน = ไม่เขียน ไม่ log
- log `rename_tenant` เก็บทั้งค่าเดิม/ใหม่ (log เก่าอ้างลูกค้าด้วย slug เดิม — ต้องโยงกลับได้)
- 🪤 ผลข้างเคียงที่หน้าจอบอก (เหลือง เมื่อชื่อย่อเปลี่ยน): ลิงก์หน้าล็อกอินแบบ subdomain ชื่อเดิมใช้ไม่ได้ · ไฟล์สำรองที่โหลดก่อนแก้ `restore:tenant` จะปฏิเสธเพราะ slug ไม่ตรง ต้องระบุ `--tenant` เอง
- ชื่อผู้ใช้ `owner-<slug เดิม>` **ไม่เปลี่ยนตาม** (ตั้งใจ — เปลี่ยน = ลูกค้าล็อกอินไม่ได้)
- ✅ **เทสบนจอจริง (localhost · DB proof-app · tenant ทดลอง `zz-test-rename` แล้วลบทิ้ง)**: ชื่อซ้ำ/ภาษาไทย/ชื่อสงวน → error ไทย ไม่มีอะไรถูกเขียน · แก้สำเร็จ → ตาราง+หัวแผงเปลี่ยนทันที · DB: กิจการ (ชื่อ/เลขภาษี/ที่อยู่/VAT) · แบรนด์ · ผู้ใช้ ไม่ขยับ · **ล็อกอินด้วยชื่อผู้ใช้เดิมหลังเปลี่ยน slug ได้จริง** และเห็นกิจการของตัวเอง
- เทส `lib/platform/provision.test.ts` +7 · ชุดเทส `docs/TESTING.md` ส่วนที่ 80

### D123 — ภพ.30 นับบิลค้างที่ออกใบกำกับแล้ว · ยอดเงินของบิลค้างตัดตามวันที่ชำระ (0088, 2026-10-23)

- **ที่มา**: ย้าย AIM (D121) แล้ว ภพ.30 ไม่ตรงกับที่ยื่นไว้ — แอปเก่าของ AIM นับบิลค้างรับ/ค้างจ่ายเข้า ภพ.30 แต่ proof ข้าม (กติกาเหล็ก A2 cash basis ที่ยกมาจากแอปบัญชีเดิมของเจ้าของ — `Reports.js` มีคอมเมนต์ `[Phase 2] !row[21] = ข้าม AP/AR ค้าง` = ตั้งใจข้าม)
- **ผู้ใช้ตัดสิน (2026-10-23)**: ทาง ข. แก้ทั้งระบบให้ถูกตามหลักบัญชี **ไม่ทำสวิตช์รายลูกค้า** (ผู้ใช้ระบบมีแค่เจ้าของ + aim) · ขอให้ "ไม่แตะการคำนวณ VAT"
- **หลัก**: ภาษีขาย/ซื้อเกิดตามใบกำกับภาษี ไม่ใช่ตามการรับ/จ่ายเงิน ⇒ บิลค้างที่มีเลขใบกำกับแล้วต้องอยู่ใน ภพ.30 ของเดือนนั้น · ส่วนหัก ณ ที่จ่ายเกิดตอนจ่ายเงิน และยอดเงินในบัญชีขยับตอนเงินเข้า/ออกจริง
- **3 ส่วน**:
  1. ภพ.30 (`passesVatGuard` — ใช้กับ `taxReport` ตัวเดียว): บิลค้าง (AP/AR) นับเมื่อ**มีเลขใบกำกับ** ไม่ถามบัญชี (ยังไม่มีเงินเข้า/ออก) · บิลปกติเหมือน A2 ทุกตัวอักษร · เดือนยังเป็น `transaction_date`
  2. ยอดเงิน/statement (`ledger.ts`): ใช้ `cashDateOf()` = `settled_on || transaction_date`
  3. ภงด.3/53 + 50ทวิ ค้างออก + cron เตือน ภงด.: บิลค้างจ่ายที่เคลียแล้วนับเดือนที่จ่ายจริง · ยอดแดชบอร์ด**ไม่แตะ** (เรื่องวันที่ของแดชบอร์ดค้างคุยอยู่ใน NEXT_STEPS)
- 🚨 **ไม่แตะสูตร VAT**: ยังคิดจากยอดรวม × 7% ปัดครั้งเดียว · golden A1/A3/A4/A10/A11 ผ่านโดยไม่แก้ตัวเลขคาดหวัง — แก้แค่ fixture `AR1` ให้เป็น "บิลค้างที่ยังไม่มีใบกำกับ" (ตัวแทนของกติกาเดิมที่ยังจริง) แล้วเพิ่ม golden **A23** แยก
- 🚨 **คอลัมน์ใหม่ `settled_on` ไม่ใช้ `payment_date`**: `payment_date` ถูกเขียนจาก 2 ทาง — กดชำระบิลค้าง **และกรอกวันที่จ่ายตอนออก 50ทวิ** (`fn_issue_wht`) ⇒ ให้ยอดเงินอ่าน `payment_date` = ออก 50ทวิ ของบิลเงินสดธรรมดาแล้วเงินย้ายเดือนเอง · `settled_on` เขียนโดย `fn_settle_apar` ที่เดียว · ไม่ backfill (ไม่มีข้อมูลว่าบิลไหนเคยค้าง) ⇒ บิลเก่าทุกใบตัดยอดเหมือนเดิม
- ★ **ไม่นับซ้ำโดยโครงสร้าง**: `fn_settle_apar` แก้แถวเดิมและไม่แตะ `transaction_date` (ตรวจโค้ด + `tests/tenant/settle-apar.test.ts`) ⇒ บิลอยู่ใน ภพ.30 เดือนเดียวเสมอ ทั้งก่อนและหลังชำระ
- 🪤 ชำระบิลค้างเข้าบัญชีที่ไม่อยู่ในระบบภาษี = บิลหลุดจาก ภพ.30 หลังชำระ (บิลปกติต้องอยู่ในบัญชีระบบภาษี) → `settleVatWarn()` เตือนเหลืองตรงปุ่มชำระ · ตรวจแล้วทั้ง 2 DB ไม่มีบิลแบบนี้
- ★ แก้ `fn_settle_apar` ให้วันที่ปริยายเป็น**วันที่ไทย** (เดิม `current_date` = UTC · D100)
- 🚩 **พิสูจน์ด้วยการถ่ายภาพตัวเลขก่อน/หลัง ทั้ง 2 DB ทุก tenant ทุกกิจการทุกเดือน** (ภพ.30 · ภงด.3/53 · 50ทวิ ค้างออก · ยอดทุกบัญชีรายเดือน · statement ทุกบัญชีรายเดือน):
  - DB เจ้าของ: ขยับ**จุดเดียว** ภพ.30 EID01 ก.ค. 68 ภาษีขาย 0 → **21,800.63** (บิลค้างรับไซมิส เทสท์ 7 ใบ ใบกำกับ IN6807001–008 · ผู้ใช้ยืนยันว่าเป็นบิลจริงและยื่นภาษีเดือนนั้นจาก Excel ไปแล้ว ยังเป็นลูกหนี้อยู่) · ยอดเงิน/statement/ภงด. **ไม่ขยับเลย**
  - aim: ภพ.30 ก.ค./ส.ค./ก.ย. **ตรงกับที่ยื่นไว้เป๊ะ** (6,697.36 · 17,083.16 · 42,574.00) · ต.ค. ตรงสูตรแอปเก่าหลังหักบิล `TR-20260917-0009` ที่ผู้ใช้สั่งยกเลิก (ลงผิดจากระบบเก่า)
  - ลง 0088 แล้วถ่ายซ้ำ → ไม่มีอะไรขยับ (ยังไม่มีบิลไหนมี `settled_on`)
- ✅ 0088 ลงครบ 2 DB (สำรองไว้ `D:/insep-erp-backup/2026-10-23-0088`) · audit ผ่าน · `test:tenant` **399** (`settle-apar` 4 ข้อ) · test **1780**
- ⚠️ ในระหว่างนี้ (aim): บิลไม่มีบัญชี 3 ใบ (`TR-20260731-0001`, `TR-20260817-0001`, `TR-20261007-0012`) ตั้งเป็นค้างจ่ายแล้วตามที่ผู้ใช้บอก (ยังไม่ได้โอน จะเคลียสิ้นเดือน) · ขาภาษีหัก ณ ที่จ่ายงวดเงินเดือน มิ.ย./ก.ค. ติ๊กลงบัญชีแล้วแบบไม่มีบิล (จ่ายรวมกับ ภงด.53 ในบิล `TR-20260707-0006` / `TR-20260810-0010`)
- ชุดเทส `docs/TESTING.md` ส่วนที่ 81
- ✅ **เทสเบราว์เซอร์ส่วนที่ 81 ผ่าน (2026-10-23 · siamdist · DB proof-app)** — คีย์บิลค้างรับ 20/09 (1,000+VAT 70 · ใบกำกับ) + ค้างจ่าย 22/09 (2,000+VAT 140 · หัก 3% = 60) ผ่านหน้าบันทึกจริง:
  ก่อนชำระ ภพ.30 ก.ย. จากบิล = **24.07** (คำนวณคู่ขนาน 262.21 − 238.14 ตรง) · ยอดสิ้น ก.ย. 1,817.93 ไม่ขยับ · ภงด.53 ก.ย. 0 ·
  ชำระ 20/10 และ 22/10 → DB `transaction_date` คงเดิม `settled_on` = วันที่ชำระ · ภพ.30 ก.ย. **ยังเป็น 24.07** · ต.ค. ไม่มีบิลทดสอบ (ไม่นับซ้ำ) ·
  ภงด.53 **ต.ค. 60** / ก.ย. 0 · 50ทวิ ค้างออกขึ้นเดือน ต.ค. ลงวันที่ 22/10 · statement ต.ค. 1,817.93 → +1,070 (20/10) → −2,080 (22/10) → **807.93** · statement ก.ย. ไม่มีบิลทดสอบ ·
  เลือกบัญชีนอกระบบภาษี → เตือนเหลือง · เปลี่ยนเป็นบัญชีในระบบ → เตือนหาย
- 🐛 **เจอ 1 ตัว (แก้แล้ว)**: ข้อความชี้ทางเขียนชื่อการ์ดเองว่า *"บัญชีที่นับเข้าระบบภาษี"* แต่หัวการ์ดจริงคือ **"บัญชีในระบบภาษี"** (และเป็นช่องเพิ่ม ไม่ใช่ช่องติ๊ก) — หน้าตั้งค่าบาร์ (D96) ก็ผิดแบบเดียวกัน ⇒ `TAX_ACCOUNTS_CARD`/`TAX_ACCOUNTS_WHERE` ใน `lib/accounting/taxAccounts.ts` เป็นแหล่งเดียว ใช้ทั้งหัวการ์ดและข้อความชี้ทางทุกจุด + เทสอ่านซอร์สกันเขียนชื่อเอง · ตรวจบนจอแล้วข้อความกับหัวการ์ดตรงกัน
- 🐛 **แก้แล้ว (ผู้ใช้สั่งก่อน commit · มีมาก่อน D123)**: แท็บลูกหนี้-เจ้าหนี้ ช่องบัญชี/วันที่ชำระจำค่าของบิลใบก่อนมาเติมให้ใบถัดไป (state ร่วมทุกแถว — กดยืนยันเร็ว ๆ = ชำระผิดบัญชี/ผิดวัน) → `toggleSettle()` ล้างบัญชี + คืนวันที่เป็นวันนี้ทุกครั้งที่เปิดแถว · ชำระ/ยกเลิกสำเร็จแล้วข้อความไม่ขึ้น (อยู่ในแถวที่ปิดไปพร้อมกัน) → `<Msg>` นอกแถวเมื่อไม่มีแถวเปิด (แถวเปิด = ข้อความในแถว ไม่ซ้ำ 2 ที่) · `lib/accounting/aparTab.test.ts` อ่านซอร์สล็อกทั้ง 2 ข้อ · ✅ ลองบนจอแล้ว: ชำระใบแรก 15/10 → ขึ้น "บันทึกการชำระเรียบร้อย" · เปิดใบที่ 2 → บัญชีว่าง วันที่ = วันนี้ · กดยืนยันโดยไม่เลือกบัญชี → error ในแถวจุดเดียว
- เก็บกวาดแล้ว: บิลทดสอบ 2 ใบ = ยกเลิก · ลบบัญชีชั่วคราว + คืนค่าตั้งบัญชีในระบบภาษีเป็นว่าง · ภพ.30 ก.ย. ของ siamdist กลับเป็น 192.21 / 98.14 เท่าก่อนเทส

### D124 — รายงานภาษีตัดสินจากกิจการ + เอกสาร · เลิกตัวกรอง "บัญชีในระบบภาษี" (ไม่มี migration, 2026-10-23)

- **ที่มา**: ผู้ใช้ตั้งคำถามว่า *"เรื่องระบบภาษีจริง ๆ แล้วมันไม่ได้ขึ้นกับบัญชี น่าจะขึ้นกับกิจการไหมว่าจดทะเบียนภาษีหรือเปล่า"* — ถูก · ภาษีขาย/ซื้อเกิดตามใบกำกับในนามกิจการ ไม่ใช่ตามบัญชีที่เงินเข้า/ออก · ตัวกรองเดิม (D93 `app_settings` kind `tax_account`) ทำให้บิลซื้อที่มีใบกำกับจริงแต่จ่ายจากบัญชีเงินสด **หายจาก ภพ.30 เงียบ ๆ**
- **ผู้ใช้เลือก "ทาง 1"**: รายงานภาษีตัดสินจากกิจการ + เอกสาร · เลิกตัวกรองบัญชีทุกจุด · ทำสคริปต์เทียบผลกระทบก่อน · หน้าตั้งค่าบัญชีเงินใหม่ทำต่อทีหลัง (D125)
- **เลิกทุกจุดพร้อมกัน** (กติกาเดิมกระจาย 5 ที่ — เอากลับที่เดียว = แอปกับ LINE นับคนละชุด): `passesTaxGuard`/`passesVatGuard` · `taxReport`/`whtReport`/`dashboardData` ไม่รับพารามิเตอร์ชุดบัญชีแล้ว · ป้าย "ภาษี" ในยอดบัญชี · cron เตือน ภงด. · คำเตือนบัญชีในหน้าตั้งค่าบาร์ (D96) · คำเตือนตอนชำระบิลค้าง (`settleVatWarn` D123) · การ์ด "บัญชีในระบบภาษี" ในหน้าตั้งค่า · ลบ `lib/accounting/taxAccounts.ts` · แถวเก่าใน `app_settings` **ทิ้งไว้ได้ ไม่มีใครอ่าน** (ไม่ต้องมี migration · `kind` ยังอยู่ใน CHECK whitelist)
- ★ **เช็คราคา (A13) ยังหลุดทุกรายงาน**: เดิมหลุดเพราะบัญชีว่าง แต่ทุกรายงานกรอง `type` (รายรับ/รายจ่าย/บันทึกภาษี) อยู่แล้ว — ไม่ได้พึ่งบัญชี
- 🚨 **สูตรไม่แตะ**: golden A1/A2/A10/A11/A13/A23 ผ่านโดยไม่แก้ตัวเลขคาดหวัง — แก้แค่ย้าย fixture `N1` (บิลซื้อบัญชีเงินสดย่อยมี VAT ไม่มีเลข) ออกจากชุดหลัก ไปเป็นเคสของ golden **A24** · `taxAccounts.test.ts` เปลี่ยนเป็นเทสอ่านซอร์สล็อกว่าไม่มีไฟล์ไหนกลับไปอ่าน `tax_account` หรือถาม `taxAccounts.has(`
- **บิลซื้อมี VAT แต่ไม่มีเลขใบกำกับ — ผู้ใช้ตัดสิน "ทาง ก"**: *ยังนับเข้า ภพ.30* (DB เจ้าของมีบิลซื้อแบบนี้ 87 ใบ VAT รวม 34,201.70 ที่ยื่นไปแล้ว — ใบจริงมี แค่ตอนคีย์ไม่ได้กรอกเลข · ไม่นับ = ภาษีซื้อเดือนที่ยื่นแล้วหายเงียบ ๆ) **แต่ต้องเห็นทุกใบ**:
  - ตอนบันทึก/แก้บิล: บรรทัดเหลือง `missingInvoiceWarn()` เมื่อเป็นบิลซื้อ + ติ๊ก VAT + เลขใบกำกับว่าง (เตือน ไม่บล็อก)
  - การ์ด ภพ.30 (เอกสารสรรพากร): ลิสต์บิลของเดือนนั้น + วิธีแก้ (`missingInvoicePurchases()` ใช้**ด่านเดียวกับ ภพ.30** ⇒ ลิสต์ = บิลที่อยู่ในตัวเลขจริงพอดี ไม่ขาดไม่เกิน · หัวข้อ/วิธีแก้ตัดสินใน lib `missingInvoiceListText()`)
- **แก้ข้อมูลก่อนเลิกตัวกรอง** (สำรองไว้ `D:/insep-erp-backup/2026-10-23-d124/`):
  - DB เจ้าของ: บิล 17 ใบที่ลงบัญชีนอกระบบภาษี มี VAT ไม่มีเลขใบกำกับ (เดิมไม่เคยเข้า ภพ.30) → **พับ VAT เป็นต้นทุน** (รวม 8,365.05 · ยอดจ่ายจริงเท่าเดิม) ตามที่ผู้ใช้สั่ง — ไม่งั้นจะโผล่เป็นภาษีซื้อของเดือนที่ยื่นไปแล้ว
  - aim: บิลปกติที่ไม่มีบัญชี 10 ใบ → **ค้างจ่าย** (ผู้ใช้: ลงไว้ก่อน ยังไม่ได้โอนจริง จะเคลียสิ้นเดือน)
- 🚩 **พิสูจน์ด้วยสคริปต์ถ่ายตัวเลขก่อน/หลัง ทั้ง 2 DB ทุก tenant ทุกกิจการทุกเดือน** (ภพ.30 · ภงด.3/53 · 50ทวิ ค้างออก · แดชบอร์ด):
  - DB เจ้าของ: **ภพ.30 / ภงด.3/53 / 50ทวิ ค้างออก ไม่ขยับเลย** · ขยับแค่แดชบอร์ด (เงินในบัญชีส่วนตัวที่ลงในกิจการ EID01/EID02 นับแล้ว — ตามที่ตกลง: แยกเงินส่วนตัวด้วยกิจการ/สำรองจ่าย ไม่ใช่ด้วยบัญชี)
  - aim: ขยับจุดเดียว ภพ.30 EID01 ต.ค. ภาษีขาย +11,970 = บิล `TR-20260917-0009` ที่ผู้ใช้ต้องกดยกเลิกเอง (ลงผิดจากระบบเก่า) · siamdist ไม่ขยับ
- ✅ เทสบนจอ (siamdist): ติ๊ก VAT ไม่กรอกเลข → เตือนเหลือง · กรอกเลข → หาย · หน้าตั้งค่าไม่มีการ์ดบัญชีในระบบภาษี · หน้า ภพ.30 โหลดได้ ไม่มี error · test **1783** · build/lint ผ่าน
- ⏳ ลิสต์บนการ์ด ภพ.30 ยังไม่ได้เห็นกับข้อมูลจริง (dev ชี้ proof-app — DB เจ้าของมี 87 ใบ)
- ชุดเทส `docs/TESTING.md` ส่วนที่ 82

### D125 — หน้าตั้งค่าบัญชีเงินใหม่: แก้ไข · เปลี่ยนชื่อ · ปิดใช้ · ลบ (0089, 2026-10-24)

- **ที่มา**: ผู้ใช้บอกว่าหน้าตั้งค่าบัญชี *"แต่ละอันดูใช้งานยาก … ยิ่งการเพิ่ม/แก้ไขบัญชีน่าจะเป็นจุดที่ผมว่าหนักสุด"* · ของเดิมมีฟอร์มเดียว "พิมพ์ชื่อเดิมแล้วกดเพิ่ม" (upsert ตามชื่อ) ⇒ เปลี่ยนชื่อไม่ได้เลย · ลบต้องไปทำในหน้า Supabase · ปิดบัญชีที่เลิกใช้ไม่ได้ · ต่อจาก D124 (ตัดการ์ดบัญชีในระบบภาษีออกแล้ว)
- **การ์ดใหม่** `BankAccountsCard.tsx`: ตารางมี ยอดยกมา · **คงเหลือ** (`accountBalances` ตัวเดียวกับแท็บบัญชี & เงินสด) · **การใช้งาน** · ปุ่ม แก้ไข / ปิดใช้ / ลบ ต่อแถว · เพิ่ม = ป๊อปอัพตัวเดียวกับแก้ไข · ประเภทบัญชีเป็นช่องเลือก+พิมพ์เอง · วันที่ยอดยกมา · ช่องกิจการโชว์เฉพาะเมื่อมีหลายกิจการ
- 🚨 **บิลอ้างบัญชีด้วย "ชื่อ" ไม่ใช่ id** (ยกมาจากชีทเดิม · 0001) ⇒ เปลี่ยนชื่อในตารางบัญชีอย่างเดียว = บิลเก่าทั้งหมดหลุดบัญชี ยอดคงเหลือหาย → `fn_rename_bank_account` (definer) ตามไปแก้ **ใน transaction เดียว**: `transactions` · `tax_payments` · `pay_post_legs` · `app_settings` 7 kind (`fn_account_setting_kinds()` ⇄ `ACCOUNT_SETTING_KINDS` · เทสอ่านไฟล์ SQL มาเทียบ + เทียบกับ CHECK whitelist ของ app_settings)
  - 🪤 trigger `advance_guard` (0086) ห้ามแก้บิลสำรองจ่ายที่เคลียแล้ว/รายการรับคืนตรง ๆ → RPC ตั้ง `app.advance_rpc` แบบเดียวกับ RPC ของ 0086 (เปลี่ยนชื่อบัญชีไม่แตะสถานะสำรองจ่ายเลย)
  - ★ `edit_log` จะมีแถวเพิ่มตามจำนวนบิลที่ถูกแก้ชื่อ (บอกบนจอก่อนกดบันทึก · เป็นร่องรอยที่ถูกต้อง ไม่ปิด trigger — D82)
- **ลบได้เฉพาะบัญชีที่ไม่มีอะไรอ้างถึง** (`fn_delete_bank_account` ตรวจที่ DB อีกชั้น) · มีบิลแล้ว = ปุ่มลบเทา + บอกเหตุผล (ซ่อนปุ่มแย่กว่าปุ่มเทา D86) → ใช้ **ปิดใช้** แทน
- **ปิดใช้** = คอลัมน์ใหม่ `bank_accounts.active` · ไม่โผล่ในช่องเลือกบัญชีของบิลใหม่ทุกจุด (บันทึก · ค้นบิล/แก้ · ลูกหนี้-เจ้าหนี้ · โอนระหว่างบัญชี · ชำระภาษี · สำรองจ่าย · บาร์ · เงินเดือน · ตั้งค่า→กิจการ) ผ่าน `accountsFor()` ตัวเดียว · ยอด/รายงาน/statement ยังนับครบ
  - 🪤 **บัญชีที่ปิดใช้แต่เป็นค่าของบิลที่เปิดมาแก้ (หรือค่าตั้งที่ตั้งไว้แล้ว) ต้องยังอยู่ในช่อง** — ตัดทิ้งแล้ว Select โชว์ว่าง กดบันทึก = บิลหลุดบัญชี/ค่าตั้งถูกล้างเงียบ ๆ → พารามิเตอร์ `keep`
  - ★ ค่าว่าง (ข้อมูลก่อน 0089) ถือว่าใช้อยู่ · เตือนก่อนปิดใช้ถ้ายังมียอดคงเหลือหรือยังถูกตั้งค่าใช้อยู่ (เตือน ไม่บล็อก)
- 🚨 **เปลี่ยนชื่อ/ลบ ต้องเห็นทุกกิจการ** (`my_entities() is null`) — ผู้ใช้ที่ถูกจำกัดกิจการ (D120) มองไม่เห็นบิลของกิจการอื่นที่ใช้บัญชีร่วม จะเปลี่ยนชื่อให้คนอื่นโดยไม่รู้ตัว · การนับการใช้งานเป็น definer ด้วยเหตุผลเดียวกัน (RLS ของคนที่ถูกจำกัดนับขาด = ลบบัญชีที่มีบิลได้)
- **ฟอร์มคู่ค้า** ใช้กติกาเลขภาษี/สาขาชุดเดียวกับฟอร์มลูกค้าฝั่งขาย (`lib/shared/taxCustomer` · S13): ช่องติ๊ก *ไม่มีเลขประจำตัวผู้เสียภาษี* · สำนักงานใหญ่/สาขาที่ + เลขสาขา · เดิมบังคับ 13 หลักทุกกรณี (คู่ค้าบุคคลทั่วไปบันทึกไม่ได้ · บทเรียน D86) และช่องสาขาเป็นข้อความอิสระ · `branchFormOf()` แปลงค่าที่บันทึกไว้กลับเป็นฟอร์ม 🪤 สาขาที่ไม่มีตัวเลข (เช่น "สาขาบางนา") ไม่เดาว่าเป็นสำนักงานใหญ่ ให้ฟอร์มฟ้อง · ลบคู่ค้าใช้ `useConfirm()` แทน `window.confirm()` (D96)
- **จัดหน้า**: บัญชีเงิน → คู่ค้า → หมวด/อัตรา · การ์ดหมวดรับวัตถุดิบเข้าสต็อกผลิต **โชว์เฉพาะลูกค้าที่มีโมดูลผลิต** · บันทึกแล้ว `router.refresh()` ให้แท็บอื่นเห็นค่าใหม่ทันที (เลิกข้อความ "รีเฟรชหน้าเพื่อให้แท็บอื่นเห็น")
- ✅ 0089 ลงครบ 2 DB (สำรองไว้ `D:/insep-erp-backup/2026-10-24-0089`) · `db:audit-grants` ผ่าน · `test:tenant` **409** (`bank-account-admin` 10 ข้อ: เปลี่ยนชื่อแล้วบิล/ขาเงินเดือน/ค่าตั้งตามไปหมด · ซ้ำ/ไม่มีสิทธิ์/ถูกจำกัด = ปฏิเสธและไม่มีอะไรขยับ · ลบได้เฉพาะที่ไม่มีใครใช้) · test **1794** (golden **A25** + `taxCustomerForm`) · build/lint ผ่าน
- ✅ **เทสบนจอ (siamdist)**: ชื่อซ้ำ → error ไทยในป๊อปอัพ · เพิ่ม → แถวใหม่ "ยังไม่มีรายการ" · บัญชีจริงปุ่มลบเทาพร้อมเหตุผล · เปลี่ยนชื่อ → สำเร็จ · ปิดใช้ → หายจากตาราง (มีช่องติ๊กแสดง) และหายจากช่องบัญชีของหน้าบันทึก · ลบ → หาย · ฟอร์มคู่ค้า: ลูกค้าทั่วไปเปิดมาติ๊ก "ไม่มีเลข" ให้เอง · เอาติ๊กออกแล้วบันทึก → ฟ้อง 13 หลัก · console ไม่มี error
- 🐛 เจอ 1 (แก้แล้ว): บัญชีที่ยังไม่มีบิล เปลี่ยนชื่อแล้วขึ้น *"แก้ตามในบิล 0 รายการ"* → `renameWarnText()`/`renameDoneText()` ใน lib + เทสล็อก
- ชุดเทส `docs/TESTING.md` ส่วนที่ 83

### D126 — บาร์: ประวัติราคารับของ + ประวัติเป็นป๊อปอัพ (ไม่มี migration, 2026-10-23)

- **ที่มา**: ผู้ใช้ถามว่าเช็คราคาวัตถุดิบที่เคยรับของได้ไหม → `bar_receive` เก็บทุกครั้งมาตั้งแต่ 0064 (วันที่ · `qty_pack` · `qty` · `cost_total` · ร้าน · หมายเหตุ) **แต่ไม่มีโค้ดไหนอ่านเลย** (ตระกูล D74/D77) · ปุ่ม "ประวัติ" เดิมอ่าน `bar_move` ที่มีแต่จำนวน และเปิดเป็นกล่องต่อท้ายตาราง ต้องเลื่อนลงล่างสุดถึงเจอ
- **ทำ**: ปุ่ม ประวัติ → ป๊อปอัพ `ItemHistoryModal` 2 มุมมอง **ราคารับของ** / **ความเคลื่อนไหวสต็อก** · ข้อมูลเก่าขึ้นครบตั้งแต่วันแรกโดยไม่ต้องแตะ DB
- 🚨 **ราคาเฉพาะ `bar.config`** (คนเดียวกับที่เห็นคอลัมน์ต้นทุน) — `itemReceivesAction` ตรวจสิทธิ์ที่ server · พนักงานบาร์ไม่เห็นปุ่มสลับและป๊อปอัพไม่ยิง action ราคาเลย (`skip`)
- 🪤 **ราคาต่อหน่วยซื้อคิดจากแถวนั้นเอง** (`qty / qty_pack` = ขนาดขวดของล็อตนั้น) **ห้ามใช้ `packSize` ปัจจุบัน** — เคยเปลี่ยนขวด 700→750 แล้วราคาต่อขวดของล็อตเก่าจะถูกหารผิดขนาดเงียบ ๆ
- ▲▼ เทียบ **ราคาต่อหน่วยฐาน** กับครั้งก่อนที่**กรอกราคา** (ข้ามครั้งที่ไม่กรอก/ของแถม) · ไม่กรอกราคา = แสดง "ไม่ได้กรอกราคา" **ไม่ใช่ 0.00** (ไม่รู้ ≠ ฟรี · D86) · เรียงใหม่สุดก่อนด้วยวันที่+id ใน lib (ไม่พึ่งลำดับจาก DB · D86/D107)
- `lib/bar/receiveHistory.ts` golden **B22** · ชั้นแสดงผลล้วน ห้ามเอาไปคิดต้นทุน
- ⚠️ **ช่องโหว่เดิมที่เห็นระหว่างทาง (ไม่ได้แก้)**: RLS ของ `bar_receive`/`bar_item` เป็น `bar.read` ⇒ ต้นทุน "ซ่อน" จากพนักงานบาร์ได้แค่ชั้นแอป (`stripCost`) ยิง API ตรงยังอ่านได้ · ปิดจริงต้องแยกคอลัมน์ต้นทุนออก/ทำ view — รอผู้ใช้ตัดสินว่าสำคัญแค่ไหน
- test **1806** · build/lint ผ่าน · ชุดเทส `docs/TESTING.md` ส่วนที่ 84

### D127 — บาร์: เหล้าประจำบ้าน · ชุดตกแต่ง · แถบปุ่มลัดในหน้าสร้างเมนู (0090, 2026-10-24)

- **ที่มา**: ผู้ใช้ขอ 3 อย่างที่แตะหน้าสร้างเมนู/สูตร ก่อนจะลงสูตรค็อกเทลชุดใหม่ — (1) ช่อง House Gin/Vodka/… ชี้ขวด 1 ตัว สูตรอ้างช่องแทนขวดยี่ห้อ เปลี่ยนขวด = ทุกเมนูเปลี่ยนตาม (2) ชุดตกแต่ง กดแล้วบวกเข้าบรรทัดของวัตถุดิบนั้น (3) แถบปุ่มลัด House / ใช้บ่อย / ตกแต่ง เหนือช่องค้น
- **ผู้ใช้ตัดสิน (2026-10-24)**: ช่อง**ต้องมีขวดตั้งแต่สร้าง** (`item_id not null` ⇒ ไม่มีสถานะช่องว่างที่ขายแล้วต้นทุน 0 เงียบ ๆ) · **ลบช่องที่มีสูตรอ้าง = บล็อก + บอกรายชื่อเมนู** · ชุดตกแต่งที่ไม่ตัดอะไร **ไม่ต้องมี** (อยากนับต้นทุนจริงตั้งเป็นเศษของลูก) · ลำดับปุ่ม **จัดเองด้วย ▲▼**
- **โครงสร้าง**: `bar_house_slot` · `bar_recipe_slot` (บรรทัดสูตรที่อ้างช่อง) · `bar_garnish` · `bar_item.pin_sort` · ★ **ไม่ผ่าตัด PK ของ `bar_recipe`** — แยกบรรทัดช่องไว้ตารางของตัวเอง สูตรเดิมทุกเมนูทำงานเหมือนเดิมเป๊ะ · ตัวรวมสองตารางมี**ที่เดียว**ใน SQL คือ `bar_menu_lines()` (ใช้ทั้งคิดต้นทุนและตัดสต็อกใน `fn_bar_add_lines`) ฝาแฝดฝั่งจอคือ `resolveRecipe()` (golden **B23**) · `test:tenant` เทียบต้นทุนสองฝั่งให้ตรงกัน
- 🚨 **ชนิดข้อมูลบังคับให้แปลงช่องก่อนใช้**: `BarRecipeLine` เป็น union (`itemId` หรือ `slotId`) ⇒ โค้ดที่หยิบ `itemId` ไปใช้ตรง ๆ build ไม่ผ่าน (D84) — TS ฟ้องครบทุกจุดที่ต้องแก้ · `stockPlan`/`shortages`/`lineCost`/`cartCost`/`recipeUseCount` รับ `slots` **บังคับ** (ไม่มีค่าปริยาย) — เทส golden B2/B3 เดิมแก้แค่เติมอาร์กิวเมนต์ `[]` **ค่าที่คาดหวังไม่ถูกแตะ**
- 🚨 **หน่วยของช่อง** (ไม่อยู่ในโจทย์): "House Gin 45" เขียนตอนขวดเป็น ml ถ้าเปลี่ยนเป็นขวดที่ตั้งหน่วย "ขวด" = ตัด 45 ขวดต่อแก้ว โดยไม่มีอะไรฟ้อง (อาการเดียวกับ D104) → ช่องที่มีสูตรอ้าง **เปลี่ยนได้เฉพาะขวดหน่วยเดียวกัน** · ด่านที่ DB ด้วย trigger `bar_house_slot_unit_guard` (ยิง API ตรงก็ไม่รอด) · ดร็อปดาวน์ขวดกรองให้เหลือแค่หน่วยเดียวกัน · การล็อกหน่วยของวัตถุดิบ (D104) **นับการอ้างผ่านช่องด้วย** และบอกทางแก้ให้ถูก (เปลี่ยนขวดของช่อง ไม่ใช่ไล่แก้สูตร)
- 🔴 **เจอระหว่างทาง: ยกเลิกรายการ/บิลคืนสต็อกตาม "สูตรปัจจุบัน" ไม่ใช่ตามที่ตัดไปจริง** — มีมาตั้งแต่ 0065 (แก้สูตรแล้วยกเลิกบิลเก่า = คืนผิดจำนวน) แต่ช่องทำให้หนักขึ้น: เปลี่ยนขวด House Gin แล้วยกเลิกบิลเก่า = **ของถูกคืนเข้าขวดใหม่ผิดยี่ห้อ** = บิลเก่าขยับ ซึ่งขัดกับสิ่งที่ผู้ใช้สั่ง → `bar_move.ref_line` ผูกการตัดกับบรรทัดบิล + `bar_sale_item.moves_linked` · บรรทัดตั้งแต่ 0090 คืนตาม `bar_move` จริง · 🚨 **บรรทัดเก่าก่อน 0090 คืนตามสูตรแบบเดิม** (ไม่มีร่องรอยรายบรรทัด — ไม่เดา) · `ref_line` เขียนด้วย `currval()` ของแถวที่ `bar_apply_move` เพิ่งเขียน ⇒ **ไม่แตะ `bar_apply_move`** (definer ที่ปิดแล้วใน 0073)
- 🐛 **เจอของเดิม**: เลือกวัตถุดิบเดียวกัน 2 บรรทัด → บันทึกเมนูชน PK แล้วขึ้นแค่ *"มีข้อมูลนี้อยู่แล้ว"* ไม่บอกว่าซ้ำตรงไหน (ชุดตกแต่งทำให้เจอบ่อยขึ้น) → `cleanRecipe` **รวมบรรทัดซ้ำ** + `duplicateRows()` บอกบนจอ
- **ชุดตกแต่งบวกเข้าบรรทัดเป็นเลขธรรมดา** (ผู้ใช้สั่ง ไม่แยกบรรทัด) ⇒ แก้จำนวนของชุดทีหลัง **เมนูที่สร้างไปแล้วไม่เปลี่ยน** — การ์ดบอกไว้ตรง ๆ · 🪤 บรรทัดที่อ้าง**ช่อง**ซึ่งชี้ขวดเดียวกับชุดตกแต่ง ไม่นับเป็นบรรทัดเดียวกัน (ช่องเปลี่ยนขวดได้ ชุดผูกตายตัว) แต่ตอนตัดสต็อกรวมต่อขวดอยู่แล้ว
- **ปุ่มลัด**: กด House/ใช้บ่อยซ้ำ = ไปที่บรรทัดเดิม **ไม่สร้างบรรทัดซ้ำ** · ใส่แถวว่างก่อนต่อท้าย · 🪤 แถวที่พิมพ์ค้างไว้ไม่ใช่แถวว่าง (ห้ามเขียนทับ) · โฟกัสช่องปริมาณให้ (มือถือ = คีย์บอร์ดตัวเลขขึ้นทันที) · ปุ่มสูง 44px บนจอแคบ · ไม่มีปุ่มลัดเลย = บอกว่าตั้งได้ที่ไหน (D92) · ชุดตกแต่ง/ใช้บ่อยที่วัตถุดิบปิดใช้ = ไม่ขึ้นเป็นปุ่ม แต่การ์ดตั้งค่าบอกเหตุผล · ช่อง House ขึ้นเสมอแม้ขวดปิดใช้ (ช่องยังตัดขวดนั้นจริง)
- **ตั้งค่า**: 3 การ์ดในแท็บตั้งค่าบาร์ **บันทึกแยกทีละการ์ด** (บอกบนจอ — ไม่ผูกกับปุ่มบันทึกการตั้งค่าเดิม) · RPC **INVOKER** 3 ตัว `fn_bar_save_house_slots/garnishes/pins` (ทั้งชุด transaction เดียว · `bar_guard(…,'bar.config')`) · RLS: ช่อง/ชุดตกแต่ง เขียนต้อง `bar.config` · บรรทัดสูตรที่อ้างช่อง `bar.write` เท่ากับ `bar_recipe` (พนักงานบาร์สร้างเมนูจากหน้าขายได้) · audit trigger ครบ 3 ตาราง (เปลี่ยนขวดในช่อง = ต้นทุนทุกเมนูเปลี่ยน ต้องตอบได้ว่าใครเปลี่ยน)
- **แสดงผล**: แท็บเมนู & สูตร ใต้ชื่อเมนูขึ้นสูตรเป็นบรรทัดเดียว *House Gin (Gordon's) 45 ml · …* (`recipeText`) · การ์ดสูตรในหน้าขาย/หน้าลูกค้าใช้ข้อความชุดเดียวกัน (เดิมเขียนเองคนละที่ และจะขึ้น `undefined` กับบรรทัดช่อง)
- **ทะเบียนตาราง** (กับดัก D79): `TENANT_TABLES` · `AUDITED_TABLES` · `ENTITY_SCOPED_TABLES` · `RESTORE_ORDER` · `backup-tables` · harness · `fn_mig_truncate` (ยกด้วยสคริปต์ + revoke ซ้ำ D99) · grant ในไฟล์เดียวกัน (D118) · `cleanup_test.sql` ลบช่อง/ชุดตกแต่งก่อนวัตถุดิบ (FK restrict)
- migration ยก `fn_bar_add_lines`(0068) · `fn_bar_void_line`(0065) · `fn_bar_void_sale`/`fn_bar_save_menu`(0067) · `fn_mig_truncate`(0076) ด้วย `scripts/gen/gen-0090.mjs` + `diff` เทียบต้นฉบับ (เปลี่ยนเฉพาะจุดที่ตั้งใจ)
- ✅ **เทสเบราว์เซอร์ส่วนที่ 85 ผ่าน (siamdist)**: ไม่เลือกขวด/ชื่อซ้ำ → ปุ่มบันทึกเทาพร้อมเหตุผล · ปุ่มลัดโฟกัสช่องปริมาณจริง กดซ้ำไม่เพิ่มบรรทัด · ชุดตกแต่ง 2 ครั้ง = 0.5 บรรทัดเดียว · ต้นทุน 68.50/% 36.6/ราคาแนะนำ 250 คิดเองตรง · มะนาวซ้ำถูกรวมเป็น 1.5 แถวเดียวใน DB · ขายบิล 1 ตัดจินทดสอบ −45 · เปลี่ยนขวด → บิล 2 ตัดยี่ห้อ 2 −45 ต้นทุนบิล 1 คงที่ 73.50 · 🚨 **ยกเลิกบิล 1 คืนเข้าจินทดสอบ (ขวดที่ตัดจริง) ยี่ห้อ 2 ไม่ขยับ** · มือถือ 375 px ปุ่มสูง 44 ไม่ล้นจอ ช่องปริมาณ `inputmode=decimal` · 🐛 เจอ 2 จุดเล็ก แก้แล้ว: (1) บรรทัด House ที่กรอกบรรทัดแรก เปิดแก้แล้วไปอยู่ท้ายสูตร (ไม่มีคอลัมน์ลำดับบรรทัด — data.ts ต่อบรรทัดช่องท้าย) → ให้บรรทัดช่องขึ้นก่อน (เหล้าฐานอยู่บนสุด) (2) ปุ่มลัดมีแค่ `title` → โปรแกรมอ่านหน้าจออ่านคำอธิบายแทนชื่อ → เติม `aria-label` · เก็บกวาดข้อมูลเทสครบ สต็อกกลับค่าตั้งต้น
- test **1860** (golden **B23** 29 · **B24** 20) · `test:tenant` **430** (`bar-house-slot` 18 — ผ่านรอบแรก) · 0090 ลงครบ 2 DB (สำรองไว้ `D:/insep-erp-backup/2026-10-24-0090`) · `db:audit-grants` ✅ · ชุดเทส `docs/TESTING.md` ส่วนที่ **85**

### D128 — บาร์: หน้าสต็อกแบบสลับทีละส่วน + ช่องค้นทุกส่วน (ไม่มี migration, 2026-10-25)

- **ที่มา**: ผู้ใช้บอกว่าวัตถุดิบเยอะแล้วหน้าสต็อกยาวมาก — ไล่แล้วยาวเพราะ**ตารางยาวเท่าจำนวนวัตถุดิบมี 2 ชุด** (ทะเบียน + นับสต็อก) และการ์ดรับของที่ใช้บ่อยจมอยู่ตรงกลาง
- **ผู้ใช้เลือกแบบ B** (สลับทีละส่วน) แทนแบบ A (แถบกระโดด หน้ายังยาว) · แถบ **วัตถุดิบ (N) | รับของเข้า | นับสต็อก** ผูก URL `?view=` (รีเฟรช/ลิงก์ตรงได้ · ค่าแปลก = วัตถุดิบ) · คนดูอย่างเดียวไม่มีแถบ
- 🚨 **ทุกส่วน mount ค้าง ซ่อนด้วย CSS** — สลับส่วนแล้วของที่กรอกค้างต้องไม่หาย · ส่วนที่มีของค้างขึ้นจุดเหลือง (การ์ดรายงานผ่าน `onDirty`) · 🪤 callback ต้องคงที่ด้วย `useCallback` — การ์ดเรียกใน effect ที่มี cleanup ถ้าเป็น arrow ใหม่ทุก render จะวนตั้ง false/true ไม่จบ
- **ช่องค้น**: ทะเบียน (ชื่อ + ชิป ทั้งหมด/ใกล้หมด/เลิกใช้ · ใช้ร่วมกับโหมดแก้ไข) · นับสต็อก (ชื่อ + ชิป ทั้งหมด/ที่กรอกแล้ว/ใกล้หมด) · รับของเข้า = ช่องวัตถุดิบเป็น **`Combobox` ตัวเดียวกับหน้าขาย** (ผู้ใช้เลือก) — พิมพ์ค้นแล้วกดเลือก · 🚨 พิมพ์ค้างแล้วไม่เลือก = ช่องว่าง (ไม่เดา = ไม่รับของเข้าผิดขวด) · 🪤 **เลิกใช้ตารางในการ์ดรับของ** เพราะกล่องห่อตาราง (overflow) ตัดป๊อปอัพรายการทิ้ง → แถว flex ตัดบรรทัดเองบนจอแคบ
- 🚨 **การกรองซ่อนแถวบนจอเท่านั้น** — `planCount`/`planItemEdits` ยังคิดจากทุกแถว ⇒ แถวที่กรอก/แก้แล้วถูกกรองซ่อนยังถูกบันทึก **ต้องบอกบนจอ** (`hiddenPendingText`) · 🚨 **เลขแถวคงเลขเดิมแม้กรองอยู่** (error ของการบันทึกอ้าง "แถว 7" — นับใหม่ = ผู้ใช้ไปแก้ผิดแถว) · ค้นไม่เจอบอก "ทั้งหมด N รายการ" ไม่ใช่ "ยังไม่มีวัตถุดิบ" (คำโกหก) · โหมดแก้ไขกรองด้วย**ชื่อที่บันทึกไว้** (แก้ชื่อแล้วแถวไม่หายกลางคัน)
- `lib/bar/stockNav.ts` golden **B25** (14) · ✅ เทสเบราว์เซอร์แล้ว (siamdist · ไม่ได้บันทึกอะไรจริง) · test **1875** · build/lint ผ่าน · ชุดเทส `docs/TESTING.md` ส่วนที่ **86**

### D129 — บาร์: ห้องทดลอง — ลองชงสูตรใหม่ · ใช้ทำคอนเทนต์ · สรุปทุน (0091, 2026-10-25)

- **ที่มา**: ผู้ใช้คิดสูตรใหม่และชงถ่ายคอนเทนต์เป็นประจำ อยากรู้ว่าเสียทุนไปเท่าไร · ของเดิมทำได้ 2 ทางที่ไม่ดีทั้งคู่ — บิล "แถม" (ปนยอดขาย/เลขใบเสร็จ/แดชบอร์ด) หรือนับสต็อกเหตุผล "ชิม/เทสต์" (เก็บแค่จำนวน ไม่มีตัวเงิน ต้องคิดสูตรเอง) · ไม่ลงเลย = ไปโผล่เป็นของหายตอนนับสต็อก
- **ผู้ใช้แก้ดีไซน์ของผม**: ผมเสนอแยก "สูตรดราฟต์" กับ "ชงทดลอง" เป็น 2 ส่วน ผู้ใช้ชี้ว่า *"ตอนเริ่มบันทึกก็คือตอนลองชงแล้ว … ดูทำงานหลายหน้าเกิน"* → **ลองชง 1 ครั้ง = บันทึกสูตร + ตัดสต็อก + แช่ทุน ในป๊อปอัพเดียว** · การ์ดสูตรมีหลายรอบ · โน้ตเขียนทีหลังได้ (ชงก่อน ชิมทีหลัง) · **ส่งขึ้นเมนูอยู่บนการ์ดสูตร** (ผู้ใช้ขอ) เลือกรอบได้
- **ผู้ใช้ตัดสิน**: หมวดตั้งเองได้แบบ **ก** (รายการหมวด · ＋ หมวดใหม่ จากหน้าบันทึก) · รอบทดลองลงหมวด **ทดลองสูตร** เสมอ ไม่มีช่องเปลี่ยน (*"ทำเพื่อทดลองเป็นหลัก แค่ได้คอนเทนต์แถม"*) · ใช้เมนูที่มีตัด**วัตถุดิบเดี่ยว**ได้ด้วย · **ไม่ลงบัญชี** (ซื้อวัตถุดิบเข้าบาร์ลงค่าใช้จ่ายไปแล้ว — ลงอีก = นับซ้ำ) · **แดชบอร์ดแยกบรรทัด ไม่หักกำไรขั้นต้นของการขาย** · สิทธิ์: `bar.write` ลองชง/ใช้/ส่งขึ้นเมนู/เพิ่มหมวด · **ทุนเห็นเฉพาะ `bar.config`** (ตัดเป็น 0 ที่ server ก่อนส่ง) · แก้/ลบหมวด และลบย้อนหลังต้อง `bar.config` · ของทำเองในร้าน (ไซรัป/infused) ยกไปรอบหน้า
- **โครงสร้าง**: `bar_lab_category` · `bar_lab_recipe` (การ์ด · สถานะ กำลังลอง/ขึ้นเมนูแล้ว/เลิกลอง CHECK ไทย) · `bar_lab_use` (1 แถว = ตัดสต็อก 1 ครั้ง · รอบทดลอง = มี `recipe_id`+`round_no` · unique ต่อสูตร) · `bar_lab_use_line` (snapshot ชื่อ/หน่วย/ปริมาณ/ทุน · บรรทัดช่อง House เก็บทั้ง `slot_id` และขวดที่ตัดจริง) · `bar_move.reason` เพิ่ม **ห้องทดลอง** (CHECK เดิมเป็น inline ไม่มีชื่อ → หาชื่อจาก catalog แล้ว drop)
- 🚨 **ไม่มี policy เขียน** — ทุกการเขียนผ่าน RPC definer (`fn_bar_lab_round/use/delete_use/update_use/update_recipe/promote/add_category/save_categories`) เพราะการตัดสต็อกต้องผ่าน `bar_apply_move` ที่ปิดแล้ว (0073) และกติกาสิทธิ์ลบ (ต่อคน/ต่อเวลา) เขียนเป็น policy ไม่ได้ · `test:tenant` พิสูจน์ว่าแก้ `cost_total` ตรงผ่าน API ไม่ได้แม้เป็นเจ้าของ · ตัวช่วยภายใน 3 ตัว (`bar_lab_ensure_categories/next_id/cut_line`) revoke จาก anon/authenticated (D99)
- 🚨 **แช่ทุน ณ ตอนตัด** (D75) — แก้สูตรรอบใหม่/เปลี่ยนขวด House/ราคาขยับ ตัวเลขเก่าไม่ขยับ (เทสยืนยัน) · คิดสดได้เฉพาะ "พรีวิวก่อนกด" (`previewUseCost` ฝาแฝดของ SQL)
- 🚨 **ลบรายการคืนของตาม `bar_move` จริง** (`ref_no = use_id` · แพตเทิร์น D127) — เปลี่ยนขวด House แล้วลบรายการเก่า = คืนเข้าขวดเดิม (เทสยืนยัน) · **ลบได้เอง**: คนที่ลง ภายใน 12 ชม. (ชงผิด/กดซ้ำ) · นอกนั้น `bar.config` · ลบรอบสุดท้ายของสูตร = การ์ดหายด้วย (ป๊อปอัพบอกก่อน)
- **ส่งขึ้นเมนู** = `fn_bar_lab_promote` เรียก `fn_bar_save_menu` ตัวเดิมแล้วผูกการ์ด ใน transaction เดียว (เมนูไม่เกิด = การ์ดไม่เปลี่ยน) · หน้าจอใช้ **`MenuModal` ตัวเดียวกับแท็บเมนู** (export + `prefill`) ห้ามก๊อป (D42)
- **ใช้สูตรทดลองทำคอนเทนต์** = สูตรรอบล่าสุด · บรรทัดช่อง House แปลงเป็นขวดตอนนี้ (ช่องถูกลบ → ขวดที่ตัดในรอบนั้น) · ทุนพัฒนาของสูตร = รอบทดลองเท่านั้น (เอาไปถ่ายคอนเทนต์คือการใช้ ไม่ใช่การพัฒนา)
- 🐛 **เจอตอนเทสเบราว์เซอร์ แก้แล้ว**: (1) ช่องกรอกสูตรยืมจากหน้าเมนู ขึ้นประโยค *"บันทึกได้ แต่เมนูนี้จะไม่ตัดสต็อก"* ซึ่งผิดในห้องทดลอง (บันทึกไม่ได้ถ้าไม่มีสูตร · ขัดกับบรรทัด "ยังกรอกไม่ครบ") และมีปุ่ม **ใช้ราคานี้** ที่กดแล้วไม่เกิดอะไร (ไม่มีช่องราคา) → `RecipeEditor mode="lab"` โชว์แค่ทุนต่อแก้ว (2) ส่งขึ้นเมนู/เลิกลองแล้ว **การ์ดหายจากจอทันที** เพราะตัวกรองปริยาย "กำลังลอง" → สลับตัวกรองตามสถานะใหม่เอง · ⚠️ **เห็นครั้งเดียว ทำซ้ำไม่ได้**: กดตัดสต็อกแล้วหน้าเด้งไป `/` (บันทึกสำเร็จ) ลองซ้ำทั้งคลิกจริงและกดผ่านโค้ด 2 รอบไม่เกิดอีก — สงสัยเครื่องมือเทส ยังไม่ยืนยัน
- ✅ **ตัวเลขบนจอตรงกับ DB ทุกจุด** (siamdist): รอบ 1 ทุน 104 · รอบ 2 = 44 · คอนเทนต์พรีวิว 157 = ตัวจริง 157 · จิน 445→235 (60+30+90+30) · สรุป 310 แยกหมวด/สูตร/งานถูก · แดชบอร์ดแยกบรรทัด กำไรขั้นต้นไม่ขยับ · ส่งรอบ 1 ขึ้นเมนูได้สูตรรอบ 1 ราคาแนะนำ 190 · เก็บกวาดแล้ว สต็อกกลับค่าตั้งต้น
- `lib/bar/lab.ts` golden **B26** (16) · `tests/tenant/bar-lab.test.ts` 13 (ผ่านรอบแรก) · test **1895** · `test:tenant` **447** · 0091 ลงครบ 2 DB (สำรอง `D:/insep-erp-backup/2026-10-25-0091`) · `db:audit-grants` ✅ · ชุดเทส `docs/TESTING.md` ส่วนที่ **87**

### D130 — บาร์: ของทำเองในร้าน — ไซรัป · infused · cordial (0092, 2026-10-25)

- **ที่มา**: ต่อจากห้องทดลอง (D129) — สูตรใหม่มักต้องทำของในร้านเพิ่ม · เดิมต้องเพิ่มเป็นวัตถุดิบธรรมดาแล้วเดาต้นทุนเอง
- **แนวคิด**: ของทำเอง = **วัตถุดิบตัวหนึ่งใน `bar_item`** ต่างแค่ของเข้าสต็อกด้วย "ทำล็อต" แทนการซื้อ ⇒ ใช้ในสูตรเมนู/ห้องทดลอง/ปุ่มลัด/นับสต็อกได้ทันที **ไม่ต้องแก้หน้าเมนูหรือหน้าขายเลย**
- **ผู้ใช้ตัดสิน**: สูตรมาตรฐานต่อ 1 ล็อตแก้ได้ภายหลัง (มีผลกับล็อตถัดไป) · ทำทีละน้อยได้ (0.3 ล็อต) · **ปริมาณที่ได้จริงกรอกทุกครั้ง** · **ไม่นับค่าแรง/ค่าแก๊ส** · **อายุของ/หมดอายุยกไปรอบหน้า** (ทำพร้อมน้ำผลไม้/ซอส) · ยกเลิกล็อตที่เสร็จแล้วได้เฉพาะตอนเป็นการเคลื่อนไหวล่าสุด · พนักงานบาร์ตั้งสูตร/ทำล็อตได้ ทุนเห็นเฉพาะ `bar.config` · **เพิ่มปุ่มเริ่มแช่** (ผมเสนอ: โฟลวเดิมทำให้สต็อกไม่ตรงของจริงตลอดช่วงแช่หลายวัน + ต้องจำว่าวันแรกใส่อะไร)
- **2 ปุ่ม**: **ทำเสร็จแล้ว** (ตัดวัตถุดิบ + เข้าสต็อกทันที) · **เริ่มแช่** (ตัดวัตถุดิบวันเทลงโหล — สต็อกตรงของจริงตั้งแต่วันแรก · ล็อตไปอยู่กล่อง "กำลังแช่" · กด **เสร็จแล้ว** ตอนกรอง ใส่ปริมาณที่ได้ → เข้าสต็อก) · ยกเลิกล็อตที่แช่อยู่ได้ทุกเมื่อ (คืนวัตถุดิบเป๊ะ เพราะยังไม่มีของออกมาปนทุนเฉลี่ย)
- 🚨 **ทุนเฉลี่ยใช้สูตรเดียวกับรับของเข้า** — ตอนเสร็จเรียก `fn_bar_receive` ตัวเดิม (source `ทำเองในร้าน` · note = เลขล็อต) ⇒ สูตรทุนเฉลี่ยมีที่เดียว (golden B3) และล็อตขึ้นใน **ประวัติราคารับของ** (D126) เองโดยไม่ต้องแก้หน้านั้น
- 🚨 **ทุนต่อหน่วย = ทุนวัตถุดิบที่ใช้จริง ÷ ปริมาณที่ได้จริง** — เคี่ยวแล้วงวดเหลือน้อยกว่าสูตร ทุนต่อ ml ต้องแพงขึ้นตามจริง · ทุนล็อตแช่ ณ วันตัดวัตถุดิบ (D75)
- 🚨 **ยกเลิกล็อตที่เสร็จแล้ว** = ได้เฉพาะเมื่อแถว `bar_move` ล่าสุดของของทำเองคือการรับเข้าของล็อตนี้ (ไม่มีขาย/รับ/นับ/ใช้ ตามหลัง) → คืนยอด + `cost_per_unit` กลับค่าที่แช่ไว้ก่อนล็อต (`prev_qty`/`prev_cpu`) เป๊ะ + ลบแถวราคารับของ · ไม่งั้นบล็อกและบอกให้แก้ด้วยนับสต็อก (ทุนเฉลี่ยย้อนกลับเป๊ะไม่ได้เมื่อมีการเคลื่อนไหวคั่น) · หน้าจอได้ธง `latest` จาก server ตัดสินด้วยเกณฑ์เดียวกับ SQL · วัตถุดิบคืนตาม `bar_move` จริง (D127)
- **ใช้ตัวเองในสูตรไม่ได้** (CHECK + RPC + ไม่เสนอในช่องค้น) · ใช้ของทำเองตัวอื่นได้ · ลบได้เฉพาะที่ยังไม่เคยทำล็อต (เคยทำแล้ว = ปิดใช้ ประวัติต้องอยู่) · หน่วยเปลี่ยนที่ส่วนวัตถุดิบตามกติกาล็อกหน่วย D104
- **โครงสร้าง**: `bar_prep` (ของทำเอง ↔ `bar_item` · ได้ประมาณต่อล็อต) · `bar_prep_input` · `bar_prep_batch` (สถานะ กำลังแช่/เสร็จแล้ว/ยกเลิก · ทุนแช่ · receive_id · prev_qty/prev_cpu) · `bar_prep_batch_line` (snapshot) · `bar_move.reason` เพิ่ม **ทำของ** · ไม่มี policy เขียน (RPC definer `fn_bar_prep_save/delete/start/finish/cancel` · ตัวช่วย `bar_prep_finish_batch` invoker + revoke D99)
- **หน้าจอ**: ส่วนที่ 4 **ของทำเอง** ในแท็บสต็อก (`?view=prep` · แถบเป็น 2×2 บนมือถือ) · กล่องกำลังแช่บนสุด · การ์ดต่อตัว (คงเหลือ · สูตร · ทุนล็อตล่าสุด · ทำล็อต/แก้สูตร/ประวัติ/ลบ) · ช่องวัตถุดิบใช้ `RecipeEditor` ชุดเดิม `mode="prep"` (ไม่มีประโยค/กล่องของเมนู) · พรีวิวทุนล็อต + ทุนต่อหน่วย + เทียบล็อตก่อน ▲▼
- 🐛 **เจอตอนเทสเบราว์เซอร์ แก้แล้ว**: ทุนต่อหน่วยแสดง 2 ตำแหน่งแบบเงิน (0.1667 → 0.17 · 0.1786 → 0.18) ⇒ เทียบล็อตไม่ได้ และไม่ตรงกับประวัติราคารับของที่แสดง 4 ตำแหน่ง → `perUnitText` 4 ตำแหน่ง
- ✅ **บนจอตรงกับ DB ทุกจุด** (siamdist): 0.5 ล็อต ได้ 140 ml ทุน 25 → 0.1786/ml · เริ่มแช่แล้วไซรัปไม่ขยับแต่วัตถุดิบถูกตัดทันที · เสร็จ 250 ml → คงเหลือ 390 ทุนเฉลี่ย 0.19 (75 ÷ 390) · ประวัติล็อต ▲ 12% · ประวัติราคารับของขึ้น "ทำเองในร้าน · PB…" · ยกเลิกล็อตล่าสุด → 140 @ 0.1786 เป๊ะ วัตถุดิบคืนครบ · มือถือไม่มีเลื่อนแนวนอน · เก็บกวาดแล้ว สต็อกกลับค่าตั้งต้น
- `lib/bar/prep.ts` golden **B27** (18) · `tests/tenant/bar-prep.test.ts` 12 (ผ่านรอบแรก) · test **1917** · `test:tenant` **463** · 0092 ลงครบ 2 DB (สำรอง `D:/insep-erp-backup/2026-10-25-0092`) · `db:audit-grants` ✅ · ชุดเทส `docs/TESTING.md` ส่วนที่ **88**

### D131 — บาร์: บรรทัดสูตรอ้าง "ชุดตกแต่ง" + จำนวนเศษส่วน (0093, 2026-10-26)

- **ที่มา**: D127 ให้ปุ่มชุดตกแต่ง **บวกจำนวนเข้าบรรทัดวัตถุดิบ** เป็นเลขธรรมดา ⇒ แก้สัดส่วนของชุดทีหลัง (มะนาว 1 ลูกได้ 7 แว่น → 8 แว่น) เมนูเดิมไม่ขยับ ต้องไล่แก้ทีละเมนู · ผู้ใช้ขอให้สูตร **อ้างตัวชุด** แบบเดียวกับช่องเหล้าประจำบ้าน
- **ผู้ใช้ตัดสิน**: (1) พิมพ์ **"1/7"** ลงช่องได้ — เก็บทั้งตัวเลข (`qty`) และข้อความ (`qty_text`) ไว้แสดง · (2) **ชุดที่ไม่ตัดสต็อกมีได้** (วัตถุดิบว่าง — เปลี่ยนใจจาก D127) บนสูตรขึ้น "(ไม่ตัดสต็อก)" · (3) **แบบ ก** เปลี่ยนวัตถุดิบของชุดเป็นหน่วยอื่นขณะมีเมนูใช้ → ช่องจำนวนว่าง + เหลืองบอกว่าทำไม + บันทึกไม่ได้จนใส่จำนวนใหม่ · (4) ไม่แตะเมนูเก่าที่บวกเลขไว้ตอน D127 (ผู้ใช้ลงสูตรใหม่เอง)
- **แพตเทิร์นเดียวกับ `bar_recipe_slot`**: ตารางใหม่ `bar_recipe_garnish` (menu × ชุด · `qty` = จำนวน*ชุด*ต่อแก้ว) · FK ไปชุดแบบ restrict · RLS อ่าน `bar.read` เขียน `bar.write` · grant ในไฟล์เดียวกัน (D118) · audit
- 🚨 **ตัวแปลงสูตร → ขวดยังมีที่เดียว** — `bar_menu_lines()` เติมบรรทัดชุด (`rg.qty × g.qty` · กรอง `item_id is not null`) ⇒ `fn_bar_add_lines` / `fn_bar_lab_use` (เมนู) / ยกเลิกบิลคืนตาม `bar_move` ที่ผูก `ref_line` ครอบเองโดยไม่ต้องแก้ · ฝาแฝดฝั่งจอ `resolveRecipe()` (golden **B28**)
- 🪤 **"เมนูนี้มีสูตรไหม" ต้องตัดสินจากแถวสูตร ไม่ใช่จากขวดที่แปลงได้** — เมนูที่สูตรมีแต่ชุดไม่ตัดสต็อกแปลงได้ 0 ขวด ⇒ `exists(bar_menu_lines)` แบบเดิมจะตกไปใช้ต้นทุนตายตัว ขณะที่หน้าจอ (`menuMode` ดู `recipe.length`) บอกว่าใช้สูตร = สองฝั่งตัดสินคนละแบบ (D84) → `bar_menu_has_recipe()` ใช้ใน `fn_bar_add_lines` + `fn_bar_lab_use`
- 🚨 **ตัวเลขเศษส่วนไม่ปัดก่อนคูณ** — 1/7 × 7 แก้วต้องได้ 1 ลูกพอดี · `resolveRecipe` เปลี่ยนการปัดจาก 4 ตำแหน่งเป็น 10 (4 ตำแหน่ง = 0.1429 × 7 = 1.0003) · golden B23 เดิมผ่านโดยไม่แก้ค่า
- **ด่านหน่วย**: หน้าจอจำว่าจำนวนถูกพิมพ์สำหรับหน่วยไหน (`qtyUnit`) แล้วส่ง `qty_unit` ไป RPC · RPC ปฏิเสธถ้าไม่ตรงหน่วยของวัตถุดิบ (กันจอค้างรุ่นเก่า) · 🪤 เลือกแบบนี้แทน trigger "จำนวนต้องเปลี่ยน" เพราะผู้ใช้อาจพิมพ์เลขเดิมในหน่วยใหม่จริง ๆ (1 ลูก → 1 ชิ้น) · ล็อกหน่วยของวัตถุดิบ (D104) นับการอ้างผ่านชุดด้วย และบอกชื่อชุด
- **ลบชุดที่มีเมนูอ้าง = บล็อก + บอกรายชื่อเมนู** (RPC + `garnishEditsError` + ซ่อนปุ่มลบพร้อมเหตุผล) · ข้อความเดียวกับช่องเหล้าประจำบ้าน (`inUseBlock`)
- **ห้องทดลอง**: `bar_lab_use_line` kind ใหม่ **ชุดตกแต่ง** + `garnish_id`/`garnish_qty` (ปริมาณต่อชุด ณ ตอนชง) · ตัวช่วยใหม่ `bar_lab_cut_garnish` (invoker + revoke D99) — ไม่แก้ `bar_lab_cut_line` · ใช้สูตรทดลองทำคอนเทนต์ = ชุด ณ ตอนนี้ (ชุดถูกลบ → ค่าที่จำไว้) · ส่งขึ้นเมนู/ลองรอบใหม่กลับเป็นบรรทัดชุดเดิม
- **ของทำเอง (D130) ไม่ใช้ชุดตกแต่ง** (ส่ง `NO_REFS`)
- **โครงสร้างฝั่ง TS**: `BarRecipeLine` เพิ่มแบบที่ 3 `{garnishId}` · ฟังก์ชันที่รับ `slots` เปลี่ยนเป็น `refs: RecipeRefs` (ลืมส่งชุดตกแต่ง = build ไม่ผ่าน · D84) · `recipeRpcLines()` แหล่งเดียวของ payload (เดิมก๊อป 2 ที่ใน actions) · `lib/bar/fraction.ts` (parse "1/7" · "1 1/2")
- 🐛 **เจอตอนเทสเบราว์เซอร์ แก้แล้ว**: (1) บรรทัดชุดไม่ตัดสต็อกขึ้นว่า *"1 ชุดตอนนี้ตัด ไม่ตัดสต็อก"* → *"ชุดนี้ ไม่ตัดสต็อก"* (2) เปลี่ยนวัตถุดิบเป็นหน่วยอื่นแล้วช่องจำนวนว่าง แต่บรรทัดเหลืองบอกแค่ "ใส่จำนวน" ไม่บอกว่า**ทำไม**ถึงว่าง → *"วัตถุดิบเปลี่ยนจากหน่วย ลูก เป็น ml — จำนวนเดิม (1/7 ลูก) ใช้ไม่ได้แล้ว…"*
- ✅ **บนจอตรงกับ DB** (siamdist): สูตร *จินทดสอบ 45 ml · Lime Wheel × 2 (ชุดละ มะนาวทดสอบ 1/7 ลูก) · ใบมิ้นต์ × 1 (ไม่ตัดสต็อก)* ต้นทุน 55.43 → แก้ชุดเป็น 1/8 เมนูตามเป็น 55.25 · ขาย 8 แก้ว มะนาว 10 → **8 พอดี** จิน 445 → 85 · ยกเลิกบิล คืนครบ · ลบชุดที่ใช้อยู่ = ไม่มีปุ่มลบ + บอกชื่อเมนู · ห้องทดลองคิดทุนชุดถูก · จอ 285 px ไม่เลื่อนแนวนอน · เก็บกวาดแล้ว
- golden **B28** (19) · `tests/tenant/bar-recipe-garnish.test.ts` 16 (ผ่านรอบแรก) · เทสเดิมที่ล็อกพฤติกรรม D127 (ชุดบวกเข้าบรรทัดวัตถุดิบ · ไม่เลือกวัตถุดิบ = บล็อก) ถูกแก้ให้ล็อกกติกาใหม่ · test **1944** · `test:tenant` **480** · 0093 ลงครบ 2 DB (สำรอง `D:/insep-erp-backup/2026-10-26-0093`) · `db:audit-grants` ✅

### D132 — บัญชี: ย้ายบิลไปกิจการอื่นจากหน้าแก้ไขบิล (0094, 2026-10-26)

- **ที่มา**: ผู้ใช้บันทึกบิลผิดกิจการแล้วแก้ไม่ได้ · ไล่แล้วพบว่า `fn_edit_transaction` (0019) **เขียน `entity_id` ได้มาตั้งแต่แรก** และหน้าแก้บิลก็โหลดกิจการเข้า state (`entId`) แล้วส่งกลับทุกครั้ง — **ขาดแค่ช่องเลือกบนจอ** (ตระกูล D74/D77) · ทางเดียวที่มีคือยกเลิกแล้วคีย์ใหม่
- **ทำ**: ช่อง **กิจการ** บนหน้า ค้นบิล → แก้ไข (ซ่อนเมื่อมีกิจการเดียว · D53)
- 🚨 **ย้ายได้เฉพาะบิลที่คีย์เอง** (`source` = `ui`/`migration`) — บิลที่ระบบอื่นสร้างให้ ย้ายแล้วต้นทางยังอยู่ที่กิจการเดิม = สองฝั่งไม่ตรงกันเงียบ ๆ → ปุ่มเทา + บอกว่าไปแก้ที่ไหน (ทุกครั้งที่ปิดปุ่ม ต้องตอบว่าต้องกดอะไรแทน · D88): ขาย (แก้ค่ากิจการรับรายได้ + ยกเลิกออเดอร์) · เงินเดือน (ถอนลงบัญชีที่งวดจ่าย) · จ่ายภาษี (ถอนการจ่าย) · บาร์ (ถอนลงบัญชีวันนั้น) · ผลของการเคลียสำรองจ่าย (ถอนการเคลีย) · source ที่ไม่รู้จัก = ย้ายไม่ได้ (ไม่เดา)
- 🚨 **ออก 50ทวิ ไปแล้ว = ย้ายไม่ได้** — ใบที่อยู่ในมือคู่ค้าเป็นนามกิจการเดิม (เลขชุดของกิจการนั้น) แต่ ภงด.3/53 คิดจากบิล ⇒ ย้ายแล้วใบกับแบบไม่ตรงกัน · ไม่มีปุ่มยกเลิก 50ทวิ ในแอป จึงบอกให้ยกเลิกบิลแล้วคีย์ใหม่
- 🚨 **บิลสำรองจ่ายย้ายไปเป็นของกิจการที่ซื้อให้ไม่ได้** (CHECK `transactions_advance_shape` เคยเด้งเป็นอังกฤษ) · ย้ายคนจ่ายไปกิจการอื่นได้ · VAT ของบิลสำรองจ่ายดูกิจการที่ซื้อให้ (0086) ⇒ ไม่โดนด่าน VAT ตอนย้ายคนจ่าย
- **มี VAT แล้วย้ายไปกิจการไม่จด VAT** = trigger 0036 ปฏิเสธอยู่แล้ว · หน้าจอบอกล่วงหน้าให้เอาติ๊ก VAT ออก
- **เตือนไม่บล็อก**: ยอดแดชบอร์ด/ภพ.30/ภงด. ของทั้งสองกิจการเปลี่ยน (เดือนที่ยื่นแล้วใช้ drift เดิมของ D88) · บัญชีไม่ได้ผูกกับกิจการปลายทาง (🚨 ไม่ล้างบัญชีให้ — เงินออกจากบัญชีนั้นจริง ถ้าเป็นเงินกิจการอื่นควรเป็นสำรองจ่าย · D124) · หมวดจุดชนวนรับวัตถุดิบ = ของในสต็อกผลิตยังอยู่กิจการเดิม (หน้าแก้บิลไม่ forward ซ้ำมาตั้งแต่ 0019)
- **ด่านตัวจริงอยู่ใน `fn_edit_transaction` (0094)** — ยกด้วย `scripts/gen/gen-0094.mjs` คำต่อคำ (D79) · ด่านทั้งหมดอยู่ใต้ `if v_new_entity <> v_old_entity` ⇒ **ไม่ย้ายกิจการ = เส้นทางเดิมทุกบรรทัด** (บิลจากระบบอื่นยังแก้ช่องอื่นได้เหมือนเดิม) · ด่านอยู่**ก่อน** `update` · ยังเป็น invoker (ไม่มี definer ใหม่ D99 · ไม่มีตารางใหม่ D118) · สิทธิ์กิจการ (D120) RLS `tx_w` with check กันอยู่แล้ว
- ★ ประโยคทุกตัวตัดสินที่ `lib/accounting/entityMove.ts` · `MOVABLE_SOURCES` ⇄ `not in (...)` ใน SQL มีเทสอ่านไฟล์เทียบ · โหลดใบ 50ทวิ ด้วย `mustRead` (อ่านไม่ได้ ≠ ไม่มี · D89) + หน้าแก้บิลเพิ่ม `.catch` (เดิมค้าง "กำลังโหลด…" ถ้าอ่านพัง)
- ข้อความหลังบันทึกบอกว่าบิลย้ายไปกิจการไหน — เพราะบิลจะหายจากรายการของกิจการที่เลือกอยู่ (ไม่บอก = ผู้ใช้นึกว่าบิลหาย · บทเรียน D86)
- golden **A26** (18) · `tests/tenant/edit-tx-entity.test.ts` 9 ข้อ (⏳ ยังไม่ได้รัน — container นี้ไม่มี DB) · test **1962**
- ✅ **รันแล้ว (2026-10-26 · ดู D136)**: รอบแรกแดง **เพราะตัวเทสเขียนผิด 2 จุด ไม่ใช่โค้ด** — (1) insert บิลหลายแถวที่คีย์ไม่เท่ากัน → PostgREST ใช้คอลัมน์รวมแล้วแถวที่ไม่มีคีย์ได้ `null` (ไม่ใช่ default) ชน not null → `defaultToNull: false` (2) ข้อผู้ใช้ถูกจำกัดกิจการ คาดว่าได้ error แต่ด่าน "ไม่พบกิจการ" ตอบ `ok:false` ก่อน (RLS ของ `entities` ซ่อนกิจการปลายทาง) — บล็อกถูกแต่คนละชั้น → ตัดสินด้วยแถวไม่ขยับ · เหลือ **8 ข้อ** (vitest นับ 8 · คอมเมนต์เดิมเขียน 9)

### D133 — ไม่โชว์ของโมดูลที่ลูกค้าไม่ได้ซื้อ (ไม่มี migration, 2026-10-26)

- **ที่มา**: ผู้ใช้สั่ง — *"บางเจ้าไม่ได้ทำโรงเหล้าก็ซื้อระบบไปใช้ได้ จะงงเรื่องผลิตกับบาร์เปล่า ๆ"* ยกตัวอย่างหน้าตั้งค่าให้คนที่ไม่ได้ซื้อผลิตกรอกเลขสรรพสามิต แล้วให้ไล่หาจุดอื่น
- **กลับคำตัดสินเดิม**: หน้าแรกเคยโชว์โมดูลที่ยังไม่ได้ซื้อเป็นการ์ดเทา+กุญแจ (ให้เห็นว่ามีของขายเพิ่ม) → **ซ่อน** ใช้ `workspacesFor()` ตัวเดียวกับแถบเมนู · ลบ `workspacesWithLock()` ทิ้ง (การขายโมดูลเพิ่มเป็นงานของเจ้าของระบบ ไม่ใช่ของหน้าจอที่ลูกค้าใช้ทุกวัน)
- **ไล่แล้วเจอเพิ่ม** (ทุกจุด build/lint/test เดิมผ่านหมด):
  1. **ตั้งค่า → กิจการ**: เลขสรรพสามิต (ผลิต) · วิธียื่นแบบภาษี (บัญชี) · เลขนายจ้าง สปส. (เงินเดือน) · ช่องทางโอน + ตัวอย่างหัวกระดาษ + การ์ดผู้ออกเอกสารการค้า + การ์ดรับรายได้ขาย (ขาย) — โชว์ทุกช่องให้ทุกเจ้า
  2. **ตั้งค่า → ผู้ใช้**: มีบทบาท "พนักงานบาร์" / ฝ่ายขาย / เงินเดือน ให้เลือกแม้ไม่ได้ซื้อโมดูลนั้น
  3. **ตั้งค่า → ประวัติการแก้ไข**: ตัวกรองมีตารางผลิต 12 ตัว + บาร์ 16 ตัว
  4. **ตั้งค่า → แจ้งเตือน**: เขียนตายตัวว่าส่ง "ออเดอร์ใหม่ · รับเงิน · จัดส่ง" — ลูกค้าที่ซื้อแค่บัญชีอ่านแล้วนึกว่าไม่เกี่ยว ทั้งที่การเตือนยื่นภาษีส่งทางนี้
  5. 🔴 **บัญชี → บันทึก**: หมวดรายจ่าย **"วัตถุดิบผลิตสุรา"** (ค่าปริยาย D80) ถูกเติมเข้าดร็อปดาวน์ของ**ทุกเจ้า** และถ้าเลือก บิลจะส่งของเข้าสต็อกผลิตที่ไม่มีใครเห็น · การ์ดตั้งค่าซ่อนไว้แล้วตั้งแต่ D125 แต่ตัวหมวดยังทำงาน (ซ่อนที่ตั้งค่า ≠ ปิดของที่มีผล) → `forwardCatsOf(set, hasProduction)` คืนว่างเมื่อไม่มีโมดูลผลิต
  6. **แอปขาย**: ประโยค "สุราจะขึ้นฟอร์ม ภส." · "สต็อกรวม (สุราจากโรงกลั่น …)" · "ส่งข้อมูลให้แอปผลิต" · หมวดเมนูปริยาย **สุรา (ตัดสต็อกผลิต)** ทั้งที่ไม่มีสต็อกผลิตให้ตัด
  7. **ระดับสินค้า**: หน้าล็อกอิน / manifest / metadata เขียนว่า "ระบบจัดการโรงกลั่นสุราคราฟต์" · manifest มีปุ่มลัด "ผลิต" ให้ทุกเจ้า (กดแล้วเด้งกลับหน้าแรก) → ข้อความกลาง + ตัด shortcuts (ไฟล์คงที่ต่อ deployment รู้ไม่ได้ว่าใครซื้ออะไร)
- ★ **ตัดสินที่เดียว** `lib/shared/moduleScope.ts` (`companySectionsFor` · `rolesFor` · `auditTablesFor` · `lineEventsFor`) + `lib/sales/productionText.ts` — หน้าจอถามแค่ "โชว์ไหม" (D84)
- ★ **fail-open** ตาม `hasModule()` (อ่านโมดูลไม่ได้ = โชว์ครบ · D53)
- 🚨 **ซ่อนแค่บนจอ ไม่ลบค่า** — ค่าเดิม (เช่น `excise_id` ของลูกค้าที่เลิกใช้ผลิต) ยังถูกส่งกลับตอนบันทึก · บทบาทเดิมของผู้ใช้อยู่ในดร็อปดาวน์เสมอ · เมนูหมวด "สุรา" ที่มีอยู่แล้วแก้ได้และตัดสต็อกเหมือนเดิม (แพตเทิร์น `accountsFor` D125: ตัดค่าที่เลือกอยู่ทิ้ง = บันทึกทับเงียบ ๆ)
- 🚨 **ลูกค้าที่มีโมดูลผลิต ประโยคทุกตัวเหมือนเดิมเป๊ะ** (เทสล็อก)
- ⏳ **เจอแต่ไม่ได้แก้ (ต้องถามผู้ใช้)**: ลูกค้าที่ซื้อ **ขาย หรือ เงินเดือน แต่ไม่ซื้อบัญชี** ตั้งบัญชีรับรายได้/บัญชีจ่ายเงินเดือนไม่ได้ เพราะเพิ่มบัญชีเงินได้ที่ บัญชี → ตั้งค่า เท่านั้น (การ์ดรับรายได้ขายยังบอกให้ไปที่นั่น) · และบิลที่ระบบลงให้ไม่มีหน้าให้ดู — เป็นเรื่องว่าจะขายโมดูลเดี่ยวแบบนี้หรือไม่
- test **1984** (moduleScope 20 · forwardCats +3 · workspaces แก้ข้อที่ล็อกการ์ดเทา)

### D134 — ป้ายแจ้งผลลอย (toast) แทนแถบในการ์ด · เลิกกล่องของเบราว์เซอร์ทั้งแอป (ไม่มี migration, 2026-10-26)

- **ที่มา 2 เรื่อง**: (1) หนี้ D96 ข้อ ก. — `window.confirm()` ถูกเบราว์เซอร์บล็อกแล้วคืน `false` เงียบ ๆ ⇒ ปุ่มลบ/ยกเลิกกดแล้วไม่มีอะไรเกิดขึ้น (เจอจริงที่แท็บบรรจุ/จ่าย ตอน D99) · (2) ผู้ใช้แจ้ง *"เวลาบันทึกไปแล้วบางทีเราไม่ได้อยู่ตรงที่จะมองเห็นว่าเกิดการบันทึกแล้ว"* และฝั่งบาร์ *"กดไปแล้วไม่รู้แอคชั่นเรียบร้อยหรือยัง"* — ผลการบันทึกเป็นแถบสีในการ์ด (`<Msg>`) เลื่อนจอไปที่อื่นก็มองไม่เห็น
- **ผู้ใช้ตัดสิน**: ป้ายอยู่ **บนกลางจอ** (ล่างชนถาดหน้าขายบาร์บนมือถือ) · **เอาแถบในการ์ดออกเลย** — *"บันทึกสำเร็จมันค้างอยู่ในการ์ดทั้ง ๆ ที่เริ่มบันทึกต่อเลย ไม่ควรมี"*
- **ป้ายลอย** `lib/shared/toast.tsx`: `showToast()` เรียกจากที่ไหนก็ได้ (รวมฟังก์ชันพิมพ์ที่ไม่ใช่ component) ผ่าน window event → `<ToastHost />` ใน layout `(app)` และ `(platform)` · ✅ สำเร็จหายเองใน 3 วิ · ⚠️ บางส่วน / ❌ ไม่สำเร็จ **ค้างจนกด ✕** (`toastLife()`) · z สูงกว่าป๊อปอัพและกล่องยืนยัน · ข้อความซ้ำติดกันแทนที่ ไม่ซ้อน · สูงสุด 3 ป้าย
- ★ **ต่อที่ `useSaver` ตัวเดียว** ⇒ ~50 หน้าจอได้ป้ายโดยไม่ต้องไล่แก้ทีละปุ่ม · ลบ `<Msg>` 71 จุด + ลบ export `Msg` ทิ้ง (เพิ่มกลับ = build ไม่ผ่าน) · หน้าที่เก็บข้อความเอง 4 ไฟล์ (ผู้ใช้ · สำรองข้อมูล · เอกสารสรรพากร · รายงานสรรพสามิต + ปิดเดือน) และป๊อปอัพรับของบาร์ เปลี่ยนเป็น `showToast` · แถบ "โหลดไม่สำเร็จ" (`LoadError`/`mcErr`) **คงไว้** เพราะเป็นสถานะของหน้า ไม่ใช่ผลของการกด
- 🪤 **กับดักที่เจอระหว่างทำ**: `run()` เดิมตั้งเขียวก่อนแล้ว `onOk` ทับด้วยเหลือง "บันทึกได้บางส่วน" บนแถบเดียวกัน (เห็นแค่อันหลัง) — พอเป็นป้ายลอยจะได้ "สำเร็จ" กับ "สำเร็จบางส่วน" ขึ้นคู่กันขัดกันเอง ⇒ เรียก `onOk` ก่อน แล้วขึ้นเขียวเฉพาะเมื่อ `onOk` ไม่ได้ตั้งข้อความเอง (เทสอ่านซอร์สล็อกลำดับ)
- **กล่องยืนยัน 31 จุด / 21 ไฟล์** → `useConfirm()` ตัวเดิม (บาร์ใช้อยู่แล้ว) · ข้อความเดิมทุกคำ (บรรทัดแรก = หัวข้อ) · ปุ่มยืนยันเป็นคำกริยา · 🚨 **ปุ่มแดงเฉพาะที่ทำลายข้อมูล/แตะเงิน/ตัวเลขยื่นราชการจริง** (บทเรียน D97) — "บันทึกว่ายื่นแล้ว" · "ถอนการบันทึกยื่น" · "ล้างฟอร์ม" · "เอาคนออกจากงวดร่าง" · "เปลี่ยนเป็นจด VAT" · "คืนสิทธิ์" เป็นสีปกติ
- 🚨 **ปุ่มปิดของกล่องตั้งชื่อได้แล้ว (`cancelText`)** — การกระทำที่ชื่อ "ยกเลิก…" ใช้ **"กลับ"** ไม่งั้นได้ [ยกเลิกออเดอร์] [ยกเลิก] อ่านแล้วไม่รู้ว่าปุ่มไหนคืออะไร
- หน้าตั้งค่าเงินเดือน: ตัวช่วย `askDelete()` (ฟังก์ชันธรรมดา) → hook `useAskDelete()` ทุกการ์ดที่ใช้วาง `{confirmNode}` เอง · หน้าคลัง: เปลี่ยนชื่อฟังก์ชัน `confirm` → `confirmShip` (ไม่ใช่บั๊ก แต่ทำให้เทสตรวจได้ชัด) · ใน TenantPanel ตัวแปรชื่อ `ask` ชนกับ hook → เปลี่ยนเป็น `ok`
- **`alert()` 8 จุด → `showToast`** (หน้าต่างพิมพ์ถูกบล็อก · เลือกวันที่ลงบัญชีก่อน · คัดลอกไม่สำเร็จ ฯลฯ) · 🔴 เจอระหว่างทาง: ข้อความกันพิมพ์หัวกระดาษเปล่าในแอปขายยังชี้ไป **"บัญชี › ตั้งค่า › ข้อมูลบนเอกสารการค้า"** ซึ่งย้ายไป ตั้งค่า → กิจการ ตั้งแต่ D63 → แก้แล้ว
- **ไล่ปุ่มที่กดแล้วเงียบ**: ทุกจุดที่เรียกบันทึกตรง ๆ มีข้อความอยู่แล้ว ยกเว้น **ลบแถว ภพ.30** (ลบแล้วโหลดใหม่เงียบ ๆ · ลบไม่สำเร็จก็ไม่รู้) → แก้แล้ว · หน้าขายบาร์ทุกปุ่มผ่าน `run()` ของตัวเองซึ่งเรียก `setMsg` ⇒ ได้ป้ายครบ
- **กันซ้ำ** `lib/shared/nativeDialogs.test.ts` อ่านซอร์สทั้ง `app/` + `lib/`: ห้าม `confirm/alert/prompt` ของเบราว์เซอร์ · จำนวน hook กล่องยืนยันต่อไฟล์ต้องเท่ากับจำนวน `{confirmNode}` (ลืมวาง = กดแล้วค้างเงียบ ๆ) · ห้าม `<Msg` · layout ต้องมี `<ToastHost />` · 🚩 **พิสูจน์แล้วว่าจับได้** (ใส่ `confirm("x")` + ลบ `{confirmNode}` ใน MonitorTab ชั่วคราว → แดง 2 ข้อ)
- เทสเดิมที่ล็อกพฤติกรรมเก่า (`aparTab.test.ts` — แถบข้อความต้องอยู่นอกแถวชำระ) ถูกแก้ให้ล็อกกติกาใหม่ · test **1991** · ⏳ ยังไม่ได้เทสเบราว์เซอร์ (container ไม่มี DB)

### D135 — เซสชันหมดอายุแล้วไม่ค้าง "กำลังโหลด…" ตลอดไป (ไม่มี migration, 2026-10-26)

- **ที่มา**: งานค้างใน NEXT_STEPS (เจอตอนเทส D98) — เปิดแอปด้วยคุกกี้เซสชันที่หมดอายุ → ทุก workspace ค้างที่โครงหน้า `WorkspaceSkeleton` ไม่มีข้อความ ไม่เด้ง login · ทางออกเดียวคือกด "ออกจากระบบ" ซึ่งคนที่เจอหน้าค้างไม่รู้ว่าต้องกด · ผู้ใช้สั่งทำต่อ (ข้อ 1.2)
- **ไล่แล้วเจอ 3 ชั้น** (ทุกข้อ build/lint/test เดิมผ่านหมด):
  1. 🔴 **middleware ส่งคุกกี้เก่าต่อให้หน้าเว็บ** — `updateSession` คัดลอก header ไว้ก่อน `getUser()` แล้วใช้สำเนานั้นซ้ำใน `setAll` ⇒ middleware ต่ออายุเซสชันสำเร็จ (เบราว์เซอร์ได้คุกกี้ใหม่) แต่ layout/page ได้**คุกกี้เก่าที่หมดอายุ + refresh token ที่เพิ่งถูกใช้ไปแล้ว** แล้วทุก `createClient()` ในหน้าเดียวขอต่ออายุซ้ำเองด้วยตัวนั้น · ตัวอย่างทางการของ Supabase ส่ง `{ request }` ตรง ๆ แต่เราต้องเขียนทับ `x-tenant-slug` จึงสร้าง `Headers` เอง — และสร้างผิดจังหวะ → `forwardHeaders()` สร้างใหม่**หลัง** `request.cookies.set()` ทุกครั้ง · `x-tenant-slug` ยังถูกเขียนทับจาก host เสมอ (ค่าปลอมจาก client ไม่รอด)
  2. 🔴 **การขอต่ออายุไม่มีเพดานเวลา** — พิสูจน์ด้วย mock server ฝั่ง Auth (auth-js 2.110.7 ที่ติดตั้งจริง): ได้ 400 (token ใช้แล้ว/หมดอายุ) → จบใน ~40 ms ถูกต้อง · **ไม่มีคำตอบกลับ → รอตลอดกาล** · ได้ 5xx → ไลบรารีลองซ้ำเองจน ~30 วิ → `lib/supabase/authFetch.ts` `withAuthTimeout()` เพดาน 10 วิ **เฉพาะ `/auth/v1/`** ส่งผ่าน `global.fetch` ทั้ง middleware และ server client · ยืนยันกับ auth-js จริง: กรณีไม่ตอบเลย จาก "ค้างตลอดกาล" → **จบใน ~30 วิ ได้ `user = null` → เด้ง login** (30 วิ คือรอบลองซ้ำของไลบรารีเอง สั้นกว่านี้ต้องแก้ไลบรารี — ไม่ทำ)
     ★ คำขอข้อมูล (PostgREST/Storage) ไม่ถูกแตะ — รายงานใหญ่ใช้เวลานานได้โดยชอบธรรม · ใช้ AbortController ไม่ใช่ `AbortSignal.any` (middleware รันบน Edge)
  3. 🟡 **ปุ่มออกจากระบบออกไม่ได้เมื่อฝั่ง Auth ล้ม** — `supabase.auth.signOut()` ลบคุกกี้**เฉพาะเมื่อฝั่ง Auth ตอบสำเร็จ (หรือ 401/403/404)** ได้ 5xx/หมดเวลา = คืน error แล้วคงเซสชันเดิม ⇒ กดแล้วติดอยู่ที่เดิม → `signOut` ลบคุกกี้เซสชันเองหลังเรียกเสมอ (`isSessionCookie()` จับเฉพาะ `sb-*-auth-token[.n]` + code-verifier · 🚨 คุกกี้โหมดสว่าง/มืดต้องรอด)
- **ตาข่ายรองรับ** `SlowLoadNotice` บนโครงหน้า: ค้างเกิน **15 วิ** → ป้ายเหลือง *โหลดนานกว่าปกติ* + ปุ่ม **โหลดใหม่** / **ออกจากระบบ** · ★ เพราะหน้าค้างยังเกิดจากเหตุอื่นได้ (เน็ตหลุด · DB แผนฟรีหลับ D60) ไม่ว่าเหตุไหนต้องมีทางออกบนจอ (D92: ทุกครั้งที่ระบบไม่ทำอะไรให้ ต้องบอกว่าทำไม) · 🚨 **ไม่เด้ง login เอง** — ช้าเพราะรายงานใหญ่/เน็ตช้า ≠ เซสชันหมดอายุ (เดาแล้วเตะคนออกกลางงานแย่กว่า) · ประโยคตัดสินที่ `lib/shared/slowLoad.ts`
- redirect ของ middleware พาคุกกี้ที่ Supabase เพิ่งเขียน/ลบไปด้วย (เดิมทิ้ง ⇒ คุกกี้เสียค้างแล้วขอต่ออายุซ้ำทุกคำขอ)
- ★ **ไม่แตะ fail-open/fail-closed เดิม** — ธงโมดูล (D53) และ role (D85) ไม่เปลี่ยน · ไม่มีตรรกะใหม่ใน layout (ตัวเดิม `if (!user) redirect("/login")` ทำงานได้เองเมื่อ `getUser()` ไม่ค้าง)
- 🪤 **ยังพิสูจน์ต้นเหตุตัวจริงบน Supabase จริงไม่ได้** (container ไม่มี DB) — แก้ทั้งตัวที่น่าจะเป็นต้นเหตุ (1) และทำให้ทุกเส้นทางมีจุดจบ (2)(3) + ทางออกบนจอ ⇒ ต้องให้ผู้ใช้ลองในเบราว์เซอร์ (TESTING ส่วนที่ 93)
- กันซ้ำ: `lib/supabase/middleware.test.ts` **ยิง `updateSession` จริง** ปลอมแค่ Supabase ให้ต่ออายุด้วยการเรียก `setAll` แล้วอ่าน header ที่ Next ส่งต่อ (`x-middleware-request-cookie`) · 🚩 **พิสูจน์แล้วว่าจับได้**: เอาโค้ดเดิมกลับมา → แดง 3 ข้อ (คุกกี้เก่า · redirect ไม่พาคุกกี้ · ไม่มีเพดาน) · `authFetch.test.ts` 11 ข้อ · test **2009**

### D136 — เทสเบราว์เซอร์ D132-D135 แล้วแก้ 4 ข้อ: สคริปต์ล้างข้อมูลทดสอบลบข้ามลูกค้า · ประโยค VAT รวมเป็นต้นทุน · ปุ่ม "กลับ" ในบาร์ · ยกเลิกรายการบาร์ไม่ถาม (ไม่มี migration, 2026-10-26)

- **ที่มา**: ทำตาม NEXT_STEPS ข้อ 0.-22 — ลง 0094 ครบ 2 DB · `test:tenant` · เทสเบราว์เซอร์ส่วนที่ 90-93 บน tenant `siamdist` (proof-app) ด้วย `/browser-qa` · ผ่านเกือบทั้งหมด เจอ 4 ข้อด้านล่าง (build/lint/test เดิมผ่านหมดทุกข้อ)
- 🔴 **1. `supabase/seed/cleanup_test.sql` ไม่มีตัวกรอง tenant เลยสักบรรทัด** — ไกด์เทสหลายส่วน (รวมข้อ 0.-22 เอง) สั่งให้รันใน SQL Editor ซึ่งเป็น role postgres ไม่มี RLS ⇒ บนก้อน proof-app ที่มีลูกค้าจริง (`aim`) อยู่ด้วย จะลบ `sales_revenue_*` / `pos_walkin_contact` ของ**ทุก tenant** และ `bar_*` ทั้งชุด โดยไม่มีอะไรฟ้อง · ไฟล์เขียนมาตั้งแต่ยุค tenant เดียวแล้วต่อเติมทีละ D โดยไม่มีใครย้อนดู (คำโปรยบนหัวไฟล์ยังเขียนว่า *"ปลอดภัย ข้อมูลจริงไม่โดน"*)
  - แก้: ทั้งไฟล์อยู่ใน `do $$` บล็อกเดียว · `v_slug` ต้องแก้เอง · **ค่าเริ่มต้นเป็นข้อความที่ไม่มีอยู่จริง** (`<<ใส่ slug…>>`) ⇒ ลืมแก้ = error ทันที ไม่ลบอะไรเลย · ห้ามใช้กับ tenant แพลตฟอร์ม · **ทุก delete/update และทุก subquery** กรอง `tenant_id = v_tenant`
  - 🚩 พิสูจน์บน DB จริงแบบไม่เสียของ: รันไฟล์แบบไม่แก้ slug → plpgsql parse ทั้งบล็อกแล้วโยน "ไม่พบ tenant" ก่อนคำสั่งแรก · รันสำเนาที่ตั้ง slug=siamdist แล้ว `raise exception` ไว้ท้ายบล็อก → ทุกคำสั่งรันจริงแล้วย้อนกลับทั้งหมด (บล็อกเดียว = transaction เดียว) · นับแถวหลังรัน: ค่าตั้งบาร์ siamdist 12 · เมนู 7 · ค่าตั้งขายของ aim 2 = ไม่มีอะไรหาย
  - กันซ้ำ: `lib/shared/cleanupSql.test.ts` อ่านไฟล์มาตรวจว่าทุก `from/update <ตารางแอป>` (เทียบ `TENANT_TABLES`) มีตัวกรองครบ · ตัดคอมเมนต์ก่อนตรวจ (D92/D95) · 🚩 จับได้จริง: เอาตัวกรองออกจาก delete → แดง 2 ข้อ · ออกจาก subquery อย่างเดียว → แดง 1 ข้อ
- 🔴 **เจอระหว่างพิสูจน์ข้อ 1 — ลบลูกค้าบาร์ที่เคยมีบิลไม่ได้เลย** (⏳ ยังไม่แก้ · ต้องมี migration · รอผู้ใช้ตัดสิน): FK `bar_menu.created_for` และ `bar_sale.customer_id` (0064) เป็น `on delete set null` แบบ **composite** `(tenant_id, entity_id, customer_id)` ⇒ Postgres ตั้ง**ทุกคอลัมน์**เป็น null รวม `tenant_id` ที่ not null → `deleteCustomerAction` (ลบตาม PDPA) ล้มทุกครั้งที่ลูกค้าเคยมีบิลหรือมีเมนูสร้างให้ · พิสูจน์ด้วยรันแล้วย้อนกลับบน siamdist · ทางแก้: `on delete set null (customer_id)` แบบระบุคอลัมน์ (Postgres 15+ · DB เป็น 17.6) · สคริปต์ล้างข้อมูลเลี่ยงด้วยการล้างการอ้างอิงก่อนลบ
- 🟡 **2. ประโยค "เอาติ๊ก มี VAT 7% ออก (VAT จะรวมเป็นต้นทุน)" ไม่จริง** — เอาติ๊กออกแล้วระบบคิดจากราคาไม่รวม VAT (D98) ⇒ VAT **หายจากยอด** ไม่ได้ถูกบวกเข้าต้นทุน (บนจอ: 107.00 → 100.00) · ผู้ใช้เชื่อประโยคแล้วกดบันทึก = ยอดบิล/ยอดเงินในแอปต่ำกว่าเงินที่จ่ายจริงเงียบ ๆ (ตระกูล D91/0059: ตรรกะถูก ประโยคผิด) · มี 3 จุด: ด่านย้ายบิล D132 (`entityMove.ts`) · คำเตือนบิลซื้อไม่มีเลขใบกำกับ D124 (`missingInvoiceWarn`) · วิธีแก้บนการ์ด ภพ.30 (`missingInvoiceListText`) → บอกให้แก้ราคาเป็นยอดที่จ่ายจริงรวม VAT + หน้าย้ายบิลบอกจำนวนที่จะหาย · 🚨 **ไม่แตะสูตร** (เปลี่ยนแค่ประโยค · golden เดิมผ่าน) · เทสล็อกว่าห้ามมีคำ "จะรวมเป็นต้นทุน"
- 🟢 **3. กล่องยืนยัน [ยกเลิกทั้งบิล] [ยกเลิก] / [ยกเลิกล็อต] [ยกเลิก]** — D134 ไล่ใส่ `cancelText: "กลับ"` ให้ action ที่ขึ้นต้นด้วย "ยกเลิก…" แต่ตกประวัติบิลบาร์กับของทำเอง (สองจุดนี้ใช้ `useConfirm` มาตั้งแต่ D96 จึงไม่อยู่ในรายการที่ D134 ไล่แปลงจาก `window.confirm`) · กันซ้ำ: `nativeDialogs.test.ts` ข้อใหม่ — `confirmText` ขึ้นต้น "ยกเลิก" ต้องมี `cancelText: "กลับ"` (จับ 2 จุดนี้ได้พอดีก่อนแก้)
- 🟢 **4. ปุ่ม "ยกเลิกรายการ" ในประวัติบิลบาร์ไม่ถามก่อน** — ลิงก์ตัวเล็กติดชื่อเมนู กดครั้งเดียวยอดบิลที่ปิดแล้วลด + คืนสต็อก กู้กลับไม่ได้ (มีมาตั้งแต่ก่อน D134) → ถามก่อน บอกยอดที่ลด (รายการแถม = ยอดไม่เปลี่ยน) · ⏳ ยังไม่ได้เห็นบนจอ: บาร์ที่จด VAT ออกใบเสร็จทุกบิล ⇒ ปุ่มนี้เทาเสมอ (ถูก) · เห็นได้เฉพาะบาร์ที่ไม่จด VAT
- **ที่เทสแล้วผ่าน** (ดู TESTING ส่วนที่ 90-93 · ข้อ 94 สำหรับรอบนี้): เซสชัน (ลบคุกกี้ → login 2.5 วิ · จำลองหมดอายุ → ต่ออายุเอง · 6 หน้าไม่มีป้ายเหลือง) · ป้ายลอย (เขียว 2.9 วิ · แดงค้าง · เหนือป๊อปอัพ · รัวแล้วไม่ซ้อน · มือถือ 375px ไม่ชนถาด) · กล่องยืนยันทั้ง 2 แบบ + ตรวจ DB ทุกครั้ง · ย้ายบิล + ด่านบล็อก 4 แบบ · ซ่อนโมดูล 2 รอบ (บัญชี+เงินเดือน / +ขาย) แล้วคืนครบ
- 🪤 **ผลเทสที่เกือบสรุปผิด**: ข้อ 91.4 (หมวดวัตถุดิบผลิตสุราต้องไม่โผล่) ผ่านรอบแรกเพราะฟอร์มค้างประเภท **สำรองจ่าย** จากบิลก่อนหน้า (ระบบจำประเภทไว้ตามตั้งใจ) — หมวดนี้โผล่เฉพาะ **รายจ่าย** อยู่แล้ว ⇒ ผ่านโดยไม่ได้ทดสอบอะไร · จับได้ตอนเทสทิศกลับ (91.6 โมดูลครบ) แล้วหมวดก็ไม่โผล่เหมือนกัน → ทำใหม่ทั้งสองทิศด้วยประเภทที่ถูก · **เทสทิศเดียวที่ผ่าน ไม่ได้แปลว่าผ่าน** (บทเรียน D85/D92)
- ไกด์เทสไม่ตรงหน้าจอ 2 จุด (แก้ใน TESTING): 90.2.1 บิลรายรับจากแอปขาย**ไม่มีปุ่มแก้ไขเลย**ในหน้าค้นบิล (ปลอดภัยกว่าที่ไกด์เขียน) · 92.1.4 ทำไม่ได้ เพราะหมวดรับวัตถุดิบเปลี่ยนช่องรายการเป็นดร็อปดาวน์จาก master
- test **2017** · `test:tenant` **488** (24 ไฟล์ — รอบแรก 480 ผ่าน + 8 ข้อของไฟล์ใหม่ถูกข้ามเพราะ beforeAll ล้ม · หลังแก้ไฟล์เทสผ่านครบ)

### D137 — ลบลูกค้าบาร์ที่เคยมีบิล/เมนู "สร้างให้" ไม่ได้: FK composite `on delete set null` ล้าง tenant_id ด้วย (0095, 2026-10-26)

**ที่มา**: เจอระหว่างเทสเบราว์เซอร์ D136 — กดลบลูกค้าบาร์ (ปุ่มลบตาม PDPA · `deleteCustomerAction`) แล้วล้มทุกครั้งที่ลูกค้าเคยมีบิลหรือมีเมนูที่ "สร้างให้"
`null value in column "tenant_id" of relation "bar_menu" violates not-null constraint` · พิสูจน์บน DB จริงแล้ว (Postgres 17.6)

**สาเหตุ** (0064 · มีมาตั้งแต่เปิดโมดูลบาร์ D96):
- `bar_menu (tenant_id, entity_id, created_for) references bar_customer … on delete set null`
- `bar_sale (tenant_id, entity_id, customer_id) references bar_customer … on delete set null`
- 🚨 `set null` **ไม่ระบุคอลัมน์** บน FK composite = Postgres ตั้ง null **ทุกคอลัมน์ของ FK** รวม `tenant_id`/`entity_id` ⇒ ชน not null
  (ถ้าคอลัมน์ไม่ได้ not null จะแย่กว่า: บิลหลุดจาก tenant เงียบ ๆ แล้ว RLS มองไม่เห็นอีกเลย)
- 🪤 กล่องยืนยันการลบบอกผู้ใช้ไว้แล้วว่า *"บิลเก่ายังอยู่แต่จะไม่ผูกกับใคร"* — ประโยคถูก แต่ schema ทำไม่ได้ (กลับด้านกับตระกูล D91/0059: ตรรกะผิด ประโยคถูก) · หลัง 0095 ประโยคนี้เป็นจริง ไม่ต้องแก้ข้อความ
- 🪤 ตกหล่นเพราะไม่มีเทสไหนลบลูกค้าที่มีบิล · ปุ่มลบมีมาตั้งแต่ D96 แต่ใช้ได้แค่กับลูกค้าที่ยังไม่เคยซื้อ = **สิทธิ์ลบข้อมูลตาม PDPA ใช้ไม่ได้กับคนที่ควรใช้ได้มากที่สุด**

**แก้** (migration **0095** `bar_customer_fk_setnull`):
- drop FK เดิม 2 ตัว แล้วสร้างใหม่เป็น `on delete set null (created_for)` / `on delete set null (customer_id)` (Postgres 15+ · มีด่านเช็คเวอร์ชันบอกเหตุผลเป็นไทย)
- ★ ชื่อ FK เดิมเป็นชื่ออัตโนมัติ — **ไม่เดาชื่อ** หาจาก `pg_constraint` ด้วยตาราง + ตารางปลายทาง (`bar_customer`) + คอลัมน์ตามลำดับ · เจอ 0 หรือเกิน 1 ตัว = `raise exception` (ล้มทั้งไฟล์ ไม่ได้ drop ครึ่งเดียว) · ชื่อใหม่ `bar_menu_created_for_fkey` / `bar_sale_customer_id_fkey`
- ผลหลังแก้: ลบลูกค้า = บิล (ตัวเงิน/VAT/ลงบัญชีแล้ว) และเมนูยังอยู่ครบ · เหลือแค่ช่องลูกค้าเป็น null → แท็บประวัติขึ้น **—** (ตามที่ D97 วางไว้สำหรับลูกค้าที่ถูกลบตาม PDPA) · เมนูโปรด (`bar_customer_fav`) หายตาม (cascade เดิม)
- ★ ไม่มีตาราง/ฟังก์ชัน/definer ใหม่ (ไม่ต้อง grant · D99/D118) · ไม่แตะ `deleteCustomerAction` (โค้ดถูกอยู่แล้ว — ผิดที่ schema)
- ★ การ set null ของ FK ข้าม RLS (referential action) · trigger `audit_bar_sale`/`audit_bar_menu` ยังทำงานและเอา tenant จากแถว ซึ่งตอนนี้ไม่ถูกล้างแล้ว

**กันซ้ำ**:
- `lib/shared/fkSetNullSql.test.ts` อ่าน migration **ทุกไฟล์ตามลำดับ** เก็บ FK ทุกตัว (ไฟล์หลังที่สร้าง FK ตาราง+คอลัมน์ชุดเดียวกันทับของเดิม) แล้วตรวจ **สภาพล่าสุด** ว่าไม่มี FK composite ที่มี `tenant_id` แล้ว `on delete set null` โดยไม่ระบุคอลัมน์ · `set null (…)` ต้องเป็นคอลัมน์ของ FK และห้ามมี tenant_id/entity_id
  · positive control: 0064 เดี่ยว ๆ ต้องเจอของผิด 2 ตัวพอดี · ✅ พิสูจน์แล้วว่าจับได้ (ย้าย 0095 ออก → แดง 3 ข้อ)
  · ไล่ทุก migration แล้ว **ไม่เจอ FK composite + set null เปล่าตัวอื่น** นอกจาก 2 ตัวนี้ (ทั้งระบบมี `on delete set null` แค่ 2 จุดนี้)
- `tests/tenant/bar-customer-delete.test.ts` (ยิง DB จริง): ลบผ่าน client ผู้ใช้ (anon + ล็อกอิน · RLS มีผล — เส้นทางเดียวกับ `deleteCustomerAction`) ลูกค้าที่มีบิลปิดแล้ว + บิลเปิดค้าง (เปิดผ่าน RPC) + เมนูสร้างให้ → ต้องสำเร็จ · แถวยังอยู่ · ช่องลูกค้าเป็น null · tenant/entity คงเดิม · positive control 2 ชั้น: ลูกค้าอีกคนใน tenant เดียวกันไม่ถูกแตะ + tenant อีกเจ้าที่ใช้รหัสลูกค้าเดียวกันไม่ถูกแตะ
  · ⏳ **ยังไม่เคยรัน** — container cloud ไม่มี DB · รันครั้งแรกด้วย `npm run test:tenant` หลังลง 0095 · ถ้าแดง ให้สงสัยตัวเทสก่อน (บทเรียน D95/D136)
  · ✅ **ผู้ใช้ลง 0095 ครบ 2 DB แล้ว และ `test:tenant` ผ่าน** (2026-10-26) → merge กิ่ง D132-D137 เข้า main
- `supabase/seed/cleanup_test.sql` **เก็บ** บล็อกล้างการอ้างอิงก่อนลบลูกค้าไว้ (DB ที่ยังไม่ลง 0095 ต้องใช้ได้) · แก้แค่คอมเมนต์ว่าหลัง 0095 ไม่จำเป็นแล้ว
- test **2025** (+6 ไฟล์อ่านซอร์ส)

### D138 — บาร์: ลบ/ปิดใช้เมนู (0096, 2026-10-27)

- **ที่มา**: เทสเบราว์เซอร์ D137 เจอว่าแอปบาร์ **ลบเมนูไม่ได้ และปิดใช้ก็ไม่ได้** — `bar_menu.active` มีคอลัมน์ และหน้าขาย/ห้องทดลอง/จัดลำดับเมนูกรอง `active = false` อยู่แล้ว **ขาดแค่ปุ่มกับ action** (ตระกูล D74/D77) ⇒ เมนูสร้างผิด/เลิกขายค้างบนหน้าขายตลอดไป · ขัดกติกา CLAUDE.md "ทุกจุดที่บันทึกได้ต้องแก้/ลบได้" · ตอนเก็บกวาดเทสต้องลบเมนูด้วย SQL ตรง
- **ผู้ใช้ตัดสิน 3 ข้อ** (แพตเทิร์นบัญชีเงิน D125):
  1. **ทั้งสองแบบ** — เมนูที่**ไม่เคยขาย/ไม่เคยใช้ทำคอนเทนต์** ลบทิ้งได้ · เมนูที่เคยขาย **ปิดใช้ได้อย่างเดียว** (ปุ่มลบเทาพร้อมเหตุผล) · เปิดใช้คืนได้
  2. **ปิดใช้ = พนักงานบาร์ (`bar.write`) · ลบ = เจ้าของ (`bar.config`)** — ปิดใช้ไม่มีอะไรหาย (ของหมดชั่วคราว) ลบหายจริง
  3. เมนูที่ปิดใช้**ซ่อนในแท็บเมนู** + ปุ่ม *แสดงเมนูที่ปิดใช้ (N)* (ไม่มีเลย = ไม่มีปุ่ม) · แถวที่ปิดใช้จางลง + ป้าย *ปิดใช้ · ไม่ขึ้นหน้าขาย*
- 🚨 **ทำไมเมนูที่เคยขายห้ามลบ**: บิลก่อน 0090 ไม่มี `bar_move.ref_line` → ยกเลิกทีหลังคืนสต็อก "ตามสูตรปัจจุบัน" (D127) · ลบเมนู = สูตรหายตาม `on delete cascade` = **ยกเลิกบิลแล้วสต็อกไม่คืนเงียบ ๆ** · นับ**ทุกสถานะ**รวมบิล/รายการที่ยกเลิกแล้ว (ยังเป็นประวัติที่อ้างเมนู)
- 🔴 **เจอระหว่างออกแบบ — ด่านเดิมรั่ว**: policy `bar_menu_w` เป็น `for all` ของ `bar.write` ⇒ พนักงานบาร์**ลบเมนูตรงผ่าน API ได้อยู่แล้ว** ข้ามด่านทุกอย่าง → 0096 แยกเป็น insert/update (คง `bar.write`) · **ไม่มี policy delete** ลบได้ทางเดียวคือ `fn_bar_delete_menu` (แพตเทิร์น bar_post/lab · D91) · ★ FK action จากตารางอื่นไม่ผ่าน RLS ⇒ ไม่กระทบ 0095 · ไม่มีโค้ดแอปลบ `bar_menu` ตรง (เทสไล่อ่านซอร์สล็อกไว้)
- **0096**: `bar_menu_used_ids(p_entity)` = **invoker** `language sql` คืนรหัสไม่ซ้ำ (กันลิมิต 1000 แถว D82 · ไม่ต้องเปิดสิทธิ์ definer) · `fn_bar_delete_menu` = definer + `bar_guard(…,'bar.config')` · ตรวจว่าเคยใช้**ก่อน** delete · การ์ดห้องทดลองที่ชี้มาที่เมนู (`menu_id` เป็นป้ายบอกทาง ไม่ใช่ FK · 0091) → กลับเป็น *กำลังลอง* ใน transaction เดียว · 🚨 เงื่อนไข "เคยใช้" ของตัวอ่าน (จอ) กับของด่านต้องตรงกัน — เทสอ่านไฟล์เทียบ
- **จอ**: ปุ่ม แก้ · ปิดใช้/เปิดใช้ · ลบ ต่อแถว · โหลดรายชื่อเมนูที่เคยใช้ตอนเปิดแท็บ (เฉพาะคนมีสิทธิ์ลบ) · 🚨 **ยังไม่รู้ ≠ ไม่เคยขาย** (D89) — ระหว่างโหลด/โหลดไม่ได้ ปุ่มลบเทาพร้อมบอกเหตุผล · ลบผ่าน `useConfirm` ปุ่มแดง + `กลับ` (D136) · แถบ *ยังไม่ตั้งต้นทุน* ไม่นับเมนูที่ปิดใช้ (ไม่ขึ้นหน้าขายแล้ว)
- ประโยคทุกตัวตัดสินที่ `lib/bar/menuRemove.ts` · golden **B29** (14 ข้อรวมชั้น SQL/ซอร์ส) · `tests/tenant/bar-menu-remove.test.ts` 8 ข้อ (✅ ผ่านตั้งแต่รอบแรกหลังลง 0096) · test **2042** · ✅ เทสบนจอผ่าน (TESTING 96.1-96.2 · 96.3/96.4 พิสูจน์ใน test:tenant)

### D139 — บัญชี: ยอดรวมในค้นบิล · ช่องคู่ค้าพิมพ์ค้น · statement หลายเดือน (2026-10-27)

- **ที่มา**: ผู้ใช้ขอ (1) ยอดรวมสุทธิของบิลที่กรองในแท็บค้นบิล (2) ช่องคู่ค้าพิมพ์ค้นได้ (3) statement ดูหลายเดือน/ทั้งหมดได้ · เสนอก่อนแล้วผู้ใช้เลือกทาง **ยอดรวมแยกตามประเภท + statement มีแถวสรุปท้ายเดือน**
- **ยอดรวมค้นบิล** (`lib/accounting/billTotals.ts`): 🚨 **ห้ามบวกทุกประเภทเป็นเลขเดียว** (รายรับปนรายจ่าย = เลขไม่มีความหมาย) → แถบสรุปต่อประเภท + *รายรับ − รายจ่าย* · บิลยกเลิก**ไม่นับแม้ติ๊ก "รวมที่ยกเลิก"** (บอกจำนวนที่ตัด) · *เช็คราคา* ไม่นับ · ตั้งค้างยังนับแต่วงเล็บบอกยอดค้าง · 🪤 **โอน 1 ครั้ง = 2 ขา (+/−) บวกกันได้ 0** → นับเฉพาะขาเข้า ป้าย *ยอดโอน (นับขาเข้า)* · ยอดตามแถวที่เห็นบนจอ (รวมช่องค้นรายละเอียด) · ชนเพดาน 500 แถว = เตือนเหลืองว่ายอดยังไม่ครบ · ★ เป็นตัวเลขบนจอ ไม่ใช่รายงานเงิน/ภาษี ไม่แตะสูตร
- **ช่องคู่ค้า**: ใช้ `Combobox` ตัวเดิมของระบบ (ไม่เขียนชุดใหม่) + ตัวเลือก *ทั้งหมด* + ปุ่ม ✕ · คู่ค้าหลายสาขาชื่อซ้ำ → ยุบเหลือชื่อเดียว (ค้นบิลกรองด้วย `contact_name` อยู่แล้ว)
- **statement หลายเดือน** (`accountStatementRange` ใน `ledger.ts`): ช่วง `from/to` (yyyy-MM · null = ไม่จำกัด) · ยอดยกมา = ยอดตั้งต้น + ทุกรายการก่อนเดือนแรก · ทั้งหมด = ยอดตั้งต้นล้วน · รายการหลัง `to` ไม่นับ · `months` สรุปเข้า/ออก/คงเหลือสิ้นเดือน (เฉพาะเดือนที่มีรายการ) · 🚨 **สูตรมีที่เดียว**: `accountStatement` (รายเดือนเดิม) เรียกผ่านตัวใหม่ ⇒ **golden A8 + advance ผ่านโดยไม่แก้ไฟล์เทส** + เทสเทียบเดือนเดียวต่อเดือน · ปุ่มลัด *เดือนนี้ · 3 เดือน · ต้นปีถึงเดือนนี้ · ทั้งหมด · กำหนดเอง* นับถอยจากเดือนที่เลือกด้านบน (`lib/accounting/statementView.ts`) · เดือนเริ่มหลังเดือนสุดท้าย = เตือน ไม่ยิง (server ตรวจซ้ำ) · 🪤 `useRead` เก็บก้อนเก่าระหว่างโหลด → เช็คว่าข้อมูลเป็นของบัญชี+ช่วงที่ดูอยู่ก่อนแสดง (D81)
- **ไม่มี migration** · golden **A27** (22 เทส: billTotals 10 · statementRange 7 · statementView 5) · test **2064** · ✅ เทสเบราว์เซอร์แล้ว (siamdist · ยอดตรงคิดมือ 3,318.07 / 1,500.14 / 1,817.93 · statement ทั้งหมด ยกไป = ยอดคงเหลือในตาราง · มือถือ 375px) · ชุดเทส `docs/TESTING.md` ส่วนที่ **97**

### D140 — บัญชี: ประวัติราคา กรองงาน/หมวด · คู่ค้าพิมพ์ค้น · ยอดรวม · ช่วงเวลา · เลิกตัด 300 แถว (2026-10-28)

- **ที่มา**: ผู้ใช้ขอตัวกรอง **งาน** + ยอดรวมแบบหน้าค้นบิล (D139) + คู่ค้าพิมพ์ค้นได้ แล้วให้เสนอเพิ่ม · เสนอ 5 ข้อ ผู้ใช้เลือกทำทั้งหมด
- 🔴 **เจอระหว่างดูโค้ด — หน้านี้ดึงแค่ 300 รายการล่าสุดแบบเงียบ ๆ** (`.limit(300)` แล้วค่อยกรองบิลยกเลิก/คู่ค้าทีหลัง) ⇒ ค้นของที่ซื้อนาน ๆ ขึ้น "ไม่มีรายการ" ทั้งที่มี · ถ้าเติมยอดรวมงานลงไปตรง ๆ **ยอดจะขาดแถวเก่าโดยดูน่าเชื่อถือ** · และใช้ `.then()` ไม่มี `.catch` (โหลดพัง = ค้าง "กำลังโหลด…" · D89)
- **ฝั่ง server** (`searchPriceHistory`): กรองทุกอย่างใน query — สถานะ `ปกติ` · กิจการ · คู่ค้า · เช็คราคา · `item_job` · `item_category` · ช่วงเดือน (`transaction_date`) · แบ่งหน้าทีละ 1,000 (PostgREST max_rows) จนถึงเพดาน **10,000** · คืน `{ rows, loaded, total }` (count exact หน้าแรก) ⇒ เกินเพดาน = แถบเหลืองบอกว่ายอดยังไม่ครบ **ไม่ตัดเงียบ** · ชื่อสินค้ายังกรองที่จอ (พิมพ์แล้วกรองทันที · ได้ครบเพราะโหลดทั้งชุด) · เรียงตามวันที่บิลใหม่สุดก่อน (sort เสถียร)
- **ยอดรวม** (`lib/accounting/priceHistory.ts`): ใช้ `billTotals` **ตัวเดียวกับหน้าค้นบิล** (ไม่เขียนตัวบวกชุดที่สอง) · ยอด = `total_price` ก่อน VAT หลังส่วนลด (เขียนกำกับบนจอ) · เช็คราคาแสดงในตาราง (จาง) แต่ไม่นับ · รายรับ − รายจ่าย โชว์เฉพาะเมื่อมีทั้งสองประเภท
- **ข้อเสริม — จำนวนรวม + ราคาเฉลี่ยต่อหน่วย** (`singleItemSummary`): เฉพาะเมื่อแถวที่นับเป็น**ชื่อเดียว + ประเภทเดียว** 🚨 หลายชื่อ = บวกต่างหน่วย · ซื้อปนขาย = เฉลี่ยราคาซื้อกับขาย ⇒ ไม่โชว์ · เฉลี่ยถ่วงน้ำหนัก (Σยอด ÷ Σจำนวน) · จำนวน 0 = ไม่โชว์ราคาเฉลี่ย
- **จอ**: ช่องงาน/หมวด/คู่ค้าเป็น `Combobox` + ทั้งหมด + ✕ (รายชื่องาน/หมวดจาก `getItemHistory` ชุดเดียวกับที่ฟอร์มบันทึกแนะนำ) · คอลัมน์ หมวด/งาน · ช่วงเวลาใช้ปุ่มชุดเดียวกับ statement (`statementView.ts`) ค่าเริ่มต้น **ทั้งหมด** = พฤติกรรมเดิม · `useRead` + `<LoadError>` · แท็บรับ `period`/`active` (ไม่โหลดตอนซ่อน)
- **ไม่มี migration** · ไม่แตะสูตรเงิน/ภาษี · golden **A28** (9 เทส) · test **2073** · ⏳ **ยังไม่ได้เทสเบราว์เซอร์** (ผู้ใช้สั่งข้าม) · ชุดเทส `docs/TESTING.md` ส่วนที่ **98**

### D141 — Claude connector: ส่งรูปบิลในแชท Claude (มือถือ) แล้วลงบัญชี (0097, 2026-10-28)

- **ที่มา**: ผู้ใช้อยากถ่ายรูปบิลส่งในแอป Claude มือถือ แล้วให้ลงบัญชีให้ · เทียบ 5 ทางแล้วเลือก **connector (remote MCP)** — ใช้แพ็กเกจ Claude ที่จ่ายอยู่แล้ว (ไม่ต้องมี `ANTHROPIC_API_KEY` · ไม่มีค่า API ต่อบิล) ได้โมเดลตัวใหญ่ (สาเหตุหลักที่ D61 ล้มคือ Haiku) · **ใช้เองก่อน** แต่ผู้ใช้สั่ง **เปิด env + OAuth ฝั่ง DB ลูกค้าไว้ตั้งแต่แรก** เผื่อรับลงบิลให้ลูกค้า ⇒ รายชื่อผู้ใช้ที่อนุญาต + ด่านชื่อย่อลูกค้า กลายเป็นของ**ต้องมีรอบแรก** · ผู้ใช้สั่งให้จัดการรายชื่อที่หน้า **/platform** แทนคำสั่ง CLI
- **ไม่ใช่การกดในเบราว์เซอร์**: Claude → `POST /api/mcp` (Bearer token) → `fn_save_transaction` ตัวเดียวกับฟอร์ม ⇒ RLS · trigger · `edit_log` เหมือนคีย์มือทุกอย่าง · Claude ไม่เห็น DB/ชื่อตาราง เห็นแค่เครื่องมือ 5 ตัว
- **ล็อกอิน = Supabase OAuth 2.1 server** (beta · ทุกแพ็กเกจ · เปิดรายก้อน) · token เป็น JWT ของผู้ใช้จริง ⇒ `my_tenant()` (อ่าน profiles ของ `auth.uid()`) ทำงานต่อ **ไม่แก้ policy สักตัว** · tenant มาจาก session ตามกติกาเดิม · หน้าอนุญาต `/oauth/consent` (กลุ่ม `(auth)` เพราะ layout ของ `(app)` เด้งไป change-password/suspended แล้ว authorization_id หาย)
- **กัน 3 ชั้น** (`lib/connector/guard.ts`): env `CLAUDE_CONNECTOR=1` (ไม่ตั้ง = 404 · แพตเทิร์น PLATFORM_ADMIN D54) → token (ไม่มี = **401 + `WWW-Authenticate: resource_metadata=…`** — 🪤 Claude ไม่สนใจ header นี้บน 200) → `connector_allowed()` **ถามทุกคำขอ** (ถอนสิทธิ์แล้วหยุดทันทีแม้ token ยังไม่หมดอายุ) + บทบาทต้องมี `acct.write` + โมดูลบัญชี
- 🚨 **`connector_allowed()` เช็คการระงับลูกค้าด้วย** — การระงับบังคับที่ `(app)/layout.tsx` ไม่ใช่ RLS (D59) และ connector ไม่ผ่าน layout ⇒ ไม่เช็ค = ลูกค้าค้างค่างวดยังบันทึกบิลผ่าน Claude ได้ · + `must_change_password` · + ไม่ใช่ tenant แพลตฟอร์ม
- 🚨 **ไม่มี service role ในเส้นทาง /api/mcp เลย** (anon key + token) · `connector_users` เป็น**ตารางแพลตฟอร์ม** (RLS deny-all + revoke anon/authenticated · `PLATFORM_ONLY_TABLES`) เขียนได้เฉพาะหน้า /platform ⇒ ลูกค้าให้สิทธิ์ตัวเองไม่ได้ · endpoint ถามผ่าน definer อ่านอย่างเดียว (`DEFINER_ALLOWLIST` หมวด readonly · revoke `public, anon` ตาม D99)
- 🪤 **middleware ต้องยกเว้น `/api/mcp`** ก่อน session guard (คำขอของ Claude ไม่มีคุกกี้ → ถูกเด้งไป /login ได้ 200 หน้า HTML · บทเรียนเดียวกับ cron D88) · หน้า login รับ `next` เฉพาะ `/oauth/consent…` (`safeNext` กัน open redirect) — ไม่งั้นล็อกอินแล้วหลุด flow
- **สูตรเงิน**: `lib/connector/bill.ts` เรียก `entryCalc()` + `buildItemInputs()` ตัวเดิม (ย้าย `buildItemInputs`/`hasContent`/`TxItemInput`/`SaveTxInput` จาก `_components/billItems.ts`/`actions.ts` ไป `lib/accounting/itemInputs.ts` คำต่อคำ · ไฟล์เดิม re-export) ⇒ **golden A3/A4/A21 ไม่ถูกแตะ** · เทสอ่านซอร์สว่าตัวคิดยอดไม่มี 1.07/0.07
- 🚨 **ด่านหลัก: ยอดที่คิดได้ต้องเท่ายอดรวมที่พิมพ์บนบิล** (`total_on_bill` · Claude อ่านแยกจากรายการ · ต่างเกิน 1 สตางค์ = ไม่บันทึก) · ต่าง 7% พอดี = แนะนำสลับ `price_mode` · 🚨 ข้อความสั่ง *ห้ามปรับตัวเลขให้ยอดตรงเอง* · + เลขภาษี checksum 13 หลัก (จับอ่านผิดหลัก) · วันที่ต้อง ค.ศ. (ปี พ.ศ. หลุดมา = วันในอนาคต → เตือน) · หมวด/บัญชีต้องมีอยู่จริงทุกตัวอักษร (ฟอร์มเป็นดร็อปดาวน์) · คำเตือนตัวเดียวกับฟอร์ม (D124) · กิจการไม่จด VAT ด่าน ม.86/13 เป็นภาษาไทยก่อนถึง trigger
- **บิลซ้ำ**: `fn_save_transaction` ไม่มี idempotency_key ⇒ ค้นบิลเลขใบกำกับเดียวกัน / วันที่+ยอด+คู่ค้าเดียวกัน — เจอ = save_bill ไม่ยอมจนกว่าจะส่ง `confirm_not_duplicate`
- **ลงผิดเจ้า**: `save_bill` บังคับ `tenant_slug` ตรงกับเจ้าของ token (เปิด connector หลายเจ้าพร้อมกันได้) · ทุกผลลัพธ์ขึ้นชื่อลูกค้า+กิจการ
- **ป้าย `source = 'claude'`** — `fn_save_transaction` รับค่าจาก payload ได้อยู่แล้ว (ไม่มี CHECK) · 🪤 แต่ D132 ย้ายกิจการได้เฉพาะ `ui/migration` ⇒ 0097 ยก `fn_edit_transaction` ด้วยสคริปต์ (`gen-0097.mjs` · diff ต่าง 1 บรรทัด) + `MOVABLE_SOURCES`
- **ขอบเขตรอบแรก**: รายจ่าย/รายรับ + ตั้งค้าง · ❌ แบ่งงวด/สำรองจ่าย/โอน/50ทวิ/แก้-ลบ (ทำในแอป) · ❌ แนบรูป (Claude ส่งไฟล์รูปให้เครื่องมือไม่ได้) · ❌ สร้างคู่ค้าใหม่
- **/platform แท็บ Claude connector**: เลือกลูกค้า → อนุญาต/ถอนสิทธิ์รายคน · บทบาทที่ไม่มี `acct.write`/ลูกค้าถูกระงับ = ปุ่มเทา+เหตุผล (`grantBlock` ตรวจซ้ำฝั่ง server) · บัญชี main ได้แต่เตือน (แนะนำผู้ใช้ accounting แยก) · log `grant_connector`/`revoke_connector` ใน `platform_admin_log` · จัดการได้เฉพาะ DB ที่ deployment นั้นชี้ (`insep-erp` = ของเจ้าของ · `proof-admin` = ลูกค้า)
- package ใหม่: `@modelcontextprotocol/sdk` 1.32.2 (transport `WebStandardStreamableHTTPServerTransport` stateless + JSON response) · `zod` 4 · ไม่ใช้ `mcp-handler` (v2 ผูกกับ SDK รุ่นใหม่ที่ยังไม่นิ่ง)
- golden **C1-C4** (43 เทส) · `tests/tenant/connector.test.ts` 8/8 ผ่านตั้งแต่รอบแรกหลังลง 0097 · `test:tenant` **513** · test **2116** · build/lint ผ่าน · ✅ ยิงบนเครื่องแล้ว: ไม่มี token = 401 + header ถูก · token มั่ว = 401 `invalid_token` · metadata ชี้ Supabase ถูกก้อน · หน้าอนุญาตพาไป `/login?next=…` · Supabase ยังตอบ `OAuth server is disabled` (ผู้ใช้ต้องเปิดเอง) · ชุดเทส `docs/TESTING.md` ส่วนที่ **99**
- 🔴 **ลองกับ Claude จริงรอบแรก: ล็อกอิน+ออก token สำเร็จ แต่ทุกคำขอได้ 403** — `authenticate()` อ่าน `tenants.brand_name` ซึ่งถูกลบไปตั้งแต่ 0030 (แบรนด์ย้ายไป app_settings · D47) ⇒ อ่านลูกค้าไม่สำเร็จทุกครั้ง · หน้าอนุญาตก็อ่านคอลัมน์เดียวกัน (ไม่ล้มเพราะไม่ได้เช็ค error แต่ชื่อลูกค้าว่าง) · 🪤 **build/lint/test ผ่านหมด** เพราะ select เป็นข้อความ · Claude แสดงแค่ *refused* ไม่บอกเหตุผล และ endpoint ไม่ได้ log สาเหตุ ⇒ ต้องไล่ด้วย Vercel logs (เห็น 403 จาก serverless) + ออก session ทดลองให้ผู้ใช้บอทแล้วยิง production อ่าน body · แก้: ตัดคอลัมน์ทิ้ง · **endpoint `console.warn` สาเหตุทุกครั้งที่ปฏิเสธ** (ไม่มี token) · เทสอ่าน migration ไล่คอลัมน์ของ `tenants` (create + add/drop ทุกไฟล์) แล้วตรวจทุก `.from("tenants").select()` ในโค้ด connector — พิสูจน์แล้วว่าจับได้ · test **2121**
- **รอบ 2 (2026-10-28) — การ์ดตรวจบิลในแชท (MCP App) + ยอดไม่ตรง 3 ขั้น** · ผู้ใช้ขอให้สิ่งที่ Claude ไม่แน่ใจเป็นตัวเลือกให้กด + รายการสินค้าแก้เองได้ · ไม่มี migration
  - **การ์ด** = `preview_bill` ผูก `ui://insep-erp/bill-card` (SDK `@modelcontextprotocol/ext-apps` 1.7.5 · รองรับ iOS/Android) · การ์ดย่อ: ปุ่มเลือกกิจการ (เมื่อ >1) · หมวด (ตัวที่เลือก + ที่คู่ค้าเจ้านี้เคยใช้ สูงสุด 3 · `categoryChips` กรองเฉพาะหมวดในผัง) · บัญชี + ตั้งค้าง · รายการ 3 แถวแรก · ปุ่มหลัก 1 ปุ่ม + แก้ในแชท · หน้าแก้รายการเต็มจอ (ชื่อ · จำนวน · ราคา · ลบแถว · แก้ยอดบนบิลแบบแยกพร้อมคำเตือน)
  - 🚨 **การ์ดไม่คิดเงินเอง** — ทุกการกด/พิมพ์เรียก `recalc_bill` (visibility `app` · Claude มองไม่เห็น) ให้ server คิดด้วย `checkBill` → `entryCalc` ตัวเดิม · เทสอ่านซอร์สการ์ดว่าไม่มี 0.07/1.07 · ปุ่ม/ประโยคตัดสินที่ `lib/connector/cardView.ts` (golden **C5**)
  - 🚨 **กันบันทึกซ้ำ**: การ์ดเรียก `save_bill` จุดเดียว (ส่ง `tenant_slug` เสมอ) แล้ว `updateModelContext` บอก Claude ว่าบันทึกแล้ว · คำสั่ง connector สั่ง Claude ไม่ให้เรียก `save_bill` เองหลังแสดงการ์ด · ด่านบิลซ้ำฝั่ง server ยังอยู่
  - **ยอดไม่ตรง 3 ขั้น** (`checkBill` คืน `mismatch`): ① สลับโหมดราคาแล้วตรงพอดี → ปุ่มสลับ (เคส D98) ② ต่าง ≤ **1 บาท** (ผู้ใช้ตัดสิน `ROUNDING_CAP`) → **ใช้ยอดตามบิล** บันทึกยอดก่อน VAT + VAT ตามที่พิมพ์ (กลไกเดียวกับโหมดแก้ยอดเองของฟอร์ม · ภาษีซื้อต้องตรงใบกำกับ) ต้องมี `bill_before_vat`/`bill_vat` ที่อ่านแยก · ก่อน VAT + VAT ต้องเท่ายอดรวม · **VAT ต้องใกล้ 7% ของยอดก่อน VAT** (คลาด ≤ 0.01×จำนวนแถว ไม่งั้น = อ่านผิด) · ทิ้งร่องรอยในคำอธิบายบิล ③ ต่างมาก → ไฮไลต์แถวที่ส่วนต่างเท่ากับผลของ 1 หน่วยหลายเท่าพอดี (`suspectLines`) + ให้ Claude อ่านใหม่ · ไม่ลงตัว = ไม่ชี้ (ไม่เดา)
  - 🪤 **ช่องกรอกในหน้าแก้รายการห้ามถูกวาดใหม่ระหว่างพิมพ์** (โฟกัสหลุด · D71) → วาดใหม่เฉพาะยอด/ปุ่ม (`paintLive`) · พิสูจน์ใน harness ว่าโฟกัสอยู่
  - การ์ด build เป็น HTML ไฟล์เดียวด้วย esbuild (`npm run gen:bill-card` → `billCard.generated.ts`) ไม่โหลดอะไรจากภายนอก · 🪤 import ตัวปกติของ SDK ลาก zod เต็มก้อน (528KB) → ใช้ `app-with-deps` ที่ย่อแล้ว (385KB) · เทสฟ้องถ้าไฟล์ที่ commit ไม่ตรงกับซอร์ส
  - ✅ **ลองด้วย harness ที่ใช้ `AppBridge` ของ SDK (ตัวเดียวกับโฮสต์)**: ขวดแก้วอ่าน 15 แทน 16 → ไม่ตรง 75.00 + ไฮไลต์แถว → แก้เป็น 16 โฟกัสไม่หลุด → ตรงบิล → บันทึก → แจ้ง Claude → กลับการ์ดย่อ · เคสปัดเศษ 0.03 → ใช้ยอดตามบิล → บันทึกครั้งเดียว · 🐛 **เจอ 2 จุดตอนลอง แก้แล้ว**: ข้อความขึ้น "ต่างจากบิล -0.03" (ติดลบ) · กดใช้ยอดตามบิลแล้วเปลี่ยนกิจการ ธงค้าง → ขึ้น "ใช้ยอดตามบิลไม่ได้" ทั้งที่ไม่ได้กด (เปลี่ยนกิจการต้องล้างธง เพราะ VAT เปลี่ยน)
  - golden **C1** เพิ่มขั้น 1-3 · **C5** 12 · **C6** 7 · test **2153** · ⏳ **ยังไม่ได้ลองใน Claude จริงบนมือถือ** — ไม่รู้ว่าปุ่มบันทึกในการ์ดจะมีป๊อปอัพอนุมัติของ Claude ซ้อนหรือไม่ · แป้นพิมพ์บังช่องในหน้าเต็มจอไหม
- **รอบ 3 (2026-10-28) — ใช้จริงบนมือถือแล้วปรับ: คู่ค้าใหม่ · ถามก่อน-บันทึกในการ์ดทางเดียว · งานรายแถว · แก้บิลหลังบันทึก** · ไม่มี migration
  - **เจอจากการใช้จริง (2 บิล)**: ① บิลไทวัสดุถูกบันทึกด้วยหมวดที่ Claude เดา ก่อนที่ผู้ใช้จะตอบคำถาม แล้ว Claude แก้ให้ไม่ได้ ② ผู้ใช้บอก "กดในการ์ดแล้วไม่บันทึก" แต่จริง ๆ บันทึกแล้ว (น่าจะติดป๊อปอัพอนุมัติของ Claude ที่ซ้อนอยู่) ③ บิลมหาจักรฯ Claude เรียก `save_bill` เองขณะการ์ดยังมีปุ่มบันทึกค้าง = เสี่ยงบิลซ้ำ ④ คู่ค้าใหม่ไม่ถูกเพิ่ม → บิลไม่ผูก `contact_id` (ภพ.30 ไม่มีเลขภาษี) ⑤ งานไม่มีตัวเลือก
  - 🚨 **`save_bill` เรียกได้จากการ์ดทางเดียว** (visibility `app`) — การกดในการ์ดคือการยืนยัน · Claude บันทึกเองไม่ได้ ⇒ ไม่มีทางบันทึกซ้ำสองทาง และไม่บันทึกก่อนผู้ใช้ตัดสิน · คำสั่ง connector สั่งให้ **ถามสิ่งที่ไม่แน่ใจทีเดียวก่อนแสดงการ์ด** (กิจการ · บัญชี/ตั้งค้าง · หมวด · งานรายแถว) · แนะนำตั้ง `save_bill` = Always allow (ปุ่มในการ์ดคือการอนุมัติ)
  - **คู่ค้าใหม่** (`lib/connector/contact.ts` · golden **C7**): Claude ส่ง `new_contact` (ชื่อ · เลขภาษี · สาขา · ที่อยู่ จากหัวบิล) · การ์ดขึ้นกล่อง *คู่ค้าใหม่ — จะเพิ่มเข้าทะเบียนตอนบันทึก* · ใช้กติกา `validateNewCustomer`/`branchToSave` ตัวเดียวกับฟอร์มในแอป + checksum เลขภาษี (เลขผิดติดไปทุกบิลถัดไป) · เลขภาษี+สาขาตรงกับในทะเบียน (152 = 00152) = ผูกตัวเดิม ไม่เพิ่มซ้ำ · 🚨 **เพิ่มหลังด่านทุกตัวผ่าน** (บิลซ้ำ/ยอดไม่ตรง = ไม่มีคู่ค้างอกค้าง) · เลข `C-xxxx` จาก `next_serial CONTACT` แบบเดียวกับ `addContactAction` · ไม่ผูกคู่ค้าเลย = คำเตือนเหลือง
  - **งานรายแถว** (`lib/connector/jobs.ts`): งานผูกกับรายการอยู่แล้ว (`item_job`) · การ์ดย่อมีแถวงาน (กด = ใส่ทุกแถว · ขึ้น *หลายงาน (n)* เมื่อต่างกัน) · หน้าแก้รายการมีช่องเลือกงานต่อแถว · **งานใหม่** พิมพ์ได้ + เตือนชื่อใกล้ (`similarJob` ตัดช่องว่าง/คำหนึ่งอยู่ในอีกคำ · เตือนไม่บล็อก) · งานที่พิมพ์ใหม่ขึ้นเป็นตัวเลือกของแถวอื่นทันที · **บังคับเลือกงานเมื่อกิจการนั้นเคยใช้งาน** (200 บิลล่าสุด · ตัดสินจากข้อมูล ไม่ฮาร์ดโค้ด EID01) · 🚨 **ไม่ระบุงาน = บันทึกเป็นค่าว่าง** (ผู้ใช้สั่ง · `job_none` ใช้ผ่านด่านอย่างเดียว · DB ได้ `null` — test:tenant ยืนยัน) · อ่านประวัติงานไม่ได้ = error ไม่เดาว่าไม่บังคับ
  - **หมวด "อื่น ๆ"** กางหมวดทั้งหมดในการ์ด (ไม่ย้อนไปแชท)
  - **`edit_bill`** (Claude เรียกได้ · ควรตั้ง Needs approval): แก้ หมวด · บัญชี · งาน (ทั้งบิล/รายแถว) · คู่ค้า (ผูกตัวเดิม/เพิ่มใหม่) ผ่าน `fn_edit_transaction` ตัวเดียวกับหน้าแก้บิล · 🚨 อ่านค่าเดิมทั้งแถวแล้วส่งกลับ **ไม่แตะยอดเงิน/รายการ** (เทสอ่านซอร์สล็อก) · เฉพาะ `source = claude` + สถานะปกติ · บิลค้างห้ามเปลี่ยนบัญชี · หมวดจุดชนวนรับวัตถุดิบห้ามสลับเข้า/ออก (สต็อกผลิตไม่ตามให้)
  - 🐛 เจอใน harness แล้วแก้: เลือกงานใหม่ให้แถวในหน้าเต็มจอ ข้อมูลถูกแต่ช่องเลือกค้างชื่อเดิม (หน้าเต็มจอวาดใหม่เฉพาะส่วนยอด) → วาดค่าใหม่ทันทีก่อน recalc (เลือก ≠ พิมพ์ โฟกัสไม่หลุด · พิสูจน์แล้ว)
  - golden **C7** 15 · `tests/tenant/connector.test.ts` 10 (+ พนักงานบัญชีเพิ่มคู่ค้าได้ · แก้หมวด/งานแล้วยอดไม่ขยับ) · test **2169** · ⏳ บิลมหาจักรฯ `TR-20261028-0002` ยังไม่ผูกคู่ค้า — ให้ผู้ใช้สั่ง Claude ด้วย `edit_bill` หลัง deploy
- **รอบ 4 (2026-10-28) — สาขาสำนักงานใหญ่ + การ์ดตรวจคู่ค้าใหม่** · ไม่มี migration
  - **ใช้จริง**: Claude เพิ่มคู่ค้า C-0066 มหาจักรฯ ผ่าน `edit_bill` แล้วรายงานว่า "คำอธิบายบอกให้ใส่ สำนักงานใหญ่ แต่ระบบรับแค่ตัวเลข" · ✅ ตรวจ DB แล้ว C-0066 เก็บสาขาเป็น "สำนักงานใหญ่" ถูกต้อง และบิลผูกแล้ว ยอดเท่าเดิม · 🐛 **บั๊กจริงแต่ไม่ใช่อย่างที่ Claude สรุป**: "สำนักงานใหญ่" ตรงตัวผ่าน แต่ "Head Office" / "สนญ." / "HQ" ตกไปเป็น *เลขสาขาต้องเป็นตัวเลข 1-5 หลัก* (ข้อความชวนให้ใส่ 00000) และ "สำนักงานใหญ่ (00000)" ถูกเก็บเป็น "00000" → `normalizeBranch()` แปลงทุกรูปที่หมายถึงสำนักงานใหญ่ + "สาขาที่ 00152"/"Branch 152" → เลข · อ่านไม่ออก = บอกรูปที่รับ (ไม่เดาว่าเป็นสำนักงานใหญ่) · แก้ที่ connector ไม่แตะ `lib/shared/taxCustomer.ts` (ฟอร์มในแอปเป็นปุ่มเลือก ไม่มีปัญหานี้)
  - **ผู้ใช้ขอ: เพิ่มคู่ค้าใหม่ต้องมีการ์ดให้รีเช็ค** → เครื่องมือ `add_contact` (แสดงการ์ด ไม่เพิ่มเอง) · การ์ดแก้ ชื่อ/เลขภาษี/สาขา/ที่อยู่ ได้ ตรวจซ้ำทุกครั้งที่พิมพ์ (`recalc_contact` app-only) · ตรงกับในทะเบียน = ปุ่ม *ใช้/ผูกกับคู่ค้าเดิม* ไม่เพิ่มซ้ำ · `link_tx_id` = เพิ่มแล้วผูกกับบิลที่บันทึกผ่าน Claude (`create_contact` app-only → `editBill`) · 🚨 **`edit_bill` เลิกรับ `new_contact`** — เพิ่มคู่ค้าได้ 2 ทางเท่านั้น: กดบันทึกในการ์ดบิล · กดเพิ่มในการ์ดคู่ค้า (เทสนับ `createContact` = 2 จุด) · การ์ดบิล: กล่องคู่ค้าใหม่มีปุ่ม *แก้ข้อมูลคู่ค้า* → แก้ในหน้าเต็มจอ
  - 🐛 **เจอใน harness ก่อนส่ง**: การ์ดคู่ค้าพิมพ์แก้แล้ว**ไม่ตรวจซ้ำเลย** และกดเพิ่มด้วยค่าที่ Claude อ่านมา ไม่ใช่ค่าที่แก้ — ตัวรับการพิมพ์ออกไปตั้งแต่ `if (!data) return` (การ์ดคู่ค้าไม่มีข้อมูลบิล) → ย้ายขึ้นก่อน + เทสอ่านซอร์สล็อกลำดับ · ✅ ลองซ้ำ: เลขภาษีผิดหลัก = ปุ่มเทา+เหตุผล (กดไม่ส่ง) · เลขที่มีในทะเบียน = ผูกกับคู่ค้าเดิม · โฟกัสไม่หลุด
  - golden **C7** +3 (สาขา) · **C8** 4 (การ์ดคู่ค้า) · test **2178**
- **รอบ 5 (2026-10-28) — หมวดสินค้ารายแถว (item_category) ในการ์ด** · ไม่มี migration
  - **ใช้จริง**: บิล `TR-20261028-0003` Claude ลงหมวดสินค้า "สกรู" ให้ แต่ผู้ใช้ไม่รู้ก่อนบันทึก และแก้หลังบันทึกไม่ได้ (การ์ดไม่แสดงช่องนี้ · `edit_bill` ไม่รับ) · ในระบบหมวดสินค้าใช้จริงจัง (ค่าตัดวัสดุ 13 · สเตนเลสตัดเลเซอร์ 7 · ลูกปืน 5 · สกรู 4 · สายพาน 4 …)
  - การ์ดย่อแสดง *หมวด X · งาน Y* ใต้ชื่อทุกรายการ · หน้าแก้รายการมีช่องเลือกหมวดสินค้าทุกแถว + *หมวดสินค้าใหม่* พร้อมเตือนชื่อใกล้ (กลไกเดียวกับงาน — `newField` แยกว่ากล่องพิมพ์เป็นของช่องไหน) · รายการหมวดจัดอันดับด้วย `rankJobs` ตัวเดียวกับงาน (คู่ค้าเจ้านี้ก่อน · ดึงจากคำขอเดียวกับงาน) · `edit_bill` รับ `item_categories` รายแถว (`''` = ล้าง)
  - ★ **ไม่บังคับเลือก** (ต่างจากงาน) — หมวดสินค้าเป็นป้ายอธิบาย ไม่เข้ารายงานภาษี · ไม่ระบุ = ค่าว่าง
  - ✅ ลองใน harness: เปลี่ยนหมวดรายแถว · พิมพ์ "สาย พาน" แล้วเตือน "สายพาน" · งานไม่ถูกกระทบ · test **2179**
- **รอบ 6 (2026-10-29) — ปิดเดือน: เครื่องมืออ่านอย่างเดียว 3 ตัว + skill** · ไม่มี migration
  - **ผู้ใช้ตัดสิน**: อยากให้ AI ช่วยงานบัญชีจนเกือบครบลูป (กระทบ statement · หาบิลที่ขาด · ตัวเลข ภพ.30 ไปกรอก e-Filing) · เลือก **กระบวนการอยู่ใน Claude Skill (ผู้ใช้แก้เองได้) + connector ให้แค่ข้อมูลที่จำเป็น** · ไม่ต้องสอนอ่าน statement ละเอียด (Claude อ่านเองได้)
  - เครื่องมือ: `account_statement` (statement บัญชีเงินช่วงเดือน · ตัวเลขเดียวกับหน้าเว็บ) · `search_transactions` (ค้นตามวันที่/ยอดสุทธิหรือยอดก่อน VAT ±0.01/คู่ค้า/ข้อความ ทุกบัญชี — หาบิลลงผิดบัญชี/ผิดเดือน) · `tax_report` (ภพ.30 + ภงด.3/53 + บิลซื้อมี VAT ไม่มีเลขใบกำกับ + สถานะยื่นจาก `tax_filings`) · ทั้ง 3 ตัว `readOnlyHint` ไม่มี rpc/insert/update/delete (เทสอ่านซอร์สล็อก)
  - 🚨 **ตัวเลือกข้อมูลมีที่เดียว** (บทเรียน D81): ย้าย `fetchAllTransactions`/`loadContactMap`/statement/ชุดรายงานภาษี/บิลไม่มีเลขใบกำกับ จาก `app/(app)/accounting/data.ts` ไป `lib/accounting/reportLoaders.ts` (รับ supabase client) คำต่อคำ · หน้าเว็บ (คุกกี้) และ connector (token ผู้ใช้) เรียกตัวเดียวกัน · ไม่แตะสูตร golden เดิมผ่านไม่แก้ไฟล์เทส
  - ปัดสตางค์ตอนส่งออกเท่านั้น (`money()`) — ยอดสะสมแบบ float ออกมาเป็น 12181.220000000001 · ปี พ.ศ. ถูกปฏิเสธ (ไม่เดาลบ 543) · บัญชีที่มองไม่เห็นตอบ "ไม่พบบัญชี" ไม่ใช่ statement ว่าง
  - Skill `docs/skills/month-end-close/SKILL.md` (ผู้ใช้อัปโหลดเองที่ claude.ai): ตัวเลขภาษีมาจาก `tax_report` เท่านั้น · ห้ามแก้ยอดบิลเดิม (บอก tx_id ให้ไปแก้ในแอป) · บิลที่ขาดลงผ่านการ์ดพร้อมรูปบิลจริง · ตาราง ภพ.30 เรียงตามช่องแบบ ⚠️ **ลำดับช่องเขียนจากความจำ ยังไม่ได้เทียบหน้าจอ e-Filing จริง** (skill สั่งให้ยึดหน้าจอจริง)
  - ✅ ยิงบนเครื่อง (dev ต่อ DB เจ้าของ · session ของ claudeacc): statement 19 แถว ยอดคงเหลือปัดถูก · ค้นยอด 1,258 เจอบิลเดียว · `tax_report` ก.ค. 2568 ภาษีขาย **21,800.63** ตรงตัวเลขที่จดไว้ใน D123 · เดือน/บัญชี/กิจการผิดได้ข้อความไทย
- **รอบ 7 (2026-10-29) — หลายบิลจากร้านใหม่เดียวกัน + get_bill** · ไม่มี migration
  - **ใช้จริง**: ส่งบิล Shopee 4 ใบ (ร้านใหม่ ไม่มีเลขภาษี) · Claude แบ่งเป็น 2 รอบ (บันทึกใบแรกให้คู่ค้าเกิดก่อน แล้วค่อยแสดงที่เหลือ) เพราะกลัวคู่ค้าซ้ำ · ✅ ตรวจ DB แล้วทั้ง 4 ใบผูก C-0067 ตัวเดียว ไม่มีคู่ค้าซ้ำ — ด่านตอนบันทึก (evaluate → resolveContact ถามทะเบียนใหม่ทุกครั้งก่อน createContact) ทำงานอยู่แล้ว ⇒ ที่ขาดคือ **Claude ไม่รู้ว่าด่านนี้มี**
  - แก้: คำสั่ง connector บอกให้ส่ง new_contact ตัวเดียวกันทุกใบแล้วแสดงการ์ดพร้อมกัน ห้ามแยกรอบ · กล่องคู่ค้าใหม่ในการ์ดบอกว่าใบที่บันทึกทีหลังจะผูกคู่ค้าเดิมเอง · `save_bill` คืน `contact` (added / linked) การ์ดแสดง *ใช้คู่ค้าเดิม C-xxxx* และบอก Claude ทาง model context
  - 🪤 ชื่อร้านที่ไม่มีเลขภาษีเดิมเทียบตรงตัว ⇒ Claude อ่านใบหนึ่งได้ `Shopee` อีกใบ `SHOPEE` = คู่ค้าซ้ำ · เปลี่ยนเป็นไม่สนตัวพิมพ์/ช่องว่างซ้อน (`nameKey`) + query `ilike` แบบตรงทั้งคำ (`ilikeExact` กัน `%` `_`) · ชื่อที่มีเลขภาษีในทะเบียนยังไม่ผูกด้วยชื่ออย่างเดียว
  - ผู้ใช้แจ้งอีกข้อ: Claude ตรวจงานรายบรรทัดหลัง edit_bill ไม่ได้ (search_transactions ไม่มีรายการ) → เครื่องมือใหม่ `get_bill` อ่านอย่างเดียว ≤20 บิล/ครั้ง คืนรายการ + หมวดสินค้า + งาน (ว่าง = null)
  - ✅ ยิงบนเครื่อง (DB เจ้าของ · อ่านอย่างเดียว): get_bill บิล Shopee ขึ้นงาน *ถังหมัก* · preview ด้วย `" SHOPEE "` ได้คู่ค้าเดิม C-0067 · test **2202**

### D142 — แอปขาย: บัญชีรับเงินสดแยก (0098, 2026-10-29)

- **ที่มา**: ผู้ใช้รับเงินสดจากออเดอร์ แต่ระบบลงบิลรายรับเข้าบัญชีธนาคาร (`sales_revenue_account`) ⇒ สเตทเม้นต์ไม่ตรง · เดิมตั้งใจจะโอนเงินเข้าธนาคารเอง แต่ทางนั้นไม่ช่วย เพราะในระบบเงินเข้าธนาคารวันที่ขาย ส่วนธนาคารจริงเห็นเงินวันที่เอาไปฝาก (คนละวัน · รวมก้อน · อาจหยิบไปใช้ก่อน) · ผู้ใช้เลือกให้มีช่องตั้งค่า
- **ของเดิม**: แอปขายเก็บวิธีรับเงินเป็นข้อความเฉย ๆ (`sales_orders.payment_method` + คำอธิบายบิล) ทุกวิธีลงบัญชีเดียว
- **ทำ**: kind ใหม่ `sales_cash_account` · `revenueAccountFor()` ใน `lib/sales/cashAccount.ts` = **จุดเดียว**ที่ตัดสิน (วิธี `เงินสด` + ตั้งไว้ → บัญชีเงินสด · นอกนั้นบัญชีหลัก) · `processOrder` เรียกตัวนี้ (เทสอ่านซอร์สกันหยิบ `config.accountName` ตรง) · แต่ละครั้งที่รับเงินตัดสินจากวิธีของครั้งนั้น (มัดจำเงินสด + ยอดค้างโอน = ลงคนละบัญชี) · ขายหน้าร้าน (POS) ผ่านทางเดียวกัน
- 🚨 **ไม่ตั้ง = พฤติกรรมเดิมทุกตัวอักษร** · บัตรเครดิต/เช็คยังลงบัญชีหลัก (สุดท้ายเข้าธนาคาร) · ไม่แปลงบิลเก่าให้เอง (ผู้ใช้เลือกแก้รายใบที่หน้าแก้บิล หรือบันทึกโอนธนาคาร→เงินสดก้อนเดียว)
- ★ **ไม่แตะ RPC**: `fn_apply_order_action` เขียน account_name ตามที่ได้รับ ⇒ กติกาอยู่ฝั่ง TS ที่เดียว (ต่างจากบาร์ D116 ที่ตัดสินใน SQL) · ★ **ยกเลิกออเดอร์ไม่ต้องแก้**: `fn_cancel_order` เปลี่ยนสถานะบิลเดิมเป็น `ยกเลิก` ⇒ ย้อนจากบัญชีที่รับไว้จริงเสมอ · ★ **ไม่กระทบภาษี**: รายงานภาษีไม่กรองบัญชีแล้ว (D124)
- **migration 0098**: CHECK whitelist ของ `app_settings.kind` (ยกจาก 0084 ครบ + kind ใหม่ · D80) + `fn_account_setting_kinds()` เติม kind ใหม่ (🚨 ไม่เติม = เปลี่ยนชื่อบัญชีแล้วค่าตั้งนี้ชี้ไปบัญชีที่ไม่มี · ลบบัญชีที่ตั้งไว้ได้ · D125) · สิทธิ์เขียน = `admin` เหมือน `sales_revenue_account` (ไม่ต้องแก้ `app_setting_cap`)
- **จอ**: ตั้งค่า → กิจการ → การ์ด *กิจการและบัญชีที่รับรายได้จากการขาย* เพิ่มช่อง **บัญชีที่เงินสดเข้า** (ค่าว่าง = ใช้บัญชีเดียวกัน) + ประโยคใต้การ์ดจาก `cashSettingText()` บอกว่าเงินสดไปลงที่ไหน และตอนฝากให้บันทึก *โอนเงินระหว่างบัญชี* · `activeAccountNames()` รับ keep หลายค่า (คงบัญชีที่ตั้งไว้แม้ปิดใช้ ทั้ง 2 ช่อง)
- golden **S14** (12 เทส) · S1-S13 ผ่านโดยไม่แก้ไฟล์เทส · test **2214** · ✅ **0098 ลงครบ 2 DB แล้ว** (ผู้ใช้ลงเอง) · ✅ **เทสเบราว์เซอร์ส่วนที่ 100 ผ่าน** (siamdist · ไม่ตั้ง → เงินสดลงธนาคาร · ตั้งแล้ว → เงินสด/โอนแยกบัญชี · มัดจำเงินสด+ยอดค้างโอน แยกบัญชี · ยกเลิกแล้ว 2 บิลเป็นยกเลิกในบัญชีเดิม · ลบบัญชีถูกกัน · เปลี่ยนชื่อแล้วค่าตั้งตาม) · 🟡 **เจอบนจอ 2 จุด แก้แล้ว**: (1) ประโยคใต้การ์ดเปลี่ยนตามดร็อปดาวน์ทันทีแล้วขึ้นต้นว่า "ตอนนี้…" ทั้งที่ยังไม่บันทึก (ตระกูล D80) → ประโยคบอกค่าที่บันทึกไว้เสมอ + แถบเหลือง *ยังไม่ได้บันทึก* · เลือกบัญชีเดียวกับบัญชีหลัก = server เก็บเป็นไม่ตั้ง (2) ตัวเลือก "ใช้บัญชีเดียวกับด้านซ้าย" ผิดบนจอแคบ (ช่องเรียงลงล่าง) → "บัญชีที่เงินเข้า" · ชุดเทส `docs/TESTING.md` ส่วนที่ **100**

### D143 — แอปขาย: ตารางการรับเงิน sales_payments (เฟส 1 ของแบ่งชำระหลายงวด · 0099, 2026-10-30)

- **ที่มา**: ผู้ใช้ขอปุ่มแก้วิธีชำระ (ลงผิดแล้วอยากแก้ก่อนส่งใบเสร็จ) + แบ่งชำระมากกว่า 2 งวด และปรับ % งวดที่ยังไม่จ่ายได้ (เช่น 50/20/30 → รวบ 20+30 · สลับ 30/20 · แตก 20/20/10) · ตกลงแผน 3 เฟส: **1 ตารางการรับเงิน → 2 แก้วิธีชำระ (หัวหน้าฝ่ายขายขึ้นไป · เปลี่ยนเป็นเช็คได้ · แก้เอกสารด้วย) → 3 แผนงวด** · ผู้ใช้ยืนยัน: ออกใบกำกับ/ใบเสร็จแยกใบต่องวด
- 🔴 **บั๊กที่มีอยู่แล้ว**: ออเดอร์มี `payment_method` ช่องเดียว ⇒ รับยอดค้างแล้วค่าของมัดจำถูกเขียนทับ · **พิมพ์ใบเสร็จค่ามัดจำซ้ำหลังรับยอดค้าง = ขึ้นวิธีชำระของยอดค้าง** (`print.ts` อ่านช่องเดียวกันทุกใบ)
- **ทำ (เฟส 1)**: ตาราง `sales_payments` 1 แถว = รับเงิน 1 ครั้ง (ป้าย · ยอด · วิธีชำระ · เช็ค · วันที่ · เลขเอกสาร · `tx_id`) · `fn_apply_order_action` เขียนแถวต่อจากบิลรายรับ **ใต้ `not v_dup`** (กดซ้ำไม่เกิดแถวซ้ำ) · ใบเสร็จอ่านวิธีชำระ/เช็คของครั้งนั้นผ่าน `paymentForDoc()` (จับคู่ด้วย **ป้าย** ไม่ใช่ลำดับ) · ป้ายชุดเดียว `PAY_LABEL` ใช้ทั้งแถว/LINE/backfill
- ★ **เฟส 1 ไม่เปลี่ยนโฟลว์**: ช่องเดิมบนออเดอร์ (`tax_no1/2` · `check_detail1/2` · `payment_method`) ยังถูกเขียนเหมือนเดิมทุกตัวอักษร ⇒ ตัวออกเลขเอกสาร (D100) · ยกเลิกออเดอร์ · หน้าลูกหนี้ฝั่งบัญชี **ไม่ต้องแตะ** · golden S1-S14 ผ่านโดยไม่แก้ไฟล์เทส
- ★ **ไม่มีคอลัมน์สถานะ**: ถูกยกเลิกหรือไม่ อ่านจาก `transactions.status` ของ `tx_id` — ยกเลิกออเดอร์หรือยกเลิกบิลจากหน้าค้นบิล แถวรู้เองโดยไม่ต้อง sync (กันความจริง 2 แหล่ง · D81)
- **backfill**: ครั้งที่ 1 = บิล key ออเดอร์ (`มัดจำ` ถ้า deposit > 0 · ไม่งั้น `ชำระเต็ม`) · ครั้งที่ 2 = key `-balance` · วิธีชำระอ่านจากวงเล็บท้ายคำอธิบายบิล (`processOrder` เขียนไว้ทุกใบ) 🚨 ไม่มีในคำอธิบาย → ครั้งที่ 1 ใช้ช่องของออเดอร์ได้**เฉพาะเมื่อยังไม่มีครั้งที่ 2** (ไม่งั้นคือบั๊กเดิมซ้ำ) · เช็ค: มัดจำช่อง 1 · ที่เหลือช่อง 2 · รวมบิลที่ยกเลิกแล้ว · audit trigger สร้าง**หลัง** backfill (ไม่ท่วม edit_log)
- 🚨 **ไม่มี policy เขียน** — เขียนได้ทางเดียวคือ RPC definer · อ่านได้ทั้ง `sales.read` และ `acct.read` (เหมือนออเดอร์) · grant ในไฟล์เดียวกัน (D118) · `fn_mig_truncate` เติมก่อน `sales_orders` · ทะเบียนตาราง 4 ที่ (D79)
- 🪤 **เกือบใส่ generated column** (`qu_no#seq` เป็นป้ายใน edit_log) — `restore:tenant` insert ทุกคอลัมน์จากไฟล์สำรอง = ล้ม และทั้งระบบยังไม่มี generated column สักตัว → ใช้ `qu_no` เป็นป้ายแทน
- `fn_apply_order_action`/`fn_mig_truncate` ยกด้วยสคริปต์ + `diff` (กัน D79) · signature เดิม = สิทธิ์เดิม (D99) · golden **S15** (12) + `tests/tenant/sales-payments.test.ts` (6) · test **2226** · ✅ **0099 ลงครบ 2 DB** (ผู้ใช้ลงเอง) · backfill siamdist ครบ 11/11 บิล (QU261029-004 ได้มัดจำเงินสด/ยอดค้างโอน ถูกตามจริง ทั้งที่ช่องเดิมเก็บแค่โอน) · ✅ `test:tenant` **522** (28 ไฟล์) · ✅ **เทสเบราว์เซอร์ส่วนที่ 101 ผ่าน**: มัดจำเช็ค + ยอดค้างโอน → ใบเสร็จมัดจำขึ้น *เช็ค* พร้อมข้อมูลเช็ค (ช่องเดิมของออเดอร์เป็น *โอนเงิน* แล้ว · โค้ดเดิมจะขึ้นโอนเงินและบรรทัดเช็คหาย) · ใบเสร็จยอดค้างขึ้น *โอนเงิน* ไม่มีบรรทัดเช็ค · ขายหน้าร้านขึ้นเงินสด · ตัวกรองประวัติมีตารางใหม่ · ยกเลิกแล้วบิลเป็นยกเลิก แถวการรับเงินคงอยู่ (สถานะอ่านจากบิล) · 🪤 เทสครั้งแรกค้าง "กำลังโหลด…" เพราะหน้าต่าง Claude ไม่ได้แสดงบนจอ (React สลับเนื้อหาที่สตรีมมาตอนเฟรมถัดไป) ไม่ใช่บั๊กของแอป · ⏳ หน้าคลัง "พิมพ์เอกสาร" ส่งการรับเงินไปด้วยแล้วแต่ยังไม่ได้กดดูบนจอ · ชุดเทส `docs/TESTING.md` ส่วนที่ **101**

### D144 — แอปขาย: แก้วิธีชำระของการรับเงินที่บันทึกไปแล้ว (เฟส 2 · 0100, 2026-10-30)

- **ที่มา**: ลงวิธีชำระผิด (เช่น รับโอนแต่กดเงินสด) — ผู้ใช้ตัดสิน: แก้ได้ทุกวิธี **รวมเปลี่ยนเป็นเช็ค** · **หัวหน้าฝ่ายขายขึ้นไป** (`sales.config`) · ส่วนใหญ่แก้ก่อนส่งใบเสร็จให้ลูกค้า ⇒ **แก้แล้วเอกสารต้องเปลี่ยนตาม**
- **ทำ**: `fn_sales_edit_payment` แก้ 3 ที่ใน transaction เดียว — แถว `sales_payments` (วิธี/เช็ค) · บิลรายรับ (บัญชีตามวิธีใหม่ + วงเล็บท้ายคำอธิบาย) · ช่องเดิมบนออเดอร์ (`payment_method` เฉพาะเมื่อแก้ครั้งล่าสุด · `check_detail1/2` ตามป้าย) ★ ช่องเดิมยังเป็นทางสำรองของใบเสร็จออเดอร์ที่ไม่มีแถว — ปล่อยค้างค่าเก่า = ความจริง 2 แหล่ง (D81)
- ★ **เอกสารเปลี่ยนตามเอง**: ใบเสร็จอ่านแถวของครั้งนั้นอยู่แล้ว (D143) · หลังแก้มีปุ่ม **พิมพ์ใบนี้ใหม่** ได้**เลขเดิม** (`receiptDocFor()` กติกาเดียวกับปุ่มพิมพ์เดิม)
- ★ **บัญชีปลายทาง** ตัดสินฝั่ง server action ด้วย `revenueAccountFor()` ตัวเดียวกับตอนรับเงิน (D142) ⇒ เงินสด → โอน บิลย้ายกลับบัญชีหลักเอง · RPC ตรวจว่าบัญชีมีจริงของลูกค้ารายนี้ (กันยิงตรงด้วยชื่อมั่ว) · ข้อความหลังแก้บอกว่าบิลย้ายบัญชีไหน → ไหน (`editPaymentDoneText`)
- 🚨 **ไม่แตะ** ยอด · VAT · เลขเอกสาร · วันที่ · สต็อก (วิธีชำระไม่มีผลกับรายงานภาษี D124) · บิลที่ยกเลิกแล้วแก้ไม่ได้ (บอกเลขบิล) · เช็ค → ต้องมีรายละเอียด · เช็คเดิม → เช็คเดิมได้ (แก้เลขที่ที่กรอกผิด)
- **จอ**: ปุ่ม **แก้วิธีชำระ** ในหน้าจัดการออเดอร์ โชว์เมื่อออเดอร์เคยรับเงิน (`hasReceivedPayment` ตัดสินจาก**ยอด** ไม่ใช่สถานะ — "รอคลังจัดส่ง" มีทั้งรับมัดจำแล้วและส่งเครดิต) · พนักงานขายเห็น**ปุ่มเทา**พร้อมเหตุผล (D86) · ป๊อปอัพแยกไฟล์ `EditPaymentDialog.tsx` (OrdersTab ยาวแล้ว) · ปิดด้วย mousedown ที่พื้นหลัง + Esc (D73)
- ★ รูปข้อความเช็คแหล่งเดียว `chequeText()` — หน้าต่างรับเงินเดิมเลิกประกอบเอง (เทสอ่านซอร์สกันก๊อป) · `PAY_METHODS` ชุดเดียวทั้งจอ/action/SQL (เทสเทียบ)
- golden **S15** +7 · `tests/tenant/sales-payments.test.ts` +6 (แก้แล้ว 3 ที่ตรงกัน · ยอดไม่ขยับ · กันข้อมูลผิด 4 แบบ · พนักงานขายแก้ไม่ได้ · ลูกค้าอื่นแก้ไม่ได้ · บิลยกเลิกแก้ไม่ได้) · test **2236** · ✅ **0100 ลงครบ 2 DB** (ผู้ใช้ลงเอง) · ✅ `test:tenant` **528** · ✅ **เทสเบราว์เซอร์ส่วนที่ 102 ผ่าน** (siamdist): ขายหน้าร้านเงินสด → แก้เป็นโอน → พิมพ์ใบนี้ใหม่ได้ TAX261030-004 เลขเดิม ชนิดเอกสารเดิม ขึ้นโอนเงิน · → เช็ค: ปุ่มเทาจนกรอกครบ แล้วใบขึ้นข้อมูลเช็ค · DB ตรงกัน 3 ที่ ยอด/VAT/เลขใบกำกับไม่ขยับ · edit_log บันทึก · มัดจำเงินสด+ยอดค้างโอน แก้ครั้งที่ 1 เป็นบัตรเครดิต → ใบเสร็จมัดจำขึ้นบัตรเครดิตทั้งจากพิมพ์ใบนี้ใหม่และพิมพ์ชุดแรก ใบยอดค้างยังโอนเงิน · ออเดอร์ยังไม่รับเงินไม่มีปุ่ม · รับมัดจำแล้วรอคลังมีปุ่ม · ยกเลิกแล้วปุ่มหาย · 🟡 **เจอบนจอ 3 จุด แก้แล้ว**: (1) วันที่ขึ้น `2026-10-30` ทั้งที่ทั้งแอปเป็นวันที่ไทย → `formatThaiDate` (2) แก้เลขที่เช็คที่กรอกผิดต้องพิมพ์ธนาคารใหม่ทั้งหมด → `parseCheque()` เติมค่าเดิม (ย้อนรูปของ `chequeText` · รูปอื่นไม่เดาแยก) (3) ปุ่มเทาตอนยังไม่เปลี่ยนวิธีบอกเหตุผลแค่ใน title (มือถือมองไม่เห็น) → บรรทัด *เลือกวิธีชำระใหม่ก่อน ถึงจะบันทึกได้* (D83) · ⏳ ยังไม่ได้เห็นบนจอ: ปุ่มเทาของพนักงานขาย (ต้องล็อกอินเป็นพนักงานขาย · RPC ปฏิเสธพิสูจน์แล้วใน test:tenant) และบิลย้ายบัญชี (siamdist ไม่ได้ตั้งบัญชีเงินสดแยก · พิสูจน์แล้วใน test:tenant) · ชุดเทส `docs/TESTING.md` ส่วนที่ **102**

### D145 — แอปขาย: แบ่งชำระหลายงวด เฟส 3a — แผนงวด + กติกาที่ DB บังคับ (0101, 2026-10-30)

- **ที่มา**: ต่อจาก D143/D144 · ผู้ใช้ตกลง: ใบเสนอราคาใหม่ทุกใบใช้ตัวแก้งวด (มัดจำเดิม = แผน 2 งวด) · ออเดอร์ที่ค้างอยู่ใช้ปุ่มเดิมจนปิด · สถานะใหม่ **กำลังผ่อนชำระ** (รับเงินแล้วบางงวด ยังไม่ส่งของ — ใช้ "รอคอนเฟิร์ม" ต่อไม่ได้เพราะแก้ใบเสนอราคาได้ทั้งที่รับเงินแล้ว) · ใบเสร็จรายงวดหัว "(งวดที่ k/n)" + ยอดตามสัญญา/รับก่อนหน้า/งวดนี้/คงเหลือ (ทำใน 3c) · จุดส่งของผูกงวด + ปุ่มส่งคลังตอนนี้ · รับตามลำดับ · ยอดไม่เท่างวดให้งวดสุดท้ายรับส่วนต่าง
- **แบ่ง 3 เฟสย่อย**: **3a** ข้อมูล+กติกา (เฟสนี้ · ยังไม่มีหน้าจอ) · 3b ตัวแก้งวดในใบเสนอราคา · 3c การ์ดออเดอร์ + ใบแจ้งหนี้/ใบเสร็จรายงวด + ปรับงวด
- **ตาราง `sales_installments`** (ชื่อ · % ที่กรอก · ยอดบาท · วันครบกำหนด · เลขใบแจ้งหนี้ของงวด · ธงจุดส่งของ) + `sales_payments.installment_seq` · "รับแล้ว" = มีแถวการรับเงินที่บิลยังไม่ยกเลิก (`sales_installment_paid()` แหล่งเดียวใน SQL · `getOrderPlan()` กติกาเดียวกันฝั่ง TS)
- **กติกาที่ DB บังคับ** (TS ตรวจก่อนเพื่อข้อความไทย · RPC ตรวจซ้ำกันยิงตรง): รับตามลำดับ (ตรวจ**ก่อน**ลงบิล) · งวดที่รับแล้ว/ออกใบแจ้งหนี้แล้ว**ล็อกและต้องอยู่ต้นแผน** · งวดที่ยังไม่ล็อกรวมต้องเท่า (ยอดค้าง − งวดล็อกที่ยังไม่รับ) พอดี · รับไม่เท่ายอดงวด → งวดนั้นเก็บยอดจริง ส่วนต่างไปงวดสุดท้าย · 🚨 **งวดสุดท้ายต้องรับเต็ม** (ไม่งั้นยอดค้างไม่มีงวดรองรับ) · จุดส่งของได้งวดเดียว และตั้งไม่ได้เมื่อส่งคลังแล้ว · ใบแจ้งหนี้ออกได้เฉพาะงวดถัดไป · ยกเลิกใบแจ้งหนี้รายงวด = `sales.config` · ออเดอร์ที่รับเงินแบบเดิมไปแล้วตั้งแผนไม่ได้ · ปุ่มแบบเดิมกับออเดอร์มีแผน (และกลับกัน) ใช้ไม่ได้ (`planActionError`)
- **ยอดบาทคิดฝั่ง TS** `planAmounts()` — ปัดทุกงวด **งวดสุดท้ายรับเศษ** (ผลรวมเท่ายอดทุกสตางค์) · % คิดจากยอดสุทธิหลังหัก ณ ที่จ่าย (เหมือนมัดจำ D45) · ยอดค้างเป็น % ไม่ลงตัว (ลูกค้าจ่ายขาด) ตั้งได้ คลาด 0.01%
- **processOrder**: action ใหม่ `RECEIVE_INSTALLMENT` / `SHIP_PLAN` · ถอด VAT/WHT ต่องวดด้วย `reverseVatWht` ตัวเดิม (แบบมัดจำ) · รายการสินค้าแนบเฉพาะงวดแรกที่รับ · key `ORD-iN` · 🚨 **ไม่ลงช่องเลขเดิมของออเดอร์** (tax_no1/2 · check_detail) — ใบเสร็จรายงวดเก็บเลขที่แถวการรับเงิน · `statusAfterInstallment()` ตัดสินสถานะ (ส่งคลังเมื่อถึงจุดส่งของ **หรือรับครบทุกงวดแล้ว** — ไม่ค้างของไว้) · `Record<OrderAction,…>` บังคับเติมชื่อ action ใหม่ (D84) · 🚩 **golden S1-S15 ผ่านโดยไม่แก้ไฟล์เทส**
- 🪤 **ป้ายงวดขึ้นต้น "งวดที่ k" เสมอ** — ชื่องวด "มัดจำ" เปล่า ๆ จะชนป้ายการรับเงินแบบเดิม แล้ว `paymentForDoc()` จับผิดใบ
- **ยกฟังก์ชันด้วยสคริปต์ + diff** (กัน D79): `fn_apply_order_action` (ตรวจลำดับ · installment_seq · ปรับยอดงวด) · `fn_cancel_order` (void บิลทุกงวดตามแถวการรับเงิน) · `fn_doc_nos` (เลขใบเสร็จ/ใบแจ้งหนี้รายงวดนับเป็นเลขที่ใช้แล้ว — ไม่งั้นออกเลขซ้ำได้) · `fn_mig_truncate`
- 🔴 **เทสกันซ้ำจับได้ระหว่างทาง**: ปุ่มออกใบแจ้งหนี้รายงวดเรียก `fn_next_doc_no` ซ้ำอีกจุด (D100 ล็อกให้ขอเลขจุดเดียว) → `nextSalesDocNo()` ระดับไฟล์ ใช้ทั้งสองทาง
- ⏳ **ส่งต่อเฟส 3b**: ตัวแก้งวดในใบเสนอราคา · 🚨 แก้ใบเสนอราคาหลังมีงวดล็อกต้องถูกบล็อก (ยอดสุทธิเปลี่ยน = แผนไม่ตรง) · 3c: ซ่อนปุ่ม "แก้ไข" ของออเดอร์ที่มีงวดล็อก
- golden **S16** (24) + `tests/tenant/sales-installments.test.ts` (18) · test **2260** · ✅ **0101 ลงครบ 2 DB** (ผู้ใช้ลงเอง) · ✅ `test:tenant` **547** (29 ไฟล์) — รอบแรกแดง 1 ข้อและ**เป็นเทสที่เขียนผิดเอง**: ยิง `fn_doc_no_taken` ตรง ซึ่งรับ `p_tenant` จึงถูกปิดจากผู้ใช้ตั้งแต่ D99 (`permission denied` = ถูกต้อง) → ถามผ่าน `fn_doc_manual_check` ตัวที่หน้าจอใช้จริง + positive control เลขว่างต้องตอบ false · ✅ **เทสเบราว์เซอร์ 103.2 ผ่าน**: ขายหน้าร้าน (TAX261030-007 เงินสด) · ออเดอร์มัดจำเงินสด → ส่งของ → ยอดค้างโอน → ปิดการขาย ปุ่มแบบเดิมครบ แถวการรับเงิน `installment_seq` ว่างตามแบบเดิม · ยกเลิกเก็บกวาดแล้ว · ชุดเทส `docs/TESTING.md` ส่วนที่ **103**

### D146 — แอปขาย: แบ่งชำระหลายงวด เฟส 3b — ตัวแก้งวดในใบเสนอราคา (0102, 2026-10-30)

- **ทำ**: ช่องติ๊ก "กำหนดเงื่อนไขมัดจำ" → **แบ่งชำระเป็นงวด** + `InstallmentEditor` (ชื่องวด · % · ยอดบาท · จุดส่งของ · รวมกับงวดถัดไป · เพิ่ม/ลบงวด) — คอมโพเนนต์เดียวจะใช้ต่อในป๊อปอัพปรับงวดของเฟส 3c · เปิดมาเป็นแผนตั้งต้น **มัดจำ 50% (จุดส่งของ) + ส่วนที่เหลือ** = โฟลว์มัดจำเดิม · เพิ่มงวดเติม % ที่ขาดให้เอง
- ★ **ยอดบนจอ = ยอดที่บันทึก**: ตัวแก้คิดด้วย `planAmounts()` ตัวเดียวกับ server · ข้อความผิดมาจาก `planError()` ตัวเดียวกับที่ server ตรวจ · ปุ่มบันทึกเทา + `MissingHint` "แผนงวดให้ถูกต้อง"
- **บันทึก**: ตรวจแผน**ก่อน**สร้างใบเสนอราคา (ไม่งั้นได้ใบที่ไม่มีแผนค้าง) · แผนบันทึกหลังได้เลข QU — ล้ม = **เหลือง** บอกให้กดแก้ไขแล้วตั้งใหม่ (D79 · ไม่ใช่เขียว) · มีแผน = ปิด `is_deposit` แบบเดิมเสมอ (`withPlan()` · ไม่งั้นหน้าออเดอร์โชว์ปุ่มมัดจำเดิมซ้อน)
- **แก้ใบเสนอราคา**: เติมแผนเดิมกลับ · ใบเก่าที่ติ๊กมัดจำไว้ (ยังไม่มีแผน) แปลงเป็นแผน 2 งวดตอนเปิดแก้ · ยอดสุทธิเปลี่ยน → ตั้งแผนใหม่ทั้งชุด (ปิดแบ่งงวด = ลบแผน) · 🚨 มีงวดที่ออกใบแจ้งหนี้/รับเงินแล้ว = **แก้ใบเสนอราคาไม่ได้**
- **0102 — DB บล็อกการแก้ใบเสนอราคาเอง**: ออกใบแจ้งหนี้งวดแรก → สถานะ `รอคอนเฟิร์ม` → `รอชำระมัดจำ` (สถานะเดียวกับใบแจ้งหนี้มัดจำเดิม D45) · `fn_update_quotation` รับแค่ "รอคอนเฟิร์ม" อยู่แล้ว ⇒ **ไม่ต้องยกฟังก์ชันนั้น** · ยกเลิกใบแจ้งหนี้จนไม่เหลือและยังไม่รับเงิน → กลับ `รอคอนเฟิร์ม` · ยกจาก 0101 ด้วยสคริปต์ + diff
- **ใบเสนอราคาพิมพ์เงื่อนไขการชำระ** ใต้หมายเหตุ (`planTermsLines()` ประโยคเดียวทั้งตอนสร้างและพิมพ์ซ้ำจากหน้าออเดอร์ · พิมพ์ซ้ำโหลดแผนปัจจุบัน · โหลดไม่ได้ = ปิดหน้าต่างแล้วบอก D89)
- 🟡 **เทสเบราว์เซอร์เจอ 1 จุด แก้แล้ว**: แผนรวมไม่ครบบนใบเสนอราคาใหม่ขึ้นว่า *"งวดที่ยังไม่รับรวมได้ 90% แต่ยอดค้างคือ 100%"* = ประโยคของการปรับงวด ไม่เข้ากับใบที่ยังไม่มีเงินเข้า + บอกซ้ำกับบรรทัดผลรวม → *"งวดรวมได้ 90% แต่ต้องได้ 100%"* (ปรับงวดต่อท้าย "(เท่ายอดค้าง)") · บรรทัดผลรวมเหลือแค่ "รวม 90%" สีเหลือง
- 🪤 เทสอ่านซอร์สจับคำในคอมเมนต์ของตัวเอง ("แทน กำหนดเงื่อนไขมัดจำ") → ตรวจเฉพาะ JSX (กับดัก D95)
- ✅ **เทสเบราว์เซอร์ (siamdist)**: สร้างใบเสนอราคา 50/20/30 → DB ได้ 525/210/315 จุดส่งของงวด 3 `is_deposit=false` · ใบเสนอราคาพิมพ์ 3 บรรทัดเงื่อนไข · กดแก้ไขแล้วแผนเติมกลับครบ · เพิ่มสินค้า (1,400) + รวมงวด 2+3 → 700/700 จุดส่งของติดไปงวดที่รวม · แผนรวม 90% → ปุ่มเทา · ยกเลิกเก็บกวาดแล้ว · ⏳ ยังไม่ได้เทส: แปลงใบเก่าที่ติ๊กมัดจำ (ไม่มีใบค้างให้ลอง · มีเทสหน่วย) และการบล็อกแก้หลังออกใบแจ้งหนี้ (ต้องลง 0102 · มีเทส tenant)
- 🚨 **ห้าม push ก่อนจบ 3c**: ออเดอร์ที่ตั้งแผนแล้วยังโชว์ปุ่มรับเงินแบบเดิม ซึ่ง server ปฏิเสธ (`planActionError`) — ปุ่มรับชำระรายงวดมาในเฟส 3c
- golden **S16** +5 · `tests/tenant/sales-installments.test.ts` +2 · test **2265** · ✅ **0102 ลงครบ 2 DB** (ผู้ใช้ลงเอง) · ✅ `test:tenant` **549** (ใบแจ้งหนี้งวดแรก → รอชำระมัดจำ · fn_update_quotation ปฏิเสธ · ยกเลิกใบแจ้งหนี้ → กลับรอคอนเฟิร์ม พิสูจน์บน DB จริง) · ชุดเทส `docs/TESTING.md` ส่วนที่ **104**

### D147 — แอปขาย: แบ่งชำระหลายงวด เฟส 3c — การ์ดงวดในหน้าจัดการออเดอร์ + เอกสารรายงวด (ไม่มี migration, 2026-10-30)

- **ทำ**: `PlanPanel.tsx` (ไฟล์ใหม่ · OrdersTab ยาวแล้ว) แถวต่อจากออเดอร์ที่มีแผน ทั้งจอกว้างและมือถือ — ตารางงวด (ชื่อ · % · ยอด · ใบแจ้งหนี้ · สถานะ) + ปุ่มต่อแถว **ออกใบแจ้งหนี้** / **ใบแจ้งหนี้** / **ยกเลิกใบแจ้งหนี้** (`sales.config`) / **รับชำระงวดที่ k** / **ใบเสร็จ** · ท้ายการ์ด **ปรับงวด** · **ส่งคลังตอนนี้** · **ใบแจ้งหนี้/ใบส่งสินค้า** (หลังส่งคลัง)
- 🚨 **ออเดอร์ที่มีแผนไม่โชว์ปุ่มรับเงินแบบเดิม** (`hasPlan()` · server ปฏิเสธอยู่แล้วด้วย `planActionError` — ปุ่มที่กดแล้วพังห้ามมี) · ปุ่มรับชำระมีแค่**งวดถัดไป** (รับตามลำดับ D145)
- **รับชำระ**: หน้าต่างรับเงินตัวเดิม (วิธีชำระ · เช็ค · ลงย้อนหลัง) ยอดตั้งต้น = ยอดงวด แก้ได้ · `receiveAmountError()` ตัวเดียวกับ server ⇒ งวดสุดท้ายรับไม่เต็ม = ปุ่มเทาพร้อมเหตุผล · รับไม่เท่ายอดงวด → บรรทัดบอกว่าส่วนต่างไปงวดสุดท้าย
- **ปรับงวด**: `InstallmentEditor` ตัวเดียวกับใบเสนอราคา (D146) · งวดล็อกแสดงเป็นหัว "งวดที่ 1-k ล็อกแล้ว" · ยอดที่ต้องแบ่ง = ยอดค้าง − งวดล็อกที่ยังไม่รับ · ข้อความผิดจาก `planError()` ตัวเดียวกับ server
- **เอกสารรายงวด** (`print.ts`): `invoice-installment:k` · `tax-invoice-installment:k` หัว "(งวดที่ k/n)" · ผู้ไม่จด VAT = **ใบเสร็จรับเงิน** (ม.86/13 · เทสล็อก) · แถวสรุป **ยอดตามสัญญา · รับก่อนหน้า · งวดนี้ (ก่อน VAT · VAT · หัก ณ ที่จ่าย) · คงเหลือ** จาก `installmentDocFigures()` 🚨 **คิดจากแผน ไม่อ่านยอดค้างปัจจุบัน** ⇒ พิมพ์ใบงวด 1 ซ้ำหลังรับงวด 2 ตัวเลขไม่ขยับ · วิธีชำระ/เช็คอ่านจากแถวการรับเงินของงวดนั้น (`paymentForDoc` จับด้วยเลขงวด ไม่ใช่ป้าย — ชื่องวดแก้ได้) · ใบแจ้งหนี้/ใบส่งสินค้าของออเดอร์แผนใช้ป้าย **หัก รับชำระแล้ว** (ไม่ใช่ "หัก มัดจำ")
- **ข้อมูล**: `loadPlans()` โหลดแผน+การรับเงินของทุกออเดอร์ในครั้งเดียว (ไม่ยิงต่อแถว) · หน้าคลังได้แผนด้วย (พิมพ์เอกสารจากคลังขึ้นยอดถูก)
- 🟡 **เทสเบราว์เซอร์เจอ 4 จุด แก้แล้ว** (ประโยค/ตัวเลขบนจอ ตรรกะไม่ผิด): (1) ป้าย "ส่งของ · ส่งของ" ซ้ำ → "· จุดส่งของ" (2) % ค้างค่าที่กรอกตอนวางแผน หลังรับไม่เท่ายอดงวด → `shownPercent()` คิดจากยอดจริง (3) หัวหน้าต่าง "รับชำระงวด งวดที่ 2" → "รับชำระ งวดที่ 2" (4) ล็อกงวดเดียวขึ้น "งวดที่ 1-1" → "งวดที่ 1"
- ✅ **เทสเบราว์เซอร์ครบลูป** (siamdist · ยอดสุทธิ 1,050 · แผน 50/20/30 จุดส่งของงวด 3): ออกใบแจ้งหนี้งวด 1 → `รอชำระมัดจำ` ปุ่มแก้ไขหาย · รับงวด 1 เงินสด 525 (TAX261030-010 · ใบเสร็จ 490.65 + VAT 34.35) → `กำลังผ่อนชำระ` · ปรับงวดเป็น 30/20 (315/210) · รับงวด 2 แค่ 300 → งวดสุดท้ายเป็น 225 เอง · รับงวดสุดท้ายไม่เต็ม = เทาพร้อมเหตุผล · รับ 225 → `รอคลังจัดส่ง` + INV ใบส่งของ (ขึ้น "หัก รับชำระแล้ว") → คลังยืนยัน → `ปิดการขาย` · DB: บิล 3 ใบรวม 1,050.00 · VAT รวม 68.70 vs ออเดอร์ 68.69 (ปัดต่อใบกำกับ 1 สตางค์ เหมือนมัดจำ+ยอดค้างเดิม · ภพ.30 คิดจากผลรวมฐาน) · `tax_no1/2` ไม่ถูกแตะ · **ส่งคลังตอนนี้** (ออเดอร์ 350 แผน 50/50) → `รอคลังจัดส่ง` / ถัดไป `ส่งของแล้วรอชำระยอดค้าง` ไม่มีบิลเกิด · ยกเลิก 2 ออเดอร์ → บิลทุกงวดเป็นยกเลิก · ⏳ ยังไม่ได้เห็นบนจอ: พนักงานขายเห็นปุ่มยกเลิกใบแจ้งหนี้เทา (RPC ปฏิเสธพิสูจน์แล้วใน test:tenant) · ผู้ไม่จด VAT (มีเทสหน่วย)
- golden **S16** +7 · test **2272** · ไม่มี migration · ชุดเทส `docs/TESTING.md` ส่วนที่ **105**
- ★ **จบงานแบ่งชำระหลายงวด D143-D147** · push ได้แล้ว (0098-0102 ลงครบ 2 DB)

### D148 — แอปขาย: "ประเภทรายได้" ใช้ลิสต์หมวดหมู่รายรับของบัญชี (ไม่มี migration, 2026-10-30)

- **ต้นเรื่อง**: ผู้ใช้ถามว่าดร็อปดาวน์ *ประเภทรายได้ (สำหรับบัญชี)* ในหน้าสร้างใบเสนอราคาเอาข้อมูลมาจากไหน — **ฮาร์ดโค้ด 4 ตัวไว้ใน `QuotationTab.tsx`** (รายได้ค่าสินค้า / ค่าบริการ / ค่าที่ปรึกษา / อื่น ๆ) แก้จากแอปไม่ได้ ทั้งที่ค่านี้ไปเป็น `transactions.category` ของบิลรายรับ · ขายหน้าร้านฮาร์ดโค้ด `"รายได้ค่าสินค้า"` อีกจุดใน `posSaleAction`
- **ผู้ใช้เลือก**: ใช้ลิสต์ **หมวดหมู่รายรับ** ของบัญชี (`app_settings.income_cat` · ตั้งที่ บัญชี → ตั้งค่า) แทนลิสต์แยกของฝ่ายขาย — แก้ที่เดียวมีผลทั้งสองฝั่ง · หมวดของบิลขายตรงกับหมวดที่บัญชีใช้ · ไม่ต้องมี migration (ทางลิสต์แยกต้องเพิ่ม kind ใน CHECK whitelist และเสี่ยงสองลิสต์ไม่ตรงกัน)
- **กติกา** (`lib/sales/revenueCats.ts` · golden **S17**):
  - 🚨 ยังไม่ตั้ง (ลิสต์ว่าง) = **4 ตัวเดิมเป๊ะ** · ค่าปริยายของใบใหม่/ขายหน้าร้าน = `รายได้ค่าสินค้า` ถ้ายังอยู่ในลิสต์ ไม่งั้นตัวแรก ⇒ ลูกค้าที่ไม่ได้ตั้งอะไรพฤติกรรมไม่ขยับ
  - 🚨 แก้ใบเก่าที่หมวดหลุดจากลิสต์ไปแล้ว = หมวดเดิม**ต่อหัวไว้ในตัวเลือก** + บรรทัดบอก (ไม่งั้น `<select>` โชว์ตัวแรกแต่ state ยังเป็นค่าเดิม = หน้าจอโกหก)
  - ขายหน้าร้านอ่าน `income_cat` ฝั่ง server · อ่านไม่ได้ = error ไม่เดาค่าเริ่มต้น (D89)
  - คำอธิบายใต้ดร็อปดาวน์บอกว่าลิสต์มาจากไหน · ไม่มีโมดูลบัญชี = ไม่พูดถึงบัญชี (D133)
- ⚠️ **ข้อจำกัดที่รู้อยู่**: ลูกค้าที่ซื้อแอปขายแต่ไม่ซื้อบัญชี แก้ลิสต์ไม่ได้ (แท็บตั้งค่าบัญชีถูก `requireModule("accounting")` กั้น) → ใช้ 4 ตัวเดิม · แก้ลิสต์ต้องมี `acct.config`
- ★ ไม่แตะสูตร/RPC — ค่าที่ส่งเข้า `fn_save_quotation` ยังเป็นข้อความเหมือนเดิม · golden S1-S16 ผ่านโดยไม่แก้ไฟล์เทส
- test **2280** · ไม่มี migration · ชุดเทส `docs/TESTING.md` ส่วนที่ **106**
