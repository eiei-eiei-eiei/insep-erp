"use client";

import { Fragment, useEffect, useState } from "react";
import { getApArAction, settleApArAction, voidTransactionAction } from "../actions";
import type { Bootstrap } from "./types";
import { Card, Field, Msg, Select, TextInput, fmt, todayISO, useSaver } from "./ui";

type ApAr = Awaited<ReturnType<typeof getApArAction>>;

export function ApArTab({ boot, entityId, active }: { boot: Bootstrap; entityId: string; active: boolean }) {
  const [data, setData] = useState<ApAr | null>(null);
  const [loading, setLoading] = useState(true);
  const { pending, msg, run, setMsg } = useSaver();
  const [settleId, setSettleId] = useState<string | null>(null);
  const [acc, setAcc] = useState("");
  const [payDate, setPayDate] = useState(todayISO());
  const accountOptions = boot.accounts.filter((a) => entityId === "ALL" || (a.entity_ids ?? []).length === 0 || (a.entity_ids ?? []).includes(entityId));

  function reload() {
    setLoading(true);
    getApArAction(entityId).then((d) => { setData(d); setLoading(false); });
  }
  useEffect(() => {
    if (!active) return;
    let alive = true;
    getApArAction(entityId).then((d) => { if (alive) { setData(d); setLoading(false); } });
    return () => { alive = false; };
  }, [entityId, active]);

  function doSettle(txId: string) {
    if (!acc) { setMsg({ ok: false, text: "เลือกบัญชีที่ใช้ชำระ" }); return; }
    run(() => settleApArAction({ txId, accountName: acc, paymentDate: payDate }), "บันทึกการชำระเรียบร้อย", () => { setSettleId(null); reload(); });
  }
  function doVoid(txId: string) {
    if (!confirm("ยกเลิกบิลนี้? (จะกลายเป็นสถานะ 'ยกเลิก')")) return;
    run(() => voidTransactionAction(txId), "ยกเลิกเรียบร้อย", reload);
  }

  if (loading || !data) return <p className="text-faint">กำลังโหลด…</p>;

  const table = (title: string, rows: ApAr["payable"], total: number, tone: string) => (
    <Card title={`${title} — รวม ${fmt(total)} บาท`}>
      {rows.length === 0 ? <p className="text-sm text-faint">ไม่มีรายการค้าง</p> : (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr className="text-left text-faint"><th>วันที่</th><th>คู่ค้า</th><th>รายละเอียด</th><th>ครบกำหนด</th><th className="num">ยอด</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.transactionId}>
                  <tr>
                    <td>{r.date}</td>
                    <td>{r.contactName}</td>
                    <td>{r.description}{r.installment ? ` [งวด ${r.installment}]` : ""}</td>
                    <td>{r.dueDate}</td>
                    <td className={`p-1 text-right font-medium ${tone}`}>{fmt(r.amount)}</td>
                    <td className="whitespace-nowrap">
                      <button onClick={() => { setSettleId(settleId === r.transactionId ? null : r.transactionId); setMsg(null); }} className="text-sm text-muted hover:underline">ชำระ</button>
                      <button onClick={() => doVoid(r.transactionId)} className="ml-2 text-sm text-crit hover:underline">ยกเลิก</button>
                    </td>
                  </tr>
                  {settleId === r.transactionId && (
                    <tr className="bg-raised">
                      <td colSpan={6}>
                        <div className="flex flex-wrap items-end gap-2">
                          <Field label="บัญชีที่ใช้ชำระ"><Select value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">— เลือก —</option>{accountOptions.map((a) => <option key={a.account_name} value={a.account_name}>{a.account_name}</option>)}</Select></Field>
                          <Field label="วันที่ชำระ"><TextInput type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></Field>
                          <button onClick={() => doSettle(r.transactionId)} disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm text-on-brand disabled:opacity-50">ยืนยันชำระ</button>
                        </div>
                        <Msg msg={msg} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );

  return (
    <div className="space-y-4">
      {table("เจ้าหนี้ (AP) — เราต้องจ่าย", data.payable, data.totalAP, "text-crit")}
      {table("ลูกหนี้ (AR) — เขาต้องจ่ายเรา", data.receivable, data.totalAR, "text-ok")}
      <Card title={`ยอดค้างจากออเดอร์ขาย (${data.salesOutstanding.length}) — อ่านอย่างเดียว`}>
        {data.salesOutstanding.length === 0 ? <p className="text-sm text-faint">ไม่มียอดค้างจากออเดอร์ขาย</p> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr className="text-left text-faint"><th>ออเดอร์</th><th>ลูกค้า</th><th>สถานะ</th><th className="num">ยอดค้าง</th></tr></thead>
              <tbody>
                {data.salesOutstanding.map((r) => (
                  <tr key={r.quNo}><td>{r.orderNo || r.quNo}</td><td>{r.customerName}</td><td>{r.status}</td><td className="num">{fmt(r.outstanding)}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-faint">ไปกดเก็บเงินได้ที่ workspace ขาย (แก้ T2 — เห็นลูกหนี้ครบในที่เดียว)</p>
          </div>
        )}
      </Card>
    </div>
  );
}
