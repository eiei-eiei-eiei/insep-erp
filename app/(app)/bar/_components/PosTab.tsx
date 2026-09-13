"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BarBoot, BarOpenSale } from "../data";
import type { CartLine, BarMenu } from "@/lib/bar/types";
import { barTotals, lineAmount } from "@/lib/bar/totals";
import {
  menuMode, menuWarning, shortages, mergeCart,
  cleanRecipe, blankRecipeRow, danglingRows, type RecipeDraftRow,
} from "@/lib/bar/recipe";
import {
  discountBaht, discountLabel, resolveLines, NO_DISCOUNT, type DiscountInput,
} from "@/lib/bar/discount";
import { customerMenuIds, applyCustomerChip, sortMenusForGrid, searchMenus } from "@/lib/bar/menuFilter";
import { promptPayPayload, promptPayError } from "@/lib/bar/promptpay";
import { buildReceipt } from "@/lib/bar/receipt";
import {
  Card, Msg, TextInput, NumBox, Select, MissingHint, Badge, Empty, fmt, useSaver, useConfirm,
} from "@/lib/shared/ui";
import {
  IconPrint, IconTrash, IconClose, IconMoney, IconCheck, IconPlus, IconAlert,
} from "@/lib/shared/icons";
import {
  openSaleAction, addLinesAction, voidLineAction, closeSaleAction, voidSaleAction,
  quickSaleAction, saveMenuAction, issueReceiptAction,
} from "../actions";

const METHODS = ["เงินสด", "โอนเงิน", "QR", "บัตรเครดิต"];

/** คีย์ของถาดในโหมดบูธ — ไม่มีเลขบิลให้ผูก จึงใช้คีย์คงที่ตัวนี้ */
const BOOTH = "__booth__";

/** ตะกร้าที่ยังไม่ได้ส่งเข้าบิล — ผูกกับ "บิล" ไม่ใช่ผูกกับหน้าจอ (ดูเหตุผลที่ B-1) */
type Trays = Record<string, CartLine[]>;
type Discounts = Record<string, DiscountInput>;

/**
 * ขายหน้าบาร์ (D96 · เขียนใหม่ทั้งหน้าในภาค 2)
 *
 * ── โฟลว์ ────────────────────────────────────────────────────────────────
 *   เปิดบิล → กดเมนู (ลงถาด **ยังไม่แตะ DB**) → ส่งเข้าบิล (**ตัดสต็อกตรงนี้**)
 *   → เก็บเงิน (จอเต็ม: ส่วนลด → วิธีจ่าย → QR/พิมพ์ → ยืนยัน) → ปิดบิล
 *
 * ── 🐛 สามอย่างที่ผู้ใช้เจอตอนใช้จริงแล้วทำให้ต้องรื้อหน้านี้ใหม่ ────────────
 * **B-1 ตะกร้ากับส่วนลดเคยเป็นของกลางทั้งหน้า** (`useState` ตัวเดียว) แต่สลับบิลได้
 *   ⇒ กดเมนูค้างในโต๊ะ 3 แล้วสลับไปโต๊ะ 5 ของตามไปด้วย
 *   ⇒ **ลดให้โต๊ะ 3 ไป 50 แล้วไปปิดโต๊ะ 5 → โต๊ะ 5 ได้ลด 50 โดยไม่มีอะไรบนจอบอก**
 *   → ตอนนี้เป็น `Record<saleNo, …>` ทั้งคู่ · สลับบิลแล้วค่าอยู่กับบิลเดิมเสมอ
 *
 * **B-2 "บันทึกแล้วเพิ่มเข้าบิล" ไม่เข้าบิล** — บันทึกเมนูสำเร็จจริง แต่โค้ดเดิมไปหา
 *   เมนูใหม่จาก `data.menus` ซึ่งเป็น prop ที่ยังเป็นค่ารอบก่อน (setState ยังไม่ re-render)
 *   → หาไม่เจอ → `return` เงียบ ๆ ไม่มี error
 *   🚨 → `addToCart()` รับ **ตัวเมนู** ไม่ใช่ id · ไม่ต้องพึ่งลิสต์ที่อาจยังไม่อัปเดต
 *
 * **โฟลว์บนจอ** — เดิมเป็น `1fr / 360px` ⇒ จอแคบยุบเป็นคอลัมน์เดียว ตะกร้าไปอยู่
 *   **ใต้ตารางเมนูทั้งตาราง** = กดเมนูแล้วไม่มีอะไรขยับในสายตาเลย · จอกว้างก็ยัด
 *   ทุกอย่างลงคอลัมน์ 360px ทั้งที่ฝั่งซ้ายว่างครึ่งจอ
 *   → ตะกร้าเป็น **แถบติดขอบล่าง** บนจอแคบ (เห็นยอดตลอด) และคอลัมน์กว้างขึ้นบนจอกว้าง
 *
 * 🚨 ปุ่มเขียน "ยืนยันรับเงินแล้ว" ไม่ใช่ "ตรวจสอบการชำระเงิน"
 *    PromptPay ไม่มี callback — **ระบบไม่มีทางรู้ว่าจ่ายแล้วจริง** ห้ามทำท่าว่ารู้
 */
