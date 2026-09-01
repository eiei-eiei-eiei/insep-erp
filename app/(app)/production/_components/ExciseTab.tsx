"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// 🔴 ห้าม import pdf-lib / lib/pdf/excise แบบ static ที่นี่ — แท็บนี้อยู่ในแอปผลิตแล้ว
//    static import = ทุกคนที่เปิดแอปผลิตต้องโหลด pdf-lib + fontkit ทั้งที่ส่วนใหญ่ไม่ได้ออกฟอร์ม
//    (ตอนอยู่ /reports ต้นทุนนี้ถูกกักไว้หน้าเดียว) → โหลดตอนกดสร้าง PDF เท่านั้น
import { EXCISE_TEMPLATE_KEY, FONT_KEY, type ExciseKind } from "@/lib/pdf/keys";
import { downloadBlob, MIME } from "@/lib/shared/download";
import { getPdfAssetUrl } from "../../actions";
import {
  getExciseOptionsAction, getExciseReportData, getExciseReportRunsAction, markExciseRunAction,
  getExciseMonthCloseAction, closeExciseMonthAction, reopenExciseMonthAction, recomputeExciseHiddenAction,
  type MonthCloseView,
} from "../excise-actions";
import { ReportChecklist } from "../../_components/ReportChecklist";
import {
  closeStatus, monthCloseBadge, closeWarnText, pendingRecomputeText, driftSummary, recomputeResultText,
} from "@/lib/production/monthClose";
import { can, capHolderText, type Role } from "@/lib/shared/roles";
import { formatDateThai } from "@/lib/shared/format";

// report_key ของ report_runs ↔ ฟอร์ม ภส. (FLOW sec 6 — "เดือนนี้สร้างครบยัง")
const EXCISE_CHECKLIST = [
  { key: "phor_so_07_01", label: "ภส.๐๗-๐๑/๑ บัญชีวัตถุดิบ" },
  { key: "phor_so_07_02_1", label: "ภส.๐๗-๐๒/๑(๑) บัญชีผลิตสุรากลั่น" },
  { key: "phor_so_07_02_1_chae", label: "ภส.๐๗-๐๒/๑(๑) บัญชีผลิตสุราแช่" },
  { key: "phor_so_07_02_2", label: "ภส.๐๗-๐๒/๑(๒) บัญชีสุราบรรจุขวด" },
  { key: "phor_so_07_04", label: "ภส.๐๗-๐๔ งบเดือน" },
];
const RUN_KEY: Record<ExciseKind, string> = {
  "0701": "phor_so_07_01",
  "0702_1": "phor_so_07_02_1",
  "0702_1_chae": "phor_so_07_02_1_chae",
  "0702_2": "phor_so_07_02_2",
  "0704": "phor_so_07_04",
};

type Opt = {
  entities: { entity_id: string; name: string; excise_id: string | null }[];
  materials: { material_id: string; name: string; unit: string | null }[];
  products: { product_id: string; name: string; degree: number | null; bottle_size_l: number | null }[];
  productNames: string[];
  /** D78 — ชื่อสุราแยกตามประเภท (ฟอร์มผลิตคนละใบ) + รายชื่อที่ตั้งประเภทไม่ครบ/ไม่ตรงกัน */
  productNamesDistilled: string[];
  productNamesFermented: string[];
  namesNoProcess: string[];
  namesMixedProcess: string[];
};

function nowMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function mergePdfs(PDFDocument: typeof import("pdf-lib").PDFDocument, arrays: Uint8Array[]): Promise<Uint8Array> {
  if (arrays.length === 1) return arrays[0];
  const merged = await PDFDocument.create();
  for (const b of arrays) {
    const src = await PDFDocument.load(b);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return merged.save();
}

/** ★ ตัวจริงอยู่ที่ `lib/shared/download.ts` แล้ว (D82) — ที่นี่เหลือแค่ห่อให้เรียกสั้นเหมือนเดิม */
function download(bytes: Uint8Array, name: string) {
  downloadBlob(bytes as BlobPart, name, MIME.pdf);
}

const EMPTY_OPT: Opt = {
  entities: [], materials: [], products: [], productNames: [],
  productNamesDistilled: [], productNamesFermented: [], namesNoProcess: [], namesMixedProcess: [],
};

/**
 * แท็บ "รายงานสรรพสามิต" ของแอปผลิต — ออกฟอร์ม ภส.๐๗ ทั้ง 4 ตัว
 * (เดิมเป็น workspace แยก /reports · ยุบเข้ามาเป็นแท็บแล้ว — DECISIONS D62)
 *
 * ★ โหลดตัวเลือกตอนเปิดแท็บครั้งแรกเท่านั้น (prop active) ไม่ใช่ตอนเปิดแอปผลิต —
 *   คนส่วนใหญ่เข้าแอปผลิตมาลงหมัก/กลั่น ไม่ได้มาออกฟอร์มราชการทุกครั้ง
 */
export function ExciseTab({ active, role }: { active: boolean; role: Role }) {
  const [options, setOptions] = useState<Opt>(EMPTY_OPT);
  const [loaded, setLoaded] = useState(false);
  const [entityId, setEntityId] = useState("");
  const [month, setMonth] = useState(nowMonth());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // เลือกรายการต่อฟอร์ม (default เลือกทั้งหมด — เติมให้ตอนตัวเลือกโหลดเสร็จ)
  const [sel0701, setSel0701] = useState<string[]>([]);
  const [sel0702_1, setSel0702_1] = useState<string[]>([]);
  const [sel0702_1_chae, setSel0702_1Chae] = useState<string[]>([]);
  const [sel0702_2, setSel0702_2] = useState<string[]>([]);
  const [en, setEn] = useState({ "0701": true, "0702_1": true, "0702_1_chae": true, "0702_2": true, "0704": true });

  useEffect(() => {
    if (!active || loaded) return;
    let alive = true;
    getExciseOptionsAction().then((o) => {
      if (!alive) return;
      setOptions(o);
      // default = กิจการที่มีเลขสรรพสามิต (ไม่งั้นหัวฟอร์มจะว่าง)
      setEntityId(o.entities.find((e) => e.excise_id)?.entity_id ?? o.entities[0]?.entity_id ?? "");
      setSel0701(o.materials.map((m) => m.material_id));
      setSel0702_1(o.productNamesDistilled);
      setSel0702_1Chae(o.productNamesFermented);
      setSel0702_2(o.products.map((p) => p.product_id));
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [active, loaded]);

  const selectedExcise = options.entities.find((e) => e.entity_id === entityId)?.excise_id;

  const assetCache = useRef<Record<string, Uint8Array>>({});

  const [runs, setRuns] = useState<Record<string, string>>({});
  const loadRuns = useCallback(() => {
    if (!month || !entityId) return;
    getExciseReportRunsAction(month, entityId).then(setRuns);
  }, [month, entityId]);
  useEffect(() => { loadRuns(); }, [loadRuns]);

  // ── ปิดเดือนสรรพสามิต (D91) ────────────────────────────────────────────────
  const [mc, setMc] = useState<MonthCloseView | null>(null);
  const [mcErr, setMcErr] = useState<string | null>(null);
  const [mcMsg, setMcMsg] = useState<{ text: string; tone: "ok" | "warn" | "err" } | null>(null);
  const [mcBusy, setMcBusy] = useState(false);
  const [mcNote, setMcNote] = useState("");

  const loadClose = useCallback(() => {
    if (!month || !entityId) { setMc(null); return; }
    // ★ ไม่ล้างของเดิมทิ้งตอน error — ผู้ใช้ที่กำลังดูอยู่ต้องไม่เสียของ (D89)
    getExciseMonthCloseAction(month, entityId)
      .then((v) => { setMc(v); setMcErr(null); })
      .catch((e: unknown) => setMcErr(e instanceof Error ? e.message : "อ่านสถานะปิดเดือนไม่สำเร็จ"));
  }, [month, entityId]);
  useEffect(() => { loadClose(); setMcMsg(null); setMcNote(""); }, [loadClose]);

  const st = closeStatus(mc?.rows ?? []);
  const badge = monthCloseBadge(st);
  const mayClose = can(role, "prod.config");
  const drift = driftSummary(st.active?.totals ?? null, mc?.currentTotals ?? null);
  const doneRuns = EXCISE_CHECKLIST.filter((i) => runs[i.key]).length;
  // 🚨 ต้องรู้ทิศทาง ไม่ใช่แค่จำนวน — "จะเอาออก" กับ "จะเอากลับมาแสดง" เป็นคนละเรื่องกันคนละทาง
  const pendingN = (mc?.pending.toHide ?? 0) + (mc?.pending.toShow ?? 0);
  const pending = mc ? pendingRecomputeText(mc.pending) : null;

  async function runClose(
    fn: () => Promise<{ ok: boolean; error?: string; changed?: number; toHide?: number; toShow?: number }>,
    okText: string,
  ) {
    setMcBusy(true);
    setMcMsg(null);
    try {
      const r = await fn();
      if (!r.ok) { setMcMsg({ text: r.error ?? "ทำรายการไม่สำเร็จ", tone: "err" }); return; }
      // 🚨 "ไม่มีอะไรเปลี่ยน" ไม่ใช่ความสำเร็จแบบเดียวกับ "เปลี่ยนแล้ว" — ต้องแยกสีให้เห็น (D79)
      const t = typeof r.changed === "number"
        ? recomputeResultText({ toHide: r.toHide ?? 0, toShow: r.toShow ?? 0 })
        : { text: okText, warn: false };
      setMcMsg({ text: t.text, tone: t.warn ? "warn" : "ok" });
      setMcNote("");
      loadClose();
    } finally {
      setMcBusy(false);
    }
  }

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
      // โหลด pdf-lib + ตัวเติมฟอร์มตอนนี้เท่านั้น (ดูเหตุผลที่หัวไฟล์)
      const [{ PDFDocument }, { fillExciseForm }] = await Promise.all([
        import("pdf-lib"),
        import("@/lib/pdf/excise"),
      ]);
      const font = await fetchAsset(FONT_KEY);
      const jobs: { kind: ExciseKind; ids: string[]; file: string }[] = [];
      if (en["0701"]) jobs.push({ kind: "0701", ids: sel0701, file: "ภส07-01_วัตถุดิบ" });
      if (en["0702_1"] && options.productNamesDistilled.length > 0) jobs.push({ kind: "0702_1", ids: sel0702_1, file: "ภส07-02-1_ผลิตสุรากลั่น" });
      if (en["0702_1_chae"] && options.productNamesFermented.length > 0) jobs.push({ kind: "0702_1_chae", ids: sel0702_1_chae, file: "ภส07-02-1_ผลิตสุราแช่" });
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
        const bytes = await mergePdfs(PDFDocument, parts);
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

  const box = "rounded-lg border border-line bg-card p-4";
  const chk = "flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-raised cursor-pointer";

  const anyMaster = useMemo(
    () => options.materials.length + options.products.length,
    [options],
  );

  // D80 — ขนาดขวดที่น่าจะกรอกเป็นมิลลิลิตร (ไม่มีขวดขายปลีกใหญ่กว่า 5 ลิตร)
  const bigBottles = useMemo(
    () => options.products.filter((p) => (Number(p.bottle_size_l) || 0) > 5),
    [options],
  );

  if (!loaded) return <p className="text-sm text-faint">กำลังโหลด…</p>;

  return (
    <div>
      {anyMaster === 0 && (
        <div className="mb-4 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">
          ยังไม่มีข้อมูลวัตถุดิบ/สินค้า — เพิ่ม master (หรือรัน seed ทดสอบ) ก่อนออกรายงาน
        </div>
      )}

      {/* D78 🚨 ห้าม default เป็นสุรากลั่น — เดาแล้วออกฟอร์มผิดใบโดยไม่มีอะไรฟ้อง */}
      {options.namesNoProcess.length > 0 && (
        <div className="mb-4 rounded-lg bg-crit-bg px-3 py-2 text-sm text-crit">
          สินค้าเหล่านี้ยังไม่ได้ตั้ง <b>ประเภทสุรา</b> (สุรากลั่น / สุราแช่) จึงยัง<b>ออกฟอร์มบัญชีผลิตให้ไม่ได้</b>:{" "}
          <b>{options.namesNoProcess.join(", ")}</b>
          <br />ตั้งได้ที่แท็บ <b>จัดการข้อมูล → สินค้า / สุรา</b> (ฟอร์มวัตถุดิบ · สุราบรรจุขวด · งบเดือน ยังออกได้ตามปกติ)
        </div>
      )}
      {options.namesMixedProcess.length > 0 && (
        <div className="mb-4 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">
          ชื่อสุราเหล่านี้มีหลายแถวที่ <b>ประเภทสุราไม่ตรงกัน</b>: <b>{options.namesMixedProcess.join(", ")}</b>
          <br />รายงานรวมยอดตาม<b>ชื่อสุรา</b> — ถ้าประเภทไม่ตรงกันระบบจะยึดแถวแรกที่เจอ ควรแก้ให้ตรงกันก่อนยื่น
        </div>
      )}

      {/*
        D80 — ที่นี่คือจุดที่ขนาดขวดผิดหน่วยกลายเป็นเลขบนเอกสารราชการจริง
        🚨 ภส.๐๗-๐๒/๑(๒) คิดลิตร = จำนวนขวด × bottle_size_l · กรอก 330 แทน 0.33
           = ปริมาตรบนฟอร์มพันเท่า และไม่มีอะไรฟ้องจนกว่าเจ้าหน้าที่จะทัก
      */}
      {bigBottles.length > 0 && (
        <div className="mb-4 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">
          สินค้าเหล่านี้ตั้ง <b>ขนาดขวดเกิน 5 ลิตร/ขวด</b> — น่าจะกรอกเป็น <b>มิลลิลิตร</b>:{" "}
          <b>{bigBottles.map((p) => `${p.name} ${p.bottle_size_l} ล.`).join(", ")}</b>
          <br />ฟอร์ม <b>ภส.๐๗-๐๒/๑(๒)</b> คิดปริมาตรจาก <b>จำนวนขวด × ขนาดขวด</b> —
          ถ้าหน่วยผิด ปริมาณบนฟอร์มจะมากกว่าความจริงพันเท่า · แก้ที่แท็บ <b>จัดการข้อมูล → สินค้า / สุรา</b>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        {/* 4.4 — มีกิจการเดียวก็ไม่ต้องให้เลือก · แต่ยังต้องโชว์เลขสรรพสามิตเพราะมันขึ้นหัวฟอร์ม
            (ตัดสินจากจำนวนกิจการจริง ไม่ใช่ max_entities — เหตุผลเดียวกับ AccountingApp) */}
        <label className="text-sm">
          <span className="mb-1 block text-muted">กิจการ</span>
          {options.entities.length > 1 ? (
            <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className="rounded-lg border border-line px-3 py-2">
              {options.entities.map((en) => (
                <option key={en.entity_id} value={en.entity_id}>
                  {en.entity_id} — {en.name} {en.excise_id ? "" : "(ไม่มีเลขสรรพสามิต)"}
                </option>
              ))}
            </select>
          ) : (
            <span className="block rounded-lg border border-line px-3 py-2 text-ink">
              {options.entities[0]?.name ?? "ยังไม่มีข้อมูลกิจการ"}
            </span>
          )}
          <span className={`mt-1 block text-xs ${selectedExcise ? "text-faint" : "text-crit"}`}>
            {selectedExcise
              ? `เลขสรรพสามิต: ${selectedExcise}`
              : "กิจการนี้ยังไม่มีเลขสรรพสามิต — หัวฟอร์มจะว่าง (กรอกที่ ตั้งค่า → กิจการ)"}
          </span>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">เดือน</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-line px-3 py-2" />
        </label>
        <button
          onClick={generate}
          disabled={busy}
          className="rounded-lg bg-brand px-5 py-2 font-medium text-on-brand hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "กำลังสร้าง…" : "สร้าง PDF ที่เลือก"}
        </button>
      </div>

      {msg && (
        <div className={`mb-4 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-ok-bg text-ok" : "bg-crit-bg text-crit"}`}>{msg.text}</div>
      )}

      <div className="mb-4">
        <ReportChecklist
          title="เช็กลิสต์ฟอร์มสรรพสามิตของเดือนนี้"
          month={month}
          items={EXCISE_CHECKLIST}
          runs={runs}
          note="ติ๊กอัตโนมัติเมื่อกดสร้าง PDF ฟอร์มนั้น (แยกตามกิจการ) — เอกสารสรรพากร (ภพ.30/ภงด./50ทวิ) อยู่ที่ บัญชี → แท็บเอกสารสรรพากร"
        />
      </div>

      {/*
        ปิดเดือนสรรพสามิต (D91) — 🚨 อยู่ **นอก** ReportChecklist โดยตั้งใจ
        คอมโพเนนต์นั้นใช้ร่วมกับแท็บเอกสารสรรพากรฝั่งบัญชี ซึ่งไม่มีเรื่องปิดเดือน
      */}
      {entityId && month && (
        <div className="mb-4 rounded-lg border border-line bg-card p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-ink">ปิดบัญชีสรรพสามิตของเดือนนี้</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                badge.tone === "ok" ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"
              }`}
            >
              {badge.text}
            </span>
            <span className="text-xs text-faint">เดือน {month}</span>
          </div>

          {mcErr && <div className="mb-2 rounded-lg border border-crit-line bg-crit-bg px-3 py-2 text-sm text-crit">{mcErr}</div>}
          {mcMsg && (
            <div
              className={`mb-2 rounded-lg border px-3 py-2 text-sm ${
                mcMsg.tone === "err"
                  ? "border-crit-line bg-crit-bg text-crit"
                  : mcMsg.tone === "warn"
                    ? "border-warn-line bg-warn-bg text-warn"
                    : "border-ok-line bg-ok-bg text-ok"
              }`}
            >
              {mcMsg.text}
            </div>
          )}

          <p className="mb-3 text-xs text-faint">
            การกดสร้าง PDF <b>ไม่ล็อกอะไร</b> — พิมพ์บัญชีประจำวันให้เจ้าหน้าที่ตรวจได้ตลอด ·
            ปิดเดือนคือการบอกระบบว่า <b>ยื่นงบเดือนไปแล้ว</b> หลังจากนั้นการยกเลิกบิลจะไม่เปลี่ยนตัวเลขบนฟอร์มของเดือนนี้
          </p>

          {st.closed && st.active ? (
            <>
              <p className="mb-2 text-sm text-muted">
                ปิดเมื่อ {formatDateThai(st.active.closedAt.slice(0, 10))}
                {st.active.closedBy ? ` โดย ${st.active.closedBy}` : ""}
                {st.active.note ? ` — ${st.active.note}` : ""}
              </p>
              {drift.length > 0 && (
                <div className="mb-3 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-sm text-warn">
                  <p className="font-medium">ข้อมูลปัจจุบันต่างจากตอนปิดเดือน {drift.length} รายการ</p>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {drift.slice(0, 8).map((d) => (
                      <li key={`${d.group}-${d.key}`}>
                        {d.group} · {d.key}: {d.before} → {d.after}
                      </li>
                    ))}
                  </ul>
                  {drift.length > 8 && <p className="mt-1 text-xs">…และอีก {drift.length - 8} รายการ</p>}
                  <p className="mt-1 text-xs">ถ้ายังไม่ได้ยื่นจริง ให้ถอนปิดเดือนแล้วออกฟอร์มใหม่</p>
                </div>
              )}
            </>
          ) : (
            <>
              {closeWarnText(doneRuns, EXCISE_CHECKLIST.length) && (
                <p className="mb-2 text-sm text-warn">{closeWarnText(doneRuns, EXCISE_CHECKLIST.length)}</p>
              )}
              {pending && <p className="mb-2 text-sm text-warn">{pending}</p>}
            </>
          )}

          {st.reopenedTimes > 0 && (
            <p className="mb-2 text-xs text-faint">เดือนนี้เคยถูกถอนปิดมาแล้ว {st.reopenedTimes} ครั้ง</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={mcNote}
              onChange={(e) => setMcNote(e.target.value)}
              placeholder="หมายเหตุ (ไม่บังคับ)"
              disabled={!mayClose || mcBusy}
              className="min-w-48 flex-1 rounded-lg border border-line px-3 py-2 text-sm"
            />
            {st.closed ? (
              <button
                type="button"
                disabled={!mayClose || mcBusy}
                onClick={() => runClose(() => reopenExciseMonthAction(month, entityId, mcNote), "ถอนปิดเดือนแล้ว")}
                className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium text-muted hover:bg-raised disabled:opacity-50"
              >
                ถอนปิดเดือน
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!mayClose || mcBusy}
                  onClick={() => runClose(() => closeExciseMonthAction(month, entityId, mcNote), "ปิดเดือนแล้ว")}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:opacity-90 disabled:opacity-50"
                >
                  ปิดเดือน
                </button>
                <button
                  type="button"
                  disabled={!mayClose || mcBusy || pendingN === 0}
                  onClick={() => runClose(() => recomputeExciseHiddenAction(month, entityId), "คำนวณใหม่แล้ว")}
                  className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium text-muted hover:bg-raised disabled:opacity-50"
                  title={pendingN === 0 ? "ไม่มีคู่ จ่าย/รับ ที่ต้องปรับ" : undefined}
                >
                  คำนวณใหม่ตามจริง
                </button>
              </>
            )}
          </div>
          {!mayClose && (
            <p className="mt-2 text-sm text-warn">
              ปิด/ถอนปิดเดือนได้เฉพาะ {capHolderText("prod.config")} — บทบาทนี้ดูสถานะได้อย่างเดียว
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={box}>
          <label className="mb-2 flex items-center gap-2 font-semibold text-ink">
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

        {/* D78: ฟอร์มผลิตแยกใบตามประเภทสุรา — กล่องที่ไม่มีสินค้าเลยจะไม่โผล่ */}
        {options.productNamesDistilled.length > 0 && (
          <div className={box}>
            <label className="mb-2 flex items-center gap-2 font-semibold text-ink">
              <input type="checkbox" checked={en["0702_1"]} onChange={(e) => setEn({ ...en, "0702_1": e.target.checked })} />
              ภส.๐๗-๐๒/๑(๑) บัญชีผลิต<b>สุรากลั่น</b> (ต่อชื่อสุรา)
            </label>
            <div className="max-h-48 space-y-0.5 overflow-y-auto pl-6">
              {options.productNamesDistilled.map((n) => (
                <label key={n} className={chk}>
                  <input type="checkbox" checked={sel0702_1.includes(n)} onChange={() => toggle(sel0702_1, setSel0702_1, n)} />
                  {n}
                </label>
              ))}
            </div>
          </div>
        )}

        {options.productNamesFermented.length > 0 && (
          <div className={box}>
            <label className="mb-2 flex items-center gap-2 font-semibold text-ink">
              <input type="checkbox" checked={en["0702_1_chae"]} onChange={(e) => setEn({ ...en, "0702_1_chae": e.target.checked })} />
              ภส.๐๗-๐๒/๑(๑) บัญชีผลิต<b>สุราแช่</b> (ต่อชื่อสุรา)
            </label>
            <div className="max-h-48 space-y-0.5 overflow-y-auto pl-6">
              {options.productNamesFermented.map((n) => (
                <label key={n} className={chk}>
                  <input type="checkbox" checked={sel0702_1_chae.includes(n)} onChange={() => toggle(sel0702_1_chae, setSel0702_1Chae, n)} />
                  {n}
                </label>
              ))}
            </div>
            <p className="mt-2 pl-6 text-xs text-faint">คนละกระดาษกับฉบับสุรากลั่น แม้เลขฟอร์มบนหัวกระดาษจะเหมือนกัน</p>
          </div>
        )}

        <div className={box}>
          <label className="mb-2 flex items-center gap-2 font-semibold text-ink">
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
          <label className="mb-2 flex items-center gap-2 font-semibold text-ink">
            <input type="checkbox" checked={en["0704"]} onChange={(e) => setEn({ ...en, "0704": e.target.checked })} />
            ภส.๐๗-๐๔/๑ งบเดือน (รวมทั้งกิจการ)
          </label>
          <p className="pl-6 text-sm text-faint">ออกทั้งเดือน ไม่ต้องเลือกรายการ</p>
        </div>
      </div>
    </div>
  );
}
