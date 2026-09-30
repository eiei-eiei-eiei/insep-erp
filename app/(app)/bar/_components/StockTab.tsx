"use client";

import { useState } from "react";
import type { BarBoot } from "../data";
import type { BarItem } from "@/lib/bar/types";
import { stockText, isLowStock, packToBase, numText } from "@/lib/bar/units";
import {
  planReceive, planAdjust, planNewItems, countAllDrafts, errorsText, ADJUST_REASONS,
  blankReceive, blankAdjust, blankNewItem,
  type ReceiveDraft, type AdjustDraft, type NewItemDraft, type NewItemRow,
} from "@/lib/bar/stockBatch";
import { Card, Msg, TextInput, NumBox, Select, Field, Badge, Empty, EscToClose, fmt, useSaver } from "@/lib/shared/ui";
import { receiveBatchAction, adjustBatchAction, addItemsAction, saveItemAction, itemMovesAction } from "../actions";

type MoveRow = {
  id: number;
  moved_at: string;
  delta: number;
  qty_after: number;
  reason: string;
  ref_no: string | null;
  note: string | null;
};

/**
 * สต็อกบาร์ (D96)
 *
 * 🚨 **`qty` และ `cost_per_unit` แก้ตรง ๆ ไม่ได้** — ขยับได้ทางเดียวคือผ่าน
 *    รับของ / ปรับยอด ซึ่งเขียน `bar_move` คู่กันเสมอ
 *    (หลักเดียวกับ D93 ที่ไม่ยอมให้แก้ตัวเลขบน log_distill ตรง ๆ — ตัวเลขต้องมีร่องรอย)
 */
