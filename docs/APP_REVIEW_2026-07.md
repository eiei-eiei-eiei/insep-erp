# Insep ERP — UX + Code Review (read-only)

> ตรวจเมื่อ 2026-07-30 · อ่าน CLAUDE.md / MIGRATION_PLAN sec 6 / DECISIONS.md (D1–D35) / FLOW_REDESIGN ก่อนตัดสินทุกข้อ
> กติกา: ไม่แตะสูตรเงิน/ภาษี/สรรพสามิต/ตาราง ABV/พิกัด PDF ราชการ — ข้อที่เฉียดจุด frozen จะติดป้าย `[frozen — verify with human]`
> ทุกข้อมี path:line + เหตุผล + วิธีแก้ + effort (S/M/L) + ป้าย `[safe]` / `[frozen — verify with human]`

---

## (a) Executive Summary — Top 10 ที่ควรแก้ก่อน

| # | หมวด | สรุปหนึ่งบรรทัด | Priority | Effort |
|---|------|----------------|----------|--------|
| 1 | Correctness | รายงานเงิน/ภาษี (dashboard, ยอดบัญชี, ภพ.30, statement) ดึง `transactions` **ทั้งตารางแบบไม่มี `.limit()`** — PostgREST ตัดที่ ~1,000 แถวเงียบ ๆ → เลขจะ "ผิดโดยไม่มี error" เมื่อข้อมูลโตเกิน 1 ปี (`app/(app)/accounting/data.ts:87,193,466`) | **P0** | S–M |
| 2 | Perf (tab lag) | ทุกแท็บถูก unmount → remount → refetch ใหม่ทุกครั้งที่สลับแท็บ ไม่มี cache — นี่คือสาเหตุหลักที่ "สลับแท็บแล้วหน่วง" (`AccountingApp.tsx:61-70` + ทุก `*Tab.tsx` ที่มี `useEffect` fetch) | **P1** | M |
| 3 | Perf (bundle) | `pdf-lib` + `@pdf-lib/fontkit` ถูก import แบบ static เข้า bundle หน้าบัญชี (`TaxDocsTab.tsx:7-8`) → First Load JS ~634 kB ทั้งที่ใช้เฉพาะตอนออก 50ทวิ | **P1** | S |
| 4 | Perf (route) | ไม่มี `loading.tsx` แม้แต่ไฟล์เดียว → กด workspace แล้ว "จอนิ่ง" จนกว่า server query ทั้งชุดจะเสร็จ | **P1** | S |
| 5 | UX+Data (ผลิต) | หน้ากลั่น: รีเฟรช/สลับแท็บแล้ว "หม้อที่กำลังกลั่น" หายจาก state — ทางเดียวที่จะบันทึกค่าต่อคือกด "เริ่มหม้อใหม่" = สร้างหม้อ phantom (`DistillTab.tsx:32,75-89`) — งานกลั่นจริงใช้เวลาหลายชั่วโมง เกิดแน่ | **P1** | M |
| 6 | UX (ผลิต) | **log ผลิตทุกตารางแก้/ลบจากแอปไม่ได้เลย** — ขัดกติกาเหล็กของ repo เอง (FLOW sec 10.1 + CLAUDE.md "ทุกจุดที่บันทึกได้ต้องแก้/ลบได้") — กรอกเลขผิด 1 ช่องต้องเข้า Supabase dashboard | **P1** | L |
| 7 | Data-risk (บัญชี) | เลือกกิจการ = "ทุกกิจการ" แล้วไปแท็บบันทึก → บิลถูกบันทึกลง **กิจการแรกเงียบ ๆ** โดยไม่มีอะไรบอกบนฟอร์ม (`AccountingApp.tsx:36`) — multi-entity = ยื่นภาษีคนละกิจการ | **P1** | S |
| 8 | Bug (บัญชี) | คำแนะนำใน UI "แก้ยอดยกมา = พิมพ์ชื่อบัญชีเดิมแล้วกดเพิ่ม (upsert ตามชื่อ)" ใช้ไม่ได้จริง — action upsert ด้วย `account_id` ใหม่ → ชน unique `account_name` ได้ error อังกฤษดิบ (`accounting/actions.ts:400-424` vs `SettingsTab.tsx:107`) | **P1** | S |
| 9 | Bug (ขาย) | `itemsCache` ของหน้าออเดอร์ไม่เคยถูกล้าง — แก้ใบเสนอราคาแล้วสั่งพิมพ์ = **พิมพ์รายการเก่า** (`OrdersTab.tsx:12-18`) | **P1** | S |
| 10 | Mobile | ตารางออเดอร์ min-width 820px + ปุ่ม action สูง ~22px ตัวอักษร 11px + ทุกปุ่มพิมพ์เปิด `window.open` หลัง `await` → โดน popup blocker บนมือถือ/iPad บ่อย (`OrdersTab.tsx:124,250`, `TaxDocsTab.tsx:40-43`, `print.ts:188`) | **P1** | M |

ภาพรวมตรง ๆ: **โค้ดฝั่งสูตร (lib/ + RPC) แข็งแรงมาก — golden tests, idempotency, RLS, audit ครบ** ปัญหา "ใช้แล้วไม่ลื่น" เกือบทั้งหมดอยู่ที่ **ชั้น UI/data-fetching**: แอปทั้ง 3 โดเมนเป็น client component ก้อนเดียวที่ throw ทุกอย่างทิ้งแล้วโหลดใหม่ทุกการสลับแท็บ + ไม่มี skeleton + bundle หนัก + จุด flow ที่ค้างจาก FLOW_REDESIGN ยังไม่ได้ทำ (กระดาน batch)

---

## (b) รายงานตามแกน

### A. UX & Flow Smoothness (สำคัญสุด)

#### A1. งานประจำวัน "บันทึกบิลค่าไฟ" — ทำได้ดีแล้ว 80% เหลือขอบคม

สิ่งที่ทำดีอยู่แล้ว (ไม่ต้องแตะ): draft ค้างใน localStorage (`EntryTab.tsx:97-135`), บิลล่าสุดของคู่ค้า (`EntryTab.tsx:151-172`), สแกน AI, ดรอปดาวน์จากประวัติ, คงคู่ค้า/หมวดหลังบันทึก (`EntryTab.tsx:271`) — D35 ทำงานได้จริง

- **[P1][S][safe] เลือก "ทุกกิจการ" แล้วบันทึกลงกิจการแรกเงียบ ๆ** — `AccountingApp.tsx:36` (`entryEntity = entityId === "ALL" ? firstEntity : entityId`) ส่งเข้า `EntryTab` โดยฟอร์มไม่แสดงชื่อกิจการเลย ผู้ใช้ที่ตั้ง header เป็น "ทุกกิจการ" เพื่อดู dashboard แล้วเผลอมาบันทึกบิล → บิลเข้า EID01 ทั้งที่ตั้งใจลงอีกกิจการ → ภพ.30 สองกิจการเพี้ยนพร้อมกัน
  **แก้**: แสดง badge "บันทึกเข้ากิจการ: EIDxx — ชื่อ" บนหัวฟอร์ม EntryTab + ถ้า header เป็น ALL ให้บังคับเลือกกิจการในฟอร์มก่อนบันทึก (dropdown ในฟอร์มเอง)
- **[P1][S][safe] Enter ในฟอร์มบันทึกไม่ทำอะไร / ไม่มีคีย์ลัดเพิ่มแถว** — ฟอร์ม EntryTab ไม่ใช่ `<form>` (`EntryTab.tsx:306-514`) กด Enter ในช่องราคา = เงียบ งานคีย์บิล 20 ใบ/วันต้องสลับมือไปคลิก "+ เพิ่มรายการ"/"บันทึก" ตลอด
  **แก้**: Enter ที่ช่องสุดท้ายของแถว → เพิ่มแถวใหม่+focus ชื่อรายการ · Ctrl+Enter → บันทึก (จับ onKeyDown ที่ container เดียว)
- **[P2][S][safe] ปุ่มบันทึกอยู่ในการ์ด "ออปชัน" มุมล่าง** (`EntryTab.tsx:495`) — ตำแหน่ง `Msg` + `SaveButton` ฝังในคอลัมน์กลางของ grid 3 คอลัมน์ บนจอเล็กจะไหลไปอยู่กลาง ๆ ของหน้ายาว ๆ มองไม่เห็นข้อความ error ตอนกดจากล่างสุด
  **แก้**: ย้ายปุ่มบันทึก + Msg เป็นแถบ sticky ล่างจอ (สรุปยอดสุทธิ + ปุ่มบันทึก) — ช่วยมือถือมากด้วย
