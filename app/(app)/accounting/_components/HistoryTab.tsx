"use client";

import { useMemo, useState } from "react";
import { getItemHistoryAction, searchPriceHistoryAction } from "../actions";
import type { Bootstrap } from "./types";
import { Card, Combobox, Field, RowBtn, TextInput, fmt, todayISO, useRead, LoadError } from "./ui";
import { showToast } from "@/lib/shared/toast";
import { useDataVersion } from "@/lib/shared/dataChanged";
import { copyText, downloadXlsx } from "@/lib/shared/tableExport";
import { useDateFmt } from "@/lib/shared/dateFormatContext";
import type { StatementRange } from "@/lib/accounting/ledger";
import { STATEMENT_PRESETS, presetRange, rangeTitle, rangeError, type StatementPreset } from "@/lib/accounting/statementView";
import { billTotalLabel, billTotalsNote, PRICE_CHECK_TYPE } from "@/lib/accounting/billTotals";
import { priceHistoryTotals, singleItemSummary, priceHistoryCapNote, priceHistoryTable, toTsv } from "@/lib/accounting/priceHistory";
import { SkeletonTable } from "@/lib/shared/page";

type Hist = Awaited<ReturnType<typeof searchPriceHistoryAction>>;
type ItemHist = Awaited<ReturnType<typeof getItemHistoryAction>>;

/** ตัวเลือกช่องพิมพ์ค้น: "ทั้งหมด" บนสุด + ยุบค่าซ้ำ */
function withAll(values: string[]) {
  return [{ value: "", label: "ทั้งหมด" }, ...[...new Set(values.filter(Boolean))].map((v) => ({ value: v, label: v }))];
}

