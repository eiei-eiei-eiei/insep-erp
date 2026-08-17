"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";

/** แท็บของแอปจัดการหลังบ้าน — ต้องเป็น client component เพราะต้องรู้ว่ายืนอยู่หน้าไหน */
const TABS: { href: Route; label: string }[] = [
  { href: "/platform" as Route, label: "ลูกค้า" },
  { href: "/platform/billing" as Route, label: "ค่างวด" },
];

export function PlatformTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1">
      {TABS.map((t) => {
        // "/platform" ต้องเทียบเป๊ะ ไม่งั้นจะ active พร้อมกับหน้าลูกทุกหน้า
        const active = t.href === "/platform" ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`min-h-[44px] rounded px-3 text-sm font-medium leading-[44px] transition sm:min-h-0 sm:py-1.5 sm:leading-normal ${
              active ? "bg-brand-soft text-brand" : "text-muted hover:bg-raised hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
