"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  addSettingAction,
  deleteSettingAction,
  addContactAction,
  updateContactAction,
  deleteContactAction,
} from "../actions";
import Link from "next/link";
import { FORWARD_CAT_KIND, DEFAULT_FORWARD_CATS } from "@/lib/accounting/forwardCats";
import { validateNewCustomer, branchToSave, taxIdToSave, hidesBranch, branchFormOf, type NewCustomerInput } from "@/lib/shared/taxCustomer";
import type { Bootstrap, Contact } from "./types";
import { Card, Field, SaveButton, Select, TextInput, useSaver, EscToClose } from "./ui";
import { useConfirm } from "@/lib/shared/ui";
import { BankAccountsCard } from "./BankAccountsCard";

/**
 * ตั้งค่าที่เป็น "ข้อมูลของโดเมนบัญชี" เท่านั้น
 *
 * ★ แบรนด์ / ข้อมูลกิจการบนเอกสาร / LINE **ย้ายออกไปหน้าตั้งค่ากลางแล้ว** (D63)
 *   เพราะเป็นค่าของทั้งระบบ แต่แท็บนี้ถูก requireModule("accounting") กั้นอยู่
 *   → ลูกค้าที่ซื้อแค่โมดูลผลิตเคยตั้งค่าพวกนั้นไม่ได้เลย
 * ★ D125 — เรียงตามที่ใช้บ่อย: บัญชีเงิน → คู่ค้า → หมวด/อัตรา
 *   · ~~บัญชีในระบบภาษี~~ ตัดแล้ว (D124 — ภาษีขึ้นกับกิจการ + เอกสาร ไม่ใช่บัญชี)
 *   · หมวดรับวัตถุดิบเข้าสต็อกผลิต แสดงเฉพาะลูกค้าที่มีโมดูลผลิต (ไม่มี = ตั้งไปก็ไม่มีผลอะไร)
 */
export function SettingsTab({ boot }: { boot: Bootstrap }) {
  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-raised px-3 py-2 text-sm text-muted">
        แบรนด์ · ข้อมูลกิจการบนเอกสาร · แจ้งเตือน LINE ย้ายไปที่เมนู{" "}
        <Link href="/settings" className="font-medium text-brand hover:underline">ตั้งค่า</Link>{" "}
        แล้ว (ใช้ได้ทุกแพ็กเกจ ไม่ต้องมีโมดูลบัญชี)
      </p>
      <BankAccountsCard boot={boot} />
      <Contacts initial={boot.contacts} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChipList kind="expense_cat" title="หมวดหมู่รายจ่าย" initial={boot.expenseCats} />
        <ChipList kind="income_cat" title="หมวดหมู่รายรับ" initial={boot.incomeCats} />
        <ChipList kind="wht_rate" title="อัตรา WHT (%)" initial={boot.whtRates} placeholder="เช่น 3" />
        {/* D80: เดิมฮาร์ดโค้ด "ต้นทุนสุรา" ไว้ในหน้าจอ — ผังบัญชีจริงของลูกค้าไม่มีคำนั้น
            🪤 ส่ง `forwardCatsSet` (ที่ตั้งเองจริง) ไม่ใช่ `forwardCats` (ที่มีผลจริง) —
               โชว์ค่าปริยายเป็น chip เมื่อไหร่ ผู้ใช้จะนึกว่าบันทึกไว้แล้ว พอเพิ่มตัวที่ 2
               ค่าปริยายจะหลุดเงียบ ๆ ทันที (กับดักเดียวกับ D74) */}
        {boot.hasProduction && (
          <ChipList
            kind={FORWARD_CAT_KIND}
            title="หมวดที่รับวัตถุดิบเข้าสต็อกผลิต"
            initial={boot.forwardCatsSet}
            placeholder="เช่น วัตถุดิบผลิตสุรา"
            emptyHint={`ยังไม่ได้ตั้ง — ระบบใช้ “${DEFAULT_FORWARD_CATS.join(" · ")}” ให้ก่อน · เพิ่มเองแล้วจะใช้เฉพาะที่เพิ่ม`}
            note="ลงบิลรายจ่ายด้วยหมวดเหล่านี้ = ช่องรายการกลายเป็นดร็อปดาวน์วัตถุดิบ และของเข้าสต็อกผลิตให้อัตโนมัติ"
          />
        )}
      </div>
    </div>
  );
}

