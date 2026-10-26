"use client";

/**
 * ตั้งค่าปุ่มลัดของหน้าสร้างเมนู (D127) — 3 การ์ดในแท็บตั้งค่าบาร์
 *   · เหล้าประจำบ้าน (ช่อง → ขวด)   · ชุดตกแต่ง (ชื่อ → วัตถุดิบ + จำนวนต่อชุด · D131 สูตรอ้างตัวชุด)   · วัตถุดิบใช้บ่อย (ปักหมุด)
 *
 * ★ แต่ละการ์ด **บันทึกแยกของตัวเอง** (ไม่ผูกกับปุ่ม "บันทึกการตั้งค่า" ด้านบน) — บอกบนจอด้วย
 *   แก้ในจอทั้งหมดแล้วกดบันทึกทีเดียว (แพตเทิร์น D109) · มีที่แก้ค้าง = ขึ้น "ยังไม่ได้บันทึก"
 * ★ การตัดสินทุกข้อ (ลบได้ไหม · เปลี่ยนขวดได้ไหม · ชื่อซ้ำ) อยู่ใน lib/bar (golden B23/B24)
 *   ที่นี่แค่วาด · ด่านจริงคือ RPC ใน 0090 (ทั้งชุดเป็น transaction เดียว)
 * 🚨 ห้ามประกาศคอมโพเนนต์ซ้อนข้างในคอมโพเนนต์ (โฟกัสหลุดทุกตัวอักษร · D71)
 * ★ การ์ดถูก remount ด้วย key จากข้อมูลที่บันทึกแล้ว ⇒ บันทึกสำเร็จแล้วฉบับร่างเริ่มใหม่จากของจริงเสมอ
 */
import { useState } from "react";
import type { BarBoot } from "../data";
import type { BarItem } from "@/lib/bar/types";
import {
  garnishDeleteBlock,
  menusUsingGarnish,
  menusUsingSlot,
  slotDeleteBlock,
  slotEditsError,
  slotItemChangeBlock,
  slotItemChoices,
  slotWarning,
  type SlotDraft,
} from "@/lib/bar/houseSlot";
import {
  garnishDraftOf,
  garnishEditsError,
  garnishPickItem,
  garnishQtyHint,
  garnishTypeQty,
  garnishWarning,
  moveAt,
  orderedGarnishes,
  orderedSlots,
  pinnedItems,
  type GarnishDraft,
} from "@/lib/bar/quickPick";
import { Card, Select, TextInput, MissingHint, useSaver } from "@/lib/shared/ui";
import { saveGarnishesAction, saveHouseSlotsAction, savePinsAction } from "../actions";

type Reload = () => Promise<void>;
type Notify = (text: string) => void;

const ARROW =
  "grid h-8 w-8 place-items-center rounded text-muted hover:bg-raised hover:text-ink disabled:opacity-30";

export function QuickPickSettings({ boot, onReload }: { boot: BarBoot; onReload: Reload }) {
  // ★ ข้อความ "บันทึกแล้ว" อยู่ที่ตัวแม่ — การ์ดถูก remount หลังบันทึก ข้อความในการ์ดจะหายไปพร้อมการ์ด
  const { setMsg } = useSaver();
  const notify: Notify = (text) => setMsg({ ok: true, text });
  return (
    <>
      <div className="lg:col-span-2">
        <h3 className="mt-2 text-sm font-semibold text-ink">ปุ่มลัดในหน้าสร้างเมนู</h3>
        <p className="text-xs text-muted">
          3 การ์ดนี้ <b>บันทึกแยกทีละการ์ด</b> ด้วยปุ่มในการ์ดเอง (ไม่เกี่ยวกับปุ่ม บันทึกการตั้งค่า ด้านบน)
        </p>
      </div>
      <HouseSlotCard key={`hs:${JSON.stringify(boot.houseSlots)}`} boot={boot} onReload={onReload} notify={notify} />
      <GarnishCard key={`gn:${JSON.stringify(boot.garnishes)}`} boot={boot} onReload={onReload} notify={notify} />
      <PinCard
        key={`pin:${boot.items.map((i) => `${i.itemId}=${i.pinSort ?? ""}`).join(",")}`}
        boot={boot}
        onReload={onReload}
        notify={notify}
      />
    </>
  );
}

