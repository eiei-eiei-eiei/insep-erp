import { describe, it, expect } from "vitest";
import {
  roundsOf,
  recipeSpent,
  roundToDraft,
  roundLinesText,
  roundBlock,
  filterRecipes,
  deleteBlock,
  deleteConfirmText,
  planUse,
  previewUseCost,
  labSummary,
  labDashboardText,
  type LabUse,
  type LabLine,
  type LabRecipe,
  type LabCategory,
} from "./lab";
import type { BarItem, BarMenu, HouseSlot } from "./types";

/** golden **B26** — ห้องทดลองบาร์ (D129) */

const line = (p: Partial<LabLine>): LabLine => ({
  lineNo: 1, kind: "สูตร", itemId: null, slotId: null, menuId: null, labRecipeId: null,
  label: "", unit: null, qty: 1, cost: 0, ...p,
});
const mkUse = (p: Partial<LabUse>): LabUse => ({
  useId: "LB0001", usedAt: "2026-10-25T10:00:00Z", businessDate: "2026-10-25", categoryId: "trial",
  recipeId: null, roundNo: null, glasses: null, eventName: null, note: null, costTotal: 0, createdBy: "u1", lines: [], ...p,
});

const R1 = mkUse({
  useId: "LB0001", recipeId: "LR1", roundNo: 1, glasses: 1, costTotal: 39.5,
  lines: [
    line({ lineNo: 2, itemId: "SYR", label: "ไซรัปฟักทอง", unit: "ml", qty: 20, cost: 4 }),
    line({ lineNo: 1, itemId: "GORD", slotId: "S-GIN", label: "House Gin (Gordon's)", unit: "ml", qty: 30, cost: 35.5 }),
  ],
});
const R2 = mkUse({ useId: "LB0002", recipeId: "LR1", roundNo: 2, glasses: 2, costTotal: 76, businessDate: "2026-10-26",
  lines: [line({ lineNo: 1, itemId: "GORD", slotId: "S-GIN", label: "House Gin (Gordon's)", unit: "ml", qty: 30 })] });
const CONTENT = mkUse({ useId: "LB0003", categoryId: "content", eventName: "ถ่ายรีลหน้าหนาว", costTotal: 120, businessDate: "2026-10-26",
  lines: [line({ kind: "เมนู", menuId: "M1", label: "Negroni", qty: 2, cost: 120 })] });
const USES = [CONTENT, R1, R2];

describe("B26 · การ์ดสูตร", () => {
  it("รอบใหม่สุดก่อน · ไม่ปนรายการคอนเทนต์", () => {
    expect(roundsOf("LR1", USES).map((u) => u.roundNo)).toEqual([2, 1]);
  });
  it("ทุนพัฒนา = รอบทดลองทั้งหมด", () => {
    expect(recipeSpent("LR1", USES)).toEqual({ rounds: 2, glasses: 3, cost: 115.5 });
    expect(recipeSpent("NOPE", USES)).toEqual({ rounds: 0, glasses: 0, cost: 0 });
  });
  it("สูตรของรอบ → แถวฟอร์ม เรียงตามบรรทัด · ช่อง House กลับเป็นช่องเดิม", () => {
    expect(roundToDraft(R1, [{ slotId: "S-GIN" }])).toEqual([
      { itemId: "", slotId: "S-GIN", qty: 30 },
      { itemId: "SYR", qty: 20 },
    ]);
  });
  it("🪤 ช่อง House ที่ถูกลบไปแล้ว → ใช้ขวดที่ตัดในรอบนั้น (ไม่ทิ้งบรรทัดเงียบ ๆ)", () => {
    expect(roundToDraft(R1, [])[0]).toEqual({ itemId: "GORD", qty: 30 });
  });
  it("ข้อความสูตรใช้ชื่อ/หน่วยที่แช่ไว้ตอนชง", () => {
    expect(roundLinesText(R1)).toBe("House Gin (Gordon's) 30 ml · ไซรัปฟักทอง 20 ml");
  });
  it("เลิกลองแล้ว = ลองรอบใหม่ไม่ได้ · ขึ้นเมนูแล้วยังลองต่อได้", () => {
    expect(roundBlock("เลิกลอง")).toContain("กลับมาลองต่อ");
    expect(roundBlock("กำลังลอง")).toBeNull();
    expect(roundBlock("ขึ้นเมนูแล้ว")).toBeNull();
  });
  it("กรองการ์ด: สถานะ + คำค้น · ใหม่สุดก่อน · ลำดับคงที่", () => {
    const rs: LabRecipe[] = [
      { recipeId: "LR1", name: "ฟักทอง Negroni", status: "กำลังลอง", menuId: null, createdAt: "2026-10-01" },
      { recipeId: "LR2", name: "Yuzu Sour", status: "ขึ้นเมนูแล้ว", menuId: "M9", createdAt: "2026-10-05" },
      { recipeId: "LR3", name: "ฟักทอง Sour", status: "กำลังลอง", menuId: null, createdAt: "2026-10-05" },
    ];
    expect(filterRecipes(rs, "", "กำลังลอง").map((r) => r.recipeId)).toEqual(["LR3", "LR1"]);
    expect(filterRecipes(rs, "sour", "all").map((r) => r.recipeId)).toEqual(["LR3", "LR2"]);
    expect(filterRecipes([...rs].reverse(), "", "all").map((r) => r.recipeId)).toEqual(["LR3", "LR2", "LR1"]);
  });
});

