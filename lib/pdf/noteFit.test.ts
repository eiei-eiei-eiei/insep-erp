import { describe, it, expect } from "vitest";
import { fitNote, noteBaselines, type Measure } from "./noteFit";

/**
 * D94 — ช่องหมายเหตุฟอร์ม ภส.๐๗-๐๒/๑(๑) สุรากลั่น
 *
 * ★ ใช้ตัววัดจำลอง (1 ตัวอักษร = 1 หน่วย × size) เพื่อให้เทสอ่านง่ายและไม่ต้องโหลดฟอนต์จริง
 *   ตัวเลข pt จริงวัดจาก THSARABUN + template จริงแล้วแยกไว้ในเทสท้ายไฟล์
 */
const fake: Measure = (t, size) => t.length * size;

describe("fitNote — ห้ามตัดประโยค", () => {
  it("★ พอดีอยู่แล้วในบรรทัดเดียว = ขนาดเดิมเป๊ะ (ฟอร์มเดือนเก่าหน้าตาไม่ขยับ)", () => {
    const r = fitNote("abc def", fake, { maxW: 100, size: 6.5 });
    expect(r).toEqual({ lines: ["abc def"], size: 6.5, overflow: false });
  });

  it("ยาวเกิน → ขึ้นบรรทัดที่ 2 ตรงช่องว่าง ไม่หั่นกลางคำ", () => {
    const r = fitNote("aaaa bbbb", fake, { maxW: 30, size: 5 });   // 4×5=20 ต่อคำ · 9×5=45 ทั้งประโยค
    expect(r.lines).toEqual(["aaaa", "bbbb"]);
    expect(r.overflow).toBe(false);
  });

  it("🚨 ต่อกันแล้วได้ประโยคเดิมเสมอ — ห้ามมีตัวอักษรหาย", () => {
    const src = "S1/69 ได้ 180.00 ล. 65 ดีกรี · ปรับดีกรี 40 ได้ปริมาณ 292.50 ลิตร";
    const r = fitNote(src, fake, { maxW: 120, size: 6.5, minSize: 5 });
    expect(r.lines.join(" ")).toBe(src);
    // 🚨 ห้ามมี … โผล่มาเด็ดขาด (ต่างจากฟอร์มสุราแช่ที่ตัดท้ายได้)
    expect(r.lines.join("")).not.toContain("…");
  });

  it("2 บรรทัดยังไม่พอที่ขนาดเดิม → ย่อฟอนต์ลงจนพอ", () => {
    // 20 ตัวอักษร · maxW 50 → ที่ 5 ต้องใช้ 2 บรรทัด (10 ตัว/บรรทัด) พอดี
    const r = fitNote("aaaaa bbbbb ccccc ddd", fake, { maxW: 50, size: 6.5, minSize: 4 });
    expect(r.lines.length).toBeLessThanOrEqual(2);
    expect(r.size).toBeLessThan(6.5);
    for (const l of r.lines) expect(fake(l, r.size)).toBeLessThanOrEqual(50);
  });

  it("🚨 ย่อจนสุดแล้วยังไม่พอ = ชูธง overflow แต่ยังคืนข้อความครบ (ไม่ตัด)", () => {
    const src = "aaaa bbbb cccc dddd eeee ffff gggg";
    const r = fitNote(src, fake, { maxW: 20, size: 6.5, minSize: 5, maxLines: 2 });
    expect(r.overflow).toBe(true);
    expect(r.lines.join(" ")).toBe(src);
    expect(r.lines.length).toBeGreaterThan(2);
  });

  it("คำเดี่ยวยาวเกินช่อง ถูกหั่นขึ้นบรรทัดใหม่ ไม่หายไป", () => {
    const r = fitNote("aaaaaaaaaa", fake, { maxW: 25, size: 5, minSize: 5, maxLines: 5 });
    expect(r.lines.join("")).toBe("aaaaaaaaaa");
  });

  it("ข้อความว่าง = ไม่วาดอะไร", () => {
    expect(fitNote("", fake, { maxW: 60, size: 6.5 }).lines).toEqual([]);
    expect(fitNote("   ", fake, { maxW: 60, size: 6.5 }).lines).toEqual([]);
  });
});

describe("noteBaselines — จัดกึ่งกลางรอบ baseline เดิม", () => {
  it("★ 1 บรรทัด = baseline เดิมเป๊ะ", () => {
    expect(noteBaselines(300, 1, 6.5)).toEqual([300]);
  });

  it("🔴 2 บรรทัดต้องไม่ทะลุเส้นตาราง — baseline สูงจากเส้นล่างแค่ 2.59 pt", () => {
    const ABOVE = 9.89, BELOW = 2.59, y = 300, size = 5;
    const [a, b] = noteBaselines(y, 2, size, ABOVE, BELOW);
    expect(a).toBeGreaterThan(b);
    // หมึกบรรทัดบนต้องอยู่ใต้เส้นบน · หมึกบรรทัดล่างต้องอยู่เหนือเส้นล่าง
    expect(a + 0.95 * size).toBeLessThanOrEqual(y + ABOVE);
    expect(b - 0.3 * size).toBeGreaterThanOrEqual(y - BELOW);
  });

  it("🪤 จัดกึ่งกลาง baseline (ของเดิม) จะทะลุเส้นล่าง — เหตุผลที่ต้องส่งกรอบเข้ามา", () => {
    const [, b] = noteBaselines(300, 2, 6.25);      // ไม่ส่ง above/below
    expect(b).toBeLessThan(300 - 2.59);             // ต่ำกว่าเส้นล่างจริง ๆ
  });
});

/** ตัวเลขจริงจากฟอนต์ THSARABUN + template ภส_07-02ทับ1.pdf (วัดด้วย pdf-lib) */
describe("ความกว้างจริงของช่องหมายเหตุ", () => {
  const MAXW = 819.1 - 758.7;   // เส้นแบ่งคอลัมน์ขวาสุด − จุดเริ่มข้อความ

  it("ช่องกว้าง 60.4 pt — ห้ามใช้ขอบกระดาษ (841.8) เป็นขอบช่อง", () => {
    expect(MAXW).toBeCloseTo(60.4, 6);
  });

  /** ความกว้างที่วัดได้จริง @6.5 pt (บันทึกไว้กันสูตรเพี้ยนโดยไม่มีใครเห็น) */
  const REAL: Record<string, number> = {
    "ปรุงปรับดีกรี 40 ได้ปริมาณ 292.50 ลิตร": 69.0,
    "ยกไปแช่สมุนไพรและกลั่นซ้ำ S1/69 (อยู่ระหว่างดำเนินการ)": 100.8,
    "S1/69 ปรับดีกรีเสร็จ 12/10/69": 54.6,
    "S1/69 ได้ 180.00 ล. 65 ดีกรี · ปรับดีกรี 40 ได้ปริมาณ 292.50 ลิตร": 116.5,
  };

  it("🔴 ข้อความอัตโนมัติเดิมล้นช่องอยู่แล้ว 8.6 pt (บั๊กเก่า ไม่ใช่ของ D94)", () => {
    expect(REAL["ปรุงปรับดีกรี 40 ได้ปริมาณ 292.50 ลิตร"]).toBeGreaterThan(MAXW);
  });

  it("ข้อความของ D94 ทุกอันอยู่ในวิสัยที่ 2 บรรทัดรับได้ (< 2 × ช่อง)", () => {
    for (const [s, w] of Object.entries(REAL)) {
      expect(w, `"${s}" ยาวเกิน 2 บรรทัดรับไหว`).toBeLessThan(MAXW * 2);
    }
  });
});
