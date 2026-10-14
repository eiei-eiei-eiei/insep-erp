"use client";

/**
 * รายการ "ในบิลแล้ว" + แก้ลูกค้า/ชื่อบิล (D112 · 0082)
 *
 * ผู้ใช้ถาม: รายการที่ส่งเข้าบิลไปแล้วกดลด/กดแถมได้ไหม · บิลที่เปิดไปแล้วแก้ลูกค้าได้ไหม
 * ★ เดิมทำได้อย่างเดียวคือยกเลิกรายการ — ตอนนี้แก้ส่วนลด (บาท/%) และแถมได้ ด้วยสิทธิ์เดียวกับตอนอยู่ในถาด
 * ★ ไม่แตะสต็อก (ตัดไปแล้วตอนส่งเข้าบิล) · ยอดรายการ server คิดจาก qty/ราคาใน DB ไม่ใช่จากจอ
 * ★ แก้ในจอก่อน แล้วกด **บันทึก** — พรีวิวยอดใช้ `resolveLine` + `lineAmount` ตัวเดียวกับ server
 * 🚨 ประกาศคอมโพเนนต์ที่ระดับไฟล์เสมอ (ประกาศข้างในคอมโพเนนต์อื่น = ช่องกรอกโฟกัสหลุดทุกตัวอักษร · D71)
 */
import { useState } from "react";
import type { BarCustomerRow, BarSaleLine } from "../data";
import { resolveLine } from "@/lib/bar/discount";
import { lineAmount } from "@/lib/bar/totals";
import { customerLabel } from "@/lib/bar/customerName";
import { NumBox, Select, TextInput, fmt } from "@/lib/shared/ui";
import { IconEdit, IconTrash } from "@/lib/shared/icons";

type LinePatch = { lineDiscount: number; lineDiscountPct: number | null; isComp: boolean };

