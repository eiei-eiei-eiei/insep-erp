import { describe, expect, it } from "vitest";
import {
  DATE_FORMATS,
  DATE_FORMAT_LABEL,
  DEFAULT_DOC_FORMAT,
  DEFAULT_SCREEN_FORMAT,
  dateFormatsFromSettings,
  formatDate,
  formatDateTime,
  formatDayShort,
  formatMonth,
  parseDateParts,
  toDateFormat,
  weekdayShort,
  type DateFormat,
} from "./dateFormat";
import { formatDateThai, formatMonthThai } from "./format";
import { thaiDay } from "./period";

/**
 * D161 เฟส 4 — สำเนา**แช่แข็ง**ของตัวจัดรูปเดิมที่ถูกลบออกจากโค้ดจริงแล้ว
 * ★ เก็บไว้เพื่อให้ golden ยังพิสูจน์ได้ว่า "ค่าเริ่มต้น = ของเดิมเป๊ะ" · ห้าม import ไปใช้ที่อื่น
 */
function formatThaiDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${Number(m[1]) + 543}` : iso;
}
function receiveDateText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${String((Number(m[1]) + 543) % 100).padStart(2, "0")}`;
}
import { fmtIsoDMY } from "../production/reports";

/** ทุกวันในช่วง (UTC ล้วน — ไม่ขึ้นกับโซนเวลาของเครื่องที่รันเทส) */
function everyDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
const DAYS = everyDay("2000-01-01", "2040-12-31");

describe("D161 golden — ค่าเริ่มต้นให้ผลเท่าตัวจัดรูปเดิมทุกวัน (2000–2040)", () => {
  it("หน้าจอ d_mon_yy = formatDateThai (A9) เป๊ะ", () => {
    for (const d of DAYS) if (formatDate(d, "d_mon_yy") !== formatDateThai(d)) throw new Error(d);
    expect(DEFAULT_SCREEN_FORMAT).toBe("d_mon_yy");
  });
  it("เอกสาร dd_mm_yyyy_be = formatThaiDate (เอกสารขาย) เป๊ะ ⇒ ไม่ตั้ง = กระดาษไม่ขยับ", () => {
    for (const d of DAYS) if (formatDate(d, "dd_mm_yyyy_be") !== formatThaiDate(d)) throw new Error(d);
    expect(DEFAULT_DOC_FORMAT).toBe("dd_mm_yyyy_be");
  });
  it("dd_mm_yy_be = receiveDateText (บาร์) = fmtIsoDMY (ภส.) เป๊ะ", () => {
    for (const d of DAYS) {
      const v = formatDate(d, "dd_mm_yy_be");
      if (v !== receiveDateText(d) || v !== fmtIsoDMY(d)) throw new Error(d);
    }
  });
  it("วันสั้น d_mon_* = thaiDay (แถบเตือน) เป๊ะ", () => {
    for (const d of DAYS) {
      if (formatDayShort(d, "d_mon_yy") !== thaiDay(d)) throw new Error(d);
      if (formatDayShort(d, "d_mon_yyyy") !== thaiDay(d)) throw new Error(d);
    }
  });
  it("เดือน d_mon_yyyy = formatMonthThai เป๊ะ", () => {
    for (const d of DAYS.filter((x) => x.endsWith("-01"))) {
      const p = d.slice(0, 7);
      expect(formatMonth(p, "d_mon_yyyy")).toBe(formatMonthThai(p));
    }
  });
});

describe("ทุกรูปแบบกับวันตัวอย่าง", () => {
  const cases: Record<DateFormat, [string, string, string]> = {
    d_mon_yy: ["6 พ.ย. 69", "พ.ย. 69", "6 พ.ย."],
    d_mon_yyyy: ["6 พ.ย. 2569", "พ.ย. 2569", "6 พ.ย."],
    dd_mm_yyyy_be: ["06/11/2569", "11/2569", "06/11"],
    dd_mm_yy_be: ["06/11/69", "11/69", "06/11"],
    dd_mm_yyyy_ce: ["06/11/2026", "11/2026", "06/11"],
    iso: ["2026-11-06", "2026-11", "2026-11-06"],
  };
  for (const f of DATE_FORMATS) {
    it(f, () => {
      expect(formatDate("2026-11-06", f)).toBe(cases[f][0]);
      expect(formatMonth("2026-11", f)).toBe(cases[f][1]);
      expect(formatDayShort("2026-11-06", f)).toBe(cases[f][2]);
    });
  }
  it("ทุกรูปแบบมีป้ายบนจอ และไม่ซ้ำกัน (D84)", () => {
    expect(Object.keys(DATE_FORMAT_LABEL).sort()).toEqual([...DATE_FORMATS].sort());
    expect(new Set(Object.values(DATE_FORMAT_LABEL)).size).toBe(DATE_FORMATS.length);
    const samples = DATE_FORMATS.map((f) => formatDate("2026-11-06", f));
    expect(new Set(samples).size).toBe(DATE_FORMATS.length);
  });
  it("ISO เรียงตามตัวอักษร = เรียงตามเวลา", () => {
    const s = ["2026-11-06", "2025-12-31", "2026-01-02"].map((d) => formatDate(d, "iso"));
    expect([...s].sort()).toEqual(["2025-12-31", "2026-01-02", "2026-11-06"]);
  });
});