/** ป้ายของวัตถุดิบในดร็อปดาวน์ — ชื่อ + หน่วยที่สูตรใช้ (ให้รู้ว่าปริมาณในสูตรเป็นหน่วยอะไร) */
const optLabel = (it: BarItem) => `${it.name} (${it.unit})${it.active === false ? " · ปิดใช้แล้ว" : ""}`;

function HouseSlotCard({ boot, onReload, notify }: { boot: BarBoot; onReload: Reload; notify: Notify }) {
  const { setMsg } = useSaver();
  const [busy, setBusy] = useState(false);
  const initial: SlotDraft[] = orderedSlots(boot.houseSlots).map((s) => ({
    slotId: s.slotId,
    name: s.name,
    itemId: s.itemId,
  }));
  const [rows, setRows] = useState<SlotDraft[]>(initial);
  const set = (i: number, patch: Partial<SlotDraft>) => setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  const problem = dirty ? slotEditsError(rows, boot.houseSlots, boot.items, boot.menus) : "";

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await saveHouseSlotsAction(rows);
      if (!r.ok) return setMsg({ ok: false, text: r.error ?? "บันทึกไม่สำเร็จ" });
      await onReload();
      notify("บันทึกเหล้าประจำบ้านแล้ว");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="เหล้าประจำบ้าน (House)">
      <p className="mb-2 text-xs text-muted">
        ตั้งชื่อช่อง แล้วเลือกขวดที่ใช้อยู่ตอนนี้ · สูตรอ้างช่องแทนขวดยี่ห้อได้ ·{" "}
        <b>เปลี่ยนขวด = ทุกเมนูที่อ้างช่องนี้เปลี่ยนทันที</b> (บิลเก่าไม่ขยับ) · ขวดหมดระบบปล่อยติดลบ ไม่สลับขวดให้เอง
      </p>
      {rows.length === 0 && <p className="text-xs text-faint">— ยังไม่มีช่อง —</p>}
      {rows.map((r, i) => {
        const saved = r.slotId ? boot.houseSlots.find((s) => s.slotId === r.slotId) : undefined;
        const used = saved ? menusUsingSlot(saved.slotId, boot.menus).length : 0;
        const choices = slotItemChoices(saved?.itemId ?? null, boot.items, used);
        const block = saved ? slotDeleteBlock(saved.slotId, boot.menus) : null;
        const cur = saved ? boot.items.find((it) => it.itemId === saved.itemId) : undefined;
        const next = boot.items.find((it) => it.itemId === r.itemId);
        const unitBlock = saved && r.itemId !== saved.itemId ? slotItemChangeBlock(cur, next, used) : null;
        const warn = r.itemId ? slotWarning({ itemId: r.itemId }, boot.items) : null;
        return (
          <div key={r.slotId ?? `new-${i}`} className="border-b border-line-soft py-2 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" aria-label="เลื่อนขึ้น" disabled={busy || i === 0} onClick={() => setRows((p) => moveAt(p, i, -1))} className={ARROW}>
                ▲
              </button>
              <button type="button" aria-label="เลื่อนลง" disabled={busy || i === rows.length - 1} onClick={() => setRows((p) => moveAt(p, i, 1))} className={ARROW}>
                ▼
              </button>
              <div className="w-36">
                <TextInput value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="House Gin" />
              </div>
              <span className="text-faint">→</span>
              <div className="min-w-40 flex-1">
                <Select value={r.itemId} onChange={(e) => set(i, { itemId: e.target.value })}>
                  <option value="">— เลือกขวด —</option>
                  {choices.map((it) => (
                    <option key={it.itemId} value={it.itemId}>
                      {optLabel(it)}
                    </option>
                  ))}
                </Select>
              </div>
              {block ? null : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
                  className="text-xs text-crit underline disabled:opacity-50"
                >
                  ลบ
                </button>
              )}
            </div>
            <div className="mt-0.5 text-xs text-faint">
              {saved ? `ใช้ในสูตร ${used} เมนู` : "ช่องใหม่ (ยังไม่ได้บันทึก)"}
              {used > 0 && cur && ` · เลือกได้เฉพาะขวดหน่วย ${cur.unit} (ปริมาณในสูตรผูกกับหน่วยนี้)`}
            </div>
            {block && <div className="text-xs text-faint">ลบไม่ได้ — {block}</div>}
            {unitBlock && <div className="text-xs text-warn">{unitBlock}</div>}
            {warn && <div className="text-xs text-warn">{warn}</div>}
          </div>
        );
      })}
      {boot.items.length === 0 && (
        <p className="mt-1 text-xs text-warn">ยังไม่มีวัตถุดิบ — เพิ่มขวดที่แท็บ สต็อก ก่อนถึงจะตั้งช่องได้</p>
      )}
      <SaveRow
        busy={busy}
        dirty={dirty}
        problem={problem}
        canConfig={boot.canConfig}
        onAdd={() => setRows((p) => [...p, { slotId: null, name: "", itemId: "" }])}
        addText="＋ เพิ่มช่อง"
        onSave={save}
        onReset={() => setRows(initial)}
      />
    </Card>
  );
}

