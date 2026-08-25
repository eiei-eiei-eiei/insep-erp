import { describe, it, expect } from "vitest";
import { forwardCatsOf, isForwardCat, DEFAULT_FORWARD_CATS } from "./forwardCats";

describe("หมวดจุดชนวนรับวัตถุดิบ (D80)", () => {
  it("ยังไม่ตั้งค่า → ใช้ค่าปริยาย 'วัตถุดิบผลิตสุรา'", () => {
    expect(forwardCatsOf(null)).toEqual(["วัตถุดิบผลิตสุรา"]);
    expect(forwardCatsOf([])).toEqual([...DEFAULT_FORWARD_CATS]);
    expect(forwardCatsOf(["  ", ""])).toEqual([...DEFAULT_FORWARD_CATS]);
  });

  it("ตั้งเองแล้ว → ใช้ของลูกค้าล้วน ๆ ไม่เอาค่าปริยายมาปน", () => {
    expect(forwardCatsOf(["ค่าต้นทุนสินค้า"])).toEqual(["ค่าต้นทุนสินค้า"]);
    expect(forwardCatsOf(["ค่าต้นทุนสินค้า", "ค่าบรรจุภัณฑ์"])).toEqual(["ค่าต้นทุนสินค้า", "ค่าบรรจุภัณฑ์"]);
  });

  it("เทียบชื่อแบบ trim — ห้าม fuzzy (สะกดต่างนิดเดียวต้องไม่จุดชนวน)", () => {
    const cats = ["วัตถุดิบผลิตสุรา"];
    expect(isForwardCat("วัตถุดิบผลิตสุรา", cats)).toBe(true);
    expect(isForwardCat("  วัตถุดิบผลิตสุรา  ", cats)).toBe(true);
    expect(isForwardCat("วัตถุดิบผลิตสุราฯ", cats)).toBe(false);
    expect(isForwardCat("วัตถุดิบ", cats)).toBe(false);
  });

  it("🚨 หมวดว่างต้องไม่จุดชนวน (ผู้ใช้ยังไม่ได้เลือกหมวด = ห้ามรับของเข้าสต็อก)", () => {
    expect(isForwardCat("", ["วัตถุดิบผลิตสุรา"])).toBe(false);
    expect(isForwardCat("   ", ["วัตถุดิบผลิตสุรา"])).toBe(false);
  });
});
