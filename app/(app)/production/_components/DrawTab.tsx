"use client";

import { useEffect, useState } from "react";
import { diluteCalc, isFermented } from "@/lib/production/calc";
import {
  getRecentDrawsAction,
  getRemainingFermentedVolAction,
  saveDrawAction,
  updateDrawLogAction,
  deleteDrawLogAction,
} from "../actions";
import { Card, Field, MissingHint, Msg, NumInput, RowBtn, SaveButton, Select, TextInput, todayISO, useSaver } from "./ui";
import type { PendingBatch, Product } from "./types";
import { IconEdit, IconTrash } from "@/lib/shared/icons";

type RecentDraw = Awaited<ReturnType<typeof getRecentDrawsAction>>[number];
type EditFields = {
  date: string; productName: string; batch: string; vol: string; abv: string;
  adjustDate: string; water: string; finalVol: string; finalAbv: string; note: string;
};

/**
 * D78 — แท็บ "รินน้ำสุราแช่" (เส้นทางผลิตสุราแช่ · แทนแท็บกลั่น+ปรุงของสุรากลั่น)
 *
 * 1 ครั้งที่หมัก = 1 แถว (unique ที่ DB) เพราะฟอร์ม ภส. หักน้ำหมักของ batch นั้น **ทั้งก้อน**
 * ต่อ 1 แถว — รินซ้ำ = หักซ้ำ = เลขยื่นราชการผิด (กติกาเดียวกับ "ปิด batch" ของสุรากลั่น)
 *
 * ขั้นปรุง (เติมน้ำ/น้ำตาล/ปรับดีกรี) อยู่ในแถวเดียวกัน ไม่แยกเป็น log_dilute เพราะฟอร์มสุราแช่
 * ไม่มีคอลัมน์รองรับขั้นปรุง — ยอดที่ลงฟอร์มคือยอด **หลังปรุง** (พร้อมบรรจุ)
 */
