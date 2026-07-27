"use client";

import { useState } from "react";
import type { SalesBoot, OrderRow } from "./types";
import { QuotationTab } from "./QuotationTab";
import { OrdersTab } from "./OrdersTab";
import { WarehouseTab } from "./WarehouseTab";
import { SyncHistoryTab } from "./SyncHistoryTab";
import { MenuTab } from "./MenuTab";

type Tab = "create" | "orders" | "warehouse" | "sync" | "manage";

const ALL_TABS: { key: Tab; label: string }[] = [
  { key: "create", label: "＋ สร้างใบเสนอราคา" },
  { key: "orders", label: "📋 จัดการออเดอร์" },
  { key: "warehouse", label: "🏢 คลังจัดส่ง" },
  { key: "sync", label: "🔁 ประวัติเชื่อมระบบ" },
  { key: "manage", label: "⚙️ จัดการข้อมูล" },
];

/** แท็บที่ role เห็น (main=ทั้งหมด, sale=ขาย, warehouse=คลัง, viewer=อ่านออเดอร์) */
function tabsForRole(role: string): Tab[] {
  if (role === "main") return ["create", "orders", "warehouse", "sync", "manage"];
  if (role === "sale") return ["create", "orders", "sync"];
  if (role === "warehouse") return ["warehouse"];
  return ["orders"]; // viewer
}

export function SalesApp({ boot }: { boot: SalesBoot }) {
  const allowed = tabsForRole(boot.role);
  const [tab, setTab] = useState<Tab>(allowed[0]);
  const [editOrder, setEditOrder] = useState<OrderRow | null>(null);
  const canWrite = boot.role === "main" || boot.role === "sale";

  function startEdit(order: OrderRow) {
    setEditOrder(order);
    setTab("create");
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-2xl">🛒</span>
        <h1 className="text-2xl font-bold text-slate-800">ขาย</h1>
        <span className="ml-auto text-sm text-slate-500">
          บทบาท <b>{boot.role}</b>
        </span>
      </div>

      {boot.role === "viewer" && (
        <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">บทบาท viewer — ดูได้อย่างเดียว</div>
      )}

      <div className="mb-5 flex flex-wrap gap-1 border-b border-slate-200">
        {ALL_TABS.filter((t) => allowed.includes(t.key)).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition ${tab === t.key ? "border-b-2 border-amber-600 text-amber-700" : "text-slate-500 hover:text-slate-700"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "create" && (
        <QuotationTab boot={boot} canWrite={canWrite} editOrder={editOrder} onDoneEdit={() => setEditOrder(null)} />
      )}
      {tab === "orders" && <OrdersTab boot={boot} canWrite={canWrite} onEdit={startEdit} />}
      {tab === "warehouse" && <WarehouseTab role={boot.role} />}
      {tab === "sync" && <SyncHistoryTab />}
      {tab === "manage" && <MenuTab />}
    </div>
  );
}
