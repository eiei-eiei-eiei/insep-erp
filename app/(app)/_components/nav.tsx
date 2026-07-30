"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { signOut } from "../actions";
import { ROLE_LABEL, type Role, type Workspace } from "@/lib/shared/workspaces";

export function Nav({
  workspaces,
  displayName,
  role,
}: {
  workspaces: Workspace[];
  displayName: string;
  role: Role;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  // รายการเมนู = workspace + ตั้งค่า/สำรอง (ถ้า main) — ใช้ทั้ง top (desktop) และ bottom-tab (มือถือ)
  const items: { key: string; href: string; icon: string; label: string }[] = [
    ...workspaces.map((w) => ({ key: w.key, href: w.href, icon: w.icon, label: w.label })),
    ...(role === "main"
      ? [
          { key: "settings", href: "/settings/users", icon: "⚙️", label: "ตั้งค่า" },
          { key: "data", href: "/settings/data", icon: "💾", label: "สำรอง" },
        ]
      : []),
  ];

  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-x-6 px-4 py-3">
          <Link href="/" className="text-lg font-bold text-slate-800">
            Insep&nbsp;ERP
          </Link>

          {/* ลิงก์ workspace — เดสก์ท็อปเท่านั้น (มือถือใช้ bottom-tab ด้านล่าง) */}
          <nav className="hidden flex-1 gap-1 overflow-x-auto md:flex">
            {items.map((w) => (
              <Link
                key={w.key}
                href={w.href as Route}
                className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  isActive(w.href) ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <span className="mr-1">{w.icon}</span>
                {w.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3 text-sm md:ml-0">
            <span className="text-slate-500">
              {displayName}
              <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                {ROLE_LABEL[role]}
              </span>
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-600 transition hover:bg-slate-100"
              >
                ออก
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Bottom-tab — มือถือเท่านั้น */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white md:hidden">
        {items.map((w) => (
          <Link
            key={w.key}
            href={w.href as Route}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition ${
              isActive(w.href) ? "text-slate-900" : "text-slate-400"
            }`}
          >
            <span className="text-lg leading-none">{w.icon}</span>
            {w.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
