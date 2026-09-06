import { describe, it, expect } from "vitest";
import { effectiveTaxAccounts, taxAccountsAreDefault } from "./taxAccounts";

// ── A19: บัญชีที่นับเข้าระบบภาษี ───────────────────────────────────────────────
//
// 🚩 ต้นเรื่อง: ค่าปริยายเดิมเป็นชื่อตายตัว "บัญชีบริษัท" → ลูกค้าที่ตั้งชื่อบัญชีอื่น
//    ถูกกรองบิลออกหมด แดชบอร์ดและ ภพ.30 ขึ้น 0 โดยไม่มีคำอธิบาย
describe("A19 effectiveTaxAccounts", () => {
  const banks = ["กสิกร ออมทรัพย์", "เงินสดหน้าร้าน"];

  it("ตั้งเองไว้แล้ว → ใช้ที่ตั้งเท่านั้น (ไม่เอาบัญชีอื่นมารวม)", () => {
    const s = effectiveTaxAccounts(["บัญชีบริษัท", "กสิกร insep"], banks);
    expect([...s].sort()).toEqual(["กสิกร insep", "บัญชีบริษัท"]);
    expect(s.has("กสิกร ออมทรัพย์")).toBe(false); // บัญชีส่วนตัวต้องถูกคัดออกได้เหมือนเดิม
  });

  it("🚩 ยังไม่ได้ตั้ง → นับทุกบัญชีเงิน ไม่ใช่เดาชื่อ 'บัญชีบริษัท'", () => {
    const s = effectiveTaxAccounts([], banks);
    expect(s.has("กสิกร ออมทรัพย์")).toBe(true);
    expect(s.has("บัญชีบริษัท")).toBe(false);
  });

  it("ไม่มีทั้งคู่ → เซตว่าง (ไม่มีบิลไหนมีชื่อบัญชีว่างอยู่แล้ว)", () => {
    expect(effectiveTaxAccounts([], []).size).toBe(0);
  });

  it("ตัดช่องว่าง/ค่าว่างทิ้งทั้งสองฝั่ง", () => {
    expect([...effectiveTaxAccounts([" ", ""], ["  ก  ", ""])]).toEqual(["ก"]);
  });

  it("taxAccountsAreDefault บอกได้ว่ากำลังใช้ค่าปริยายอยู่หรือเปล่า", () => {
    expect(taxAccountsAreDefault([])).toBe(true);
    expect(taxAccountsAreDefault([" "])).toBe(true);
    expect(taxAccountsAreDefault(["บัญชีบริษัท"])).toBe(false);
  });
});
