"use client";

import { useState } from "react";
import { upsertMaster, deleteMaster, type MasterTable } from "../master-actions";
import { Card, Msg, useSaver } from "./ui";
import type { Container, Material, Product } from "./types";

type Field = { key: string; label: string; pk?: boolean; num?: boolean; required?: boolean };

const inputCls = "w-full rounded border border-line px-2 py-1 text-sm";

function buildPayload(fields: Field[], row: Record<string, string>) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = (row[f.key] ?? "").trim();
    out[f.key] = f.num ? (v === "" ? null : Number(v)) : v === "" ? null : v;
  }
  return out;
}

function CrudSection({
  title,
  table,
  fields,
  rows,
}: {
  title: string;
  table: MasterTable;
  fields: Field[];
  rows: Record<string, unknown>[];
}) {
  const pk = fields.find((f) => f.pk)!.key;
  const { pending, msg, run } = useSaver();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editPk, setEditPk] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<Record<string, string>>({});

  function validate(row: Record<string, string>): string | null {
    for (const f of fields) {
      if ((f.pk || f.required) && !(row[f.key] ?? "").trim()) return `กรอก "${f.label}" ก่อน`;
    }
    return null;
  }

  function add() {
    const err = validate(draft);
    if (err) return run(async () => ({ ok: false, error: err }), "");
    run(() => upsertMaster(table, buildPayload(fields, draft)), "เพิ่มแล้ว", () => setDraft({}));
  }
  function save() {
    const err = validate(editRow);
    if (err) return run(async () => ({ ok: false, error: err }), "");
    run(() => upsertMaster(table, buildPayload(fields, editRow)), "บันทึกแล้ว", () => setEditPk(null));
  }
  function startEdit(row: Record<string, unknown>) {
    const r: Record<string, string> = {};
    for (const f of fields) r[f.key] = row[f.key] == null ? "" : String(row[f.key]);
    setEditPk(String(row[pk]));
    setEditRow(r);
  }

  return (
    <Card title={title}>
      <Msg msg={msg} />
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              {fields.map((f) => <th key={f.key}>{f.label}</th>)}
              <th className="num">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {/* แถวเพิ่มใหม่ */}
            <tr className="bg-raised">
              {fields.map((f) => (
                <td key={f.key}>
                  <input
                    className={inputCls}
                    type={f.num ? "number" : "text"}
                    step={f.num ? "any" : undefined}
                    placeholder={f.label}
                    value={draft[f.key] ?? ""}
                    onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  />
                </td>
              ))}
              <td className="num">
                <button disabled={pending} onClick={add} className="rounded bg-brand px-3 py-1 text-on-brand hover:opacity-90 disabled:opacity-50">
                  + เพิ่ม
                </button>
              </td>
            </tr>

            {/* แถวข้อมูล */}
            {rows.map((row) => {
              const id = String(row[pk]);
              const editing = editPk === id;
              return (
                <tr key={id}>
                  {fields.map((f) => (
                    <td key={f.key}>
                      {editing ? (
                        <input
                          className={inputCls}
                          type={f.num ? "number" : "text"}
                          step={f.num ? "any" : undefined}
                          disabled={f.pk}
                          value={editRow[f.key] ?? ""}
                          onChange={(e) => setEditRow({ ...editRow, [f.key]: e.target.value })}
                        />
                      ) : (
                        <span className={f.pk ? "font-medium text-muted" : "text-muted"}>
                          {row[f.key] == null || row[f.key] === "" ? "—" : String(row[f.key])}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="whitespace-nowrap num">
                    {editing ? (
                      <>
                        <button disabled={pending} onClick={save} className="mr-1 rounded border border-ok-line px-2 py-1 text-ok hover:bg-ok-bg">บันทึก</button>
                        <button onClick={() => setEditPk(null)} className="rounded border border-line px-2 py-1 text-faint hover:bg-raised">ยกเลิก</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(row)} className="mr-1 rounded border border-line px-2 py-1 text-muted hover:bg-raised">แก้</button>
                        <button
                          disabled={pending}
                          onClick={() => { if (window.confirm(`ลบ "${id}" ?`)) run(() => deleteMaster(table, id), "ลบแล้ว"); }}
                          className="rounded border border-crit-line px-2 py-1 text-crit hover:bg-crit-bg"
                        >
                          ลบ
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={fields.length + 1} className="py-3 text-center text-faint">ยังไม่มีข้อมูล — เพิ่มในแถวบนสุด</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function MasterTab({
  materials,
  containers,
  products,
}: {
  materials: Material[];
  containers: Container[];
  products: Product[];
}) {
  const [sub, setSub] = useState<"materials" | "containers" | "products">("materials");
  const subTabs: { key: typeof sub; label: string }[] = [
    { key: "materials", label: "วัตถุดิบ" },
    { key: "containers", label: "ภาชนะ" },
    { key: "products", label: "สินค้า (สุรา)" },
  ];

  return (
    <div>
      <div className="mb-4 flex gap-1">
        {subTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setSub(t.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${sub === t.key ? "bg-line text-ink" : "text-faint hover:bg-raised"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub === "materials" && (
        <CrudSection
          title="วัตถุดิบ (materials)"
          table="materials"
          fields={[
            { key: "material_id", label: "รหัส", pk: true },
            { key: "name", label: "ชื่อวัตถุดิบ", required: true },
            { key: "unit", label: "หน่วยนับ" },
          ]}
          rows={materials as unknown as Record<string, unknown>[]}
        />
      )}
      {sub === "containers" && (
        <CrudSection
          title="ภาชนะ (containers)"
          table="containers"
          fields={[
            { key: "container_id", label: "รหัส", pk: true },
            { key: "container_type", label: "ประเภทภาชนะ" },
            { key: "capacity_l", label: "ความจุ (ล.)", num: true },
          ]}
          rows={containers as unknown as Record<string, unknown>[]}
        />
      )}
      {sub === "products" && (
        <CrudSection
          title="สินค้า / สุรา (products)"
          table="products"
          fields={[
            { key: "product_id", label: "รหัส", pk: true },
            { key: "name", label: "ชื่อสุรา", required: true },
            { key: "degree", label: "ดีกรี", num: true },
            { key: "bottle_size_l", label: "ขนาดขวด (ล.)", num: true },
            { key: "liquor_type", label: "ประเภทสุรา" },
            { key: "liquor_kind", label: "ชนิดสุรา" },
          ]}
          rows={products as unknown as Record<string, unknown>[]}
        />
      )}
    </div>
  );
}