describe("B26 · ลบรายการ (ต้องตรงกับ fn_bar_lab_delete_use)", () => {
  const now = Date.parse("2026-10-25T15:00:00Z");
  it("ผู้มีสิทธิ์ตั้งค่า ลบได้เสมอ", () => {
    expect(deleteBlock({ createdBy: "x", usedAt: "2026-01-01T00:00:00Z" }, "u1", now, true)).toBeNull();
  });
  it("คนที่ลงเอง ภายใน 12 ชม. ลบได้ · เกินแล้วไม่ได้", () => {
    expect(deleteBlock({ createdBy: "u1", usedAt: "2026-10-25T10:00:00Z" }, "u1", now, false)).toBeNull();
    expect(deleteBlock({ createdBy: "u1", usedAt: "2026-10-24T10:00:00Z" }, "u1", now, false)).toContain("เกิน 12 ชั่วโมง");
  });
  it("รายการของคนอื่น ลบไม่ได้", () => {
    expect(deleteBlock({ createdBy: "u2", usedAt: "2026-10-25T14:00:00Z" }, "u1", now, false)).toContain("ตัวเองลง");
    expect(deleteBlock({ createdBy: null, usedAt: "2026-10-25T14:00:00Z" }, null, now, false)).not.toBeNull();
  });
  it("รอบเดียวของสูตร → บอกว่าการ์ดหายด้วย · มีหลายรอบ → ไม่บอก", () => {
    expect(deleteConfirmText(R1, [R1], "ฟักทอง")).toContain("การ์ดสูตรจะหายไปด้วย");
    expect(deleteConfirmText(R1, USES, "ฟักทอง")).not.toContain("การ์ด");
    expect(deleteConfirmText(CONTENT, USES, null)).toContain("คืนเข้าสต็อก");
  });
});

