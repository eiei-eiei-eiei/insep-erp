import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  cutoffInfo, crossDayChoice, allowedCloseDates, openBillsNotice, editMethodOptions,
  editSaleProblem, editSaleChanged, CUTOFF_LEAD_MIN,
} from "./billDay";
import { businessDate } from "./businessDate";
import { DEFAULT_PAY_METHOD, TRANSFER_METHOD, PAY_METHODS } from "./payMethods";

/** เวลาไทย → instant (UTC+7 คงที่) */
const bkk = (iso: string) => new Date(iso + "+07:00");
const NIGHT_TO_NOON = { start: "18:00", end: "12:00" };
const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/* ── golden B30 (D163) ─────────────────────────────────────────────────────── */

describe("B30 cutoffInfo — อีกกี่นาทีวันขายจะเปลี่ยน ต้องตรงกับ businessDate() ทุกนาที", () => {
  const wins = [null, { start: "10:00", end: "22:00" }, NIGHT_TO_NOON, { start: "18:00", end: "03:00" }];
  it.each(wins.map((w) => [JSON.stringify(w), w] as const))("รอบ %s", (_l, win) => {
    for (let m = 0; m < 24 * 60; m += 7) {
      const now = new Date(bkk("2026-11-08T00:00:00").getTime() + m * 60_000);
      const { minutesLeft } = cutoffInfo(now, win);
      expect(minutesLeft).toBeGreaterThan(0);
      const before = new Date(now.getTime() + (minutesLeft - 1) * 60_000);
      const after = new Date(now.getTime() + minutesLeft * 60_000);
      expect(businessDate(before, win), `นาทีก่อนตัด @${m}`).toBe(businessDate(now, win));
      expect(businessDate(after, win), `นาทีที่ตัด @${m}`).not.toBe(businessDate(now, win));
    }
  });

  it("ป้ายเวลาตัดรอบ: รอบข้ามคืน = เวลาจบรอบ · ไม่ได้ตั้ง = เที่ยงคืน", () => {
    expect(cutoffInfo(bkk("2026-11-08T11:00:00"), NIGHT_TO_NOON)).toEqual({ minutesLeft: 60, at: "12:00" });
    expect(cutoffInfo(bkk("2026-11-08T23:30:00"), null)).toEqual({ minutesLeft: 30, at: "00:00" });
  });
});

describe("B30 crossDayChoice — ถามเฉพาะบิลที่เปิดตั้งแต่วันขายก่อน", () => {
  it("คำถามของผู้ใช้: รอบจบเที่ยง เปิด 23:00 รับเงิน 11:00 วันถัดไป = วันเดียวกัน ไม่ต้องถาม", () => {
    expect(crossDayChoice(bkk("2026-11-07T23:00:00").toISOString(), bkk("2026-11-08T11:00:00"), NIGHT_TO_NOON)).toBeNull();
    expect(businessDate(bkk("2026-11-08T11:00:00"), NIGHT_TO_NOON)).toBe("2026-11-07");
  });

  it("รับเงินหลังตัดรอบ (13:00) → ถาม พร้อมทั้งสองวัน", () => {
    expect(crossDayChoice(bkk("2026-11-07T23:00:00").toISOString(), bkk("2026-11-08T13:00:00"), NIGHT_TO_NOON))
      .toEqual({ openDate: "2026-11-07", nowDate: "2026-11-08" });
  });

  it("ไม่ได้ตั้งรอบ: เปิด 23:00 รับเงินเช้า = ข้ามวันตามปฏิทิน → ถาม", () => {
    expect(crossDayChoice(bkk("2026-11-07T23:00:00").toISOString(), bkk("2026-11-08T09:00:00"), null))
      .toEqual({ openDate: "2026-11-07", nowDate: "2026-11-08" });
  });

  it("เวลาเปิดอ่านไม่ได้ = ไม่ถาม (ไม่เดา)", () => {
    expect(crossDayChoice("ไม่ใช่วันที่", new Date(), null)).toBeNull();
  });

  it("🚨 server ยอมรับแค่วันนี้หรือวันที่เปิดบิล — วันอื่นไม่อยู่ในลิสต์", () => {
    const ok = allowedCloseDates(bkk("2026-11-07T23:00:00").toISOString(), bkk("2026-11-08T09:00:00"), null);
    expect(ok.sort()).toEqual(["2026-11-07", "2026-11-08"]);
    expect(allowedCloseDates(null, bkk("2026-11-08T09:00:00"), null)).toEqual(["2026-11-08"]);
  });
});

