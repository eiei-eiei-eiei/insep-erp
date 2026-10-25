"use client";

import { useEffect, useState } from "react";
import type { BarBoot } from "../data";
import {
  summarize, byChannel, topMenus, inRange, lapsedCustomers,
  type SaleRow, type SaleItemRow, type Summary,
} from "@/lib/bar/dashboard";
import {
  dailyRows, presetRange, matchPreset, previousRange, changePct, sortTopMenus, postConfirmText,
  RANGE_LABEL, TOP_SORT_LABEL, type RangeKey, type TopSort, type DayRow,
} from "@/lib/bar/dashDays";
import { businessDate } from "@/lib/bar/businessDate";
import { Card, Msg, TextInput, Field, Badge, Empty, fmt, useSaver, useConfirm } from "@/lib/shared/ui";
import { dashboardAction, postDayAction, unpostDayAction } from "../actions";
import { labSummary, labDashboardText, labCategories, type LabUse } from "@/lib/bar/lab";
import { unpostedText, unpostedTotal } from "@/lib/bar/posting";
import { CASH_METHOD, accountForMethod } from "@/lib/bar/payMethods";
import { customerLabel } from "@/lib/bar/customerName";

type PostRow = { post_date: string; status: string; tx_ids: string[]; totals: Record<string, unknown>; posted_at: string };
type CustRow = { customer_id: string; name: string; last_seen: string | null; visits: number; spend_total: number };

const toSale = (s: Record<string, unknown>): SaleRow => ({
  saleNo: s.sale_no as string,
  status: s.status as SaleRow["status"],
  businessDate: (s.business_date as string) ?? null,
  channel: (s.channel as string) ?? "บาร์",
  method: (s.method as string) ?? null,
  grandTotal: Number(s.grand_total),
  costTotal: Number(s.cost_total),
});

/** วันที่ในตาราง — ใส่วันในสัปดาห์ให้อ่านง่าย (โหลดฝั่ง client เท่านั้น ไม่มีปัญหา hydration) */
const dayLabel = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" });

/**
 * แดชบอร์ดบาร์ + ลงบัญชีรายวัน (D96 · รื้อหน้าตาใน D115)
 *
 * 🚨 **อ่านค่าที่แช่ไว้ในบิลเท่านั้น ห้ามคำนวณต้นทุนใหม่** (กติกา D75)
 * 🚨 แท็บนี้อยู่หลัง `bar.config` — พนักงานบาร์ไม่เห็นต้นทุน/กำไร
 *
 * D115 — ผู้ใช้งงกับการ์ดลงบัญชีเดิม (เลือกวันในช่องแยก แต่ยอดแยกวิธีรับเงินเป็นของทั้งช่วง)
 *   → **ตารางรายวัน**: 1 แถวต่อ 1 วันขาย ปุ่มลง/ถอนอยู่ติดกับตัวเลขของวันนั้นเอง
 *   → แถบวันค้างย้ายขึ้นบนสุด · ช่วงสำเร็จรูป + โหลดเองเมื่อเปลี่ยนช่วง · เทียบช่วงก่อน
 */
