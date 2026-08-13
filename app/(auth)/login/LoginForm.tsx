"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";
import { PRODUCT_NAME, PRODUCT_TAGLINE, type Branding } from "@/lib/shared/branding";

const initialState: LoginState = { error: null };

/**
 * ฟอร์มล็อกอิน (client) — ส่วนที่รู้ว่าเป็นลูกค้าเจ้าไหนถูกคำนวณมาจาก page.tsx (server)
 * เพราะต้องอ่าน header + query DB ก่อนล็อกอิน ซึ่งทำฝั่ง client ไม่ได้
 */
export default function LoginForm({
  branding,
  isTenant,
}: {
  branding: Branding;
  isTenant: boolean;
}) {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    // data-brand ต้องอยู่ตรงนี้ — หน้า login ไม่ผ่าน (app)/layout.tsx ที่ปกติเป็นคนตั้งให้
    // ไม่ใส่ = ดึงสีของลูกค้ามาแล้วไม่ได้ใช้ ทุกเจ้าเห็นสี steel เหมือนกันหมด
    <main
      data-brand={branding.color}
      className="flex min-h-screen items-center justify-center bg-raised p-4"
    >
      {/* overflow-hidden = แถบสีด้านบนโดนตัดมุมตามการ์ด ไม่โผล่ออกนอกโค้ง */}
      <div className="w-full max-w-sm overflow-hidden rounded-lg bg-card shadow-lg">
        {/* แถบสีแบรนด์ — ของหน้า login มีที่ใช้สีแบรนด์แค่ปุ่มกับกล่องตัวอักษร
            ลูกค้าเลยรู้สึกว่า "สีไม่เปลี่ยน" (ผู้ใช้เจอเองตอนเทส 2026-08-12)
            ★ ขึ้นเฉพาะตอนเป็นลูกค้า — ไม่มี subdomain ต้องเหมือนเดิมเป๊ะ (NEXT_STEPS ข้อ 2) */}
        {isTenant && <div className="h-2 bg-brand" />}

        <div className="p-8">
          <div className="mb-6 text-center">
            {isTenant && branding.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- โลโก้ลูกค้าเป็น URL ภายนอก ขนาดไม่แน่นอน
              <img
                src={branding.logoUrl}
                alt={branding.name}
                className="mx-auto mb-3 h-14 w-auto max-w-[200px] object-contain"
              />
            ) : isTenant ? (
              // ไม่มีโลโก้ = ตัวอักษรแรกในกล่องสีแบรนด์ (ดูตั้งใจ ไม่ได้ดูขาด — เหมือนแถบเมนู)
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-lg bg-brand text-2xl font-bold text-on-brand">
                {branding.name.trim().charAt(0) || "?"}
              </div>
            ) : null}

            <h1 className="text-2xl font-bold text-ink">{branding.name}</h1>
            {!isTenant && (
              <p className="mt-1 text-sm text-faint">{PRODUCT_TAGLINE}</p>
            )}
          </div>

          <form action={formAction} className="space-y-4">
            <div>
              <label
                htmlFor="username"
                className="mb-1 block text-sm font-medium text-muted"
              >
                ชื่อผู้ใช้
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                required
                className="w-full rounded-lg border border-line px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1 block text-sm font-medium text-muted"
              >
                รหัสผ่าน
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="w-full rounded-lg border border-line px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft"
              />
            </div>

            {state.error && (
              <p className="rounded-lg bg-crit-bg px-3 py-2 text-sm text-crit">
                {state.error}
              </p>
            )}

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-brand py-2.5 font-medium text-on-brand transition hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
            </button>
          </form>

          {/* co-brand: แบรนด์ลูกค้าเด่น ชื่อสินค้าเราเล็ก ๆ ด้านล่าง (มติ session 2026-08-11) */}
          {isTenant && (
            <p className="mt-6 text-center text-xs text-faint">
              powered by {PRODUCT_NAME}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
