/**
 * lib/sales/customer — กติกาการกรอกข้อมูลคู่ค้าตอนเพิ่มลูกค้าใหม่ (D86)
 *
 * ทำไมต้องดึงออกมาจาก component: เดิมเป็น `if` 3 บรรทัดในฟอร์ม ซึ่งพอกฎกลายเป็น
 * "บังคับ **เว้นแต่** ลูกค้าทั่วไป หรือ ลูกค้าต่างประเทศ" มันมี 3 ตัวแปรที่พันกัน
 * — เงื่อนไขแบบนี้พังเงียบได้ง่ายและ build/lint/test มองไม่เห็นถ้าฝังอยู่ใน JSX
 *
 * 🚨 นี่คือกติกา **คุณภาพข้อมูล ไม่ใช่ขอบเขตความปลอดภัย** — `saveCustomerAction`
 *    ฝั่ง server ไม่ได้ตรวจ (และ DB ยอมให้ `tax_id` ว่างมาตั้งแต่แรก) ยิง API ตรงก็ผ่าน
 *    เจตนาคือกัน "พนักงานเผลอสร้างคู่ค้า B2B โดยไม่ใส่เลขภาษี" ไม่ใช่กันคนตั้งใจเลี่ยง
 */

export type NewCustomerInput = {
  name: string;
  taxId: string;
  branchMode: "hq" | "branch";
  branchNumber: string;
  /** ลูกค้าทั่วไป/ขาจร — ไม่มีเลขประจำตัวผู้เสียภาษี (ผู้ใช้ติ๊กเอง) */
  noTaxId: boolean;
  /** ลูกค้าจำหน่ายต่างประเทศ — ผู้ซื้อต่างชาติไม่มีเลขภาษีไทย */
  isExport: boolean;
};

/**
 * ต้องกรอกเลขประจำตัวผู้เสียภาษีไหม
 *
 * 🪤 `isExport` **ผ่อนกฎอย่างเดียว ไม่ล้างช่อง** — ลูกค้าที่ซื้อไปส่งออกอาจเป็น
 *    นิติบุคคลไทยที่มีเลขภาษีจริง (กรอกได้ตามปกติ) ต่างจาก `noTaxId` ที่แปลว่า
 *    "ไม่มีจริง ๆ" จึงซ่อนช่องและบันทึกเป็นค่าว่าง
 */
export function taxIdRequired(input: Pick<NewCustomerInput, "noTaxId" | "isExport">): boolean {
  return !input.noTaxId && !input.isExport;
}

/** ติ๊ก "ไม่มีเลขภาษี" = ไม่มีสาขาด้วย (ลูกค้าขาจรเป็นบุคคล ไม่มีสำนักงานใหญ่/สาขา) */
export function hidesBranch(input: Pick<NewCustomerInput, "noTaxId">): boolean {
  return input.noTaxId;
}

/** สาขาที่จะบันทึกจริง — ว่าง = ไม่พิมพ์วงเล็บสาขาบนเอกสาร (`branchLabel` คืน "") */
export function branchToSave(input: Pick<NewCustomerInput, "noTaxId" | "branchMode" | "branchNumber">): string {
  if (input.noTaxId) return "";
  return input.branchMode === "hq" ? "สำนักงานใหญ่" : input.branchNumber.padStart(5, "0");
}

/** เลขภาษีที่จะบันทึกจริง — ติ๊กไม่มีเลขภาษีแล้วห้ามเก็บค่าที่เผลอพิมพ์ค้างไว้ */
export function taxIdToSave(input: Pick<NewCustomerInput, "noTaxId" | "taxId">): string {
  return input.noTaxId ? "" : input.taxId.trim();
}

/** ข้อความบอกว่ากรอกไม่ผ่านตรงไหน · `null` = ผ่าน */
export function validateNewCustomer(input: NewCustomerInput): string | null {
  if (!input.name.trim()) return "กรอกชื่อลูกค้า";
  if (taxIdRequired(input) && !/^\d{13}$/.test(input.taxId.trim())) {
    return "เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก — ลูกค้าทั่วไปที่ไม่มีเลข ให้ติ๊กช่อง “ไม่มีเลขประจำตัวผู้เสียภาษี”";
  }
  // 🪤 ต้องตรวจ **ค่าที่ผู้ใช้พิมพ์** ไม่ใช่ค่าที่ padStart แล้ว —
  //    ของเดิมตรวจค่าหลัง pad ทำให้ "เลือกสาขาแต่ไม่กรอกเลข" กลายเป็น "00000" ผ่านไปเงียบ ๆ
  //    แล้วไปพิมพ์ "(สาขาที่ 00000)" บนใบกำกับภาษี (00000 คือรหัสของสำนักงานใหญ่ ไม่ใช่สาขา)
  if (!hidesBranch(input) && input.branchMode === "branch" && !/^\d{1,5}$/.test(input.branchNumber.trim())) {
    return "เลขสาขาต้องเป็นตัวเลข 1-5 หลัก";
  }
  return null;
}
