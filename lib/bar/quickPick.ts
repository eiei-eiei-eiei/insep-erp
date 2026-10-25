/**
 * lib/bar/quickPick — แถบปุ่มลัดในหน้าสร้างเมนู + ชุดตกแต่ง + วัตถุดิบใช้บ่อย (golden B24 · D127)
 *
 * ผู้ใช้ขอ: เหนือช่องค้นวัตถุดิบมีปุ่มลัด 3 กลุ่ม
 *   · **House** — ช่องเหล้าประจำบ้าน
 *   · **ใช้บ่อย** — วัตถุดิบที่ปักหมุดเองในตั้งค่าบาร์ (🚨 ไม่เรียงตามยอดใช้ — ปุ่มต้องอยู่ที่เดิมเสมอ)
 *   · **ตกแต่ง** — ชุดตกแต่ง (ชื่อ → วัตถุดิบ + จำนวนต่อครั้ง)
 * กดแล้วเพิ่มบรรทัด/บวกจำนวน แล้วโฟกัสช่องจำนวนให้
 *
 * ── กติกา ────────────────────────────────────────────────────────────────────
 * · ลำดับปุ่ม = ที่ผู้ใช้จัดเองด้วย ▲▼ (ผู้ใช้เลือก) · เท่ากัน → ตัดสินด้วยชื่อแล้ว id (ห้ามสลับเองทุกครั้งที่โหลด · D107)
 * · ชุดตกแต่ง **บวกเข้าบรรทัดของวัตถุดิบนั้น** ไม่แยกบรรทัด ไม่จำว่าส่วนไหนเป็นของตกแต่ง (ผู้ใช้สั่ง)
 *   ⇒ แก้จำนวนของชุดตกแต่งทีหลัง **เมนูเดิมไม่ขยับ** (บวกเข้าไปแล้วเป็นเลขธรรมดา) — หน้าตั้งค่าต้องบอก
 * · ชุดตกแต่งต้องผูกวัตถุดิบเสมอ (ผู้ใช้เลือก — ชุดที่ไม่ตัดอะไรไม่ต้องมี)
 * · กด House/ใช้บ่อย ซ้ำ = ไปที่บรรทัดเดิม **ไม่สร้างบรรทัดซ้ำ** (2 บรรทัดของเดียวกันคือสิ่งที่ทำให้บันทึกพัง)
 */
import type { BarGarnish, BarItem, HouseSlot } from "./types";
import { rowRefKey, type RecipeDraftRow } from "./recipe";
import { numText } from "./units";

export type QuickPick =
  | { kind: "slot"; slotId: string }
  | { kind: "item"; itemId: string }
  | { kind: "garnish"; itemId: string; qty: number };

export type QuickChip = { key: string; label: string; hint: string; pick: QuickPick };

/** เรียงตามลำดับที่จัดไว้ → ชื่อ → id (ตัวตัดสินสุดท้ายต้องไม่ซ้ำ ไม่งั้นผลขึ้นกับเครื่องยนต์ JS · D107) */
function byOrder<T>(xs: readonly T[], sort: (x: T) => number, name: (x: T) => string, id: (x: T) => string): T[] {
  return [...xs].sort(
    (a, b) => sort(a) - sort(b) || name(a).localeCompare(name(b), "th") || (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0),
  );
}

/** วัตถุดิบที่ปักหมุด เรียงตามที่จัดไว้ — ปิดใช้แล้ว = ไม่ขึ้นเป็นปุ่ม */
export function pinnedItems(items: readonly BarItem[]): BarItem[] {
  return byOrder(
    items.filter((i) => i.pinSort !== null && i.pinSort !== undefined && i.active !== false),
    (i) => i.pinSort as number,
    (i) => i.name,
    (i) => i.itemId,
  );
}

export function orderedSlots(slots: readonly HouseSlot[]): HouseSlot[] {
  return byOrder(slots, (s) => s.sort, (s) => s.name, (s) => s.slotId);
}

