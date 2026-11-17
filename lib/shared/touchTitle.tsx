"use client";

/**
 * จอสัมผัสไม่มี "เมาส์ชี้" — ข้อความใน `title=` จึงมองไม่เห็นเลยบนมือถือ (D173 เฟส 3)
 *
 * ทั้งแอปมี `title=` ราว 150 จุด หลายจุดเก็บ **เหตุผล** ไว้ที่นั่นที่เดียว
 * (เช่นป้าย "ลบไม่ได้" ที่เหตุผลอยู่ใน title) ⇒ บนมือถือผู้ใช้เห็นแค่ว่าทำไม่ได้ ไม่รู้ว่าทำไม
 *
 * ตัวนี้: บนจอสัมผัส แตะของที่มี `title` แล้ว **ไม่ใช่ปุ่ม/ลิงก์/ช่องกรอกที่กดได้**
 * → ขึ้นกล่องข้อความเล็ก ๆ เหนือแถบล่าง 4 วินาที (แตะที่อื่นก็หาย)
 *
 * 🚨 ปุ่มที่กดได้ไม่ยุ่ง — แตะแล้วต้องทำงานของมันตามเดิม
 * 🪤 ปุ่มที่ `disabled` เบราว์เซอร์ไม่ส่ง click ให้เลย จึงจับไม่ได้ที่นี่
 *    ⇒ เหตุผลที่ปุ่มเทา **ต้องอยู่บนจอ** (`<MissingHint>` / บรรทัดใต้ปุ่ม) ไม่ใช่ใน title — DESIGN_SYSTEM "จอสัมผัส"
 * ★ ของใหม่อย่าเก็บคำอธิบายไว้ใน title — ใช้ `<Help>`
 */

import { useEffect, useState } from "react";

/** แตะ element นี้แล้วควรโชว์ title ไหม — แยกออกมาให้เทสได้ (ไม่แตะ DOM จริง) */
export function touchTitleOf(path: { tag: string; title: string | null; disabled?: boolean; role?: string | null }[]): string | null {
  for (const n of path) {
    const interactive =
      ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "LABEL", "SUMMARY"].includes(n.tag) || n.role === "button";
    // ไล่จากตัวที่แตะขึ้นไป: เจอของกดได้ก่อนเจอ title = ปล่อยให้มันทำงานตามเดิม
    if (interactive && !n.disabled) return null;
    const t = n.title?.trim();
    if (t) return t;
  }
  return null;
}

export function TouchTitles() {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia?.("(pointer: coarse)").matches) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onClick = (e: MouseEvent) => {
      const path: Parameters<typeof touchTitleOf>[0] = [];
      for (let el = e.target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
        path.push({
          tag: el.tagName,
          title: el.getAttribute("title"),
          disabled: (el as HTMLButtonElement).disabled === true,
          role: el.getAttribute("role"),
        });
      }
      const t = touchTitleOf(path);
      if (timer) clearTimeout(timer);
      setText(t);
      if (t) timer = setTimeout(() => setText(null), 4000);
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!text) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex justify-center px-4">
      <div role="status" className="max-w-sm rounded-lg border border-line bg-card px-3 py-2 text-xs leading-relaxed text-ink shadow-lg">
        {text}
      </div>
    </div>
  );
}
