"use client";

import { Fragment, useEffect, useState } from "react";
import { getBalancesAction, getStatementAction, saveTransferAction } from "../actions";
import type { Bootstrap } from "./types";
import { accountsFor } from "@/lib/accounting/bankAccounts";
import type { StatementRange } from "@/lib/accounting/ledger";
import { STATEMENT_PRESETS, presetRange, rangeTitle, rangeError, isMultiMonth, type StatementPreset } from "@/lib/accounting/statementView";
import { Badge, Card, Field, NumBox, SaveButton, Select, TextInput, fmt, todayISO, useSaver, useRead, LoadError } from "./ui";

type Balances = Awaited<ReturnType<typeof getBalancesAction>>;
type Statement = Awaited<ReturnType<typeof getStatementAction>>;

export function AccountsTab({ boot, period, entityId, active }: { boot: Bootstrap; period: string; entityId: string; active: boolean }) {
  const [openAcc, setOpenAcc] = useState<string | null>(null);
  // D139 — ช่วงเวลาของ statement (ปุ่มลัดนับถอยจากเดือนที่เลือกด้านบน · กำหนดเอง = จาก/ถึง)
  const [preset, setPreset] = useState<StatementPreset>("month");
  const [custom, setCustom] = useState<StatementRange>({ from: period, to: period });
  const range: StatementRange = preset === "custom" ? custom : presetRange(preset, period);
  const rangeErr = rangeError(range);
  const { pending, run, setMsg } = useSaver();

  // โอนระหว่างบัญชี
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState(0);
  const [tdate, setTdate] = useState(todayISO());
  const [note, setNote] = useState("");

  // บัญชีที่เลือกได้ในหน้าโอน = เฉพาะที่ผูกกับกิจการนี้ (ว่าง = ใช้ร่วมทุกกิจการ)
  const accountOptions = accountsFor(boot.accounts, entityId);

  // 🚨 D89 — ยอดคงเหลือทุกบัญชีมาจากที่นี่ · อ่านไม่ได้ต้องฟ้อง ไม่ใช่โชว์ยอดที่ขาดยอดยกมา
  const { data: bal, err, reload } = useRead<Balances>(
    () => getBalancesAction(period, entityId),
    [period, entityId],
    { skip: !active },
  );
  useEffect(() => {
    if (!active) return;
    setOpenAcc(null);
  }, [period, entityId, active]);

  const { data: stmtData, err: stmtErr, reload: stmtReload } = useRead<Statement>(
    () => getStatementAction(openAcc ?? "", range),
    [openAcc, range.from, range.to],
    { skip: !active || !openAcc || !!rangeErr },
  );
  // 🪤 useRead เก็บก้อนเดิมไว้ระหว่างโหลด ⇒ ต้องเช็คว่าเป็นของบัญชี+ช่วงที่กำลังดู ไม่งั้นโชว์ statement บัญชีอื่น (D81)
  const stmt = stmtData && stmtData.accountType === openAcc && stmtData.range.from === range.from && stmtData.range.to === range.to ? stmtData : null;
  const monthOf = new Map((stmt?.months ?? []).map((m) => [m.month, m]));
  const multi = isMultiMonth(range);

  function openStatement(acc: string) {
    setOpenAcc(acc);
    setPreset("month");
  }
  function pickCustom() {
    setCustom(range.from || range.to ? range : { from: period, to: period });
    setPreset("custom");
  }

  function doTransfer() {
    if (!from || !to || amount <= 0) { setMsg({ ok: false, text: "กรอกบัญชีต้นทาง/ปลายทาง + จำนวนเงิน" }); return; }
    run(() => saveTransferAction({ from, to, amount, date: tdate, note, entityId }), "โอนเรียบร้อย", () => { setAmount(0); setNote(""); reload(); });
  }

  return (
    <div className="space-y-4">
      <Card title={`ยอดคงเหลือทุกบัญชี ณ สิ้นเดือน ${period}`}>
        <LoadError err={err} onRetry={reload} what="ยอดคงเหลือ" />
        {!bal ? <p className="text-faint">{err ? "— โหลดไม่สำเร็จ —" : "กำลังโหลด…"}</p> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr className="text-left text-faint"><th>บัญชี</th><th className="num">ยอดยกมา</th><th className="num">เข้า</th><th className="num">ออก</th><th className="num">คงเหลือ</th><th></th></tr></thead>
              <tbody>
                {bal.balances.map((b) => (
                  <tr key={b.accountType}>
                    <td>{b.accountType}{b.shared ? <Badge tone="neutral" className="ml-1">ใช้ร่วม</Badge> : null}</td>
                    <td className="num">{fmt(b.openingBalance)}</td>
                    <td className="text-ok num">{fmt(b.totalIn)}</td>
                    <td className="text-crit num">{fmt(b.totalOut)}</td>
                    <td className="font-semibold num">{fmt(b.balance)}</td>
                    <td><button onClick={() => openStatement(b.accountType)} className="text-muted hover:underline">statement</button></td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line font-semibold"><td>รวมทุกบัญชี</td><td colSpan={3}></td><td className="num">{fmt(bal.grandTotal)}</td><td></td></tr>
              </tbody>
            </table>
            <p className="mt-1 text-xs text-faint">ป้าย “ใช้ร่วม” = ใช้ได้หลายกิจการ</p>
          </div>
        )}
      </Card>

      {openAcc && (
        <Card title={`Statement: ${openAcc} — ${rangeTitle(range)}`}>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            {STATEMENT_PRESETS.map((p) => (
              <button key={p.key} type="button" onClick={() => setPreset(p.key)} aria-pressed={preset === p.key}
                className={`rounded-full border px-3 py-1 ${preset === p.key ? "border-brand-line bg-brand-soft text-brand" : "border-line text-muted hover:bg-raised"}`}>{p.label}</button>
            ))}
            <button type="button" onClick={pickCustom} aria-pressed={preset === "custom"}
              className={`rounded-full border px-3 py-1 ${preset === "custom" ? "border-brand-line bg-brand-soft text-brand" : "border-line text-muted hover:bg-raised"}`}>กำหนดเอง</button>
            {preset === "custom" && (
              <span className="flex flex-wrap items-center gap-1">
                จาก <input type="month" value={custom.from ?? ""} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value || null }))} className="rounded-lg border border-line px-2 py-1" />
                ถึง <input type="month" value={custom.to ?? ""} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value || null }))} className="rounded-lg border border-line px-2 py-1" />
              </span>
            )}
          </div>
          {preset !== "custom" && preset !== "all" && <p className="mb-2 text-xs text-faint">นับถอยจากเดือน {period} ที่เลือกไว้ด้านบน</p>}
          {preset === "custom" && <p className="mb-2 text-xs text-faint">เว้นช่องไหนว่าง = ไม่จำกัดด้านนั้น</p>}
          {rangeErr ? <p className="text-sm text-warn">{rangeErr}</p> : (
            <>
              <LoadError err={stmtErr} onRetry={stmtReload} what="statement" />
              {!stmt ? <p className="text-faint">{stmtErr ? "— โหลดไม่สำเร็จ —" : "กำลังโหลด…"}</p> : (
                <div className="overflow-x-auto">
                  <p className="mb-2 text-sm text-muted">
                    ยอดยกมา: <b>{fmt(stmt.openingBalance)}</b> · ยอดยกไป: <b>{fmt(stmt.closingBalance)}</b> · {stmt.rows.length} รายการ
                    {!range.from && <span className="text-xs text-faint"> (ยอดยกมา = ยอดตั้งต้นของบัญชี)</span>}
                  </p>
                  <table className="tbl">
                    <thead><tr className="text-left text-faint"><th>วันที่</th><th>ประเภท</th><th>รายละเอียด</th><th className="num">เดบิต</th><th className="num">เครดิต</th><th className="num">คงเหลือ</th></tr></thead>
                    <tbody>
                      {stmt.rows.length === 0 ? <tr><td colSpan={6} className="p-3 text-center text-faint">ไม่มีรายการในช่วงนี้</td></tr> :
                        stmt.rows.map((r, i) => {
                          const mo = r.date.slice(0, 7);
                          const endOfMonth = multi && stmt.rows[i + 1]?.date.slice(0, 7) !== mo;
                          const m = endOfMonth ? monthOf.get(mo) : undefined;
                          return (
                            <Fragment key={r.txId}>
                              <tr>
                                <td>{r.date}</td><td>{r.type}</td><td>{r.description || r.contactName}</td>
                                <td className="text-crit num">{r.debit ? fmt(r.debit) : ""}</td>
                                <td className="text-ok num">{r.credit ? fmt(r.credit) : ""}</td>
                                <td className="num">{fmt(r.runningBalance)}</td>
                              </tr>
                              {m && (
                                <tr className="border-b-2 border-line bg-raised font-semibold">
                                  <td colSpan={3}>สรุปเดือน {m.month} · {m.count} รายการ</td>
                                  <td className="text-crit num">{fmt(m.totalOut)}</td>
                                  <td className="text-ok num">{fmt(m.totalIn)}</td>
                                  <td className="num">{fmt(m.closingBalance)}</td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Card>
      )}

      <Card title="โอนเงินระหว่างบัญชี">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="จากบัญชี"><Select value={from} onChange={(e) => setFrom(e.target.value)}><option value="">— เลือก —</option>{accountOptions.map((a) => <option key={a.account_name} value={a.account_name}>{a.account_name}</option>)}</Select></Field>
          <Field label="ไปบัญชี"><Select value={to} onChange={(e) => setTo(e.target.value)}><option value="">— เลือก —</option>{accountOptions.map((a) => <option key={a.account_name} value={a.account_name}>{a.account_name}</option>)}</Select></Field>
          <Field label="จำนวนเงิน"><NumBox value={amount} blankZero onChange={(v) => setAmount(v === "" ? 0 : v)} /></Field>
          <Field label="วันที่"><TextInput type="date" value={tdate} onChange={(e) => setTdate(e.target.value)} /></Field>
          <div className="col-span-2 md:col-span-4"><Field label="หมายเหตุ"><TextInput value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
        </div>
        <div className="mt-3"><SaveButton pending={pending} onClick={doTransfer}>โอนเงิน</SaveButton></div>
      </Card>
    </div>
  );
}
