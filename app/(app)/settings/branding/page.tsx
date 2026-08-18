import { getBrandingSettings } from "../settings-data";
import { BrandingCard } from "../_components/BrandingCard";

export default async function BrandingSettingsPage() {
  const branding = await getBrandingSettings();
  return <BrandingCard current={branding} />;
}
