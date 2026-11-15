"use client";

/**
 * ป๊อปอัพตัวกลางของทั้งแอป (D173)
 *
 * เดิมป๊อปอัพเขียนแยกกันเอง 29 ไฟล์ — ฉากหลัง 5 ความเข้ม · เปิดแล้วเคอร์เซอร์ไม่อยู่ในช่อง ·
 * กด Tab หลุดไปหน้าหลัง · เลื่อนแล้วหน้าหลังเลื่อนตาม · มือถือจอเตี้ยถูกตัดหัวท้าย
 * ตัวนี้ทำให้ครบที่เดียว ผู้เรียกส่งแค่ หัวข้อ · เนื้อหา · ปุ่มท้าย
 *
 *   <Modal title="เพิ่มคู่ค้า" onClose={close} onSubmit={save} busy={pending}
 *          footer={<><ModalCancel onClick={close} /><SaveButton pending={pending} onClick={save} /></>}>
 *     <Field label="ชื่อ"><TextInput … /></Field>
 *   </Modal>
 *
 * สิ่งที่ได้มาเอง:
 * · **เปิดแล้วพร้อมพิมพ์** — เคอร์เซอร์ไปที่ช่อง `data-autofocus` ถ้ามี ไม่งั้นช่องกรอกแรก
 *   (จอสัมผัสไม่โฟกัสช่อง — ไม่งั้นคีย์บอร์ดเด้งบังครึ่งจอทันทีที่เปิด)
 * · **Enter = บันทึก** ในช่องบรรทัดเดียว · **Ctrl/⌘+Enter** จากที่ไหนก็ได้ (ต้องส่ง `onSubmit`)
 *   ช่องที่ Enter มีความหมายของตัวเอง (เช่น "เพิ่มแถว") ใส่ `data-enter="own"` ที่ช่องหรือกล่องที่ครอบ
 * · **Esc ปิด** เฉพาะป๊อปอัพบนสุด (ซ้อนกัน 2 ชั้น กดครั้งเดียวปิดชั้นเดียว) · ดร็อปดาวน์ที่เปิดอยู่ปิดก่อน
 * · **Tab วนอยู่ในป๊อปอัพ** · ปิดแล้วโฟกัสกลับไปปุ่มที่เปิดมัน
 * · **ล็อกหน้าหลังไม่ให้เลื่อน** · เนื้อหายาวเลื่อนในฉากของป๊อปอัพเอง (ไม่ถูกตัดเมื่อคีย์บอร์ดมือถือเด้ง)
 * · มือถือ = แผ่นเลื่อนขึ้นจากขอบล่างเต็มความกว้าง · จอ `sm` ขึ้นไป = กล่องกลางจอ
 *
 * 🚨 ปิดด้วยการกดพื้นหลังใช้ `onMouseDown` + เช็คว่ากดที่พื้นหลังจริง — ห้ามเปลี่ยนเป็น `onClick`
 *    (ลากคลุมข้อความในช่องแล้วปล่อยเมาส์นอกกล่อง เบราว์เซอร์ยิง click ไปที่พื้นหลัง = ปิดเองกลางคัน · D73)
 */

import { useEffect, useId, useRef } from "react";
import { IconClose } from "./icons";
import { enterSubmits, trapTab, FOCUSABLE, TYPEABLE } from "./keyboard";

/** ป๊อปอัพที่เปิดอยู่ เรียงตามลำดับเปิด — ตัวท้ายสุดคือตัวบนสุดที่รับ Esc/Tab */
const stack: symbol[] = [];
let prevOverflow = "";
let prevPadRight = "";

function lockScroll() {
  if (stack.length !== 1) return; // ล็อกครั้งเดียวตอนเปิดตัวแรก
  const body = document.body;
  prevOverflow = body.style.overflow;
  prevPadRight = body.style.paddingRight;
  // ชดเชยความกว้างแถบเลื่อนที่หายไป — ไม่งั้นหน้าหลังกระตุกไปทางขวาตอนเปิด
  const gap = window.innerWidth - document.documentElement.clientWidth;
  if (gap > 0) body.style.paddingRight = `${gap}px`;
  document.body.style.overflow = "hidden";
}
function unlockScroll() {
  if (stack.length !== 0) return; // ยังมีป๊อปอัพอื่นเปิดอยู่
  document.body.style.overflow = prevOverflow;
  document.body.style.paddingRight = prevPadRight;
}

