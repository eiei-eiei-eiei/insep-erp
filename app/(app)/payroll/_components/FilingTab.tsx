"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card, Field, Select, NumBox, TextInput, Empty, Stat, RowBtn, SaveButton, Msg, useSaver, fmt, EscToClose, LoadError,
} from "@/lib/shared/ui";
import {
  pnd1Rows, sso110Rows, pnd1kRows, wht50Totals, yearBEfromCE, empDisplayName, countsForFiling,
  type FilingItem, type FilingEmployee,
} from "@/lib/payroll/filings";
import {
  pnd1Html, sso110Html, pnd1kHtml, printFilingDoc, toTsv, thaiMonthYear, formatNationalId,
  type FilingEntity,
} from "@/lib/payroll/filingHtml";
import { getFilingPeriodAction, getFilingYearAction } from "../read-actions";
import { issueEmp50TawiAction, nextEmpWhtDocNoAction } from "../actions";
import type { PeriodRow, EmpCertRow } from "../data";

/**
 * แท็บ "เอกสารยื่น" — ภงด.1 · สปส.1-10 · ภงด.1ก · 50ทวิ
 *
 * 🎯 ออกแบบรอบ **"คนกรอกเว็บราชการเอง"** ไม่ใช่ "คนพิมพ์กระดาษ" (ผู้ใช้ยืนยัน 2026-08-19)
 *    → กล่องยอดรวมตัวใหญ่ + ปุ่มคัดลอกตาราง เป็นของหลัก · พิมพ์เป็นของรอง
 *
 * 🚨 ตัวเลขทุกตัวมาจาก `payroll_items` ที่แช่ไว้ตอนกดบันทึกงวด **ไม่คำนวณสดจาก config**
 *    (ดูเหตุผลเต็มในหัว `lib/payroll/filings.ts`)
 */

type Doc = "pnd1" | "sso110" | "pnd1k" | "wht50";

const DOC_LABEL: Record<Doc, string> = {
  pnd1: "ภ.ง.ด.1 (รายเดือน)",
  sso110: "สปส.1-10 (รายเดือน)",
  pnd1k: "ภ.ง.ด.1ก (รายปี)",
  wht50: "50 ทวิ (รายคน/ปี)",
};

const EMPTY_ENTITY: FilingEntity = { entityId: "", name: "" };

