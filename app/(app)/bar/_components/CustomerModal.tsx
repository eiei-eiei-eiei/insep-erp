"use client";

import { useState } from "react";
import type { BarBoot } from "../data";
import { Field, TextInput } from "@/lib/shared/ui";
import type { saveCustomerAction } from "../actions";

/**
 * ฟอร์มเพิ่ม/แก้ลูกค้าบาร์ (D96)
 *
 * ★ **แยกออกมาเป็นไฟล์ของตัวเองเพราะถูกเรียกจาก 2 หน้าจอ** — แท็บลูกค้า และแท็บขาย
 *   (ผู้ใช้ขอให้เพิ่มลูกค้าได้จากหน้าขายเลย ไม่ต้องสลับแท็บกลางบิล)
 * 🚨 **ห้ามก๊อปฟอร์มไปวางอีกชุด** — ช่องความยินยอม PDPA กับกฎเลขภาษี
 *   ต้องเหมือนกันทุกที่ที่เพิ่มลูกค้าได้ (บทเรียน `billItems` ของ D42: เลิกก๊อป 3 ชุด)
 */
export function CustomerModal({
  boot, customerId, busy, onClose, onSave, onDelete,
}: {
  boot: BarBoot;
  customerId: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: Parameters<typeof saveCustomerAction>[0]) => void;
  /** ★ ไม่ส่งมา = ไม่มีปุ่มลบ (หน้าขายเพิ่มลูกค้าใหม่อย่างเดียว) */
  onDelete?: (id: string) => void;
}) {
  const cur = boot.customers.find((c) => c.customerId === customerId);
  const [name, setName] = useState(cur?.name ?? "");
  const [nickname, setNickname] = useState(cur?.nickname ?? "");
  const [phone, setPhone] = useState(cur?.phone ?? "");
  const [note, setNote] = useState(cur?.note ?? "");
  const [taxId, setTaxId] = useState(cur?.taxId ?? "");
  const [branch, setBranch] = useState(cur?.branch ?? "");
  const [address, setAddress] = useState(cur?.address ?? "");
  const [consent, setConsent] = useState(false);
  const [showTax, setShowTax] = useState(Boolean(cur?.taxId));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-xl bg-card p-5">
        <h3 className="mb-3 text-lg font-bold text-ink">{cur ? "แก้ข้อมูลลูกค้า" : "เพิ่มลูกค้า"}</h3>

        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="ชื่อ">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="ชื่อเล่น">
            <TextInput value={nickname} onChange={(e) => setNickname(e.target.value)} />
          </Field>
        </div>
        <Field label="เบอร์โทร (ไม่บังคับ)">
          <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="โน้ตที่ต้องจำ">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="แพ้ถั่ว · ไม่กินหวาน · ชอบเปรี้ยวจัด" />
        </Field>

        <label className="mt-3 flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={showTax} onChange={(e) => setShowTax(e.target.checked)} />
          ขอใบเสร็จในนามบริษัท (ต้องมีเลขภาษี · ที่อยู่ · สาขา)
        </label>
        {showTax && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Field label="เลขประจำตัวผู้เสียภาษี">
              <TextInput value={taxId} onChange={(e) => setTaxId(e.target.value)} />
            </Field>
            <Field label="สาขา">
              <TextInput value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="สำนักงานใหญ่" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="ที่อยู่">
                <TextInput value={address} onChange={(e) => setAddress(e.target.value)} />
              </Field>
            </div>
          </div>
        )}

        {/* 🚨 PDPA — ค่าปริยายต้องไม่ติ๊ก · ความยินยอมที่ติ๊กไว้ล่วงหน้าไม่ใช่ความยินยอม */}
        <div className="mt-3 rounded-lg bg-raised p-3">
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
            <span>
              <b>ยินยอมให้โรงกลั่นติดต่อ</b>
              <span className="block text-xs text-faint">
                ติ๊กเมื่อ<b>ถามลูกค้าแล้ว</b>เท่านั้น · ชื่อและเบอร์จะอยู่ในไฟล์ที่ส่งให้โรงกลั่นทำตลาด ·
                ถอนได้ทุกเมื่อโดยติ๊กออก
              </span>
            </span>
          </label>
          {cur && !consent && (
            <p className="mt-1 text-xs text-muted">
              สถานะปัจจุบันโหลดเป็น &quot;ไม่ยินยอม&quot; เสมอ — ต้องติ๊กใหม่ทุกครั้งที่แก้โปรไฟล์
              เพื่อไม่ให้ความยินยอมติดค้างโดยไม่ตั้งใจ
            </p>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() =>
              onSave({
                customerId,
                name, nickname, phone, note,
                taxId: showTax ? taxId : "",
                branch: showTax ? branch : "",
                address: showTax ? address : "",
                consentMarketing: consent,
              })
            }
            className="flex-1 rounded-lg bg-brand px-3 py-2 text-sm text-on-brand disabled:opacity-50"
          >
            บันทึก
          </button>
          {cur && boot.canConfig && onDelete && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDelete(cur.customerId)}
              className="rounded-lg bg-raised px-3 py-2 text-sm text-crit disabled:opacity-50"
            >
              ลบ
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-lg bg-raised px-3 py-2 text-sm text-ink">
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
}
