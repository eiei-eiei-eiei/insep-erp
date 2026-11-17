"use client";

/**
 * ตัวกันพลาดระดับหน้า (D173 เฟส 5) — mount ครั้งเดียวใน `app/(app)/layout.tsx`
 *
 *  1. `useUnsaved(dirty, label)` + `<PageGuards />` — เตือนก่อนออกจากหน้าตอนยังไม่ได้บันทึก
 *     · ปิดแท็บ / รีเฟรช → กล่องของเบราว์เซอร์ (`beforeunload` — ข้อความกำหนดเองไม่ได้)
 *     · กดลิงก์ในแอปไปหน้าอื่น → กล่องถามของเราเอง (Next เปลี่ยนหน้าโดยไม่ยิง beforeunload)
 *     🪤 ปุ่มย้อนกลับของเบราว์เซอร์ยังไม่ครอบ (App Router ไม่มีทางดักที่เชื่อถือได้)
 *     🚨 `dirty` ต้องคิดจาก state ที่ฟอร์มมีอยู่แล้ว (ตะกร้ามีของ · แถวที่กรอกแล้ว) —
 *        ห้ามตั้ง true ค้าง: เตือนทั้งที่ไม่มีอะไรหาย = ผู้ใช้เลิกอ่านคำเตือน
 *  2. กันล้อเมาส์เปลี่ยนค่าช่องตัวเลข — เลื่อนหน้าขณะเคอร์เซอร์อยู่ในช่อง `type=number`
 *     เบราว์เซอร์จะบวก/ลบค่าให้เงียบ ๆ ⇒ ปล่อยโฟกัสช่องนั้นก่อน (หน้าเลื่อนตามปกติ ค่าไม่ขยับ)
 *  3. `usePageTitle(parts)` — ชื่อแท็บเบราว์เซอร์
 */

import { useEffect, useId, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useConfirm } from "./ui";
import { leaveGuard, pageTitle, unsavedDetail } from "./pageGuards";

// ── ทะเบียนของที่ยังไม่บันทึก (ระดับโมดูล — ทุกฟอร์มในหน้าลงชื่อที่นี่) ──
const dirtyMap = new Map<string, string>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const snapshot = () => dirtyMap.size;

/** ฟอร์มบอกว่า "ตอนนี้มีของที่ยังไม่ได้บันทึก" — `label` = ชื่อที่ผู้ใช้รู้จัก (เช่น "บิลที่กำลังกรอก") */
export function useUnsaved(dirty: boolean, label: string) {
  const id = useId();
  useEffect(() => {
    if (!dirty) return;
    dirtyMap.set(id, label);
    emit();
    return () => { dirtyMap.delete(id); emit(); };
  }, [dirty, id, label]);
}

export function usePageTitle(parts: (string | null | undefined)[]) {
  const title = pageTitle(parts);
  useEffect(() => {
    document.title = title;
    // 🪤 Next ใส่ <title> จาก metadata ("PROOF") ตามมาทีหลังได้ (สตรีมหลัง effect รอบแรก)
    //    ⇒ เฝ้า <head> ไว้ ถ้าถูกเขียนทับให้ตั้งกลับ (ตั้งค่าเดิมซ้ำไม่ทำให้ observer วนเพราะเช็คก่อน)
    const obs = new MutationObserver(() => { if (document.title !== title) document.title = title; });
    obs.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => obs.disconnect();
  }, [title]);
}

export function PageGuards() {
  const router = useRouter();
  const { ask, confirmNode } = useConfirm();
  const count = useSyncExternalStore(subscribe, snapshot, () => 0);

  // ปิดแท็บ / รีเฟรช
  useEffect(() => {
    if (count === 0) return;
    const onBefore = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [count]);

  // กดลิงก์ในแอปไปหน้าอื่น
  useEffect(() => {
    if (count === 0) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const to = leaveGuard(
        {
          href: a.getAttribute("href"),
          target: a.getAttribute("target"),
          download: a.hasAttribute("download"),
          modified: e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey,
          origin: window.location.origin,
          pathname: window.location.pathname,
        },
        dirtyMap.size > 0,
      );
      if (!to) return;
      e.preventDefault();
      e.stopPropagation();
      void ask({
        title: "ออกจากหน้านี้โดยยังไม่บันทึก?",
        detail: unsavedDetail([...dirtyMap.values()]),
        confirmText: "ออกจากหน้านี้",
        cancelText: "อยู่ต่อ",
      }).then((ok) => {
        if (!ok) return;
        dirtyMap.clear();
        emit();
        router.push(to as Route);
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [count, ask, router]);

  // ล้อเมาส์บนช่องตัวเลขที่โฟกัสอยู่
  useEffect(() => {
    const onWheel = () => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement && el.type === "number") el.blur();
    };
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);

  return <>{confirmNode}</>;
}
