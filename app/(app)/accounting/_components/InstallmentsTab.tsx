"use client";

import { useState } from "react";
import { getInstallmentGroupAction, voidTransactionAction } from "../actions";
import { Card, Field, Msg, TextInput, fmt, useSaver } from "./ui";

type Group = Awaited<ReturnType<typeof getInstallmentGroupAction>>;

export function InstallmentsTab() {
  const [poId, setPoId] = useState("");
  const [group, setGroup] = useState<Group>(null);
  const [loading, setLoading] = useState(false);
  const { pending, msg, run } = useSaver();

  async function load() {
    if (!poId) return;
    setLoading(true);
    setGroup(await getInstallmentGroupAction(poId.trim()));
    setLoading(false);
  }
  function doVoid() {
    if (!group) return;
    if (!confirm("ยกเลิกทั้งกลุ่มงวดนี้?")) return;
    run(() => voidTransactionAction(group.poGroupId), "ยกเลิกกลุ่มงวดเรียบร้อย", () => setGroup(null));
  }

  return (
    <div className="space-y-4">
      <Card title="ดูกลุ่มแบ่งจ่ายงวด">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="รหัสกลุ่มงวด (PO Group = tx_id งวดแรก)"><TextInput value={poId} onChange={(e) => setPoId(e.target.value)} placeholder="TR-..." onKeyDown={(e) => e.key === "Enter" && load()} /></Field>
          <button onClick={load} className="mb-0.5 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white">ดู</button>
        </div>
        <p className="mt-1 text-xs text-slate-400">สร้างกลุ่มงวดใหม่ได้ที่แท็บ “บันทึก” → ติ๊ก “แบ่งจ่ายหลายงวด” · ชำระแต่ละงวดที่แท็บ “ลูกหนี้-เจ้าหนี้”</p>
        <Msg msg={msg} />
      </Card>

      {loading && <p className="text-slate-400">กำลังโหลด…</p>}
      {group === null && !loading && poId && <p className="text-sm text-slate-400">— ไม่พบกลุ่มงวด —</p>}
      {group && (
        <Card title={`กลุ่มงวด ${group.poGroupId} — ${group.header.contactName}`}>
          <div className="mb-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
            <span>ประเภท: <b>{group.header.type}</b></span>
            <span>หมวดหมู่: <b>{group.header.category}</b></span>
            <span>ยอดรวม: <b>{fmt(group.totalBase)}</b></span>
            <span className="md:col-span-3">รายละเอียด: {group.header.description}</span>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500"><th className="p-1">งวด</th><th className="p-1">ครบกำหนด</th><th className="p-1 text-right">ยอด(ฐาน)</th><th className="p-1 text-right">สุทธิ</th><th className="p-1">สถานะ</th><th className="p-1">บัญชีที่จ่าย</th></tr></thead>
            <tbody>
              {group.installments.map((it) => (
                <tr key={it.txId} className="border-t border-slate-100">
                  <td className="p-1">{it.installmentNo}</td><td className="p-1">{it.dueDate}</td>
                  <td className="p-1 text-right">{fmt(it.base)}</td><td className="p-1 text-right">{fmt(it.net)}</td>
                  <td className="p-1">{it.paid ? <span className="text-green-600">จ่ายแล้ว</span> : <span className="text-amber-600">ค้าง</span>}</td>
                  <td className="p-1">{it.accountType || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3"><button onClick={doVoid} disabled={pending} className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">ยกเลิกทั้งกลุ่ม</button></div>
        </Card>
      )}
    </div>
  );
}
