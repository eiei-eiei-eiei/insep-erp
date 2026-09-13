"use client";

import { useMemo, useState } from "react";
import type { BarBoot } from "../data";
import type { BarMenu } from "@/lib/bar/types";
import { CUSTOM_CATEGORY_ID } from "@/lib/bar/types";
import { menuMode, menuWarning, unsetMenus, cleanRecipe, blankRecipeRow, danglingRows, type RecipeDraftRow } from "@/lib/bar/recipe";
import { lineCost } from "@/lib/bar/cost";
import { searchMenus } from "@/lib/bar/menuFilter";
import { Card, Msg, TextInput, NumBox, Select, Field, Badge, Empty, fmt, useSaver } from "@/lib/shared/ui";
import { saveMenuAction, saveCategoryAction, deleteCategoryAction } from "../actions";

const MODE_LABEL: Record<string, string> = {
  recipe: "มีสูตร",
  fixed: "ต้นทุนตายตัว",
  unset: "ยังไม่ตั้งต้นทุน",
};

/**
 * เมนู & สูตร (D96)
 *
 * 🚨 **แถบรวม "ยังไม่ตั้งต้นทุน N รายการ" ต้องมีเสมอ** — ไม่มีแถบนี้ เมนูโหมด unset
 *    จะค้างตลอดกาลแล้วกำไรพองขึ้นเรื่อย ๆ โดยไม่มีใครรู้ (บทเรียน D83/D86)
 */
