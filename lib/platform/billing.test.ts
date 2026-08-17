import { describe, it, expect } from "vitest";
import { validateSubscription } from "./billing-db";
import {
  BILLING_STATE_LABEL,
  DUE_SOON_DAYS,
  NOTICE_DAYS,
  billingState,
  daysUntil,
  monthlyEquivalent,
  noticeLevel,
  periodEnd,
  suggestPlanName,
  suggestPrice,
} from "./billing";

/**
 * สูตรค่างวด — ชั้นสูตรที่เกี่ยวกับเงิน จึงต้องคุมทุกเคสขอบตามกติกาเหล็ก CLAUDE.md
 * เคสที่แพงที่สุดคือ "สิ้นเดือน" เพราะพลาดแล้ว **ไม่มีใครสังเกต** จนวันตัดรอบเลื่อนไปหลายวัน
 */

describe("periodEnd — ตัดรอบแบบ anniversary", () => {
  it("รายเดือนปกติ", () => {
    expect(periodEnd("2026-03-15", "monthly", 1)).toBe("2026-04-15");
    expect(periodEnd("2026-03-15", "monthly", 6)).toBe("2026-09-15");
  });

  it("รายปีปกติ", () => {
    expect(periodEnd("2026-03-15", "yearly", 1)).toBe("2027-03-15");
    expect(periodEnd("2026-03-15", "yearly", 3)).toBe("2029-03-15");
  });

  it("ข้ามปีตอนบวกเดือน", () => {
    expect(periodEnd("2026-11-20", "monthly", 2)).toBe("2027-01-20");
    expect(periodEnd("2026-12-31", "monthly", 1)).toBe("2027-01-31");
  });

  it("สิ้นเดือนที่เดือนปลายทางสั้นกว่า → หนีบลงมา", () => {
    expect(periodEnd("2026-01-31", "monthly", 1)).toBe("2026-02-28");
    expect(periodEnd("2026-03-31", "monthly", 1)).toBe("2026-04-30");
  });

  it("★★ ไม่ drift — 31 ม.ค. รอบที่ 2 ต้องกลับไปเป็นวันที่ 31 ไม่ใช่ 28", () => {
    // ถ้าเผลอบวกจาก current_period_end เดิม (28 ก.พ. + 1 เดือน) จะได้ 28 มี.ค. = ผิด
    expect(periodEnd("2026-01-31", "monthly", 2)).toBe("2026-03-31");
    expect(periodEnd("2026-01-31", "monthly", 3)).toBe("2026-04-30");
    expect(periodEnd("2026-01-31", "monthly", 4)).toBe("2026-05-31");
  });

  it("★★ จ่ายต่อเนื่อง 24 รอบ วันที่ตัดรอบต้องไม่เลื่อนสะสม", () => {
    const anchor = "2026-01-31";
    // ทุกเดือนที่มี 31 วัน ต้องได้วันที่ 31 เสมอ ไม่ว่าจะผ่านเดือนสั้นมากี่รอบ
    const may = periodEnd(anchor, "monthly", 4); // พ.ค.
    const july = periodEnd(anchor, "monthly", 6); // ก.ค.
    const dec = periodEnd(anchor, "monthly", 11); // ธ.ค.
    expect([may, july, dec]).toEqual(["2026-05-31", "2026-07-31", "2026-12-31"]);
    expect(periodEnd(anchor, "monthly", 24)).toBe("2028-01-31");
  });

  it("29 ก.พ. ปีอธิกสุรทิน + 1 ปี → 28 ก.พ.", () => {
    expect(periodEnd("2028-02-29", "yearly", 1)).toBe("2029-02-28");
    // และรอบที่ 4 กลับมาเป็น 29 ได้เพราะยึดจากจุดเริ่มเสมอ
    expect(periodEnd("2028-02-29", "yearly", 4)).toBe("2032-02-29");
  });

  it("periods ต่ำกว่า 1 ถูกดันขึ้นเป็น 1 (กันคำนวณย้อนหลังโดยไม่ตั้งใจ)", () => {
    expect(periodEnd("2026-03-15", "monthly", 0)).toBe("2026-04-15");
    expect(periodEnd("2026-03-15", "monthly", -5)).toBe("2026-04-15");
  });
});

