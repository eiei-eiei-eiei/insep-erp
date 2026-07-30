"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { SaveResult } from "../actions";

export function todayISO(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export function nowMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** จัดรูปแบบตัวเลข 2 ตำแหน่ง มีคอมม่า */
export function fmt(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? parseFloat(n.replace(/,/g, "")) : n;
  return (Math.round(((v as number) || 0) * 100) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** เลขประจำตัวผู้เสียภาษี 13 หลัก (ตัวเลขล้วน) — คืน digits ที่ clean แล้ว หรือ null ถ้าไม่ครบ 13 หลัก */
export function cleanTaxId13(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length === 13 ? d : null;
}

export function useSaver() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run(fn: () => Promise<SaveResult>, okText: string, onOk?: (data?: unknown) => void) {
    setMsg(null);
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        setMsg({ ok: true, text: okText });
        onOk?.(r.data);
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
    <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
      {msg.text}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
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
  return <input {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}
export function NumInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" step="any" {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

/**
 * ช่องกรอกตัวเลขที่พิมพ์ทศนิยมได้ลื่น (เก็บ buffer ข้อความระหว่างพิมพ์)
 * แก้บั๊ก `value={x || ""}` ที่พิมพ์ "0.03" ไม่ได้ (พอเป็น 0 React ลบจุดทศนิยมทิ้ง)
 * onChange คืน number หรือ "" (ช่องว่าง) · blankZero = แสดงว่างเมื่อค่าเป็น 0
 */
export function NumBox({
  value,
  onChange,
  blankZero = false,
  readOnly = false,
  placeholder,
  className,
}: {
  value: number | "";
  onChange?: (v: number | "") => void;
  blankZero?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const display = (v: number | "") => (v === "" || (v === 0 && blankZero) ? "" : String(v));
  const [raw, setRaw] = useState<string>(() => display(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setRaw(display(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, blankZero]);
  function handle(s: string) {
    if (s !== "" && !/^-?\d*\.?\d*$/.test(s)) return; // อนุญาตเฉพาะตัวเลข/จุด/ลบ
    setRaw(s);
    if (!onChange) return;
    if (s === "" || s === "-" || s === "." || s === "-.") { onChange(""); return; }
    const n = Number(s);
    if (!Number.isNaN(n)) onChange(n);
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      readOnly={readOnly}
      placeholder={placeholder}
      value={raw}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; setRaw(display(value)); }}
      onChange={(e) => handle(e.target.value)}
      className={`${inputCls} ${readOnly ? "cursor-default bg-slate-50 text-slate-500" : ""} ${className ?? ""}`}
    />
  );
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
      {pending ? "กำลังทำงาน…" : children}
    </button>
  );
}

export function Card({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-5 ${className ?? ""}`}>
      {title && <h2 className="mb-4 font-semibold text-slate-800">{title}</h2>}
      {children}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" | "slate" }) {
  const c = tone === "green" ? "text-green-600" : tone === "red" ? "text-red-600" : "text-slate-800";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${c}`}>{value}</div>
    </div>
  );
}
