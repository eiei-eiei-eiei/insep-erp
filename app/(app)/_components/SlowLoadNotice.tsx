"use client";

import { useEffect, useState } from "react";
import { SLOW_LOAD_MS, SLOW_LOAD_TEXT } from "@/lib/shared/slowLoad";
import { signOut } from "../actions";

/**
 * ป้ายบนโครงหน้า "กำลังโหลด…" ที่ค้างเกิน SLOW_LOAD_MS (D135)
 * โครงหน้าถูกแทนที่เมื่อหน้าโหลดเสร็จ ⇒ ป้ายหายไปเองพร้อมกัน ไม่ต้องจัดการ
 */
export function SlowLoadNotice() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => clearTimeout(t);
  }, []);
  if (!slow) return null;
  return (
    <div role="alert" className="mb-4 rounded-lg border border-warn-line bg-warn-bg p-4 text-sm text-warn">
      <div className="font-semibold">⚠️ {SLOW_LOAD_TEXT.title}</div>
      <p className="mt-1">{SLOW_LOAD_TEXT.body}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg border border-line bg-card px-3 py-1.5 text-ink hover:bg-raised"
        >
          {SLOW_LOAD_TEXT.reload}
        </button>
        <form action={signOut}>
          <button type="submit" className="rounded-lg border border-line bg-card px-3 py-1.5 text-ink hover:bg-raised">
            {SLOW_LOAD_TEXT.signOut}
          </button>
        </form>
      </div>
    </div>
  );
}
