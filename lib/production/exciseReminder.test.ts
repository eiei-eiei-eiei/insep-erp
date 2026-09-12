import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  EXCISE_DUE_DAY,
  EXCISE_REMINDER_ACTION,
  exciseDueDate,
  exciseRemindDate,
  exciseReminderLine,
  exciseRemindersFor,
  exciseReminderMessage,
  reminderHintText,
} from "./exciseReminder";

const NEVER_CLOSED = () => false;

describe("D92 — วันครบกำหนดและวันเตือน", () => {
  it("งบเดือนยื่นภายในวันที่ 15 ของเดือนถัดจากงวด", () => {
    expect(EXCISE_DUE_DAY).toBe(15);
    expect(exciseDueDate("2026-08")).toBe("2026-09-15");
  });

  it("เตือนล่วงหน้า 3 วัน = วันที่ 12", () => {
    expect(exciseRemindDate("2026-08")).toBe("2026-09-12");
  });

  it("🪤 ข้ามปีต้องไม่พัง — งวด ธ.ค. ครบกำหนด ม.ค. ปีถัดไป", () => {
    expect(exciseDueDate("2026-12")).toBe("2027-01-15");
    expect(exciseRemindDate("2026-12")).toBe("2027-01-12");
  });

  it("leadDays เปลี่ยน วันเตือนต้องขยับตาม (รวมกรณีถอยข้ามเดือน)", () => {
    expect(exciseRemindDate("2026-08", 1)).toBe("2026-09-14");
    expect(exciseRemindDate("2026-08", 20)).toBe("2026-08-26");
  });
});

describe("D92 — ใครได้รับการเตือน", () => {
  const base = { todayISO: "2026-09-12", entityId: "EID01", hasExciseId: true, closed: NEVER_CLOSED };

  it("ยังไม่ปิดเดือน + ถึงวันเตือน = เตือน 1 บรรทัดของงวดที่ถูกต้อง", () => {
    const rs = exciseRemindersFor(base);
    expect(rs).toHaveLength(1);
    expect(rs[0].period).toBe("2026-08");
  });

  it("วันอื่นต้องไม่เตือน", () => {
    // ★ D95 — 15 และ 16 ก.ย. ถูกย้ายไปเป็นจังหวะ due/late แล้ว (ดู describe ด้านล่าง)
    for (const d of ["2026-09-11", "2026-09-13", "2026-09-17", "2026-09-30"]) {
      expect(exciseRemindersFor({ ...base, todayISO: d }), d).toEqual([]);
    }
  });

  /**
   * D95 — 3 จังหวะ: จังหวะเดียวแบบ D92 แปลว่า **พลาดวันนั้น = งวดนั้นเงียบตลอดกาล**
   * (เพราะ key ถูกจดใน integration_log ไปแล้ว ไม่มีรอบสอง)
   * 🚨 งบเดือนสรรพสามิต **ไม่มีกำหนดยื่นออนไลน์** → วันสุดท้ายคือ 15 เสมอ ไม่มีตัวเลือกวิธียื่น
   */
  describe("D95 — 3 จังหวะ", () => {
    const stageOn = (d: string) => exciseRemindersFor({ ...base, todayISO: d }).map((r) => r.stage);

    it("12 = ล่วงหน้า · 15 = วันสุดท้าย · 16 = เลยกำหนด (ครั้งเดียว)", () => {
      expect(stageOn("2026-09-12")).toEqual(["pre"]);
      expect(stageOn("2026-09-15")).toEqual(["due"]);
      expect(stageOn("2026-09-16")).toEqual(["late"]);
      expect(stageOn("2026-09-17")).toEqual([]);
    });

    it("🚨 key ของจังหวะ pre ต้องเป็นรูปแบบเดิมของ D92 เป๊ะ (ไม่งั้นส่งซ้ำทั้งชุด)", () => {
      expect(exciseRemindersFor({ ...base, todayISO: "2026-09-12" })[0].key).toBe("EID01-excise-2026-08");
    });

    it("จังหวะใหม่ต่อท้ายชื่อจังหวะ — ไม่ชนกับ key ที่จดไว้แล้ว", () => {
      expect(exciseRemindersFor({ ...base, todayISO: "2026-09-15" })[0].key).toBe("EID01-excise-2026-08-due");
      expect(exciseRemindersFor({ ...base, todayISO: "2026-09-16" })[0].key).toBe("EID01-excise-2026-08-late");
    });

    it("ปิดเดือนแล้วเงียบทุกจังหวะ", () => {
      for (const d of ["2026-09-12", "2026-09-15", "2026-09-16"]) {
        expect(exciseRemindersFor({ ...base, todayISO: d, closed: () => true }), d).toEqual([]);
      }
    });

    it("หัวข้อความต้องตรงกับจังหวะ (ไม่งั้นโกหกบรรทัดที่อยู่ข้างใน)", () => {
      const blocks = [{ entityName: "A", lines: ["• x"] }];
      expect(exciseReminderMessage(blocks, { multiEntity: false, stage: "pre", leadDays: 3 })).toContain("อีก 3 วัน");
      expect(exciseReminderMessage(blocks, { multiEntity: false, stage: "due" })).toContain("วันนี้วันสุดท้าย");
      expect(exciseReminderMessage(blocks, { multiEntity: false, stage: "late" })).toContain("เลยกำหนด");
    });

    it("ทุกจังหวะยังบอกว่าต้องไปกด 'ปิดเดือน' ถึงจะหยุดเตือน (D83)", () => {
      const blocks = [{ entityName: "A", lines: ["• x"] }];
      for (const stage of ["pre", "due", "late"] as const) {
        expect(exciseReminderMessage(blocks, { multiEntity: false, stage }), stage).toContain("ปิดเดือน");
      }
    });
  });

  it("ปิดเดือนไปแล้ว = ไม่เตือน", () => {
    expect(exciseRemindersFor({ ...base, closed: (p) => p === "2026-08" })).toEqual([]);
  });

  it("🚨 ถอนปิดแล้ว = ยังไม่ปิด → ต้องกลับมาเตือน (งานยังค้างจริง)", () => {
    // ฝั่ง cron ส่ง closed() ที่ดูเฉพาะแถวที่ reopened_at is null → ถอนแล้วจะคืน false
    expect(exciseRemindersFor({ ...base, closed: NEVER_CLOSED })).toHaveLength(1);
  });

  it("🚨 ไม่ได้กรอกเลขสรรพสามิต = ไม่เตือนเลย (ไม่ใช่โรงสุราที่ต้องยื่น)", () => {
    expect(exciseRemindersFor({ ...base, hasExciseId: false })).toEqual([]);
  });

  it("🚨 key ต้องเป็นรูปแบบเดิมเป๊ะ — เปลี่ยนแล้วจะส่งซ้ำให้ลูกค้าทุกรายที่เคยได้รับไปแล้ว", () => {
    expect(exciseRemindersFor(base)[0].key).toBe("EID01-excise-2026-08");
  });

  it("action ของ integration_log ต้องแยกจากของฝั่งภาษี", () => {
    expect(EXCISE_REMINDER_ACTION).toBe("EXCISE_REMINDER");
    expect(EXCISE_REMINDER_ACTION).not.toBe("TAX_REMINDER");
  });
});