export function BilledLineRow({
  line,
  canWrite,
  busy,
  onSave,
  onVoid,
}: {
  line: BarSaleLine;
  canWrite: boolean;
  busy: boolean;
  onSave: (patch: LinePatch) => Promise<boolean>;
  onVoid: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<LinePatch>({
    lineDiscount: line.lineDiscount,
    lineDiscountPct: line.lineDiscountPct,
    isComp: line.isComp,
  });
  const mode: "baht" | "pct" = draft.lineDiscountPct != null ? "pct" : "baht";
  const preview = resolveLine({
    menuId: line.menuId,
    menuName: line.menuName,
    qty: line.qty,
    price: line.price,
    ...draft,
  });
  const newAmount = lineAmount(preview);
  const dirty =
    draft.isComp !== line.isComp ||
    (draft.lineDiscountPct ?? null) !== (line.lineDiscountPct ?? null) ||
    (draft.lineDiscountPct == null && draft.lineDiscount !== line.lineDiscount);
  const reset = () => {
    setDraft({ lineDiscount: line.lineDiscount, lineDiscountPct: line.lineDiscountPct, isComp: line.isComp });
    setOpen(false);
  };

  return (
    <div className="py-0.5 text-sm">
      <div className="flex items-center gap-2">
        <span className="w-8 text-muted">{line.qty}×</span>
        <span className="flex-1 text-ink">
          {line.menuName}
          {line.isComp && <span className="ml-1 text-xs text-muted">(แถม)</span>}
          {!line.isComp && line.lineDiscount > 0 && (
            <span className="ml-1 text-xs text-warn">
              · ลด {line.lineDiscountPct != null ? `${line.lineDiscountPct}% (${fmt(line.lineDiscount)})` : fmt(line.lineDiscount)}
            </span>
          )}
        </span>
        <span className="text-ink">{line.isComp ? "—" : fmt(line.amount)}</span>
        {canWrite && (
          <>
            <button
              type="button"
              aria-label="แก้ส่วนลด / แถม"
              title="แก้ส่วนลด / แถม"
              disabled={busy}
              onClick={() => setOpen((v) => !v)}
              className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-raised hover:text-ink disabled:opacity-40"
            >
              <IconEdit size={14} />
            </button>
            <button
              type="button"
              title="ยกเลิกรายการนี้ (คืนสต็อก)"
              aria-label="ยกเลิกรายการนี้ (คืนสต็อก)"
              disabled={busy}
              onClick={onVoid}
              className="grid h-7 w-7 place-items-center rounded text-crit hover:bg-crit-bg disabled:opacity-40"
            >
              <IconTrash size={14} />
            </button>
          </>
        )}
      </div>

      {open && (
        <div className="mt-1 flex flex-wrap items-center gap-2 rounded bg-raised px-2 py-1.5 text-xs">
          <span className="text-muted">ส่วนลด</span>
          <div className="w-24">
            {/* 🚨 ช่องเดียวสองความหมาย — ค่าต้องสลับตามหน่วยที่เลือก (กติกาเดียวกับถาด) */}
            <NumBox
              value={mode === "pct" ? (draft.lineDiscountPct ?? 0) : draft.lineDiscount}
              onChange={(v) => {
                const n = v === "" ? 0 : Math.max(0, v);
                setDraft((d) => (mode === "pct" ? { ...d, lineDiscountPct: n || null } : { ...d, lineDiscount: n, lineDiscountPct: null }));
              }}
              blankZero
            />
          </div>
          <div className="flex overflow-hidden rounded border border-line">
            {(["baht", "pct"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() =>
                  setDraft((d) =>
                    m === "pct"
                      ? { ...d, lineDiscountPct: d.lineDiscountPct ?? 0, lineDiscount: 0 }
                      : { ...d, lineDiscountPct: null, lineDiscount: preview.lineDiscount ?? 0 },
                  )
                }
                className={`px-2 py-1 ${mode === m ? "bg-brand text-on-brand" : "text-muted"}`}
              >
                {m === "baht" ? "บาท" : "%"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-muted">
            <input
              type="checkbox"
              checked={draft.isComp}
              onChange={(e) => setDraft((d) => ({ ...d, isComp: e.target.checked }))}
            />
            แถม (ยอด 0 แต่ต้นทุนยังนับ)
          </label>
          <span className="text-muted">
            ยอดใหม่ <b className="text-ink">{fmt(newAmount)}</b>
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              disabled={busy || !dirty}
              onClick={async () => {
                if (await onSave(draft)) setOpen(false);
              }}
              className="rounded bg-brand px-2.5 py-1 text-on-brand disabled:opacity-50"
            >
              บันทึก
            </button>
            <button type="button" onClick={reset} className="text-muted underline">
              เลิกแก้
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * แก้ลูกค้า/ชื่อบิลของบิลที่ยังเปิดอยู่ (ผู้ใช้เลือก: บิลที่ปิดแล้วไม่ให้แก้ — อาจออกใบเสร็จใส่ชื่อเดิมไปแล้ว)
 * ★ ลูกค้าเปลี่ยน = ชิป "ดูเฉพาะเมนูของ…" และใบเสร็จตอนปิดบิลใช้คนใหม่
 */
export function EditBillCustomer({
  saleNo,
  tabName,
  customerId,
  customers,
  busy,
  onSave,
  onCancel,
}: {
  saleNo: string;
  tabName: string | null;
  customerId: string | null;
  customers: BarCustomerRow[];
  busy: boolean;
  onSave: (customerId: string | null, tabName: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(tabName ?? "");
  const [cust, setCust] = useState(customerId ?? "");
  const dirty = name.trim() !== (tabName ?? "") || cust !== (customerId ?? "");

  return (
    <div className="mb-3 space-y-2 rounded-lg bg-raised p-3 text-sm">
      <div className="font-medium text-ink">แก้บิล {saleNo}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อบิล / โต๊ะ" />
        <Select value={cust} onChange={(e) => setCust(e.target.value)}>
          <option value="">— ไม่ระบุลูกค้า —</option>
          {customers.map((c) => (
            <option key={c.customerId} value={c.customerId}>
              {customerLabel(c)}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => onSave(cust || null, name)}
          className="rounded-lg bg-brand px-3 py-1.5 text-on-brand disabled:opacity-50"
        >
          บันทึก
        </button>
        <button type="button" onClick={onCancel} className="text-muted underline">
          เลิกแก้
        </button>
        <span className="text-xs text-muted">แก้ได้เฉพาะบิลที่ยังเปิดอยู่ · ใบเสร็จตอนปิดบิลจะใช้ลูกค้าคนใหม่</span>
      </div>
    </div>
  );
}
