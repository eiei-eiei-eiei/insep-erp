"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { fillExciseForm, EXCISE_TEMPLATE_KEY, FONT_KEY, type ExciseKind } from "@/lib/pdf/excise";
import { getExciseReportData, getPdfAssetUrl, getExciseReportRunsAction, markExciseRunAction } from "../actions";
import { ReportChecklist } from "../../_components/ReportChecklist";

// report_key ของ report_runs ↔ ฟอร์ม ภส. (FLOW sec 6 — "เดือนนี้สร้างครบยัง")
const EXCISE_CHECKLIST = [
  { key: "phor_so_07_01", label: "ภส.๐๗-๐๑/๑ บัญชีวัตถุดิบ" },
  { key: "phor_so_07_02_1", label: "ภส.๐๗-๐๒/๑(๑) บัญชีผลิตสุรา" },
  { key: "phor_so_07_02_2", label: "ภส.๐๗-๐๒/๑(๒) บัญชีสุราบรรจุขวด" },
  { key: "phor_so_07_04", label: "ภส.๐๗-๐๔ งบเดือน" },
];
const RUN_KEY: Record<ExciseKind, string> = {
  "0701": "phor_so_07_01",
  "0702_1": "phor_so_07_02_1",
  "0702_2": "phor_so_07_02_2",
  "0704": "phor_so_07_04",
};

type Opt = { entities: { entity_id: string; name: string; excise_id: string | null }[]; materials: { material_id: string; name: string; unit: string | null }[]; products: { product_id: string; name: string; degree: number | null; bottle_size_l: number | null }[]; productNames: string[] };

function nowMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function mergePdfs(arrays: Uint8Array[]): Promise<Uint8Array> {
  if (arrays.length === 1) return arrays[0];
  const merged = await PDFDocument.create();
  for (const b of arrays) {
    const src = await PDFDocument.load(b);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return merged.save();
}

function download(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function ReportsApp({ options }: { options: Opt }) {
  // default = กิจการที่มีเลขสรรพสามิต (ไม่งั้นหัวฟอร์มจะว่าง)
  const [entityId, setEntityId] = useState(
    options.entities.find((e) => e.excise_id)?.entity_id ??
      options.entities[0]?.entity_id ??
      "",
  );
  const selectedExcise = options.entities.find((e) => e.entity_id === entityId)?.excise_id;
  const [month, setMonth] = useState(nowMonth());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // เลือกรายการต่อฟอร์ม (default เลือกทั้งหมด)
  const [sel0701, setSel0701] = useState<string[]>(options.materials.map((m) => m.material_id));
  const [sel0702_1, setSel0702_1] = useState<string[]>(options.productNames);
  const [sel0702_2, setSel0702_2] = useState<string[]>(options.products.map((p) => p.product_id));
  const [en, setEn] = useState({ "0701": true, "0702_1": true, "0702_2": true, "0704": true });

  const assetCache = useRef<Record<string, Uint8Array>>({});

  const [runs, setRuns] = useState<Record<string, string>>({});
  const loadRuns = useCallback(() => {
    if (!month || !entityId) return;
    getExciseReportRunsAction(month, entityId).then(setRuns);
  }, [month, entityId]);
  useEffect(() => { loadRuns(); }, [loadRuns]);

  async function fetchAsset(path: string): Promise<Uint8Array> {
    if (assetCache.current[path]) return assetCache.current[path];
    const { url, error } = await getPdfAssetUrl(path);
    if (!url) throw new Error(error || "โหลดไฟล์ template ไม่ได้: " + path);
    const res = await fetch(url);
    if (!res.ok) throw new Error("โหลด template ล้มเหลว: " + path);
    const bytes = new Uint8Array(await res.arrayBuffer());
    assetCache.current[path] = bytes;
    return bytes;
  }

  function toggle(list: string[], set: (v: string[]) => void, v: string) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  async function generate() {
    if (!month) { setMsg({ ok: false, text: "เลือกเดือนก่อน" }); return; }
    if (!entityId) { setMsg({ ok: false, text: "เลือกกิจการก่อน" }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const font = await fetchAsset(FONT_KEY);
      const jobs: { kind: ExciseKind; ids: string[]; file: string }[] = [];
      if (en["0701"]) jobs.push({ kind: "0701", ids: sel0701, file: "ภส07-01_วัตถุดิบ" });
      if (en["0702_1"]) jobs.push({ kind: "0702_1", ids: sel0702_1, file: "ภส07-02-1_ผลิตสุรา" });
      if (en["0702_2"]) jobs.push({ kind: "0702_2", ids: sel0702_2, file: "ภส07-02-2_สุราขวด" });
      if (en["0704"]) jobs.push({ kind: "0704", ids: [""], file: "ภส07-04_งบเดือน" });

      if (jobs.length === 0) { setMsg({ ok: false, text: "ยังไม่ได้เลือกฟอร์ม" }); setBusy(false); return; }
      for (const j of jobs) if (j.kind !== "0704" && j.ids.length === 0) throw new Error(`ฟอร์ม ${j.file} ยังไม่ได้เลือกรายการ`);

      let count = 0;
      for (const j of jobs) {
        const tpl = await fetchAsset(EXCISE_TEMPLATE_KEY[j.kind]);
        const parts: Uint8Array[] = [];
        for (const id of j.ids) {
          const data = await getExciseReportData(j.kind, month, id, entityId);
          parts.push(await fillExciseForm(j.kind, data, tpl, font));
        }
        const bytes = await mergePdfs(parts);
        download(bytes, `${j.file}_${month}.pdf`);
        await markExciseRunAction(RUN_KEY[j.kind], month, entityId); // ติ๊ก checklist (ไม่กระทบตัว PDF)
        count++;
        await new Promise((r) => setTimeout(r, 400));
      }
      setMsg({ ok: true, text: `สร้างรายงานสำเร็จ ${count} ไฟล์ (ดูในโฟลเดอร์ดาวน์โหลด)` });
      loadRuns();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "เกิดข้อผิดพลาด" });
    } finally {
      setBusy(false);
    }
  }

  const box = "rounded-2xl border border-slate-200 bg-white p-4";
  const chk = "flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50 cursor-pointer";

  const anyMaster = useMemo(
    () => options.materials.length + options.products.length,
    [options],
  );

  return (
    <div>
      {anyMaster === 0 && (
        <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          ยังไม่มีข้อมูลวัตถุดิบ/สินค้า — เพิ่ม master (หรือรัน seed ทดสอบ) ก่อนออกรายงาน
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">กิจการ</span>
          <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2">
            {options.entities.map((en) => (
              <option key={en.entity_id} value={en.entity_id}>
                {en.entity_id} — {en.name} {en.excise_id ? "" : "(ไม่มีเลขสรรพสามิต)"}
              </option>
            ))}
          </select>
          <span className={`mt-1 block text-xs ${selectedExcise ? "text-slate-400" : "text-red-500"}`}>
            {selectedExcise
              ? `เลขสรรพสามิต: ${selectedExcise}`
              : "⚠️ กิจการนี้ยังไม่มีเลขสรรพสามิต — หัวฟอร์มจะว่าง (ตั้งที่ entities.excise_id)"}
          </span>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">เดือน</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <button
          onClick={generate}
          disabled={busy}
          className="rounded-lg bg-slate-800 px-5 py-2 font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? "กำลังสร้าง…" : "สร้าง PDF ที่เลือก"}
        </button>
      </div>

      {msg && (
        <div className={`mb-4 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>{msg.text}</div>
      )}

      <div className="mb-4">
        <ReportChecklist
          title="เช็กลิสต์ฟอร์มสรรพสามิตของเดือนนี้"
          month={month}
          items={EXCISE_CHECKLIST}
          runs={runs}
          note="ติ๊กอัตโนมัติเมื่อกดสร้าง PDF ฟอร์มนั้น (แยกตามกิจการ) — เอกสารสรรพากร (ภพ.30/ภงด.) ดูที่ workspace บัญชี แท็บเอกสารสรรพากร"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={box}>
          <label className="mb-2 flex items-center gap-2 font-semibold text-slate-800">
            <input type="checkbox" checked={en["0701"]} onChange={(e) => setEn({ ...en, "0701": e.target.checked })} />
            ภส.๐๗-๐๑/๑ บัญชีวัตถุดิบ (ต่อวัตถุดิบ)
          </label>
          <div className="max-h-48 space-y-0.5 overflow-y-auto pl-6">
            {options.materials.map((m) => (
              <label key={m.material_id} className={chk}>
                <input type="checkbox" checked={sel0701.includes(m.material_id)} onChange={() => toggle(sel0701, setSel0701, m.material_id)} />
                {m.name} {m.unit ? `(${m.unit})` : ""}
              </label>
            ))}
          </div>
        </div>

        <div className={box}>
          <label className="mb-2 flex items-center gap-2 font-semibold text-slate-800">
            <input type="checkbox" checked={en["0702_1"]} onChange={(e) => setEn({ ...en, "0702_1": e.target.checked })} />
            ภส.๐๗-๐๒/๑(๑) บัญชีผลิตสุรา (ต่อชื่อสุรา)
          </label>
          <div className="max-h-48 space-y-0.5 overflow-y-auto pl-6">
            {options.productNames.map((n) => (
              <label key={n} className={chk}>
                <input type="checkbox" checked={sel0702_1.includes(n)} onChange={() => toggle(sel0702_1, setSel0702_1, n)} />
                {n}
              </label>
            ))}
          </div>
        </div>

        <div className={box}>
          <label className="mb-2 flex items-center gap-2 font-semibold text-slate-800">
            <input type="checkbox" checked={en["0702_2"]} onChange={(e) => setEn({ ...en, "0702_2": e.target.checked })} />
            ภส.๐๗-๐๒/๑(๒) บัญชีสุราบรรจุขวด (ต่อสินค้า)
          </label>
          <div className="max-h-48 space-y-0.5 overflow-y-auto pl-6">
            {options.products.map((p) => (
              <label key={p.product_id} className={chk}>
                <input type="checkbox" checked={sel0702_2.includes(p.product_id)} onChange={() => toggle(sel0702_2, setSel0702_2, p.product_id)} />
                {p.name} {p.degree ? `${p.degree}%` : ""} {p.bottle_size_l ? `${p.bottle_size_l}L` : ""}
              </label>
            ))}
          </div>
        </div>

        <div className={box}>
          <label className="mb-2 flex items-center gap-2 font-semibold text-slate-800">
            <input type="checkbox" checked={en["0704"]} onChange={(e) => setEn({ ...en, "0704": e.target.checked })} />
            ภส.๐๗-๐๔/๑ งบเดือน (รวมทั้งกิจการ)
          </label>
          <p className="pl-6 text-sm text-slate-400">ออกทั้งเดือน ไม่ต้องเลือกรายการ</p>
        </div>
      </div>
    </div>
  );
}
