"use client";

import { Fragment, useState } from "react";
import { Card, Empty, Badge, RowBtn } from "@/lib/shared/ui";
import { AUDITED_TABLES, tableLabel } from "@/lib/shared/tenantTables";
import { changedFields, rawBefore, ACTION_LABEL_TH, type EditLogRow } from "@/lib/shared/editLog";

/**
 * ประวัติการแก้ไข — ดูอย่างเดียว + คัดลอกค่าเก่า (D80)
 *
 * 🚨 **ไม่มีปุ่มเขียนทับ DB โดยตั้งใจ** — กดผิดคือทับข้อมูลจริง และการย้อนค่าต้องคิดเรื่อง
 *    FK/trigger/สต็อกครบทุกตาราง · การย้อนของจริงใช้ **ตั้งค่า → สำรองข้อมูล (snapshot)**
 *    ที่นี่ให้แค่ "ก๊อปค่าเก่าไปวางกลับเอง" ซึ่งผ่านการตรวจของฟอร์มปกติทุกชั้น
 */

const ACTION_TONE = { insert: "ok", update: "brand", delete: "crit" } as const;

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

export function HistoryCard({
  rows,
  total,
  limit,
  filter,
}: {
  rows: EditLogRow[];
  total: number;
  limit: number;
  filter: { table: string; action: string; q: string; days: number };
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const tables = [...AUDITED_TABLES].sort((a, b) => tableLabel(a).localeCompare(tableLabel(b), "th"));

  async function copy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      /* เบราว์เซอร์ไม่ให้เข้าคลิปบอร์ด — ผู้ใช้ยังลากคลุมคัดลอกเองได้ ไม่ต้องเด้ง error */
    }
  }

  return (
    <div className="space-y-4">
      <Card title="ประวัติการแก้ไข">
        <p className="mb-4 text-xs text-faint">
          ทุกการเพิ่ม/แก้/ลบของข้อมูลสำคัญถูกบันทึกไว้ที่นี่ — ใครแก้ · แก้ช่องไหน · ค่าก่อนเป็นอะไร
          <br />
          ★ หน้านี้ <b>ดูอย่างเดียว</b> · ถ้าจะย้อนค่ากลับ ให้กดคัดลอกค่าเก่าแล้วเอาไปกรอกกลับในหน้าของมันเอง
          (ย้อนทั้งระบบใช้แท็บ <b>สำรองข้อมูล</b>)
        </p>

        <form method="get" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium tracking-wide text-muted">ข้อมูล</span>
            <select
              name="table"
              defaultValue={filter.table}
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-ink outline-none focus:border-brand"
            >
              <option value="">ทั้งหมด</option>
              {tables.map((t) => (
                <option key={t} value={t}>{tableLabel(t)}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium tracking-wide text-muted">การกระทำ</span>
            <select
              name="action"
              defaultValue={filter.action}
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-ink outline-none focus:border-brand"
            >
              <option value="">ทั้งหมด</option>
              <option value="insert">เพิ่ม</option>
              <option value="update">แก้ไข</option>
              <option value="delete">ลบ</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium tracking-wide text-muted">ย้อนหลัง</span>
            <select
              name="days"
              defaultValue={String(filter.days)}
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-ink outline-none focus:border-brand"
            >
              <option value="7">7 วัน</option>
              <option value="30">30 วัน</option>
              <option value="90">90 วัน</option>
              <option value="365">1 ปี</option>
              <option value="0">ทั้งหมด</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium tracking-wide text-muted">ค้นด้วยเลขที่/รหัส</span>
            <div className="flex gap-1">
              <input
                name="q"
                defaultValue={filter.q}
                placeholder="เช่น TR-2026… / TESTDISL"
                className="w-full rounded-lg border border-line bg-card px-3 py-2 text-ink outline-none focus:border-brand"
              />
              <button
                type="submit"
                className="whitespace-nowrap rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-on-brand hover:opacity-90"
              >
                ค้น
              </button>
            </div>
          </label>
        </form>
      </Card>

      <Card title={`รายการ (${total.toLocaleString("th-TH")})`}>
        {rows.length === 0 ? (
          <Empty>— ไม่พบการแก้ไขตามเงื่อนไขนี้ —</Empty>
        ) : (
          <>
            {total > rows.length && (
              <p className="mb-3 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-xs text-warn">
                แสดง {rows.length.toLocaleString("th-TH")} รายการล่าสุดจากทั้งหมด {total.toLocaleString("th-TH")} —
                ใช้ตัวกรองด้านบนเพื่อแคบลง (ระบบตั้งเพดานไว้ {limit} รายการต่อครั้ง)
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>เมื่อไหร่</th>
                    <th>ใครแก้</th>
                    <th>ข้อมูล</th>
                    <th>รายการที่</th>
                    <th>ทำอะไร</th>
                    <th className="num">ช่องที่เปลี่ยน</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const fields = changedFields(r);
                    const isOpen = open === r.id;
                    return (
                      <Fragment key={r.id}>
                        <tr
                          onClick={() => setOpen(isOpen ? null : r.id)}
                          className="cursor-pointer"
                        >
                          <td className="whitespace-nowrap text-muted">{fmtWhen(r.createdAt)}</td>
                          <td className="text-muted">{r.userName}</td>
                          <td className="text-muted">{tableLabel(r.tableName)}</td>
                          <td className="font-medium text-ink">{r.rowPk || "—"}</td>
                          <td>
                            <Badge tone={ACTION_TONE[r.action]}>{ACTION_LABEL_TH[r.action]}</Badge>
                          </td>
                          <td className="num text-muted">
                            {fields.length} {isOpen ? "▲" : "▼"}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={6} className="bg-raised">
                              {fields.length === 0 ? (
                                <p className="py-2 text-sm text-faint">
                                  ไม่มีช่องไหนเปลี่ยนค่า (บันทึกซ้ำด้วยค่าเดิม)
                                </p>
                              ) : (
                                <table className="tbl">
                                  <thead>
                                    <tr>
                                      <th>ช่อง</th>
                                      <th>ค่าก่อน</th>
                                      <th>ค่าหลัง</th>
                                      <th className="num"></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {fields.map((f) => (
                                      <tr key={f.key}>
                                        <td className="text-muted">{f.label}</td>
                                        <td className="text-crit">{f.before}</td>
                                        <td className="text-ok">{f.after}</td>
                                        <td className="num whitespace-nowrap">
                                          {f.before !== "—" && (
                                            <RowBtn
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                copy(`${r.id}-${f.key}`, rawBefore(r, f.key));
                                              }}
                                            >
                                              {copied === `${r.id}-${f.key}` ? "คัดลอกแล้ว" : "คัดลอกค่าเก่า"}
                                            </RowBtn>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
