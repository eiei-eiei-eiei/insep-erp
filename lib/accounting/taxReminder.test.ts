import { describe, it, expect } from "vitest";
import { taxRemindersFor, reminderMessage, REMINDER_ITEMS, type ReminderInput } from "./taxReminder";

/**
 * golden A18 — เตือนกำหนดยื่นภาษีเข้า LINE (D88 · ขยายเป็น 3 จังหวะ + วิธียื่น ที่ D95)
 *
 * 🚨 สิ่งที่เทสชุดนี้ปกป้อง:
 *   · ผู้จด VAT ต้องได้เตือน **ทุกเดือน** แม้เดือนนั้นไม่มียอด (ยอดศูนย์ก็ต้องยื่น)
 *   · เดือนที่ไม่มีการหัก ณ ที่จ่าย **ต้องไม่เตือน** (ไม่มีหน้าที่ยื่น = เตือนไปก็กวน)
 *   · ภงด.3 กับ ภงด.53 ต้องเป็น **บรรทัดเดียว** (ยื่นวันเดียวกัน ปุ่มสร้างแบบเดียวกัน)
 *   · key กันส่งซ้ำต้องนิ่ง — เปลี่ยนสูตร key เมื่อไหร่ ลูกค้าจะได้ข้อความซ้ำทั้งชุด
 *     🚨 โดยเฉพาะจังหวะ `pre` ที่ **ต้องเท่ากับรูปแบบเดิมของ D88 เป๊ะ**
 *   · ตัวปิดเสียงคือ **"ยื่นแล้ว"** ไม่ใช่ "กดพิมพ์แล้ว" (ต้นเรื่องทั้งหมดของ D95)
 */

const base: ReminderInput = {
  todayISO: "2026-09-12",
  entityId: "EID01",
  isVat: true,
  hasWht: () => true,
  submitted: () => false,
  method: null,
};
const make = (o: Partial<ReminderInput>): ReminderInput => ({ ...base, ...o });
const ids = (i: ReminderInput) => taxRemindersFor(i).map((x) => `${x.id}:${x.period}:${x.stage}`);

describe("วันที่ยิงเตือน — ยังไม่ได้ตั้งวิธียื่น (ใช้กำหนดกระดาษ)", () => {
  it("12 ก.ย. → เตือนล่วงหน้า ภพ.30 ของงวด ส.ค. (ครบกำหนดกระดาษ 15 ก.ย.)", () => {
    expect(ids(make({ todayISO: "2026-09-12" }))).toEqual(["vat:2026-08:pre"]);
  });

  it("15 ก.ย. → จังหวะ 'วันสุดท้าย' ของ ภพ.30 งวด ส.ค.", () => {
    expect(ids(make({ todayISO: "2026-09-15" }))).toEqual(["vat:2026-08:due"]);
  });

  it("16 ก.ย. → จังหวะ 'เลยกำหนดแล้ว' ครั้งเดียว · 17 ก.ย. เงียบ (ไม่วนซ้ำจนคนเลิกอ่าน)", () => {
    expect(ids(make({ todayISO: "2026-09-16" }))).toEqual(["vat:2026-08:late"]);
    expect(ids(make({ todayISO: "2026-09-17" }))).toEqual([]);
  });

  it("4 / 7 / 8 ก.ย. → ภงด.3/53 ของงวด ส.ค. ครบ 3 จังหวะ (ครบกำหนดกระดาษ 7 ก.ย.)", () => {
    expect(ids(make({ todayISO: "2026-09-04" }))).toEqual(["wht:2026-08:pre"]);
    expect(ids(make({ todayISO: "2026-09-07" }))).toEqual(["wht:2026-08:due"]);
    expect(ids(make({ todayISO: "2026-09-08" }))).toEqual(["wht:2026-08:late"]);
  });

  it("วันอื่นไม่เตือนอะไรเลย (ไม่ใช่ส่งทุกวันจนคนเลิกอ่าน)", () => {
    for (const d of ["2026-09-01", "2026-09-05", "2026-09-13", "2026-09-20", "2026-09-30"]) {
      expect(ids(make({ todayISO: d })), d).toEqual([]);
    }
  });

  it("🪤 ข้ามปี — 4 ม.ค. เตือน ภงด. ของงวด ธ.ค. ปีก่อน · 12 ม.ค. เตือน ภพ.30 งวด ธ.ค.", () => {
    expect(taxRemindersFor(make({ todayISO: "2027-01-04" }))[0].period).toBe("2026-12");
    expect(taxRemindersFor(make({ todayISO: "2027-01-12" }))[0].period).toBe("2026-12");
  });

  it("ปรับ leadDays ได้ และยังเจองวดถูกแม้วันเตือนถอยข้ามเดือน", () => {
    // ภงด. ครบกำหนด 7 ก.ย. · เตือนล่วงหน้า 10 วัน = 28 ส.ค. (อยู่ในเดือนของงวดเอง)
    expect(ids(make({ todayISO: "2026-08-28", leadDays: 10 }))).toEqual(["wht:2026-08:pre"]);
  });

  it("🪤 leadDays = 0 → pre ชนกับ due ต้องเหลือข้อความเดียว (จังหวะที่หนักกว่าชนะ)", () => {
    expect(ids(make({ todayISO: "2026-09-15", leadDays: 0 }))).toEqual(["vat:2026-08:due"]);
  });
});

