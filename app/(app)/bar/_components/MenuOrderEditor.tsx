"use client";

/**
 * จัดลำดับเมนูบนหน้าขาย ▲▼ (D108)
 *
 * ★ แต่ละหน้าตั้งแยกกัน (ผู้ใช้เลือก) — หน้า "ทั้งหมด" กับแต่ละหมวดมีลำดับของตัวเอง
 * ★ แก้ในจอก่อน แล้วกด **บันทึกลำดับ** ทีเดียว (ไม่บันทึกทุกครั้งที่กด ▲▼ —
 *   เลื่อนเมนูหนึ่งข้าม 10 ตำแหน่ง = 10 รอบเรียก server · และกดพลาดยังกด เลิกแก้ ได้)
 * ★ ยอดขาย 30 วันโชว์ข้างชื่อ **ช่วยตัดสินใจเท่านั้น** ไม่ได้ใช้เรียง (ผู้ใช้เลือกจัดเองทั้งหมด)
 * 🚨 การตัดสิน/ประโยคอยู่ใน lib/bar/menuOrder.ts ที่มีเทสคุม
 */
import { useEffect, useMemo, useState } from "react";
import type { BarBoot } from "../data";
import { CUSTOM_CATEGORY_ID } from "@/lib/bar/types";
import {
  ALL_VIEW,
  moveMenu,
  moveMenuToTop,
  orderLockedReason,
  orderableMenus,
  salesHint,
  type OrderView,
} from "@/lib/bar/menuOrder";
import { Select } from "@/lib/shared/ui";
import { getMenuSalesAction, reorderMenusAction } from "../actions";

const DAYS = 30;

export function MenuOrderEditor({
  boot,
  busy,
  onRun,
}: {
  boot: BarBoot;
  busy: boolean;
  onRun: (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => Promise<boolean>;
}) {
  const [view, setView] = useState<OrderView>(ALL_VIEW);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [sales, setSales] = useState<Record<string, number> | null>(null);
  const [salesErr, setSalesErr] = useState("");

  useEffect(() => {
    let alive = true;
    void getMenuSalesAction(DAYS).then((r) => {
      if (!alive) return;
      if (r.ok) setSales(r.data ?? {});
      else setSalesErr(r.error ?? "");
    });
    return () => {
      alive = false;
    };
  }, []);

  const base = useMemo(() => orderableMenus(boot.menus, view), [boot.menus, view]);
  const baseIds = base.map((m) => m.menuId);
  const ids = draft ?? baseIds;
  const byId = new Map(boot.menus.map((m) => [m.menuId, m]));
  const dirty = draft !== null && draft.join("|") !== baseIds.join("|");
  const locked = orderLockedReason(view);
  const catName = (id: string) => boot.categories.find((c) => c.categoryId === id)?.name ?? id;

  const btn =
    "grid h-7 w-7 place-items-center rounded text-muted hover:bg-card hover:text-ink disabled:opacity-30";

  return (
    <div className="mb-3 rounded-lg bg-raised p-3">
      <div className="mb-1 text-sm font-medium text-ink">จัดลำดับเมนูบนหน้าขาย</div>
      <div className="mb-2 text-xs text-muted">
        เลือกหน้า แล้วใช้ ▲▼ หรือ ⤒ (ขึ้นบนสุด) · กด <b>บันทึกลำดับ</b> เมื่อเสร็จ ·{" "}
        <b>แต่ละหน้าตั้งแยกกัน</b> — จัดหน้า &quot;ทั้งหมด&quot; ไม่มีผลกับหน้าหมวด · เมนูใหม่จะต่อท้ายเอง
      </div>

      <div className="mb-2 w-60">
        {/* 🪤 เปลี่ยนหน้าระหว่างแก้ = ลำดับที่จัดไว้หายเงียบ ๆ → ล็อกจนกว่าจะบันทึก/เลิกแก้ */}
        <Select
          value={view}
          disabled={dirty}
          onChange={(e) => {
            setView(e.target.value);
            setDraft(null);
          }}
        >
          <option value={ALL_VIEW}>หน้า &quot;ทั้งหมด&quot;</option>
          {boot.categories.map((c) => (
            <option key={c.categoryId} value={c.categoryId}>
              หมวด {c.name}
            </option>
          ))}
        </Select>
      </div>

      {locked ? (
        <div className="text-sm text-muted">{locked}</div>
      ) : ids.length === 0 ? (
        <div className="text-sm text-muted">— หน้านี้ยังไม่มีเมนูที่เปิดใช้ —</div>
      ) : (
        <>
          <ol className="space-y-0.5">
            {ids.map((id, i) => {
              const m = byId.get(id);
              if (!m) return null;
              return (
                // 🐛 เดิม flex-wrap ทั้งแถว → ชื่อยาวตกไปบรรทัดใหม่ทั้งก้อน ปุ่มค้างอยู่บรรทัดบนเปล่า ๆ (ผู้ใช้แจ้ง)
                // → ปุ่มเป็นคอลัมน์กว้างคงที่ทางซ้าย · ชื่อกินที่ที่เหลือแล้วตัดบรรทัด**ในคอลัมน์ตัวเอง**
                //   หมวด + ยอดขายเป็นบรรทัดเล็กใต้ชื่อ (ไม่ลอยไปมาตามความยาวชื่อ)
                <li key={id} className="flex items-start gap-1.5 border-b border-line py-1.5 text-sm last:border-b-0">
                  <span className="w-6 shrink-0 pt-1 text-right text-faint">{i + 1}</span>
                  <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    aria-label="ขึ้นบนสุด"
                    title="ขึ้นบนสุด"
                    disabled={busy || i === 0}
                    onClick={() => setDraft(moveMenuToTop(ids, id))}
                    className={btn}
                  >
                    ⤒
                  </button>
                  <button
                    type="button"
                    aria-label="เลื่อนขึ้น"
                    disabled={busy || i === 0}
                    onClick={() => setDraft(moveMenu(ids, id, -1))}
                    className={btn}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label="เลื่อนลง"
                    disabled={busy || i === ids.length - 1}
                    onClick={() => setDraft(moveMenu(ids, id, 1))}
                    className={btn}
                  >
                    ▼
                  </button>
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="break-words text-ink">{m.name}</div>
                    {(view === ALL_VIEW || sales) && (
                      <div className="text-xs text-muted">
                        {[view === ALL_VIEW ? catName(m.categoryId) : "", sales ? salesHint(sales[id], DAYS) : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {salesErr && <div className="mt-1 text-xs text-muted">{salesErr}</div>}
          {view === ALL_VIEW && boot.menus.some((m) => m.categoryId === CUSTOM_CATEGORY_ID && m.active !== false) && (
            <div className="mt-1 text-xs text-muted">
              เมนูที่คิดหน้าบาร์ (หมวด {catName(CUSTOM_CATEGORY_ID)}) อยู่ท้ายหน้านี้เสมอ เรียงตามที่สั่งล่าสุด
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || !dirty}
              onClick={async () => {
                if (await onRun(() => reorderMenusAction(view, ids), "บันทึกลำดับเมนูแล้ว")) setDraft(null);
              }}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm text-on-brand disabled:opacity-50"
            >
              บันทึกลำดับ
            </button>
            {dirty && (
              <>
                <button type="button" onClick={() => setDraft(null)} className="text-xs text-muted underline">
                  เลิกแก้
                </button>
                <span className="text-xs text-warn">ยังไม่ได้บันทึก — บันทึกหรือเลิกแก้ก่อนเปลี่ยนหน้า</span>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
