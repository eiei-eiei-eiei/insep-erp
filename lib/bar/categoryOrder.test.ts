import { describe, it, expect } from "vitest";
import { moveCategory, nextCategorySort, sortUpdates, sameCategorySet } from "./categoryOrder";

describe("moveCategory — ▲▼", () => {
  const ids = ["A", "B", "C"];
  it("เลื่อนขึ้น", () => expect(moveCategory(ids, "B", -1)).toEqual(["B", "A", "C"]));
  it("เลื่อนลง", () => expect(moveCategory(ids, "B", 1)).toEqual(["A", "C", "B"]));
  it("ตัวแรกเลื่อนขึ้นไม่ได้ — คืนเดิม", () => expect(moveCategory(ids, "A", -1)).toEqual(ids));
  it("ตัวท้ายเลื่อนลงไม่ได้ — คืนเดิม", () => expect(moveCategory(ids, "C", 1)).toEqual(ids));
  it("ไม่รู้จัก id — คืนเดิม", () => expect(moveCategory(ids, "X", 1)).toEqual(ids));
  it("ไม่แก้ array ต้นฉบับ", () => {
    moveCategory(ids, "A", 1);
    expect(ids).toEqual(["A", "B", "C"]);
  });
});

describe("nextCategorySort — ต่อท้ายสุดเสมอ", () => {
  it("ยังไม่มีหมวด = 0", () => expect(nextCategorySort([])).toBe(0));
  it("🪤 เคยลบหมวดกลาง ๆ ไปแล้ว ต้องไม่ชนเลขเดิม", () => {
    // เดิม 0,1,2 ลบตัว 1 ทิ้ง → เหลือ 0,2 · ของเก่าให้ length = 2 ชนกับตัวท้าย
    expect(nextCategorySort([0, 2])).toBe(3);
  });
  it("เลขซ้ำอยู่แล้วก็ยังต่อท้าย", () => expect(nextCategorySort([1, 1, 1])).toBe(2));
});

describe("sortUpdates — เขียนเป็น 0,1,2,… เฉพาะแถวที่เปลี่ยน", () => {
  it("สลับ 2 ตัว = เขียน 2 แถว", () => {
    const cur = new Map([["A", 0], ["B", 1], ["C", 2]]);
    expect(sortUpdates(["B", "A", "C"], cur)).toEqual([
      { categoryId: "B", sort: 0 },
      { categoryId: "A", sort: 1 },
    ]);
  });
  it("🪤 เลขซ้ำของเดิมถูกล้างเป็นลำดับต่อเนื่อง", () => {
    const cur = new Map([["A", 0], ["B", 2], ["C", 2]]);
    expect(sortUpdates(["A", "B", "C"], cur)).toEqual([
      { categoryId: "B", sort: 1 },
    ]);
  });
  it("ลำดับเดิมพอดี = ไม่ต้องเขียนอะไร", () => {
    const cur = new Map([["A", 0], ["B", 1]]);
    expect(sortUpdates(["A", "B"], cur)).toEqual([]);
  });
});

describe("sameCategorySet — กันเรียงทับตอนอีกเครื่องเพิ่ม/ลบหมวด", () => {
  it("ชุดเดียวกันต่างลำดับ = ผ่าน", () => expect(sameCategorySet(["B", "A"], ["A", "B"])).toBe(true));
  it("ขาดหมวด = ไม่ผ่าน", () => expect(sameCategorySet(["A"], ["A", "B"])).toBe(false));
  it("เกินหมวด = ไม่ผ่าน", () => expect(sameCategorySet(["A", "B", "C"], ["A", "B"])).toBe(false));
  it("id ซ้ำ = ไม่ผ่าน", () => expect(sameCategorySet(["A", "A"], ["A", "B"])).toBe(false));
});
