/**
 * lib/bar/dashDays — ตารางรายวัน + ช่วงเวลา + เทียบช่วงก่อน ของแดชบอร์ดบาร์ (golden B20 · D115)
 *
 * 🎯 ผู้ใช้ "งง" กับการ์ดลงบัญชีเดิม: เลือกวันในช่องแยก แล้วกล่อง "แยกตามวิธีรับเงิน"
 *    กลับโชว์ยอดของ **ทั้งช่วง** ไม่ใช่ของวันที่จะลง ⇒ ตัวเลขที่เห็นไม่ใช่ตัวเลขที่จะลง
 *    → ยุบเป็นตาราง 1 แถวต่อ 1 วันขาย ปุ่มลงบัญชีอยู่ติดกับตัวเลขของวันนั้นเอง
 *
 * 🚨 อ่านค่าที่แช่ไว้ในบิลเท่านั้น (กติกาเดียวกับ dashboard.ts · D75)
 */
import { countedSales, summarize, type SaleRow, type TopMenu } from "./dashboard";

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * สถานะลงบัญชีของวันขาย
 * · posted   = ลงแล้ว
 * · unposted = ผ่านไปแล้ว ยังไม่ลง → มีปุ่มลง
 * · selling  = วันขายปัจจุบัน (ร้านอาจยังเปิด) → ลงได้ แต่ต้องถามยืนยันก่อน
 *   🚨 หลังลงแล้วปิดบิลเข้าวันนั้นไม่ได้อีก (0083) — ต้องเตือนก่อนกด ไม่ใช่หลังกด
 */
export type DayState = "posted" | "unposted" | "selling";

export type DayRow = {
  date: string;
  bills: number;
  revenue: number;
  cost: number;
  profit: number;
  marginPct: number | null;
  /** ยอดแยกวิธีรับเงิน — เรียงยอดมากก่อน (= บิลบัญชีที่จะได้ 1 ใบต่อ 1 วิธี) */
  methods: { method: string; bills: number; revenue: number }[];
  state: DayState;
};

/**
 * ตารางรายวัน — เฉพาะวันที่มีบิลปิดแล้ว · เรียงวันใหม่ก่อน
 * @param currentDay วันขายปัจจุบัน (businessDate ของตอนนี้) — วันนี้หรือหลังจากนี้ = selling
 */
