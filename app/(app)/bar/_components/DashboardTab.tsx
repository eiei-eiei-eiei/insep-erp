"use client";

import { useEffect, useState } from "react";
import type { BarBoot } from "../data";
import {
  summarize, byChannel, byMethod, topMenus, inRange, lapsedCustomers,
  type SaleRow, type SaleItemRow,
} from "@/lib/bar/dashboard";
import { Card, Msg, TextInput, Field, Stat, Badge, Empty, fmt, useSaver, useConfirm, todayISO } from "@/lib/shared/ui";
import { dashboardAction, postDayAction, unpostDayAction } from "../actions";
import { unpostedText, unpostedTotal } from "@/lib/bar/posting";
import { customerLabel } from "@/lib/bar/customerName";

type PostRow = { post_date: string; status: string; tx_ids: string[]; totals: Record<string, unknown>; posted_at: string };
type CustRow = { customer_id: string; name: string; last_seen: string | null; visits: number; spend_total: number };

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

/**
 * แดชบอร์ดบาร์ + ลงบัญชีรายวัน (D96)
 *
 * 🚨 **อ่านค่าที่แช่ไว้ในบิลเท่านั้น ห้ามคำนวณต้นทุนใหม่**
 *    `bar_item.cost_per_unit` ขยับทุกครั้งที่รับของ — คำนวณสดตอนเปิดดู =
 *    กำไรของเดือนที่แล้วขยับเองเมื่อเดือนนี้ซื้อของแพงขึ้น (กติกา D75)
 *    ★ ชนิดข้อมูลขาเข้าของ `lib/bar/dashboard.ts` ไม่มีช่องให้ส่งราคาวัตถุดิบมาเลย
 *      = บังคับด้วยโครงสร้าง ไม่ใช่ด้วยวินัย
 *
 * 🚨 แท็บนี้อยู่หลัง `bar.config` — พนักงานบาร์ไม่เห็นต้นทุน/กำไร
 */