export function PosTab({ boot, onReload }: { boot: BarBoot; onReload: () => Promise<void> }) {
  const data = boot;
  const { msg, setMsg } = useSaver();
  const { confirmNode, ask } = useConfirm();
  const [busy, setBusy] = useState(false);

  const [booth, setBooth] = useState(false);
  const [saleNo, setSaleNo] = useState<string | null>(null);
  const [trays, setTrays] = useState<Trays>({});
  const [discounts, setDiscounts] = useState<Discounts>({});
  const [cat, setCat] = useState<string>("");
  const [q, setQ] = useState("");
  const [chipOn, setChipOn] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [paying, setPaying] = useState(false);
  const [newMenu, setNewMenu] = useState(false);
  const [cardMenu, setCardMenu] = useState<string | null>(null);
  const [boothChannel, setBoothChannel] = useState("บาร์");
  const [boothCustomer, setBoothCustomer] = useState("");
  /** บิลที่เพิ่งปิด — เก็บไว้ให้พิมพ์ซ้ำ/ออกใบเสร็จได้ทันทีที่ลูกค้าขอ */
  const [justClosed, setJustClosed] = useState<{
    sale: BarOpenSale;
    rcptNo: string | null;
    /** 🚨 แช่ไว้ตอนปิดบิล — `clearTray()` ล้างส่วนลดของบิลนั้นทิ้งทันที
     *     ไม่แช่ = ใบที่พิมพ์ซ้ำยอดสูงกว่าที่ลูกค้าจ่ายจริง (ตระกูล D75) */
    discount: DiscountInput;
    method: string;
  } | null>(null);

  const sale = data.openSales.find((s) => s.saleNo === saleNo) ?? null;
  const canWrite = data.canWrite;

  /** ถาดที่กำลังใช้อยู่ — โหมดบูธไม่มีเลขบิล จึงใช้คีย์คงที่ */
  const key = booth ? BOOTH : saleNo;
  /** 🚨 `resolveLines` คิดบาทจาก % สดทุกรอบ — ฐาน (ราคา × จำนวน) เปลี่ยนได้ตลอดที่ยังอยู่ในถาด */
  const rawTray = (key && trays[key]) || [];
  const tray = resolveLines(rawTray);
  const disc: DiscountInput = (key && discounts[key]) || NO_DISCOUNT;

  /**
   * 🚨 **สำรองถาดลง localStorage เท่านั้น — ไม่ใช่แหล่งความจริง**
   *    DB เป็นตัวจริงเสมอ · ที่นี่แค่กันของหายตอนรีเฟรชหน้า/มือถือฆ่าแท็บทิ้งกลางคัน
   *    (ของในถาดยังไม่ถูกบันทึกที่ไหนเลยตามดีไซน์ — หายแล้วต้องกดใหม่ทั้งรอบ)
   */
  const lsKey = `bar:tray:${data.entityId}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(lsKey);
      if (raw) {
        const saved = JSON.parse(raw) as { trays?: Trays; discounts?: Discounts };
        if (saved.trays) setTrays(saved.trays);
        if (saved.discounts) setDiscounts(saved.discounts);
      }
      setBooth(localStorage.getItem("bar:booth") === "1");
    } catch {
      /* โหมดส่วนตัว/ปิดคุกกี้ = อ่านไม่ได้ ก็แค่เริ่มจากถาดว่าง */
    }
  }, [lsKey]);
  useEffect(() => {
    try {
      localStorage.setItem(lsKey, JSON.stringify({ trays, discounts }));
    } catch {
      /* เต็ม/ถูกบล็อก = ข้ามไป ห้ามพังหน้าขาย */
    }
  }, [lsKey, trays, discounts]);

  const setTray = useCallback(
    (k: string, fn: (prev: CartLine[]) => CartLine[]) =>
      setTrays((p) => ({ ...p, [k]: fn(p[k] ?? []) })),
    [],
  );

  async function run(fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (!r.ok) {
        setMsg({ ok: false, text: r.error ?? "บันทึกไม่สำเร็จ" });
        return null;
      }
      await onReload();
      setMsg({ ok: true, text: okText });
      return r;
    } finally {
      setBusy(false);
    }
  }

  // ── เมนูที่แสดง ───────────────────────────────────────────────────────────
  const customerId = booth ? boothCustomer || null : (sale?.customerId ?? null);
  const history = useMemo(
    () =>
      data.openSales.flatMap((s) =>
        s.lines
          .filter((l) => !l.voidedAt && l.menuId)
          .map((l) => ({ menuId: l.menuId!, customerId: s.customerId, at: s.openedAt, qty: l.qty })),
      ),
    [data.openSales],
  );
  const chipIds = useMemo(
    () => customerMenuIds(customerId, { menus: data.menus, history }),
    [customerId, data.menus, history],
  );
  const shown = useMemo(() => {
    let list = data.menus.filter((m) => m.active !== false);
    if (cat) list = list.filter((m) => m.categoryId === cat);
    list = applyCustomerChip(list, chipOn, chipIds);
    list = searchMenus(list, q);
    return sortMenusForGrid(list, history);
  }, [data.menus, cat, chipOn, chipIds, q, history]);

  /**
   * 🐛 **เจอตอนเทสในเบราว์เซอร์ 2026-09-13** — ยอดเคยคิดจาก **ถาดอย่างเดียว**
   *    พอกด "ส่งเข้าบิล" ถาดถูกล้าง ⇒ ปุ่มกลายเป็น **"เก็บเงิน 0.00"** ทั้งที่ในบิล
   *    มีของอยู่ 133 บาท · **ปุ่มที่ใช้รับเงินโกหกตัวเลข** = เก็บเงินขาดทั้งบิล
   *    🚨 และร้ายกว่านั้น: `rounding` ที่ส่งเข้า `closeSaleAction` ก็คิดจากถาดว่าง
   *       ⇒ กิจการที่เปิด "ปัดเศษเงินสด" ไว้จะได้ยอดปัดผิดทุกบิลโดยไม่มีอะไรฟ้อง
   *    (ของเดิมก็เป็นแบบนี้ แต่ไม่มีใครเห็นเพราะปุ่มเดิมไม่ได้พิมพ์ยอดไว้บนตัวมัน)
   *
   * ⇒ **ยอดของบิล = รายการที่ส่งเข้าบิลแล้ว + รายการที่ยังอยู่ในถาด**
   *   (โหมดบูธไม่มีบิล เหลือแค่ถาด)
   */
  const billLines: CartLine[] = sale
    ? sale.lines
        .filter((l) => !l.voidedAt)
        .map((l) => ({
          menuId: l.menuId,
          menuName: l.menuName,
          qty: l.qty,
          price: l.price,
          lineDiscount: l.lineDiscount,
          lineDiscountPct: l.lineDiscountPct,
          isComp: l.isComp,
        }))
    : [];
  const allLines = [...billLines, ...tray];
  /** ★ ฐานของ % ท้ายบิล = ยอด**หลัง**หักส่วนลดรายรายการ (golden B10 ล็อกไว้)
   *  คิด `subTotal` ก่อนรอบหนึ่งแล้วค่อยเอาไปแปลง % → บาท แล้วคิดยอดจริงอีกรอบ */
  const discount = discountBaht(disc, barTotals(allLines, {}).subTotal);
  const totals = barTotals(allLines, { discount, roundCash: data.settings.roundCash });
  /** ★ ของขาดดูจาก **ถาด** เท่านั้น — รายการที่ส่งเข้าบิลแล้วตัดสต็อกไปเรียบร้อย */
  const short = shortages(tray, data.menus, data.items);
  const ppTarget = { type: data.settings.promptPayType, id: data.settings.promptPayId };
  const ppError = promptPayError(ppTarget);
  const trayQty = tray.reduce((s, l) => s + l.qty, 0);

  // ── ถาด ───────────────────────────────────────────────────────────────────
  /**
   * 🚨 รับ **ตัวเมนู** ไม่ใช่ `menuId` — นี่คือจุดที่บั๊ก B-2 เกิด
   *    เมนูที่เพิ่งสร้างยังไม่อยู่ใน `data.menus` ของ render รอบนี้
   */
  function addToCart(m: Pick<BarMenu, "menuId" | "name" | "price">) {
    if (!key) return;
    setTray(key, (prev) =>
      mergeCart([...prev, { menuId: m.menuId, menuName: m.name, qty: 1, price: m.price }]),
    );
    setSheet(true);
  }
  const bump = (i: number, by: number) =>
    key &&
    setTray(key, (p) =>
      p.map((x, j) => (j === i ? { ...x, qty: x.qty + by } : x)).filter((x) => x.qty > 0),
    );
  const setQty = (i: number, qty: number) =>
    key && setTray(key, (p) => p.map((x, j) => (j === i ? { ...x, qty: Math.max(1, qty) } : x)));
  const dropLine = (i: number) => key && setTray(key, (p) => p.filter((_, j) => j !== i));
  const patchLine = (i: number, patch: Partial<CartLine>) =>
    key && setTray(key, (p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setDiscount = (v: DiscountInput) => key && setDiscounts((p) => ({ ...p, [key]: v }));
  const clearTray = (k: string) => {
    setTrays((p) => ({ ...p, [k]: [] }));
    setDiscounts((p) => ({ ...p, [k]: NO_DISCOUNT }));
  };

  async function sendTray() {
    if (!saleNo || tray.length === 0) return;
    // 🚨 ส่ง `tray` (ผ่าน resolveLines แล้ว) ไม่ใช่ `rawTray` — ไม่งั้น % ไม่ถูกแปลงเป็นบาท
    const r = await run(() => addLinesAction({ saleNo, lines: tray }), "ส่งเข้าบิลแล้ว");
    if (r) setTrays((p) => ({ ...p, [saleNo]: [] }));
  }

  // ── เอกสาร ────────────────────────────────────────────────────────────────
  async function printDoc(
    target: BarOpenSale,
    opts: {
      paid?: boolean; receipt?: boolean; rcptNo?: string | null; method?: string;
      discount?: DiscountInput;
    } = {},
  ) {
    if (!data.seller) {
      setMsg({ ok: false, text: "ยังไม่ได้ตั้งกิจการของบาร์ — พิมพ์เอกสารไม่ได้" });
      return;
    }
    const lines: (CartLine & { voidedAt?: string | null })[] = target.lines.map((l) => ({
      menuId: l.menuId, menuName: l.menuName, qty: l.qty, price: l.price,
      lineDiscount: l.lineDiscount, isComp: l.isComp, voidedAt: l.voidedAt,
    }));
    const live = lines.filter((l) => !l.voidedAt);
    const d = opts.discount ?? discounts[target.saleNo] ?? NO_DISCOUNT;
    const t = barTotals(live, {
      discount: discountBaht(d, barTotals(live, {}).subTotal),
      roundCash: data.settings.roundCash,
    });
    const cust = data.customers.find((c) => c.customerId === target.customerId) ?? null;
    const doc = buildReceipt({
      status: opts.paid ? "ปกติ" : "เปิดอยู่",
      saleNo: target.saleNo,
      rcptNo: opts.rcptNo ?? null,
      wantReceipt: opts.receipt,
      lines,
      totals: t,
      seller: data.seller,
      buyer: cust ? { name: cust.name, address: cust.address, taxId: cust.taxId, branch: cust.branch } : null,
      method: opts.paid ? (opts.method ?? null) : null,
      closedAt: opts.paid ? new Date().toLocaleString("th-TH") : null,
      printedAt: new Date().toLocaleString("th-TH"),
      footer: data.settings.footer,
      qrPayload: promptPayPayload({ target: ppTarget, amount: t.grandTotal }),
      discountLabel: discountLabel(d),
      layout: data.layout,
      channel: target.channel,
    });
    // 🔴 โหลด lib พิมพ์/QR แบบ dynamic — ไม่งั้นทุกคนที่เปิดแอปโหลดตาม (D61/D82)
    const { receiptHtml, openPrint80, qrSvg, receiptCss } = await import("@/lib/bar/print80");
    const markup = doc.hasQr && doc.qrPayload ? await qrSvg(doc.qrPayload) : null;
    // ★ CSS ต้องมาจากผังเดียวกับที่วาดเนื้อหา ไม่งั้นกระดาษ 58 มม. จะถูกจัดด้วยความกว้าง 80
    const css = receiptCss(doc.layout.paper, doc.layout.fontLarge);
    if (!openPrint80(receiptHtml(doc, markup), doc.title, css)) {
      setMsg({ ok: false, text: "เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต pop-up ให้เว็บนี้ก่อน" });
    }
  }

  /** ถาดของบิลอื่นที่ยังค้างอยู่ — เอาไปเตือนบนชิปบิล */
  const pendingOf = (no: string) => (trays[no] ?? []).length;

  if (!data.entityId) return null;

  return (
    <>
      {confirmNode}
      {/* pb เผื่อแถบตะกร้าที่ลอยอยู่ขอบล่าง — ไม่งั้นเนื้อหาท้ายหน้าถูกบัง */}
      <div className="grid gap-4 pb-44 lg:grid-cols-[1fr_380px] lg:pb-0 2xl:grid-cols-[1fr_420px]">
        {/* ───────── ซ้าย: บิล + เมนู ───────── */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* โหมดบูธ — จำต่อเครื่อง ไม่ใช่ต่อ tenant
                (เครื่องที่บาร์กับเครื่องที่บูธเป็นคนละโหมดในวันเดียวกันได้) */}
            <label className="flex items-center gap-2 rounded-lg bg-raised px-3 py-1.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={booth}
                onChange={(e) => {
                  setBooth(e.target.checked);
                  try {
                    localStorage.setItem("bar:booth", e.target.checked ? "1" : "0");
                  } catch {
                    /* ปิด storage = ไม่จำข้ามครั้ง ก็ยังใช้งานได้ */
                  }
                }}
              />
              โหมดบูธ (ขายเร็ว ไม่เปิดบิลค้าง)
            </label>
            {booth && (
              <>
                <div className="w-40">
                  <Select value={boothChannel} onChange={(e) => setBoothChannel(e.target.value)}>
                    <option>บาร์</option>
                    {data.settings.channels.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </div>
                <div className="w-44">
                  <Select value={boothCustomer} onChange={(e) => setBoothCustomer(e.target.value)}>
                    <option value="">— ไม่ระบุลูกค้า —</option>
                    {data.customers.map((c) => (
                      <option key={c.customerId} value={c.customerId}>
                        {c.nickname || c.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </>
            )}
          </div>

          {!booth && (
            <Card title="บิลที่เปิดอยู่">
              <div className="flex flex-wrap gap-2">
                {data.openSales.map((s) => {
                  const live = s.lines.filter((l) => !l.voidedAt).length;
                  const waiting = pendingOf(s.saleNo);
                  return (
                    <div
                      key={s.saleNo}
                      className={`flex items-center gap-1 rounded-lg px-1 ${
                        saleNo === s.saleNo ? "bg-brand text-on-brand" : "bg-raised text-muted"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSaleNo(s.saleNo)}
                        className="px-2 py-2 text-sm hover:text-ink"
                      >
                        {s.tabName || s.saleNo}
                        <span className="ml-2 opacity-70">{live} รายการ</span>
                        {/* ★ ของค้างในถาดของ *บิลอื่น* ต้องมองเห็นจากตรงนี้
                            ไม่งั้นจะลืมทิ้งไว้แล้วปิดร้านไปเลย */}
                        {waiting > 0 && <span className="ml-1 text-warn">· รอส่ง {waiting}</span>}
                      </button>
                      {canWrite && (
                        <button
                          type="button"
                          title="ปิดบิลนี้ทิ้ง"
                          disabled={busy}
                          onClick={async () => {
                            const ok = await ask({
                              title: `ปิดบิล ${s.tabName || s.saleNo} ทิ้ง?`,
                              detail:
                                live === 0
                                  ? "บิลนี้ยังไม่มีรายการเลย — ปิดทิ้งได้โดยไม่กระทบสต็อก"
                                  : `บิลนี้มี ${live} รายการ — สต็อกจะถูกคืนกลับทุกตัว และบิลจะถูกทำเครื่องหมายว่ายกเลิก (ไม่ลบทิ้ง)`,
                              confirmText: "ปิดบิลทิ้ง",
                              danger: true,
                            });
                            if (!ok) return;
                            const r = await run(() => voidSaleAction(s.saleNo), "ปิดบิลทิ้งแล้ว");
                            if (r) {
                              clearTray(s.saleNo);
                              if (saleNo === s.saleNo) setSaleNo(null);
                            }
                          }}
                          className="grid h-7 w-7 place-items-center rounded hover:bg-crit-bg hover:text-crit disabled:opacity-40"
                        >
                          <IconClose size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
                <NewTabButton
                  disabled={!canWrite || busy}
                  channels={data.settings.channels}
                  customers={data.customers}
                  onOpen={(name, channel, cust) =>
                    run(() => openSaleAction({ tabName: name, channel, customerId: cust }), "เปิดบิลแล้ว").then(
                      (r) => {
                        const no = (r?.data as { sale_no?: string } | undefined)?.sale_no;
                        if (no) setSaleNo(no);
                      },
                    )
                  }
                />
              </div>
              {data.openSales.length === 0 && <Empty>— ยังไม่มีบิลที่เปิดอยู่ —</Empty>}
            </Card>
          )}

          <Card title="เมนู">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCat("")}
                className={`rounded-lg px-2.5 py-1 text-sm ${cat === "" ? "bg-brand text-on-brand" : "bg-raised text-muted"}`}
              >
                ทั้งหมด
              </button>
              {data.categories.map((c) => (
                <button
                  key={c.categoryId}
                  type="button"
                  onClick={() => setCat(c.categoryId)}
                  className={`rounded-lg px-2.5 py-1 text-sm ${cat === c.categoryId ? "bg-brand text-on-brand" : "bg-raised text-muted"}`}
                >
                  {c.name}
                </button>
              ))}
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <TextInput
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ค้นชื่อ · โน้ต · แก้ว · วิธีชง"
                className="max-w-xs"
              />
              {/* ★ ชิปกรองโผล่เฉพาะเมื่อบิลนี้มีลูกค้า — และเป็น "มุมมอง" ไม่ใช่สิทธิ์
                  ปิดชิปแล้วต้องเห็นเมนูครบเหมือนเดิม (golden B9 ล็อกไว้) */}
              {customerId && (
                <label className="flex items-center gap-1.5 text-sm text-muted">
                  <input type="checkbox" checked={chipOn} onChange={(e) => setChipOn(e.target.checked)} />
                  เฉพาะของ {data.customers.find((c) => c.customerId === customerId)?.name ?? "ลูกค้ารายนี้"}
                </label>
              )}
              {canWrite && (
                <button
                  type="button"
                  onClick={() => setNewMenu(true)}
                  className="ml-auto flex items-center gap-1 rounded-lg border border-line bg-card px-3 py-1.5 text-sm text-ink"
                >
                  <IconPlus size={15} /> เมนูใหม่
                </button>
              )}
            </div>

            {/* 🚨 ปุ่มที่กดไม่ได้ต้องบอกว่าขาดอะไร (D83) — เดิมการ์ดเมนูเทาหมดเฉย ๆ
                ผู้ใช้ใหม่จะนึกว่าเมนูเสีย ไม่ใช่ว่า "ยังไม่ได้เปิดบิล" */}
            {!key && (
              <div className="mb-3 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">
                เลือกบิลที่เปิดอยู่ หรือกด <b>＋ เปิดบิลใหม่</b> ก่อน ถึงจะกดสั่งเมนูได้
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-4">
              {shown.map((m) => {
                const warn = menuWarning(m);
                return (
                  <div key={m.menuId} className="rounded-lg border border-line p-2">
                    <button
                      type="button"
                      disabled={!key || !canWrite}
                      onClick={() => addToCart(m)}
                      className="w-full text-left disabled:opacity-50"
                    >
                      <div className="font-medium text-ink">{m.name}</div>
                      <div className="text-sm text-muted">{fmt(m.price)}</div>
                    </button>
                    <div className="mt-1 flex items-center gap-1">
                      {warn && <Badge tone="warn">ยังไม่ตัดสต็อก</Badge>}
                      <button
                        type="button"
                        onClick={() => setCardMenu(cardMenu === m.menuId ? null : m.menuId)}
                        className="ml-auto text-xs text-muted underline"
                      >
                        สูตร
                      </button>
                    </div>
                    {cardMenu === m.menuId && <RecipeCard boot={data} menuId={m.menuId} />}
                  </div>
                );
              })}
            </div>
            {shown.length === 0 && <Empty>— ไม่พบเมนู —</Empty>}
          </Card>
        </div>

        {/* ───────── ขวา (จอกว้าง) / แถบล่าง (จอแคบ): ถาด + ยอด ───────── */}
        <div className="fixed inset-x-0 bottom-14 z-30 md:bottom-0 lg:sticky lg:inset-x-auto lg:bottom-auto lg:top-4 lg:z-auto lg:self-start">
          {/* แถบยุบ — จอแคบเท่านั้น · เห็นยอดตลอดโดยไม่ต้องเลื่อนหา */}
          {!sheet && (
            <button
              type="button"
              onClick={() => setSheet(true)}
              className="flex w-full items-center gap-3 border-t border-line bg-card px-4 py-3 text-left shadow-lg lg:hidden"
            >
              <span className="text-sm text-muted">
                {booth ? "ขายเร็ว" : sale ? sale.tabName || sale.saleNo : "ยังไม่ได้เลือกบิล"}
              </span>
              <span className="ml-auto text-sm text-ink">
                {trayQty > 0
                  ? `${booth ? "" : "รอส่ง "}${trayQty} รายการ`
                  : "ยังไม่ได้เลือกอะไร"}
              </span>
              <span className="text-lg font-bold text-ink">{fmt(totals.grandTotal)}</span>
            </button>
          )}

          <div
            className={`${sheet ? "" : "hidden"} max-h-[78vh] overflow-y-auto border-t border-line bg-card shadow-lg lg:block lg:max-h-none lg:overflow-visible lg:border-0 lg:bg-transparent lg:shadow-none`}
          >
            <div className="p-3 lg:p-0">
              <button
                type="button"
                onClick={() => setSheet(false)}
                className="mb-2 flex w-full items-center gap-2 text-sm text-muted lg:hidden"
              >
                <IconClose size={15} /> ย่อลง
              </button>

              <Card title={booth ? "ขายเร็ว (บูธ)" : sale ? `บิล ${sale.tabName || sale.saleNo}` : "ยังไม่ได้เลือกบิล"}>
                <Msg msg={msg} />

                {!key && !justClosed && <Empty>— เปิดบิลใหม่หรือเลือกบิลที่เปิดอยู่ก่อน —</Empty>}

                {justClosed && (
                  <ClosedPanel
                    info={justClosed}
                    booth={booth}
                    isVat={Boolean(data.seller?.isVat)}
                    busy={busy}
                    canWrite={canWrite}
                    onPrint={() =>
                      printDoc(justClosed.sale, {
                        paid: true,
                        // ★ ออกเลขไปแล้ว = ใบนั้นคือใบเสร็จ/ใบกำกับอย่างย่อ ไม่ใช่ใบแจ้งรายการ
                        receipt: Boolean(justClosed.rcptNo),
                        rcptNo: justClosed.rcptNo,
                        discount: justClosed.discount,
                        method: justClosed.method,
                      })
                    }
                    onIssue={async () => {
                      const r = await run(() => issueReceiptAction(justClosed.sale.saleNo), "ออกใบเสร็จแล้ว");
                      const no = (r?.data as { rcpt_no?: string } | undefined)?.rcpt_no ?? null;
                      if (r) {
                        setJustClosed({ ...justClosed, rcptNo: no });
                        await printDoc(justClosed.sale, {
                          paid: true,
                          receipt: true,
                          rcptNo: no,
                          discount: justClosed.discount,
                          method: justClosed.method,
                        });
                      }
                    }}
                    onClose={() => setJustClosed(null)}
                  />
                )}

                {/* ── ในบิลแล้ว — ตัดสต็อกไปแล้ว แก้ได้แค่ยกเลิกรายการ ── */}
                {sale && sale.lines.filter((l) => !l.voidedAt).length > 0 && (
                  <div className="mb-3">
                    <div className="mb-1 text-sm font-medium text-muted">ในบิลแล้ว</div>
                    {sale.lines
                      .filter((l) => !l.voidedAt)
                      .map((l) => (
                        <div key={l.lineNo} className="flex items-center gap-2 py-0.5 text-sm">
                          <span className="w-8 text-muted">{l.qty}×</span>
                          <span className="flex-1 text-ink">
                            {l.menuName}
                            {l.isComp && <span className="ml-1 text-xs text-muted">(แถม)</span>}
                          </span>
                          <span className="text-ink">{l.isComp ? "—" : fmt(l.amount)}</span>
                          {canWrite && (
                            <button
                              type="button"
                              title="ยกเลิกรายการนี้ (คืนสต็อก)"
                              disabled={busy}
                              onClick={() =>
                                run(
                                  () => voidLineAction({ saleNo: sale.saleNo, lineNo: l.lineNo }),
                                  "ยกเลิกรายการแล้ว",
                                )
                              }
                              className="grid h-7 w-7 place-items-center rounded text-crit hover:bg-crit-bg disabled:opacity-40"
                            >
                              <IconTrash size={14} />
                            </button>
                          )}
                        </div>
                      ))}
                  </div>
                )}

                {/* ── รอส่งเข้าบิล — ยังไม่แตะ DB แก้อะไรก็ได้ฟรี ── */}
                {key && tray.length > 0 && (
                  <div className="mb-3 rounded-lg bg-raised p-2">
                    {/* 🐛 D96 — โหมดบูธ **ไม่มีบิลให้ส่งเข้า** (ขายจบในจังหวะเดียว)
                        เขียนว่า "รอส่งเข้าบิล" = ประโยคขัดกับสิ่งที่หน้าจอทำ (ตระกูล D91/0059) */}
                    <div className="mb-1 text-sm font-medium text-muted">
                      {booth ? "รายการที่จะขาย" : "รอส่งเข้าบิล"} · {trayQty} รายการ
                    </div>
                    {tray.map((l, i) => (
                      <TrayRow
                        key={i}
                        line={l}
                        pct={rawTray[i]?.lineDiscountPct ?? null}
                        onBump={(by) => bump(i, by)}
                        onQty={(v) => setQty(i, v)}
                        onPatch={(p) => patchLine(i, p)}
                        onDrop={() => dropLine(i)}
                      />
                    ))}

                    {!booth && (
                      <button
                        type="button"
                        disabled={busy || !canWrite || !saleNo}
                        onClick={sendTray}
                        className="mt-2 w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-on-brand disabled:opacity-50"
                      >
                        ส่งเข้าบิล — ตัดสต็อก {trayQty} รายการ
                      </button>
                    )}

                    {/* 🚨 ของไม่พอ = เตือน ไม่บล็อก — บาร์จริงเปิดขวดใหม่แล้วคีย์ทีหลังตลอด */}
                    {short.short.length > 0 && (
                      <div className="mt-2 flex gap-1.5 rounded bg-warn-bg px-2 py-1 text-xs text-warn">
                        <IconAlert size={14} className="mt-0.5 shrink-0" />
                        <span>
                          ของอาจไม่พอ:{" "}
                          {short.short.map((s) => `${s.name} ต้อง ${s.need} มี ${s.have} ${s.unit}`).join(" · ")}
                        </span>
                      </div>
                    )}
                    {short.unknownItems.length > 0 && (
                      <div className="mt-1 text-xs text-muted">
                        สูตรอ้างวัตถุดิบที่ไม่มีในทะเบียน {short.unknownItems.length} ตัว — ไม่นับเป็นของขาด
                      </div>
                    )}
                  </div>
                )}

                {key && (
                  <>
                    <div className="space-y-2 border-t border-line pt-2 text-sm">
                      <Row label="รวม" value={fmt(totals.subTotal)} />
                      {totals.discount > 0 && <Row label="ส่วนลดท้ายบิล" value={`-${fmt(totals.discount)}`} />}
                      {totals.rounding !== 0 && <Row label="ปัดเศษ" value={fmt(totals.rounding)} />}
                      <Row label="ยอดสุทธิ" value={fmt(totals.grandTotal)} bold />
                    </div>

                    {/* 🚨 ปุ่มหลักมีได้อันเดียวต่อกลุ่ม (DESIGN_SYSTEM) — เรื่องจ่ายเงินย้ายไปจอของมันเอง
                        เดิมมี เช็คบิล / แสดง QR / ปิดบิล กองเป็นสี่เหลี่ยมเทาเหมือนกันหมด 3 อัน */}
                    <button
                      type="button"
                      disabled={busy || !canWrite || (booth ? tray.length === 0 : !sale)}
                      onClick={() => setPaying(true)}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2.5 text-sm font-medium text-on-brand disabled:opacity-50"
                    >
                      <IconMoney size={17} /> เก็บเงิน {fmt(totals.grandTotal)}
                    </button>
                    <MissingHint
                      checks={
                        booth
                          ? [{ ok: tray.length > 0, label: "รายการที่จะขาย" }]
                          : [
                              { ok: Boolean(sale), label: "บิล" },
                              {
                                ok: Boolean(sale && sale.lines.some((l) => !l.voidedAt)),
                                label: "รายการที่ส่งเข้าบิลแล้ว",
                              },
                            ]
                      }
                    />
                  </>
                )}
              </Card>
            </div>
          </div>
        </div>
      </div>

      {paying && key && (
        <PayScreen
          boot={data}
          booth={booth}
          sale={sale}
          tray={tray}
          totals={totals}
          disc={disc}
          discountBahtValue={discount}
          onDiscount={setDiscount}
          ppError={ppError}
          ppPayload={promptPayPayload({ target: ppTarget, amount: totals.grandTotal })}
          busy={busy}
          onPrintBill={(method) => sale && printDoc(sale, { method })}
          onClose={() => setPaying(false)}
          onConfirm={async (method) => {
            if (booth) {
              const r = await run(
                () =>
                  quickSaleAction({
                    lines: tray,
                    method,
                    channel: boothChannel,
                    customerId: boothCustomer || null,
                    discount,
                    discountPct: disc.mode === "pct" ? disc.value : null,
                    roundCash: data.settings.roundCash,
                    window: data.settings.window,
                  }),
                "ขายแล้ว",
              );
              if (r) {
                const no = (r.data as { sale_no?: string } | undefined)?.sale_no ?? "";
                const rcpt = (r.data as { rcpt_no?: string | null } | undefined)?.rcpt_no ?? null;
                setJustClosed({
                  sale: {
                    saleNo: no,
                    tabName: null,
                    customerId: boothCustomer || null,
                    channel: boothChannel,
                    openedAt: new Date().toISOString(),
                    lines: tray.map((l, i) => ({
                      lineNo: i + 1,
                      menuId: l.menuId,
                      menuName: l.menuName,
                      qty: l.qty,
                      price: l.price,
                      lineDiscount: l.lineDiscount ?? 0,
                      lineDiscountPct: l.lineDiscountPct ?? null,
                      isComp: Boolean(l.isComp),
                      amount: lineAmount(l),
                      voidedAt: null,
                    })),
                  },
                  rcptNo: rcpt,
                  discount: disc,
                  method,
                });
                clearTray(BOOTH);
                setPaying(false);
              }
              return;
            }
            if (!sale) return;
            const r = await run(
              () =>
                closeSaleAction({
                  saleNo: sale.saleNo,
                  method,
                  discount,
                  discountPct: disc.mode === "pct" ? disc.value : null,
                  rounding: totals.rounding,
                  window: data.settings.window,
                }),
              "ปิดบิลแล้ว",
            );
            if (r) {
              // ★ กิจการจด VAT: `fn_bar_close_sale` ออกเลขใบกำกับอย่างย่อให้ตั้งแต่ปิดบิล
              //   (ไม่ต้องรอลูกค้ากดขอ) — รับมาโชว์เลยจะได้พิมพ์ใบที่ถูกต้องทันที
              const rcpt = (r.data as { rcpt_no?: string | null } | undefined)?.rcpt_no ?? null;
              setJustClosed({ sale, rcptNo: rcpt, discount: disc, method });
              clearTray(sale.saleNo);
              setSaleNo(null);
              setPaying(false);
            }
          }}
        />
      )}

      {newMenu && (
        <NewMenuModal
          boot={data}
          customerId={customerId}
          busy={busy}
          onClose={() => setNewMenu(false)}
          onSave={async (input) => {
            const r = await run(() => saveMenuAction(input), "บันทึกเมนูแล้ว");
            if (r) {
              setNewMenu(false);
              const id = (r.data as { menu_id?: string } | undefined)?.menu_id;
              // 🚨 ใส่ลงถาดจาก **ค่าที่เพิ่งกรอก** ไม่ใช่จาก `data.menus` ที่ยังไม่อัปเดต (B-2)
              if (id && key) addToCart({ menuId: id, name: input.name, price: input.price });
            }
          }}
        />
      )}
    </>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center">
      <span className={`flex-1 ${bold ? "font-medium text-ink" : "text-muted"}`}>{label}</span>
      <span className={bold ? "font-bold text-ink" : "text-ink"}>{value}</span>
    </div>
  );
}

