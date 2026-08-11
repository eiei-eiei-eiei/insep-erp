"use client";

import { useActionState } from "react";
import { changePassword, type ChangePwState } from "./actions";
import { PASSWORD_MIN } from "@/lib/shared/password";

const initialState: ChangePwState = { error: null };

/**
 * หน้าเปลี่ยนรหัสผ่าน — ผู้ใช้ที่ยังใช้รหัสที่คนอื่นตั้งให้จะถูกส่งมาที่นี่
 * โดย (app)/layout.tsx ก่อนเข้าหน้าใด ๆ ในแอป
 *
 * อยู่นอกกลุ่ม (app) โดยตั้งใจ — ถ้าอยู่ข้างในจะโดน layout เด้งกลับมาที่นี่ไม่รู้จบ
 */
export default function ChangePasswordPage() {
  const [state, formAction, pending] = useActionState(changePassword, initialState);

  return (
    <main className="flex min-h-screen items-center justify-center bg-raised p-4">
      <div className="w-full max-w-sm rounded-lg bg-card p-8 shadow-lg">
        <h1 className="text-xl font-bold text-ink">ตั้งรหัสผ่านใหม่</h1>
        <p className="mt-2 text-sm text-muted">
          บัญชีนี้ยังใช้รหัสที่คนอื่นตั้งให้ กรุณาตั้งรหัสของคุณเองก่อนเริ่มใช้งาน
        </p>

        <form action={formAction} className="mt-5 space-y-4">
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-muted">
              รหัสผ่านใหม่
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN}
              className="w-full rounded-lg border border-line px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft"
            />
            <p className="mt-1 text-xs text-faint">
              อย่างน้อย {PASSWORD_MIN} ตัวอักษร · ไม่ใช่ตัวเลขล้วน · ไม่มีชื่อผู้ใช้อยู่ข้างใน
            </p>
          </div>

          <div>
            <label htmlFor="confirm" className="mb-1 block text-sm font-medium text-muted">
              พิมพ์รหัสผ่านใหม่อีกครั้ง
            </label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN}
              className="w-full rounded-lg border border-line px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft"
            />
          </div>

          {state.error && (
            <p className="rounded-lg bg-crit-bg px-3 py-2 text-sm text-crit">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-brand py-2.5 font-medium text-on-brand transition hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "กำลังบันทึก…" : "บันทึกรหัสผ่านใหม่"}
          </button>
        </form>
      </div>
    </main>
  );
}
