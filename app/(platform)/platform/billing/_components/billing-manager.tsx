"use client";

import { useState } from "react";
import {
  Badge,
  Card,
  Empty,
  Field,
  Msg,
  NumBox,
  RowBtn,
  SaveButton,
  Select,
  Stat,
  TableWrap,
  TextInput,
  fmt,
  useSaver,
} from "@/lib/shared/ui";
import { IconAlert } from "@/lib/shared/icons";
import { formatDateThai } from "@/lib/shared/format";
import {
  BILLING_STATE_LABEL,
  billingState,
  daysUntil,
  monthlyEquivalent,
  suggestPlanName,
  suggestPrice,
  type Cycle,
} from "@/lib/platform/billing";
import type { BillingRow } from "@/lib/platform/billing-db";
import {
  recordPaymentAction,
  saveSubscriptionAction,
  setActiveAction,
  voidPaymentAction,
} from "../actions";

const CYCLE_LABEL: Record<Cycle, string> = { monthly: "รายเดือน", yearly: "รายปี" };
const STATUS_LABEL: Record<string, string> = {
  active: "ใช้งานอยู่",
  paused: "หยุดพักชั่วคราว",
  cancelled: "ยกเลิกแล้ว",
};

const TONE: Record<string, "ok" | "warn" | "crit" | "neutral"> = {
  active: "ok",
  due_soon: "warn",
  past_due: "crit",
  paused: "neutral",
  cancelled: "neutral",
  none: "neutral",
};

/** ข้อความบอกว่าเหลือ/เลยมากี่วัน — อ่านเร็วกว่าวันที่ล้วนตอนกวาดตาทั้งตาราง */
function dueText(dueOn: string, todayISO: string): string {
  const left = daysUntil(todayISO, dueOn);
  if (left === 0) return "ครบกำหนดวันนี้";
  return left > 0 ? `อีก ${left} วัน` : `เลยมาแล้ว ${-left} วัน`;
}

// ── แผงจัดการค่างวดของลูกค้า 1 ราย ────────────────────────────────────────────

