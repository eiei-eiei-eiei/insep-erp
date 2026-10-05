import { getDocNumberingSettings } from "../settings-data";
import { DocNumberingCard } from "../_components/DocNumberingCard";

/**
 * ตั้งค่า → เลขเอกสาร (D100)
 * `?bar=` / `?wht=` = กิจการที่การ์ดบาร์ / การ์ด 50ทวิ แสดงอยู่ (แยกกัน)
 * เอกสารขายออกในนามกิจการเดียวเสมอ · batch/ล็อตใช้ร่วมทุกกิจการ — RPC ตัดสินให้
 */
export default async function NumberingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ bar?: string; wht?: string }>;
}) {
  const sp = await searchParams;
  const { rows, entities, entityOf, modules } = await getDocNumberingSettings({ bar: sp.bar, wht: sp.wht });
  return <DocNumberingCard rows={rows} entities={entities} entityOf={entityOf} modules={modules} />;
}
