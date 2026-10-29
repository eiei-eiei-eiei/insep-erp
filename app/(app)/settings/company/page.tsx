import { getCompanySettings } from "../settings-data";
import { CompanyCard } from "../_components/CompanyCard";
import { getTenantPlan } from "@/lib/shared/tenant-plan";
import { companySectionsFor } from "@/lib/shared/moduleScope";

export default async function CompanySettingsPage() {
  const [{ entities, docEntityId, revenueEntityId, revenueAccountName, cashAccountName, accounts }, plan] = await Promise.all([
    getCompanySettings(),
    getTenantPlan(),
  ]);

  if (entities.length === 0) {
    return (
      <div className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">
        ยังไม่มีข้อมูลกิจการ (entities) — ติดต่อผู้ดูแลระบบเพื่อเปิดกิจการก่อน
      </div>
    );
  }
  return (
    <CompanyCard
      sections={companySectionsFor(plan.modules)}
      entities={entities}
      docEntityId={docEntityId}
      revenueEntityId={revenueEntityId}
      revenueAccountName={revenueAccountName}
      cashAccountName={cashAccountName}
      accounts={accounts}
    />
  );
}
