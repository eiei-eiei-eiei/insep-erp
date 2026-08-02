/**
 * company — ข้อมูลผู้ขายที่ขึ้นหัวเอกสารการค้า (ใบเสนอราคา/ใบแจ้งหนี้/ใบกำกับภาษี/ใบเสร็จ)
 *
 * ⚠️ เดิมค่าพวกนี้ hardcode อยู่ใน `app/(app)/sales/_components/print.ts` (constant COMPANY)
 *    → ขายโค้ดให้โรงอื่นแล้วลูกค้าพิมพ์ใบกำกับภาษีออกมาเป็นชื่อ + เลขบัญชีธนาคารของโรงแรก
 *    ตอนนี้อ่านจากตาราง `entities` แทน (migration 0023 เพิ่ม name_eng/phone/bank_line)
 *
 * ที่นี่มีแต่ตรรกะ "ประกอบข้อความ" ล้วน ๆ (ไม่มี HTML ไม่มี DB) → เทสได้ตรง ๆ
 * รูปแบบข้อความทุกบรรทัดต้องเหมือนของเดิมเป๊ะ — ผู้ใช้พิมพ์เอกสารนี้ทุกวัน
 */

/** แถวจาก `entities` (ชื่อคอลัมน์ตาม DB เพื่อไม่ต้อง map ไป-กลับให้พลาด) */
export type EntityDocRow = {
  entity_id?: string | null;
  name?: string | null;
  name_eng?: string | null;
  tax_id?: string | null;
  branch?: string | null;
  address?: string | null;
  phone?: string | null;
  bank_line?: string | null;
};

/** ข้อความพร้อมวางบนเอกสาร (ยัง escape HTML ไม่ได้ — ฝั่ง print เป็นคน escape) */
export type CompanyInfo = {
  name: string;
  nameEng: string;
  /** "(สำนักงานใหญ่) 5/15 ม.8 …" */
  address: string;
  /** "เลขประจำตัวผู้เสียภาษี (Tax ID): 0000000000000 | โทร: 0X-XXX-XXXX" */
  taxLine: string;
  /** ช่องทางการโอนเงิน — หลายบรรทัดคั่นด้วย \n */
  bank: string;
};

export const EMPTY_COMPANY: CompanyInfo = { name: "", nameEng: "", address: "", taxLine: "", bank: "" };

/** สาขา → ข้อความในวงเล็บบนเอกสาร (port เดิมจาก print.ts) */
export function branchLabel(branchText: string | null | undefined): string {
  if (!branchText) return "";
  const b = branchText.toString().trim();
  if (b === "สำนักงานใหญ่" || b.includes("สำนักงานใหญ่")) return "(สำนักงานใหญ่)";
  if (/^\d+$/.test(b)) return `(สาขาที่ ${b})`;
  return `(${b})`;
}

const t = (v: string | null | undefined) => (v ?? "").toString().trim();

/** แถว entities → ข้อความบนหัวเอกสาร · ไม่มีแถว = ค่าว่างทั้งชุด (ฝั่ง print จะเตือนแทนที่จะพิมพ์หัวเปล่า) */
export function companyFromEntity(e: EntityDocRow | null | undefined): CompanyInfo {
  if (!e) return EMPTY_COMPANY;
  const taxId = t(e.tax_id);
  const phone = t(e.phone);
  const taxLine = [taxId ? `เลขประจำตัวผู้เสียภาษี (Tax ID): ${taxId}` : "", phone ? `โทร: ${phone}` : ""]
    .filter(Boolean)
    .join(" | ");
  return {
    name: t(e.name),
    nameEng: t(e.name_eng),
    address: [branchLabel(e.branch), t(e.address)].filter(Boolean).join(" "),
    taxLine,
    bank: t(e.bank_line),
  };
}

/**
 * เลือกกิจการที่ใช้ออกเอกสาร:
 *   1. ค่าที่ตั้งไว้ (app_settings `sales_doc_entity` → ถ้าไม่มีใช้ `sales_revenue_entity`)
 *   2. ไม่ได้ตั้ง/หาไม่เจอ + มีกิจการเดียว → กิจการนั้น
 *   3. นอกนั้นคืน null — เจตนา: มีหลายนิติบุคคลแล้วยังไม่เลือก ห้ามเดาให้ (หัวกระดาษผิดนิติบุคคล = ผิดกฎหมาย)
 */
export function pickDocEntity<T extends EntityDocRow>(rows: T[] | null | undefined, wantedId: string | null | undefined): T | null {
  const list = rows ?? [];
  const want = t(wantedId);
  if (want) {
    const hit = list.find((r) => t(r.entity_id) === want);
    if (hit) return hit;
  }
  return list.length === 1 ? list[0] : null;
}
