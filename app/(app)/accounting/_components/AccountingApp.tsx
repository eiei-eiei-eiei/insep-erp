"use client";

import { useEffect, useState } from "react";
import type { Bootstrap } from "./types";
import { nowMonth } from "./ui";
import { EntryTab } from "./EntryTab";
import { DashboardTab } from "./DashboardTab";
import { AccountsTab } from "./AccountsTab";
import { ApArTab } from "./ApArTab";
import { BillsTab } from "./BillsTab";
import { HistoryTab } from "./HistoryTab";
import { PriceCheckTab } from "./PriceCheckTab";
import { InstallmentsTab } from "./InstallmentsTab";
import { TaxDocsTab } from "./TaxDocsTab";
import { SettingsTab } from "./SettingsTab";

const TABS = [
  "บันทึก",
  "แดชบอร์ด",
  "บัญชี & เงินสด",
  "ลูกหนี้-เจ้าหนี้",
  "ค้นบิล",
  "แบ่งงวด",
  "ประวัติราคา",
  "เช็คราคา",
  "เอกสารสรรพากร",
  "ตั้งค่า",
] as const;

type Tab = (typeof TABS)[number];

/** เลื่อนเดือน YYYY-MM ไป ±delta เดือน (ข้ามปีถูกต้อง) */
function shiftMonth(m: string, delta: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function AccountingApp({ boot }: { boot: Bootstrap }) {
  const [tab, setTab] = useState<Tab>("บันทึก");
  const [entityId, setEntityId] = useState(boot.entities[0]?.entity_id ?? "");
  const [month, setMonth] = useState(nowMonth());
  const readOnly = boot.role !== "main";
  const firstEntity = boot.entities[0]?.entity_id ?? "";
  const entryEntity = entityId === "ALL" ? firstEntity : entityId;

  // เก็บแท็บที่เคยเปิดไว้ (mount ครั้งเดียว แล้วคงไว้ ซ่อนด้วย CSS) → สลับแท็บลื่น ไม่ refetch ซ้ำ
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>(["บันทึก"]));
  useEffect(() => { setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab))); }, [tab]);
  const show = (t: Tab) => (tab === t ? "" : "hidden");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-2xl">📒</span>
        <h1 className="text-2xl font-bold text-slate-800">บัญชี</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2">
            <option value="ALL">ทุกกิจการ</option>
            {boot.entities.map((en) => (<option key={en.entity_id} value={en.entity_id}>{en.entity_id} — {en.name}</option>))}
          </select>
          <div className="flex items-center gap-1">
            <button onClick={() => setMonth(shiftMonth(month, -1))} title="เดือนก่อน" className="rounded-lg border border-slate-300 px-2.5 py-2 text-slate-600 hover:bg-slate-50">‹</button>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" />
            <button onClick={() => setMonth(shiftMonth(month, 1))} title="เดือนถัดไป" className="rounded-lg border border-slate-300 px-2.5 py-2 text-slate-600 hover:bg-slate-50">›</button>
          </div>
        </div>
      </div>

      {readOnly && <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">บทบาท <b>{boot.role}</b> — ดูได้อย่างเดียว (การบันทึก/แก้ไขต้องเป็น main)</div>}
      {boot.entities.length === 0 && <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">ยังไม่มีข้อมูลกิจการ (entities) — เพิ่มก่อนใช้งาน</div>}

      <div className="mb-5 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-t-lg px-4 py-2 text-sm font-medium transition ${tab === t ? "border-b-2 border-slate-800 text-slate-800" : "text-slate-500 hover:text-slate-700"}`}>{t}</button>
        ))}
      </div>

      {visited.has("บันทึก") && <div className={show("บันทึก")}><EntryTab boot={boot} entityId={entryEntity} ambiguous={entityId === "ALL"} /></div>}
      {visited.has("แดชบอร์ด") && <div className={show("แดชบอร์ด")}><DashboardTab period={month} entityId={entityId} active={tab === "แดชบอร์ด"} /></div>}
      {visited.has("บัญชี & เงินสด") && <div className={show("บัญชี & เงินสด")}><AccountsTab boot={boot} period={month} entityId={entityId} active={tab === "บัญชี & เงินสด"} /></div>}
      {visited.has("ลูกหนี้-เจ้าหนี้") && <div className={show("ลูกหนี้-เจ้าหนี้")}><ApArTab boot={boot} entityId={entityId} active={tab === "ลูกหนี้-เจ้าหนี้"} /></div>}
      {visited.has("ค้นบิล") && <div className={show("ค้นบิล")}><BillsTab boot={boot} period={month} entityId={entityId} active={tab === "ค้นบิล"} /></div>}
      {visited.has("แบ่งงวด") && <div className={show("แบ่งงวด")}><InstallmentsTab /></div>}
      {visited.has("ประวัติราคา") && <div className={show("ประวัติราคา")}><HistoryTab boot={boot} entityId={entityId} /></div>}
      {visited.has("เช็คราคา") && <div className={show("เช็คราคา")}><PriceCheckTab boot={boot} entityId={entryEntity} /></div>}
      {visited.has("เอกสารสรรพากร") && <div className={show("เอกสารสรรพากร")}><TaxDocsTab period={month} entityId={entityId} active={tab === "เอกสารสรรพากร"} /></div>}
      {visited.has("ตั้งค่า") && <div className={show("ตั้งค่า")}><SettingsTab boot={boot} /></div>}
    </div>
  );
}