function GarnishCard({ boot, onReload, notify }: { boot: BarBoot; onReload: Reload; notify: Notify }) {
  const { setMsg } = useSaver();
  const [busy, setBusy] = useState(false);
  const initial: GarnishDraft[] = orderedGarnishes(boot.garnishes).map((g) => garnishDraftOf(g, boot.items));
  const [rows, setRows] = useState<GarnishDraft[]>(initial);
  const setRow = (i: number, fn: (r: GarnishDraft) => GarnishDraft) => setRows((p) => p.map((r, j) => (j === i ? fn(r) : r)));
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  const problem = dirty ? garnishEditsError(rows, boot.items, boot.garnishes, boot.menus) : "";

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await saveGarnishesAction(rows);
      if (!r.ok) return setMsg({ ok: false, text: r.error ?? "บันทึกไม่สำเร็จ" });
      await onReload();
      notify("บันทึกชุดตกแต่งแล้ว");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="ชุดตกแต่ง">
      <p className="mb-2 text-xs text-muted">
        กดชุดตกแต่งในหน้าสร้างเมนู = <b>เพิ่มเป็นบรรทัดของชุด</b> (กดซ้ำ = เพิ่มจำนวนชุด) ·{" "}
        <b>แก้ชุดที่นี่ = ทุกเมนูที่ใช้ชุดนี้เปลี่ยนตาม</b> (แก้วที่ขายไปแล้วไม่ขยับ) · จำนวนพิมพ์เศษส่วนได้ เช่น{" "}
        <b>1/7</b> (มะนาว 1 ลูกฝานได้ 7 แว่น) · ไม่เลือกวัตถุดิบ = ชุดที่ไม่ตัดสต็อก
      </p>
      {rows.length === 0 && <p className="text-xs text-faint">— ยังไม่มีชุดตกแต่ง —</p>}
      {rows.map((r, i) => {
        const saved = r.garnishId ? boot.garnishes.find((g) => g.garnishId === r.garnishId) : undefined;
        const used = saved ? menusUsingGarnish(saved.garnishId, boot.menus).length : 0;
        const block = saved ? garnishDeleteBlock(saved.garnishId, boot.menus) : null;
        const it = boot.items.find((x) => x.itemId === r.itemId);
        const choices = boot.items.filter((x) => x.active !== false || x.itemId === r.itemId);
        const warn = r.itemId && r.garnishId ? garnishWarning({ itemId: r.itemId }, boot.items) : null;
        const hint = garnishQtyHint(r, boot.items, saved);
        return (
          <div key={r.garnishId ?? `new-${i}`} className="border-b border-line-soft py-2 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" aria-label="เลื่อนขึ้น" disabled={busy || i === 0} onClick={() => setRows((p) => moveAt(p, i, -1))} className={ARROW}>
                ▲
              </button>
              <button type="button" aria-label="เลื่อนลง" disabled={busy || i === rows.length - 1} onClick={() => setRows((p) => moveAt(p, i, 1))} className={ARROW}>
                ▼
              </button>
              <div className="w-40">
                <TextInput value={r.name} onChange={(e) => setRow(i, (x) => ({ ...x, name: e.target.value }))} placeholder="Lime Wheel" />
              </div>
              <div className="min-w-36 flex-1">
                <Select
                  value={r.itemId}
                  aria-label="วัตถุดิบของชุด"
                  onChange={(e) => setRow(i, (x) => garnishPickItem(x, e.target.value, boot.items, used))}
                >
                  <option value="">— ไม่ตัดสต็อก —</option>
                  {choices.map((x) => (
                    <option key={x.itemId} value={x.itemId}>
                      {optLabel(x)}
                    </option>
                  ))}
                </Select>
              </div>
              {r.itemId && (
                <>
                  <div className="w-20">
                    {/* ★ ช่องข้อความ ไม่ใช่ช่องตัวเลข — ต้องพิมพ์ "/" ได้ (D131) */}
                    <TextInput
                      value={r.qtyText}
                      inputMode="text"
                      aria-label="จำนวนต่อ 1 ชุด"
                      onChange={(e) => setRow(i, (x) => garnishTypeQty(x, e.target.value, boot.items))}
                      placeholder="1/7"
                    />
                  </div>
                  <span className="text-xs text-faint">{it?.unit ?? ""} / ชุด</span>
                </>
              )}
              {block ? null : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
                  className="text-xs text-crit underline disabled:opacity-50"
                >
                  ลบ
                </button>
              )}
            </div>
            <div className="mt-0.5 text-xs text-faint">
              {saved ? `ใช้ในสูตร ${used} เมนู` : "ชุดใหม่ (ยังไม่ได้บันทึก)"}
              {!r.itemId && " · ไม่ตัดสต็อก (ขึ้นในสูตรว่า ไม่ตัดสต็อก)"}
            </div>
            {block && <div className="text-xs text-faint">ลบไม่ได้ — {block}</div>}
            {hint && <div className="text-xs text-warn">{hint}</div>}
            {warn && <div className="text-xs text-warn">{warn}</div>}
          </div>
        );
      })}
      <SaveRow
        busy={busy}
        dirty={dirty}
        problem={problem}
        canConfig={boot.canConfig}
        onAdd={() => setRows((p) => [...p, { garnishId: null, name: "", itemId: "", qtyText: "", qtyUnit: null }])}
        addText="＋ เพิ่มชุดตกแต่ง"
        onSave={save}
        onReset={() => setRows(initial)}
      />
    </Card>
  );
}

