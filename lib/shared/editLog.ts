/**
 * lib/shared/editLog — แปลงแถว `edit_log` ให้เป็นภาษาคน (D80)
 *
 * 🚨 หน้าประวัติการแก้ไข **ห้ามเทดัมพ์ JSON ดิบลงจอ** — ผู้ใช้อ่านโค้ดไม่ได้ (กติกาใน CLAUDE.md)
 *    และแถว `transactions` มี ~28 คอลัมน์ ถ้าโชว์ทั้งก้อนจะหาไม่เจอว่าอะไรเปลี่ยน
 *    → โชว์เฉพาะ "ฟิลด์ที่ต่างกันจริง" พร้อมชื่อไทย
 *
 * ★ ไฟล์นี้บริสุทธิ์ (ไม่แตะ DB/React) จึงเทสได้ — ตรรกะ diff คือส่วนที่พลาดแล้วเงียบที่สุด
 */

export type EditAction = "insert" | "update" | "delete";

export type EditLogRow = {
  id: number;
  tableName: string;
  rowPk: string;
  action: EditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  userId: string | null;
  userName: string;
  createdAt: string;
};

export type FieldChange = {
  key: string;
  label: string;
  before: string;
  after: string;
};

/**
 * คอลัมน์ที่ไม่ต้องโชว์ — เป็นของระบบล้วน ไม่ใช่สิ่งที่ผู้ใช้ "แก้"
 * ★ `tenant_id` ห้ามโชว์เด็ดขาด: ไม่มีความหมายกับผู้ใช้ และเป็น uuid ยาวที่กินพื้นที่จอ
 */
const SKIP = new Set(["tenant_id", "created_at", "updated_at"]);

/** ชื่อไทยของคอลัมน์ที่เจอบ่อย — ไม่มีในนี้ = โชว์ชื่อคอลัมน์ตามจริง (ดีกว่าเดาผิด) */
export const COLUMN_LABEL_TH: Record<string, string> = {
  // ทั่วไป
  name: "ชื่อ",
  entity_id: "กิจการ",
  note: "หมายเหตุ",
  status: "สถานะ",
  amount: "จำนวน",
  doc_date: "วันที่",
  doc_ref: "เลขที่อ้างอิง",
  trans_type: "ประเภทรายการ",
  active: "เปิดใช้งาน",
  // กิจการ / เอกสาร
  tax_id: "เลขประจำตัวผู้เสียภาษี",
  excise_id: "เลขทะเบียนสรรพสามิต",
  sso_employer_no: "เลขที่บัญชีนายจ้าง ปกส.",
  branch: "สาขา",
  address: "ที่อยู่",
  phone: "เบอร์โทร",
  bank_line: "ช่องทางการโอนเงิน",
  name_eng: "ชื่อ (อังกฤษ)",
  is_vat: "จดทะเบียน VAT",
  // สินค้า / วัตถุดิบ
  product_id: "รหัสสินค้า",
  material_id: "รหัสวัตถุดิบ",
  container_id: "รหัสภาชนะ",
  degree: "ดีกรี",
  bottle_size_l: "ขนาดขวด (ล.)",
  liquor_type: "ประเภทสุรา",
  liquor_kind: "ชนิดสุรา",
  unit: "หน่วยนับ",
  capacity_l: "ความจุ (ล.)",
  // ผลิต
  batch: "Batch",
  product_name: "ชื่อสุรา",
  vol: "ปริมาณ (ล.)",
  abv: "ดีกรี@20",
  final_vol: "ปริมาณหลังปรุง (ล.)",
  final_abv: "ดีกรีหลังปรุง",
  ferment_date: "วันลงหมัก",
  distill_date: "วันกลั่นเสร็จ",
  draw_date: "วันริน",
  // บัญชี
  tx_id: "เลขที่บิล",
  transaction_date: "วันที่รายการ",
  type: "ประเภท",
  category: "หมวดหมู่",
  contact_name: "คู่ค้า",
  account_name: "บัญชี",
  description: "รายละเอียด",
  base_amount: "ยอดก่อน VAT",
  vat_amount: "VAT",
  wht_rate: "อัตราหัก ณ ที่จ่าย (%)",
  wht_amount: "ภาษีหัก ณ ที่จ่าย",
  net_amount: "ยอดสุทธิ",
  tax_invoice_no: "เลขที่ใบกำกับภาษี",
  tax_invoice_date: "วันที่ใบกำกับ",
  ap_ar_status: "สถานะบิลค้าง",
  due_date: "วันครบกำหนด",
  item_name: "ชื่อรายการ",
  quantity: "จำนวน",
  discount: "ส่วนลด",
  amount_after_discount: "ยอดหลังหักส่วนลด",
  contact_id: "รหัสคู่ค้า",
  source: "ที่มาของรายการ",
  payment_date: "วันที่ชำระ",
  po_group_id: "กลุ่มบิลแบ่งงวด",
  installment_no: "งวดที่",
  installment_total: "จำนวนงวด",
  transfer_id: "เลขที่โอนระหว่างบัญชี",
  idempotency_key: "คีย์กันบันทึกซ้ำ",
  receipt_image_url: "รูปใบเสร็จ",
  item_category: "หมวดหมู่ของรายการ",
  item_job: "งานของรายการ",
  // ขาย
  qu_no: "เลขที่ใบเสนอราคา",
  order_no: "เลขที่ออเดอร์",
  customer_name: "ลูกค้า",
  grand_total: "ยอดรวมทั้งสิ้น",
  outstanding_balance: "ยอดค้าง",
  price: "ราคา",
  // เงินเดือน
  emp_id: "รหัสพนักงาน",
  emp_name: "ชื่อพนักงาน (ที่แช่ไว้)",
  base_wage: "ค่าจ้างฐาน",
  wage_type: "ชนิดค่าจ้าง",
  group_code: "กลุ่มพนักงาน",
  sso_exempt: "ยกเว้นประกันสังคม",
  wht_mode: "วิธีคิดภาษี",
  wht_fixed: "ภาษีคงที่",
  start_date: "วันเริ่มงาน",
  end_date: "วันพ้นสภาพ",
  effective_from: "มีผลตั้งแต่",
  gross: "รวมเงินได้",
  sso: "ประกันสังคม",
  net: "สุทธิ",
};

