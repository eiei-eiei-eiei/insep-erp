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
import Link from "next/link";
import { FORWARD_CAT_KIND, DEFAULT_FORWARD_CATS } from "@/lib/accounting/forwardCats";
import type { AccountRow, Bootstrap, Contact } from "./types";
import { Card, Field, Msg, NumBox, SaveButton, Select, TextInput, cleanTaxId13, fmt, useSaver, EscToClose } from "./ui";

/**
 * ตั้งค่าที่เป็น "ข้อมูลของโดเมนบัญชี" เท่านั้น
 *
 * ★ แบรนด์ / ข้อมูลกิจการบนเอกสาร / LINE **ย้ายออกไปหน้าตั้งค่ากลางแล้ว** (D63)
 *   เพราะเป็นค่าของทั้งระบบ แต่แท็บนี้ถูก requireModule("accounting") กั้นอยู่
 *   → ลูกค้าที่ซื้อแค่โมดูลผลิตเคยตั้งค่าพวกนั้นไม่ได้เลย
 */
export function SettingsTab({ boot }: { boot: Bootstrap }) {
  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-raised px-3 py-2 text-sm text-muted">
        แบรนด์ · ข้อมูลกิจการบนเอกสาร · แจ้งเตือน LINE ย้ายไปที่เมนู{" "}
        <Link href="/settings" className="font-medium text-brand hover:underline">ตั้งค่า</Link>{" "}
        แล้ว (ใช้ได้ทุกแพ็กเกจ ไม่ต้องมีโมดูลบัญชี)
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChipList kind="expense_cat" title="หมวดหมู่รายจ่าย" initial={boot.expenseCats} />
        <ChipList kind="income_cat" title="หมวดหมู่รายรับ" initial={boot.incomeCats} />
        <ChipList kind="wht_rate" title="อัตรา WHT (%)" initial={boot.whtRates} placeholder="เช่น 3" />
        <ChipList kind="tax_account" title="บัญชีในระบบภาษี (ชื่อต้องตรงบัญชีเงิน)" initial={boot.taxAccounts} />
        {/* D80: เดิมฮาร์ดโค้ด "ต้นทุนสุรา" ไว้ในหน้าจอ — ผังบัญชีจริงของลูกค้าไม่มีคำนั้น
            🪤 ส่ง `forwardCatsSet` (ที่ตั้งเองจริง) ไม่ใช่ `forwardCats` (ที่มีผลจริง) —
               โชว์ค่าปริยายเป็น chip เมื่อไหร่ ผู้ใช้จะนึกว่าบันทึกไว้แล้ว พอเพิ่มตัวที่ 2
               ค่าปริยายจะหลุดเงียบ ๆ ทันที (กับดักเดียวกับ D74) */}
        <ChipList
          kind={FORWARD_CAT_KIND}
          title="หมวดที่รับวัตถุดิบเข้าสต็อกผลิต"
          initial={boot.forwardCatsSet}
          placeholder="เช่น วัตถุดิบผลิตสุรา"
          emptyHint={`ยังไม่ได้ตั้ง — ระบบใช้ “${DEFAULT_FORWARD_CATS.join(" · ")}” ให้ก่อน · เพิ่มเองแล้วจะใช้เฉพาะที่เพิ่ม`}
          note="ลงบิลรายจ่ายด้วยหมวดเหล่านี้ = ช่องรายการกลายเป็นดร็อปดาวน์วัตถุดิบ และของเข้าสต็อกผลิตให้อัตโนมัติ"
        />
      </div>
      <BankAccounts boot={boot} />
      <Contacts initial={boot.contacts} />
      <p className="text-xs text-faint">* ต้องเป็น role main ถึงจะแก้ได้ · แก้แล้วรีเฟรชหน้าเพื่อให้แท็บอื่นเห็นค่าล่าสุด</p>
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
    const nm = name.trim();
    if (!nm) return;
    run(() => saveBankAccountAction({ accountName: nm, entityIds: ents, kind, openingBalance: opening }), "บันทึกบัญชีแล้ว", (data) => {
      const updated = (data as { updated?: boolean } | undefined)?.updated;
      const row = { account_name: nm, entity_ids: ents, opening_balance: opening, kind };
      setRows((p) => (updated ? p.map((a) => (a.account_name === nm ? row : a)) : [...p, row]));
      setName(""); setOpening(0); setEnts([]); setKind("");
    });
  }
  // ลบต้องรู้ account_id — boot.accounts ไม่มี id · ให้รีเฟรชหน้าเพื่อลบได้ (หรือใช้ Supabase) — เก็บ id ถ้ามี
  return (
    <Card title="บัญชีเงิน (bank_accounts)">
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr className="text-left text-faint"><th>ชื่อบัญชี</th><th>ประเภท</th><th>กิจการที่ใช้</th><th className="num">ยอดยกมา</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.account_name}><td>{a.account_name}</td><td>{a.kind}</td><td>{(a.entity_ids ?? []).join(", ") || "ทุกกิจการ"}</td><td className="num">{fmt(a.opening_balance)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="ชื่อบัญชี"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="ประเภท"><TextInput value={kind} onChange={(e) => setKind(e.target.value)} placeholder="ออมทรัพย์/เงินสด" /></Field>
        <Field label="ยอดยกมา"><NumBox value={opening} blankZero onChange={(v) => setOpening(v === "" ? 0 : v)} /></Field>
        <div className="col-span-2 md:col-span-4">
          <span className="mb-1 block text-sm text-muted">กิจการที่ใช้ (ติ๊กได้หลายอัน · ไม่ติ๊ก = ใช้ร่วมทุกกิจการ)</span>
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
      <p className="mt-1 text-xs text-faint">แก้ยอดยกมา = พิมพ์ชื่อบัญชีเดิม + ยอดใหม่ แล้วกดเพิ่ม (upsert ตามชื่อ) · ลบบัญชีทำผ่านหน้า Supabase (กันลบผิด)</p>
    </Card>
  );
}

