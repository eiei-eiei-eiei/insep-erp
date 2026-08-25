import { describe, it, expect } from "vitest";
import {
  buildEnvelope, exportFileName, sheetNameOf, cellSafe, sheetRows, totalRows,
  EXPORT_FORMAT, EXPORT_VERSION, RESTORE_ORDER, RESTORE_SKIP, EXPORT_TABLES,
} from "./tenantExport";

const TENANT = { id: "874aa9ee-0000-0000-0000-000000000001", slug: "rongkor", name: "โรงกลั่นทดสอบ" };

describe("โครงไฟล์ที่ลูกค้าดาวน์โหลด (D82)", () => {
  it("มี format/version/tenant ครบ — สคริปต์ฝั่งเจ้าของใช้ตรวจก่อนเอาข้อมูลกลับ", () => {
    const env = buildEnvelope({ tenant: TENANT, exportedBy: "owner", tables: { entities: [{ entity_id: "EID01" }] } });
    expect(env.format).toBe(EXPORT_FORMAT);
    expect(env.version).toBe(EXPORT_VERSION);
    expect(env.tenant.id).toBe(TENANT.id);
    expect(env.tenant.slug).toBe("rongkor");
    expect(env.exported_by).toBe("owner");
  });

  it("counts ตรงกับจำนวนแถวจริงทุกตาราง", () => {
    const env = buildEnvelope({
      tenant: TENANT, exportedBy: "owner",
      tables: { entities: [{ a: 1 }, { a: 2 }], products: [], transactions: [{ a: 1 }] },
    });
    expect(env.counts).toEqual({ entities: 2, products: 0, transactions: 1 });
    expect(totalRows(env.counts)).toBe(3);
  });

  it("ตารางว่างต้องยังอยู่ในไฟล์ (เป็นรายการว่าง) ไม่ใช่หายไปเฉย ๆ", () => {
    const env = buildEnvelope({ tenant: TENANT, exportedBy: "o", tables: { products: [] } });
    expect(env.tables.products).toEqual([]);
    expect(Object.keys(env.counts)).toContain("products");
  });
});

describe("ชื่อไฟล์", () => {
  it("มีชื่อกิจการและวันเวลาในชื่อไฟล์", () => {
    const n = exportFileName("rongkor", "json", new Date(2026, 7, 25, 14, 30));
    expect(n).toBe("insep-rongkor-2026-08-25-1430.json");
  });

  it("slug ที่มีอักขระต้องห้ามของชื่อไฟล์ ต้องถูกล้าง", () => {
    expect(exportFileName("a/b:c*d", "xlsx", new Date(2026, 0, 2, 3, 4))).toBe("insep-a-b-c-d-2026-01-02-0304.xlsx");
  });

  it("slug ว่าง ต้องไม่ได้ชื่อไฟล์พิกล", () => {
    expect(exportFileName("", "json", new Date(2026, 0, 1, 0, 0))).toBe("insep-tenant-2026-01-01-0000.json");
  });
});

describe("ชื่อชีต Excel (กฎของ Excel ผิดข้อเดียว = ไฟล์เปิดไม่ขึ้น)", () => {
  it("ใช้ชื่อไทยของตาราง", () => {
    expect(sheetNameOf("transactions", new Set())).toBe("บิลบัญชี");
  });

  it("ยาวเกิน 31 ตัวต้องถูกตัด", () => {
    const long = "x".repeat(80);
    expect(sheetNameOf(long, new Set()).length).toBeLessThanOrEqual(31);
  });

  it("ชื่อซ้ำต้องไม่ชนกัน", () => {
    const used = new Set<string>();
    const a = sheetNameOf("transactions", used);
    const b = sheetNameOf("transactions", used);
    expect(b).not.toBe(a);
    expect(b.length).toBeLessThanOrEqual(31);
  });

  it("อักขระต้องห้าม : \\ / ? * [ ] ต้องไม่หลุดออกไป", () => {
    const n = sheetNameOf("a:b/c\\d?e*f[g]h", new Set());
    expect(n).not.toMatch(/[:\\/?*[\]]/);
  });
});

describe("ค่าที่ใส่ช่อง Excel", () => {
  it("🚨 เลขผู้เสียภาษี/เลขบัตร ต้องออกเป็นข้อความ — Excel กินศูนย์นำหน้าและแปลงเป็น scientific notation", () => {
    expect(cellSafe("tax_id", "0105558123456")).toBe("0105558123456");
    expect(cellSafe("national_id", 1030300492837)).toBe("1030300492837");
    expect(cellSafe("excise_id", "1899299384728-1-001")).toBe("1899299384728-1-001");
    expect(cellSafe("sso_employer_no", "0998287365427")).toBe("0998287365427");
  });

  it("ตัวเลขที่เป็นเงินจริง ต้องยังเป็นตัวเลข (เอาไปบวกใน Excel ได้)", () => {
    expect(cellSafe("net_amount", 1234.56)).toBe(1234.56);
    expect(cellSafe("quantity", 25)).toBe(25);
  });

  it("คอลัมน์ jsonb ต้องเป็นข้อความ JSON ไม่ใช่ [object Object]", () => {
    expect(cellSafe("computed", { net: 100, sso: 5 })).toBe('{"net":100,"sso":5}');
    expect(cellSafe("tx_ids", ["a", "b"])).toBe('["a","b"]');
  });

  it("ค่าว่างเป็น null ไม่ใช่คำว่า null", () => {
    expect(cellSafe("note", null)).toBeNull();
    expect(cellSafe("note", undefined)).toBeNull();
  });

  it("boolean คงเป็น boolean", () => {
    expect(cellSafe("is_vat", true)).toBe(true);
  });
});

describe("แปลงตารางเป็นชีต", () => {
  it("แถวแรกเป็นหัวคอลัมน์ แล้วตามด้วยข้อมูลตามลำดับเดิม", () => {
    const out = sheetRows([{ a: 1, b: "x" }, { a: 2, b: "y" }]);
    expect(out[0]).toEqual(["a", "b"]);
    expect(out[1]).toEqual([1, "x"]);
    expect(out[2]).toEqual([2, "y"]);
  });

  it("ตารางว่างต้องได้ชีตที่บอกว่าไม่มีข้อมูล ไม่ใช่ชีตเปล่าที่ดูเหมือนพัง", () => {
    expect(sheetRows([])).toEqual([["(ไม่มีข้อมูล)"]]);
  });
});

describe("รายชื่อตารางของ export/restore", () => {
  it("RESTORE_ORDER ต้องไม่มีตารางที่ตั้งใจข้าม", () => {
    for (const t of RESTORE_SKIP) expect(RESTORE_ORDER).not.toContain(t);
  });

  it("🚨 ไฟล์ export ต้องมีครบทุกตาราง — RESTORE_SKIP ตัดเฉพาะตอนเอากลับ ไม่ใช่ตอนสำรอง", () => {
    for (const t of RESTORE_SKIP) expect(EXPORT_TABLES).toContain(t);
  });

  it("ไม่มี snapshots หลงเหลือ (ตารางถูก drop ใน 0049)", () => {
    expect(EXPORT_TABLES as readonly string[]).not.toContain("snapshots");
    expect(RESTORE_ORDER as readonly string[]).not.toContain("snapshots");
  });
});
