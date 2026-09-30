"use client";

import { useState } from "react";
import type { BarBoot } from "../data";
import type { BarItem } from "@/lib/bar/types";
import { stockText, isLowStock, packToBase, numText } from "@/lib/bar/units";
import {
  planReceive, planNewItems, planCount, planItemEdits, errorsText, ADJUST_REASONS,
  blankReceive, blankNewItem, countItems, countDrafts, countPreview, editDrafts,
  recipeUseCount, unitLockReason, unitLabel, lowToBase,
  type ReceiveDraft, type NewItemDraft, type NewItemRow, type CountDraft, type ItemEditDraft, type QtyUnit,
} from "@/lib/bar/stockBatch";
import { Card, Msg, TextInput, NumBox, Select, Field, Badge, Empty, EscToClose, fmt, useSaver } from "@/lib/shared/ui";
import {
  receiveBatchAction, adjustBatchAction, addItemsAction, updateItemsAction, itemMovesAction,
} from "../actions";

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
 * สต็อกบาร์ (D96 · D103 · D104)
 *
 * 🚨 **`qty` และ `cost_per_unit` แก้ตรง ๆ ไม่ได้** — ขยับได้ทางเดียวคือผ่าน
 *    รับของ / นับสต็อก ซึ่งเขียน `bar_move` คู่กันเสมอ
 *    (หลักเดียวกับ D93 ที่ไม่ยอมให้แก้ตัวเลขบน log_distill ตรง ๆ — ตัวเลขต้องมีร่องรอย)
 *    โหมด "แก้ไข" ของตารางวัตถุดิบจึงไม่มีช่องยอดคงเหลือ/ต้นทุน
 */
export function StockTab({ boot, onReload }: { boot: BarBoot; onReload: () => Promise<void> }) {
  const data = boot;
  const { msg, setMsg } = useSaver();
  const [busy, setBusy] = useState(false);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [moves, setMoves] = useState<MoveRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);

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
        {editing ? (
          <ItemsEditor
            boot={data}
            busy={busy}
            onCancel={() => setEditing(false)}
            onRun={run}
            onDone={() => setEditing(false)}
          />
        ) : (
          <>
            {canWrite && (
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="rounded-lg bg-raised px-3 py-1.5 text-sm text-ink"
                >
                  ＋ เพิ่มวัตถุดิบ
                </button>
                {data.items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpenItem(null);
                      setEditing(true);
                    }}
                    className="rounded-lg bg-raised px-3 py-1.5 text-sm text-ink"
                  >
                    แก้ไข
                  </button>
                )}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>ชื่อ</th>
                    <th>คงเหลือ</th>
                    <th>เตือนเมื่อเหลือ</th>
                    {data.canSeeCost && <th className="text-right">ต้นทุน/หน่วย</th>}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((i) => (
                    <tr key={i.itemId}>
                      <td>
                        <span className="text-ink">{i.name}</span>
                        {/* ตัวที่เลิกใช้ไม่ขึ้น "ใกล้หมด" — ให้ตรงกับแถบเตือนด้านบนที่กรองเฉพาะตัวที่ยังใช้อยู่ */}
                        {i.active !== false && isLowStock(i) && (
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
                      <td className="text-sm text-muted">
                        {i.lowQty != null ? stockText({ ...i, qty: i.lowQty }) : "—"}
                      </td>
                      {/* 🚨 ต้นทุนไม่ได้ถูกส่งมาให้พนักงานบาร์ตั้งแต่ชั้น data.ts — ไม่ใช่ซ่อนด้วย CSS */}
                      {data.canSeeCost && <td className="text-right">{fmt(i.costPerUnit)}</td>}
                      <td className="text-right">
                        <button type="button" onClick={() => showMoves(i.itemId)} className="text-xs text-muted underline">
                          ประวัติ
                        </button>
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
          </>
        )}
      </Card>

      {canWrite && <ReceiveCard boot={data} busy={busy} onRun={run} />}
      {canWrite && <CountCard boot={data} busy={busy} onRun={run} />}

      {adding && (
        <NewItemsModal
          boot={data}
          busy={busy}
          onClose={() => setAdding(false)}
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
    </div>
  );
}

/**
 * ปุ่มสลับหน่วยที่กรอก [ลูก | ml] (D104)
 * ★ ประกาศนอกคอมโพเนนต์อื่นเสมอ (ประกาศข้างใน = input ถูกทำลายทุกตัวอักษร · D71)
 * ไม่มีหน่วยซื้อ = โชว์แค่ชื่อหน่วยฐาน (ไม่มีอะไรให้สลับ)
 */
function UnitToggle({
  item, value, onChange,
}: {
  item: Pick<BarItem, "unit" | "packLabel"> & { packSize?: number | "" | null };
  value: QtyUnit;
  onChange: (u: QtyUnit) => void;
}) {
  const hasPack = typeof item.packSize === "number" && item.packSize > 0;
  if (!hasPack) return <span className="text-xs text-muted">{item.unit}</span>;
  return (
    <div className="inline-flex overflow-hidden rounded border border-line text-xs">
      {(["pack", "base"] as const).map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => onChange(u)}
          className={`px-2 py-1 ${value === u ? "bg-brand text-on-brand" : "bg-input text-muted"}`}
        >
          {unitLabel(item, u)}
        </button>
      ))}
    </div>
  );
}