export function DashboardTab({ boot, onReload }: { boot: BarBoot; onReload: () => Promise<void> }) {
  const { msg, setMsg } = useSaver();
  const { confirmNode, ask } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayISO());
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [items, setItems] = useState<SaleItemRow[]>([]);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [customers, setCustomers] = useState<CustRow[]>([]);
  const [postDate, setPostDate] = useState(todayISO());
  const [openBills, setOpenBills] = useState(0);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await dashboardAction({ from, to });
      if (!r.ok) {
        setMsg({ ok: false, text: r.error ?? "โหลดข้อมูลไม่สำเร็จ" });
        return;
      }
      const d = r.data as {
        sales: Record<string, unknown>[];
        lines: Record<string, unknown>[];
        posts: PostRow[];
        customers: CustRow[];
        openBills: number;
      };
      setSales(
        d.sales.map((s) => ({
          saleNo: s.sale_no as string,
          status: s.status as SaleRow["status"],
          businessDate: (s.business_date as string) ?? null,
          channel: (s.channel as string) ?? "บาร์",
          method: (s.method as string) ?? null,
          grandTotal: Number(s.grand_total),
          costTotal: Number(s.cost_total),
        })),
      );
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
      setLoaded(true);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const ranged = inRange(sales, from, to);
  const s = summarize(ranged);
  const channels = byChannel(ranged);
  const methods = byMethod(ranged);
  const tops = topMenus(ranged, items);
  const lapsed = lapsedCustomers(
    customers.map((c) => ({ ...c, lastSeen: c.last_seen })),
    todayISO(),
    90,
  );
  /**
   * ลงบัญชีย้อนหลังทุกวันที่ค้าง
   * 🚨 **ยิงทีละวัน ไม่รวบเป็นคำสั่งเดียว** — วันหนึ่งล้ม (เช่น มีบิลของวันนั้นถูกแก้อยู่)
   *    ต้องไม่ทำให้วันอื่นล้มตาม และต้องบอกได้ว่าวันไหนไม่ผ่าน
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
      await onReload();
      // 🚨 สำเร็จบางส่วน ≠ สำเร็จ — ต้องขึ้นเหลือง ไม่ใช่เขียว (บทเรียน D79/D86)
      if (failed.length === 0) setMsg({ ok: true, text: `ลงบัญชีแล้ว ${done} วัน` });
      else setMsg({ ok: false, text: `ลงบัญชีสำเร็จ ${done} วัน · ไม่สำเร็จ: ${failed.join(" · ")}` });
    } finally {
      setBusy(false);
    }
  }

  const postedDay = posts.find((p) => p.post_date === postDate);

  if (!boot.entityId) return null;

  return (
    <div className="space-y-4">
      {confirmNode}
      <Msg msg={msg} />

      <Card title="ช่วงเวลา">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="ตั้งแต่ (วันขาย)">
            <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="ถึง">
            <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <button
            type="button"
            disabled={busy}
            onClick={load}
            className="rounded-lg bg-brand px-4 py-2 text-sm text-on-brand disabled:opacity-50"
          >
            ดูยอด
          </button>
        </div>
        {/* 🚨 บิลที่ยังเปิดอยู่ไม่นับเป็นยอดขาย — ต้องบอก ไม่ใช่เงียบ */}
        {openBills > 0 && (
          <p className="mt-2 text-xs text-warn">
            มีบิลที่ยังเปิดอยู่ <b>{openBills} ใบ</b> — ยังไม่นับเป็นยอดขาย เพราะยังไม่ได้รับเงินและยอดยังเปลี่ยนได้
          </p>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="ยอดขาย" value={fmt(s.revenue)} />
        <Stat label="ต้นทุน" value={fmt(s.cost)} />
        <Stat label="กำไรขั้นต้น" value={fmt(s.profit)} tone={s.profit >= 0 ? "green" : "red"} />
        {/* 🪤 ยังไม่มียอดขาย → null ไม่ใช่ 0% (บทเรียน D94 "หายระหว่างทาง 100%") */}
        <Stat label="อัตรากำไร" value={s.marginPct === null ? "—" : `${s.marginPct}%`} />
        <Stat label="จำนวนบิล" value={String(s.bills)} />
        <Stat label="เฉลี่ยต่อบิล" value={s.avgPerBill === null ? "—" : fmt(s.avgPerBill)} />
      </div>

      <Card title="แยกตามช่องทาง/งาน">
        {channels.length === 0 && loaded && <Empty>— ยังไม่มียอดในช่วงนี้ —</Empty>}
        {channels.length > 0 && (
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

      <Card title="เมนูขายดี">
        {tops.length === 0 && loaded && <Empty>— ยังไม่มียอด —</Empty>}
        {tops.length > 0 && (
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
                {/* ★ RPC คืนมาแค่ชื่อจริง — ชื่อเล่นมาจากทะเบียนที่โหลดไว้แล้วใน boot
                    หาไม่เจอ (เพิ่งลบ) = ใช้ชื่อที่ติดมากับแถว ไม่ใช่ปล่อยว่าง */}
                {customerLabel(boot.customers.find((x) => x.customerId === c.customer_id)) || c.name} ·{" "}
                {c.last_seen}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      <Card title="ลงบัญชียอดขายรายวัน">
        {/**
          * ── แถบตามเก็บวันที่ยังไม่ได้ลงบัญชี (D96 เฟส E) ────────────────────
          * 🚨 การลงบัญชีเป็น **ปุ่มที่ต้องกดเป็นกิจวัตร** ⇒ วันหนึ่งจะลืม แล้วยอดขาด
          *    โดยไม่มีอะไรฟ้อง (บทเรียน D91) · ผู้ใช้เลือกทางนี้เองแทนการลงอัตโนมัติ
          * ★ ข้อความมาจาก `unpostedText()` ที่มีเทสคุม — ห้ามแต่งประโยคในคอมโพเนนต์ (D84/D88)
          * ★ **วันขายของตอนนี้ถูกกันออกแล้วตั้งแต่ชั้น data** (ยังขายอยู่ ห้ามเตือน)
          */}
        {boot.unposted.length > 0 && (
          <div className="mb-3 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1">
                <b>{unpostedText(boot.unposted)}</b> · รวม {fmt(unpostedTotal(boot.unposted))} บาท
              </span>
              <button
                type="button"
                disabled={busy || !boot.settings.revenueAccount}
                onClick={() => void postAll()}
                className="rounded-lg bg-brand px-3 py-1.5 text-sm text-on-brand disabled:opacity-50"
              >
                ลงบัญชีทั้งหมด
              </button>
            </div>
            {!boot.settings.revenueAccount && (
              <div className="mt-1 text-xs">
                ยังกดไม่ได้ — ตั้ง <b>บัญชีที่รายได้บาร์เข้า</b> ที่แท็บ <b>ตั้งค่าบาร์</b> ก่อน
              </div>
            )}
          </div>
        )}

        <p className="mb-3 text-sm text-muted">
          รวมบิลของวันนั้นเป็น <b>1 บิลบัญชีต่อ 1 วิธีรับเงิน</b> เข้ากิจการ{" "}
          <b>{boot.settings.entityId}</b> · จุดนี้คือ<b>จุดเชื่อมเดียว</b>ระหว่างบาร์กับระบบบัญชีเดิม
        </p>

        {/* ★ โชว์ล่วงหน้าว่าจะได้บิลบัญชีกี่ใบ — เห็นก่อนกด ดีกว่ากดแล้วค่อยไปหาในหน้าบัญชี */}
        {methods.length > 0 && (
          <div className="mb-3 rounded-lg bg-raised p-3">
            <div className="mb-1 text-sm font-medium text-muted">
              ยอดรวมทั้งช่วง แยกตามวิธีรับเงิน (ทั้งช่วง ไม่ใช่เฉพาะวันที่จะลง)
            </div>
            {methods.map((m) => (
              <div key={m.method} className="flex items-center py-0.5 text-sm">
                <span className="flex-1 text-ink">{m.method}</span>
                <span className="text-muted">{m.bills} บิล</span>
                <span className="ml-4 w-24 text-right text-ink">{fmt(m.revenue)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <Field label="วันขายที่จะลง">
            <TextInput type="date" value={postDate} onChange={(e) => setPostDate(e.target.value)} />
          </Field>
          {postedDay ? (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const ok = await ask({
                  title: `ถอนการลงบัญชีของวัน ${postDate}?`,
                  detail: "บิลบัญชีจะถูกยกเลิก (ไม่ลบทิ้ง) แล้วลงบัญชีใหม่ได้",
                  confirmText: "ถอนการลงบัญชี",
                  danger: true,
                });
                if (ok) void run(() => unpostDayAction(postDate), "ถอนการลงบัญชีแล้ว");
              }}
              className="rounded-lg bg-raised px-4 py-2 text-sm text-crit disabled:opacity-50"
            >
              ถอนการลงบัญชี
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || !boot.settings.revenueAccount}
              title={boot.settings.revenueAccount ? undefined : "ยังไม่ได้ตั้งบัญชีที่รายได้บาร์เข้า"}
              onClick={() => void run(() => postDayAction(postDate), "ลงบัญชีแล้ว")}
              className="rounded-lg bg-brand px-4 py-2 text-sm text-on-brand disabled:opacity-50"
            >
              ลงบัญชียอดขายวันนี้
            </button>
          )}
        </div>

        {/* 🚨 ทุกครั้งที่ปิดปุ่ม ต้องบอกว่าต้องกดอะไรแทน (D88) */}
        {!boot.settings.revenueAccount && (
          <p className="mt-2 text-xs text-warn">
            ยังไม่ได้ตั้ง <b>บัญชีที่รายได้บาร์เข้า</b> — ไปตั้งที่แท็บ <b>ตั้งค่าบาร์</b> ก่อน
          </p>
        )}

        {postedDay && (
          <div className="mt-3 rounded-lg bg-raised p-3 text-sm">
            <div className="text-ink">
              วัน <b>{postedDay.post_date}</b> ลงบัญชีแล้วเมื่อ{" "}
              {new Date(postedDay.posted_at).toLocaleString("th-TH")}
            </div>
            <div className="mt-1 text-muted">บิลบัญชี: {postedDay.tx_ids.join(" · ") || "—"}</div>
            {/* 🚨 ยกเลิกบิลบาร์ของวันที่ลงบัญชีแล้วจะถูก DB บล็อก — บอกไว้ก่อนจะได้ไม่งง */}
            <div className="mt-1 text-xs text-warn">
              วันนี้ลงบัญชีไปแล้ว — ยกเลิกบิลของวันนี้ไม่ได้จนกว่าจะกด <b>ถอนการลงบัญชี</b> ก่อน
            </div>
          </div>
        )}

        {posts.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-sm font-medium text-muted">วันที่ลงบัญชีแล้วในช่วงนี้</div>
            <div className="flex flex-wrap gap-2">
              {posts.map((p) => (
                <Badge key={p.post_date} tone="ok">
                  {p.post_date}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
