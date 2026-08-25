"use client";

/**
 * UI primitives ที่ใช้ร่วมทั้ง 3 โดเมน (ผลิต/บัญชี/ขาย)
 *
 * เหตุผล: เดิมมี ui.tsx ก๊อปกัน 3 ชุด แล้ว drift จริง — บั๊กพิมพ์ทศนิยม (NumBox)
 * ถูกแก้ที่บัญชีที่เดียว ส่วนขาย/ผลิตยังเหลือ · ตรรกะที่ "ต้องเหมือนกันเสมอ"
 * (NumBox buffer, Combobox คีย์บอร์ด, useSaver, fmt) ย้ายมาอยู่ที่นี่ที่เดียว
 *
 * ★ สีทั้งหมดมาจาก token ใน app/globals.css เท่านั้น (D43)
 *   ห้ามเขียน bg-slate-800 / text-red-500 ตรง ๆ — ดู docs/DESIGN_SYSTEM.md
 */

import { useEffect, useRef, useState, useTransition } from "react";

export type SaveResultLike = { ok: boolean; error?: string; data?: unknown };

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
/**
 * ข้อความผลลัพธ์ท้ายฟอร์ม
 * · `ok: true`  = สำเร็จ (เขียว)
 * · `ok: false` = ล้มเหลว ไม่ได้บันทึกอะไร (แดง)
 * · `warn: true` = **บันทึกแล้วแต่มีบางส่วนไม่สำเร็จ** (เหลือง) — เช่น ลงบัญชีสำเร็จ
 *   แต่ forward วัตถุดิบเข้าสต็อกผลิตไม่ได้ · 🚨 เคสนี้ห้ามโชว์เขียวเด็ดขาด
 *   ผู้ใช้อ่านผ่านแล้วเข้าใจว่าครบ (D79)
 */
export type UiMsg = { ok: boolean; text: string; warn?: boolean };

