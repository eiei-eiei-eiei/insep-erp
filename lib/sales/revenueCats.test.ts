import { describe, expect, it } from "vitest";
import {
  DEFAULT_REVENUE_CATS,
  defaultRevenueCat,
  revenueCatHint,
  revenueCatOptions,
  revenueCatsOf,
} from "./revenueCats";

describe("S17 revenueCats — ประเภทรายได้ของแอปขายมาจากหมวดหมู่รายรับของบัญชี (D148)", () => {
  it("ยังไม่ตั้ง = 4 ตัวเดิมเป๊ะ (พฤติกรรมเดิม)", () => {
    expect(revenueCatsOf([])).toEqual(["รายได้ค่าสินค้า", "รายได้ค่าบริการ", "รายได้ค่าที่ปรึกษา", "รายได้อื่น ๆ"]);
    expect(defaultRevenueCat([])).toBe("รายได้ค่าสินค้า");
  });

  it("ตั้งแล้วใช้ลิสต์ที่ตั้ง ตามลำดับ · ตัดค่าว่าง/ซ้ำ/ช่องว่างหัวท้าย", () => {
    expect(revenueCatsOf([" ขายสุรา ", "", "ค่าเวิร์กช็อป", "ขายสุรา"])).toEqual(["ขายสุรา", "ค่าเวิร์กช็อป"]);
  });

  it("ลิสต์มีแต่ค่าว่าง = ถือว่ายังไม่ตั้ง", () => {
    expect(revenueCatsOf(["", "  "])).toEqual(DEFAULT_REVENUE_CATS);
  });

  it("ค่าปริยาย = รายได้ค่าสินค้า ถ้ายังอยู่ในลิสต์ ไม่งั้นตัวแรก", () => {
    expect(defaultRevenueCat(["ค่าบริการ", "รายได้ค่าสินค้า"])).toBe("รายได้ค่าสินค้า");
    expect(defaultRevenueCat(["ขายสุรา", "ค่าเวิร์กช็อป"])).toBe("ขายสุรา");
  });

  it("แก้ใบเก่าที่หมวดหลุดจากลิสต์ไปแล้ว = หมวดเดิมยังอยู่ในตัวเลือก (ต่อหัว)", () => {
    expect(revenueCatOptions(["ขายสุรา"], "รายได้ค่าที่ปรึกษา")).toEqual(["รายได้ค่าที่ปรึกษา", "ขายสุรา"]);
    expect(revenueCatOptions(["ขายสุรา"], "ขายสุรา")).toEqual(["ขายสุรา"]);
    expect(revenueCatOptions(["ขายสุรา"], "")).toEqual(["ขายสุรา"]);
  });

  it("ค่าปริยายต้องอยู่ในตัวเลือกเสมอ", () => {
    for (const set of [[], ["ขายสุรา"], ["a", "รายได้ค่าสินค้า"]]) {
      expect(revenueCatOptions(set)).toContain(defaultRevenueCat(set));
    }
  });

  it("คำอธิบาย: ยังไม่ตั้ง → บอกว่าไปตั้งที่ไหน · ไม่มีโมดูลบัญชี → ไม่พูดถึงบัญชี", () => {
    expect(revenueCatHint([], "รายได้ค่าสินค้า", true)).toContain("บัญชี → ตั้งค่า → หมวดหมู่รายรับ");
    expect(revenueCatHint([], "รายได้ค่าสินค้า", true)).toContain("ค่าเริ่มต้น");
    expect(revenueCatHint([], "รายได้ค่าสินค้า", false)).toBe("");
    expect(revenueCatHint(["ขายสุรา"], "ขายสุรา", true)).toContain("หมวดหมู่รายรับ");
  });

  it("คำอธิบาย: หมวดเดิมหลุดลิสต์ → บอกตรง ๆ", () => {
    expect(revenueCatHint(["ขายสุรา"], "รายได้ค่าบริการ", true)).toContain("ไม่อยู่ในหมวดหมู่รายรับ");
  });
});
