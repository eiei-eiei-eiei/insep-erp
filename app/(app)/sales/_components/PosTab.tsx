"use client";

import { useMemo, useState } from "react";
import type { SalesBoot, CustomerRow, MenuRow, OrderItem } from "./types";
import { Card, Combobox, MissingHint, Msg, Select, fmt, useSaver } from "./ui";
import { AddCustomerModal } from "./CustomerFields";
import { posTotals, stockShortages, mergeCart } from "@/lib/sales/pos";
import { posSaleAction, savePosWalkinContactAction, getSalesBootstrapAction } from "../actions";
import { printSalesDocs, openPrintWindow } from "./print";
import { IconCart, IconPlus } from "@/lib/shared/icons";
import { can, toRole } from "@/lib/shared/roles";

const METHODS = ["เงินสด", "โอนเงิน", "บัตรเครดิต"];

/**
 * ขายหน้าร้าน (POS · D86) — กดครั้งเดียวได้ครบ: ออกใบกำกับ/ใบเสร็จ · ลงบัญชี · ตัดสต็อก
 *
 * ★ ภายในยังเป็นโฟลว์ B2B ตัวเดิมเป๊ะ (ใบเสนอราคา → รับเต็ม & ส่งคลัง → ยืนยันจัดส่ง)
 *   แค่รวบให้เป็นปุ่มเดียว — ออเดอร์ที่ได้จึงแก้/ยกเลิก/พิมพ์ซ้ำได้จากแท็บจัดการออเดอร์เหมือนกันหมด
 */
