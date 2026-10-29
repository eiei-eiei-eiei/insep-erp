/**
 * golden C7 — คู่ค้าใหม่จากบิล + งานรายแถว (D141 รอบ 3)
 */
import { describe, it, expect } from "vitest";
import { newContactRow, findExistingContact, CONTACT_TYPE_OF, nameKey, ilikeExact } from "./contact";
import { rankJobs, similarJob, jobSummary } from "./jobs";
import { checkBill, type BillDraft, type BillContext } from "./bill";

describe("C7 — คู่ค้าใหม่", () => {
  it("มีเลขภาษี + สำนักงานใหญ่ → แถวพร้อมบันทึก (สาขาแบบเดียวกับฟอร์มในแอป)", () => {
    expect(newContactRow({ name: " บริษัท มหาจักร อินดัสเตรียลบรัชส์ จำกัด ", tax_id: "0105551103594", branch: "สำนักงานใหญ่", address: "กทม." }, "รายจ่าย"))
      .toEqual({ name: "บริษัท มหาจักร อินดัสเตรียลบรัชส์ จำกัด", tax_id: "0105551103594", branch: "สำนักงานใหญ่", address: "กทม.", contact_type: "ผู้ขาย" });
  });

  it("สาขาเป็นตัวเลข → เติม 0 ครบ 5 หลัก · ไม่ส่งสาขา = สำนักงานใหญ่", () => {
    expect(newContactRow({ name: "ไทวัสดุ", tax_id: "0105555021215", branch: "152" }, "รายจ่าย")).toMatchObject({ branch: "00152" });
    expect(newContactRow({ name: "ไทวัสดุ", tax_id: "0105555021215" }, "รายจ่าย")).toMatchObject({ branch: "สำนักงานใหญ่" });
  });

  it("🐛 รอบ 4: สาขาทุกรูปที่หมายถึงสำนักงานใหญ่ → 'สำนักงานใหญ่' (ไม่ใช่ 00000)", () => {
    for (const b of ["สำนักงานใหญ่", "สำนักงานใหญ่ (00000)", "Head Office", "head office", "สนญ.", "HQ", "00000", "0"]) {
      expect(newContactRow({ name: "x", tax_id: "0105551103594", branch: b }, "รายจ่าย"), b).toMatchObject({ branch: "สำนักงานใหญ่" });
    }
  });

  it("รอบ 4: สาขาที่มีคำนำหน้า → เลขสาขา 5 หลัก", () => {
    for (const b of ["สาขาที่ 00152", "สาขา 152", "Branch 152", "Branch No. 00152", "152"]) {
      expect(newContactRow({ name: "x", tax_id: "0105555021215", branch: b }, "รายจ่าย"), b).toMatchObject({ branch: "00152" });
    }
  });

  it("รอบ 4: สาขาอ่านไม่ออก = บอกรูปที่รับให้ชัด (ไม่เดาว่าเป็นสำนักงานใหญ่)", () => {
    expect(newContactRow({ name: "x", tax_id: "0105555021215", branch: "สาขาบางนา" }, "รายจ่าย")).toMatch(/อ่านไม่ออก — ใส่ "สำนักงานใหญ่" หรือเลขสาขา/);
  });

  it("ร้านเล็กไม่มีเลขภาษี → ไม่มีสาขา (ไม่พิมพ์วงเล็บสาขา)", () => {
    expect(newContactRow({ name: "ร้านป้าแดง" }, "รายจ่าย")).toMatchObject({ tax_id: null, branch: null });
  });

  it("🚨 เลขภาษีอ่านผิดหลัก = ไม่ยอมเพิ่ม (เลขผิดจะติดไปทุกบิลถัดไป)", () => {
    expect(newContactRow({ name: "x", tax_id: "0105551103595" }, "รายจ่าย")).toMatch(/ไม่ผ่านการตรวจหลักสุดท้าย/);
    expect(newContactRow({ name: "x", tax_id: "123" }, "รายจ่าย")).toMatch(/13 หลัก/);
    expect(newContactRow({ name: " " }, "รายจ่าย")).toMatch(/คู่ค้าใหม่/);
  });

  it("ประเภทคู่ค้าตามประเภทบิล", () => {
    expect(CONTACT_TYPE_OF.รายรับ).toBe("ลูกค้า");
  });

  it("หาตัวที่มีอยู่: เลขภาษี + สาขา (152 = 00152) · คนละสาขา = คนละคู่ค้า · ไม่มีเลข = เทียบชื่อ", () => {
    const all = [
      { contact_id: "C-0001", name: "บริษัท ซีอาร์ซี ไทวัสดุ จำกัด", tax_id: "0105555021215", branch: "152" },
      { contact_id: "C-0002", name: "ร้านป้าแดง", tax_id: null, branch: null },
    ];
    const row = (nc: Parameters<typeof newContactRow>[0]) => newContactRow(nc, "รายจ่าย") as Exclude<ReturnType<typeof newContactRow>, string>;
    expect(findExistingContact(row({ name: "ไทวัสดุ อุทัย", tax_id: "0105555021215", branch: "00152" }), all)?.contact_id).toBe("C-0001");
    expect(findExistingContact(row({ name: "ไทวัสดุ", tax_id: "0105555021215", branch: "153" }), all)).toBeNull();
    expect(findExistingContact(row({ name: "ร้านป้าแดง" }), all)?.contact_id).toBe("C-0002");
  });
});

