# REVIEW_FABLE_1 — กฎเดียวกันที่เขียนไว้มากกว่าหนึ่งที่ แล้วไม่ตรงกัน

ขอบเขต: `supabase/migrations/*.sql` (ยึดไฟล์ล่าสุดที่นิยามแต่ละฟังก์ชัน) + `lib/**/*.ts` + `app/**/actions.ts` + `app/**/data.ts`
วิธี: ดึงนิยามล่าสุดของฟังก์ชัน SQL ทั้ง 82 ตัว → เทียบกับ TS ที่ทำหน้าที่เดียวกัน · ไม่แก้ไฟล์ใด ๆ

---

## 🔴 แดง

### R1. "กิจการเจ้าของการขาย" — SQL ใช้ `is_default` · TS ใช้ `sales_doc_entity`/`sales_revenue_entity`
- SQL: `supabase/migrations/20260811000026_entity_scope.sql:85` (`sales_orders.entity_id default my_default_entity()`) + `20260801000021_multibranch_and_quotation_terms.sql:143` (`fn_save_quotation` insert ไม่ระบุ `entity_id`) → ออเดอร์ทุกใบตกเป็นของกิจการ `is_default`
- ผู้อ่านค่านั้นฝั่ง SQL: `20260901000057_excise_hide_cancelled.sql:122` (`fn_confirm_fulfillment` เขียน `log_product`/`warehouse_stock` ด้วย `v_order.entity_id`) · `20260901000058_excise_month_close.sql:352` (`fn_cancel_order` เช่นกัน) · `20260813000036_vat_branching.sql:41` (`trg_block_tax_invoice_non_vat` เช็ค VAT ของ `new.entity_id`)
- TS: `app/(app)/sales/actions.ts:198-205` (`resolveSalesVat` ตัดสิน isVat จาก `sales_doc_entity` → `sales_revenue_entity`) · `lib/sales/orders.ts:379` (รายรับลง `config.entityId` = `sales_revenue_entity`)
- ต่างกัน: กิจการที่ "ขาย" มี 2 นิยาม — ฝั่งเอกสาร/บัญชี = กิจการที่ตั้งค่า · ฝั่งสต็อก/ฟอร์ม ภส./ด่าน VAT = กิจการ default
- อินพุต: tenant ที่มี ≥2 กิจการ และ `sales_doc_entity`/`sales_revenue_entity` ≠ กิจการ `is_default` (เช่น EID01 โรงกลั่น default · EID02 บริษัทขาย)
- ผล: (1) แถว `log_product` ของการขายไปโผล่บนฟอร์ม ภส.๐๗-๐๒/๑(๒) ของ EID01 แม้ผู้ขายคือ EID02 · (2) ถ้า VAT ต่างกัน: TS ออกเลขใบกำกับ → trigger เด้ง error ดิบชื่อกิจการผิด หรือกลับด้าน TS ออกใบเสร็จทั้งที่กิจการ default จด VAT — ด่าน ม.86/13 ตรวจผิดกิจการ
- ระดับ: แดง (ตัวเลขบนฟอร์มสรรพสามิตลงผิดกิจการ)

### R2. definer ที่รับ `p_tenant` เป็นพารามิเตอร์ แต่ไม่ revoke จาก public — เรียกข้าม tenant ได้
- SQL: `20260811000029_tenant_rpc.sql:24` `apply_stock_delta(p_tenant, p_entity, p_product_id, p_delta)` · `:74` `recompute_stock_product(p_tenant)` · `20260912000065_bar_rpc.sql:64` `bar_apply_move(p_tenant, …)` — ทั้งสามเป็น `security definer`, ไม่มี `has_cap`/`my_tenant()`, และ **ไม่มี `revoke execute … from public`** (grep ทั้งโฟลเดอร์)
- กฎเดียวกันที่ทำถูก: `20260901000058_excise_month_close.sql:282` (`fn_excise_months_open(p_tenant,…)` revoke) · `fn_mig_*` revoke ทุกตัว
- ต่างกัน: helper ภายในตระกูลเดียวกัน (รับ tenant จากพารามิเตอร์) บางตัวปิดประตู บางตัวเปิดทิ้ง — PostgREST ให้ `authenticated` เรียกฟังก์ชันใน `public` ได้โดยปริยาย
- อินพุต: ผู้ใช้ที่ล็อกอินอยู่ (role ใดก็ได้ แม้ `viewer`) ยิง `POST /rest/v1/rpc/apply_stock_delta` ด้วย uuid ของ tenant อื่น
- ผล: `stock_product` / `bar_item` / `bar_move` ของลูกค้าเจ้าอื่นถูกบวก/ลบได้ตามใจ โดยไม่ผ่าน trigger/audit
- ระดับ: แดง (ข้อมูลข้ามลูกค้า)