describe("B30 openBillsNotice — แถบเตือนบนหน้าขาย", () => {
  const sale = (no: string, at: string, tab: string | null = null) => ({ saleNo: no, tabName: tab, openedAt: bkk(at).toISOString() });

  it("ไม่มีบิลเปิด = ไม่เตือนแม้ใกล้ตัดรอบ", () => {
    expect(openBillsNotice([], bkk("2026-11-08T11:30:00"), NIGHT_TO_NOON)).toBeNull();
  });

  it(`มีบิลเปิด และเหลือ ≤ ${CUTOFF_LEAD_MIN} นาที → เตือนใกล้ตัดรอบ`, () => {
    const n = openBillsNotice([sale("B1", "2026-11-07T23:00:00", "โต๊ะ 3")], bkk("2026-11-08T11:15:00"), NIGHT_TO_NOON);
    expect(n?.soon).toEqual({ minutesLeft: 45, at: "12:00", count: 1 });
    expect(n?.stale).toEqual([]);
  });

  it("ยังไม่ใกล้ตัดรอบ = ไม่เตือน", () => {
    expect(openBillsNotice([sale("B1", "2026-11-07T23:00:00")], bkk("2026-11-08T02:00:00"), NIGHT_TO_NOON)).toBeNull();
  });

  it("บิลค้างจากวันขายก่อน → อยู่ใน stale และไม่นับซ้ำใน soon", () => {
    const n = openBillsNotice(
      [sale("B1", "2026-11-07T23:00:00", "โต๊ะ 3"), sale("B2", "2026-11-08T23:10:00")],
      bkk("2026-11-08T23:30:00"),
      null,
    );
    expect(n?.stale).toEqual([{ saleNo: "B1", label: "โต๊ะ 3", openDate: "2026-11-07" }]);
    expect(n?.soon).toEqual({ minutesLeft: 30, at: "00:00", count: 1 });
  });
});

describe("B30 แก้บิลในประวัติ — editSaleProblem (ฝาแฝดของ fn_bar_edit_sale)", () => {
  const base = {
    status: "ปกติ", oldDate: "2026-11-08", newDate: "2026-11-07",
    oldMethod: "โอน/QR", newMethod: "โอน/QR", today: "2026-11-08", posted: new Set<string>(),
  };

  it("ย้ายเข้าวันก่อนที่ยังไม่ลงบัญชี = แก้ได้", () => {
    expect(editSaleProblem(base)).toBeNull();
  });

  it("บิลเปิดอยู่/ยกเลิก แก้ไม่ได้", () => {
    expect(editSaleProblem({ ...base, status: "เปิดอยู่" })).toMatch(/รับเงินแล้ว/);
    expect(editSaleProblem({ ...base, status: "ยกเลิก" })).toMatch(/รับเงินแล้ว/);
  });

  it("🚨 วันเดิมลงบัญชีแล้ว → บล็อก + บอกให้ถอน (แม้แค่เปลี่ยนวิธีรับเงิน)", () => {
    const p = { ...base, newDate: base.oldDate, newMethod: "เงินสด", posted: new Set(["2026-11-08"]) };
    expect(editSaleProblem(p)).toMatch(/ลงบัญชีไปแล้ว.*ถอนการลงบัญชี/);
  });

  it("🚨 วันใหม่ลงบัญชีแล้ว → บล็อก", () => {
    expect(editSaleProblem({ ...base, posted: new Set(["2026-11-07"]) })).toMatch(/ย้ายบิลเข้าวันนั้นไม่ได้/);
  });

  it("วันในอนาคต / วันว่าง → บล็อก", () => {
    expect(editSaleProblem({ ...base, newDate: "2026-11-09" })).toMatch(/อนาคต/);
    expect(editSaleProblem({ ...base, newDate: "" })).toMatch(/ระบุวันขาย/);
  });

  it("ข้อความใช้ตัวจัดรูปวันที่ที่ส่งมา", () => {
    const p = { ...base, posted: new Set(["2026-11-07"]), fmtDate: () => "7 พ.ย. 69" };
    expect(editSaleProblem(p)).toContain("7 พ.ย. 69");
  });

  it("ไม่เปลี่ยนอะไร = changed false", () => {
    expect(editSaleChanged({ oldDate: "2026-11-08", newDate: "2026-11-08", oldMethod: "เงินสด", newMethod: "เงินสด" })).toBe(false);
    expect(editSaleChanged({ oldDate: "2026-11-08", newDate: "2026-11-08", oldMethod: "เงินสด", newMethod: "โอน/QR" })).toBe(true);
  });

  it("ป้ายเก่าของบิล (QR) คงไว้เป็นตัวเลือกได้ · ป้ายปัจจุบันไม่ซ้ำ", () => {
    expect(editMethodOptions("QR")).toEqual(["QR", ...PAY_METHODS]);
    expect(editMethodOptions("เงินสด")).toEqual([...PAY_METHODS]);
  });
});