describe("D92 — ข้อความ", () => {
  it("บอกงวด + วันครบกำหนด และ 🚨 ไม่มีตัวเลขเงินเลย", () => {
    const line = exciseReminderLine("2026-08");
    expect(line).toContain("ภส.๐๗-๐๔");
    expect(line).toContain("ส.ค.");
    expect(line).toContain("15 ก.ย.");
    expect(line, "กลุ่ม LINE มีคนที่ไม่ควรเห็นตัวเลขของกิจการ").not.toMatch(/บาท|฿/);
  });

  it("🚨 ต้องไม่มีวันยื่นออนไลน์ — ไม่รู้ก็ไม่เดา (ต่างจาก ภพ.30 ที่รู้ทั้ง 2 วัน)", () => {
    expect(exciseReminderLine("2026-08")).not.toContain("ออนไลน์");
  });

  it("บอกด้วยว่าต้องไปกดอะไรที่ไหน", () => {
    const m = exciseReminderMessage([{ entityName: "โรงกลั่น", lines: ["• x"] }], { multiEntity: false });
    expect(m).toContain("ปิดเดือน");
    expect(m).toContain("รายงานสรรพสามิต");
  });

  it("กิจการเดียว = ไม่ใส่ชื่อกิจการ · หลายกิจการ = ใส่", () => {
    const blocks = [
      { entityName: "โรงกลั่น A", lines: ["• a"] },
      { entityName: "โรงกลั่น B", lines: ["• b"] },
    ];
    expect(exciseReminderMessage([blocks[0]], { multiEntity: false })).not.toContain("[โรงกลั่น A]");
    expect(exciseReminderMessage(blocks, { multiEntity: true })).toContain("[โรงกลั่น B]");
  });

  it("บล็อกที่ไม่มีบรรทัดต้องไม่โผล่เป็นหัวข้อว่าง", () => {
    const m = exciseReminderMessage(
      [{ entityName: "ว่าง", lines: [] }, { entityName: "มีของ", lines: ["• y"] }],
      { multiEntity: true },
    );
    expect(m).not.toContain("[ว่าง]");
  });

  it("★ จำนวนวันในหัวข้อความคิดจาก leadDays ไม่ใช่ฮาร์ดโค้ด", () => {
    const m = exciseReminderMessage([{ entityName: "x", lines: ["• z"] }], { multiEntity: false, leadDays: 7 });
    expect(m).toContain("อีก 7 วัน");
  });
});

