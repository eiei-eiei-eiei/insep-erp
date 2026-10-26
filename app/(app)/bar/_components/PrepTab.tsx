"use client";

/**
 * ของทำเองในร้าน — ส่วนที่ 4 ของแท็บสต็อก (D130)
 *
 * · ตั้งของทำเอง: ชื่อ · หน่วย · สูตรมาตรฐานต่อ 1 ล็อต · 1 ล็อตได้ประมาณเท่าไร (แก้ได้ตลอด — มีผลกับล็อตถัดไป)
 * · ทำล็อต: กี่ล็อต (0.3 ได้) → วัตถุดิบ/ปริมาณที่ได้เติมให้ แก้ได้ → 2 ปุ่ม
 *     ทำเสร็จแล้ว (เข้าสต็อกเลย) · เริ่มแช่ (ตัดวัตถุดิบวันนี้ ของยังไม่เข้า → กด เสร็จแล้ว ทีหลัง)
 * · ประวัติล็อต · ยกเลิกล็อต (แช่อยู่ = ได้เสมอ · เสร็จแล้ว = ได้เฉพาะตอนยังเป็นการเคลื่อนไหวล่าสุด)
 *
 * ★ ตรรกะ/ประโยคตัดสินใน lib/bar/prep.ts (golden B27) · ช่องกรอกวัตถุดิบใช้ RecipeEditor ชุดเดียวกับเมนู (mode="prep")
 * 🚨 ห้ามประกาศคอมโพเนนต์ซ้อนข้างในคอมโพเนนต์ (D71)
 */
import { useState } from "react";
import type { BarBoot } from "../data";
import type { BarItem } from "@/lib/bar/types";
import { cleanRecipe, blankRecipeRow, type RecipeDraftRow } from "@/lib/bar/recipe";
import {
  scaleInputs, scaledYield, prepRecipeText, batchPreview, batchPerUnit, lastFinished, perUnitChange, soakDays,
  batchesOf, soakingBatches, cancelBlock, cancelConfirmText, prepEditError, batchError,
  type PrepDef, type PrepBatch,
} from "@/lib/bar/prep";
import { stockText, numText } from "@/lib/bar/units";
import {
  Card, TextInput, NumBox, Field, Badge, Empty, EscToClose, SuggestInput, LoadError,
  fmt, useSaver, useRead, useConfirm,
} from "@/lib/shared/ui";
import {
  prepDataAction, prepSaveAction, prepDeleteAction, prepStartAction, prepFinishAction, prepCancelAction,
} from "../actions";
import { RecipeEditor } from "./RecipeEditor";

type PrepData = { canSeeCost: boolean; preps: PrepDef[]; batches: PrepBatch[] };
type Res = { ok: boolean; error?: string; data?: unknown };

async function loadPrep(): Promise<PrepData> {
  const r = await prepDataAction();
  if (!r.ok) throw new Error(r.error ?? "อ่านข้อมูลของทำเองไม่สำเร็จ");
  return r.data as PrepData;
}

const UNITS = ["ml", "g", "ชิ้น"];

/**
 * ทุนต่อหน่วยของของทำเองมักเป็นสตางค์ (0.0375 บาท/ml) — ปัด 2 ตำแหน่งแบบเงินแล้วเทียบล็อตไม่ได้
 * 🐛 เจอตอนเทสเบราว์เซอร์: 0.1667 กับ 0.1786 ขึ้นเป็น 0.17/0.18 · ใช้ 4 ตำแหน่งให้ตรงกับประวัติราคารับของ (D126)
 */
const perUnitText = (v: number) => numText(v, 4);

