"use client";

import { Fragment, useEffect, useState } from "react";
import { getApArAction, settleApArAction, voidTransactionAction } from "../actions";
import type { Bootstrap } from "./types";
import { Card, Field, Msg, Select, TextInput, fmt, todayISO, useSaver } from "./ui";

type ApAr = Awaited<ReturnType<typeof getApArAction>>;

export function ApArTab({ boot, entityId }: { boot: Bootstrap; entityId: string }) {
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
    let alive = true;
    setLoading(true);
    getApArAction(entityId).then((d) => { if (alive) { setData(d); setLoading(false); } });
    return () => { alive = false; };
  }, [entityId]);

  function doSettle(txId: string) {
    if (!acc) { setMsg({ ok: false, text: "เลือกบัญชีที่ใช้ชำระ" }); return; }
    run(() => settleApArAction({ txId, accountName: acc, paymentDate: payDate }), "บันทึกการชำระเรียบร้อย", () => { setSettleId(null); reload(); });
  }
  function doVoid(txId: string) {
    if (!confirm("ยกเลิกบิลนี้? (จะกลายเป็นสถานะ 'ยกเลิก')")) return;
    run(() => voidTransactionAction(txId), "ยกเลิกเรียบร้อย", reload);
  }

  if (loading || !data) return <p className="text-slate-400">กำลังโหลด…</p>;

  const table = (title: string, rows: ApAr["payable"], total: number, tone: string) => (
    <Card title={`${title} — รวม ${fmt(total)} บาท`}>
      {rows.length === 0 ? <p className="text-sm text-slate-400">ไม่มีรายการค้าง</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500"><th className="p-1">วันที่</th><th className="p-1">คู่ค้า</th><th className="p-1">รายละเอียด</th><th className="p-1">ครบกำหนด</th><th className="p-1 text-right">ยอด</th><th className="p-1"></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.transactionId}>
                  <tr className="border-t border-slate-100">
                    <td className="p-1">{r.date}</td>
                    <td className="p-1">{r.contactName}</td>
                    <td className="p-1">{r.description}{r.installment ? ` [งวด ${r.installment}]` : ""}</td>
                    <td className="p-1">{r.dueDate}</td>
                    <td className={`p-1 text-right font-medium ${tone}`}>{fmt(r.amount)}</td>
                    <td className="p-1 whitespace-nowrap">
                      <button onClick={() => { setSettleId(settleId === r.transactionId ? null : r.transactionId); setMsg(null); }} className="text-sm text-slate-700 hover:underline">ชำระ</button>
                      <button onClick={() => doVoid(r.transactionId)} className="ml-2 text-sm text-red-500 hover:underline">ยกเลิก</button>
                    </td>
                  </tr>
                  {settleId === r.transactionId && (
                    <tr className="bg-slate-50">
                      <td colSpan={6} className="p-2">
                        <div className="flex flex-wrap items-end gap-2">
                          <Field label="บัญชีที่ใช้ชำระ"><Select value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">— เลือก —</option>{accountOptions.map((a) => <option key={a.account_name} value={a.account_name}>{a.account_name}</option>)}</Select></Field>
                          <Field label="วันที่ชำระ"><TextInput type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></Field>
                          <button onClick={() => doSettle(r.transactionId)} disabled={pending} className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50">ยืนยันชำระ</button>
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
      {table("เจ้าหนี้ (AP) — เราต้องจ่าย", data.payable, data.totalAP, "text-red-600")}
      {table("ลูกหนี้ (AR) — เขาต้องจ่ายเรา", data.receivable, data.totalAR, "text-green-600")}
      <Card title={`ยอดค้างจากออเดอร์ขาย (${data.salesOutstanding.length}) — อ่านอย่างเดียว`}>
        {data.salesOutstanding.length === 0 ? <p className="text-sm text-slate-400">ไม่มียอดค้างจากออเดอร์ขาย</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-500"><th className="p-1">ออเดอร์</th><th className="p-1">ลูกค้า</th><th className="p-1">สถานะ</th><th className="p-1 text-right">ยอดค้าง</th></tr></thead>
              <tbody>
                {data.salesOutstanding.map((r) => (
                  <tr key={r.quNo} className="border-t border-slate-100"><td className="p-1">{r.orderNo || r.quNo}</td><td className="p-1">{r.customerName}</td><td className="p-1">{r.status}</td><td className="p-1 text-right">{fmt(r.outstanding)}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-400">ไปกดเก็บเงินได้ที่ workspace ขาย (แก้ T2 — เห็นลูกหนี้ครบในที่เดียว)</p>
          </div>
        )}
      </Card>
    </div>
  );
}
