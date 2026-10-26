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
 * · ⛔ ~~ชุดตกแต่งบวกเข้าบรรทัดของวัตถุดิบ~~ (D127) → **D131: เพิ่มเป็นบรรทัดของชุด** · กดซ้ำ = +1 ชุด
 *   ⇒ แก้สัดส่วนของชุดทีหลัง ทุกเมนูที่อ้างชุดเปลี่ยนตาม (แก้วที่ขายไปแล้วไม่ขยับ — ตัดตอนสั่งแล้ว)
 * · ชุดที่ไม่ตัดสต็อกมีได้ (วัตถุดิบว่าง · ผู้ใช้เปลี่ยนใจจาก D127)
 * · กดปุ่มไหนซ้ำก็ไปที่บรรทัดเดิม **ไม่สร้างบรรทัดซ้ำ** (2 บรรทัดของเดียวกันคือสิ่งที่ทำให้บันทึกพัง)
 */
import type { BarGarnish, BarItem, BarMenu, HouseSlot } from "./types";
import { rowRefKey, type RecipeDraftRow } from "./recipe";
import { garnishContent, garnishDeleteBlock } from "./houseSlot";
import { parseQty, qtyShown, qtyTextToKeep } from "./fraction";

export type QuickPick =
  | { kind: "slot"; slotId: string }
  | { kind: "item"; itemId: string }
  | { kind: "garnish"; garnishId: string };

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
      .filter((g) => g.itemId === null || (byId.has(g.itemId) && byId.get(g.itemId)?.active !== false))
      .map((g) => ({
        key: `garnish:${g.garnishId}`,
        label: g.name,
        hint: `+1 ชุด · ${garnishContent(g, byId)}`,
        pick: { kind: "garnish", garnishId: g.garnishId },
      })),
  };
}

const isBlank = (r: RecipeDraftRow) => !rowRefKey(r) && !(r.text ?? "").trim() && (r.qty === "" || r.qty === 0);

/**
 * กดปุ่มลัด → แถวสูตรใหม่ + แถวที่ต้องโฟกัสช่องจำนวน
 *
 * · House / ใช้บ่อย: มีบรรทัดนั้นอยู่แล้ว → **ไม่แตะอะไร** แค่โฟกัส · ยังไม่มี → ใส่ลงแถวว่างแถวแรก (ไม่มี = ต่อท้าย)
 * · ตกแต่ง (D131): มีบรรทัดของชุดนี้แล้ว → +1 ชุด (ช่องว่าง = นับเป็น 0) · ยังไม่มี → แถวใหม่ 1 ชุด
 * 🪤 บรรทัดชุดตกแต่ง ไม่นับเป็นบรรทัดเดียวกับบรรทัดวัตถุดิบตัวเดียวกัน (มะนาวในสูตร + Lime Wheel)
 *    คนละความหมาย: แก้ชุดทีหลังต้องเปลี่ยนเฉพาะส่วนของชุด (ผลรวมตอนตัดสต็อกยังถูก เพราะรวมต่อขวดอยู่แล้ว)
 */
