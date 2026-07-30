"use client";

import { useEffect, useRef, useState } from "react";
import { taxReportHtml, whtReportHtml } from "@/lib/accounting/reportHtml";
import { isCorporate } from "@/lib/accounting/calc";
import { buildWht50PrintData } from "@/lib/accounting/wht";
import { buildWht50Pdf, WHT_TEMPLATE_KEY, type Wht50Doc } from "@/lib/pdf/wht50";
import { FONT_KEY } from "@/lib/pdf/excise";
import {
  getTaxReportBundleAction,
  getWhtBundleAction,
  getWht50ContextAction,
  getTxPaymentDateAction,
  getForwardedVatAction,
  nextWhtDocNoAction,
  recordTaxSummaryAction,
  markReportRunAction,
  issueWhtAction,
  updateWhtAction,
  listTaxSummariesAction,
  deleteTaxSummaryAction,
} from "../actions";
import { getPdfAssetUrl } from "../../reports/actions";
import { Field, Select, TextInput, fmt, todayISO, useSaver } from "./ui";

const SEQ = [
  { v: 1, label: "1. เงินเดือน/ค่าจ้าง ม.40(1)" },
  { v: 2, label: "2. ค่าธรรมเนียม/นายหน้า ม.40(2)" },
  { v: 3, label: "3. ค่าแห่งลิขสิทธิ์ ม.40(3)" },
  { v: 4, label: "4. ดอกเบี้ย/เงินปันผล ม.40(4)" },
  { v: 5, label: "5. ค่าจ้างทำของ/บริการ/ค่าเช่า (ม.3 เตรส)" },
  { v: 6, label: "6. อื่นๆ" },
];

type WhtBundle = Awaited<ReturnType<typeof getWhtBundleAction>>;
type Pending = WhtBundle["pending"][number];
type History = WhtBundle["history"][number];
type Summaries = Awaited<ReturnType<typeof listTaxSummariesAction>>;

/** เปิดแท็บเปล่าทันทีใน onClick (ก่อน await) — กัน popup blocker บนมือถือ/iPad */
function openBlankTab(): Window | null {
  return window.open("", "_blank");
}

