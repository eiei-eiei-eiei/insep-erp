"use client";

import { useEffect, useRef, useState } from "react";
import type { SyncRow } from "./types";
import { Card, LoadError } from "./ui";
import { getSyncHistoryAction } from "../actions";
import { IconRefresh } from "@/lib/shared/icons";

const ACTION_LABEL: Record<string, string> = {
  SELL_PRODUCT: "ขาย → ผลิต (ตัดสต็อกสุรา)",
  RECEIVE_REVENUE: "ขาย → บัญชี (รายรับ)",
};

export function SyncHistoryTab({ active }: { active: boolean }) {
  const [rows, setRows] = useState<SyncRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const firstLoad = useRef(true);

  function refresh() {
    if (firstLoad.current) setLoading(true);
    setErr(false);
    getSyncHistoryAction()
      .then((d) => {
        setRows(d);
        setLoading(false);
        firstLoad.current = false;
      })
      .catch(() => {
        // 🚨 D89 — ต้องจบสถานะโหลดเสมอ ไม่งั้นค้างที่ "กำลังโหลด…" ตลอดกาล
        setErr(true);
        setLoading(false);
        firstLoad.current = false;
      });
  }
  useEffect(() => {
    if (active) refresh();
  }, [active]);

  return (
    <Card title="ประวัติเชื่อมระบบ (แทนหน้าคิว sync เดิม)">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={refresh} className="rounded border border-line px-2.5 py-1.5 text-sm text-muted hover:bg-raised"><IconRefresh size={15} className="mr-1 inline align-[-2px]" />รีเฟรช
        </button>
        <span className="text-xs text-faint">
          การรับเงิน/จัดส่ง = ลงบัญชี/ตัดสต็อกทันทีใน DB เดียวกัน (ไม่มีคิวให้ยิงเองอีก) — หน้านี้ไว้ตรวจย้อนหลัง
        </span>
      </div>
      {loading ? (
        <div className="py-8 text-center text-faint">กำลังโหลด…</div>
      ) : err ? (
        <LoadError err onRetry={refresh} what="ประวัติเชื่อมระบบ" />
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl min-w-[640px]">
            <thead>
              <tr>
                <th>เวลา</th>
                <th>ประเภท</th>
                <th>อ้างอิง (key)</th>
                <th className="text-center">สถานะ</th>
                <th>รายละเอียด</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="whitespace-nowrap text-faint">{r.createdAt}</td>
                  <td>{ACTION_LABEL[r.action] ?? r.action}</td>
                  <td className="whitespace-nowrap font-mono text-xs text-muted">{r.key}</td>
                  <td className="text-center">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${r.status === "ok" ? "bg-ok-bg text-ok" : r.status === "duplicate" ? "bg-line text-faint" : "bg-crit-bg text-crit"}`}>
                      {r.status === "ok" ? "สำเร็จ" : r.status === "duplicate" ? "ข้าม (ซ้ำ)" : "ล้มเหลว"}
                    </span>
                  </td>
                  <td className="text-muted">{r.message}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-faint">
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
