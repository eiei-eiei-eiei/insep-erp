"use client";

import { useEffect, useRef, useState } from "react";
import { Card, Msg, NumBox, NumInput, Select, TextInput, useSaver, fmt } from "./ui";
import { getSaleMenuAction, getMenuLinkOptionsAction, saveSaleMenuAction, deleteSaleMenuAction } from "../actions";
import type { SaleMenuRow } from "../data";

type LinkOpts = { products: { id: string; name: string }[]; warehouse: { id: string; name: string }[] };
const EMPTY = { id: 0, menuName: "", price: 0, category: "สุรา", productId: "", multiplier: 1 };

export function MenuTab({ active }: { active: boolean }) {
  const [rows, setRows] = useState<SaleMenuRow[]>([]);
  const [opts, setOpts] = useState<LinkOpts>({ products: [], warehouse: [] });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ id: number; menuName: string; price: number; category: string; productId: string; multiplier: number }>({ ...EMPTY });
  const { pending, msg, run, setMsg } = useSaver();
  const firstLoad = useRef(true);

  function refresh() {
    if (firstLoad.current) setLoading(true);
    Promise.all([getSaleMenuAction(), getMenuLinkOptionsAction()]).then(([m, o]) => {
      setRows(m);
      setOpts(o as LinkOpts);
      setLoading(false);
      firstLoad.current = false;
    });
  }
  useEffect(() => {
    if (active) refresh();
  }, [active]);

  function edit(r: SaleMenuRow) {
    setMsg(null);
    setForm({ id: r.id, menuName: r.menuName, price: r.price, category: r.category || "สุรา", productId: r.productId, multiplier: r.multiplier });
  }
  function reset() {
    setForm({ ...EMPTY });
  }
  function save() {
    if (!form.menuName.trim()) return setMsg({ ok: false, text: "กรอกชื่อเมนู" });
    run(() => saveSaleMenuAction(form), form.id ? "แก้ไขเมนูแล้ว" : "เพิ่มเมนูแล้ว", () => {
      reset();
      refresh();
    });
  }
  function del(r: SaleMenuRow) {
    if (!confirm(`ลบเมนู "${r.menuName}"?`)) return;
    run(() => deleteSaleMenuAction(r.id), "ลบเมนูแล้ว", () => {
      if (form.id === r.id) reset();
      refresh();
    });
  }

  const linkList = form.category === "สุรา" ? opts.products : opts.warehouse;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card title="เมนูขาย (sale_menu)">
        {loading ? (
          <div className="py-8 text-center text-faint">กำลังโหลด…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl min-w-[560px]">
              <thead>
                <tr>
                  <th>ชื่อเมนู</th>
                  <th className="num">ราคา</th>
                  <th>ประเภท</th>
                  <th>เชื่อมสินค้า</th>
                  <th className="text-center">×หน่วย</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b hover:bg-raised">
                    <td className="font-medium text-ink">{r.menuName}</td>
                    <td className="num">฿{fmt(r.price)}</td>
                    <td>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${r.category === "สุรา" ? "bg-warn-bg text-warn" : "bg-raised text-muted"}`}>{r.category || "-"}</span>
                    </td>
                    <td className="font-mono text-xs text-faint">{r.productId || "-"}</td>
                    <td className="text-center">{r.multiplier}</td>
                    <td className="num">
                      <button onClick={() => edit(r)} className="mr-1 rounded border border-line px-2 py-1 text-xs hover:bg-raised">
                        แก้ไข
                      </button>
                      <button onClick={() => del(r)} className="rounded border border-crit-line px-2 py-1 text-xs text-crit hover:bg-crit-bg">
                        ลบ
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-faint">
                      ยังไม่มีเมนู
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={form.id ? "แก้ไขเมนู" : "เพิ่มเมนูใหม่"}>
        <Msg msg={msg} />
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-muted">ชื่อเมนู *</span>
            <TextInput value={form.menuName} onChange={(e) => setForm({ ...form, menuName: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-muted">ราคาขายต่อหน่วย (รวม VAT แล้ว)</span>
            <NumBox value={form.price} blankZero onChange={(v) => setForm({ ...form, price: v === "" ? 0 : v })} />
            <span className="mt-1 block text-xs text-faint">ใส่ราคาที่ลูกค้าจ่ายจริง เช่น 210 → ระบบถอด VAT ให้เอง (196.26 + 13.74)</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-muted">ประเภท</span>
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="สุรา">สุรา (ตัดสต็อกผลิต)</option>
              <option value="ทั่วไป">ทั่วไป (ตัดสต็อกคลัง)</option>
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-muted">เชื่อมรหัสสินค้า {form.category === "สุรา" ? "(products)" : "(warehouse_stock)"}</span>
            <input
              list="menu-link-list"
              value={form.productId}
              onChange={(e) => setForm({ ...form, productId: e.target.value })}
              placeholder="เลือกหรือพิมพ์รหัส"
              className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-brand"
            />
            <datalist id="menu-link-list">
              {linkList.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="mb-1 block text-muted">หน่วยย่อยต่อหน่วยขาย (× multiplier)</span>
            <NumInput value={form.multiplier} onChange={(e) => setForm({ ...form, multiplier: Number(e.target.value) || 1 })} />
            <span className="mt-1 block text-xs text-faint">เช่น ขาย &quot;ลัง&quot; = 12 ขวด → ใส่ 12 (สต็อกเก็บเป็นขวด)</span>
          </label>
          <div className="flex gap-2 pt-1">
            <button onClick={save} disabled={pending} className="flex-1 rounded-lg bg-brand py-2 font-bold text-on-brand hover:opacity-90 disabled:opacity-50">
              {pending ? "…" : form.id ? "บันทึกการแก้ไข" : "เพิ่มเมนู"}
            </button>
            {form.id > 0 && (
              <button onClick={reset} className="rounded-lg border border-line px-3 py-2 text-muted hover:bg-raised">
                ยกเลิก
              </button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
