"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fermentSummary,
  fermentSeriesPoints,
  distillSummary,
  globalCum,
  groupPots,
  equivVol,
  type FermentRead,
  type DistillRead,
} from "@/lib/production/history";
import {
  getHistoryBatchesAction,
  getFermentMultiAction,
  getDistillMultiAction,
} from "../actions";
import { XYChart, type XYSeries } from "./XYChart";
import { Card } from "./ui";
import { CHART_COLORS } from "@/lib/shared/chart";
import type { Product } from "./types";

const PAL = CHART_COLORS; // ชุดสีกราฟตาม token (เปลี่ยนตามโหมดสว่าง/มืด)
const fmt = (v: number, d = 1) => (v == null || isNaN(v) ? "—" : v.toFixed(d));

type BatchInfo = { batch: string; startDate: string | null; productName: string };

function BatchPicker({ list, sel, onToggle }: { list: BatchInfo[]; sel: string[]; onToggle: (b: string) => void }) {
  if (list.length === 0) return <p className="text-sm text-faint">ยังไม่มี batch</p>;
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((b) => (
        <button
          key={b.batch}
          onClick={() => onToggle(b.batch)}
          className={`rounded-lg border px-2.5 py-1 text-sm ${sel.includes(b.batch) ? "border-brand bg-brand text-on-brand" : "border-line text-muted hover:bg-raised"}`}
        >
          {b.batch} <span className="text-xs opacity-70">({b.productName})</span>
        </button>
      ))}
    </div>
  );
}

export function HistoryTab({ products }: { products: Product[] }) {
  const [lists, setLists] = useState<{ ferment: BatchInfo[]; distill: BatchInfo[] }>({ ferment: [], distill: [] });
  const degreeMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of products) if (p.name && p.degree != null) m[p.name] = Number(p.degree);
    return m;
  }, [products]);

  useEffect(() => { getHistoryBatchesAction().then(setLists); }, []);

  return (
    <div className="space-y-6">
      <FermentCompare list={lists.ferment} />
      <DistillCompare list={lists.distill} degreeMap={degreeMap} />
    </div>
  );
}

