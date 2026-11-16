import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { addError, countText, sectionOf } from "./settingsList";

/** หน้าตั้งค่าแบบ ก (D173 เฟส 4a) — กติกา 6 ข้อใน DESIGN_SYSTEM "หน้าตั้งค่า" */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("sectionOf — หัวข้อที่เปิด", () => {
  it("หัวข้อที่ขอมายังมีอยู่ → ใช้ตามนั้น", () => {
    expect(sectionOf(["a", "b", "c"], "b")).toBe("b");
  });
  it("หัวข้อที่ขอมาไม่มีแล้ว (โมดูล/สิทธิ์เปลี่ยน · ลิงก์เก่า) → หัวข้อแรก ไม่ใช่หน้าว่าง", () => {
    expect(sectionOf(["a", "b"], "forward")).toBe("a");
    expect(sectionOf(["a", "b"], null)).toBe("a");
    expect(sectionOf(["a", "b"], "")).toBe("a");
  });
  it("ไม่มีหัวข้อเลย → ค่าว่าง", () => {
    expect(sectionOf([], "a")).toBe("");
  });
});

describe("addError — ค่าที่จะเพิ่มเข้ารายการ", () => {
  it("ว่าง / มีแต่ช่องว่าง → ไม่ส่งไป server", () => {
    expect(addError([], "")).toBeTruthy();
    expect(addError(["ก"], "   ")).toBeTruthy();
  });
  it("ซ้ำ — ไม่สนช่องว่างหัวท้ายและตัวพิมพ์", () => {
    expect(addError(["ค่าเช่า"], "ค่าเช่า")).toContain("ค่าเช่า");
    expect(addError(["ค่าเช่า"], " ค่าเช่า ")).toBeTruthy();
    expect(addError(["Rent"], "rent")).toBeTruthy();
  });
  it("ไม่ซ้ำ → เพิ่มได้", () => {
    expect(addError(["ค่าเช่า"], "ค่าน้ำ")).toBeNull();
    expect(addError(["3"], "30")).toBeNull();
  });
});

describe("countText — จำนวนชิดขวาของหัวการ์ด", () => {
  it("ยังโหลดไม่เสร็จ (null) ≠ 0 รายการ → ไม่แสดงอะไร", () => {
    expect(countText(null)).toBe("");
    expect(countText(undefined)).toBe("");
  });
  it("0 ก็แสดง · มีหน่วยเอง · คั่นหลักพัน", () => {
    expect(countText(0)).toBe("0 รายการ");
    expect(countText(3, "บัญชี")).toBe("3 บัญชี");
    expect(countText(1234)).toBe("1,234 รายการ");
  });
});

describe("กติกาแบบ ก ที่ล็อกจากซอร์ส", () => {
  const src = read("lib/shared/settings.tsx");

  it("ข้อ 1 — จอเล็กเป็นดร็อปดาวน์ ไม่ใช่แถบเลื่อนแนวนอน", () => {
    const shell = src.slice(src.indexOf("export function SettingsShell"), src.indexOf("export function SettingsCard"));
    expect(shell).toContain("<select");
    expect(shell).toContain("md:hidden");
    expect(shell).not.toContain("overflow-x-auto");
  });

  it("ข้อ 1 — คอลัมน์เนื้อหาเป็น minmax(0,1fr) (ไม่ดันหน้าให้กว้างเกินจอ · D165)", () => {
    expect(src).toContain("md:grid-cols-[13rem_minmax(0,1fr)]");
  });

  it("ข้อ 2 — หัวการ์ดมี ⓘ ตัวกลาง และจำนวนชิดขวา", () => {
    const card = src.slice(src.indexOf("export function SettingsCard"), src.indexOf("export function ListRow"));
    expect(card).toContain("<Help>{help}</Help>");
    expect(card).toContain("countText(count, unit)");
    expect(card).toContain("ml-auto");
  });

  it("ข้อ 4 — แถวสุดท้ายเป็นช่องเพิ่ม: Enter = เพิ่ม · เพิ่มสำเร็จแล้วเคอร์เซอร์อยู่ช่องเดิม", () => {
    const list = src.slice(src.indexOf("export function SettingsList"));
    expect(list).toContain('e.key === "Enter"');
    expect(list).toContain("isComposing");
    expect(list).toContain("ref.current?.focus()");
    expect(list).toContain("addError(items, val)");
  });

  it("ปุ่มลบในแถวมีชื่อให้โปรแกรมอ่านจอ (ปุ่มไอคอนล้วน)", () => {
    expect(src).toContain("aria-label={`ลบ ${v}`}");
  });

  it("🚨 ไฟล์หน้าตาไม่เรียก action / supabase เอง", () => {
    expect(src).not.toMatch(/from\s+["'][^"']*actions["']/);
    expect(src).not.toContain("supabase");
  });

  it("ทุกหัวข้อ mount ค้าง ซ่อนด้วย hidden (สลับแล้วของที่พิมพ์ไม่หาย)", () => {
    expect(src).toContain('s.key === cur ? "" : "hidden"');
  });
});

describe("หน้าตั้งค่าบัญชี = ตัวอย่างของแบบ ก", () => {
  const tab = read("app/(app)/accounting/_components/SettingsTab.tsx");
  const bank = read("app/(app)/accounting/_components/BankAccountsCard.tsx");

  it("ข้อ 3 — เลิก chip กับ ✕ และลิงก์ตัวหนังสือ แก้ไข/ลบ", () => {
    for (const s of [tab, bank]) {
      expect(s).not.toContain("rounded-full bg-raised");
      expect(s).not.toMatch(/hover:underline">(แก้ไข|ลบ)</);
      expect(s).not.toContain('<table className="tbl">');
    }
    expect(tab).toContain("<SettingsShell");
    expect(tab).toContain("<SettingsList");
    expect(bank).toContain("<SettingsCard");
  });

  it("ข้อ 5 — ลบหมวด/อัตรา ถามก่อนผ่าน useConfirm (เดิมกด ✕ แล้วหายทันที)", () => {
    const cat = tab.slice(tab.indexOf("function CatList"), tab.indexOf("/** ฟอร์มคู่ค้า"));
    expect(cat).toContain("await ask(");
    expect(cat.indexOf("await ask(")).toBeLessThan(cat.indexOf("deleteSettingAction(kind, v)"));
  });

  it("ข้อ 6 — คำเตือนที่ต้องเห็นยังอยู่บนจอ: ค่าปริยายของหมวดรับวัตถุดิบ · บัญชีที่มีรายการลบไม่ได้", () => {
    expect(tab).toContain("emptyHint={`ยังไม่ได้ตั้ง — ระบบใช้");
    expect(bank).toContain("บัญชีที่มีรายการแล้วลบไม่ได้ ให้กด ปิดใช้ แทน");
    expect(bank).toContain("deleteBlockReason(r.usage)");
  });

  it("🪤 หมวดรับวัตถุดิบยังส่ง forwardCatsSet (ที่ตั้งเอง) ไม่ใช่ forwardCats (D80)", () => {
    expect(tab).toContain("initial={boot.forwardCatsSet}");
    expect(tab).not.toContain("initial={boot.forwardCats}");
  });
});