describe("C7 — งาน", () => {
  it("งานของคู่ค้าเจ้านี้ก่อน แล้วตามด้วยงานที่ใช้บ่อย · ไม่ซ้ำ · ตัดค่าว่าง", () => {
    expect(rankJobs(["บ่อปลา"], ["บาร์", "บาร์", "", "เครื่องล้างส้ม", "บ่อปลา"])).toEqual(["บ่อปลา", "บาร์", "เครื่องล้างส้ม"]);
  });

  it("ชื่อใกล้กัน = เตือน · ชื่อเดิมเป๊ะ = ไม่เตือน · ไม่เกี่ยวกัน = ไม่เตือน", () => {
    const ex = ["บาร์ค็อกเทล", "บ่อปลา"];
    expect(similarJob("บาร์", ex)).toBe("บาร์ค็อกเทล");
    expect(similarJob("บ่อ ปลา", ex)).toBe("บ่อปลา");
    expect(similarJob("บ่อปลา", ex)).toBeNull();
    expect(similarJob("โรงงาน", ex)).toBeNull();
    expect(similarJob("บ", ex)).toBeNull();
  });

  it("สรุปงานของบิล", () => {
    expect(jobSummary([{}, {}])).toEqual({ kind: "none_set" });
    expect(jobSummary([{ job: "บาร์" }, { job: "บาร์" }])).toEqual({ kind: "single", job: "บาร์" });
    expect(jobSummary([{ job_none: true }, { job_none: true }])).toEqual({ kind: "no_job" });
    expect(jobSummary([{ job: "บาร์" }, { job: "บ่อปลา" }, { job_none: true }])).toEqual({ kind: "multi", count: 2 });
    expect(jobSummary([{ job: "บาร์" }, {}, {}])).toEqual({ kind: "partial", missing: [2, 3] });
  });
});

describe("C7 — ด่านงานใน checkBill", () => {
  const ctx = (jobsRequired: boolean): BillContext => ({
    entities: [{ entity_id: "EID01", name: "บริษัท", is_vat: true }], accounts: ["ก"], forwardCats: [],
    categories: { รายจ่าย: ["ค่าวัสดุ"], รายรับ: [] }, today: "2026-10-28", jobsRequired,
  });
  const d = (items: BillDraft["items"]): BillDraft => ({
    entity_id: "EID01", type: "รายจ่าย", transaction_date: "2026-10-27", category: "ค่าวัสดุ", account_name: "ก",
    price_mode: "ex", has_vat: false, items, total_on_bill: items.reduce((s, it) => s + it.quantity * it.unit_price, 0),
  });

  it("กิจการที่เคยใช้งาน: แถวที่ยังไม่เลือกงาน = ไม่ยอมบันทึก พร้อมบอกแถว", () => {
    const r = checkBill(d([{ name: "ก", quantity: 1, unit_price: 10, job: "บาร์" }, { name: "ข", quantity: 1, unit_price: 5 }]), ctx(true));
    expect(r.payload).toBeNull();
    expect(r.errors.join()).toMatch(/รายการที่ 2 \(ข\) ยังไม่ได้เลือกงาน/);
  });

  it("หลายงานในบิลเดียว → บันทึกงานรายแถว", () => {
    const r = checkBill(d([{ name: "ก", quantity: 1, unit_price: 10, job: "บาร์" }, { name: "ข", quantity: 1, unit_price: 5, job: "บ่อปลา" }]), ctx(true));
    expect(r.payload!.items.map((x) => x.item_job)).toEqual(["บาร์", "บ่อปลา"]);
  });

  it("🚨 ไม่ระบุงาน = ผ่านด่าน แต่บันทึกเป็นค่าว่าง (ไม่ใช่คำว่า ไม่ระบุงาน)", () => {
    const r = checkBill(d([{ name: "ก", quantity: 1, unit_price: 10, job: "ไม่ระบุงาน", job_none: true }]), ctx(true));
    expect(r.errors).toEqual([]);
    expect(r.payload!.items[0].item_job).toBe("");
  });

  it("กิจการที่ไม่เคยใช้งาน: ไม่บังคับ", () => {
    expect(checkBill(d([{ name: "ก", quantity: 1, unit_price: 10 }]), ctx(false)).errors).toEqual([]);
  });
});

describe("C8 — รอบ 7: หลายบิลของร้านเดียวกันที่ไม่มีเลขภาษี", () => {
  const row = (nc: Parameters<typeof newContactRow>[0]) => newContactRow(nc, "รายจ่าย") as Exclude<ReturnType<typeof newContactRow>, string>;
  it("ชื่อเทียบไม่สนตัวพิมพ์/ช่องว่างซ้อน (Shopee = SHOPEE)", () => {
    const all = [{ contact_id: "C-0067", name: "Shopee", tax_id: null, branch: null }];
    expect(findExistingContact(row({ name: " SHOPEE " }), all)?.contact_id).toBe("C-0067");
    expect(findExistingContact(row({ name: "Shopee  Mall" }), [{ contact_id: "C-1", name: "shopee mall", tax_id: null, branch: null }])?.contact_id).toBe("C-1");
    expect(nameKey("  A  b ")).toBe("a b");
  });
  it("ชื่อที่มีเลขภาษีในทะเบียน ไม่ถูกผูกด้วยชื่ออย่างเดียว (คนละสาขา/คนละบริษัทชื่อซ้ำได้)", () => {
    expect(findExistingContact(row({ name: "Shopee" }), [{ contact_id: "C-9", name: "Shopee", tax_id: "0105555021215", branch: "สำนักงานใหญ่" }])).toBeNull();
  });
  it("ilikeExact กัน % _ และแบ็กสแลช กลายเป็น wildcard", () => {
    expect(ilikeExact("50%_off")).toBe(String.raw`50\%\_off`);
    expect(ilikeExact(String.raw`a\b`)).toBe(String.raw`a\\b`);
    expect(ilikeExact(" ร้านป้าแดง ")).toBe("ร้านป้าแดง");
  });
});
