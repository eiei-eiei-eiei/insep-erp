"use client";

/**
 * หน้าตั้งค่าแบบ ก — เมนูข้าง + รายการเป็นแถว (D173 เฟส 4a · ผู้ใช้เลือกจากตัวอย่าง 3 แบบ)
 * กติกา 6 ข้ออยู่ที่ `docs/DESIGN_SYSTEM.md` หัวข้อ "หน้าตั้งค่า"
 *
 *   <SettingsShell sections={[{ key, label, count, body }]} />   ← เมนูข้าง (จอเล็ก = ดร็อปดาวน์)
 *   <SettingsCard title help count action>…</SettingsCard>       ← หัวการ์ด: ชื่อ + ⓘ + จำนวนชิดขวา
 *   <ListRow title sub meta actions />                           ← 1 รายการ = 1 แถว
 *   <SettingsList …/>                                            ← รายการข้อความล้วน (หมวดหมู่ · อัตรา)
 *
 * ★ ทุกหัวข้อ mount ค้าง (ซ่อนด้วย `hidden`) — สลับหัวข้อแล้วของที่พิมพ์ค้างไม่หาย
 *   (แพตเทิร์นเดียวกับแท็บของทุก workspace)
 * 🚨 ตรรกะบันทึก/ลบอยู่ที่ผู้เรียก — ไฟล์นี้เป็นหน้าตาล้วน ห้ามเรียก action จากที่นี่
 */

import { useEffect, useRef, useState } from "react";
import { Help } from "./help";
import { IconPlus, IconTrash } from "./icons";
import { addError, countText, sectionOf, type SettingsSection } from "./settingsList";

const inputCls =
  "w-full rounded border border-line bg-input px-3 py-2 text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-soft";

// ── เมนูข้าง ─────────────────────────────────────────────────────────────────
export type ShellSection = SettingsSection & { body: React.ReactNode };