### R3. "วันนี้" — SQL ฝั่งขาย/บัญชีใช้ `current_date` (UTC) · SQL ฝั่งบาร์และ TS ใช้เวลาไทย
- SQL UTC: `20260901000057_excise_hide_cancelled.sql:122` (`log_product.doc_date = current_date` ตอนคอนเฟิร์มส่ง) · `20260901000058_excise_month_close.sql:352` (แถวรับคืนตอนยกเลิก) · `20260720000011_accounting_rpc.sql:18` (`next_tx_id` วันที่ใน `TR-…`) · `20260720000013_sales_rpc.sql:24` (`fn_next_sales_doc` วันที่ใน `QU-/ORD-`)
- SQL ไทย: `20260912000065_bar_rpc.sql:56` (`fn_bar_next_doc` ใช้ `now() at time zone 'Asia/Bangkok'`)
- TS ไทย: `lib/shared/datetime.ts:12` (`bangkokDateISO`) · `lib/shared/ui.tsx:22` (`todayISO` ตามเครื่องผู้ใช้) · ข้อยกเว้น `lib/sales/orders.ts:395,415` (`today()` ใช้เวลา server = UTC บน Vercel)
- ต่างกัน: DB Supabase ไม่ได้ตั้ง timezone (ไม่มี `set timezone` ในไฟล์ใด) → `current_date` = UTC
- อินพุต: กดคอนเฟิร์มจัดส่ง/ยกเลิก/บันทึกบิล ระหว่าง 00:00–06:59 น. ไทย (เช่น ตี 1 วันที่ 1 ต.ค.)
- ผล: แถว `log_product` ลงวันที่ 30 ก.ย. → ขึ้นฟอร์ม ภส. ของเดือนที่อาจปิด/ยื่นไปแล้ว (`excise_month_close`) · `tx_id`/`QU` มีวันที่ไม่ตรงกับ `transaction_date` ที่ผู้ใช้กรอก
- ระดับ: แดง (วันที่บนฟอร์มสรรพสามิต)

### R4. ยอดรวมบิลบาร์เมื่อพิมพ์ซ้ำจากประวัติ — TS คิดใหม่โดยไม่เอา `rounding` ที่บันทึกไว้
- SQL: `20260913000069_bar_vat.sql:57` (`grand_total = sub − disc + p_rounding` แช่ไว้ในแถว `bar_sale`)
- TS: `app/(app)/bar/_components/HistoryTab.tsx:125` → `barTotals(lines, { discount })` **ไม่ส่ง `roundCash` และไม่อ่าน `s.rounding`** → `lib/bar/totals.ts:64` rounding = 0 · แล้ว `lib/bar/receipt.ts:182` คิด VAT จาก `grandTotal` ที่ได้
- (เทียบ: `PosTab.tsx:217,280` ส่ง `roundCash` จาก setting ปัจจุบัน — ไม่ใช่ค่าที่แช่ไว้เช่นกัน)
- อินพุต: บิลที่ปิดตอน `bar_round_cash = 1` และยอดหลังลดไม่ลงตัว (เช่น 99.75 → บันทึก 100.00, rounding 0.25)
- ผล: ใบเสร็จ/ใบกำกับอย่างย่อที่พิมพ์ซ้ำจากแท็บประวัติแสดง 99.75 + VAT ของ 99.75 ขณะที่ DB, ยอดลงบัญชีรายวัน และ `bar_customer.spend_total` เป็น 100.00 — เอกสารภาษีสองใบเลขบิลเดียวกันยอดไม่เท่ากัน
- ระดับ: แดง (ตัวเลขบนใบกำกับภาษีอย่างย่อ)