function Contacts({ initial }: { initial: Contact[] }) {
  const { pending, msg, run, setMsg } = useSaver();
  const [rows, setRows] = useState<Contact[]>(initial);
  const [edit, setEdit] = useState<Contact | null>(null);
  const [q, setQ] = useState("");
  const filtered = rows.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));

  function blank(): Contact { return { contact_id: "", name: "", tax_id: "", branch: "สำนักงานใหญ่", address: "", contact_type: "ทั้งสอง", roles: [] }; }
  function save(c: Contact) {
    if (!c.name.trim()) { setMsg({ ok: false, text: "กรุณากรอกชื่อคู่ค้า" }); return; }
    const tax = cleanTaxId13(c.tax_id);
    if (!tax) { setMsg({ ok: false, text: "เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก" }); return; }
    const saved = { ...c, tax_id: tax };
    if (c.contact_id) {
      run(() => updateContactAction({ contactId: c.contact_id, name: c.name, taxId: tax, branch: c.branch ?? "", address: c.address ?? "", contactType: c.contact_type ?? "" }), "แก้ไขแล้ว",
        () => { setRows((p) => p.map((x) => x.contact_id === c.contact_id ? saved : x)); setEdit(null); });
    } else {
      run(() => addContactAction({ name: c.name, taxId: tax, branch: c.branch ?? "", address: c.address ?? "", contactType: c.contact_type ?? "" }), "เพิ่มแล้ว",
        (data) => { const id = (data as { contactId: string }).contactId; setRows((p) => [...p, { ...saved, contact_id: id }]); setEdit(null); });
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
        <button onClick={() => setEdit(blank())} className="whitespace-nowrap rounded-lg bg-brand px-4 py-2 text-sm text-on-brand">+ เพิ่มคู่ค้า</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        <table className="tbl">
          <thead><tr className="text-left text-faint"><th>ชื่อ</th><th>เลขภาษี</th><th>สาขา</th><th>ประเภท</th><th></th></tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.contact_id}>
                <td>{c.name}</td><td>{c.tax_id}</td><td>{c.branch}</td><td>{c.contact_type}</td>
                <td className="whitespace-nowrap"><button onClick={() => setEdit(c)} className="text-muted hover:underline">แก้</button><button onClick={() => del(c.contact_id)} className="ml-2 text-crit hover:underline">ลบ</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Msg msg={msg} />
      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/30 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setEdit(null); }}>
          <EscToClose onClose={() => { setEdit(null); }} />
          <div className="w-full max-w-md rounded-lg bg-card p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 font-semibold text-ink">{edit.contact_id ? "แก้ไขคู่ค้า" : "เพิ่มคู่ค้า"}</h3>
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
              <button onClick={() => setEdit(null)} className="rounded-lg border border-line px-4 py-2 text-sm">ยกเลิก</button>
              <SaveButton pending={pending} onClick={() => save(edit)}>บันทึก</SaveButton>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
