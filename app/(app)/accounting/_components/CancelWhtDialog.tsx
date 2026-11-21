"use client";

import { useState } from "react";
import { Modal, ModalCancel } from "@/lib/shared/ui";
import { showToast } from "@/lib/shared/toast";
import { useDateFmt } from "@/lib/shared/dateFormatContext";
import { cancelWhtBlock, cancelWhtEffects, cancelWhtFiledWarn, filedFromServer } from "@/lib/accounting/whtCancel";
import { cancelWhtAction } from "../actions";
import { Field, TextInput, fmt } from "./ui";

/**
 * D180 — ยกเลิกใบ 50ทวิ ที่ออกไปแล้ว
 *
 * ★ ไม่ลบ: ใบขึ้นว่า "ยกเลิก" · เลขไม่ถูกนำกลับมาใช้ · บิลกลับเข้าคิวรอออก
 * ★ ต้องมีเหตุผล · ภงด. เดือนนั้นยื่นแล้ว = ต้องติ๊กรับทราบ (เตือน ไม่บล็อก — fn_cancel_wht บังคับซ้ำ)
 * 🚨 ไม่มี onSubmit — Enter ในช่องเหตุผลห้ามยกเลิกเอกสารแทนการกดปุ่ม (keyboard.test.ts ล็อก)
 */
export function CancelWhtDialog({
  docNo, entityId, issueDate, contactName, baseAmount, whtAmount, billCount, filed, onClose, onDone,
}: {
  docNo: string;
  entityId: string;
  issueDate: string;
  contactName: string;
  baseAmount: number;
  whtAmount: number;
  billCount: number;
  /** ภงด. ที่ยื่นแล้วซึ่งอาจมีบิลของใบนี้ (whtCertFiledPeriods) */
  filed: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const d = useDateFmt();
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ★ server อาจบอกว่ายื่นแล้วทั้งที่หน้าจอยังไม่รู้ (มีคนติ๊กยื่นระหว่างที่ป๊อปอัพเปิด) → เพิ่มเข้ารายการ
  const [serverFiled, setServerFiled] = useState<string[]>([]);
  const filedAll = serverFiled.length > 0 && filed.length === 0 ? serverFiled : filed;

  const block = cancelWhtBlock({ reason, filed: filedAll, ackFiled: ack });
  const filedWarn = cancelWhtFiledWarn(filedAll);

  async function submit() {
    if (block) return;
    setBusy(true);
    setError(null);
    const r = await cancelWhtAction({ entityId, docNo, reason: reason.trim(), ackFiled: ack });
    setBusy(false);
    if (r.ok) {
      showToast({ ok: true, text: `ยกเลิกใบ 50ทวิ เลขที่ ${docNo} แล้ว — บิลกลับเข้าคิว "ยังไม่ออกใบ" ของเดือนที่จ่ายเงิน` });
      onDone();
      return;
    }
    if (r.needAck && r.filed) {
      // ★ กล่องเหลือง + ช่องติ๊กอธิบายครบแล้ว — ไม่ต้องมีกล่องแดงพูดซ้ำ (เทสเบราว์เซอร์ 133.3)
      setServerFiled(filedFromServer(r.filed, d.month));
      setAck(false);
      return;
    }
    setError(r.error ?? "ยกเลิกไม่สำเร็จ");
  }

  return (
    <Modal
      title={<>ยกเลิกใบ 50ทวิ เลขที่ {docNo}</>}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {/* D134 — การกระทำชื่อ "ยกเลิก…" ปุ่มปิดต้องเป็น "กลับ" */}
          <ModalCancel onClick={onClose} disabled={busy}>กลับ</ModalCancel>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !!block}
            className="min-h-[44px] rounded border border-crit-line bg-crit-bg px-4 text-sm font-semibold text-crit transition hover:opacity-90 disabled:opacity-50 sm:min-h-0 sm:py-2"
          >
            {busy ? "กำลังยกเลิก…" : "ยกเลิกใบนี้"}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted">
          {contactName} · ออกวันที่ {d.date(issueDate)} · ยอดที่จ่าย <b className="tnum">{fmt(baseAmount)}</b> · ภาษีหัก <b className="tnum">{fmt(whtAmount)}</b>
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          {cancelWhtEffects({ docNo, billCount }).map((t) => <li key={t}>{t}</li>)}
        </ul>
        {filedWarn && (
          <div className="rounded border border-warn-line bg-warn-bg p-2 text-warn">
            <p>⚠️ {filedWarn}</p>
            <label className="mt-2 flex items-start gap-2">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
              <span>รับทราบ — ยกเลิกในแอปแล้วจะไปยื่นแบบเพิ่มเติมเองถ้ายอดที่ยื่นผิด</span>
            </label>
          </div>
        )}
        <Field label="เหตุผลที่ยกเลิก (จำเป็น)">
          <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ยอดจ่ายรวมค่าขนส่งที่ไม่ได้หัก" maxLength={300} />
        </Field>
        {/* D83 — ปุ่มเทาต้องบอกเหตุผลบนจอ */}
        {block && !busy && <p className="text-xs text-faint">ยังกดยกเลิกไม่ได้: {block}</p>}
        {error && <p className="rounded border border-crit-line bg-crit-bg p-2 text-crit">{error}</p>}
      </div>
    </Modal>
  );
}
