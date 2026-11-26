"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { IconPeople } from "@/lib/shared/icons";
import { ModuleTabs, PageHeader } from "@/lib/shared/page";
import { tabsFor, labelFromSlug, slugFromLabel } from "@/lib/shared/tabs";
import type { Role } from "@/lib/shared/roles";
import { useTabUrl } from "../../_components/useTabUrl";
import type { EmployeeRow, PeriodRow } from "../data";
import type { getPayrollConfig } from "../data";
import { PeriodTab } from "./PeriodTab";
import { EmployeesTab } from "./EmployeesTab";
import { ConfigTab } from "./ConfigTab";
import { ReportTab } from "./ReportTab";
import { FilingTab } from "./FilingTab";

export type PayrollConfig = Awaited<ReturnType<typeof getPayrollConfig>>;

type Tab = string;

export function PayrollApp({
  config,
  employees,
  periods,
  role,
}: {
  config: PayrollConfig;
  employees: EmployeeRow[];
  periods: PeriodRow[];
  /** 🚨 ต้องรับมาจาก page — แท็บ "ตั้งค่าการคำนวณ" เปิดเฉพาะคนที่มี pay.config (D85) */
  role: Role;
}) {
  const sp = useSearchParams();
  const TABS = useMemo(() => tabsFor("payroll", role).map((t) => t.label), [role]);
  const [tab, setTab] = useState<Tab>(() => {
    const l = labelFromSlug("payroll", sp.get("tab"));
    return l && TABS.includes(l) ? l : TABS[0];
  });
  // 🚨 กันยัดแท็บที่ไม่มีสิทธิ์ผ่าน URL
  useTabUrl("payroll", tab, (l) => { if (TABS.includes(l)) setTab(l); }, (l) => slugFromLabel("payroll", l));

  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>([tab]));
  useEffect(() => { setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab))); }, [tab]);
  const show = (t: Tab) => (tab === t ? "" : "hidden");

  // ยังตั้งค่าไม่ครบ = คำนวณไม่ได้เลย → บอกให้ชัดตั้งแต่บนสุด แทนที่จะปล่อยให้ error ตอนกดบันทึก
  const missing: string[] = [];
  if (config.rates.length === 0) missing.push("ชุดอัตรา (ประกันสังคม/ภาษี)");
  if (config.legs.length === 0) missing.push("ขาลงบัญชี");
  if (!config.payAccount) missing.push("บัญชีเงินหลักที่ใช้จ่ายเงินเดือน");

  return (
    <div>
      <PageHeader icon={<IconPeople size={24} />} title="เงินเดือน" />

      {missing.length > 0 && (
        <div className="mb-4 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">
          ยังตั้งค่าไม่ครบ: {missing.join(" · ")} — ไปที่แท็บ <b>ตั้งค่าการคำนวณ</b> ก่อนเริ่มใช้งาน
        </div>
      )}

      <ModuleTabs tabs={TABS} active={tab} onPick={setTab} label="แท็บของเงินเดือน" />

      {visited.has("งวดจ่าย") && (
        <div className={show("งวดจ่าย")}>
          <PeriodTab config={config} employees={employees} periods={periods} active={tab === "งวดจ่าย"} />
        </div>
      )}
      {visited.has("รายงาน") && (
        <div className={show("รายงาน")}>
          <ReportTab active={tab === "รายงาน"} />
        </div>
      )}
      {visited.has("เอกสารยื่น") && (
        <div className={show("เอกสารยื่น")}>
          <FilingTab periods={periods} active={tab === "เอกสารยื่น"} />
        </div>
      )}
      {visited.has("พนักงาน") && (
        <div className={show("พนักงาน")}>
          <EmployeesTab config={config} initial={employees} />
        </div>
      )}
      {visited.has("ตั้งค่าการคำนวณ") && (
        <div className={show("ตั้งค่าการคำนวณ")}>
          <ConfigTab config={config} employees={employees} />
        </div>
      )}
    </div>
  );
}
