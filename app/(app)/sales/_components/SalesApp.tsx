"use client";

import { useEffect, useState } from "react";
import type { SalesBoot, OrderRow } from "./types";
import { QuotationTab } from "./QuotationTab";
import { OrdersTab } from "./OrdersTab";
import { WarehouseTab } from "./WarehouseTab";
import { SyncHistoryTab } from "./SyncHistoryTab";
import { MenuTab } from "./MenuTab";
import { IconCart } from "@/lib/shared/icons";

type Tab = "create" | "orders" | "warehouse" | "sync" | "manage";

const ALL_TABS: { key: Tab; label: string }[] = [
  { key: "create", label: "＋ สร้างใบเสนอราคา" },
  { key: "orders", label: "จัดการออเดอร์" },
  { key: "warehouse", label: "คลังจัดส่ง" },
  { key: "sync", label: "ประวัติเชื่อมระบบ" },
  { key: "manage", label: "จัดการข้อมูล" },
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

  // mount แท็บครั้งเดียวแล้วคงไว้ (ซ่อนด้วย CSS) → สลับแท็บลื่น ไม่โหลดใหม่
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>([allowed[0]]));
  useEffect(() => { setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab))); }, [tab]);
  const show = (t: Tab) => (tab === t ? "" : "hidden");

  function startEdit(order: OrderRow) {
    setEditOrder(order);
    setTab("create");
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <IconCart size={24} className="text-brand" />
        <h1 className="text-2xl font-bold text-ink">ขาย</h1>
        <span className="ml-auto text-sm text-faint">
          บทบาท <b>{boot.role}</b>
        </span>
      </div>

      {boot.role === "viewer" && (
        <div className="mb-4 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">บทบาท viewer — ดูได้อย่างเดียว</div>
      )}

      <div className="mb-5 -mx-4 flex gap-1 overflow-x-auto border-b border-line px-4">
        {ALL_TABS.filter((t) => allowed.includes(t.key)).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 whitespace-nowrap rounded-t-lg px-4 py-2 text-sm font-medium transition ${tab === t.key ? "border-b-2 border-warn-line text-warn" : "text-faint hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {visited.has("create") && (
        <div className={show("create")}><QuotationTab boot={boot} canWrite={canWrite} editOrder={editOrder} onDoneEdit={() => setEditOrder(null)} /></div>
      )}
      {visited.has("orders") && <div className={show("orders")}><OrdersTab boot={boot} canWrite={canWrite} onEdit={startEdit} active={tab === "orders"} /></div>}
      {visited.has("warehouse") && <div className={show("warehouse")}><WarehouseTab role={boot.role} company={boot.company} active={tab === "warehouse"} /></div>}
      {visited.has("sync") && <div className={show("sync")}><SyncHistoryTab active={tab === "sync"} /></div>}
      {visited.has("manage") && <div className={show("manage")}><MenuTab active={tab === "manage"} /></div>}
    </div>
  );
}
