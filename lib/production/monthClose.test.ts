import { describe, it, expect } from "vitest";
import {
  closeStatus,
  monthCloseBadge,
  closeWarnText,
  pendingRecomputeText,
  driftSummary,
  recomputeResultText,
  cancelLockedText,
  type MonthCloseRow,
  type ExciseTotals,
} from "./monthClose";

const row = (o: Partial<MonthCloseRow> = {}): MonthCloseRow => ({
  id: 1,
  month: "2026-09",
  closedAt: "2026-10-05T03:00:00Z",
  closedBy: "เจ้าของกิจการ",
  note: null,
  reopenedAt: null,
  reopenedBy: null,
  reopenNote: null,
  totals: null,
  ...o,
});

describe("D91 — สถานะปิดเดือน", () => {
  it("ไม่มีแถวเลย = ยังไม่ปิด", () => {
    const st = closeStatus([]);
    expect(st.closed).toBe(false);
    expect(st.active).toBeNull();
    expect(monthCloseBadge(st)).toEqual({ text: "ยังไม่ปิดเดือน", tone: "warn" });
  });

  it("มีแถวที่ยังไม่ถูกถอน = ปิดอยู่", () => {
    const st = closeStatus([row()]);
    expect(st.closed).toBe(true);
    expect(st.active?.id).toBe(1);
    expect(monthCloseBadge(st).tone).toBe("ok");
  });

  it("🚨 ถอนแล้ว = กลับเป็นเปิด (แถวเก่ายังอยู่เป็นประวัติ ห้ามนับเป็นปิด)", () => {
    const st = closeStatus([row({ reopenedAt: "2026-10-06T03:00:00Z" })]);
    expect(st.closed).toBe(false);
    expect(st.reopenedTimes).toBe(1);
  });

  it("ปิด → ถอน → ปิดใหม่ = ปิดอยู่ และนับรอบที่ถอนไปแล้วได้", () => {
    const st = closeStatus([
      row({ id: 2 }),
      row({ id: 1, reopenedAt: "2026-10-06T03:00:00Z" }),
    ]);
    expect(st.closed).toBe(true);
    expect(st.active?.id).toBe(2);
    expect(st.reopenedTimes).toBe(1);
  });
});

describe("D91 — ข้อความเตือน (เตือน ไม่บล็อก)", () => {
  it("สร้างฟอร์มครบแล้ว = ไม่เตือน", () => {
    expect(closeWarnText(5, 5)).toBeNull();
  });

  it("ยังไม่ครบ = เตือนพร้อมบอกจำนวน แต่ยังปิดได้", () => {
    expect(closeWarnText(2, 5)).toContain("2/5");
    expect(closeWarnText(2, 5)).toContain("ปิดเดือนได้");
  });

  it("ไม่มีฟอร์มให้สร้างเลย (เส้นทางผลิตยังไม่ได้ตั้ง) = ไม่เตือน", () => {
    expect(closeWarnText(0, 0)).toBeNull();
  });

  it("ไม่มีคู่ค้าง = ไม่ขึ้นข้อความ · มีคู่ค้าง = บอกจำนวนและบอกว่าต้องกดอะไร", () => {
    expect(pendingRecomputeText({ toHide: 0, toShow: 0 })).toBeNull();
    const t = pendingRecomputeText({ toHide: 3, toShow: 0 })!;
    expect(t).toContain("3 คู่");
    expect(t).toContain("คำนวณใหม่ตามจริง");
    expect(t).toContain("เอาออก");
  });

  it("🚨 ทิศทางกลับกัน ต้องไม่พูดว่า \"เอาออก\" — คู่ที่ซ่อนไว้แต่เดือนนั้นปิดแล้ว จะ**กลับมาแสดง**", () => {
    const t = pendingRecomputeText({ toHide: 0, toShow: 2 })!;
    expect(t).toContain("กลับมาแสดง");
    expect(t, "บั๊กที่เจอตอนเทสเบราว์เซอร์: ข้อความกลับด้านกับความจริงพอดี").not.toContain("เพื่อเอาออก");
  });

  it("มีทั้งสองทิศพร้อมกัน = บอกครบทั้งคู่", () => {
    const t = pendingRecomputeText({ toHide: 1, toShow: 2 })!;
    expect(t).toContain("1 คู่");
    expect(t).toContain("2 คู่");
  });
});

