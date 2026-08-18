"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { BoardTab } from "./BoardTab";
import { ExciseTab } from "./ExciseTab";
import { IconStill } from "@/lib/shared/icons";
import { PRODUCTION_TABS, labelFromSlug, slugFromLabel } from "@/lib/shared/tabs";
import { useTabUrl } from "../../_components/useTabUrl";

// ★ ลำดับ/ชื่อแท็บมาจากทะเบียนกลาง lib/shared/tabs — แถบเมนูด้านบนอ่านชุดเดียวกันไปทำดร็อปดาวน์
const TABS = PRODUCTION_TABS.map((t) => t.label);
type Tab = string;

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
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => labelFromSlug("production", sp.get("tab")) ?? "กระดาน batch");
  useTabUrl("production", tab, setTab, (l) => slugFromLabel("production", l));

  // mount แท็บครั้งเดียวแล้วคงไว้ (ซ่อนด้วย CSS) → สลับแท็บลื่น + คงสถานะ (เช่น หม้อกลั่นที่เลือก/ค่าที่กรอกค้าง)
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>([tab]));
  useEffect(() => { setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab))); }, [tab]);
  const show = (t: Tab) => (tab === t ? "" : "hidden");

  // batch ที่เลือก = state ร่วมของทั้ง workspace → เลือกครั้งเดียวใช้ได้ทุกแท็บ (APP_REVIEW A6)
  const [batch, setBatch] = useState("");
  function openBatch(b: string, target: string) {
    setBatch(b);
    if (TABS.includes(target)) setTab(target);
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <IconStill size={24} className="text-brand" />
        <h1 className="text-2xl font-bold text-ink">ผลิต</h1>
      </div>

      <div className="mb-5 -mx-4 flex gap-1 overflow-x-auto border-b border-line px-4">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`shrink-0 whitespace-nowrap rounded-t-lg px-4 py-2 text-sm font-medium transition ${
              tab === t
                ? "border-b-2 border-brand text-ink"
                : "text-faint hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {visited.has("กระดาน batch") && (
        <div className={show("กระดาน batch")}><BoardTab active={tab === "กระดาน batch"} onOpen={openBatch} /></div>
      )}
      {visited.has("วัตถุดิบ") && <div className={show("วัตถุดิบ")}><MaterialTab materials={materials} /></div>}
      {visited.has("ลงหมัก") && (
        <div className={show("ลงหมัก")}><FermentTab materials={materials} containers={containers} products={products} /></div>
      )}
      {visited.has("ติดตามหมัก") && <div className={show("ติดตามหมัก")}><MonitorTab pending={pending} batch={batch} onBatchChange={setBatch} /></div>}
      {visited.has("กลั่น") && <div className={show("กลั่น")}><DistillTab pending={pending} batch={batch} onBatchChange={setBatch} /></div>}
      {visited.has("ปรุง/ปรับดีกรี") && <div className={show("ปรุง/ปรับดีกรี")}><DiluteTab products={products} /></div>}
      {visited.has("บรรจุ/จ่าย") && <div className={show("บรรจุ/จ่าย")}><ProductTab products={products} /></div>}
      {visited.has("ประวัติ/เทียบ") && <div className={show("ประวัติ/เทียบ")}><HistoryTab products={products} /></div>}
      {visited.has("สต็อก") && <div className={show("สต็อก")}><StockTab stock={stock} /></div>}
      {visited.has("รายงานสรรพสามิต") && <div className={show("รายงานสรรพสามิต")}><ExciseTab active={tab === "รายงานสรรพสามิต"} /></div>}
      {visited.has("จัดการข้อมูล") && (
        <div className={show("จัดการข้อมูล")}><MasterTab materials={materials} containers={containers} products={products} /></div>
      )}
    </div>
  );
}
