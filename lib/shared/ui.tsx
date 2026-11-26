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

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useTransition } from "react";
import { showToast } from "./toast";

import { missingText, type FieldCheck } from "./forms";
import { comboKey } from "./keyboard";
import { Modal, ModalCancel } from "./modal";
import { Help } from "./help";
import { BTN_BASE, BTN_SIZE, BTN_TONE } from "./page";
import { floatPlace, type FloatStyle } from "./floatPlace";

export { Modal, ModalCancel, type ModalProps } from "./modal";
export { Help, type HelpProps } from "./help";

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

/**
 * ★ D134 — ทุกข้อความที่ผ่าน `run()` / `setMsg()` **ขึ้นเป็นป้ายลอยบนกลางจอ** (`showToast`)
 *   ไม่มีแถบในการ์ดแล้ว (ผู้ใช้สั่ง: แถบเขียว "บันทึกแล้ว" ค้างในการ์ดทั้งที่เริ่มกรอกต่อแล้ว
 *   และเลื่อนจอไปที่อื่นก็มองไม่เห็น) · `msg` ยังคืนให้เผื่อผู้เรียกใช้ตัดสินอย่างอื่น แต่ห้ามวาดลงการ์ด
 */
export function useSaver<R extends SaveResultLike = SaveResultLike>() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsgState] = useState<UiMsg | null>(null);
  // onOk ตั้งข้อความเองไหม (เช่น เหลือง "บันทึกได้บางส่วน") — ถ้าตั้ง ไม่ต้องขึ้นป้ายเขียวซ้อน
  const overridden = useRef(false);
  const setMsg = useCallback((m: UiMsg | null) => {
    setMsgState(m);
    if (m) {
      overridden.current = true;
      showToast(m);
    }
  }, []);

  function run(fn: () => Promise<R>, okText: string, onOk?: (data?: unknown) => void) {
    setMsg(null);
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        // 🪤 D134 — เดิมตั้งเขียวก่อนแล้ว onOk ทับด้วยเหลืองบนแถบเดียวกัน (เห็นแค่อันหลัง)
        //    พอเป็นป้ายลอย สองข้อความจะขึ้นคู่กัน "สำเร็จ" กับ "สำเร็จบางส่วน" ขัดกันเอง
        //    ⇒ เรียก onOk ก่อน แล้วขึ้นเขียวเฉพาะเมื่อ onOk ไม่ได้ตั้งข้อความเอง
        overridden.current = false;
        onOk?.(r.data);
        if (!overridden.current) setMsg({ ok: true, text: okText });
      } else {
        setMsg({ ok: false, text: r.error ?? "เกิดข้อผิดพลาด" });
      }
    });
  }
  return { pending, msg, run, setMsg };
}

// ── โหลดข้อมูลเข้าแท็บ (D89) ─────────────────────────────────────────────────
/**
 * ดึงข้อมูลเข้าแท็บพร้อม **ที่รับ error** — แทนแพตเทิร์น `action().then(setRows)` ที่ไม่มี `.catch`
 *
 * 🚨 ทำไมต้องมี: ชั้นอ่านถูกเปลี่ยนให้ `throw` เมื่อ query พัง (ดู `mustRead`) —
 *    ถ้าผู้เรียกไม่มี `.catch` จะกลายเป็น unhandled rejection แล้ว `setLoading(false)`
 *    ไม่ทำงาน = **ค้างที่ "กำลังโหลด…" ตลอดกาล ซึ่งแย่กว่าลิสต์ว่างเดิม**
 *
 * ★ เก็บข้อมูลก้อนล่าสุดไว้ **ไม่ล้างทิ้งตอน error** — คนที่กำลังดูอยู่ต้องไม่เสียของ
 * ★ `loading` เป็น true เฉพาะครั้งแรก · รอบถัดไปโชว์ของเดิมค้างระหว่างโหลด (พฤติกรรมเดิมของทุกแท็บ)
 * 🪤 Next.js ปิดบังข้อความ error ของ server action ใน production (เหลือแต่ digest)
 *    → `<LoadError>` จึงแสดงข้อความไทยของเราเอง ไม่พยายามโชว์ข้อความจากเซิร์ฟเวอร์
 */
