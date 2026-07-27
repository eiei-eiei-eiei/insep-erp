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

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="text-lg font-bold text-slate-800">
          Insep&nbsp;ERP
        </Link>

        <nav className="flex flex-1 flex-wrap gap-1">
          {workspaces.map((w) => {
            const active =
              pathname === w.href || pathname.startsWith(w.href + "/");
            return (
              <Link
                key={w.key}
                href={w.href as Route}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? "bg-slate-800 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <span className="mr-1">{w.icon}</span>
                {w.label}
              </Link>
            );
          })}
          {role === "main" && (
            <Link
              href={"/settings/users" as Route}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                pathname.startsWith("/settings/users")
                  ? "bg-slate-800 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span className="mr-1">⚙️</span>
              ตั้งค่า
            </Link>
          )}
          {role === "main" && (
            <Link
              href={"/settings/data" as Route}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                pathname.startsWith("/settings/data")
                  ? "bg-slate-800 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span className="mr-1">💾</span>
              สำรองข้อมูล
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-3 text-sm">
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
              ออกจากระบบ
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
