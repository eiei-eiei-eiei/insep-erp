"use client";

import { useState } from "react";
import type { BarBoot, BarCustomerRow } from "../data";
import { Card, Msg, TextInput, Field, Badge, Empty, fmt, useSaver, useConfirm } from "@/lib/shared/ui";
import {
  saveCustomerAction, deleteCustomerAction, toggleFavAction,
  customerCardAction, exportConsentedAction,
} from "../actions";

type CardData = {
  favMenuIds: string[];
  sales: { sale_no: string; business_date: string | null; grand_total: number }[];
  lines: { sale_no: string; menu_id: string | null; menu_name: string; qty: number; voided_at: string | null }[];
};

/**
 * ทะเบียนลูกค้าบาร์ (D96)
 *
 * 🚨 **แยกจาก `contacts` โดยตั้งใจ** — `contacts` เป็นคู่ค้า B2B ที่ใช้ร่วมกันทั้ง tenant
 *    (PK ไม่มี entity_id · ไม่มีโค้ดฝั่งอ่านกรอง entity เลยสักจุด — ตรวจแล้ว 2026-09-10)
 *    เอามาใช้ = พนักงานบาร์เห็นทะเบียนลูกค้าค้าส่งทั้งหมดพร้อมเลขภาษี/เครดิตเทอม
 *
 * ⚠️ **PDPA**: เก็บเบอร์โทร = ข้อมูลส่วนบุคคล → ต้องลบได้จริง และความยินยอมต้องถอนได้
 */
