"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import {
  Badge, Card, EscToClose, Field, Msg, NumBox, RowBtn, SaveButton, Select, TextInput, useConfirm, useSaver,
} from "@/lib/shared/ui";
import {
  DOC_GROUPS, DOC_TYPE_INFO, DATE_FMTS, DATE_FMT_LABEL, ERAS, ERA_LABEL, RESETS, RESET_LABEL, SEPS, SEP_LABEL, PREFIX_RE,
  allowedResets, fitReset, toCfg,
  type DocNumberCfg, type DocNumberingRow, type DocNumberPreview, type DocType,
} from "@/lib/shared/docNumbering";
import { previewDocNumberAction, resetDocNumberAction, saveDocNumberAction } from "../actions";

/**
 * ตั้งค่า → เลขเอกสาร (D100)
 *
 * ★ "ใบถัดไปจะเป็น …" ทุกบรรทัดบนหน้านี้มาจาก RPC ที่เรียก **ตัวจัดรูปเลขตัวเดียวกับตอนออกเลขจริง**
 *   (`fn_doc_no_format`) — ไม่มีการจำลองฝั่ง TS · เห็นอย่างไรได้อย่างนั้น
 * 🪤 ห้ามประกาศคอมโพเนนต์ข้างในคอมโพเนนต์ (D71) — ทุกตัวในไฟล์นี้อยู่ระดับบนสุด
 */
