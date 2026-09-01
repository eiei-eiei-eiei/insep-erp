"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Field, NumBox, Empty, fmt, LoadError } from "@/lib/shared/ui";
import { buildPayrollReport, type PayrollReport } from "@/lib/payroll/report";
import { getPayrollReportAction } from "../read-actions";

/**
 * แท็บรายงาน — บัญชีลงเป็นก้อน (ยอดสุทธิ/นำส่ง) เพื่อไม่ให้หมวดรายจ่ายรุงรัง
 * ข้างในก้อนนั้นเป็นอะไรบ้างมาดูที่นี่: แยกตามรายการ × รายคน
 *
 * ★ ไม่ต้องมีตารางใหม่ — ข้อมูลมาจาก `payroll_items.computed` ที่แช่ไว้ตอนกดบันทึกอยู่แล้ว
 */
export function ReportTab({ active }: { active: boolean }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [report, setReport] = useState<PayrollReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);

  const load = useCallback((y: number) => {
    setLoading(true);
    setErr(false);
    getPayrollReportAction(y)
      .then((src) => {
        setReport(buildPayrollReport(src));
        setLoading(false);
      })
      .catch(() => {
        // 🚨 D89 — ยอดทั้งปีที่โหลดไม่ครบต้องไม่ขึ้นจอเหมือนของจริง
        setErr(true);
        setLoading(false);
      });
  }, []);

  useEffect(() => { if (active) load(year); }, [active, year, load]);

  const earn = report?.components.filter((c) => c.kind === "earning") ?? [];
  const ded = report?.components.filter((c) => c.kind === "deduction") ?? [];

  return (
    <div className="space-y-4">
      <Card title="เลือกปี">
        <div className="max-w-[10rem]">
          <Field label="ปี (ค.ศ.)">
            <NumBox value={year} onChange={(v) => setYear(v === "" ? new Date().getFullYear() : v)} />
          </Field>
        </div>
        <p className="mt-2 text-xs text-faint">
          ตัวเลขมาจากงวดที่<b>กดคำนวณ &amp; บันทึกแล้ว</b> — งวดร่างที่ยังไม่บันทึกจะไม่โผล่
        </p>
      </Card>

      {loading && <p className="text-sm text-faint">กำลังโหลด…</p>}
      <LoadError err={err} onRetry={() => load(year)} what="รายงานเงินเดือน" />

      {!loading && report && report.rows.length === 0 && (
        <Empty>— ปี {year} ยังไม่มีงวดที่บันทึกไว้ —</Empty>
      )}

      {!loading && report && report.rows.length > 0 && (
        <>
          <Card title={`สรุปทั้งบริษัท ปี ${year}`}>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr className="text-left text-faint"><th>รายการ</th><th className="num">รวมทั้งปี</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>ค่าจ้างฐาน (เงินเดือน/ค่าแรง)</td>
                    <td className="num">{fmt(report.total.baseAmount)}</td>
                  </tr>
                  {earn.map((c) => (
                    <tr key={c.code}><td>{c.name}</td><td className="num">{fmt(c.total)}</td></tr>
                  ))}
                  <tr className="font-semibold">
                    <td>รวมเงินได้</td><td className="num">{fmt(report.total.gross)}</td>
                  </tr>
                  {ded.map((c) => (
                    <tr key={c.code}><td>หัก {c.name}</td><td className="num">−{fmt(c.total)}</td></tr>
                  ))}
                  <tr><td>หัก ประกันสังคม (ส่วนลูกจ้าง)</td><td className="num">−{fmt(report.total.sso)}</td></tr>
                  <tr><td>หัก ภาษี ณ ที่จ่าย</td><td className="num">−{fmt(report.total.wht)}</td></tr>
                  <tr className="font-semibold">
                    <td>จ่ายจริงให้พนักงาน</td><td className="num">{fmt(report.total.net)}</td>
                  </tr>
                  <tr>
                    <td>ประกันสังคม (ส่วนนายจ้าง — รายจ่ายเพิ่มของบริษัท)</td>
                    <td className="num">{fmt(report.total.ssoEmployer)}</td>
                  </tr>
                  <tr className="font-semibold">
                    <td>ต้นทุนพนักงานรวมของบริษัท</td>
                    <td className="num">{fmt(report.total.gross + report.total.ssoEmployer)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="แยกรายคน">
            <p className="mb-2 text-xs text-faint">
              ใช้ดู performance ได้ — เช่นใครทำคอมมิชชั่นได้เท่าไร ใครทำล่วงเวลาเยอะ
            </p>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr className="text-left text-faint">
                    <th>ชื่อ</th><th>กลุ่ม</th><th className="num">งวด</th>
                    <th className="num">ค่าจ้างฐาน</th>
                    {report.components.map((c) => <th key={c.code} className="num">{c.name}</th>)}
                    <th className="num">รวมได้</th><th className="num">ปกส.</th>
                    <th className="num">ภาษี</th><th className="num">จ่ายจริง</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.empId}>
                      <td className="whitespace-nowrap">{r.empName}</td>
                      <td>{r.groupCode ?? "—"}</td>
                      <td className="num">{r.periods}</td>
                      <td className="num">{fmt(r.baseAmount)}</td>
                      {report.components.map((c) => (
                        <td key={c.code} className="num">
                          {r.byComponent[c.code] ? fmt(r.byComponent[c.code]) : "—"}
                        </td>
                      ))}
                      <td className="num">{fmt(r.gross)}</td>
                      <td className="num">{fmt(r.sso)}</td>
                      <td className="num">{fmt(r.wht)}</td>
                      <td className="num font-semibold">{fmt(r.net)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td colSpan={3}>รวม</td>
                    <td className="num">{fmt(report.total.baseAmount)}</td>
                    {report.components.map((c) => (
                      <td key={c.code} className="num">{fmt(c.total)}</td>
                    ))}
                    <td className="num">{fmt(report.total.gross)}</td>
                    <td className="num">{fmt(report.total.sso)}</td>
                    <td className="num">{fmt(report.total.wht)}</td>
                    <td className="num">{fmt(report.total.net)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
