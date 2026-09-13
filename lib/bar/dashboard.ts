/**
 * lib/bar/dashboard — สรุปยอด/กำไร/เมนูขายดี (golden B7 · D96)
 *
 * 🚨 **อ่านค่าที่แช่ไว้ในบิลเท่านั้น ห้ามคำนวณต้นทุนใหม่**
 *    `bar_item.cost_per_unit` ขยับทุกครั้งที่รับของ — คำนวณสดตอนเปิดดู =
 *    **กำไรของเดือนที่แล้วขยับเองเมื่อเดือนนี้ซื้อของแพงขึ้น** (กติกา D75)
 *    ⇒ ชนิดข้อมูลขาเข้าของไฟล์นี้จึงมีแต่ `grandTotal` / `costTotal` ที่แช่ไว้แล้ว
 *
 * 🚨 **บิลที่ยังเปิดอยู่ไม่นับเป็นยอดขาย** — ยังไม่ได้เงิน และยอดยังเปลี่ยนได้
 *    บิลที่ถูกยกเลิกก็ไม่นับ
 */
import { grossMargin } from "./cost";

/** บิล 1 ใบในรูปแบบที่แดชบอร์ดต้องการ (ค่าที่แช่ไว้แล้วทั้งหมด) */
export type SaleRow = {
  saleNo: string;
  status: "เปิดอยู่" | "ปกติ" | "ยกเลิก";
  /** วันขาย (คิดจาก businessDate.ts มาแล้ว) */
  businessDate: string | null;
  channel: string;
  method: string | null;
  grandTotal: number;
  costTotal: number;
};

export type SaleItemRow = {
  saleNo: string;
  menuId: string | null;
  menuName: string;
  qty: number;
  amount: number;
  cost: number;
  voidedAt?: string | null;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

/** เฉพาะบิลที่ปิดแล้วและไม่ถูกยกเลิก — ตัวเดียวที่นับเป็นยอดขายจริง */
export function countedSales(rows: readonly SaleRow[]): SaleRow[] {
  return rows.filter((r) => r.status === "ปกติ");
}

/** กรองตามช่วงวันขาย (รวมปลายทั้งสองข้าง) · บิลที่ยังไม่มี `businessDate` ถูกข้าม */
export function inRange(rows: readonly SaleRow[], fromISO: string, toISO: string): SaleRow[] {
  return rows.filter((r) => r.businessDate && r.businessDate >= fromISO && r.businessDate <= toISO);
}

export type Summary = {
  bills: number;
  revenue: number;
  cost: number;
  profit: number;
  /** เปอร์เซ็นต์กำไรขั้นต้น — `null` เมื่อยังไม่มียอดขาย (ไม่ใช่ 0) */
  marginPct: number | null;
  /** ยอดเฉลี่ยต่อบิล — `null` เมื่อไม่มีบิล */
  avgPerBill: number | null;
};

export function summarize(rows: readonly SaleRow[]): Summary {
  const counted = countedSales(rows);
  const revenue = round2(counted.reduce((s, r) => s + r.grandTotal, 0));
  const cost = round2(counted.reduce((s, r) => s + r.costTotal, 0));
  const { profit, pct } = grossMargin(revenue, cost);
  return {
    bills: counted.length,
    revenue,
    cost,
    profit,
    marginPct: pct,
    avgPerBill: counted.length ? round2(revenue / counted.length) : null,
  };
}

/** สรุปแยกตามช่องทาง/งาน — ตอบคำถาม "บูธงานนี้คุ้มไหม" */
export function byChannel(rows: readonly SaleRow[]): (Summary & { channel: string })[] {
  const groups = new Map<string, SaleRow[]>();
  for (const r of countedSales(rows)) {
    const key = r.channel || "บาร์";
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  return [...groups.entries()]
    .map(([channel, rs]) => ({ channel, ...summarize(rs) }))
    .sort((a, b) => b.revenue - a.revenue);
}

/** สรุปแยกตามวิธีรับเงิน — ใช้ทำบิลลงบัญชีรายวันด้วย */
export function byMethod(rows: readonly SaleRow[]): { method: string; bills: number; revenue: number }[] {
  const groups = new Map<string, { bills: number; revenue: number }>();
  for (const r of countedSales(rows)) {
    const key = r.method?.trim() || "ไม่ระบุ";
    const g = groups.get(key) ?? { bills: 0, revenue: 0 };
    g.bills += 1;
    g.revenue = round2(g.revenue + r.grandTotal);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([method, g]) => ({ method, ...g }))
    .sort((a, b) => b.revenue - a.revenue);
}

export type TopMenu = {
  menuId: string | null;
  menuName: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
};

/**
 * เมนูขายดี — นับเฉพาะรายการที่**ไม่ถูกยกเลิก** ในบิลที่**ปิดแล้ว**
 * 🪤 จัดกลุ่มด้วย `menuId` ไม่ใช่ชื่อ — ชื่อเมนูถูกแก้ทีหลังได้ (ในบิลเก็บเป็น snapshot)
 *    แต่ถ้า `menuId` ว่าง (เมนูถูกลบไปแล้ว) ค่อยตกไปใช้ชื่อ
 */
export function topMenus(
  sales: readonly SaleRow[],
  items: readonly SaleItemRow[],
  limit = 10,
): TopMenu[] {
  const ok = new Set(countedSales(sales).map((s) => s.saleNo));
  const acc = new Map<string, TopMenu>();
  for (const it of items) {
    if (!ok.has(it.saleNo) || it.voidedAt) continue;
    const key = it.menuId ?? `name:${it.menuName}`;
    const cur =
      acc.get(key) ??
      { menuId: it.menuId, menuName: it.menuName, qty: 0, revenue: 0, cost: 0, profit: 0 };
    cur.qty += it.qty;
    cur.revenue = round2(cur.revenue + it.amount);
    cur.cost = round2(cur.cost + it.cost);
    cur.profit = round2(cur.revenue - cur.cost);
    cur.menuName = it.menuName; // ชื่อล่าสุดที่เคยขาย
    acc.set(key, cur);
  }
  return [...acc.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, limit);
}

/**
 * ลูกค้าที่ไม่ได้มานาน — `lastSeen` เก่ากว่า `days` วันนับจาก `todayISO`
 * 🪤 คนที่ไม่เคยมีวันที่เลย (`lastSeen` ว่าง) **ไม่นับ** — ไม่รู้ ≠ หายไปนาน
 */
export function lapsedCustomers<T extends { lastSeen?: string | null }>(
  customers: readonly T[],
  todayISO: string,
  days = 90,
): T[] {
  const cut = new Date(todayISO + "T00:00:00Z");
  cut.setUTCDate(cut.getUTCDate() - days);
  const cutISO = cut.toISOString().slice(0, 10);
  return customers.filter((c) => c.lastSeen && c.lastSeen < cutISO);
}
