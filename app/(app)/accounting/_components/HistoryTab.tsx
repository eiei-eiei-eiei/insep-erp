"use client";

import { useMemo, useState } from "react";
import { getItemHistoryAction, searchPriceHistoryAction } from "../actions";
import type { Bootstrap } from "./types";
import { Card, Combobox, Field, TextInput, fmt, useRead, LoadError } from "./ui";
import type { StatementRange } from "@/lib/accounting/ledger";
import { STATEMENT_PRESETS, presetRange, rangeTitle, rangeError, type StatementPreset } from "@/lib/accounting/statementView";
import { billTotalLabel, billTotalsNote, PRICE_CHECK_TYPE } from "@/lib/accounting/billTotals";
import { priceHistoryTotals, singleItemSummary, priceHistoryCapNote } from "@/lib/accounting/priceHistory";

type Hist = Awaited<ReturnType<typeof searchPriceHistoryAction>>;
type ItemHist = Awaited<ReturnType<typeof getItemHistoryAction>>;

/** ตัวเลือกช่องพิมพ์ค้น: "ทั้งหมด" บนสุด + ยุบค่าซ้ำ */
function withAll(values: string[]) {
  return [{ value: "", label: "ทั้งหมด" }, ...[...new Set(values.filter(Boolean))].map((v) => ({ value: v, label: v }))];
}

