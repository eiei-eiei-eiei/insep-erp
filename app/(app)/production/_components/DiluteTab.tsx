"use client";

import { useEffect, useState } from "react";
import { diluteCalc } from "@/lib/production/calc";
import { getRemainingDistillVolAction, saveDiluteAction, getRecentDilutesAction, deleteDiluteLogAction, updateDiluteLogAction } from "../actions";
import { Card, Field, Msg, NumInput, RowBtn, SaveButton, Select, TextInput, todayISO, useSaver } from "./ui";
import type { Product } from "./types";

type RecentDilute = Awaited<ReturnType<typeof getRecentDilutesAction>>[number];
type EditFields = { date: string; productName: string; bottleSize: string; startVol: string; startAbv: string; water: string; finalVol: string; finalAbv: string; note: string };

export function DiluteTab({ products }: { products: Product[] }) {
  const { pending, msg, run } = useSaver();
  const [date, setDate] = useState(todayISO());
  const [productName, setProductName] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [calcMode, setCalcMode] = useState(true);
  const [bottleSize, setBottleSize] = useState("");
  const [note, setNote] = useState("");

  // ช่องคำนวณ
  const [v1, setV1] = useState(""); // ปริมาตรตั้งต้น
  const [c1, setC1] = useState(""); // ดีกรีตั้งต้น
  const [c2, setC2] = useState(""); // ดีกรีปลายทาง
  const [v2, setV2] = useState(""); // ปริมาตรปลายทาง
  const [water, setWater] = useState("");
  const [recent, setRecent] = useState<RecentDilute[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState<EditFields>({ date: "", productName: "", bottleSize: "", startVol: "", startAbv: "", water: "", finalVol: "", finalAbv: "", note: "" });

  const productNames = Array.from(new Set(products.map((p) => p.name)));

  function loadRecent() { getRecentDilutesAction().then((r) => setRecent(r as RecentDilute[])); }
  function refreshRemaining() { if (productName) getRemainingDistillVolAction(productName).then(setRemaining); }
  useEffect(() => { loadRecent(); }, []);
  function del(r: RecentDilute) {
    if (!confirm(`ลบรายการปรุง ${r.product_name} (${String(r.dilute_date).slice(0, 10)})?`)) return;
    run(() => deleteDiluteLogAction(r.id as number), "ลบรายการเรียบร้อย", () => { loadRecent(); refreshRemaining(); });
  }
  function startEdit(r: RecentDilute) {
    setEditId(r.id as number);
    const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
    setEdit({
      date: String(r.dilute_date).slice(0, 10),
      productName: (r.product_name as string) ?? "",
      bottleSize: (r.bottle_size as string) ?? "",
      startVol: s(r.start_vol), startAbv: s(r.start_abv), water: s(r.water),
      finalVol: s(r.final_vol), finalAbv: s(r.final_abv),
      note: (r.note as string) ?? "",
    });
  }
  function saveEdit() {
    if (editId == null) return;
    const n = (v: string) => (v === "" ? null : parseFloat(v));
    run(
      () => updateDiluteLogAction(editId, {
        date: edit.date, productName: edit.productName, bottleSize: edit.bottleSize,
        startVol: n(edit.startVol), startAbv: n(edit.startAbv), water: n(edit.water),
        finalVol: n(edit.finalVol), finalAbv: n(edit.finalAbv), note: edit.note,
      }),
      "แก้ไขรายการปรุงเรียบร้อย",
      () => { setEditId(null); loadRecent(); refreshRemaining(); },
    );
  }

  useEffect(() => {
    if (!productName) {
      setRemaining(null);
      return;
    }
    let active = true;
    getRemainingDistillVolAction(productName).then((r) => {
      if (active) setRemaining(r);
    });
    return () => {
      active = false;
    };
  }, [productName]);

  function recalc(source: "v1" | "v2", next: { v1?: string; c1?: string; c2?: string; v2?: string }) {
    const nv1 = next.v1 ?? v1, nc1 = next.c1 ?? c1, nc2 = next.c2 ?? c2, nv2 = next.v2 ?? v2;
    if (next.v1 !== undefined) setV1(next.v1);
    if (next.c1 !== undefined) setC1(next.c1);
    if (next.c2 !== undefined) setC2(next.c2);
    if (next.v2 !== undefined) setV2(next.v2);
    if (!calcMode) return;
    const r = diluteCalc(source, {
      v1: parseFloat(nv1) || 0,
      c1: parseFloat(nc1) || 0,
      c2: parseFloat(nc2) || 0,
      v2: parseFloat(nv2) || 0,
    });
    if (source === "v1") setV2(String(r.v2));
    else setV1(String(r.v1));
    setWater(String(r.water));
  }

  function submit() {
    if (!productName) return;
    run(
      () =>
        saveDiluteAction({
          date,
          productName,
          bottleSize: bottleSize || null,
          startVol: v1 ? parseFloat(v1) : null,
          startAbv: c1 ? parseFloat(c1) : null,
          water: water ? parseFloat(water) : null,
          finalVol: v2 ? parseFloat(v2) : null,
          finalAbv: c2 ? parseFloat(c2) : null,
          note,
        }),
      "บันทึกปรุง/ปรับดีกรีเรียบร้อย",
      () => {
        setV1(""); setC1(""); setC2(""); setV2(""); setWater(""); setNote("");
        if (productName) getRemainingDistillVolAction(productName).then(setRemaining);
        loadRecent();
      },
    );
  }

  return (
    <div className="space-y-5">
    <Card title="ปรุง / ปรับดีกรี (C1·V1 = C2·V2)">
      <Msg msg={msg} />
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={calcMode} onChange={(e) => setCalcMode(e.target.checked)} />
          ระบบช่วยคำนวณ 2 ทาง (กรอกปริมาตรตั้งต้นหรือปลายทาง อีกช่อง+น้ำจะคำนวณให้)
        </label>
        {remaining !== null && (
          <span className="rounded-lg bg-slate-100 px-3 py-1 text-sm text-slate-600">
            คงเหลือรอปรุง: <b>{remaining.toFixed(2)}</b> ล.
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="วันที่ปรุงแต่ง">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="ชื่อสุรา">
          <Select value={productName} onChange={(e) => setProductName(e.target.value)}>
            <option value="">-- เลือกชื่อสุรา --</option>
            {productNames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </Select>
        </Field>
        <Field label="ขนาดขวด">
          <TextInput value={bottleSize} onChange={(e) => setBottleSize(e.target.value)} />
        </Field>

        <Field label="ปริมาตรตั้งต้น V1 (ล.)">
          <NumInput value={v1} onChange={(e) => recalc("v1", { v1: e.target.value })} />
        </Field>
        <Field label="ดีกรีตั้งต้น C1 (%)">
          <NumInput value={c1} onChange={(e) => recalc("v1", { c1: e.target.value })} />
        </Field>
        <Field label="ดีกรีปลายทาง C2 (%)">
          <NumInput value={c2} onChange={(e) => recalc("v1", { c2: e.target.value })} />
        </Field>
        <Field label="ปริมาตรปลายทาง V2 (ล.)">
          <NumInput value={v2} onChange={(e) => recalc("v2", { v2: e.target.value })} />
        </Field>
        <Field label="น้ำที่เติม (ล.)">
          <NumInput value={water} readOnly={calcMode} onChange={(e) => setWater(e.target.value)} />
        </Field>
        <Field label="หมายเหตุ">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4">
        <SaveButton pending={pending} onClick={submit} disabled={!productName}>
          บันทึกปรุง
        </SaveButton>
      </div>
    </Card>

    <Card title="รายการล่าสุด (แก้ไข / ลบ ได้จากแอป)">
      {recent.length === 0 ? <p className="text-sm text-slate-400">— ยังไม่มีรายการ —</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500"><tr><th className="px-2 py-1">วันที่</th><th className="px-2 py-1">ชื่อสุรา</th><th className="px-2 py-1 text-right">V1→V2 (ล.)</th><th className="px-2 py-1 text-right">ดีกรี</th><th className="px-2 py-1">หมายเหตุ</th><th className="px-2 py-1"></th></tr></thead>
            <tbody>
              {recent.map((r) => (
                editId === (r.id as number) ? (
                  <tr key={r.id as number} className="border-b border-slate-100 bg-amber-50/50">
                    <td className="px-1 py-1"><TextInput type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} className="w-36" /></td>
                    <td className="px-1 py-1">
                      <Select value={edit.productName} onChange={(e) => setEdit({ ...edit, productName: e.target.value })} className="w-40">
                        {!productNames.includes(edit.productName) && edit.productName && <option value={edit.productName}>{edit.productName}</option>}
                        {productNames.map((n) => <option key={n} value={n}>{n}</option>)}
                      </Select>
                      <TextInput value={edit.bottleSize} onChange={(e) => setEdit({ ...edit, bottleSize: e.target.value })} className="mt-1 w-40" placeholder="ขนาดขวด" />
                    </td>
                    <td className="px-1 py-1"><div className="flex items-center gap-1"><NumInput value={edit.startVol} onChange={(e) => setEdit({ ...edit, startVol: e.target.value })} className="w-20 text-right" />→<NumInput value={edit.finalVol} onChange={(e) => setEdit({ ...edit, finalVol: e.target.value })} className="w-20 text-right" /></div><NumInput value={edit.water} onChange={(e) => setEdit({ ...edit, water: e.target.value })} className="mt-1 w-full text-right" placeholder="น้ำที่เติม" /></td>
                    <td className="px-1 py-1"><div className="flex items-center gap-1"><NumInput value={edit.startAbv} onChange={(e) => setEdit({ ...edit, startAbv: e.target.value })} className="w-16 text-right" />→<NumInput value={edit.finalAbv} onChange={(e) => setEdit({ ...edit, finalAbv: e.target.value })} className="w-16 text-right" /></div></td>
                    <td className="px-1 py-1"><TextInput value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></td>
                    <td className="whitespace-nowrap px-1 py-1">
                      <RowBtn tone="green" onClick={saveEdit} disabled={pending || !edit.productName}>บันทึก</RowBtn>
                      <RowBtn onClick={() => setEditId(null)} className="ml-1">ยกเลิก</RowBtn>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id as number} className="border-b border-slate-100">
                    <td className="whitespace-nowrap px-2 py-1">{String(r.dilute_date).slice(0, 10)}</td>
                    <td className="px-2 py-1">{r.product_name as string}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">{(r.start_vol as number) ?? "—"} → {(r.final_vol as number) ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">{(r.start_abv as number) ?? "—"}° → {(r.final_abv as number) ?? "—"}°</td>
                    <td className="px-2 py-1 text-slate-500">{(r.note as string) ?? ""}</td>
                    <td className="whitespace-nowrap px-2 py-1">
                      <button onClick={() => startEdit(r)} disabled={pending} className="text-slate-600 hover:text-slate-800" title="แก้ไข">✏️</button>
                      <button onClick={() => del(r)} disabled={pending} className="ml-2 text-red-500 hover:text-red-700" title="ลบ">🗑️</button>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-slate-400">แสดง 30 รายการล่าสุด · แก้/ลบแล้วปริมาณคงเหลือรอปรุงปรับให้อัตโนมัติ</p>
        </div>
      )}
    </Card>
    </div>
  );
}
