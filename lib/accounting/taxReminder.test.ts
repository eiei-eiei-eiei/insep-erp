import { describe, it, expect } from "vitest";
import { taxRemindersFor, reminderMessage, REMINDER_ITEMS, type ReminderInput } from "./taxReminder";

/**
 * golden A18 — เตือนกำหนดยื่นภาษีเข้า LINE (D88)
 *
 * 🚨 สิ่งที่เทสชุดนี้ปกป้อง:
 *   · ผู้จด VAT ต้องได้เตือน **ทุกเดือน** แม้เดือนนั้นไม่มียอด (ยอดศูนย์ก็ต้องยื่น)
 *   · เดือนที่ไม่มีการหัก ณ ที่จ่าย **ต้องไม่เตือน** (ไม่มีหน้าที่ยื่น = เตือนไปก็กวน)
 *   · ภงด.3 กับ ภงด.53 ต้องเป็น **บรรทัดเดียว** (ยื่นวันเดียวกัน ปุ่มสร้างแบบเดียวกัน)
 *   · key กันส่งซ้ำต้องนิ่ง — เปลี่ยนสูตร key เมื่อไหร่ ลูกค้าจะได้ข้อความซ้ำทั้งชุด
 */

const base: ReminderInput = {
  todayISO: "2026-09-12",
  entityId: "EID01",
  isVat: true,
  hasWht: () => true,
  filed: () => false,
};
const make = (o: Partial<ReminderInput>): ReminderInput => ({ ...base, ...o });

describe("วันที่ยิงเตือน", () => {
  it("12 ก.ย. → เตือน ภพ.30 ของงวด ส.ค. (ครบกำหนด 15 ก.ย.)", () => {
    const r = taxRemindersFor(make({ todayISO: "2026-09-12" }));
    expect(r.map((x) => `${x.id}:${x.period}`)).toEqual(["vat:2026-08"]);
  });

  it("4 ก.ย. → เตือน ภงด.3/53 ของงวด ส.ค. (ครบกำหนด 7 ก.ย.)", () => {
    const r = taxRemindersFor(make({ todayISO: "2026-09-04" }));
    expect(r.map((x) => `${x.id}:${x.period}`)).toEqual(["wht:2026-08"]);
  });

  it("วันอื่นไม่เตือนอะไรเลย (ไม่ใช่ส่งทุกวันจนคนเลิกอ่าน)", () => {
    for (const d of ["2026-09-01", "2026-09-05", "2026-09-13", "2026-09-20", "2026-09-30"]) {
      expect(taxRemindersFor(make({ todayISO: d })), d).toEqual([]);
    }
  });

  it("🪤 ข้ามปี — 4 ม.ค. เตือน ภงด. ของงวด ธ.ค. ปีก่อน · 12 ม.ค. เตือน ภพ.30 งวด ธ.ค.", () => {
    expect(taxRemindersFor(make({ todayISO: "2027-01-04" }))[0].period).toBe("2026-12");
    expect(taxRemindersFor(make({ todayISO: "2027-01-12" }))[0].period).toBe("2026-12");
  });

  it("ปรับ leadDays ได้ และยังเจองวดถูกแม้วันเตือนถอยข้ามเดือน", () => {
    // ภงด. ครบกำหนด 7 ก.ย. · เตือนล่วงหน้า 10 วัน = 28 ส.ค. (อยู่ในเดือนของงวดเอง)
    const r = taxRemindersFor(make({ todayISO: "2026-08-28", leadDays: 10 }));
    expect(r.map((x) => `${x.id}:${x.period}`)).toEqual(["wht:2026-08"]);
  });
});

