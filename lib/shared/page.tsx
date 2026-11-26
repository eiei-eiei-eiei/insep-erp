"use client";

/**
 * ตัวกลางของหน้า (D173 งานค้าง ข้อ 4 · D184) — หัวหน้าจอ · แถบแท็บ · ปุ่ม 3 ระดับ · โครงร่างตอนโหลด
 *
 * ★ หน้าตาล้วน — ไม่มี action / เงื่อนไขธุรกิจในไฟล์นี้ (กติกาเดียวกับ `lib/shared/settings.tsx`)
 * ★ หน้าตัวอย่าง: บัญชี (หัวหน้าจอ + แถบแท็บ) · แท็บ แดชบอร์ด / บัญชี & เงินสด / ลูกหนี้-เจ้าหนี้
 *   ⏳ รอผู้ใช้ดูก่อนไล่ทั้งแอป (แบบเฟส 4a)
 */
import { useEffect, useRef, useState } from "react";

// ── หัวหน้าจอของโมดูล ───────────────────────────────────────────────────────────
/**
 * ไอคอน + ชื่อโมดูล ชิดซ้าย · ตัวเลือกของหน้า (กิจการ/เดือน/บทบาท) ชิดขวา
 * ★ จอแคบ: ด้านขวาตกลงบรรทัดใหม่เต็มกว้าง ไม่บีบชื่อ (เดิมแต่ละโมดูลเขียนเอง บางตัวไม่ `flex-wrap`)
 */
