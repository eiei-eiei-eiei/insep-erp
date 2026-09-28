import { getDocNumberingSettings } from "../settings-data";
import { DocNumberingCard } from "../_components/DocNumberingCard";

/**
 * ตั้งค่า → เลขเอกสาร (D100)
 * `?entity=` เลือกกิจการของเอกสารบาร์ (เอกสารขายออกในนามกิจการเดียวเสมอ — RPC ตัดสินให้)
 */
export default async function NumberingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  const sp = await searchParams;
  const { rows, entities, barEntityId, modules } = await getDocNumberingSettings(sp.entity);
  return <DocNumberingCard rows={rows} entities={entities} barEntityId={barEntityId} modules={modules} />;
}
