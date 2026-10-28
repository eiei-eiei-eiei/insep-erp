/**
 * การ์ดตรวจบิล — โค้ดฝั่งเบราว์เซอร์ที่รันใน Claude (MCP App · D141)
 *
 * ★ build เป็นสคริปต์ก้อนเดียวฝังใน HTML ด้วย `npm run gen:bill-card` → billCard.generated.ts
 *   (ไม่โหลดอะไรจากเว็บภายนอกตอนใช้งาน) · แก้ไฟล์นี้แล้วต้องรันคำสั่งนั้น — เทสฟ้องถ้าลืม
 * 🚨 การ์ดไม่คิดเงินเอง: ทุกครั้งที่เปลี่ยนค่า เรียก recalc_bill ให้ server คิดด้วย entryCalc ตัวเดิม
 * 🚨 ปุ่ม/ข้อความทั้งหมดตัดสินใน lib/connector/cardView.ts (มีเทส) — ที่นี่แค่วาด
 * 🪤 ช่องกรอกในหน้าแก้รายการต้องไม่ถูกวาดใหม่ระหว่างพิมพ์ (โฟกัสหลุด · D71) — วาดใหม่เฉพาะส่วนยอด/ปุ่ม
 */
// ★ ใช้ตัวที่ SDK build ย่อมาแล้ว — import ตัวปกติลาก zod เต็มก้อนมา (การ์ดโต 528KB → ~350KB)
import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps/app-with-deps";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { primaryAction, suspectSet, savedContextText, INLINE_ITEMS, EDIT_TOTAL_WARN, type CardData } from "../cardView";
import type { DraftItem } from "../bill";

const app = new App({ name: "Insep ERP bill card", version: "1.0.0" }, { availableDisplayModes: ["inline", "fullscreen"] });

let data: CardData | null = null;
let full = false;
let busy = false;
let saved: string | null = null;
let failText = "";
let editTotal = false;
let timer: ReturnType<typeof setTimeout> | undefined;

