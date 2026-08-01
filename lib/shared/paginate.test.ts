import { describe, it, expect } from "vitest";
import { fetchAllRows, type FetchPage } from "./paginate";

/** จำลอง PostgREST: มีข้อมูล n แถว แต่ตัดที่ maxRows ต่อหน้า */
function fakeTable(n: number, maxRows = 1000, withCount = true): { fetch: FetchPage<number>; calls: [number, number][] } {
  const rows = Array.from({ length: n }, (_, i) => i);
  const calls: [number, number][] = [];
  const fetch: FetchPage<number> = async (from, to) => {
    calls.push([from, to]);
    const end = Math.min(to + 1, from + maxRows);
    return { data: rows.slice(from, end), count: withCount ? n : null };
  };
  return { fetch, calls };
}

describe("fetchAllRows — กันรายงานเงิน/ภาษีโดน PostgREST ตัด 1,000 แถวเงียบ ๆ", () => {
  it("ข้อมูลน้อยกว่า 1 ก้อน = ยิงครั้งเดียว ได้ครบ", async () => {
    const { fetch, calls } = fakeTable(468);
    const rows = await fetchAllRows(fetch);
    expect(rows).toHaveLength(468);
    expect(calls).toHaveLength(1);
  });

  it("ข้อมูลเกิน 1,000 แถว = วนอ่านจนครบ (จุดที่เคยขาดหาย)", async () => {
    const { fetch, calls } = fakeTable(2500);
    const rows = await fetchAllRows(fetch);
    expect(rows).toHaveLength(2500);
    expect(rows[0]).toBe(0);
    expect(rows[2499]).toBe(2499);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("ครบพอดีทวีคูณของก้อน = ต้องยิงหน้าถัดไปเพื่อยืนยันว่าหมด", async () => {
    const { fetch, calls } = fakeTable(2000);
    const rows = await fetchAllRows(fetch);
    expect(rows).toHaveLength(2000);
    expect(calls).toHaveLength(3); // 0-999, 1000-1999, 2000-2999 (ว่าง)
  });

  it("โยน error เมื่อได้ไม่ครบตาม count (โดนตัด) — ห้ามปล่อยเลขผิดขึ้น ภพ.30", async () => {
    const fetch: FetchPage<number> = async () => ({ data: [1, 2, 3], count: 9999 });
    await expect(fetchAllRows(fetch, { label: "รายการบัญชี" })).rejects.toThrow(/ไม่ครบ/);
  });

  it("โยน error ของ DB ต่อทันที (ไม่กลืนด้วย data ?? [])", async () => {
    const fetch: FetchPage<number> = async () => ({ data: null, error: { message: "boom" } });
    await expect(fetchAllRows(fetch)).rejects.toThrow("boom");
  });

  it("ไม่มี count (caller ไม่ได้ขอ) ก็ยังวนอ่านครบตามปกติ", async () => {
    const { fetch } = fakeTable(1500, 1000, false);
    const rows = await fetchAllRows(fetch);
    expect(rows).toHaveLength(1500);
  });

  it("safety cap: หยุดแล้วโยน error แทนวนไม่รู้จบ", async () => {
    const fetch: FetchPage<number> = async (from, to) => ({ data: Array.from({ length: to - from + 1 }, () => 1) });
    await expect(fetchAllRows(fetch, { chunk: 10, maxPages: 3 })).rejects.toThrow(/ไม่ครบ/);
  });
});
