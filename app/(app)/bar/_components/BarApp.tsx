"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { BarBoot } from "../data";
import { reloadBarAction } from "../actions";
import { PosTab } from "./PosTab";
import { StockTab } from "./StockTab";
import { MenuTab } from "./MenuTab";
import { HistoryTab } from "./HistoryTab";
import { CustomerTab } from "./CustomerTab";
import { DashboardTab } from "./DashboardTab";
import { BarSettingsTab } from "./BarSettingsTab";
import { tabsFor } from "@/lib/shared/tabs";
import { toRole, ROLE_LABEL } from "@/lib/shared/roles";
import { IconGlass } from "@/lib/shared/icons";
import { useTabUrl } from "../../_components/useTabUrl";

/**
 * เปลือกของโมดูลบาร์ (D96)
 *
 * 🚨 **ต้องเรียก `tabsFor()` ไม่ใช่ map จาก `BAR_TABS` ตรง ๆ**
 *    บั๊ก D85: 3 ใน 4 App ลืมเรียกตัวกรอง → พนักงานเห็นแท็บตั้งค่าที่ไม่ควรเห็น
 *    (`lib/shared/tabs.test.ts` อ่านซอร์สของทุก App มาตรวจข้อนี้)
 */
export function BarApp({ boot }: { boot: BarBoot }) {
  /**
   * 🐛 **เจอตอนเทสในเบราว์เซอร์ 2026-09-12** — เดิมแต่ละแท็บถือ `useState(boot)` ของตัวเอง
   *    และแท็บ **mount ค้างไว้** (ซ่อนด้วย CSS เพื่อให้สลับลื่น) ⇒ แท็บที่ไม่ได้กดปุ่มเอง
   *    จะไม่มีวันรู้ว่าข้อมูลเปลี่ยน
   *    อาการจริง: ขาย Negroni ในแท็บ **ขาย** → สต็อกใน DB ลดถูกต้อง (2,100 → 2,070)
   *    แต่แท็บ **สต็อก** ยังโชว์ 2,100 ทั้งคืน
   *    🚨 นี่คือ "หน้าจอโกหก" — เจ้าของบาร์จะสรุปว่าระบบไม่ตัดสต็อก หรือสั่งของเกินเพราะดูเลขผิด
   *    (ตอนเทส ผมเองยังเกือบสรุปว่าเป็นบั๊กของ RPC ทั้งที่ DB ถูกมาตลอด)
   *
   * ⇒ **ความจริงมีชุดเดียว อยู่ที่นี่** · ทุกแท็บรับ `boot` กับ `onReload` เป็น prop
   *   🪤 อย่า "แก้" ด้วยการให้แต่ละแท็บ reload ตัวเองตอนถูกเปิด — จะยิง RPC ซ้ำทุกครั้งที่สลับแท็บ
   *      และยังแก้ไม่ตรงจุด (ปัญหาคือมีสำเนาหลายชุด ไม่ใช่จังหวะโหลด)
   */
  const [data, setData] = useState(boot);
  const reload = useCallback(async () => {
    setData(await reloadBarAction());
  }, []);

  const role = toRole(boot.role);
  const allowedTabs = tabsFor("bar", role);
  const allowed = allowedTabs.map((t) => t.slug);
  const sp = useSearchParams();
  const urlTab = sp.get("tab");
  const [tab, setTab] = useState<string>(() =>
    urlTab && allowed.includes(urlTab) ? urlTab : (allowed[0] ?? "pos"),
  );
  useTabUrl(
    "bar",
    tab,
    (t) => {
      if (allowed.includes(t)) setTab(t);
    },
    (k) => (allowed.includes(k) ? k : ""),
  );

  const [visited, setVisited] = useState<Set<string>>(() => new Set<string>([tab]));
  useEffect(() => setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab))), [tab]);
  const show = (t: string) => (tab === t ? "" : "hidden");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* 🐛 D96 — เดิมเป็นอิโมจิ 🍸 ทั้งที่ D43 เลิกใช้อิโมจิทั้งแอปไปแล้ว
            (อิโมจิเปลี่ยนหน้าตาตาม OS · ปรับสีตาม token ไม่ได้ · ดู "ทำเล่น" ตอนเดโมขาย) */}
        <IconGlass size={24} className="text-brand" />
        <h1 className="text-2xl font-bold text-ink">บาร์</h1>
        <span className="ml-auto text-sm text-faint">
          บทบาท <b>{ROLE_LABEL[role]}</b>
        </span>
      </div>

      {/* ★ ยังไม่ได้ตั้งกิจการ = ทำอะไรไม่ได้เลย · ต้องบอกตรง ๆ ว่าไปกดที่ไหน (D83)
          🚨 จงใจไม่เดาเป็นกิจการหลัก — เดาผิดแล้วยอดขายทั้งคืนไปลงบัญชีโรงกลั่น */}
      {!data.entityId && (
        <div className="mb-4 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">
          ยังไม่ได้ตั้ง <b>กิจการของบาร์</b> — ระบบจะไม่เดาให้ เพราะรายได้บาร์เป็นของอีกกิจการหนึ่ง
          {data.canConfig ? (
            <>
              {" "}
              ไปตั้งที่แท็บ <b>ตั้งค่าบาร์</b> ก่อน
            </>
          ) : (
            <> ให้เจ้าของกิจการตั้งที่แท็บ ตั้งค่าบาร์ ก่อน</>
          )}
        </div>
      )}

      {allowedTabs.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {allowedTabs.map((t) => (
            <button
              key={t.slug}
              type="button"
              onClick={() => setTab(t.slug)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                tab === t.slug ? "bg-brand text-on-brand" : "bg-raised text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {allowed.includes("pos") && visited.has("pos") && (
        <div className={show("pos")}>
          <PosTab boot={data} onReload={reload} />
        </div>
      )}
      {allowed.includes("stock") && visited.has("stock") && (
        <div className={show("stock")}>
          <StockTab boot={data} onReload={reload} />
        </div>
      )}
      {allowed.includes("menu") && visited.has("menu") && (
        <div className={show("menu")}>
          <MenuTab boot={data} onReload={reload} />
        </div>
      )}
      {allowed.includes("history") && visited.has("history") && (
        <div className={show("history")}>
          <HistoryTab boot={data} onReload={reload} />
        </div>
      )}
      {allowed.includes("customer") && visited.has("customer") && (
        <div className={show("customer")}>
          <CustomerTab boot={data} onReload={reload} />
        </div>
      )}
      {allowed.includes("dashboard") && visited.has("dashboard") && (
        <div className={show("dashboard")}>
          <DashboardTab boot={data} onReload={reload} />
        </div>
      )}
      {allowed.includes("settings") && visited.has("settings") && (
        <div className={show("settings")}>
          <BarSettingsTab boot={data} onReload={reload} />
        </div>
      )}
    </div>
  );
}