// ── เทียบการหมัก ────────────────────────────────────────────────────────────────
function FermentCompare({ list }: { list: BatchInfo[] }) {
  const [sel, setSel] = useState<string[]>([]);
  const [data, setData] = useState<Record<string, FermentRead[]>>({});
  const startMap = useMemo(() => Object.fromEntries(list.map((b) => [b.batch, b.startDate])), [list]);

  useEffect(() => {
    if (sel.length === 0) { setData({}); return; }
    getFermentMultiAction(sel).then((d) => setData(d as Record<string, FermentRead[]>));
  }, [sel]);

  const toggle = (b: string) => setSel((s) => (s.includes(b) ? s.filter((x) => x !== b) : [...s, b]));

  const chart = (metric: "brix" | "ph" | "temp"): XYSeries[] =>
    sel.map((b, i) => ({
      name: b,
      color: PAL[i % PAL.length],
      points: fermentSeriesPoints(data[b] ?? [], startMap[b] ?? null, metric),
    }));

  const hasData = sel.some((b) => (data[b] ?? []).length);

  return (
    <Card title="เทียบการหมัก (Brix / pH / อุณหภูมิ) — วันจากเริ่มหมัก">
      <BatchPicker list={list} sel={sel} onToggle={toggle} />
      {sel.length === 0 ? (
        <p className="mt-3 text-sm text-faint">เลือก batch (คลิกได้หลายอัน) เพื่อเทียบกราฟ</p>
      ) : !hasData ? (
        <p className="mt-3 text-sm text-faint">batch ที่เลือกยังไม่มีค่าวัด</p>
      ) : (
        <div className="mt-4 space-y-5">
          <div><p className="mb-1 text-sm font-medium text-muted">Brix (°Bx)</p><XYChart series={chart("brix")} xLabel="วันจากเริ่มหมัก" /></div>
          <div><p className="mb-1 text-sm font-medium text-muted">pH</p><XYChart series={chart("ph")} xLabel="วันจากเริ่มหมัก" /></div>
          <div><p className="mb-1 text-sm font-medium text-muted">อุณหภูมิ (°C)</p><XYChart series={chart("temp")} xLabel="วันจากเริ่มหมัก" /></div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-faint">
                <tr><th className="px-2 py-1">Batch</th><th className="px-2 py-1 text-right">วันหมัก</th><th className="px-2 py-1 text-right">Brix เริ่ม→จบ</th><th className="px-2 py-1 text-right">Atten%</th><th className="px-2 py-1 text-right">~ดีกรี</th><th className="px-2 py-1 text-right">pH เริ่ม→จบ</th><th className="px-2 py-1 text-right">Temp พีค</th></tr>
              </thead>
              <tbody>
                {sel.filter((b) => (data[b] ?? []).length).map((b) => {
                  const s = fermentSummary(data[b] ?? [], startMap[b] ?? null);
                  return (
                    <tr key={b} className="border-b border-line-soft">
                      <td className="px-2 py-1 font-medium">{b}</td>
                      <td className="px-2 py-1 text-right">{fmt(s.days)}</td>
                      <td className="px-2 py-1 text-right">{fmt(s.firstBrix)}→{fmt(s.lastBrix)}</td>
                      <td className="px-2 py-1 text-right">{fmt(s.atten)}%</td>
                      <td className="px-2 py-1 text-right">~{fmt(s.estAbv)}</td>
                      <td className="px-2 py-1 text-right">{fmt(s.firstPh, 2)}→{fmt(s.lastPh, 2)}</td>
                      <td className="px-2 py-1 text-right">{fmt(s.tempPeak)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-faint">~ดีกรีน้ำส่าประมาณจาก Brix (apparent) ไม่ใช่ค่าทางการ</p>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── เทียบการกลั่น ────────────────────────────────────────────────────────────────
const D_METRICS: { key: "abv20" | "vapor_temp" | "cum_vol"; label: string }[] = [
  { key: "abv20", label: "ดีกรี@20" },
  { key: "vapor_temp", label: "อุณหภูมิไอ" },
  { key: "cum_vol", label: "ปริมาณสะสม" },
];

function DistillCompare({ list, degreeMap }: { list: BatchInfo[]; degreeMap: Record<string, number> }) {
  const [sel, setSel] = useState<string[]>([]);
  const [data, setData] = useState<Record<string, DistillRead[]>>({});
  const [final, setFinal] = useState<Record<string, { vol: number; abv: number }>>({});
  const [metric, setMetric] = useState<"abv20" | "vapor_temp" | "cum_vol">("abv20");
  const [xaxis, setXaxis] = useState<"minute" | "cum">("minute");
  const nameMap = useMemo(() => Object.fromEntries(list.map((b) => [b.batch, b.productName])), [list]);

  useEffect(() => {
    if (sel.length === 0) { setData({}); setFinal({}); return; }
    getDistillMultiAction(sel).then((res) => {
      setData(res.data as Record<string, DistillRead[]>);
      setFinal(res.final as Record<string, { vol: number; abv: number }>);
    });
  }, [sel]);

  const toggle = (b: string) => setSel((s) => (s.includes(b) ? s.filter((x) => x !== b) : [...s, b]));

  const series: XYSeries[] = useMemo(() => {
    const out: XYSeries[] = [];
    let ci = 0;
    for (const b of sel) {
      const pots = groupPots(data[b] ?? []);
      for (const potNo of Object.keys(pots).map(Number).sort((a, z) => a - z)) {
        let points: { x: number; y: number | null }[];
        if (xaxis === "cum") {
          points = globalCum(pots[potNo]).map((r) => ({ x: r.globalCum, y: r[metric] as number | null })).filter((p) => !isNaN(p.x));
        } else {
          points = pots[potNo]
            .slice()
            .sort((a, z) => (Number(a.minute) || 0) - (Number(z.minute) || 0))
            .map((r) => ({ x: Number(r.minute), y: r[metric] as number | null }))
            .filter((p) => !isNaN(p.x));
        }
        if (points.length) { out.push({ name: `${b}·หม้อ${potNo}`, color: PAL[ci % PAL.length], points }); ci++; }
      }
    }
    return out;
  }, [sel, data, metric, xaxis]);

  const hasData = series.length > 0;

  return (
    <Card title="เทียบการกลั่น (overlay ต่อหม้อ) + สรุปหัวใจ/Yield">
      <BatchPicker list={list} sel={sel} onToggle={toggle} />
      {sel.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <label>ค่าที่ดู:{" "}
            <select value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)} className="rounded border border-line px-2 py-1">
              {D_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
          <label>แกนนอน:{" "}
            <select value={xaxis} onChange={(e) => setXaxis(e.target.value as typeof xaxis)} className="rounded border border-line px-2 py-1">
              <option value="minute">นาทีที่</option>
              <option value="cum">ปริมาณสะสม</option>
            </select>
          </label>
        </div>
      )}
      {sel.length === 0 ? (
        <p className="mt-3 text-sm text-faint">เลือก batch (หลายอันได้) เพื่อเทียบเส้นโค้งการกลั่น</p>
      ) : !hasData ? (
        <p className="mt-3 text-sm text-faint">batch ที่เลือกยังไม่มีข้อมูลการกลั่น</p>
      ) : (
        <div className="mt-4 space-y-4">
          <XYChart series={series} xLabel={xaxis === "cum" ? "ปริมาณสะสม (ล.)" : "นาทีที่"} height={300} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-faint">
                <tr><th className="px-2 py-1">Batch</th><th className="px-2 py-1 text-right">หม้อ</th><th className="px-2 py-1 text-right">หัวใจ(ล.)</th><th className="px-2 py-1 text-right">ดีกรี@20</th><th className="px-2 py-1 text-right">เป้าหมาย°</th><th className="px-2 py-1 text-right">ปริมาณ@เป้า(ล.)</th><th className="px-2 py-1 text-right">Yield</th></tr>
              </thead>
              <tbody>
                {sel.filter((b) => (data[b] ?? []).length).map((b) => {
                  const s = distillSummary(data[b] ?? []);
                  const useLog = !!(final[b] && final[b].vol > 0);
                  const vol = useLog ? final[b].vol : s.totalVol;
                  const abv = useLog ? final[b].abv : s.abv;
                  const target = degreeMap[nameMap[b] ?? ""] ?? NaN;
                  const eq = equivVol(vol, abv, target);
                  const yld = !isNaN(eq) && s.charge > 0 ? (eq / s.charge) * 100 : NaN;
                  return (
                    <tr key={b} className="border-b border-line-soft">
                      <td className="px-2 py-1 font-medium">{b}</td>
                      <td className="px-2 py-1 text-right">{s.potCount}</td>
                      <td className="px-2 py-1 text-right">{fmt(vol, 2)}</td>
                      <td className="px-2 py-1 text-right">{fmt(abv)}%</td>
                      <td className="px-2 py-1 text-right">{isNaN(target) ? "—" : fmt(target, 0) + "°"}</td>
                      <td className="px-2 py-1 text-right">{isNaN(eq) ? "—" : fmt(eq, 2)}</td>
                      <td className="px-2 py-1 text-right">{isNaN(yld) ? "—" : fmt(yld) + "%"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-faint">หัวใจ = ค่าจริงจาก log_distill ถ้าปิด batch แล้ว · Yield = ปริมาณ@ดีกรีเป้าหมาย ÷ น้ำหมักที่กลั่น</p>
          </div>
        </div>
      )}
    </Card>
  );
}