export function useRead<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  opts: { skip?: boolean } = {},
): { data: T | null; loading: boolean; refreshing: boolean; err: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  // D181 — กำลังโหลดรอบถัดไปโดยที่ข้อมูลเก่ายังโชว์อยู่ · ไม่บอก = ผู้ใช้เห็นตารางเก่า/"ไม่มีรายการ"
  //   ระหว่างรอ แล้วสรุปว่าบันทึกไม่เข้า ทั้งที่อีกไม่กี่วินาทีข้อมูลใหม่ก็มา
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState(false);
  const [tick, setTick] = useState(0);
  const first = useRef(true);
  const skip = opts.skip ?? false;
  // fetcher เป็น arrow ใหม่ทุก render — ผูก effect กับ deps ที่ผู้เรียกระบุเท่านั้น
  const fnRef = useRef(fetcher);
  fnRef.current = fetcher;

  useEffect(() => {
    if (skip) return;
    let alive = true; // กัน race ตอนสลับ deps เร็ว ๆ (แพตเทิร์นเดิมของทุกแท็บ)
    if (first.current) setLoading(true);
    else setRefreshing(true);
    setErr(false);
    fnRef
      .current()
      .then((r) => {
        if (!alive) return;
        setData(r);
        setLoading(false);
        setRefreshing(false);
        first.current = false;
      })
      .catch(() => {
        if (!alive) return;
        setErr(true);
        setLoading(false); // 🚨 ต้องจบสถานะโหลดเสมอ ไม่งั้นค้าง "กำลังโหลด…"
        setRefreshing(false);
        first.current = false;
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, skip, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, loading, refreshing, err, reload };
}

/** แถบแดง "โหลดไม่สำเร็จ" + ปุ่มลองใหม่ — ไม่ขึ้นอะไรเลยเมื่อไม่มี error */
export function LoadError({ err, onRetry, what }: { err: boolean; onRetry?: () => void; what?: string }) {
  if (!err) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-crit-line bg-crit-bg px-3 py-2 text-sm text-crit">
      <span>
        โหลด{what ?? "ข้อมูล"}ไม่สำเร็จ — <b>ตัวเลขที่เห็นอาจไม่ครบ</b> อย่าเพิ่งใช้ตัดสินใจหรือยื่นเอกสาร
      </span>
      {onRetry && (
        <button onClick={onRetry} className="ml-auto rounded border border-crit-line px-3 py-1 font-medium hover:bg-crit-bg">
          ลองใหม่
        </button>
      )}
    </div>
  );
}

// ── layout ───────────────────────────────────────────────────────────────────
/*
 * ★ D134 — `<Msg>` (แถบผลลัพธ์ในการ์ด) ถูกลบแล้ว · ผลการบันทึกขึ้นเป็นป้ายลอยผ่าน `useSaver` / `showToast`
 *   🚨 อย่าเอาแถบในการ์ดกลับมา — ผู้ใช้สั่งเอาออกเอง (ค้างทั้งที่เริ่มงานถัดไปแล้ว)
 */

/**
 * `help` = คำอธิบายที่ซ่อนอยู่หลังปุ่ม ⓘ ข้างป้าย (D173) — แทนโน้ตตัวเล็กใต้ช่อง
 * 🚨 คำเตือนเงิน/ภาษี/ราชการ และข้อความตามสถานะ ห้ามใส่ที่นี่ (DESIGN_SYSTEM "คำอธิบาย ⓘ")
 */
export function Field({ label, help, children }: { label: string; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted">
        {label}
        {help && <Help>{help}</Help>}
      </span>
      {children}
    </label>
  );
}

export function Card({
  title, help, children, className,
}: { title?: string; help?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-line bg-card p-4 sm:p-5 ${className ?? ""}`}>
      {title && (
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-ink">
          {title}
          {help && <Help>{help}</Help>}
        </h2>
      )}
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
/**
 * 🪤 **`w-full` ตัวนี้ชนะ `className` ที่ส่งเข้ามาเสมอ — อย่าส่ง `w-*` มาให้ช่องกรอกโดยตรง**
 *
 * Tailwind ตัดสินว่าใครชนะจาก **ลำดับใน CSS ที่ generate ออกมา** ไม่ใช่ลำดับในสตริง class
 * ⇒ `<NumBox className="w-24" />` ได้ผลลัพธ์เป็น `width: 100%` เงียบ ๆ ไม่มี error ไม่มี warning
 *
 * 🐛 เจอตอน D96: แถวสูตรในป๊อปอัพ "เมนูใหม่" ตกบรรทัดละช่อง เพราะทั้ง `<Select>` และ
 *    `<NumBox className="w-24">` กลายเป็นเต็มความกว้างทั้งคู่
 *    ★ ไล่ดูแล้วมี **~30 จุดในโมดูลอื่น** ที่เขียนความกว้างไว้แล้วไม่เคยมีผลเลยเหมือนกัน
 *      (ยังไม่แก้ในรอบนี้ — ดู `docs/NEXT_STEPS.md` เพราะการแก้จะขยับหน้าจอที่ผู้ใช้เทสผ่านแล้ว)
 *
 * ✅ วิธีที่ได้ผล — ครอบด้วย div (แพตเทิร์นที่หน้าบัญชีใช้อยู่แล้ว):
 *      <div className="w-24"><NumBox … /></div>
 */
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

/**
 * D185 — ตำแหน่งรายการลอยแบบ fixed ตามช่อง (พ้นกรอบ `overflow-x-auto` ของตาราง)
 * ★ ตามช่องเมื่อหน้า/กรอบใดก็ตามเลื่อน (scroll แบบ capture = ทุกกล่องเลื่อน) และเมื่อจอเปลี่ยนขนาด
 * ★ ไม่ใช้ portal — รายการยังอยู่ใต้ช่องใน DOM ⇒ เช็ค "กดนอกช่อง" / โฟกัสออก / ป๊อปอัพครอบ ทำงานเหมือนเดิม
 *   (`Modal` ไม่มี transform จึง fixed อ้างกับจอจริง)
 */
function useFloat(anchor: React.RefObject<HTMLElement | null>, open: boolean): FloatStyle | null {
  const [st, setSt] = useState<FloatStyle | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchor.current;
      if (el) setSt(floatPlace(el.getBoundingClientRect(), window.innerHeight, window.innerWidth));
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchor]);
  return open ? st : null;
}
const floatCls = "fixed z-50 overflow-y-auto rounded-lg border border-line bg-card shadow-lg";

/**
 * dropdown พิมพ์ค้นหาได้ (combobox) — สำหรับรายการยาว เช่น ลูกค้า/คู่ค้าหลายราย
 * ★ D185 — ใช้ในแถวตารางได้แล้ว (รายการลอยพ้นกรอบเลื่อนของตาราง) · `emptyLabel` = มีทางล้างค่ากลับเป็นว่าง
 *
 * คีย์บอร์ด (กติกาอยู่ที่ `comboKey` ใน keyboard.ts · มีเทสคุม):
 *   พิมพ์ = กรอง · ↓ ↑ เลื่อนไฮไลต์ (รายการเลื่อนตาม) · Enter = เลือกแล้วอยู่ช่องเดิม ·
 *   Tab = เลือกแล้วไปช่องถัดไป (เฉพาะเมื่อพิมพ์/กดลูกศรแล้ว) · Esc = ปิดรายการ
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder,
  autoFocus,
  emptyLabel,
  className,
  inputAttrs,
  ...aria
}: {
  /** แอตทริบิวต์เพิ่มของช่อง เช่น `{ "data-item-first": "" }` (หน้าบันทึกบิลหาช่องแรกของแถวใหม่ด้วยตัวนี้) */
  inputAttrs?: Record<`data-${string}`, string>;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** ให้ป๊อปอัพ (`Modal`) วางเคอร์เซอร์ที่ช่องนี้ตอนเปิด */
  autoFocus?: boolean;
  /** ใส่ = มีรายการแรกไว้ล้างค่ากลับเป็นว่าง (เช่น "— ไม่ระบุ —") */
  emptyLabel?: string;
  /** คลาสเพิ่มของช่อง (เช่นความกว้างในแถวตาราง) */
  className?: string;
  /** ช่องในแถวตารางไม่มีป้าย — ต้องบอกโปรแกรมอ่านหน้าจอว่าช่องอะไร */
  "aria-label"?: string;
}) {
  options = emptyLabel !== undefined ? [{ value: "", label: emptyLabel }, ...options] : options;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  // ผู้ใช้พิมพ์ค้นหรือกดลูกศรไปแล้ว — Tab จะเลือกให้เฉพาะกรณีนี้ (ไม่งั้น Tab ผ่านช่องเฉย ๆ ค่าเปลี่ยนเอง)
  const [touched, setTouched] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const float = useFloat(inputRef, open);
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

  // รายการยาวกว่ากรอบ — เลื่อนให้เห็นตัวที่ไฮไลต์เสมอ (เดิมกดลูกศรลงแล้วไฮไลต์หายใต้ขอบ)
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi, open]);

  function openList() {
    setOpen(true);
    setQuery("");
    setTouched(false);
    // เปิดมาให้ไฮไลต์อยู่ที่ค่าที่เลือกไว้ — กดลูกศรต่อจากตรงนั้นได้เลย
    setHi(Math.max(0, options.findIndex((o) => o.value === value)));
  }
  function close() {
    setOpen(false);
    setQuery("");
    setTouched(false);
  }
  function pick(v: string) {
    onChange(v);
    close();
  }

  return (
    <div
      className="relative"
      ref={ref}
      onBlur={(e) => {
        // โฟกัสออกจากช่องนี้ (เช่น กด Tab) = ปิดรายการ · เดิมค้างเปิดบังช่องถัดไป
        if (!ref.current?.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <input
        {...inputAttrs}
        ref={inputRef}
        aria-label={aria["aria-label"]}
        className={`${inputCls} ${className ?? ""}`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[hi] ? `${listId}-${hi}` : undefined}
        autoComplete="off"
        data-autofocus={autoFocus ? "" : undefined}
        value={open ? query : selected && selected.value !== "" ? selected.label : ""}
        placeholder={open && selected ? selected.label : placeholder ?? "พิมพ์ค้นหา…"}
        onFocus={openList}
        onMouseDown={() => { if (!open) openList(); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHi(0); setTouched(true); }}
        onKeyDown={(e) => {
          const act = comboKey(e.key, { open, hi, count: filtered.length, touched });
          if (!act) return;
          if (act.type === "open") {
            e.preventDefault();
            openList();
          } else if (act.type === "move") {
            e.preventDefault();
            setHi(act.hi);
            setTouched(true);
          } else if (act.type === "pick") {
            // Enter: อยู่ช่องเดิม (กันฟอร์ม/ป๊อปอัพรับ Enter ไปบันทึก) · Tab: ปล่อยให้โฟกัสเดินต่อ
            if (act.stay) e.preventDefault();
            pick(filtered[act.index].value);
          } else {
            // Esc ปิดแค่รายการ — ไม่ให้ไหลไปปิดป๊อปอัพที่ครอบอยู่
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); }
            close();
          }
        }}
      />
      {open && float && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          style={float}
          className={floatCls}
        >
          {filtered.length === 0 && <div className="px-3 py-2 text-sm text-faint">ไม่พบ</div>}
          {filtered.map((o, i) => (
            <button
              key={o.value}
              id={`${listId}-${i}`}
              data-i={i}
              type="button"
              role="option"
              aria-selected={o.value === value}
              tabIndex={-1}
              // กดเมาส์ที่รายการต้องไม่ดึงโฟกัสออกจากช่องพิมพ์ (ไม่งั้น onBlur ปิดรายการก่อน click ทำงาน)
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(o.value)}
              className={`block min-h-[44px] w-full px-3 py-2 text-left text-sm sm:min-h-0 ${i === hi ? "bg-raised" : ""} ${
                o.value === value ? "font-semibold text-brand" : "text-ink"
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

/**
 * ช่องพิมพ์อิสระ + รายการแนะนำ (D185) — แทน `<input list=…>` + `<datalist>` ของเบราว์เซอร์
 *
 * 🪤 datalist เดิม: หน้าตาวาดโดยเบราว์เซอร์ (ไม่ตามธีม/โหมดมืด) · มือถือแต่ละรุ่นโชว์ต่างกัน (D110) ·
 *    คีย์บอร์ดไม่เหมือนช่องอื่นของแอป · ในแถวตารางบางเบราว์เซอร์โดนกรอบตัด
 * ★ D185 แทนตัวเดิมที่เป็น datalist (ชื่อ/props เดิม — ที่ใช้อยู่ 5 จุดได้หน้าตาใหม่เอง)
 * ★ ต่างจาก `Combobox`: **พิมพ์คำใหม่ที่ไม่มีในรายการได้** (ชื่อสินค้า/หมวด/งานใหม่) — ค่าคือข้อความที่พิมพ์
 * ★ คีย์บอร์ด: พิมพ์ = กรองรายการ (ยังไม่ไฮไลต์) · ↓ ↑ เลือกรายการ · Enter = ใช้รายการที่ไฮไลต์ ถ้ายังไม่ไฮไลต์
 *   Enter ไหลต่อ (หน้าบันทึกบิล = เพิ่มแถว) · Esc ปิดรายการ (ไม่ปิดป๊อปอัพที่ครอบ)
 * ★ `data-enter="own"` ติดมาเอง — Enter ในป๊อปอัพไม่ส่งฟอร์ม (เหมือนช่อง list= เดิม · modal.tsx)
 * ★ props อื่นของ `<input>` (เช่น `data-item-first`, placeholder) ส่งต่อให้ช่องตรง ๆ
 */
export function SuggestInput({
  value,
  onChange,
  options: suggestions,
  listId: _legacyListId,
  className,
  onKeyDown,
  onFocus,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "list"> & {
  value: string;
  onChange: (v: string) => void;
  /** รายการแนะนำ (ไม่บังคับเลือก) */
  options: readonly string[];
  /** ⚠️ เลิกใช้ — เดิมผูก `<datalist>` ด้วย id (D185 ไม่ใช้ datalist แล้ว) · รับไว้ให้ที่เรียกเดิมไม่ต้องแก้ */
  listId?: string;
}) {
  void _legacyListId;
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const float = useFloat(inputRef, open);

  const q = value.trim().toLowerCase();
  // ★ ตัดตัวที่ตรงเป๊ะกับที่พิมพ์ออก (ไม่มีอะไรให้เลือกเพิ่ม) · จำกัด 50 รายการ (ประวัติชื่อสินค้ามีเป็นพัน)
  const filtered = (q ? suggestions.filter((v) => v.toLowerCase().includes(q) && v.toLowerCase() !== q) : [...suggestions]).slice(0, 50);
  const show = open && float && filtered.length > 0;

  useEffect(() => {
    if (!show || hi < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi, show]);

  function close() { setOpen(false); setHi(-1); }
  function pick(v: string) { onChange(v); close(); }

  return (
    <div
      className="relative"
      ref={ref}
      onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node | null)) close(); }}
    >
      <input
        {...rest}
        ref={inputRef}
        className={`${inputCls} ${className ?? ""}`}
        role="combobox"
        aria-expanded={!!show}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={show && hi >= 0 ? `${listId}-${hi}` : undefined}
        autoComplete="off"
        data-enter="own"
        value={value}
        onFocus={(e) => { setOpen(true); setHi(-1); onFocus?.(e); }}
        onMouseDown={() => { if (!open) setOpen(true); }}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHi(-1); }}
        onKeyDown={(e) => {
          const act = comboKey(e.key, { open: !!show, hi, count: filtered.length, touched: hi >= 0 });
          if (act?.type === "open") { e.preventDefault(); setOpen(true); setHi(0); }
          else if (act?.type === "move") { e.preventDefault(); setHi(act.hi); }
          else if (act?.type === "pick") { if (act.stay) e.preventDefault(); pick(filtered[act.index]); }
          else if (act?.type === "close") {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); }
            close();
          }
          onKeyDown?.(e);
        }}
      />
      {show && (
        <div ref={listRef} id={listId} role="listbox" style={float} className={floatCls}>
          {filtered.map((v, i) => (
            <button
              key={v}
              id={`${listId}-${i}`}
              data-i={i}
              type="button"
              role="option"
              aria-selected={i === hi}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(v)}
              className={`block min-h-[44px] w-full px-3 py-2 text-left text-sm text-ink sm:min-h-0 ${i === hi ? "bg-raised" : ""}`}
            >
              {v}
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
      aria-busy={pending || undefined}
      // D184 — หน้าตาเดียวกับ <Button tone="primary"> (lib/shared/page) · ของเก่าที่ใช้ SaveButton ไม่ต้องไล่เปลี่ยน
      className={`${BTN_BASE} ${BTN_SIZE.md} ${BTN_TONE.primary} ${className}`}
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
  /**
   * D184 — ปุ่ม 3 ระดับ (DESIGN_SYSTEM) · tone เดิมยังรับได้ แต่ map เข้า 3 ระดับ:
   *   green ("บันทึก" ตอนแก้แถว = ยืนยัน) → primary · red → danger · slate/brand → secondary
   * ★ ปุ่มในแถวตารางบนจอแคบสูง 44px เหมือนเดิม (เดิม RowBtn ตั้งไว้ · กฎกลางจอสัมผัสให้แค่ 32)
   */
  const tones: Record<"slate" | "green" | "red" | "brand", string> = {
    slate: BTN_TONE.secondary,
    green: BTN_TONE.primary,
    red: BTN_TONE.danger,
    brand: BTN_TONE.secondary,
  };
  return (
    <button
      {...rest}
      className={`${BTN_BASE} ${BTN_SIZE.sm} ${tones[tone]} min-h-[44px] sm:min-h-0 ${className}`}
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

/*
 * ★ D173 — `EscToClose` ถูกลบแล้ว · ป๊อปอัพทุกตัวใช้ `<Modal>` (lib/shared/modal.tsx) ซึ่งจัดการ Esc/Tab/โฟกัส/ล็อกหน้าหลังเอง
 *   🚨 อย่าเขียนฉากหลัง `fixed inset-0` เองอีก — มีเทสล็อก (keyboard.test.ts)
 */

/**
 * ข้อความใต้ปุ่มที่ถูก disable — บอกว่า "ยังขาดอะไร"
 *
 * 🪤 ปุ่มเทาเฉย ๆ โดยไม่บอกเหตุผล = ผู้ใช้ใหม่นึกว่าปุ่มเสีย (ตระกูล D74/D77/D80)
 *    วางไว้ **ใต้ปุ่ม** เสมอ · ครบแล้วจะไม่ render อะไรเลย (ไม่ใช่ช่องว่างค้างไว้)
 *
 *   <SaveButton disabled={!a || !b} … />
 *   <MissingHint checks={[{ label: "ลูกค้า", ok: !!a }, { label: "ชื่อ", ok: !!b }]} />
 *
 * 🚨 เงื่อนไข disabled= ของปุ่มยังเป็นตัวจริง — อันนี้เป็นคำอธิบายอย่างเดียว
 */
export function MissingHint({ checks, prefix }: { checks: FieldCheck[]; prefix?: string }) {
  const text = missingText(checks, prefix);
  if (!text) return null;
  return <p className="mt-1 text-xs text-warn">{text}</p>;
}

/**
 * ── กล่องยืนยันในแอป (D96) — แทน `window.confirm()` ────────────────────────
 *
 * 🐛 **บั๊กที่ทำให้ต้องมีตัวนี้**: ปุ่ม *ปิดบิลนี้ทิ้ง* ในหน้าขายบาร์ใช้ `confirm()`
 *    ผู้ใช้กดแล้ว **ไม่มีอะไรเกิดขึ้นเลย** — ไม่ใช่เพราะ RPC พัง แต่เพราะ
 *    เบราว์เซอร์บางตัว/บางบริบท **บล็อก native dialog ทิ้งเงียบ ๆ แล้วคืน `false`**
 *    (เบราว์เซอร์ในตัวช่วยเทสเป็นแบบนั้น · บางเบราว์เซอร์บล็อกหลังผู้ใช้ติ๊ก
 *     "ไม่ต้องแสดงกล่องนี้อีก" ซึ่งกดครั้งเดียวแล้วปุ่มลบตายถาวรทั้งเว็บ)
 *
 * 🚨 อาการมันเหมือน "ปุ่มเสีย" ทุกประการ และ **build/lint/test มองไม่เห็นเลย**
 *
 * ★ ใช้แบบ Promise เพื่อให้ call site อ่านเหมือน `confirm()` เดิม:
 *
 *     const { confirmNode, ask } = useConfirm();
 *     …
 *     if (!(await ask({ title: "ปิดบิลทิ้ง?", detail: "สต็อกจะถูกคืน" }))) return;
 *     …
 *     return (<>{confirmNode}…</>);
 *
 * 🪤 ต้อง render `{confirmNode}` ด้วย ไม่งั้น `ask()` จะค้างรอตลอดกาลแบบไม่มี error
 */
export type ConfirmOpts = {
  title: string;
  detail?: string;
  /** ข้อความบนปุ่มยืนยัน (ปริยาย "ยืนยัน") */
  confirmText?: string;
  /** true = การกระทำทำลายข้อมูล → ปุ่มเป็นระดับ danger */
  danger?: boolean;
  /**
   * ข้อความบนปุ่มปิด (ปริยาย "ยกเลิก")
   * 🪤 D134 — การกระทำที่ชื่อ "ยกเลิก…" (ยกเลิกออเดอร์/ยกเลิกบิล) ต้องส่ง `"กลับ"`
   *    ไม่งั้นได้ปุ่ม [ยกเลิกออเดอร์] [ยกเลิก] คนอ่านไม่รู้ว่าปุ่มขวาคือยกเลิกออเดอร์หรือยกเลิกคำสั่ง
   */
  cancelText?: string;
};

export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const ask = useCallback((o: ConfirmOpts) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const done = useCallback((ok: boolean) => {
    setOpts(null);
    resolver.current?.(ok);
    resolver.current = null;
  }, []);

  const confirmNode = opts ? (
    <Modal
      top
      size="sm"
      title={opts.title}
      onClose={() => done(false)}
      footer={
        <>
          <ModalCancel onClick={() => done(false)}>{opts.cancelText ?? "ยกเลิก"}</ModalCancel>
          <button
            type="button"
            data-autofocus
            onClick={() => done(true)}
            className={`min-h-[44px] rounded px-4 text-sm font-semibold transition hover:opacity-90 sm:min-h-0 sm:py-2 ${
              opts.danger ? "border border-crit-line bg-crit-bg text-crit" : "bg-brand text-on-brand"
            }`}
          >
            {opts.confirmText ?? "ยืนยัน"}
          </button>
        </>
      }
    >
      {opts.detail && <p className="whitespace-pre-line text-sm text-muted">{opts.detail}</p>}
    </Modal>
  ) : null;

  return { confirmNode, ask };
}
