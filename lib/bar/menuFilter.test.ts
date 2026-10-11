import { describe, it, expect } from "vitest";
import { customerMenuIds, applyCustomerChip, sortMenusForGrid, searchMenus } from "./menuFilter";
import type { BarMenu } from "./types";

/**
 * golden **B9** — ชิปกรองรายลูกค้า + เรียงหมวด custom (D96)
 *
 * 🚨 ข้อที่ชุดนี้ล็อกไว้แน่นที่สุด: **ชิปเป็นมุมมอง ไม่ใช่สิทธิ์**
 *    ปิดชิปแล้วต้องเห็นเมนูครบทุกตัว — เมนูของพี่โอ๊ตคนอื่นสั่งได้ปกติ
 *    (พลาดข้อนี้ เมนูจะค่อย ๆ หายจากตะแกรงโดยไม่มีใครรู้สาเหตุ)
 */

const m = (id: string, over: Partial<BarMenu> = {}): BarMenu => ({
  menuId: id,
  name: id,
  price: 100,
  categoryId: "cocktail",
  recipe: [],
  ...over,
});

const MENUS = [
  m("M1", { name: "Negroni", createdFor: "C1", categoryId: "custom" }),
  m("M2", { name: "Martini", categoryId: "cocktail", sort: 1 }),
  m("M3", { name: "Gimlet", categoryId: "cocktail", sort: 2 }),
  m("M4", { name: "ลับของโอ๊ต", createdFor: "C2", categoryId: "custom" }),
];

describe("เมนู 'ของลูกค้าคนนี้' = union ของ 3 ทาง", () => {
  it("สร้างให้ตั้งแต่แรก (createdFor)", () => {
    expect([...customerMenuIds("C1", { menus: MENUS })]).toEqual(["M1"]);
  });

  it("ปักหมุดเป็นของโปรด", () => {
    const ids = customerMenuIds("C1", { menus: MENUS, favMenuIds: ["M2"] });
    expect([...ids].sort()).toEqual(["M1", "M2"]);
  });

  it("เคยสั่ง (ไล่จากประวัติ ไม่ต้องเก็บซ้ำ)", () => {
    const ids = customerMenuIds("C1", {
      menus: MENUS,
      history: [{ menuId: "M3", customerId: "C1", at: "2026-09-01T20:00:00Z", qty: 1 }],
    });
    expect([...ids].sort()).toEqual(["M1", "M3"]);
  });

  it("ประวัติของลูกค้าคนอื่นไม่ปน", () => {
    const ids = customerMenuIds("C1", {
      menus: MENUS,
      history: [{ menuId: "M2", customerId: "C2", at: "2026-09-01T20:00:00Z", qty: 1 }],
    });
    expect([...ids]).toEqual(["M1"]);
  });

  it("ไม่ระบุลูกค้า = เซตว่าง (ไม่ใช่ทุกเมนู)", () => {
    expect(customerMenuIds(null, { menus: MENUS }).size).toBe(0);
    expect(customerMenuIds(undefined, { menus: MENUS }).size).toBe(0);
  });
});

describe("🚨 ชิปกรองเป็นมุมมอง ไม่ใช่สิทธิ์", () => {
  it("เปิดชิป = เห็นเฉพาะของลูกค้าคนนั้น", () => {
    const ids = customerMenuIds("C1", { menus: MENUS });
    expect(applyCustomerChip(MENUS, true, ids).map((x) => x.menuId)).toEqual(["M1"]);
  });

  it("🚨 ปิดชิป = เห็นครบทุกตัวเหมือนเดิมเป๊ะ", () => {
    const ids = customerMenuIds("C1", { menus: MENUS });
    expect(applyCustomerChip(MENUS, false, ids).map((x) => x.menuId)).toEqual(
      MENUS.map((x) => x.menuId),
    );
  });

  it("🚨 เมนูที่สร้างให้คนหนึ่ง คนอื่นยังสั่งได้ — อยู่ในรายการเสมอเมื่อไม่กรอง", () => {
    const idsOfC2 = customerMenuIds("C2", { menus: MENUS });
    const seenByAnyone = applyCustomerChip(MENUS, false, idsOfC2);
    expect(seenByAnyone.some((x) => x.menuId === "M1")).toBe(true); // M1 เป็นของ C1
    expect(seenByAnyone.some((x) => x.menuId === "M4")).toBe(true); // M4 เป็นของ C2
  });

  it("ไม่แก้ array เดิม", () => {
    const out = applyCustomerChip(MENUS, false, new Set());
    expect(out).not.toBe(MENUS);
  });
});

