"use client";

import { useState } from "react";
import type { BarBoot } from "../data";
import { stockText, isLowStock, packToBase, numText } from "@/lib/bar/units";
import { Card, Msg, TextInput, NumBox, Select, Field, Badge, Empty, fmt, useSaver } from "@/lib/shared/ui";
import { receiveAction, adjustAction, saveItemAction, itemMovesAction } from "../actions";

const ADJUST_REASONS = ["ปรับยอด", "เสียหาย", "ชิม/เทสต์"];

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

      {editItem && (
        <ItemModal
          boot={data}
          itemId={editItem === "new" ? null : editItem}
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

/**
 * รับของเข้าบาร์
 * ★ ช่องราคาเติมค่าล่าสุดมาให้ → กดผ่านเลยก็ได้พฤติกรรม "ราคากลาง"
 *   ⇒ ได้ทั้งสองแบบโดยไม่ต้องมีสองโหมด (ตัดสินไว้ตอนวางแผน)
 */
function ReceiveCard({
  boot, busy, onRun,
}: {
  boot: BarBoot;
  busy: boolean;
  onRun: (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => Promise<boolean>;
}) {
  const [itemId, setItemId] = useState("");
  // 🐛 D96 — ช่องตัวเลขทั้งโมดูลเคยเป็น <input type="number"> ดิบที่ทำ Number("") = 0
  //    ⇒ ลบเลข 0 ทิ้งไม่ได้ ต้องเลือกคลุมแล้วพิมพ์ทับตลอด (ผู้ใช้แจ้งเอง)
  //    NumBox เก็บ buffer ข้อความระหว่างพิมพ์และคืนค่าว่างได้ — บัญชี/เงินเดือนใช้มาตั้งแต่ D71
  const [qtyPack, setQtyPack] = useState<number | "">(1);
  const [costTotal, setCostTotal] = useState<number | "">("");
  const [source, setSource] = useState("");

  const item = boot.items.find((i) => i.itemId === itemId);
  const nQtyPack = qtyPack === "" ? 0 : qtyPack;
  const nCost = costTotal === "" ? 0 : costTotal;
  const qtyBase = item ? packToBase(nQtyPack, item.packSize) : 0;
  // ค่าที่เติมให้อัตโนมัติ — ราคาล็อตล่าสุดต่อหน่วย × ปริมาณที่กำลังจะรับ
  const suggested = item ? Math.round(item.costPerUnit * qtyBase * 100) / 100 : 0;

  return (
    <Card title="รับของเข้าบาร์">
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="วัตถุดิบ">
          <Select
            value={itemId}
            onChange={(e) => {
              setItemId(e.target.value);
              setCostTotal("");
            }}
          >
            <option value="">— เลือก —</option>
            {boot.items
              .filter((i) => i.active !== false)
              .map((i) => (
                <option key={i.itemId} value={i.itemId}>
                  {i.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={item?.packLabel ? `จำนวน (${item.packLabel})` : "จำนวน (หน่วยซื้อ)"}>
          <NumBox value={qtyPack} onChange={setQtyPack} />
        </Field>
        <Field label="เป็นหน่วยฐาน">
          <div className="px-1 py-2 text-sm text-muted">
            {item ? `${numText(qtyBase)} ${item.unit}` : "—"}
          </div>
        </Field>
        <Field label="ราคาที่จ่ายจริง (บาท)">
          <NumBox value={costTotal} onChange={setCostTotal} blankZero />
        </Field>
      </div>

      {item && boot.canSeeCost && suggested > 0 && nCost === 0 && (
        <button
          type="button"
          onClick={() => setCostTotal(suggested)}
          className="mt-1 text-xs text-muted underline"
        >
          ใช้ราคาล็อตก่อน ({fmt(suggested)} บาท)
        </button>
      )}

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <Field label="ซื้อจาก">
          <TextInput value={source} onChange={(e) => setSource(e.target.value)} placeholder="โรงกลั่น / 7-11" />
        </Field>
      </div>

      {/* ⚠️ คีย์ 0 = ของฟรี · ถูกตามเลขคณิต แต่จะทำให้กำไรบาร์ดูดีเกินจริง */}
      {itemId && nCost === 0 && (
        <p className="mt-1 text-xs text-warn">
          ราคาเป็น 0 — ต้นทุนเฉลี่ยจะลดลงและกำไรจะดูดีกว่าความจริง
          ถ้าโรงกลั่นให้ฟรี แนะนำคีย์ราคาส่งไปเลยแล้วหักกลบหลังบ้าน
        </p>
      )}

      <button
        type="button"
        disabled={busy || !itemId || nQtyPack <= 0}
        onClick={async () => {
          if (
            await onRun(
              () => receiveAction({ itemId, qtyPack: nQtyPack, qty: qtyBase, costTotal: nCost, source }),
              "รับของเข้าแล้ว",
            )
          ) {
            setQtyPack(1);
            setCostTotal("");
          }
        }}
        className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm text-on-brand disabled:opacity-50"
      >
        รับเข้า
      </button>
    </Card>
  );
}

function AdjustCard({
  boot, busy, onRun,
}: {
  boot: BarBoot;
  busy: boolean;
  onRun: (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => Promise<boolean>;
}) {
  const [itemId, setItemId] = useState("");
  // ★ ไม่ใส่ `blankZero` — ที่นี่ 0 คือคำตอบจริง (นับแล้วหมดเกลี้ยง) ไม่ใช่ "ยังไม่กรอก"
  const [qtyAfter, setQtyAfter] = useState<number | "">(0);
  const [reason, setReason] = useState(ADJUST_REASONS[0]);
  const [note, setNote] = useState("");
  const item = boot.items.find((i) => i.itemId === itemId);

  return (
    <Card title="ปรับยอด / ของเสีย / ชิม">
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="วัตถุดิบ">
          <Select
            value={itemId}
            onChange={(e) => {
              setItemId(e.target.value);
              const it = boot.items.find((i) => i.itemId === e.target.value);
              setQtyAfter(it?.qty ?? 0);
            }}
          >
            <option value="">— เลือก —</option>
            {boot.items.map((i) => (
              <option key={i.itemId} value={i.itemId}>
                {i.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ยอดที่นับได้จริง">
          <NumBox value={qtyAfter} onChange={setQtyAfter} />
        </Field>
        <Field label="เหตุผล">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {ADJUST_REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <Field label="หมายเหตุ">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {item && qtyAfter !== "" && (
        <p className="mt-1 text-xs text-muted">
          ระบบเก็บอยู่ {numText(item.qty)} {item.unit} → จะเปลี่ยนเป็น {numText(qtyAfter)} {item.unit}
        </p>
      )}
      <button
        type="button"
        disabled={busy || !itemId || qtyAfter === "" || (item ? qtyAfter === item.qty : true)}
        onClick={() =>
          qtyAfter !== "" &&
          onRun(() => adjustAction({ itemId, qtyAfter, reason, note }), "ปรับยอดแล้ว")
        }
        className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm text-on-brand disabled:opacity-50"
      >
        บันทึกการปรับยอด
      </button>
      {item && qtyAfter === item.qty && (
        <p className="mt-1 text-xs text-faint">ยอดเท่าเดิม — ไม่มีอะไรต้องบันทึก</p>
      )}
    </Card>
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
