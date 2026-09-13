"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BarBoot } from "../data";
import {
  BLOCK_LABEL,
  TEXT_BLOCKS,
  TOKENS,
  filledButOff,
  moveBlock,
  resolveLayout,
  type BlockKey,
  type PaperWidth,
  type ReceiptLayout,
  type TextBlock,
} from "@/lib/bar/layout";
import { buildReceipt } from "@/lib/bar/receipt";
import { barTotals } from "@/lib/bar/totals";
import { Card, Field, TextInput, Select } from "@/lib/shared/ui";

/** ตัวอย่างที่ใช้พรีวิว — ★ ตั้งใจให้มีครบทุกอย่างที่บล็อกต่าง ๆ ต้องใช้ */
const SAMPLE_LINES = [
  { menuId: "x1", menuName: "Negroni", qty: 2, price: 260, lineDiscount: 52, lineDiscountPct: 10 },
  { menuId: "x2", menuName: "ถั่วทอด", qty: 1, price: 80, isComp: true },
];

type PreviewKind = "unpaid" | "paid" | "receipt";

const PREVIEW_LABEL: Record<PreviewKind, string> = {
  unpaid: "ใบแจ้งรายการ (มี QR)",
  paid: "หลังจ่ายแล้ว",
  receipt: "ใบเสร็จ / ใบกำกับอย่างย่อ",
};

/**
 * รูปแบบบิล (D96 เฟส G)
 *
 * ── 🚨 พรีวิวต้องเรนเดอร์ด้วย `receiptHtml()` ตัวเดียวกับที่พิมพ์จริง ───────────
 * ห้ามวาดจำลอง — **พรีวิวที่ไม่ตรงกระดาษแย่กว่าไม่มีพรีวิว** เพราะผู้ใช้จะเชื่อมัน
 * แล้วไปรู้ตอนพิมพ์ออกมาเป็นม้วน
 *
 * ── 🚨 บรรทัดที่กฎหมายบังคับ = สวิตช์เทาพร้อมเหตุผล ไม่ใช่ซ่อนสวิตช์ ─────────
 * ซ่อนไปเลยแล้วผู้ใช้จะหาไม่เจอและไม่รู้ว่าทำไม (D86: ปุ่มเทาดีกว่าซ่อนปุ่ม)
 */
