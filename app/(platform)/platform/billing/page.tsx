import { requirePlatformAdmin } from "@/lib/platform/auth";
import { listBilling } from "@/lib/platform/billing-db";
import { bangkokDateISO } from "@/lib/shared/datetime";
import { BillingManager } from "./_components/billing-manager";

/**
 * หน้าค่างวด (เฟส 2) — "ที่เดียวที่เปิดแล้วรู้ว่าใครค้าง"
 *
 * ★ "วันนี้" คำนวณฝั่ง server ด้วย `bangkokDateISO()` แล้วส่งเป็น prop
 *   ให้ client คิดเองจะได้วันเพี้ยนตาม timezone เครื่อง และเสี่ยง hydration mismatch
 */
export default async function BillingPage() {
  const { db } = await requirePlatformAdmin();
  const rows = await listBilling(db);

  return <BillingManager rows={rows} todayISO={bangkokDateISO()} />;
}