export function dailyRows(
  sales: readonly SaleRow[],
  postedDays: readonly string[],
  currentDay: string,
): DayRow[] {
  const posted = new Set(postedDays);
  const byDay = new Map<string, SaleRow[]>();
  for (const s of countedSales(sales)) {
    if (!s.businessDate) continue;
    const list = byDay.get(s.businessDate);
    if (list) list.push(s);
    else byDay.set(s.businessDate, [s]);
  }
  return [...byDay.entries()]
    .map(([date, rows]) => {
      const sum = summarize(rows);
      const m = new Map<string, { bills: number; revenue: number }>();
      for (const r of rows) {
        const key = r.method?.trim() || "ไม่ระบุ";
        const g = m.get(key) ?? { bills: 0, revenue: 0 };
        g.bills += 1;
        g.revenue = round2(g.revenue + r.grandTotal);
        m.set(key, g);
      }
      const state: DayState = posted.has(date) ? "posted" : date >= currentDay ? "selling" : "unposted";
      return {
        date,
        bills: sum.bills,
        revenue: sum.revenue,
        cost: sum.cost,
        profit: sum.profit,
        marginPct: sum.marginPct,
        methods: [...m.entries()].map(([method, g]) => ({ method, ...g })).sort((a, b) => b.revenue - a.revenue),
        state,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

// ── ช่วงเวลา ─────────────────────────────────────────────────────────────────
export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "thisMonth" | "lastMonth";

export const RANGE_LABEL: Record<RangeKey, string> = {
  today: "วันนี้",
  yesterday: "เมื่อวาน",
  "7d": "7 วัน",
  "30d": "30 วัน",
  thisMonth: "เดือนนี้",
  lastMonth: "เดือนก่อน",
};

const parse = (iso: string) => new Date(iso + "T00:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function addDays(isoDate: string, n: number): string {
  const d = parse(isoDate);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/**
 * ช่วงสำเร็จรูป — คิดจาก **วันขายปัจจุบัน** ไม่ใช่วันปฏิทิน
 * (ตีหนึ่งของคืนวันเสาร์ "วันนี้" ยังเป็นวันเสาร์ ถ้าตั้งรอบข้ามเที่ยงคืนไว้)
 * · 7 วัน / 30 วัน = รวมวันนี้ (วันนี้ − 6 … วันนี้)
 */
export function presetRange(key: RangeKey, today: string): { from: string; to: string } {
  switch (key) {
    case "today": return { from: today, to: today };
    case "yesterday": { const y = addDays(today, -1); return { from: y, to: y }; }
    case "7d": return { from: addDays(today, -6), to: today };
    case "30d": return { from: addDays(today, -29), to: today };
    case "thisMonth": return { from: today.slice(0, 8) + "01", to: today };
    case "lastMonth": {
      const first = today.slice(0, 8) + "01";
      const lastPrev = addDays(first, -1);
      return { from: lastPrev.slice(0, 8) + "01", to: lastPrev };
    }
  }
}

/** ช่วงที่ตรงกับ preset ไหน (ไม่ตรง = null → ปุ่มไม่ไฮไลต์) */
export function matchPreset(from: string, to: string, today: string): RangeKey | null {
  for (const k of Object.keys(RANGE_LABEL) as RangeKey[]) {
    const r = presetRange(k, today);
    if (r.from === from && r.to === to) return k;
  }
  return null;
}

/**
 * ช่วงก่อนหน้าที่ใช้เทียบ — ยาวเท่ากัน ติดกันพอดี
 * ★ "เดือนนี้" (1-18) เทียบกับ 18 วันก่อนหน้า ไม่ใช่ทั้งเดือนก่อน
 *   ⇒ เทียบความยาวเท่ากันเสมอ ไม่งั้นต้นเดือนจะดูเหมือนยอดตกทุกครั้ง
 */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const days = Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000) + 1;
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

/**
 * เปลี่ยนไปกี่ % จากช่วงก่อน — `null` เมื่อช่วงก่อนเป็น 0 (หารไม่ได้ ไม่ใช่ +100%)
 * 🪤 บอกว่า "+100%" ตอนช่วงก่อนไม่มียอดเลย = ตัวเลขที่ไม่มีความหมายแต่ดูน่าเชื่อ
 */
export function changePct(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

// ── เมนูขายดี ────────────────────────────────────────────────────────────────
export type TopSort = "qty" | "revenue" | "profit";
export const TOP_SORT_LABEL: Record<TopSort, string> = { qty: "จำนวน", revenue: "ยอดขาย", profit: "กำไร" };

/** เรียงเมนูขายดีใหม่ · เสมอกัน = ตัดสินด้วยยอดขาย แล้วชื่อ (ลำดับไม่สลับเอง · บทเรียน D107) */
export function sortTopMenus(list: readonly TopMenu[], by: TopSort, limit = 10): TopMenu[] {
  return [...list]
    .sort((a, b) => b[by] - a[by] || b.revenue - a.revenue || a.menuName.localeCompare(b.menuName))
    .slice(0, limit);
}

/**
 * ข้อความถามยืนยันก่อนลงบัญชีวันขายปัจจุบัน — `null` = ไม่ต้องถาม (วันที่ผ่านไปแล้ว)
 * 🚨 หลังลงแล้วปิดบิลเข้าวันนั้นไม่ได้ (0083) — ต้องบอก **ก่อน** กด ไม่ใช่ให้ไปเจอตอนปิดบิล
 * ★ ตัดสินประโยคที่นี่ (มีเทสคุม) ไม่ใช่ในคอมโพเนนต์ (D84/D91)
 */
export function postConfirmText(state: DayState, openBills: number): string | null {
  if (state !== "selling") return null;
  const open = openBills > 0 ? ` และยังมีบิลเปิดอยู่ ${openBills} ใบ` : "";
  return `วันนี้ยังเป็นวันขายปัจจุบัน${open} — ลงบัญชีแล้วจะปิดบิลเข้าวันนี้ไม่ได้อีก จนกว่าจะกด ถอนการลงบัญชี · ถ้าร้านยังไม่ปิด แนะนำให้ลงพรุ่งนี้`;
}