export function DocNumberingCard({
  rows,
  entities,
  barEntityId,
  modules,
}: {
  rows: DocNumberingRow[];
  entities: { entity_id: string; name: string }[];
  barEntityId: string;
  modules: string[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<DocNumberingRow | null>(null);
  const entityName = (id: string | null) => entities.find((e) => e.entity_id === id)?.name ?? id ?? "—";

  // ★ แสดงเฉพาะกลุ่มที่ลูกค้าซื้อโมดูล · 50ทวิ อยู่ทั้งบัญชีและเงินเดือน (ชุดเลขเดียวกัน D69)
  const bought = (t: DocType) => DOC_TYPE_INFO[t].modules.some((m) => modules.includes(m));
  const groups = DOC_GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => g.types.includes(r.doc_type) && bought(r.doc_type)) }))
    .filter((g) => g.rows.length > 0);
  // กิจการมีผลกับเอกสารที่แยกกิจการเท่านั้น (บาร์ · 50ทวิ) — ขาย/ผลิต RPC ตัดสินกิจการให้เอง
  const needsEntity = groups.some((g) => g.perEntity);

  return (
    <div className="space-y-4">
      <Card title="รูปแบบเลขเอกสาร">
        <p className="mb-2 text-sm text-muted">
          กำหนดเองได้ว่าเลขเอกสารขึ้นต้นด้วยอะไร มีวันที่แบบไหน และเริ่มนับใหม่เมื่อไร
          · ยังไม่ได้ตั้ง = ใช้รูปแบบเดิมของระบบ
        </p>
        <p className="text-xs text-faint">
          เลขใหม่มากกว่าเลขล่าสุดที่ออกไปแล้วเสมอ — ไม่ซ้ำ ไม่ย้อนลำดับ ไม่เอาเลขที่ถูกลบกลับมาใช้
          · เอกสารที่ออกไปแล้วยังใช้เลขเดิม ไม่ถูกแก้ย้อนหลัง
        </p>
        {needsEntity && entities.length > 1 && (
          <div className="mt-3 max-w-xs">
            <Field label="กิจการ (ใช้กับเลขบาร์และ 50 ทวิ)">
              <Select
                value={barEntityId}
                onChange={(e) => router.push(`/settings/numbering?entity=${encodeURIComponent(e.target.value)}` as Route)}
              >
                {entities.map((e) => (
                  <option key={e.entity_id} value={e.entity_id}>
                    {e.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </Card>

      {groups.length === 0 && (
        <Card>
          <p className="text-sm text-muted">แพ็กเกจนี้ยังไม่มีเอกสารที่ตั้งรูปแบบเลขได้</p>
        </Card>
      )}

      {groups.map((g) => (
        <Card key={g.title} title={g.title}>
          {g.note && <p className="mb-3 text-xs text-faint">{g.note.replace("{กิจการ}", entityName(g.rows[0].entity_id))}</p>}
          <DocRows rows={g.rows} onEdit={setEditing} />
        </Card>
      ))}

      {editing && (
        <DocNumberEditor
          key={editing.doc_type + (editing.entity_id ?? "")}
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function DocRows({ rows, onEdit }: { rows: DocNumberingRow[]; onEdit: (r: DocNumberingRow) => void }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => {
        const info = DOC_TYPE_INFO[r.doc_type];
        return (
          <li key={r.doc_type} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
            <div className="min-w-[12rem] flex-1">
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                {info?.label ?? r.doc_type}
                {r.cfg.configured ? <Badge tone="brand">ตั้งเอง</Badge> : <Badge>รูปแบบเดิม</Badge>}
              </div>
              {info?.hint && <div className="text-xs text-faint">{info.hint}</div>}
            </div>
            <div className="text-sm text-muted">
              ใบถัดไป <span className="tnum font-mono font-semibold text-ink">{r.next_no}</span>
              <span className="ml-2 text-xs text-faint">· เริ่มนับใหม่{RESET_LABEL[toCfg(r.cfg).reset]}</span>
            </div>
            <RowBtn tone="brand" onClick={() => onEdit(r)}>
              แก้รูปแบบ
            </RowBtn>
          </li>
        );
      })}
    </ul>
  );
}

function DocNumberEditor({
  row,
  onClose,
  onSaved,
}: {
  row: DocNumberingRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const saved = toCfg(row.cfg);
  const [cfg, setCfg] = useState<DocNumberCfg>(saved);
  const [next, setNext] = useState<number | "">("");
  const [pv, setPv] = useState<DocNumberPreview | null>(null);
  const seq = useRef(0);
  const { pending, msg, run } = useSaver();
  const { confirmNode, ask } = useConfirm();
  const info = DOC_TYPE_INFO[row.doc_type as DocType];

  const noDate = cfg.date_fmt === "none";
  const okResets = allowedResets(cfg.date_fmt);
  const prefixBad = !PREFIX_RE.test(cfg.prefix);
  const nextBad = next !== "" && (!Number.isInteger(next) || next < 1);
  const formatChanged = JSON.stringify(cfg) !== JSON.stringify(saved);
  const changed = formatChanged || next !== "";

  // พรีวิวสดจาก RPC (หน่วง 300ms) · ★ ทิ้งผลที่มาช้ากว่าคำขอล่าสุด
  useEffect(() => {
    if (prefixBad || nextBad) return;
    const my = ++seq.current;
    const t = setTimeout(async () => {
      const r = await previewDocNumberAction({
        docType: row.doc_type,
        entityId: row.entity_id,
        cfg,
        next: next === "" ? null : next,
      }).catch(() => ({ ok: false as const, error: "ดูตัวอย่างไม่สำเร็จ — ลองใหม่อีกครั้ง" }));
      if (my === seq.current) setPv(r);
    }, 300);
    return () => clearTimeout(t);
  }, [cfg, next, prefixBad, nextBad, row.doc_type, row.entity_id]);

  const set = <K extends keyof DocNumberCfg>(k: K, v: DocNumberCfg[K]) => setCfg((p) => fitReset({ ...p, [k]: v }));

  const taken = pv?.ok === true && pv.taken;
  const blockReason = prefixBad
    ? "ตัวอักษรนำหน้าใช้ได้เฉพาะ ก-ฮ A-Z 0-9 และ . _ / - ไม่เกิน 12 ตัว (ห้ามเว้นวรรค)"
    : nextBad
      ? "เลขถัดไปต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป"
      : pv && !pv.ok
        ? pv.error
        : taken
          ? next !== "" && pv.last_n != null && next <= pv.last_n
            ? `เลขถัดไปต้องมากกว่า ${pv.last_n.toLocaleString()} ซึ่งเป็นเลขล่าสุดที่ใช้หรือข้ามไปแล้วในรอบนี้ — ออกเลขย้อนลำดับไม่ได้`
            : `เลข ${pv.next_no} ถูกใช้ไปแล้ว — ใส่เลขที่มากกว่านี้ หรือเว้นช่องว่างให้ระบบหาเอง`
          : "";

  function save() {
    run(
      () => saveDocNumberAction({ docType: row.doc_type, entityId: row.entity_id, cfg, next: next === "" ? null : next }),
      "บันทึกรูปแบบเลขแล้ว",
      onSaved,
    );
  }

  async function reset() {
    const ok = await ask({
      title: "กลับไปใช้รูปแบบเดิมของระบบ?",
      detail: `${info?.label ?? row.doc_type} จะกลับไปใช้รูปแบบเดิม · เอกสารที่ออกไปแล้วไม่ถูกแก้ และระบบยังข้ามเลขที่ใช้แล้วให้เสมอ`,
      confirmText: "กลับไปใช้รูปแบบเดิม",
    });
    if (!ok) return;
    run(() => resetDocNumberAction({ docType: row.doc_type, entityId: row.entity_id }), "กลับไปใช้รูปแบบเดิมแล้ว", onSaved);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !pending) onClose(); }}
    >
      <EscToClose onClose={() => { if (!pending) onClose(); }} />
      {confirmNode}
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-card p-5 shadow-xl">
        <div className="mb-1 text-lg font-bold text-ink">{info?.label ?? row.doc_type}</div>
        <p className="mb-4 text-xs text-faint">ตอนนี้ใบถัดไปคือ {row.next_no}</p>

        <div className="mb-4 rounded-lg border border-line bg-raised px-3 py-3">
          <div className="text-xs text-muted">ใบถัดไปจะเป็น</div>
          <div className="tnum font-mono text-xl font-bold text-ink">
            {pv?.ok ? pv.next_no : pv ? "—" : "…"}
          </div>
          {pv?.ok && !!pv.last_n && (
            <div className="mt-1 text-xs text-muted">เลขใหม่จะต่อจาก {pv.last_n.toLocaleString()} เสมอ (เลขล่าสุดที่ใช้หรือข้ามไปแล้วในรอบนี้)</div>
          )}
          {pv?.ok && pv.skipped > 0 && (
            <div className="mt-1 text-xs text-muted">ข้ามเลขที่มีเอกสารใช้แล้ว {pv.skipped.toLocaleString()} เลข</div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="ตัวอักษรนำหน้า">
            <TextInput value={cfg.prefix} maxLength={12} onChange={(e) => set("prefix", e.target.value.trim())} />
          </Field>
          <Field label="ส่วนวันที่ในเลข">
            <Select value={cfg.date_fmt} onChange={(e) => set("date_fmt", e.target.value as DocNumberCfg["date_fmt"])}>
              {DATE_FMTS.map((d) => (
                <option key={d} value={d}>{DATE_FMT_LABEL[d]}</option>
              ))}
            </Select>
          </Field>
          <Field label="ปี">
            <Select value={cfg.era} disabled={noDate} onChange={(e) => set("era", e.target.value as DocNumberCfg["era"])}>
              {ERAS.map((x) => (
                <option key={x} value={x}>{ERA_LABEL[x]}</option>
              ))}
            </Select>
          </Field>
          <Field label="ตำแหน่งเลขรัน">
            <Select
              value={cfg.num_first ? "first" : "last"}
              disabled={noDate}
              onChange={(e) => set("num_first", e.target.value === "first")}
            >
              <option value="last">อยู่หลังวันที่</option>
              <option value="first">อยู่หน้าวันที่</option>
            </Select>
          </Field>
          <Field label="ตัวคั่นระหว่างวันที่กับเลขรัน">
            <Select value={cfg.sep} disabled={noDate} onChange={(e) => set("sep", e.target.value as DocNumberCfg["sep"])}>
              {SEPS.map((s) => (
                <option key={s || "none"} value={s}>{SEP_LABEL[s]}</option>
              ))}
            </Select>
          </Field>
          <Field label="จำนวนหลักของเลขรัน (1–10)">
            <NumBox value={cfg.digits} onChange={(v) => set("digits", v === "" ? 1 : Math.min(10, Math.max(1, Math.trunc(v))))} />
          </Field>
          <Field label="เริ่มนับใหม่">
            <Select value={cfg.reset} onChange={(e) => set("reset", e.target.value as DocNumberCfg["reset"])}>
              {RESETS.map((r) => (
                <option key={r} value={r} disabled={!okResets.includes(r)}>
                  {RESET_LABEL[r]}
                  {okResets.includes(r) ? "" : " — ต้องมีวันที่ละเอียดพอในเลข"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="เลขถัดไปของรอบนี้ (ว่าง = ให้ระบบหาเอง)">
            <NumBox value={next} blankZero placeholder={pv?.ok ? String(pv.next_n) : ""} onChange={setNext} />
          </Field>
        </div>

        {formatChanged && (
          <p className="mt-3 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-xs text-warn">
            เอกสารที่ออกไปแล้วยังใช้เลขเดิม — ถ้าเปลี่ยนกลางปี ปีนี้จะมีเลข 2 รูปแบบปนกันในสมุดเอกสาร
          </p>
        )}
        {blockReason && <p className="mt-3 text-sm text-crit">{blockReason}</p>}

        <div className="mt-4">
          <Msg msg={msg} />
          <div className="flex flex-wrap items-center gap-2">
            <SaveButton pending={pending} disabled={!changed || !!blockReason || !pv?.ok} onClick={save}>
              บันทึก
            </SaveButton>
            {row.cfg.configured && (
              <RowBtn disabled={pending} onClick={reset}>
                กลับไปใช้รูปแบบเดิม
              </RowBtn>
            )}
            <RowBtn disabled={pending} onClick={onClose}>
              ยกเลิก
            </RowBtn>
          </div>
          {!changed && <p className="mt-1 text-xs text-faint">ยังไม่ได้เปลี่ยนอะไร</p>}
        </div>
      </div>
    </div>
  );
}
