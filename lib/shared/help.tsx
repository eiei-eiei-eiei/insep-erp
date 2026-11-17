"use client";

/**
 * ปุ่มคำอธิบาย ⓘ / ! (D173 เฟส 2a) — ที่เดียวของทั้งแอป
 *
 * ผู้ใช้สั่ง: โน้ตอธิบายที่วางเรียงอยู่ตามหน้าจอทำให้รก → ย้ายเข้าปุ่มวงกลม กดแล้วค่อยเห็น
 *
 *   <Help>ข้อความอธิบาย</Help>                 ← ⓘ สีเทา (คำอธิบายทั่วไป)
 *   <Help tone="warn">ข้อควรระวัง</Help>       ← ! สีเหลือง (ควรอ่านก่อนใช้ แต่ไม่ถึงขั้นต้องเห็นตลอด)
 *   <Field label="…" help="…">  /  <Card title="…" help="…">   ← ทางลัดที่ใช้บ่อยสุด
 *
 * 🚨 **อะไรย้ายเข้าได้ / อะไรต้องอยู่บนจอ ดู `docs/DESIGN_SYSTEM.md` หัวข้อ "คำอธิบาย ⓘ"**
 *    คำเตือนเรื่องเงิน/ภาษี/เอกสารราชการ/สต็อก และข้อความที่ขึ้นตามสถานะ **ห้ามย้ายเข้า**
 *
 * พฤติกรรม (เทสใน `help.test.ts`):
 *  · กด/แตะ/Enter/Space = เปิด-ปิด · Esc = ปิด (ไม่ปิดป๊อปอัพที่ครอบอยู่) · กดที่อื่น/Tab ออก/เลื่อนจอ = ปิด
 *  · กล่องเป็น `fixed` คำนวณจากตำแหน่งปุ่ม → ไม่ถูกตัดโดยตาราง/ป๊อปอัพ และไม่ดันหน้าให้กว้างเกินจอมือถือ
 *  · ปุ่มอยู่ใน `<label>` ได้ — กดแล้วไม่ไปโฟกัสช่องกรอก
 *  · เปิดได้ทีละอัน (เปิดอันใหม่ อันเดิมปิดเอง เพราะโฟกัสย้าย)
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { helpPlace } from "./helpPlace";

export type HelpProps = {
  children: React.ReactNode;
  /** `info` = ⓘ (ปริยาย) · `warn` = ! สีเหลือง */
  tone?: "info" | "warn";
  /** ชื่อปุ่มสำหรับโปรแกรมอ่านจอ — ปริยาย "คำอธิบาย" / "ข้อควรระวัง" */
  label?: string;
  className?: string;
};

export function Help({ children, tone = "info", label, className = "" }: HelpProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const id = useId();

  // วัดกล่องหลังวาดแล้วค่อยวางตำแหน่ง (ก่อนวัดซ่อนไว้ กันกะพริบที่มุมจอ)
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const b = btnRef.current?.getBoundingClientRect();
    const p = popRef.current?.getBoundingClientRect();
    if (!b || !p) return;
    const { left, top } = helpPlace(
      { left: b.left, top: b.top, width: b.width, height: b.height },
      { width: p.width, height: p.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: Event) => {
      const t = e.target as Node | null;
      if (t && (btnRef.current?.contains(t) || popRef.current?.contains(t))) return;
      close();
    };
    // กล่องเป็น fixed — เลื่อนจอแล้วจะลอยค้างผิดที่ ⇒ ปิด (ยกเว้นเลื่อนข้างในกล่องเอง)
    const onScroll = (e: Event) => {
      if (popRef.current && e.target instanceof Node && popRef.current.contains(e.target)) return;
      close();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const warn = tone === "warn";
  const name = label ?? (warn ? "ข้อควรระวัง" : "คำอธิบาย");

  return (
    <span className={`inline-flex align-middle ${className}`}>
      <button
        ref={btnRef}
        type="button"
        data-help={tone}
        aria-label={name}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          // 🪤 อยู่ใน <label> — ไม่กันไว้ การกดจะไปโฟกัส/ติ๊กช่องกรอกของ label นั้น
          e.preventDefault();
          e.stopPropagation();
          // Safari ไม่โฟกัสปุ่มตอนคลิก — ต้องโฟกัสเองเพื่อให้ Esc / Tab ออก ทำงาน
          btnRef.current?.focus();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            // ป๊อปอัพที่ครอบอยู่ข้ามปุ่มที่ aria-expanded อยู่แล้ว — กันซ้ำอีกชั้น
            e.stopPropagation();
            setOpen(false);
          }
        }}
        onBlur={() => setOpen(false)}
        className={`relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold leading-none outline-none transition before:absolute before:-inset-2 before:content-[''] focus-visible:ring-2 focus-visible:ring-brand-soft ${
          warn
            ? "border-warn-line bg-warn-bg text-warn hover:border-warn"
            : open
              ? "border-brand text-brand"
              : "border-line text-muted hover:border-brand hover:text-brand"
        }`}
      >
        <span aria-hidden>{warn ? "!" : "i"}</span>
      </button>
      {open && (
        <span
          ref={popRef}
          id={id}
          role="note"
          // กดในกล่องแล้วโฟกัสต้องไม่หลุดจากปุ่ม (หลุด = onBlur ปิดกล่องก่อนอ่านจบ)
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
          className={`fixed z-[70] block max-h-[60vh] w-72 max-w-[calc(100vw-16px)] overflow-y-auto rounded-lg border bg-card px-3 py-2 whitespace-normal text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-ink shadow-lg ${
            warn ? "border-warn-line" : "border-line"
          }`}
        >
          {children}
        </span>
      )}
    </span>
  );
}
