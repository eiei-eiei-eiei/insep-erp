"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Field, Msg, NumBox, SaveButton, Select, TextInput, useSaver, Empty, fmt } from "@/lib/shared/ui";
import { calcPayrollLine } from "@/lib/payroll/calc";
import { ratesOn } from "@/lib/payroll/sso";
import { printSlips, type SlipData } from "@/lib/payroll/slip";
import { legCoverage, legTotal, suggestLegDate } from "@/lib/payroll/legs";
import { shownLine, differsFromStored } from "@/lib/payroll/periodView";
import type { PayrollLine } from "@/lib/payroll/types";
import {
  createPeriodAction,
  savePeriodLinesAction,
  postPayrollAction,
  unpostPayrollAction,
  type LineInput,
} from "../actions";
import { getPeriodDetailAction } from "../read-actions";
import type { EmployeeRow, ItemRow, PeriodRow } from "../data";
import type { PayrollConfig } from "./PayrollApp";

/**
 * แท็บงวดจ่าย
 *
 * 🪤 พรีวิวสดบนหน้าจอเรียก `calcPayrollLine` **ตัวเดียวกับที่ฝั่ง server ใช้ตอนบันทึก**
 *    ห้ามเขียนสูตรซ้ำที่นี่เด็ดขาด (ระบบเดิมบน GAS เขียนซ้ำ 2 ที่ แล้วใบเบี้ยขยัน
 *    กับยอดที่จ่ายจริงจะเพี้ยนกันทันทีที่แก้เกณฑ์ที่เดียว)
 */


