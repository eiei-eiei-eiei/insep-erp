"use client";

/**
 * ── ป้ายแจ้งผลลอยบนกลางจอ (toast) — D134 ──────────────────────────────────────
 *
 * ที่มา: ผู้ใช้แจ้งว่า *"เวลาบันทึกไปแล้วบางทีเราไม่ได้อยู่ตรงที่จะมองเห็นว่าเกิดการบันทึกแล้ว"*
 *   และฝั่งบาร์ *"กดไปแล้วไม่รู้แอคชั่นเรียบร้อยหรือยัง"* — เดิมผลการบันทึกเป็นแถบสีในการ์ด (`<Msg>`)
 *   เลื่อนจอไปที่อื่นอยู่ = มองไม่เห็น · และแถบเขียว "บันทึกแล้ว" **ค้างอยู่ในการ์ด** ทั้งที่เริ่มกรอกบิลถัดไปแล้ว
 *   ⇒ ผู้ใช้สั่งเอาแถบในการ์ดออก เหลือป้ายลอยอย่างเดียว
 *
 * ★ เรียกจากที่ไหนก็ได้ด้วย `showToast()` — รวมถึงฟังก์ชันที่ไม่ใช่ component (พิมพ์เอกสาร/สลิป)
 *   ส่งผ่าน window event ไปหา `<ToastHost>` ที่วางไว้ใน layout (ไม่ต้องมี context/provider)
 * ★ `useSaver()` ส่งเข้ามาเองทุกครั้ง ⇒ ทุกหน้าจอที่ใช้ตัวกลางได้ป้ายโดยไม่ต้องแก้ทีละปุ่ม
 *
 * กติกาการหาย (ตัดสินที่ `toastLife()` มีเทสคุม):
 *   ✅ สำเร็จ → หายเองใน 3 วิ (เริ่มทำงานต่อได้เลย ไม่ต้องกดปิด)
 *   ⚠️ สำเร็จบางส่วน / ❌ ไม่สำเร็จ → **ค้างจนกด ✕** (ต้องอ่านเหตุผล · D79 บันทึกได้บางส่วน ≠ สำเร็จ)
 *
 * 🚨 ตำแหน่ง: บนกลางจอ — ไม่วางล่างเพราะหน้าขายบาร์บนมือถือมีถาดติดขอบล่าง (ผู้ใช้เลือก)
 * 🚨 z-index สูงกว่าป๊อปอัพ (z-50) และกล่องยืนยัน (z-60) — บันทึกจากในป๊อปอัพก็ต้องเห็น
 */
import { useEffect, useRef, useState } from "react";

export type ToastMsg = { ok: boolean; text: string; warn?: boolean };

const EVENT = "app-toast";

/** อายุของป้าย (มิลลิวินาที) — null = ค้างจนกดปิด */
export function toastLife(m: ToastMsg): number | null {
  if (m.ok && !m.warn) return 3000;
  return null;
}

/** ส่งป้ายขึ้นจอ · ข้อความว่าง = ไม่ส่ง */
export function showToast(m: ToastMsg): void {
  if (typeof window === "undefined" || !m.text) return;
  window.dispatchEvent(new CustomEvent<ToastMsg>(EVENT, { detail: m }));
}

type Item = ToastMsg & { id: number };

/** จำนวนป้ายที่โชว์พร้อมกันสูงสุด — เกินนี้ตัดอันเก่าสุดทิ้ง (กันจอเต็มตอนกดรัว) */
const MAX = 3;

/** วางครั้งเดียวต่อ layout — `app/(app)/layout.tsx` และ `app/(platform)/layout.tsx` */
export function ToastHost() {
  const [items, setItems] = useState<Item[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    function onToast(e: Event) {
      const m = (e as CustomEvent<ToastMsg>).detail;
      const id = ++seq.current;
      setItems((prev) => {
        // ข้อความเดียวกันซ้ำติดกัน (กดรัว) = แทนที่ ไม่ซ้อน
        const rest = prev.filter((p) => !(p.text === m.text && p.ok === m.ok && !!p.warn === !!m.warn));
        return [...rest, { ...m, id }].slice(-MAX);
      });
      const life = toastLife(m);
      if (life != null) {
        const t = setTimeout(() => {
          timers.delete(t);
          setItems((prev) => prev.filter((p) => p.id !== id));
        }, life);
        timers.add(t);
      }
    }
    window.addEventListener(EVENT, onToast);
    return () => {
      window.removeEventListener(EVENT, onToast);
      timers.forEach(clearTimeout);
    };
  }, []);

  if (items.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-16 z-[70] flex flex-col items-center gap-2 px-4"
    >
      {items.map((t) => {
        const tone = t.warn
          ? "border-warn-line bg-warn-bg text-warn"
          : t.ok
            ? "border-ok-line bg-ok-bg text-ok"
            : "border-crit-line bg-crit-bg text-crit";
        const icon = t.warn ? "⚠️" : t.ok ? "✅" : "❌";
        return (
          <div
            key={t.id}
            role={t.ok && !t.warn ? "status" : "alert"}
            className={`pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg ${tone}`}
          >
            <span aria-hidden>{icon}</span>
            <span className="flex-1 whitespace-pre-line">{t.text}</span>
            <button
              type="button"
              aria-label="ปิดข้อความ"
              onClick={() => setItems((prev) => prev.filter((p) => p.id !== t.id))}
              className="shrink-0 px-1 opacity-70 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
