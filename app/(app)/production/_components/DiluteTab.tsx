"use client";

import { useEffect, useState } from "react";
import { diluteCalc } from "@/lib/production/calc";
import { getRemainingDistillVolAction, saveDiluteAction } from "../actions";
import { Card, Field, Msg, NumInput, SaveButton, Select, TextInput, todayISO, useSaver } from "./ui";
import type { Product } from "./types";

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

  const productNames = Array.from(new Set(products.map((p) => p.name)));

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
      },
    );
  }

  return (
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
  );
}