function PinCard({ boot, onReload, notify }: { boot: BarBoot; onReload: Reload; notify: Notify }) {
  const { setMsg } = useSaver();
  const [busy, setBusy] = useState(false);
  const initial = pinnedItems(boot.items).map((i) => i.itemId);
  // ★ ตัวที่ปักไว้แต่ถูกปิดใช้ ไม่ขึ้นเป็นปุ่ม (pinnedItems ตัดทิ้ง) — ถอดหมุดให้ตอนบันทึกครั้งถัดไป
  const [order, setOrder] = useState<string[]>(initial);
  const [adding, setAdding] = useState("");
  const byId = new Map(boot.items.map((i) => [i.itemId, i]));
  // 🪤 เทียบกับลิสต์ตั้งต้น ไม่ใช่ pinPlan — ตัวที่ปักไว้แต่ปิดใช้ทำให้ pinPlan มีงานค้างตั้งแต่เปิดหน้า
  const dirty = order.join("|") !== initial.join("|");
  const addable = boot.items.filter((i) => i.active !== false && !order.includes(i.itemId));

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await savePinsAction(order);
      if (!r.ok) return setMsg({ ok: false, text: r.error ?? "บันทึกไม่สำเร็จ" });
      await onReload();
      notify("บันทึกวัตถุดิบใช้บ่อยแล้ว");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="วัตถุดิบใช้บ่อย">
      <p className="mb-2 text-xs text-muted">
        ขึ้นเป็นปุ่มลัดกลุ่ม <b>ใช้บ่อย</b> ในหน้าสร้างเมนู เรียงตามที่จัดที่นี่ (ไม่เรียงตามยอดใช้ — ปุ่มอยู่ที่เดิมเสมอ)
      </p>
      {order.length === 0 && <p className="text-xs text-faint">— ยังไม่ได้ปักหมุด —</p>}
      {order.map((id, i) => {
        const it = byId.get(id);
        return (
          <div key={id} className="flex flex-wrap items-center gap-2 py-0.5 text-sm">
            <button type="button" aria-label="เลื่อนขึ้น" disabled={busy || i === 0} onClick={() => setOrder((p) => moveAt(p, i, -1))} className={ARROW}>
              ▲
            </button>
            <button type="button" aria-label="เลื่อนลง" disabled={busy || i === order.length - 1} onClick={() => setOrder((p) => moveAt(p, i, 1))} className={ARROW}>
              ▼
            </button>
            <span className="text-ink">{it ? optLabel(it) : id}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => setOrder((p) => p.filter((x) => x !== id))}
              className="text-xs text-crit underline disabled:opacity-50"
            >
              ถอดหมุด
            </button>
          </div>
        );
      })}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="min-w-40 flex-1">
          <Select value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">— เลือกวัตถุดิบที่จะปักหมุด —</option>
            {addable.map((x) => (
              <option key={x.itemId} value={x.itemId}>
                {optLabel(x)}
              </option>
            ))}
          </Select>
        </div>
        <button
          type="button"
          disabled={busy || !adding}
          onClick={() => {
            setOrder((p) => [...p, adding]);
            setAdding("");
          }}
          className="rounded-lg bg-raised px-3 py-1.5 text-sm text-ink disabled:opacity-50"
        >
          ปักหมุด
        </button>
      </div>
      <SaveRow
        busy={busy}
        dirty={dirty}
        problem=""
        canConfig={boot.canConfig}
        onSave={save}
        onReset={() => setOrder(initial)}
      />
    </Card>
  );
}

/** แถวปุ่มท้ายการ์ด: (เพิ่ม) · บันทึก · เลิกแก้ + สถานะ "ยังไม่ได้บันทึก"/เหตุผลที่บันทึกไม่ได้ */
function SaveRow({
  busy, dirty, problem, canConfig, onAdd, addText, onSave, onReset,
}: {
  busy: boolean;
  dirty: boolean;
  problem: string;
  canConfig: boolean;
  onAdd?: () => void;
  addText?: string;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {onAdd && (
          <button type="button" disabled={busy} onClick={onAdd} className="text-xs text-muted underline disabled:opacity-50">
            {addText}
          </button>
        )}
        <button
          type="button"
          disabled={busy || !dirty || problem !== "" || !canConfig}
          onClick={onSave}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm text-on-brand disabled:opacity-50"
        >
          {busy ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        {dirty && (
          <>
            <button type="button" onClick={onReset} className="text-xs text-muted underline">
              เลิกแก้
            </button>
            <span className="text-xs text-warn">{problem || "ยังไม่ได้บันทึก"}</span>
          </>
        )}
      </div>
      <MissingHint checks={[{ ok: canConfig, label: "สิทธิ์ตั้งค่าบาร์" }]} />
    </>
  );
}
