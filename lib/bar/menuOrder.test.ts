import { describe, it, expect } from "vitest";
import {
  ALL_VIEW,
  menuOrderError,
  menuOrderUpdates,
  menuQtyMap,
  moveMenu,
  moveMenuToTop,
  orderColumn,
  orderLockedReason,
  orderableMenus,
  salesHint,
} from "./menuOrder";
import { sortMenusForGrid } from "./menuFilter";
import type { BarMenu } from "./types";

/** golden **B18** — จัดลำดับเมนูบนหน้าขายเอง แยกกันต่อหน้า (D108) */

const m = (id: string, over: Partial<BarMenu> = {}): BarMenu => ({
  menuId: id,
  name: id,
  price: 100,
  categoryId: "cocktail",
  recipe: [],
  ...over,
});

const MENUS = [
  m("A", { name: "Negroni", categoryId: "cocktail", sort: 0, sortAll: 2 }),
  m("B", { name: "Martini", categoryId: "cocktail", sort: 1, sortAll: 0 }),
  m("C", { name: "จินช็อต", categoryId: "shot", sort: 0, sortAll: 1 }),
  m("D", { name: "ปิด", categoryId: "shot", active: false }),
  m("X", { name: "เมรัย", categoryId: "custom" }),
];

describe("🚨 แต่ละหน้าตั้งแยกกัน ไม่มีผลต่อกัน (ผู้ใช้เลือก)", () => {
  it("หน้า 'ทั้งหมด' เรียงด้วย sortAll", () => {
    const out = sortMenusForGrid(MENUS.filter((x) => x.active !== false), [], "all").map((x) => x.menuId);
    expect(out).toEqual(["B", "C", "A", "X"]);
  });
  it("หน้าหมวดเรียงด้วย sort — ไม่สนใจ sortAll", () => {
    const cocktail = MENUS.filter((x) => x.categoryId === "cocktail");
    expect(sortMenusForGrid(cocktail, [], "category").map((x) => x.menuId)).toEqual(["A", "B"]);
  });
  it("orderColumn: ทั้งหมด → sort_all · หมวด → sort (server เขียนตามนี้)", () => {
    expect(orderColumn(ALL_VIEW)).toBe("sort_all");
    expect(orderColumn("cocktail")).toBe("sort");
  });
  it("เปลี่ยน sortAll ไม่ทำให้หน้าหมวดขยับ", () => {
    const flipped = MENUS.map((x) => (x.menuId === "A" ? { ...x, sortAll: -5 } : x));
    const cocktail = flipped.filter((x) => x.categoryId === "cocktail");
    expect(sortMenusForGrid(cocktail, [], "category").map((x) => x.menuId)).toEqual(["A", "B"]);
    expect(sortMenusForGrid(flipped.filter((x) => x.active !== false), [], "all")[0].menuId).toBe("A");
  });
});

describe("ลำดับว่าง = ต่อท้ายตามชื่อ", () => {
  it("เมนูใหม่ (ยังไม่มีเลข) ไม่แทรกบนสุดของลำดับที่จัดไว้", () => {
    const list = [m("NEW", { name: "อาอา" }), m("P", { name: "zz", sort: 0 }), m("Q", { name: "aa", sort: 1 })];
    expect(sortMenusForGrid(list, [], "category").map((x) => x.menuId)).toEqual(["P", "Q", "NEW"]);
  });
  it("★ ลูกค้าที่ยังไม่เคยจัด (ว่างทุกตัว) = เรียงตามชื่อเหมือนเดิม", () => {
    const list = [m("2", { name: "Martini" }), m("1", { name: "Gimlet" })];
    expect(sortMenusForGrid(list, [], "all").map((x) => x.menuId)).toEqual(["1", "2"]);
  });
});