export function HistoryTab({ boot, period, entityId, active }: { boot: Bootstrap; period: string; entityId: string; active: boolean }) {
  const [itemName, setItemName] = useState("");
  const [contact, setContact] = useState("");
  const [job, setJob] = useState("");
  const [category, setCategory] = useState("");
  const [includePriceCheck, setIncludePriceCheck] = useState(true);
  // D140 — ช่วงเวลา (ปุ่มชุดเดียวกับ statement) · ค่าเริ่มต้น "ทั้งหมด" = พฤติกรรมเดิม
  const [preset, setPreset] = useState<StatementPreset>("all");
  const [custom, setCustom] = useState<StatementRange>({ from: period, to: period });
  const range: StatementRange = preset === "custom" ? custom : presetRange(preset, period);
  const rangeErr = rangeError(range);

  // 🚨 D89 — ผ่าน useRead: อ่านไม่ได้ = แถบแดง ไม่ใช่ค้าง "กำลังโหลด…" หรือตารางว่างที่อ่านว่า "ไม่มีประวัติ"
  const { data, loading, err, reload } = useRead<Hist>(
    () => searchPriceHistoryAction({
      entityId, contact: contact || undefined, job: job || undefined, category: category || undefined,
      includePriceCheck, from: range.from, to: range.to,
    }),
    [entityId, contact, job, category, includePriceCheck, range.from, range.to],
    { skip: !active || !!rangeErr },
  );
  const { data: hist } = useRead<ItemHist>(() => getItemHistoryAction(entityId), [entityId], { skip: !active });

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const shown = useMemo(() => {
    const t = itemName.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => r.itemName.toLowerCase().includes(t));
  }, [rows, itemName]);

  const totals = useMemo(() => priceHistoryTotals(shown), [shown]);
  const single = useMemo(() => singleItemSummary(shown, PRICE_CHECK_TYPE), [shown]);
  const capNote = data ? priceHistoryCapNote(data.loaded, data.total) : "";
  const totalsNote = billTotalsNote(totals, false);

  const contactOptions = useMemo(() => withAll(boot.contacts.map((c) => c.name)), [boot.contacts]);
  const jobOptions = useMemo(() => withAll(hist?.itemJobs ?? []), [hist]);
  const categoryOptions = useMemo(() => withAll(hist?.itemCategories ?? []), [hist]);

  const clearBtn = (show: boolean, onClear: () => void, what: string) =>
    show && <button type="button" onClick={onClear} aria-label={`ล้าง${what}`} title={`ล้าง = ทุก${what}`} className="rounded border border-line px-2 py-1 text-muted hover:bg-raised">✕</button>;
  const pick = (value: string, set: (v: string) => void, options: { value: string; label: string }[], what: string) => (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1"><Combobox options={options} value={value} onChange={set} placeholder={`พิมพ์ค้น${what}…`} /></div>
      {clearBtn(!!value, () => set(""), what)}
    </div>
  );
  const chip = (on: boolean) => `rounded-full border px-3 py-1 ${on ? "border-brand-line bg-brand-soft text-brand" : "border-line text-muted hover:bg-raised"}`;

  return (
    <div className="space-y-4">
      <Card title="ค้นประวัติราคาสินค้า/วัตถุดิบ">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="ชื่อสินค้า (พิมพ์เพื่อกรองทันที)"><TextInput value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="พิมพ์ชื่อสินค้า…" /></Field>
          <Field label="คู่ค้า">{pick(contact, setContact, contactOptions, "คู่ค้า")}</Field>
          <Field label="งาน">{pick(job, setJob, jobOptions, "งาน")}</Field>
          <Field label="หมวด">{pick(category, setCategory, categoryOptions, "หมวด")}</Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-faint">ช่วงเวลา:</span>
          {STATEMENT_PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => setPreset(p.key)} aria-pressed={preset === p.key} className={chip(preset === p.key)}>{p.label}</button>
          ))}
          <button type="button" onClick={() => { setCustom(range.from || range.to ? range : { from: period, to: period }); setPreset("custom"); }} aria-pressed={preset === "custom"} className={chip(preset === "custom")}>กำหนดเอง</button>
          {preset === "custom" && (
            <span className="flex flex-wrap items-center gap-1">
              จาก <input type="month" value={custom.from ?? ""} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value || null }))} className="rounded-lg border border-line px-2 py-1" />
              ถึง <input type="month" value={custom.to ?? ""} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value || null }))} className="rounded-lg border border-line px-2 py-1" />
            </span>
          )}
          <label className="ml-auto flex items-center gap-2"><input type="checkbox" checked={includePriceCheck} onChange={(e) => setIncludePriceCheck(e.target.checked)} /> รวมใบเช็คราคา</label>
        </div>
        <p className="mt-1 text-xs text-faint">
          กรองตามกิจการที่เลือกด้านบน ({entityId === "ALL" ? "ทุกกิจการ" : entityId}) · ช่วงเวลา: {rangeTitle(range)}
          {preset !== "custom" && preset !== "all" ? ` (นับถอยจากเดือน ${period} ที่เลือกไว้ด้านบน)` : ""}
          {preset === "custom" ? " · เว้นช่องไหนว่าง = ไม่จำกัดด้านนั้น" : ""}
        </p>
        {rangeErr && <p className="mt-1 text-sm text-warn">{rangeErr}</p>}
      </Card>

      <Card title={`ผลลัพธ์ (${shown.length})`}>
        <LoadError err={err} onRetry={reload} what="ประวัติราคา" />
        {capNote && <p className="mb-2 text-xs text-warn">{capNote}</p>}
        {rangeErr ? <p className="text-sm text-faint">— แก้ช่วงเวลาก่อน —</p> : loading ? <p className="text-faint">กำลังโหลด…</p> : shown.length === 0 ? (
          <p className="text-sm text-faint">{err ? "— โหลดไม่สำเร็จ —" : "— ไม่มีรายการ —"}</p>
        ) : (
          <>
            {/* D140 — ยอดรวมแยกตามประเภท (ตัวบวกเดียวกับหน้าค้นบิล) */}
            <div className="mb-3 rounded-lg border border-line bg-raised p-3 text-sm">
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {totals.byType.map((t) => (
                  <div key={t.type}>
                    <span className="text-faint">{billTotalLabel(t.type)} {t.count} รายการ · </span>
                    <b className="tnum text-ink">{fmt(t.total)}</b>
                  </div>
                ))}
                {totals.incomeMinusExpense !== null && totals.byType.some((t) => t.type === "รายรับ") && totals.byType.some((t) => t.type === "รายจ่าย") && (
                  <div>
                    <span className="text-faint">รายรับ − รายจ่าย · </span>
                    <b className={`tnum ${totals.incomeMinusExpense < 0 ? "text-crit" : "text-ok"}`}>{fmt(totals.incomeMinusExpense)}</b>
                  </div>
                )}
                {totals.byType.length === 0 && <span className="text-faint">ไม่มีรายการที่นับยอดได้</span>}
              </div>
              {single && (
                <p className="mt-1">
                  <span className="text-faint">{single.itemName} · จำนวนรวม </span><b className="tnum text-ink">{fmt(single.quantity)}</b>
                  {single.avgPrice !== null && <><span className="text-faint"> · ราคาเฉลี่ย/หน่วย </span><b className="tnum text-ink">{fmt(single.avgPrice)}</b></>}
                </p>
              )}
              <p className="mt-1 text-xs text-faint">ยอดเป็นยอดก่อน VAT หลังหักส่วนลด{totalsNote ? ` · ${totalsNote}` : ""}</p>
            </div>

            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr className="text-left text-faint"><th>วันที่</th><th>รายการ</th><th>คู่ค้า</th><th>ประเภท</th><th>หมวด</th><th>งาน</th><th className="num">จำนวน</th><th className="num">ราคา(ex)</th><th className="num">รวม (ก่อน VAT)</th></tr></thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={r.txId + i} className={r.type === PRICE_CHECK_TYPE ? "text-faint" : undefined}>
                      <td className="whitespace-nowrap">{r.date}</td><td>{r.itemName}</td><td>{r.contactName}</td><td>{r.type}</td>
                      <td>{r.category}</td><td>{r.job}</td>
                      <td className="num">{fmt(r.quantity)}</td><td className="num">{fmt(r.exVat)}</td><td className="num">{fmt(r.totalPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
