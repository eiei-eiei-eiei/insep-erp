"use client";

import { useState, useTransition } from "react";
import { EscToClose } from "@/lib/shared/ui";
import { downloadBlob, MIME } from "@/lib/shared/download";
import { tableLabel } from "@/lib/shared/tenantTables";
import {
  exportFileName, sheetNameOf, sheetRows, totalRows, EXPORT_TABLES,
} from "@/lib/export/tenantExport";
import { exportTenantDataAction, type ExportResult } from "../actions";

type Kind = "json" | "xlsx";

const KIND_LABEL: Record<Kind, string> = {
  json: "ไฟล์สำรอง (.json)",
  xlsx: "ไฟล์ Excel (.xlsx)",
};

/**
 * หน้า ตั้งค่า → สำรองข้อมูล (D82)
 *
 * 🎯 เดิมเป็นระบบ snapshot ที่เก็บไว้ใน DB แล้วมีปุ่ม "ย้อนกลับ" ให้ลูกค้ากดเอง —
 *    ปุ่มนั้นเรียก `fn_mig_set_triggers` ซึ่งปิด trigger **ทั้งฐานข้อมูล** = กระทบลูกค้าเจ้าอื่น
 *    ที่กำลังใช้อยู่พร้อมกัน (สต็อกของเขาผิดถาวรโดยไม่มีอะไรฟ้อง) → ตัดทิ้งทั้งก้อน
 *    เหลือ **ดาวน์โหลดเก็บไว้เอง** · ทางกลับทำผ่าน `npm run restore:tenant` ฝั่งผู้ดูแลระบบ
 *
 * 🚨 ต้องบอกผู้ใช้ตรง ๆ ว่าไฟล์นี้กดกลับเองไม่ได้ — ไม่ใช่ปล่อยให้เขาเดาเอง
 */