export function FilingTab({ periods, active }: { periods: PeriodRow[]; active: boolean }) {
  const [doc, setDoc] = useState<Doc>("pnd1");
  const monthly = doc === "pnd1" || doc === "sso110";

  // 🚨 งวดร่างต้องเลือกไม่ได้ตั้งแต่แรก — เอกสารยื่นนับเฉพาะงวดที่ลงบัญชีแล้ว (D81)
  //    `periods` มี status ติดมาจาก getPeriods() อยู่แล้ว ไม่ต้อง query เพิ่ม
  const filedPeriods = periods.filter((p) => countsForFiling(p.status));

  const [periodId, setPeriodId] = useState(filedPeriods[0]?.periodId ?? "");
  const [year, setYear] = useState(filedPeriods[0]?.year ?? new Date().getFullYear());

  const [entity, setEntity] = useState<FilingEntity>(EMPTY_ENTITY);
  const [items, setItems] = useState<FilingItem[]>([]);
  const [emps, setEmps] = useState<FilingEmployee[]>([]);
  const [certs, setCerts] = useState<EmpCertRow[]>([]);
  const [period, setPeriod] = useState<PeriodRow | null>(null);
  const [draftPeriodIds, setDraftPeriodIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);
  /** ข้อมูลที่ถืออยู่ตอนนี้เป็นของอะไร — เซ็ตพร้อมข้อมูลเสมอ (ดู `ready` ข้างล่าง) */
  const [loadedKey, setLoadedKey] = useState("");

  const key = monthly ? `p:${periodId}` : `y:${year}`;

  const load = useCallback(() => {
    if (monthly && !periodId) return;
    setLoading(true);
    const p = monthly
      ? getFilingPeriodAction(periodId).then((d) => {
          setPeriod(d.period);
          setCerts([]);
          setDraftPeriodIds([]);
          return d;
        })
      : getFilingYearAction(year).then((d) => {
          setPeriod(null);
          setCerts(d.certs);
          setDraftPeriodIds(d.draftPeriodIds);
          return d;
        });
    setErr(false);
    p.then((d) => {
      setEntity(d.entity);
      setItems(d.items);
      setEmps(d.emps);
      setLoadedKey(monthly ? `p:${periodId}` : `y:${year}`);
      setLoading(false);
    }).catch(() => {
      // 🚨 D89 — เอกสารพวกนี้ยื่นสรรพากร/ประกันสังคม · โหลดไม่ครบต้องไม่ปล่อยให้กดพิมพ์
      setErr(true);
      setLoading(false);
    });
  }, [monthly, periodId, year]);

  useEffect(() => { if (active) load(); }, [active, load]);

  /**
   * 🚨 ห้าม render เอกสารด้วยข้อมูลของเอกสารคนละชนิด
   *
   * `setLoading(true)` อยู่ใน `load()` ซึ่งถูกเรียกจาก useEffect = **หลัง** render ที่ `doc`
   * เปลี่ยนไปแล้ว → เฟรมนั้น doc เป็นรายเดือนแต่ `items` ยังเป็นชุดทั้งปี ทำให้ใบแนบ
   * ภ.ง.ด.1 ของเดือนเดียวขึ้นยอด**ทั้งปี** ชั่วขณะ (React ฟ้อง duplicate key มาตลอด)
   * → กดปุ่มคัดลอก/พิมพ์จังหวะนั้น = ได้เอกสารยื่นที่ยอดผิด
   *
   * 🪤 กันทั้งคลาสด้วยการผูก "ข้อมูล" กับ "ข้อมูลนี้เป็นของอะไร" ไว้ด้วยกัน — เช็ค `loading` อย่างเดียวไม่พอ
   */
  const ready = !loading && loadedKey === key;

  const monthLabel = period ? thaiMonthYear(period.month, yearBEfromCE(period.year)) : "";
  const yearBE = yearBEfromCE(year);

  return (
    <div className="space-y-4">
      <Card title="เลือกเอกสาร">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="เอกสาร">
            <Select value={doc} onChange={(e) => setDoc(e.target.value as Doc)}>
              {(Object.keys(DOC_LABEL) as Doc[]).map((d) => (
                <option key={d} value={d}>{DOC_LABEL[d]}</option>
              ))}
            </Select>
          </Field>
          {monthly ? (
            <Field label="งวด">
              <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
                {filedPeriods.length === 0 && <option value="">— ยังไม่มีงวดที่ลงบัญชีแล้ว —</option>}
                {filedPeriods.map((p) => (
                  <option key={p.periodId} value={p.periodId}>
                    {thaiMonthYear(p.month, yearBEfromCE(p.year))}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="ปีภาษี (ค.ศ.)">
              <NumBox value={year} onChange={(v) => setYear(v === "" ? new Date().getFullYear() : v)} />
            </Field>
          )}
        </div>
        <p className="mt-2 text-xs text-faint">
          นับเฉพาะงวดที่ <b>ลงบัญชีแล้ว</b> (ครบทุกขาหรือบางขาก็ได้) —
          งวดร่างที่ยังไม่ลงบัญชีสักขา<b>ไม่นับ</b> และเลือกที่นี่ไม่ได้ ·
          ต้องไปลงบัญชีที่แท็บ <b>งวดจ่าย</b> ก่อน
          {!monthly && <> · ปี {year} = พ.ศ. {yearBE}</>}
        </p>
      </Card>

      {loading && <p className="text-sm text-faint">กำลังโหลด…</p>}
      {/* 🚨 D89 — เอกสารยื่นราชการ · โหลดไม่ครบแล้วพิมพ์ = ยื่นขาดคน/ยอดผิด */}
      <LoadError err={err} onRetry={load} what="ข้อมูลเอกสารยื่น" />

      {!loading && !monthly && <DraftNote periodIds={draftPeriodIds} />}

      {ready && items.length === 0 && (
        <Empty>
          {filedPeriods.length === 0
            ? "— ยังไม่มีงวดที่ลงบัญชีแล้ว จึงยังออกเอกสารยื่นไม่ได้ —"
            : `— ไม่มีงวดที่ลงบัญชีแล้ว${monthly ? "ในงวดนี้" : ` ในปี ${year}`} —`}
        </Empty>
      )}

      {ready && items.length > 0 && doc === "pnd1" && (
        <Pnd1View entity={entity} items={items} emps={emps} monthLabel={monthLabel} />
      )}
      {ready && items.length > 0 && doc === "sso110" && (
        <Sso110View entity={entity} items={items} emps={emps} monthLabel={monthLabel} />
      )}
      {ready && items.length > 0 && doc === "pnd1k" && (
        <Pnd1kView entity={entity} items={items} emps={emps} yearBE={yearBE} />
      )}
      {ready && items.length > 0 && doc === "wht50" && (
        <Wht50View
          entity={entity} items={items} emps={emps} yearBE={yearBE}
          certs={certs} onIssued={load}
        />
      )}
    </div>
  );
}

// ── ชิ้นส่วนที่ใช้ร่วม ─────────────────────────────────────────────────────────

/** ปุ่มคัดลอกตาราง — ตัวช่วยหลักของแท็บนี้ (ผู้ใช้กรอกเว็บราชการเอง) */
function CopyBtn({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  const [done, setDone] = useState(false);
  return (
    <RowBtn
      tone="brand"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(toTsv(headers, rows));
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          alert("คัดลอกไม่สำเร็จ — เบราว์เซอร์ไม่อนุญาต");
        }
      }}
    >
      {done ? "คัดลอกแล้ว ✓" : "คัดลอกตาราง"}
    </RowBtn>
  );
}

/** ป้ายเตือนงวดเก่าที่ยังไม่มีฐานภาษีแช่ไว้ — ห้าม fallback เงียบ ๆ */
function FallbackNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="mb-3 rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn">
      ⚠ งวดนี้บันทึกไว้ก่อนระบบแยก &ldquo;ฐานภาษี&rdquo; ออกจาก &ldquo;รวมเงินได้&rdquo; —
      ช่องเงินได้จึงใช้<b>ยอดรวมเงินได้</b>แทน · ถ้ามีรายการที่ไม่ติดธงภาษี
      ให้กด <b>คำนวณ &amp; บันทึก</b> งวดนั้นใหม่เพื่อให้ตัวเลขตรง
    </div>
  );
}

