"use client";

import { useEffect, useRef, useState } from "react";
import type { SyncRow } from "./types";
import { Card } from "./ui";
import { getSyncHistoryAction } from "../actions";

const ACTION_LABEL: Record<string, string> = {
  SELL_PRODUCT: "ขาย → ผลิต (ตัดสต็อกสุรา)",
  RECEIVE_REVENUE: "ขาย → บัญชี (รายรับ)",
};

export function SyncHistoryTab({ active }: { active: boolean }) {
  const [rows, setRows] = useState<SyncRow[]>([]);
  const [loading, setLoading] = useState(true);
  const firstLoad = useRef(true);

  function refresh() {
    if (firstLoad.current) setLoading(true);
    getSyncHistoryAction().then((d) => {
      setRows(d);
      setLoading(false);
      firstLoad.current = false;
    });
  }
  useEffect(() => {
    if (active) refresh();
  }, [active]);

  return (
    <Card title="🔁 ประวัติเชื่อมระบบ (แทนหน้าคิว sync เดิม)">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={refresh} className="rounded border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
          🔄 รีเฟรช
        </button>
        <span className="text-xs text-slate-500">
          การรับเงิน/จัดส่ง = ลงบัญชี/ตัดสต็อกทันทีใน DB เดียวกัน (ไม่มีคิวให้ยิงเองอีก) — หน้านี้ไว้ตรวจย้อนหลัง
        </span>
      </div>
      {loading ? (
        <div className="py-8 text-center text-slate-400">กำลังโหลด…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-slate-100 text-xs text-slate-600">
              <tr>
                <th className="p-2">เวลา</th>
                <th className="p-2">ประเภท</th>
                <th className="p-2">อ้างอิง (key)</th>
                <th className="p-2 text-center">สถานะ</th>
                <th className="p-2">รายละเอียด</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="whitespace-nowrap p-2 text-slate-500">{r.createdAt}</td>
                  <td className="p-2">{ACTION_LABEL[r.action] ?? r.action}</td>
                  <td className="whitespace-nowrap p-2 font-mono text-xs text-slate-600">{r.key}</td>
                  <td className="p-2 text-center">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${r.status === "ok" ? "bg-green-100 text-green-700" : r.status === "duplicate" ? "bg-slate-200 text-slate-500" : "bg-red-100 text-red-700"}`}>
                      {r.status === "ok" ? "สำเร็จ" : r.status === "duplicate" ? "ข้าม (ซ้ำ)" : "ล้มเหลว"}
                    </span>
                  </td>
                  <td className="p-2 text-slate-600">{r.message}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">
                    ยังไม่มีประวัติเชื่อมระบบ
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
