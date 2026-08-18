"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { SETTINGS_TABS } from "@/lib/shared/tabs";

/**
 * แท็บของหน้าตั้งค่ากลาง — เป็น **route จริง** ไม่ใช่ state
 * (ต่างจากแท็บในผลิต/บัญชี/ขายที่เป็น ?tab= เพราะหน้าพวกนั้นแชร์ข้อมูลก้อนเดียวกัน
 *  ส่วนตั้งค่าแต่ละแท็บดึงข้อมูลคนละชุด แยกเป็นหน้าจึงโหลดเฉพาะที่ใช้)
 *
 * ★ ต้องเป็น client component เพราะต้องรู้ว่ายืนอยู่หน้าไหน
 */
export function SettingsTabs() {
  const pathname = usePathname();

  return (
    <nav className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4">
      {SETTINGS_TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href as Route}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 whitespace-nowrap rounded-t-lg px-4 py-2 text-sm font-medium transition ${
              active ? "border-b-2 border-brand text-ink" : "text-faint hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
