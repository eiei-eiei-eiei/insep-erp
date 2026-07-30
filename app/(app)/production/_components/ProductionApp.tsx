"use client";

import { useEffect, useState } from "react";
import type { Container, Material, PendingBatch, Product, StockRow } from "./types";
import { MaterialTab } from "./MaterialTab";
import { FermentTab } from "./FermentTab";
import { MonitorTab } from "./MonitorTab";
import { DistillTab } from "./DistillTab";
import { DiluteTab } from "./DiluteTab";
import { ProductTab } from "./ProductTab";
import { StockTab } from "./StockTab";
import { MasterTab } from "./MasterTab";
import { HistoryTab } from "./HistoryTab";

const TABS = [
  "วัตถุดิบ",
  "ลงหมัก",
  "ติดตามหมัก",
  "กลั่น",
  "ปรุง/ปรับดีกรี",
  "บรรจุ/จ่าย",
  "ประวัติ/เทียบ",
  "สต็อก",
  "จัดการข้อมูล",
] as const;
type Tab = (typeof TABS)[number];

export function ProductionApp({
  materials,
  containers,
  products,
  pending,
  stock,
}: {
  materials: Material[];
  containers: Container[];
  products: Product[];
  pending: PendingBatch[];
  stock: StockRow[];
}) {
  const [tab, setTab] = useState<Tab>("วัตถุดิบ");

  // mount แท็บครั้งเดียวแล้วคงไว้ (ซ่อนด้วย CSS) → สลับแท็บลื่น + คงสถานะ (เช่น หม้อกลั่นที่เลือก/ค่าที่กรอกค้าง)
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>(["วัตถุดิบ"]));
  useEffect(() => { setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab))); }, [tab]);
  const show = (t: Tab) => (tab === t ? "" : "hidden");

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <span className="text-2xl">🏭</span>
        <h1 className="text-2xl font-bold text-slate-800">ผลิต</h1>
      </div>

      <div className="mb-5 -mx-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-4">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`shrink-0 whitespace-nowrap rounded-t-lg px-4 py-2 text-sm font-medium transition ${
              tab === t
                ? "border-b-2 border-slate-800 text-slate-800"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {visited.has("วัตถุดิบ") && <div className={show("วัตถุดิบ")}><MaterialTab materials={materials} /></div>}
      {visited.has("ลงหมัก") && (
        <div className={show("ลงหมัก")}><FermentTab materials={materials} containers={containers} products={products} /></div>
      )}
      {visited.has("ติดตามหมัก") && <div className={show("ติดตามหมัก")}><MonitorTab pending={pending} /></div>}
      {visited.has("กลั่น") && <div className={show("กลั่น")}><DistillTab pending={pending} /></div>}
      {visited.has("ปรุง/ปรับดีกรี") && <div className={show("ปรุง/ปรับดีกรี")}><DiluteTab products={products} /></div>}
      {visited.has("บรรจุ/จ่าย") && <div className={show("บรรจุ/จ่าย")}><ProductTab products={products} /></div>}
      {visited.has("ประวัติ/เทียบ") && <div className={show("ประวัติ/เทียบ")}><HistoryTab products={products} /></div>}
      {visited.has("สต็อก") && <div className={show("สต็อก")}><StockTab stock={stock} /></div>}
      {visited.has("จัดการข้อมูล") && (
        <div className={show("จัดการข้อมูล")}><MasterTab materials={materials} containers={containers} products={products} /></div>
      )}
    </div>
  );
}