describe("daysUntil", () => {
  it("นับวันข้ามเดือน/ปีได้ถูก", () => {
    expect(daysUntil("2026-08-17", "2026-08-20")).toBe(3);
    expect(daysUntil("2026-08-31", "2026-09-01")).toBe(1);
    expect(daysUntil("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("วันเดียวกัน = 0 · เลยมาแล้วเป็นลบ", () => {
    expect(daysUntil("2026-08-17", "2026-08-17")).toBe(0);
    expect(daysUntil("2026-08-17", "2026-08-10")).toBe(-7);
  });

  it("★ ข้ามช่วงที่เคยเป็นกับดัก DST ของภาษาอื่น — ไทยไม่มี DST แต่ต้องไม่พึ่งเวลาเครื่อง", () => {
    expect(daysUntil("2026-03-01", "2026-04-01")).toBe(31);
    expect(daysUntil("2026-02-01", "2026-03-01")).toBe(28);
  });
});

describe("billingState — เลยกำหนดคำนวณสด ไม่ได้เก็บใน DB", () => {
  const sub = (status: string, end: string) => ({ status, currentPeriodEnd: end });

  it("ยังอีกไกล = ปกติ", () => {
    expect(billingState(sub("active", "2026-09-30"), "2026-08-17")).toBe("active");
  });

  it("เหลือพอดี 7 วัน = ใกล้ครบกำหนด (ขอบเขต)", () => {
    expect(billingState(sub("active", "2026-08-24"), "2026-08-17")).toBe("due_soon");
    expect(billingState(sub("active", "2026-08-25"), "2026-08-17")).toBe("active");
    expect(DUE_SOON_DAYS).toBe(7);
  });

  it("★ วันครบกำหนดพอดี ยังไม่ถือว่าเลย (ให้โอนภายในวันนั้นได้)", () => {
    expect(billingState(sub("active", "2026-08-17"), "2026-08-17")).toBe("due_soon");
    expect(billingState(sub("active", "2026-08-16"), "2026-08-17")).toBe("past_due");
  });

  it("หยุดพัก/ยกเลิก ชนะเสมอ — ตกลงกันแล้วว่าพัก ไม่ต้องขึ้นว่าค้างจ่าย", () => {
    expect(billingState(sub("paused", "2020-01-01"), "2026-08-17")).toBe("paused");
    expect(billingState(sub("cancelled", "2020-01-01"), "2026-08-17")).toBe("cancelled");
  });

  it("ยังไม่ได้ตั้งค่างวด = none และมีป้ายภาษาไทยครบทุกสถานะ", () => {
    expect(billingState(null, "2026-08-17")).toBe("none");
    expect(billingState(undefined, "2026-08-17")).toBe("none");
    expect(BILLING_STATE_LABEL.none).toBeTruthy();
    expect(BILLING_STATE_LABEL.past_due).toBeTruthy();
  });
});

describe("noticeLevel — สิ่งที่ลูกค้าเห็นในแอปตัวเอง", () => {
  it("เหลือพอดี 3 วัน = เตือน · 4 วันยังเงียบ", () => {
    expect(noticeLevel("2026-08-20", "2026-08-17")).toBe("due_soon");
    expect(noticeLevel("2026-08-21", "2026-08-17")).toBe("none");
    expect(NOTICE_DAYS).toBe(3);
  });

  it("วันครบกำหนดพอดี = ยังไม่เลย · เลยแล้ว = overdue", () => {
    expect(noticeLevel("2026-08-17", "2026-08-17")).toBe("due_soon");
    expect(noticeLevel("2026-08-16", "2026-08-17")).toBe("overdue");
  });

  it("★ ไม่มีวันครบกำหนด (ยังไม่ตั้ง/หยุดพัก/ปิดการเตือน) = เงียบสนิท", () => {
    expect(noticeLevel(null, "2026-08-17")).toBe("none");
    expect(noticeLevel(undefined, "2026-08-17")).toBe("none");
    expect(noticeLevel("", "2026-08-17")).toBe("none");
  });

  it("★ ลูกค้าต้องถูกเตือนช้ากว่าที่แอดมินเห็น (แอดมินมีเวลาเตรียมทวงก่อน)", () => {
    expect(NOTICE_DAYS).toBeLessThan(DUE_SOON_DAYS);
  });
});

describe("suggestPrice / suggestPlanName — ราคาที่ระบบเสนอ (พิมพ์ทับได้)", () => {
  it("โมดูลเดียว", () => {
    expect(suggestPrice(["production"], 1, "monthly")).toBe(790);
    expect(suggestPrice(["accounting"], 1, "monthly")).toBe(490);
  });

  it("สองโมดูล = บวกกัน", () => {
    expect(suggestPrice(["production", "accounting"], 1, "monthly")).toBe(1280);
  });

  it("ครบ 3 โมดูล = ราคาเหมา ไม่ใช่ผลบวก", () => {
    expect(suggestPrice(["production", "accounting", "sales"], 1, "monthly")).toBe(1490);
  });

  it("กิจการที่ 2 ขึ้นไปคิดเพิ่มรายกิจการ", () => {
    expect(suggestPrice(["production"], 2, "monthly")).toBe(790 + 490);
    expect(suggestPrice(["production"], 3, "monthly")).toBe(790 + 490 * 2);
  });

  it("รายปี = รายเดือน × 12 (จงใจไม่ใส่ส่วนลดอัตโนมัติ)", () => {
    expect(suggestPrice(["production"], 1, "yearly")).toBe(790 * 12);
  });

  it("โมดูลที่ไม่รู้จักถูกข้าม ไม่ทำให้ราคาเพี้ยน", () => {
    expect(suggestPrice(["production", "hr"], 1, "monthly")).toBe(790);
    expect(suggestPrice([], 1, "monthly")).toBe(0);
  });

  it("ชื่อแพ็กเกจอ่านรู้เรื่อง", () => {
    expect(suggestPlanName(["production", "accounting", "sales"])).toBe("ครบทุกโมดูล");
    expect(suggestPlanName(["production", "accounting"])).toBe("ผลิต+บัญชี");
    expect(suggestPlanName(["sales"])).toBe("ขาย");
    expect(suggestPlanName([])).toBe("ยังไม่ระบุ");
  });
});

describe("monthlyEquivalent — รวมเป็นรายได้ต่อเดือน (MRR)", () => {
  it("รายเดือนคืนค่าเดิม · รายปีหารสิบสอง", () => {
    expect(monthlyEquivalent(1490, "monthly")).toBe(1490);
    expect(monthlyEquivalent(17880, "yearly")).toBe(1490);
  });

  it("ปัดเป็นทศนิยม 2 ตำแหน่ง และรับค่าเพี้ยนได้", () => {
    expect(monthlyEquivalent(1000, "yearly")).toBe(83.33);
    expect(monthlyEquivalent(Number.NaN, "monthly")).toBe(0);
  });
});

describe("validateSubscription — ตรวจฟอร์มก่อนแตะ DB", () => {
  const ok = {
    plan: "ผลิต+บัญชี",
    price: 1280,
    cycle: "monthly" as const,
    startedOn: "2026-08-17",
    status: "active" as const,
    note: null,
    billingNotice: true,
  };

  it("ข้อมูลครบถูกต้อง = ผ่าน", () => {
    expect(validateSubscription(ok)).toBeNull();
  });

  it("ราคา 0 ได้ (ลูกค้าทดลองใช้ฟรี) แต่ติดลบไม่ได้", () => {
    expect(validateSubscription({ ...ok, price: 0 })).toBeNull();
    expect(validateSubscription({ ...ok, price: -1 })).not.toBeNull();
    expect(validateSubscription({ ...ok, price: Number.NaN })).not.toBeNull();
  });

  it("ชื่อแพ็กเกจว่าง / รอบไม่รู้จัก / สถานะไม่รู้จัก = ไม่ผ่าน", () => {
    expect(validateSubscription({ ...ok, plan: "   " })).not.toBeNull();
    expect(validateSubscription({ ...ok, cycle: "weekly" as never })).not.toBeNull();
    expect(validateSubscription({ ...ok, status: "past_due" as never })).not.toBeNull();
  });

  it("★ วันเริ่มใช้บริการต้องเป็น yyyy-MM-dd — เป็นจุดยึดของวันตัดรอบทั้งหมด", () => {
    expect(validateSubscription({ ...ok, startedOn: "17/08/2026" })).not.toBeNull();
    expect(validateSubscription({ ...ok, startedOn: "" })).not.toBeNull();
  });
});
