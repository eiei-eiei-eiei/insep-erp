"use client";

import { useEffect, useState } from "react";
import { getBalancesAction, getStatementAction, saveTransferAction } from "../actions";
import type { Bootstrap } from "./types";
import { Card, Field, Msg, NumBox, SaveButton, Select, TextInput, fmt, todayISO, useSaver } from "./ui";

type Balances = Awaited<ReturnType<typeof getBalancesAction>>;
type Statement = Awaited<ReturnType<typeof getStatementAction>>;

export function AccountsTab({ boot, period, entityId, active }: { boot: Bootstrap; period: string; entityId: string; active: boolean }) {
  const [bal, setBal] = useState<Balances | null>(null);
  const [stmt, setStmt] = useState<Statement | null>(null);
  const [openAcc, setOpenAcc] = useState<string | null>(null);
  const { pending, msg, run, setMsg } = useSaver();

  // โอนระหว่างบัญชี
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState(0);
  const [tdate, setTdate] = useState(todayISO());
  const [note, setNote] = useState("");

  // บัญชีที่เลือกได้ในหน้าโอน = เฉพาะที่ผูกกับกิจการนี้ (ว่าง = ใช้ร่วมทุกกิจการ)
  const accountOptions = boot.accounts.filter((a) => entityId === "ALL" || (a.entity_ids ?? []).length === 0 || (a.entity_ids ?? []).includes(entityId));

  function reload() {
    getBalancesAction(period, entityId).then(setBal);
  }
  useEffect(() => {
    if (!active) return;
    let alive = true;
    getBalancesAction(period, entityId).then((d) => { if (alive) setBal(d); });
    setStmt(null);
    setOpenAcc(null);
    return () => { alive = false; };
  }, [period, entityId, active]);

  function openStatement(acc: string) {
    setOpenAcc(acc);
    setStmt(null);
    getStatementAction(acc, period).then(setStmt);
  }

  function doTransfer() {
    if (!from || !to || amount <= 0) { setMsg({ ok: false, text: "กรอกบัญชีต้นทาง/ปลายทาง + จำนวนเงิน" }); return; }
    run(() => saveTransferAction({ from, to, amount, date: tdate, note, entityId }), "โอนเรียบร้อย", () => { setAmount(0); setNote(""); reload(); });
  }

  return (
    <div className="space-y-4">
      <Card title={`ยอดคงเหลือทุกบัญชี ณ สิ้นเดือน ${period}`}>
        {!bal ? <p className="text-faint">กำลังโหลด…</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-faint"><th className="p-1">บัญชี</th><th className="p-1 text-right">ยอดยกมา</th><th className="p-1 text-right">เข้า</th><th className="p-1 text-right">ออก</th><th className="p-1 text-right">คงเหลือ</th><th className="p-1"></th></tr></thead>
              <tbody>
                {bal.balances.map((b) => (
                  <tr key={b.accountType} className="border-t border-line-soft">
                    <td className="p-1">{b.accountType}{b.isTaxAccount ? " 🧾" : ""}{b.shared ? " 🔗" : ""}</td>
                    <td className="p-1 text-right">{fmt(b.openingBalance)}</td>
                    <td className="p-1 text-right text-ok">{fmt(b.totalIn)}</td>
                    <td className="p-1 text-right text-crit">{fmt(b.totalOut)}</td>
                    <td className="p-1 text-right font-semibold">{fmt(b.balance)}</td>
                    <td className="p-1"><button onClick={() => openStatement(b.accountType)} className="text-muted hover:underline">statement</button></td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line font-semibold"><td className="p-1">รวมทุกบัญชี</td><td colSpan={3}></td><td className="p-1 text-right">{fmt(bal.grandTotal)}</td><td></td></tr>
              </tbody>
            </table>
            <p className="mt-1 text-xs text-faint">🧾 บัญชีในระบบภาษี · 🔗 บัญชีใช้ร่วมหลายกิจการ</p>
          </div>
        )}
      </Card>

      {openAcc && (
        <Card title={`Statement: ${openAcc} — เดือน ${period}`}>
          {!stmt ? <p className="text-faint">กำลังโหลด…</p> : (
            <div className="overflow-x-auto">
              <p className="mb-2 text-sm text-muted">ยอดยกมา: <b>{fmt(stmt.openingBalance)}</b> · ยอดยกไป: <b>{fmt(stmt.closingBalance)}</b></p>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-faint"><th className="p-1">วันที่</th><th className="p-1">ประเภท</th><th className="p-1">รายละเอียด</th><th className="p-1 text-right">เดบิต</th><th className="p-1 text-right">เครดิต</th><th className="p-1 text-right">คงเหลือ</th></tr></thead>
                <tbody>
                  {stmt.rows.length === 0 ? <tr><td colSpan={6} className="p-3 text-center text-faint">ไม่มีรายการในเดือนนี้</td></tr> :
                    stmt.rows.map((r) => (
                      <tr key={r.txId} className="border-t border-line-soft">
                        <td className="p-1">{r.date}</td><td className="p-1">{r.type}</td><td className="p-1">{r.description || r.contactName}</td>
                        <td className="p-1 text-right text-crit">{r.debit ? fmt(r.debit) : ""}</td>
                        <td className="p-1 text-right text-ok">{r.credit ? fmt(r.credit) : ""}</td>
                        <td className="p-1 text-right">{fmt(r.runningBalance)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
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
        <div className="mt-3"><Msg msg={msg} /><SaveButton pending={pending} onClick={doTransfer}>โอนเงิน</SaveButton></div>
      </Card>
    </div>
  );
}
