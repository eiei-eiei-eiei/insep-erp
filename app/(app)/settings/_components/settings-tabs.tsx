"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import { SETTINGS_TABS } from "@/lib/shared/tabs";

/**
 * เมนูข้างของหน้าตั้งค่ากลาง (D173 เฟส 4b — หน้าตาแบบ ก) — เป็น **route จริง** ไม่ใช่ state
 * (ต่างจากแท็บในผลิต/บัญชี/ขายที่เป็น ?tab= เพราะหน้าพวกนั้นแชร์ข้อมูลก้อนเดียวกัน
 *  ส่วนตั้งค่าแต่ละหัวข้อดึงข้อมูลคนละชุด แยกเป็นหน้าจึงโหลดเฉพาะที่ใช้)
 *
 * · จอคอม: คอลัมน์ซ้าย (คลาสหน้าตาเดียวกับ `SettingsShell`) แต่แต่ละข้อเป็น `<Link>` ไป route เดิม
 * · จอเล็ก (< md): ดร็อปดาวน์ — เลือกแล้ว `router.push` ไป route เดิม
 *
 * ★ ต้องเป็น client component เพราะต้องรู้ว่ายืนอยู่หน้าไหน
 */
export function SettingsTabs({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const cur = SETTINGS_TABS.find((t) => isActive(t.href))?.href ?? "";

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[13rem_minmax(0,1fr)] md:items-start">
      {/* จอเล็ก: ดร็อปดาวน์ (ห้ามเป็นแถบเลื่อนแนวนอน) */}
      <div className="md:hidden">
        <select
          aria-label="หัวข้อตั้งค่า"
          value={cur}
          onChange={(e) => router.push(e.target.value as Route)}
          className="w-full rounded border border-line bg-input px-3 py-2 font-medium text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft"
        >
          {SETTINGS_TABS.map((t) => (
            <option key={t.href} value={t.href}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <nav aria-label="หัวข้อตั้งค่า" className="hidden rounded-lg border border-line bg-card p-1.5 md:sticky md:top-4 md:block">
        {SETTINGS_TABS.map((t) => {
          const on = isActive(t.href);
          return (
            <Link
              key={t.href}
              href={t.href as Route}
              aria-current={on ? "page" : undefined}
              className={`flex w-full items-center justify-between gap-2 rounded px-3 py-2 text-left text-sm transition ${
                on ? "bg-brand-soft font-medium text-brand" : "text-muted hover:bg-raised hover:text-ink"
              }`}
            >
              <span className="min-w-0 truncate">{t.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
