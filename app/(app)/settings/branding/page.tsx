import { getBrandingSettings, getDateFormatSettings } from "../settings-data";
import { BrandingCard } from "../_components/BrandingCard";
import { DateFormatCard } from "../_components/DateFormatCard";
import { bangkokDateISO } from "@/lib/shared/datetime";

export default async function BrandingSettingsPage() {
  const [branding, dateFormats] = await Promise.all([getBrandingSettings(), getDateFormatSettings()]);
  return (
    <div className="space-y-6">
      <BrandingCard current={branding} />
      {/* ★ ส่ง "วันนี้" จาก server — ตัวอย่างบนการ์ดจะได้ตรงกันทั้ง SSR และเบราว์เซอร์ */}
      <DateFormatCard current={dateFormats} todayISO={bangkokDateISO()} nowISO={new Date().toISOString()} />
    </div>
  );
}
