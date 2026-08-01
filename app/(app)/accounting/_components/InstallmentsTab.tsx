"use client";

import { useEffect, useState } from "react";
import { getInstallmentGroupAction, listInstallmentGroupsAction, voidTransactionAction } from "../actions";
import { Card, Field, Msg, Select, fmt, useSaver } from "./ui";
import { IconRefresh } from "@/lib/shared/icons";

type Group = Awaited<ReturnType<typeof getInstallmentGroupAction>>;
type GroupList = Awaited<ReturnType<typeof listInstallmentGroupsAction>>;

export function InstallmentsTab() {
  const [poId, setPoId] = useState("");
  const [list, setList] = useState<GroupList>([]);
  const [group, setGroup] = useState<Group>(null);
  const [loading, setLoading] = useState(false);
  const { pending, msg, run } = useSaver();

  function refreshList() { listInstallmentGroupsAction().then(setList); }
  useEffect(() => { refreshList(); }, []);

  async function load(id: string) {
    if (!id) { setGroup(null); return; }
    setLoading(true);
    setGroup(await getInstallmentGroupAction(id.trim()));
    setLoading(false);
  }
  function doVoid() {
    if (!group) return;
    if (!confirm("ยกเลิกทั้งกลุ่มงวดนี้?")) return;
    run(() => voidTransactionAction(group.poGroupId), "ยกเลิกกลุ่มงวดเรียบร้อย", () => { setGroup(null); setPoId(""); refreshList(); });
  }

  return (
    <div className="space-y-4">
      <Card title="ดูกลุ่มแบ่งจ่ายงวด">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[280px] flex-1">
            <Field label="เลือกกลุ่มงวด">
              <Select value={poId} onChange={(e) => { setPoId(e.target.value); load(e.target.value); }}>
                <option value="">— เลือกกลุ่มงวด ({list.length}) —</option>
                {list.map((g) => (
                  <option key={g.poGroupId} value={g.poGroupId}>
                    {g.date} · {g.contactName || "ไม่ระบุ"} · {g.count} งวด · {fmt(g.total)} {g.description ? `· ${g.description}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <button onClick={refreshList} className="mb-0.5 rounded-lg border border-line px-3 py-2 text-sm text-muted hover:bg-raised"><IconRefresh size={16} /></button>
        </div>
        <p className="mt-1 text-xs text-faint">สร้างกลุ่มงวดใหม่ได้ที่แท็บ “บันทึก” → ติ๊ก “แบ่งจ่ายหลายงวด” · ชำระแต่ละงวดที่แท็บ “ลูกหนี้-เจ้าหนี้” · กดปุ่มรีโหลด ถ้าเพิ่งสร้างใหม่</p>
        <Msg msg={msg} />
      </Card>

      {loading && <p className="text-faint">กำลังโหลด…</p>}
      {group === null && !loading && poId && <p className="text-sm text-faint">— ไม่พบกลุ่มงวด —</p>}
      {group && (
        <Card title={`กลุ่มงวด ${group.poGroupId} — ${group.header.contactName}`}>
          <div className="mb-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
            <span>ประเภท: <b>{group.header.type}</b></span>
            <span>หมวดหมู่: <b>{group.header.category}</b></span>
            <span>ยอดรวม: <b>{fmt(group.totalBase)}</b></span>
            <span className="md:col-span-3">รายละเอียด: {group.header.description}</span>
          </div>
          <table className="tbl">
            <thead><tr className="text-left text-faint"><th>งวด</th><th>ครบกำหนด</th><th className="num">ยอด(ฐาน)</th><th className="num">สุทธิ</th><th>สถานะ</th><th>บัญชีที่จ่าย</th></tr></thead>
            <tbody>
              {group.installments.map((it) => (
                <tr key={it.txId}>
                  <td>{it.installmentNo}</td><td>{it.dueDate}</td>
                  <td className="num">{fmt(it.base)}</td><td className="num">{fmt(it.net)}</td>
                  <td>{it.paid ? <span className="text-ok">จ่ายแล้ว</span> : <span className="text-warn">ค้าง</span>}</td>
                  <td>{it.accountType || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3"><button onClick={doVoid} disabled={pending} className="rounded-lg border border-crit-line px-4 py-2 text-sm text-crit hover:bg-crit-bg disabled:opacity-50">ยกเลิกทั้งกลุ่ม</button></div>
        </Card>
      )}
    </div>
  );
}
