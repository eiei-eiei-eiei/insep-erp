# Insep ERP (Next.js + Supabase) — คู่มือประจำ repo

> ระบบ ERP ภายในของโรงกลั่นสุราคราฟต์ (solo entrepreneur) — ย้ายมาจาก Google Apps Script + Google Sheets 3 แอป
> **เอกสารหลัก**: `docs/MIGRATION_PLAN.md` (แผนละเอียดทุก section — อ่านก่อนทำงานทุกครั้ง) + `docs/FLOW_REDESIGN.md` (โฟลว์/UI ใหม่ 4 workspace — ถ้าขัดกัน: เรื่องโฟลว์/UI ยึด FLOW_REDESIGN, เรื่องสูตร/ข้อมูล ยึด MIGRATION_PLAN sec 6)
> **งานที่เหลือ/ส่งต่อ session ใหม่**: `docs/NEXT_STEPS.md` — **อ่านก่อนเริ่มงานใหม่ทุกครั้ง**
> **หน้าตา/สี/ไอคอน**: `docs/DESIGN_SYSTEM.md` — **อ่านก่อนแตะ UI ทุกครั้ง** · ห้ามเขียนคลาสสีดิบ (`bg-slate-800`, `text-red-500`, hex) ใน component ใช้ token เท่านั้น
> **โค้ดระบบเดิม (reference)**: `docs/legacy/production/`, `docs/legacy/accounting/`, `docs/legacy/sales/`
> **ผู้ใช้เขียนโค้ดไม่ได้** — ส่งมอบไฟล์เต็มเสมอ อธิบายขั้นตอนที่ผู้ใช้ต้องทำเอง (รันคำสั่ง/กดปุ่ม) ทีละบรรทัด ตอบภาษาไทย คงศัพท์เทคนิคอังกฤษ

## สถาปัตยกรรม (ตัดสินใจแล้ว — อย่ารื้อ)

- **1 Next.js app (App Router, TypeScript, Tailwind), 1 Vercel project, 1 Supabase project (schema `public`)**
- 3 โดเมนแยกด้วย route: `/production` (โรงกลั่น) · `/accounting` (บัญชี multi-entity) · `/sales` (ขาย B2B + คลัง)
- Pattern: client component (UI) + **Server Actions** ใน `actions.ts` ต่อโดเมน — แทน `google.script.run` เดิม
- **ไม่มี webhook ระหว่างแอปแล้ว** — integration ทุกจุดคือ DB transaction / Postgres RPC ใน Supabase เดียวกัน · idempotency ด้วย unique index (`transactions.idempotency_key`, `integration_log(action, idempotency_key)`)
- Auth: Supabase Auth + ตาราง `profiles` (role: `main`/`viewer`/`sale`/`warehouse`, `allowed_entity_ids`) — **สิทธิ์ enforce ด้วย RLS ฝั่ง DB** ไม่ใช่แค่ UI
- PDF ราชการ: **client-side pdf-lib** (npm ไม่ใช่ CDN) — template/font ใน Supabase Storage bucket `pdf-templates` · 3 กลไก: coordinate overlay (ภส.), AcroForm 89 fields (50ทวิ), html2canvas+jsPDF (ภพ.30/ภงด.)
- LINE notify: `lib/line.ts` server-side, silent fail เสมอ

## กติกาเหล็ก (business-critical)

