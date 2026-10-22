"use client";

import { useMemo, useState } from "react";
import { getAdvancesAction, clearAdvancesAction, unclearAdvancesAction, advanceToPersonalAction } from "../actions";
import type { Bootstrap } from "./types";
import { Card, Field, Msg, Select, TextInput, fmt, todayISO, useSaver, useRead, LoadError } from "./ui";
import { useConfirm } from "@/lib/shared/ui";
import { can, toRole } from "@/lib/shared/roles";
import {
  groupPendingAdvances,
  clearSelectionProblem,
  defaultRefundAccount,
  staleInvoiceWarn,
  accountsOf,
  type AdvanceGroup,
  type AdvanceRow,
} from "@/lib/accounting/advance";

type Data = Awaited<ReturnType<typeof getAdvancesAction>>;

/**
 * D119 — สำรองจ่ายรอเบิกคืน + เคลีย + ถอนการเคลีย (อยู่บนสุดของแท็บลูกหนี้-เจ้าหนี้)
 * ★ ด่าน/ข้อความตัดสินใน lib/accounting/advance (มีเทส A22) · ตัวตัดสินจริงคือ RPC ใน 0086
 */
export function AdvanceCard({ boot, entityId, active }: { boot: Bootstrap; entityId: string; active: boolean }) {
  const { pending, msg, run } = useSaver();
  const { confirmNode, ask } = useConfirm();
  const role = toRole(boot.role);
  const canWrite = can(role, "acct.write");
  const canUnclear = can(role, "acct.config");
  const [showAllCleared, setShowAllCleared] = useState(false);

  const { data, loading, err, reload } = useRead<Data>(() => getAdvancesAction(entityId), [entityId], { skip: !active });
  const groups = useMemo(() => groupPendingAdvances(data?.pending ?? []), [data]);
  const entName = (id: string) => boot.entities.find((e) => e.entity_id === id)?.name ?? "";
  const entLabel = (id: string) => (entName(id) ? `${id} — ${entName(id)}` : id);

  // กิจการเดียวในระบบ = สำรองจ่ายไม่มีความหมาย และไม่มีข้อมูลเก่า → ไม่ต้องโชว์การ์ดนี้เลย
  if (boot.entities.length < 2 && !(data && (data.pending.length || data.cleared.length))) return null;
  if (err && !data) return <LoadError err onRetry={reload} what="สำรองจ่าย" />;
  if (loading || !data) return <p className="text-faint">กำลังโหลดสำรองจ่าย…</p>;

  const total = groups.reduce((s, g) => s + g.total, 0);

  async function toPersonal(r: AdvanceRow) {
    const ok = await ask({
      title: "ตัดเป็นค่าใช้จ่ายส่วนตัว?",
      detail:
        `บิล ${r.txId} (${fmt(r.netAmount)} บาท) จะกลายเป็นรายจ่ายของ ${entLabel(r.payer)} แทนการรอเบิกคืนจาก ${entLabel(r.target)}` +
        (r.vatAmount > 0
          ? `\n\nใบกำกับออกในนาม ${entName(r.target) || r.target} จึงขอคืนภาษีซื้อไม่ได้ — VAT ${fmt(r.vatAmount)} บาทรวมเป็นค่าใช้จ่าย (เงินที่จ่ายจริง ${fmt(r.netAmount)} บาทเท่าเดิม)`
          : "") +
        "\n\nทำแล้วกลับเป็นสำรองจ่ายไม่ได้ (ยังแก้หรือยกเลิกบิลได้ที่แท็บค้นบิล)",
      confirmText: "ตัดเป็นค่าใช้จ่ายส่วนตัว",
    });
    if (!ok) return;
    run(() => advanceToPersonalAction(r.txId), `ตัดบิล ${r.txId} เป็นค่าใช้จ่ายส่วนตัวแล้ว`, reload);
  }

  async function unclear(b: Data["cleared"][number]) {
    const ok = await ask({
      title: `ถอนการเคลีย ${b.clearId}?`,
      detail:
        `บิลรายจ่ายของ ${entLabel(b.target)} ${b.billIds.length} ใบ และรายการรับคืน ${fmt(b.total)} บาทเข้า ${b.refundAccount} จะถูกยกเลิก` +
        `\nบิลสำรองจ่าย ${b.advanceIds.length} ใบกลับไปเป็น "รอเบิกคืน"` +
        `\n\nถ้ายื่น ภพ.30 เดือนที่เคลีย (${b.date.substring(0, 7)}) ไปแล้ว ยอดภาษีซื้อจะต่างจากที่ยื่น`,
      confirmText: "ถอนการเคลีย",
    });
    if (!ok) return;
    run(() => unclearAdvancesAction(b.clearId), `ถอนการเคลีย ${b.clearId} แล้ว`, reload);
  }

  const cleared = showAllCleared ? data.cleared : data.cleared.slice(0, 10);

  return (
    <>
      {confirmNode}
      <Card title={`สำรองจ่ายรอเบิกคืน — รวม ${fmt(total)} บาท`}>
        <Msg msg={msg} />
        {groups.length === 0 ? (
          <p className="text-sm text-faint">ไม่มีบิลสำรองจ่ายรอเบิกคืน · บันทึกได้ที่แท็บบันทึก เลือกประเภท <b>สำรองจ่าย</b></p>
        ) : (
          <div className="space-y-5">
            {groups.map((g) => (
              <AdvanceGroupBlock
                key={g.key}
                g={g}
                boot={boot}
                entLabel={entLabel}
                canWrite={canWrite}
                pending={pending}
                onToPersonal={toPersonal}
                onClear={async (rows, payAccount, refundAccount, date) => {
                  const sum = rows.reduce((s, r) => s + r.netAmount, 0);
                  const ok = await ask({
                    title: `เคลียสำรองจ่าย ${rows.length} ใบ?`,
                    detail:
                      `${entLabel(g.target)} จ่ายคืน ${fmt(sum)} บาท จาก ${payAccount} เข้า ${refundAccount || "บัญชีที่จ่ายออกไป"}` +
                      `\nระบบจะสร้างบิลรายจ่ายของ ${entName(g.target) || g.target} ${rows.length} ใบ ลงวันที่ ${date} (ภาษีซื้อเข้า ภพ.30 เดือนนั้น)`,
                    confirmText: "เคลีย",
                  });
                  if (!ok) return false;
                  run(
                    () => clearAdvancesAction({ txIds: rows.map((r) => r.txId), payAccount, refundAccount, date }),
                    `เคลีย ${rows.length} ใบแล้ว — บิลรายจ่ายของ ${entName(g.target) || g.target} อยู่ในแท็บค้นบิล`,
                    reload,
                  );
                  return true;
                }}
              />
            ))}
          </div>
        )}
      </Card>

      {data.cleared.length > 0 && (
        <Card title={`เคลียแล้ว (${data.cleared.length})`}>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr className="text-left text-faint">
                  <th>วันที่เคลีย</th><th>เลขที่</th><th>ซื้อให้</th><th>จ่ายคืนจาก</th><th>รับคืนเข้า</th>
                  <th className="num">ใบ</th><th className="num">ยอด</th><th></th>
                </tr>
              </thead>
              <tbody>
                {cleared.map((b) => (
                  <tr key={b.clearId}>
                    <td className="whitespace-nowrap">{b.date}</td>
                    <td className="whitespace-nowrap">{b.clearId}</td>
                    <td>{entLabel(b.target)}</td>
                    <td>{b.payAccount}</td>
                    <td>{b.refundAccount}</td>
                    <td className="num">{b.advanceIds.length}</td>
                    <td className="num">{fmt(b.total)}</td>
                    <td className="act">
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => unclear(b)}
                          disabled={pending || !canUnclear}
                          title={canUnclear ? "ยกเลิกบิลของกิจการปลายทาง + รายการรับคืน แล้วให้บิลสำรองจ่ายกลับไปรอเบิกคืน" : "ถอนการเคลียได้เฉพาะหัวหน้าบัญชีขึ้นไป"}
                          className="rounded border border-line px-2 py-1 text-sm text-muted hover:bg-raised disabled:opacity-40"
                        >
                          ถอนการเคลีย
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.cleared.length > 10 && (
            <button type="button" onClick={() => setShowAllCleared((v) => !v)} className="mt-2 text-sm text-muted hover:underline">
              {showAllCleared ? "แสดงแค่ 10 รายการล่าสุด" : `แสดงทั้งหมด ${data.cleared.length} รายการ`}
            </button>
          )}
        </Card>
      )}
    </>
  );
}

function AdvanceGroupBlock({
  g, boot, entLabel, canWrite, pending, onToPersonal, onClear,
}: {
  g: AdvanceGroup;
  boot: Bootstrap;
  entLabel: (id: string) => string;
  canWrite: boolean;
  pending: boolean;
  onToPersonal: (r: AdvanceRow) => void;
  onClear: (rows: AdvanceRow[], payAccount: string, refundAccount: string, date: string) => Promise<boolean>;
}) {
  const [sel, setSel] = useState<string[]>([]);
  const [payAccount, setPayAccount] = useState("");
  const [refundAccount, setRefundAccount] = useState("");
  const [date, setDate] = useState(todayISO());

  const chosen = g.rows.filter((r) => sel.includes(r.txId));
  const payOptions = accountsOf(boot.accounts, g.target);
  const refundOptions = accountsOf(boot.accounts, g.payer);
  // บัญชีรับคืนปริยาย = บัญชีที่จ่ายออกไป (ถ้าทุกใบที่เลือกจ่ายจากบัญชีเดียว) — ผู้ใช้เปลี่ยนได้
  const effRefund = refundAccount || defaultRefundAccount(chosen);
  const problem = clearSelectionProblem(chosen, date) ?? (!payAccount ? "เลือกบัญชีที่จ่ายคืน" : !effRefund ? "เลือกบัญชีที่รับเงินคืน" : null);
  const warn = staleInvoiceWarn(chosen, date);
  const chosenSum = chosen.reduce((s, r) => s + r.netAmount, 0);
  const allOn = sel.length === g.rows.length;

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm text-ink">
          จ่ายโดย <b>{entLabel(g.payer)}</b> → ซื้อให้ <b>{entLabel(g.target)}</b>
        </div>
        <div className="text-sm text-muted">{g.rows.length} ใบ · รวม <b className="text-warn">{fmt(g.total)}</b> บาท{g.vatTotal > 0 ? ` (VAT ${fmt(g.vatTotal)})` : ""}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr className="text-left text-faint">
              {canWrite && <th className="w-8"><input type="checkbox" checked={allOn} onChange={(e) => setSel(e.target.checked ? g.rows.map((r) => r.txId) : [])} title="เลือกทั้งหมด" /></th>}
              <th>วันที่</th><th>คู่ค้า</th><th>รายละเอียด</th><th>ใบกำกับ</th><th>จ่ายจาก</th><th className="num">ยอด</th>{canWrite && <th></th>}
            </tr>
          </thead>
          <tbody>
            {g.rows.map((r) => (
              <tr key={r.txId}>
                {canWrite && (
                  <td><input type="checkbox" checked={sel.includes(r.txId)} onChange={(e) => setSel((p) => (e.target.checked ? [...p, r.txId] : p.filter((x) => x !== r.txId)))} /></td>
                )}
                <td className="whitespace-nowrap">{r.date}</td>
                <td>{r.contactName}</td>
                <td>{r.description}</td>
                <td className="whitespace-nowrap">{r.taxInvoiceNo || "-"}</td>
                <td>{r.accountName}</td>
                <td className="num">{fmt(r.netAmount)}</td>
                {canWrite && (
                  <td className="act">
                    <button type="button" onClick={() => onToPersonal(r)} disabled={pending} title="บริษัทไม่คืนเงินแล้ว — เปลี่ยนเป็นรายจ่ายของกิจการที่จ่าย" className="text-sm text-muted hover:underline disabled:opacity-40">
                      ตัดเป็นส่วนตัว
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canWrite && chosen.length > 0 && (
        <div className="mt-3 rounded-lg bg-raised p-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field label={`${entLabel(g.target)} จ่ายคืนจากบัญชี`}>
              <Select value={payAccount} onChange={(e) => setPayAccount(e.target.value)}>
                <option value="">— เลือก —</option>
                {payOptions.map((a) => (<option key={a.account_name} value={a.account_name}>{a.account_name}</option>))}
              </Select>
            </Field>
            <Field label="รับเงินคืนเข้าบัญชี">
              <Select value={effRefund} onChange={(e) => setRefundAccount(e.target.value)}>
                <option value="">— เลือก —</option>
                {refundOptions.map((a) => (<option key={a.account_name} value={a.account_name}>{a.account_name}</option>))}
              </Select>
            </Field>
            <Field label="วันที่เคลีย (วันที่บริษัทโอน)"><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <button
              type="button"
              disabled={pending || problem !== null}
              onClick={async () => { if (await onClear(chosen, payAccount, effRefund, date)) { setSel([]); setRefundAccount(""); } }}
              className="rounded-lg bg-brand px-4 py-2 text-sm text-on-brand disabled:opacity-50"
            >
              เคลีย {chosen.length} ใบ · {fmt(chosenSum)} บาท
            </button>
          </div>
          {problem && <p className="mt-1 text-xs text-warn">ยังกดไม่ได้: {problem}</p>}
          {warn && <p className="mt-1 text-xs text-warn">{warn}</p>}
          <p className="mt-1 text-xs text-faint">
            บิลรายจ่ายของ {entLabel(g.target)} จะลงวันที่เคลีย (วันที่ใบกำกับคงตามใบจริง) — ภาษีซื้อเข้า ภพ.30 เดือนที่เคลีย
          </p>
        </div>
      )}
    </div>
  );
}
