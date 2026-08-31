"use client";

import { useState } from "react";
import type { CustomerRow } from "./types";
import { Msg, NumInput, TextInput, useSaver } from "./ui";
import { saveCustomerAction } from "../actions";
import { IconPlus } from "@/lib/shared/icons";
import { validateNewCustomer, branchToSave, taxIdToSave, hidesBranch } from "@/lib/sales/customer";

/**
 * ฟอร์มเพิ่มลูกค้าใหม่ — **ใช้ร่วมกันระหว่างหน้าใบเสนอราคาและหน้าขายหน้าร้าน (D86)**
 *
 * 🚨 เดิมฝังอยู่ใน QuotationTab · ย้ายออกมาเพราะหน้าขายหน้าร้านต้องใช้ตัวเดียวกัน
 *    การก๊อปไปอีกชุด = กติกาตรวจเลขภาษี 13 หลัก / เลขสาขา 5 หลัก มี 2 ที่
 *    แล้ววันหนึ่งจะแก้ไปแค่ที่เดียวโดยไม่มีอะไรฟ้อง (ตระกูล D84)
 */
export function AddCustomerModal({ onClose, onAdded }: { onClose: () => void; onAdded: (c: CustomerRow) => void }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [taxId, setTaxId] = useState("");
  const [branchMode, setBranchMode] = useState<"hq" | "branch">("hq");
  const [branchNumber, setBranchNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [creditTerm, setCreditTerm] = useState(0);
  const [isExport, setIsExport] = useState(false);
  const [noTaxId, setNoTaxId] = useState(false);
  const { pending, msg, run, setMsg } = useSaver();

  // กติกาอยู่ใน lib/sales/customer (มีเทส) — ที่นี่เหลือแค่การวาดหน้าจอ
  const form = { name, taxId, branchMode, branchNumber, noTaxId, isExport };
  const showTaxFields = !hidesBranch(form);

  function save() {
    const err = validateNewCustomer(form);
    if (err) { setMsg({ ok: false, text: err }); return; }
    const branch = branchToSave(form);
    const tax = taxIdToSave(form);
    run(
      () => saveCustomerAction({ name, address, taxId: tax, branch, phone, creditTerm, isExport }),
      "เพิ่มลูกค้าแล้ว",
      (data) => {
        const { id } = data as { id: string };
        onAdded({ id, name, address, taxId: tax, branch, phone, creditTerm, saleName: "", isExport });
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink"><IconPlus size={15} className="mr-1 inline align-[-2px]" />เพิ่มลูกค้าใหม่</h2>
          <button onClick={onClose} className="text-2xl leading-none text-faint hover:text-crit">
            &times;
          </button>
        </div>
        <Msg msg={msg} />
        <div className="space-y-3">
          <TextInput placeholder="ชื่อบริษัท / ลูกค้า *" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea placeholder="ที่อยู่จดทะเบียน *" value={address} onChange={(e) => setAddress(e.target.value)} rows={2} className="w-full rounded-lg border border-line p-2 text-sm outline-none focus:border-brand" />
          {/* D86 — ลูกค้าขาจรหน้าร้านไม่มีเลขประจำตัวผู้เสียภาษี · ติ๊กแล้วซ่อนทั้งเลขภาษีและสาขา
              (สาขาว่าง = ไม่พิมพ์วงเล็บสาขาบนเอกสาร ซึ่งถูกกว่าการพิมพ์ "(สำนักงานใหญ่)" ให้คนเดินเข้ามาซื้อ) */}
          <label className="flex items-center gap-3 rounded-lg border border-line bg-raised p-3 text-sm">
            <input type="checkbox" checked={noTaxId} onChange={(e) => setNoTaxId(e.target.checked)} />
            <span>
              <b className="text-ink">ไม่มีเลขประจำตัวผู้เสียภาษี</b> — ลูกค้าทั่วไป/ขาจรที่ซื้อหน้าร้าน
            </span>
          </label>

          {showTaxFields && (
            <div className="grid grid-cols-2 gap-3">
              <TextInput placeholder={`เลขผู้เสียภาษี 13 หลัก${isExport ? "" : " *"}`} maxLength={13} value={taxId} onChange={(e) => setTaxId(e.target.value.replace(/\D/g, ""))} />
              <div className="text-sm">
                <label className="mr-3">
                  <input type="radio" checked={branchMode === "hq"} onChange={() => setBranchMode("hq")} /> สนญ.
                </label>
                <label>
                  <input type="radio" checked={branchMode === "branch"} onChange={() => setBranchMode("branch")} /> สาขา
                </label>
                {branchMode === "branch" && <TextInput placeholder="00001" maxLength={5} value={branchNumber} onChange={(e) => setBranchNumber(e.target.value.replace(/\D/g, ""))} className="mt-1" />}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <TextInput placeholder="เบอร์โทร" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <NumInput placeholder="เครดิต (วัน)" value={creditTerm || ""} onChange={(e) => setCreditTerm(Number(e.target.value) || 0)} />
          </div>
          <label className="flex items-center gap-3 rounded-lg border border-warn-line bg-warn-bg p-3 text-sm">
            <input type="checkbox" checked={isExport} onChange={(e) => setIsExport(e.target.checked)} />
            <span>
              <b className="text-warn">ลูกค้าจำหน่ายต่างประเทศ (Export)</b> — ส่งข้อมูลให้แอปผลิตเป็น &quot;จำหน่ายต่างประเทศ&quot;
              {isExport && showTaxFields && (
                <>
                  <br />
                  ผู้ซื้อต่างชาติไม่มีเลขภาษีไทย — เว้นว่างได้ · เป็นนิติบุคคลไทยที่ซื้อไปส่งออกก็ยังกรอกได้ตามปกติ
                </>
              )}
            </span>
          </label>
          <button onClick={save} disabled={pending} className="w-full rounded-lg bg-brand py-2 font-bold text-on-brand hover:opacity-90 disabled:opacity-50">
            {pending ? "กำลังบันทึก…" : "บันทึกข้อมูลลูกค้า"}
          </button>
        </div>
      </div>
    </div>
  );
}