export function orderedGarnishes(gs: readonly BarGarnish[]): BarGarnish[] {
  return byOrder(gs, (g) => g.sort, (g) => g.name, (g) => g.garnishId);
}

/**
 * ปุ่มลัด 3 กลุ่ม
 * ★ ชุดตกแต่งที่วัตถุดิบถูกปิดใช้ = ไม่ขึ้นเป็นปุ่ม (ช่องค้นวัตถุดิบก็ไม่เสนอของที่ปิดใช้ — ให้ตรงกัน)
 *   แต่การ์ดตั้งค่ายังเห็นและบอกเหตุผล (`garnishWarning`)
 * ★ ช่องเหล้าประจำบ้านขึ้นเสมอแม้ขวดถูกปิดใช้ — ช่องยังตัดขวดนั้นจริง ซ่อนแล้วเมนูก็ยังใช้อยู่ดี
 */
export function quickChips(
  slots: readonly HouseSlot[],
  items: readonly BarItem[],
  garnishes: readonly BarGarnish[],
): { house: QuickChip[]; pinned: QuickChip[]; garnish: QuickChip[] } {
  const byId = new Map(items.map((i) => [i.itemId, i]));
  return {
    house: orderedSlots(slots).map((s) => {
      const it = byId.get(s.itemId);
      return {
        key: `slot:${s.slotId}`,
        label: s.name,
        hint: it ? `ตอนนี้: ${it.name} (${it.unit})` : "ไม่พบขวด",
        pick: { kind: "slot", slotId: s.slotId },
      };
    }),
    pinned: pinnedItems(items).map((i) => ({
      key: `item:${i.itemId}`,
      label: i.name,
      hint: `หน่วย ${i.unit}`,
      pick: { kind: "item", itemId: i.itemId },
    })),
    garnish: orderedGarnishes(garnishes)
      .filter((g) => byId.get(g.itemId)?.active !== false && byId.has(g.itemId))
      .map((g) => {
        const it = byId.get(g.itemId) as BarItem;
        return {
          key: `garnish:${g.garnishId}`,
          label: g.name,
          hint: `+${numText(g.qty)} ${it.unit} ${it.name}`,
          pick: { kind: "garnish", itemId: g.itemId, qty: g.qty },
        };
      }),
  };
}

const isBlank = (r: RecipeDraftRow) => !rowRefKey(r) && !(r.text ?? "").trim() && (r.qty === "" || r.qty === 0);

/**
 * กดปุ่มลัด → แถวสูตรใหม่ + แถวที่ต้องโฟกัสช่องจำนวน
 *
 * · House / ใช้บ่อย: มีบรรทัดนั้นอยู่แล้ว → **ไม่แตะอะไร** แค่โฟกัส · ยังไม่มี → ใส่ลงแถวว่างแถวแรก (ไม่มี = ต่อท้าย)
 * · ตกแต่ง: บวกจำนวนเข้าบรรทัดของวัตถุดิบนั้น (ช่องจำนวนว่าง = นับเป็น 0) · ยังไม่มี → แถวใหม่ด้วยจำนวนของชุด
 * 🪤 บรรทัดที่อ้าง **ช่อง** ซึ่งตอนนี้ชี้ขวดเดียวกับชุดตกแต่ง ไม่นับเป็นบรรทัดเดียวกัน —
 *    ช่องเปลี่ยนขวดได้ ชุดตกแต่งผูกวัตถุดิบตายตัว (ผลรวมตอนตัดสต็อกยังถูก เพราะรวมต่อขวดอยู่แล้ว)
 */