export function DrawTab({
  products,
  pending,
  batch,
  onBatchChange,
}: {
  products: Product[];
  pending: PendingBatch[];
  batch: string;
  onBatchChange: (b: string) => void;
}) {
  const { pending: busy, msg, run } = useSaver();
  const [date, setDate] = useState(todayISO());
  const [productName, setProductName] = useState("");
  const [vol, setVol] = useState("");
  const [abv, setAbv] = useState("");
  const [adjust, setAdjust] = useState(false);
  const [adjustDate, setAdjustDate] = useState("");
  const [water, setWater] = useState("");
  const [finalVol, setFinalVol] = useState("");
  const [finalAbv, setFinalAbv] = useState("");
  const [note, setNote] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [recent, setRecent] = useState<RecentDraw[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState<EditFields>({
    date: "", productName: "", batch: "", vol: "", abv: "",
    adjustDate: "", water: "", finalVol: "", finalAbv: "", note: "",
  });

  // เฉพาะสินค้าประเภท "สุราแช่" — ห้ามให้เลือกสุรากลั่นมาลงที่นี่ (ฟอร์มคนละใบ)
  const fermentedNames = Array.from(new Set(products.filter((p) => isFermented(p.liquor_type)).map((p) => p.name)));
  // ครั้งที่หมักที่ยังไม่ได้ริน (pendingBatches ตัด batch ที่รินแล้วออกให้ที่ฝั่ง server)
  const batchOptions = pending.filter((b) => !productName || b.productName === productName);
  const picked = pending.find((b) => b.batch === batch);

  function loadRecent() { getRecentDrawsAction().then((r) => setRecent(r as RecentDraw[])); }
  function refreshRemaining() {
    if (!productName) { setRemaining(null); return; }
    getRemainingFermentedVolAction(productName).then(setRemaining);
  }
  useEffect(() => { loadRecent(); }, []);
  useEffect(() => {
    if (!productName) { setRemaining(null); return; }
    let alive = true;
    // 🚨 D89 — อ่านไม่ได้ = คืน null (ไม่รู้) ไม่ใช่ 0 ที่อ่านว่า "ของหมด"
    getRemainingFermentedVolAction(productName)
      .then((r) => { if (alive) setRemaining(r); })
      .catch(() => { if (alive) setRemaining(null); });
    return () => { alive = false; };
  }, [productName]);

  // เลือก batch แล้วเติมชื่อสุราให้ (batch เป็น state ร่วมของทั้ง workspace)
  useEffect(() => {
    if (!batch) return;
    const b = pending.find((x) => x.batch === batch);
    if (b && b.productName && b.productName !== productName) setProductName(b.productName);
  }, [batch, pending, productName]);

  /** ช่วยคำนวณขั้นปรุง 2 ทาง (C1·V1 = C2·V2) — ใช้ตัวเดียวกับแท็บปรุงของสุรากลั่น */
  function recalc(source: "v1" | "v2", next: { v1?: string; c1?: string; c2?: string; v2?: string }) {
    const nv1 = next.v1 ?? vol, nc1 = next.c1 ?? abv, nc2 = next.c2 ?? finalAbv, nv2 = next.v2 ?? finalVol;
    if (next.v1 !== undefined) setVol(next.v1);
    if (next.c1 !== undefined) setAbv(next.c1);
    if (next.c2 !== undefined) setFinalAbv(next.c2);
    if (next.v2 !== undefined) setFinalVol(next.v2);
    if (!adjust) return;
    const r = diluteCalc(source, {
      v1: parseFloat(nv1) || 0, c1: parseFloat(nc1) || 0,
      c2: parseFloat(nc2) || 0, v2: parseFloat(nv2) || 0,
    });
    if (source === "v1") setFinalVol(String(r.v2));
    else setVol(String(r.v1));
    setWater(String(r.water));
  }

  function submit() {
    if (!productName || !batch || !vol || !abv) return;
    const n = (v: string) => (v === "" ? null : parseFloat(v));
    run(
      () => saveDrawAction({
        date,
        productName,
        batch,
        vol: parseFloat(vol),
        abv: parseFloat(abv),
        adjustDate: adjust ? adjustDate || null : null,
        water: adjust ? n(water) : null,
        finalVol: adjust ? n(finalVol) : null,
        finalAbv: adjust ? n(finalAbv) : null,
        note,
      }),
      `บันทึกรินน้ำสุราแช่ ครั้งที่หมัก ${batch} เรียบร้อย`,
      () => {
        setVol(""); setAbv(""); setWater(""); setFinalVol(""); setFinalAbv(""); setNote(""); setAdjustDate("");
        onBatchChange("");
        refreshRemaining();
        loadRecent();
      },
    );
  }

  function del(r: RecentDraw) {
    if (!confirm(`ลบรายการรินน้ำสุราแช่ ครั้งที่หมัก ${r.batch} (${String(r.draw_date).slice(0, 10)})?\nน้ำหมักของ batch นี้จะกลับมาเป็นยอดคงเหลือ`)) return;
    run(() => deleteDrawLogAction(r.id as number), "ลบรายการเรียบร้อย", () => { loadRecent(); refreshRemaining(); });
  }
  function startEdit(r: RecentDraw) {
    const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
    setEditId(r.id as number);
    setEdit({
      date: String(r.draw_date).slice(0, 10),
      productName: (r.product_name as string) ?? "",
      batch: (r.batch as string) ?? "",
      vol: s(r.vol), abv: s(r.abv),
      adjustDate: r.adjust_date ? String(r.adjust_date).slice(0, 10) : "",
      water: s(r.water), finalVol: s(r.final_vol), finalAbv: s(r.final_abv),
      note: (r.note as string) ?? "",
    });
  }
  function saveEdit() {
    if (editId == null) return;
    const n = (v: string) => (v === "" ? null : parseFloat(v));
    run(
      () => updateDrawLogAction(editId, {
        date: edit.date, productName: edit.productName, batch: edit.batch,
        vol: n(edit.vol), abv: n(edit.abv), adjustDate: edit.adjustDate || null,
        water: n(edit.water), finalVol: n(edit.finalVol), finalAbv: n(edit.finalAbv),
        note: edit.note,
      }),
      "แก้ไขรายการเรียบร้อย",
      () => { setEditId(null); loadRecent(); refreshRemaining(); },
    );
  }

  if (fermentedNames.length === 0) {
    return (
      <Card title="รินน้ำสุราแช่">
        <p className="text-sm text-muted">
          ยังไม่มีสินค้าที่ตั้ง <b>ประเภทสุรา = สุราแช่</b> — ไปที่แท็บ <b>จัดการข้อมูล → สินค้า / สุรา</b>
          แล้วเลือกประเภทสุราให้สินค้าก่อน
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card title="รินน้ำสุราแช่ออกจากถังหมัก (1 ครั้งที่หมัก = 1 รายการ)">
        <Msg msg={msg} />
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {remaining !== null && (
            <span className="rounded-lg bg-raised px-3 py-1 text-sm text-muted">
              น้ำสุราแช่คงเหลือรอบรรจุ: <b>{remaining.toFixed(2)}</b> ล.
            </span>
          )}
          {picked && (
            <span className="rounded-lg bg-warn-bg px-3 py-1 text-sm text-warn">
              น้ำหมักของ {picked.batch} = <b>{picked.fermVol.toFixed(2)}</b> ล. — บันทึกแล้ว
              จะถูกหักออกจากยอดคงเหลือ<b>ทั้งก้อน</b>
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="วันที่ริน">
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="ชื่อสุรา (ประเภทสุราแช่)">
            <Select value={productName} onChange={(e) => { setProductName(e.target.value); onBatchChange(""); }}>
              <option value="">-- เลือกชื่อสุรา --</option>
              {fermentedNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
          <Field label="ครั้งที่หมัก (ที่ยังไม่ริน)">
            <Select value={batch} onChange={(e) => onBatchChange(e.target.value)}>
              <option value="">-- เลือกครั้งที่หมัก --</option>
              {batchOptions.map((b) => (
                <option key={b.batch} value={b.batch}>{b.batch} · น้ำหมัก {b.fermVol} ล.</option>
              ))}
            </Select>
          </Field>

          <Field label="ปริมาณน้ำสุราแช่ที่รินได้ (ล.)">
            <NumInput value={vol} onChange={(e) => recalc("v1", { v1: e.target.value })} />
          </Field>
          <Field label="ดีกรีตอนริน">
            <NumInput value={abv} onChange={(e) => recalc("v1", { c1: e.target.value })} />
          </Field>
          <Field label="หมายเหตุ">
            <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>

        <div className="mt-4 rounded-lg border border-line p-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={adjust} onChange={(e) => setAdjust(e.target.checked)} />
            ปรุง/ปรับดีกรีก่อนบรรจุ (เติมน้ำ/น้ำตาล) — <b>ยอดหลังปรุงคือยอดที่ลงฟอร์ม ภส.</b>
          </label>
          {adjust && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="ดีกรีหลังปรุง">
                <NumInput value={finalAbv} onChange={(e) => recalc("v1", { c2: e.target.value })} />
              </Field>
              <Field label="ปริมาณหลังปรุง (ล.)">
                <NumInput value={finalVol} onChange={(e) => recalc("v2", { v2: e.target.value })} />
              </Field>
              <Field label="น้ำ/ส่วนผสมที่เติม (ล.)">
                <NumInput value={water} onChange={(e) => setWater(e.target.value)} />
              </Field>
              <Field label="วันที่ปรุงเสร็จ (ว่าง = วันเดียวกัน)">
                <TextInput type="date" value={adjustDate} onChange={(e) => setAdjustDate(e.target.value)} />
              </Field>
            </div>
          )}
        </div>

        <div className="mt-4">
          <SaveButton pending={busy} onClick={submit} disabled={!productName || !batch || !vol || !abv}>
            บันทึกการริน
          </SaveButton>
          <MissingHint
            checks={[
              { label: "ชื่อสุรา", ok: !!productName },
              { label: "ครั้งที่หมัก", ok: !!batch },
              { label: "ปริมาณน้ำสุราแช่ที่รินได้", ok: !!vol },
              { label: "ดีกรีตอนริน", ok: !!abv },
            ]}
          />
        </div>
      </Card>

      <Card title="รายการล่าสุด (แก้ไข / ลบ ได้จากแอป)">
        {recent.length === 0 ? <p className="text-sm text-faint">— ยังไม่มีรายการ —</p> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>วันที่</th><th>ชื่อสุรา</th><th>ครั้งที่หมัก</th>
                  <th className="num">รินได้ (ล.)</th><th className="num">ดีกรี</th>
                  <th className="num">หลังปรุง (ล.)</th><th className="num">ดีกรีหลังปรุง</th>
                  <th>หมายเหตุ</th><th></th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  editId === (r.id as number) ? (
                    <tr key={r.id as number} className="editing">
                      <td>
                        <TextInput type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} className="w-36" />
                        <TextInput type="date" value={edit.adjustDate} onChange={(e) => setEdit({ ...edit, adjustDate: e.target.value })} className="mt-1 w-36" title="วันที่ปรุงเสร็จ" />
                      </td>
                      <td>
                        <Select value={edit.productName} onChange={(e) => setEdit({ ...edit, productName: e.target.value })} className="w-40">
                          {!fermentedNames.includes(edit.productName) && edit.productName && <option value={edit.productName}>{edit.productName}</option>}
                          {fermentedNames.map((n) => <option key={n} value={n}>{n}</option>)}
                        </Select>
                      </td>
                      <td><TextInput value={edit.batch} onChange={(e) => setEdit({ ...edit, batch: e.target.value })} className="w-20" /></td>
                      <td><NumInput value={edit.vol} onChange={(e) => setEdit({ ...edit, vol: e.target.value })} className="w-20 text-right" /></td>
                      <td><NumInput value={edit.abv} onChange={(e) => setEdit({ ...edit, abv: e.target.value })} className="w-16 text-right" /></td>
                      <td>
                        <NumInput value={edit.finalVol} onChange={(e) => setEdit({ ...edit, finalVol: e.target.value })} className="w-20 text-right" />
                        <NumInput value={edit.water} onChange={(e) => setEdit({ ...edit, water: e.target.value })} className="mt-1 w-20 text-right" placeholder="น้ำที่เติม" />
                      </td>
                      <td><NumInput value={edit.finalAbv} onChange={(e) => setEdit({ ...edit, finalAbv: e.target.value })} className="w-16 text-right" /></td>
                      <td><TextInput value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></td>
                      <td className="whitespace-nowrap">
                        <RowBtn tone="green" onClick={saveEdit} disabled={busy || !edit.productName || !edit.batch}>บันทึก</RowBtn>
                        <RowBtn onClick={() => setEditId(null)} className="ml-1">ยกเลิก</RowBtn>
                      </td>
                    </tr>
                  ) : (
                    <tr key={r.id as number}>
                      <td className="whitespace-nowrap">
                        {String(r.draw_date).slice(0, 10)}
                        {r.adjust_date && <span className="block text-xs text-faint">ปรุง {String(r.adjust_date).slice(0, 10)}</span>}
                      </td>
                      <td>{r.product_name as string}</td>
                      <td className="whitespace-nowrap">{r.batch as string}</td>
                      <td className="num">{(r.vol as number) ?? "—"}</td>
                      <td className="num">{(r.abv as number) ?? "—"}°</td>
                      <td className="num">{(r.final_vol as number) ?? "—"}</td>
                      <td className="num">{r.final_abv === null ? "—" : `${r.final_abv as number}°`}</td>
                      <td className="text-faint">{(r.note as string) ?? ""}</td>
                      <td className="whitespace-nowrap">
                        <button onClick={() => startEdit(r)} disabled={busy} className="text-muted hover:text-ink" title="แก้ไข"><IconEdit size={16} /></button>
                        <button onClick={() => del(r)} disabled={busy} className="ml-2 text-crit hover:text-crit" title="ลบ"><IconTrash size={16} /></button>
                      </td>
                    </tr>
                  )
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-faint">
              แสดง 30 รายการล่าสุด · ช่อง &quot;หลังปรุง&quot; ว่าง = ไม่ได้ปรุง (ฟอร์มจะใช้ยอดตอนริน)
              · แก้/ลบแล้วยอดคงเหลือทั้งน้ำหมักและน้ำสุราแช่ปรับให้อัตโนมัติ
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
