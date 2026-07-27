"use client";

import { recomputeStockAction } from "../actions";
import { Card, Msg, useSaver } from "./ui";
import type { StockRow } from "./types";

export function StockTab({ stock }: { stock: StockRow[] }) {
  const { pending, msg, run } = useSaver();

  return (
    <Card title="สต็อกขวดคงเหลือ (stock_product)">
      <Msg msg={msg} />
      <div className="mb-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(() => recomputeStockAction(), "คำนวณสต็อกใหม่จาก log ทั้งหมดเรียบร้อย")
          }
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
        >
          {pending ? "กำลังคำนวณ…" : "คำนวณสต็อกใหม่ (recompute)"}
        </button>
      </div>
      {stock.length === 0 ? (
        <p className="text-sm text-slate-400">ยังไม่มีข้อมูลสต็อก</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-3 py-2">รหัสสินค้า</th>
                <th className="px-3 py-2">ชื่อสุรา</th>
                <th className="px-3 py-2 text-right">คงเหลือ (ขวด)</th>
                <th className="px-3 py-2">อัปเดตล่าสุด</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((s) => (
                <tr key={s.product_id} className="border-b border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-700">{s.product_id}</td>
                  <td className="px-3 py-2">{s.products?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-semibold">{Number(s.balance).toLocaleString()}</td>
                  <td className="px-3 py-2 text-slate-400">
                    {s.last_updated ? new Date(s.last_updated).toLocaleString("th-TH") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
