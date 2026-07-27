"use client";

import { useState } from "react";
import {
  addSettingAction,
  deleteSettingAction,
  saveBankAccountAction,
  addContactAction,
  updateContactAction,
  deleteContactAction,
} from "../actions";
import type { AccountRow, Bootstrap, Contact } from "./types";
import { Card, Field, Msg, NumInput, SaveButton, Select, TextInput, fmt, useSaver } from "./ui";

export function SettingsTab({ boot }: { boot: Bootstrap }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChipList kind="expense_cat" title="หมวดหมู่รายจ่าย" initial={boot.expenseCats} />
        <ChipList kind="income_cat" title="หมวดหมู่รายรับ" initial={boot.incomeCats} />
        <ChipList kind="wht_rate" title="อัตรา WHT (%)" initial={boot.whtRates} placeholder="เช่น 3" />
        <ChipList kind="tax_account" title="บัญชีในระบบภาษี (ชื่อต้องตรงบัญชีเงิน)" initial={boot.taxAccounts} />
      </div>
      <BankAccounts boot={boot} />
      <Contacts initial={boot.contacts} />
      <p className="text-xs text-slate-400">* ต้องเป็น role main ถึงจะแก้ได้ · แก้แล้วรีเฟรชหน้าเพื่อให้แท็บอื่นเห็นค่าล่าสุด</p>
    </div>
  );
}

function ChipList({ kind, title, initial, placeholder }: { kind: string; title: string; initial: string[]; placeholder?: string }) {
  const { pending, msg, run } = useSaver();
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
        {list.length === 0 && <span className="text-sm text-slate-400">— ยังไม่มี —</span>}
        {list.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
            {v}<button onClick={() => del(v)} disabled={pending} className="text-slate-400 hover:text-red-500">✕</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <TextInput value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder={placeholder ?? "เพิ่มรายการ…"} />
        <SaveButton pending={pending} onClick={add}>เพิ่ม</SaveButton>
      </div>
      <Msg msg={msg} />
    </Card>
  );
}