- **[P2][S][safe] error validation โผล่คนละที่กับปุ่ม** — `validate()` (`EntryTab.tsx:239-245`) คืนข้อความอย่าง "เลือกหมวดหมู่" ไปแสดงใน `Msg` ที่การ์ดออปชัน แต่ช่องหมวดหมู่อยู่การ์ดบนสุด — ไม่มีการไฮไลต์ช่องที่ผิด
  **แก้**: ใส่ขอบแดง + scrollIntoView ช่องที่ validate ไม่ผ่าน
- **[P2][S][safe] validate ปล่อยรายรับไม่มีบัญชีผ่าน** — `EntryTab.tsx:242` เงื่อนไข `type !== "รายรับ"` ทำให้รายรับที่ไม่ติ๊กตั้งค้างและไม่เลือกบัญชีบันทึกได้ → ยอดเข้าไม่อยู่ในบัญชีไหน (ยอดบัญชีรวมจะขาด) — ถ้าเป็นพฤติกรรม legacy จงใจ ให้จดใน DECISIONS; ถ้าไม่ใช่ ให้เตือน "รายรับยังไม่เลือกบัญชี จะไม่ปรากฏในยอดบัญชี — ยืนยัน?" `[frozen — verify with human]` (เกี่ยว A8 ยอดบัญชี)

#### A2. "ปิดยอดเดือน" (ภพ.30/ภงด./50ทวิ) — flow ต่อเนื่องดี แต่มีหลุม

- **[P1][S][safe] `window.open` หลัง `await` โดน popup blocker** — `TaxDocsTab.tsx:40-43` (`openHtml`) ถูกเรียกหลัง `await getTaxReportBundleAction(...)` (`:83-84`) → Chrome/Safari ถือว่าไม่ใช่ user gesture โดยตรง มีโอกาสสูงที่ "กดสร้าง ภพ.30 แล้วไม่มีอะไรเกิดขึ้น" โดยเฉพาะบน iPad และไม่มีแม้แต่ alert แจ้ง (ฝั่ง sales `print.ts:189-191` มี alert แต่ฝั่งนี้ไม่มี)
  **แก้**: เปิดแท็บเปล่า **ก่อน** await (`const w = window.open("", "_blank")` ที่บรรทัดแรกของ handler) แล้วค่อยเขียน HTML ลง `w` เมื่อข้อมูลมา; ถ้า `w === null` แสดงข้อความไทยแนะนำอนุญาต popup