/* ── ล็อกการต่อสายที่ TypeScript มองไม่เห็น ──────────────────────────────────── */

describe("D163 — ต่อสายครบทุกชั้น (อ่านซอร์ส)", () => {
  it("จอเก็บเงินเปิดมาที่ โอน/QR (ผู้ใช้สั่ง)", () => {
    expect(DEFAULT_PAY_METHOD).toBe(TRANSFER_METHOD);
    expect(read("app/(app)/bar/_components/PosTab.tsx")).toContain("useState<string>(DEFAULT_PAY_METHOD)");
  });

  it("🚨 ปุ่มยืนยันรับเงินเทาจนกว่าจะเลือกวัน — ห้ามเลือกวันให้ก่อน", () => {
    const src = read("app/(app)/bar/_components/PosTab.tsx");
    expect(src).toContain("useState<string | null>(null)");
    expect(src).toContain("Boolean(dayChoice && !pickDay)");
  });

  it("🚨 server ตรวจวันที่ผู้ใช้เลือกด้วย allowedCloseDates ก่อนส่งให้ SQL", () => {
    const src = read("app/(app)/bar/actions.ts");
    expect(src).toMatch(/allowedCloseDates\(/);
    expect(src).toMatch(/p_business_date: bdate/);
  });

  it("แดชบอร์ดกับประวัติบิลโหลดใหม่เมื่อถูกเปิดหลังมีการขาย", () => {
    for (const f of ["DashboardTab", "HistoryTab"]) {
      expect(read(`app/(app)/bar/_components/${f}.tsx`), f).toMatch(/useReloadWhenShown\(active, boot,/);
    }
    const app = read("app/(app)/bar/_components/BarApp.tsx");
    expect(app).toContain('active={tab === "dashboard"}');
    expect(app).toContain('active={tab === "history"}');
  });

  it("🚨 fn_bar_edit_sale: ต้อง bar.config + ด่านลงบัญชีทั้งวันเดิมและวันใหม่ + row_count", () => {
    const sql = read("supabase/migrations/20261108000109_bar_manager_edit_sale.sql");
    const i = sql.indexOf("create or replace function fn_bar_edit_sale(");
    const body = sql.slice(i, sql.indexOf("end $fn$;", i));
    expect(body).toContain("bar_guard(p_entity, 'bar.config')");
    expect(body).toContain("post_date = v_sale.business_date");
    expect(body).toContain("post_date = p_business_date");
    expect(body).toContain("get diagnostics v_n = row_count");
    // 🚨 ไม่แตะ closed_at / รายการ / สต็อก
    expect(body).not.toMatch(/closed_at\s*=/);
    expect(body).not.toMatch(/bar_sale_item|bar_move/);
  });
});