describe("ใครควรได้รับ", () => {
  it("🚨 จด VAT = เตือน ภพ.30 ทุกเดือน แม้ไม่มียอดต้องชำระ (ยอดศูนย์ก็ต้องยื่น)", () => {
    const r = taxRemindersFor(make({ todayISO: "2026-09-12", hasWht: () => false }));
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("vat");
  });

  it("ไม่จด VAT = ไม่เตือน ภพ.30 เลย (D55)", () => {
    expect(taxRemindersFor(make({ todayISO: "2026-09-12", isVat: false }))).toEqual([]);
  });

  it("ไม่จด VAT แต่ยังเตือน ภงด. — หัก ณ ที่จ่ายไม่เกี่ยวกับการจด VAT", () => {
    const r = taxRemindersFor(make({ todayISO: "2026-09-04", isVat: false }));
    expect(r.map((x) => x.id)).toEqual(["wht"]);
  });

  it("เดือนที่ไม่มีการหัก ณ ที่จ่าย → ไม่เตือน ภงด.", () => {
    expect(taxRemindersFor(make({ todayISO: "2026-09-04", hasWht: () => false }))).toEqual([]);
  });

  it("สร้างแบบของงวดนั้นไปแล้ว → ไม่เตือนซ้ำ", () => {
    expect(taxRemindersFor(make({ todayISO: "2026-09-12", filed: () => true }))).toEqual([]);
    expect(taxRemindersFor(make({ todayISO: "2026-09-04", filed: () => true }))).toEqual([]);
  });

  it("ดู report_key ให้ตรงงวด — สร้างของงวดอื่นแล้วไม่ทำให้งวดนี้เงียบ", () => {
    const r = taxRemindersFor(
      make({ todayISO: "2026-09-12", filed: (_k, p) => p === "2026-07" }),
    );
    expect(r.map((x) => x.period)).toEqual(["2026-08"]);
  });
});

describe("รูปแบบข้อความ", () => {
  it("ภงด.3/53 เป็นบรรทัดเดียว ไม่แยก 2 บรรทัด", () => {
    const r = taxRemindersFor(make({ todayISO: "2026-09-04" }));
    expect(r).toHaveLength(1);
    expect(r[0].line).toContain("ภงด.3/53");
  });

  it("บอกวันครบกำหนดทั้งกระดาษและออนไลน์ · ไม่มียอดเงิน", () => {
    const line = taxRemindersFor(make({ todayISO: "2026-09-12" }))[0].line;
    expect(line).toContain("15 ก.ย.");
    expect(line).toContain("23 ก.ย.");
    expect(line).not.toMatch(/บาท|\d{1,3},\d{3}/);
  });

  it("🚨 key กันส่งซ้ำผูกกับ กิจการ + รายการ + งวด (เปลี่ยนสูตร = ลูกค้าโดนส่งซ้ำทั้งชุด)", () => {
    const r = taxRemindersFor(make({ todayISO: "2026-09-12", entityId: "EID02" }));
    expect(r[0].key).toBe("EID02-vat-2026-08");
  });

  it("id ของรายการต้องไม่เปลี่ยน (เป็นส่วนหนึ่งของ key ที่บันทึกไว้แล้ว)", () => {
    expect(REMINDER_ITEMS.map((i) => i.id)).toEqual(["vat", "wht"]);
  });

  it("กิจการเดียว = ไม่ใส่ชื่อกิจการนำหน้า · หลายกิจการ = ใส่", () => {
    const blocks = [{ entityName: "โรงกลั่น A", lines: ["• x"] }];
    expect(reminderMessage(blocks, { multiEntity: false })).not.toContain("โรงกลั่น A");
    expect(reminderMessage(blocks, { multiEntity: true })).toContain("[โรงกลั่น A]");
  });

  it("กิจการที่ไม่มีอะไรต้องเตือน ไม่โผล่ในข้อความ", () => {
    const msg = reminderMessage(
      [
        { entityName: "A", lines: [] },
        { entityName: "B", lines: ["• y"] },
      ],
      { multiEntity: true },
    );
    expect(msg).not.toContain("[A]");
    expect(msg).toContain("[B]");
  });
});