export function SettingsShell({
  sections,
  param = "sec",
  intro,
}: {
  sections: ShellSection[];
  /** ชื่อ query string ที่จำหัวข้อไว้ (รีเฟรชแล้วอยู่หัวข้อเดิม · ก๊อปลิงก์ส่งกันได้) */
  param?: string;
  /** แถบบอกทางเหนือเนื้อหา (ถ้ามี) */
  intro?: React.ReactNode;
}) {
  const keys = sections.map((s) => s.key);
  const [active, setActive] = useState(keys[0] ?? "");

  // อ่านหัวข้อจาก URL หลัง mount (อ่านตอน render = server กับ client ได้ค่าไม่ตรงกัน)
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get(param);
    setActive((cur) => sectionOf(keys, want ?? cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.join("|"), param]);

  function go(key: string) {
    setActive(key);
    const u = new URL(window.location.href);
    u.searchParams.set(param, key);
    window.history.replaceState(null, "", u);
  }

  const cur = sectionOf(keys, active);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[13rem_minmax(0,1fr)] md:items-start">
      {/* จอเล็ก: ดร็อปดาวน์ (ห้ามเป็นแถบเลื่อนแนวนอน — กติกาข้อ 1) */}
      <div className="md:hidden">
        <select
          aria-label="หัวข้อตั้งค่า"
          value={cur}
          onChange={(e) => go(e.target.value)}
          className={`${inputCls} font-medium`}
        >
          {sections.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}{s.count != null ? ` (${s.count})` : ""}
            </option>
          ))}
        </select>
      </div>

      <nav aria-label="หัวข้อตั้งค่า" className="hidden rounded-lg border border-line bg-card p-1.5 md:sticky md:top-4 md:block">
        {sections.map((s) => {
          const on = s.key === cur;
          return (
            <button
              key={s.key}
              type="button"
              aria-current={on ? "page" : undefined}
              onClick={() => go(s.key)}
              className={`flex w-full items-center justify-between gap-2 rounded px-3 py-2 text-left text-sm transition ${
                on ? "bg-brand-soft font-medium text-brand" : "text-muted hover:bg-raised hover:text-ink"
              }`}
            >
              <span className="min-w-0 truncate">{s.label}</span>
              {s.count != null && <span className={`tnum shrink-0 text-xs ${on ? "text-brand" : "text-faint"}`}>{s.count}</span>}
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 space-y-4">
        {intro}
        {sections.map((s) => (
          <div key={s.key} className={s.key === cur ? "" : "hidden"}>
            {s.body}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── การ์ด ────────────────────────────────────────────────────────────────────
export function SettingsCard({
  title,
  help,
  count,
  unit,
  action,
  children,
}: {
  title: string;
  help?: React.ReactNode;
  /** จำนวนรายการชิดขวา — ไม่ส่ง/null = ไม่แสดง */
  count?: number | null;
  unit?: string;
  /** ปุ่มหลักของการ์ด (เช่น + เพิ่ม) อยู่ขวาสุดของหัวการ์ด */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const c = countText(count, unit);
  return (
    <section className="rounded-lg border border-line bg-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3 sm:px-5">
        <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold text-ink">
          <span className="min-w-0">{title}</span>
          {help && <Help>{help}</Help>}
        </h2>
        <div className="ml-auto flex items-center gap-3">
          {c && <span className="tnum text-xs text-faint">{c}</span>}
          {action}
        </div>
      </header>
      <div className="px-4 py-2 sm:px-5">{children}</div>
    </section>
  );
}

// ── แถว ──────────────────────────────────────────────────────────────────────
/**
 * 1 รายการ = 1 แถว: ชื่อ (+บรรทัดรอง) ชิดซ้าย · ตัวเลข/ป้าย กลางขวา · ปุ่มชิดขวา
 * จอแคบ: ปุ่มยังอยู่บรรทัดเดียวกับชื่อ · `meta` ตกลงไปใต้ชื่อ
 */
export function ListRow({
  title,
  sub,
  meta,
  actions,
  dim,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  /** จางทั้งแถว (เช่น ปิดใช้อยู่) */
  dim?: boolean;
}) {
  return (
    <div className={`flex min-h-12 items-center gap-3 border-b border-line-soft py-2 last:border-b-0 ${dim ? "opacity-60" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink [overflow-wrap:anywhere]">{title}</div>
        {sub && <div className="mt-0.5 text-xs text-muted [overflow-wrap:anywhere]">{sub}</div>}
        {meta && <div className="mt-1 text-sm sm:hidden">{meta}</div>}
      </div>
      {meta && <div className="hidden shrink-0 text-right text-sm sm:block">{meta}</div>}
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

/** หน้าจอว่างของรายการ — `warn` = ข้อความที่ต้องสะดุดตา (เช่น ยังไม่ได้ตั้ง ระบบใช้ค่าปริยาย) */
export function ListEmpty({ children = "— ยังไม่มีรายการ —", warn }: { children?: React.ReactNode; warn?: boolean }) {
  return <p className={`py-3 text-sm ${warn ? "text-warn" : "text-faint"}`}>{children}</p>;
}

// ── รายการข้อความล้วน ────────────────────────────────────────────────────────
/**
 * รายการค่าตั้งที่เป็นข้อความ (หมวดหมู่ · อัตรา) — แถวสุดท้ายเป็นช่องเพิ่ม
 * · Enter = เพิ่ม แล้วเคอร์เซอร์อยู่ช่องเดิมพร้อมพิมพ์ต่อ (กติกาข้อ 4)
 * · ซ้ำ/ว่าง = บอกใต้ช่อง ไม่ส่งไป server
 * ★ ไม่มี "แก้ชื่อ" โดยตั้งใจ: บิลอ้างหมวดด้วย **ชื่อ** — เปลี่ยนชื่อในลิสต์อย่างเดียว บิลเก่าไม่ตาม
 *   = หมวดเดียวแตกเป็นสองชื่อในรายงาน · จะแก้ชื่อได้ต้องมี RPC ที่ตามไปแก้บิลด้วย (แบบบัญชีเงิน D125)
 */
export function SettingsList({
  title,
  help,
  items,
  onAdd,
  onDelete,
  pending,
  placeholder = "พิมพ์แล้วกด Enter เพื่อเพิ่ม",
  emptyHint,
  note,
  suffix,
}: {
  title: string;
  help?: React.ReactNode;
  items: string[];
  onAdd: (value: string) => void;
  onDelete: (value: string) => void;
  pending?: boolean;
  placeholder?: string;
  /** ข้อความตอนยังไม่มีรายการ ที่ต้องเห็น (ขึ้นสีเหลือง) — เช่น ระบบใช้ค่าปริยายอะไรให้อยู่ */
  emptyHint?: string;
  /** คำเตือนที่ต้องอยู่บนจอ (เงิน/ภาษี) — คำอธิบายทั่วไปให้ใส่ `help` */
  note?: React.ReactNode;
  /** หน่วยต่อท้ายชื่อในแถว (เช่น "%") */
  suffix?: string;
}) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const prevLen = useRef(items.length);

  // เพิ่มสำเร็จ (รายการยาวขึ้น) → ล้างช่อง แล้วพร้อมพิมพ์ต่อ · ไม่สำเร็จ = ค่าที่พิมพ์ยังอยู่
  useEffect(() => {
    if (items.length > prevLen.current) {
      setVal("");
      ref.current?.focus();
    }
    prevLen.current = items.length;
  }, [items.length]);

  function add() {
    if (pending) return;
    const e = addError(items, val);
    setErr(e);
    if (e) return;
    onAdd(val.trim());
  }

  return (
    <SettingsCard title={title} help={help} count={items.length}>
      {items.length === 0 && <ListEmpty warn={!!emptyHint}>{emptyHint}</ListEmpty>}
      {items.map((v) => (
        <ListRow
          key={v}
          title={<>{v}{suffix}</>}
          actions={
            <button
              type="button"
              disabled={pending}
              onClick={() => onDelete(v)}
              aria-label={`ลบ ${v}`}
              title={`ลบ ${v}`}
              className="grid h-8 w-8 place-items-center rounded text-crit transition hover:bg-crit-bg disabled:opacity-40"
            >
              <IconTrash size={16} />
            </button>
          }
        />
      ))}
      <div className="flex items-center gap-2 py-2">
        <IconPlus size={16} className="shrink-0 text-faint" />
        <input
          ref={ref}
          value={val}
          onChange={(e) => { setVal(e.target.value); if (err) setErr(null); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); add(); }
          }}
          placeholder={placeholder}
          aria-label={`เพิ่ม${title}`}
          className={inputCls}
        />
        <button
          type="button"
          onClick={add}
          disabled={pending || !val.trim()}
          className="shrink-0 rounded border border-line px-3 py-2 text-sm text-ink transition hover:bg-raised disabled:opacity-50"
        >
          เพิ่ม
        </button>
      </div>
      {err && <p className="pb-2 text-xs text-warn">{err}</p>}
      {note && <div className="border-t border-line-soft py-2 text-xs text-muted">{note}</div>}
    </SettingsCard>
  );
}