export function useSaver<R extends SaveResultLike = SaveResultLike>() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<UiMsg | null>(null);

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
export function Msg({ msg }: { msg: UiMsg | null }) {
  if (!msg) return null;
  const tone = msg.warn
    ? "border-warn-line bg-warn-bg text-warn"
    : msg.ok
      ? "border-ok-line bg-ok-bg text-ok"
      : "border-crit-line bg-crit-bg text-crit";
  return (
    <div role="status" className={`mb-3 rounded-lg border px-3 py-2 text-sm ${tone}`}>
      {msg.text}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

export function Card({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-line bg-card p-4 sm:p-5 ${className ?? ""}`}>
      {title && <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-ink">{title}</h2>}
      {children}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" | "slate" }) {
  const c = tone === "green" ? "text-ok" : tone === "red" ? "text-crit" : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <div className="text-[10px] font-medium uppercase tracking-widest text-muted">{label}</div>
      <div className={`tnum mt-1 text-xl font-bold ${c}`}>{value}</div>
    </div>
  );
}

// ── inputs ───────────────────────────────────────────────────────────────────
const inputCls =
  "w-full rounded border border-line bg-input px-3 py-2 text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft";

export function TextInput({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${className}`} />;
}
export function NumInput({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" step="any" inputMode="decimal" {...props} className={`tnum ${inputCls} text-right ${className}`} />;
}
export function Select({ className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${className}`} />;
}
export function TextArea({ className = "", rows = 3, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} {...props} className={`${inputCls} ${className}`} />;
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
  onKeyDown,
}: {
  value: number | "";
  onChange?: (v: number | "") => void;
  blankZero?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
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
      className={`tnum ${inputCls} text-right ${readOnly ? "cursor-default bg-raised text-muted" : ""} ${className ?? ""}`}
    />
  );
}

/** dropdown พิมพ์ค้นหาได้ (combobox) — สำหรับรายการยาว เช่น ลูกค้า/คู่ค้าหลายราย */
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
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-card shadow-lg">
          {filtered.length === 0 && <div className="px-3 py-2 text-sm text-faint">ไม่พบ</div>}
          {filtered.map((o, i) => (
            <button
              key={o.value}
              type="button"
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(o.value)}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-raised ${i === hi ? "bg-raised" : ""} ${
                o.value === value ? "font-semibold text-brand" : "text-muted"
              }`}
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
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { pending?: boolean; pendingText?: string }) {
  return (
    <button
      {...rest}
      disabled={pending || rest.disabled}
      className={`min-h-[44px] rounded bg-brand px-5 text-sm font-semibold tracking-wide text-on-brand transition hover:opacity-90 disabled:opacity-50 sm:min-h-0 sm:py-2 ${className}`}
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
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "slate" | "green" | "red" | "brand" }) {
  const tones = {
    slate: "border-line text-muted hover:bg-raised hover:text-ink",
    green: "border-ok-line text-ok hover:bg-ok-bg",
    red: "border-crit-line text-crit hover:bg-crit-bg",
    brand: "border-brand-line text-brand hover:bg-brand-soft",
  };
  return (
    <button
      {...rest}
      className={`min-h-[44px] rounded border px-3 text-xs font-medium transition ${tones[tone]} disabled:opacity-50 sm:min-h-0 sm:py-1 ${className}`}
    />
  );
}

/** ปุ่มไอคอนล้วนในแถวตาราง (แก้/ลบ) — ต้องมี title เสมอ */
export function IconBtn({
  tone = "slate",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "slate" | "red" | "brand" }) {
  const tones = {
    slate: "text-muted hover:bg-raised hover:text-ink",
    red: "text-crit hover:bg-crit-bg",
    brand: "text-brand hover:bg-brand-soft",
  };
  return (
    <button
      {...rest}
      className={`grid h-8 w-8 place-items-center rounded transition ${tones[tone]} disabled:opacity-40 ${className}`}
    />
  );
}

/**
 * กล่องครอบตาราง — คุมการเลื่อนแนวนอนให้ตัวหน้าไม่เลื่อนตาม
 * ใช้คู่กับ <table className="tbl"> (สไตล์อยู่ใน globals.css layer components)
 *
 *   <TableWrap minWidth={620}>
 *     <table className="tbl">…</table>
 *   </TableWrap>
 */
export function TableWrap({
  children,
  minWidth,
  className = "",
}: {
  children: React.ReactNode;
  /** ความกว้างขั้นต่ำของตาราง (px) — ต่ำกว่านี้จะเลื่อนแนวนอนแทนบีบคอลัมน์ */
  minWidth?: number;
  className?: string;
}) {
  return (
    <div className={`-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 ${className}`}>
      <div style={minWidth ? { minWidth } : undefined}>{children}</div>
    </div>
  );
}

/** ข้อความเมื่อยังไม่มีข้อมูล — ใช้แทนการเขียน <p> เองทุกที่ */
export function Empty({ children = "— ยังไม่มีรายการ —" }: { children?: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-faint">{children}</p>;
}

/** ป้ายสถานะทั่วไป — ok/warn/crit/neutral/brand (สีสถานะล็อกตายทุกกิจการ) */
export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: "ok" | "warn" | "crit" | "neutral" | "brand";
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    ok: "border-ok-line bg-ok-bg text-ok",
    warn: "border-warn-line bg-warn-bg text-warn",
    crit: "border-crit-line bg-crit-bg text-crit",
    neutral: "border-line bg-raised text-muted",
    brand: "border-brand-line bg-brand-soft text-brand",
  };
  return (
    <span
      className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * ช่องพิมพ์อิสระ + รายการแนะนำ (datalist)
 *
 * ★ ต่างจาก `Combobox`: อันนี้ **พิมพ์ค่าใหม่ที่ไม่มีในรายการได้** — ใช้กับช่องที่ค่าที่ถูกต้อง
 *   ไม่ได้จำกัดอยู่แค่ที่มีในระบบ (หมวดรายจ่าย/ชื่อคู่ค้าที่อาจยังไม่เคยมี)
 *   แพตเทิร์นเดียวกับช่องหมวด/คู่ค้าในแท็บบันทึกของบัญชี
 */
export function SuggestInput({
  value,
  onChange,
  options,
  placeholder,
  listId,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  /** ต้องไม่ซ้ำกันในหน้าเดียว — datalist ผูกด้วย id */
  listId: string;
}) {
  return (
    <>
      <input
        className={inputCls}
        list={listId}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {options.map((o) => <option key={o} value={o} />)}
      </datalist>
    </>
  );
}

/**
 * กด Esc เพื่อปิดป๊อปอัพ — วางไว้**ในป๊อปอัพ** จะได้ผูก/ถอด listener ตามการเปิดปิดเอง
 *
 * 🚨 ใช้คู่กับพื้นหลังที่ปิดด้วย `onMouseDown` + เช็ค `e.target === e.currentTarget` เท่านั้น
 *    **ห้ามใช้ `onClick` ปิดพื้นหลัง** — ลากคลุมข้อความในช่องกรอกแล้วปล่อยเมาส์นอกช่อง
 *    เบราว์เซอร์จะยิง click ไปที่บรรพบุรุษร่วม (= พื้นหลัง) แล้วป๊อปอัพปิดเองกลางคัน
 */
export function EscToClose({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return null;
}
