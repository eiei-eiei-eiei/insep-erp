"use client";

import { useState } from "react";
import type { BarBoot } from "../data";
import { promptPayError, promptPayPayload } from "@/lib/bar/promptpay";
import { hasSaleWindow } from "@/lib/bar/businessDate";
import { Card, Field, TextInput, Select, Msg, useSaver, MissingHint, SuggestInput } from "@/lib/shared/ui";
import { saveBarSettingsAction } from "../actions";
import { ReceiptLayoutCard } from "./ReceiptLayoutCard";
import type { ReceiptLayout } from "@/lib/bar/layout";

/** ชวนเลือก — ★ พิมพ์เองได้เสมอ ผังบัญชีของแต่ละเจ้าไม่เหมือนกัน (บทเรียน D80-B2) */
const INCOME_CATS = ["รายได้บาร์", "รายได้จากการขาย", "ขายสินค้า"];

const PP_TYPES: { value: string; label: string }[] = [
  { value: "mobile", label: "เบอร์มือถือ" },
  { value: "natid", label: "เลขบัตรประชาชน / เลขผู้เสียภาษี" },
  { value: "ewallet", label: "e-Wallet" },
];

/**
 * ตั้งค่าบาร์ (D96)
 *
 * 🚨 **หน้านี้ต้องมาพร้อมหน้าขายตั้งแต่เฟสแรก** — ไม่มีที่ตั้งเลขพร้อมเพย์
 *    = ปุ่ม QR ปิดตายตลอดกาล และเทสกับแอปธนาคารจริงไม่ได้เลย
 */