export function PosTab({ boot, canWrite }: { boot: SalesBoot; canWrite: boolean }) {
  const canConfig = can(toRole(boot.role), "sales.config");
  const [menu, setMenu] = useState<MenuRow[]>(boot.menu);
  const [customers, setCustomers] = useState<CustomerRow[]>(boot.customers);
  const [walkinId, setWalkinId] = useState(boot.posWalkinId);

  const [custId, setCustId] = useState(boot.posWalkinId);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [method, setMethod] = useState(METHODS[0]);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [pickCustomer, setPickCustomer] = useState(false);
  const { msg, setMsg } = useSaver();
  const [busy, setBusy] = useState(false);

  const isVat = boot.isVat;
  const customer = customers.find((c) => c.id === custId) ?? null;
  /** ยังไม่เคยตั้งลูกค้าทั่วไป = กำลังตั้งค่าครั้งแรก (คนละเจตนากับ "เปลี่ยนลูกค้าเฉพาะบิลนี้") */
  const setupMode = !walkinId;

  // 🚨 ตัดสต็อกได้เฉพาะเมนูที่ผูก product_id — เมนูที่ไม่ผูกจะถูก fn_confirm_fulfillment
  //    ข้ามไปเงียบ ๆ (ขายแล้วสต็อกไม่ขยับโดยไม่มีอะไรฟ้อง) → ไม่เอามาโชว์ในหน้านี้
  //    แต่ต้องบอกว่าซ่อนไปกี่ตัวและซ่อนทำไม (D83 — ของที่หายไปต้องมีคำอธิบาย)
  const sellable = useMemo(() => menu.filter((m) => m.itemCode !== ""), [menu]);
  const hiddenCount = menu.length - sellable.length;
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? sellable.filter((m) => m.name.toLowerCase().includes(q)) : sellable;
  }, [sellable, search]);

  const totals = posTotals(items, discount, isVat);
  const shortages = stockShortages(items, menu);

  function addToCart(m: MenuRow) {
    setMsg(null);
    setItems((prev) => mergeCart([...prev, { name: m.name, price: m.price, qty: 1 }]));
  }
  function setQty(i: number, qty: number) {
    setItems((prev) => prev.map((x, j) => (j === i ? { ...x, qty } : x)));
  }
  function clearBill() {
    setItems([]);
    setDiscount(0);
    setCustId(walkinId);
  }

  const checks = [
    { label: "ลูกค้า", ok: !!customer },
    { label: "รายการสินค้า", ok: items.length > 0 },
  ];
  const ready = checks.every((c) => c.ok) && !busy;

  async function sell() {
    if (!customer || items.length === 0 || busy) return;
    setMsg(null);
    setBusy(true);
    const snap = [...items];
    const t = totals;
    const w = openPrintWindow(); // เปิดก่อน await กัน popup blocker (มือถือ/iPad)
    try {
      const r = await posSaleAction({
        customer: { id: customer.id, name: customer.name },
        items: snap,
        discount,
        method,
      });
      if (!r.ok) {
        w?.close();
        setMsg({ ok: false, text: r.error ?? "ขายไม่สำเร็จ" });
        return;
      }
      const d = r.data as {
        quNo: string;
        orderNo: string;
        invNo: string;
        taxNo1: string;
        rcptNo1: string;
        docDate: string;
        warning: string;
      };
      printSalesDocs(
        boot.company,
        {
          quNo: d.quNo,
          invNo: d.invNo,
          taxNo1: d.taxNo1,
          taxNo2: "",
          // D89 — กิจการไม่จด VAT ได้เลขใบเสร็จช่องนี้แทนเลขใบกำกับ
          rcptNo1: d.rcptNo1,
          rcptNo2: "",
          subTotal: t.subTotal,
          discount: t.discountEx, // เอกสารคิด subDiscount = subTotal − discount (รูปก่อน VAT)
          vatAmount: t.vatAmount,
          grandTotal: t.grandTotal,
          netPayable: t.netPayable,
          whtPercent: 0,
          whtAmount: 0,
          deposit: 0,
          outstandingBalance: 0,
          docDate1: d.docDate,
          docDate2: "",
          checkDetail1: "",
          checkDetail2: "",
          paymentMethod: method,
          customerName: customer.name,
          customerAddress: customer.address,
          customerTaxId: customer.taxId,
          customerBranch: customer.branch,
        },
        snap,
        ["tax-invoice-receipt-do"],
        w,
      );
      // 🚨 ตัดสต็อกไม่สำเร็จ = สำเร็จบางส่วน ห้ามขึ้นเขียว (บทเรียน D79)
      setMsg(
        d.warning
          ? { ok: true, warn: true, text: d.warning }
          : { ok: true, text: `ขายสำเร็จ — ${d.orderNo} · ฿${fmt(t.grandTotal)}` },
      );
      clearBill();
      // ดึงสต็อกใหม่ ไม่งั้นบิลถัดไปเตือนจากตัวเลขเก่า
      const fresh = await getSalesBootstrapAction();
      setMenu(fresh.menu);
    } finally {
      setBusy(false);
    }
  }

  function saveWalkin(id: string) {
    savePosWalkinContactAction(id).then((r) => {
      if (!r.ok) {
        setMsg({ ok: false, text: r.error ?? "บันทึกไม่สำเร็จ" });
        return;
      }
      setWalkinId(id);
      setCustId(id);
      setMsg({ ok: true, text: "ตั้งลูกค้าทั่วไปแล้ว" });
    });
  }

  if (!canWrite) {
    return <div className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">ไม่มีสิทธิ์ขายหน้าร้าน</div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      {/* ── ซ้าย: เลือกสินค้า ─────────────────────────────────────────────── */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-ink">สินค้า{isVat ? " (ราคารวม VAT)" : ""}</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาสินค้า…"
            className="w-44 rounded-lg border border-line bg-card p-2 text-sm outline-none focus:border-brand"
          />
        </div>

        {hiddenCount > 0 && (
          <p className="mb-3 rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn">
            ซ่อนเมนูไว้ {hiddenCount} รายการ เพราะยังไม่ได้ผูกรหัสสินค้า — ขายผ่านหน้านี้แล้ว
            <b> สต็อกจะไม่ถูกตัด</b> · ไปผูกได้ที่แท็บ &ldquo;จัดการข้อมูล&rdquo;
          </p>
        )}

        {shown.length === 0 ? (
          <div className="py-10 text-center text-sm text-faint">
            {sellable.length === 0
              ? "ยังไม่มีสินค้าที่ผูกรหัสไว้ — ไปเพิ่มที่แท็บ “จัดการข้อมูล”"
              : "ไม่พบสินค้าที่ค้นหา"}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {shown.map((m) => (
              <button
                key={m.name}
                onClick={() => addToCart(m)}
                className="flex h-24 flex-col justify-between rounded-lg border border-line bg-card p-3 text-left transition hover:border-brand hover:shadow"
              >
                <div className="line-clamp-2 text-xs font-medium text-ink">{m.name}</div>
                <div className="flex items-end justify-between">
                  <span className="text-sm font-bold text-warn">฿{fmt(m.price)}</span>
                  {m.stockQty !== null && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${m.stockQty <= 0 ? "bg-crit-bg text-crit" : m.stockQty <= 5 ? "bg-warn-bg text-warn" : "bg-ok-bg text-ok"}`}
                    >
                      {m.stockQty <= 0 ? "หมด" : m.stockQty}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* ── ขวา: บิลปัจจุบัน ──────────────────────────────────────────────── */}
      <Card className="h-fit">
        <div className="mb-2 flex items-center gap-2">
          <IconCart size={18} className="text-brand" />
          <h2 className="font-semibold text-ink">บิลหน้าร้าน</h2>
        </div>
        <Msg msg={msg} />

        {/* ลูกค้า */}
        {!walkinId && !pickCustomer ? (
          <div className="mb-3 rounded-lg border border-warn-line bg-warn-bg p-3 text-xs text-warn">
            <b>ยังไม่ได้ตั้ง &ldquo;ลูกค้าทั่วไป&rdquo;</b> — บิลหน้าร้านต้องมีลูกค้าเสมอ เพราะชื่อ/ที่อยู่/เลขภาษี
            บนใบกำกับอ่านจากทะเบียนคู่ค้า
            <button
              onClick={() => setPickCustomer(true)}
              className="mt-2 block w-full rounded-lg bg-brand py-1.5 font-bold text-on-brand hover:opacity-90"
            >
              เลือก/สร้างลูกค้าทั่วไป
            </button>
            {!canConfig && <p className="mt-2">ตั้งค่านี้ต้องใช้สิทธิ์หัวหน้าฝ่ายขาย</p>}
          </div>
        ) : (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-lg bg-raised px-3 py-2 text-sm">
            <span className="truncate text-ink">{customer ? customer.name : "— ยังไม่ได้เลือกลูกค้า —"}</span>
            <button
              onClick={() => setPickCustomer((v) => !v)}
              className="shrink-0 text-xs font-medium text-brand hover:underline"
            >
              {pickCustomer ? "ปิด" : "เปลี่ยน"}
            </button>
          </div>
        )}

        {pickCustomer && (
          <div className="mb-3 space-y-2 rounded-lg border border-line p-3">
            <p className="text-xs text-faint">
              {setupMode
                ? "เลือกคู่ค้าที่จะใช้เป็น “ลูกค้าทั่วไป” ของทุกบิลหน้าร้าน — ยังไม่มีในทะเบียนให้กดเพิ่มลูกค้าใหม่ (ระบบจะตั้งให้เลย)"
                : "ลูกค้าขอใบกำกับภาษีเต็มรูป → เลือกหรือเพิ่มลูกค้ารายนั้น (ที่อยู่/เลขภาษีบนเอกสารมาจากตรงนี้)"}
            </p>
            <Combobox
              value={custId}
              onChange={setCustId}
              options={customers.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="ค้นหาลูกค้า…"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowAdd(true)}
                className="flex-1 rounded-lg border border-line py-1.5 text-xs font-medium text-ink hover:border-brand"
              >
                <IconPlus size={14} className="mr-1 inline align-[-2px]" />
                เพิ่มลูกค้าใหม่
              </button>
              {/* 🚨 ปุ่มนี้ต้อง **โผล่เสมอ** แล้วค่อย disable — ของเดิมซ่อนจนกว่าจะเลือกลูกค้า
                  = หายไปพอดีตอนที่ผู้ใช้กำลังหามันอยู่ (ตระกูล D83: ปุ่มที่ไม่มีต้องมีคำอธิบาย) */}
              {canConfig && (
                <button
                  onClick={() => saveWalkin(custId)}
                  disabled={!custId || custId === walkinId}
                  title={custId === walkinId ? "รายนี้เป็นลูกค้าทั่วไปอยู่แล้ว" : undefined}
                  className={`flex-1 rounded-lg py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                    setupMode
                      ? "bg-brand font-bold text-on-brand hover:opacity-90"
                      : "border border-line text-ink hover:border-brand"
                  }`}
                >
                  {setupMode ? "ใช้รายนี้เป็นลูกค้าทั่วไป" : "ตั้งเป็นลูกค้าทั่วไป"}
                </button>
              )}
            </div>
            {canConfig && <MissingHint checks={[{ label: "ลูกค้าที่จะตั้งเป็นลูกค้าทั่วไป", ok: !!custId }]} prefix="ยังไม่ได้เลือก" />}
          </div>
        )}

        {/* รายการ */}
        <div className="mb-3 max-h-64 overflow-y-auto">
          {items.length === 0 ? (
            <div className="py-6 text-center text-sm text-faint">แตะสินค้าทางซ้ายเพื่อเริ่มบิล</div>
          ) : (
            items.map((it, i) => (
              <div key={it.name} className="flex items-center gap-2 border-b border-line py-2 text-sm">
                <div className="flex-1">
                  <div className="font-medium text-ink">{it.name}</div>
                  <div className="text-xs text-faint">฿{fmt(it.price)} / หน่วย</div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setQty(i, Math.max(1, it.qty - 1))}
                    className="h-7 w-7 rounded border border-line text-ink hover:border-brand"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    value={it.qty}
                    onChange={(e) => setQty(i, Number(e.target.value) || 0)}
                    className="w-12 rounded border border-line bg-raised p-1 text-center text-sm font-bold outline-none"
                  />
                  <button
                    onClick={() => setQty(i, it.qty + 1)}
                    className="h-7 w-7 rounded border border-line text-ink hover:border-brand"
                  >
                    +
                  </button>
                </div>
                <div className="w-20 text-right text-sm font-semibold text-ink">฿{fmt(it.price * it.qty)}</div>
                <button onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))} className="text-crit">
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        {/* 🟡 เตือนอย่างเดียว ไม่บล็อก — ของจริงอาจมีในโรงแต่ยังไม่ได้คีย์ (มติ D86) */}
        {shortages.length > 0 && (
          <div className="mb-3 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-xs text-warn">
            <b>สต็อกไม่พอ</b> — ขายได้ แต่ยอดคงเหลือจะติดลบ
            {shortages.map((s) => (
              <div key={s.name}>
                • {s.name}: สั่ง {s.want} มี {s.have}
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2 text-sm">
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-muted">
              ส่วนลดท้ายบิล (บาท{isVat ? " รวม VAT" : ""})
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={discount || ""}
              onChange={(e) => setDiscount(Number(e.target.value) || 0)}
              className="w-full rounded-lg border border-line p-2 text-sm outline-none focus:border-brand"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-muted">ช่องทางชำระ</span>
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </label>

          {/* ★ เรียงลำดับเดียวกับบนกระดาษ — ผู้ใช้จะได้กระทบยอดกับใบเสร็จได้ทีละบรรทัด */}
          <div className="space-y-1 border-t border-line pt-2">
            {discount > 0 && <Row label="รวมสินค้า" value={totals.grandIncl} />}
            {discount > 0 && <Row label="ส่วนลด" value={discount} negative />}
            {isVat && (
              <>
                <Row label="มูลค่าก่อน VAT" value={totals.subDiscount} />
                <Row label="ภาษีมูลค่าเพิ่ม 7%" value={totals.vatAmount} />
              </>
            )}
            <div className="flex justify-between border-t border-line pt-1 text-base font-bold text-brand">
              <span>รวมรับเงิน</span>
              <span>฿{fmt(totals.grandTotal)}</span>
            </div>
          </div>

          <button
            onClick={sell}
            disabled={!ready}
            className="w-full rounded-lg bg-brand py-3 text-base font-bold text-on-brand transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "กำลังบันทึก…" : `ขาย & พิมพ์ ฿${fmt(totals.grandTotal)}`}
          </button>
          <MissingHint checks={checks} />
          <p className="text-center text-[11px] text-faint">
            ลงบัญชีรายรับ · ตัดสต็อก · ออก{isVat ? "ใบกำกับภาษี/ใบเสร็จ" : "ใบเสร็จรับเงิน"}/ใบส่งของ ให้อัตโนมัติ
            <br />
            ขายย้อนวันไม่ได้ — ต้องย้อนวันให้ใช้แท็บ &ldquo;＋ สร้างใบเสนอราคา&rdquo;
          </p>
        </div>
      </Card>

      {showAdd && (
        <AddCustomerModal
          onClose={() => setShowAdd(false)}
          onAdded={(c) => {
            setCustomers((prev) => [...prev, c]);
            setCustId(c.id);
            setShowAdd(false);
            // ยังไม่เคยตั้งลูกค้าทั่วไป + เพิ่งสร้างคู่ค้าจากการ์ดตั้งค่า = เจตนาชัดว่าจะใช้รายนี้
            // → ตั้งให้เลย ไม่ต้องให้ไปกดปุ่มอีกทีที่เพิ่งโผล่ขึ้นมา
            if (setupMode && canConfig) saveWalkin(c.id);
          }}
        />
      )}
    </div>
  );
}

function Row({ label, value, negative }: { label: string; value: number; negative?: boolean }) {
  return (
    <div className="flex justify-between text-sm text-muted">
      <span>{label}</span>
      <span>
        {negative ? "−" : ""}฿{fmt(value)}
      </span>
    </div>
  );
}
