import { describe, it, expect } from "vitest";
import { lendPopupFrames } from "./popupFrames";

/** หน้าต่างปลอม: rAF เก็บ callback ไว้ จนกว่าเทสจะสั่ง flush (แท็บที่ซ่อน = ไม่มีวัน flush) */
function fakeWin(closed = false) {
  const queue: FrameRequestCallback[] = [];
  return {
    closed,
    queue,
    requestAnimationFrame(cb: FrameRequestCallback) {
      queue.push(cb);
      return queue.length;
    },
    flush() {
      queue.splice(0).forEach((cb) => cb(0));
    },
  };
}

describe("lendPopupFrames (D105 — บั๊กค้าง 'กำลังเตรียมภาพ' บนมือถือ)", () => {
  it("ระหว่างยืม rAF ของหน้าต่างแอป (ที่ถูกซ่อน) วิ่งไปที่หน้าต่างเอกสาร", () => {
    const host = fakeWin();
    const popup = fakeWin();
    lendPopupFrames(host, popup);
    let ran = false;
    host.requestAnimationFrame(() => (ran = true));
    expect(host.queue).toHaveLength(0); // ไม่ไปรอแท็บที่ซ่อน
    popup.flush();
    expect(ran).toBe(true);
  });

  it("คืนแล้วกลับเป็นของเดิมเป๊ะ", () => {
    const host = fakeWin();
    const original = host.requestAnimationFrame;
    const release = lendPopupFrames(host, fakeWin());
    expect(host.requestAnimationFrame).not.toBe(original);
    release();
    expect(host.requestAnimationFrame).toBe(original);
  });

  it("หน้าต่างเอกสารปิดไปแล้ว = ใช้ของเดิม (ไม่ส่งไปหน้าต่างที่ตายแล้ว)", () => {
    const host = fakeWin();
    const popup = fakeWin();
    lendPopupFrames(host, popup);
    popup.closed = true;
    host.requestAnimationFrame(() => {});
    expect(host.queue).toHaveLength(1);
    expect(popup.queue).toHaveLength(0);
  });

  it("เปิด 2 หน้าต่างพร้อมกัน: ปิดอันแรก อันที่ 2 ยังยืมอยู่ · ปิดครบถึงคืนของเดิม", () => {
    const host = fakeWin();
    const original = host.requestAnimationFrame;
    const a = fakeWin();
    const b = fakeWin();
    const ra = lendPopupFrames(host, a);
    const rb = lendPopupFrames(host, b);
    ra();
    host.requestAnimationFrame(() => {});
    expect(b.queue).toHaveLength(1);
    rb();
    expect(host.requestAnimationFrame).toBe(original);
  });

  it("เรียกคืนซ้ำไม่พัง และไม่ไปคืนของคนอื่น", () => {
    const host = fakeWin();
    const ra = lendPopupFrames(host, fakeWin());
    const b = fakeWin();
    lendPopupFrames(host, b);
    ra();
    ra();
    host.requestAnimationFrame(() => {});
    expect(b.queue).toHaveLength(1);
  });
});