/**
 * ป้ายบอกว่ายอดทั้งปี **ข้ามงวดไหนไปบ้าง** (D81)
 *
 * 🚨 ห้ามข้ามงวดเงียบ ๆ — ผู้ใช้เห็นยอดปีในแท็บ *รายงาน* (นับทุกงวดที่บันทึกไว้)
 *    ไม่ตรงกับแท็บนี้ (นับเฉพาะที่ลงบัญชีแล้ว) แล้วไล่หาสาเหตุไม่เจอ
 *    บทเรียน D75: ต่างกันได้ แต่ต้องบอกให้ชัดว่าอันไหนคืออันไหน
 */
function DraftNote({ periodIds }: { periodIds: string[] }) {
  if (periodIds.length === 0) return null;
  const months = periodIds
    .map((id) => {
      const m = /^PR-(\d{4})-(\d{2})$/.exec(id);
      return m ? thaiMonthYear(Number(m[2]), yearBEfromCE(Number(m[1]))) : id;
    })
    .join(" · ");
  return (
    <div className="rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn">
      ⚠ ยอดทั้งปีนี้<b>ไม่รวม {periodIds.length} งวดที่ยังเป็นงวดร่าง</b> — {months}
      <br />
      งวดร่าง = ยังไม่ได้ลงบัญชีสักขา จึงยังไม่นับเป็นเงินได้ที่จ่ายจริง ·
      ถ้าจ่ายไปแล้วให้ไป<b>ลงบัญชีที่แท็บ งวดจ่าย</b> แล้วยอดจะรวมให้เอง
    </div>
  );
}