/**
 * โหมดแก้ไขของตารางวัตถุดิบ — แก้ทุกรายการแล้วบันทึกทีเดียว (D104)
 * · ส่งเฉพาะแถวที่เปลี่ยน · upsert คำสั่งเดียว เข้าหมดหรือไม่เข้าเลย
 * · 🚨 ช่องหน่วยที่สูตรใช้ล็อกเมื่อมียอดหรืออยู่ในสูตร — เทาพร้อมเหตุผล (D86: ปุ่มเทาดีกว่าซ่อน)
 * · ค่าเตือนกรอกเป็นหน่วยซื้อได้ ระบบแปลงเก็บเป็นหน่วยฐาน
 */
function ItemsEditor({
  boot, busy, onCancel, onRun, onDone,
}: {
  boot: BarBoot;
  busy: boolean;
  onCancel: () => void;
  onRun: OnRun;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<ItemEditDraft[]>(() => editDrafts(boot.items));
  const used = recipeUseCount(boot.menus);
  const plan = planItemEdits(rows, boot.items, used);
  const set = (idx: number, patch: Partial<ItemEditDraft>) =>
    setRows((rs) => rs.map((r, j) => (j === idx ? { ...r, ...patch } : r)));

  return (
    <>
      <p className="mb-2 text-xs text-faint">
        ยอดคงเหลือและต้นทุนแก้ที่นี่ไม่ได้ — ต้องผ่าน <b>รับของ</b> หรือ <b>นับสต็อก</b> เพื่อให้ทุกการเปลี่ยนแปลงมีร่องรอยใน ประวัติ
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
              <th>เตือนเมื่อเหลือน้อยกว่า</th>
              <th>ใช้อยู่</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const item = boot.items.find((i) => i.itemId === r.itemId)!;
              const lock = unitLockReason(item, used.get(r.itemId) ?? 0);
              const lowBase = lowToBase(r.lowQty, r.lowUnit, r.packSize);
              return (
                <tr key={r.itemId}>
                  <td className="text-sm text-faint">{idx + 1}</td>
                  <td>
                    <div className="w-44">
                      <TextInput value={r.name} onChange={(e) => set(idx, { name: e.target.value })} />
                    </div>
                  </td>
                  <td>
                    <div className="w-20">
                      <TextInput
                        value={r.unit}
                        disabled={!!lock}
                        title={lock ?? undefined}
                        onChange={(e) => set(idx, { unit: e.target.value })}
                        className="disabled:opacity-60"
                      />
                    </div>
                    {lock && <div className="max-w-[10rem] text-xs text-faint">🔒 {lock}</div>}
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
                    <div className="flex items-center gap-1">
                      <div className="w-20">
                        <NumBox value={r.lowQty} onChange={(v) => set(idx, { lowQty: v })} blankZero placeholder="ไม่เตือน" />
                      </div>
                      <UnitToggle item={{ ...item, unit: r.unit, packSize: r.packSize, packLabel: r.packLabel }} value={r.lowUnit} onChange={(u) => set(idx, { lowUnit: u })} />
                    </div>
                    {lowBase !== null && r.lowUnit === "pack" && (
                      <div className="text-xs text-faint">= {numText(lowBase)} {r.unit}</div>
                    )}
                  </td>
                  <td className="text-center">
                    <input type="checkbox" checked={r.active} onChange={(e) => set(idx, { active: e.target.checked })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {plan.errors.length > 0 && <p className="mt-2 text-xs text-warn">ยังบันทึกไม่ได้ — {errorsText(plan.errors)}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || plan.rows.length === 0 || plan.errors.length > 0}
          onClick={async () => {
            const n = plan.rows.length;
            if (await onRun(() => updateItemsAction(plan.rows), `บันทึกวัตถุดิบแล้ว ${n} รายการ`)) onDone();
          }}
          className="rounded-lg bg-brand px-4 py-2 text-sm text-on-brand disabled:opacity-50"
        >
          {plan.rows.length > 0 ? `บันทึก ${plan.rows.length} รายการ` : "บันทึก"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg bg-raised px-4 py-2 text-sm text-ink">
          ยกเลิก
        </button>
        {plan.rows.length === 0 && plan.errors.length === 0 && (
          <span className="text-xs text-faint">ยังไม่ได้แก้อะไร</span>
        )}
      </div>
    </>
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
 * นับสต็อก / ปรับยอด / ของเสีย / ชิม — แสดงวัตถุดิบครบทุกรายการเสมอ (D104)
 * ★ ช่องว่าง = ใช้ค่าในระบบ (ข้าม) · กรอกเฉพาะตัวที่นับแล้วไม่ตรง
 * ★ เลือกหน่วยที่กรอกได้ทีละแถว (ลูก/ขวด หรือ ml) ระบบแปลงเก็บเป็นหน่วยฐาน
 * ★ เก็บค่าที่กรอกไว้ตาม itemId ไม่ใช่ตามลำดับ — เพิ่มวัตถุดิบใหม่ระหว่างนับแล้วค่าไม่เลื่อนแถว
 */
function CountCard({ boot, busy, onRun }: { boot: BarBoot; busy: boolean; onRun: OnRun }) {
  const [edits, setEdits] = useState<Record<string, CountDraft>>({});
  const items = countItems(boot.items);
  const defaults = new Map(countDrafts(boot.items).map((d) => [d.itemId, d]));
  const rows = items.map((i) => edits[i.itemId] ?? defaults.get(i.itemId)!);
  const plan = planCount(rows, boot.items);
  const set = (d: CountDraft, patch: Partial<CountDraft>) =>
    setEdits((e) => ({ ...e, [d.itemId]: { ...d, ...patch } }));

  return (
    <Card title="นับสต็อก / ของเสีย / ชิม">
      <p className="mb-2 text-xs text-faint">
        กรอกเฉพาะตัวที่นับแล้วไม่ตรง — <b>ช่องที่เว้นว่างไว้ใช้ค่าในระบบ</b> · 0 = นับแล้วหมด
      </p>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>วัตถุดิบ</th>
              <th className="text-right">ระบบเก็บอยู่</th>
              <th>ยอดที่นับได้จริง</th>
              <th className="text-right">เปลี่ยน</th>
              <th>เหตุผล</th>
              <th>หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const item = boot.items.find((i) => i.itemId === r.itemId)!;
              const pv = countPreview(r, item);
              return (
                <tr key={r.itemId}>
                  <td className="text-sm text-faint">{idx + 1}</td>
                  <td className="text-sm text-ink">
                    {item.name}
                    {item.active === false && (
                      <>
                        {" "}
                        <Badge tone="neutral">เลิกใช้</Badge>
                      </>
                    )}
                  </td>
                  <td className="text-right text-sm text-muted">{stockText(item)}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      {/* ★ ไม่ใส่ blankZero — 0 คือคำตอบจริง (นับแล้วหมดเกลี้ยง) · ว่างคือใช้ค่าในระบบ */}
                      <div className="w-24">
                        <NumBox value={r.value} onChange={(v) => set(r, { value: v })} placeholder="ตามระบบ" />
                      </div>
                      <UnitToggle item={item} value={r.unit} onChange={(u) => set(r, { unit: u })} />
                    </div>
                    {pv && r.unit === "pack" && (
                      <div className="text-xs text-faint">= {numText(pv.after)} {item.unit}</div>
                    )}
                  </td>
                  <td className="text-right text-sm">
                    {!pv ? (
                      ""
                    ) : pv.diff === 0 ? (
                      <span className="text-faint">เท่าเดิม</span>
                    ) : (
                      <span className={pv.diff < 0 ? "text-crit" : "text-ok"}>
                        {pv.diff > 0 ? "+" : ""}
                        {numText(pv.diff)} {item.unit}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="w-32">
                      <Select value={r.reason} onChange={(e) => set(r, { reason: e.target.value })}>
                        {ADJUST_REASONS.map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </Select>
                    </div>
                  </td>
                  <td>
                    <div className="w-40">
                      <TextInput value={r.note} onChange={(e) => set(r, { note: e.target.value })} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {items.length === 0 && <Empty>— ยังไม่มีวัตถุดิบ —</Empty>}

      {plan.errors.length > 0 && <p className="mt-2 text-xs text-warn">ยังบันทึกไม่ได้ — {errorsText(plan.errors)}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || plan.rows.length === 0 || plan.errors.length > 0}
          onClick={async () => {
            const n = plan.rows.length;
            if (await onRun(() => adjustBatchAction(plan.rows), `ปรับยอดแล้ว ${n} รายการ`)) setEdits({});
          }}
          className="rounded-lg bg-brand px-4 py-2 text-sm text-on-brand disabled:opacity-50"
        >
          {plan.rows.length > 0 ? `บันทึกการนับ ${plan.rows.length} รายการ` : "บันทึกการนับ"}
        </button>
        {Object.keys(edits).length > 0 && (
          <button type="button" onClick={() => setEdits({})} className="text-sm text-muted underline">
            ล้างที่กรอก
          </button>
        )}
      </div>
      {plan.same > 0 && (
        <p className="mt-1 text-xs text-faint">กรอกไว้ตรงกับระบบ {plan.same} รายการ — ไม่ต้องบันทึก ระบบข้ามให้</p>
      )}
      {plan.rows.length === 0 && plan.same === 0 && plan.errors.length === 0 && (
        <p className="mt-1 text-xs text-faint">ยังไม่ได้กรอกยอดที่นับได้สักรายการ</p>
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
                    <div className="flex items-center gap-1">
                      <div className="w-20">
                        <NumBox value={r.lowQty} onChange={(v) => set(idx, { lowQty: v })} blankZero placeholder="ไม่เตือน" />
                      </div>
                      <UnitToggle item={r} value={r.lowUnit} onChange={(u) => set(idx, { lowUnit: u })} />
                    </div>
                    {r.lowUnit === "pack" && r.packSize !== "" && r.packSize > 0 && r.lowQty !== "" && r.lowQty > 0 && (
                      <div className="text-xs text-faint">
                        = {numText(lowToBase(r.lowQty, r.lowUnit, r.packSize) ?? 0)} {r.unit}
                      </div>
                    )}
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