### R5. "batch จบแล้ว" — TS นับ `log_ferment_draw` · ด่านลบใน SQL นับแค่ `log_distill`
- SQL: `20260731000020_delete_ferment.sql:19` (`fn_delete_ferment_batch` บล็อกเฉพาะเมื่อมี `log_distill_run`/`log_distill`)
- TS: `app/(app)/production/data.ts:38` + `lib/production/calc.ts:44` (`getPendingBatches` ถือว่า batch จบเมื่ออยู่ใน `log_distill` **หรือ** `log_ferment_draw` — D78)
- อินพุต: batch สุราแช่ที่รินแล้ว (มีแถว `log_ferment_draw`) แล้วกดลบ batch หมัก
- ผล: ลบผ่าน → `log_ferment` + `log_material` "เบิกไปหมัก" หายทั้งชุด แต่ `log_ferment_draw` ยังอยู่ → ฟอร์ม ภส.๐๗-๐๒/๑(๑) ฉบับสุราแช่หักน้ำหมักของ batch ที่ไม่มีบันทึกหมัก และ ๐๗-๐๑/๑ เสียแถวจ่ายวัตถุดิบ (ฝั่งกลั่นถูกกันไว้ ฝั่งแช่ไม่ — สองข้างไม่สมมาตรแบบเดียวกับ D80-C2)
- ระดับ: แดง (ตัวเลขบนฟอร์มสรรพสามิต)

### R6. tenant ของผู้ใช้ใหม่ — TS ส่ง `tenant_id` เสมอ · SQL มี fallback "tenant ที่ active ตัวแรก"
- SQL: `20260811000031_force_password_change.sql:33` (`handle_new_user`: `coalesce(metadata.tenant_id, my_tenant(), (select id from tenants where is_active limit 1))`)
- TS: `lib/platform/provision.ts:230` · `app/(app)/settings/users/actions.ts:96` (ส่ง `tenant_id` ใน `user_metadata` ทุกครั้ง · คอมเมนต์บอกว่า "ไม่ส่ง = สร้าง profile ไม่ได้" ซึ่ง**ไม่จริง**)
- อินพุต: ผู้ใช้ที่ถูกสร้างโดยไม่มี metadata — เพิ่มจาก Supabase Dashboard (`my_tenant()` = null ใน context นั้น) หรือ self-signup ถ้าโปรเจกต์ยังเปิด Email signup (ไม่มี `supabase/config.toml` ล็อกไว้ · `login/actions.ts` ยังอ้าง "Auto Confirm User" ในหน้า dashboard = ใช้ hosted default)
- ผล: profile ตกไปอยู่ tenant ของลูกค้ารายแรกที่ active ด้วย role `viewer` → อ่านบิล/สูตร/ราคาของลูกค้ารายนั้นได้ (`viewer` มี `prod/acct/sales/bar.read`)
- ระดับ: แดง (ข้อมูลข้ามลูกค้า — มีเงื่อนไข)

---

## 🟡 เหลือง

