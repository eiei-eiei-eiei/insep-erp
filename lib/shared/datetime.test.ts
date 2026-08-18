import { describe, it, expect } from "vitest";
import { bangkokDateISO } from "./datetime";

describe("ขอบเขตวันตามเวลาไทย (server เป็น UTC บน Vercel)", () => {
  it("ตี 1 ของวันไทย = ยังเป็นวันเดียวกัน (UTC ยังเป็นเมื่อวาน 18:00)", () => {
    // 2026-08-01 01:00 ไทย = 2026-07-31 18:00Z
    expect(bangkokDateISO(new Date("2026-07-31T18:00:00Z"))).toBe("2026-08-01");
  });

  it("ตี 6 เช้าไทย ยังอยู่วันเดิม — จุดที่ setHours(0,0,0,0) แบบ UTC เคยตัดวันผิด", () => {
    // 2026-08-01 06:00 ไทย = 2026-07-31 23:00Z (UTC ยังเป็นวันที่ 31)
    expect(bangkokDateISO(new Date("2026-07-31T23:00:00Z"))).toBe("2026-08-01");
  });

  it("เที่ยงคืนไทยพอดี = เริ่มวันใหม่", () => {
    expect(bangkokDateISO(new Date("2026-07-31T17:00:00Z"))).toBe("2026-08-01");
  });

  it("ก่อนเที่ยงคืนไทย 1 นาที = ยังเป็นวันก่อนหน้า", () => {
    expect(bangkokDateISO(new Date("2026-07-31T16:59:00Z"))).toBe("2026-07-31");
  });
});
