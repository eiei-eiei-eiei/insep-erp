"use client";

/**
 * การ์ด "ชำระภาษี" ในแท็บเอกสารสรรพากร (D88)
 *
 * ★ **ไม่มีหน้าตั้งค่าแยก** — ป๊อปอัพนี้คือที่ตั้งค่า แล้วจำค่าที่ใช้ครั้งก่อนของแบบนั้น
 *   มาเติมให้รอบถัดไป (`prefs` มาจากแถวล่าสุดใน `tax_payments`)
 *   ครั้งแรกไม่มีอะไรให้จำ → ใช้ค่าปริยายจาก `lib/accounting/taxPay`
 *
 * 🚨 ตรรกะ "กดได้/ไม่ได้ และเพราะอะไร" อยู่ใน `lib/accounting/taxPay` ทั้งหมด
 *    ที่นี่แค่วาด — server action ตรวจซ้ำด้วยฟังก์ชันตัวเดียวกันก่อนเรียก RPC
 */

import { useState } from "react";
import {
  canPay,
  canUnpay,
  DEFAULT_SURCHARGE_CAT,
  DEFAULT_TAX_CAT,
  DEFAULT_TAX_PAYEE,
  TAX_KIND_FULL,
  taxTxDescription,
  type TaxDueRow,
  type TaxKind,
} from "@/lib/accounting/taxPay";
import { formatDateThai } from "@/lib/shared/format";
import { payTaxAction, unpayTaxAction, getTaxPayBoardAction } from "../actions";
import type { AccountRow, Contact } from "./types";
import {
  Badge,
  EscToClose,
  Field,
  fmt,
  MissingHint,
  Msg,
  NumBox,
  RowBtn,
  SaveButton,
  Select,
  TextInput,
  todayISO,
  useSaver,
  useRead,
  LoadError,
} from "./ui";

type Board = Awaited<ReturnType<typeof getTaxPayBoardAction>>;
type Prefs = Board["prefs"];