describe("D91 — drift: ข้อมูลขยับไปจากตอนปิดเดือนไหม", () => {
  const saved: ExciseTotals = {
    product: { "P-01": { in: 10, out: 4 } },
    material: { "M-01": { in: 100, out: 0 } },
    distill: { สุรากลั่นทดลอง: { n: 1, vol: 20 } },
  };

  it("🚨 ยังไม่เคยปิด (saved = null) ต้องไม่ขึ้น drift เลย", () => {
    expect(driftSummary(null, saved)).toEqual([]);
  });

  it("ข้อมูลเท่าเดิม = ไม่มี drift", () => {
    expect(driftSummary(saved, JSON.parse(JSON.stringify(saved)))).toEqual([]);
  });

  it("ยอดจ่ายเปลี่ยน = ฟ้องบรรทัดเดียวพร้อมค่าก่อน/หลัง", () => {
    const now: ExciseTotals = { ...saved, product: { "P-01": { in: 10, out: 5 } } };
    const d = driftSummary(saved, now);
    expect(d).toHaveLength(1);
    expect(d[0].group).toBe("บรรจุ/จ่ายขวด");
    expect(d[0].key).toBe("P-01");
    expect(d[0].before).toContain("จ่าย 4");
    expect(d[0].after).toContain("จ่าย 5");
  });

  it("สินค้าที่เพิ่งโผล่มาใหม่หลังปิดเดือน ต้องถูกฟ้องด้วย", () => {
    const now: ExciseTotals = { ...saved, product: { ...saved.product, "P-02": { in: 0, out: 2 } } };
    const d = driftSummary(saved, now);
    expect(d.map((x) => x.key)).toEqual(["P-02"]);
    expect(d[0].before).toBe("—");
  });

  it("แถวที่หายไปหลังปิดเดือนก็ต้องถูกฟ้อง (ตรงข้ามกับข้อบน)", () => {
    const d = driftSummary(saved, { ...saved, distill: {} });
    expect(d.map((x) => x.key)).toEqual(["สุรากลั่นทดลอง"]);
    expect(d[0].after).toBe("—");
  });

  it("ค่าที่มาเป็นสตริงจาก jsonb ต้องเทียบได้เหมือนตัวเลข (ไม่ฟ้อง drift ปลอม)", () => {
    const now = { product: { "P-01": { in: "10", out: "4" } } } as unknown as ExciseTotals;
    expect(driftSummary({ product: saved.product }, now)).toEqual([]);
  });
});

describe("D91 — ผลของการคำนวณใหม่ (บันทึกได้บางส่วน/ไม่มีอะไรเปลี่ยน ห้ามขึ้นเขียว)", () => {
  it("ไม่มีอะไรเปลี่ยน = เหลือง พร้อมบอกตรง ๆ", () => {
    const r = recomputeResultText({ toHide: 0, toShow: 0 });
    expect(r.warn).toBe(true);
    expect(r.text).toContain("ไม่มีคู่ไหนต้องเปลี่ยน");
  });

  it("เปลี่ยนจริง = เขียว พร้อมจำนวน **และทิศทาง**", () => {
    const r = recomputeResultText({ toHide: 2, toShow: 0 });
    expect(r.warn).toBe(false);
    expect(r.text).toContain("เอาออกจากฟอร์ม 2 คู่");
  });

  it("🚨 ทิศเอากลับมาแสดง ต้องพูดให้ตรง (ตัวเลขบนฟอร์มเพิ่ม ไม่ใช่ลด)", () => {
    expect(recomputeResultText({ toHide: 0, toShow: 1 }).text).toContain("เอากลับมาแสดง 1 คู่");
  });

  it("เกิดพร้อมกันทั้งสองทิศ = บอกครบ", () => {
    const t = recomputeResultText({ toHide: 1, toShow: 3 }).text;
    expect(t).toContain("เอาออกจากฟอร์ม 1 คู่");
    expect(t).toContain("เอากลับมาแสดง 3 คู่");
  });
});

describe("D91 — ข้อความตอนยกเลิกบิลของเดือนที่ปิดแล้ว", () => {
  it("ไม่มีเดือนที่ถูกล็อก = ไม่ขึ้นข้อความ", () => {
    expect(cancelLockedText("QU260901-001", [])).toBeNull();
  });

  it("🚨 ต้องบอกทั้งเดือนที่ล็อก · ผลที่เกิด · และใครต้องเป็นคนกดต่อ", () => {
    const t = cancelLockedText("QU260901-001", ["2026-09"])!;
    expect(t).toContain("2026-09");
    expect(t).toContain("ยังแสดงบนฟอร์ม");
    expect(t).toContain("เจ้าของกิจการ");
    expect(t).toContain("รายงานสรรพสามิต");
  });

  it("คู่ข้ามเดือน ต้องบอกครบทุกเดือนที่ปิด", () => {
    expect(cancelLockedText("QU-1", ["2026-09", "2026-10"])!).toContain("2026-09, 2026-10");
  });
});