export function ReceiptLayoutCard({
  boot,
  value,
  onChange,
}: {
  boot: BarBoot;
  value: ReceiptLayout;
  onChange: (v: ReceiptLayout) => void;
}) {
  const [kind, setKind] = useState<PreviewKind>("receipt");
  const [html, setHtml] = useState("");
  const [css, setCss] = useState("");

  const isVat = Boolean(boot.seller?.isVat);
  const L = useMemo(() => resolveLayout(value, { isVat }), [value, isVat]);
  const offButFilled = filledButOff(value, L);

  const set = (patch: Partial<ReceiptLayout>) => onChange({ ...value, ...patch });
  const toggle = (k: BlockKey) => {
    const off = new Set(L.order.filter((x) => !L.on(x)));
    if (off.has(k)) off.delete(k);
    else off.add(k);
    set({ off: [...off] });
  };
  /**
   * แทรกตัวแปรต่อท้ายข้อความ แล้ว **คืนเคอร์เซอร์ไปท้ายช่อง**
   *
   * 🐛 เจอบนจอตอนเทสเฟส G: ไม่คืนโฟกัสเอง แต่เบราว์เซอร์คืนให้หลัง re-render
   *    โดยเคอร์เซอร์ไปอยู่ **ตำแหน่ง 0** ⇒ พิมพ์ต่อแล้วตัวอักษรไปแทรกหัวช่อง
   *    ("ขอบคุณ" + แทรก {ชื่อร้าน} + " แล้วพบกันใหม่" ได้ " แล้วพบกันใหม่ขอบคุณ{ชื่อร้าน}")
   * 🚨 ข้อความนี้ถูกพิมพ์ลงบิลจริงทุกใบ — เพี้ยนแล้วเสียทั้งม้วนกว่าจะมีคนสังเกต
   */
  const boxes = useRef<Partial<Record<TextBlock, HTMLDivElement | null>>>({});
  const insertToken = (field: TextBlock, t: string) => {
    const next = `${value[field] ?? ""}{${t}}`;
    set({ [field]: next } as Partial<ReceiptLayout>);
    requestAnimationFrame(() => {
      const el = boxes.current[field]?.querySelector("input");
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.length, next.length);
    });
  };

  // ── พรีวิว — เรนเดอร์ใหม่ทุกครั้งที่ผังเปลี่ยน
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { receiptHtml, receiptCss, qrSvg } = await import("@/lib/bar/print80");
      const totals = barTotals(SAMPLE_LINES, { discount: 20 });
      const doc = buildReceipt({
        status: kind === "unpaid" ? "เปิดอยู่" : "ปกติ",
        saleNo: "B260913-001",
        rcptNo: kind === "receipt" ? "BR260913-001" : null,
        wantReceipt: kind === "receipt",
        lines: SAMPLE_LINES,
        totals,
        seller: boot.seller ?? { name: "ชื่อร้านของคุณ" },
        buyer: { name: "คุณลูกค้า (ตัวอย่าง)", taxId: "0105558123456" },
        method: kind === "unpaid" ? null : "เงินสด",
        closedAt: kind === "unpaid" ? null : "13/09/2569 23:50",
        printedAt: "13/09/2569 23:51",
        // 🚨 QR ยังตัดสินที่ `receipt.ts` จุดเดียว — พรีวิวส่ง payload ปลอมมาก็ถูกทิ้ง
        //    ถ้าเอกสารนั้นไม่ควรมี QR (ใบที่จ่ายแล้ว)
        qrPayload: "00020101021129370016A000000677010111011300660000000005802TH530376463047A9E",
        discountLabel: "10%",
        layout: value,
        channel: "บูธ Craft Fest",
      });
      const markup = doc.hasQr && doc.qrPayload ? await qrSvg(doc.qrPayload) : null;
      if (!alive) return;
      setHtml(receiptHtml(doc, markup));
      setCss(receiptCss(L.paper, L.fontLarge));
    })();
    return () => {
      alive = false;
    };
  }, [value, kind, boot.seller, L.paper, L.fontLarge]);

  return (
    <Card title="รูปแบบบิล" className="lg:col-span-2">
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* ───────── ซ้าย: ตัวตั้งค่า ───────── */}
        <div>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <Field label="ขนาดกระดาษ">
              <Select
                value={String(L.paper)}
                onChange={(e) => set({ paper: Number(e.target.value) as PaperWidth })}
              >
                <option value="80">80 มม. (มาตรฐาน)</option>
                <option value="58">58 มม. (เครื่องพกพา)</option>
              </Select>
            </Field>
            <label className="flex items-center gap-2 pb-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={L.fontLarge}
                onChange={(e) => set({ fontLarge: e.target.checked })}
              />
              ตัวหนังสือใหญ่
            </label>
          </div>

          <div className="mb-1 text-sm font-medium text-muted">
            บล็อกบนกระดาษ — ▲▼ เรียงลำดับ · ติ๊กเพื่อเปิด/ปิด
          </div>
          <div className="rounded-lg border border-line">
            {L.order.map((k, i) => {
              const locked = L.locked(k);
              return (
                <div
                  key={k}
                  className="flex items-center gap-2 border-b border-line-soft px-2 py-1 text-sm last:border-0"
                >
                  <input
                    type="checkbox"
                    checked={L.on(k)}
                    disabled={locked}
                    onChange={() => toggle(k)}
                  />
                  <span className={`flex-1 ${L.on(k) ? "text-ink" : "text-faint"}`}>
                    {BLOCK_LABEL[k]}
{/*
                      * 🚨 ปิดไม่ได้ต้องบอกว่าทำไม — เทาเฉย ๆ = ผู้ใช้นึกว่าระบบพัง (D83)
                      * 🚨 **ห้ามแต่งประโยคที่นี่** ต้องถาม `L.lockReason()` เสมอ
                      *    เหตุผลขึ้นกับว่า *ชุดไหน* เป็นคนล็อก ไม่ใช่ว่ากิจการจด VAT ไหม
                      *    (เคยเขียนเป็น `isVat ? … : …` แล้วชื่อร้านขึ้นว่า "ใบกำกับภาษีต้องมี"
                      *     ทั้งที่มันถูกล็อกด้วย ALWAYS_ON — ตระกูล D91/0059)
                      */}
                    {L.lockReason(k) && (
                      <span className="ml-2 text-xs text-warn">{L.lockReason(k)}</span>
                    )}
                    {k === "logo" && !L.logoUrl && (
                      <span className="ml-2 text-xs text-faint">ยังไม่ได้ใส่ลิงก์โลโก้ (ช่องด้านล่าง)</span>
                    )}
                  </span>
                  <button
                    type="button"
                    aria-label="เลื่อนขึ้น"
                    disabled={i === 0}
                    onClick={() => set({ order: moveBlock(L.order, k, -1) })}
                    className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-raised hover:text-ink disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label="เลื่อนลง"
                    disabled={i === L.order.length - 1}
                    onClick={() => set({ order: moveBlock(L.order, k, 1) })}
                    className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-raised hover:text-ink disabled:opacity-30"
                  >
                    ▼
                  </button>
                </div>
              );
            })}
          </div>

          {/**
            * 🚨 **โลโก้ของบาร์ แยกจากโลโก้แบรนด์ในหน้าตั้งค่ากลางโดยตั้งใจ**
            *    บาร์มักขายในนาม **อีกกิจการหนึ่ง** (เช่น EID02 ของเจ้าของ)
            *    ซึ่งเป็นคนละแบรนด์กับโรงกลั่น — ใช้ร่วมกัน = บิลบาร์ขึ้นโลโก้โรงเหล้า
            *    ให้ลูกค้าเห็น ซึ่งผิดทั้งภาพลักษณ์และผิดว่าใครเป็นผู้ขายบนกระดาษใบนั้น
            */}
          <div className="mt-3">
            <Field label="ลิงก์โลโก้ของบาร์">
              <TextInput
                value={value.logoUrl ?? ""}
                onChange={(e) => set({ logoUrl: e.target.value })}
                placeholder="https://…/logo.png"
              />
            </Field>
            <p className="mt-1 text-xs text-faint">
              ★ <b>คนละตัวกับโลโก้แบรนด์</b> ใน ตั้งค่า → แบรนด์ — บาร์มักขายในนามอีกกิจการหนึ่ง
              <br />
              🚨 กระดาษความร้อนพิมพ์ <b>ขาวดำล้วน 203dpi</b> — ภาพสีเทาจะออกมาเป็นด่าง
              ใช้โลโก้ที่เป็นเส้นทึบคอนทราสต์สูง แล้ว<b>พิมพ์จริงดูหนึ่งใบ</b>ก่อนใช้งาน
            </p>
          </div>

          {TEXT_BLOCKS.map((f) => (
            <div
              key={f}
              className="mt-3"
              ref={(el) => {
                boxes.current[f] = el;
              }}
            >
              <Field label={f === "headText" ? "ข้อความหัวบิล" : "ข้อความท้ายบิล"}>
                <TextInput
                  value={value[f] ?? ""}
                  onChange={(e) => set({ [f]: e.target.value } as Partial<ReceiptLayout>)}
                  placeholder={f === "headText" ? "ยินดีต้อนรับ" : "ขอบคุณครับ แล้วพบกันใหม่"}
                />
              </Field>
              {/* 🚨 ชุดปิด · กดปุ่มแทรกอย่างเดียว — ห้ามให้พิมพ์ชื่อตัวแปรเอง
                  ไม่งั้นกลายเป็นภาษาสูตรที่ห้ามทำ (D67/D70) */}
              <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">
                แทรก:
                {TOKENS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => insertToken(f, t)}
                    className="rounded border border-line px-1.5 py-0.5 text-muted hover:text-ink"
                  >
                    {t}
                  </button>
                ))}
              </div>
              {/* 🚨 กรอกไว้แต่บล็อกปิดอยู่ = ไม่ขึ้นบนกระดาษ ต้องบอกว่าทำไม (D92) */}
              {offButFilled.includes(f) && (
                <p className="mt-1 text-xs text-warn">
                  ⚠ ยังไม่ขึ้นบนบิล — บล็อก <b>{BLOCK_LABEL[f]}</b> ปิดอยู่ ติ๊กเปิดในรายการด้านบนก่อน
                </p>
              )}
            </div>
          ))}
        </div>

        {/* ───────── ขวา: พรีวิวขนาดเท่ากระดาษจริง ───────── */}
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {(Object.keys(PREVIEW_LABEL) as PreviewKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded-lg px-2 py-1 text-xs ${
                  kind === k ? "bg-brand text-on-brand" : "bg-raised text-muted"
                }`}
              >
                {PREVIEW_LABEL[k]}
              </button>
            ))}
          </div>
          {/* ★ ใส่ใน iframe เพื่อให้ CSS ของกระดาษไม่ชนกับ CSS ของแอป
              และความกว้างเป็นมิลลิเมตรจริงเหมือนตอนพิมพ์ */}
          <iframe
            title="ตัวอย่างบิล"
            className="h-[520px] w-full rounded-lg border border-line bg-white"
            srcDoc={`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`}
          />
          <p className="mt-1 text-xs text-faint">
            ตัวอย่างนี้เรนเดอร์ด้วย<b>ตัวเดียวกับที่พิมพ์จริง</b> — ที่เห็นคือที่จะได้บนกระดาษ
            {isVat && <> · กิจการนี้จด VAT จึงมีบรรทัดที่ปิดไม่ได้</>}
          </p>
        </div>
      </div>
    </Card>
  );
}
