"use client";

import { useEffect, useState } from "react";
import { getDashboardAction } from "../actions";
import { Card, Stat, fmt } from "./ui";

type Dash = Awaited<ReturnType<typeof getDashboardAction>>;

export function DashboardTab({ period, entityId, active }: { period: string; entityId: string; active: boolean }) {
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  // โหลดเมื่อแท็บถูกเปิด (active) + refetch ทุกครั้งที่กลับมา — โชว์ข้อมูลเดิมค้างไว้ระหว่างโหลด (ไม่กระพริบ)
  useEffect(() => {
    if (!active) return;
    let alive = true;
    getDashboardAction(period, entityId).then((d) => { if (alive) { setData(d); setLoading(false); } });
    return () => { alive = false; };
  }, [period, entityId, active]);

  if (loading || !data) return <p className="text-faint">กำลังโหลด…</p>;
  const { netIncome, netExpense, vatOut, vatIn } = data.dash;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="รายรับสุทธิ (เดือนนี้)" value={fmt(netIncome)} tone="green" />
        <Stat label="รายจ่ายสุทธิ (เดือนนี้)" value={fmt(netExpense)} tone="red" />
        <Stat label="ภาษีขาย (VAT out)" value={fmt(vatOut)} />
        <Stat label="ภาษีซื้อ (VAT in)" value={fmt(vatIn)} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-2">
        <Stat label="กำไรสุทธิ (รับ − จ่าย)" value={fmt(netIncome - netExpense)} tone={netIncome - netExpense >= 0 ? "green" : "red"} />
        <Stat label="VAT สุทธิเดือนนี้ (ขาย − ซื้อ)" value={fmt(vatOut - vatIn)} />
      </div>

      <Card title={`รายจ่ายที่ยังไม่ออก 50ทวิ (${data.whtPending.length} รายการ)`}>
        {data.whtPending.length === 0 ? (
          <p className="text-sm text-faint">ไม่มีรายการค้างออกหนังสือรับรอง</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr className="text-left text-faint"><th>วันที่</th><th>คู่ค้า</th><th>หมวดหมู่</th><th className="num">ยอด</th><th className="num">หัก ณ ที่จ่าย</th></tr></thead>
              <tbody>
                {data.whtPending.map((p) => (
                  <tr key={p.transactionId}>
                    <td>{p.displayDate}</td>
                    <td>{p.contactName}</td>
                    <td>{p.category}</td>
                    <td className="num">{fmt(p.amount)}</td>
                    <td className="num">{fmt(p.whtAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-faint">ออกใบ 50ทวิ ได้ที่แท็บ “เอกสารสรรพากร” ในหน้าบัญชีนี้</p>
          </div>
        )}
      </Card>
      <p className="text-xs text-faint">* Dashboard กรองเดือนด้วยวันที่ใบกำกับ (fallback วันที่รายการ) — จงใจต่างจาก ภพ.30 ตามระบบเดิม</p>
    </div>
  );
}