### Y1. ลำดับด่านของ RPC ภาษี — `fn_file_tax` มีด่านกิจการ · `fn_pay_tax`/`fn_unpay_tax` ไม่มี
- SQL มี: `20260914000072_file_tax_entity_guard.sql:39,51` (`my_entities()` + "ไม่พบกิจการ") · `20260914000071_tax_filings.sql:153` (`fn_unfile_tax` มี `my_entities()`)
- SQL ไม่มี: `20260914000071_tax_filings.sql:198` (`fn_pay_tax` definer · เช็คแค่ `has_cap('acct.write')`) · `20260901000054_tax_payments.sql:214` (`fn_unpay_tax`)
- RLS ที่ถูก bypass: `20260827000051_roles_caps.sql:157` (insert `transactions` ต้อง `entity_id = any(my_entities())`)
- อินพุต: `finance_manager` ที่ `allowed_entity_ids = [A]` ยิง `fn_pay_tax(..., p_entity := 'B')` หรือรหัสกิจการที่ไม่มีจริง
- ผล: บิลจ่ายภาษี + `tax_payments` ลงกิจการ B / กิจการปลอม (FK เด้ง error อังกฤษดิบ — ตระกูลเดียวกับที่ 0072 เพิ่งแก้ให้ `fn_file_tax`)
- เพิ่มเติม: "สร้างแบบแล้ว" ของ ภพ.30 — TS `lib/accounting/taxPay.ts:219` ต้องมีทั้ง `report_runs` และ `tax_summaries` · SQL `:232` ดูแค่ `tax_summaries`
- ตระกูลเดียวกัน (definer ไม่เช็ค entity ที่รับจาก payload): `20260827000051_roles_caps.sql:770,792` (`fn_post_payroll` ใช้ `p_payload->>'entityId'`) · `20260901000056_receipt_no_non_vat.sql:93` (`fn_apply_order_action` ใช้ `p_revenue->>'entityId'`)

### Y2. `modules_enabled` ว่าง — แอปถือว่า "เปิดทุกโมดูล" · cron ถือว่า "ไม่มีโมดูลเลย"
- TS แอป: `lib/shared/workspaces.ts:84` (`hasModule([]) → true`) · `lib/shared/tenant-plan.ts:30` (`null → ALL_MODULES`)
- TS cron: `app/api/cron/tax-reminder/route.ts:414,417` (`mods = [] ` แล้ว `continue` ถ้าไม่มี accounting/production/bar)
- อินพุต: tenant ที่ `modules_enabled` เป็น `[]`/null (D53 ระบุว่า = fail-open)
- ผล: ผู้ใช้เห็นครบทุกโมดูล แต่ไม่ได้รับเตือน ภพ.30/ภงด./งบเดือน/ลงบัญชีบาร์เข้า LINE เลย โดยไม่มีอะไรฟ้อง

### Y3. ค่า "ทุกกิจการ" — TS ใช้ sentinel `"ALL"` · SQL ใส่ลงคอลัมน์ตรง ๆ
- TS: `app/(app)/accounting/_components/AccountingApp.tsx:102` ส่ง `entityId` ดิบ (อาจเป็น `"ALL"`) ให้ `AccountsTab` → `AccountsTab.tsx:46` ส่งต่อเข้า `saveTransferAction` · `lib/accounting/calc.ts:64` `inScope()` ถือ `"ALL"` เป็นสัญลักษณ์
- SQL: `20260720000011_accounting_rpc.sql:177,180` (`fn_save_transfer` เขียน `coalesce(p_entity,'')` ลง `entity_id`) · FK `20260811000027_tenant_keys.sql:138`
- อินพุต: เลือก "ทุกกิจการ" ในดร็อปดาวน์แล้วกดโอนระหว่างบัญชี (หรือ `entityId` ว่าง → `''`)
- ผล: FK ล้ม โอนไม่ได้ พร้อม error ที่ไม่บอกว่าต้องเลือกกิจการก่อน (EntryTab ถูก remap เป็น `entryEntity` แล้วที่ `:51` แต่ AccountsTab ไม่)

### Y4. กิจการปริยายของ 50ทวิ — SQL ฮาร์ดโค้ด `'EID01'` · TS ให้แอดมินตั้งรหัสเอง
- SQL: `20260819000043_payroll_filings.sql:55` (`fn_issue_wht`: `coalesce(nullif(p_entity_id,''),'EID01')`)
- TS: `lib/platform/provision.ts:85` (`ENTITY_ID_RE` — รหัสกิจการแรกเป็นอะไรก็ได้ 2-12 ตัว) · ผู้เรียก `app/(app)/accounting/actions.ts:283` / `payroll/actions.ts:545` ส่ง `entityId` ที่อาจว่างได้ (type `string` ไม่บังคับ)
- อินพุต: `entityId` ว่างบน tenant ที่กิจการแรกไม่ใช่ EID01 → FK เด้ง / tenant ที่มี EID01 แต่บิลเป็นของ EID02 → ใบออกในชื่อกิจการผิด
- ผล: เลขที่ 50ทวิ วิ่งชุดของ EID01 ทั้งที่ควรเป็น EID02 (เลขซ้ำ/กระโดดตอนออกใบจริงของ EID01)