- **[P1][S][safe] สร้าง ภพ.30 = เขียน `tax_summaries` ทันทีแม้แท็บพิมพ์ถูกบล็อก** — `TaxDocsTab.tsx:83-87` เรียก `recordTaxSummaryAction` ต่อจาก openHtml เสมอ ผู้ใช้ที่ popup โดนบล็อกจะไม่รู้ว่ายอดยกไปถูกบันทึกแล้ว (ดีที่ D23#5 ทำ replace ไม่ append — ความเสียหายต่ำ) — แค่ปรับข้อความสำเร็จให้บอกทั้งสองผลลัพธ์แยกกัน
- **[P2][S][safe] reprint 50ทวิ ของคู่ค้าหลายสาขาอาจได้สาขาผิด** — `TaxDocsTab.tsx:114` เรียก `getWht50ContextAction(h.entityId, h.contactName)` โดยไม่ส่ง `contactId` → fallback `limit(1)` (`accounting/actions.ts:71-76`) ได้สาขาแรกเสมอ — เป็น limitation ที่ D30 จดไว้แล้วสำหรับ "ข้อมูลเก่า" แต่ใบที่ออกใหม่ก็ยังไม่เก็บ contact_id ใน `wht_certificates` → ควรเพิ่มคอลัมน์ contact_id ในใบที่ออกใหม่ (ไม่แตะสูตร) `[frozen — verify with human]` (แตะ schema เอกสารภาษี)
- **[P2][M][safe] /reports (ภส.) กับแท็บเอกสารสรรพากร ใช้เดือน/กิจการคนละตัวเลือกกัน** — ตาม D23#7 เป็น owner override ที่จงใจ (ไม่ re-litigate) แต่ช่องว่างที่เหลือ: ไม่มีหน้าไหนตอบคำถาม "เดือนนี้สร้างครบยัง" ตาม FLOW sec 6 (✅/⬜ จาก `report_runs`) — ตาราง `report_runs` มีอยู่แล้ว (`migrations/0005`) และ `markReportRunAction` เขียนอยู่แล้ว (`accounting/actions.ts:460-465`) **แต่ไม่มี UI ที่อ่านมันเลย** — เก็บของฟรี: แสดงแถบ checklist เดือนนี้ในแท็บเอกสารสรรพากร + /reports

#### A3. "ออกใบเสนอราคา → เก็บเงิน → ส่งของ" (ขาย)

- **[P1][S][safe] พิมพ์เอกสารจาก cache เก่าหลังแก้ใบเสนอราคา** — `OrdersTab.tsx:12-18` `itemsCache` เป็น module-level `Map` ไม่มี invalidation; `updateQuotationAction` (แก้ items ใน DB) ไม่ล้าง cache → กด 🖨️ พิมพ์ชุดแรก/ใบกำกับหลังแก้ = เอกสารการค้ารายการ/ยอดผิด
  **แก้**: `itemsCache.delete(quNo)` เมื่อแก้เสร็จ (ส่ง callback จาก `SalesApp.startEdit`/`onDoneEdit`) หรือตัด cache ทิ้ง (ข้อมูลไม่กี่แถว)
- **[P2][S][safe] แก้ใบเสนอราคาแล้วเงื่อนไขมัดจำ/ผู้เสนอราคาไม่ถูก prefill** — `QuotationTab.tsx:47-58` prefill เฉพาะ discount/category/remarks/WHT — `isDeposit`, `depositPct` ไม่ถูกตั้ง และ `saleName` ค้างจากค่าที่พิมพ์ครั้งก่อน → อัปเดตแล้ว `sale_name` ในออเดอร์ถูกทับด้วยค่าที่ไม่เกี่ยว
  **แก้**: prefill ทุก field จาก editOrder + เก็บ deposit condition ไว้ในออเดอร์ถ้าต้องการให้พิมพ์ซ้ำตรงเดิม
- **[P2][S][safe] เลข INV/TAX ถูกเผาทิ้งเมื่อ action ล้มเหลว/ซ้ำ** — `sales/actions.ts:176-188` gen เลขจาก `fn_next_sales_doc` **ก่อน** เรียก `fn_apply_order_action`; ถ้า RPC fail หรือ duplicate เลขใบกำกับข้ามเบอร์ (สรรพากรถามได้)
  **แก้**: ย้ายการออกเลขเข้าไปใน `fn_apply_order_action` (ใน transaction เดียว) — logic เลขเดิมไม่เปลี่ยน แค่ย้ายที่เรียก `[frozen — verify with human]` (แตะ RPC ขาย S2/S6 — ต้อง golden test ผ่านเหมือนเดิม)
- **[P2][S][safe] เครดิตเทอมหาโดยชื่อลูกค้า** — `OrdersTab.tsx:226` `boot.customers.find((c) => c.name === ...)` — ลูกค้าหลายสาขาชื่อเดียวกัน (ไซมิส 7 สาขา!) ได้เครดิตเทอมของสาขาแรก → dueDate ผิดได้ **แก้**: หาโดย `customerId` ซึ่งมีอยู่แล้วใน OrderRow

#### A4. Dead-ends / จุดต้องจำ ID เอง

- **[P1][S][safe] แท็บ "แบ่งงวด" ต้องพิมพ์ `TR-...` เอง** — `InstallmentsTab.tsx:31` มีช่องเดียวให้กรอกรหัสกลุ่มงวดจากความจำ ไม่มี list ให้เลือก — เจ้าของกิจการไม่มีทางจำ tx_id ได้ ต้องไปเปิดค้นบิลก่อนแล้ว copy มา
  **แก้**: query กลุ่มงวดที่มีอยู่ (`select distinct po_group_id, contact_name, ... from transactions where po_group_id is not null`) มาแสดงเป็นรายการคลิกได้ — ข้อมูลอยู่ครบแล้ว
- **[P2][S][safe] แท็บลูกหนี้-เจ้าหนี้: ยอดค้างออเดอร์ขายมีคำว่า "ไปกดเก็บเงินได้ที่ workspace ขาย" แต่ไม่มีลิงก์** — `ApArTab.tsx:97` เป็นข้อความเฉย ๆ **แก้**: ทำเป็น `<Link href="/sales">` พร้อม query ที่ค้นออเดอร์นั้น (แค่ href ก็ลด 3 คลิก)
- **[P2][S][safe] แดชบอร์ด: รายการ WHT ค้างบอก "ออกใบ 50ทวิ ได้ที่ workspace รายงาน"** (`DashboardTab.tsx:55`) — **ข้อความล้าสมัย**: ตาม D23#7 ปุ่มออก 50ทวิ ย้ายมาอยู่แท็บ "เอกสารสรรพากร" ในบัญชีแล้ว — ผู้ใช้จะไป /reports แล้วไม่เจอ **แก้**: เปลี่ยนข้อความ + ทำปุ่มกดข้ามแท็บ

#### A5. ความสม่ำเสมอของ pattern ยืนยัน/ลบ

- **[P2][S][safe] `confirm()`/`alert()` ของ browser ปนกับ modal สวย ๆ** — ลบ/ยกเลิก/void ใช้ `window.confirm` ภาษาไทย (ดี) แต่ `QuotationTab.tsx:349,410-411` ใช้ `alert()` แจ้ง validation ทั้งที่ที่อื่นใช้ `Msg` — บน iPad `confirm` ใช้ได้แต่ดูแปลก **แก้**: อย่างน้อยแทน alert ด้วย Msg ให้เหมือนที่อื่น
- **[P2][S][safe] error message ดิบจาก Postgres เป็นอังกฤษ** — pattern `fail(error.message)` ใช้ทุก action (`accounting/actions.ts:127` และอีก ~25 จุด) — คนใช้เขียนโค้ดไม่ได้จะเจอ `duplicate key value violates unique constraint "contacts_name_branch_key"` เมื่อเพิ่มคู่ค้าชื่อ+สาขาซ้ำ
  **แก้**: helper กลาง `mapDbError(error)` แปล 4-5 รหัสที่เจอบ่อย (23505 unique → "มีข้อมูลนี้อยู่แล้ว (ชื่อ+สาขาซ้ำ)", 23503 FK → "ลบไม่ได้ มีรายการอ้างอิงอยู่", RLS → "สิทธิ์ไม่พอ (ต้องเป็น main)") — ตัวอย่างที่ทำถูกแล้วมีอยู่: `production/master-actions.ts:40`

#### A6. โครง flow ผลิตยังเป็น "แท็บตามตาราง log" (FLOW_REDESIGN ยังไม่เกิดจริง)

- **[P1][L][safe]** `ProductionApp.tsx:15-25` = 9 แท็บ วัตถุดิบ/ลงหมัก/ติดตามหมัก/กลั่น/ปรุง/บรรจุ/... ตรงตามที่ FLOW sec 3 วินิจฉัยว่า "วกวน" เป๊ะ — 1 batch ต้องไล่เลือก batch เดิมซ้ำในดรอปดาวน์ของ 3-4 แท็บ (MonitorTab, DistillTab เลือก batch แยกกันคนละ state) — กระดาน batch + timeline ต่อ batch ตาม FLOW sec 3 ยังไม่ได้ทำ
  **แก้ (ทางสายกลาง ไม่ต้องรื้อ)**: (1) ยก batch ที่เลือกเป็น state ของ `ProductionApp` แชร์ข้ามแท็บ — เลือกครั้งเดียวใช้ทุกแท็บ (S) · (2) เพิ่มแท็บแรก "กระดาน batch" การ์ดละ batch + ปุ่มกระโดดไปแท็บที่ถูกต้อง (M) · ฟอร์มเดิมคงไว้ทั้งหมด

### B. Perceived Performance — สาเหตุจริงของ "สลับแท็บแล้วหน่วง"

(รายละเอียด root-cause เต็มอยู่ deep-dive ท้ายรายงาน — หัวข้อนี้สรุป findings)

- **[P1][M][safe] แท็บ = conditional render → remount + refetch ทุกครั้ง** — `AccountingApp.tsx:61-70` (`{tab === "แดชบอร์ด" && <DashboardTab .../>}`) ทุก Tab มี `useEffect` fetch ตอน mount โดยไม่มี cache: `DashboardTab.tsx:13-18`, `AccountsTab.tsx:30-36`, `ApArTab.tsx:23-28`, `BillsTab.tsx:33-39`, `TaxDocsTab.tsx:71-78`; ฝั่งขาย `OrdersTab.tsx:35-37`, `WarehouseTab.tsx:40-42,130-132`, `MenuTab.tsx:26-28`, `SyncHistoryTab` เช่นกัน — สลับไป-กลับแดชบอร์ด↔ค้นบิล 5 รอบ = ยิง server 10 ชุด ได้ข้อมูลเดิมทุกรอบ
- **[P1][S][safe] แต่ละแท็บยิงหลาย server action ต่อคิวกัน** — Next.js **serialize server actions** (POST ทีละตัว): `TaxDocsTab.reload()` ยิง 3 actions (`TaxDocsTab.tsx:71-78`) = 3 roundtrip ต่อแถว ไม่ขนาน ยิ่งهน่วง **แก้**: รวมเป็น action เดียวคืน object รวม (ฝั่ง server ใช้ `Promise.all` ได้อยู่แล้ว)
- **[P1][S][safe] pdf-lib+fontkit ใน bundle หลัก** — `TaxDocsTab.tsx:7-8` (และ `ReportsApp.tsx:4-5` สำหรับ /reports ซึ่งพอรับได้เพราะเป็นหน้า PDF โดยตรง) **แก้**: `const { buildWht50Pdf } = await import("@/lib/pdf/wht50")` ในตัว handler — ไม่มีผลต่อพิกัดฟอร์มใด ๆ
- **[P1][S][safe] ไม่มี `loading.tsx` ทั้งแอป** — Glob `app/**/loading.tsx` = ว่าง → การนำทางข้าม workspace ค้างที่หน้าปัจจุบันจนกว่า RSC ใหม่จะเสร็จ (auth + bootstrap หลาย query) — ผู้ใช้รู้สึก "กดแล้วไม่ไป" **แก้**: เพิ่ม `app/(app)/production|accounting|sales|reports/loading.tsx` เป็น skeleton ง่าย ๆ 10 บรรทัด
- **[P2][S][safe] getDashboard/getBalances ดึง `transactions` ทั้งตารางมา filter ใน JS ทุกครั้ง** — `data.ts:84-94,190-203` — วันนี้ 468 แถวเร็วอยู่ แต่โตแบบ O(n) กับทุกการสลับแท็บ (และดู P0 ข้อ limit ในแกน D) **แก้**: filter เดือน/entity ใน query (dashboard ใช้ tax_invoice_date fallback transaction_date — ระวัง: **เงื่อนไข filter เป็นสูตร A11 ที่ frozen** ต้อง filter หยาบใน SQL (เช่น ช่วง ±1 เดือน) แล้วให้ `dashboardData` เดิมตัดสินใจละเอียด) `[frozen — verify with human]`
- **[P2][S][safe] `getItemHistory` scan 5,000 แถวทุกครั้งที่เข้าแท็บบันทึก + หลังบันทึกทุกบิล** — `data.ts:308-331` + `EntryTab.tsx:146-147` — ควรทำเป็น RPC `select distinct` หรือ cache ฝั่ง client แล้ว merge ค่าที่เพิ่งบันทึกเอง (ไม่ต้องยิงใหม่ทั้งก้อน)
- **[P3][S][safe] `revalidatePath("/accounting")` หลังทุก action** (`accounting/actions.ts:128` ฯลฯ) ทำให้ bootstrap ของ page ถูกดึงใหม่ทั้งชุดในการนำทางถัดไป แม้แก้แค่ setting เดียว — พอรับได้ แต่เป็นเหตุให้กลับเข้าหน้าช้ากว่าที่ควร

### C. Mobile / Tablet

(รายละเอียดเต็มใน deep-dive — สรุป findings ระบุจอ)

- **[P1][M][safe] จัดการออเดอร์ (จอที่ใช้บ่อยสุดฝั่งขาย) พังบน 375px** — `OrdersTab.tsx:124` `min-w-[820px]` + คอลัมน์จัดการ `width:340` (`:133`) → เลื่อนแนวนอนตลอด; ปุ่ม action `text-[11px] px-2 py-1` (`:250`) ≈ 22px สูง — ต่ำกว่ามาตรฐาน touch 44px มาก; `StatusBadge` `text-[10px]` (`sales/ui.tsx:174`)
  **แก้**: ต่ำกว่า `sm:` เปลี่ยนเป็น layout การ์ด (ออเดอร์ละใบ: หัว = ลูกค้า+ยอด, แถวปุ่มใหญ่เต็มกว้าง) — ตารางคงไว้สำหรับ desktop
- **[P1][S][safe] ปุ่มพิมพ์/รายงานทุกจุดพึ่ง `window.open` + `document.write` + `w.print()`** — `print.ts:187-224`, `TaxDocsTab.tsx:40-43,103-109` — iOS Safari บล็อก window.open หลัง await, print dialog บนมือถือไม่เสถียร และฟอนต์พิมพ์โหลดจาก Google Fonts CDN (`print.ts:51`) = ไม่มีเน็ตหรือ CDN ช้า → เอกสารเป็น fallback font
  **แก้**: (1) เปิดหน้าต่างก่อน await (ดู A2) (2) ทางเลือกมือถือ: ปุ่ม "บันทึกเป็น PDF" ที่ gen blob แล้ว `<a download>` (ฝั่ง /reports ทำอยู่แล้ว — `ReportsApp.tsx:26-36` ใช้ pattern นี้ได้เลย) (3) self-host ฟอนต์ Kanit เป็น base64 ในไฟล์ print
- **[P1][S][safe] แถบแท็บบัญชี 10 แท็บ + nav ห่อหลายบรรทัดบนจอแคบ** — `AccountingApp.tsx:55-59` `flex-wrap` → บน 375px แท็บกลายเป็น 3 แถว กินจอ 1/3 และปุ่มสูง ~34px; `nav.tsx:27-72` ก็ wrap อีกชั้น
  **แก้**: มือถือเปลี่ยนเป็นแถบเลื่อนแนวนอน (`overflow-x-auto flex-nowrap` + `scrollbar-hide`) หรือ `<select>` เลือกแท็บ; nav ทำ hamburger/bottom-tab 4 workspace
- **[P2][M][safe] ตารางรายการสินค้าในฟอร์มบันทึกต้องเลื่อนแนวนอนขณะพิมพ์เลข** — `EntryTab.tsx:383-428` (`overflow-x-auto` + คอลัมน์ w-28×4) — งานหลักรายวันบนมือถือครึ่งจอคีย์บอร์ด + เลื่อนซ้ายขวา = เหนื่อย
  **แก้**: < `md:` เปลี่ยนแถว item เป็นการ์ด (ชื่อเต็มกว้าง / จำนวน+ราคา 2 ช่องต่อแถว) — logic เดิมทุกอย่าง
- **[P2][S][safe] `NumInput` เป็น `type="number"`ไม่มี `inputMode="decimal"`** — `accounting/_components/ui.tsx:75-77`, `sales/ui.tsx:60-62`, `production/ui.tsx` — Android บางรุ่นเปิดคีย์บอร์ดเต็ม; ที่ทำถูกแล้วคือ `NumBox` (`ui.tsx:118-120` มี inputMode="decimal") **แก้**: เพิ่ม `inputMode="decimal"` ใน NumInput ทั้ง 3 โดเมน (1 บรรทัด/ไฟล์)
- **[P2][S][safe] `input type="month"`** (`AccountingApp.tsx:48`) — desktop Firefox ไม่รองรับ (กลายเป็น text) และบนมือถือ picker ใช้ได้แต่เล็ก — พอรับได้ แต่ควรมีปุ่ม ‹ เดือนก่อน / เดือนถัดไป › ข้าง ๆ (การใช้งานจริงคือเลื่อนทีละเดือน)
- **[P3][S][safe] datalist combobox (`input list=`)** ใน EntryTab — บน iOS Safari UI ของ datalist จำกัดมาก (แสดงเป็น suggestion เหนือคีย์บอร์ด) — ใช้ได้ แต่ถ้าจะยกระดับ ให้ใช้ `Combobox` ที่มีอยู่แล้วของฝั่งขาย (`sales/ui.tsx:77-160`) ซึ่งดีกว่า — ย้ายเข้า lib/shared แล้วใช้ร่วม

### D. Correctness & Safety

- **[P0][S-M][safe] ไม่มี `.limit()` บน query รายงานเงิน → PostgREST ตัด ~1,000 แถวเงียบ ๆ**
  - `app/(app)/accounting/data.ts:87` (`getDashboard`), `:193` (`getBalances`), `:209` (`getStatement`), `:466` (`getTaxReportBundle` — **ตัวนี้ป้อน ภพ.30/ภงด.**), `:100-103` (`getApAr`), `sales/data.ts:179` (`getOrders`)
  - ตอนนี้ 468 tx — ยังถูกอยู่ แต่คีย์จริงวันละหลายบิล + รายรับขาย auto ≈ ทะลุ 1,000 ภายใน ~1 ปี แล้ววันนั้น **ยอดบัญชีและ ภพ.30 จะขาดแถวเก่าสุดโดยไม่มี error ใด ๆ** (`data ?? []` กลืนทุกอย่าง) — supabase/config.toml ไม่ได้ตั้ง max_rows ไว้ (default 1000; ค่าจริงของ hosted project ต้องเช็คใน dashboard → API settings)
  - **แก้ (ไม่แตะสูตร)**: (1) เติม `.limit(100000)` ทันที = กันตายชั้นแรก (S) (2) ถาวร: helper `fetchAllTransactions()` ที่ page ผ่าน `.range()` เป็นก้อน ๆ จนหมด + `count: "exact"` ตรวจว่าได้ครบ ไม่ครบให้ throw (M) — ตัวเลขที่เข้าสูตรเดิมเป๊ะ แค่การันตีว่าข้อมูลครบ · หมายเหตุ: สูตรใน `lib/accounting/*` ไม่ต้องแตะเลย `[safe]` แต่แนะนำให้ verify กับ human ว่า max_rows ของ project จริงคือเท่าไร
- **[P1][M][safe] หม้อกลั่น resume ไม่ได้ + สร้างแถว phantom** — `DistillTab.tsx:32` `activeRun` เป็น useState ล้วน; รีเฟรช/สลับแท็บ (ซึ่ง unmount — ดูแกน B) = หาย; ปุ่มเดียวที่เหลือคือ "เริ่มหม้อใหม่" (`:75-89`) ซึ่ง insert แถว `เริ่มกลั่น` potNo ใหม่เสมอ (`actions.ts:104-126`) → log_distill_run มีหม้อเกินจริง และ P8 เดิมระบุว่า timestamp เป็น source of truth ให้ resume ข้าม browser ได้ — ความสามารถนี้หายไปจากระบบใหม่
  **แก้**: ตอนเลือก batch ให้เช็คจาก readings ที่โหลดอยู่แล้ว: หม้อล่าสุดที่ยังไม่มีแถว `จบหม้อ` = หม้อที่กำลังกลั่น → ตั้ง `activeRun` อัตโนมัติ + แสดง "กำลังกลั่นหม้อที่ N (ต่อจากเดิม)" — ใช้ข้อมูลที่มีอยู่ ไม่แตะสูตร P8 (weighted avg ปิด batch อยู่ใน `closeBatchSummary` เดิม)
- **[P1][L][safe] log ผลิตแก้/ลบไม่ได้จากแอป** — grep ทั้ง `app/(app)/production/_components/` มี delete เฉพาะ `MasterTab.tsx:130` (master) — `log_material`, `log_ferment`, `log_ferment_monitor`, `log_distill_run`, `log_distill`, `log_dilute`, `log_product` ไม่มีปุ่มแก้/ลบเลย ทั้งที่ RLS อนุญาต main เขียนตรงแล้ว (D4, `migrations/0006:113-126`) และ stock trigger ครอบ UPDATE/DELETE แล้ว (D3) — **โครงหลังบ้านพร้อมหมดแล้ว ขาดแค่ UI**; วันนี้พิมพ์ Brix ผิดต้องเปิด Supabase Table Editor (ผู้ใช้เขียนโค้ด/SQL ไม่ได้)
  **แก้**: เริ่มจากตารางที่แสดงอยู่แล้ว (MonitorTab `:100-116`, DistillTab `:228-259`) เติมปุ่ม ✏️/🗑️ ต่อแถว → action `update/delete` ตรง (RLS คุม, edit_log จับอัตโนมัติ) — ระวังจุดเดียว: แก้ `log_distill` ต้องผ่านข้อความ unique(batch) เดิม `[frozen — verify with human]` เฉพาะ log_distill (P3 กฎ 1 batch = 1 แถว)
- **[P1][S][safe] แก้ยอดยกมาบัญชีเงินจากแอปไม่ได้จริง (upsert ผิด key)** — `accounting/actions.ts:408-420`: ไม่มี `accountId` → gen `ACC-###` ใหม่แล้ว `upsert` (conflict ที่ PK `account_id`) แต่ `account_name` เป็น `unique` (`migrations/0001:23`) → insert ชนชื่อเดิม = error 23505 ภาษาอังกฤษ ทั้งที่ hint ใน UI บอกให้ทำแบบนั้น (`SettingsTab.tsx:107`) และ D23#3 ตัดสินไว้ว่า "upsert by ชื่อ"
  **แก้**: `.upsert({...}, { onConflict: "account_name" })` และไม่ gen id ใหม่ถ้าชื่อมีอยู่ — ตรงกับ D23 เดิม
- **[P2][S][safe] เพิ่มบัญชีเงินใน UI แล้ว state ซ้ำ** — `SettingsTab.tsx:72-75` push แถวใหม่เข้า local state เสมอแม้เป็นการ "แก้" ชื่อเดิม → เห็นบัญชีซ้ำ 2 แถวจนรีเฟรช (อาการย่อยของข้อบน)
- **[P2][S][safe] scan rate-limit นับวันตาม timezone ของ server (UTC บน Vercel)** — `accounting/actions.ts:485-487` `todayStart.setHours(0,0,0,0)` = เที่ยงคืน UTC = 7 โมงเช้าไทย → โควตารีเซ็ตเช้า 7 โมง ไม่ใช่เที่ยงคืน — ผลกระทบต่ำ (limit 100/วัน) แต่ให้ใช้ boundary Asia/Bangkok ถ้าจะเก็บสถิติแม่น
- **[P2][S][safe] `searchBills` ตัด 500 แถวโดยไม่บอก** — `data.ts:226` + `BillsTab` ไม่แสดงว่า "แสดง 500 จากทั้งหมด N" — เดือนเดียวไม่มีปัญหา แต่ถ้าติ๊ก "เฉพาะเดือน" ออก จะเข้าใจผิดว่าเห็นครบ **แก้**: `count: "exact"` แล้วเตือนเมื่อ truncated
- **[P2][S][safe] ปุ่ม "ดู/แก้ไข/ยกเลิก" ใน BillsTab ไม่มี guard role** — UI ฝั่งบัญชีโชว์ปุ่มแม้ role viewer (`AccountingApp.tsx:52` เตือนอย่างเดียว) — กดแล้วจะเจอ RLS error อังกฤษ ไม่พัง แต่ควรซ่อนปุ่มตาม `readOnly` ที่มีอยู่แล้ว (ส่ง prop ลง BillsTab/ApArTab)
- **[P3][S][safe] `fn_save_ferment` วันที่ batch ใช้ปี พ.ศ. จาก client clock** — `nextBatchNumber` ใช้วันที่ที่เลือก (P12 ตามเดิม) — โอเค เพียงบันทึกไว้ว่า timezone-safe แล้วผ่าน `todayISO()` (`ui.tsx:6-10` ชดเชย offset ถูกต้อง) — no action
- ✅ สิ่งที่ตรวจแล้ว "ดี ไม่ต้องแตะ": idempotency ขาย (`fn_apply_order_action` + unique key), `select ... for update` ครบใน RPC ขาย (`0013:74,194,267,299,313`), soft-delete ทุกทาง, RLS แน่น (`0006` — write ผูก role ทุกตาราง, `my_role()` security definer กัน recursion), `SUPABASE_SERVICE_ROLE_KEY` อยู่หลัง `server-only` (D9/D33), snapshot/restore มี auto-snapshot กันพลาด (D33)

### E. Code Structure / Tech Debt / Test Coverage

- **[P2][M][safe] `ui.tsx` ซ้ำ 3 ชุดและเริ่ม drift แล้ว** — `accounting/_components/ui.tsx` (165 บรรทัด, มี `NumBox` แก้บั๊กทศนิยม), `sales/_components/ui.tsx` (175 บรรทัด, มี `Combobox` ที่บัญชีไม่มี), `production/_components/ui.tsx` (106 บรรทัด, ไม่มีทั้งคู่) — `fmt/todayISO/useSaver/Msg/Card` ก็อปกัน 3 ที่ ผลจริงของ drift: **บั๊กพิมพ์ทศนิยม (เช่น 0.03) ที่แก้แล้วในบัญชี (commit 1cf39e7 → NumBox) ยังอยู่ครบในขาย/โอนเงิน**: `AccountsTab.tsx:103` (จำนวนเงินโอน `value={amount || ""}`), `QuotationTab.tsx:277` (ส่วนลด), `MenuTab.tsx:114` (ราคาเมนู), `SettingsTab.tsx:93` (ยอดยกมา) — เงินทั้งนั้น
  **แก้**: ย้าย `NumBox`+`Combobox`+ของกลางไป `lib/shared/ui.tsx` (คง export เดิมใน 3 ไฟล์เป็น re-export กันพัง) แล้วแทน NumInput เงินทุกจุดด้วย NumBox — S ต่อจุด, M รวม
- **[P2][M][safe] `EditBillModal` ก็อป logic จาก `EntryTab` ~150 บรรทัด** — `BillsTab.tsx:129-334` มี `onExVat/onInVat/onQty/onDiscPct/onDiscBaht/entryCalc/manualAmt` ชุดเดียวกับ `EntryTab.tsx:209-217` — แก้สูตร VAT-สลับช่องครั้งหน้าต้องแก้ 2 ที่ (เสี่ยงลืม = เลขไม่ตรงกันระหว่างสร้างกับแก้)
  **แก้**: สกัด `<BillItemsEditor items onChange showOpt/>` + hook `useBillAmounts()` ใช้ร่วม — สูตรยังอยู่ `lib/accounting/calc` เหมือนเดิม ไม่แตะ
- **[P2][S][safe] ไม่มีเทสชั้น data-access เลย** — golden tests คุม `lib/` แน่น (166 เทส) แต่บั๊กจริงที่เจอในรีวิวนี้ทั้งหมด (limit 1000, upsert ผิด key, cache ค้าง) อยู่ชั้น `data.ts`/`actions.ts` ที่ไม่มีเทสแตะ — เสนอเทสตัวเดียวที่คุ้มสุด: mock supabase → ยืนยันว่า `getTaxReportBundle` โยน error เมื่อ `count > rows.length` (คู่กับ fix P0)
- **[P3][S][safe] `as unknown as Tx` เกลื่อน** (`data.ts:93,110,202,235,...`) — ใช้ `supabase gen types typescript` แล้วให้ query typed จะตัด cast ได้เกือบหมด — ทำตอนว่าง ไม่เร่ง
- **[P3][S][safe] ข้อความ hint ล้าสมัยหลัง D23#7** — `DashboardTab.tsx:55` (ดู A4) และ `SettingsTab.tsx:26` "แก้แล้วรีเฟรชหน้าเพื่อให้แท็บอื่นเห็นค่าล่าสุด" — อันหลังคือการยอมรับ bug (bootstrap ไม่ refresh ข้ามแท็บ) ควรแก้ต้นเหตุด้วย state ที่แชร์จาก `AccountingApp` แทนสั่งผู้ใช้รีเฟรช

### F. อื่น ๆ (Accessibility / Robustness / ความสม่ำเสมอ)

- **[P2][S][safe] ไม่มี `error.tsx` ทั้งแอป** — server component โยน error (เช่น Supabase ล่มชั่วคราว) = จอขาว Next default ภาษาอังกฤษ **แก้**: `app/(app)/error.tsx` ภาษาไทย + ปุ่ม "ลองใหม่" (reset)
- **[P2][S][safe] ปุ่ม icon-only ไม่มี aria-label/title บางจุด** — เช่นปุ่มลบแถว `✕` (`EntryTab.tsx:420`), ปุ่ม `＋` เพิ่มคู่ค้า (`:332` — อันนี้มี title แล้ว ดี) — เติม `title=` ให้ครบอย่างน้อย (ช่วยทั้ง hover-hint บน desktop)
- **[P2][S][safe] ฟอนต์ไทยไม่ได้ embed** — `globals.css:17` พึ่ง `"Noto Sans Thai"` จากระบบ; Windows ไม่มี → ได้ Leelawadee/Tahoma ผสมกับ UI ที่ออกแบบมากับฟอนต์อื่น **แก้**: `next/font/google` Noto Sans Thai (self-host อัตโนมัติ ไม่พึ่ง CDN ตอน runtime) — งานครั้งเดียว เปลี่ยนความรู้สึก "แอปโปรฯ" ทั้งแอป
- **[P3][S][safe] `fmt` ใช้ locale `en-US`** สม่ำเสมอดีแล้ว (ตัวเลขเงินไทยใช้ comma แบบเดียวกัน) — no action; แค่จดว่าตั้งใจ
- **[P3][M][safe] ยังไม่เป็น PWA** — ผู้ใช้เปิดจาก browser มือถือทุกครั้ง; เพิ่ม `manifest.json` + icon = "ติดตั้ง" บนโฮมสกรีน แท็บเลตในโรงกลั่นเปิดเหมือนแอปจริง (ไม่ต้องทำ offline ก็ได้ประโยชน์แล้ว)

---

## (c-1) Deep-dive: Tab-switch performance — ทำไมถึงรู้สึกช้า และแก้ตรงไหน

### กายวิภาคของ 1 การสลับแท็บ (เช่น บันทึก → แดชบอร์ด)

1. `AccountingApp.tsx:62` เปลี่ยน state → React **unmount** `EntryTab` และ **mount** `DashboardTab` ใหม่จากศูนย์
2. `DashboardTab.tsx:13-18` `useEffect` ตั้ง `loading=true` → จอกลายเป็นข้อความ "กำลังโหลด…" บรรทัดเดียว (layout กระโดด — ความรู้สึก "กะพริบ" ทุกครั้ง)
3. ยิง server action `getDashboardAction` (POST — server actions ถูก **จัดคิวต่อกัน** ถ้ามีตัวอื่นค้าง เช่น draft-save/refresh อื่น)
4. ฝั่ง server: `data.ts:84-93` ดึง `transactions` **ทั้งตาราง** + `app_settings` + `wht_certificates` แล้วคำนวณ `dashboardData` — latency = RTT Vercel↔Supabase + scan ทั้งตาราง
5. ข้อมูลกลับ → render — **แล้วถ้าสลับกลับมาอีกครั้ง ทำใหม่ทั้งหมดทุกขั้น** เพราะไม่มี cache ใด ๆ (state ตายไปกับ unmount)

ประกอบกับ: **ครั้งแรกที่เข้า /accounting** ต้องจ่ายเพิ่มอีก 2 ชั้น — (ก) bundle ~634 kB ที่มี pdf-lib/fontkit ทั้งก้อน (`TaxDocsTab.tsx:7-8` static import — โหลดแม้ไม่เคยเปิดแท็บเอกสารสรรพากร) และ (ข) การนำทางข้าม workspace ที่ไม่มี `loading.tsx` → ระหว่างรอ middleware `getUser()` (network call, `lib/supabase/middleware.ts:37`) + layout `getUser()`+profile (`app/(app)/layout.tsx:17-27`) + bootstrap 6 query (`accounting/data.ts:49-58`) **หน้าจอเดิมค้างนิ่งเหมือนแอปแฮงก์** — คนจึงสรุปว่า "แอปช้า" ทั้งที่ DB เร็ว

### ลำดับการแก้ (เรียงตามผลลัพธ์/ความเสี่ยง — ทั้งหมด [safe] ไม่แตะสูตรใด)

1. **เลิก unmount แท็บ (แก้ 1 ไฟล์ เห็นผลทันที)** — `AccountingApp.tsx:61-70` เปลี่ยนจาก conditional render เป็น mount ค้าง + ซ่อนด้วย CSS:
   ```tsx
   <div className={tab === "แดชบอร์ด" ? "" : "hidden"}><DashboardTab ... /></div>
   ```
   ผล: สลับแท็บ = **0ms** (state, scroll, ผลค้นหา, ฟอร์มค้าง อยู่ครบ) — ตรงพฤติกรรม GAS เดิมที่เป็น SPA โชว์/ซ่อน div ผู้ใช้คุ้นแบบนั้นอยู่แล้ว · ข้อแลก: fetch ตอน mount จะเกิดครั้งแรกครั้งเดียว ต้องเติม refresh เมื่อ `period/entityId` เปลี่ยน — ซึ่ง `useEffect` เดิมทำอยู่แล้วเพราะ deps คือ `[period, entityId]` — แทบไม่ต้องแก้ Tab ลูกเลย · ทำแบบเดียวกันกับ `SalesApp.tsx:66-72` และ `ProductionApp.tsx:65-77` (production เบากว่าเพราะ props มาจาก server แล้ว แต่ DistillTab/MonitorTab จะได้ resume state ฟรี — แก้ปัญหา A/D ข้อหม้อกลั่นไปด้วยครึ่งหนึ่ง)
   ถ้ากังวล mount แรกหนัก: mount แบบ lazy-once (render เมื่อเปิดครั้งแรก แล้วคงไว้): `const [visited, setVisited] = useState(new Set([firstTab]))`
2. **เพิ่ม `loading.tsx` ต่อ workspace** — skeleton หัวข้อ+การ์ดเทา ๆ 10 บรรทัด → กด nav แล้ว "ไปทันที" — ความรู้สึกเร็วขึ้นมากสุดต่อบรรทัดโค้ดที่เขียน
3. **dynamic import pdf-lib** — ใน `TaxDocsTab` เปลี่ยน import บนหัวไฟล์เป็น `await import(...)` ในฟังก์ชัน `buildAndOpenWht`/handler → bundle บัญชีเหลือโครง UI; /reports จะทำด้วยก็ได้ (ผู้ใช้กดปุ่ม gen อยู่แล้ว รอเพิ่ม 0.5s ครั้งแรกไม่รู้สึก)
4. **รวม action ต่อแท็บ** — `TaxDocsTab.reload()` 3 actions → 1 action (`getTaxDocsBundleAction(period, entity)` ที่ฝั่ง server `Promise.all` สามตัวเดิม) — ตัด 2 roundtrip; เช่นกันกับ `MenuTab` (2 actions)
5. **skeleton แทนข้อความ "กำลังโหลด…"** — คงพื้นที่ layout เดิม (ตาราง 5 แถวเทา) กันหน้ากระโดด — ทำเฉพาะแดชบอร์ด/ค้นบิล/ออเดอร์พอ
6. **(รอบสอง)** ย้าย filter เดือนเข้า SQL สำหรับ dashboard/statement ตามข้อ B — ต้องระวังกติกา A11 (filter ด้วย tax_invoice_date fallback) ให้ filter หยาบใน SQL แล้วสูตรเดิมตัดสินละเอียด `[frozen — verify with human]`

> วัดผลได้: ก่อนแก้ ลอง Network tab นับ request ตอนสลับแท็บไปกลับ 3 รอบ (จะเห็น ~6 POST) — หลังข้อ 1 ต้องเหลือ 0

## (c-2) Deep-dive: Mobile/tablet readiness — จอไหนพัง ตรงไหน แก้ยังไง

### สภาพจริงบน iPhone/Android 375px (ไล่ตามหน้า)

| หน้า | อาการบน 375px | จุดโค้ด | แก้ |
|---|---|---|---|
| Nav ทุกหน้า | ลิงก์ 6 ตัว + ชื่อผู้ใช้ + ปุ่มออกจากระบบ ห่อ 3 บรรทัด สูง ~120px | `nav.tsx:22-89` | มือถือ: bottom-tab 4 workspace + เมนู ⋯ สำหรับ ตั้งค่า/สำรอง/ออกจากระบบ (M) |
| บัญชี — แถบแท็บ | 10 แท็บห่อ 3 แถว | `AccountingApp.tsx:55-59` | `overflow-x-auto flex-nowrap` เลื่อนแนวนอน + ไล่แท็บที่ใช้บ่อยไว้หน้า (S) |
| บัญชี — บันทึก | ตาราง items เลื่อนแนวนอน (คอลัมน์บังคับ ~480px แม้ปิดคอลัมน์เสริม), ปุ่มบันทึกจมกลางหน้า | `EntryTab.tsx:383-428,495` | item-card layout ต่ำกว่า md + sticky save bar (M) |
| บัญชี — ค้นบิล | ตาราง 8 คอลัมน์ + ปุ่ม 3 ตัวต่อแถวขนาดลิงก์ตัวหนังสือ — จิ้มพลาดง่าย (ยกเลิก อยู่ติด แก้ไข) | `BillsTab.tsx:74-90` | มือถือ: บิลละการ์ด + ปุ่มใหญ่, "ยกเลิก" แยกสีและระยะจาก "แก้ไข" (M) |
| บัญชี — EditBillModal | `max-w-3xl` + ตารางในตัว modal เลื่อน 2 ชั้น (page scroll + table scroll) | `BillsTab.tsx:244-而245,271` | มือถือ: modal เต็มจอ (`h-dvh`) + item-card เดียวกับ EntryTab (M — ได้ฟรีถ้าสกัด component ร่วมตาม E) |
| ขาย — จัดการออเดอร์ | ตาราง `min-w-[820px]`; ปุ่ม action 11px; badge 10px | `OrdersTab.tsx:124,133,250`, `sales/ui.tsx:174` | order-card ต่ำกว่า sm (ดู C) — **หน้านี้สำคัญสุดเพราะเป็นหน้าที่จะถูกใช้นอกสถานที่จริง ๆ (ไปส่งของ/เก็บเงิน)** (M) |
| ขาย — ใบเสนอราคา | grid `lg:grid-cols-[1fr_400px]` ยุบเป็นคอลัมน์เดียว = ดี; แต่ตะกร้าอยู่ใต้เมนูสินค้า — เพิ่มของแล้วไม่เห็นตะกร้า ไม่รู้ว่าเข้าหรือยัง | `QuotationTab.tsx:139-232` | แถบสรุปลอยล่างจอ "N รายการ · ฿ยอด · [ดูตะกร้า]" บนจอ < lg (S-M) |
| ขาย/คลัง — ยืนยันจัดส่ง | การ์ดออเดอร์ responsive ดีอยู่แล้ว ✅ ปุ่มยืนยันใหญ่ ✅ | `WarehouseTab.tsx:64-112` | เก็บไว้เป็นแบบอย่างให้หน้าอื่น |
| ผลิต — ทุกแท็บฟอร์ม | grid `sm:grid-cols-2 lg:grid-cols-3/4` ยุบคอลัมน์เดียว = กรอกได้ดี ✅ ตาราง readings เลื่อนแนวนอนพอรับได้ | `DistillTab.tsx:180-215` ฯลฯ | เหลือแค่ปัญหา resume (D) + แท็บ 9 อันห่อแถว (แก้แบบเดียวกับบัญชี) |
| การพิมพ์ทุกจุด | `window.open` หลัง await → popup block; print dialog มือถือไม่เสถียร; ฟอนต์พิมพ์มาจาก CDN | `print.ts:51,187-224`, `TaxDocsTab.tsx:40-43` | (1) เปิด window ก่อน await (2) ปุ่มสำรอง "ดาวน์โหลด PDF" ด้วย blob pattern ที่ `ReportsApp.tsx:26-36` มีอยู่แล้ว (3) embed ฟอนต์ (S-M) |

### ราก 3 อย่างที่ทำให้ "ยังไม่ใช่แอปมือถือ"

1. **ตาราง = หน่วยการแสดงผลหลักของทุกหน้า** — ทุก list ใช้ `<table>` + `overflow-x-auto` — ถูกต้องบน desktop แต่มือถือคือเลื่อน 2 แกนตลอดเวลา → หน้า 3 อันดับที่ใช้นอกสถานที่ (ออเดอร์/ค้นบิล/คลัง) ควรได้ card layout; ที่เหลือคง table ได้
2. **touch target เล็กกว่ามาตรฐานทั่วแอป** — ลิงก์ text (`ดู/แก้ไข/ยกเลิก`), ปุ่ม 11px, checkbox default ~16px — ยกระดับด้วย utility เดียว: ปุ่มใน list ให้ `min-h-[44px] px-3` บนจอเล็ก
3. **ทุก output ผูกกับ popup + desktop print dialog** — ต้องมีเส้นทาง blob-download คู่กันเสมอ

### สิ่งที่ **ไม่ต้อง** ทำ

- ไม่ต้องทำ responsive กับ `/settings/data`, `/settings/users`, MasterTab — งาน admin ทำบน desktop ครั้งคราวพอ
- ไม่ต้องเขียน PDF ราชการใหม่เป็น mobile-friendly ใด ๆ — ฟอร์ม ภส./50ทวิ ต้องเป๊ะตาม template เดิมเท่านั้น (กติกาเหล็ก #3) — โจทย์มือถือคือ "ส่งไฟล์ให้ถึงมือ" (download) ไม่ใช่เปลี่ยนตัวเอกสาร

---

## ภาคผนวก: สิ่งที่ตรวจแล้วตั้งใจไม่รายงานเป็นปัญหา (เป็น decision ที่จดไว้แล้ว)

- ภพ.30 replace แถวเดิมแทน append — D23#5 (จงใจต่าง legacy)
- เอกสารสรรพากรอยู่ในแท็บบัญชี ไม่อยู่ /reports — D23#7 (owner override)
- ราคาขาย VAT-inclusive ต่างจาก legacy — D27 (ผู้ใช้อนุมัติ ยกเว้น byte-compatible เฉพาะจุด)
- ลบ bank_account ผ่าน Supabase เท่านั้น — D23#3 (กันลบผิด) — แต่ *แก้* ต้องทำได้จากแอป (ดู D ข้อ upsert)
- แก้กลุ่มงวด mode A/B ยังไม่พอร์ต — D21 (workaround void+สร้างใหม่)
- cell ตาราง ABV temp=2 ค่า 50.9 ซ้ำ — D10/P1 จดค้างไว้แล้ว รอผู้ใช้เช็ค calal — **ห้ามแตะ** `[frozen]`
- dashboard filter เดือนด้วย tax_invoice_date ต่างจาก ภพ.30 — A11 จงใจ, มีหมายเหตุใน UI แล้ว (`DashboardTab.tsx:59`) ✅
- `log_distill_run` ว่างได้ / RECEIVE_MATERIAL idempotency = tx_id — D27/D12 ตามแผน

## ภาคผนวก 2: ความไม่แน่นอน (ต้องยืนยันกับแอปจริง/dashboard)

1. ค่า **max rows** จริงของ Supabase hosted project (Settings → API) — โค้ดต้องไม่พึ่งค่านี้อยู่ดี แต่ตัวเลข 1,000 คือ default
2. ตัวเลข First Load JS 634 kB มาจากรายงานของผู้ว่าจ้าง — กลไก (pdf-lib static import) ยืนยันจากโค้ดแล้ว แต่ไม่ได้รัน `next build` ซ้ำในรีวิวนี้ (read-only)
3. พฤติกรรม popup blocker แตกต่างตาม browser/OS จริง — ข้อเสนอ "เปิด window ก่อน await" เป็น pattern มาตรฐานที่ปลอดภัยทุกกรณี แต่ควรทดสอบบน iPad ของผู้ใช้จริง
4. ข้อ validate รายรับไม่มีบัญชี (A1 ข้อสุดท้าย) — ต้องเทียบ `_js_entry.html` legacy ว่าปล่อยผ่านเหมือนกันหรือไม่ก่อนแก้

---

## Progress Checklist (อัปเดต 2026-07-30)

### ✅ ทำแล้ว (push ขึ้น production)
**D35 (ก่อนรีวิว) — หน้าบันทึก/แดชบอร์ด/ค้นบิล**
- [x] หมวดหมู่ combobox พิมพ์ค้นได้ · VAT ออโต้ตามเลขใบกำกับ · บิลล่าสุดของคู่ค้า
- [x] ดรอปดาวน์ชื่อ/หมวด/งาน จากประวัติ + refresh หลังบันทึก · ค้างร่าง localStorage
- [x] ย้ายสรุปยอดลงล่าง (ตารางเต็มกว้าง) · จำนวนลบเป็นช่องว่าง · เลขภาษี 13 หลัก
- [x] ปุ่มแก้ไขบิลในค้นบิล · แดชบอร์ดยอดสุทธิ · input พิมพ์ทศนิยม (NumBox) · แก้ยอดเอง (override)

**ชุด A — UX ลื่น**
- [x] #2 สลับแท็บลื่น (mount ค้าง lazy-once) ทั้ง 3 แอป
- [x] #4 loading skeleton ทุก workspace
- [x] #10(บางส่วน) เปิด popup พิมพ์ก่อน await (มือถือ/iPad)

**ชุด B — กันข้อมูลผิด**
- [x] #1 P0 query ตัด 1000 แถว → pagination ครบทุกรายงาน
- [x] #8 แก้ยอดยกมาบัญชี (upsert by ชื่อ) + state ไม่ซ้ำ
- [x] freshness stale-while-revalidate (แก้ผลข้างเคียง lazy-once)
- [x] #9 cache รายการออเดอร์ค้าง (พิมพ์หลังแก้ได้ของใหม่)

### ☐ ยังต้องทำ (เรียงตามความคุ้ม)

**Quick wins (S) — ✅ ทำแล้ว D37 (เหลือ 2 ย่อย)**
- [x] บั๊กพิมพ์ทศนิยม 0.03 ครบทุกช่องเงิน (โอน/ส่วนลด/ราคาเมนู/ยอดยกมา/สินค้านอกระบบ)
- [x] #3 bundle → dynamic import pdf-lib (/accounting 635→131 kB · /reports คง static = หน้า PDF โดยตรง จงใจ)
- [x] #7 "ทุกกิจการ" → badge + บังคับเลือกกิจการก่อนบันทึก
- [x] แบ่งงวดเลือกจากลิสต์ · mapDbError + alert→Msg · hint 50ทวิ · searchBills เตือน 500 · ซ่อนปุ่ม role viewer · inputMode + ปุ่มเดือน
- [x] Ctrl+Enter บันทึก · Enter ในช่องตัวเลข = เพิ่มแถว · validate ไฮไลต์ช่องผิด (แดง) + scrollIntoView (D40)

**Mobile (M) — ✅ ทำครบแล้ว (D38 + D40)**
- [x] #10 card layout: จัดการออเดอร์ / ค้นบิล / หน้าบันทึกรายการสินค้า + ปุ่มใหญ่ขึ้น
- [x] แถบแท็บ 3 แอป + nav → เลื่อนแนวนอน · **nav bottom-tab มือถือ** (D40)
- [x] ใบเสนอราคา แถบตะกร้าลอย · **EditBillModal เต็มจอมือถือ** (D40)

**ผลิต (M–L)**
- [x] #5 หม้อกลั่น resume อัตโนมัติ + กันสร้างหม้อ phantom (D39)
- [x] #6 แก้/ลบ log จากแอป — ติดตามหมัก(แก้+ลบ)/กลั่น(ลบ)/วัตถุดิบ/ปรุง/บรรจุ(รายการล่าสุด+ลบ) (D39)
- [x] edit inline เต็มรูปแบบของ log วัตถุดิบ/ปรุง/บรรจุ (D42)
- [x] ยก batch ที่เลือกเป็น state ร่วมข้ามแท็บ + กระดาน batch (FLOW_REDESIGN A6) (D42)

**ขาย (S–M)**
- [x] แก้ใบเสนอราคา: prefill มัดจำ/ผู้เสนอราคาครบ · เครดิตเทอมหาโดย customerId (multi-branch) (D42)
- [x] ~~เลข INV/TAX gen ใน RPC เดียว~~ → **ตัดสินใจไม่ทำ** (D42) — เสี่ยง drift กับ golden test มากกว่าปัญหาที่แก้ · จดวิธีรับมือไว้ใน DECISIONS

**อื่น ๆ (S–M)**
- [x] error.tsx ภาษาไทย + ปุ่มลองใหม่ · embed ฟอนต์ไทย (next/font) · PWA manifest (D42)
- [x] report_runs checklist "เดือนนี้สร้างรายงานครบยัง" (D42 — ทั้งแท็บเอกสารสรรพากร และ /reports)
- [x] รวม ui.tsx 3 ชุด → lib/shared · สกัด EditBillModal ซ้ำ · เทส data-layer (D42)
- [x] 50ทวิ เก็บ contact_id (reprint สาขาถูก) · scan timezone Asia/Bangkok (D42)
- [x] **เพิ่มเติมที่เจอตอน audit multi-branch**: รายรับจากขายไม่เก็บ contact_id → ภพ.30/ภงด. ได้สาขาแรก (D42, migration 0021)

---

## Quick wins — เสร็จแล้ว (2026-07-30, D37)
- [x] บั๊กพิมพ์ 0.03 ครบทุกช่องเงิน (โอน/ยอดยกมา/ส่วนลด/ราคาเมนู/สินค้านอกระบบ) + inputMode=decimal 3 โดเมน
- [x] #3 bundle /accounting 635→131 kB (dynamic import pdf-lib)
- [x] #7 "ทุกกิจการ" บันทึกบิล → badge + บังคับเลือกกิจการ (ไม่เข้ากิจการผิดเงียบ)
- [x] mapDbError แปล error postgres เป็นไทย (accounting+sales)
- [x] แบ่งงวด: เลือกจาก dropdown (เลิกพิมพ์ TR-)
- [x] Ctrl+Enter บันทึก · ปุ่ม ‹เดือนก่อน/ถัดไป› · searchBills เตือน 500 · ซ่อนปุ่มแก้/ยกเลิก role viewer · alert→Msg · hint 50ทวิ

### ยังเหลือจาก quick-win group
- [x] validate ไฮไลต์ช่องผิด + scrollIntoView (D40) · [x] Enter เพิ่มแถวรายการ (D40)
- [ ] report_runs checklist UI "เดือนนี้สร้างรายงานครบยัง"
- [ ] แก้ใบเสนอราคา prefill มัดจำ/ผู้เสนอราคา · เครดิตเทอมหาโดย customerId

---

## Mobile — เสร็จแล้ว (2026-07-30, D38)
- [x] nav + แถบแท็บ 3 แอป → เลื่อนแนวนอน (ไม่ห่อสูง)
- [x] จัดการออเดอร์ (ขาย) → card layout + ปุ่มใหญ่ขึ้น
- [x] ค้นบิล (บัญชี) → card layout
- [x] หน้าบันทึก รายการสินค้า → card layout (2 คอลัมน์)
- [x] ใบเสนอราคา → แถบตะกร้าลอยล่างจอ
### ยังเหลือ (mobile)
- [x] nav bottom-tab เต็มรูปแบบ (D40) · [x] EditBillModal เต็มจอ (D40)
- [ ] touch target บางจุดยัง < 44px (polish) · input type=month picker เล็ก (มี ‹›​ ช่วยแล้ว)

## Production — เสร็จแล้ว (2026-07-30, D39)
- [x] #5 กลั่น: resume หม้ออัตโนมัติ (หม้อล่าสุดที่ยังไม่ "จบหม้อ") — กัน phantom pot
- [x] #6 แก้/ลบ log จากแอป:
  - ติดตามหมัก (log_ferment_monitor): แก้ inline + ลบ ต่อแถว
  - กลั่น (log_distill_run): ลบ reading ต่อแถว
  - วัตถุดิบ/ปรุง/บรรจุ (log_material/dilute/product): การ์ด "รายการล่าสุด 30" + ลบ
### ยังเหลือ (production)
- [ ] edit inline เต็มรูปแบบของ log วัตถุดิบ/ปรุง/บรรจุ (ตอนนี้ลบ+บันทึกใหม่)

## Production เพิ่มเติม — เสร็จแล้ว (2026-07-31, D41)
- [x] ลบ batch หมัก (fn_delete_ferment_batch, migration 0020) — คืนวัตถุดิบ + ลบค่าติดตามหมัก · guard: กลั่นแล้วลบไม่ได้
- [x] ช่อง "ปริมาณต่อถัง" ในลงหมัก (เติมจากความจุภาชนะ แก้ได้ · วัตถุดิบหลัก = ต่อถัง × จำนวนถัง)
- [x] ปิดกติกาเหล็ก "ทุกจุดบันทึกได้ต้องแก้/ลบได้" ครบทุก log ✅

---

## ✅ ปิดรีวิวครบทุกข้อ (2026-08-01, D42) — migration 0021

รายการที่เหลือทั้งหมดเสร็จแล้ว · `npm run build` / `lint` / `test 180` ผ่าน

| กลุ่ม | สิ่งที่ทำ |
|---|---|
| Multi-branch (ต่อ D30) | **รายรับจากขายเก็บ contact_id** (บั๊กจริง — ภพ.30/ภงด. เคยได้สาขาแรก) · 50ทวิ เก็บ contact_id พิมพ์ซ้ำได้สาขาถูก · เครดิตเทอม/บิลล่าสุด หาโดย id |
| ขาย | prefill มัดจำ/ผู้เสนอราคาตอนแก้ใบเสนอราคา (`is_deposit`/`deposit_percent`) · เปลี่ยนลูกค้าตอนแก้ได้จริง · พิมพ์ซ้ำได้ผู้เสนอราคา/เครดิตเทอมจริง |
| ผลิต | **กระดาน batch** (แท็บแรก) + batch ร่วมข้ามแท็บ · แก้ inline log วัตถุดิบ/ปรุง/บรรจุ |
| รายงาน | checklist "เดือนนี้สร้างครบยัง" จาก `report_runs` — ทั้งเอกสารสรรพากรและ ภส. |
| Tech debt | `lib/shared/ui.tsx` ชุดเดียว 3 โดเมน · `billItems.ts` ใช้ร่วม EntryTab/EditBillModal · `lib/shared/paginate.ts` + เทส (throw เมื่อโหลดไม่ครบ) · scan timezone ไทย |
| UX/แพลตฟอร์ม | error.tsx + global-error ภาษาไทย · ฟอนต์ไทย self-host (next/font) · PWA manifest + ไอคอน · touch target 44px |

**ตัดสินใจไม่ทำ 1 ข้อ**: ย้ายการออกเลข INV/TAX เข้า RPC — เหตุผลและวิธีรับมือถ้าเลขข้าม อยู่ใน `docs/DECISIONS.md` (D42)

**ผู้ใช้ต้องทำก่อนใช้**: `npm run db:push` เพื่อ apply migration 0021 (ดู `docs/GOLIVE_CHECKLIST.md`)