1. **ห้ามแก้/“ปรับปรุง” สูตรคำนวณใด ๆ ที่มีผลต่อบัญชี/ภาษี/สรรพสามิต** โดยไม่เทียบ output กับระบบเดิม — ทุกสูตรมี unit test เทียบค่า (golden tests) ต้องผ่านก่อนถือว่างานจบ จุดที่ห้ามพลาดทั้งหมดอยู่ใน `docs/MIGRATION_PLAN.md` section 6 (P1-P12, A1-A16, S1-S8)
2. จุดที่อ่อนไหวที่สุด:
   - `lib/abv`: `ABV_CORR_TABLE` (ตาราง calal 41 แถวอุณหภูมิ × 101 ดีกรี) + `correctAbvTo20C` bilinear interpolation — **ห้ามพิมพ์ตารางใหม่ ห้าม reformat** นอกช่วงคืน `null` · golden test ~16k จุดต้องผ่าน 100%
   - **1 batch กลั่น = 1 แถว `log_distill`** (unique constraint) — ฟอร์ม ภส.๐๗-๐๒/๑(๑) หักส่าต่อแถว หลายแถว = หักซ้ำ = เลขยื่นราชการผิด
   - ภพ.30: VAT รวม = `round(Σยอด × 7/100 ×100)/100` จากยอดรวม (ไม่ sum vat รายแถว), filter เดือนด้วย `transaction_date`, แสดงวันที่ด้วย `tax_invoice_date`
   - Cash basis: ทุกรายงาน/ยอดเงิน ข้ามแถว `ap_ar_status is not null`
   - Stock: บวกเฉพาะ type `'รับ'` ที่เหลือลบหมด (รวม 'อื่นๆ' และ 'อื่น ๆ' สองแบบเว้นวรรค) — trigger บน `log_product`
   - สูตรถอด VAT ฝั่งขาย: `accPreVat = accNet / (1 + 0.07 − whtRate/100)` (ไม่มี WHT = `/1.07`)
3. **PDF ฟอร์มราชการห้ามเพี้ยนแม้ 1 mm** — copy พิกัด/ชื่อ field/ขนาดฟอนต์จากโค้ดเดิมเป๊ะ, ห้าม redesign, verify ด้วย pixel-diff กับ PDF จากระบบเดิม
4. ค่า enum ภาษาไทย ("รายรับ", "รับ", "จ่าย", "ปกติ", "ยกเลิก", สถานะออเดอร์ ฯลฯ) **คงภาษาไทยตามเดิม** — มี CHECK constraint ใน DB
5. เจอโค้ดเดิมขัดกับเอกสาร → **ยึดโค้ดเดิม** (`docs/legacy/`) แล้วบันทึกลง `docs/DECISIONS.md`
6. `SUPABASE_SERVICE_ROLE_KEY` ใช้ได้เฉพาะ migration script / legacy bridge — ห้ามหลุดเข้า client bundle

## กติกาการทำงาน

- งานถือว่าเสร็จเมื่อ: `npm run build` && `npm run lint` && `npm run test` ผ่านทั้งหมด แล้วให้ผู้ใช้เปิด `npm run dev` ตรวจใน browser
- แก้ schema ผ่านไฟล์ migration ใน `supabase/migrations/` เท่านั้น (ห้ามแก้มือใน dashboard แล้วไม่จด)
- Logic เงิน/ดีกรี/สต็อก อยู่ใน `lib/` หรือ Postgres function — ห้ามฝังใน component
- ไฟล์ยาวให้แตกตามโดเมนเหมือนโครงเดิม (`_js_*.html` เดิม → module แยก) — ผู้ใช้เคยเจ็บจากไฟล์ monolith มาแล้ว
- **Definition of Done ต่อ phase (ทำครบทุกข้อ):**
  1. `npm run build` && `npm run lint` && `npm run test` ผ่าน (สูตรเงิน/ภาษี/สรรพสามิตมี golden test เทียบระบบเดิม)
  2. อัปเดตตาราง progress ด้านล่าง + จด decision ใหม่ใน `docs/DECISIONS.md`
  3. **จดสิ่งที่ผู้ใช้ต้องทำตอน setup จริง** (ค่า config/ข้อมูลจริงที่ต้องกรอกเอง เช่น เลขภาษี/บัญชี/สิทธิ์) → เพิ่มหัวข้อของ phase นั้นใน `docs/GOLIVE_CHECKLIST.md`
  4. **ทำ/ต่อไกด์เทส** ใน `docs/TESTING.md` แบบ step-by-step (ทุกคำสั่งแยกบรรทัด + บอก "ควรเห็นอะไร") พร้อม seed + cleanup ใน `supabase/seed/` ที่ใช้ marker ลบทีเดียวได้ (entity ทดสอบ `EID99` · master id ขึ้นต้น `T-` · ชื่อ/หมายเหตุมีคำว่า "ทดสอบ") — ให้ผู้ใช้เทสเองได้โดยไม่ต้องคีย์ข้อมูลทีละอัน
