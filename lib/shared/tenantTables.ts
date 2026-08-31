/**
 * รายชื่อตารางที่มีคอลัมน์ `tenant_id` — **แหล่งเดียวของความจริง** (D79)
 *
 * ทำไมต้องมีไฟล์นี้: รายชื่อเดียวกันนี้ถูกก๊อปไว้ 4 ที่ (fn_mig_truncate ใน SQL ·
 * RESTORE_ORDER · backup-tables · harness ของเทส) และ **พลาดมาแล้ว 3 รอบ**
 * (D67 ลืม pay_* · D69 ลืม pay_variables/pay_post_legs · D78 ลืม log_ferment_draw)
 *
 * 🚨 อาการเวลาลืม ไม่ฟ้องตอน build/lint/test เลย — ไปโผล่ตอน:
 *    · ลบ/รีเซ็ตลูกค้า → ติด FK ของ `tenants` (ตารางที่ลืมยังมีแถวค้าง)
 *    · สำรอง/ย้อนข้อมูล → ข้อมูลตารางที่ลืม **หายเงียบ ๆ** ไม่มี error
 *
 * เพิ่มตารางใหม่ที่มี tenant_id → เติมที่นี่ แล้ว `npm run test` จะฟ้องเองว่าอีก 3 ที่ยังไม่ตาม
 */
export const TENANT_TABLES = [
  "entities", "bank_accounts", "app_settings", "contacts", "counters", "integration_log",
  "materials", "containers", "products",
  "log_material", "log_ferment", "log_distill", "log_distill_run",
  "log_ferment_monitor", "log_dilute", "log_ferment_draw", "log_product", "stock_product",
  "transactions", "transaction_items", "tax_summaries", "tax_payments", "wht_certificates",
  "sale_menu", "sales_orders", "sales_order_items", "warehouse_stock", "stock_moves",
  "pay_inputs", "pay_components", "pay_rates", "pay_variables", "pay_post_legs",
  "employees", "payroll_periods", "payroll_items",
  "report_runs", "edit_log", "profiles",
] as const;

export type TenantTable = (typeof TENANT_TABLES)[number];

/**
 * ชื่อไทยของตาราง — ใช้ในหน้า **ตั้งค่า → ประวัติการแก้ไข** (D80)
 * ผู้ใช้ไม่ได้เขียนโค้ด ห้ามโชว์ชื่อตารางดิบ ๆ ให้อ่านเอง
 */
export const TABLE_LABEL_TH: Partial<Record<TenantTable, string>> = {
  entities: "กิจการ",
  bank_accounts: "บัญชีเงิน",
  app_settings: "ค่าตั้งระบบ",
  contacts: "คู่ค้า/ลูกค้า",
  materials: "วัตถุดิบ (ข้อมูลหลัก)",
  containers: "ภาชนะ",
  products: "สินค้า/สุรา (ข้อมูลหลัก)",
  log_material: "บันทึกวัตถุดิบ",
  log_ferment: "บันทึกลงหมัก",
  log_distill: "ปิด batch กลั่น",
  log_distill_run: "ค่าระหว่างกลั่น",
  log_ferment_monitor: "ค่าติดตามหมัก",
  log_dilute: "ปรุง/ปรับดีกรี",
  log_ferment_draw: "รินน้ำสุราแช่",
  log_product: "บรรจุ/จ่ายขวด",
  stock_product: "สต็อกขวด",
  transactions: "บิลบัญชี",
  transaction_items: "รายการในบิล",
  tax_summaries: "ยอด ภพ.30",
  tax_payments: "การชำระภาษี",
  wht_certificates: "หนังสือรับรอง 50ทวิ",
  sale_menu: "เมนูขาย",
  sales_orders: "ออเดอร์ขาย",
  sales_order_items: "รายการในออเดอร์",
  warehouse_stock: "สต็อกคลัง",
  stock_moves: "ความเคลื่อนไหวคลัง",
  pay_inputs: "ช่องกรอกเงินเดือน",
  pay_components: "รายการคำนวณเงินเดือน",
  pay_rates: "อัตราตามกฎหมาย",
  pay_variables: "ตัวแปรกลางเงินเดือน",
  pay_post_legs: "ขาลงบัญชีเงินเดือน",
  employees: "ทะเบียนพนักงาน",
  payroll_periods: "งวดจ่าย",
  payroll_items: "แถวงวดจ่ายรายคน",
  report_runs: "ประวัติสร้างรายงาน",
  // ★ 3 ตัวนี้ไม่เคยโผล่ให้ผู้ใช้เห็นจนกระทั่ง D82 เอาไปทำ**ชื่อชีต Excel**
  //   ไม่มีชื่อไทย = ลูกค้าเปิดไฟล์แล้วเจอชื่อตารางดิบ ๆ ซึ่งผิดกฎที่เขียนไว้หัวบล็อกนี้เอง
  counters: "เลขรันนิ่งเอกสาร",
  integration_log: "ประวัติเชื่อมระบบ",
  edit_log: "ประวัติการแก้ไข",
  profiles: "ผู้ใช้",
};