export function MenuTab({ boot, onReload }: { boot: BarBoot; onReload: () => Promise<void> }) {
  const data = boot;
  const { msg, setMsg } = useSaver();
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [edit, setEdit] = useState<string | null | "new">(null);
  const [showCats, setShowCats] = useState(false);

  const canWrite = data.canWrite;
  const unset = unsetMenus(data.menus);

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

  const shown = useMemo(() => {
    let list = data.menus;
    if (cat) list = list.filter((m) => m.categoryId === cat);
    return searchMenus(list, q).sort((a, b) => a.name.localeCompare(b.name, "th"));
  }, [data.menus, cat, q]);

  const catName = (id: string) => data.categories.find((c) => c.categoryId === id)?.name ?? id;

  if (!data.entityId) return null;

  return (
    <div className="space-y-4">
      <Msg msg={msg} />

      {/* 🚨 แถบตามเก็บ — ต้องบอกจำนวนและกดเข้าไปดูได้ ไม่ใช่แค่เตือนลอย ๆ */}
      {unset.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setCat("");
            setQ("");
          }}
          className="block w-full rounded-lg bg-warn-bg px-3 py-2 text-left text-sm text-warn"
        >
          ⚠️ เมนูที่ยังไม่ตั้งต้นทุน <b>{unset.length} รายการ</b> — ขายได้แต่{" "}
          <b>ไม่ตัดสต็อกและกำไรจะเกินจริง</b>: {unset.map((m) => m.name).join(" · ")}
        </button>
      )}

      <Card title="เมนู">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นชื่อ · โน้ต · แก้ว" className="max-w-xs" />
          <div className="w-44">
            <Select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">ทุกหมวด</option>
            {data.categories.map((c) => (
              <option key={c.categoryId} value={c.categoryId}>
                {c.name}
              </option>
              ))}
            </Select>
          </div>
          {canWrite && (
            <>
              <button
                type="button"
                onClick={() => setEdit("new")}
                className="rounded-lg bg-raised px-3 py-1.5 text-sm text-ink"
              >
                ＋ เมนูใหม่
              </button>
              <button
                type="button"
                onClick={() => setShowCats((v) => !v)}
                className="ml-auto rounded-lg bg-raised px-3 py-1.5 text-sm text-ink"
              >
                จัดการหมวด
              </button>
            </>
          )}
        </div>

        {showCats && canWrite && <CategoryEditor boot={data} busy={busy} onRun={run} />}

        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>เมนู</th>
                <th>หมวด</th>
                <th className="text-right">ราคา</th>
                {data.canSeeCost && <th className="text-right">ต้นทุน</th>}
                {data.canSeeCost && <th className="text-right">กำไร</th>}
                <th>โหมด</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => {
                const cost = lineCost(
                  { menuId: m.menuId, menuName: m.name, qty: 1, price: m.price },
                  data.menus,
                  data.items,
                );
                const warn = menuWarning(m);
                return (
                  <tr key={m.menuId}>
                    <td>
                      <span className="text-ink">{m.name}</span>
                      {m.note && <div className="text-xs text-muted">{m.note}</div>}
                      {m.glass && <div className="text-xs text-faint">แก้ว: {m.glass}</div>}
                    </td>
                    <td className="text-sm">{catName(m.categoryId)}</td>
                    <td className="text-right">{fmt(m.price)}</td>
                    {data.canSeeCost && <td className="text-right">{fmt(cost)}</td>}
                    {data.canSeeCost && (
                      <td className="text-right">{m.price > 0 ? fmt(m.price - cost) : "—"}</td>
                    )}
                    <td>
                      <Badge tone={menuMode(m) === "unset" ? "warn" : "neutral"}>{MODE_LABEL[menuMode(m)]}</Badge>
                      {warn && menuMode(m) !== "unset" && <div className="text-xs text-warn">{warn}</div>}
                    </td>
                    <td className="text-right">
                      {canWrite && (
                        <button type="button" onClick={() => setEdit(m.menuId)} className="text-xs text-muted underline">
                          แก้
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && <Empty>— ไม่พบเมนู —</Empty>}
      </Card>

      {edit && (
        <MenuModal
          boot={data}
          menuId={edit === "new" ? null : edit}
          busy={busy}
          onClose={() => setEdit(null)}
          onSave={async (input) => {
            if (await run(() => saveMenuAction(input), "บันทึกเมนูแล้ว")) setEdit(null);
          }}
        />
      )}
    </div>
  );
}

function CategoryEditor({
  boot, busy, onRun,
}: {
  boot: BarBoot;
  busy: boolean;
  onRun: (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const count = (id: string) => boot.menus.filter((m) => m.categoryId === id).length;

  return (
    <div className="mb-3 rounded-lg bg-raised p-3">
      <div className="mb-2 text-sm font-medium text-ink">หมวดเมนู (เรียงตามลำดับที่โชว์ในหน้าขาย)</div>
      {boot.categories.map((c) => (
        <div key={c.categoryId} className="flex items-center gap-2 py-0.5 text-sm">
          <TextInput
            defaultValue={c.name}
            onBlur={(e) =>
              e.target.value.trim() !== c.name &&
              onRun(
                () => saveCategoryAction({ categoryId: c.categoryId, name: e.target.value, sort: c.sort }),
                "แก้ชื่อหมวดแล้ว",
              )
            }
            className="w-48"
          />
          <span className="text-muted">{count(c.categoryId)} เมนู</span>
          {c.isSystem ? (
            // ★ หมวด custom เป็นที่ลงจอดของเมนูใหม่จากหน้าขาย → ลบไม่ได้
            //   ปุ่มเทาพร้อมเหตุผล ดีกว่าซ่อนปุ่ม (D86)
            // 🐛 D96 — เดิมเขียนแค่ "หมวดระบบ" ซึ่ง**บอกสถานะแต่ไม่บอกความหมาย**
            //    ผู้ใช้ถามตรง ๆ ว่ามันคืออะไร · คำอธิบายอยู่ใน title= ที่บนมือถือไม่มีทางเห็น
            <span className="text-xs text-faint">
              หมวดตั้งต้นของเมนูที่สร้างจากหน้าขาย — เปลี่ยนชื่อได้ ลบไม่ได้
            </span>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => onRun(() => deleteCategoryAction(c.categoryId), "ลบหมวดแล้ว")}
              className="text-xs text-crit underline disabled:opacity-50"
            >
              ลบ
            </button>
          )}
        </div>
      ))}
      <div className="mt-2 flex gap-2">
        <div className="w-48">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อหมวดใหม่" />
        </div>
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={async () => {
            if (await onRun(() => saveCategoryAction({ name, sort: boot.categories.length }), "เพิ่มหมวดแล้ว"))
              setName("");
          }}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm text-on-brand disabled:opacity-50"
        >
          เพิ่ม
        </button>
      </div>
    </div>
  );
}

function MenuModal({
  boot, menuId, busy, onClose, onSave,
}: {
  boot: BarBoot;
  menuId: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: Parameters<typeof saveMenuAction>[0]) => void;
}) {
  const cur: BarMenu | undefined = boot.menus.find((m) => m.menuId === menuId);
  const [name, setName] = useState(cur?.name ?? "");
  // 🐛 D96 — เดิมเป็น input type=number ดิบ: ลบเลข 0 ที่ค้างอยู่ไม่ได้เลย (ผู้ใช้แจ้งเอง)
  const [price, setPrice] = useState<number | "">(cur?.price ?? "");
  const [categoryId, setCategoryId] = useState(cur?.categoryId ?? CUSTOM_CATEGORY_ID);
  const [useFixed, setUseFixed] = useState(cur ? menuMode(cur) === "fixed" : false);
  const [fixedCost, setFixedCost] = useState<number | "">(cur?.fixedCost ?? "");
  const [glass, setGlass] = useState(cur?.glass ?? "");
  const [method, setMethod] = useState(cur?.method ?? "");
  const [note, setNote] = useState(cur?.note ?? "");
  const [rows, setRows] = useState<RecipeDraftRow[]>(
    cur?.recipe.length ? cur.recipe.map((r) => ({ ...r })) : [blankRecipeRow(), blankRecipeRow()],
  );
  const setRow = (i: number, patch: Partial<RecipeDraftRow>) =>
    setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const recipe = cleanRecipe(rows);
  const nPrice = price === "" ? 0 : price;
  const previewCost = boot.canSeeCost
    ? recipe.reduce((s, r) => s + r.qty * (boot.items.find((i) => i.itemId === r.itemId)?.costPerUnit ?? 0), 0)
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-xl bg-card p-5">
        <h3 className="mb-3 text-lg font-bold text-ink">{cur ? "แก้เมนู" : "เมนูใหม่"}</h3>

        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="ชื่อเมนู">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="ราคาขาย">
            <NumBox value={price} onChange={setPrice} blankZero placeholder="0" />
          </Field>
          <Field label="หมวด">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {boot.categories.map((c) => (
                <option key={c.categoryId} value={c.categoryId}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={useFixed} onChange={(e) => setUseFixed(e.target.checked)} />
          ใช้ต้นทุนตายตัวแทนสูตร (สำหรับอาหาร/กับแกล้มที่คีย์ BOM ไม่คุ้ม)
        </label>

        {useFixed ? (
          <>
            <Field label="ต้นทุนต่อจาน (บาท)">
              <NumBox value={fixedCost} onChange={setFixedCost} blankZero placeholder="0" />
            </Field>
            <p className="text-xs text-faint">โหมดนี้ <b>ไม่ตัดสต็อก</b> — ใช้ตอนที่รู้ต้นทุนแต่ไม่อยากคีย์ส่วนผสม</p>
          </>
        ) : (
          <>
            <div className="mt-3 text-sm font-medium text-muted">สูตร (ตัดสต็อกตามนี้)</div>
            {rows.map((r, i) => (
              // 🐛 D96 (B-8) — เดิมยัด select + ช่องตัวเลข + ปุ่มลัด 4 ปุ่ม ไว้บรรทัดเดียว
              //    บนจอแคบ select ถูกบีบจนอ่านชื่อวัตถุดิบไม่ออก → แยกบรรทัดบนมือถือ
              <div key={i} className="mt-1 flex flex-wrap items-center gap-2">
                <Select
                  value={r.itemId}
                  onChange={(e) => setRow(i, { itemId: e.target.value })}
                  className="w-full sm:w-auto sm:flex-1"
                >
                  <option value="">— เลือกวัตถุดิบ —</option>
                  {boot.items
                    .filter((it) => it.active !== false)
                    .map((it) => (
                      <option key={it.itemId} value={it.itemId}>
                        {it.name} ({it.unit})
                      </option>
                    ))}
                </Select>
                <div className="w-24">
                  <NumBox value={r.qty} onChange={(v) => setRow(i, { qty: v })} blankZero />
                </div>
                <div className="flex gap-1">
                  {[15, 30, 45, 60].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setRow(i, { qty: v })}
                      className="rounded bg-raised px-1.5 text-xs text-muted"
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
                  className="text-xs text-crit underline"
                >
                  ลบ
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRows((p) => [...p, blankRecipeRow()])}
              className="mt-1 text-xs text-muted underline"
            >
              ＋ เพิ่มบรรทัด
            </button>
            {boot.canSeeCost && recipe.length > 0 && (
              <p className="mt-1 text-xs text-muted">
                ต้นทุนตามสูตรตอนนี้ <b>{fmt(previewCost)}</b> บาท ·
                กำไรขั้นต้น <b>{fmt(nPrice - previewCost)}</b> บาท
              </p>
            )}
            {recipe.length === 0 && (
              <p className="mt-1 text-xs text-warn">
                ยังไม่ใส่สูตร — บันทึกได้ แต่เมนูนี้จะ <b>ไม่ตัดสต็อกและต้นทุนเป็น 0</b>
              </p>
            )}
            {/* 🚨 แถวที่กรอกครึ่งเดียวถูกทิ้งเงียบ ๆ ไม่ได้ — ต้องบอกว่ามีกี่แถวและจะเกิดอะไร
                (บทเรียน D79: แถวที่กรอกแต่ราคาไม่กรอกชื่อ เคยล้มการบันทึกโดยไม่บอกว่าแถวไหน) */}
            {danglingRows(rows) > 0 && (
              <p className="mt-1 text-xs text-warn">
                มี <b>{danglingRows(rows)} บรรทัด</b> ที่กรอกไม่ครบ (เลือกวัตถุดิบแต่ไม่ใส่ปริมาณ หรือกลับกัน) —
                บรรทัดพวกนี้จะ <b>ไม่ถูกบันทึก</b>
              </p>
            )}
          </>
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Field label="แก้วที่ใช้">
            <TextInput value={glass} onChange={(e) => setGlass(e.target.value)} list="menu-glass" placeholder="coupe" />
          </Field>
          <datalist id="menu-glass">
            {[...new Set(boot.menus.map((m) => m.glass).filter(Boolean))].map((g) => (
              <option key={String(g)} value={String(g)} />
            ))}
          </datalist>
          <Field label="โน้ต">
            <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="ของพี่โอ๊ต — ลดเวอร์มุท" />
          </Field>
        </div>
        <Field label="วิธีชง">
          <textarea
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            rows={2}
            placeholder="shake 12 วิ · double strain · เหล้าบ๊วยลอยหน้า"
            className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink"
          />
        </Field>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() =>
              onSave({
                menuId,
                name,
                price: nPrice,
                categoryId,
                fixedCost: useFixed ? (fixedCost === "" ? 0 : fixedCost) : null,
                glass,
                method,
                note,
                createdFor: cur?.createdFor ?? null,
                recipe: useFixed ? [] : recipe,
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