const root = document.getElementById("root")!;
const baht = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmtDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${Number(m[3])}/${Number(m[2])}/${Number(m[1]) + 543}` : iso;
};

// ── คุยกับ server ──────────────────────────────────────────────────────────────
/** ส่งเฉพาะช่องของบิล (ธงยืนยันซ้ำเป็นของ save_bill เท่านั้น) */
function billArgs(): Record<string, unknown> {
  const { confirm_not_duplicate: _ignored, ...d } = data!.draft;
  void _ignored;
  return d as unknown as Record<string, unknown>;
}

async function recalc(patch: Partial<CardData["draft"]>, wait = 0) {
  if (!data || saved) return;
  data = { ...data, draft: { ...data.draft, ...patch } };
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    busy = true;
    paintActions();
    try {
      const r = await app.callServerTool({ name: "recalc_bill", arguments: billArgs() });
      const sc = r.structuredContent as CardData | undefined;
      // ★ เก็บธงยืนยันซ้ำของผู้ใช้ไว้ (server ไม่รู้จัก)
      if (sc) data = { ...sc, draft: { ...sc.draft, confirm_not_duplicate: data?.draft.confirm_not_duplicate } };
      failText = r.isError ? textOf(r) : "";
    } catch {
      failText = "เชื่อมต่อระบบไม่สำเร็จ — ลองกดอีกครั้ง";
    }
    busy = false;
    if (full) paintLive(); else render();
  }, wait);
}

function textOf(r: { content?: { type: string; text?: string }[] }): string {
  return (r.content ?? []).map((c) => (c.type === "text" ? c.text ?? "" : "")).join(" ").slice(0, 300);
}

async function save() {
  if (!data || busy || saved) return;
  busy = true;
  paintActions();
  try {
    const r = await app.callServerTool({
      name: "save_bill",
      arguments: { tenant_slug: data.tenant_slug, confirm_not_duplicate: Boolean(data.draft.confirm_not_duplicate), ...billArgs() },
    });
    const sc = r.structuredContent as { ok?: boolean; tx_id?: string; errors?: string[] } | undefined;
    if (sc?.ok && sc.tx_id) {
      saved = sc.tx_id;
      failText = "";
      // บอก Claude ว่าบันทึกแล้ว (ไม่ขึ้นเป็นข้อความในแชท) — กัน Claude เรียก save_bill ซ้ำ
      app.updateModelContext({ content: [{ type: "text", text: savedContextText(sc.tx_id) }] }).catch(() => undefined);
    } else {
      failText = sc?.errors?.[0] ?? (textOf(r) || "บันทึกไม่สำเร็จ");
    }
  } catch {
    failText = "บันทึกไม่สำเร็จ — เชื่อมต่อระบบไม่ได้ ลองอีกครั้ง";
  }
  busy = false;
  if (full && saved) await setFull(false);
  else if (full) paintLive(); else render();
}

function ask(text: string) {
  app.sendMessage({ role: "user", content: [{ type: "text", text }] }).catch(() => undefined);
}

async function setFull(on: boolean) {
  full = on;
  editTotal = false;
  try {
    const ctx = app.getHostContext();
    if (ctx?.availableDisplayModes?.includes(on ? "fullscreen" : "inline")) {
      await app.requestDisplayMode({ mode: on ? "fullscreen" : "inline" });
    }
  } catch { /* โฮสต์ไม่รองรับ = ขยายในที่เดิม */ }
  render();
}

// ── วาด ─────────────────────────────────────────────────────────────────────────
function chip(label: string, on: boolean, act: string, val = "") {
  return `<button class="chip${on ? " on" : ""}" data-act="${act}" data-val="${esc(val)}"${saved ? " disabled" : ""}>${esc(label)}</button>`;
}

function choicesHtml(d: CardData): string {
  const x = d.draft;
  const ent = d.entities.length > 1
    ? `<div class="row"><div class="lab">ลงกิจการ</div><div class="chips">${d.entities
        .map((e) => chip(`${e.entity_id} ${e.name}`, e.entity_id === x.entity_id, "entity", e.entity_id)).join("")}</div></div>`
    : "";
  const cats = `<div class="row"><div class="lab">หมวด</div><div class="chips">${d.category_chips
    .map((c) => chip(c, c === x.category, "category", c)).join("")}${chip("อื่น ๆ ↗", false, "other-cat")}</div></div>`;
  const accs = `<div class="row"><div class="lab">${x.type === "รายรับ" ? "รับเข้า" : "จ่ายจาก"}</div><div class="chips">${d.accounts
    .map((a) => chip(a, !x.unpaid && a === x.account_name, "account", a)).join("")}${chip(
    x.type === "รายรับ" ? "ตั้งค้างรับ" : "ตั้งค้างจ่าย", Boolean(x.unpaid), "unpaid")}</div></div>`;
  return ent + cats + accs;
}

function itemsInlineHtml(d: CardData): string {
  const sus = suspectSet(d);
  const items = d.draft.items;
  const rows = items.slice(0, INLINE_ITEMS).map((it, i) =>
    `<div class="li${sus.has(i) ? " sus" : ""}"><span>${esc(it.name)}</span><span class="num">${it.quantity} × ${baht(it.unit_price)}</span></div>`).join("");
  const more = items.length > INLINE_ITEMS ? `<div class="mu">+ อีก ${items.length - INLINE_ITEMS} รายการ</div>` : "";
  const hidden = [...sus].some((i) => i >= INLINE_ITEMS) ? `<div class="bad">แถวที่น่าจะผิดอยู่ในรายการที่ซ่อนไว้</div>` : "";
  return `<div class="row"><div class="lab">รายการ ${items.length} รายการ · ราคา${d.draft.price_mode === "in" ? "รวม" : "ไม่รวม"} VAT</div>${rows}${more}${hidden}
    <button class="sec wide" data-act="edit"${saved ? " disabled" : ""}>ดู/แก้รายการ</button></div>`;
}

function itemsEditHtml(d: CardData): string {
  const rows = d.draft.items.map((it, i) => `<div class="er" data-row="${i}">
      <input class="nm" data-f="name" value="${esc(it.name)}" aria-label="ชื่อรายการ ${i + 1}">
      <input class="q" data-f="quantity" inputmode="decimal" value="${esc(it.quantity)}" aria-label="จำนวน ${i + 1}">
      <input class="p" data-f="unit_price" inputmode="decimal" value="${esc(it.unit_price)}" aria-label="ราคาต่อหน่วย ${i + 1}">
      <button class="x" data-act="del" data-val="${i}" aria-label="ลบรายการ ${i + 1}">✕</button></div>`).join("");
  return `<div class="row"><div class="er hd"><span>รายการ</span><span>จำนวน</span><span>ราคา/หน่วย</span><span></span></div>${rows}</div>`;
}

function totalsHtml(d: CardData): string {
  const c = d.computed;
  const m = d.mismatch;
  const line = (k: string, v: string, cls = "") => `<div class="tl ${cls}"><span>${k}</span><span class="num">${v}</span></div>`;
  let status = "";
  if (d.used_bill_amounts && m) status = `<div class="ok">ใช้ยอดตามบิล ${baht(m.onBill)} (ระบบคิดได้ ${baht(m.computed)})</div>`;
  else if (m) status = `<div class="bad">ไม่ตรงบิล — คิดได้ ${baht(m.computed)} บนบิล ${baht(m.onBill)}</div>`;
  else if (c) status = `<div class="ok">ตรงกับยอดบนบิล ${baht(d.draft.total_on_bill)}</div>`;
  const totalEdit = full
    ? editTotal
      ? `<div class="warnbox">${esc(EDIT_TOTAL_WARN)}</div><label class="lab">ยอดรวมบนบิล <input id="tob" inputmode="decimal" value="${esc(d.draft.total_on_bill)}"></label>`
      : `<button class="link" data-act="edit-total">แก้ยอดบนบิล</button>`
    : "";
  return `<div class="tot">${c ? line("ก่อน VAT", baht(c.amount_after_discount)) + line("VAT", baht(c.vat_amount)) + line("รวม", baht(c.gross_total), "big") : ""}
    ${c && c.wht_amount > 0 ? line(`หัก ณ ที่จ่าย ${c.wht_rate}%`, baht(c.wht_amount)) + line("สุทธิ", baht(c.net_amount)) : ""}
    ${status}${totalEdit}</div>`;
}

function warningsHtml(d: CardData): string {
  return d.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join("");
}

function actionsHtml(d: CardData): string {
  if (saved) {
    return `<div class="done">บันทึกแล้ว ${esc(saved)} — แก้หรือลบได้ที่แอป บัญชี → ค้นบิล</div>`;
  }
  const a = primaryAction(d);
  const off = busy || a.kind === "fix";
  const main = `<button class="pri" data-act="primary"${off ? " disabled" : ""}>${busy ? "กำลังทำงาน…" : esc(a.label)}</button>`;
  const second = full
    ? `<button class="sec" data-act="done-edit">เสร็จ</button>`
    : `<button class="sec" data-act="chat">แก้ในแชท ↗</button>`;
  return `<div class="acts">${main}${second}</div>${a.hint ? `<div class="hint">${esc(a.hint)}</div>` : ""}${
    failText ? `<div class="bad">${esc(failText)}</div>` : ""}`;
}

function render() {
  if (!data) {
    root.innerHTML = `<div class="card"><div class="mu">กำลังตรวจบิล…</div></div>`;
    return;
  }
  const d = data;
  const x = d.draft;
  const head = `<div class="hd1"><b>${esc(x.contact_name || "(ไม่ระบุคู่ค้า)")}</b><span class="mu">${esc(d.tenant_name)}</span></div>
    <div class="mu">${esc(x.type)} · ${esc(fmtDate(x.transaction_date))}${x.tax_invoice_no ? ` · ใบกำกับ ${esc(x.tax_invoice_no)}` : ""}</div>`;
  root.innerHTML = `<div class="card${full ? " full" : ""}">${head}
    ${full ? itemsEditHtml(d) : choicesHtml(d) + itemsInlineHtml(d)}
    <div id="live">${totalsHtml(d)}${warningsHtml(d)}<div id="acts">${actionsHtml(d)}</div></div></div>`;
  paintSuspects();
}

/** หน้าแก้รายการ: วาดใหม่เฉพาะยอด/คำเตือน/ปุ่ม — ไม่แตะช่องกรอกที่กำลังพิมพ์ */
function paintLive() {
  const live = document.getElementById("live");
  if (!live || !data) return render();
  live.innerHTML = `${totalsHtml(data)}${warningsHtml(data)}<div id="acts">${actionsHtml(data)}</div>`;
  paintSuspects();
}

function paintActions() {
  const el = document.getElementById("acts");
  if (el && data) el.innerHTML = actionsHtml(data);
}

function paintSuspects() {
  if (!data || !full) return;
  const sus = suspectSet(data);
  document.querySelectorAll<HTMLElement>(".er[data-row]").forEach((r) => r.classList.toggle("sus", sus.has(Number(r.dataset.row))));
}

// ── กด/พิมพ์ ───────────────────────────────────────────────────────────────────
root.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!b || !data || saved) return;
  const val = b.dataset.val ?? "";
  switch (b.dataset.act) {
    // เปลี่ยนกิจการ = VAT อาจเปลี่ยน ⇒ "ใช้ยอดตามบิล" ที่เคยกดต้องตัดสินใหม่ (ไม่งั้นขึ้น error ทั้งที่ไม่ได้กดอะไร)
    case "entity": return void recalc({ entity_id: val, use_bill_amounts: false });
    case "category": return void recalc({ category: val });
    case "account": return void recalc({ account_name: val, unpaid: false });
    case "unpaid": return void recalc({ unpaid: !data.draft.unpaid });
    case "other-cat": return ask("ขอดูหมวดอื่นสำหรับบิลนี้ แล้วเปิดการ์ดใหม่");
    case "chat": return ask("ขอแก้บิลนี้: ");
    case "edit": return void setFull(true);
    case "done-edit": return void setFull(false);
    case "edit-total": editTotal = true; return paintLive();
    case "del": {
      const items = data.draft.items.filter((_, i) => i !== Number(val));
      data = { ...data, draft: { ...data.draft, items } };
      render();
      return void recalc({ items });
    }
    case "primary": {
      const a = primaryAction(data);
      if (a.kind === "save") return void save();
      if (a.kind === "confirm_dup") { data.draft.confirm_not_duplicate = true; return void save(); }
      if (a.kind === "switch_mode") return void recalc({ price_mode: data.mismatch?.altPriceMode ?? data.draft.price_mode });
      if (a.kind === "use_bill_amounts") return void recalc({ use_bill_amounts: true });
      if (a.kind === "ask_claude") return ask(a.message ?? "ช่วยอ่านบิลนี้ใหม่อีกครั้ง");
    }
  }
});

root.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  if (!data) return;
  if (el.id === "tob") return void recalc({ total_on_bill: Number(el.value) || 0, use_bill_amounts: false }, 500);
  const row = el.closest<HTMLElement>(".er[data-row]");
  const f = el.dataset.f as keyof DraftItem | undefined;
  if (!row || !f) return;
  const i = Number(row.dataset.row);
  const items = data.draft.items.map((it, j) =>
    j === i ? { ...it, [f]: f === "name" ? el.value : Number(el.value) || 0 } : it);
  // แก้รายการ = เลิกใช้ยอดตามบิลที่เคยกด (ต้องตัดสินใหม่จากยอดใหม่)
  void recalc({ items, use_bill_amounts: false }, 500);
});

// ── เชื่อมกับ Claude ────────────────────────────────────────────────────────────
function applyCtx(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  const s = ctx.safeAreaInsets;
  if (s) document.body.style.padding = `${s.top}px ${s.right}px ${s.bottom}px ${s.left}px`;
  if (ctx.displayMode && ctx.displayMode !== "fullscreen" && full) { full = false; render(); }
}

app.ontoolresult = (r) => {
  const sc = r.structuredContent as CardData | undefined;
  if (sc && sc.v === 1) { data = sc; render(); }
};
app.onhostcontextchanged = (ctx) => applyCtx(ctx as McpUiHostContext);

render();
await app.connect();
applyCtx(app.getHostContext());
