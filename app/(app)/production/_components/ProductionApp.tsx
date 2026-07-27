"use client";

import { useState } from "react";
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
  const [tab, setTab] = useState<(typeof TABS)[number]>("วัตถุดิบ");

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <span className="text-2xl">🏭</span>
        <h1 className="text-2xl font-bold text-slate-800">ผลิต</h1>
      </div>

      <div className="mb-5 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition ${
              tab === t
                ? "border-b-2 border-slate-800 text-slate-800"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "วัตถุดิบ" && <MaterialTab materials={materials} />}
      {tab === "ลงหมัก" && (
        <FermentTab materials={materials} containers={containers} products={products} />
      )}
      {tab === "ติดตามหมัก" && <MonitorTab pending={pending} />}
      {tab === "กลั่น" && <DistillTab pending={pending} />}
      {tab === "ปรุง/ปรับดีกรี" && <DiluteTab products={products} />}
      {tab === "บรรจุ/จ่าย" && <ProductTab products={products} />}
      {tab === "ประวัติ/เทียบ" && <HistoryTab products={products} />}
      {tab === "สต็อก" && <StockTab stock={stock} />}
      {tab === "จัดการข้อมูล" && (
        <MasterTab materials={materials} containers={containers} products={products} />
      )}
    </div>
  );
}
