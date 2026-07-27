"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { SaveResult } from "../actions";

/** ตัวเลข 2 ตำแหน่ง มีคอมม่า */
export function fmt(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? parseFloat(n.replace(/,/g, "")) : n;
  return (Math.round(((v as number) || 0) * 100) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** ตัวเลขไม่มีทศนิยม (สำหรับ badge/สรุปสั้น) */
export function fmt0(n: number | null | undefined): string {
  return (Number(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: 0 });
}

export function todayISO(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
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

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}
export function NumInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" step="any" {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

export function Card({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-5 ${className ?? ""}`}>
      {title && <h2 className="mb-4 font-semibold text-slate-800">{title}</h2>}
      {children}
    </div>
  );
}

/** dropdown พิมพ์ค้นหาได้ (combobox) — สำหรับรายการยาว เช่น ลูกค้าหลายราย */
export function Combobox({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)) : options;

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="relative" ref={ref}>
      <input
        className={inputCls}
        value={open ? query : selected?.label ?? ""}
        placeholder={placeholder ?? "พิมพ์ค้นหา…"}
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setHi(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && open && filtered[hi]) {
            e.preventDefault();
            pick(filtered[hi].value);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {filtered.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">ไม่พบ</div>}
          {filtered.map((o, i) => (
            <button
              key={o.value}
              type="button"
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(o.value)}
              className={`block w-full px-3 py-2 text-left text-sm ${i === hi ? "bg-amber-50" : ""} ${o.value === value ? "font-semibold text-amber-700" : "text-slate-700"} hover:bg-amber-50`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** ป้ายสถานะออเดอร์ (สีตามสถานะเดิม) */
export function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "รอคอนเฟิร์ม"
      ? "bg-yellow-100 text-yellow-700"
      : status === "รอคลังจัดส่ง"
        ? "bg-orange-100 text-orange-700"
        : status === "ปิดการขาย"
          ? "bg-green-100 text-green-700"
          : status === "ยกเลิก"
            ? "bg-slate-200 text-slate-500"
            : "bg-blue-100 text-blue-700";
  return <span className={`inline-block rounded px-2 py-1 text-[10px] font-bold leading-tight ${cls}`}>{status}</span>;
}