export const columnLabel = (key: string): string => COLUMN_LABEL_TH[key] ?? key;

export const ACTION_LABEL_TH: Record<EditAction, string> = {
  insert: "เพิ่ม",
  update: "แก้ไข",
  delete: "ลบ",
};

/** ค่าที่โชว์บนจอ — ว่าง/null เป็น "—" เสมอ จะได้เห็นว่า "ลบค่าทิ้ง" ต่างจาก "ไม่ได้แตะ" */
export function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "ใช่" : "ไม่ใช่";
  if (Array.isArray(v)) return v.length ? v.map((x) => fmtVal(x)).join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * ฟิลด์ที่เปลี่ยนจริงของแถวนี้
 * · update = เฉพาะที่ค่าต่างกัน
 * · insert = ทุกฟิลด์ที่มีค่า (ก่อน = "—")
 * · delete = ทุกฟิลด์ที่มีค่า (หลัง = "—") — เก็บไว้ให้ก๊อปค่ากลับได้ตอนลบผิด
 */
export function changedFields(row: Pick<EditLogRow, "action" | "before" | "after">): FieldChange[] {
  const before = row.before ?? {};
  const after = row.after ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !SKIP.has(k));

  const out: FieldChange[] = [];
  for (const key of keys) {
    const b = fmtVal(before[key]);
    const a = fmtVal(after[key]);
    if (row.action === "update" && b === a) continue;
    if (row.action !== "update" && b === "—" && a === "—") continue; // แถวใหม่/ที่ลบ ไม่ต้องโชว์ช่องว่าง
    out.push({ key, label: columnLabel(key), before: b, after: a });
  }
  return out;
}

/**
 * ค่าที่ควรให้ปุ่ม "คัดลอกค่าเก่า" ก๊อป — ค่าก่อนแก้
 * 🚨 คืน **ค่าดิบตามที่เก็บ** ไม่ใช่ค่าที่ฟอร์แมตแล้ว — ผู้ใช้เอาไปวางกลับในช่องกรอก
 *    ถ้าก๊อป "—" หรือ "ใช่" ไปวาง จะกรอกกลับไม่ได้
 */
export function rawBefore(
  row: Pick<EditLogRow, "before">,
  key: string,
): string {
  const v = (row.before ?? {})[key];
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