export function TaxPayCard({
  period,
  entityId,
  accounts,
  expenseCats,
  contacts,
  canConfig,
  canWrite,
  reloadKey,
}: {
  period: string;
  entityId: string;
  accounts: AccountRow[];
  expenseCats: string[];
  contacts: Contact[];
  canConfig: boolean;
  canWrite: boolean;
  /** เปลี่ยนค่าเมื่อกดสร้างแบบในการ์ดข้างบน → โหลดกระดานใหม่ (สถานะ "สร้างแล้ว" เปลี่ยน) */
  reloadKey: number;
}) {
  const [open, setOpen] = useState<TaxDueRow | null>(null);
  const { pending, msg, run, setMsg } = useSaver();

  // 🚨🚨 D89 — ถ้าอ่าน tax_payments ไม่ได้แล้วปล่อยผ่าน กระดานจะบอกว่า "ยังไม่เคยจ่าย"
  //    ทั้งที่จ่ายไปแล้ว → ผู้ใช้กดจ่ายซ้ำ · ต้องขึ้นแถบแดงและอย่าให้ตัดสินใจจากจอนี้
  const { data: board, err, reload: load } = useRead<Board>(
    () => getTaxPayBoardAction(period, entityId),
    [period, entityId, reloadKey],
    { skip: !entityId },
  );

  function doUnpay(r: TaxDueRow) {
    if (!window.confirm(
      `ถอนการบันทึกจ่าย ${r.label} งวดนี้?\n\nบิล ${r.payment?.tx_id ?? ""} จะกลายเป็น "ยกเลิก" (ไม่ถูกลบ) และยอดเงินในบัญชีจะกลับไปเท่าก่อนจ่าย`,
    )) return;
    run(() => unpayTaxAction(r.kind, r.period, entityId), "ถอนการบันทึกจ่ายแล้ว — บิลถูกยกเลิก", load);
  }

  const box = "rounded-lg border border-line bg-card p-4";
  if (!entityId) return null;

  return (
    <div className={box}>
      <h3 className="mb-1 font-semibold text-ink">ชำระภาษี</h3>
      {/* 🚨 D89 — อ่านประวัติจ่ายไม่ได้ = กระดานอาจบอกว่า "ยังไม่เคยจ่าย" ทั้งที่จ่ายแล้ว */}
      <LoadError err={err} onRetry={load} what="สถานะการชำระภาษี" />
      <p className="mb-3 text-xs text-faint">
        กดจ่ายแล้วระบบบันทึกเป็น <b>รายจ่าย</b> ให้เลย (เงินออกจากบัญชีที่เลือก) — ไม่ต้องไปคีย์ที่แท็บบันทึกรายการอีก
        · ภงด.1 และ ประกันสังคม อยู่ที่หน้าเงินเดือน (ขาลงบัญชี) ไม่ได้อยู่ในนี้
      </p>
      <Msg msg={msg} />

      {!board ? (
        <p className="text-sm text-faint">กำลังโหลด…</p>
      ) : (
        <div className="space-y-2">
          {board.rows.map((r) => (
            <TaxRow
              key={r.kind}
              row={r}
              canWrite={canWrite}
              canConfig={canConfig}
              pending={pending}
              onPay={() => { setMsg(null); setOpen(r); }}
              onUnpay={() => doUnpay(r)}
            />
          ))}
        </div>
      )}

      {board && board.history.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-muted">ประวัติการชำระภาษีของกิจการนี้ ({board.history.length})</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr className="text-left text-faint">
                  <th>งวด</th><th>แบบ</th><th>วันที่จ่าย</th><th className="num">ยอด</th><th className="num">เบี้ยปรับ</th>
                  <th>บัญชี</th><th>บิล</th><th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {board.history.map((h, i) => (
                  <tr key={`${h.kind}-${h.period}-${i}`}>
                    <td>{h.period}</td>
                    <td>{h.kind === "vat" ? "ภพ.30" : h.kind === "pnd3" ? "ภงด.3" : "ภงด.53"}</td>
                    <td>{formatDateThai(h.pay_date)}</td>
                    <td className="num">{fmt(h.amount)}</td>
                    <td className="num">{h.surcharge ? fmt(h.surcharge) : "—"}</td>
                    <td>{h.account_name ?? "—"}</td>
                    <td className="text-xs">{h.tx_id ?? "—"}</td>
                    <td>
                      {h.status !== "ปกติ" ? <Badge tone="neutral">ถอนแล้ว</Badge>
                        : h.tx_status === "ยกเลิก" ? <Badge tone="crit">บิลถูกยกเลิก</Badge>
                        : <Badge tone="ok">จ่ายแล้ว</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {open && (
        <PayModal
          row={open}
          entityId={entityId}
          accounts={accounts}
          expenseCats={expenseCats}
          contacts={contacts}
          prefs={board?.prefs ?? {}}
          onClose={() => setOpen(null)}
          onSaved={() => { setOpen(null); load(); }}
        />
      )}
    </div>
  );
}

function TaxRow({
  row, canWrite, canConfig, pending, onPay, onUnpay,
}: {
  row: TaxDueRow; canWrite: boolean; canConfig: boolean; pending: boolean;
  onPay: () => void; onUnpay: () => void;
}) {
  const p = row.payment;
  const done = row.badge === "paid";
  // ★ ป้ายสถานะตัดสินใน lib (มีเทสคุม) — ที่นี่แค่แปลงเป็นสีกับคำ
  const BADGE = {
    paid: ["ok", "จ่ายแล้ว"],
    voided: ["crit", "บิลถูกยกเลิก"],
    unfiled: ["neutral", "ยังไม่ได้สร้างแบบ"],
    due: ["warn", "ยังไม่จ่าย"],
    none: ["neutral", "ไม่มียอด"],
  } as const;
  // 🪤 ป้องกัน row เก่าที่ยังไม่มี badge (ข้อมูลค้างใน state ตอน hot-reload / deploy คาบเกี่ยว)
  //    destructure ค่าที่เป็น undefined = ทั้งแถวพังเป็น error boundary ทั้งการ์ด
  const [tone, badgeText] = BADGE[row.badge] ?? BADGE.none;
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-ink">{TAX_KIND_FULL[row.kind]}</span>
        <Badge tone={tone}>{badgeText}</Badge>
        <span className="text-xs text-faint">
          กำหนดยื่น {formatDateThai(row.due.paper)} · ยื่นออนไลน์ถึง {formatDateThai(row.due.efiling)}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        {/* ★ ยังไม่ได้สร้างแบบ = ยังไม่มียอดที่ยื่นจริง → บอกว่าเป็นยอดจากบิล ไม่ใช่ "ต้องชำระ 0.00"
            (เคยขึ้น "ยอดต้องชำระ 0.00" คู่กับป้าย "ไม่มียอด" ทั้งที่มียอดรออยู่จริง) */}
        {row.badge === "unfiled" ? (
          <span className="text-muted">
            ยอดจากบิลตอนนี้ <b className="tnum text-ink">{fmt(row.liveAmount)}</b> บาท
            <span className="text-faint"> — กดสร้างแบบเพื่อยืนยันยอดที่จะยื่นและจ่าย</span>
          </span>
        ) : (
          <span className="text-muted">
            ยอดต้องชำระ <b className="tnum text-ink">{fmt(row.amount)}</b> บาท
          </span>
        )}
        {/* 🚨 ยอดที่แช่ไว้ต่างจากยอดสด → โชว์ทั้งคู่ ไม่เลือกข้างให้ (D75) */}
        {row.drifted && (
          <span className="text-warn">
            ยอดที่คำนวณจากบิลตอนนี้ได้ {fmt(row.liveAmount)} — ต่างจากยอดที่ยื่นไว้
            {row.kind === "vat" ? " (มีการแก้บิลหลังสร้าง ภพ.30 · สร้างแบบใหม่ถ้าจะยื่นตามยอดใหม่)" : ""}
          </span>
        )}
        {done && p && (
          <span className="text-muted">
            จ่าย {formatDateThai(p.pay_date)} · บิล {p.tx_id}
            {p.surcharge > 0 ? ` · เบี้ยปรับ ${fmt(p.surcharge)}` : ""}
          </span>
        )}
      </div>

      {row.billVoided && (
        <p className="mt-1 text-xs text-crit">
          บิล {p?.tx_id} ถูกยกเลิกจากหน้าค้นบิลไปแล้ว — เงินไม่ได้ออกจากบัญชี
          แต่ระบบยังบันทึกงวดนี้ว่า &quot;จ่ายแล้ว&quot; อยู่ · กด <b>ถอนการบันทึกจ่าย</b> ก่อน แล้วจึงบันทึกจ่ายใหม่ได้
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <RowBtn tone="brand" onClick={onPay} disabled={!canWrite || pending || !canPay(row)}>
          บันทึกจ่าย
        </RowBtn>
        {canUnpay(row) && (
          <RowBtn
            tone="red"
            onClick={onUnpay}
            disabled={!canConfig || pending}
            title={canConfig ? undefined : "ถอนได้เฉพาะผู้ที่ตั้งค่าหน้าบัญชีได้ (หัวหน้าบัญชี/เจ้าของกิจการ)"}
          >
            ถอนการบันทึกจ่าย
          </RowBtn>
        )}
      </div>
      {/* คำอธิบายว่าทำไมปุ่มเทา — ไม่ใช่ตัวตัดสิน (D83) */}
      {/* คำอธิบายว่าทำไมปุ่มเทา — ไม่ใช่ตัวตัดสิน (D83)
          ★ จ่ายแล้วไม่ต้องขึ้นอะไร ป้าย "จ่ายแล้ว" บอกครบแล้ว (ขึ้นอีกบรรทัดว่า
            "ยังกดจ่ายไม่ได้" ข้าง ๆ ป้ายเขียวอ่านแล้วสับสน) */}
      {!done && (
        <MissingHint
          checks={[
            { label: "สิทธิ์บันทึกบัญชี", ok: canWrite },
            { label: row.blocked ?? "", ok: !row.blocked },
          ]}
          prefix="ยังกดจ่ายไม่ได้"
        />
      )}
    </div>
  );
}

function PayModal({
  row, entityId, accounts, expenseCats, contacts, prefs, onClose, onSaved,
}: {
  row: TaxDueRow;
  entityId: string;
  accounts: AccountRow[];
  expenseCats: string[];
  contacts: Contact[];
  prefs: Prefs;
  onClose: () => void;
  onSaved: () => void;
}) {
  const pref = prefs[row.kind] ?? {};
  const visibleAccounts = accounts.filter(
    (a) => !a.entity_ids || a.entity_ids.length === 0 || a.entity_ids.includes(entityId),
  );
  const [payDate, setPayDate] = useState(todayISO());
  const [amount, setAmount] = useState<number | "">(row.amount);
  const [surcharge, setSurcharge] = useState<number | "">("");
  const [accountName, setAccountName] = useState(pref.accountName || visibleAccounts[0]?.account_name || "");
  const [category, setCategory] = useState(pref.category || DEFAULT_TAX_CAT[row.kind]);
  const [surchargeCategory, setSurchargeCategory] = useState(pref.surchargeCategory || DEFAULT_SURCHARGE_CAT);
  const [contactName, setContactName] = useState(pref.contactName || DEFAULT_TAX_PAYEE);
  const [note, setNote] = useState("");
  const { pending, msg, run } = useSaver();

  const amt = Number(amount) || 0;
  const sur = Number(surcharge) || 0;
  const checks = [
    { label: "วันที่จ่าย", ok: !!payDate },
    { label: "ยอดที่จ่าย", ok: amt > 0 },
    { label: "บัญชีที่จ่าย", ok: !!accountName.trim() },
    { label: "หมวดหมู่", ok: !!category.trim() },
    { label: "จ่ายให้", ok: !!contactName.trim() },
    { label: "หมวดของเบี้ยปรับ", ok: sur <= 0 || !!surchargeCategory.trim() },
  ];
  const ready = checks.every((c) => c.ok);

  function submit() {
    const contactId = contacts.find((c) => c.name.trim() === contactName.trim())?.contact_id ?? "";
    run(
      () =>
        payTaxAction({
          kind: row.kind as TaxKind,
          period: row.period,
          entityId,
          payDate,
          amount: amt,
          surcharge: sur,
          accountName: accountName.trim(),
          category: category.trim(),
          surchargeCategory: surchargeCategory.trim(),
          contactName: contactName.trim(),
          contactId,
          note: note.trim(),
        }),
      "บันทึกจ่ายเรียบร้อย — สร้างบิลรายจ่ายให้แล้ว",
      onSaved,
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay/30 p-0 sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <EscToClose onClose={onClose} />
      <div className="min-h-dvh w-full bg-card p-5 sm:my-8 sm:min-h-0 sm:max-w-2xl sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-ink">บันทึกจ่าย {TAX_KIND_FULL[row.kind]}</h3>
        <p className="mb-3 text-xs text-faint">
          {taxTxDescription(row.kind, row.period)} · กำหนดยื่น {formatDateThai(row.due.paper)} (ออนไลน์ถึง {formatDateThai(row.due.efiling)})
        </p>
        <Msg msg={msg} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="วันที่จ่าย (วันที่เงินออกจากบัญชี)">
            <TextInput type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </Field>
          <Field label="ยอดที่จ่าย (บาท)">
            <NumBox value={amount} onChange={setAmount} />
          </Field>
          <Field label="จ่ายจากบัญชี">
            <Select value={accountName} onChange={(e) => setAccountName(e.target.value)}>
              <option value="">— เลือกบัญชี —</option>
              {visibleAccounts.map((a) => (
                <option key={a.account_name} value={a.account_name}>{a.account_name}</option>
              ))}
            </Select>
          </Field>
          <Field label="หมวดหมู่รายจ่าย">
            <TextInput list="taxpay-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder={DEFAULT_TAX_CAT[row.kind]} />
          </Field>
          <Field label="จ่ายให้ (คู่ค้า)">
            <TextInput list="taxpay-payee" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder={DEFAULT_TAX_PAYEE} />
          </Field>
          <Field label="เบี้ยปรับ/เงินเพิ่ม (ถ้ายื่นช้า)">
            <NumBox value={surcharge} onChange={setSurcharge} blankZero />
          </Field>
          {sur > 0 && (
            <Field label="หมวดของเบี้ยปรับ (ต้องแยกจากตัวภาษี)">
              <TextInput list="taxpay-cat" value={surchargeCategory} onChange={(e) => setSurchargeCategory(e.target.value)} />
            </Field>
          )}
          <Field label="หมายเหตุ (ไม่บังคับ)">
            <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น เลขที่อ้างอิงการชำระ" />
          </Field>
        </div>

        {/* datalist: id ต้องไม่ซ้ำกับแท็บอื่นที่ mount ค้างอยู่ (บทเรียน D77) */}
        <datalist id="taxpay-cat">
          {[...new Set([DEFAULT_TAX_CAT[row.kind], DEFAULT_SURCHARGE_CAT, ...expenseCats])].map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <datalist id="taxpay-payee">
          {[...new Set([DEFAULT_TAX_PAYEE, ...contacts.map((c) => c.name)])].map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>

        {sur > 0 && (
          <p className="mt-3 rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn">
            เบี้ยปรับ/เงินเพิ่มจะถูกบันทึกเป็น <b>บิลแยกอีกใบ</b> คนละหมวดกับตัวภาษี —
            เป็นรายจ่ายต้องห้ามที่ต้องบวกกลับตอนคำนวณภาษีเงินได้สิ้นปี รวมหมวดกันแล้วผู้ทำบัญชีแยกออกมาไม่ได้
          </p>
        )}
        {Math.abs(amt - row.amount) >= 0.005 && amt > 0 && (
          <p className="mt-3 rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn">
            ยอดที่กรอกต่างจากยอดที่ระบบคำนวณไว้ ({fmt(row.amount)} บาท) — บันทึกได้ แต่ระบบจะเก็บยอดที่คำนวณไว้ด้วยเพื่อให้ย้อนตรวจได้
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <SaveButton pending={pending} disabled={!ready} onClick={submit}>บันทึกจ่าย</SaveButton>
          <RowBtn onClick={onClose} disabled={pending}>ปิด</RowBtn>
        </div>
        <MissingHint checks={checks} />
      </div>
    </div>
  );
}
