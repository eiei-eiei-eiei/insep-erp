"use client";

/**
 * ช่องสูตร + ต้นทุน + ราคาแนะนำ — ใช้ร่วมทั้ง "เมนูใหม่" ในแท็บขาย และ "เมนู & สูตร" (D110)
 *
 * 🚨 เดิมสองหน้ามีช่องสูตรคนละชุดที่ก๊อปกันมา (หน้าขายไม่มีปุ่มลบบรรทัด/ไม่โชว์ต้นทุน) — ตอนนี้ชุดเดียว
 *    ห้ามก๊อปกลับไปแยกอีก (บทเรียน billItems D42 · แก้ที่หนึ่งแล้วอีกที่ไม่ตาม)
 * ★ ช่องวัตถุดิบ **พิมพ์ค้นได้** (ผู้ใช้ขอ — ไล่หาในรายการยาวยาก) — `<datalist>` ของเบราว์เซอร์
 *   ขึ้นตัวเลือกตามที่พิมพ์ ใช้ได้ทั้งคอมและมือถือ · id ของ datalist มาจาก `useId()`
 *   🪤 id ซ้ำข้ามแท็บที่ mount ค้าง = ผูกเข้ารายการของอีกแท็บเงียบ ๆ (D77)
 * 🚨 พิมพ์ไม่ตรงวัตถุดิบไหน = **ยังไม่ได้เลือก** และบอกบนจอ — ไม่เดาจากคำบางส่วน (`matchRef`)
 * ★ การตัดสิน/สูตรทั้งหมดอยู่ที่ lib/bar/menuPricing.ts (golden B19) — ที่นี่แค่วาด
 *
 * ── D127 ──────────────────────────────────────────────────────────────────────
 * · บรรทัดอ้าง **ช่องเหล้าประจำบ้าน** ได้ (พิมพ์ชื่อช่อง หรือกดปุ่มลัด House) — ต้นทุนคิดจากขวดที่ช่องชี้อยู่
 * · แถบปุ่มลัด 3 กลุ่ม (House / ใช้บ่อย / ตกแต่ง) — ตรรกะอยู่ที่ lib/bar/quickPick.ts (golden B24)
 *   กดแล้วโฟกัสช่องจำนวนของบรรทัดนั้นให้ (มือถือ = คีย์บอร์ดตัวเลขขึ้นทันที)
 * · บรรทัดซ้ำรวมเป็นบรรทัดเดียวตอนบันทึก (`cleanRecipe`) — บอกบนจอด้วย `duplicateRows`
 */
import { useEffect, useId, useRef, useState } from "react";
import type { BarGarnish, BarItem, HouseSlot } from "@/lib/bar/types";
import { blankRecipeRow, cleanRecipe, danglingRows, duplicateRows, type RecipeDraftRow } from "@/lib/bar/recipe";
import {
  costPct,
  itemLabel,
  matchRef,
  normalizeTargetPct,
  recipeCost,
  suggestPrice,
  DEFAULT_TARGET_PCT,
} from "@/lib/bar/menuPricing";
import { resolveRecipe, slotOption } from "@/lib/bar/houseSlot";
import { applyPick, quickChips, type QuickChip, type QuickPick } from "@/lib/bar/quickPick";
import { NumBox, TextInput, fmt } from "@/lib/shared/ui";

const TARGET_KEY = "bar:targetCostPct";