describe("timestamp → เวลาไทยเสมอ (บั๊ก UTC ของ D100/D161 เฟส 0)", () => {
  it("เที่ยงคืนครึ่งเวลาไทย = 17:30 UTC ของวันก่อน → ต้องได้วันของไทย", () => {
    expect(formatDate("2026-11-05T17:30:00+00:00", "d_mon_yy")).toBe("6 พ.ย. 69");
    expect(formatDate("2026-11-05T17:30:00.123456+00:00", "iso")).toBe("2026-11-06");
    expect(formatDateTime("2026-11-05T17:30:00+00:00", "d_mon_yy")).toBe("6 พ.ย. 69 00:30");
  });
  it("โซนแบบ +00 ที่ Postgres พิมพ์ (มีช่องว่างแทน T)", () => {
    expect(formatDateTime("2026-11-05 17:30:00+00", "iso")).toBe("2026-11-06 00:30");
    expect(formatDate("2026-11-05 17:30:00+00", "iso")).toBe("2026-11-06");
  });
  it("โซน +07:00 ไม่ถูกบวกซ้ำ", () => {
    expect(formatDateTime("2026-11-06T09:05:00+07:00", "dd_mm_yyyy_be")).toBe("06/11/2569 09:05");
  });
  it("รับ Date ได้", () => {
    expect(formatDateTime(new Date("2026-11-05T17:30:00Z"), "iso")).toBe("2026-11-06 00:30");
  });
  it("ไม่มีโซนเวลา → วันที่ใช้ตามตัวอักษร · วันเวลาคืนตามเดิม (ไม่เดาโซน)", () => {
    expect(formatDate("2026-11-06T23:30:00", "iso")).toBe("2026-11-06");
    expect(formatDateTime("2026-11-06T23:30:00", "iso")).toBe("2026-11-06T23:30:00");
  });
});

describe("ค่าแปลก — ไม่เดา ไม่พิมพ์ undefined", () => {
  it("ว่าง/null → ค่าว่าง", () => {
    for (const v of ["", "  ", null, undefined]) {
      expect(formatDate(v, "d_mon_yy")).toBe("");
      expect(formatDayShort(v, "d_mon_yy")).toBe("");
      expect(formatMonth(v, "d_mon_yy")).toBe("");
      expect(formatDateTime(v, "d_mon_yy")).toBe("");
    }
  });
  it("อ่านไม่ออก/วันที่ไม่มีจริง → คืนตามเดิม", () => {
    for (const v of ["abc", "2026-02-30", "2026-13-01", "06/11/2569"]) {
      expect(formatDate(v, "d_mon_yy")).toBe(v);
      expect(parseDateParts(v)).toBeNull();
    }
    expect(formatMonth("2026-13", "d_mon_yy")).toBe("2026-13");
    expect(formatDateTime("not a date+00:00", "iso")).toBe("not a date+00:00");
  });
  it("29 ก.พ. ปีอธิกสุรทินผ่าน ปีปกติไม่ผ่าน", () => {
    expect(formatDate("2028-02-29", "iso")).toBe("2028-02-29");
    expect(formatDate("2027-02-29", "iso")).toBe("2027-02-29"); // คืนตามเดิม
    expect(parseDateParts("2027-02-29")).toBeNull();
  });
  it("ไม่มีคำว่า undefined/NaN ในผลลัพธ์ของทุกรูปแบบ ทุกวัน", () => {
    for (const f of DATE_FORMATS) {
      for (const d of DAYS.filter((_, i) => i % 7 === 0)) {
        const out = formatDate(d, f) + formatDayShort(d, f) + formatMonth(d.slice(0, 7), f);
        if (/undefined|NaN/.test(out)) throw new Error(`${f} ${d} ${out}`);
      }
    }
  });
});

describe("วันในสัปดาห์", () => {
  it("6 พ.ย. 2026 = ศุกร์ · 1 ม.ค. 2026 = พฤหัส", () => {
    expect(weekdayShort("2026-11-06")).toBe("ศ.");
    expect(weekdayShort("2026-01-01")).toBe("พฤ.");
    expect(weekdayShort("")).toBe("");
  });
});

describe("ค่าตั้งจาก app_settings", () => {
  it("ไม่มีแถว = ค่าเริ่มต้นทั้งคู่", () => {
    expect(dateFormatsFromSettings([])).toEqual({ screen: "d_mon_yy", doc: "dd_mm_yyyy_be" });
    expect(dateFormatsFromSettings(null)).toEqual({ screen: "d_mon_yy", doc: "dd_mm_yyyy_be" });
  });
  it("อ่านสองค่าแยกกัน", () => {
    expect(
      dateFormatsFromSettings([
        { kind: "date_format", value: "iso" },
        { kind: "doc_date_format", value: "dd_mm_yyyy_ce" },
        { kind: "brand_name", value: "x" },
      ]),
    ).toEqual({ screen: "iso", doc: "dd_mm_yyyy_ce" });
  });
  it("ค่าที่ไม่รู้จัก (เช่นโค้ดเก่าเจอค่าจากโค้ดใหม่) = ค่าเริ่มต้น ไม่ทำให้จอพัง", () => {
    expect(toDateFormat("yyyy/mm/dd", "d_mon_yy")).toBe("d_mon_yy");
    expect(toDateFormat(undefined, "dd_mm_yyyy_be")).toBe("dd_mm_yyyy_be");
  });
});