export function CustomerTab({ boot, onReload }: { boot: BarBoot; onReload: () => Promise<void> }) {
  const data = boot;
  const { msg, setMsg } = useSaver();
  const { confirmNode, ask } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<string | null | "new">(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [card, setCard] = useState<CardData | null>(null);

  const canWrite = data.canWrite;

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (!r.ok) {
        setMsg({ ok: false, text: r.error ?? "บันทึกไม่สำเร็จ" });
        return false;
      }
      await onReload();
      setMsg({ ok: true, text: okText });
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function openCard(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setCard(null);
    const r = await customerCardAction(id);
    if (!r.ok) {
      setMsg({ ok: false, text: r.error ?? "โหลดการ์ดลูกค้าไม่สำเร็จ" });
      return;
    }
    setCard(r.data as CardData);
  }

  const shown = data.customers.filter((c) => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return [c.name, c.nickname, c.phone, c.note].some((f) => (f ?? "").toLowerCase().includes(t));
  });

  async function exportCsv() {
    const r = await exportConsentedAction();
    if (!r.ok) {
      setMsg({ ok: false, text: r.error ?? "ส่งออกไม่สำเร็จ" });
      return;
    }
    const rows = r.data as Record<string, unknown>[];
    if (!rows.length) {
      setMsg({ ok: false, text: "ยังไม่มีลูกค้าที่ยินยอมให้โรงกลั่นติดต่อ" });
      return;
    }
    const head = ["ชื่อ", "ชื่อเล่น", "เบอร์โทร", "โน้ต", "ยินยอมเมื่อ", "มาล่าสุด", "จำนวนครั้ง"];
    const body = rows.map((x) =>
      [x.name, x.nickname, x.phone, x.note, x.consent_at, x.last_seen, x.visits]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(","),
    );
    // ﻿ = BOM · ไม่ใส่แล้ว Excel อ่านภาษาไทยเป็นตัวยึกยือ
    const blob = new Blob(["﻿" + [head.join(","), ...body].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ลูกค้าที่ยินยอม-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg({ ok: true, text: `ส่งออก ${rows.length} รายชื่อแล้ว` });
  }

  if (!data.entityId) return null;

  return (
    <div className="space-y-4">
      {confirmNode}
      <Msg msg={msg} />

      <Card title="ลูกค้าบาร์">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นชื่อ · ชื่อเล่น · เบอร์ · โน้ต" className="max-w-xs" />
          {canWrite && (
            <button type="button" onClick={() => setEdit("new")} className="rounded-lg bg-raised px-3 py-1.5 text-sm text-ink">
              ＋ เพิ่มลูกค้า
            </button>
          )}
          {data.canConfig && (
            <button type="button" onClick={exportCsv} className="ml-auto rounded-lg bg-raised px-3 py-1.5 text-sm text-ink">
              ส่งออกรายชื่อที่ยินยอม (CSV)
            </button>
          )}
        </div>

        {/* ★ อธิบายตรง ๆ ว่าการส่งออกคืออะไร — เป็นการส่งมอบที่มองเห็นได้ ไม่ใช่ท่อลับ */}
        {data.canConfig && (
          <p className="mb-3 text-xs text-faint">
            ไฟล์ที่ส่งออกมี <b>เฉพาะคนที่ติ๊กยินยอม</b> ให้โรงกลั่นติดต่อ ·
            คนที่ไม่ได้ติ๊กจะไม่อยู่ในไฟล์ และไม่มี query ไหนในระบบดึงข้อมูลข้ามกิจการเอง
          </p>
        )}

        {shown.length === 0 && <Empty>— ยังไม่มีลูกค้า —</Empty>}

        <div className="space-y-2">
          {shown.map((c) => (
            <div key={c.customerId} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => openCard(c.customerId)} className="text-left">
                  <span className="font-medium text-ink">{c.name}</span>
                  {c.nickname && <span className="ml-1 text-sm text-muted">({c.nickname})</span>}
                </button>
                {c.note && <span className="text-xs text-warn">⚠ {c.note}</span>}
                {c.taxId && <Badge tone="neutral">มีเลขภาษี</Badge>}
                <span className="ml-auto flex gap-2 text-xs">
                  <button type="button" onClick={() => openCard(c.customerId)} className="text-muted underline">
                    {openId === c.customerId ? "ปิดการ์ด" : "เปิดการ์ด"}
                  </button>
                  {canWrite && (
                    <button type="button" onClick={() => setEdit(c.customerId)} className="text-muted underline">
                      แก้
                    </button>
                  )}
                </span>
              </div>

              {openId === c.customerId && (
                <CustomerCard boot={data} customer={c} card={card} busy={busy} onRun={run} onReload={() => openCard(c.customerId)} />
              )}
            </div>
          ))}
        </div>
      </Card>

      {edit && (
        <CustomerModal
          boot={data}
          customerId={edit === "new" ? null : edit}
          busy={busy}
          onClose={() => setEdit(null)}
          onSave={async (input) => {
            if (await run(() => saveCustomerAction(input), "บันทึกลูกค้าแล้ว")) setEdit(null);
          }}
          onDelete={async (id) => {
            const ok = await ask({
              title: "ลบลูกค้ารายนี้?",
              detail: "ข้อมูลส่วนตัวจะถูกลบจริง · บิลเก่ายังอยู่แต่จะไม่ผูกกับใคร",
              confirmText: "ลบลูกค้า",
              danger: true,
            });
            if (!ok) return;
            if (await run(() => deleteCustomerAction(id), "ลบลูกค้าแล้ว")) setEdit(null);
          }}
        />
      )}
    </div>
  );
}

/** การ์ดลูกค้า — 🎯 โจทย์ตั้งต้น: "เผื่อลูกค้ามาสั่งซ้ำจะได้เปิดดูสูตรได้ ให้จำเองคงไม่หมด" */
function CustomerCard({
  boot, customer, card, busy, onRun, onReload,
}: {
  boot: BarBoot;
  customer: BarCustomerRow;
  card: CardData | null;
  busy: boolean;
  onRun: (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => Promise<boolean>;
  onReload: () => void;
}) {
  if (!card) return <div className="mt-3 text-sm text-muted">กำลังโหลด…</div>;

  const live = card.lines.filter((l) => !l.voided_at);
  const byMenu = new Map<string, { name: string; qty: number; last: string | null }>();
  for (const l of live) {
    const key = l.menu_id ?? `name:${l.menu_name}`;
    const sale = card.sales.find((s) => s.sale_no === l.sale_no);
    const cur = byMenu.get(key) ?? { name: l.menu_name, qty: 0, last: null };
    cur.qty += Number(l.qty);
    cur.name = l.menu_name;
    if (!cur.last || (sale?.business_date ?? "") > cur.last) cur.last = sale?.business_date ?? cur.last;
    byMenu.set(key, cur);
  }
  const ordered = [...byMenu.entries()].sort((a, b) => b[1].qty - a[1].qty);
  const favs = new Set(card.favMenuIds);
  const spend = card.sales.reduce((s, x) => s + Number(x.grand_total), 0);

  return (
    <div className="mt-3 space-y-3 rounded-lg bg-raised p-3">
      <div className="flex flex-wrap gap-4 text-sm">
        <span className="text-muted">
          มา <b className="text-ink">{card.sales.length}</b> ครั้ง
        </span>
        <span className="text-muted">
          ยอดสะสม <b className="text-ink">{fmt(spend)}</b>
        </span>
        {card.sales[0]?.business_date && (
          <span className="text-muted">
            ล่าสุด <b className="text-ink">{card.sales[0].business_date}</b>
          </span>
        )}
        {customer.phone && <span className="text-muted">โทร {customer.phone}</span>}
      </div>

      <div>
        <div className="mb-1 text-sm font-medium text-ink">เคยสั่ง</div>
        {ordered.length === 0 && <Empty>— ยังไม่เคยสั่งอะไร —</Empty>}
        {ordered.map(([key, v]) => {
          const menuId = key.startsWith("name:") ? null : key;
          const menu = menuId ? boot.menus.find((m) => m.menuId === menuId) : null;
          return (
            <div key={key} className="flex flex-wrap items-center gap-2 py-1 text-sm">
              <span className="text-ink">{v.name}</span>
              <span className="text-xs text-muted">
                {v.qty} แก้ว{v.last ? ` · ล่าสุด ${v.last}` : ""}
              </span>
              {menuId && (
                <button
                  type="button"
                  disabled={busy || !boot.canWrite}
                  onClick={async () => {
                    await onRun(
                      () => toggleFavAction({ customerId: customer.customerId, menuId, on: !favs.has(menuId) }),
                      favs.has(menuId) ? "ถอนหมุดแล้ว" : "ปักหมุดแล้ว",
                    );
                    onReload();
                  }}
                  className="text-xs text-muted underline disabled:opacity-50"
                >
                  {favs.has(menuId) ? "★ เลิกปักหมุด" : "☆ ปักหมุด"}
                </button>
              )}
              {/* 🎯 สูตรของแก้วที่เคยสั่ง — เปิดดูได้ทันที ไม่ต้องจำ */}
              {menu && (
                <span className="text-xs text-faint">
                  {menu.recipe.length > 0
                    ? menu.recipe
                        .map((r) => {
                          const it = boot.items.find((i) => i.itemId === r.itemId);
                          return `${it?.name ?? r.itemId} ${r.qty}${it?.unit ?? ""}`;
                        })
                        .join(" · ")
                    : "ยังไม่มีสูตร"}
                  {menu.glass ? ` · แก้ว ${menu.glass}` : ""}
                  {menu.method ? ` · ${menu.method}` : ""}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CustomerModal({
  boot, customerId, busy, onClose, onSave, onDelete,
}: {
  boot: BarBoot;
  customerId: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: Parameters<typeof saveCustomerAction>[0]) => void;
  onDelete: (id: string) => void;
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
          {cur && boot.canConfig && (
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
