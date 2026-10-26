import { getLineSettings } from "../settings-data";
import { LineCard } from "../_components/LineCard";
import { getTenantPlan } from "@/lib/shared/tenant-plan";
import { lineEventsFor } from "@/lib/shared/moduleScope";

export default async function NotifySettingsPage() {
  const [line, plan] = await Promise.all([getLineSettings(), getTenantPlan()]);
  return <LineCard current={line} events={lineEventsFor(plan.modules)} />;
}