describe("รายการที่จัดได้", () => {
  it("หน้า 'ทั้งหมด': ทุกหมวด ยกเว้นเมนูเฉพาะกิจและที่ปิดใช้ · ตามลำดับปัจจุบัน", () => {
    expect(orderableMenus(MENUS, ALL_VIEW).map((x) => x.menuId)).toEqual(["B", "C", "A"]);
  });
  it("หน้าหมวด: เฉพาะหมวดนั้น", () => {
    expect(orderableMenus(MENUS, "shot").map((x) => x.menuId)).toEqual(["C"]);
  });
  it("🚨 หมวดเฉพาะกิจจัดไม่ได้ และต้องบอกเหตุผล", () => {
    expect(orderableMenus(MENUS, "custom")).toEqual([]);
    expect(orderLockedReason("custom")).toMatch(/สั่งล่าสุด/);
    expect(orderLockedReason(ALL_VIEW)).toBe("");
  });
});

describe("เลื่อน", () => {
  it("▲▼ สลับกับตัวข้าง ๆ · ขอบบน/ล่างไม่ขยับ", () => {
    expect(moveMenu(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveMenu(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveMenu(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });
  it("⤒ ขึ้นบนสุด ที่เหลือคงลำดับเดิม", () => {
    expect(moveMenuToTop(["a", "b", "c", "d"], "c")).toEqual(["c", "a", "b", "d"]);
    expect(moveMenuToTop(["a", "b"], "zz")).toEqual(["a", "b"]);
  });
});

describe("ตรวจก่อนเขียน (server)", () => {
  const rows = MENUS.map((x) => ({ menuId: x.menuId, categoryId: x.categoryId }));
  it("ปกติ = ผ่าน", () => {
    expect(menuOrderError(["B", "A", "C"], rows, ALL_VIEW)).toBe("");
    expect(menuOrderError(["B", "A"], rows, "cocktail")).toBe("");
  });
  it("เมนูถูกลบระหว่างนั้น / ซ้ำ / ย้ายหมวด / เฉพาะกิจ = error ไทยบอกให้รีเฟรช", () => {
    expect(menuOrderError(["A", "GONE"], rows, ALL_VIEW)).toMatch(/รีเฟรช/);
    expect(menuOrderError(["A", "A"], rows, ALL_VIEW)).toMatch(/ซ้ำ/);
    expect(menuOrderError(["A", "C"], rows, "cocktail")).toMatch(/ย้ายหมวด/);
    expect(menuOrderError(["A", "X"], rows, ALL_VIEW)).toMatch(/สั่งล่าสุด/);
    expect(menuOrderError(["X"], rows, "custom")).toMatch(/สั่งล่าสุด/);
    expect(menuOrderError([], rows, ALL_VIEW)).not.toBe("");
  });
  it("เขียนเฉพาะแถวที่เลขเปลี่ยน เป็น 0,1,2,…", () => {
    const cur = new Map<string, number | null>([["A", 0], ["B", 5], ["C", null]]);
    expect(menuOrderUpdates(["A", "B", "C"], cur)).toEqual([
      { menuId: "B", pos: 1 },
      { menuId: "C", pos: 2 },
    ]);
  });
});

describe("ยอดขายช่วยตัดสินใจ", () => {
  it("รวมจำนวนต่อเมนู ไม่นับบรรทัดที่ยกเลิก/ไม่มีเมนู", () => {
    const q = menuQtyMap([
      { menuId: "A", qty: 2, voided: false },
      { menuId: "A", qty: 3, voided: false },
      { menuId: "A", qty: 9, voided: true },
      { menuId: null, qty: 4, voided: false },
    ]);
    expect(q.get("A")).toBe(5);
    expect(q.size).toBe(1);
  });
  it("ป้าย", () => {
    expect(salesHint(1250, 30)).toBe("ขายได้ 1,250 ใน 30 วัน");
    expect(salesHint(undefined, 30)).toBe("ยังไม่มียอดใน 30 วัน");
  });
});
