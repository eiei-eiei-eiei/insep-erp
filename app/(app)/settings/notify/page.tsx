import { getLineSettings } from "../settings-data";
import { LineCard } from "../_components/LineCard";

export default async function NotifySettingsPage() {
  const line = await getLineSettings();
  return <LineCard current={line} />;
}