describe("เรียงเมนูในตะแกรง", () => {
  const history = [
    { menuId: "M4", at: "2026-09-10T22:00:00Z", qty: 1 },
    { menuId: "M1", at: "2026-09-01T20:00:00Z", qty: 9 },
  ];

  it("🪤 หมวด custom เรียงตาม **สั่งล่าสุดก่อน** ไม่ใช่ตามตัวอักษร", () => {
    const customs = MENUS.filter((x) => x.categoryId === "custom");
    expect(sortMenusForGrid(customs, history).map((x) => x.menuId)).toEqual(["M4", "M1"]);
  });

  it("ไม่เคยสั่งเลยไปอยู่ท้าย (ไม่ใช่หายไป)", () => {
    const customs = [...MENUS.filter((x) => x.categoryId === "custom"), m("M9", { categoryId: "custom" })];
    const out = sortMenusForGrid(customs, history).map((x) => x.menuId);
    expect(out).toHaveLength(3);
    expect(out[2]).toBe("M9");
  });

  it("สั่งล่าสุดเท่ากัน → ตัดสินด้วยความถี่", () => {
    const a = m("A", { categoryId: "custom" });
    const b = m("B", { categoryId: "custom" });
    const same = "2026-09-10T20:00:00Z";
    const out = sortMenusForGrid([a, b], [
      { menuId: "A", at: same, qty: 1 },
      { menuId: "B", at: same, qty: 5 },
    ]);
    expect(out.map((x) => x.menuId)).toEqual(["B", "A"]);
  });

  it("หมวดปกติเรียงตาม sort ที่ผู้ใช้ตั้ง ไม่ใช่ตามประวัติ", () => {
    const normal = MENUS.filter((x) => x.categoryId === "cocktail");
    expect(sortMenusForGrid(normal, history).map((x) => x.menuId)).toEqual(["M2", "M3"]);
  });

  it("ไม่มีประวัติเลยก็ต้องไม่พัง", () => {
    expect(sortMenusForGrid(MENUS).map((x) => x.menuId)).toHaveLength(4);
  });
});

/**
 * D107 — ตัวเปรียบเทียบเคยวนเป็นวง → Node กับ Chrome เรียงต่างกัน → hydration mismatch ในแท็บขาย
 * ข้อมูลชุดนี้คือของจริงที่ทำให้พัง (เมนูเฉพาะกิจ 2 ตัวไม่มีเลข sort + 1 ตัวมี sort 5)
 */