export function applyPick(rows: readonly RecipeDraftRow[], pick: QuickPick): { rows: RecipeDraftRow[]; focus: number } {
  const key =
    pick.kind === "slot" ? `slot:${pick.slotId}` : pick.kind === "garnish" ? `garnish:${pick.garnishId}` : `item:${pick.itemId}`;
  const next = rows.map((r) => ({ ...r }));
  const hit = next.findIndex((r) => rowRefKey(r) === key);
  const fresh = (): RecipeDraftRow =>
    pick.kind === "slot"
      ? { itemId: "", slotId: pick.slotId, qty: "" }
      : pick.kind === "garnish"
        ? { itemId: "", garnishId: pick.garnishId, qty: 1 }
        : { itemId: pick.itemId, qty: "" };

  if (hit >= 0) {
    if (pick.kind === "garnish") {
      const cur = next[hit].qty === "" ? 0 : (next[hit].qty as number);
      next[hit] = { ...next[hit], qty: r4(cur + 1) };
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

/**
 * แถวในการ์ดตั้งค่า (D131)
 * · `itemId` "" = ชุดที่ไม่ตัดสต็อก
 * · `qtyText` = สิ่งที่พิมพ์ในช่อง (รับ "1/7") — ตัวเลขจริงได้จาก `parseQty`
 * · `qtyUnit` = หน่วยที่จำนวนนี้ถูกพิมพ์ไว้ — 🚨 ต้องตรงกับหน่วยของวัตถุดิบที่เลือกอยู่ถึงบันทึกได้
 *   (เปลี่ยนเป็นวัตถุดิบหน่วยอื่นขณะมีเมนูใช้ → ล้างช่องจำนวน · ผู้ใช้เลือกแบบ ก)
 */
export type GarnishDraft = {
  garnishId: string | null;
  name: string;
  itemId: string;
  qtyText: string;
  qtyUnit: string | null;
};

const unitOf = (items: readonly BarItem[], id: string) => items.find((i) => i.itemId === id)?.unit ?? null;

/** ชุดที่บันทึกไว้ → แถวในการ์ด */
export function garnishDraftOf(g: BarGarnish, items: readonly BarItem[]): GarnishDraft {
  return {
    garnishId: g.garnishId,
    name: g.name,
    itemId: g.itemId ?? "",
    qtyText: g.qty === null ? "" : qtyShown(g.qty, g.qtyText),
    qtyUnit: g.itemId ? unitOf(items, g.itemId) : null,
  };
}

/** พิมพ์จำนวนใหม่ = จำนวนนี้เป็นของหน่วยของวัตถุดิบที่เลือกอยู่ */
export function garnishTypeQty(d: GarnishDraft, text: string, items: readonly BarItem[]): GarnishDraft {
  return { ...d, qtyText: text, qtyUnit: d.itemId ? unitOf(items, d.itemId) : null };
}

/**
 * เปลี่ยนวัตถุดิบของชุด
 * · เลือก "ไม่ตัดสต็อก" → ล้างจำนวน
 * · 🚨 ชุดที่มีเมนูใช้ + หน่วยเปลี่ยน → **ล้างช่องจำนวน** ต้องใส่ใหม่ (1 ลูก ไม่ได้แปลว่า 1 ml)
 * · ยังไม่มีเมนูใช้ หรือหน่วยเดิม → คงจำนวนไว้ (ยังไม่มีแก้วไหนผูกกับตัวเลขนี้)
 */
export function garnishPickItem(d: GarnishDraft, itemId: string, items: readonly BarItem[], usedIn: number): GarnishDraft {
  if (!itemId) return { ...d, itemId: "", qtyText: "", qtyUnit: null };
  const unit = unitOf(items, itemId);
  const prevUnit = d.itemId ? unitOf(items, d.itemId) : null;
  if (usedIn > 0 && d.itemId && prevUnit !== unit) return { ...d, itemId, qtyText: "", qtyUnit: null };
  return { ...d, itemId, qtyUnit: d.qtyText.trim() ? unit : null };
}

/**
 * บรรทัดเหลืองใต้ช่องจำนวน — บอกว่าต้องใส่อะไร **และทำไมช่องถึงว่าง** (D92) · null = ไม่มีอะไรต้องบอก
 * `saved` = ชุดที่บันทึกไว้ (ถ้ามี) — ใช้บอกว่าจำนวนเดิมหายไปเพราะเปลี่ยนหน่วย ไม่ใช่เพราะระบบทำหาย
 */
export function garnishQtyHint(d: GarnishDraft, items: readonly BarItem[], saved?: BarGarnish): string | null {
  if (!d.itemId) return null;
  const unit = unitOf(items, d.itemId);
  if (!d.qtyText.trim()) {
    if (!unit) return null;
    const prevUnit = saved?.itemId ? unitOf(items, saved.itemId) : null;
    if (saved?.qty != null && prevUnit && prevUnit !== unit) {
      return `วัตถุดิบเปลี่ยนจากหน่วย ${prevUnit} เป็น ${unit} — จำนวนเดิม (${qtyShown(saved.qty, saved.qtyText)} ${prevUnit}) ใช้ไม่ได้แล้ว ใส่จำนวนต่อ 1 ชุดใหม่เป็น ${unit}`;
    }
    return `ใส่จำนวนต่อ 1 ชุด เป็น ${unit} (พิมพ์เศษส่วนได้ เช่น 1/7)`;
  }
  if (parseQty(d.qtyText) === null) return "พิมพ์จำนวนเป็นตัวเลขหรือเศษส่วน เช่น 0.5 หรือ 1/7";
  return null;
}

/** แถว → payload ของ RPC `fn_bar_save_garnishes` */
export function garnishPayload(d: GarnishDraft): {
  garnish_id: string | null;
  name: string;
  item_id: string | null;
  qty: number | null;
  qty_text: string | null;
  qty_unit: string | null;
} {
  const has = Boolean(d.itemId);
  return {
    garnish_id: d.garnishId,
    name: d.name.trim(),
    item_id: has ? d.itemId : null,
    qty: has ? parseQty(d.qtyText) : null,
    qty_text: has ? qtyTextToKeep(d.qtyText) : null,
    qty_unit: has ? d.qtyUnit : null,
  };
}

/**
 * ตรวจก่อนบันทึก ("" = ผ่าน) — ใช้ทั้งบนจอและ server
 * 🪤 ชุดที่หายไปจากฉบับร่าง = จะถูกลบ ⇒ ต้องตรวจว่าไม่มีสูตรอ้าง (แบบเดียวกับ `slotEditsError`)
 */
export function garnishEditsError(
  drafts: readonly GarnishDraft[],
  items: readonly BarItem[],
  existing: readonly BarGarnish[],
  menus: readonly Pick<BarMenu, "name" | "recipe">[],
): string {
  const key = (s: string) => s.trim().toLowerCase();
  const seen = new Set<string>();
  for (const [i, d] of drafts.entries()) {
    const row = `แถว ${i + 1}`;
    const name = d.name.trim();
    if (!name) return `${row}: ตั้งชื่อชุดตกแต่งก่อน`;
    if (seen.has(key(name))) return `${row}: ชื่อ "${name}" ซ้ำกับชุดอื่น`;
    seen.add(key(name));
    if (d.garnishId && !existing.some((g) => g.garnishId === d.garnishId)) {
      return `ชุด ${name} ถูกลบจากอีกเครื่องไปแล้ว — รีเฟรชหน้าแล้วลองใหม่`;
    }
    if (!d.itemId) continue; // ไม่ตัดสต็อก
    const it = items.find((x) => x.itemId === d.itemId);
    if (!it) return `${row} (${name}): ไม่พบวัตถุดิบ — เลือกใหม่`;
    if (parseQty(d.qtyText) === null) return `${row} (${name}): ใส่จำนวนต่อชุดมากกว่า 0 (พิมพ์เศษส่วนได้ เช่น 1/7)`;
    if (d.qtyUnit !== it.unit) return `${row} (${name}): วัตถุดิบใช้หน่วย ${it.unit} — ใส่จำนวนต่อชุดใหม่ก่อนบันทึก`;
  }
  const kept = new Set(drafts.map((d) => d.garnishId).filter(Boolean));
  for (const g of existing) {
    if (kept.has(g.garnishId)) continue;
    const block = garnishDeleteBlock(g.garnishId, menus);
    if (block) return `ลบชุด ${g.name} ไม่ได้ — ${block}`;
  }
  return "";
}

/**
 * คำเตือนของชุดตกแต่ง (D92) · ชุดที่ไม่ตัดสต็อก = ไม่มีอะไรต้องเตือน (ผู้ใช้ตั้งใจ)
 * 🚨 วัตถุดิบถูกปิดใช้ = ไม่ขึ้นเป็นปุ่ม **แต่เมนูที่อ้างชุดนี้อยู่ยังตัดวัตถุดิบนั้นต่อ** — ต้องบอกทั้งสองอย่าง
 */
export function garnishWarning(g: Pick<BarGarnish, "itemId">, items: readonly BarItem[]): string | null {
  if (g.itemId === null) return null;
  const it = items.find((i) => i.itemId === g.itemId);
  if (!it) return "ไม่พบวัตถุดิบ — เลือกใหม่";
  if (it.active === false) {
    return `${it.name} ถูกปิดใช้ — ชุดนี้จะไม่ขึ้นเป็นปุ่มในหน้าสร้างเมนู แต่เมนูที่ใช้ชุดนี้อยู่ยังตัด ${it.name} ต่อ`;
  }
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
