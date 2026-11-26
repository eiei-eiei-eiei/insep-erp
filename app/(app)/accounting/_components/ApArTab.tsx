"use client";

import { useConfirm } from "@/lib/shared/ui";
import { Fragment, useState } from "react";
import { getApArAction, settleApArAction, voidTransactionAction } from "../actions";
import type { Bootstrap } from "./types";
import { AdvanceCard } from "./AdvanceCard";
import { accountsFor } from "@/lib/accounting/bankAccounts";
import { Card, Field, Select, TextInput, fmt, todayISO, useSaver, useRead, LoadError } from "./ui";
import { useDateFmt } from "@/lib/shared/dateFormatContext";
import { ActionRow, Button, SkeletonCard } from "@/lib/shared/page";

type ApAr = Awaited<ReturnType<typeof getApArAction>>;

export function ApArTab({ boot, entityId, active }: { boot: Bootstrap; entityId: string; active: boolean }) {

  const { pending, run, setMsg } = useSaver();
  const { confirmNode, ask } = useConfirm();
  const d = useDateFmt();
  const [settleId, setSettleId] = useState<string | null>(null);
  const [acc, setAcc] = useState("");
  const [payDate, setPayDate] = useState(todayISO());
  const accountOptions = accountsFor(boot.accounts, entityId);

  // 🚨 D89 — รับ throw จากชั้นอ่าน ไม่งั้นหน้าลูกหนี้-เจ้าหนี้ค้างที่ "กำลังโหลด…"
  const { data, loading, err, reload } = useRead<ApAr>(
    () => getApArAction(entityId),
    [entityId],
    { skip: !active },
  );

  /**
   * เปิด/ปิดแถวชำระ — 🪤 เปิดแถวใหม่ต้องล้างบัญชี/วันที่ทุกครั้ง
   * เดิม state ใช้ร่วมทุกแถว: ชำระใบแรกเข้า "กสิกร" วันที่ 20/10 แล้วเปิดใบถัดไป
   * ช่องยังเติมค่าเดิมไว้ให้ → กดยืนยันเร็ว ๆ = ชำระผิดบัญชี/ผิดวันโดยไม่รู้ตัว (เจอตอนเทส D123)
   */
  function toggleSettle(txId: string) {
    setMsg(null);
    if (settleId === txId) { setSettleId(null); return; }
    setAcc("");
    setPayDate(todayISO());
    setSettleId(txId);
  }

  function doSettle(txId: string) {
    if (!acc) { setMsg({ ok: false, text: "เลือกบัญชีที่ใช้ชำระ" }); return; }
    run(() => settleApArAction({ txId, accountName: acc, paymentDate: payDate }), "บันทึกการชำระเรียบร้อย", () => { setSettleId(null); reload(); });
  }
  async function doVoid(txId: string) {
    if (!(await ask({ title: "ยกเลิกบิลนี้?", detail: "(จะกลายเป็นสถานะ 'ยกเลิก')", confirmText: "ยกเลิกบิล", cancelText: "กลับ", danger: true }))) return;
    run(() => voidTransactionAction(txId), "ยกเลิกเรียบร้อย", reload);
  }

  if (err && !data) return <LoadError err onRetry={reload} what="ยอดลูกหนี้-เจ้าหนี้" />;
  // D184 — โครงร่าง 3 การ์ด (เจ้าหนี้ · ลูกหนี้ · ยอดค้างจากออเดอร์) แทนตัวหนังสือ
  if (loading || !data) return (
    <div className="space-y-4">
      <SkeletonCard rows={3} cols={6} what="ยอดลูกหนี้-เจ้าหนี้" />
      <SkeletonCard rows={2} cols={6} />
      <SkeletonCard rows={2} cols={4} />
    </div>
  );

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
                    <td className="whitespace-nowrap">{d.date(r.date)}</td>
                    <td>{r.contactName}</td>
                    <td>{r.description}{r.installment ? ` [งวด ${r.installment}]` : ""}</td>
                    <td className="whitespace-nowrap">{d.date(r.dueDate)}</td>
                    <td className={`p-1 text-right font-medium ${tone}`}>{fmt(r.amount)}</td>
                    <td>
                      {/* D184 — ชำระ = ปุ่มรอง · ยกเลิก = ปุ่มอันตรายแยกด้วยเส้นคั่น (กันนิ้วพลาด) */}
                      <ActionRow compact danger={<Button size="sm" tone="danger" onClick={() => doVoid(r.transactionId)}>ยกเลิก</Button>}>
                        <Button size="sm" aria-expanded={settleId === r.transactionId} onClick={() => toggleSettle(r.transactionId)}>ชำระ</Button>
                      </ActionRow>
                    </td>
                  </tr>
                  {settleId === r.transactionId && (
                    <tr className="bg-raised">
                      <td colSpan={6}>
                        <div className="flex flex-wrap items-end gap-2">
                          <Field label="บัญชีที่ใช้ชำระ"><Select value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">— เลือก —</option>{accountOptions.map((a) => <option key={a.account_name} value={a.account_name}>{a.account_name}</option>)}</Select></Field>
                          <Field label="วันที่ชำระ"><TextInput type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></Field>
                          <Button tone="primary" pending={pending} onClick={() => doSettle(r.transactionId)}>ยืนยันชำระ</Button>
                        </div>
                        <p className="mt-1 text-xs text-faint">
                          ยอดเงินในบัญชีจะขยับในวันที่ชำระ · บิลยังอยู่ในรายงานภาษีเดือนเดิม ({d.month(r.date)}) ไม่ย้ายตามวันที่ชำระ
                        </p>
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
      {confirmNode}
      {/* D119 — สำรองจ่ายรอเบิกคืน (เงินที่จ่ายแทนไปแล้ว ไม่ใช่หนี้ค้าง — จึงแยกการ์ดจาก AP/AR) */}
      <AdvanceCard boot={boot} entityId={entityId} active={active} />
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
