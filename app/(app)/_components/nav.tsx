"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { signOut } from "../actions";
import { ROLE_LABEL, type Role, type Workspace } from "@/lib/shared/workspaces";
import { WORKSPACE_ICON, IconLogout } from "@/lib/shared/icons";
import type { Branding } from "@/lib/shared/branding";
import { ModeToggle } from "./ModeToggle";

export function Nav({
  workspaces,
  displayName,
  role,
  branding,
}: {
  workspaces: Workspace[];
  displayName: string;
  role: Role;
  branding: Branding;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  // รายการเมนู = workspace + ตั้งค่า/สำรอง (ถ้า main) — ใช้ทั้ง top (desktop) และ bottom-tab (มือถือ)
  const items: { key: string; href: string; label: string }[] = [
    ...workspaces.map((w) => ({ key: w.key, href: w.href, label: w.label })),
    ...(role === "main"
      ? [
          { key: "settings", href: "/settings/users", label: "ตั้งค่า" },
          { key: "data", href: "/settings/data", label: "สำรอง" },
        ]
      : []),
  ];

  const initials = displayName.trim().slice(0, 2);

  return (
    <>
      <header className="border-b border-line bg-nav">
        <div className="mx-auto flex max-w-6xl items-center gap-x-5 px-4 py-2.5">
          <Link href="/" className="flex shrink-0 items-center gap-2 text-ink">
            {branding.logoUrl ? (
              <Image src={branding.logoUrl} alt="" width={22} height={22} className="rounded" unoptimized />
            ) : (
              <span className="grid h-6 w-6 place-items-center rounded bg-brand text-[10px] font-bold text-on-brand">
                {branding.name.trim().slice(0, 1) || "I"}
              </span>
            )}
            <span className="text-[15px] font-bold tracking-tight">{branding.name}</span>
          </Link>

          {/* ลิงก์ workspace — เดสก์ท็อปเท่านั้น (มือถือใช้ bottom-tab ด้านล่าง) */}
          <nav className="hidden flex-1 gap-1 overflow-x-auto md:flex">
            {items.map((w) => {
              const Icon = WORKSPACE_ICON[w.key];
              const on = isActive(w.href);
              return (
                <Link
                  key={w.key}
                  href={w.href as Route}
                  aria-current={on ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    on ? "bg-brand-soft text-brand" : "text-muted hover:bg-raised hover:text-ink"
                  }`}
                >
                  {Icon && <Icon size={16} />}
                  {w.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2 text-sm md:ml-0">
            <span className="hidden items-center gap-2 sm:flex">
              <span className="grid h-6 w-6 place-items-center rounded bg-brand-soft text-[10px] font-bold text-brand">
                {initials}
              </span>
              <span className="text-muted">
                {displayName}
                <span className="ml-1 text-xs text-faint">{ROLE_LABEL[role]}</span>
              </span>
            </span>
            <ModeToggle tenantDefault={branding.defaultMode} />
            <form action={signOut}>
              <button
                type="submit"
                title="ออกจากระบบ"
                aria-label="ออกจากระบบ"
                className="grid h-9 w-9 place-items-center rounded-lg border border-line text-muted transition hover:bg-raised hover:text-ink"
              >
                <IconLogout size={17} />
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Bottom-tab — มือถือเท่านั้น */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-nav md:hidden">
        {items.map((w) => {
          const Icon = WORKSPACE_ICON[w.key];
          const on = isActive(w.href);
          return (
            <Link
              key={w.key}
              href={w.href as Route}
              aria-current={on ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium transition ${
                on ? "text-brand" : "text-faint"
              }`}
            >
              {Icon && <Icon size={19} />}
              {w.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
