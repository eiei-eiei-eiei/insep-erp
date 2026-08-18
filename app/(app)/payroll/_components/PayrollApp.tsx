"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { IconPeople } from "@/lib/shared/icons";
import { PAYROLL_TABS, labelFromSlug, slugFromLabel } from "@/lib/shared/tabs";
import { useTabUrl } from "../../_components/useTabUrl";
import type { EmployeeRow, PeriodRow } from "../data";
import type { getPayrollConfig } from "../data";
import { PeriodTab } from "./PeriodTab";
import { EmployeesTab } from "./EmployeesTab";
import { ConfigTab } from "./ConfigTab";

export type PayrollConfig = Awaited<ReturnType<typeof getPayrollConfig>>;

const TABS = PAYROLL_TABS.map((t) => t.label);
type Tab = string;

export function PayrollApp({
  config,
  employees,
  periods,
}: {
  config: PayrollConfig;
  employees: EmployeeRow[];
  periods: PeriodRow[];
}) {
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => labelFromSlug("payroll", sp.get("tab")) ?? "งวดจ่าย");
  useTabUrl("payroll", tab, setTab, (l) => slugFromLabel("payroll", l));

  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>([tab]));
  useEffect(() => { setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab))); }, [tab]);
  const show = (t: Tab) => (tab === t ? "" : "hidden");

  // ยังตั้งค่าไม่ครบ = คำนวณไม่ได้เลย → บอกให้ชัดตั้งแต่บนสุด แทนที่จะปล่อยให้ error ตอนกดบันทึก
  const missing: string[] = [];
  if (config.rates.length === 0) missing.push("ชุดอัตรา (ประกันสังคม/ภาษี)");
  if (config.components.length === 0) missing.push("รายการเพิ่ม/หัก");
  if (!config.accounts.pay) missing.push("บัญชีเงินที่ใช้จ่ายเงินเดือน");

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <IconPeople size={24} className="text-brand" />
        <h1 className="text-2xl font-bold text-ink">เงินเดือน</h1>
      </div>

      {missing.length > 0 && (
        <div className="mb-4 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">
          ยังตั้งค่าไม่ครบ: {missing.join(" · ")} — ไปที่แท็บ <b>ตั้งค่าการคำนวณ</b> ก่อนเริ่มใช้งาน
        </div>
      )}

      <div className="mb-5 -mx-4 flex gap-1 overflow-x-auto border-b border-line px-4">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`shrink-0 whitespace-nowrap rounded-t-lg px-4 py-2 text-sm font-medium transition ${
              tab === t ? "border-b-2 border-brand text-ink" : "text-faint hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {visited.has("งวดจ่าย") && (
        <div className={show("งวดจ่าย")}>
          <PeriodTab config={config} employees={employees} periods={periods} active={tab === "งวดจ่าย"} />
        </div>
      )}
      {visited.has("พนักงาน") && (
        <div className={show("พนักงาน")}>
          <EmployeesTab config={config} initial={employees} />
        </div>
      )}
      {visited.has("ตั้งค่าการคำนวณ") && (
        <div className={show("ตั้งค่าการคำนวณ")}>
          <ConfigTab config={config} />
        </div>
      )}
    </div>
  );
}