describe("D92 — บรรทัดบอกสถานะการเตือนบนการ์ดในแอป", () => {
  it("🚨 ไม่กรอกเลขสรรพสามิต = เหลือง พร้อมบอกว่าต้องไปกรอกที่ไหน", () => {
    const h = reminderHintText({ hasExciseId: false, closed: false, period: "2026-09" })!;
    expect(h.warn).toBe(true);
    expect(h.text).toContain("ไม่เตือน");
    expect(h.text).toContain("ตั้งค่า → กิจการ");
  });

  it("ปิดเดือนแล้ว = ไม่ต้องขึ้นอะไร", () => {
    expect(reminderHintText({ hasExciseId: true, closed: true, period: "2026-09" })).toBeNull();
  });

  it("ยังไม่ปิด = บอกวันที่จะเตือนและวันครบกำหนด", () => {
    const h = reminderHintText({ hasExciseId: true, closed: false, period: "2026-08" })!;
    expect(h.warn).toBe(false);
    expect(h.text).toContain("12 ก.ย.");
    expect(h.text).toContain("15 ก.ย.");
  });
});

/**
 * เทสอ่านซอร์ส cron จริง (ชั้นเดียวกับ `tenantTables.test.ts` / `rolesSql.test.ts`)
 *
 * 🚨 บล็อกภาษีของ D88 ใช้ `continue` หลายจุด — เอางานใหม่ไปต่อท้ายเฉย ๆ จะถูกข้ามเงียบ ๆ
 *    TypeScript มองไม่เห็นความผิดพลาดแบบนี้เลย
 */
describe("D92 — โครงของ cron route", () => {
  const src = fs.readFileSync("app/api/cron/tax-reminder/route.ts", "utf8");

  it("🚨 สองงานต้องเป็นอิสระต่อกัน — แยกฟังก์ชัน ไม่ใช่ต่อท้ายหลัง continue", () => {
    expect(src).toMatch(/async function taxPart\(/);
    expect(src).toMatch(/async function excisePart\(/);
    expect(src).toMatch(/includes\("accounting"\)[\s\S]{0,120}taxPart\(/);
    expect(src).toMatch(/includes\("production"\)[\s\S]{0,120}excisePart\(/);
  });

  it("ใช้ action แยกจากฝั่งภาษี", () => {
    expect(src).toContain("EXCISE_REMINDER_ACTION");
  });

  it("🚨 อ่าน error ของ excise_month_close — อ่านไม่ได้แล้วเดาว่า 'ยังไม่ปิด' = สแปมเตือน", () => {
    expect(src).toMatch(/excise_month_close[\s\S]{0,600}closeErr/);
  });

  it("🚨 ส่งก่อน แล้วค่อยจด — จดก่อนแล้วส่งพลาด = เตือนหายตลอดกาล", () => {
    /**
     * ★ D95 ย้ายการส่ง+จดไปที่ `sendByStage` ซึ่งใช้ร่วมกันทั้ง 2 งาน → ตรวจในฟังก์ชันนั้น
     * 🪤 ต้องตัดเฉพาะตัวฟังก์ชันมาตรวจ ห้ามค้นทั้งไฟล์ — บทเรียน D92: ค้นทั้งไฟล์แล้วเจอ
     *    บรรทัด import ก่อน ทำให้ลำดับถูก "โดยบังเอิญ" = เทสที่ผ่านโดยไม่ได้ตรวจอะไร
     */
    const a = src.indexOf("async function sendByStage");
    expect(a, "ไม่พบ sendByStage").toBeGreaterThan(-1);
    const fn = src.slice(a);
    const insert = fn.indexOf('.from("integration_log").insert(');
    const send = fn.indexOf("await sendLineToTenant(");
    expect(insert, "ไม่พบ insert integration_log").toBeGreaterThan(-1);
    expect(send, "ไม่พบการส่ง LINE").toBeGreaterThan(-1);
    expect(send, "insert ต้องอยู่หลัง sendLineToTenant").toBeLessThan(insert);
  });

  it("🚨 ทั้ง 2 งานต้องส่งผ่านตัวเดียวกัน — 1 ข้อความต่อ 1 จังหวะ (หัวข้อความต้องตรงกับเนื้อ)", () => {
    const part = (name: string) => {
      const i = src.indexOf(`async function ${name}(`);
      const j = src.indexOf("\n  }\n", i);
      return src.slice(i, j);
    };
    expect(part("taxPart")).toContain("sendByStage(");
    expect(part("excisePart")).toContain("sendByStage(");
    // จัดกลุ่มตามจังหวะจริง ไม่ใช่ส่งรวมแล้วเดาหัวข้อความ
    expect(src).toMatch(/for \(const stage of DUE_STAGES\)/);
  });
});
