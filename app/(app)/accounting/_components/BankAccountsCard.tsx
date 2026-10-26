"use client";

/**
 * D125 — การ์ดบัญชีเงินในแท็บตั้งค่า (แทนฟอร์ม "พิมพ์ชื่อเดิมแล้วกดเพิ่ม" แบบเก่า)
 *
 * · แต่ละแถวมีปุ่ม แก้ไข / ปิดใช้ / ลบ · เพิ่มบัญชีผ่านป๊อปอัพตัวเดียวกับแก้ไข
 * · เปลี่ยนชื่อ = ตามไปแก้ทุกบิล/ค่าตั้งที่อ้างชื่อเดิม (fn_rename_bank_account · 0089)
 * · ลบได้เฉพาะบัญชีที่ไม่มีอะไรอ้างถึง — นอกนั้นปุ่มเทา + บอกเหตุผล (ซ่อนปุ่มแย่กว่าปุ่มเทา D86)
 * ★ ประโยค/เงื่อนไขทุกตัวตัดสินใน lib/accounting/bankAccounts (มีเทส A25)
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  getBankAccountAdminAction,
  saveBankAccountAction,
  setBankAccountActiveAction,
  deleteBankAccountAction,
} from "../actions";
import type { BankAccountAdminRow } from "../data";
import type { Bootstrap } from "./types";
import { Badge, Card, Field, NumBox, SaveButton, TextInput, fmt, useSaver, useRead, LoadError, EscToClose } from "./ui";
import { SuggestInput, useConfirm } from "@/lib/shared/ui";
import {
  accountNameError,
  usageText,
  deleteBlockReason,
  deactivateWarn,
  renameDoneText,
  renameWarnText,
} from "@/lib/accounting/bankAccounts";

const KIND_OPTIONS = ["ออมทรัพย์", "กระแสรายวัน", "ฝากประจำ", "เงินสด", "เงินสดย่อย", "บัตรเครดิต", "e-Wallet"];

type Form = {
  accountId?: string;
  originalName: string;
  name: string;
  kind: string;
  opening: number;
  openingDate: string;
  ents: string[];
};

export function BankAccountsCard({ boot }: { boot: Bootstrap }) {
  const router = useRouter();
  const { pending, run, setMsg } = useSaver();
  const { ask, confirmNode } = useConfirm();
  const { data, err, reload } = useRead(() => getBankAccountAdminAction(), []);
  const [form, setForm] = useState<Form | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const multiEntity = boot.entities.length > 1;
  const entName = (id: string) => boot.entities.find((e) => e.entity_id === id)?.name ?? id;

  const rows = data ?? [];
  const inactiveCount = rows.filter((r) => !r.active).length;
  const shown = rows.filter((r) => showInactive || r.active);

  /** บันทึกสำเร็จ → โหลดการ์ดนี้ใหม่ + ให้แท็บอื่น (ช่องเลือกบัญชี) เห็นค่าใหม่ทันที */
  function refreshAll() {
    reload();
    router.refresh();
  }

  function openNew() {
    setMsg(null); setFormErr(null);
    setForm({ originalName: "", name: "", kind: "", opening: 0, openingDate: "", ents: [] });
  }
  function openEdit(r: BankAccountAdminRow) {
    setMsg(null); setFormErr(null);
    setForm({ accountId: r.accountId, originalName: r.accountName, name: r.accountName, kind: r.kind, opening: r.openingBalance, openingDate: r.openingDate, ents: r.entityIds });
  }

  function save() {
    if (!form) return;
    const e = accountNameError(form.name, rows.map((r) => r.accountName), form.originalName || null);
    if (e) { setFormErr(e); return; }
    setFormErr(null);
    run(
      () => saveBankAccountAction({
        accountId: form.accountId,
        accountName: form.name,
        entityIds: form.ents,
        kind: form.kind,
        openingBalance: form.opening,
        openingDate: form.openingDate || null,
      }),
      form.accountId ? "บันทึกบัญชีแล้ว" : "เพิ่มบัญชีแล้ว",
      (d) => {
        const renamed = (d as { renamed?: Record<string, number> | null } | undefined)?.renamed;
        if (renamed?.changed) setMsg({ ok: true, text: renameDoneText(renamed) });
        setForm(null);
        refreshAll();
      },
    );
  }

  async function toggleActive(r: BankAccountAdminRow) {
    if (r.active) {
      const warn = deactivateWarn(r.usage, r.balance);
      const ok = await ask({
        title: `ปิดใช้บัญชี "${r.accountName}"?`,
        detail: "บัญชีจะไม่โผล่ในช่องเลือกบัญชีของบิลใหม่ · บิลเก่า ยอดคงเหลือ และรายงานยังอยู่ครบ · เปิดใช้คืนได้ทุกเมื่อ" + (warn ? `\n\n⚠️ ${warn}` : ""),
        confirmText: "ปิดใช้",
      });
      if (!ok) return;
    }
    run(() => setBankAccountActiveAction(r.accountId, !r.active), r.active ? "ปิดใช้บัญชีแล้ว" : "เปิดใช้บัญชีแล้ว", refreshAll);
  }

  async function del(r: BankAccountAdminRow) {
    const ok = await ask({ title: `ลบบัญชี "${r.accountName}"?`, detail: "บัญชีนี้ยังไม่มีรายการ ลบแล้วไม่มีอะไรหาย", confirmText: "ลบ", danger: true });
    if (!ok) return;
    run(() => deleteBankAccountAction(r.accountName), "ลบบัญชีแล้ว", refreshAll);
  }

  const editing = form?.accountId ? rows.find((r) => r.accountId === form.accountId) : undefined;
  const renaming = !!form?.accountId && form.name.trim() !== form.originalName;

  return (
    <Card title={`บัญชีเงิน (${rows.filter((r) => r.active).length})`}>
      {confirmNode}
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <button onClick={openNew} className="rounded-lg bg-brand px-4 py-2 text-sm text-on-brand">+ เพิ่มบัญชี</button>
        {inactiveCount > 0 && (
          <label className="flex items-center gap-1.5 text-sm text-muted">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            แสดงบัญชีที่ปิดใช้ ({inactiveCount})
          </label>
        )}
      </div>
      <LoadError err={err} onRetry={reload} what="บัญชีเงิน" />
      {!data ? <p className="text-sm text-faint">{err ? "— โหลดไม่สำเร็จ —" : "กำลังโหลด…"}</p> : rows.length === 0 ? (
        <p className="text-sm text-faint">ยังไม่มีบัญชีเงิน — กด + เพิ่มบัญชี (บิลทุกใบต้องเลือกบัญชีที่เงินเข้า/ออก)</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr className="text-left text-faint">
                <th>ชื่อบัญชี</th><th>ประเภท</th>{multiEntity && <th>กิจการที่ใช้</th>}
                <th className="num">ยอดยกมา</th><th className="num">คงเหลือ</th><th>การใช้งาน</th><th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const block = deleteBlockReason(r.usage);
                return (
                  <tr key={r.accountId} className={r.active ? "" : "opacity-60"}>
                    <td>{r.accountName}{!r.active && <Badge tone="neutral" className="ml-1">ปิดใช้</Badge>}</td>
                    <td>{r.kind || "-"}</td>
                    {multiEntity && <td className="text-xs">{r.entityIds.length ? r.entityIds.map(entName).join(", ") : "ทุกกิจการ"}</td>}
                    <td className="num">{fmt(r.openingBalance)}</td>
                    <td className="num">{r.balance == null ? "—" : fmt(r.balance)}</td>
                    <td className="text-xs text-muted">{usageText(r.usage)}</td>
                    <td className="whitespace-nowrap">
                      <button onClick={() => openEdit(r)} className="text-sm text-muted hover:underline">แก้ไข</button>
                      <button onClick={() => toggleActive(r)} disabled={pending} className="ml-2 text-sm text-muted hover:underline disabled:opacity-40">
                        {r.active ? "ปิดใช้" : "เปิดใช้"}
                      </button>
                      <button onClick={() => del(r)} disabled={pending || !!block} title={block ?? "ลบบัญชีนี้"} className="ml-2 text-sm text-crit hover:underline disabled:cursor-not-allowed disabled:text-faint disabled:no-underline">ลบ</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-faint">
            คงเหลือ = ยอดยกมา + เงินเข้า − เงินออก ถึงวันนี้ (ตัวเดียวกับแท็บ บัญชี &amp; เงินสด) ·
            บัญชีที่มีรายการแล้วลบไม่ได้ ให้กด ปิดใช้ แทน (ประวัติยังอยู่ครบ)
          </p>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/30 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setForm(null); }}>
          <EscToClose onClose={() => setForm(null)} />
          <div className="w-full max-w-md rounded-lg bg-card p-5">
            <h3 className="mb-3 font-semibold text-ink">{form.accountId ? "แก้ไขบัญชีเงิน" : "เพิ่มบัญชีเงิน"}</h3>
            <div className="space-y-3">
              <Field label="ชื่อบัญชี"><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="เช่น กสิกร ออมทรัพย์ 123-4" /></Field>
              {renaming && <p className="text-xs text-warn">⚠️ {renameWarnText(form.originalName, editing?.usage)}</p>}
              <Field label="ประเภท">
                <SuggestInput value={form.kind} onChange={(v) => setForm({ ...form, kind: v })} options={KIND_OPTIONS} placeholder="เลือกหรือพิมพ์เอง" listId="acct-settings-bank-kind" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="ยอดยกมา"><NumBox value={form.opening} blankZero onChange={(v) => setForm({ ...form, opening: v === "" ? 0 : v })} /></Field>
                <Field label="ยอดยกมา ณ วันที่ (ถ้ามี)"><TextInput type="date" value={form.openingDate} onChange={(e) => setForm({ ...form, openingDate: e.target.value })} /></Field>
              </div>
              {multiEntity ? (
                <div>
                  <span className="mb-1 block text-sm text-muted">กิจการที่ใช้บัญชีนี้ (ไม่ติ๊ก = ใช้ร่วมทุกกิจการ)</span>
                  <div className="flex flex-col gap-1">
                    {boot.entities.map((en) => (
                      <label key={en.entity_id} className="flex items-center gap-1.5 text-sm">
                        <input type="checkbox" checked={form.ents.includes(en.entity_id)} onChange={(e) => setForm({ ...form, ents: e.target.checked ? [...form.ents, en.entity_id] : form.ents.filter((x) => x !== en.entity_id) })} />
                        {en.name}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            {formErr && <p className="mt-2 text-sm text-crit">{formErr}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setForm(null)} className="rounded-lg border border-line px-4 py-2 text-sm">ยกเลิก</button>
              <SaveButton pending={pending} onClick={save}>บันทึก</SaveButton>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
