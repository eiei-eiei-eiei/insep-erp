"use client";

import { useState } from "react";
import type { BarItem } from "@/lib/bar/types";
import { stockText, numText } from "@/lib/bar/units";
import { receiveHistory, changeText, receiveDateText, type ReceiveRecord } from "@/lib/bar/receiveHistory";
import { Empty, EscToClose, LoadError, fmt, useRead } from "@/lib/shared/ui";
import { itemMovesAction, itemReceivesAction } from "../actions";

type MoveRow = {
  id: number;
  moved_at: string;
  delta: number;
  qty_after: number;
  reason: string;
  ref_no: string | null;
  note: string | null;
};

type HistoryView = "price" | "moves";
const VIEW_LABEL: Record<HistoryView, string> = { price: "ราคารับของ", moves: "ความเคลื่อนไหวสต็อก" };

/** ดึงผลจาก action แบบ `{ ok, data }` ให้เข้า `useRead` — ล้ม = throw ให้ `<LoadError>` ขึ้น (D89) */
async function readOrThrow<T>(p: Promise<{ ok: boolean; error?: string; data?: unknown }>): Promise<T[]> {
  const r = await p;
  if (!r.ok) throw new Error(r.error ?? "โหลดไม่สำเร็จ");
  return (r.data as T[]) ?? [];
}

/**
 * ป๊อปอัพประวัติของวัตถุดิบบาร์ (D126) — เดิมเป็นกล่องต่อท้ายตาราง ต้องเลื่อนลงล่างสุดถึงจะเจอ
 *
 * · **ราคารับของ** (`bar_receive`) — เฉพาะคนที่เห็นต้นทุน · server ตรวจ `bar.config` ซ้ำ
 * · **ความเคลื่อนไหวสต็อก** (`bar_move`) — ทุกคนที่เข้าแท็บคลังได้ (เหมือนเดิม)
 * 🚨 พนักงานบาร์ไม่ได้แม้แต่ปุ่มสลับ และไม่มีการยิง action ราคาเลยสักครั้ง (`skip`)
 */
export function ItemHistoryModal({
  item, canSeeCost, onClose,
}: {
  item: BarItem | null;
  canSeeCost: boolean;
  onClose: () => void;
}) {
  const [view, setView] = useState<HistoryView>(canSeeCost ? "price" : "moves");
  const itemId = item?.itemId ?? "";
  const receives = useRead(
    () => readOrThrow<ReceiveRecord>(itemReceivesAction(itemId)),
    [itemId],
    { skip: !canSeeCost || !itemId },
  );
  const moves = useRead(() => readOrThrow<MoveRow>(itemMovesAction(itemId)), [itemId], { skip: !itemId });

  const unit = item?.unit ?? "";
  const unitWord = unit || "หน่วย";
  const priced = receiveHistory(receives.data ?? []);
  const moveRows = moves.data ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <EscToClose onClose={onClose} />
      <div className="w-full max-w-3xl rounded-xl bg-card p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-ink">ประวัติ — {item?.name ?? "—"}</h3>
            {item && <div className="text-sm text-muted">คงเหลือ {stockText(item)}</div>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg bg-raised px-3 py-1.5 text-sm text-ink">
            ปิด
          </button>
        </div>

        {canSeeCost && (
          <div className="mb-3 inline-flex overflow-hidden rounded-md border border-line">
            {(Object.keys(VIEW_LABEL) as HistoryView[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setView(k)}
                aria-pressed={view === k}
                className={`px-3 py-1 text-sm ${view === k ? "bg-brand font-medium text-on-brand" : "bg-raised text-muted hover:text-ink"}`}
              >
                {VIEW_LABEL[k]}
              </button>
            ))}
          </div>
        )}

        {view === "price" && canSeeCost ? (
          <>
            <LoadError err={receives.err} onRetry={receives.reload} what="ประวัติราคา" />
            {receives.loading ? (
              <Empty>กำลังโหลด…</Empty>
            ) : priced.length === 0 ? (
              <Empty>— ยังไม่เคยรับของตัวนี้เข้า —</Empty>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>วันที่</th>
                        <th className="text-right">จำนวน</th>
                        <th className="text-right">ราคารวม</th>
                        <th className="text-right">ราคา/หน่วยซื้อ</th>
                        <th className="text-right">ราคา/{unitWord}</th>
                        <th>ร้าน / หมายเหตุ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {priced.map((r) => {
                        const ch = changeText(r.change);
                        const hasPack = r.qtyPack !== null && r.packSize !== null && r.packSize !== 1;
                        const tone =
                          r.change === null || ch === "เท่าเดิม" ? "text-faint" : r.change > 0 ? "text-crit" : "text-ok";
                        return (
                          <tr key={r.id}>
                            <td className="text-sm">{receiveDateText(r.docDate)}</td>
                            <td className="text-right text-sm">
                              {hasPack ? (
                                <>
                                  {numText(r.qtyPack ?? 0)} × {numText(r.packSize ?? 0)} {unit}
                                  <div className="text-xs text-faint">
                                    = {numText(r.qty)} {unit}
                                  </div>
                                </>
                              ) : (
                                `${numText(r.qty)} ${unit}`
                              )}
                            </td>
                            <td className="text-right">
                              {r.perUnit === null ? (
                                <span className="text-xs text-faint">ไม่ได้กรอกราคา</span>
                              ) : (
                                fmt(r.costTotal)
                              )}
                            </td>
                            <td className="text-right">{hasPack && r.perPack !== null ? fmt(r.perPack) : "—"}</td>
                            <td className="text-right">
                              {r.perUnit === null ? "—" : numText(r.perUnit, 4)}
                              {ch && <div className={`text-xs ${tone}`}>{ch}</div>}
                            </td>
                            <td className="text-sm text-muted">{[r.source, r.note].filter(Boolean).join(" · ")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-faint">
                  ▲▼ เทียบราคาต่อ {unitWord} กับครั้งก่อนหน้าที่กรอกราคา (ข้ามครั้งที่ไม่ได้กรอก) · ราคาต่อหน่วยซื้อคิดจากขนาดของล็อตนั้นเอง
                  {priced.length >= 100 && " · แสดง 100 ครั้งล่าสุด"}
                </p>
              </>
            )}
          </>
        ) : (
          <>
            <LoadError err={moves.err} onRetry={moves.reload} what="ประวัติ" />
            {moves.loading ? (
              <Empty>กำลังโหลด…</Empty>
            ) : moveRows.length === 0 ? (
              <Empty>— ยังไม่มีความเคลื่อนไหว —</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>เมื่อไร</th>
                      <th>เหตุผล</th>
                      <th className="text-right">เปลี่ยน</th>
                      <th className="text-right">คงเหลือ</th>
                      <th>อ้างอิง</th>
                    </tr>
                  </thead>
                  <tbody>
                    {moveRows.map((m) => (
                      <tr key={m.id}>
                        <td className="text-sm">{new Date(m.moved_at).toLocaleString("th-TH")}</td>
                        <td className="text-sm">{m.reason}</td>
                        <td className={`text-right ${Number(m.delta) < 0 ? "text-crit" : "text-ok"}`}>
                          {Number(m.delta) > 0 ? "+" : ""}
                          {numText(Number(m.delta))}
                        </td>
                        <td className="text-right">{numText(Number(m.qty_after))}</td>
                        <td className="text-sm text-muted">{m.ref_no ?? m.note ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
