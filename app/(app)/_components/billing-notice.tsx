"use client";

import { useEffect, useState } from "react";
import { noticeLevel } from "@/lib/platform/billing";
import { formatDateThai } from "@/lib/shared/format";
import { IconAlert, IconClose } from "@/lib/shared/icons";

/**
 * แจ้งเตือนค่าบริการในแอปของลูกค้า (0037 · เฟส 2)
 *
 * บันได 3 ขั้น: **แถบเหลือง** (ใกล้ครบกำหนด) → **ป๊อปอัพแดง** (เลยกำหนด) → หน้า `/suspended` (ถูกระงับ)
 * ไม่ใช้ป๊อปอัพตั้งแต่ขั้นแรกโดยตั้งใจ — ลูกค้าที่จ่ายตรงทุกเดือนจะโดนขวางจอปีละ 12 ครั้ง
 * โดยไม่ได้ทำอะไรผิด ซึ่งกัดความรู้สึกสะสม
 *
 * 🚨 ข้อมูลที่เข้ามาถึงเบราว์เซอร์มีแค่ **วันครบกำหนด** (`tenants.billing_due_on` ที่ trigger มิเรอร์ไว้)
 *    — ไม่มีราคา ไม่มีชื่อแพ็กเกจ และ**ไม่ได้อ่านตาราง `subscriptions`** ซึ่งเป็น RLS deny-all
 * ★ ผู้เรียก (layout) กรองมาแล้วว่าเป็น role `main` เท่านั้น — พนักงานเห็นแล้วทำอะไรไม่ได้
 *   และเป็นเรื่องน่าอายของเจ้าของกิจการ
 */
export function BillingNotice({ dueOn, todayISO }: { dueOn: string | null; todayISO: string }) {
  const level = noticeLevel(dueOn, todayISO);

  // เริ่มที่ "ไม่แสดง" เสมอ แล้วค่อยเปิดใน effect — ฝั่ง server ไม่รู้จัก localStorage
  // ถ้า render ตั้งแต่รอบแรกจะ hydration mismatch
  const [show, setShow] = useState(false);
  const key = `billing-notice:${todayISO}`;

  useEffect(() => {
    if (level === "none") return;
    try {
      if (window.localStorage.getItem(key) !== "1") setShow(true);
    } catch {
      setShow(true); // เบราว์เซอร์บล็อก storage (โหมดส่วนตัวบางตัว) → ยอมให้ขึ้นทุกครั้ง ดีกว่าเงียบ
    }
  }, [key, level]);

  function dismiss() {
    setShow(false);
    try {
      window.localStorage.setItem(key, "1"); // คีย์ผูกกับวันที่ → พรุ่งนี้ขึ้นใหม่เอง
    } catch {
      /* ปิดไม่จำก็ไม่เป็นไร */
    }
  }

  if (!show || level === "none" || !dueOn) return null;

  const dateText = formatDateThai(dueOn);

  // ── เลยกำหนด: ป๊อปอัพ ──
  if (level === "overdue") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 p-4">
        <div className="w-full max-w-sm rounded-lg border border-crit-line bg-card p-5 shadow-lg">
          <div className="flex items-start gap-2">
            <IconAlert size={20} className="mt-0.5 shrink-0 text-crit" />
            <div>
              <h2 className="text-base font-bold text-crit">ค่าบริการเลยกำหนดชำระแล้ว</h2>
              <p className="mt-2 text-sm text-muted">
                ครบกำหนดเมื่อ <strong className="text-ink">{dateText}</strong> —
                กรุณาติดต่อผู้ดูแลระบบเพื่อชำระค่าบริการ
              </p>
              <p className="mt-2 text-xs text-faint">ถ้าโอนแล้วข้ามข้อความนี้ได้เลย</p>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="mt-5 min-h-[44px] w-full rounded bg-brand text-sm font-semibold text-on-brand transition hover:opacity-90 sm:py-2"
          >
            รับทราบ
          </button>
        </div>
      </div>
    );
  }

  // ── ใกล้ครบกำหนด: แถบ ──
  return (
    <div className="border-b border-warn-line bg-warn-bg">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 text-sm text-warn">
        <IconAlert size={16} className="shrink-0" />
        <span className="flex-1">
          ค่าบริการรอบถัดไปครบกำหนด <strong>{dateText}</strong> · ถ้าโอนแล้วข้ามข้อความนี้ได้เลย
        </span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="ปิดข้อความ"
          title="ปิดข้อความ"
          className="grid h-8 w-8 shrink-0 place-items-center rounded transition hover:bg-warn-line/30"
        >
          <IconClose size={16} />
        </button>
      </div>
    </div>
  );
}