describe("🔴 เรียงเมนูต้องได้ลำดับเดียวแน่นอนเสมอ (D107)", () => {
  const REAL = [
    m("T-BM01", { name: "Negroni ทดสอบ", categoryId: "T-cocktail", sort: 1 }),
    m("T-BM02", { name: "จินทดสอบ (ขวด)", categoryId: "T-bottle", sort: 2 }),
    m("T-BM03", { name: "จินช็อตทดสอบ", categoryId: "T-shot", sort: 3 }),
    m("T-BM04", { name: "ถั่วทอดทดสอบ", categoryId: "T-food", sort: 4 }),
    m("T-BM05", { name: "ค็อกเทลลับทดสอบ", categoryId: "custom", sort: 5 }),
    m("C-1", { name: "เมรัย", categoryId: "custom" }),
    m("C-2", { name: "เทส", categoryId: "custom" }),
  ];

  /** ทุกการสลับลำดับของ n ตัว */
  function* perms<T>(xs: T[]): Generator<T[]> {
    if (xs.length <= 1) return yield xs;
    for (let i = 0; i < xs.length; i++) {
      for (const p of perms([...xs.slice(0, i), ...xs.slice(i + 1)])) yield [xs[i], ...p];
    }
  }

  it("ข้อมูลเข้ามาลำดับไหนก็ได้ผลเดียวกัน (สลับครบ 5,040 แบบ)", () => {
    const want = sortMenusForGrid(REAL).map((x) => x.menuId).join(",");
    let n = 0;
    for (const p of perms(REAL)) {
      expect(sortMenusForGrid(p).map((x) => x.menuId).join(",")).toBe(want);
      n++;
    }
    expect(n).toBe(5040);
  });

  it("เมนูปกติก่อน (ตามเลข sort) · เมนูเฉพาะกิจไว้ท้าย", () => {
    const out = sortMenusForGrid(REAL).map((x) => x.categoryId);
    expect(out.slice(0, 4)).toEqual(["T-cocktail", "T-bottle", "T-shot", "T-food"]);
    expect(out.slice(4).every((c) => c === "custom")).toBe(true);
  });

  it("ไม่วนเป็นวงอีก: ค็อกเทลลับ ↔ เมรัย ↔ Negroni ตอบสอดคล้องกันทุกคู่", () => {
    const order = sortMenusForGrid(REAL).map((x) => x.name);
    expect(order.indexOf("Negroni ทดสอบ")).toBeLessThan(order.indexOf("เมรัย"));
    expect(order.indexOf("Negroni ทดสอบ")).toBeLessThan(order.indexOf("ค็อกเทลลับทดสอบ"));
  });

  it("ในกลุ่มเฉพาะกิจ: สั่งล่าสุดยังขึ้นก่อนเหมือนเดิม", () => {
    const out = sortMenusForGrid(REAL, [{ menuId: "C-1", at: "2026-10-09T09:27:15Z", qty: 1 }]);
    expect(out[4].menuId).toBe("C-1");
  });

  it("ชื่อซ้ำกันเป๊ะ ตัดสินด้วย menuId (ไม่ปล่อยให้เครื่องยนต์ JS เลือกเอง)", () => {
    const twins = [m("Z", { name: "ซ้ำ", sort: 1 }), m("A", { name: "ซ้ำ", sort: 1 })];
    expect(sortMenusForGrid(twins).map((x) => x.menuId)).toEqual(["A", "Z"]);
    expect(sortMenusForGrid([...twins].reverse()).map((x) => x.menuId)).toEqual(["A", "Z"]);
  });
});

describe("ค้นหาเมนู", () => {
  const searchable = [
    m("S1", { name: "Negroni", note: "ของพี่โอ๊ต ลดเวอร์มุท", glass: "coupe", method: "stir 30 วิ" }),
    m("S2", { name: "Mojito", glass: "highball", method: "muddle" }),
  ];

  it("ค้นจากชื่อ", () => {
    expect(searchMenus(searchable, "negro").map((x) => x.menuId)).toEqual(["S1"]);
  });

  it("🎯 ค้นจากโน้ตได้ — 'ของพี่โอ๊ต' คือวิธีที่คนจริงจำเมนูได้", () => {
    expect(searchMenus(searchable, "โอ๊ต").map((x) => x.menuId)).toEqual(["S1"]);
  });

  it("ค้นจากแก้วและวิธีชงได้", () => {
    expect(searchMenus(searchable, "highball").map((x) => x.menuId)).toEqual(["S2"]);
    expect(searchMenus(searchable, "muddle").map((x) => x.menuId)).toEqual(["S2"]);
  });

  it("คำค้นว่าง = คืนครบ (ไม่ใช่ว่างเปล่า)", () => {
    expect(searchMenus(searchable, "   ")).toHaveLength(2);
  });
});