export function HistoryTab({ boot, period, entityId, active }: { boot: Bootstrap; period: string; entityId: string; active: boolean }) {
  const d = useDateFmt();
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
  // D181 — บันทึกบิล/เช็คราคาแล้วโหลดใหม่ (กันกรณีสลับแท็บมาก่อนบันทึกเสร็จ แล้วค้างข้อมูลเก่า)
  const dataVersion = useDataVersion("accounting");
  const { data, loading, refreshing, err, reload } = useRead<Hist>(
    () => searchPriceHistoryAction({
      entityId, contact: contact || undefined, job: job || undefined, category: category || undefined,
      includePriceCheck, from: range.from, to: range.to,
    }),
    [entityId, contact, job, category, includePriceCheck, range.from, range.to, dataVersion],
    { skip: !active || !!rangeErr },
  );
  const { data: hist } = useRead<ItemHist>(() => getItemHistoryAction(entityId), [entityId], { skip: !active });

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const shown = useMemo(() => {
    const t = itemName.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => r.itemName.toLowerCase().includes(t));
  }, [rows, itemName]);

  // D181 — ติ๊กเลือกรายการ (แบบระบบเดิม _js_history: เลือกแล้วรวมราคา) → ส่งออก Excel / คัดลอก
  //   เก็บเป็น itemId · ส่งออกเฉพาะที่เลือก*และยังโชว์อยู่* (ถูกกรองซ่อนไปแล้ว = ไม่ส่งของที่มองไม่เห็น)
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const pickedShown = useMemo(() => shown.filter((r) => picked.has(r.itemId)), [shown, picked]);
  const allPicked = shown.length > 0 && pickedShown.length === shown.length;
  const togglePick = (id: string) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleAll = () => setPicked((p) => {
    const n = new Set(p);
    if (allPicked) shown.forEach((r) => n.delete(r.itemId)); else shown.forEach((r) => n.add(r.itemId));
    return n;
  });
  const pickedNet = useMemo(() => pickedShown.reduce((s, r) => s + r.netTotal, 0), [pickedShown]);
  const exportRows = pickedShown.length > 0 ? pickedShown : shown;
  const exportWhat = pickedShown.length > 0 ? `ที่เลือก ${pickedShown.length}` : `ทั้งหมด ${shown.length}`;
  const [exporting, setExporting] = useState(false);
  async function doExcel() {
    setExporting(true);
    try {
      await downloadXlsx(priceHistoryTable(exportRows), `ประวัติราคา-${todayISO()}.xlsx`, { sheetName: "ประวัติราคา", dateCols: [0] });
      showToast({ ok: true, text: `ดาวน์โหลด Excel แล้ว (${exportRows.length} รายการ)` });
    } catch {
      showToast({ ok: false, text: "สร้างไฟล์ Excel ไม่สำเร็จ — ลองใหม่ หรือใช้ปุ่มคัดลอกตารางแทน" });
    } finally {
      setExporting(false);
    }
  }
  async function doCopy() {
    const ok = await copyText(toTsv(priceHistoryTable(exportRows)));
    showToast(ok
      ? { ok: true, text: `คัดลอก ${exportRows.length} รายการแล้ว — ไปที่ Excel คลิกช่องแรกแล้วกด Ctrl+V` }
      : { ok: false, text: "เบราว์เซอร์ไม่ยอมให้คัดลอก — ใช้ปุ่มดาวน์โหลด Excel แทน" });
  }
  const anyBillDisc = shown.some((r) => r.billDiscounted);

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
              จาก <div className="w-40"><TextInput type="month" value={custom.from ?? ""} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value || null }))} className="py-1" /></div>
              ถึง <div className="w-40"><TextInput type="month" value={custom.to ?? ""} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value || null }))} className="py-1" /></div>
            </span>
          )}
          <label className="ml-auto flex items-center gap-2"><input type="checkbox" checked={includePriceCheck} onChange={(e) => setIncludePriceCheck(e.target.checked)} /> รวมใบเช็คราคา</label>
        </div>
        <p className="mt-1 text-xs text-faint">
          กรองตามกิจการที่เลือกด้านบน ({entityId === "ALL" ? "ทุกกิจการ" : entityId}) · ช่วงเวลา: {rangeTitle(range, d.month)}
          {preset !== "custom" && preset !== "all" ? ` (นับถอยจากเดือน ${d.month(period)} ที่เลือกไว้ด้านบน)` : ""}
          {preset === "custom" ? " · เว้นช่องไหนว่าง = ไม่จำกัดด้านนั้น" : ""}
        </p>
        {rangeErr && <p className="mt-1 text-sm text-warn">{rangeErr}</p>}
      </Card>

      <Card title={`ผลลัพธ์ (${shown.length})`}>
        <LoadError err={err} onRetry={reload} what="ประวัติราคา" />
        {refreshing && <p className="mb-2 text-xs text-brand">กำลังโหลดข้อมูลล่าสุด…</p>}
        {capNote && <p className="mb-2 text-xs text-warn">{capNote}</p>}
        {rangeErr ? <p className="text-sm text-faint">— แก้ช่วงเวลาก่อน —</p> : loading ? <SkeletonTable rows={6} cols={7} what="ประวัติราคา" /> : shown.length === 0 ? (
          <p className="text-sm text-faint">{err ? "— โหลดไม่สำเร็จ —" : refreshing ? "กำลังโหลด…" : "— ไม่มีรายการ —"}</p>
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
              <p className="mt-1 text-xs text-faint">ยอดเป็นยอดก่อน VAT หลังหักส่วนลดรายบรรทัด{totalsNote ? ` · ${totalsNote}` : ""}</p>
            </div>

            {/* D181 — ติ๊กเลือก · รวมที่เลือก · ส่งออก */}
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-faint">
                {pickedShown.length > 0
                  ? <>เลือก <b className="text-ink">{pickedShown.length}</b> รายการ · รวมสุทธิ (ก่อน VAT) <b className="tnum text-ink">{fmt(pickedNet)}</b></>
                  : "ติ๊กหน้ารายการเพื่อเลือก — ไม่ติ๊ก = ส่งออกทั้งหมดที่เห็น"}
              </span>
              <span className="ml-auto flex flex-wrap gap-2">
                {pickedShown.length > 0 && <RowBtn type="button" onClick={() => setPicked(new Set())}>ล้างที่เลือก</RowBtn>}
                <RowBtn type="button" tone="brand" onClick={doExcel} disabled={exporting}>{exporting ? "กำลังสร้างไฟล์…" : `ดาวน์โหลด Excel (${exportWhat})`}</RowBtn>
                <RowBtn type="button" tone="brand" onClick={doCopy}>{`คัดลอกตาราง (${exportWhat})`}</RowBtn>
              </span>
            </div>

            <div className={`overflow-x-auto ${refreshing ? "opacity-60" : ""}`}>
              <table className="tbl">
                <thead><tr className="text-left text-faint">
                  <th className="w-8"><input type="checkbox" checked={allPicked} onChange={toggleAll} aria-label="เลือกทั้งหมดที่เห็น" /></th>
                  <th>วันที่</th><th>รายการ</th><th>คู่ค้า</th><th>ประเภท</th><th>หมวด</th><th>งาน</th><th className="num">จำนวน</th>
                  <th className="num">ราคา/หน่วย (ex)</th><th className="num">รวม (ก่อน VAT)</th><th className="num">ราคา/หน่วยสุทธิ</th>
                </tr></thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.itemId} className={r.type === PRICE_CHECK_TYPE ? "text-faint" : undefined}>
                      <td><input type="checkbox" checked={picked.has(r.itemId)} onChange={() => togglePick(r.itemId)} aria-label={`เลือก ${r.itemName}`} /></td>
                      <td className="whitespace-nowrap">{d.date(r.date)}</td><td>{r.itemName}</td><td>{r.contactName}</td><td>{r.type}</td>
                      <td>{r.category}</td><td>{r.job}</td>
                      <td className="num">{fmt(r.quantity)}</td><td className="num">{fmt(r.exVat)}</td><td className="num">{fmt(r.totalPrice)}</td>
                      <td className="num whitespace-nowrap">{r.netUnit === null ? "—" : fmt(r.netUnit)}{r.billDiscounted && <span className="text-warn"> †</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-faint">
              ราคา/หน่วยสุทธิ = ยอดก่อน VAT หลังหักส่วนลดทุกชั้น ÷ จำนวน · ใบเช็คราคา = ราคาที่กรอก
              {anyBillDisc && <> · <span className="text-warn">†</span> บิลที่มีส่วนลดท้ายบิล — เกลี่ยส่วนลดนั้นลงแต่ละรายการตามสัดส่วนยอดเงินแล้ว (คอลัมน์ &quot;รวม&quot; ยังไม่หักส่วนลดท้ายบิล)</>}
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
