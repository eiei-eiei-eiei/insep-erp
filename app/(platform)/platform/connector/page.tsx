import { requirePlatformAdmin } from "@/lib/platform/auth";
import { listConnectorUsers } from "@/lib/platform/connector-db";
import { connectorEnabled } from "@/lib/connector/guard";
import { ConnectorManager } from "./_components/connector-manager";

/**
 * แท็บ Claude connector (D141) — ใครส่งรูปบิลในแชท Claude แล้วลงบัญชีได้
 * ★ จัดการได้เฉพาะ DB ก้อนที่ deployment นี้ชี้ (insep-erp = ของเจ้าของ · proof-admin = ลูกค้า)
 */
export default async function ConnectorPage() {
  const { db } = await requirePlatformAdmin();
  const tenants = await listConnectorUsers(db);
  return <ConnectorManager tenants={tenants} envOn={connectorEnabled(process.env.CLAUDE_CONNECTOR)} />;
}
