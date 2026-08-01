"use client";

import { useEffect, useState } from "react";
import { IconMoon, IconSun } from "@/lib/shared/icons";
import { MODE_COOKIE, MODE_COOKIE_MAX_AGE } from "@/lib/shared/mode";
import type { ColorMode } from "@/lib/shared/branding";

/**
 * ปุ่มสลับโหมดสว่าง/มืด (D43)
 * เก็บที่ cookie ไม่ใช่ localStorage — เพื่อให้ server รู้ตั้งแต่ render แรก (ไม่กะพริบ)
 * สลับแล้วเปลี่ยน data-mode บน <html> ทันที ไม่ต้องรอโหลดหน้าใหม่
 */
export function ModeToggle({ tenantDefault }: { tenantDefault: ColorMode }) {
  const [mode, setMode] = useState<ColorMode>(tenantDefault);

  // ครั้งแรกที่เข้า (ยังไม่มี cookie) → ใช้ค่าเริ่มต้นของกิจการ แล้วจำไว้
  useEffect(() => {
    const current = document.documentElement.dataset.mode as ColorMode | undefined;
    const hasCookie = document.cookie.includes(`${MODE_COOKIE}=`);
    if (!hasCookie) {
      apply(tenantDefault);
      setMode(tenantDefault);
    } else if (current) {
      setMode(current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply(next: ColorMode) {
    document.documentElement.dataset.mode = next;
    document.cookie = `${MODE_COOKIE}=${next}; path=/; max-age=${MODE_COOKIE_MAX_AGE}; samesite=lax`;
  }

  function toggle() {
    const next: ColorMode = mode === "dark" ? "light" : "dark";
    setMode(next);
    apply(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={mode === "dark" ? "เปลี่ยนเป็นโหมดสว่าง" : "เปลี่ยนเป็นโหมดมืด"}
      aria-label={mode === "dark" ? "เปลี่ยนเป็นโหมดสว่าง" : "เปลี่ยนเป็นโหมดมืด"}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-muted transition hover:bg-raised hover:text-ink"
    >
      {mode === "dark" ? <IconSun size={17} /> : <IconMoon size={17} />}
    </button>
  );
}
