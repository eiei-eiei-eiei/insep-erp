"use client";

import { useEffect, useState } from "react";
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
import { ContactFields, blankContactForm, contactPayload, toContactForm, type ContactForm } from "./ContactFields";
import type { Bootstrap, Contact } from "./types";
import { IconBtn, SaveButton, TextInput, useSaver } from "./ui";
import { useConfirm, Modal, ModalCancel } from "@/lib/shared/ui";
import { ListEmpty, ListRow, SettingsCard, SettingsList, SettingsShell, type ShellSection } from "@/lib/shared/settings";
import { IconEdit, IconPlus, IconTrash } from "@/lib/shared/icons";
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
 * ★ D173 เฟส 4a — หน้าตัวอย่างของ "แบบ ก" (เมนูข้าง + รายการเป็นแถว · DESIGN_SYSTEM "หน้าตั้งค่า")
 *   หน้าตาอยู่ที่ lib/shared/settings.tsx · ไฟล์นี้เหลือแต่ข้อมูลกับการบันทึก (ตรรกะเดิมไม่ถูกแตะ)
 */
export function SettingsTab({ boot }: { boot: Bootstrap }) {
  // จำนวนบนเมนูข้าง — นับจากรายการที่แต่ละการ์ดถืออยู่จริง (เพิ่ม/ลบแล้วเลขขยับตาม)
  const [counts, setCounts] = useState<Record<string, number | null>>({
    accounts: null,
    contacts: boot.contacts.length,
    expense_cat: boot.expenseCats.length,
    income_cat: boot.incomeCats.length,
    wht_rate: boot.whtRates.length,
    [FORWARD_CAT_KIND]: boot.forwardCatsSet.length,
  });
  const setCount = (key: string) => (n: number | null) =>
    setCounts((p) => (p[key] === n ? p : { ...p, [key]: n }));

  const sections: ShellSection[] = [
    { key: "accounts", label: "บัญชีเงิน", count: counts.accounts, body: <BankAccountsCard boot={boot} onCount={setCount("accounts")} /> },
    { key: "contacts", label: "คู่ค้า", count: counts.contacts, body: <Contacts initial={boot.contacts} onCount={setCount("contacts")} /> },
    {
      key: "expense",
      label: "หมวดหมู่รายจ่าย",
      count: counts.expense_cat,
      body: <CatList kind="expense_cat" title="หมวดหมู่รายจ่าย" initial={boot.expenseCats} onCount={setCount("expense_cat")} placeholder="เช่น ค่าเช่า — พิมพ์แล้วกด Enter" />,
    },
    {
      key: "income",
      label: "หมวดหมู่รายรับ",
      count: counts.income_cat,
      body: <CatList kind="income_cat" title="หมวดหมู่รายรับ" initial={boot.incomeCats} onCount={setCount("income_cat")} placeholder="เช่น รายได้ค่าสินค้า — พิมพ์แล้วกด Enter" />,
    },
    {
      key: "wht",
      label: "อัตราหัก ณ ที่จ่าย",
      count: counts.wht_rate,
      body: <CatList kind="wht_rate" title="อัตราหัก ณ ที่จ่าย (WHT)" initial={boot.whtRates} onCount={setCount("wht_rate")} placeholder="เช่น 3 — พิมพ์แล้วกด Enter" suffix="%" />,
    },
  ];
  // D80: เดิมฮาร์ดโค้ด "ต้นทุนสุรา" ไว้ในหน้าจอ — ผังบัญชีจริงของลูกค้าไม่มีคำนั้น
  // 🪤 ส่ง `forwardCatsSet` (ที่ตั้งเองจริง) ไม่ใช่ `forwardCats` (ที่มีผลจริง) —
  //    โชว์ค่าปริยายเป็นรายการเมื่อไหร่ ผู้ใช้จะนึกว่าบันทึกไว้แล้ว พอเพิ่มตัวที่ 2
  //    ค่าปริยายจะหลุดเงียบ ๆ ทันที (กับดักเดียวกับ D74)
  if (boot.hasProduction) {
    sections.push({
      key: "forward",
      label: "หมวดรับวัตถุดิบเข้าผลิต",
      count: counts[FORWARD_CAT_KIND],
      body: (
        <CatList
          kind={FORWARD_CAT_KIND}
          title="หมวดที่รับวัตถุดิบเข้าสต็อกผลิต"
          initial={boot.forwardCatsSet}
          onCount={setCount(FORWARD_CAT_KIND)}
          placeholder="เช่น วัตถุดิบผลิตสุรา — พิมพ์แล้วกด Enter"
          emptyHint={`ยังไม่ได้ตั้ง — ระบบใช้ “${DEFAULT_FORWARD_CATS.join(" · ")}” ให้ก่อน · เพิ่มเองแล้วจะใช้เฉพาะที่เพิ่ม`}
          help="ลงบิลรายจ่ายด้วยหมวดเหล่านี้ = ช่องรายการกลายเป็นดร็อปดาวน์วัตถุดิบ และของเข้าสต็อกผลิตให้อัตโนมัติ"
        />
      ),
    });
  }

  return (
    <SettingsShell
      sections={sections}
      intro={
        <p className="rounded-lg bg-raised px-3 py-2 text-sm text-muted">
          แบรนด์ · ข้อมูลกิจการบนเอกสาร · แจ้งเตือน LINE ย้ายไปที่เมนู{" "}
          <Link href="/settings" className="font-medium text-brand hover:underline">ตั้งค่า</Link>{" "}
          แล้ว (ใช้ได้ทุกแพ็กเกจ ไม่ต้องมีโมดูลบัญชี)
        </p>
      }
    />
  );
}