export function RecipeEditor({
  items,
  slots,
  garnishes,
  rows,
  setRows,
  canSeeCost,
  isVat,
  price,
  onUsePrice,
  mode = "menu",
}: {
  /**
   * D129 — "lab" = ป๊อปอัพลองชงในห้องทดลอง: ไม่มีประโยค "บันทึกได้แต่ไม่ตัดสต็อก" (ที่นั่นบันทึกไม่ได้ถ้าไม่มีสูตร)
   * และไม่มีราคาแนะนำ/ปุ่มใช้ราคานี้ (ไม่มีช่องราคา — ปุ่มที่กดแล้วไม่เกิดอะไรแย่กว่าไม่มีปุ่ม) โชว์แค่ทุนต่อแก้ว
   * D130 — "prep" = สูตร/ล็อตของทำเอง: ไม่มีทั้งประโยคของเมนูและกล่องทุน (ทุนต่อหน่วยขึ้นกับปริมาณที่ได้ — ผู้เรียกโชว์เอง)
   */
  mode?: "menu" | "lab" | "prep";
  items: readonly BarItem[];
  slots: readonly HouseSlot[];
  garnishes: readonly BarGarnish[];
  rows: RecipeDraftRow[];
  setRows: (fn: (p: RecipeDraftRow[]) => RecipeDraftRow[]) => void;
  canSeeCost: boolean;
  isVat: boolean;
  price: number | "";
  onUsePrice: (p: number) => void;
}) {
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [focusAt, setFocusAt] = useState<number | null>(null);
  const active = items.filter((it) => it.active !== false);
  const byId = new Map(items.map((it) => [it.itemId, it]));
  const bySlot = new Map(slots.map((s) => [s.slotId, s]));
  const setRow = (i: number, patch: Partial<RecipeDraftRow>) =>
    setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const recipe = cleanRecipe(rows);
  const cost = recipeCost(resolveRecipe(recipe, slots).lines, items);
  const dangling = danglingRows(rows);
  const dup = duplicateRows(rows);
  const chips = quickChips(slots, items, garnishes);

  // กดปุ่มลัด → โฟกัสช่องจำนวนของบรรทัดนั้น (หลังวาดแถวใหม่เสร็จ)
  useEffect(() => {
    if (focusAt === null) return;
    const el = box.current?.querySelector<HTMLInputElement>(`[data-qty-row="${focusAt}"] input`);
    if (el) {
      el.focus();
      el.select();
    }
    setFocusAt(null);
  }, [focusAt, rows]);

  function pick(p: QuickPick) {
    const r = applyPick(rows, p);
    setRows(() => r.rows);
    setFocusAt(r.focus);
  }

  /** ขวดที่บรรทัดนี้จะตัดจริง — บรรทัดช่อง = ขวดที่ช่องชี้อยู่ตอนนี้ */
  const rowItem = (r: RecipeDraftRow) => {
    if (r.slotId) {
      const s = bySlot.get(r.slotId);
      return s ? byId.get(s.itemId) : undefined;
    }
    return r.itemId ? byId.get(r.itemId) : undefined;
  };

  return (
    <div ref={box}>
      <div className="mt-3 text-sm font-medium text-muted">สูตร (ตัดสต็อกตามนี้)</div>
      <QuickBar chips={chips} onPick={pick} />
      <datalist id={listId}>
        {slots.map((s) => (
          <option key={s.slotId} value={slotOption(s)} />
        ))}
        {active.map((it) => (
          <option key={it.itemId} value={itemLabel(it)} />
        ))}
      </datalist>
      {rows.map((r, i) => {
        const slot = r.slotId ? bySlot.get(r.slotId) : undefined;
        const it = rowItem(r);
        const shown = r.text ?? (slot ? slotOption(slot) : it ? itemLabel(it) : "");
        const qty = r.qty === "" ? 0 : r.qty;
        const picked = Boolean(r.itemId || r.slotId);
        return (
          // 🐛 D96 (B-8) — บนจอแคบช่องวัตถุดิบเต็มบรรทัด ปริมาณ/ปุ่มลัดลงบรรทัดถัดไป
          <div key={i} className="mt-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-40 flex-1">
                <TextInput
                  value={shown}
                  list={listId}
                  placeholder="พิมพ์ชื่อวัตถุดิบ / เหล้าประจำบ้าน…"
                  onChange={(e) => {
                    const m = matchRef(e.target.value, active, slots);
                    setRow(i, { text: e.target.value, itemId: m.itemId, slotId: m.slotId });
                  }}
                />
              </div>
              <div className="w-24" data-qty-row={i}>
                <NumBox value={r.qty} onChange={(v) => setRow(i, { qty: v })} blankZero placeholder="ปริมาณ" />
              </div>
              <div className="flex gap-1">
                {[15, 30, 45, 60].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setRow(i, { qty: v })}
                    className="rounded bg-raised px-2 py-1 text-xs text-muted"
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
            {shown.trim() && !picked ? (
              <div className="mt-0.5 text-xs text-warn">
                ยังไม่ได้เลือก — พิมพ์แล้วเลือกจากรายการที่ขึ้นมา (ไม่มีในรายการ = ยังไม่ได้เพิ่มที่แท็บสต็อก)
              </div>
            ) : (
              picked && (
                <div className="mt-0.5 text-xs text-muted">
                  {slot && (
                    <span>
                      ตอนนี้ตัด <b className="text-ink">{it ? `${it.name} (${it.unit})` : "— ไม่พบขวด"}</b> ·
                      เปลี่ยนขวดได้ที่แท็บตั้งค่าบาร์{canSeeCost && it && qty > 0 ? " · " : ""}
                    </span>
                  )}
                  {canSeeCost &&
                    it &&
                    qty > 0 &&
                    (it.costPerUnit > 0 ? (
                      <>ต้นทุน {fmt(Math.round(qty * it.costPerUnit * 100) / 100)} บาท</>
                    ) : (
                      <span className="text-warn">วัตถุดิบนี้ยังไม่มีต้นทุน (ยังไม่เคยรับของเข้า)</span>
                    ))}
                </div>
              )
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => setRows((p) => [...p, blankRecipeRow()])}
        className="mt-2 text-xs text-muted underline"
      >
        ＋ เพิ่มบรรทัด
      </button>

      {recipe.length === 0 && mode === "menu" && (
        <p className="mt-2 text-xs text-warn">
          ยังไม่ใส่สูตร — บันทึกได้ แต่เมนูนี้จะ <b>ไม่ตัดสต็อกและต้นทุนเป็น 0</b>
        </p>
      )}
      {/* 🚨 แถวที่กรอกครึ่งเดียวถูกทิ้งเงียบ ๆ ไม่ได้ — บอกว่ามีกี่แถวและจะเกิดอะไร (D79) */}
      {dangling > 0 && (
        <p className="mt-1 text-xs text-warn">
          มี <b>{dangling} บรรทัด</b> ที่กรอกไม่ครบ (เลือกวัตถุดิบแต่ไม่ใส่ปริมาณ หรือกลับกัน) — บรรทัดพวกนี้จะ{" "}
          <b>ไม่ถูกบันทึก</b>
        </p>
      )}
      {/* D127 — เดิมบรรทัดซ้ำทำให้บันทึกพังด้วยข้อความกำกวม ตอนนี้รวมให้ แต่ต้องบอก */}
      {dup > 0 && (
        <p className="mt-1 text-xs text-warn">
          มี <b>{dup} บรรทัด</b> ที่เลือกของซ้ำกับบรรทัดอื่น — ตอนบันทึกจะ <b>รวมปริมาณเป็นบรรทัดเดียว</b>
        </p>
      )}

      {recipe.length > 0 && mode === "lab" && canSeeCost && (
        <div className="mt-3 rounded-lg bg-raised p-3 text-sm text-ink">
          ทุนต่อแก้ว <b>{fmt(cost.total)}</b> บาท
          {cost.missing > 0 && (
            <div className="mt-1 text-xs text-warn">
              มี {cost.missing} วัตถุดิบที่ยังไม่มีต้นทุน — ทุนที่เห็น <b>ต่ำกว่าความจริง</b>
            </div>
          )}
        </div>
      )}
      {recipe.length > 0 && mode === "menu" && (
        <PriceSuggest
          cost={cost.total}
          missing={cost.missing}
          canSeeCost={canSeeCost}
          isVat={isVat}
          price={price}
          onUsePrice={onUsePrice}
        />
      )}
    </div>
  );
}

/**
 * แถบปุ่มลัด 3 กลุ่ม — กลุ่มที่ว่างไม่แสดง · ว่างทั้งหมด = บอกว่าตั้งได้ที่ไหน (D92: ระบบไม่ทำอะไรให้ ต้องบอกว่าทำไม)
 * ★ ปุ่มสูง 44px บนจอแคบ (DESIGN_SYSTEM · touch target) · ขึ้นบรรทัดใหม่เองเมื่อจอแคบ
 */
function QuickBar({ chips, onPick }: { chips: ReturnType<typeof quickChips>; onPick: (p: QuickPick) => void }) {
  const groups: [string, QuickChip[]][] = [
    ["House", chips.house],
    ["ใช้บ่อย", chips.pinned],
    ["ตกแต่ง", chips.garnish],
  ];
  if (groups.every(([, g]) => g.length === 0)) {
    return (
      <p className="mt-1 text-xs text-faint">
        ตั้งปุ่มลัด (เหล้าประจำบ้าน · วัตถุดิบใช้บ่อย · ชุดตกแต่ง) ได้ที่แท็บ ตั้งค่าบาร์
      </p>
    );
  }
  return (
    <div className="mt-2 space-y-1.5">
      {groups.map(
        ([label, list]) =>
          list.length > 0 && (
            <div key={label} className="flex flex-wrap items-center gap-1.5">
              <span className="w-14 shrink-0 text-xs text-faint">{label}</span>
              {list.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  title={c.hint}
                  // title อย่างเดียว = โปรแกรมอ่านหน้าจออ่านคำอธิบายแทนชื่อปุ่ม (เจอตอนเทสเบราว์เซอร์)
                  aria-label={`${c.label} — ${c.hint}`}
                  onClick={() => onPick(c.pick)}
                  className="min-h-[44px] rounded-full border border-line bg-card px-3 py-1 text-xs text-ink hover:bg-raised sm:min-h-0"
                >
                  {c.label}
                </button>
              ))}
            </div>
          ),
      )}
    </div>
  );
}

/**
 * ต้นทุนรวม + % ต้นทุนที่ราคาปัจจุบัน + ราคาแนะนำ (ใช้กับโหมดต้นทุนตายตัวได้ด้วย)
 * ★ % เป้าหมายแก้ได้ในกล่องนี้ (ผู้ใช้เลือก) · เครื่องจำค่าล่าสุด (localStorage — ค่าสะดวกต่อเครื่อง ไม่ใช่ข้อมูลร้าน)
 * ★ ไม่เขียนทับราคาเอง — ต้องกด "ใช้ราคานี้"
 */
export function PriceSuggest({
  cost,
  missing = 0,
  canSeeCost,
  isVat,
  price,
  onUsePrice,
}: {
  cost: number;
  missing?: number;
  canSeeCost: boolean;
  isVat: boolean;
  price: number | "";
  onUsePrice: (p: number) => void;
}) {
  const [target, setTarget] = useState<number | "">(DEFAULT_TARGET_PCT);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TARGET_KEY);
      if (saved) setTarget(normalizeTargetPct(saved));
    } catch {
      // private mode / ถูกบล็อก — ใช้ค่าปริยาย
    }
  }, []);

  if (!canSeeCost) {
    return (
      <p className="mt-2 text-xs text-muted">ต้นทุนและราคาแนะนำ เห็นเฉพาะผู้มีสิทธิ์ตั้งค่าบาร์</p>
    );
  }

  const pct = normalizeTargetPct(target);
  const suggest = suggestPrice(cost, pct, isVat);
  const nPrice = price === "" ? 0 : price;
  const actual = costPct(nPrice, cost, isVat);

  return (
    <div className="mt-3 rounded-lg bg-raised p-3 text-sm">
      <div className="text-ink">
        ต้นทุนต่อแก้ว <b>{fmt(cost)}</b> บาท
        {nPrice > 0 && actual !== null && (
          <span className="text-muted">
            {" "}
            · ที่ราคา {fmt(nPrice)} ต้นทุนเป็น <b>{actual}%</b> · กำไรขั้นต้น {fmt(nPrice - cost)} บาท
          </span>
        )}
      </div>
      {missing > 0 && (
        <div className="mt-1 text-xs text-warn">
          มี {missing} วัตถุดิบที่ยังไม่มีต้นทุน — ต้นทุนรวมและราคาแนะนำ <b>ต่ำกว่าความจริง</b>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-muted">ให้ต้นทุนเป็น</span>
        <div className="w-16">
          <NumBox
            value={target}
            onChange={(v) => {
              setTarget(v);
              try {
                if (v !== "") localStorage.setItem(TARGET_KEY, String(v));
              } catch {
                // ไม่จำก็ไม่เป็นไร
              }
            }}
          />
        </div>
        <span className="text-muted">% ของราคาขาย →</span>
        {suggest !== null ? (
          <>
            <span className="text-ink">
              ราคาแนะนำ <b>{fmt(suggest)}</b> บาท
            </span>
            <button
              type="button"
              disabled={nPrice === suggest}
              onClick={() => onUsePrice(suggest)}
              className="rounded-lg bg-brand px-2.5 py-1 text-xs text-on-brand disabled:opacity-50"
            >
              ใช้ราคานี้
            </button>
          </>
        ) : (
          <span className="text-muted">— (ยังไม่มีต้นทุนให้คิด)</span>
        )}
      </div>
      <div className="mt-1 text-xs text-faint">
        ปัดขึ้นหลัก 10
        {isVat ? " · ร้านจด VAT: คิด % จากยอดก่อน VAT แล้วบวก VAT 7% กลับเข้าราคาป้าย" : ""}
      </div>
    </div>
  );
}