function DocActions({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 flex flex-wrap gap-2">{children}</div>;
}

// ── ภ.ง.ด.1 ──────────────────────────────────────────────────────────────────
function Pnd1View({
  entity, items, emps, monthLabel,
}: { entity: FilingEntity; items: FilingItem[]; emps: FilingEmployee[]; monthLabel: string }) {
  const r = pnd1Rows(items, emps);
  const headers = ["ที่", "ชื่อ-สกุล", "เลขประจำตัวผู้เสียภาษี", "เงินได้", "ภาษีที่หัก"];
  const tsvRows = r.rows.map((x) => [x.seq, x.name, x.nationalId, x.income, x.wht]);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="ผู้มีเงินได้ทั้งหมด" value={`${r.count} ราย`} />
        <Stat label="ในนั้นถูกหักภาษี" value={`${r.countWithTax} ราย`} />
        <Stat label="เงินได้รวม" value={fmt(r.totalIncome)} />
        <Stat label="ภาษีนำส่ง" value={fmt(r.totalWht)} tone="green" />
      </div>

      <Card title={`ใบแนบ ภ.ง.ด.1 — ${monthLabel}`}>
        <FallbackNote show={r.usedGrossFallback} />
        <DocActions>
          <CopyBtn headers={headers} rows={tsvRows} />
          <RowBtn onClick={() => printFilingDoc(`ภงด1 ${monthLabel}`, pnd1Html(entity, monthLabel, r))}>
            พิมพ์ / บันทึก PDF
          </RowBtn>
        </DocActions>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr className="text-left text-faint">
                <th>ที่</th><th>ชื่อ-สกุล</th><th>เลขประจำตัวผู้เสียภาษี</th>
                <th className="num">เงินได้</th><th className="num">ภาษีที่หัก</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={x.empId}>
                  <td>{x.seq}</td>
                  <td>{x.name}</td>
                  <td className="tnum">{formatNationalId(x.nationalId) || "—"}</td>
                  <td className="num">{fmt(x.income)}</td>
                  <td className="num">{fmt(x.wht)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-faint">
          ★ คนที่ภาษีเป็น 0 <b>ต้องอยู่ในใบแนบด้วย</b> — แบบถามจำนวน &ldquo;ผู้มีเงินได้&rdquo;
          ไม่ใช่จำนวนผู้ถูกหักภาษี
        </p>
      </Card>
    </>
  );
}

// ── สปส.1-10 ─────────────────────────────────────────────────────────────────
function Sso110View({
  entity, items, emps, monthLabel,
}: { entity: FilingEntity; items: FilingItem[]; emps: FilingEmployee[]; monthLabel: string }) {
  const r = sso110Rows(items, emps);
  const headers = ["ที่", "เลข ปกส./เลขบัตร", "ชื่อ-สกุล", "ค่าจ้าง", "เงินสมทบ"];
  const tsvRows = r.rows.map((x) => [x.seq, x.ssoRef, x.name, x.wage, x.sso]);
  const excluded = items.length - r.count;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="ผู้ประกันตน" value={`${r.count} คน`} />
        <Stat label="ค่าจ้างรวม" value={fmt(r.totalWage)} />
        <Stat label="ส่วนลูกจ้าง" value={fmt(r.totalEmployee)} />
        <Stat label="รวมนำส่ง" value={fmt(r.grandTotal)} tone="green" />
      </div>

      <Card title={`สปส.1-10 — ${monthLabel}`}>
        <DocActions>
          <CopyBtn headers={headers} rows={tsvRows} />
          <RowBtn onClick={() => printFilingDoc(`สปส1-10 ${monthLabel}`, sso110Html(entity, monthLabel, r))}>
            พิมพ์ / บันทึก PDF
          </RowBtn>
        </DocActions>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr className="text-left text-faint">
                <th>ที่</th><th>เลข ปกส./เลขบัตร</th><th>ชื่อ-สกุล</th>
                <th className="num">ค่าจ้าง</th><th className="num">เงินสมทบ</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={x.empId}>
                  <td>{x.seq}</td>
                  <td className="tnum">{x.ssoRef || "—"}</td>
                  <td>{x.name}</td>
                  <td className="num">{fmt(x.wage)}</td>
                  <td className="num">{fmt(x.sso)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 rounded-lg bg-raised px-3 py-2 text-xs text-muted">
          เงินสมทบส่วนนายจ้าง <b>{fmt(r.totalEmployer)}</b> บาท ·
          รวมนำส่งทั้งสิ้น <b>{fmt(r.grandTotal)}</b> บาท
          <br />
          ★ ค่าจ้างที่แสดง = <b>ฐานที่ใช้คิดเงินสมทบ</b> (บีบเพดานแล้ว) ไม่ใช่รวมเงินได้
          {excluded > 0 && (
            <>
              <br />
              ★ ไม่นับ <b>{excluded} คน</b> ที่ตั้งไว้ว่า &ldquo;ยกเว้นประกันสังคม&rdquo;
              ในทะเบียนพนักงาน (ไม่ใช่ผู้ประกันตน)
            </>
          )}
        </div>
      </Card>
    </>
  );
}

// ── ภ.ง.ด.1ก ─────────────────────────────────────────────────────────────────
function Pnd1kView({
  entity, items, emps, yearBE,
}: { entity: FilingEntity; items: FilingItem[]; emps: FilingEmployee[]; yearBE: number }) {
  const r = pnd1kRows(items, emps);
  const headers = ["ที่", "ชื่อ-สกุล", "เลขประจำตัวผู้เสียภาษี", "เงินได้ทั้งปี", "ภาษีหักทั้งปี"];
  const tsvRows = r.rows.map((x) => [x.seq, x.name, x.nationalId, x.income, x.wht]);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="ผู้มีเงินได้ทั้งหมด" value={`${r.count} ราย`} />
        <Stat label="ในนั้นถูกหักภาษี" value={`${r.countWithTax} ราย`} />
        <Stat label="เงินได้ทั้งปี" value={fmt(r.totalIncome)} />
        <Stat label="ภาษีนำส่งทั้งปี" value={fmt(r.totalWht)} tone="green" />
      </div>

      <Card title={`ภ.ง.ด.1ก — ปีภาษี ${yearBE}`}>
        <FallbackNote show={r.usedGrossFallback} />
        <DocActions>
          <CopyBtn headers={headers} rows={tsvRows} />
          <RowBtn onClick={() => printFilingDoc(`ภงด1ก ${yearBE}`, pnd1kHtml(entity, yearBE, r))}>
            พิมพ์ / บันทึก PDF
          </RowBtn>
        </DocActions>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr className="text-left text-faint">
                <th>ที่</th><th>ชื่อ-สกุล</th><th>เลขประจำตัวผู้เสียภาษี</th>
                <th className="num">งวด</th>
                <th className="num">เงินได้ทั้งปี</th><th className="num">ภาษีหักทั้งปี</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={x.empId}>
                  <td>{x.seq}</td>
                  <td>{x.name}</td>
                  <td className="tnum">{formatNationalId(x.nationalId) || "—"}</td>
                  <td className="num">{x.periods}</td>
                  <td className="num">{fmt(x.income)}</td>
                  <td className="num">{fmt(x.wht)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-faint">
          ★ ยอดรวมที่นี่ต้องเท่ากับผลบวกของ ภ.ง.ด.1 ทุกงวดในปีนั้น (มีเทสคุมไว้)
        </p>
      </Card>
    </>
  );
}

// ── 50 ทวิ ───────────────────────────────────────────────────────────────────
function Wht50View({
  entity, items, emps, yearBE, certs, onIssued,
}: {
  entity: FilingEntity;
  items: FilingItem[];
  emps: FilingEmployee[];
  yearBE: number;
  certs: EmpCertRow[];
  onIssued: () => void;
}) {
  const router = useRouter();
  const { pending, msg, run } = useSaver();
  const [target, setTarget] = useState<{ empId: string; name: string } | null>(null);
  const [docNo, setDocNo] = useState("");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));

  // รายชื่อที่มีงวดในปีนั้น (เรียงตามรหัส) — ออกใบให้ได้ทุกคนแม้ภาษี 0
  const empIds = [...new Set(items.map((i) => i.empId))].sort();
  const certOf = (empId: string) => certs.find((c) => c.empId === empId);

  // 🚨 ต้องเป็น entity จริง — ส่งค่าว่างไป `nextWhtDocNo` จะนับจากศูนย์แล้ว**ออกเลขซ้ำกับใบที่มีอยู่**
  //    และ RPC จะ fallback ไป 'EID01' ที่ฮาร์ดโค้ดไว้ ซึ่งผิดกิจการทันทีสำหรับลูกค้ารายอื่น
  const entityId = entity.entityId;

  async function openIssue(empId: string, name: string) {
    setTarget({ empId, name });
    setDocNo(await nextEmpWhtDocNoAction(entityId));
  }

  return (
    <Card title={`50 ทวิ — ปีภาษี ${yearBE}`}>
      <p className="mb-3 text-xs text-faint">
        ★ <b>ออกให้ได้ทุกคน แม้ภาษีเป็น 0</b> — ม.50 ทวิ ไม่ได้ยกเว้นกรณีไม่มีภาษี
        และลูกจ้างต้องใช้ใบนี้ไปยื่น ภ.ง.ด.91 ของตัวเอง
        <br />
        ★ เลขที่เอกสารต่อเนื่อง<b>ชุดเดียวกับใบ 50ทวิ ของคู่ค้า</b>ในแท็บบัญชี
      </p>
      <Msg msg={msg} />

      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr className="text-left text-faint">
              <th>รหัส</th><th>ชื่อ-สกุล</th><th className="num">งวด</th>
              <th className="num">เงินได้ทั้งปี</th><th className="num">ภาษีทั้งปี</th>
              <th className="num">ประกันสังคม</th><th>ใบที่ออกแล้ว</th><th></th>
            </tr>
          </thead>
          <tbody>
            {empIds.map((empId) => {
              const t = wht50Totals(items, empId);
              const cert = certOf(empId);
              // ชื่อปัจจุบันเสมอ · snapshot เป็น fallback ตอนพนักงานถูกลบ (D80)
              // 🪤 ใบที่ **ออกไปแล้ว** ต้องคงชื่อที่พิมพ์ลงกระดาษไปแล้ว — ใบนั้นอยู่ในมือพนักงานจริง
              //    พิมพ์ซ้ำต้องได้ข้อความเดิมเป๊ะ ไม่งั้นเอกสาร 2 ใบเลขเดียวกันชื่อไม่ตรงกัน
              const name =
                cert?.empName ||
                empDisplayName(emps, empId, items.find((i) => i.empId === empId)?.empName) ||
                empId;
              return (
                <tr key={empId}>
                  <td className="tnum">{empId}</td>
                  <td>{name}</td>
                  <td className="num">{t.periods}</td>
                  <td className="num">{fmt(t.income)}</td>
                  <td className="num">{fmt(t.wht)}</td>
                  <td className="num">{fmt(t.sso)}</td>
                  <td className="text-xs">
                    {cert ? `${cert.docNo} (${cert.issueDate})` : <span className="text-faint">—</span>}
                  </td>
                  <td className="whitespace-nowrap">
                    {cert ? (
                      <span className="text-xs text-faint">ออกแล้ว</span>
                    ) : (
                      <RowBtn tone="brand" onClick={() => openIssue(empId, name)}>ออก 50ทวิ</RowBtn>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/30 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setTarget(null); }}>
          <EscToClose onClose={() => { setTarget(null); }} />
          <div className="w-full max-w-md rounded-lg bg-card p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 font-semibold text-ink">ออก 50 ทวิ — {target.name}</h3>
            <div className="space-y-3">
              <Field label="เลขที่เอกสาร">
                <TextInput value={docNo} onChange={(e) => setDocNo(e.target.value)} />
              </Field>
              <Field label="วันที่ออกหนังสือ">
                <TextInput type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </Field>
            </div>
            <p className="mt-3 text-xs text-faint">
              เงินได้ทั้งปี <b>{fmt(wht50Totals(items, target.empId).income)}</b> ·
              ภาษี <b>{fmt(wht50Totals(items, target.empId).wht)}</b> บาท
              <br />
              ★ ออกได้ <b>ครั้งเดียวต่อคนต่อปีภาษี</b> — DB กันใบซ้ำไว้ (ลูกจ้างถือ 2 ใบไปยื่นภาษีไม่ได้)
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setTarget(null)} className="rounded-lg border border-line px-4 py-2 text-sm">ยกเลิก</button>
              <SaveButton
                pending={pending}
                onClick={() => {
                  const t = wht50Totals(items, target.empId);
                  const e = emps.find((x) => x.empId === target.empId);
                  run(
                    () => issueEmp50TawiAction({
                      docNo, entityId, empId: target.empId, empName: target.name,
                      address: e?.address ?? "", taxYearBE: yearBE,
                      income: t.income, whtAmount: t.wht, issueDate,
                    }),
                    "ออกเอกสารแล้ว",
                    () => { setTarget(null); onIssued(); router.refresh(); },
                  );
                }}
              >
                ออกเอกสาร
              </SaveButton>
            </div>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-faint">
        เอกสาร PDF ของ 50ทวิ พิมพ์จากแท็บ <b>บัญชี → เอกสารสรรพากร</b> (ใช้ฟอร์ม AcroForm ตัวเดียวกัน)
        — ใบที่ออกจากที่นี่จะไปโผล่ในทะเบียนเดียวกัน
      </p>
    </Card>
  );
}