describe("B26 · ใช้เมนูที่มี", () => {
  it("แถวว่างข้าม · กรอกครึ่งเดียว = error · ซ้ำ = error", () => {
    const p = planUse([
      { kind: "menu", id: "M1", qty: 2 },
      { kind: "item", id: "", qty: "" },
      { kind: "item", id: "GORD", qty: "" },
      { kind: "item", id: "", qty: 3 },
      { kind: "menu", id: "M1", qty: 1 },
      { kind: "recipe", id: "LR1", qty: 1 },
    ]);
    expect(p.menus).toEqual([{ menuId: "M1", qty: 2 }]);
    expect(p.recipes).toEqual([{ recipeId: "LR1", qty: 1 }]);
    expect(p.errors).toEqual(["แถว 3: ใส่จำนวนมากกว่า 0", "แถว 4: ยังไม่ได้เลือก", "แถว 5: เลือกซ้ำกับแถวอื่น — รวมเป็นแถวเดียว"]);
  });
  it("พรีวิวทุน: เมนู + สูตรทดลองรอบล่าสุด (ช่องแปลงเป็นขวดตอนนี้) + วัตถุดิบ", () => {
    const items: BarItem[] = [
      { itemId: "GORD", name: "g", unit: "ml", qty: 0, costPerUnit: 1 },
      { itemId: "BOMB", name: "b", unit: "ml", qty: 0, costPerUnit: 2 },
      { itemId: "SYR", name: "s", unit: "ml", qty: 0, costPerUnit: 0.2 },
    ];
    const menus: BarMenu[] = [{ menuId: "M1", name: "x", price: 200, categoryId: "c", recipe: [{ itemId: "GORD", qty: 45 }] }];
    const slots: HouseSlot[] = [{ slotId: "S-GIN", name: "House Gin", itemId: "BOMB", sort: 0 }];
    const p = planUse([
      { kind: "menu", id: "M1", qty: 2 },
      { kind: "recipe", id: "LR1", qty: 1 },
      { kind: "item", id: "SYR", qty: 50 },
    ]);
    // 45×1×2 = 90 · รอบ 2: House Gin 30 → ตอนนี้ Bombay 30×2 = 60 · ไซรัป 50×0.2 = 10
    expect(previewUseCost(p, menus, items, slots, USES)).toBe(160);
  });
});

describe("B26 · สรุปทุน", () => {
  const cats: LabCategory[] = [
    { categoryId: "trial", name: "ทดลองสูตร", sort: 0, isSystem: true },
    { categoryId: "content", name: "ถ่ายคอนเทนต์", sort: 1, isSystem: false },
  ];
  const recs: LabRecipe[] = [{ recipeId: "LR1", name: "ฟักทอง", status: "กำลังลอง", menuId: null, createdAt: "" }];
  it("ตามหมวด/สูตร/งาน เรียงทุนมากสุดก่อน", () => {
    const s = labSummary(USES, cats, recs, "2026-10-01", "2026-10-31");
    expect(s.total).toBe(235.5);
    expect(s.count).toBe(3);
    expect(s.byCategory).toEqual([
      { id: "content", name: "ถ่ายคอนเทนต์", cost: 120, count: 1 },
      { id: "trial", name: "ทดลองสูตร", cost: 115.5, count: 2 },
    ]);
    expect(s.byRecipe).toEqual([{ id: "LR1", name: "ฟักทอง", cost: 115.5, count: 2 }]);
    expect(s.byEvent).toEqual([{ name: "ถ่ายรีลหน้าหนาว", cost: 120, count: 1 }]);
  });
  it("กรองช่วงวันขาย (ทั้งสองขอบนับ)", () => {
    expect(labSummary(USES, cats, recs, "2026-10-25", "2026-10-25").total).toBe(39.5);
    expect(labSummary(USES, cats, recs, "2026-11-01", "2026-11-30").count).toBe(0);
  });
  it("แดชบอร์ด: บอกตรง ๆ ว่าไม่ได้หักกำไร · ไม่มีรายการ = ว่าง", () => {
    const f = (n: number) => n.toFixed(2);
    expect(labDashboardText(labSummary(USES, cats, recs, "2026-10-01", "2026-10-31"), f)).toBe(
      "ใช้ในห้องทดลอง 235.50 บาท (ถ่ายคอนเทนต์ 120.00 · ทดลองสูตร 115.50) — ไม่ได้หักจากกำไรขั้นต้นข้างบน",
    );
    expect(labDashboardText({ total: 0, count: 0, byCategory: [] }, f)).toBe("");
  });
});