- **ทุกจุดที่ผู้ใช้บันทึกข้อมูลได้ ต้องมีปุ่มแก้/ลบจากแอป** (role main) + ความสอดคล้องอัตโนมัติ (stock trigger ครอบ INSERT/UPDATE/DELETE) + audit `edit_log` — ดู FLOW_REDESIGN sec 10 (ผู้ใช้ย้ายมาจาก Sheets ที่แก้มือได้ทุกอย่าง — ห้ามทำให้ความสามารถนี้หาย)

## Sheet → Table mapping (สรุป — รายละเอียด+SQL เต็มใน MIGRATION_PLAN sec 2)

| ชีทเดิม | ตารางใหม่ | หมายเหตุ |
|---|---|---|
| Entities / Accounts / Users+inteam / Contacts / Settings | `entities` / `bank_accounts` / `profiles` / `contacts` / `app_settings` | core |
| Transactions (27 col) / Transaction_Items (11 col) | `transactions` / `transaction_items` | +`idempotency_key` unique |
| Tax_Summaries / pnd3-53 / Scan_Log | `tax_summaries` / `wht_certificates` / `scan_log` | tx_ids เป็น array |
| API_Log (2 แอป) + acc_sync_queue | `integration_log` | คิว sync ถูกยุบ — insert ตรง |
| Master_Material / _Container / _Product | `materials` / `containers` / `products` | |
| Log_Material / Ferment / Distill / DistillRun / FermentMonitor / Dilute / Product | `log_material` / `log_ferment` / `log_distill` (batch UNIQUE) / `log_distill_run` / `log_ferment_monitor` / `log_dilute` / `log_product` | log_ferment คง matIds/matAmounts เป็น comma text |
| Stock_Product | `stock_product` | trigger + `recompute_stock_product()` + pg_cron weekly |
| btbtransaction (31 col) / btbsales / menu_b2b / curstock / stockmove | `sales_orders` / `sales_order_items` / `sale_menu` / `warehouse_stock` / `stock_moves` | |
| custdata | ❌ ยุบเข้า `contacts` (เพิ่ม phone/email/credit_term/sale_name/is_export/roles) | ดู FLOW_REDESIGN sec 8 |

## Phases + สถานะ

