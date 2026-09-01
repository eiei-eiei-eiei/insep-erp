"use client";

import { getDashboardAction } from "../actions";
import { Card, Stat, fmt, useRead, LoadError } from "./ui";

type Dash = Awaited<ReturnType<typeof getDashboardAction>>;

export function DashboardTab({ period, entityId, active }: { period: string; entityId: string; active: boolean }) {
  // โหลดเมื่อแท็บถูกเปิด (active) + refetch ทุกครั้งที่กลับมา — โชว์ข้อมูลเดิมค้างไว้ระหว่างโหลด (ไม่กระพริบ)
  // 🚨 D89 — useRead รับ throw จากชั้นอ่าน · ไม่งั้นแดชบอร์ดค้างที่ "กำลังโหลด…" ตลอดกาล
  const { data, loading, err, reload } = useRead<Dash>(
    () => getDashboardAction(period, entityId),
    [period, entityId],
    { skip: !active },
  );

  if (err && !data) return <LoadError err onRetry={reload} what="แดชบอร์ด" />;
  if (loading || !data) return <p className="text-faint">กำลังโหลด…</p>;
  const { netIncome, netExpense, vatOut, vatIn } = data.dash;

  return (
    <div className="space-y-4">
      {/* ข้อมูลเดิมยังอยู่ แต่ต้องบอกว่ารอบล่าสุดโหลดไม่สำเร็จ — ตัวเลขอาจไม่ใช่ของตอนนี้ */}
      <LoadError err={err} onRetry={reload} what="แดชบอร์ด" />
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
