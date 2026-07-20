# Insep ERP (Next.js + Supabase) — คู่มือประจำ repo

> ระบบ ERP ภายในของโรงกลั่นสุราคราฟต์ (solo entrepreneur) — ย้ายมาจาก Google Apps Script + Google Sheets 3 แอป
> **เอกสารหลัก**: `docs/MIGRATION_PLAN.md` (แผนละเอียดทุก section — อ่านก่อนทำงานทุกครั้ง) + `docs/FLOW_REDESIGN.md` (โฟลว์/UI ใหม่ 4 workspace — ถ้าขัดกัน: เรื่องโฟลว์/UI ยึด FLOW_REDESIGN, เรื่องสูตร/ข้อมูล ยึด MIGRATION_PLAN sec 6)
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
- ทุกครั้งที่จบ phase: อัปเดตตาราง progress ด้านล่าง + จด decision ใหม่ใน `docs/DECISIONS.md`
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
| 1 | Scaffold + Supabase schema + RLS + Auth + login + Storage templates | ☐ |
| 2 | แอปผลิต (ทุกแท็บ + ABV golden test + ฟอร์ม ภส. 4 ตัว) | ☐ |
| 3 | แอปบัญชี (ทุกแท็บ + ภพ.30/ภงด./50ทวิ) | ☐ |
| 4 | แอปขาย (quotation/orders/warehouse + integrations) | ☐ |
| 5 | Migration scripts + reconcile | ☐ |
| 6 | UAT + shadow verification + cutover kit | ☐ |

*Definition of Done ต่อ phase อยู่ใน MIGRATION_PLAN section 12 · คำถามค้างตัดสินใจอยู่ section 11 — ถ้างานชนคำถามเหล่านั้น ให้ถามผู้ใช้ก่อน อย่าเดา*
