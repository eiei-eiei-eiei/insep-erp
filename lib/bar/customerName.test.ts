import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { customerLabel, customerNameParts } from "./customerName";

/**
 * golden **B15** — ชื่อลูกค้าบนจอ (D97)
 *
 * 🚨 ข้อที่ชุดนี้ล็อกไว้เหนืออย่างอื่น: **ชื่อเล่นห้ามหลุดลงกระดาษ**
 *    ใบเสร็จ/ใบกำกับภาษีต้องเป็นชื่อผู้ซื้อจริง — "พี่โอ๊ต" ไม่ใช่คู่สัญญาของใคร
 */

describe("ชื่อที่แสดงบนจอ", () => {
  it("มีทั้งคู่ → ชื่อเล่นเป็นตัวเด่น ชื่อจริงอยู่ในวงเล็บ", () => {
    expect(customerLabel({ name: "สมชาย ใจดี", nickname: "พี่โอ๊ต" })).toBe("พี่โอ๊ต (สมชาย ใจดี)");
    expect(customerNameParts({ name: "สมชาย ใจดี", nickname: "พี่โอ๊ต" })).toEqual({
      head: "พี่โอ๊ต",
      paren: "สมชาย ใจดี",
    });
  });

  /**
   * 🚨 เคสที่ผู้ใช้บอกเองว่าจะใช้บ่อยที่สุด — ลูกค้าทั่วไปจะพิมพ์ชื่อเล่นลงช่อง *ชื่อ*
   *    ไปเลยเพราะไม่ขอใบกำกับ ⇒ ช่องชื่อเล่นว่างคือ **สภาพปกติ ไม่ใช่ข้อมูลขาด**
   */
  it("🚨 ไม่มีชื่อเล่น → ชื่อจริงล้วน **ห้ามมีวงเล็บว่าง**", () => {
    expect(customerLabel({ name: "พี่โอ๊ต", nickname: null })).toBe("พี่โอ๊ต");
    expect(customerLabel({ name: "พี่โอ๊ต", nickname: "   " })).toBe("พี่โอ๊ต");
    expect(customerLabel({ name: "พี่โอ๊ต" })).not.toContain("(");
  });

  it("🪤 ชื่อเล่นซ้ำกับชื่อจริง → แสดงครั้งเดียว", () => {
    expect(customerLabel({ name: "พี่โอ๊ต", nickname: "พี่โอ๊ต" })).toBe("พี่โอ๊ต");
    expect(customerLabel({ name: " พี่โอ๊ต ", nickname: "พี่โอ๊ต" })).toBe("พี่โอ๊ต");
  });

  it("🪤 มีแต่ชื่อเล่น (ข้อมูลเก่า/นำเข้า) → ใช้ชื่อเล่น ไม่ใช่ค่าว่าง", () => {
    expect(customerLabel({ name: "", nickname: "พี่โอ๊ต" })).toBe("พี่โอ๊ต");
  });

  it("ไม่มีอะไรเลย → คืนค่าว่าง (ให้หน้าจอเลือกคำแทนเอง)", () => {
    expect(customerLabel(null)).toBe("");
    expect(customerLabel({})).toBe("");
  });
});

/* ── ชั้นที่ TypeScript มองไม่ทะลุ: ใครเรียกไฟล์นี้ได้บ้าง ────────────────────
 *
 * 🚩 การเผลอเอา `customerLabel()` ไปใช้ตอนประกอบเอกสารคือโค้ดที่ **ถูกต้องทุกบรรทัด
 *    แค่ผิดที่** — build/lint/test ปกติผ่านหมด แต่ใบกำกับภาษีจะพิมพ์ว่า
 *    "พี่โอ๊ต (สมชาย ใจดี)" เป็นชื่อผู้ซื้อ ซึ่งใช้ยื่นไม่ได้
 *    (ชั้นเดียวกับ `isolation.test.ts` ของ D96 · `tenantTables.test.ts` ของ D79)
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("🚩 ชื่อเล่นห้ามหลุดลงกระดาษ", () => {
  it("🚨 ชั้นเอกสาร (receipt/print80) ต้องไม่ import ตัวช่วยนี้เลย", () => {
    for (const f of ["lib/bar/receipt.ts", "lib/bar/print80.ts"]) {
      expect(read(f), `${f} ห้ามรู้จัก customerName`).not.toContain("customerName");
    }
  });

  it("🚨 จุดที่ประกอบ `buyer` ส่งลง `buildReceipt()` ต้องใช้ชื่อจริงล้วน", () => {
    for (const f of [
      "app/(app)/bar/_components/PosTab.tsx",
      "app/(app)/bar/_components/HistoryTab.tsx",
    ]) {
      const src = read(f);
      // ★ ตรวจ **โค้ดจริง** ไม่ใช่คำในไฟล์ — ไฟล์พวกนี้ใช้ customerLabel() บนจอได้
      //   (บทเรียน D92/D95: จับชื่อ constant แล้วไปเจอบรรทัด import = ผ่านด้วยเหตุผลผิด)
      const buyer = src.match(/buyer:\s*cust\s*\?\s*\{[^}]*\}/s);
      expect(buyer, `${f} หาบรรทัด buyer: ไม่เจอ — โครงเปลี่ยนไปแล้ว ต้องตรวจใหม่`).toBeTruthy();
      expect(buyer![0]).toContain("name: cust.name");
      expect(buyer![0]).not.toContain("customerLabel");
      expect(buyer![0]).not.toContain("nickname");
    }
  });
});