describe("วิธียื่นของกิจการ (D95)", () => {
  it("ยื่นออนไลน์ → วันสุดท้ายของ ภพ.30 เลื่อนไป 23 ก.ย. (12 ก.ย. ไม่ใช่วันเตือนของ ภพ.30 อีกต่อไป)", () => {
    // ★ 12 ก.ย. ยังมี ภงด. อยู่ (ออนไลน์ครบกำหนด 15 ก.ย. → เตือนล่วงหน้า 12 ก.ย. พอดี)
    //   — เขียนให้เห็นชัดว่าแต่ละแบบเลื่อนของตัวเอง ไม่ใช่เลื่อนพร้อมกันทั้งชุด
    expect(ids(make({ todayISO: "2026-09-12", method: "efiling" }))).toEqual(["wht:2026-08:pre"]);
    expect(ids(make({ todayISO: "2026-09-20", method: "efiling" }))).toEqual(["vat:2026-08:pre"]);
    expect(ids(make({ todayISO: "2026-09-23", method: "efiling" }))).toEqual(["vat:2026-08:due"]);
    expect(ids(make({ todayISO: "2026-09-24", method: "efiling" }))).toEqual(["vat:2026-08:late"]);
  });

  it("ยื่นกระดาษ = เหมือนค่าปริยาย (ไม่ตั้งก็ใช้กำหนดกระดาษ เพราะมาก่อนเสมอ)", () => {
    expect(ids(make({ todayISO: "2026-09-12", method: "paper" }))).toEqual(
      ids(make({ todayISO: "2026-09-12", method: null })),
    );
  });

  it("ยื่นออนไลน์ → ภงด. วันสุดท้ายเป็น 15 ก.ย. (ชนวันของ ภพ.30 กระดาษพอดี แต่คนละกิจการคนละตั้งค่า)", () => {
    expect(ids(make({ todayISO: "2026-09-15", method: "efiling" }))).toEqual(["wht:2026-08:due"]);
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
    expect(taxRemindersFor(make({ todayISO: "2026-09-04", isVat: false })).map((x) => x.id)).toEqual(["wht"]);
  });

  it("เดือนที่ไม่มีการหัก ณ ที่จ่าย → ไม่เตือน ภงด.", () => {
    expect(taxRemindersFor(make({ todayISO: "2026-09-04", hasWht: () => false }))).toEqual([]);
  });

  it("🚨 บันทึกว่า 'ยื่นแล้ว' → เงียบทั้ง 3 จังหวะ", () => {
    for (const d of ["2026-09-12", "2026-09-15", "2026-09-16"]) {
      expect(taxRemindersFor(make({ todayISO: d, submitted: () => true })), d).toEqual([]);
    }
  });

  it("🚨 ภงด. ยื่นข้างเดียว (ภงด.3 แต่ไม่ ภงด.53) → ยังต้องเตือน (คนละใบ ยื่นแยกจ่ายแยก)", () => {
    const only3 = taxRemindersFor(
      make({ todayISO: "2026-09-04", submitted: (k) => k === "pnd3" }),
    );
    expect(only3.map((x) => x.id)).toEqual(["wht"]);
    const both = taxRemindersFor(
      make({ todayISO: "2026-09-04", submitted: (k) => k === "pnd3" || k === "pnd53" }),
    );
    expect(both).toEqual([]);
  });

  it("ดูงวดให้ตรง — ยื่นของงวดอื่นแล้วไม่ทำให้งวดนี้เงียบ", () => {
    const r = taxRemindersFor(make({ todayISO: "2026-09-12", submitted: (_k, p) => p === "2026-07" }));
    expect(r.map((x) => x.period)).toEqual(["2026-08"]);
  });
});