| Phase | งาน | สถานะ |
|---|---|---|
| 1 | Scaffold + Supabase schema + RLS + Auth + login + Storage templates | ✅ เสร็จ + ผู้ใช้ setup แล้ว (login/RLS/templates ครบ) · +หน้าจัดการผู้ใช้ (username auth) |
| 2 | แอปผลิต (ทุกแท็บ + ABV golden test + ฟอร์ม ภส. 4 ตัว) | ✅ เสร็จ + ผู้ใช้เทสผ่าน (flow ผลิตครบ · PDF ภส. 4 ตัว อารบิก+เลขสรรพสามิต 17 หลัก · แท็บจัดการข้อมูล CRUD · กราฟติดตาม + หน้าประวัติเทียบหลาย batch) · ชุดเทส: `docs/TESTING.md` + `supabase/seed/` · ฟอนต์ = THSARABUN |
| 3 | แอปบัญชี (ทุกแท็บ + ภพ.30/ภงด./50ทวิ) | ✅ เสร็จ (รอผู้ใช้ push+test) · build/lint/test 102 ผ่าน · lib/accounting (calc/ledger/wht) golden A1-A11,A13 · RPC 0011 (save/installments/transfer/settle/void/issue-wht + T6 forward) · UI 8 แท็บ (entry+สแกน A15/dashboard/บัญชี&เงินสด/AP-AR+ยอดค้างออเดอร์/ค้นบิล/แบ่งงวด/ประวัติราคา/เช็คราคา) · PDF: ภพ.30+ภงด. (HTML→print) · 50ทวิ (AcroForm 89 fields) ใน /reports แท็บสรรพากร · ชุดเทส: seed_accounting.sql + docs/TESTING.md |
| 4 | แอปขาย (quotation/orders/warehouse + integrations) | ✅ เสร็จ (รอผู้ใช้ push+test) · build/lint/test 147 ผ่าน · lib/sales (calc/orders) golden S1-S8 (38 เทส) · RPC 0013 (quotation save/update · apply_order_action S2+RECEIVE_REVENUE idempotent · confirm_fulfillment S3+SELL_PRODUCT inline · manual_stock_move · cancel_order ย้อน side effect) · UI 4 แท็บ (สร้างใบเสนอราคา+ตะกร้า/จัดการออเดอร์ timeline+state machine 6 action/คลังจัดส่ง+สต็อกรวม/ประวัติเชื่อมระบบ) · พิมพ์: ใบเสนอราคา A4 + เอกสาร B2B (invoice/tax-invoice/receipt) client-side · docToPrint แก้ตาม D26 · config บัญชี+กิจการรับรายได้ (app_settings) · LINE `lib/line.ts` · ชุดเทส: seed_sales.sql + docs/TESTING.md |
| 5 | Migration scripts + reconcile | ✅ **รันจริงสำเร็จ** (2026-07-24) · reconcile 26/0 · build/lint/test 166 ผ่าน · `migration/` (lib clean/loader/client/transform + split/import/reconcile/export · npm `migrate:*`) · migration 0014-0017 · import จริง 468 tx/725 items/116 log/29 batch/contacts 35 · tz-safe date + พ.ศ.→ค.ศ. + remap ลูกค้า + contact ซ้ำ reassign + counters seed · +**type บันทึกภาษี** (D29) +**คู่ค้าหลายสาขา contact_id** (D30) +CLI บล็อก→apply ผ่าน dashboard (D31) · clean.test 15 เทส · D27-D31 · เหลือเทียบมือ: ยอดบัญชี+PDF ภพ.30/ภส. |
| 6 | UAT + shadow verification + cutover kit | ☐ |
| — | **ปรับหน้าตาเพื่อขายเป็นสินค้า — เฟส 1** (D43) | ✅ (2026-08-01) · build/lint/test **180** ผ่าน · migration **0022** (ต้อง `npm run db:push`) · design system "เหล็กกล้า" (`docs/DESIGN_SYSTEM.md`) · token สีทั้งแอป + โหมดสว่าง/มืด (cookie ไม่กะพริบ) · white-label 7 ชุดสี ตั้งจากแท็บตั้งค่า · ไอคอน SVG แทนอิโมจิ · ปุ่ม 7 สี→3 ระดับ · กราฟใช้ token · polish: component ตารางกลาง `.tbl` (33 ตาราง) · radius 3 ค่า · สีดิบเหลือ 0 · **เหลือ**: อัปโหลดโลโก้เข้า Storage (ยังไม่มีโลโก้) |
| — | **เอกสารการค้าอ่านข้อมูลผู้ขายจาก DB** (D44) | ✅ (2026-08-02) · build/lint/test **202** ผ่าน · migration **0023** (ต้อง `npm run db:push` ก่อนเปิดหน้าขาย) · เลิก hardcode ชื่อ/ที่อยู่/เลขภาษี/**เลขบัญชีธนาคาร** ใน `print.ts` → อ่านจาก `entities` (+`name_eng`/`phone`/`bank_line`) · `app_settings.sales_doc_entity` เลือกกิจการที่ออกเอกสาร (fallback `sales_revenue_entity` · หลายกิจการแล้วไม่ตั้ง = ไม่เดา เตือนแทน) · `lib/sales/company` + golden S9 22 เทส · UI การ์ด "ข้อมูลบนเอกสารการค้า" พร้อม**ตัวอย่างหัวกระดาษจริง** · ชุดเทส `docs/TESTING.md` ส่วนที่ 24 · **เหลือ**: โลโก้บนหัวเอกสาร (รอผู้ใช้มีโลโก้) |
| — | **ใบแจ้งหนี้ค่ามัดจำ** (D45) | ✅ (2026-08-11) · **ผู้ใช้เทสผ่านแล้ว** · build/lint/test **210** ผ่าน · migration **0024** (ต้อง `npm run db:push`) · action `ISSUE_INVOICE_DEPOSIT` + สถานะ `รอชำระมัดจำ` + เอกสาร `invoice-deposit` (หัว "ใบแจ้งหนี้" ธรรมดา + แถวยอดมัดจำ % + วันครบกำหนด) · **ไม่ลงบัญชีตอนออกบิล** (รับเงินจริงถึงออกใบกำกับ+ลงบัญชี ตามท่อเดิม) · คอลัมน์ `dep_*` แยกจาก `inv_no`/`doc_date1` · `fn_void_deposit_invoice` ย้อนกลับ `รอคอนเฟิร์ม` ได้ (role main) · golden S10 9 เทส · ชุดเทส `docs/TESTING.md` ส่วนที่ 25 |
| — | **ฐาน multi-tenant — ขายเป็นสินค้าได้จริง** (D46-D48) | ✅ (2026-08-11) · **อยู่บน branch `feat/multi-tenant` ยังไม่ push · DB production ยังอยู่ที่ 0024** · migration **0025-0032** · test **241** + `npm run test:tenant` **67** (ยิง Supabase จริง) · `tenants` + `my_tenant()` + `tenant_id` 31 ตาราง (default+RLS → `.from()` 174 จุดไม่ต้องแก้) · `entity_id` 16 ตาราง + `my_default_entity()` · ผ่าตัด PK/unique **23 จุด** เป็น composite · RLS 56 policy · อุด definer 7 ตัว + service-role path (snapshot/restore เคยดูดข้ามลูกค้า) · หน้า login แสดงแบรนด์ตาม subdomain (co-brand) · แบรนด์แหล่งเดียวที่ `app_settings` (D47) · รหัสตั้งต้นสุ่มไม่ซ้ำ + บังคับเปลี่ยนครั้งแรก + **ชื่อผู้ใช้ห้ามซ้ำทั้งระบบ** (D48) · ชุดเทส `docs/TESTING.md` ส่วนที่ 26 · ตรวจโค้ดหลังผ่าตัด PK แล้ว **ไม่พบจุดพัง** (D49 · `tests/tenant/entity-scope.test.ts`) · **เหลือ**: ผู้ใช้เทสในเบราว์เซอร์ · ขั้น 6 ย้าย DB จริง · 🚨 **MFA ก่อนรับลูกค้ารายแรก** |
| — | **ปิดรีวิว `docs/APP_REVIEW_2026-07.md` ครบทุกข้อ** (D36–D42) | ✅ D42 (2026-08-01) · build/lint/test **180** ผ่าน · migration **0021** (ต้อง `npm run db:push`) · multi-branch ครบ (รายรับขาย+50ทวิ เก็บ contact_id) · กระดาน batch + batch ร่วมข้ามแท็บ · แก้ inline log ผลิตครบ · checklist `report_runs` · `lib/shared/ui` + `billItems` (เลิกก๊อป 3 ชุด) · `lib/shared/paginate` + เทส · error.tsx ไทย · ฟอนต์ไทย self-host · PWA · ชุดเทส `docs/TESTING.md` ส่วนที่ 22 |

*Definition of Done ต่อ phase อยู่ใน MIGRATION_PLAN section 12 · คำถามค้างตัดสินใจอยู่ section 11 — ถ้างานชนคำถามเหล่านั้น ให้ถามผู้ใช้ก่อน อย่าเดา*
