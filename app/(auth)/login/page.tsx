"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <main className="flex min-h-screen items-center justify-center bg-raised p-4">
      <div className="w-full max-w-sm rounded-2xl bg-card p-8 shadow-lg">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-ink">Insep ERP</h1>
          <p className="mt-1 text-sm text-faint">ระบบภายในโรงกลั่นสุราคราฟต์</p>
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
      </div>
    </main>
  );
}