### Y5. `fn_manual_stock_move` คีย์ด้วย `item_code` อย่างเดียว ทั้งที่ PK เป็น (tenant, entity, item_code)
- SQL: `20260720000013_sales_rpc.sql:267,278` (`select … into` + `update warehouse_stock … where item_code = v_code` ไม่กรอง entity) · `:220` insert `stock_moves` ไม่ระบุ `entity_id` → ตก default กิจการของคนล็อกอิน
- กฎที่ถูก: `20260811000027_tenant_keys.sql:99` (PK composite) · `fn_confirm_fulfillment`/`fn_cancel_order` กรอง `entity_id = v_order.entity_id` ทุกจุด
- อินพุต: 2 กิจการใน tenant เดียวมี `item_code` เดียวกัน แล้วปรับสต็อกด้วยมือ
- ผล: `update` เขียน `v_after` ทับ**ทั้งสองแถว** (ยอดของอีกกิจการถูกแทนที่ด้วยเลขของกิจการแรกที่ `select into` หยิบได้) · `stock_moves` ลงผิดกิจการ — กับดักเดียวกับที่ D94 บันทึกไว้

### Y6. ยอดบิลบาร์หลังยกเลิกรายการ — SQL คง `rounding`/`discount_pct` เดิม · TS คิด rounding ใหม่
- SQL: `20260912000065_bar_rpc.sql:313` (`fn_bar_void_line`: `grand_total = … + s.rounding` เดิม · `discount` ถูกตัดไม่เกิน sub แต่ `discount_pct` ไม่ถูกคิดใหม่)
- TS: `lib/bar/totals.ts:64` (rounding คิดจาก `roundCash` ของยอดใหม่) · ป้าย "ลด X%" มาจาก `discount_pct` ที่แช่ไว้
- อินพุต: บิลปิดแล้ว (ยังไม่ออกใบเสร็จ) มี rounding ≠ 0 หรือส่วนลด % แล้วกดยกเลิกหนึ่งรายการ
- ผล: `grand_total` ใน DB ลงท้ายไม่กลม/ป้าย % ไม่ตรงกับบาท ขณะที่หน้าจอ/ใบพิมพ์คิดอีกค่า

### Y7. VAT บาร์ — ใบละ (TS) กับวันละ (SQL) ปัดคนละระดับ
- TS: `lib/bar/receipt.ts:182` (`vatFromGross(grandTotal)` ต่อบิล) · SQL: `20260913000069_bar_vat.sql:152` (`round(total×7/107)` ต่อวันต่อวิธีจ่าย)
- อินพุต: หลายบิลต่อวันที่เศษสตางค์ของ VAT ปัดคนละทิศ
- ผล: Σ VAT บนใบกำกับอย่างย่อทั้งวัน ≠ `vat_amount` ที่ลงบัญชีของวันนั้นเป็นสตางค์ (ภพ.30 คิดใหม่จากฐาน ×7% อยู่แล้วจึงไม่กระทบยอดยื่น — แต่รายงานภาษีขายรายแถวโชว์ `vat_amount` ตัวนี้)

