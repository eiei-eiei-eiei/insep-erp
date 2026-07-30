"use client";

import { useState, useTransition } from "react";
import type { SaveResult } from "../actions";

/** วันที่วันนี้รูปแบบ yyyy-MM-dd (เวลาเครื่องผู้ใช้) */
export function todayISO(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export function useSaver() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run(fn: () => Promise<SaveResult>, okText: string, onOk?: () => void) {
    setMsg(null);
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        setMsg({ ok: true, text: okText });
        onOk?.();
      } else {
        setMsg({ ok: false, text: r.error ?? "เกิดข้อผิดพลาด" });
      }
    });
  }
  return { pending, msg, run, setMsg };
}

export function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <div
      className={`mb-3 rounded-lg px-3 py-2 text-sm ${
        msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
      }`}
    >
      {msg.text}
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-slate-600">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={inputCls} />;
}

export function NumInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" step="any" inputMode="decimal" {...props} className={inputCls} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={inputCls} />;
}

export function SaveButton({
  pending,
  children = "บันทึก",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { pending?: boolean }) {
  return (
    <button
      {...rest}
      disabled={pending || rest.disabled}
      className="rounded-lg bg-slate-800 px-5 py-2 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
    >
      {pending ? "กำลังบันทึก…" : children}
    </button>
  );
}

export function Card({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      {title && (
        <h2 className="mb-4 font-semibold text-slate-800">{title}</h2>
      )}
      {children}
    </div>
  );
}