export function PrepView({ boot, onReload }: { boot: BarBoot; onReload: () => Promise<void> }) {
  const prep = useRead(loadPrep, [boot.entityId], { skip: !boot.entityId });
  const { setMsg } = useSaver();
  const { confirmNode, ask } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ def: PrepDef | null } | null>(null);
  const [making, setMaking] = useState<PrepDef | null>(null);
  const [finishing, setFinishing] = useState<PrepBatch | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const data = prep.data;
  const byId = new Map(boot.items.map((i) => [i.itemId, i]));
  const now = Date.now();

  async function run(fn: () => Promise<Res>, okText: string | ((d: unknown) => string)): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (!r.ok) {
        setMsg({ ok: false, text: r.error ?? "บันทึกไม่สำเร็จ" });
        return false;
      }
      prep.reload();
      await onReload();
      setMsg({ ok: true, text: typeof okText === "function" ? okText(r.data) : okText });
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function cancel(b: PrepBatch) {
    const unit = byId.get(b.itemId)?.unit ?? "";
    const ok = await ask({
      title: `ยกเลิกล็อต ${b.batchId}?`,
      detail: cancelConfirmText(b, unit),
      confirmText: "ยกเลิกล็อต",
      cancelText: "กลับ",
      danger: true,
    });
    if (ok) await run(() => prepCancelAction(b.batchId), `ยกเลิกล็อต ${b.batchId} แล้ว`);
  }

  if (!data) {
    return (
      <>
        <LoadError err={prep.err} onRetry={prep.reload} what="ของทำเอง" />
        {!prep.err && <p className="text-sm text-muted">กำลังโหลด…</p>}
      </>
    );
  }

  const soaking = soakingBatches(data.batches);
  const defs = [...data.preps].sort((a, b) =>
    (byId.get(a.itemId)?.name ?? "").localeCompare(byId.get(b.itemId)?.name ?? "", "th"),
  );

  return (
    <div className="space-y-4">
      {confirmNode}

      {soaking.length > 0 && (
        <Card title={`กำลังแช่ ${soaking.length} ล็อต`}>
          {soaking.map((b) => {
            const it = byId.get(b.itemId);
            return (
              <div key={b.batchId} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft py-2 text-sm last:border-0">
                <b className="text-ink">{it?.name ?? b.itemId}</b>
                <span className="text-xs text-muted">
                  {b.batchId} · {numText(b.multiplier)} ล็อต · เริ่ม {b.startDate} · แช่มาแล้ว {soakDays(b.startedAt, now)} วัน
                  {data.canSeeCost && ` · ทุน ${fmt(b.costTotal)}`}
                </span>
                <span className="ml-auto flex gap-3">
                  <button
                    type="button"
                    disabled={busy || !boot.canWrite}
                    onClick={() => setFinishing(b)}
                    className="min-h-[44px] rounded-lg bg-brand px-3 py-1 text-xs text-on-brand disabled:opacity-50 sm:min-h-0"
                  >
                    เสร็จแล้ว
                  </button>
                  <button type="button" disabled={busy || !boot.canWrite} onClick={() => cancel(b)} className="text-xs text-crit underline">
                    ยกเลิก
                  </button>
                </span>
              </div>
            );
          })}
        </Card>
      )}

      <Card title="ของทำเองในร้าน">
        <p className="mb-3 text-xs text-muted">
          ไซรัป · infused · cordial — ตั้งสูตรต่อ 1 ล็อตไว้ แล้วกด <b>ทำล็อต</b> ทุกครั้งที่ทำ (ทำทีละน้อยได้ เช่น 0.3 ล็อต)
          · ระบบตัดวัตถุดิบ แล้วเอาของทำเองเข้าสต็อก คิดทุนต่อหน่วยจากของที่ใช้จริง · ใช้ในสูตรเมนูได้เหมือนวัตถุดิบทั่วไป
          · ไม่นับค่าแรง/ค่าแก๊ส
        </p>
        <button
          type="button"
          disabled={busy || !boot.canWrite}
          onClick={() => setEdit({ def: null })}
          className="min-h-[44px] rounded-lg bg-brand px-4 py-2 text-sm text-on-brand disabled:opacity-50 sm:min-h-0"
        >
          ＋ ของทำเองใหม่
        </button>
        {defs.length === 0 && <Empty>— ยังไม่มีของทำเอง —</Empty>}

        <div className="mt-3 space-y-3">
          {defs.map((d) => {
            const it = byId.get(d.itemId);
            if (!it) return null;
            const last = lastFinished(d.itemId, data.batches);
            const all = batchesOf(d.itemId, data.batches);
            return (
              <div key={d.itemId} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-ink">{it.name}</b>
                  {it.active === false && <Badge tone="neutral">ปิดใช้</Badge>}
                  <span className="text-xs text-muted">คงเหลือ {stockText(it)}</span>
                  {data.canSeeCost && last && (
                    <span className="text-xs text-muted">
                      · ล็อตล่าสุด {perUnitText(batchPerUnit(last) ?? 0)} บาท/{it.unit}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-ink">{prepRecipeText(d, boot.items, it.unit)}</div>
                {d.note && <div className="text-xs text-muted">โน้ต: {d.note}</div>}
                {boot.canWrite && (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setMaking(d)}
                      className="min-h-[44px] rounded-lg bg-brand px-3 py-1.5 text-sm text-on-brand disabled:opacity-50 sm:min-h-0"
                    >
                      ทำล็อต
                    </button>
                    <button type="button" disabled={busy} onClick={() => setEdit({ def: d })} className="text-sm text-muted underline">
                      แก้สูตร
                    </button>
                    <button type="button" onClick={() => setOpen(open === d.itemId ? null : d.itemId)} className="text-sm text-muted underline">
                      {open === d.itemId ? "ซ่อนประวัติล็อต" : `ประวัติล็อต (${all.length})`}
                    </button>
                    {all.length === 0 && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          const ok = await ask({
                            title: `ลบ ${it.name}?`,
                            detail: "ยังไม่เคยทำล็อต · ลบทั้งสูตรและวัตถุดิบตัวนี้ (สูตรเมนูที่ใช้อยู่จะทำให้ลบไม่ได้)",
                            confirmText: "ลบ",
                            danger: true,
                          });
                          if (ok) await run(() => prepDeleteAction(d.itemId), `ลบ ${it.name} แล้ว`);
                        }}
                        className="text-sm text-crit underline"
                      >
                        ลบ
                      </button>
                    )}
                  </div>
                )}
                {open === d.itemId && (
                  <BatchHistory batches={all} unit={it.unit} canSeeCost={data.canSeeCost} busy={busy} canWrite={boot.canWrite} onCancel={cancel} />
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {edit && (
        <PrepModal
          boot={boot}
          def={edit.def}
          canSeeCost={data.canSeeCost}
          busy={busy}
          onClose={() => setEdit(null)}
          onSave={async (input) => {
            if (await run(() => prepSaveAction(input), edit.def ? "บันทึกสูตรแล้ว — มีผลกับล็อตถัดไป" : "เพิ่มของทำเองแล้ว — กด ทำล็อต ตอนทำได้เลย"))
              setEdit(null);
          }}
        />
      )}

      {making && byId.get(making.itemId) && (
        <BatchModal
          boot={boot}
          def={making}
          item={byId.get(making.itemId)!}
          last={lastFinished(making.itemId, data.batches)}
          canSeeCost={data.canSeeCost}
          busy={busy}
          onClose={() => setMaking(null)}
          onSubmit={async (input) => {
            const unit = byId.get(making.itemId)!.unit;
            const ok = await run(
              () => prepStartAction({ ...input, itemId: making.itemId, window: boot.settings.window }),
              (d) => {
                const x = d as { batch_id?: string; finished?: boolean; cost?: number };
                return x.finished
                  ? `ทำล็อต ${x.batch_id} เสร็จ · ${numText(input.yieldQty ?? 0)} ${unit} เข้าสต็อกแล้ว`
                  : `เริ่มแช่ล็อต ${x.batch_id} แล้ว · ตัดวัตถุดิบแล้ว — กรองเสร็จแล้วกด เสร็จแล้ว ที่กล่อง กำลังแช่`;
              },
            );
            if (ok) setMaking(null);
          }}
        />
      )}

      {finishing && (
        <FinishModal
          batch={finishing}
          def={data.preps.find((p) => p.itemId === finishing.itemId)}
          item={byId.get(finishing.itemId)}
          canSeeCost={data.canSeeCost}
          busy={busy}
          onClose={() => setFinishing(null)}
          onSubmit={async (yieldQty) => {
            const ok = await run(
              () => prepFinishAction({ batchId: finishing.batchId, yieldQty, window: boot.settings.window }),
              `ล็อต ${finishing.batchId} เสร็จแล้ว · เข้าสต็อกแล้ว`,
            );
            if (ok) setFinishing(null);
          }}
        />
      )}
    </div>
  );
}

function BatchHistory({
  batches, unit, canSeeCost, busy, canWrite, onCancel,
}: {
  batches: PrepBatch[];
  unit: string;
  canSeeCost: boolean;
  busy: boolean;
  canWrite: boolean;
  onCancel: (b: PrepBatch) => void;
}) {
  if (batches.length === 0) return <p className="mt-2 text-xs text-faint">— ยังไม่เคยทำล็อต —</p>;
  const finished = batches.filter((b) => b.status === "เสร็จแล้ว");
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>ล็อต</th>
            <th>วันที่</th>
            <th>สถานะ</th>
            <th className="num">ล็อต</th>
            <th className="num">ได้</th>
            {canSeeCost && <th className="num">ทุน</th>}
            {canSeeCost && <th className="num">ต่อ {unit}</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => {
            const pu = batchPerUnit(b);
            const prev = finished[finished.indexOf(b) + 1];
            const ch = b.status === "เสร็จแล้ว" && prev ? perUnitChange(pu, batchPerUnit(prev)) : null;
            const block = cancelBlock(b);
            return (
              <tr key={b.batchId} className={b.status === "ยกเลิก" ? "opacity-50" : ""}>
                <td className="text-xs">{b.batchId}</td>
                <td className="text-xs">
                  {b.startDate}
                  {b.finishDate && b.finishDate !== b.startDate && ` → ${b.finishDate}`}
                </td>
                <td>
                  <Badge tone={b.status === "เสร็จแล้ว" ? "ok" : b.status === "กำลังแช่" ? "warn" : "neutral"}>{b.status}</Badge>
                </td>
                <td className="num">{numText(b.multiplier)}</td>
                <td className="num">{b.yieldQty === null ? "—" : `${numText(b.yieldQty)} ${unit}`}</td>
                {canSeeCost && <td className="num">{fmt(b.costTotal)}</td>}
                {canSeeCost && (
                  <td className="num">
                    {pu === null ? "—" : perUnitText(pu)}
                    {ch !== null && ch !== 0 && (
                      <div className={`text-xs ${ch > 0 ? "text-crit" : "text-ok"}`}>
                        {ch > 0 ? "▲" : "▼"} {Math.abs(ch)}%
                      </div>
                    )}
                  </td>
                )}
                <td className="act">
                  {canWrite && b.status !== "ยกเลิก" &&
                    (block === null ? (
                      <button type="button" disabled={busy} onClick={() => onCancel(b)} className="text-xs text-crit underline">
                        ยกเลิก
                      </button>
                    ) : (
                      <span className="text-xs text-faint" title={block}>
                        ยกเลิกไม่ได้
                      </span>
                    ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** ตั้ง/แก้ของทำเอง — ชื่อ · หน่วย (ตอนสร้าง) · 1 ล็อตได้เท่าไร · สูตรต่อ 1 ล็อต */
function PrepModal({
  boot, def, canSeeCost, busy, onClose, onSave,
}: {
  boot: BarBoot;
  def: PrepDef | null;
  canSeeCost: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (input: { itemId: string | null; name: string; unit: string; stdYield: number; inputs: { itemId: string; qty: number }[]; note: string }) => void;
}) {
  const cur = def ? boot.items.find((i) => i.itemId === def.itemId) : undefined;
  const [name, setName] = useState(cur?.name ?? "");
  const [unit, setUnit] = useState(cur?.unit ?? "ml");
  const [stdYield, setStdYield] = useState<number | "">(def?.stdYield ?? "");
  const [note, setNote] = useState(def?.note ?? "");
  const [rows, setRows] = useState<RecipeDraftRow[]>(
    def ? scaleInputs(def, 1) : [blankRecipeRow(), blankRecipeRow(), blankRecipeRow()],
  );
  // 🚨 ใช้ตัวเองในสูตรไม่ได้ — ไม่เสนอให้เลือกตั้งแต่แรก (DB กันซ้ำอีกชั้น)
  const items = boot.items.filter((i) => i.itemId !== def?.itemId);
  const err = prepEditError({ itemId: def?.itemId ?? null, name, unit, stdYield, rows, items: boot.items });
  const pv = batchPreview(rows, boot.items, stdYield, undefined);
  const u = cur?.unit ?? unit;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <EscToClose onClose={onClose} />
      <div className="w-full max-w-lg rounded-lg bg-card p-5">
        <h3 className="mb-3 text-lg font-bold text-ink">{def ? `แก้สูตร — ${cur?.name ?? ""}` : "ของทำเองใหม่"}</h3>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Field label="ชื่อ">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="ไซรัปฟักทอง" />
            </Field>
          </div>
          <Field label="หน่วย">
            {def ? (
              <div className="py-2 text-sm text-muted" title="เปลี่ยนหน่วยได้ที่ส่วน วัตถุดิบ → แก้ไข (ตอนยอดเป็น 0 และไม่มีสูตรเมนูใช้)">
                {u}
              </div>
            ) : (
              <SuggestInput value={unit} onChange={setUnit} options={UNITS} listId="prep-units" />
            )}
          </Field>
        </div>
        <div className="mt-2 text-sm font-medium text-muted">วัตถุดิบต่อ 1 ล็อต</div>
        <RecipeEditor
          mode="prep"
          items={items}
          slots={[]}
          garnishes={[]}
          rows={rows}
          setRows={setRows}
          canSeeCost={canSeeCost}
          isVat={false}
          price=""
          onUsePrice={() => undefined}
        />
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Field label={`1 ล็อตได้ประมาณ (${u})`}>
            <NumBox value={stdYield} onChange={setStdYield} blankZero placeholder="800" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="โน้ต (วิธีทำ)">
              <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="เคี่ยว 20 นาที กรองผ้าขาวบาง" />
            </Field>
          </div>
        </div>
        {canSeeCost && cleanRecipe(rows).length > 0 && (
          <p className="mt-2 text-sm text-muted">
            ทุนต่อล็อตโดยประมาณ <b className="text-ink">{fmt(pv.cost)}</b> บาท
            {pv.perUnit !== null && ` · ${perUnitText(pv.perUnit)} บาท/${u}`}
            {pv.missing > 0 && <span className="text-warn"> · มี {pv.missing} วัตถุดิบที่ยังไม่มีทุน</span>}
          </p>
        )}
        {def && <p className="mt-1 text-xs text-faint">แก้สูตรแล้วมีผลกับล็อตถัดไปเท่านั้น — ล็อตที่ทำไปแล้วไม่ขยับ</p>}
        {err && <p className="mt-1 text-xs text-warn">{err}</p>}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy || err !== ""}
            onClick={() =>
              onSave({
                itemId: def?.itemId ?? null,
                name,
                unit,
                stdYield: stdYield as number,
                inputs: cleanRecipe(rows).flatMap((r) => (r.itemId !== undefined ? [{ itemId: r.itemId, qty: r.qty }] : [])),
                note,
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

/** ทำล็อต — กี่ล็อต · วัตถุดิบ (แก้ได้) · ปริมาณที่ได้ · 2 ปุ่ม */
function BatchModal({
  boot, def, item, last, canSeeCost, busy, onClose, onSubmit,
}: {
  boot: BarBoot;
  def: PrepDef;
  item: BarItem;
  last: PrepBatch | undefined;
  canSeeCost: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: { multiplier: number; inputs: { itemId: string; qty: number }[]; yieldQty: number | null; note: string }) => void;
}) {
  const [mult, setMult] = useState<number | "">(1);
  const [rows, setRows] = useState<RecipeDraftRow[]>(() => scaleInputs(def, 1));
  const [yieldQty, setYieldQty] = useState<number | "">(scaledYield(def, 1));
  const [note, setNote] = useState("");
  const pv = batchPreview(rows, boot.items, yieldQty, item);
  const ch = perUnitChange(pv.perUnit, last ? batchPerUnit(last) : null);
  const inputs = cleanRecipe(rows).flatMap((r) => (r.itemId !== undefined ? [{ itemId: r.itemId, qty: r.qty }] : []));
  const errNow = batchError({ multiplier: mult, rows, yieldQty, finishNow: true });
  const errSoak = batchError({ multiplier: mult, rows, yieldQty, finishNow: false });
  const items = boot.items.filter((i) => i.itemId !== def.itemId);

  /** เปลี่ยนจำนวนล็อต = คิดวัตถุดิบ/ปริมาณที่ได้ใหม่จากสูตรมาตรฐาน (ที่แก้มือไว้จะถูกแทน — บอกบนจอ) */
  const changeMult = (v: number | "") => {
    setMult(v);
    if (v !== "" && v > 0) {
      setRows(scaleInputs(def, v));
      setYieldQty(scaledYield(def, v));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <EscToClose onClose={onClose} />
      <div className="w-full max-w-lg rounded-lg bg-card p-5">
        <h3 className="mb-3 text-lg font-bold text-ink">ทำล็อต — {item.name}</h3>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="กี่ล็อต">
            <NumBox value={mult} onChange={changeMult} blankZero placeholder="1" />
          </Field>
          <p className="self-end pb-2 text-xs text-faint sm:col-span-2">ทำทีละน้อยใส่ 0.3 ได้ · เปลี่ยนตัวเลขนี้แล้วปริมาณข้างล่างคิดใหม่จากสูตร</p>
        </div>
        <div className="mt-2 text-sm font-medium text-muted">วัตถุดิบที่ใช้จริง (แก้ได้ถ้าวันนี้ใส่ต่างไป)</div>
        <RecipeEditor
          mode="prep"
          items={items}
          slots={[]}
          garnishes={[]}
          rows={rows}
          setRows={setRows}
          canSeeCost={canSeeCost}
          isVat={false}
          price=""
          onUsePrice={() => undefined}
        />
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Field label={`ได้จริง (${item.unit})`}>
            <NumBox value={yieldQty} onChange={setYieldQty} blankZero />
          </Field>
          <div className="sm:col-span-2">
            <Field label="โน้ต">
              <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        </div>
        {canSeeCost && inputs.length > 0 && (
          <p className="mt-2 text-sm text-muted">
            ทุนล็อตนี้ <b className="text-ink">{fmt(pv.cost)}</b> บาท
            {pv.perUnit !== null && (
              <>
                {" "}
                · <b className="text-ink">{perUnitText(pv.perUnit)}</b> บาท/{item.unit}
              </>
            )}
            {ch !== null && last && ` (ล็อตก่อน ${perUnitText(batchPerUnit(last) ?? 0)} ${ch > 0 ? "▲" : ch < 0 ? "▼" : ""} ${Math.abs(ch)}%)`}
            {pv.missing > 0 && <span className="text-warn"> · มี {pv.missing} วัตถุดิบที่ยังไม่มีทุน — ทุนต่ำกว่าความจริง</span>}
          </p>
        )}
        <p className="mt-2 text-xs text-faint">
          <b>ทำเสร็จแล้ว</b> = ตัดวัตถุดิบ + ของเข้าสต็อกเลย · <b>เริ่มแช่</b> = ตัดวัตถุดิบวันนี้ (สต็อกตรงของจริงตั้งแต่วันเทลงโหล)
          ของยังไม่เข้า — กรองเสร็จแล้วค่อยกด เสร็จแล้ว ที่กล่องกำลังแช่ · ขวดไม่พอก็ตัดได้ (ติดลบ)
        </p>
        {errSoak && <p className="mt-1 text-xs text-warn">{errSoak}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || errNow !== ""}
            title={errNow || undefined}
            onClick={() => onSubmit({ multiplier: mult as number, inputs, yieldQty: yieldQty as number, note })}
            className="min-h-[44px] flex-1 rounded-lg bg-brand px-3 py-2 text-sm text-on-brand disabled:opacity-50 sm:min-h-0"
          >
            ทำเสร็จแล้ว — เข้าสต็อกเลย
          </button>
          <button
            type="button"
            disabled={busy || errSoak !== ""}
            onClick={() => onSubmit({ multiplier: mult as number, inputs, yieldQty: null, note })}
            className="min-h-[44px] flex-1 rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink disabled:opacity-50 sm:min-h-0"
          >
            เริ่มแช่ — ยังไม่ได้ของ
          </button>
          <button type="button" onClick={onClose} className="rounded-lg bg-raised px-3 py-2 text-sm text-ink">
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
}

/** แช่เสร็จแล้ว — ใส่ปริมาณที่ได้จริง (เติมค่ามาตรฐาน × จำนวนล็อตไว้ให้) */
function FinishModal({
  batch, def, item, canSeeCost, busy, onClose, onSubmit,
}: {
  batch: PrepBatch;
  def: PrepDef | undefined;
  item: BarItem | undefined;
  canSeeCost: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (yieldQty: number) => void;
}) {
  const [yieldQty, setYieldQty] = useState<number | "">(def ? scaledYield(def, batch.multiplier) : "");
  const unit = item?.unit ?? "";
  const pu = yieldQty !== "" && yieldQty > 0 ? Math.round((batch.costTotal / yieldQty) * 10000) / 10000 : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <EscToClose onClose={onClose} />
      <div className="w-full max-w-sm rounded-lg bg-card p-5">
        <h3 className="mb-1 text-lg font-bold text-ink">แช่เสร็จแล้ว — {item?.name ?? batch.itemId}</h3>
        <p className="mb-3 text-xs text-muted">
          {batch.batchId} · เริ่ม {batch.startDate} · {numText(batch.multiplier)} ล็อต
        </p>
        <Field label={`ได้จริง (${unit})`}>
          <NumBox value={yieldQty} onChange={setYieldQty} blankZero />
        </Field>
        {canSeeCost && (
          <p className="mt-2 text-sm text-muted">
            ทุนล็อต {fmt(batch.costTotal)} บาท{pu !== null && ` · ${perUnitText(pu)} บาท/${unit}`}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy || yieldQty === "" || !(yieldQty > 0)}
            onClick={() => onSubmit(yieldQty as number)}
            className="flex-1 rounded-lg bg-brand px-3 py-2 text-sm text-on-brand disabled:opacity-50"
          >
            เสร็จแล้ว — เข้าสต็อก
          </button>
          <button type="button" onClick={onClose} className="rounded-lg bg-raised px-3 py-2 text-sm text-ink">
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
}