### Y8. ราคาแพ็กเกจ/ชื่อแพ็กเกจรู้จักแค่ 3 โมดูล — `Record<string,…>` ไม่บังคับครบ (ตระกูล D84)
- TS: `lib/platform/billing.ts:120,132` (`MODULE_PRICE`/`MODULE_SHORT` มี production/accounting/sales) vs `lib/shared/workspaces.ts:20` (`MODULES` มี 5 รวม payroll/bar)
- ผู้เรียก: `billing.ts:144,156` (`suggestPrice` นับ "ครบทุกโมดูล" เมื่อ ≥3 ที่รู้จัก · `suggestPlanName` คืน "ยังไม่ระบุ")
- อินพุต: ลูกค้าที่ซื้อ payroll หรือ bar
- ผล: หน้า `/platform/billing` เสนอราคา/ชื่อแพ็กเกจผิด (bar-only = 0 บาท "ยังไม่ระบุ" · production+accounting+sales+payroll = ราคาเท่า 3 โมดูล) · ไม่มีเทสอ่านซอร์สเทียบ `MODULES` และ TS ไม่ฟ้องเพราะไม่ใช่ `Record<ModuleKey,…>`

### Y9. ลิสต์ที่มีสำเนา ≥2 ชุดและ **ยังไม่มีเทสไล่อ่านซอร์ส** (ตอนนี้ยังตรงกัน — จดไว้ว่าควรมี)
- เหตุผลบาร์ปรับสต็อก 3 ชุด: `app/(app)/bar/_components/StockTab.tsx:9` · `20260912000065_bar_rpc.sql:491` (`fn_bar_adjust`) · `20260910000064_bar_schema.sql:232` (CHECK `bar_move.reason`)
- ชุดสี 3 ชุด: `lib/shared/branding.ts:11` · `20260811000025_tenants.sql:27` · `20260801000022_branding.sql:20`
- ชนิดภาษี: `lib/accounting/taxFiling.ts:45` vs CHECK `20260914000071_tax_filings.sql:40` + `in ('vat','pnd3','pnd53')` ใน `fn_pay_tax`/`fn_file_tax`
- วิธียื่น: `taxFiling.ts:91` vs `20260914000071_tax_filings.sql:89`
- วิธีคิดเงินเดือน/แหล่งยอดขา/แหล่งตัวแปร: `lib/payroll/types.ts:39` · `lib/payroll/legs.ts:29` vs `20260819000042_pay_variables_legs.sql:31,88,107`
- ประเภทรายการผลิต: `app/(app)/production/_components/types.ts:29` vs `20260720000002_production.sql:32,106`
- รูปแบบ `doc_ref` กลั่นซ้ำ: `lib/production/redistill.ts:91` (`materialDocRef`) vs `20260907000062_redistill_note_sync.sql:48` (`p_lot_no || ' รอบ ' || p_round_no`) — SQL ใช้เป็นเงื่อนไข **ลบ** `log_material`
- `app_settings.kind` whitelist (0070) ไม่มีลิสต์ฝั่ง TS ให้เทียบเลย — เพิ่ม kind ใหม่ในโค้ดแล้วรู้ตอน runtime (D80 เจอแล้ว)

---

## ไม่พบ
- ชนิด 1 สูตรเงิน: `reverseVatWht`/`quotationTotals`/`vatFromGross`/`legAmount`/`weightedAvgCost`/`remainingDistillVol` — ฝั่ง SQL ไม่คิดซ้ำ หรือคิดตรงกัน (ตรวจ `fn_bar_receive`, `fn_bar_add_lines`, `fn_raw_spirit_remaining`, `trg_update_stock_product`, `fn_excise_month_totals` แล้ว)
- ชนิด 2 ที่มีเทสอยู่แล้วและตรง: `ROLE_CAPS`↔`has_cap` · `AUDITED_TABLES`↔`audit_*` · `TENANT_TABLES`↔`fn_mig_truncate` · `ROLES`↔CHECK `profiles.role`
- ชนิด 5: ลำดับ ระงับ→เปลี่ยนรหัส ใน `app/(app)/layout.tsx` และ env→login→`platform_admins` ใน `lib/platform/auth.ts` ถูกตามที่ตั้งใจ · idempotency `fn_post_payroll`/`fn_unpost_payroll` ถูก (partial unique `where status='ok'` ที่ `20260811000027_tenant_keys.sql:122` — ข้อความใน D88 ที่ว่า "ถอนแล้วลงใหม่ไม่เกิดอะไร" ไม่ตรงกับ SQL จริง)