const SIZES = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
} as const;

export type ModalProps = {
  title: React.ReactNode;
  onClose: () => void;
  /** ส่งมา = Enter ในช่องกรอก / Ctrl+Enter จะเรียกตัวนี้ (ปกติคือฟังก์ชันเดียวกับปุ่มบันทึก) */
  onSubmit?: () => void;
  /** กำลังบันทึก — กัน Enter ซ้ำ และกันปิดกลางคัน */
  busy?: boolean;
  size?: keyof typeof SIZES;
  /** ปุ่มท้ายป๊อปอัพ (ชิดขวา) */
  footer?: React.ReactNode;
  /** false = กดพื้นหลัง/Esc ไม่ปิด (ใช้กับป๊อปอัพที่ต้องอ่านให้จบ) · ปุ่ม ✕ ก็ไม่แสดง */
  dismissable?: boolean;
  /**
   * false = กดพื้นหลังไม่ปิด (Esc กับปุ่ม ✕ ยังปิดได้) — ใช้กับฟอร์มยาวที่กดพลาดแล้วของที่กรอกหาย
   * หรือป๊อปอัพรับเงิน/ออกเอกสารที่เดิมก็ไม่ปิดด้วยการกดพื้นหลัง
   */
  backdropClose?: boolean;
  /** กล่องยืนยันที่ซ้อนบนป๊อปอัพอื่น */
  top?: boolean;
  children: React.ReactNode;
};

