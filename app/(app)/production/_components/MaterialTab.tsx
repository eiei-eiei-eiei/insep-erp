"use client";

import { useEffect, useState } from "react";
import { saveMaterialAction, getRecentMaterialsAction, deleteMaterialLogAction, updateMaterialLogAction } from "../actions";
import { Card, Field, Msg, NumInput, RowBtn, SaveButton, Select, TextInput, todayISO, useSaver } from "./ui";
import { MATERIAL_TYPES, type Material } from "./types";
import { IconEdit, IconTrash } from "@/lib/shared/icons";

type RecentMaterial = Awaited<ReturnType<typeof getRecentMaterialsAction>>[number];
type EditFields = { date: string; transType: string; materialId: string; amount: string; docRef: string; note: string };

export function MaterialTab({ materials }: { materials: Material[] }) {
  const { pending, msg, run } = useSaver();
  const [date, setDate] = useState(todayISO());
  const [transType, setTransType] = useState<string>("รับ");
  const [materialId, setMaterialId] = useState("");
  const [amount, setAmount] = useState("");
  const [docRef, setDocRef] = useState("");
  const [note, setNote] = useState("");
  const [recent, setRecent] = useState<RecentMaterial[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState<EditFields>({ date: "", transType: "รับ", materialId: "", amount: "", docRef: "", note: "" });
  const matName = (id: string) => materials.find((m) => m.material_id === id)?.name ?? id;

  function loadRecent() { getRecentMaterialsAction().then((r) => setRecent(r as RecentMaterial[])); }
  useEffect(() => { loadRecent(); }, []);

  function submit() {
    if (!materialId || !amount) return;
    run(
      () =>
        saveMaterialAction({
          date,
          transType,
          materialId,
          amount: parseFloat(amount),
          docRef,
          note,
        }),
      "บันทึกวัตถุดิบเรียบร้อย",
      () => {
        setAmount("");
        setDocRef("");
        setNote("");
        loadRecent();
      },
    );
  }
  function del(r: RecentMaterial) {
    if (!confirm(`ลบรายการ ${matName(r.material_id as string)} (${r.trans_type} ${r.amount})?`)) return;
    run(() => deleteMaterialLogAction(r.id as number), "ลบรายการเรียบร้อย", loadRecent);
  }
  function startEdit(r: RecentMaterial) {
    setEditId(r.id as number);
    setEdit({
      date: String(r.doc_date).slice(0, 10),
      transType: (r.trans_type as string) ?? "รับ",
      materialId: (r.material_id as string) ?? "",
      amount: String(r.amount ?? ""),
      docRef: (r.doc_ref as string) ?? "",
      note: (r.note as string) ?? "",
    });
  }
  function saveEdit() {
    if (editId == null) return;
    run(
      () => updateMaterialLogAction(editId, {
        date: edit.date, transType: edit.transType, materialId: edit.materialId,
        amount: parseFloat(edit.amount) || 0, docRef: edit.docRef, note: edit.note,
      }),
      "แก้ไขรายการเรียบร้อย (สต็อกวัตถุดิบปรับให้แล้ว)",
      () => { setEditId(null); loadRecent(); },
    );
  }

  return (
    <div className="space-y-5">
    <Card title="บันทึกวัตถุดิบ (รับ/จ่าย)">
      <Msg msg={msg} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="วันที่">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="ประเภท">
          <Select value={transType} onChange={(e) => setTransType(e.target.value)}>
            {MATERIAL_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="วัตถุดิบ">
          <Select value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
            <option value="">-- เลือกวัตถุดิบ --</option>
            {materials.map((m) => (
              <option key={m.material_id} value={m.material_id}>
                {m.name} {m.unit ? `(${m.unit})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="จำนวน">
          <NumInput value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="หลักฐานเลขที่ (ถ้ามี)">
          <TextInput value={docRef} onChange={(e) => setDocRef(e.target.value)} />
        </Field>
        <Field label="หมายเหตุ">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4">
        <SaveButton pending={pending} onClick={submit} disabled={!materialId || !amount}>
          บันทึกวัตถุดิบ
        </SaveButton>
      </div>
    </Card>

    <Card title="รายการล่าสุด (แก้ไข / ลบ ได้จากแอป)">
      {recent.length === 0 ? <p className="text-sm text-faint">— ยังไม่มีรายการ —</p> : (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>วันที่</th><th>ประเภท</th><th>วัตถุดิบ</th><th className="num">จำนวน</th><th>หลักฐาน/หมายเหตุ</th><th></th></tr></thead>
            <tbody>
              {recent.map((r) => (
                editId === (r.id as number) ? (
                  <tr key={r.id as number} className="editing">
                    <td><TextInput type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} className="w-36" /></td>
                    <td><Select value={edit.transType} onChange={(e) => setEdit({ ...edit, transType: e.target.value })} className="w-28">{MATERIAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></td>
                    <td><Select value={edit.materialId} onChange={(e) => setEdit({ ...edit, materialId: e.target.value })} className="w-44">{materials.map((m) => <option key={m.material_id} value={m.material_id}>{m.name}</option>)}</Select></td>
                    <td><NumInput value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} className="w-24 text-right" /></td>
                    <td><div className="flex gap-1"><TextInput value={edit.docRef} onChange={(e) => setEdit({ ...edit, docRef: e.target.value })} className="w-28" placeholder="หลักฐาน" /><TextInput value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} placeholder="หมายเหตุ" /></div></td>
                    <td className="whitespace-nowrap">
                      <RowBtn tone="green" onClick={saveEdit} disabled={pending || !edit.materialId}>บันทึก</RowBtn>
                      <RowBtn onClick={() => setEditId(null)} className="ml-1">ยกเลิก</RowBtn>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id as number}>
                    <td className="whitespace-nowrap">{String(r.doc_date).slice(0, 10)}</td>
                    <td>{r.trans_type as string}</td>
                    <td>{matName(r.material_id as string)}</td>
                    <td className="num">{r.amount as number}</td>
                    <td className="text-faint">{[r.doc_ref, r.note].filter(Boolean).join(" · ")}</td>
                    <td className="whitespace-nowrap">
                      <button onClick={() => startEdit(r)} disabled={pending} className="text-muted hover:text-ink" title="แก้ไข"><IconEdit size={16} /></button>
                      <button onClick={() => del(r)} disabled={pending} className="ml-2 text-crit hover:text-crit" title="ลบ"><IconTrash size={16} /></button>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-faint">แสดง 30 รายการล่าสุด · แก้/ลบแล้วสต็อกวัตถุดิบปรับให้อัตโนมัติ</p>
        </div>
      )}
    </Card>
    </div>
  );
}