export function PeriodTab({
  config,
  employees,
  periods,
  active,
}: {
  config: PayrollConfig;
  employees: EmployeeRow[];
  periods: PeriodRow[];
  active: boolean;
}) {
  const router = useRouter();
  const { pending, msg, run } = useSaver();
  const now = new Date();

  const [periodId, setPeriodId] = useState(periods[0]?.periodId ?? "");
  const [period, setPeriod] = useState<PeriodRow | null>(periods[0] ?? null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [draft, setDraft] = useState<Record<string, LineInput>>({});
  const [loading, setLoading] = useState(false);

  // ฟอร์มสร้างงวด
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [workDaysStd, setWorkDaysStd] = useState(30);
  const [payDate, setPayDate] = useState("");
  const [postDate, setPostDate] = useState("");

  const load = useCallback((id: string) => {
    if (!id) return;
    setLoading(true);
    getPeriodDetailAction(id).then((d) => {
      setPeriod(d.period);
      setItems(d.items);
      setDraft(Object.fromEntries(d.items.map((i) => [i.empId, {
        empId: i.empId,
        workDays: i.inputs.workDays ?? d.period?.workDaysStd ?? 0,
        values: i.inputs.values ?? {},
        manual: i.inputs.manual ?? {},
        whtOverride: i.inputs.whtOverride ?? null,
      }])));
      setLoading(false);
    });
  }, []);

  useEffect(() => { if (active && periodId) load(periodId); }, [active, periodId, load]);

  const locked = period != null && period.status !== "draft";

  // ── พรีวิวสด ────────────────────────────────────────────────────────────────
  const rates = useMemo(
    () => (period ? ratesOn(config.rates, lastDayISO(period.year, period.month)) : null),
    [period, config.rates],
  );

  const live = useMemo(() => {
    if (!period || !rates) return {} as Record<string, PayrollLine>;
    const out: Record<string, PayrollLine> = {};
    for (const it of items) {
      const d = draft[it.empId];
      if (!d) continue;
      const emp = empOf(it, employees);
      if (!emp) continue;
      out[it.empId] = calcPayrollLine(
        emp,
        { workDays: d.workDays, values: d.values, manual: d.manual, whtOverride: d.whtOverride },
        config.components,
        rates,
        config.settings,
        { workDaysStd: period.workDaysStd, monthOfYear: period.month, yearBE: String(period.year + 543) },
        config.variables,
      );
    }
    return out;
  }, [items, draft, period, rates, config, employees]);

  /**
   * ค่าที่ "เอาไปแสดง" — ตัดสินจาก **สถานะของงวด** ไม่ใช่ว่าเคยบันทึกไว้หรือยัง
   *
   * | งวด | แสดง | เพราะ |
   * |---|---|---|
   * | ลงบัญชีแล้ว (`locked`) | **ค่าที่แช่ไว้** | เป็นบันทึกทางประวัติศาสตร์ — ต้องตรงกับที่ยื่น/ลงบัญชีไปแล้ว และแก้อะไรไม่ได้อยู่แล้ว |
   * | ร่าง | **ค่าที่คิดสด** | ยังทำงานอยู่ · แก้เงินเดือน/ชนิดค่าจ้างของพนักงานแล้วต้องเห็นผลทันที |
   *
   * 🪤 D73 เคยให้ "ร่างที่เคยบันทึกแล้ว" โชว์ค่าที่แช่ไว้ด้วย → ผู้ใช้แก้ฐานเงินเดือนในทะเบียน
   *    พนักงานแล้วเปิดงวดร่างมาดู เห็นยอดเดิม เลยเข้าใจว่า **"คำนวณผิด"**
   *    → ตัวเลขที่ต่างจากที่บันทึกไว้ต้อง **แสดงคู่กัน** (คอลัมน์สุทธิมีบรรทัด "บันทึกไว้ …")
   *      ไม่ใช่เลือกโชว์อันใดอันหนึ่งแล้วให้เดาเอง
   */
  const shown = useMemo(() => {
    const out: Record<string, PayrollLine> = {};
    for (const it of items) {
      const stored = storedLine(it);
      const v = shownLine(locked, stored, live[it.empId]);
      if (v) out[it.empId] = v;
    }
    return out;
  }, [items, live, locked]);

  /** ค่าที่บันทึกไว้ของแถวที่ **ต่างจากที่กำลังแสดง** — เอาไปโชว์คู่กันให้เห็นทั้งสองอัน */
  const storedDiff = useMemo(() => {
    const out: Record<string, PayrollLine> = {};
    for (const it of items) {
      const st = storedLine(it);
      if (st && differsFromStored(st, shown[it.empId])) out[it.empId] = st;
    }
    return out;
  }, [items, shown]);

  const drifted = Object.keys(storedDiff).length;

  const totals = useMemo(() => {
    const v = Object.values(shown);
    return {
      gross: v.reduce((s, l) => s + l.gross, 0),
      sso: v.reduce((s, l) => s + l.sso, 0),
      wht: v.reduce((s, l) => s + l.wht, 0),
      net: v.reduce((s, l) => s + l.net, 0),
    };
  }, [shown]);

  // รายการ manual = คอลัมน์กรอกเองในตาราง
  const manualComps = config.components.filter((c) => c.method === "manual" && c.active !== false);

  function setVal(empId: string, key: string, v: number, bucket: "values" | "manual") {
    setDraft((p) => ({ ...p, [empId]: { ...p[empId], [bucket]: { ...p[empId][bucket], [key]: v } } }));
  }

  /** แก้ช่องอื่นของแถว (วันมาทำงาน / override ภาษี) */
  function setRow(empId: string, patch: Partial<LineInput>) {
    setDraft((p) => ({ ...p, [empId]: { ...p[empId], ...patch } }));
  }

  function doSave() {
    run(() => savePeriodLinesAction(periodId, Object.values(draft)), "คำนวณและบันทึกแล้ว", () => {
      load(periodId);
      router.refresh();
    });
  }

  function doPost(legCode: string, name: string, date: string) {
    if (!date) { alert("เลือกวันที่ลงบัญชีก่อน"); return; }
    run(() => postPayrollAction(periodId, legCode, date), `ลงบัญชี${name}แล้ว`, () => {
      load(periodId);
      router.refresh();
    });
  }

  function doUnpost(legCode: string, name: string) {
    if (!confirm(`ถอนการลงบัญชี${name}? รายการในบัญชีจะถูกเปลี่ยนเป็น "ยกเลิก" (ไม่ได้ลบทิ้ง)`)) return;
    run(() => unpostPayrollAction(periodId, legCode), "ถอนแล้ว", () => {
      load(periodId);
      router.refresh();
    });
  }

  function doPrint() {
    if (!period) return;
    const slips: SlipData[] = items.map((it) => {
      const l = shown[it.empId];
      const d = draft[it.empId];
      const emp = empOf(it, employees);
      const baseLabel =
        emp?.wageType === "monthly"
          ? "เงินเดือน"
          : `${emp?.wageType === "daily" ? "ค่าแรง" : "เงินเดือน"} (${d?.workDays ?? 0} วัน)`;
      return {
        companyName: config.entityId || "บริษัท",
        periodLabel: `${String(period.month).padStart(2, "0")}/${period.year}`,
        payDate: period.payDate ?? undefined,
        empName: nameOf(it, employees),
        empId: it.empId,
        groupLabel: it.groupCode ?? undefined,
        baseLabel,
        baseAmount: l?.baseAmount ?? it.baseAmount,
        items: l?.items ?? [],
        sso: l?.sso ?? it.sso,
        wht: l?.wht ?? it.wht,
        gross: l?.gross ?? it.gross,
        net: l?.net ?? it.net,
      };
    });
    if (slips.length === 0) { alert("งวดนี้ยังไม่มีพนักงาน"); return; }
    printSlips(slips);
  }

  const posted = (code: string) => Boolean(period?.postState?.[code]);

  // ── ตัวเลขคุมกันลงรายจ่ายซ้ำ/ขาด ────────────────────────────────────────────
  //    ขาที่ลูกค้าตั้งเองอาจยอดซ้อนกันได้ และไม่มีอะไรใน DB ฟ้อง → ต้องโชว์ให้เห็น
  const legLines = items.map((it) => {
    const l = shown[it.empId];
    return {
      gross: l?.gross ?? it.gross,
      net: l?.net ?? it.net,
      sso: l?.sso ?? it.sso,
      ssoEmployer: it.ssoEmployer,
      wht: l?.wht ?? it.wht,
      items: l?.items ?? [],
    };
  });
  const coverage = legCoverage(config.legs, legLines);

  return (
    <div className="space-y-4">
      <Card title="เลือก / สร้างงวด">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          <Field label="งวดที่มีอยู่">
            <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
              <option value="">— เลือกงวด —</option>
              {periods.map((p) => (
                <option key={p.periodId} value={p.periodId}>
                  {p.periodId} ({p.status === "draft" ? "ร่าง" : p.status === "partial" ? "ลงบัญชีบางส่วน" : "ลงบัญชีครบ"})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ปี (ค.ศ.)"><NumBox value={year} onChange={(v) => setYear(v === "" ? now.getFullYear() : v)} /></Field>
          <Field label="เดือน"><NumBox value={month} onChange={(v) => setMonth(v === "" ? 1 : v)} /></Field>
          <Field label="วันทำงานมาตรฐาน"><NumBox value={workDaysStd} onChange={(v) => setWorkDaysStd(v === "" ? 0 : v)} /></Field>
          <Field label="วันจ่ายเงินเดือน"><TextInput type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></Field>
        </div>
        <p className="mt-2 text-xs text-faint">
          &ldquo;วันทำงานมาตรฐาน&rdquo; คือตัวหารของพนักงานแบบลดตามวันมาทำงาน — ตกลงกันภายในว่าจะใช้ 30 วัน
          หรือจำนวนวันจริงของเดือนนั้น
        </p>
        <div className="mt-3">
          <SaveButton
            pending={pending}
            onClick={() =>
              run(() => createPeriodAction({ year, month, workDaysStd, payDate }), "สร้าง/อัปเดตงวดแล้ว", (d) => {
                const id = (d as { periodId: string }).periodId;
                setPeriodId(id);
                load(id);
                router.refresh();
              })
            }
          >
            สร้างงวด / เติมพนักงานที่ยังไม่มี
          </SaveButton>
        </div>
        <Msg msg={msg} />
      </Card>

      {period && (
        <>
          {locked && (
            <div className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">
              งวดนี้ลงบัญชีไปแล้วบางส่วน — แก้ตัวเลขไม่ได้จนกว่าจะถอนการลงบัญชีให้ครบ
              (ถ้าแก้ได้ ยอดที่ยื่นไปแล้วจะไม่ตรงกับที่บันทึก)
            </div>
          )}
          {drifted > 0 && (
            <div className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">
              ⚠ มี <b>{drifted}</b> คนที่ยอด<b>ยังไม่ตรงกับที่บันทึกไว้</b> —
              เกิดจากแก้เกณฑ์การคำนวณ หรือแก้ข้อมูลในทะเบียนพนักงาน (เงินเดือน / ชนิดค่าจ้าง) หลังบันทึกงวดนี้
              <br />
              {locked ? (
                <>
                  งวดนี้ลงบัญชีไปแล้ว → ตัวเลขที่แสดงคือ<b>ค่าที่บันทึกไว้</b> (ตรงกับที่ยื่น/ลงบัญชี) ·
                  ถ้าต้องแก้จริงต้องถอนการลงบัญชีก่อน
                </>
              ) : (
                <>
                  ตัวเลขที่แสดงคือ<b>ยอดที่คำนวณใหม่แล้ว</b> แต่<b>ยังไม่ได้บันทึก</b> —
                  แท็บรายงานและบัญชียังเป็นยอดเดิม (ดูบรรทัด &ldquo;บันทึกไว้ …&rdquo; ในคอลัมน์สุทธิ) ·
                  กด <b>คำนวณ &amp; บันทึก</b> เพื่อให้ตรงกัน
                </>
              )}
            </div>
          )}
          {!rates && (
            <div className="rounded-lg bg-crit-bg px-3 py-2 text-sm text-crit">
              ยังไม่มีชุดอัตราที่มีผลถึงงวดนี้ — ไปตั้งที่แท็บ &ldquo;ตั้งค่าการคำนวณ&rdquo; ก่อน
            </div>
          )}

          <Card title={`ตารางงวด ${period.periodId}`}>
            {loading ? (
              <p className="text-sm text-faint">กำลังโหลด…</p>
            ) : items.length === 0 ? (
              <Empty>— ยังไม่มีพนักงานในงวดนี้ (กด &ldquo;สร้างงวด / เติมพนักงาน&rdquo;) —</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr className="text-left text-faint">
                      <th>ชื่อ</th>
                      <th className="num">วันทำงาน</th>
                      {config.inputs.map((i) => <th key={i.code} className="num">{i.label}</th>)}
                      {manualComps.map((c) => <th key={c.code} className="num">{c.name}</th>)}
                      <th className="num">ภาษี (override)</th>
                      <th className="num">รวมได้</th>
                      <th className="num">ปกส.</th>
                      <th className="num">ภาษี</th>
                      <th className="num">สุทธิ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => {
                      const d = draft[it.empId];
                      const l = shown[it.empId];
                      if (!d) return null;
                      return (
                        <tr key={it.empId}>
                          <td className="whitespace-nowrap">{nameOf(it, employees)}</td>
                          <td className="num">
                            <NumBox value={d.workDays} readOnly={locked}
                              onChange={(v) => setRow(it.empId, { workDays: v === "" ? 0 : v })} />
                          </td>
                          {config.inputs.map((i) => (
                            <td key={i.code} className="num">
                              <NumBox value={d.values[i.code] ?? 0} blankZero readOnly={locked}
                                onChange={(v) => setVal(it.empId, i.code, v === "" ? 0 : v, "values")} />
                            </td>
                          ))}
                          {manualComps.map((c) => (
                            <td key={c.code} className="num">
                              <NumBox value={d.manual[c.code] ?? 0} blankZero readOnly={locked}
                                onChange={(v) => setVal(it.empId, c.code, v === "" ? 0 : v, "manual")} />
                            </td>
                          ))}
                          <td className="num">
                            <NumBox value={d.whtOverride ?? ""} blankZero readOnly={locked}
                              onChange={(v) => setRow(it.empId, { whtOverride: v === "" ? null : v })} />
                          </td>
                          <td className="num">{fmt(l?.gross ?? it.gross)}</td>
                          <td className="num">{fmt(l?.sso ?? it.sso)}</td>
                          <td className="num">{fmt(l?.wht ?? it.wht)}</td>
                          <td className="num font-semibold">
                            {fmt(l?.net ?? it.net)}
                            {/* ★ ต่างจากที่บันทึกไว้ = โชว์ทั้งสองอัน ไม่ให้ต้องเดาว่าเลขไหนคือเลขไหน
                                (ที่บันทึกไว้ = ตัวที่รายงาน/บัญชีใช้อยู่ตอนนี้) */}
                            {storedDiff[it.empId] && (
                              <div className="font-normal text-xs text-warn">
                                บันทึกไว้ {fmt(storedDiff[it.empId].net)}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="font-semibold">
                      <td colSpan={2 + config.inputs.length + manualComps.length + 1}>รวมทั้งงวด</td>
                      <td className="num">{fmt(totals.gross)}</td>
                      <td className="num">{fmt(totals.sso)}</td>
                      <td className="num">{fmt(totals.wht)}</td>
                      <td className="num">{fmt(totals.net)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <SaveButton pending={pending} onClick={doSave} disabled={locked || !rates || items.length === 0}>
                คำนวณ &amp; บันทึก
              </SaveButton>
              <button onClick={doPrint} disabled={items.length === 0}
                className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:bg-raised disabled:opacity-50">
                พิมพ์สลิปทั้งงวด
              </button>
              <span className="text-xs text-faint">ตัวเลขบนตารางคือผลคำนวณสด — กดบันทึกเพื่อแช่ค่าไว้ก่อนลงบัญชี</span>
            </div>
          </Card>

          <Card title="ลงบัญชี">
            <p className="mb-3 text-xs text-faint">
              ขาลงบัญชีตั้งได้เองที่แท็บ &ldquo;ตั้งค่าการคำนวณ&rdquo; — ลงกี่ก้อนก็ได้
            </p>

            {/* 🚨 ตัวเลขคุม: ขาที่ตั้งไว้ต้องครอบเงินที่บริษัทจ่ายจริงพอดี
                เกิน = ลงรายจ่ายซ้ำ · ขาด = รายจ่ายตกหล่น · เตือนไม่บล็อก */}
            <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${coverage.ok ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"}`}>
              ยอดรวมของขาที่ตั้งไว้ <b>{fmt(coverage.legsTotal)}</b> ·
              ยอดที่ควรลงทั้งหมด (รวมเงินได้ + สมทบนายจ้าง) <b>{fmt(coverage.shouldBe)}</b>
              {coverage.ok
                ? " — ตรงกันพอดี"
                : coverage.diff > 0
                  ? ` — เกิน ${fmt(coverage.diff)} มีขาที่ยอดซ้อนกันอยู่ (จะลงรายจ่ายซ้ำ)`
                  : ` — ขาด ${fmt(Math.abs(coverage.diff))} ยังมีส่วนที่ไม่ได้ลงบัญชี`}
            </div>

            {config.legs.length === 0 ? (
              <Empty>— ยังไม่ได้ตั้งขาลงบัญชี (ไปที่แท็บตั้งค่าการคำนวณ) —</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr className="text-left text-faint">
                      <th>ขา</th><th className="num">ยอด</th><th>วันที่</th><th>สถานะ</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {config.legs.filter((l) => l.active !== false).map((l) => {
                      const amount = legTotal(l, legLines);
                      const date = postDate || suggestLegDate(l, period);
                      const on = posted(l.code);
                      return (
                        <tr key={l.code}>
                          <td className="whitespace-nowrap">{l.name}
                            <span className="ml-1 text-xs text-faint">{l.splitByEmployee ? "(แยกรายคน)" : ""}</span>
                          </td>
                          <td className="num">{fmt(amount)}</td>
                          <td className="text-xs">{on ? (period.postState[l.code]?.date ?? "") : date}</td>
                          <td>{on ? <span className="text-ok">ลงแล้ว</span> : <span className="text-faint">ยังไม่ลง</span>}</td>
                          <td className="whitespace-nowrap">
                            {on ? (
                              <button onClick={() => doUnpost(l.code, l.name)} disabled={pending} className="text-xs text-crit hover:underline">ถอน</button>
                            ) : (
                              <button onClick={() => doPost(l.code, l.name, date)} disabled={pending} className="text-xs text-brand hover:underline">ลงบัญชี</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-3 max-w-xs">
              <Field label="วันที่ลงบัญชี (เว้นไว้ = ใช้วันที่แนะนำของแต่ละขา)">
                <TextInput type="date" value={postDate} onChange={(e) => setPostDate(e.target.value)} />
              </Field>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * ชื่อที่เอาไปแสดง — **ชื่อปัจจุบันจากทะเบียนพนักงานเสมอ**
 *
 * 🪤 `payroll_items.emp_name` เป็น snapshot ตอนสร้างแถว → แก้ชื่อในทะเบียนแล้วงวดเดิม
 *    ยังเป็นชื่อเก่า (ผู้ใช้แจ้ง) · snapshot มีไว้กันชื่อหายตอนลบพนักงานออกจากทะเบียน
 *    จึงใช้เป็น **fallback** ไม่ใช่ตัวหลัก
 * ★ กติกาที่ใช้ทั้งโมดูล: **ชื่อ = ค่าปัจจุบัน · ตัวเงิน = ค่าที่แช่ไว้**
 *   (ชื่อสะกดผิดต้องแก้ให้ถูกทุกที่ · แต่ยอดเงินที่ยื่นไปแล้วห้ามขยับ)
 */
function nameOf(it: ItemRow, employees: EmployeeRow[]): string {
  return employees.find((x) => x.empId === it.empId)?.name || it.empName;
}

/** ประกอบ Employee ให้ engine — ใช้ master ปัจจุบัน + snapshot กลุ่มที่บันทึกไว้ตอนสร้างงวด */
function empOf(it: ItemRow, employees: EmployeeRow[]) {
  const e = employees.find((x) => x.empId === it.empId);
  if (!e) return null;
  return {
    empId: e.empId,
    name: e.name,
    groupCode: it.groupCode ?? e.groupCode,
    wageType: e.wageType,
    baseWage: e.baseWage,
    ssoExempt: e.ssoExempt,
    whtMode: e.whtMode,
    whtFixed: e.whtFixed,
    taxAllowances: e.taxAllowances,
  };
}

function lastDayISO(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/**
 * ผลคำนวณที่ **แช่ไว้แล้ว** ของแถวนี้ (จาก `payroll_items.computed`)
 * คืน null ถ้ายังไม่เคยกดบันทึก — ผู้เรียกจะได้ fallback ไปใช้ค่าที่คิดสด
 * ★ เช็ค `gross` เพราะงวดที่สร้างแล้วยังไม่บันทึกจะมี `computed` เป็น {} ว่าง
 */
function storedLine(it: ItemRow): PayrollLine | null {
  const c = it.computed as unknown as PayrollLine | undefined;
  if (!c || typeof c.gross !== "number") return null;
  return c;
}