function BillingPanel({
  row,
  todayISO,
  pending,
  onSave,
  onPay,
  onVoid,
  onActive,
}: {
  row: BillingRow;
  todayISO: string;
  pending: boolean;
  onSave: (input: {
    plan: string;
    price: number;
    cycle: Cycle;
    startedOn: string;
    status: "active" | "paused" | "cancelled";
    note: string | null;
    billingNotice: boolean;
  }) => void;
  onPay: (input: { amount: number; paidOn: string; note: string | null }) => void;
  onVoid: () => void;
  onActive: (active: boolean) => void;
}) {
  const sub = row.subscription;
  const suggested = (c: Cycle) => suggestPrice(row.modules, row.entityCount, c);

  const [plan, setPlan] = useState(sub?.plan ?? suggestPlanName(row.modules));
  const [cycle, setCycle] = useState<Cycle>(sub?.cycle ?? "monthly");
  const [price, setPrice] = useState<number | "">(sub?.price ?? suggested(sub?.cycle ?? "monthly"));
  const [startedOn, setStartedOn] = useState(sub?.startedOn ?? todayISO);
  const [status, setStatus] = useState(sub?.status ?? "active");
  const [note, setNote] = useState(sub?.note ?? "");
  const [notice, setNotice] = useState(row.billingNotice);

  const [payAmount, setPayAmount] = useState<number | "">(sub?.price ?? "");
  const [paidOn, setPaidOn] = useState(todayISO);
  const [payNote, setPayNote] = useState("");

  return (
    <Card className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-soft pb-3">
        <div>
          <h2 className="text-base font-bold text-ink">{row.name}</h2>
          <div className="text-xs text-faint">
            {row.slug} · {row.entityCount} กิจการ · โมดูล {row.modules.length || "ไม่ได้ตั้ง"}
          </div>
        </div>
        {!row.isActive && <Badge tone="crit">ถูกระงับการใช้งาน</Badge>}
      </div>

      {/* ── ค่างวด ── */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            plan,
            price: Number(price) || 0,
            cycle,
            startedOn,
            status: status as "active" | "paused" | "cancelled",
            note: note.trim() || null,
            billingNotice: notice,
          });
        }}
        className="space-y-4"
      >
        <h3 className="text-sm font-semibold text-ink">{sub ? "แก้ไขค่างวด" : "ตั้งค่างวด"}</h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="ชื่อแพ็กเกจ">
            <TextInput value={plan} onChange={(e) => setPlan(e.target.value)} required />
          </Field>
          <Field label="รอบการชำระ">
            <Select
              value={cycle}
              onChange={(e) => {
                const c = e.target.value as Cycle;
                setCycle(c);
                // ยังไม่เคยตั้งค่างวด = ยังไม่มีราคาที่ตกลงกันไว้ → ปรับตามรอบให้เลย
                if (!sub) setPrice(suggested(c));
              }}
            >
              {(Object.keys(CYCLE_LABEL) as Cycle[]).map((c) => (
                <option key={c} value={c}>
                  {CYCLE_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`ราคาต่อรอบ (บาท)`}>
            <NumBox value={price} onChange={setPrice} />
          </Field>
          <Field label="วันเริ่มใช้บริการ (ใช้เป็นวันตัดรอบ)">
            <TextInput
              type="date"
              value={startedOn}
              onChange={(e) => setStartedOn(e.target.value)}
              required
            />
          </Field>
          <Field label="สถานะ">
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="หมายเหตุ">
            <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
          <span>
            ระบบเสนอ <strong className="text-ink">{fmt(suggested(cycle))}</strong> บาท/
            {CYCLE_LABEL[cycle]} จากโมดูลที่เปิดอยู่ + {row.entityCount} กิจการ
          </span>
          <RowBtn type="button" onClick={() => setPrice(suggested(cycle))}>
            ใช้ราคานี้
          </RowBtn>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={notice} onChange={(e) => setNotice(e.target.checked)} />
          แจ้งเตือนค่าบริการในแอปของลูกค้า (เจ้าของกิจการเห็นก่อนครบกำหนด 3 วัน)
        </label>

        <SaveButton pending={pending}>{sub ? "บันทึกการแก้ไข" : "ตั้งค่างวด"}</SaveButton>
        {sub && (
          <p className="text-xs text-faint">
            วันครบกำหนดคำนวณจากวันเริ่มใช้บริการ + จ่ายมาแล้ว {sub.periodsPaid} รอบ —
            แก้วันเริ่มแล้ววันครบกำหนดจะขยับตามทันที
          </p>
        )}
      </form>

      {/* ── บันทึกการจ่าย ── */}
      {sub && (
        <div className="border-t border-line-soft pt-4">
          <h3 className="mb-2 text-sm font-semibold text-ink">บันทึกว่าจ่ายแล้ว</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onPay({
                amount: Number(payAmount) || 0,
                paidOn,
                note: payNote.trim() || null,
              });
              setPayNote("");
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="w-32">
              <Field label="จำนวนเงิน">
                <NumBox value={payAmount} onChange={setPayAmount} />
              </Field>
            </div>
            <div className="w-44">
              <Field label="วันที่จ่าย">
                <TextInput type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} required />
              </Field>
            </div>
            <div className="min-w-[10rem] flex-1">
              <Field label="หมายเหตุ">
                <TextInput
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder="เช่น โอน SCB 12:30"
                />
              </Field>
            </div>
            <SaveButton pending={pending} pendingText="กำลังบันทึก…">
              บันทึก 1 รอบ
            </SaveButton>
          </form>
          <p className="mt-2 text-xs text-faint">
            เลื่อนวันครบกำหนดไปอีก 1 รอบ <strong>จากรอบเดิม ไม่ใช่จากวันนี้</strong> —
            ลูกค้าที่จ่ายช้าจะไม่เสียวันที่จ่ายไปแล้ว · ค้างหลายรอบให้กดหลายครั้ง
          </p>
        </div>
      )}

      {/* ── ประวัติการจ่าย ── */}
      {sub && (
        <div className="border-t border-line-soft pt-4">
          <h3 className="mb-2 text-sm font-semibold text-ink">ประวัติการจ่าย</h3>
          {row.payments.length === 0 ? (
            <Empty>— ยังไม่มีการบันทึกการจ่าย —</Empty>
          ) : (
            <>
              <TableWrap minWidth={480}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>วันที่จ่าย</th>
                      <th className="num">จำนวนเงิน</th>
                      <th>ครบกำหนดถัดไป</th>
                      <th>หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.payments.map((p) => (
                      <tr key={p.id}>
                        <td>{formatDateThai(p.paidOn)}</td>
                        <td className="num">{fmt(p.amount)}</td>
                        <td>{formatDateThai(p.periodEndAfter)}</td>
                        <td>{p.note ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <div className="mt-3">
                <RowBtn type="button" tone="red" disabled={pending} onClick={onVoid}>
                  ย้อนรายการล่าสุด
                </RowBtn>
                <span className="ml-2 text-xs text-faint">
                  ย้อนได้เฉพาะรายการบนสุด (ย้อนอันกลางแล้วเลขรอบกับประวัติจะไม่ตรงกันอีก)
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── ระงับ / คืนสิทธิ์ ── */}
      <div className="border-t border-line-soft pt-4">
        <h3 className="mb-1 text-sm font-semibold text-ink">การเข้าใช้งานของลูกค้า</h3>
        <p className="mb-2 text-xs text-faint">
          ระงับแล้วลูกค้าจะเข้าใช้งานไม่ได้ทันที และเห็นหน้าแจ้งให้ติดต่อผู้ดูแลระบบ —
          <strong className="text-ink"> ข้อมูลไม่ถูกลบ</strong> เปิดคืนเมื่อไหร่ใช้ได้เหมือนเดิม
        </p>
        {row.isActive ? (
          <RowBtn type="button" tone="red" disabled={pending} onClick={() => onActive(false)}>
            ระงับการใช้งาน
          </RowBtn>
        ) : (
          <RowBtn type="button" tone="green" disabled={pending} onClick={() => onActive(true)}>
            คืนสิทธิ์การใช้งาน
          </RowBtn>
        )}
      </div>
    </Card>
  );
}

// ── หน้าหลัก ─────────────────────────────────────────────────────────────────

export function BillingManager({ rows, todayISO }: { rows: BillingRow[]; todayISO: string }) {
  const { pending, msg, run, setMsg } = useSaver();
  const [openId, setOpenId] = useState<string | null>(null);

  const open = rows.find((r) => r.tenantId === openId) ?? null;
  const stateOf = (r: BillingRow) =>
    billingState(
      r.subscription ? { status: r.subscription.status, currentPeriodEnd: r.subscription.currentPeriodEnd } : null,
      todayISO,
    );

  const overdue = rows.filter((r) => stateOf(r) === "past_due");
  const dueSoon = rows.filter((r) => stateOf(r) === "due_soon");
  const missing = rows.filter((r) => !r.subscription);
  const mrr = rows
    .filter((r) => r.subscription?.status === "active")
    .reduce((sum, r) => sum + monthlyEquivalent(r.subscription!.price, r.subscription!.cycle), 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">ค่างวดลูกค้า</h1>
        <p className="text-sm text-faint">
          เรียงตามครบกำหนดเร็วสุดก่อน · ตัดรอบตามวันที่ลูกค้าแต่ละรายเริ่มใช้บริการ
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="เลยกำหนด" value={`${overdue.length} ราย`} tone={overdue.length ? "red" : "slate"} />
        <Stat label="ครบกำหนดใน 7 วัน" value={`${dueSoon.length} ราย`} />
        <Stat label="รายได้ต่อเดือน (เทียบเท่า)" value={`${fmt(mrr)} ฿`} tone="green" />
      </div>

      <Msg msg={msg} />

      {missing.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-warn-line bg-warn-bg p-4">
          <IconAlert size={18} className="mt-0.5 shrink-0 text-warn" />
          <div className="text-sm text-warn">
            <strong>ลูกค้า {missing.length} รายยังไม่ได้ตั้งค่างวด</strong> —
            ระบบจะไม่รู้ว่าถึงกำหนดเก็บเงินเมื่อไหร่ และลูกค้าจะไม่ถูกเตือนในแอป
            <div className="mt-2 flex flex-wrap gap-2">
              {missing.map((r) => (
                <RowBtn key={r.tenantId} type="button" onClick={() => setOpenId(r.tenantId)}>
                  ตั้งค่างวดให้ {r.name}
                </RowBtn>
              ))}
            </div>
          </div>
        </div>
      )}

      <Card>
        <TableWrap minWidth={820}>
          <table className="tbl">
            <thead>
              <tr>
                <th>ลูกค้า</th>
                <th>แพ็กเกจ</th>
                <th className="num">ราคา/รอบ</th>
                <th>ครบกำหนด</th>
                <th>สถานะ</th>
                <th className="act"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = stateOf(r);
                const sub = r.subscription;
                return (
                  <tr key={r.tenantId} className={r.tenantId === openId ? "editing" : undefined}>
                    <td>
                      <div className="font-medium text-ink">{r.name}</div>
                      <div className="text-xs text-faint">{r.slug}</div>
                    </td>
                    <td>{sub ? `${sub.plan} · ${CYCLE_LABEL[sub.cycle]}` : "—"}</td>
                    <td className="num">{sub ? fmt(sub.price) : "—"}</td>
                    <td className="whitespace-nowrap">
                      {sub ? (
                        <>
                          {formatDateThai(sub.currentPeriodEnd)}
                          <div className="text-xs text-faint">{dueText(sub.currentPeriodEnd, todayISO)}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={TONE[st]}>{BILLING_STATE_LABEL[st]}</Badge>
                        {!r.isActive && <Badge tone="crit">ถูกระงับ</Badge>}
                      </span>
                    </td>
                    <td className="act">
                      <RowBtn
                        type="button"
                        onClick={() => setOpenId(r.tenantId === openId ? null : r.tenantId)}
                      >
                        {r.tenantId === openId ? "ปิด" : "จัดการ"}
                      </RowBtn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
        {rows.length === 0 && <Empty>— ยังไม่มีลูกค้า —</Empty>}
      </Card>

      {open && (
        <BillingPanel
          key={open.tenantId}
          row={open}
          todayISO={todayISO}
          pending={pending}
          onSave={(input) =>
            run(
              () => saveSubscriptionAction({ tenantId: open.tenantId, slug: open.slug, ...input }),
              "บันทึกค่างวดแล้ว",
            )
          }
          onPay={(input) => {
            setMsg(null);
            run(
              () => recordPaymentAction({ tenantId: open.tenantId, slug: open.slug, ...input }),
              "บันทึกการจ่ายแล้ว — เลื่อนวันครบกำหนดไปอีก 1 รอบ",
            );
          }}
          onVoid={() => {
            setMsg(null);
            if (!window.confirm("ย้อนรายการจ่ายล่าสุด?\nวันครบกำหนดจะถอยกลับไป 1 รอบ")) return;
            run(
              () => voidPaymentAction({ tenantId: open.tenantId, slug: open.slug }),
              "ย้อนรายการล่าสุดแล้ว",
            );
          }}
          onActive={(active) => {
            setMsg(null);
            const warn = active
              ? `คืนสิทธิ์การใช้งานให้ "${open.name}"?`
              : `ระงับการใช้งานของ "${open.name}"?\nผู้ใช้ทุกคนของกิจการนี้จะเข้าระบบไม่ได้ทันที (ข้อมูลไม่ถูกลบ)`;
            if (!window.confirm(warn)) return;
            run(
              () => setActiveAction({ tenantId: open.tenantId, slug: open.slug, active }),
              active ? "คืนสิทธิ์การใช้งานแล้ว" : "ระงับการใช้งานแล้ว",
            );
          }}
        />
      )}
    </div>
  );
}