/** รายการข้อความ 1 ชุดของ app_settings (หมวดหมู่ · อัตรา) — หน้าตาอยู่ที่ SettingsList */
function CatList({ kind, title, initial, placeholder, emptyHint, help, suffix, onCount }: {
  kind: string; title: string; initial: string[]; placeholder?: string;
  /** ข้อความตอนยังไม่มีรายการ — ใช้บอกว่า "ระบบใช้ค่าปริยายอะไรให้อยู่" */
  emptyHint?: string;
  /** คำอธิบาย (ผลของการตั้งค่านี้) — อยู่หลังปุ่ม ⓘ ข้างหัวการ์ด (D173) */
  help?: string;
  suffix?: string;
  onCount: (n: number) => void;
}) {
  const { pending, run } = useSaver();
  const { ask, confirmNode } = useConfirm();
  const [list, setList] = useState<string[]>(initial);
  useEffect(() => { onCount(list.length); }, [list.length, onCount]);

  function add(v: string) {
    run(() => addSettingAction(kind, v), "เพิ่มแล้ว", () => setList((p) => [...p, v]));
  }
  async function del(v: string) {
    const ok = await ask({
      title: `ลบ “${v}${suffix ?? ""}” ออกจาก${title}?`,
      detail: "บิลเก่าที่ใช้ค่านี้ยังอยู่ครบและยังขึ้นในรายงานตามเดิม · แค่เลือกค่านี้กับบิลใหม่ไม่ได้",
      confirmText: "ลบ",
      danger: true,
    });
    if (!ok) return;
    run(() => deleteSettingAction(kind, v), "ลบแล้ว", () => setList((p) => p.filter((x) => x !== v)));
  }
  return (
    <>
      {confirmNode}
      <SettingsList
        title={title}
        help={help}
        items={list}
        onAdd={add}
        onDelete={del}
        pending={pending}
        placeholder={placeholder}
        emptyHint={emptyHint}
        suffix={suffix}
      />
    </>
  );
}

/** คู่ค้า — ฟอร์มอยู่ที่ ContactFields (ชุดเดียวกับป๊อปอัพเพิ่มคู่ค้าในหน้าบันทึก) */
function Contacts({ initial, onCount }: { initial: Contact[]; onCount: (n: number) => void }) {
  const router = useRouter();
  const { pending, run, setMsg } = useSaver();
  const { ask, confirmNode } = useConfirm();
  const [rows, setRows] = useState<Contact[]>(initial);
  const [edit, setEdit] = useState<ContactForm | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { onCount(rows.length); }, [rows.length, onCount]);
  const filtered = rows.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || (c.tax_id ?? "").includes(q));

  function openNew() {
    setMsg(null); setFormErr(null);
    setEdit(blankContactForm());
  }
  function openEdit(c: Contact) { setMsg(null); setFormErr(null); setEdit(toContactForm(c)); }

  function save(f: ContactForm) {
    const res = contactPayload(f);
    if ("error" in res) { setFormErr(res.error); return; }
    setFormErr(null);
    const { payload } = res;
    const { taxId, branch } = payload;
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
    <SettingsCard
      title="คู่ค้า"
      count={rows.length}
      unit="ราย"
      help="ชื่อ เลขภาษี และที่อยู่ของคู่ค้า ใช้เติมลงบิล และออกหนังสือรับรองหัก ณ ที่จ่าย (50ทวิ)"
      action={
        <button onClick={openNew} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-brand px-3 py-2 text-sm font-medium text-on-brand">
          <IconPlus size={16} /> เพิ่มคู่ค้า
        </button>
      }
    >
      {confirmNode}
      {rows.length > 6 && (
        <div className="py-2">
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นชื่อหรือเลขภาษี…" aria-label="ค้นคู่ค้า" />
        </div>
      )}
      {rows.length === 0 && <ListEmpty>ยังไม่มีคู่ค้า — กด เพิ่มคู่ค้า หรือเพิ่มได้จากหน้าบันทึกตอนลงบิล</ListEmpty>}
      {rows.length > 0 && filtered.length === 0 && <ListEmpty>ไม่พบคู่ค้าที่ตรงกับ “{q}”</ListEmpty>}
      <div className={rows.length > 12 ? "max-h-[32rem] overflow-y-auto" : ""}>
        {filtered.map((c) => (
          <ListRow
            key={c.contact_id}
            title={c.name}
            sub={[c.tax_id ? `เลขภาษี ${c.tax_id}` : "ไม่มีเลขภาษี", c.tax_id ? c.branch || null : null, c.contact_type].filter(Boolean).join(" · ")}
            actions={
              <>
                <IconBtn onClick={() => openEdit(c)} aria-label={`แก้ไข ${c.name}`} title="แก้ไข"><IconEdit size={16} /></IconBtn>
                <IconBtn tone="red" onClick={() => del(c)} aria-label={`ลบ ${c.name}`} title="ลบ"><IconTrash size={16} /></IconBtn>
              </>
            }
          />
        ))}
      </div>
      {edit && (
        <Modal
          title={edit.contactId ? "แก้ไขคู่ค้า" : "เพิ่มคู่ค้า"}
          onClose={() => setEdit(null)}
          onSubmit={() => save(edit)}
          busy={pending}
          footer={
            <>
              <ModalCancel onClick={() => setEdit(null)} />
              <SaveButton pending={pending} onClick={() => save(edit)}>บันทึก</SaveButton>
            </>
          }
        >
          <ContactFields value={edit} onChange={setEdit} error={formErr} />
        </Modal>
      )}
    </SettingsCard>
  );
}
