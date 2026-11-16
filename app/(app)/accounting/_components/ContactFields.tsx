"use client";

/**
 * ฟอร์มคู่ค้า — ชุดเดียวใช้ทั้งหน้า ตั้งค่า → คู่ค้า และป๊อปอัพ "＋ เพิ่มคู่ค้า" ในหน้าบันทึก (D173)
 *
 * เดิมป๊อปอัพหน้าบันทึกมีฟอร์มของตัวเองที่บังคับเลขภาษี 13 หลักทุกกรณี
 * ⇒ คู่ค้าที่ไม่มีเลขภาษี (บุคคลทั่วไป / ร้านที่ไม่ออกใบกำกับ) เพิ่มจากหน้านั้นไม่ได้
 * กติกาเลขภาษี/สาขา = lib/shared/taxCustomer (S13) ชุดเดียวกับฟอร์มลูกค้าฝั่งขาย
 */

import { validateNewCustomer, branchToSave, taxIdToSave, hidesBranch, branchFormOf, type NewCustomerInput } from "@/lib/shared/taxCustomer";
import type { Contact } from "./types";
import { Field, Select, TextInput } from "./ui";

export type ContactForm = NewCustomerInput & { contactId: string; address: string; contactType: string };

export function blankContactForm(name = ""): ContactForm {
  return { contactId: "", name, taxId: "", branchMode: "hq", branchNumber: "", noTaxId: false, isExport: false, address: "", contactType: "ทั้งสอง" };
}

export function toContactForm(c: Contact): ContactForm {
  return {
    contactId: c.contact_id,
    name: c.name,
    taxId: c.tax_id ?? "",
    ...branchFormOf(c.branch, c.tax_id),
    isExport: false,
    address: c.address ?? "",
    contactType: c.contact_type || "ทั้งสอง",
  };
}

export type ContactPayload = { name: string; taxId: string; branch: string; address: string; contactType: string };

/** ตรวจฟอร์ม → ข้อความ error ไทย หรือค่าที่พร้อมส่งให้ action */
export function contactPayload(f: ContactForm): { error: string } | { payload: ContactPayload } {
  const err = validateNewCustomer(f);
  if (err) return { error: err.replace("กรอกชื่อลูกค้า", "กรอกชื่อคู่ค้า") };
  return {
    payload: { name: f.name.trim(), taxId: taxIdToSave(f), branch: branchToSave(f), address: f.address.trim(), contactType: f.contactType },
  };
}

export function ContactFields({ value: edit, onChange: setEdit, error }: {
  value: ContactForm;
  onChange: (f: ContactForm) => void;
  error?: string | null;
}) {
  return (
    <>
      <div className="space-y-3">
        <Field label="ชื่อ"><TextInput value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input type="checkbox" checked={edit.noTaxId} onChange={(e) => setEdit({ ...edit, noTaxId: e.target.checked })} />
          ไม่มีเลขประจำตัวผู้เสียภาษี (บุคคลทั่วไป / ร้านค้าที่ไม่ออกใบกำกับ)
        </label>
        {!hidesBranch(edit) && (
          <>
            <Field label="เลขประจำตัวผู้เสียภาษี (13 หลัก)"><TextInput value={edit.taxId} inputMode="numeric" onChange={(e) => setEdit({ ...edit, taxId: e.target.value.replace(/\D/g, "").slice(0, 13) })} /></Field>
            <div className="flex flex-wrap items-end gap-3 text-sm text-ink">
              <label className="flex items-center gap-1.5"><input type="radio" checked={edit.branchMode === "hq"} onChange={() => setEdit({ ...edit, branchMode: "hq" })} /> สำนักงานใหญ่</label>
              <label className="flex items-center gap-1.5"><input type="radio" checked={edit.branchMode === "branch"} onChange={() => setEdit({ ...edit, branchMode: "branch" })} /> สาขาที่</label>
              {edit.branchMode === "branch" && (
                <div className="w-28"><TextInput value={edit.branchNumber} inputMode="numeric" placeholder="เช่น 2" onChange={(e) => setEdit({ ...edit, branchNumber: e.target.value.replace(/\D/g, "").slice(0, 5) })} /></div>
              )}
            </div>
          </>
        )}
        <Field label="ที่อยู่ (ใช้ในหนังสือรับรองหัก ณ ที่จ่าย)"><TextInput value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
        <Field label="ประเภท" help="“ทั้งสอง” = เป็นได้ทั้งผู้ขายและลูกค้า → โผล่ทั้งรายรับและรายจ่าย"><Select value={edit.contactType} onChange={(e) => setEdit({ ...edit, contactType: e.target.value })}><option>ทั้งสอง</option><option>ผู้ขาย</option><option>ลูกค้า</option></Select></Field>
      </div>
      {error && <p className="mt-2 text-sm text-crit">{error}</p>}
    </>
  );
}
