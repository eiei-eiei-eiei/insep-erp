/**
 * แท็บลูกหนี้-เจ้าหนี้ — ล็อก 2 ข้อที่เจอตอนเทสเบราว์เซอร์ D123 (คอมโพเนนต์เทสตรง ๆ ไม่ได้ จึงอ่านซอร์ส)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("app/(app)/accounting/_components/ApArTab.tsx", "utf8");

describe("ApArTab — แถวชำระ (D123)", () => {
  it("🪤 เปิดแถวชำระใหม่ต้องล้างบัญชี/วันที่ — ไม่เติมค่าของบิลใบก่อนให้", () => {
    const fn = src.slice(src.indexOf("function toggleSettle"), src.indexOf("function doSettle"));
    expect(fn).toMatch(/setAcc\(""\)/);
    expect(fn).toMatch(/setPayDate\(todayISO\(\)\)/);
    // ปุ่มชำระต้องเปิดผ่าน toggleSettle เท่านั้น ห้ามเซ็ต settleId ตรง ๆ (ข้ามการล้างค่า)
    expect(src).toMatch(/onClick=\{\(\) => toggleSettle\(r\.transactionId\)\}/);
    expect(src.match(/setSettleId\(r\.transactionId/g)).toBeNull();
  });

  it("ข้อความผลลัพธ์ต้องมีที่แสดงนอกแถวชำระ (แถวปิดตอนสำเร็จ)", () => {
    expect(src).toMatch(/settleId === null && <Msg msg=\{msg\} \/>/);
  });
});
