/**
 * lib/sales/customer — **ย้ายไป `lib/shared/taxCustomer.ts` แล้ว (D96)** · ไฟล์นี้ส่งต่ออย่างเดียว
 *
 * ทำไมต้องย้าย: โมดูลบาร์ (`/bar`) ต้องใช้กติกาชุดเดียวกันตอนออกใบกำกับให้ลูกค้าบาร์
 * ที่ขอในนามบริษัท — แต่ **`lib/bar` ห้าม import `lib/sales`** (กติกา D92 ที่ห้าม lib
 * ข้ามโดเมนกัน · เหตุผลเดียวกับที่ `lib/production` ห้าม import `lib/accounting`)
 *
 * ★ ใช้แพตเทิร์นเดียวกับ `lib/shared/period.ts` ของ D92 — ย้ายตัวจริงไป `shared`
 *   แล้ว re-export ต่อ ⇒ **ไฟล์ที่ import เดิมไม่ต้องแก้แม้บรรทัดเดียว และ golden S13
 *   ผ่านโดยไม่แก้ไฟล์เทส** ซึ่งเป็นหลักฐานว่ากฎไม่ขยับ (ไม่ใช่แค่คำอ้าง)
 *
 * 🚨 ห้ามเพิ่มตรรกะใหม่ในไฟล์นี้ — ของจริงอยู่ที่ `lib/shared/taxCustomer.ts` ที่เดียว
 */
export {
  taxIdRequired,
  hidesBranch,
  branchToSave,
  taxIdToSave,
  validateNewCustomer,
} from "../shared/taxCustomer";
export type { NewCustomerInput } from "../shared/taxCustomer";