function ChipList({ kind, title, initial, placeholder, emptyHint, note }: {
  kind: string; title: string; initial: string[]; placeholder?: string;
  /** ข้อความตอนยังไม่มีรายการ — ใช้บอกว่า "ระบบใช้ค่าปริยายอะไรให้อยู่" */
  emptyHint?: string;
  /** คำอธิบายใต้กล่อง (ผลของการตั้งค่านี้) */
  note?: string;
}) {
  const { pending, run } = useSaver();
  const [list, setList] = useState<string[]>(initial);
  const [val, setVal] = useState("");
  function add() {
    const v = val.trim();
    if (!v || list.includes(v)) return;
    run(() => addSettingAction(kind, v), "เพิ่มแล้ว", () => { setList((p) => [...p, v]); setVal(""); });
  }
  function del(v: string) {
    run(() => deleteSettingAction(kind, v), "ลบแล้ว", () => setList((p) => p.filter((x) => x !== v)));
  }
  return (
    <Card title={title}>
      <div className="mb-2 flex flex-wrap gap-2">
        {list.length === 0 && (
          <span className={emptyHint ? "text-sm text-warn" : "text-sm text-faint"}>
            {emptyHint ?? "— ยังไม่มี —"}
          </span>
        )}
        {list.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-raised px-3 py-1 text-sm text-muted">
            {v}<button onClick={() => del(v)} disabled={pending} className="text-faint hover:text-crit">✕</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <TextInput value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder={placeholder ?? "เพิ่มรายการ…"} />
        <SaveButton pending={pending} onClick={add}>เพิ่ม</SaveButton>
      </div>
      {note && <p className="mt-2 text-xs text-faint">{note}</p>}
    </Card>
  );
}

/** ฟอร์มคู่ค้า — กติกาเลขภาษี/สาขาชุดเดียวกับฟอร์มลูกค้าฝั่งขาย (lib/shared/taxCustomer · S13) */
type ContactForm = NewCustomerInput & { contactId: string; address: string; contactType: string };

function toForm(c: Contact): ContactForm {
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

function Contacts({ initial }: { initial: Contact[] }) {
  const router = useRouter();
  const { pending, run, setMsg } = useSaver();
  const { ask, confirmNode } = useConfirm();
  const [rows, setRows] = useState<Contact[]>(initial);
  const [edit, setEdit] = useState<ContactForm | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const filtered = rows.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || (c.tax_id ?? "").includes(q));

  function openNew() {
    setMsg(null); setFormErr(null);
    setEdit({ contactId: "", name: "", taxId: "", branchMode: "hq", branchNumber: "", noTaxId: false, isExport: false, address: "", contactType: "ทั้งสอง" });
  }
  function openEdit(c: Contact) { setMsg(null); setFormErr(null); setEdit(toForm(c)); }

  function save(f: ContactForm) {
    const err = validateNewCustomer(f);
    if (err) { setFormErr(err.replace("กรอกชื่อลูกค้า", "กรอกชื่อคู่ค้า")); return; }
    setFormErr(null);
    const taxId = taxIdToSave(f);
    const branch = branchToSave(f);
    const payload = { name: f.name.trim(), taxId, branch, address: f.address.trim(), contactType: f.contactType };
    const saved: Contact = { contact_id: f.contactId, name: payload.name, tax_id: taxId, branch, address: payload.address, contact_type: f.contactType, roles: null };
    if (f.contactId) {
      run(() => updateContactAction({ contactId: f.contactId, ...payload }), "แก้ไขแล้ว", () => {
        setRows((p) => p.map((x) => (x.contact_id === f.contactId ? { ...x, ...saved, roles: x.roles } : x)));
        setEdit(null);
        router.refresh();
      });
    } else {
      run(() => addContactAction(payload), "เพิ่มแล้ว", (data) => {
        const id = (data as { contactId: string }).contactId;
        setRows((p) => [...p, { ...saved, contact_id: id }]);
        setEdit(null);
        router.refresh();
      });
    }
  }
  async function del(c: Contact) {
    // 🪤 ไม่ใช้ window.confirm() — เบราว์เซอร์บล็อกแล้วคืน false เงียบ ๆ (D96 ภาค 2)
    const ok = await ask({ title: `ลบคู่ค้า "${c.name}"?`, detail: "บิลเก่าที่ใช้ชื่อนี้ยังอยู่ครบ แต่จะไม่มีเลขภาษี/ที่อยู่ให้ดึงไปใส่รายงาน", confirmText: "ลบ", danger: true });
    if (!ok) return;
    run(() => deleteContactAction(c.contact_id), "ลบแล้ว", () => { setRows((p) => p.filter((x) => x.contact_id !== c.contact_id)); router.refresh(); });
  }

  return (
    <Card title={`คู่ค้า (${rows.length})`}>
      {confirmNode}
      <div className="mb-2 flex items-center gap-2">
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นชื่อหรือเลขภาษี…" />
        <button onClick={openNew} className="whitespace-nowrap rounded-lg bg-brand px-4 py-2 text-sm text-on-brand">+ เพิ่มคู่ค้า</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        <table className="tbl">
          <thead><tr className="text-left text-faint"><th>ชื่อ</th><th>เลขภาษี</th><th>สาขา</th><th>ประเภท</th><th></th></tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.contact_id}>
                <td>{c.name}</td><td>{c.tax_id || "-"}</td><td>{c.branch || "-"}</td><td>{c.contact_type}</td>
                <td className="whitespace-nowrap"><button onClick={() => openEdit(c)} className="text-muted hover:underline">แก้ไข</button><button onClick={() => del(c)} className="ml-2 text-crit hover:underline">ลบ</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/30 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setEdit(null); }}>
          <EscToClose onClose={() => { setEdit(null); }} />
          <div className="w-full max-w-md rounded-lg bg-card p-5">
            <h3 className="mb-3 font-semibold text-ink">{edit.contactId ? "แก้ไขคู่ค้า" : "เพิ่มคู่ค้า"}</h3>
            <div className="space-y-3">
              <Field label="ชื่อ"><TextInput value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <label className="flex items-center gap-1.5 text-sm text-muted">
                <input type="checkbox" checked={edit.noTaxId} onChange={(e) => setEdit({ ...edit, noTaxId: e.target.checked })} />
                ไม่มีเลขประจำตัวผู้เสียภาษี (บุคคลทั่วไป / ร้านค้าที่ไม่ออกใบกำกับ)
              </label>
              {!hidesBranch(edit) && (
                <>
                  <Field label="เลขประจำตัวผู้เสียภาษี (13 หลัก)"><TextInput value={edit.taxId} inputMode="numeric" onChange={(e) => setEdit({ ...edit, taxId: e.target.value.replace(/\D/g, "").slice(0, 13) })} /></Field>
                  <div className="flex flex-wrap items-end gap-3 text-sm">
                    <label className="flex items-center gap-1.5"><input type="radio" checked={edit.branchMode === "hq"} onChange={() => setEdit({ ...edit, branchMode: "hq" })} /> สำนักงานใหญ่</label>
                    <label className="flex items-center gap-1.5"><input type="radio" checked={edit.branchMode === "branch"} onChange={() => setEdit({ ...edit, branchMode: "branch" })} /> สาขาที่</label>
                    {edit.branchMode === "branch" && (
                      <div className="w-28"><TextInput value={edit.branchNumber} inputMode="numeric" placeholder="เช่น 2" onChange={(e) => setEdit({ ...edit, branchNumber: e.target.value.replace(/\D/g, "").slice(0, 5) })} /></div>
                    )}
                  </div>
                </>
              )}
              <Field label="ที่อยู่ (ใช้ในหนังสือรับรองหัก ณ ที่จ่าย)"><TextInput value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
              <Field label="ประเภท"><Select value={edit.contactType} onChange={(e) => setEdit({ ...edit, contactType: e.target.value })}><option>ทั้งสอง</option><option>ผู้ขาย</option><option>ลูกค้า</option></Select></Field>
            </div>
            {formErr && <p className="mt-2 text-sm text-crit">{formErr}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setEdit(null)} className="rounded-lg border border-line px-4 py-2 text-sm">ยกเลิก</button>
              <SaveButton pending={pending} onClick={() => save(edit)}>บันทึก</SaveButton>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