export function DashboardTab({ boot, onReload }: { boot: BarBoot; onReload: () => Promise<void> }) {
  const { msg, setMsg } = useSaver();
  const { confirmNode, ask } = useConfirm();
  const [busy, setBusy] = useState(false);
  // ★ "วันนี้" = วันขายปัจจุบันตามรอบที่ตั้งไว้ ไม่ใช่วันปฏิทิน (ตีหนึ่งยังเป็นคืนเดิม)
  const today = businessDate(new Date(), boot.settings.window);
  const [range, setRange] = useState(() => presetRange("30d", today));
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [prevSales, setPrevSales] = useState<SaleRow[]>([]);
  const [items, setItems] = useState<SaleItemRow[]>([]);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [customers, setCustomers] = useState<CustRow[]>([]);
  const [openBills, setOpenBills] = useState(0);
  const [labText, setLabText] = useState("");
  /**
   * ช่วงของข้อมูลที่โหลดมาแล้ว
   * 🪤 ของเดิมคิดตัวเลขจากช่องวันที่สดแต่ข้อมูลเป็นของช่วงเดิมจนกว่าจะกด "ดูยอด"
   *    ⇒ ขยายช่วงแล้วยอดขาดเงียบ ๆ · ผูกข้อมูลกับช่วงของมัน แล้วโชว์ตัวเลขเฉพาะตอนตรงกัน (D81)
   */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [topSort, setTopSort] = useState<TopSort>("qty");
  const rangeKey = `${range.from}|${range.to}`;
  const ready = loadedKey === rangeKey;

  async function load(r = range) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await dashboardAction({ from: r.from, to: r.to, prev: previousRange(r.from, r.to) });
      if (!res.ok) {
        setMsg({ ok: false, text: res.error ?? "โหลดข้อมูลไม่สำเร็จ" });
        return;
      }
      const d = res.data as {
        sales: Record<string, unknown>[];
        prevSales: Record<string, unknown>[];
        lines: Record<string, unknown>[];
        posts: PostRow[];
        customers: CustRow[];
        openBills: number;
        labUses: Record<string, unknown>[];
        labCats: Record<string, unknown>[];
      };
      setSales(d.sales.map(toSale));
      setPrevSales((d.prevSales ?? []).map(toSale));
      setItems(
        d.lines.map((l) => ({
          saleNo: l.sale_no as string,
          menuId: (l.menu_id as string) ?? null,
          menuName: l.menu_name as string,
          qty: Number(l.qty),
          amount: Number(l.amount),
          cost: Number(l.cost),
          voidedAt: (l.voided_at as string) ?? null,
        })),
      );
      setPosts(d.posts);
      setCustomers(d.customers);
      setOpenBills(d.openBills ?? 0);
      setLabText(
        labDashboardText(
          labSummary(
            (d.labUses ?? []).map((u) => ({
              useId: u.use_id as string, usedAt: "", businessDate: u.business_date as string,
              categoryId: u.category_id as string, recipeId: null, roundNo: null, glasses: null,
              eventName: null, note: null, costTotal: Number(u.cost_total), createdBy: null, lines: [],
            }) as LabUse),
            labCategories(
              (d.labCats ?? []).map((c) => ({
                categoryId: c.category_id as string, name: c.name as string, sort: Number(c.sort), isSystem: Boolean(c.is_system),
              })),
            ),
            [],
            r.from,
            r.to,
          ),
          fmt,
        ),
      );
      setLoadedKey(`${r.from}|${r.to}`);
    } finally {
      setBusy(false);
    }
  }

  // โหลดเองทุกครั้งที่ช่วงเปลี่ยน (เลิกใช้ปุ่ม "ดูยอด")
  useEffect(() => {
    if (range.from && range.to && range.from <= range.to) void load(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (!r.ok) {
        setMsg({ ok: false, text: r.error ?? "ทำรายการไม่สำเร็จ" });
        return;
      }
      await Promise.all([load(), onReload()]);
      setMsg({ ok: true, text: okText });
    } finally {
      setBusy(false);
    }
  }

  /**
   * ลงบัญชีย้อนหลังทุกวันที่ค้าง
   * 🚨 **ยิงทีละวัน ไม่รวบเป็นคำสั่งเดียว** — วันหนึ่งล้มต้องไม่ทำให้วันอื่นล้มตาม
   */
  async function postAll() {
    setBusy(true);
    setMsg(null);
    const failed: string[] = [];
    let done = 0;
    try {
      for (const d of boot.unposted) {
        const r = await postDayAction(d.date);
        if (r.ok) done += 1;
        else failed.push(`${d.date} (${r.error ?? "ไม่สำเร็จ"})`);
      }
      await Promise.all([load(), onReload()]);
      // 🚨 สำเร็จบางส่วน ≠ สำเร็จ (บทเรียน D79/D86)
      if (failed.length === 0) setMsg({ ok: true, text: `ลงบัญชีแล้ว ${done} วัน` });
      else setMsg({ ok: false, text: `ลงบัญชีสำเร็จ ${done} วัน · ไม่สำเร็จ: ${failed.join(" · ")}` });
    } finally {
      setBusy(false);
    }
  }

  async function postDay(day: DayRow) {
    const warn = postConfirmText(day.state, openBills);
    if (warn) {
      const ok = await ask({ title: `ลงบัญชีวันขาย ${day.date} ตอนนี้เลย?`, detail: warn, confirmText: "ลงบัญชี" });
      if (!ok) return;
    }
    void run(() => postDayAction(day.date), `ลงบัญชีวันที่ ${day.date} แล้ว`);
  }

  async function unpostDay(date: string) {
    const ok = await ask({
      title: `ถอนการลงบัญชีของวัน ${date}?`,
      detail: "บิลบัญชีของวันนั้นจะถูกยกเลิก (ไม่ลบทิ้ง) แล้วลงบัญชีใหม่ได้",
      confirmText: "ถอนการลงบัญชี",
      danger: true,
    });
    if (ok) void run(() => unpostDayAction(date), `ถอนการลงบัญชีวันที่ ${date} แล้ว`);
  }

  const ranged = inRange(sales, range.from, range.to);
  const s = summarize(ranged);
  const p = summarize(prevSales);
  const channels = byChannel(ranged);
  const tops = sortTopMenus(topMenus(ranged, items, Number.POSITIVE_INFINITY), topSort);
  const postMap = new Map(posts.map((x) => [x.post_date, x]));
  const days = dailyRows(ranged, posts.map((x) => x.post_date), today);
  const lapsed = lapsedCustomers(
    customers.map((c) => ({ ...c, lastSeen: c.last_seen })),
    today,
    90,
  );
  const preset = matchPreset(range.from, range.to, today);
  const canPost = Boolean(boot.settings.revenueAccount);

  if (!boot.entityId) return null;

  return (
    <div className="space-y-4">
      {confirmNode}
      <Msg msg={msg} />

      {/* ── แถบวันค้าง (ย้ายขึ้นบนสุดใน D115 — เดิมอยู่ล่างสุดของหน้า) ── */}
      {boot.unposted.length > 0 && (
        <div className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex-1">
              <b>{unpostedText(boot.unposted)}</b> · รวม {fmt(unpostedTotal(boot.unposted))} บาท
            </span>
            <button
              type="button"
              disabled={busy || !canPost}
              onClick={() => void postAll()}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm text-on-brand disabled:opacity-50"
            >
              ลงบัญชีทั้งหมด
            </button>
          </div>
          {!canPost && (
            <div className="mt-1 text-xs">
              ยังกดไม่ได้ — ตั้ง <b>บัญชีที่รายได้บาร์เข้า</b> ที่แท็บ <b>ตั้งค่าบาร์</b> ก่อน
            </div>
          )}
        </div>
      )}

      <Card title="ช่วงเวลา">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setRange(presetRange(k, today))}
              className={`rounded-md px-3 py-1.5 text-sm ${
                preset === k ? "bg-brand text-on-brand" : "border border-line bg-card text-muted hover:text-ink"
              }`}
            >
              {RANGE_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="ตั้งแต่ (วันขาย)">
            <TextInput type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          </Field>
          <Field label="ถึง">
            <TextInput type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          </Field>
          {busy && <span className="pb-2 text-xs text-faint">กำลังโหลด…</span>}
        </div>
        {range.from > range.to && <p className="mt-2 text-xs text-warn">วันเริ่มอยู่หลังวันสิ้นสุด — แก้ช่วงก่อน</p>}
        {/* 🚨 บิลที่ยังเปิดอยู่ไม่นับเป็นยอดขาย — ต้องบอก ไม่ใช่เงียบ */}
        {openBills > 0 && (
          <p className="mt-2 text-xs text-warn">
            มีบิลที่ยังเปิดอยู่ <b>{openBills} ใบ</b> — ยังไม่นับเป็นยอดขาย เพราะยังไม่ได้รับเงินและยอดยังเปลี่ยนได้
          </p>
        )}
      </Card>

      {ready ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="ยอดขาย" value={fmt(s.revenue)} delta={changePct(s.revenue, p.revenue)} />
            <KpiTile
              label="กำไรขั้นต้น"
              value={fmt(s.profit)}
              tone={s.profit >= 0 ? "ok" : "crit"}
              delta={changePct(s.profit, p.profit)}
            />
            {/* 🪤 ยังไม่มียอดขาย → null ไม่ใช่ 0% (บทเรียน D94) */}
            <KpiTile label="อัตรากำไร" value={s.marginPct === null ? "—" : `${s.marginPct}%`} delta={null} />
            <KpiTile label="จำนวนบิล" value={String(s.bills)} delta={changePct(s.bills, p.bills)} />
          </div>
          <p className="-mt-2 text-xs text-faint">
            ต้นทุน {fmt(s.cost)} · เฉลี่ยต่อบิล {s.avgPerBill === null ? "—" : fmt(s.avgPerBill)} ·
            ▲▼ เทียบกับ {prevNote(range.from, range.to, p)}
          </p>
          {/* D129 — ทุนห้องทดลอง แยกบรรทัด (ไม่ได้หักจากกำไรขั้นต้นข้างบน · ประโยคตัดสินใน lib) */}
          {labText && <p className="-mt-2 text-xs text-muted">{labText}</p>}

          <Card title="ยอดรายวัน และการลงบัญชี">
            <p className="mb-2 text-sm text-muted">
              กด <b>ลงบัญชี</b> ที่แถวของวันนั้น = รวมบิลของวันเป็น <b>1 บิลรายรับต่อ 1 วิธีรับเงิน</b> (ตามที่เห็นในคอลัมน์
              แยกวิธีรับเงิน) ของกิจการ{" "}
              <b>{boot.settings.entityId}</b> · ลงแล้ว ยกเลิก/แก้/ปิดบิลเข้าวันนั้นไม่ได้จนกว่าจะกด <b>ถอน</b>
            </p>
            {/* D116 — บอกล่วงหน้าว่าแต่ละวิธีลงบัญชีไหน (กติกาเดียวกับ fn_bar_post_day ผ่าน accountForMethod) */}
            {canPost && (
              <p className="mb-2 text-xs text-faint">
                {CASH_METHOD} → <b>{accountForMethod(CASH_METHOD, boot.settings.revenueAccount, boot.settings.cashAccount)}</b> ·
                วิธีอื่น → <b>{boot.settings.revenueAccount}</b>
              </p>
            )}
            {!canPost && (
              <p className="mb-2 text-xs text-warn">
                ยังไม่ได้ตั้ง <b>บัญชีที่รายได้บาร์เข้า</b> — ไปตั้งที่แท็บ <b>ตั้งค่าบาร์</b> ก่อน
              </p>
            )}
            {days.length === 0 ? (
              <Empty>— ยังไม่มีบิลที่ปิดแล้วในช่วงนี้ —</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>วันขาย</th>
                      <th className="text-right">บิล</th>
                      <th className="text-right">ยอดขาย</th>
                      <th>แยกวิธีรับเงิน</th>
                      <th className="text-right">กำไร</th>
                      <th>ลงบัญชี</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d) => {
                      const post = postMap.get(d.date);
                      return (
                        <tr key={d.date}>
                          <td className="whitespace-nowrap text-ink">
                            {dayLabel(d.date)}
                            <div className="text-xs text-faint">{d.date}</div>
                          </td>
                          <td className="text-right">{d.bills}</td>
                          <td className="text-right font-medium text-ink">{fmt(d.revenue)}</td>
                          <td className="text-xs text-muted">
                            {d.methods.map((m) => (
                              <div key={m.method} className="whitespace-nowrap">
                                {m.method} {fmt(m.revenue)} <span className="text-faint">({m.bills})</span>
                              </div>
                            ))}
                          </td>
                          <td className={`text-right ${d.profit >= 0 ? "" : "text-crit"}`}>
                            {fmt(d.profit)}
                            <div className="text-xs text-faint">{d.marginPct === null ? "—" : `${d.marginPct}%`}</div>
                          </td>
                          <td className="whitespace-nowrap">
                            {d.state === "posted" ? (
                              <div className="flex items-center gap-2">
                                <Badge tone="ok">ลงแล้ว</Badge>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void unpostDay(d.date)}
                                  title={post ? `บิลบัญชี: ${post.tx_ids.join(" · ")}` : undefined}
                                  className="text-xs text-crit hover:underline disabled:opacity-50"
                                >
                                  ถอน
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                {d.state === "selling" && <Badge tone="brand">วันขายปัจจุบัน</Badge>}
                                <button
                                  type="button"
                                  disabled={busy || !canPost}
                                  title={canPost ? undefined : "ยังไม่ได้ตั้งบัญชีที่รายได้บาร์เข้า"}
                                  onClick={() => void postDay(d)}
                                  className={`rounded-md px-3 py-1 text-xs disabled:opacity-50 ${
                                    d.state === "selling"
                                      ? "border border-line bg-card text-ink"
                                      : "bg-brand text-on-brand"
                                  }`}
                                >
                                  ลงบัญชี
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="แยกตามช่องทาง/งาน">
            {channels.length === 0 ? (
              <Empty>— ยังไม่มียอดในช่วงนี้ —</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>ช่องทาง</th>
                      <th className="text-right">บิล</th>
                      <th className="text-right">ยอดขาย</th>
                      <th className="text-right">ต้นทุน</th>
                      <th className="text-right">กำไร</th>
                      <th className="text-right">อัตรา</th>
                    </tr>
                  </thead>
                  <tbody>
                    {channels.map((c) => (
                      <tr key={c.channel}>
                        <td className="text-ink">{c.channel}</td>
                        <td className="text-right">{c.bills}</td>
                        <td className="text-right">{fmt(c.revenue)}</td>
                        <td className="text-right">{fmt(c.cost)}</td>
                        <td className={`text-right ${c.profit >= 0 ? "" : "text-crit"}`}>{fmt(c.profit)}</td>
                        <td className="text-right">{c.marginPct === null ? "—" : `${c.marginPct}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-1 text-xs text-faint">🎯 ตารางนี้คือตัวที่ตอบว่า &quot;บูธงานนั้นคุ้มไหม&quot;</p>
          </Card>

          <Card title="เมนูขายดี (10 อันดับ)">
            <div className="mb-2 flex items-center gap-2 text-sm">
              <span className="text-faint">เรียงตาม</span>
              <div className="inline-flex overflow-hidden rounded-md border border-line">
                {(Object.keys(TOP_SORT_LABEL) as TopSort[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTopSort(k)}
                    aria-pressed={topSort === k}
                    className={`px-3 py-1 text-xs ${topSort === k ? "bg-brand font-medium text-on-brand" : "bg-raised text-muted hover:text-ink"}`}
                  >
                    {TOP_SORT_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
            {tops.length === 0 ? (
              <Empty>— ยังไม่มียอด —</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>เมนู</th>
                      <th className="text-right">ขายได้</th>
                      <th className="text-right">ยอดขาย</th>
                      <th className="text-right">กำไร</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tops.map((t) => (
                      <tr key={t.menuId ?? t.menuName}>
                        <td className="text-ink">{t.menuName}</td>
                        <td className="text-right">{t.qty}</td>
                        <td className="text-right">{fmt(t.revenue)}</td>
                        <td className="text-right">{fmt(t.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {lapsed.length > 0 && (
            <Card title={`ลูกค้าที่ไม่ได้มานาน (เกิน 90 วัน) — ${lapsed.length} คน`}>
              <div className="flex flex-wrap gap-2">
                {lapsed.map((c) => (
                  <Badge key={c.customer_id} tone="neutral">
                    {/* ★ RPC คืนมาแค่ชื่อจริง — ชื่อเล่นมาจากทะเบียนที่โหลดไว้แล้วใน boot */}
                    {customerLabel(boot.customers.find((x) => x.customerId === c.customer_id)) || c.name} ·{" "}
                    {c.last_seen}
                  </Badge>
                ))}
              </div>
            </Card>
          )}
        </>
      ) : (
        <Empty>{range.from > range.to ? "— แก้ช่วงเวลาก่อน —" : "กำลังโหลดยอด…"}</Empty>
      )}
    </div>
  );
}

/** ช่วงที่ใช้เทียบ — บอกให้ชัดว่าเทียบกับอะไร ไม่งั้น ▲▼ อ่านไม่ออก */
function prevNote(from: string, to: string, prev: Summary): string {
  const r = previousRange(from, to);
  const span = r.from === r.to ? r.from : `${r.from} – ${r.to}`;
  return prev.bills === 0 ? `${span} (ช่วงนั้นไม่มียอด)` : span;
}

function KpiTile({ label, value, delta, tone }: {
  label: string;
  value: string;
  /** % เทียบช่วงก่อน · null = ไม่มีอะไรให้เทียบ (ไม่แสดง) */
  delta: number | null;
  tone?: "ok" | "crit";
}) {
  const c = tone === "ok" ? "text-ok" : tone === "crit" ? "text-crit" : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <div className="text-[10px] font-medium uppercase tracking-widest text-muted">{label}</div>
      <div className={`tnum mt-1 text-xl font-bold ${c}`}>{value}</div>
      {delta !== null && (
        <div className={`mt-0.5 text-xs ${delta > 0 ? "text-ok" : delta < 0 ? "text-crit" : "text-faint"}`}>
          {delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} {Math.abs(delta)}% จากช่วงก่อน
        </div>
      )}
    </div>
  );
}