export const tableLabel = (t: string): string =>
  TABLE_LABEL_TH[t as TenantTable] ?? t;

/**
 * ตารางที่มี trigger `audit_*` เขียนลง `edit_log` — ใช้ทำดร็อปดาวน์ตัวกรองในหน้าประวัติการแก้ไข
 *
 * 🚨 ต้องตรงกับ `create trigger audit_… on …` ในไฟล์ migration เสมอ
 *    (`tenantTables.test.ts` ไล่อ่าน SQL มาเทียบให้) — ถ้าเพิ่ม trigger แล้วลืมเติมที่นี่
 *    ผู้ใช้จะกรองหาการแก้ของตารางนั้นไม่เจอ ทั้งที่ระบบบันทึกไว้แล้ว
 */
export const AUDITED_TABLES: readonly TenantTable[] = [
  "transactions", "sales_orders",
  "log_material", "log_ferment", "log_distill", "log_distill_run",
  "log_ferment_monitor", "log_dilute", "log_ferment_draw", "log_product",
  "employees", "payroll_items", "pay_components",
  // D80 — ข้อมูลหลัก + คอนฟิกเงินเดือน
  "products", "materials", "containers", "entities", "contacts", "bank_accounts",
  "pay_rates", "pay_inputs", "pay_variables", "pay_post_legs",
];

/**
 * ★ D82: ระบบ snapshot ในแอปถูกตัดทิ้งแล้ว (`SNAPSHOT_SKIP` เดิมย้ายไปเป็น `RESTORE_SKIP`
 *   ใน `lib/export/tenantExport.ts`) — ตาราง `snapshots` ถูก drop ใน migration 0049
 *   ตอนนี้เหลือ **ดาวน์โหลดไฟล์** (ลูกค้า) + **`npm run restore:tenant`** (เจ้าของ)
 */

/**
 * ตารางที่ **จงใจ** ไม่อยู่ใน `fn_mig_truncate` (ลบข้อมูลของ tenant เดียว)
 * · profiles = ลบทางเดียวคือลบ auth user แล้ว cascade ตามมา
 */
export const MIG_TRUNCATE_SKIP: readonly TenantTable[] = ["profiles"];

/**
 * ตารางที่มีคอลัมน์ `entity_id` ผูก FK ไป `entities` (0026/0027 + 0040)
 *
 * 🚨 ใช้คุม **ลำดับ** ใน `fn_mig_truncate` — ทุกตัวต้องถูกลบ **ก่อน** `entities`
 *    ไม่งั้น `delete from entities` ติด FK แล้วล้มทั้งฟังก์ชัน = ลบ/รีเซ็ตลูกค้าไม่ได้เลย
 *
 * 🪤 D82 เจอของจริง: `report_runs` อยู่หลัง `entities` มาตั้งแต่ 0029 (ก๊อปต่อถึง 0046/0049)
 *    แต่ **`test:tenant` จับไม่ได้** เพราะ tenant ที่เทสสร้างไม่เคยมีแถวใน `report_runs`
 *    → FK ไม่มีอะไรให้ละเมิด · เจอตอนเอาข้อมูลลูกค้าจริงที่เคยออกฟอร์ม ภส. กลับ
 *    **ลิสต์ที่ "ครบ" ไม่ได้แปลว่า "เรียงถูก"**
 */
export const ENTITY_SCOPED_TABLES: readonly TenantTable[] = [
  "contacts", "materials", "containers", "products",
  "log_material", "log_ferment", "log_distill", "log_distill_run",
  "log_ferment_monitor", "log_dilute", "log_ferment_draw", "log_product", "stock_product",
  "transactions", "tax_summaries", "tax_payments", "wht_certificates",
  "sale_menu", "sales_orders", "warehouse_stock", "stock_moves",
  "employees", "payroll_periods", "report_runs",
];
