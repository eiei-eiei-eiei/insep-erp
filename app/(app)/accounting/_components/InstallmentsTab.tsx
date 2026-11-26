"use client";

import { useConfirm } from "@/lib/shared/ui";
import { useDateFmt } from "@/lib/shared/dateFormatContext";
import { useEffect, useState } from "react";
import { getInstallmentGroupAction, listInstallmentGroupsAction, voidTransactionAction } from "../actions";
import { Card, Combobox, Field, fmt, useSaver } from "./ui";
import { IconRefresh } from "@/lib/shared/icons";
import { SkeletonTable } from "@/lib/shared/page";

type Group = Awaited<ReturnType<typeof getInstallmentGroupAction>>;
type GroupList = Awaited<ReturnType<typeof listInstallmentGroupsAction>>;

export function InstallmentsTab() {
  const d = useDateFmt();
  const [poId, setPoId] = useState("");
  const [list, setList] = useState<GroupList>([]);
  const [group, setGroup] = useState<Group>(null);
  const [loading, setLoading] = useState(false);
  const { pending, run } = useSaver();
  const { confirmNode, ask } = useConfirm();

  function refreshList() { listInstallmentGroupsAction().then(setList); }
  useEffect(() => { refreshList(); }, []);

  async function load(id: string) {
    if (!id) { setGroup(null); return; }
    setLoading(true);
    setGroup(await getInstallmentGroupAction(id.trim()));
    setLoading(false);
  }
  async function doVoid() {
    if (!group) return;
    if (!(await ask({ title: "ยกเลิกทั้งกลุ่มงวดนี้?", confirmText: "ยกเลิกทั้งกลุ่ม", cancelText: "กลับ", danger: true }))) return;
    run(() => voidTransactionAction(group.poGroupId), "ยกเลิกกลุ่มงวดเรียบร้อย", () => { setGroup(null); setPoId(""); refreshList(); });
  }

  return (
    <div className="space-y-4">
      {confirmNode}
      <Card title="ดูกลุ่มแบ่งจ่ายงวด" help="สร้างกลุ่มงวดใหม่ได้ที่แท็บ “บันทึก” → ติ๊ก “แบ่งจ่ายหลายงวด” · ชำระแต่ละงวดที่แท็บ “ลูกหนี้-เจ้าหนี้” · กดปุ่มรีโหลด ถ้าเพิ่งสร้างใหม่">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[280px] flex-1">
            <Field label="เลือกกลุ่มงวด">
              <Combobox
                value={poId}
                onChange={(v) => { setPoId(v); load(v); }}
                placeholder={`พิมพ์ค้นกลุ่มงวด (${list.length})…`}
                options={list.map((g) => ({
                  value: g.poGroupId,
                  label: `${d.date(g.date)} · ${g.contactName || "ไม่ระบุ"} · ${g.count} งวด · ${fmt(g.total)} ${g.description ? `· ${g.description}` : ""}`,
                }))}
              />
            </Field>
          </div>
          <button onClick={refreshList} className="mb-0.5 rounded-lg border border-line px-3 py-2 text-sm text-muted hover:bg-raised"><IconRefresh size={16} /></button>
        </div>
      </Card>

      {loading && <SkeletonTable rows={3} cols={5} what="กลุ่มงวด" />}
      {group === null && !loading && poId && <p className="text-sm text-faint">— ไม่พบกลุ่มงวด —</p>}
      {group && (
        <Card title={`กลุ่มงวด ${group.poGroupId} — ${group.header.contactName}`}>
          <div className="mb-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
            <span>ประเภท: <b>{group.header.type}</b></span>
            <span>หมวดหมู่: <b>{group.header.category}</b></span>
            <span>ยอดรวม: <b>{fmt(group.totalBase)}</b></span>
            <span className="md:col-span-3">รายละเอียด: {group.header.description}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr className="text-left text-faint"><th>งวด</th><th>ครบกำหนด</th><th className="num">ยอด(ฐาน)</th><th className="num">สุทธิ</th><th>สถานะ</th><th>บัญชีที่จ่าย</th></tr></thead>
              <tbody>
                {group.installments.map((it) => (
                  <tr key={it.txId}>
                    <td>{it.installmentNo}</td><td className="whitespace-nowrap">{d.date(it.dueDate)}</td>
                    <td className="num">{fmt(it.base)}</td><td className="num">{fmt(it.net)}</td>
                    <td>{it.paid ? <span className="text-ok">จ่ายแล้ว</span> : <span className="text-warn">ค้าง</span>}</td>
                    <td>{it.accountType || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3"><button onClick={doVoid} disabled={pending} className="rounded-lg border border-crit-line px-4 py-2 text-sm text-crit hover:bg-crit-bg disabled:opacity-50">ยกเลิกทั้งกลุ่ม</button></div>
        </Card>
      )}
    </div>
  );
}
