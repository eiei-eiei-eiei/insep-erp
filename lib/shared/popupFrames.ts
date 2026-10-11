/**
 * popupFrames — ยืม requestAnimationFrame ของหน้าต่าง popup ให้โค้ดที่รันอยู่ในหน้าต่างแอป (D105)
 */

/**
 * 🔴 บั๊กที่เจอบนมือถือจริง (Samsung · Chrome): ค้างที่ "กำลังเตรียมภาพ 1/1…" ตลอดกาล
 *    html-to-image เรียก `requestAnimationFrame` แบบ global = ของ "หน้าต่างแอป" (ที่โค้ดนี้รันอยู่)
 *    บนมือถือ popup เปิดเป็นแท็บใหม่ → แท็บแอปถูกซ่อน → **แท็บที่ซ่อนไม่ยิง rAF เลย** → แปลงภาพไม่มีวันเสร็จ
 *    (บนคอม popup เป็นหน้าต่างแยก แท็บแอปยังมองเห็นอยู่ จึงไม่เคยเจอ)
 *    → ระหว่างแปลงภาพ ยืม rAF ของหน้าต่างเอกสาร (ที่ผู้ใช้กำลังดูอยู่) มาใช้แทน
 *    หน้าต่างเอกสารปิดไปแล้ว = กลับไปใช้ของเดิม · ไม่มีใครยืมแล้ว = คืนของเดิมทันที
 * `host` = หน้าต่างแอป (รับเป็นพารามิเตอร์เพื่อให้เทสด้วยของปลอมได้) · ผู้ใช้: lib/shared/docViewer.ts
 */
type RafHost = { requestAnimationFrame: (cb: FrameRequestCallback) => number };
type RafPopup = RafHost & { closed: boolean };
const lenders = new WeakMap<RafHost, { native: RafHost["requestAnimationFrame"]; popups: Set<RafPopup> }>();

export function lendPopupFrames(host: RafHost, popup: RafPopup): () => void {
  let entry = lenders.get(host);
  if (!entry) {
    const native = host.requestAnimationFrame; // ตัวเดิมเป๊ะ (คืนตัวนี้ ไม่ใช่สำเนาที่ bind แล้ว)
    const popups = new Set<RafPopup>();
    entry = { native, popups };
    lenders.set(host, entry);
    host.requestAnimationFrame = (cb) => {
      for (const p of popups) if (!p.closed) return p.requestAnimationFrame(cb);
      return native.call(host, cb);
    };
  }
  entry.popups.add(popup);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const e = lenders.get(host);
    if (!e) return;
    e.popups.delete(popup);
    if (e.popups.size === 0) {
      host.requestAnimationFrame = e.native;
      lenders.delete(host);
    }
  };
}