describe("รูปแบบข้อความ", () => {
  it("ภงด.3/53 เป็นบรรทัดเดียว ไม่แยก 2 บรรทัด", () => {
    const r = taxRemindersFor(make({ todayISO: "2026-09-04" }));
    expect(r).toHaveLength(1);
    expect(r[0].line).toContain("ภงด.3/53");
  });

  it("ยังไม่ตั้งวิธียื่น → บอกทั้ง 2 กำหนด **และบอกว่ายังไม่ได้ตั้ง** · ไม่มียอดเงิน", () => {
    const line = taxRemindersFor(make({ todayISO: "2026-09-12" }))[0].line;
    expect(line).toContain("15 ก.ย.");
    expect(line).toContain("23 ก.ย.");
    expect(line).toContain("ยังไม่ได้ตั้งวิธียื่น");
    expect(line).not.toMatch(/บาท|\d{1,3},\d{3}/);
  });

  it("🚨 ตั้งวิธียื่นแล้ว → บอก **วันเดียว** ของวิธีนั้น (เลิกบอกวันที่ไม่เกี่ยวกับกิจการนี้)", () => {
    const paper = taxRemindersFor(make({ todayISO: "2026-09-12", method: "paper" }))[0].line;
    expect(paper).toContain("15 ก.ย.");
    expect(paper).not.toContain("23 ก.ย.");
    const efile = taxRemindersFor(make({ todayISO: "2026-09-20", method: "efiling" }))[0].line;
    expect(efile).toContain("23 ก.ย.");
    expect(efile).not.toContain("15 ก.ย.");
  });

  it("🚨 key จังหวะ pre ต้องเป็นรูปแบบเดิมของ D88 เป๊ะ (ไม่งั้นลูกค้าโดนส่งซ้ำทั้งชุด)", () => {
    const r = taxRemindersFor(make({ todayISO: "2026-09-12", entityId: "EID02" }));
    expect(r[0].key).toBe("EID02-vat-2026-08");
  });

  it("key ของจังหวะใหม่ต่อท้ายชื่อจังหวะ — ไม่ชนกับของเดิมที่จดไว้แล้ว", () => {
    expect(taxRemindersFor(make({ todayISO: "2026-09-15" }))[0].key).toBe("EID01-vat-2026-08-due");
    expect(taxRemindersFor(make({ todayISO: "2026-09-16" }))[0].key).toBe("EID01-vat-2026-08-late");
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

  it("🚨 หัวข้อความต้องตรงกับจังหวะ — ไม่งั้นข้อความโกหกบรรทัดที่อยู่ข้างใน", () => {
    const blocks = [{ entityName: "A", lines: ["• x"] }];
    expect(reminderMessage(blocks, { multiEntity: false, stage: "pre", leadDays: 3 })).toContain("อีก 3 วัน");
    expect(reminderMessage(blocks, { multiEntity: false, stage: "due" })).toContain("วันนี้วันสุดท้าย");
    expect(reminderMessage(blocks, { multiEntity: false, stage: "late" })).toContain("เลยกำหนด");
  });

  it("จำนวนวันในหัวข้อความคิดจาก leadDays ห้ามฮาร์ดโค้ด (กติกา D92)", () => {
    const blocks = [{ entityName: "A", lines: ["• x"] }];
    expect(reminderMessage(blocks, { multiEntity: false, stage: "pre", leadDays: 7 })).toContain("อีก 7 วัน");
  });

  it("ทุกจังหวะต้องบอกว่าต้องไปกดอะไรถึงจะหยุดเตือน (D83)", () => {
    const blocks = [{ entityName: "A", lines: ["• x"] }];
    for (const stage of ["pre", "due", "late"] as const) {
      expect(reminderMessage(blocks, { multiEntity: false, stage }), stage).toContain("ยื่นแล้ว");
    }
  });
});
