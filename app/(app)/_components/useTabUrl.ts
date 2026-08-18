"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { labelFromSlug } from "@/lib/shared/tabs";

/**
 * ผูกแท็บของ workspace เข้ากับ `?tab=<slug>` บน URL
 *
 * ทำไมต้องมี: แท็บเคยเป็น `useState` ล้วน → แถบเมนูด้านบนลิงก์เข้าแท็บตรง ๆ ไม่ได้
 * กด refresh แล้วเด้งกลับแท็บแรก และส่งลิงก์ "หน้านี้" ให้กันไม่ได้
 *
 * ทำ 2 ทาง:
 *  1. URL เปลี่ยน (ผู้ใช้กดจากดร็อปดาวน์) → setTab ตาม
 *  2. ผู้ใช้กดแท็บในหน้า → เขียน URL ตาม
 *
 * 🪤 ข้อ 2 ใช้ `history.replaceState` **ไม่ใช่ router.replace** โดยตั้งใจ —
 *    router.replace ยิง RSC request ใหม่ทุกครั้งที่สลับแท็บ ทั้งที่ข้อมูลของหน้าไม่ได้เปลี่ยนเลย
 *    (แท็บทุกตัว mount ค้างไว้อยู่แล้ว การรีเฟรชฝั่ง server จึงเสียเปล่า 100%)
 * 🪤 และไม่ push เข้า history — ไม่งั้นกดปุ่ม back ของเบราว์เซอร์จะต้องย้อนทีละแท็บ
 *    กว่าจะออกจากหน้าได้
 */
export function useTabUrl(
  workspaceKey: string,
  tab: string,
  setTab: (t: string) => void,
  toSlug: (label: string) => string,
) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const urlSlug = sp.get("tab");

  // ★ ต้องจำ slug ล่าสุดที่ "เราเขียนเอง" ไว้ ไม่งั้น effect ทั้งสองจะไล่ตีกันไปมา
  const written = useRef<string | null>(null);

  // 1) URL → state
  useEffect(() => {
    const label = labelFromSlug(workspaceKey, urlSlug);
    if (label) setTab(label);
    // setTab เป็น setState ที่ identity คงที่ · ตั้งใจไม่ใส่ใน deps เพื่อไม่ให้ยิงรอบเกิน
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSlug, workspaceKey]);

  // 2) state → URL
  useEffect(() => {
    const slug = toSlug(tab);
    if (!slug || slug === urlSlug || slug === written.current) return;
    written.current = slug;
    const params = new URLSearchParams(Array.from(sp.entries()));
    params.set("tab", slug);
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, pathname]);
}