function BankAccounts({ boot }: { boot: Bootstrap }) {
  const { pending, msg, run } = useSaver();
  const [rows, setRows] = useState<AccountRow[]>(boot.accounts);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [opening, setOpening] = useState(0);
  const [ents, setEnts] = useState<string[]>([]);

  function add() {
    if (!name.trim()) return;
    run(() => saveBankAccountAction({ accountName: name.trim(), entityIds: ents, kind, openingBalance: opening }), "บันทึกบัญชีแล้ว", () => {
      setRows((p) => [...p, { account_name: name.trim(), entity_ids: ents, opening_balance: opening, kind }]);
      setName(""); setOpening(0); setEnts([]); setKind("");
    });
  }
  // ลบต้องรู้ account_id — boot.accounts ไม่มี id · ให้รีเฟรชหน้าเพื่อลบได้ (หรือใช้ Supabase) — เก็บ id ถ้ามี
  return (
    <Card title="บัญชีเงิน (bank_accounts)">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500"><th className="p-1">ชื่อบัญชี</th><th className="p-1">ประเภท</th><th className="p-1">กิจการที่ใช้</th><th className="p-1 text-right">ยอดยกมา</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.account_name} className="border-t border-slate-100"><td className="p-1">{a.account_name}</td><td className="p-1">{a.kind}</td><td className="p-1">{(a.entity_ids ?? []).join(", ") || "ทุกกิจการ"}</td><td className="p-1 text-right">{fmt(a.opening_balance)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="ชื่อบัญชี"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="ประเภท"><TextInput value={kind} onChange={(e) => setKind(e.target.value)} placeholder="ออมทรัพย์/เงินสด" /></Field>
        <Field label="ยอดยกมา"><NumInput value={opening || ""} onChange={(e) => setOpening(Number(e.target.value))} /></Field>
        <div className="col-span-2 md:col-span-4">
          <span className="mb-1 block text-sm text-slate-600">กิจการที่ใช้ (ติ๊กได้หลายอัน · ไม่ติ๊ก = ใช้ร่วมทุกกิจการ)</span>
          <div className="flex flex-wrap gap-3">
            {boot.entities.map((en) => (
              <label key={en.entity_id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={ents.includes(en.entity_id)} onChange={(e) => setEnts((p) => e.target.checked ? [...p, en.entity_id] : p.filter((x) => x !== en.entity_id))} />
                {en.entity_id} — {en.name}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2"><Msg msg={msg} /><SaveButton pending={pending} onClick={add}>เพิ่ม/แก้บัญชี</SaveButton></div>
      <p className="mt-1 text-xs text-slate-400">แก้ยอดยกมา = พิมพ์ชื่อบัญชีเดิม + ยอดใหม่ แล้วกดเพิ่ม (upsert ตามชื่อ) · ลบบัญชีทำผ่านหน้า Supabase (กันลบผิด)</p>
    </Card>
  );
}

function Contacts({ initial }: { initial: Contact[] }) {
  const { pending, msg, run } = useSaver();
  const [rows, setRows] = useState<Contact[]>(initial);
  const [edit, setEdit] = useState<Contact | null>(null);
  const [q, setQ] = useState("");
  const filtered = rows.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));

  function blank(): Contact { return { contact_id: "", name: "", tax_id: "", branch: "สำนักงานใหญ่", address: "", contact_type: "ทั้งสอง", roles: [] }; }
  function save(c: Contact) {
    if (!c.name.trim()) return;
    if (c.contact_id) {
      run(() => updateContactAction({ contactId: c.contact_id, name: c.name, taxId: c.tax_id ?? "", branch: c.branch ?? "", address: c.address ?? "", contactType: c.contact_type ?? "" }), "แก้ไขแล้ว",
        () => { setRows((p) => p.map((x) => x.contact_id === c.contact_id ? c : x)); setEdit(null); });
    } else {
      run(() => addContactAction({ name: c.name, taxId: c.tax_id ?? "", branch: c.branch ?? "", address: c.address ?? "", contactType: c.contact_type ?? "" }), "เพิ่มแล้ว",
        (data) => { const id = (data as { contactId: string }).contactId; setRows((p) => [...p, { ...c, contact_id: id }]); setEdit(null); });
    }
  }
  function del(id: string) {
    if (!confirm("ลบคู่ค้านี้?")) return;
    run(() => deleteContactAction(id), "ลบแล้ว", () => setRows((p) => p.filter((x) => x.contact_id !== id)));
  }

  return (
    <Card title={`คู่ค้า (${rows.length})`}>
      <div className="mb-2 flex items-center gap-2">
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นชื่อคู่ค้า…" />
        <button onClick={() => setEdit(blank())} className="whitespace-nowrap rounded-lg bg-slate-800 px-4 py-2 text-sm text-white">+ เพิ่มคู่ค้า</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500"><th className="p-1">ชื่อ</th><th className="p-1">เลขภาษี</th><th className="p-1">สาขา</th><th className="p-1">ประเภท</th><th className="p-1"></th></tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.contact_id} className="border-t border-slate-100">
                <td className="p-1">{c.name}</td><td className="p-1">{c.tax_id}</td><td className="p-1">{c.branch}</td><td className="p-1">{c.contact_type}</td>
                <td className="p-1 whitespace-nowrap"><button onClick={() => setEdit(c)} className="text-slate-700 hover:underline">แก้</button><button onClick={() => del(c.contact_id)} className="ml-2 text-red-500 hover:underline">ลบ</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Msg msg={msg} />
      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setEdit(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 font-semibold text-slate-800">{edit.contact_id ? "แก้ไขคู่ค้า" : "เพิ่มคู่ค้า"}</h3>
            <div className="space-y-3">
              <Field label="ชื่อ"><TextInput value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="เลขภาษี"><TextInput value={edit.tax_id ?? ""} onChange={(e) => setEdit({ ...edit, tax_id: e.target.value })} /></Field>
                <Field label="สาขา"><TextInput value={edit.branch ?? ""} onChange={(e) => setEdit({ ...edit, branch: e.target.value })} /></Field>
              </div>
              <Field label="ที่อยู่"><TextInput value={edit.address ?? ""} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
              <Field label="ประเภท"><Select value={edit.contact_type ?? "ทั้งสอง"} onChange={(e) => setEdit({ ...edit, contact_type: e.target.value })}><option>ทั้งสอง</option><option>ผู้ขาย</option><option>ลูกค้า</option></Select></Field>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setEdit(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">ยกเลิก</button>
              <SaveButton pending={pending} onClick={() => save(edit)}>บันทึก</SaveButton>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
