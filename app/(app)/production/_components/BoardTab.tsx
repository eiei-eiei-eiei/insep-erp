"use client";

import { useCallback, useEffect, useState } from "react";
import { getBatchBoardAction } from "../actions";
import type { BatchCard } from "../data";
import { Card, TextInput } from "./ui";
import { IconCheck, IconFlame, IconFlask, IconRefresh } from "@/lib/shared/icons";

const STAGE_STYLE: Record<BatchCard["stage"], string> = {
  "ลงหมัก": "bg-raised text-muted",
  "ติดตามหมัก": "bg-brand-soft text-brand",
  "กำลังกลั่น": "bg-warn-bg text-warn",
  "ปิด batch แล้ว": "bg-ok-bg text-ok",
};

/** ขั้นถัดไปที่ควรทำ → ปุ่มกระโดดไปแท็บที่ถูกต้อง (พร้อมเลือก batch ให้เลย) */
const NEXT_STEP: Record<BatchCard["stage"], { label: string; tab: string }> = {
  "ลงหมัก": { label: "บันทึกค่าติดตามหมัก", tab: "ติดตามหมัก" },
  "ติดตามหมัก": { label: "บันทึกค่าติดตามหมัก", tab: "ติดตามหมัก" },
  "กำลังกลั่น": { label: "ไปหน้ากลั่น (ต่อจากเดิม)", tab: "กลั่น" },
  "ปิด batch แล้ว": { label: "ดูประวัติ/เทียบ", tab: "ประวัติ/เทียบ" },
};

export function BoardTab({
  active,
  onOpen,
}: {
  active: boolean;
  onOpen: (batch: string, tab: string) => void;
}) {
  const [rows, setRows] = useState<BatchCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [showClosed, setShowClosed] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    getBatchBoardAction().then((r) => { setRows(r); setLoading(false); });
  }, []);
  useEffect(() => { if (active) load(); }, [active, load]);

  const filtered = rows
    .filter((r) => (showClosed ? true : r.stage !== "ปิด batch แล้ว"))
    .filter((r) => (!q ? true : (r.batch + " " + r.productName).toLowerCase().includes(q.toLowerCase())));

  return (
    <Card title="กระดาน batch — ทุก batch อยู่ขั้นไหน ทำอะไรต่อ">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <TextInput placeholder="batch / ชื่อสุรา" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          แสดง batch ที่ปิดแล้วด้วย
        </label>
        <button onClick={load} className="min-h-[44px] rounded border border-line px-3 text-sm text-muted hover:bg-raised sm:min-h-0 sm:py-1.5"><IconRefresh size={15} className="mr-1 inline align-[-2px]" />รีโหลด</button>
        <span className="ml-auto text-xs text-faint">{filtered.length} batch</span>
      </div>

      {loading ? (
        <p className="py-8 text-center text-faint">กำลังโหลด…</p>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-faint">— ยังไม่มี batch —</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((b) => {
            const next = NEXT_STEP[b.stage];
            return (
              <div key={b.batch} className="rounded-lg border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-ink">Batch {b.batch}</div>
                    <div className="truncate text-sm text-muted">{b.productName}</div>
                    <div className="text-xs text-faint">ลงหมัก {b.fermentDate}{b.tanks > 0 ? ` · ${b.tanks} ถัง` : ""}{b.fermVol > 0 ? ` · ${b.fermVol} (วัตถุดิบหลัก)` : ""}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STAGE_STYLE[b.stage]}`}>{b.stage}</span>
                </div>

                <div className="mt-2 space-y-0.5 text-xs text-muted">
                  <div>
                    <IconFlask size={13} className="mr-1 inline align-[-2px]" />ค่าวัดหมัก {b.monitorCount} ครั้ง
                    {b.lastMeasure && (
                      <span className="text-faint">
                        {" "}· ล่าสุด {b.lastMeasure.date}
                        {b.lastMeasure.brix !== null && ` · Brix ${b.lastMeasure.brix}`}
                        {b.lastMeasure.ph !== null && ` · pH ${b.lastMeasure.ph}`}
                      </span>
                    )}
                  </div>
                  <div>
                    <IconFlame size={13} className="mr-1 inline align-[-2px]" />กลั่น {b.pots > 0 ? `${b.pots} หม้อ` : "ยังไม่เริ่ม"}
                    {b.activePot !== null && <span className="font-medium text-warn"> · หม้อที่ {b.activePot} ยังไม่จบ</span>}
                  </div>
                  {b.closed && <div className="text-ok"><IconCheck size={13} className="mr-1 inline align-[-2px]" />ปิด batch {b.closed.date} · {b.closed.vol} ล. @ {b.closed.abv}°</div>}
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button
                    onClick={() => onOpen(b.batch, next.tab)}
                    className="min-h-[44px] flex-1 rounded-lg bg-brand px-3 text-sm font-medium text-on-brand hover:opacity-90 sm:min-h-0 sm:py-2"
                  >
                    {next.label}
                  </button>
                  {!b.closed && b.stage !== "ลงหมัก" && (
                    <button
                      onClick={() => onOpen(b.batch, b.stage === "กำลังกลั่น" ? "ติดตามหมัก" : "กลั่น")}
                      className="min-h-[44px] rounded-lg border border-line px-3 text-sm text-muted hover:bg-raised sm:min-h-0 sm:py-2"
                    >
                      {b.stage === "กำลังกลั่น" ? "ค่าหมัก" : "ไปกลั่น"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-xs text-faint">กดปุ่มในการ์ด = เปลี่ยนแท็บพร้อมเลือก batch นี้ให้อัตโนมัติ (ไม่ต้องเลือกซ้ำในแต่ละแท็บ)</p>
    </Card>
  );
}
