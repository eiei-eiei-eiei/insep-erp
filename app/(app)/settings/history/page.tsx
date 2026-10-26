import { getEditHistory } from "../settings-data";
import { HistoryCard } from "../_components/HistoryCard";
import { getTenantPlan } from "@/lib/shared/tenant-plan";
import { auditTablesFor } from "@/lib/shared/moduleScope";

/**
 * ตั้งค่า → ประวัติการแก้ไข (D80)
 *
 * ตัวกรองเป็น `<form method="get">` ธรรมดาโดยตั้งใจ — ไม่ต้องมี state ฝั่ง client
 * และผู้ใช้ **ก๊อป URL ส่งต่อได้** (เช่น "ดูสิ่งที่เกิดกับสินค้าตัวนี้")
 */
export default async function HistorySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; action?: string; q?: string; days?: string }>;
}) {
  const sp = await searchParams;
  const days = sp.days === undefined ? 30 : Number(sp.days) || 0;
  const [{ rows, total, limit }, plan] = await Promise.all([
    getEditHistory({ table: sp.table, action: sp.action, q: sp.q, days }),
    getTenantPlan(),
  ]);

  return (
    <HistoryCard
      auditTables={auditTablesFor(plan.modules)}
      rows={rows}
      total={total}
      limit={limit}
      filter={{ table: sp.table ?? "", action: sp.action ?? "", q: sp.q ?? "", days }}
    />
  );
}