export function BarSettingsTab({ boot, onReload }: { boot: BarBoot; onReload: () => Promise<void> }) {
  const data = boot;
  const { msg, setMsg } = useSaver();
  const [busy, setBusy] = useState(false);

  const s = data.settings;
  const [entityId, setEntityId] = useState(s.entityId);
  const [ppType, setPpType] = useState(s.promptPayType as string);
  const [ppId, setPpId] = useState(s.promptPayId);
  const [channels, setChannels] = useState(s.channels.join("\n"));
  const [dayStart, setDayStart] = useState(s.window.start);
  const [dayEnd, setDayEnd] = useState(s.window.end);
  const [roundCash, setRoundCash] = useState(s.roundCash);
  const [blockNegative, setBlockNegative] = useState(s.blockNegative);
  const [footer, setFooter] = useState(s.footer);
  const [revenueAccount, setRevenueAccount] = useState(s.revenueAccount);
  const [incomeCat, setIncomeCat] = useState(s.incomeCat);
  const [layout, setLayout] = useState<ReceiptLayout>(data.layout);
  const [preview, setPreview] = useState<string | null>(null);

  const target = { type: ppType as "mobile" | "natid" | "ewallet", id: ppId };
  const ppErr = promptPayError(target);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await saveBarSettingsAction({
        entityId,
        promptPayType: ppType,
        promptPayId: ppId,
        channels: channels.split("\n"),
        dayStart,
        dayEnd,
        roundCash,
        blockNegative,
        footer,
        revenueAccount,
        incomeCat,
        layout,
      });
      if (!r.ok) {
        setMsg({ ok: false, text: r.error ?? "บันทึกไม่สำเร็จ" });
        return;
      }
      await onReload();
      setMsg({ ok: true, text: "บันทึกแล้ว" });
    } finally {
      setBusy(false);
    }
  }

  /**
   * 🚨 ตาคนคือด่านเดียวที่ตรวจได้ว่าเลขพร้อมเพย์ถูกคน
   *    CRC ผิด = QR สแกนไม่ติด (รู้ตัวทันที) แต่ **เลขผิด = เงินเข้าบัญชีคนแปลกหน้า
   *    โดยไม่มีอะไรฟ้อง** → บังคับให้สแกนยืนยันชื่อบัญชีหนึ่งครั้งตอนตั้งค่า
   */
  async function showPreview() {
    const payload = promptPayPayload({ target, amount: 1 });
    if (!payload) return;
    const { qrSvg } = await import("@/lib/bar/print80");
    setPreview(await qrSvg(payload));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="กิจการของบาร์">
        <Msg msg={msg} />
        <Field label="รายได้บาร์เข้ากิจการไหน">
          <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            <option value="">— ยังไม่ได้ตั้ง —</option>
            {data.entityOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.id} · {e.name}
              </option>
            ))}
          </Select>
        </Field>
        <p className="mt-1 text-xs text-faint">
          🚨 ระบบ<b>ไม่เดาให้</b> — บาร์มักเป็นรายได้ของอีกกิจการหนึ่ง (คนละกิจการกับโรงกลั่น)
          ตั้งผิดแล้วยอดขายทั้งคืนไปลงบัญชีผิดกิจการ
        </p>
        {data.seller && (
          <p className="mt-2 text-xs text-muted">
            เอกสารจะออกในนาม <b>{data.seller.name}</b>
            {data.seller.isVat ? " (จด VAT)" : " (ไม่จด VAT — ออกใบเสร็จรับเงิน)"}
          </p>
        )}
      </Card>

      <Card title="พร้อมเพย์ (QR รับเงิน)">
        <Field label="ปลายทาง">
          <Select value={ppType} onChange={(e) => setPpType(e.target.value)}>
            {PP_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="เลขพร้อมเพย์">
          <TextInput value={ppId} onChange={(e) => setPpId(e.target.value)} placeholder="081-234-5678" />
        </Field>
        {ppErr ? (
          <p className="mt-1 text-xs text-warn">{ppErr}</p>
        ) : (
          <>
            <button
              type="button"
              onClick={showPreview}
              className="mt-2 rounded-lg bg-raised px-3 py-1.5 text-sm text-ink"
            >
              ทดสอบ — สร้าง QR 1 บาท
            </button>
            <p className="mt-1 text-xs text-warn">
              🚨 <b>สแกนด้วยแอปธนาคารจริงหนึ่งครั้ง แล้วอ่านชื่อบัญชีปลายทางด้วยตา</b> —
              เลขผิดจะไม่มีอะไรในระบบฟ้องเลย เงินจะเข้าบัญชีคนอื่นเงียบ ๆ
            </p>
          </>
        )}
        {preview && (
          <div className="mt-3 w-48 bg-white p-3" dangerouslySetInnerHTML={{ __html: preview }} />
        )}
      </Card>

      <Card title="รอบขาย (วันขายของบิลที่ข้ามเที่ยงคืน)">
        <div className="grid grid-cols-2 gap-2">
          <Field label="เริ่มรอบ">
            <TextInput value={dayStart} onChange={(e) => setDayStart(e.target.value)} placeholder="18:00" />
          </Field>
          <Field label="ปิดรอบ">
            <TextInput value={dayEnd} onChange={(e) => setDayEnd(e.target.value)} placeholder="03:00" />
          </Field>
        </div>
        <p className="mt-1 text-xs text-faint">
          {hasSaleWindow({ start: dayStart, end: dayEnd })
            ? "บิลที่ปิดในรอบจะนับเป็นวันที่รอบเริ่ม · บิลนอกรอบ (เช่น ออกบูธกลางวัน) ใช้วันตามปฏิทินและขายได้ตามปกติ"
            : "เวลาเริ่มเท่ากับเวลาปิด = ไม่ได้ตั้งรอบ → ใช้วันตามปฏิทินเสมอ"}
        </p>
      </Card>

      <Card title="อื่น ๆ">
        <Field label="ป้ายช่องทาง/งาน (บรรทัดละ 1 ชื่อ)">
          <textarea
            value={channels}
            onChange={(e) => setChannels(e.target.value)}
            rows={4}
            placeholder={"บูธ Craft Fest\nงานวันเกิดพี่โอ๊ต"}
            className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink"
          />
        </Field>
        <p className="mt-1 text-xs text-faint">ใช้ดูรายงานว่างานไหนคุ้ม — 🚫 ไม่พิมพ์ลงบิลของลูกค้า</p>

        <label className="mt-3 flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={roundCash} onChange={(e) => setRoundCash(e.target.checked)} />
          ปัดเศษยอดสุทธิเป็นจำนวนเต็มบาท
        </label>
        <label className="mt-1 flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={blockNegative} onChange={(e) => setBlockNegative(e.target.checked)} />
          บล็อกการขายเมื่อของไม่พอ (ปริยาย: เตือนอย่างเดียว)
        </label>

        <Field label="ข้อความท้ายสลิป">
          <TextInput value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="ขอบคุณครับ" />
        </Field>
      </Card>

      {/**
        * 🐛 **B-3 — บั๊กที่ทำให้ปุ่มลงบัญชีรายวันกดยังไงก็ไม่ผ่าน (D96)**
        *    `postDayAction` อ่าน `bar_revenue_account` ก่อน ไม่มีก็ตอบว่า
        *    *"ไปตั้งที่แท็บ ตั้งค่าบาร์ ก่อน"* — **แต่แท็บนี้ไม่เคยมีช่องนั้นเลย**
        *    server action รับค่าได้ · `data.ts` อ่านได้ · CHECK whitelist อนุญาตแล้ว
        *    ขาดแค่ช่องกรอกบนจอ ⇒ ยอดขายบาร์เข้าบัญชีไม่ได้เลยตั้งแต่วันแรก
        *    (ตระกูล D93-B1 `sales_revenue_entity` เป๊ะ · D74/D77)
        *
        * 🚨 การ์ดนี้หายไปทั้งใบเมื่อไม่ได้ซื้อโมดูลบัญชี — **บาร์ต้องขายแยกได้** (แผนข้อ 8)
        */}
      {data.hasAccounting && (
        <Card title="ลงบัญชียอดขายบาร์">
          <Field label="บัญชีที่รายได้บาร์เข้า">
            <Select value={revenueAccount} onChange={(e) => setRevenueAccount(e.target.value)}>
              <option value="">— ยังไม่ได้ตั้ง —</option>
              {data.bankAccounts.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          {data.bankAccounts.length === 0 && (
            <p className="mt-1 text-xs text-warn">
              ยังไม่มีบัญชีเงินในระบบ — ไปเพิ่มที่ <b>บัญชี → บัญชี &amp; เงินสด</b> ก่อน
            </p>
          )}
          {/**
            * 🚨 **รูซ้อนที่ต้องอุดพร้อมกัน** — ต่อให้ลงบัญชีสำเร็จ ถ้าบัญชีนี้ไม่ได้ถูกนับเข้า
            *    ระบบภาษี ยอดบาร์จะ **หายจาก ภพ.30 ทั้งเดือนโดยไม่มีอะไรฟ้อง**
            *    (`passesTaxGuard()` กรองด้วย `taxAccounts.has(account_name)` — กติกา D93)
            * 🚨 ทุกครั้งที่ระบบไม่ทำอะไรให้ ต้องบอกว่าทำไม (D92)
            */}
          {revenueAccount &&
            data.bankAccounts.some((b) => b.name === revenueAccount && !b.countedInTax) && (
              <p className="mt-1 text-xs text-warn">
                ⚠️ บัญชี <b>{revenueAccount}</b> ยังไม่ได้ถูกติ๊กว่า <b>นับเข้าระบบภาษี</b> —
                ลงบัญชีจะสำเร็จ แต่ยอดบาร์จะ <b>ไม่ขึ้นใน ภพ.30</b>
                <br />
                ไปติ๊กที่ <b>บัญชี → ตั้งค่า → บัญชีที่นับเข้าระบบภาษี</b>
              </p>
            )}

          <Field label="หมวดรายรับ">
            <SuggestInput
              value={incomeCat}
              onChange={setIncomeCat}
              options={INCOME_CATS}
              placeholder="รายได้บาร์"
              listId="bar-income-cat"
            />
          </Field>
          <p className="mt-1 text-xs text-faint">
            ไม่กรอก = ใช้ <b>รายได้บาร์</b> · บิลบัญชีจะถูกสร้าง <b>1 ใบต่อ 1 วิธีรับเงินต่อวัน</b>
            (เงินสด/โอน/QR แยกใบ)
          </p>
        </Card>
      )}

      <ReceiptLayoutCard boot={data} value={layout} onChange={setLayout} />

      <div className="lg:col-span-2">
        <button
          type="button"
          disabled={busy || !data.canConfig}
          onClick={save}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand disabled:opacity-50"
        >
          บันทึกการตั้งค่า
        </button>
        <MissingHint checks={[{ ok: data.canConfig, label: "สิทธิ์ตั้งค่าบาร์" }]} />
      </div>
    </div>
  );
}
