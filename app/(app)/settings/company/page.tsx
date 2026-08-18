import { getCompanySettings } from "../settings-data";
import { CompanyCard } from "../_components/CompanyCard";

export default async function CompanySettingsPage() {
  const { entities, docEntityId } = await getCompanySettings();

  if (entities.length === 0) {
    return (
      <div className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">
        ยังไม่มีข้อมูลกิจการ (entities) — ติดต่อผู้ดูแลระบบเพื่อเปิดกิจการก่อน
      </div>
    );
  }
  return <CompanyCard entities={entities} docEntityId={docEntityId} />;
}