export function PageHeader({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  /** ตัวเลือกของหน้า ชิดขวา */
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-brand">{icon}</span>
      <h1 className="text-2xl font-bold text-ink">{title}</h1>
      {children && <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">{children}</div>}
    </div>
  );
}

// ── แถบแท็บ ──────────────────────────────────────────────────────────────────
/**
 * แถบแท็บของโมดูล — ตัวเดียวแทนที่เขียนซ้ำ 5 โมดูล
 *
 * ★ ซ่อนแถบเลื่อนแนวนอน (เดิมโผล่เป็นแถบเทาพร้อมลูกศรใต้แท็บบนมือถือ) — ปัดได้เหมือนเดิม
 *   และ **เลื่อนแท็บที่เลือกเข้ามาในจอเอง** (เปิดลิงก์ ?tab= ของแท็บท้าย ๆ บนมือถือ จะเห็นว่าอยู่แท็บไหน)
 * ★ ขอบขวาจางลงเมื่อยังมีแท็บซ่อนอยู่ (บอกว่าปัดต่อได้ — แทนแถบเลื่อนที่ซ่อนไป)
 * ★ `role="tablist"` / `aria-selected` — โปรแกรมอ่านหน้าจอรู้ว่าแท็บไหนเลือกอยู่
 */
export function ModuleTabs<T extends string>({
  tabs,
  active,
  onPick,
  label,
  labelOf,
}: {
  tabs: readonly T[];
  active: T;
  onPick: (t: T) => void;
  label: string;
  /** แท็บที่ key เป็น slug (ขาย · บาร์) — ชื่อที่แสดง */
  labelOf?: (t: T) => string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  // ★ ขอบขวาจาง "เฉพาะตอนยังมีแท็บซ่อนอยู่ทางขวา" — ทุกขนาดจอ (จอคอมก็ล้นได้ เช่นผลิต 13 แท็บที่ 1280px · ดูบนจอแล้ว)
  //   เลื่อนไปสุดแล้ว/ไม่ล้น = ไม่จาง (ไม่งั้นแท็บสุดท้ายดูเหมือนถูกบังตลอด)
  const [more, setMore] = useState(false);
  useEffect(() => {
    const box = bar.current;
    if (!box) return;
    const check = () => setMore(box.scrollLeft + box.clientWidth < box.scrollWidth - 2);
    check();
    box.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      box.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [tabs.length]);
  useEffect(() => {
    const el = bar.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    // inline: "center" — "nearest" หยุดชิดขอบพอดีแล้วโดนขอบจางทับ (ดูบนจอมือถือแล้ว) · block: "nearest" = ไม่เลื่อนทั้งหน้า
    // ★ เลื่อนเฉพาะในแถบ (scrollTo ของแถบเอง) ไม่ใช้ scrollIntoView — กันหน้าทั้งหน้าเลื่อนตามตอนเปิด
    const box = bar.current;
    if (el && box) {
      const left = el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2;
      box.scrollTo({ left: Math.max(0, left) });
    }
  }, [active]);
  return (
    <div className="relative mb-5 -mx-4 border-b border-line">
      <div ref={bar} role="tablist" aria-label={label} className="tabbar relative flex gap-1 overflow-x-auto px-4">
        {tabs.map((t) => {
          const on = t === active;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onPick(t)}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition ${
                on ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {labelOf ? labelOf(t) : t}
            </button>
          );
        })}
      </div>
      {more && <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-l from-page" />}
    </div>
  );
}

// ── ปุ่ม 3 ระดับ ─────────────────────────────────────────────────────────────
/**
 * ปุ่มตัวเดียว 3 ระดับ (DESIGN_SYSTEM "ระดับของปุ่ม")
 *
 * | tone | ใช้เมื่อ |
 * |---|---|
 * | primary | สิ่งที่ควรทำต่อ — **1 อันต่อกลุ่ม** |
 * | secondary | ทำได้ ไม่เร่ง (ชำระ · พิมพ์ · ดู · statement) |
 * | danger | ทำลาย/ย้อนไม่ได้ (ยกเลิก · ลบ) — วางใน `ActionRow` ช่อง `danger` ให้แยกระยะเอง |
 *
 * size: `md` = ปุ่มหลักของการ์ด/ฟอร์ม · `sm` = ปุ่มในแถวตาราง
 * ★ จอสัมผัสสูง ≥ 32px อยู่แล้วจากกฎกลางใน globals.css (D173 เฟส 3) · `md` สูง 44px บนจอแคบเหมือน SaveButton เดิม
 * ★ `pending` = กดซ้ำไม่ได้ + ข้อความเปลี่ยน (แทนการเขียน disabled={pending} เองทุกจุด)
 */
export function Button({
  tone = "secondary",
  size = "md",
  pending,
  pendingText = "กำลังทำงาน…",
  className = "",
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "secondary" | "danger";
  size?: "md" | "sm";
  pending?: boolean;
  pendingText?: string;
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={pending || rest.disabled}
      aria-busy={pending || undefined}
      className={`${BTN_BASE} ${BTN_SIZE[size]} ${BTN_TONE[tone]} ${className}`}
    >
      {pending ? pendingText : children}
    </button>
  );
}

export const BTN_BASE =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded border font-medium transition " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50";
/** ★ Record ตาม key (D84) — เพิ่มขนาด/ระดับใหม่แล้วลืมเติม = TS ฟ้อง */
export const BTN_SIZE: Record<"md" | "sm", string> = {
  md: "min-h-[44px] px-5 text-sm sm:min-h-0 sm:py-2",
  sm: "px-3 py-1 text-xs",
};
export const BTN_TONE: Record<"primary" | "secondary" | "danger", string> = {
  primary: "border-brand bg-brand font-semibold text-on-brand hover:opacity-90",
  secondary: "border-line bg-card text-ink hover:bg-raised",
  danger: "border-crit-line bg-card text-crit hover:bg-crit-bg",
};

/**
 * แถวปุ่ม — ปุ่มปกติชิดซ้าย · ปุ่มอันตรายดันไปขวาสุด (แยกระยะ กันกดพลาดตอนนิ้วเลื่อน)
 * ★ ในแถวตาราง (`compact`) ระยะแคบลงแต่ยังแยกด้วยเส้นคั่น
 */
export function ActionRow({
  children,
  danger,
  compact,
  className = "",
}: {
  children?: React.ReactNode;
  danger?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    // 🪤 compact (แถวตาราง) ห้ามขึ้นบรรทัดใหม่ — ส่ง className="flex-nowrap" ทับไม่ได้ (flex-wrap ชนะตามลำดับ CSS · เห็นบนมือถือแล้ว)
    <div className={`flex items-center ${compact ? "flex-nowrap gap-1.5" : "flex-wrap gap-2"} ${className}`}>
      {children}
      {danger && (
        <span className={`ml-auto flex items-center ${compact ? "gap-1.5 border-l border-line pl-1.5" : "gap-2 pl-4"}`}>
          {danger}
        </span>
      )}
    </div>
  );
}

// ── โครงร่างตอนโหลด ──────────────────────────────────────────────────────────
/**
 * โครงร่างตอนโหลด — แทน "กำลังโหลด…" ตัวหนังสือเปล่า (เดิม 50 จุด)
 *
 * ★ รูปร่างใกล้ของจริง ⇒ ข้อมูลมาแล้วหน้าไม่กระโดด และรู้ว่ากำลังรออะไร
 * ★ ยังมีคำว่า "กำลังโหลด…" ให้โปรแกรมอ่านหน้าจอ (`sr-only` + `role="status"`)
 * ★ เคารพ "ลดการเคลื่อนไหว" ของเครื่อง (`motion-safe:`)
 * 🚨 ใช้กับ "ยังไม่มีข้อมูล" เท่านั้น — อ่านไม่สำเร็จต้องเป็น `LoadError` (D89 · อ่านไม่ได้ ≠ ไม่มีข้อมูล)
 */
function Bone({ className = "" }: { className?: string }) {
  // ★ bg-line/60 — bg-raised บนการ์ดจางจนมองแทบไม่เห็น (ดูบนจอแล้วทั้งสว่าง/มืด)
  return <span className={`block rounded bg-line/60 motion-safe:animate-pulse ${className}`} />;
}

function Busy({ what, children, className = "" }: { what?: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">กำลังโหลด{what ?? ""}…</span>
      {/* 🪤 className (space-y / grid) ต้องอยู่ที่ชั้นนี้ — ชั้นนอกมีลูกแค่ 2 ตัว แถวจะซ้อนกัน */}
      <div aria-hidden className={className}>{children}</div>
    </div>
  );
}

/** บรรทัดข้อความ — ความยาวสลับกันให้ดูเป็นย่อหน้า */
export function SkeletonText({ lines = 2, what }: { lines?: number; what?: string }) {
  const w = ["w-3/4", "w-1/2", "w-2/3", "w-5/6"];
  return (
    <Busy what={what} className="space-y-2 py-1">
      {Array.from({ length: lines }, (_, i) => <Bone key={i} className={`h-3.5 ${w[i % w.length]}`} />)}
    </Busy>
  );
}

/** ตาราง — แถวหัว + แถวข้อมูล · คอลัมน์ท้ายชิดขวาแบบคอลัมน์ตัวเลข */
export function SkeletonTable({ rows = 4, cols = 4, what }: { rows?: number; cols?: number; what?: string }) {
  // จอแคบโชว์แค่ 3 คอลัมน์ (แรก · ที่สอง · ท้าย) — 6 คอลัมน์บนมือถือถูกบีบเหลือจุดเล็ก ๆ (ดูบนจอแล้ว)
  const mid = (c: number) => (c >= 2 && c < cols - 1 ? "hidden sm:block" : "");
  return (
    <Busy what={what} className="space-y-3 py-1">
      <div className="flex gap-4 border-b border-line pb-2">
        {Array.from({ length: cols }, (_, c) => <Bone key={c} className={`h-2.5 ${c === 0 ? "w-24" : "flex-1"} ${mid(c)}`} />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4">
          {Array.from({ length: cols }, (_, c) => (
            <Bone key={c} className={`h-3.5 ${c === 0 ? "w-24" : c === cols - 1 ? "ml-auto w-20" : "flex-1"} ${mid(c)}`} />
          ))}
        </div>
      ))}
    </Busy>
  );
}

/** แถวการ์ดตัวเลข (หน้าแดชบอร์ด) — ขนาด/ระยะเท่า `Stat` */
const STAT_COLS: Record<2 | 3 | 4, string> = {
  2: "md:grid-cols-[repeat(2,minmax(0,1fr))]",
  3: "md:grid-cols-[repeat(3,minmax(0,1fr))]",
  4: "md:grid-cols-[repeat(4,minmax(0,1fr))]",
};
export function SkeletonStats({ count = 4, mdCols = 4, what }: { count?: number; mdCols?: 2 | 3 | 4; what?: string }) {
  return (
    <Busy what={what} className={`grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 ${STAT_COLS[mdCols]}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-line bg-card p-4">
          <Bone className="h-2.5 w-1/2" />
          <Bone className="h-6 w-2/3" />
        </div>
      ))}
    </Busy>
  );
}

/** การ์ดทั้งใบ (หัว + ตาราง) — ใช้ตอนทั้งแท็บยังไม่มีอะไรเลย */
export function SkeletonCard({ rows = 3, cols = 5, what }: { rows?: number; cols?: number; what?: string }) {
  return (
    <div className="rounded-lg border border-line bg-card p-4 sm:p-5">
      <Bone className="mb-4 h-3 w-48" />
      <SkeletonTable rows={rows} cols={cols} what={what} />
    </div>
  );
}
