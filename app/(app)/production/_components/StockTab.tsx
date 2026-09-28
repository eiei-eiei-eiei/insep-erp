"use client";

import { can, capHolderText, type Role } from "@/lib/shared/roles";
import { recomputeStockAction } from "../actions";
import { Card, Msg, useSaver } from "./ui";
import type { StockRow } from "./types";

export function StockTab({ stock, role }: { stock: StockRow[]; role: Role }) {
  const { pending, msg, run } = useSaver();
  // ด่านจริงอยู่ใน recompute_stock_product (0074 · D99) — ตรงนี้แค่ไม่ปล่อยให้กดแล้วค่อยเจอ error
  const mayRepair = can(role, "prod.write");

  return (
    <Card title="สต็อกขวดคงเหลือ (stock_product)">
      <Msg msg={msg} />
      <div className="mb-3">
        <button
          type="button"
          disabled={pending || !mayRepair}
          onClick={() =>
            run(() => recomputeStockAction(), "คำนวณสต็อกใหม่จาก log ทั้งหมดเรียบร้อย")
          }
          className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:bg-raised disabled:opacity-50"
        >
          {pending ? "กำลังคำนวณ…" : "คำนวณสต็อกใหม่ (recompute)"}
        </button>
        {!mayRepair && (
          <p className="mt-2 text-sm text-warn">
            คำนวณสต็อกใหม่ได้เฉพาะ {capHolderText("prod.write")} — บทบาทนี้ดูยอดได้อย่างเดียว
          </p>
        )}
      </div>
      {stock.length === 0 ? (
        <p className="text-sm text-faint">ยังไม่มีข้อมูลสต็อก</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th className="px-3">รหัสสินค้า</th>
                <th className="px-3">ชื่อสุรา</th>
                <th className="px-3 num">คงเหลือ (ขวด)</th>
                <th className="px-3">อัปเดตล่าสุด</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((s) => (
                <tr key={s.product_id}>
                  <td className="px-3 font-medium text-muted">{s.product_id}</td>
                  <td className="px-3">{s.products?.name ?? "—"}</td>
                  <td className="px-3 font-semibold num">{Number(s.balance).toLocaleString()}</td>
                  <td className="px-3 text-faint">
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
