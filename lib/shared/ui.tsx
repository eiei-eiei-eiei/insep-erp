"use client";

/**
 * UI primitives ที่ใช้ร่วมทั้ง 3 โดเมน (ผลิต/บัญชี/ขาย)
 *
 * เหตุผล: เดิมมี ui.tsx ก๊อปกัน 3 ชุด แล้ว drift จริง — บั๊กพิมพ์ทศนิยม (NumBox)
 * ถูกแก้ที่บัญชีที่เดียว ส่วนขาย/ผลิตยังเหลือ · ตรรกะที่ "ต้องเหมือนกันเสมอ"
 * (NumBox buffer, Combobox คีย์บอร์ด, useSaver, fmt) ย้ายมาอยู่ที่นี่ที่เดียว
 * ต่างกันได้แค่สี accent — ไฟล์ ui.tsx ของแต่ละโดเมน re-export ต่อ (import เดิมไม่ต้องแก้)
 */

import { useEffect, useRef, useState, useTransition } from "react";

export type SaveResultLike = { ok: boolean; error?: string; data?: unknown };
export type Accent = "slate" | "amber";

// ── formatters ───────────────────────────────────────────────────────────────
/** วันที่วันนี้ yyyy-MM-dd ตามเวลาเครื่องผู้ใช้ (ชดเชย timezone offset ก่อน toISOString) */
export function todayISO(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export function nowMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** ตัวเลข 2 ตำแหน่ง มีคอมม่า (locale en-US โดยตั้งใจ — ตัวเลขเงินไทยใช้คอมม่าแบบเดียวกัน) */
export function fmt(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? parseFloat(n.replace(/,/g, "")) : n;
  return (Math.round(((v as number) || 0) * 100) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** ตัวเลขไม่มีทศนิยม (badge/สรุปสั้น) */
export function fmt0(n: number | null | undefined): string {
  return (Number(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: 0 });
}

/** เลขผู้เสียภาษี 13 หลัก — คืน digits ที่ clean แล้ว หรือ null ถ้าไม่ครบ 13 */
export function cleanTaxId13(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length === 13 ? d : null;
}

// ── state helper ─────────────────────────────────────────────────────────────
export function useSaver<R extends SaveResultLike = SaveResultLike>() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run(fn: () => Promise<R>, okText: string, onOk?: (data?: unknown) => void) {
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

// ── layout ───────────────────────────────────────────────────────────────────
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

// ── inputs ───────────────────────────────────────────────────────────────────
const INPUT_BASE = "w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 outline-none";
const FOCUS: Record<Accent, string> = {
  slate: "focus:border-slate-500 focus:ring-2 focus:ring-slate-200",
  amber: "focus:border-amber-500 focus:ring-2 focus:ring-amber-200",
};
export function inputCls(accent: Accent = "slate"): string {
  return `${INPUT_BASE} ${FOCUS[accent]}`;
}

type WithAccent = { accent?: Accent };

export function TextInput({ accent = "slate", className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement> & WithAccent) {
  return <input {...props} className={`${inputCls(accent)} ${className}`} />;
}
export function NumInput({ accent = "slate", className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement> & WithAccent) {
  return <input type="number" step="any" inputMode="decimal" {...props} className={`${inputCls(accent)} ${className}`} />;
}
export function Select({ accent = "slate", className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & WithAccent) {
  return <select {...props} className={`${inputCls(accent)} ${className}`} />;
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
  accent = "slate",
  onKeyDown,
}: {
  value: number | "";
  onChange?: (v: number | "") => void;
  blankZero?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  accent?: Accent;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
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
      onKeyDown={onKeyDown}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; setRaw(display(value)); }}
      onChange={(e) => handle(e.target.value)}
      className={`${inputCls(accent)} ${readOnly ? "cursor-default bg-slate-50 text-slate-500" : ""} ${className ?? ""}`}
    />
  );
}

/** dropdown พิมพ์ค้นหาได้ (combobox) — สำหรับรายการยาว เช่น ลูกค้า/คู่ค้าหลายราย */
export function Combobox({
  options,
  value,
  onChange,
  placeholder,
  accent = "slate",
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  accent?: Accent;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);
  const hover = accent === "amber" ? "hover:bg-amber-50" : "hover:bg-slate-50";
  const active = accent === "amber" ? "bg-amber-50" : "bg-slate-100";
  const picked = accent === "amber" ? "font-semibold text-amber-700" : "font-semibold text-slate-900";

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
        className={inputCls(accent)}
        value={open ? query : selected?.label ?? ""}
        placeholder={placeholder ?? "พิมพ์ค้นหา…"}
        onFocus={() => { setOpen(true); setQuery(""); setHi(0); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHi(0); }}
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
              className={`block w-full px-3 py-2 text-left text-sm ${i === hi ? active : ""} ${o.value === value ? picked : "text-slate-700"} ${hover}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── buttons ──────────────────────────────────────────────────────────────────
export function SaveButton({
  pending,
  pendingText = "กำลังทำงาน…",
  children = "บันทึก",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { pending?: boolean; pendingText?: string }) {
  return (
    <button
      {...rest}
      disabled={pending || rest.disabled}
      className="min-h-[44px] rounded-lg bg-slate-800 px-5 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50 sm:min-h-0 sm:py-2"
    >
      {pending ? pendingText : children}
    </button>
  );
}

/** ปุ่มเล็กในตาราง/การ์ด (แก้/ลบ/บันทึก) — touch target ≥ 44px บนจอเล็ก */
export function RowBtn({
  tone = "slate",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "slate" | "green" | "red" }) {
  const tones = {
    slate: "border-slate-300 text-slate-600 hover:bg-slate-50",
    green: "border-emerald-300 text-emerald-700 hover:bg-emerald-50",
    red: "border-red-200 text-red-600 hover:bg-red-50",
  };
  return (
    <button
      {...rest}
      className={`min-h-[44px] rounded border px-3 text-xs ${tones[tone]} disabled:opacity-50 sm:min-h-0 sm:py-1 ${className}`}
    />
  );
}