export function StockTab({ boot, onReload }: { boot: BarBoot; onReload: () => Promise<void> }) {
  const data = boot;
  const { msg, setMsg } = useSaver();
  const [busy, setBusy] = useState(false);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [moves, setMoves] = useState<MoveRow[]>([]);
  const [editItem, setEditItem] = useState<string | null | "new">(null);

  const canWrite = data.canWrite;

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (!r.ok) {
        // ★ โหลดข้อมูลใหม่แม้ล้ม (D103) — สาเหตุที่ชุดล้มบ่อยสุดคือยอดถูกแก้จากอีกเครื่อง
        //   ไม่โหลด = คอลัมน์ "ระบบเก็บอยู่" ยังเป็นค่าเก่า กดใหม่ก็ล้มซ้ำแบบเดิมไม่รู้จบ
        //   แถวที่กรอกไว้อยู่ใน state ของการ์ด ไม่หายไปกับการโหลด
        await onReload().catch(() => undefined);
        setMsg({ ok: false, text: r.error ?? "บันทึกไม่สำเร็จ" });
        return false;
      }
      await onReload();
      setMsg({ ok: true, text: okText });
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function showMoves(itemId: string) {
    if (openItem === itemId) {
      setOpenItem(null);
      return;
    }
    setOpenItem(itemId);
    const r = await itemMovesAction(itemId);
    setMoves(r.ok ? ((r.data as MoveRow[]) ?? []) : []);
    if (!r.ok) setMsg({ ok: false, text: r.error ?? "โหลดประวัติไม่สำเร็จ" });
  }

  const low = data.items.filter((i) => i.active !== false && isLowStock(i));

  if (!data.entityId) return null;

  return (
    <div className="space-y-4">
      <Msg msg={msg} />

      {low.length > 0 && (
        <div className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">
          ของใกล้หมด {low.length} รายการ: {low.map((i) => i.name).join(" · ")}
        </div>
      )}

      <Card title="วัตถุดิบในบาร์">
        {canWrite && (
          <button
            type="button"
            onClick={() => setEditItem("new")}
            className="mb-3 rounded-lg bg-raised px-3 py-1.5 text-sm text-ink"
          >
            ＋ เพิ่มวัตถุดิบ
          </button>
        )}
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>ชื่อ</th>
                <th>คงเหลือ</th>
                {data.canSeeCost && <th className="text-right">ต้นทุน/หน่วย</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.itemId}>
                  <td>
                    <span className="text-ink">{i.name}</span>
                    {isLowStock(i) && (
                      <>
                        {" "}
                        <Badge tone="warn">ใกล้หมด</Badge>
                      </>
                    )}
                    {i.active === false && (
                      <>
                        {" "}
                        <Badge tone="neutral">เลิกใช้</Badge>
                      </>
                    )}
                  </td>
                  <td>{stockText(i)}</td>
                  {/* 🚨 ต้นทุนไม่ได้ถูกส่งมาให้พนักงานบาร์ตั้งแต่ชั้น data.ts — ไม่ใช่ซ่อนด้วย CSS */}
                  {data.canSeeCost && <td className="text-right">{fmt(i.costPerUnit)}</td>}
                  <td className="text-right">
                    <button type="button" onClick={() => showMoves(i.itemId)} className="text-xs text-muted underline">
                      ประวัติ
                    </button>
                    {canWrite && (
                      <>
                        {" · "}
                        <button
                          type="button"
                          onClick={() => setEditItem(i.itemId)}
                          className="text-xs text-muted underline"
                        >
                          แก้
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.items.length === 0 && <Empty>— ยังไม่มีวัตถุดิบ —</Empty>}

        {openItem && (
          <div className="mt-3 rounded-lg bg-raised p-3">
            <div className="mb-2 text-sm font-medium text-ink">
              ประวัติ — {data.items.find((i) => i.itemId === openItem)?.name}
            </div>
            {moves.length === 0 ? (
              <Empty>— ยังไม่มีความเคลื่อนไหว —</Empty>
            ) : (
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
                  {moves.map((m) => (
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
            )}
          </div>
        )}
      </Card>

      {canWrite && <ReceiveCard boot={data} busy={busy} onRun={run} />}
      {canWrite && <AdjustCard boot={data} busy={busy} onRun={run} />}

      {editItem === "new" && (
        <NewItemsModal
          boot={data}
          busy={busy}
          onClose={() => setEditItem(null)}
          onSave={async (rows) => {
            setBusy(true);
            setMsg(null);
            try {
              const r = await addItemsAction(rows);
              if (r.ok) {
                await onReload();
                setMsg({ ok: true, text: `เพิ่มวัตถุดิบแล้ว ${rows.length} รายการ` });
              }
              return r;
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {editItem && editItem !== "new" && (
        <ItemModal
          boot={data}
          itemId={editItem}
          busy={busy}
          onClose={() => setEditItem(null)}
          onSave={async (input) => {
            if (await run(() => saveItemAction(input), "บันทึกวัตถุดิบแล้ว")) setEditItem(null);
          }}
        />
      )}
    </div>
  );
}

type OnRun = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => Promise<boolean>;

const iconBtn =
  "grid h-7 w-7 place-items-center rounded text-muted hover:bg-raised hover:text-crit disabled:opacity-30";

/** ตัวเลือกวัตถุดิบในแถวหนึ่ง — ซ่อนตัวที่แถวอื่นเลือกไปแล้ว (ซ้ำในชุดเดียว = error อยู่ดี · stockBatch) */
function itemOptions(items: readonly BarItem[], rows: readonly { itemId: string }[], idx: number, activeOnly: boolean) {
  const taken = new Set(rows.filter((_, j) => j !== idx).map((r) => r.itemId).filter(Boolean));
  return items.filter((i) => (!activeOnly || i.active !== false) && !taken.has(i.itemId));
}

/** เปลี่ยนแถว idx แล้ว ถ้าเป็นแถวสุดท้ายและเพิ่งถูกกรอก → ต่อแถวว่างให้เอง (กรอกต่อได้ไม่ต้องกดเพิ่มแถว) */
function patchRow<T>(rows: T[], idx: number, patch: Partial<NoInfer<T>>, blank: () => NoInfer<T>, filled: (r: T) => boolean): T[] {
  const next = rows.map((r, j) => (j === idx ? { ...r, ...patch } : r));
  if (idx === next.length - 1 && filled(next[idx])) next.push(blank());
  return next;
}

/** ลบแถว — เหลือแถวเดียวแล้วลบ = ล้างเป็นแถวว่าง (ตารางไม่หายไปทั้งตาราง) */
function dropRow<T>(rows: T[], idx: number, blank: () => T): T[] {
  const next = rows.filter((_, j) => j !== idx);
  return next.length > 0 ? next : [blank()];
}

/**
 * key ของแถวต้องคงที่ — 🪤 ใช้ index เป็น key แล้วลบแถวกลาง ช่อง NumBox (เก็บ buffer ข้อความเอง)
 * จะโชว์ค่าของแถวที่ถูกลบค้างอยู่ในแถวถัดไป
 */
let seq = 0;
type K<T> = T & { k: number };
const keyed = <T,>(blank: () => T) => (): K<T> => ({ ...blank(), k: ++seq });
const newReceive = keyed(blankReceive);
const newAdjust = keyed(blankAdjust);
const newItem = keyed(blankNewItem);
const blanks = <T,>(n: number, blank: () => T) => Array.from({ length: n }, blank);

/**
 * รับของเข้าบาร์ — หลายรายการ บันทึกทีเดียว (D103)
 * ★ ช่องราคามีปุ่ม "ใช้ราคาล็อตก่อน" → กดผ่านเลยก็ได้พฤติกรรม "ราคากลาง"
 * 🚨 ทั้งชุดเข้าหมดหรือไม่เข้าเลย — ล้มแล้วแถวยังอยู่ครบ แก้แถวที่ error บอกแล้วกดใหม่
 */
function ReceiveCard({ boot, busy, onRun }: { boot: BarBoot; busy: boolean; onRun: OnRun }) {
  const [rows, setRows] = useState<K<ReceiveDraft>[]>(() => blanks(3, newReceive));
  const [source, setSource] = useState("");

  const plan = planReceive(rows, boot.items);
  const total = plan.rows.reduce((s, r) => s + r.costTotal, 0);
  const freeNames = plan.rows
    .filter((r) => r.costTotal === 0)
    .map((r) => boot.items.find((i) => i.itemId === r.itemId)?.name ?? r.itemId);
  const set = (idx: number, patch: Partial<ReceiveDraft>) =>
    setRows((rs) => patchRow(rs, idx, patch, newReceive, (r) => !!r.itemId));

  return (
    <Card title="รับของเข้าบาร์">
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>วัตถุดิบ</th>
              <th className="text-right">จำนวน (หน่วยซื้อ)</th>
              <th>เป็นหน่วยฐาน</th>
              <th className="text-right">ราคาที่จ่ายจริง (บาท)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const item = boot.items.find((i) => i.itemId === r.itemId);
              const qtyBase = item && r.qtyPack !== "" ? packToBase(r.qtyPack, item.packSize) : 0;
              // ราคาล็อตล่าสุดต่อหน่วย × ปริมาณที่กำลังจะรับ
              const suggested = item ? Math.round(item.costPerUnit * qtyBase * 100) / 100 : 0;
              return (
                <tr key={r.k}>
                  <td className="text-sm text-faint">{idx + 1}</td>
                  <td>
                    <div className="w-48">
                      <Select value={r.itemId} onChange={(e) => set(idx, { itemId: e.target.value, costTotal: "" })}>
                        <option value="">— เลือก —</option>
                        {itemOptions(boot.items, rows, idx, true).map((i) => (
                          <option key={i.itemId} value={i.itemId}>
                            {i.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </td>
                  <td>
                    <div className="ml-auto w-24">
                      <NumBox value={r.qtyPack} onChange={(v) => set(idx, { qtyPack: v })} blankZero />
                    </div>
                    {item?.packLabel && <div className="text-right text-xs text-faint">{item.packLabel}</div>}
                  </td>
                  <td className="text-sm text-muted">{item && qtyBase > 0 ? `${numText(qtyBase)} ${item.unit}` : "—"}</td>
                  <td>
                    <div className="ml-auto w-28">
                      <NumBox value={r.costTotal} onChange={(v) => set(idx, { costTotal: v })} blankZero />
                    </div>
                    {boot.canSeeCost && suggested > 0 && r.costTotal === "" && (
                      <button
                        type="button"
                        onClick={() => set(idx, { costTotal: suggested })}
                        className="block w-full text-right text-xs text-muted underline"
                      >
                        ใช้ราคาล็อตก่อน ({fmt(suggested)})
                      </button>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      aria-label="ลบแถว"
                      onClick={() => setRows((rs) => dropRow(rs, idx, newReceive))}
                      className={iconBtn}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={() => setRows((rs) => [...rs, newReceive()])}
        className="mt-2 block text-sm text-muted underline"
      >
        ＋ เพิ่มแถว
      </button>

      <div className="mt-3 max-w-sm">
        <Field label="ซื้อจาก (ใช้กับทุกรายการในชุดนี้)">
          <TextInput value={source} onChange={(e) => setSource(e.target.value)} placeholder="โรงกลั่น / 7-11" />
        </Field>
      </div>

      {/* ⚠️ คีย์ 0 = ของฟรี · ถูกตามเลขคณิต แต่จะทำให้กำไรบาร์ดูดีเกินจริง */}
      {freeNames.length > 0 && (
        <p className="mt-2 text-xs text-warn">
          ราคาเป็น 0: {freeNames.join(" · ")} — ต้นทุนเฉลี่ยจะลดลงและกำไรจะดูดีกว่าความจริง
          ถ้าโรงกลั่นให้ฟรี แนะนำคีย์ราคาส่งไปเลยแล้วหักกลบหลังบ้าน
        </p>
      )}
      {plan.errors.length > 0 && <p className="mt-2 text-xs text-warn">ยังบันทึกไม่ได้ — {errorsText(plan.errors)}</p>}

      <button
        type="button"
        disabled={busy || plan.rows.length === 0 || plan.errors.length > 0}
        onClick={async () => {
          const n = plan.rows.length;
          if (await onRun(() => receiveBatchAction({ rows: plan.rows, source }), `รับของเข้าแล้ว ${n} รายการ`)) {
            setRows(blanks(3, newReceive));
          }
        }}
        className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm text-on-brand disabled:opacity-50"
      >
        {plan.rows.length > 0 ? `รับเข้า ${plan.rows.length} รายการ` : "รับเข้า"}
        {plan.rows.length > 0 && boot.canSeeCost && ` · รวม ${fmt(total)} บาท`}
      </button>
      {plan.rows.length === 0 && plan.errors.length === 0 && (
        <p className="mt-1 text-xs text-faint">เลือกวัตถุดิบอย่างน้อย 1 แถว</p>
      )}
    </Card>
  );
}

/**
 * ปรับยอด / ของเสีย / ชิม — หลายรายการ บันทึกทีเดียว (D103)
 * ★ "นับทั้งร้าน" เติมทุกรายการด้วยยอดปัจจุบัน → แก้เฉพาะตัวที่ไม่ตรง ตัวที่เท่าเดิมถูกข้ามเอง
 */
function AdjustCard({ boot, busy, onRun }: { boot: BarBoot; busy: boolean; onRun: OnRun }) {
  const [rows, setRows] = useState<K<AdjustDraft>[]>(() => blanks(3, newAdjust));

  const plan = planAdjust(rows, boot.items);
  const set = (idx: number, patch: Partial<AdjustDraft>) =>
    setRows((rs) => patchRow(rs, idx, patch, newAdjust, (r) => !!r.itemId));

  /** เติมรายการที่ยังไม่อยู่ในตาราง — ★ ไม่ทับแถวที่กรอกไว้แล้ว (จึงไม่ต้องถามยืนยัน) */
  function countAll() {
    setRows((rs) => {
      const kept = rs.filter((r) => r.itemId);
      const have = new Set(kept.map((r) => r.itemId));
      return [...kept, ...countAllDrafts(boot.items).filter((d) => !have.has(d.itemId)).map((d) => ({ ...d, k: ++seq })), newAdjust()];
    });
  }

  return (
    <Card title="ปรับยอด / ของเสีย / ชิม">
      <button type="button" onClick={countAll} className="mb-2 rounded-lg bg-raised px-3 py-1.5 text-sm text-ink">
        นับทั้งร้าน (ใส่ทุกรายการ)
      </button>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>วัตถุดิบ</th>
              <th className="text-right">ระบบเก็บอยู่</th>
              <th className="text-right">ยอดที่นับได้จริง</th>
              <th className="text-right">เปลี่ยน</th>
              <th>เหตุผล</th>
              <th>หมายเหตุ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const item = boot.items.find((i) => i.itemId === r.itemId);
              const diff = item && r.qtyAfter !== "" ? r.qtyAfter - item.qty : null;
              return (
                <tr key={r.k}>
                  <td className="text-sm text-faint">{idx + 1}</td>
                  <td>
                    <div className="w-48">
                      <Select
                        value={r.itemId}
                        onChange={(e) => {
                          const it = boot.items.find((i) => i.itemId === e.target.value);
                          set(idx, { itemId: e.target.value, qtyAfter: it ? it.qty : "" });
                        }}
                      >
                        <option value="">— เลือก —</option>
                        {itemOptions(boot.items, rows, idx, false).map((i) => (
                          <option key={i.itemId} value={i.itemId}>
                            {i.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </td>
                  <td className="text-right text-sm text-muted">{item ? `${numText(item.qty)} ${item.unit}` : "—"}</td>
                  <td>
                    {/* ★ ไม่ใส่ blankZero — 0 คือคำตอบจริง (นับแล้วหมดเกลี้ยง) */}
                    <div className="ml-auto w-28">
                      <NumBox value={r.qtyAfter} onChange={(v) => set(idx, { qtyAfter: v })} />
                    </div>
                  </td>
                  <td className="text-right text-sm">
                    {diff === null ? (
                      ""
                    ) : diff === 0 ? (
                      <span className="text-faint">เท่าเดิม</span>
                    ) : (
                      <span className={diff < 0 ? "text-crit" : "text-ok"}>
                        {diff > 0 ? "+" : ""}
                        {numText(diff)}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="w-32">
                      <Select value={r.reason} onChange={(e) => set(idx, { reason: e.target.value })}>
                        {ADJUST_REASONS.map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </Select>
                    </div>
                  </td>
                  <td>
                    <div className="w-40">
                      <TextInput value={r.note} onChange={(e) => set(idx, { note: e.target.value })} />
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      aria-label="ลบแถว"
                      onClick={() => setRows((rs) => dropRow(rs, idx, newAdjust))}
                      className={iconBtn}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={() => setRows((rs) => [...rs, newAdjust()])}
        className="mt-2 block text-sm text-muted underline"
      >
        ＋ เพิ่มแถว
      </button>

      {plan.errors.length > 0 && <p className="mt-2 text-xs text-warn">ยังบันทึกไม่ได้ — {errorsText(plan.errors)}</p>}

      <button
        type="button"
        disabled={busy || plan.rows.length === 0 || plan.errors.length > 0}
        onClick={async () => {
          const n = plan.rows.length;
          if (await onRun(() => adjustBatchAction(plan.rows), `ปรับยอดแล้ว ${n} รายการ`)) {
            setRows(blanks(3, newAdjust));
          }
        }}
        className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm text-on-brand disabled:opacity-50"
      >
        {plan.rows.length > 0 ? `บันทึกการปรับยอด ${plan.rows.length} รายการ` : "บันทึกการปรับยอด"}
      </button>
      {plan.same > 0 && (
        <p className="mt-1 text-xs text-faint">ยอดเท่าเดิม {plan.same} รายการ — ไม่ต้องบันทึก ระบบข้ามให้</p>
      )}
      {plan.rows.length === 0 && plan.same === 0 && plan.errors.length === 0 && (
        <p className="mt-1 text-xs text-faint">เลือกวัตถุดิบอย่างน้อย 1 แถว</p>
      )}
    </Card>
  );
}

/** เพิ่มวัตถุดิบหลายรายการในป๊อปอัพเดียว (D103) — แก้รายการเดิมยังใช้ ItemModal ตัวเดิม */
function NewItemsModal({
  boot, busy, onClose, onSave,
}: {
  boot: BarBoot;
  busy: boolean;
  onClose: () => void;
  onSave: (rows: NewItemRow[]) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [rows, setRows] = useState<K<NewItemDraft>[]>(() => blanks(3, newItem));
  const [err, setErr] = useState<string | null>(null);
  const plan = planNewItems(rows, boot.items);
  const set = (idx: number, patch: Partial<NewItemDraft>) =>
    setRows((rs) => patchRow(rs, idx, patch, newItem, (r) => !!r.name.trim()));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <EscToClose onClose={onClose} />
      <div className="w-full max-w-4xl rounded-xl bg-card p-5">
        <h3 className="mb-1 text-lg font-bold text-ink">เพิ่มวัตถุดิบ</h3>
        <p className="mb-3 text-xs text-faint">
          🚨 <b>หน่วยที่สูตรใช้</b> คือหน่วยที่สูตรกิน ไม่ใช่หน่วยที่ซื้อ — เหล้าควรเป็น <b>ml</b> ไม่ใช่ขวด
          ไม่งั้นขาย 1 แก้วแล้วสต็อกกลายเป็นเศษทศนิยมของขวด · ยอดคงเหลือเริ่มที่ 0 แล้วค่อย <b>รับของเข้า</b>
        </p>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>ชื่อ</th>
                <th>หน่วยที่สูตรใช้</th>
                <th className="text-right">1 หน่วยซื้อ = กี่หน่วยฐาน</th>
                <th>ป้ายหน่วยซื้อ</th>
                <th className="text-right">เตือนเมื่อเหลือน้อยกว่า</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.k}>
                  <td className="text-sm text-faint">{idx + 1}</td>
                  <td>
                    <div className="w-44">
                      <TextInput value={r.name} onChange={(e) => set(idx, { name: e.target.value })} />
                    </div>
                  </td>
                  <td>
                    <div className="w-20">
                      <TextInput value={r.unit} onChange={(e) => set(idx, { unit: e.target.value })} />
                    </div>
                  </td>
                  <td>
                    <div className="ml-auto w-24">
                      <NumBox value={r.packSize} onChange={(v) => set(idx, { packSize: v })} blankZero placeholder="700" />
                    </div>
                  </td>
                  <td>
                    <div className="w-36">
                      <TextInput
                        value={r.packLabel}
                        onChange={(e) => set(idx, { packLabel: e.target.value })}
                        placeholder="ขวด (700 ml)"
                      />
                    </div>
                  </td>
                  <td>
                    <div className="ml-auto w-24">
                      <NumBox value={r.lowQty} onChange={(v) => set(idx, { lowQty: v })} blankZero placeholder="ว่าง=ไม่เตือน" />
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      aria-label="ลบแถว"
                      onClick={() => setRows((rs) => dropRow(rs, idx, newItem))}
                      className={iconBtn}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, newItem()])}
          className="mt-2 block text-sm text-muted underline"
        >
          ＋ เพิ่มแถว
        </button>

        {plan.errors.length > 0 && <p className="mt-2 text-xs text-warn">ยังบันทึกไม่ได้ — {errorsText(plan.errors)}</p>}
        {/* ★ error ต้องอยู่ในป๊อปอัพ — ข้อความบนหน้าหลักโดนป๊อปอัพบัง (D71) */}
        <div className="mt-2">
          <Msg msg={err ? { ok: false, text: err } : null} />
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy || plan.rows.length === 0 || plan.errors.length > 0}
            onClick={async () => {
              setErr(null);
              const r = await onSave(plan.rows);
              if (r.ok) onClose();
              else setErr(r.error ?? "บันทึกไม่สำเร็จ");
            }}
            className="flex-1 rounded-lg bg-brand px-3 py-2 text-sm text-on-brand disabled:opacity-50"
          >
            {plan.rows.length > 0 ? `บันทึก ${plan.rows.length} รายการ` : "บันทึก"}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg bg-raised px-3 py-2 text-sm text-ink">
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemModal({
  boot, itemId, busy, onClose, onSave,
}: {
  boot: BarBoot;
  itemId: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: Parameters<typeof saveItemAction>[0]) => void;
}) {
  const cur = boot.items.find((i) => i.itemId === itemId);
  const [name, setName] = useState(cur?.name ?? "");
  const [unit, setUnit] = useState(cur?.unit ?? "ml");
  const [packSize, setPackSize] = useState<number | "">(cur?.packSize ?? "");
  const [packLabel, setPackLabel] = useState(cur?.packLabel ?? "");
  const [lowQty, setLowQty] = useState<number | "">(cur?.lowQty ?? "");
  const [active, setActive] = useState(cur?.active !== false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-xl bg-card p-5">
        <h3 className="mb-3 text-lg font-bold text-ink">{cur ? "แก้วัตถุดิบ" : "เพิ่มวัตถุดิบ"}</h3>
        <Field label="ชื่อ">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="หน่วยที่สูตรใช้ (ml · ขวด · ชิ้น · g)">
          <TextInput value={unit} onChange={(e) => setUnit(e.target.value)} />
        </Field>
        <p className="text-xs text-faint">
          🚨 นี่คือหน่วยที่ <b>สูตรกิน</b> ไม่ใช่หน่วยที่ซื้อ — เหล้าควรเป็น <b>ml</b>
          ไม่ใช่ขวด ไม่งั้นขาย 1 แก้วแล้วสต็อกกลายเป็นเศษทศนิยมของขวด
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="1 หน่วยซื้อ = กี่หน่วยฐาน">
            <NumBox value={packSize} onChange={setPackSize} blankZero placeholder="700" />
          </Field>
          <Field label="ป้ายหน่วยซื้อ">
            <TextInput value={packLabel} onChange={(e) => setPackLabel(e.target.value)} placeholder="ขวด (700 ml)" />
          </Field>
        </div>
        <Field label="เตือนเมื่อเหลือน้อยกว่า (ว่าง = ไม่เตือน)">
          <NumBox value={lowQty} onChange={setLowQty} blankZero />
        </Field>
        <label className="mt-2 flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          ยังใช้อยู่
        </label>
        {cur && (
          <p className="mt-2 text-xs text-faint">
            ยอดคงเหลือและต้นทุนแก้ที่นี่ไม่ได้ — ต้องผ่าน <b>รับของ</b> หรือ <b>ปรับยอด</b>
            เพื่อให้ทุกการเปลี่ยนแปลงมีร่องรอยใน ประวัติ
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy || !name.trim() || !unit.trim()}
            onClick={() =>
              onSave({
                itemId,
                name,
                unit,
                packSize: packSize !== "" && packSize > 0 ? packSize : null,
                packLabel: packLabel || null,
                lowQty: lowQty !== "" && lowQty > 0 ? lowQty : null,
                active,
              })
            }
            className="flex-1 rounded-lg bg-brand px-3 py-2 text-sm text-on-brand disabled:opacity-50"
          >
            บันทึก
          </button>
          <button type="button" onClick={onClose} className="rounded-lg bg-raised px-3 py-2 text-sm text-ink">
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
}
