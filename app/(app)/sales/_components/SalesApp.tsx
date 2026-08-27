"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SalesBoot, OrderRow } from "./types";
import { QuotationTab } from "./QuotationTab";
import { OrdersTab } from "./OrdersTab";
import { WarehouseTab } from "./WarehouseTab";
import { SyncHistoryTab } from "./SyncHistoryTab";
import { MenuTab } from "./MenuTab";
import { IconCart } from "@/lib/shared/icons";
import { tabsFor } from "@/lib/shared/tabs";
import { can, toRole } from "@/lib/shared/roles";
import { useTabUrl } from "../../_components/useTabUrl";

type Tab = string;

// ★ แท็บ + สิทธิ์ตาม role ย้ายไปทะเบียนกลาง lib/shared/tabs แล้ว
//   (แถบเมนูด้านบนต้องอ่านชุดเดียวกันไปทำดร็อปดาวน์ ไม่งั้นสองที่จะเพี้ยนกันวันใดวันหนึ่ง)
//   ที่นี่ slug = key เดิม (create/orders/warehouse/sync/manage) จึงไม่ต้องแปลงชื่อ

export function SalesApp({ boot }: { boot: SalesBoot }) {
  const role = toRole(boot.role);
  const allowedTabs = tabsFor("sales", role);
  const allowed = allowedTabs.map((t) => t.slug);
  const sp = useSearchParams();
  const urlTab = sp.get("tab");
  const [tab, setTab] = useState<Tab>(() => (urlTab && allowed.includes(urlTab) ? urlTab : allowed[0]));
  // slug = key อยู่แล้ว · แต่ยังต้องกันแท็บที่ role นี้ไม่มีสิทธิ์ ไม่ให้ยัดผ่าน URL
  useTabUrl("sales", tab, (t) => { if (allowed.includes(t)) setTab(t); }, (k) => (allowed.includes(k) ? k : ""));
  const [editOrder, setEditOrder] = useState<OrderRow | null>(null);
  const canWrite = can(role, "sales.write");

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
        {allowedTabs.map((t) => (
          <button
            key={t.slug}
            onClick={() => setTab(t.slug)}
            className={`shrink-0 whitespace-nowrap rounded-t-lg px-4 py-2 text-sm font-medium transition ${tab === t.slug ? "border-b-2 border-warn-line text-warn" : "text-faint hover:text-ink"}`}
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
