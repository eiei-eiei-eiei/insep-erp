"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BarBoot } from "../data";
import type { BarMenu } from "@/lib/bar/types";
import { CUSTOM_CATEGORY_ID } from "@/lib/bar/types";
import { moveCategory, categoryEditsError, categoryNameUpdates } from "@/lib/bar/categoryOrder";
import { menuMode, menuWarning, unsetMenus, cleanRecipe, blankRecipeRow, draftFromRecipe, type RecipeDraftRow } from "@/lib/bar/recipe";
import { recipeText, refsOf } from "@/lib/bar/houseSlot";
import { RecipeEditor, PriceSuggest } from "./RecipeEditor";
import { lineCost } from "@/lib/bar/cost";
import { searchMenus } from "@/lib/bar/menuFilter";
import { customerLabel } from "@/lib/bar/customerName";
import { Card, TextInput, NumBox, Select, Field, Badge, Empty, fmt, useSaver, useConfirm } from "@/lib/shared/ui";
import {
  saveMenuAction, saveCategoryAction, deleteCategoryAction, saveCategoriesAction,
  getMenuUsageAction, setMenuActiveAction, deleteMenuAction,
} from "../actions";
import { MenuOrderEditor } from "./MenuOrderEditor";
import { menuRemoveState, menuDeleteConfirm, menuToggleDoneText, menuDeletedText, inactiveToggleLabel } from "@/lib/bar/menuRemove";

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
  const { setMsg } = useSaver();
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [edit, setEdit] = useState<string | null | "new">(null);
  const [showCats, setShowCats] = useState(false);
  const [showOrder, setShowOrder] = useState(false);
  // D138 — เมนูที่ปิดใช้ซ่อนไว้ก่อน (ผู้ใช้เลือก) · รหัสเมนูที่เคยขาย/ใช้ทำคอนเทนต์ (null = ยังไม่รู้)
  const [showInactive, setShowInactive] = useState(false);
  const [used, setUsed] = useState<Set<string> | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const { confirmNode, ask } = useConfirm();

  const canWrite = data.canWrite;
  // 🪤 D138 — เมนูที่ปิดใช้ไม่ขึ้นหน้าขายแล้ว ไม่ต้องเตือนให้ตั้งต้นทุน
  const unset = unsetMenus(data.menus.filter((m) => m.active !== false));
  const inactiveCount = data.menus.filter((m) => m.active === false).length;

  const loadUsage = useCallback(async () => {
    if (!data.canConfig) return; // ไม่มีสิทธิ์ลบ = ไม่ต้องรู้
    setUsageLoading(true);
    try {
      const r = await getMenuUsageAction();
      // อ่านไม่ได้ ≠ ไม่เคยขาย (D89) → ปล่อยเป็น null ปุ่มลบเทาพร้อมบอกว่าตรวจไม่ได้
      setUsed(r.ok ? new Set(r.data as string[]) : null);
    } catch {
      setUsed(null);
    } finally {
      setUsageLoading(false);
    }
  }, [data.canConfig]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

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

  /** D111 — ชื่อลูกค้าที่เมนูนี้ถูกสร้างให้ ("" = ไม่ได้สร้างให้ใคร) · รูปแบบชื่อเดียวกับที่อื่นในบาร์ (D97) */
  const ownerOf = (m: BarMenu) =>
    m.createdFor ? customerLabel(data.customers.find((c) => c.customerId === m.createdFor)) : "";

  const shown = useMemo(() => {
    let list = showInactive ? data.menus : data.menus.filter((m) => m.active !== false);
    if (cat) list = list.filter((m) => m.categoryId === cat);
    // D111 — ค้นด้วยชื่อลูกค้าที่เมนูถูกสร้างให้ได้ด้วย
    return searchMenus(list, q, (m) => ownerOf(m)).sort((a, b) => a.name.localeCompare(b.name, "th"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ownerOf อ่านจาก data.customers ที่อยู่ใน deps แล้ว
  }, [data.menus, data.customers, cat, q, showInactive]);

  const catName = (id: string) => data.categories.find((c) => c.categoryId === id)?.name ?? id;

  async function toggleActive(m: BarMenu) {
    const next = m.active === false;
    await run(() => setMenuActiveAction(m.menuId, next), menuToggleDoneText(m.name, next));
  }

  async function removeMenu(m: BarMenu) {
    const c = menuDeleteConfirm(m.name, m.recipe.length > 0);
    if (!(await ask({ ...c, cancelText: "กลับ", danger: true }))) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await deleteMenuAction(m.menuId);
      if (!r.ok) {
        setMsg({ ok: false, text: r.error ?? "ลบเมนูไม่สำเร็จ" });
        return;
      }
      await onReload();
      const d = (r.data ?? {}) as { lab_cards_reset?: number };
      setMsg({ ok: true, text: menuDeletedText(m.name, Number(d.lab_cards_reset ?? 0)) });
    } finally {
      setBusy(false);
      void loadUsage();
    }
  }

  if (!data.entityId) return null;

  return (
    <div className="space-y-4">
      {confirmNode}

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
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นชื่อ · โน้ต · แก้ว · ลูกค้า" className="max-w-xs" />
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
          {inactiveToggleLabel(inactiveCount, showInactive) && (
            <button
              type="button"
              onClick={() => setShowInactive((v) => !v)}
              className="rounded-lg bg-raised px-3 py-1.5 text-sm text-muted"
            >
              {inactiveToggleLabel(inactiveCount, showInactive)}
            </button>
          )}
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
              <button
                type="button"
                onClick={() => setShowOrder((v) => !v)}
                className="rounded-lg bg-raised px-3 py-1.5 text-sm text-ink"
              >
                จัดลำดับบนหน้าขาย
              </button>
            </>
          )}
        </div>

        {showCats && canWrite && <CategoryEditor boot={data} busy={busy} onRun={run} />}
        {showOrder && canWrite && <MenuOrderEditor boot={data} busy={busy} onRun={run} />}

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
                  refsOf(data),
                );
                const warn = menuWarning(m);
                const inactive = m.active === false;
                const rm = menuRemoveState(
                  {
                    name: m.name,
                    active: !inactive,
                    used: used ? used.has(m.menuId) : null,
                    canWrite,
                    canConfig: data.canConfig,
                  },
                  usageLoading,
                );
                return (
                  <tr key={m.menuId} className={inactive ? "opacity-60" : undefined}>
                    <td>
                      <span className="text-ink">{m.name}</span>
                      {inactive && (
                        <span className="ml-2">
                          <Badge tone="neutral">ปิดใช้ · ไม่ขึ้นหน้าขาย</Badge>
                        </span>
                      )}
                      {/* D127 — ผู้ใช้ขอ: แสดงทั้งชื่อช่องเหล้าประจำบ้านและขวดที่ช่องชี้อยู่ตอนนี้ */}
                      {m.recipe.length > 0 && (
                        <div className="text-xs text-muted">{recipeText(m.recipe, data.items, refsOf(data))}</div>
                      )}
                      {m.note && <div className="text-xs text-muted">{m.note}</div>}
                      {m.glass && <div className="text-xs text-faint">แก้ว: {m.glass}</div>}
                      {/* D111 — เดิมเก็บไว้ใน DB แต่ไม่มีหน้าจอไหนแสดงเลย (ตระกูล D74/D101) */}
                      {ownerOf(m) && <div className="text-xs text-muted">สร้างให้: {ownerOf(m)}</div>}
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
                    <td className="whitespace-nowrap text-right text-xs">
                      {canWrite && (
                        <button type="button" onClick={() => setEdit(m.menuId)} className="text-muted underline">
                          แก้
                        </button>
                      )}
                      {rm.showToggle && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void toggleActive(m)}
                          className="ml-3 text-muted underline disabled:opacity-40"
                        >
                          {rm.toggleLabel}
                        </button>
                      )}
                      {rm.showDelete && (
                        <button
                          type="button"
                          disabled={busy || rm.deleteBlocked !== null}
                          title={rm.deleteBlocked ?? undefined}
                          onClick={() => void removeMenu(m)}
                          className="ml-3 text-crit underline disabled:text-faint disabled:no-underline"
                        >
                          ลบ
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

/**
 * จัดการหมวด (D101 → 🔄 D109)
 * ★ ลำดับ + ชื่อ แก้ในจอทั้งหมดแล้วกด **บันทึก** ปุ่มเดียว — ผู้ใช้ขอ: เดิม ▲▼ บันทึกทุกคลิก ต้องรอระบบทุกครั้ง
 *   และแก้ชื่อมีปุ่มบันทึกรายหมวด (ตอนนี้แบบเดียวกับจัดลำดับเมนู D108)
 * 🪤 เพิ่ม/ลบหมวดยังทำงานทันทีแล้วโหลดข้อมูลใหม่ → ถ้ามีที่แก้ค้างจะหายเงียบ ๆ
 *    ⇒ ระหว่างยังไม่บันทึก ปุ่มเพิ่ม/ลบกดไม่ได้ พร้อมบอกเหตุผลบนจอ (D83)
 * 🚨 ลบหมวด = ถามยืนยันก่อน (`useConfirm` — ห้าม window.confirm() เบราว์เซอร์บล็อกแล้วคืน false เงียบ ๆ · D96)
 *    หมวดที่ยังมีเมนู ลบไม่ได้ (FK) → บอกเหตุผลแทนปุ่ม ไม่ต้องรอ server ตอบ error
 * ★ ช่องชื่อเป็น <TextInput> ตรง ๆ ในคอมโพเนนต์นี้ ห้ามประกาศคอมโพเนนต์ซ้อนข้างใน (โฟกัสหลุดทุกตัวอักษร · D71)
 */
function CategoryEditor({
  boot, busy, onRun,
}: {
  boot: BarBoot;
  busy: boolean;
  onRun: (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => Promise<boolean>;
}) {
  const { confirmNode, ask } = useConfirm();
  const [newName, setNewName] = useState("");
  const [order, setOrder] = useState<string[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const count = (id: string) => boot.menus.filter((m) => m.categoryId === id).length;
  const baseIds = boot.categories.map((c) => c.categoryId);
  const ids = order ?? baseIds;
  const byId = new Map(boot.categories.map((c) => [c.categoryId, c]));
  const nameOf = (id: string) => names[id] ?? byId.get(id)?.name ?? "";
  const renamed = categoryNameUpdates(names, new Map(boot.categories.map((c) => [c.categoryId, c.name])));
  const blank = Object.values(names).some((n) => !n.trim());
  const dirty = ids.join("|") !== baseIds.join("|") || renamed.length > 0 || blank;
  const problem = dirty ? categoryEditsError(ids, names, baseIds) : "";
  const reset = () => {
    setOrder(null);
    setNames({});
  };

  const btn =
    "grid h-7 w-7 place-items-center rounded text-muted hover:bg-card hover:text-ink disabled:opacity-30";

  return (
    <div className="mb-3 rounded-lg bg-raised p-3">
      {confirmNode}
      <div className="mb-1 text-sm font-medium text-ink">หมวดเมนู (เรียงตามลำดับที่โชว์ในหน้าขาย)</div>
      <div className="mb-2 text-xs text-muted">
        ▲▼ เลื่อนลำดับ · แก้ชื่อในช่อง · เสร็จแล้วกด <b>บันทึก</b> ทีเดียว
      </div>
      {ids.map((id, i) => {
        const c = byId.get(id);
        if (!c) return null;
        const n = count(id);
        return (
          <div key={id} className="flex flex-wrap items-center gap-2 py-0.5 text-sm">
            <button
              type="button"
              aria-label="เลื่อนขึ้น"
              disabled={busy || i === 0}
              onClick={() => setOrder(moveCategory(ids, id, -1))}
              className={btn}
            >
              ▲
            </button>
            <button
              type="button"
              aria-label="เลื่อนลง"
              disabled={busy || i === ids.length - 1}
              onClick={() => setOrder(moveCategory(ids, id, 1))}
              className={btn}
            >
              ▼
            </button>
            <div className="w-48">
              <TextInput value={nameOf(id)} onChange={(e) => setNames((p) => ({ ...p, [id]: e.target.value }))} />
            </div>
            <span className="text-muted">{n} เมนู</span>
            {c.isSystem ? (
              // ★ หมวด custom เป็นที่ลงจอดของเมนูใหม่จากหน้าขาย → ลบไม่ได้ (บอกเหตุผล ดีกว่าซ่อน · D86/D96)
              <span className="text-xs text-faint">หมวดตั้งต้นของเมนูที่สร้างจากหน้าขาย — เปลี่ยนชื่อได้ ลบไม่ได้</span>
            ) : n > 0 ? (
              <span className="text-xs text-faint">ลบไม่ได้จนกว่าจะย้ายเมนูออกจากหมวดนี้</span>
            ) : (
              <button
                type="button"
                disabled={busy || dirty}
                onClick={async () => {
                  const ok = await ask({
                    title: `ลบหมวด "${c.name}"?`,
                    detail: "หมวดนี้ไม่มีเมนูอยู่แล้ว · ลบแล้วเอากลับคืนไม่ได้ ต้องสร้างใหม่",
                    confirmText: "ลบหมวด",
                    danger: true,
                  });
                  if (ok) await onRun(() => deleteCategoryAction(id), "ลบหมวดแล้ว");
                }}
                className="text-xs text-crit underline disabled:opacity-50"
              >
                ลบ
              </button>
            )}
          </div>
        );
      })}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !dirty || problem !== ""}
          onClick={async () => {
            if (await onRun(() => saveCategoriesAction({ order: ids, names }), "บันทึกหมวดแล้ว")) reset();
          }}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm text-on-brand disabled:opacity-50"
        >
          บันทึก
        </button>
        {dirty && (
          <>
            <button type="button" onClick={reset} className="text-xs text-muted underline">
              เลิกแก้
            </button>
            <span className="text-xs text-warn">{problem || "ยังไม่ได้บันทึก"}</span>
          </>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <div className="w-48">
          <TextInput
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="ชื่อหมวดใหม่"
            disabled={dirty}
          />
        </div>
        <button
          type="button"
          disabled={busy || dirty || !newName.trim()}
          onClick={async () => {
            if (await onRun(() => saveCategoryAction({ name: newName }), "เพิ่มหมวดแล้ว")) setNewName("");
          }}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm text-on-brand disabled:opacity-50"
        >
          เพิ่มหมวด
        </button>
        {dirty && <span className="text-xs text-warn">เพิ่ม/ลบหมวดได้หลังบันทึกหรือเลิกแก้ที่ค้างอยู่</span>}
      </div>
    </div>
  );
}

/**
 * ★ D129 — ห้องทดลองใช้ป๊อปอัพนี้ตอน "ส่งขึ้นเมนูขาย" (`prefill` = ชื่อ + สูตรรอบที่เลือก)
 *   ห้ามก๊อปไปทำป๊อปอัพใหม่ (บทเรียน billItems D42 · แก้ที่หนึ่งแล้วอีกที่ไม่ตาม)
 */
export function MenuModal({
  boot, menuId, busy, onClose, onSave, prefill, title,
}: {
  boot: BarBoot;
  menuId: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: Parameters<typeof saveMenuAction>[0]) => void;
  prefill?: { name: string; rows: RecipeDraftRow[] };
  title?: string;
}) {
  const cur: BarMenu | undefined = boot.menus.find((m) => m.menuId === menuId);
  const [name, setName] = useState(cur?.name ?? prefill?.name ?? "");
  // 🐛 D96 — เดิมเป็น input type=number ดิบ: ลบเลข 0 ที่ค้างอยู่ไม่ได้เลย (ผู้ใช้แจ้งเอง)
  const [price, setPrice] = useState<number | "">(cur?.price ?? "");
  const [categoryId, setCategoryId] = useState(cur?.categoryId ?? CUSTOM_CATEGORY_ID);
  const [useFixed, setUseFixed] = useState(cur ? menuMode(cur) === "fixed" : false);
  const [fixedCost, setFixedCost] = useState<number | "">(cur?.fixedCost ?? "");
  const [glass, setGlass] = useState(cur?.glass ?? "");
  const [method, setMethod] = useState(cur?.method ?? "");
  const [note, setNote] = useState(cur?.note ?? "");
  // D111 — แก้/เอาออกได้ (สร้างจากบิลผิดคน = เดิมแก้ไม่ได้เลย)
  const [createdFor, setCreatedFor] = useState(cur?.createdFor ?? "");
  const [rows, setRows] = useState<RecipeDraftRow[]>(
    cur?.recipe.length
      ? draftFromRecipe(cur.recipe)
      : prefill?.rows.length
        ? prefill.rows.map((r) => ({ ...r }))
        : [blankRecipeRow(), blankRecipeRow()],
  );
  const recipe = cleanRecipe(rows);
  const nPrice = price === "" ? 0 : price;
  const isVat = boot.seller?.isVat ?? false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-xl bg-card p-5">
        <h3 className="mb-3 text-lg font-bold text-ink">{title ?? (cur ? "แก้เมนู" : "เมนูใหม่")}</h3>

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
            {fixedCost !== "" && fixedCost > 0 && (
              <PriceSuggest cost={fixedCost} canSeeCost={boot.canSeeCost} isVat={isVat} price={price} onUsePrice={setPrice} />
            )}
          </>
        ) : (
          <>
            <RecipeEditor
              items={boot.items}
              slots={boot.houseSlots}
              garnishes={boot.garnishes}
              rows={rows}
              setRows={setRows}
              canSeeCost={boot.canSeeCost}
              isVat={isVat}
              price={price}
              onUsePrice={setPrice}
            />
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
        <Field label="สร้างให้ลูกค้า">
          <Select value={createdFor} onChange={(e) => setCreatedFor(e.target.value)}>
            <option value="">— ไม่ได้สร้างให้ใคร —</option>
            {boot.customers.map((c) => (
              <option key={c.customerId} value={c.customerId}>
                {customerLabel(c)}
              </option>
            ))}
          </Select>
        </Field>
        <p className="-mt-1 text-xs text-faint">
          แค่ป้ายบอกที่มา + ใช้กับชิป &quot;ดูเฉพาะเมนูของ…&quot; ในหน้าขาย · ลูกค้าคนอื่นยังสั่งเมนูนี้ได้ตามปกติ
        </p>
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
                createdFor: createdFor || null,
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
