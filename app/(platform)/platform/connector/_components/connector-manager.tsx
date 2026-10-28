"use client";

import { useMemo, useState } from "react";
import { Badge, Card, Empty, RowBtn, Select, TableWrap, useConfirm, useSaver } from "@/lib/shared/ui";
import { ROLE_LABEL, toRole } from "@/lib/shared/roles";
import { formatDateThai } from "@/lib/shared/format";
import { grantBlock, grantWarn, REVOKE_DONE_TEXT } from "@/lib/connector/grant";
import { MCP_PATH } from "@/lib/connector/guard";
import type { ConnectorTenantRow, ConnectorUserRow } from "@/lib/platform/connector-db";
import { grantConnectorAction, revokeConnectorAction } from "../actions";

/**
 * แท็บ Claude connector (D141) — เลือกลูกค้า → อนุญาต/ถอนสิทธิ์รายคน
 * ★ ปุ่มที่กดไม่ได้ต้องบอกเหตุผล (D83/D86) — grantBlock() ตัดสินใน lib
 */
export function ConnectorManager({ tenants, envOn }: { tenants: ConnectorTenantRow[]; envOn: boolean }) {
  // เริ่มที่ลูกค้าที่มีคนได้สิทธิ์อยู่แล้ว (มักเป็นตัวที่ต้องดู) · ไม่มี = ตัวแรก
  const first = tenants.find((t) => t.users.some((u) => u.allowed)) ?? tenants[0];
  const [slug, setSlug] = useState(first?.slug ?? "");
  const t = useMemo(() => tenants.find((x) => x.slug === slug), [tenants, slug]);
  const { pending, run } = useSaver();
  const { ask, confirmNode } = useConfirm();
  const totalAllowed = tenants.reduce((s, x) => s + x.users.filter((u) => u.allowed).length, 0);

  async function grant(u: ConnectorUserRow) {
    const warn = grantWarn({ role: u.role, must_change_password: u.mustChangePassword });
    if (warn && !(await ask({ title: `อนุญาต ${u.username}?`, detail: warn, confirmText: "อนุญาต" }))) return;
    run(() => grantConnectorAction(u.userId), `อนุญาต ${u.username} แล้ว — ไปเชื่อมต่อ connector ที่ claude.ai ด้วยบัญชีนี้ได้เลย`);
  }
  async function revoke(u: ConnectorUserRow) {
    const ok = await ask({
      title: `ถอนสิทธิ์ ${u.username}?`,
      detail: "Claude จะบันทึกบิลด้วยบัญชีนี้ไม่ได้ทันที (บิลที่บันทึกไปแล้วยังอยู่ครบ)",
      confirmText: "ถอนสิทธิ์",
      danger: true,
    });
    if (ok) run(() => revokeConnectorAction(u.userId), REVOKE_DONE_TEXT);
  }

  return (
    <div className="space-y-4">
      {confirmNode}
      <Card title="Claude connector — ส่งรูปบิลในแชท Claude แล้วลงบัญชี">
        <p className="text-sm text-muted">
          เฉพาะผู้ใช้ที่อนุญาตในหน้านี้เท่านั้นที่เชื่อมต่อ Claude เข้าบัญชีของลูกค้าได้ · ถอนสิทธิ์แล้วหยุดทันที
          {" · "}อนุญาตอยู่ทั้งหมด <b className="text-ink">{totalAllowed}</b> คน
        </p>
        <p className="mt-2 text-xs text-faint">
          URL ที่ใส่ใน claude.ai = โดเมนของแอปที่ลูกค้าใช้ + <code>{MCP_PATH}</code>
          {envOn
            ? " · deployment นี้เปิด connector อยู่"
            : " · deployment นี้ไม่ได้ตั้ง CLAUDE_CONNECTOR=1 (ไม่เป็นไร ถ้า connector เปิดอยู่ที่ deployment ที่ลูกค้าใช้ ซึ่งชี้ DB ก้อนเดียวกัน)"}
        </p>
      </Card>

      {tenants.length === 0 ? (
        <Empty>— ยังไม่มีลูกค้าใน DB ก้อนนี้ —</Empty>
      ) : (
        <Card>
          <label className="mb-3 flex items-center gap-2 text-sm text-muted">
            ลูกค้า
            <Select value={slug} onChange={(e) => setSlug(e.target.value)} className="max-w-xs">
              {tenants.map((x) => (
                <option key={x.slug} value={x.slug}>
                  {x.slug} — {x.name}
                  {x.users.some((u) => u.allowed) ? ` (อนุญาต ${x.users.filter((u) => u.allowed).length})` : ""}
                </option>
              ))}
            </Select>
          </label>
          {t && !t.isActive && (
            <p className="mb-3 rounded border border-warn-line bg-warn-bg p-2 text-xs text-warn">ลูกค้ารายนี้ถูกระงับอยู่ — คนที่ได้สิทธิ์แล้วก็ใช้ connector ไม่ได้จนกว่าจะเปิดใช้งาน</p>
          )}
          {!t || t.users.length === 0 ? (
            <Empty>— ลูกค้ารายนี้ยังไม่มีผู้ใช้ —</Empty>
          ) : (
            <TableWrap minWidth={620}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>ผู้ใช้</th>
                    <th>บทบาท</th>
                    <th>สถานะ</th>
                    <th className="text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {t.users.map((u) => {
                    const block = grantBlock({ role: u.role, must_change_password: u.mustChangePassword }, t.isActive);
                    return (
                      <tr key={u.userId}>
                        <td>
                          <div className="font-medium text-ink">{u.username}</div>
                          {u.displayName && u.displayName !== u.username && <div className="text-xs text-faint">{u.displayName}</div>}
                        </td>
                        <td>{ROLE_LABEL[toRole(u.role)]}</td>
                        <td>
                          {u.allowed ? (
                            <Badge tone="ok">อนุญาต{u.allowedAt ? ` · ${formatDateThai(u.allowedAt.slice(0, 10))}` : ""}</Badge>
                          ) : (
                            <Badge>ไม่อนุญาต</Badge>
                          )}
                          {u.mustChangePassword && <div className="mt-1 text-xs text-warn">ยังใช้รหัสชั่วคราว</div>}
                        </td>
                        <td className="text-right">
                          {u.allowed ? (
                            <RowBtn tone="red" disabled={pending} onClick={() => revoke(u)}>ถอนสิทธิ์</RowBtn>
                          ) : (
                            <>
                              <RowBtn tone="brand" disabled={pending || Boolean(block)} title={block ?? undefined} onClick={() => grant(u)}>อนุญาต</RowBtn>
                              {block && <div className="mt-1 text-xs text-warn">{block}</div>}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      )}
    </div>
  );
}
