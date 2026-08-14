import { requirePlatformAdmin } from "@/lib/platform/auth";
import { listTenants } from "@/lib/platform/provision";
import { PlatformManager } from "./_components/platform-manager";

/**
 * หน้าเดียวของแอปจัดการหลังบ้าน เฟส 1 — รายชื่อลูกค้า + งานที่เคยต้องเปิด terminal/เขียน SQL
 * ผลลัพธ์ที่ต้องได้: รับลูกค้าใหม่จบได้โดยไม่ต้องแตะ terminal เลย
 */
export default async function PlatformPage() {
  const { db } = await requirePlatformAdmin();
  const tenants = await listTenants(db);

  return <PlatformManager tenants={tenants} />;
}
