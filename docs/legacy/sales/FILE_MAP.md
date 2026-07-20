# แอปขาย (Sales/B2B + Warehouse) — File Map หลังแตกไฟล์

> แตกจาก clone จริงบน GAS (`sales/รหัส.js` 1,341 บรรทัด + `sales/index.html` 1,284 บรรทัด)
> หลักการ: **ย้ายโค้ด verbatim ไม่เปลี่ยน logic** · scriptId เดิม `1C3J5...Sz MCIf3Qa`

## Backend (.gs) — 7 ไฟล์ · ไม่มี global นอกฟังก์ชัน (อ่าน config ผ่าน `getConfig()` ทุกครั้ง)

| ไฟล์ | ฟังก์ชัน |
|---|---|
| `Config.gs` | getConfig, setupScriptProperties, formatTaxId, sendLineNotification, testLineNotification, isTruthy, getNextSerial, resetCounter |
| `Main.gs` | **include()** ⬅️ใหม่, **doGet** ⬅️แก้เป็น `createTemplateFromFile().evaluate()`, getInTeamAuth |
| `Stock.gs` | getLiveStock_, getAllLiveStock_, getStockMapWithCache_, invalidateStockCache_, getCurrentStockData, processManualStockMove |
| `Customers.gs` | buildCustMap, getB2BCustomers, addB2BCustomer |
| `Warehouse.gs` | getPendingWarehouseOrders, confirmFulfillmentAndDeductStock |
| `Quotation.gs` | getB2BMenuData, generateRunningNumber, saveB2BQuotation, updateB2BQuotation |
| `Orders.gs` | getB2BOrdersHistory, processB2BOrderAction, getB2BOrderItems |

ฟังก์ชันรวม 28 → 29 (เพิ่ม `include()` helper สำหรับ HtmlService template)

## Frontend (.html) — 9 ไฟล์ · ใช้ include pattern

| ไฟล์ | เนื้อหา |
|---|---|
| `index.html` | โครงหน้า: head+CDN, `<div id="app">`, header/tabs, login + `<?!= include() ?>` ทั้งหมด |
| `_styles.html` | `<style>` ทั้งก้อน |
| `_view_warehouse.html` | markup โหมดคลังสินค้า (ออเดอร์รอจัดส่ง + สต็อก) |
| `_view_sales.html` | markup โหมด Sales B2B (history modal, add-customer modal, เลือกสินค้า, ตะกร้า) |
| `_templates_print.html` | print templates (`#print-a4-template`, `#print-b2b-doc-template`) |
| `_js_core.html` | `createApp`, `coreMixin` = data/computed/mounted + util/auth (โหลด**ก่อน**) |
| `_js_warehouse.html` | `warehouseMixin` = 6 methods โหมดคลัง |
| `_js_b2b.html` | `b2bMixin` = 13 methods ลูกค้า/ตะกร้า/คำนวณ/ออก QU |
| `_js_orders.html` | `ordersMixin` = 9 methods ประวัติ/พิมพ์ + **boot `createApp({mixins:[...]}).mount('#app')`** (โหลด**ท้ายสุด**) |

### Vue mixins — global ห้ามซ้ำ (ข้ามไฟล์)
`createApp`, `coreMixin`, `warehouseMixin`, `b2bMixin`, `ordersMixin`

### ลำดับ include สำคัญ (ใน index.html)
`_styles` → views → templates → `_js_core` → `_js_warehouse` → `_js_b2b` → `_js_orders` (boot ท้ายสุด)
⚠️ ชื่อไฟล์ใน `include()` **case-sensitive** ต้องตรงเป๊ะ

## Verify ที่ผ่านแล้ว
- ✅ JS syntax (mixin 4 ไฟล์รวมกัน) ผ่าน `node --check`
- ✅ ไม่มี global/method ซ้ำ (37 methods: core 9 / wh 6 / b2b 13 / orders 9)
- ✅ ครบทั้ง 37 method bodies verbatim · backend 29 ฟังก์ชัน syntax ผ่าน
- ✅ markup reconstructed = original (ไม่มีบรรทัดตกหล่น)
- ✅ DOM id ที่ JS อ้าง (`#app`, `#print-a4-template`, `#print-b2b-doc-template`) มีครบ