export function applyPick(rows: readonly RecipeDraftRow[], pick: QuickPick): { rows: RecipeDraftRow[]; focus: number } {
  const key = pick.kind === "slot" ? `slot:${pick.slotId}` : `item:${pick.itemId}`;
  const next = rows.map((r) => ({ ...r }));
  const hit = next.findIndex((r) => rowRefKey(r) === key);
  const fresh = (): RecipeDraftRow =>
    pick.kind === "slot"
      ? { itemId: "", slotId: pick.slotId, qty: "" }
      : { itemId: pick.itemId, qty: pick.kind === "garnish" ? r4(pick.qty) : "" };

  if (hit >= 0) {
    if (pick.kind === "garnish") {
      const cur = next[hit].qty === "" ? 0 : (next[hit].qty as number);
      next[hit] = { ...next[hit], qty: r4(cur + pick.qty) };
    }
    return { rows: next, focus: hit };
  }
  const blank = next.findIndex(isBlank);
  if (blank >= 0) {
    next[blank] = fresh();
    return { rows: next, focus: blank };
  }
  next.push(fresh());
  return { rows: next, focus: next.length - 1 };
}

// ── ตั้งค่าชุดตกแต่ง ─────────────────────────────────────────────────────────

export type GarnishDraft = { garnishId: string | null; name: string; itemId: string; qty: number | "" };

/** ตรวจก่อนบันทึก ("" = ผ่าน) — ใช้ทั้งบนจอและ server */
export function garnishEditsError(drafts: readonly GarnishDraft[], items: readonly BarItem[]): string {
  const key = (s: string) => s.trim().toLowerCase();
  const seen = new Set<string>();
  for (const [i, d] of drafts.entries()) {
    const row = `แถว ${i + 1}`;
    const name = d.name.trim();
    if (!name) return `${row}: ตั้งชื่อชุดตกแต่งก่อน`;
    if (seen.has(key(name))) return `${row}: ชื่อ "${name}" ซ้ำกับชุดอื่น`;
    seen.add(key(name));
    if (!d.itemId || !items.some((it) => it.itemId === d.itemId)) return `${row} (${name}): เลือกวัตถุดิบก่อน`;
    if (d.qty === "" || !(d.qty > 0)) return `${row} (${name}): ใส่จำนวนต่อครั้งมากกว่า 0`;
  }
  return "";
}

/** คำเตือนของชุดตกแต่ง — วัตถุดิบถูกปิดใช้ = ไม่ขึ้นเป็นปุ่ม ต้องบอกว่าทำไม (D92) */
export function garnishWarning(g: Pick<BarGarnish, "itemId">, items: readonly BarItem[]): string | null {
  const it = items.find((i) => i.itemId === g.itemId);
  if (!it) return "ไม่พบวัตถุดิบ — เลือกใหม่";
  if (it.active === false) return `${it.name} ถูกปิดใช้ — ชุดนี้จะไม่ขึ้นเป็นปุ่มในหน้าสร้างเมนู`;
  return null;
}

/**
 * วัตถุดิบใช้บ่อย: ลำดับที่จัด (id เรียง) → ค่า pin_sort ที่ต้องเขียน
 * ★ เขียนทั้งชุดเป็น 0,1,2,… (ล้างเลขซ้ำไปในตัว · แพตเทิร์น D101) · ตัวที่ไม่อยู่ในลำดับ = null (ถอดหมุด)
 */
export function pinPlan(order: readonly string[], items: readonly BarItem[]): { itemId: string; pinSort: number | null }[] {
  const at = new Map(order.map((id, i) => [id, i]));
  return items
    .map((i) => ({ itemId: i.itemId, pinSort: at.has(i.itemId) ? (at.get(i.itemId) as number) : null, prev: i.pinSort ?? null }))
    .filter((r) => r.pinSort !== r.prev)
    .map(({ itemId, pinSort }) => ({ itemId, pinSort }));
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** ▲▼ เลื่อนแถวในลิสต์ที่ยังไม่บันทึก (ใช้ ▲▼ ไม่ใช่ลาก — ทัชสกรีนชนกับการเลื่อนหน้า · D70) */
export function moveAt<T>(xs: readonly T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || i >= xs.length || j < 0 || j >= xs.length) return [...xs];
  const out = [...xs];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
