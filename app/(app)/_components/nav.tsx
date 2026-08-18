"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Route } from "next";
import { signOut } from "../actions";
import { ROLE_LABEL, type Role, type Workspace } from "@/lib/shared/workspaces";
import { navSubItems } from "@/lib/shared/tabs";
import { WORKSPACE_ICON, IconLogout, IconChevronDown } from "@/lib/shared/icons";
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

  // รายการเมนู = workspace + ตั้งค่า (ถ้า main) — ใช้ทั้ง top (desktop) และ bottom-tab (มือถือ)
  // ★ "สำรอง" ไม่ใช่เมนูแยกแล้ว — กลายเป็นแท็บหนึ่งในหน้าตั้งค่า (D63)
  const items: { key: string; href: string; label: string }[] = [
    ...workspaces.map((w) => ({ key: w.key, href: w.href, label: w.label })),
    ...(role === "main" ? [{ key: "settings", href: "/settings", label: "ตั้งค่า" }] : []),
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
            {items.map((w) => (
              <NavItem
                key={w.key}
                item={w}
                role={role}
                active={isActive(w.href)}
                currentPath={pathname}
              />
            ))}
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

      {/* Bottom-tab — มือถือเท่านั้น
          ★ ไม่มีดร็อปดาวน์ที่นี่โดยตั้งใจ: เมนูเด้งขึ้นจากขอบล่างจะบังเนื้อหาที่กำลังกรอก
            และทุกหน้ามีแถบแท็บเลื่อนแนวนอนของตัวเองอยู่แล้ว */}
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

/**
 * เมนู 1 ตัวบนแถบบน = ลิงก์ไปหน้าหลัก + ปุ่มลูกศรเปิดรายการแท็บย่อย
 *
 * ทำไมต้องมีดร็อปดาวน์: แต่ก่อนจะเข้าแท็บลึก ๆ (เช่น รายงานสรรพสามิต) ต้องกดเข้า workspace
 * ก่อนแล้วค่อยไล่หาแท็บ — 2 จังหวะทุกครั้ง · ตอนนี้กระโดดตรงได้จากทุกหน้า
 *
 * ★ เปิดด้วย "คลิก" ไม่ใช่ hover ล้วน — โน้ตบุ๊กจอสัมผัส/แท็บเล็ตไม่มี hover จริง กดแล้วจะไม่ติด
 */
function NavItem({
  item,
  role,
  active,
  currentPath,
}: {
  item: { key: string; href: string; label: string };
  role: Role;
  active: boolean;
  currentPath: string;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const Icon = WORKSPACE_ICON[item.key];
  const subs = navSubItems(item.key, role);

  // ปิดเมื่อคลิกนอกกล่อง หรือกด Esc (ไม่งั้นเมนูค้างคาจอเวลาเปลี่ยนใจ)
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // เปลี่ยนหน้าแล้วต้องปิดเอง (Link ไม่ unmount ตัวนี้)
  useEffect(() => { setOpen(false); }, [currentPath]);

  const tone = active ? "bg-brand-soft text-brand" : "text-muted hover:bg-raised hover:text-ink";

  return (
    <div ref={boxRef} className="relative shrink-0">
      <div className={`flex items-center rounded-lg ${tone}`}>
        <Link
          href={item.href as Route}
          aria-current={active ? "page" : undefined}
          className="flex items-center gap-1.5 whitespace-nowrap py-1.5 pl-3 pr-1 text-sm font-medium"
        >
          {Icon && <Icon size={16} />}
          {item.label}
        </Link>
        {subs.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`แท็บย่อยของ${item.label}`}
            className="py-1.5 pl-0.5 pr-2"
          >
            <IconChevronDown size={14} className={open ? "rotate-180 transition" : "transition"} />
          </button>
        )}
      </div>

      {open && subs.length > 0 && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 min-w-[13rem] rounded-lg border border-line bg-card py-1 shadow-lg"
        >
          {subs.map((s) => (
            <Link
              key={s.href}
              href={s.href as Route}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-muted transition hover:bg-raised hover:text-ink"
            >
              {s.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
