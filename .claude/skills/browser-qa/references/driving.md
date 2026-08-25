# ขับหน้าจอในเบราว์เซอร์ตัวนี้

รวมกับดักที่เสียเวลาแน่ถ้าไม่รู้ก่อน — อ่านก่อนเริ่มเทส

## เลือกเครื่องมือให้ถูก

| งาน | ใช้อะไร |
|---|---|
| ดูว่าหน้าจอมีอะไร | `get_page_text` (เร็ว อ่านง่าย) |
| หา element ที่จะกด/กรอก | `read_page` filter `interactive` → ได้ `ref_N` |
| กรอกช่อง | `form_input` ด้วย `ref` (จัดการ React ให้เอง) |
| กด | `computer` action `left_click` ด้วย `ref` |
| ตรวจค่า/สภาพที่ text ไม่บอก | `javascript_tool` |
| โชว์ผู้ใช้ | `computer` action `screenshot` |

**เริ่มจาก `ref` เสมอ** — `form_input`/`computer` จัดการ event ของ React ให้ถูกต้องอยู่แล้ว
หันไป JS ต่อเมื่อ `read_page` ไม่คาย ref ที่ต้องการ (เกิดได้เวลาหน้ายาวหรือ pane แคบ)

## กรอกช่องด้วย JS (เมื่อจำเป็น)

React คุมค่าใน state — สั่ง `el.value = "x"` เฉย ๆ **ไม่มีผล** ต้องเรียก native setter แล้วยิง event:

```js
const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
set.call(el, "0.7");
el.dispatchEvent(new Event("input", { bubbles: true }));
```

`<select>` ใช้ `HTMLSelectElement.prototype` และยิง `"change"` แทน

หลังกรอกแล้วให้ **หน่วงสัก 300-500ms ก่อนอ่านผล** — ช่องที่คำนวณต่อกัน (เช่น ราคารวม VAT ↔ ไม่รวม VAT,
C1V1=C2V2) ต้องรอ re-render

## dialog ถูกกลืน

`window.confirm()` คืน `false` เสมอในเบราว์เซอร์นี้ → ปุ่มที่มีการยืนยัน (ยกเลิกบิล · ลบ · ยืนยันจัดส่ง)
จะดูเหมือน "กดแล้วไม่มีอะไรเกิดขึ้น" ซึ่งหลอกให้คิดว่าเป็นบั๊ก

เช็คได้จาก `read_console_messages` — จะมีบรรทัด `Page dialog suppressed (confirm)` พร้อมข้อความจริง

วิธีเดินต่อ: stub ก่อนกด

```js
window.confirm = () => true;
```

🚨 **stub แล้วอย่าลืมว่าตัวเองข้ามคำถามอะไรไป** — ถ้ากำลังเทส "ปุ่มนี้ถามยืนยันไหม"
ต้องอ่าน console ยืนยันว่าถามจริง ไม่ใช่ stub ทิ้งแล้วสรุปว่าผ่าน

## หน้าจอไม่ตอบสนอง / ปุ่มกดไม่ติด

ไล่ตามลำดับนี้ก่อนจะสรุปว่าเป็นบั๊กของแอป:

1. `read_console_messages` `onlyErrors: true` — เจอ `404` ของ `/_next/static/chunks/…` แปลว่า
   **`.next` ถูกเขียนทับ** (มีคนรัน `npm run build` ตอน dev รันอยู่) → `preview_stop` + `preview_start` ใหม่
2. `read_network_requests` — ยืนยันว่า chunk/CSS โหลด 200 จริง
3. `computer` action `screenshot` — ถ้าภาพว่างหรือเนื้อหากองอยู่มุมเดียว pane อาจย่อจนคลิกไม่โดน
   → `resize_window` preset `desktop` แล้ว `navigate` ซ้ำ
4. ถ้าเพิ่งแก้โค้ด — Fast Refresh อาจรีเซ็ต state ของ component ทำให้แถวที่กด "แก้" ค้างไว้หลุด
   ให้ `navigate` โหลดหน้าใหม่แล้วเริ่มใหม่

## แท็บกับ URL

แท็บของ workspace ผูกกับ `?tab=` — เข้าตรงได้เลย เร็วกว่าไล่คลิก:

```
/production?tab=material      /accounting?tab=entry     /sales?tab=orders
/payroll?tab=filing           /settings/history         /settings/company
```

รายชื่อ slug ทั้งหมดอยู่ที่ `lib/shared/tabs.ts`

🪤 แท็บที่เคยเปิดจะยัง mount ค้างอยู่ (`visited.has(...)`) → `document.querySelector` อาจไปเจอ
element ของแท็บอื่น ให้จำกัดขอบเขตด้วยการหา card จากหัวข้อก่อน:

```js
const card = [...document.querySelectorAll("main div")]
  .find(d => d.querySelector("h2")?.textContent.includes("ชื่อการ์ด"));
```

## ตรวจว่า "บันทึกแล้วจริง"

อย่าเชื่อแค่ข้อความบนจอ ให้ดู 3 ชั้น:

1. **สีของแถบข้อความ** — เขียว = สำเร็จ · **เหลือง = บันทึกได้บางส่วน** (เช่น ลงบัญชีแล้วแต่ของไม่เข้าสต็อก)
   · แดง = ไม่ได้บันทึก · 🚨 เหลืองไม่ใช่ผ่าน อ่านข้อความให้ครบ
2. **หน้าปลายทาง** — ไปดูว่าของไปโผล่จริง
3. **DB** — ดู `references/verify-db.md`

## เก็บหลักฐานให้ผู้ใช้

`get_page_text` ตัดมาเฉพาะท่อนที่เกี่ยวข้องคือหลักฐานที่ดีที่สุด (อ่านง่าย ก๊อปใส่รายงานได้)
`screenshot` ใช้ตอนเรื่องนั้นเป็นเรื่อง**หน้าตา** จริง ๆ (สี · การจัดวาง · กราฟ) เท่านั้น