/**
 * แถวในถาด
 *
 * 🐛 เดิมเป็น `[ช่องตัวเลข] ชื่อเมนู [ช่องตัวเลข] ☐แถม [ยอด]` — **ช่องตัวเลขเปล่า 2 ช่อง
 *    ติดกันโดยไม่มีป้ายบอกว่าอันไหนคืออะไร** (มีแค่ `title=` ที่บนทัชสกรีนไม่มีทางเห็น)
 *    ผู้ใช้บอกตรง ๆ ว่า "งงไปหมด"
 *
 * ⇒ แถวหลักเหลือ **− จำนวน + · ชื่อ · ยอด · ⋯**
 *   ส่วนลด/แถม ย้ายไปหลัง ⋯ (ใช้ไม่กี่ครั้งต่อคืน ไม่ควรกินที่ทุกบรรทัดตลอดเวลา)
 * 🚨 แต่ **ต้องเหลือร่องรอยบนแถวที่ยุบแล้ว** — ลดไว้แล้วมองไม่เห็นจะปิดบิลผิดยอด
 *    (ค่าที่มีผลจริงต้องมองเห็นเสมอ — ตระกูล D80)
 */
function TrayRow({
  line, pct, onBump, onQty, onPatch, onDrop,
}: {
  /** บรรทัดที่ผ่าน `resolveLines()` แล้ว — `lineDiscount` เป็นบาทเสมอ */
  line: CartLine;
  /** % ที่ผู้ใช้กรอกไว้ (ถ้ามี) — มาจากของดิบในถาด ไม่ใช่จากบรรทัดที่คิดแล้ว */
  pct: number | null;
  onBump: (by: number) => void;
  onQty: (v: number) => void;
  onPatch: (patch: Partial<CartLine>) => void;
  onDrop: () => void;
}) {
  const [open, setOpen] = useState(false);
  const disc = line.lineDiscount ?? 0;
  const mode: "baht" | "pct" = pct != null ? "pct" : "baht";
  return (
    <div className="border-b border-line/50 py-1 last:border-0">
      <div className="flex items-center gap-2 text-sm">
        <div className="flex items-center rounded-lg bg-card">
          <button
            type="button"
            onClick={() => onBump(-1)}
            aria-label="ลดจำนวน"
            className="grid h-8 w-8 place-items-center rounded-l-lg text-muted hover:bg-raised hover:text-ink"
          >
            −
          </button>
          <span className="w-7 text-center tabular-nums text-ink">{line.qty}</span>
          <button
            type="button"
            onClick={() => onBump(1)}
            aria-label="เพิ่มจำนวน"
            className="grid h-8 w-8 place-items-center rounded-r-lg text-muted hover:bg-raised hover:text-ink"
          >
            ＋
          </button>
        </div>
        <span className="flex-1 text-ink">
          {line.menuName}
          {/* ร่องรอยของสิ่งที่ซ่อนอยู่หลัง ⋯ */}
          {line.isComp && <span className="ml-1 text-xs text-muted">· แถม</span>}
          {!line.isComp && disc > 0 && (
            <span className="ml-1 text-xs text-warn">
              · ลด {pct != null ? `${pct}% (${fmt(disc)})` : fmt(disc)}
            </span>
          )}
        </span>
        <span className="w-16 text-right text-ink">{fmt(lineAmount(line))}</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="ปรับส่วนลด / ของแถม"
          className="grid h-8 w-7 place-items-center rounded text-muted hover:bg-raised hover:text-ink"
        >
          ⋯
        </button>
      </div>

      {open && (
        <div className="mt-1 flex flex-wrap items-center gap-2 rounded bg-card px-2 py-1.5 text-xs">
          <span className="text-muted">จำนวน</span>
          <div className="w-16">
            <NumBox value={line.qty} onChange={(v) => v !== "" && onQty(v)} />
          </div>
          <span className="text-muted">ส่วนลด</span>
          <div className="w-24">
            {/* 🚨 ช่องเดียวสองความหมาย — ค่าที่กรอกต้องสลับตามหน่วยที่เลือก
                ไม่งั้นเปลี่ยนจาก "50 บาท" เป็นโหมด % แล้วกลายเป็น "ลด 50%" เงียบ ๆ */}
            <NumBox
              value={mode === "pct" ? (pct ?? 0) : disc}
              onChange={(v) => {
                const n = v === "" ? 0 : Math.max(0, v);
                if (mode === "pct") onPatch({ lineDiscountPct: n || null });
                else onPatch({ lineDiscount: n, lineDiscountPct: null });
              }}
              blankZero
            />
          </div>
          <div className="flex overflow-hidden rounded border border-line">
            {(["baht", "pct"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() =>
                  m === "pct"
                    ? onPatch({ lineDiscountPct: pct ?? 0, lineDiscount: 0 })
                    : onPatch({ lineDiscountPct: null, lineDiscount: disc })
                }
                className={`px-2 py-1 ${mode === m ? "bg-brand text-on-brand" : "text-muted"}`}
              >
                {m === "baht" ? "บาท" : "%"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-muted">
            <input
              type="checkbox"
              checked={Boolean(line.isComp)}
              onChange={(e) => onPatch({ isComp: e.target.checked })}
            />
            แถม (ยอด 0 แต่ต้นทุนยังนับ)
          </label>
          <button
            type="button"
            onClick={onDrop}
            className="ml-auto flex items-center gap-1 rounded border border-crit-line px-2 py-1 text-crit"
          >
            <IconTrash size={13} /> เอาออก
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * จอเก็บเงิน — เรียงตามลำดับที่เกิดจริงหน้าเคาน์เตอร์
 * ส่วนลด → วิธีรับเงิน → QR/พิมพ์ → ยืนยัน
 *
 * ★ แยกออกมาเป็นจอของตัวเองเพราะ 95% ของเวลาผู้ใช้กำลัง *สั่งของ* ไม่ใช่ *เก็บเงิน*
 *   ปุ่มพวกนี้เคยกองอยู่ใต้ตะกร้าตลอดเวลาจนหาปุ่มที่ใช้บ่อยไม่เจอ
 */
function PayScreen({
  boot, booth, sale, tray, totals, disc, discountBahtValue, onDiscount, ppError, ppPayload,
  busy, onPrintBill, onClose, onConfirm,
}: {
  boot: BarBoot;
  booth: boolean;
  sale: BarOpenSale | null;
  tray: CartLine[];
  totals: ReturnType<typeof barTotals>;
  /** ส่วนลดท้ายบิลที่ผู้ใช้กรอก (บาท หรือ %) */
  disc: DiscountInput;
  /** ค่าเดียวกันที่แปลงเป็นบาทแล้ว — ไว้โชว์กำกับตอนกรอกเป็น % */
  discountBahtValue: number;
  onDiscount: (v: DiscountInput) => void;
  ppError: string | null;
  ppPayload: string | null;
  busy: boolean;
  onPrintBill: (method: string) => void;
  onClose: () => void;
  onConfirm: (method: string) => void;
}) {
  const [method, setMethod] = useState(METHODS[0]);
  const [svg, setSvg] = useState<string | null>(null);
  const wantQr = method === "QR" || method === "โอนเงิน";

  useEffect(() => {
    if (!wantQr || !ppPayload) {
      setSvg(null);
      return;
    }
    let alive = true;
    void import("@/lib/bar/print80").then(async (m) => {
      const s = await m.qrSvg(ppPayload);
      if (alive) setSvg(s);
    });
    return () => {
      alive = false;
    };
  }, [wantQr, ppPayload]);

  /**
   * 🚨 ของที่ยังค้างในถาดต้องขวางการปิดบิล — ไม่ใช่ปิดไปเงียบ ๆ
   *    ผู้ใช้ยกประเด็นนี้เอง: *ปุ่มที่ต้องกดเป็นกิจวัตรคือปุ่มที่วันหนึ่งจะลืมกด* (D91)
   *    ลืมกด "ส่งเข้าบิล" แล้วปิดบิล = ของที่ชงไปแล้วหายทั้งจากบิลและจากสต็อก
   */
  const stuck = !booth && tray.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl bg-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-lg font-bold text-ink">
            เก็บเงิน {booth ? "(บูธ)" : sale ? sale.tabName || sale.saleNo : ""}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="ml-auto grid h-8 w-8 place-items-center rounded text-muted hover:bg-raised hover:text-ink"
          >
            <IconClose size={16} />
          </button>
        </div>

        {stuck && (
          <div className="mb-3 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">
            ยังมี <b>{tray.length} รายการ</b> ที่ยังไม่ได้ส่งเข้าบิล — ปิดบิลตอนนี้รายการพวกนั้นจะหายไป
            <div className="mt-1 text-xs">
              ปิดจอนี้แล้วกด <b>ส่งเข้าบิล</b> ก่อน หรือเอารายการที่ค้างออกจากถาด
            </div>
          </div>
        )}

        <div className="mb-3 rounded-lg bg-raised p-3 text-center">
          <div className="text-xs text-muted">ยอดที่ต้องเก็บ</div>
          <div className="text-3xl font-bold text-ink">{fmt(totals.grandTotal)}</div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="flex-1 text-muted">ส่วนลดท้ายบิล</span>
          <div className="w-24">
            <NumBox
              value={disc.value || ""}
              onChange={(v) => onDiscount({ mode: disc.mode, value: v === "" ? 0 : Math.max(0, v) })}
              blankZero
            />
          </div>
          <div className="flex overflow-hidden rounded border border-line">
            {(["baht", "pct"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onDiscount({ mode: m, value: disc.value })}
                className={`px-2.5 py-1.5 ${disc.mode === m ? "bg-brand text-on-brand" : "text-muted"}`}
              >
                {m === "baht" ? "บาท" : "%"}
              </button>
            ))}
          </div>
          {/* ★ กรอกเป็น % ต้องเห็นว่าคิดเป็นเงินเท่าไร — ไม่งั้นตัดสินใจให้ส่วนลดไม่ได้
              🚨 ฐานคือยอด**หลัง**หักส่วนลดรายรายการแล้ว (golden B10) */}
          {disc.mode === "pct" && disc.value > 0 && (
            <span className="w-full text-right text-xs text-muted">
              = {fmt(discountBahtValue)} บาท (คิดจากยอดหลังหักส่วนลดรายรายการ)
            </span>
          )}
        </div>

        <div className="mb-3">
          <div className="mb-1 text-sm text-muted">รับเงินด้วย</div>
          <div className="grid grid-cols-2 gap-2">
            {METHODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={`rounded-lg px-3 py-2.5 text-sm ${
                  method === m ? "bg-brand text-on-brand" : "border border-line bg-card text-ink"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {wantQr && (
          <div className="mb-3 text-center">
            {ppError ? (
              <p className="text-xs text-warn">{ppError}</p>
            ) : (
              <>
                <div className="mx-auto w-56 bg-white p-3" dangerouslySetInnerHTML={{ __html: svg ?? "" }} />
                <p className="mt-1 text-xs text-muted">พร้อมเพย์ · ยอดถูกกำหนดไว้ในคิวอาร์แล้ว</p>
              </>
            )}
          </div>
        )}

        {!booth && sale && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onPrintBill(method)}
            className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink disabled:opacity-50"
          >
            <IconPrint size={16} /> พิมพ์ใบแจ้งรายการ{ppError ? "" : " + QR"}
          </button>
        )}

        <button
          type="button"
          disabled={busy || stuck}
          onClick={() => onConfirm(method)}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2.5 text-sm font-medium text-on-brand disabled:opacity-50"
        >
          <IconCheck size={17} /> ยืนยันรับเงินแล้ว → {booth ? "ขายเลย" : "ปิดบิล"}
        </button>

        {/* 🚨 ระบบไม่ได้ตรวจการชำระเงินให้ — PromptPay ไม่มี callback */}
        <p className="mt-2 text-xs text-faint">
          ระบบไม่ได้ตรวจสอบว่าเงินเข้าจริง — กดยืนยันเมื่อเห็นสลิปของลูกค้าแล้วเท่านั้น
        </p>
        {!boot.seller && (
          <p className="mt-1 text-xs text-warn">ยังไม่ได้ตั้งกิจการของบาร์ — พิมพ์เอกสารไม่ได้</p>
        )}
      </div>
    </div>
  );
}

/** บิลที่เพิ่งปิด — ลูกค้ามักขอใบเสร็จหลังจ่ายไปแล้วสองสามวินาที */
function ClosedPanel({
  info, booth, isVat, busy, canWrite, onPrint, onIssue, onClose,
}: {
  info: { sale: BarOpenSale; rcptNo: string | null };
  /** โหมดบูธไม่เคยมี "บิล" ให้ผู้ใช้เห็น — คำว่า "ปิดบิล" จึงไม่ตรงกับสิ่งที่เขาเพิ่งทำ */
  booth: boolean;
  /** กิจการจด VAT — ใบเสร็จคือ **ใบกำกับภาษีอย่างย่อ** และออกเลขให้แล้วตั้งแต่ปิดบิล */
  isVat: boolean;
  busy: boolean;
  canWrite: boolean;
  onPrint: () => void;
  onIssue: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mb-3 rounded-lg bg-raised p-3">
      <div className="mb-2 text-sm text-ink">
        {booth ? "ขายแล้ว · เลขที่ " : "ปิดบิล "}
        <b>{booth ? info.sale.saleNo : info.sale.tabName || info.sale.saleNo}</b>
        {booth ? "" : " แล้ว"}
        {info.rcptNo && (
          <>
            {" "}
            · {isVat ? "ใบกำกับภาษีอย่างย่อเลขที่" : "ใบเสร็จเลขที่"} <b>{info.rcptNo}</b>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onPrint}
          className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-sm text-ink disabled:opacity-50"
        >
          <IconPrint size={15} /> พิมพ์ซ้ำ
        </button>
        {/* ★ กิจการจด VAT ได้เลขมาแล้วตั้งแต่ปิดบิล — ปุ่มนี้จึงไม่มีอะไรให้ "ขอ" อีก
            🚨 ปล่อยปุ่มไว้ให้กดแล้วไม่มีอะไรเกิด = ผู้ใช้จะกดซ้ำแล้วสงสัยว่าพัง */}
        {!(isVat && info.rcptNo) && (
          <button
            type="button"
            disabled={busy || !canWrite}
            onClick={onIssue}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-sm text-ink disabled:opacity-50"
          >
            <IconPrint size={15} /> ลูกค้าขอใบเสร็จรับเงิน
          </button>
        )}
        <button type="button" onClick={onClose} className="ml-auto text-sm text-muted underline">
          ปิด
        </button>
      </div>
    </div>
  );
}

/** การ์ดสูตร — "เผื่อลูกค้ามาสั่งซ้ำจะได้เปิดดูได้ ให้จำเองคงไม่หมด" */
function RecipeCard({ boot, menuId }: { boot: BarBoot; menuId: string }) {
  const m = boot.menus.find((x) => x.menuId === menuId);
  if (!m) return null;
  const mode = menuMode(m);
  return (
    <div className="mt-2 rounded bg-raised p-2 text-xs">
      {mode === "recipe" ? (
        <ul className="mb-1">
          {m.recipe.map((r) => {
            const it = boot.items.find((i) => i.itemId === r.itemId);
            return (
              <li key={r.itemId} className="text-ink">
                {it?.name ?? r.itemId} {r.qty} {it?.unit ?? ""}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mb-1 text-muted">{mode === "fixed" ? "ต้นทุนตายตัว" : "ยังไม่ตั้งสูตร"}</div>
      )}
      {m.glass && <div className="text-muted">แก้ว: {m.glass}</div>}
      {m.method && <div className="whitespace-pre-wrap text-muted">วิธีชง: {m.method}</div>}
      {m.note && <div className="text-muted">โน้ต: {m.note}</div>}
    </div>
  );
}

function NewTabButton({
  disabled, onOpen, channels, customers,
}: {
  disabled: boolean;
  onOpen: (name: string, channel: string, customerId: string | null) => void;
  channels: string[];
  customers: { customerId: string; name: string; nickname: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState("บาร์");
  const [cust, setCust] = useState("");
  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink disabled:opacity-50"
      >
        <IconPlus size={15} /> เปิดบิลใหม่
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="w-32">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="โต๊ะ 3 / พี่โอ๊ต" />
      </div>
      <div className="w-28">
        <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option>บาร์</option>
          {channels.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </div>
      {/* 🚨 ลูกค้าเป็นตัวเลือกเสมอ ห้ามบล็อกการขาย — ที่บูธเจอกันครั้งเดียว ไม่มีใครยอมให้เบอร์ */}
      <div className="w-36">
        <Select value={cust} onChange={(e) => setCust(e.target.value)}>
          <option value="">— ไม่ระบุลูกค้า —</option>
          {customers.map((c) => (
            <option key={c.customerId} value={c.customerId}>
              {c.nickname || c.name}
            </option>
          ))}
        </Select>
      </div>
      <button
        type="button"
        onClick={() => {
          onOpen(name, channel, cust || null);
          setOpen(false);
          setName("");
          setCust("");
        }}
        className="rounded-lg bg-brand px-3 py-2 text-sm text-on-brand"
      >
        เปิด
      </button>
    </div>
  );
}

/**
 * ＋ เมนูใหม่ ตอนยืนบาร์
 * 🎯 **ช่องสูตรกางรออยู่แล้ว ไม่ซ่อนหลังปุ่มอีกชั้น** — คนชงรู้สูตรดีที่สุด ณ วินาทีนั้น
 *    ซ่อนเมื่อไหร่ ทุกเมนูจะกลายเป็นโหมด "ยังไม่ตั้งต้นทุน" ทั้งที่ตั้งใจจะใส่สูตร
 */
function NewMenuModal({
  boot, customerId, busy, onClose, onSave,
}: {
  boot: BarBoot;
  customerId: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: Parameters<typeof saveMenuAction>[0]) => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState<number | "">("");
  const [glass, setGlass] = useState("");
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<RecipeDraftRow[]>([blankRecipeRow(), blankRecipeRow(), blankRecipeRow()]);
  const setRow = (i: number, patch: Partial<RecipeDraftRow>) =>
    setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const recipe = cleanRecipe(rows);
  const dangling = danglingRows(rows);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-xl bg-card p-5">
        <h3 className="mb-3 text-lg font-bold text-ink">เมนูใหม่</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อเมนู" />
          <NumBox value={price} onChange={setPrice} blankZero placeholder="ราคา" />
        </div>

        <div className="mt-3 text-sm font-medium text-muted">สูตร (ตัดสต็อกตามนี้)</div>
        {rows.map((r, i) => (
          // 🐛 D96 (B-8) — เดิมยัด select + ช่องตัวเลข + ปุ่มลัด 4 ปุ่ม ไว้บรรทัดเดียว
          //    บนจอแคบ select ถูกบีบจนอ่านชื่อวัตถุดิบไม่ออก → แยกบรรทัดบนมือถือ
          <div key={i} className="mt-1 flex flex-wrap items-center gap-2">
            <div className="min-w-40 flex-1">
              <Select value={r.itemId} onChange={(e) => setRow(i, { itemId: e.target.value })}>
                <option value="">— เลือกวัตถุดิบ —</option>
                {boot.items
                  .filter((it) => it.active !== false)
                  .map((it) => (
                    <option key={it.itemId} value={it.itemId}>
                      {it.name} ({it.unit})
                    </option>
                  ))}
              </Select>
            </div>
            <div className="w-24">
              <NumBox value={r.qty} onChange={(v) => setRow(i, { qty: v })} blankZero />
            </div>
            <div className="flex gap-1">
              {[15, 30, 45, 60].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setRow(i, { qty: v })}
                  className="rounded bg-raised px-2 py-1 text-xs text-muted"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setRows((p) => [...p, blankRecipeRow()])}
          className="mt-1 text-xs text-muted underline"
        >
          ＋ เพิ่มบรรทัด
        </button>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <TextInput value={glass} onChange={(e) => setGlass(e.target.value)} placeholder="แก้วที่ใช้ เช่น coupe" list="bar-glass" />
          <datalist id="bar-glass">
            {[...new Set(boot.menus.map((m) => m.glass).filter(Boolean))].map((g) => (
              <option key={String(g)} value={String(g)} />
            ))}
          </datalist>
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="โน้ต เช่น ของพี่โอ๊ต ลดเวอร์มุท" />
        </div>
        <TextInput
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          placeholder="วิธีชง เช่น shake 12 วิ · double strain"
          className="mt-2 w-full"
        />

        {recipe.length === 0 && (
          <p className="mt-2 text-xs text-warn">
            ยังไม่ใส่สูตร — บันทึกได้ แต่เมนูนี้จะ <b>ไม่ตัดสต็อกและต้นทุนเป็น 0</b>
          </p>
        )}
        {dangling > 0 && (
          <p className="mt-1 text-xs text-warn">
            มี <b>{dangling} บรรทัด</b> ที่กรอกไม่ครบ — บรรทัดพวกนี้จะ <b>ไม่ถูกบันทึก</b>
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() =>
              onSave({
                name,
                price: price === "" ? 0 : price,
                glass,
                method,
                note,
                createdFor: customerId,
                recipe,
              })
            }
            className="flex-1 rounded-lg bg-brand px-3 py-2 text-sm text-on-brand disabled:opacity-50"
          >
            บันทึกแล้วใส่ลงถาด
          </button>
          <button type="button" onClick={onClose} className="rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink">
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
}
