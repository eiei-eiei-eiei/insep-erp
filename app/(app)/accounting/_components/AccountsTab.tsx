"use client";

import { useEffect, useState } from "react";
import { getBalancesAction, getStatementAction, saveTransferAction } from "../actions";
import type { Bootstrap } from "./types";
import { Badge, Card, Field, Msg, NumBox, SaveButton, Select, TextInput, fmt, todayISO, useSaver, useRead, LoadError } from "./ui";

type Balances = Awaited<ReturnType<typeof getBalancesAction>>;
type Statement = Awaited<ReturnType<typeof getStatementAction>>;

export function AccountsTab({ boot, period, entityId, active }: { boot: Bootstrap; period: string; entityId: string; active: boolean }) {
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

  // 🚨 D89 — ยอดคงเหลือทุกบัญชีมาจากที่นี่ · อ่านไม่ได้ต้องฟ้อง ไม่ใช่โชว์ยอดที่ขาดยอดยกมา
  const { data: bal, err, reload } = useRead<Balances>(
    () => getBalancesAction(period, entityId),
    [period, entityId],
    { skip: !active },
  );
  useEffect(() => {
    if (!active) return;
    setStmt(null);
    setOpenAcc(null);
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
        <LoadError err={err} onRetry={reload} what="ยอดคงเหลือ" />
        {!bal ? <p className="text-faint">{err ? "— โหลดไม่สำเร็จ —" : "กำลังโหลด…"}</p> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr className="text-left text-faint"><th>บัญชี</th><th className="num">ยอดยกมา</th><th className="num">เข้า</th><th className="num">ออก</th><th className="num">คงเหลือ</th><th></th></tr></thead>
              <tbody>
                {bal.balances.map((b) => (
                  <tr key={b.accountType}>
                    <td>{b.accountType}{b.isTaxAccount ? <Badge tone="neutral" className="ml-1">ภาษี</Badge> : null}{b.shared ? <Badge tone="neutral" className="ml-1">ใช้ร่วม</Badge> : null}</td>
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
            <p className="mt-1 text-xs text-faint">ป้าย “ภาษี” = บัญชีในระบบภาษี · “ใช้ร่วม” = ใช้ได้หลายกิจการ</p>
          </div>
        )}
      </Card>

      {openAcc && (
        <Card title={`Statement: ${openAcc} — เดือน ${period}`}>
          {!stmt ? <p className="text-faint">กำลังโหลด…</p> : (
            <div className="overflow-x-auto">
              <p className="mb-2 text-sm text-muted">ยอดยกมา: <b>{fmt(stmt.openingBalance)}</b> · ยอดยกไป: <b>{fmt(stmt.closingBalance)}</b></p>
              <table className="tbl">
                <thead><tr className="text-left text-faint"><th>วันที่</th><th>ประเภท</th><th>รายละเอียด</th><th className="num">เดบิต</th><th className="num">เครดิต</th><th className="num">คงเหลือ</th></tr></thead>
                <tbody>
                  {stmt.rows.length === 0 ? <tr><td colSpan={6} className="p-3 text-center text-faint">ไม่มีรายการในเดือนนี้</td></tr> :
                    stmt.rows.map((r) => (
                      <tr key={r.txId}>
                        <td>{r.date}</td><td>{r.type}</td><td>{r.description || r.contactName}</td>
                        <td className="text-crit num">{r.debit ? fmt(r.debit) : ""}</td>
                        <td className="text-ok num">{r.credit ? fmt(r.credit) : ""}</td>
                        <td className="num">{fmt(r.runningBalance)}</td>
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
