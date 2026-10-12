"use client";

/**
 * ช่องสูตร + ต้นทุน + ราคาแนะนำ — ใช้ร่วมทั้ง "เมนูใหม่" ในแท็บขาย และ "เมนู & สูตร" (D110)
 *
 * 🚨 เดิมสองหน้ามีช่องสูตรคนละชุดที่ก๊อปกันมา (หน้าขายไม่มีปุ่มลบบรรทัด/ไม่โชว์ต้นทุน) — ตอนนี้ชุดเดียว
 *    ห้ามก๊อปกลับไปแยกอีก (บทเรียน billItems D42 · แก้ที่หนึ่งแล้วอีกที่ไม่ตาม)
 * ★ ช่องวัตถุดิบ **พิมพ์ค้นได้** (ผู้ใช้ขอ — ไล่หาในรายการยาวยาก) — `<datalist>` ของเบราว์เซอร์
 *   ขึ้นตัวเลือกตามที่พิมพ์ ใช้ได้ทั้งคอมและมือถือ · id ของ datalist มาจาก `useId()`
 *   🪤 id ซ้ำข้ามแท็บที่ mount ค้าง = ผูกเข้ารายการของอีกแท็บเงียบ ๆ (D77)
 * 🚨 พิมพ์ไม่ตรงวัตถุดิบไหน = **ยังไม่ได้เลือก** และบอกบนจอ — ไม่เดาจากคำบางส่วน (`matchItem`)
 * ★ การตัดสิน/สูตรทั้งหมดอยู่ที่ lib/bar/menuPricing.ts (golden B19) — ที่นี่แค่วาด
 */
import { useEffect, useId, useState } from "react";
import type { BarItem } from "@/lib/bar/types";
import { blankRecipeRow, cleanRecipe, danglingRows, type RecipeDraftRow } from "@/lib/bar/recipe";
import {
  costPct,
  itemLabel,
  matchItem,
  normalizeTargetPct,
  recipeCost,
  suggestPrice,
  DEFAULT_TARGET_PCT,
} from "@/lib/bar/menuPricing";
import { NumBox, TextInput, fmt } from "@/lib/shared/ui";

const TARGET_KEY = "bar:targetCostPct";

export function RecipeEditor({
  items,
  rows,
  setRows,
  canSeeCost,
  isVat,
  price,
  onUsePrice,
}: {
  items: readonly BarItem[];
  rows: RecipeDraftRow[];
  setRows: (fn: (p: RecipeDraftRow[]) => RecipeDraftRow[]) => void;
  canSeeCost: boolean;
  isVat: boolean;
  price: number | "";
  onUsePrice: (p: number) => void;
}) {
  const listId = useId();
  const active = items.filter((it) => it.active !== false);
  const byId = new Map(items.map((it) => [it.itemId, it]));
  const setRow = (i: number, patch: Partial<RecipeDraftRow>) =>
    setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const recipe = cleanRecipe(rows);
  const cost = recipeCost(recipe, items);
  const costByItem = new Map(cost.lines.map((l) => [l.itemId, l]));
  const dangling = danglingRows(rows);

  return (
    <>
      <div className="mt-3 text-sm font-medium text-muted">สูตร (ตัดสต็อกตามนี้)</div>
      <datalist id={listId}>
        {active.map((it) => (
          <option key={it.itemId} value={itemLabel(it)} />
        ))}
      </datalist>
      {rows.map((r, i) => {
        const it = r.itemId ? byId.get(r.itemId) : undefined;
        const shown = r.text ?? (it ? itemLabel(it) : "");
        const line = r.itemId && r.qty !== "" && r.qty > 0 ? costByItem.get(r.itemId) : undefined;
        return (
          // 🐛 D96 (B-8) — บนจอแคบช่องวัตถุดิบเต็มบรรทัด ปริมาณ/ปุ่มลัดลงบรรทัดถัดไป
          <div key={i} className="mt-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-40 flex-1">
                <TextInput
                  value={shown}
                  list={listId}
                  placeholder="พิมพ์ชื่อวัตถุดิบ…"
                  onChange={(e) => setRow(i, { text: e.target.value, itemId: matchItem(e.target.value, active) })}
                />
              </div>
              <div className="w-24">
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
            {shown.trim() && !r.itemId ? (
              <div className="mt-0.5 text-xs text-warn">
                ยังไม่ได้เลือก — พิมพ์แล้วเลือกจากรายการที่ขึ้นมา (ไม่มีในรายการ = ยังไม่ได้เพิ่มที่แท็บสต็อก)
              </div>
            ) : (
              canSeeCost &&
              line && (
                <div className="mt-0.5 text-xs text-muted">
                  {line.noCost ? (
                    <span className="text-warn">วัตถุดิบนี้ยังไม่มีต้นทุน (ยังไม่เคยรับของเข้า)</span>
                  ) : (
                    <>
                      ต้นทุน {fmt(line.cost)} บาท
                    </>
                  )}
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

      {recipe.length === 0 && (
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

      {recipe.length > 0 && (
        <PriceSuggest
          cost={cost.total}
          missing={cost.missing}
          canSeeCost={canSeeCost}
          isVat={isVat}
          price={price}
          onUsePrice={onUsePrice}
        />
      )}
    </>
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