export function TaxDocsTab({ period, entityId, active }: { period: string; entityId: string; active: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fwd, setFwd] = useState<number | null>(null);
  const [wht, setWht] = useState<WhtBundle | null>(null);
  const [summaries, setSummaries] = useState<Summaries>([]);
  const assetCache = useRef<Record<string, Uint8Array>>({});
  const realEntity = entityId === "ALL" ? "" : entityId;

  async function fetchAsset(path: string): Promise<Uint8Array> {
    if (assetCache.current[path]) return assetCache.current[path];
    const { url, error } = await getPdfAssetUrl(path);
    if (!url) throw new Error(error || "โหลด template ไม่ได้: " + path);
    const res = await fetch(url);
    if (!res.ok) throw new Error("โหลด template ล้มเหลว");
    const bytes = new Uint8Array(await res.arrayBuffer());
    assetCache.current[path] = bytes;
    return bytes;
  }

  function reload() {
    if (!realEntity) { setWht(null); setFwd(null); return; }
    getWhtBundleAction(period, realEntity).then(setWht);
    getForwardedVatAction(period, realEntity).then(setFwd);
    listTaxSummariesAction(realEntity).then(setSummaries);
  }
  useEffect(() => {
    if (!active) return;
    if (!realEntity) { setWht(null); setFwd(null); setSummaries([]); return; }
    let alive = true;
    getWhtBundleAction(period, realEntity).then((d) => { if (alive) setWht(d); });
    getForwardedVatAction(period, realEntity).then((d) => { if (alive) setFwd(d); });
    listTaxSummariesAction(realEntity).then((d) => { if (alive) setSummaries(d); });
    return () => { alive = false; };
  }, [period, realEntity, active]);

  async function genPhorPor30() {
    const w = openBlankTab(); // เปิดก่อน await กัน popup blocker
    setBusy(true); setMsg(null);
    try {
      const b = await getTaxReportBundleAction(period, realEntity);
      await recordTaxSummaryAction(period, realEntity, b.taxReport);
      await markReportRunAction("phor_por_30", period, realEntity);
      if (w) { w.document.write(taxReportHtml(period, b.entity, b.taxReport)); w.document.close(); }
      setMsg({ ok: true, text: w
        ? "สร้าง ภพ.30 แล้ว (บันทึกยอดยกไป — สร้างซ้ำเดือนเดิมจะทับของเดิม ไม่ซ้ำ)"
        : "บันทึกยอด ภพ.30 แล้ว แต่เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต popup แล้วกดสร้างใหม่เพื่อพิมพ์" });
      reload();
    } catch (e) { if (w) w.close(); setMsg({ ok: false, text: e instanceof Error ? e.message : "ผิดพลาด" }); }
    setBusy(false);
  }
  async function genPnd() {
    const w = openBlankTab();
    setBusy(true); setMsg(null);
    try {
      const b = await getTaxReportBundleAction(period, realEntity);
      await markReportRunAction("pnd_3_53", period, realEntity);
      if (w) { w.document.write(whtReportHtml(period, b.entity, b.whtReport)); w.document.close(); }
      setMsg({ ok: true, text: w
        ? "สร้าง ภงด.3/53 แล้ว — พิมพ์/บันทึก PDF จากแท็บใหม่"
        : "เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต popup แล้วลองใหม่" });
    } catch (e) { if (w) w.close(); setMsg({ ok: false, text: e instanceof Error ? e.message : "ผิดพลาด" }); }
    setBusy(false);
  }

  async function buildAndOpenWht(doc: Wht50Doc, target?: Window | null) {
    const win = target ?? window.open("", "_blank");
    const [tpl, font] = await Promise.all([fetchAsset(WHT_TEMPLATE_KEY), fetchAsset(FONT_KEY)]);
    const bytes = await buildWht50Pdf([doc], tpl, font);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    if (win) win.location.href = url; else window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function reprint(h: History) {
    const w = openBlankTab(); // เปิดก่อน await
    setBusy(true); setMsg(null);
    try {
      const ctx = await getWht50ContextAction(h.entityId || realEntity, h.contactName);
      const payDate = (await getTxPaymentDateAction(h.txIds[0])) ?? h.issueDate;
      const print = buildWht50PrintData({ docNo: h.docNo, whtAmount: h.whtAmount, transactionDate: h.issueDate, paymentDate: payDate });
      await buildAndOpenWht({
        docNo: h.docNo, entInfo: ctx.entInfo, payeeName: ctx.payee.name, payeeAddress: ctx.payee.address, payeeTaxId: ctx.payee.taxId,
        pndType: h.pndType, seq: h.incomeSeq, otherDesc: h.incomeType, amount: h.baseAmount, whtAmount: h.whtAmount,
        dateText: print.dateText, bahtText: print.bahtText, issueDateISO: h.issueDate,
      }, w);
    } catch (e) { if (w) w.close(); setMsg({ ok: false, text: e instanceof Error ? e.message : "ผิดพลาด" }); }
    setBusy(false);
  }

  const box = "rounded-2xl border border-slate-200 bg-white p-4";
  if (!realEntity) return <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">เลือกกิจการ (ไม่ใช่ &quot;ทุกกิจการ&quot;) ด้านบนก่อนออกเอกสารสรรพากร</div>;

  return (
    <div className="space-y-4">
      {msg && <div className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>{msg.text}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={box}>
          <h3 className="mb-1 font-semibold text-slate-800">ภพ.30 — รายงานภาษีซื้อ-ขาย</h3>
          <p className="mb-2 text-sm text-slate-600">ภาษีซื้อยกมา (เดือนก่อน): <b>{fwd === null ? "…" : fmt(fwd)}</b> <span className="text-xs text-slate-400">← เช็คว่าตรงกับ ภพ.30 เดือนก่อน</span></p>
          <button onClick={genPhorPor30} disabled={busy} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">สร้าง ภพ.30</button>
        </div>
        <div className={box}>
          <h3 className="mb-1 font-semibold text-slate-800">ภงด.3 / ภงด.53</h3>
          <p className="mb-2 text-sm text-slate-500">แยกบุคคล/นิติบุคคลอัตโนมัติ</p>
          <button onClick={genPnd} disabled={busy} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">สร้าง ภงด.3/53</button>
        </div>
      </div>

      {/* tax_summaries management */}
      <div className={box}>
        <h3 className="mb-2 font-semibold text-slate-800">ประวัติยอด ภพ.30 ที่บันทึกไว้ (tax_summaries)</h3>
        {summaries.length === 0 ? <p className="text-sm text-slate-400">— ยังไม่มี —</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-500"><th className="p-1">เดือน</th><th className="p-1 text-right">ภาษีขาย</th><th className="p-1 text-right">ภาษีซื้อ</th><th className="p-1 text-right">ยกมา</th><th className="p-1 text-right">ต้องชำระ</th><th className="p-1 text-right">ยกไป</th><th className="p-1"></th></tr></thead>
              <tbody>
                {summaries.map((s) => (
                  <tr key={s.id as number} className="border-t border-slate-100">
                    <td className="p-1">{s.report_month as string}</td>
                    <td className="p-1 text-right">{fmt(s.total_sales_vat as number)}</td>
                    <td className="p-1 text-right">{fmt(s.total_purchase_vat as number)}</td>
                    <td className="p-1 text-right">{fmt(s.forwarded_vat_in as number)}</td>
                    <td className="p-1 text-right">{fmt(s.net_payable as number)}</td>
                    <td className="p-1 text-right">{fmt(s.forwarded_vat_out as number)}</td>
                    <td className="p-1"><button onClick={() => { if (confirm("ลบแถวนี้?")) deleteTaxSummaryAction(s.id as number).then(reload); }} className="text-red-500 hover:underline">ลบ</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-slate-400">สร้าง ภพ.30 เดือนเดิมซ้ำ = ทับแถวเดิม (ไม่เพิ่มซ้ำ) · ลบได้ถ้าต้องการล้าง</p>
          </div>
        )}
      </div>

      {/* 50ทวิ */}
      <div className={box}>
        <h3 className="mb-2 font-semibold text-slate-800">50ทวิ — หนังสือรับรองหัก ณ ที่จ่าย (เลขรันแยกต่อกิจการ)</h3>
        {!wht ? <p className="text-sm text-slate-400">กำลังโหลด…</p> : (
          <>
            <p className="mb-2 text-sm text-slate-600">ยังไม่ออกใบ ({wht.pending.length})</p>
            {wht.pending.length === 0 ? <p className="text-sm text-slate-400">— ไม่มีรายการค้าง —</p> :
              wht.pending.map((p) => <IssueRow key={p.transactionId} p={p} entityId={realEntity} onIssued={reload} onBuild={buildAndOpenWht} setMsg={setMsg} />)}

            <p className="mb-2 mt-4 text-sm text-slate-600">ออกแล้วเดือนนี้ ({wht.history.length})</p>
            {wht.history.length === 0 ? <p className="text-sm text-slate-400">— ไม่มี —</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-slate-500"><th className="p-1">เลขที่</th><th className="p-1">วันออก</th><th className="p-1">คู่ค้า</th><th className="p-1">ประเภท</th><th className="p-1 text-right">ภาษีหัก</th><th className="p-1"></th></tr></thead>
                  <tbody>
                    {wht.history.map((h) => <EditRow key={h.docNo} h={h} entityId={realEntity} onSaved={reload} onReprint={() => reprint(h)} busy={busy} />)}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-slate-400">เลือกประเภทเงินได้ก่อนออก → จำนวนเงิน/ภาษี/วันจ่าย จะลงในแถวประเภทนั้นของฟอร์ม · แก้เลข/วันออก/ประเภทได้ที่รายการที่ออกแล้ว</p>
          </>
        )}
      </div>
    </div>
  );
}

// ── แถวออกหนังสือ (ฟอร์มกรอกก่อนออก) ─────────────────────────────────────────
function IssueRow({ p, entityId, onIssued, onBuild, setMsg }: {
  p: Pending; entityId: string; onIssued: () => void; onBuild: (d: Wht50Doc, w?: Window | null) => Promise<void>;
  setMsg: (m: { ok: boolean; text: string } | null) => void;
}) {
  const { pending, run } = useSaver();
  const [open, setOpen] = useState(false);
  const [docNo, setDocNo] = useState("");
  const [pndType, setPndType] = useState(isCorporate(p.contactName) ? "ภ.ง.ด.53" : "ภ.ง.ด.3");
  const [seq, setSeq] = useState(6);
  const [otherDesc, setOtherDesc] = useState(p.category);
  const [issueDate, setIssueDate] = useState(todayISO());
  const [paymentDate, setPaymentDate] = useState(p.transactionDateISO || todayISO());

  async function openForm() {
    setOpen(true);
    if (!docNo) setDocNo(await nextWhtDocNoAction(entityId));
  }
  function issue() {
    if (!docNo.trim()) { setMsg({ ok: false, text: "กรอกเลขที่หนังสือ" }); return; }
    const w = window.open("", "_blank"); // เปิดก่อน await กัน popup blocker (ถ้าบันทึกไม่ผ่าน = แท็บว่าง ปิดเองได้)
    run(
      () => issueWhtAction({ docNo: docNo.trim(), txIds: [p.transactionId], contactName: p.contactName, whtAmount: p.whtAmount, pndType, incomeType: otherDesc, incomeSeq: seq, baseAmount: p.amount, issueDate, paymentDate, entityId }),
      "ออกหนังสือแล้ว",
      async () => {
        const ctx = await getWht50ContextAction(entityId, p.contactName);
        const print = buildWht50PrintData({ docNo: docNo.trim(), whtAmount: p.whtAmount, transactionDate: issueDate, paymentDate });
        await onBuild({ docNo: docNo.trim(), entInfo: ctx.entInfo, payeeName: ctx.payee.name, payeeAddress: ctx.payee.address, payeeTaxId: ctx.payee.taxId, pndType, seq, otherDesc, amount: p.amount, whtAmount: p.whtAmount, dateText: print.dateText, bahtText: print.bahtText, issueDateISO: issueDate }, w);
        setMsg({ ok: true, text: `ออก 50ทวิ เลขที่ ${docNo.trim()} แล้ว` });
        onIssued();
      },
    );
  }

  return (
    <div className="mb-2 rounded-lg border border-slate-100 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>{p.displayDate} · <b>{p.contactName}</b> · {p.category} · ยอด {fmt(p.amount)} · ภาษี {fmt(p.whtAmount)}</span>
        <button onClick={openForm} className="rounded bg-slate-800 px-3 py-1 text-xs text-white">{open ? "ซ่อน" : "ออกหนังสือ"}</button>
      </div>
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
          <Field label="เลขที่หนังสือ"><TextInput value={docNo} onChange={(e) => setDocNo(e.target.value)} /></Field>
          <Field label="ประเภท (ภงด.)"><Select value={pndType} onChange={(e) => setPndType(e.target.value)}><option>ภ.ง.ด.3</option><option>ภ.ง.ด.53</option></Select></Field>
          <Field label="ประเภทเงินได้"><Select value={seq} onChange={(e) => setSeq(Number(e.target.value))}>{SEQ.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}</Select></Field>
          <Field label="ระบุประเภทเงินได้ (ถ้าอื่นๆ)"><TextInput value={otherDesc} onChange={(e) => setOtherDesc(e.target.value)} /></Field>
          <Field label="วันที่จ่าย"><TextInput type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></Field>
          <Field label="วันที่ออกหนังสือ"><TextInput type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></Field>
          <div className="col-span-2 md:col-span-3"><button onClick={issue} disabled={pending} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50">ออก + พิมพ์</button></div>
        </div>
      )}
    </div>
  );
}

// ── แถวใบที่ออกแล้ว (แก้ไข + พิมพ์ซ้ำ) ────────────────────────────────────────
function EditRow({ h, entityId, onSaved, onReprint, busy }: {
  h: History; entityId: string; onSaved: () => void; onReprint: () => void; busy: boolean;
}) {
  const { pending, run } = useSaver();
  const [edit, setEdit] = useState(false);
  const [docNo, setDocNo] = useState(h.docNo);
  const [issueDate, setIssueDate] = useState(h.issueDate);
  const [pndType, setPndType] = useState(h.pndType);
  const [seq, setSeq] = useState(h.incomeSeq);
  const [incomeType, setIncomeType] = useState(h.incomeType);

  function save() {
    run(() => updateWhtAction({ entityId, oldDocNo: h.docNo, newDocNo: docNo, issueDate, pndType, incomeSeq: seq, incomeType }), "แก้ไขแล้ว", () => { setEdit(false); onSaved(); });
  }

  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="p-1">{h.docNo}</td><td className="p-1">{h.issueDate}</td><td className="p-1">{h.contactName}</td><td className="p-1">{h.pndType}</td><td className="p-1 text-right">{fmt(h.whtAmount)}</td>
        <td className="p-1 whitespace-nowrap"><button onClick={onReprint} disabled={busy} className="text-slate-700 hover:underline">พิมพ์ซ้ำ</button><button onClick={() => setEdit((v) => !v)} className="ml-2 text-slate-700 hover:underline">แก้</button></td>
      </tr>
      {edit && (
        <tr className="bg-slate-50"><td colSpan={6} className="p-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Field label="เลขที่"><TextInput value={docNo} onChange={(e) => setDocNo(e.target.value)} /></Field>
            <Field label="วันออก"><TextInput type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></Field>
            <Field label="ประเภท"><Select value={pndType} onChange={(e) => setPndType(e.target.value)}><option>ภ.ง.ด.3</option><option>ภ.ง.ด.53</option></Select></Field>
            <Field label="ประเภทเงินได้"><Select value={seq} onChange={(e) => setSeq(Number(e.target.value))}>{SEQ.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}</Select></Field>
            <Field label="ระบุ (อื่นๆ)"><TextInput value={incomeType} onChange={(e) => setIncomeType(e.target.value)} /></Field>
          </div>
          <div className="mt-2 flex gap-2"><button onClick={save} disabled={pending} className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50">บันทึก</button></div>
        </td></tr>
      )}
    </>
  );
}