export function Modal({ title, onClose, onSubmit, busy = false, size = "md", footer, dismissable = true, backdropClose = true, top = false, children }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // เก็บค่าล่าสุดไว้ใน ref — listener ผูกครั้งเดียวตอนเปิด ไม่ผูกใหม่ทุก render
  const live = useRef({ onClose, dismissable, busy });
  live.current = { onClose, dismissable, busy };

  useEffect(() => {
    const id = Symbol("modal");
    const prev = document.activeElement as HTMLElement | null;
    stack.push(id);
    lockScroll();

    // เปิดแล้วพร้อมพิมพ์
    const el = panel.current;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const target = () =>
      el?.querySelector<HTMLElement>("[data-autofocus]") ?? (coarse ? null : el?.querySelector<HTMLElement>(TYPEABLE)) ?? null;
    if (el) (target() ?? el).focus({ preventScroll: true });

    // เนื้อหาที่โหลดทีหลัง (เช่น ป๊อปอัพแก้บิลขึ้น "กำลังโหลด…" ก่อน) — ช่องกรอกโผล่มาเมื่อไร ค่อยวางเคอร์เซอร์ให้
    // เฉพาะตอนผู้ใช้ยังไม่ได้ย้ายโฟกัสไปไหนเอง · และถ้าปุ่มที่โฟกัสอยู่ถูกถอดออกจากจอ (โฟกัสตกไป body) ดึงกลับเข้าป๊อปอัพ
    let settled = el ? document.activeElement !== el : true;
    const watch = el
      ? new MutationObserver(() => {
          if (stack[stack.length - 1] !== id) return;
          const a = document.activeElement;
          if (a === document.body || a === null) {
            (settled ? el : target() ?? el).focus({ preventScroll: true });
            if (document.activeElement !== el) settled = true;
            return;
          }
          if (settled || a !== el) {
            settled = true;
            return;
          }
          const t = target();
          if (t) {
            t.focus({ preventScroll: true });
            settled = true;
          }
        })
      : null;
    if (el) watch?.observe(el, { childList: true, subtree: true });

    function onKey(e: KeyboardEvent) {
      if (stack[stack.length - 1] !== id) return; // ไม่ใช่ตัวบนสุด
      const box = panel.current;
      if (!box) return;
      if (e.key === "Escape") {
        // ดร็อปดาวน์ที่เปิดอยู่ปิดตัวเองก่อน — Esc ครั้งนี้ไม่ใช่ของป๊อปอัพ
        const t = e.target as HTMLElement | null;
        if (t?.getAttribute?.("aria-expanded") === "true") return;
        // กันไม่ให้ Esc ครั้งเดียวไหลไปปิดป๊อปอัพชั้นล่างด้วย
        e.stopPropagation();
        if (live.current.dismissable && !live.current.busy) live.current.onClose();
        return;
      }
      if (e.key === "Tab") {
        const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
        const to = trapTab(items.indexOf(document.activeElement as HTMLElement), items.length, e.shiftKey);
        if (to !== null) {
          e.preventDefault();
          items[to].focus();
        }
      }
    }
    document.addEventListener("keydown", onKey, true);

    return () => {
      watch?.disconnect();
      document.removeEventListener("keydown", onKey, true);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      unlockScroll();
      // คืนโฟกัสให้ปุ่มที่เปิดป๊อปอัพ — คนใช้คีย์บอร์ดทำงานต่อจากจุดเดิมได้
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, []);

  function onPanelKey(e: React.KeyboardEvent) {
    // ป๊อปอัพไม่ได้ย้ายออกจากต้นไม้ของหน้า — ปุ่มที่กดในนี้ต้องไม่ไหลขึ้นไปถึงคีย์ลัดของหน้าหลัง
    // (เจอจริง: Ctrl+Enter ในป๊อปอัพเพิ่มคู่ค้าของแท็บบันทึก ไปบันทึกบิลทั้งใบของหน้าหลังด้วย)
    e.stopPropagation();
    if (!onSubmit) return;
    const t = e.target as HTMLElement;
    const ok = enterSubmits({
      key: e.key,
      ctrlOrMeta: e.ctrlKey || e.metaKey,
      composing: e.nativeEvent.isComposing,
      defaultPrevented: e.defaultPrevented,
      tag: t.tagName,
      inputType: (t.getAttribute("type") ?? "").toLowerCase(),
      expanded: t.getAttribute("aria-expanded") === "true",
      // ช่องที่ผูก <datalist>: Enter อาจเป็นการเลือกคำแนะนำ — ไม่ถือเป็นบันทึก (Ctrl+Enter ยังบันทึกได้)
      ownEnter: !!t.closest('[data-enter="own"]') || t.hasAttribute("list"),
      busy,
    });
    if (!ok) return;
    e.preventDefault();
    onSubmit();
  }

  function onBackdrop(e: React.MouseEvent) {
    if (e.target === e.currentTarget && dismissable && backdropClose && !busy) onClose();
  }

  return (
    <div
      className={`fixed inset-0 overflow-y-auto overscroll-contain bg-overlay/50 ${top ? "z-[60]" : "z-50"}`}
      onMouseDown={onBackdrop}
    >
      <div className="flex min-h-full items-end justify-center sm:items-center sm:p-4" onMouseDown={onBackdrop}>
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          onKeyDown={onPanelKey}
          className={`w-full min-w-0 rounded-t-lg border border-line bg-card pb-[env(safe-area-inset-bottom)] shadow-xl outline-none sm:rounded-lg sm:pb-0 ${SIZES[size]}`}
        >
          <div className="flex items-start gap-3 border-b border-line-soft px-4 py-3 sm:px-5">
            <h2 id={titleId} className="min-w-0 flex-1 text-base font-semibold text-ink">
              {title}
            </h2>
            {dismissable && (
              <button
                type="button"
                onClick={() => !busy && onClose()}
                aria-label="ปิด"
                title="ปิด (Esc)"
                className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded text-muted transition hover:bg-raised hover:text-ink"
              >
                <IconClose />
              </button>
            )}
          </div>
          {children ? <div className="px-4 py-4 sm:px-5">{children}</div> : null}
          {footer && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-line-soft px-4 py-3 sm:px-5">{footer}</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** ปุ่มรองท้ายป๊อปอัพ (ยกเลิก / ปิด / กลับ) — คู่กับ `SaveButton` */
export function ModalCancel({
  children = "ยกเลิก",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`min-h-[44px] rounded border border-line bg-card px-4 text-sm font-medium text-muted transition hover:bg-raised hover:text-ink disabled:opacity-50 sm:min-h-0 sm:py-2 ${className}`}
    >
      {children}
    </button>
  );
}
