import { describe, it, expect } from "vitest";
import { branchLabel, companyFromEntity, pickDocEntity, EMPTY_COMPANY, type EntityDocRow } from "./company";

/**
 * S9 — ข้อความหัวเอกสารการค้าต้องประกอบออกมา "รูปแบบเดิมเป๊ะ"
 * ของเดิมคือ constant ใน print.ts รูปแบบนี้:
 *   name      "บริษัท ตัวอย่าง จำกัด"
 *   nameEng   "EXAMPLE CO.,LTD."
 *   address   "(สำนักงานใหญ่) 5/15 ม.8 …"
 *   taxLine   "เลขประจำตัวผู้เสียภาษี (Tax ID): 0000000000000 | โทร: 0X-XXX-XXXX"
 *   bank      "ธนาคาร… เลขที่บัญชี …\nชื่อบัญชี …"
 * (ใช้ข้อมูลสมมติ — ค่าจริงของแต่ละกิจการอยู่ในตาราง entities ไม่ใช่ในโค้ด)
 */
const full: EntityDocRow = {
  entity_id: "EID01",
  name: "บริษัท ตัวอย่าง จำกัด",
  name_eng: "EXAMPLE CO.,LTD.",
  tax_id: "0000000000000",
  branch: "สำนักงานใหญ่",
  address: "5/15 ม.8 ต.ท่าน้ำอ้อย อ.พยุหะคีรี จ.นครสวรรค์ 60130",
  phone: "08-8888-8888",
  bank_line: "ธนาคารตัวอย่าง เลขที่บัญชี 000-0-00000-0\nชื่อบัญชี บริษัท ตัวอย่าง จำกัด",
};

describe("branchLabel (S9)", () => {
  it.each([
    ["สำนักงานใหญ่", "(สำนักงานใหญ่)"],
    ["  สำนักงานใหญ่  ", "(สำนักงานใหญ่)"],
    ["สาขา สำนักงานใหญ่", "(สำนักงานใหญ่)"],
    ["00002", "(สาขาที่ 00002)"],
    ["2", "(สาขาที่ 2)"],
    ["สาขาลาดพร้าว", "(สาขาลาดพร้าว)"],
    ["", ""],
  ])("branchLabel(%j) = %j", (input, expected) => {
    expect(branchLabel(input)).toBe(expected);
  });
  it("null/undefined = ว่าง", () => {
    expect(branchLabel(null)).toBe("");
    expect(branchLabel(undefined)).toBe("");
  });
});

describe("companyFromEntity (S9)", () => {
  it("ข้อมูลครบ → ทุกบรรทัดตามรูปแบบเดิม", () => {
    expect(companyFromEntity(full)).toEqual({
      name: "บริษัท ตัวอย่าง จำกัด",
      nameEng: "EXAMPLE CO.,LTD.",
      address: "(สำนักงานใหญ่) 5/15 ม.8 ต.ท่าน้ำอ้อย อ.พยุหะคีรี จ.นครสวรรค์ 60130",
      taxLine: "เลขประจำตัวผู้เสียภาษี (Tax ID): 0000000000000 | โทร: 08-8888-8888",
      bank: "ธนาคารตัวอย่าง เลขที่บัญชี 000-0-00000-0\nชื่อบัญชี บริษัท ตัวอย่าง จำกัด",
    });
  });

  it("ไม่มีเบอร์โทร → ไม่มีคั่น | ค้างท้าย", () => {
    expect(companyFromEntity({ ...full, phone: null }).taxLine).toBe("เลขประจำตัวผู้เสียภาษี (Tax ID): 0000000000000");
  });

  it("ไม่มีเลขภาษี แต่มีโทร → เหลือเฉพาะโทร", () => {
    expect(companyFromEntity({ ...full, tax_id: "" }).taxLine).toBe("โทร: 08-8888-8888");
  });

  it("ไม่มีทั้งเลขภาษีและโทร → บรรทัดว่าง (print จะไม่ขึ้นบรรทัดเปล่า)", () => {
    expect(companyFromEntity({ ...full, tax_id: null, phone: null }).taxLine).toBe("");
  });

  it("สาขาว่าง → ที่อยู่ไม่มีช่องว่างนำหน้า", () => {
    expect(companyFromEntity({ ...full, branch: "" }).address).toBe("5/15 ม.8 ต.ท่าน้ำอ้อย อ.พยุหะคีรี จ.นครสวรรค์ 60130");
  });

  it("ที่อยู่ว่าง แต่มีสาขา → เหลือเฉพาะวงเล็บสาขา ไม่มีช่องว่างท้าย", () => {
    expect(companyFromEntity({ ...full, address: null }).address).toBe("(สำนักงานใหญ่)");
  });

  it("ตัดช่องว่างหัวท้ายทุกช่อง", () => {
    const c = companyFromEntity({ ...full, name: "  บริษัท ตัวอย่าง จำกัด  ", name_eng: " EXAMPLE CO.,LTD. " });
    expect(c.name).toBe("บริษัท ตัวอย่าง จำกัด");
    expect(c.nameEng).toBe("EXAMPLE CO.,LTD.");
  });

  it("ไม่มีแถว → ค่าว่างทั้งชุด", () => {
    expect(companyFromEntity(null)).toEqual(EMPTY_COMPANY);
    expect(companyFromEntity(undefined)).toEqual(EMPTY_COMPANY);
  });
});

describe("pickDocEntity (S9)", () => {
  const a = { entity_id: "EID01", name: "กิจการ ก" };
  const b = { entity_id: "EID02", name: "กิจการ ข" };

  it("ตั้งค่าไว้ → ได้กิจการนั้น", () => {
    expect(pickDocEntity([a, b], "EID02")).toBe(b);
  });
  it("ไม่ได้ตั้งค่า + มีกิจการเดียว → ใช้กิจการนั้น", () => {
    expect(pickDocEntity([a], "")).toBe(a);
    expect(pickDocEntity([a], null)).toBe(a);
  });
  it("ไม่ได้ตั้งค่า + หลายกิจการ → null (ห้ามเดาให้ — หัวกระดาษผิดนิติบุคคล)", () => {
    expect(pickDocEntity([a, b], "")).toBeNull();
  });
  it("ตั้งค่าเป็นกิจการที่มองไม่เห็น (RLS) + หลายกิจการ → null", () => {
    expect(pickDocEntity([a, b], "EID99")).toBeNull();
  });
  it("ตั้งค่าเป็นกิจการที่มองไม่เห็น + เหลือกิจการเดียว → ใช้กิจการนั้น", () => {
    expect(pickDocEntity([a], "EID99")).toBe(a);
  });
  it("ไม่มีกิจการเลย → null", () => {
    expect(pickDocEntity([], "EID01")).toBeNull();
    expect(pickDocEntity(null, "EID01")).toBeNull();
  });
});
