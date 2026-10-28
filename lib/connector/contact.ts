/**
 * lib/connector/contact — คู่ค้าใหม่จากบิล: ตรวจ + หาตัวที่มีอยู่แล้ว ก่อนเพิ่มเข้าทะเบียน (D141 รอบ 3)
 *
 * ★ ผู้ใช้สั่ง: คู่ค้าที่ยังไม่มีในทะเบียน ต้องเพิ่มให้ก่อนบันทึกบิล (บิลมหาจักรฯ ลงไปโดยไม่ผูกคู่ค้า
 *   = ภพ.30 ไม่มีเลขผู้เสียภาษีของผู้ขาย)
 * 🚨 กติกากรอกใช้ตัวเดียวกับฟอร์มคู่ค้าในแอป (`lib/shared/taxCustomer.ts` · D86/D125) — ไม่เขียนกฎชุดที่สอง
 * ★ ฟังก์ชันล้วน — การเพิ่มจริง (next_serial CONTACT + insert) อยู่ที่ tools.ts แบบเดียวกับ addContactAction
 */
import { branchFormOf, branchToSave, taxIdToSave, validateNewCustomer } from "../shared/taxCustomer";
import { normalizeTaxId, taxIdValid, type ConnectorType } from "./bill";

/** คู่ค้าที่ Claude อ่านจากหัวบิล */
export type NewContactInput = {
  name: string;
  /** เลขผู้เสียภาษี 13 หลัก (ขีดได้) · ว่าง = ร้านเล็กที่ไม่มีเลข */
  tax_id?: string;
  /** "สำนักงานใหญ่" หรือเลขสาขา · ว่าง = สำนักงานใหญ่ (เมื่อมีเลขภาษี) */
  branch?: string;
  address?: string;
};

/** แถวที่จะ insert ลง contacts (ยังไม่มี contact_id — ออกเลขตอนบันทึก) */
export type ContactRow = { name: string; tax_id: string | null; branch: string | null; address: string | null; contact_type: string };

/** คู่ค้าในทะเบียน (เท่าที่ต้องใช้เทียบ) */
export type ExistingContact = { contact_id: string; name: string; tax_id: string | null; branch: string | null };

/** ประเภทคู่ค้าตามประเภทบิล — ค่าเดียวกับที่ฟอร์มในแอปใช้ */
export const CONTACT_TYPE_OF: Record<ConnectorType, string> = { รายจ่าย: "ผู้ขาย", รายรับ: "ลูกค้า" };

/**
 * ตรวจคู่ค้าใหม่ → แถวที่จะบันทึก หรือเหตุผลที่บันทึกไม่ได้
 * 🚨 เลขภาษีต้องผ่าน checksum ด้วย (ไม่ใช่แค่ 13 หลัก) — เพิ่มเข้าทะเบียนแล้วเลขผิดจะติดไปทุกบิลถัดไป
 */
export function newContactRow(nc: NewContactInput, type: ConnectorType): ContactRow | string {
  const taxId = normalizeTaxId(nc.tax_id);
  const form = branchFormOf(nc.branch, taxId);
  const input = { name: String(nc.name ?? ""), taxId, isExport: false, ...form };
  const err = validateNewCustomer(input);
  if (err) return `คู่ค้าใหม่: ${err}`;
  if (taxId && !taxIdValid(taxId)) return `คู่ค้าใหม่: เลขผู้เสียภาษี ${taxId} ไม่ผ่านการตรวจหลักสุดท้าย — อ่านเลขบนบิลใหม่`;
  return {
    name: input.name.trim(),
    tax_id: taxIdToSave(input) || null,
    branch: branchToSave(input) || null,
    address: String(nc.address ?? "").trim() || null,
    contact_type: CONTACT_TYPE_OF[type],
  };
}

/**
 * มีคู่ค้านี้ในทะเบียนแล้วไหม — เทียบ "เลขภาษี + สาขา" (สาขาเทียบแบบเดียวกับฟอร์ม: 152 = 00152)
 * ไม่มีเลขภาษี = เทียบชื่อตรงตัว · 🪤 เลขภาษีเดียวกันแต่คนละสาขา = คนละคู่ค้า (D30)
 */
export function findExistingContact(row: ContactRow, all: ExistingContact[]): ExistingContact | null {
  const key = (taxId: string | null, branch: string | null) => {
    const t = normalizeTaxId(taxId);
    const f = branchFormOf(branch, t);
    return `${t}|${branchToSave({ noTaxId: f.noTaxId, branchMode: f.branchMode, branchNumber: f.branchNumber })}`;
  };
  if (row.tax_id) {
    const k = key(row.tax_id, row.branch);
    return all.find((c) => c.tax_id && key(c.tax_id, c.branch) === k) ?? null;
  }
  const n = row.name.trim();
  return all.find((c) => !c.tax_id && c.name.trim() === n) ?? null;
}
