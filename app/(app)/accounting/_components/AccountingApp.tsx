"use client";

import { useState } from "react";
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

export function AccountingApp({ boot }: { boot: Bootstrap }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("บันทึก");
  const [entityId, setEntityId] = useState(boot.entities[0]?.entity_id ?? "");
  const [month, setMonth] = useState(nowMonth());
  const readOnly = boot.role !== "main";
  const firstEntity = boot.entities[0]?.entity_id ?? "";
  const entryEntity = entityId === "ALL" ? firstEntity : entityId;

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
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" />
        </div>
      </div>

      {readOnly && <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">บทบาท <b>{boot.role}</b> — ดูได้อย่างเดียว (การบันทึก/แก้ไขต้องเป็น main)</div>}
      {boot.entities.length === 0 && <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">ยังไม่มีข้อมูลกิจการ (entities) — เพิ่มก่อนใช้งาน</div>}

      <div className="mb-5 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-t-lg px-4 py-2 text-sm font-medium transition ${tab === t ? "border-b-2 border-slate-800 text-slate-800" : "text-slate-500 hover:text-slate-700"}`}>{t}</button>
        ))}
      </div>

      {tab === "บันทึก" && <EntryTab boot={boot} entityId={entryEntity} />}
      {tab === "แดชบอร์ด" && <DashboardTab period={month} entityId={entityId} />}
      {tab === "บัญชี & เงินสด" && <AccountsTab boot={boot} period={month} entityId={entityId} />}
      {tab === "ลูกหนี้-เจ้าหนี้" && <ApArTab boot={boot} entityId={entityId} />}
      {tab === "ค้นบิล" && <BillsTab boot={boot} period={month} entityId={entityId} />}
      {tab === "แบ่งงวด" && <InstallmentsTab />}
      {tab === "ประวัติราคา" && <HistoryTab boot={boot} entityId={entityId} />}
      {tab === "เช็คราคา" && <PriceCheckTab boot={boot} entityId={entryEntity} />}
      {tab === "เอกสารสรรพากร" && <TaxDocsTab period={month} entityId={entityId} />}
      {tab === "ตั้งค่า" && <SettingsTab boot={boot} />}
    </div>
  );
}