export function DataManager() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [ask, setAsk] = useState<Kind | null>(null);
  const [password, setPassword] = useState("");

  function open(kind: Kind) {
    setPassword("");
    setMsg(null);
    setAsk(kind);
  }

  async function deliver(kind: Kind, data: ExportResult) {
    const now = new Date();
    if (kind === "json") {
      downloadBlob(data.fileJson, exportFileName(data.slug, "json", now), MIME.json);
      return;
    }
    // 🔴 ต้อง await import() — SheetJS ใหญ่มาก static import = ทุกคนที่เปิดหน้าตั้งค่าโหลดตาม
    //    (บทเรียนเดียวกับ pdf-lib ใน D61)
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const used = new Set<string>();
    const envelope = JSON.parse(data.fileJson) as { tables: Record<string, Record<string, unknown>[]> };
    for (const table of EXPORT_TABLES) {
      const ws = XLSX.utils.aoa_to_sheet(sheetRows(envelope.tables[table] ?? []));
      XLSX.utils.book_append_sheet(wb, ws, sheetNameOf(table, used));
    }
    const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    downloadBlob(bytes, exportFileName(data.slug, "xlsx", now), MIME.xlsx);
  }

  function submit() {
    if (!ask) return;
    const kind = ask;
    setMsg(null);
    startTransition(async () => {
      const res = await exportTenantDataAction(password);
      if (!res.ok || !res.data) {
        setMsg({ ok: false, text: res.error ?? "ดึงข้อมูลไม่สำเร็จ" });
        return;
      }
      const data = res.data;
      try {
        await deliver(kind, data);
      } catch (e) {
        setMsg({ ok: false, text: `สร้างไฟล์ไม่สำเร็จ: ${e instanceof Error ? e.message : e}` });
        return;
      }
      setResult(data);
      setAsk(null);
      setPassword("");
      setMsg({ ok: true, text: `ดาวน์โหลด${KIND_LABEL[kind]}เรียบร้อย — เก็บไฟล์ไว้ในที่ปลอดภัย` });
    });
  }

  const rows = result ? EXPORT_TABLES.filter((t) => (result.counts[t] ?? 0) > 0) : [];

  return (
    <div className="mx-auto max-w-3xl">
      <h2 className="mb-1 text-xl font-bold text-ink">ดาวน์โหลดข้อมูลไปเก็บไว้เอง</h2>
      <p className="mb-4 text-sm text-faint">
        ดึงข้อมูลทั้งหมดของกิจการออกมาเป็นไฟล์เดียว เก็บไว้ในเครื่องหรือไดรฟ์ของคุณเอง ·
        เฉพาะเจ้าของกิจการ (main) และต้องยืนยันด้วยรหัสผ่าน
      </p>

      <div className="mb-4 rounded-lg bg-warn-bg px-4 py-3 text-sm text-warn">
        <div className="font-medium">อ่านก่อนใช้</div>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
          <li>
            ไฟล์นี้ <b>เอากลับเข้าระบบเองไม่ได้</b> — ถ้าต้องการย้อนข้อมูล ให้ส่งไฟล์ให้ผู้ดูแลระบบดำเนินการให้
          </li>
          <li>
            ไฟล์มี<b>ข้อมูลอ่อนไหวทั้งหมด</b> (เงินเดือน · เลขบัตรประชาชนพนักงาน · ยอดขาย · ราคาทุน) —
            เก็บให้มิดชิด อย่าส่งต่อทางแชทหรืออีเมลที่ไม่ปลอดภัย
          </li>
          <li>ควรโหลดเก็บไว้เป็นระยะ โดยเฉพาะก่อนแก้ข้อมูลจำนวนมาก</li>
        </ul>
      </div>

      {msg && (
        <div className={`mb-4 rounded-lg px-4 py-2 text-sm ${msg.ok ? "bg-ok-bg text-ok" : "bg-crit-bg text-crit"}`}>
          {msg.text}
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => open("json")}
          disabled={pending}
          className="rounded-lg border border-line bg-card p-4 text-left transition hover:border-brand-line disabled:opacity-50"
        >
          <div className="font-semibold text-ink">ดาวน์โหลดไฟล์สำรอง (.json)</div>
          <div className="mt-1 text-xs text-faint">
            ครบทุกตัวอักษรตามที่อยู่ในระบบ · เป็นไฟล์ที่ใช้ย้อนข้อมูลได้จริง <b>ให้เก็บไฟล์นี้ไว้เสมอ</b>
            <br />เปิดอ่านเองไม่รู้เรื่อง — ไว้ส่งให้ผู้ดูแลระบบ
          </div>
        </button>

        <button
          onClick={() => open("xlsx")}
          disabled={pending}
          className="rounded-lg border border-line bg-card p-4 text-left transition hover:border-brand-line disabled:opacity-50"
        >
          <div className="font-semibold text-ink">ดาวน์โหลดเป็น Excel (.xlsx)</div>
          <div className="mt-1 text-xs text-faint">
            แยกชีตตามประเภทข้อมูล เปิดอ่านเอง/ส่งให้ผู้ทำบัญชีได้ทันที
            <br /><b>ใช้ย้อนข้อมูลไม่ได้</b> — เป็นไฟล์ไว้ดูเท่านั้น
          </div>
        </button>
      </div>

      {result && (
        <div className="rounded-lg border border-line bg-card p-4">
          <div className="mb-3 font-semibold text-muted">
            ข้อมูลที่อยู่ในไฟล์ล่าสุด — รวม {totalRows(result.counts).toLocaleString("th-TH")} แถว
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr className="text-left text-faint"><th>ข้อมูล</th><th className="num">จำนวนแถว</th></tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t}>
                    <td>{tableLabel(t)}</td>
                    <td className="num">{(result.counts[t] ?? 0).toLocaleString("th-TH")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-faint">
            ตารางที่ไม่มีข้อมูลเลยจะไม่ขึ้นในรายการนี้ แต่ยังมีอยู่ในไฟล์ (เป็นรายการว่าง)
          </p>
        </div>
      )}

      {ask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !pending) setAsk(null); }}
        >
          <EscToClose onClose={() => { if (!pending) setAsk(null); }} />
          <div className="w-full max-w-md rounded-lg bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-lg font-bold text-ink">ยืนยันดาวน์โหลดข้อมูล</div>
            <p className="mb-3 text-sm text-muted">{KIND_LABEL[ask]}</p>
            <p className="mb-3 rounded-lg bg-raised px-3 py-2 text-xs text-faint">
              ไฟล์จะมีข้อมูลทั้งกิจการรวมถึงเงินเดือนและเลขบัตรพนักงาน — กรอกรหัสผ่านเพื่อยืนยันว่าเป็นคุณจริง
            </p>

            <label className="mb-1 block text-sm text-muted">รหัสผ่านของคุณ</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && password && submit()}
              // ★ ต้องมี bg-input + text-ink — ไม่งั้นโหมดมืดได้สีปริยายของเบราว์เซอร์ (พื้นจม อ่านไม่ออก)
              className="mb-4 w-full rounded-lg border border-line bg-input px-3 py-2 text-ink outline-none focus:border-brand"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setAsk(null)}
                disabled={pending}
                className="rounded-lg border border-line px-4 py-2 text-sm text-muted disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                onClick={submit}
                disabled={pending || !password}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "กำลังเตรียมไฟล์…" : "ดาวน์โหลด"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
