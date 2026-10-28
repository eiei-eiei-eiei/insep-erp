import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { accountsFor } from "@/lib/accounting/bankAccounts";
import { forwardCatsOf, isForwardCat, FORWARD_CAT_KIND } from "@/lib/accounting/forwardCats";
import { hasModule } from "@/lib/shared/workspaces";
import { mapDbError } from "@/lib/shared/dbError";
import { bangkokDateISO } from "@/lib/shared/datetime";
import { checkBill, mismatchText, previewSummary, taxIdValid, normalizeTaxId, CONNECTOR_TYPES, type BillDraft, type BillContext, type CheckResult, type ConnectorType } from "./bill";
import { categoryChips, type CardContact, type CardData, type ContactCardData } from "./cardView";
import { newContactRow, findExistingContact, type ContactRow, type ExistingContact } from "./contact";
import { rankJobs } from "./jobs";
import { BILL_CARD_HTML } from "./card/billCard.generated";
import type { ConnectorMe } from "./session";

/**
 * เครื่องมือของ Claude connector (D141) — บันทึกได้แค่ รายจ่าย/รายรับ (+ ตั้งค้าง)
 *
 * 🚨 ทุกคำสั่งอ่าน/เขียนผ่าน `db` ที่ทำงานในนามผู้ใช้ (RLS) — ไม่มี service role
 * 🚨 save_bill เรียกได้จาก "การ์ด" ทางเดียว (visibility: app · รอบ 3) — Claude บันทึกเองไม่ได้
 *    (ใช้จริงแล้ว Claude บันทึกก่อนผู้ใช้เลือกเสร็จ และบันทึกเองขณะการ์ดยังมีปุ่มบันทึกค้าง = เสี่ยงบิลซ้ำ)
 * 🚨 save_bill เรียก fn_save_transaction ตัวเดียวกับฟอร์ม · ยอดเงินคิดใหม่ทุกครั้งด้วย checkBill()
 * ★ คำอธิบายเครื่องมือเขียนเป็นภาษาอังกฤษ (คนอ่านคือ Claude) · ข้อความที่ผู้ใช้เห็นเป็นภาษาไทย
 */

/** การ์ดตรวจบิล (MCP App) — Claude แสดงในแชทเมื่อเรียก preview_bill */
export const BILL_CARD_URI = "ui://insep-erp/bill-card";

/** ข้อความที่ Claude ได้ตอนเชื่อมต่อ — ขั้นตอนบังคับ */
export const SERVER_INSTRUCTIONS = `This connector records purchase/sales bills into a Thai ERP (accounting module).
Workflow for every bill image the user sends:
1. Call who_am_i once per conversation. Tell the user which customer (tenant) and business (entity) you are writing into.
2. Read the bill carefully. Thai bills often print Buddhist-era years (2569 = 2026): always send dates in Gregorian YYYY-MM-DD.
3. Call find_contact with the seller's 13-digit tax ID (or name). If the seller is not registered, read its name, tax ID,
   branch ("สำนักงานใหญ่" or the branch number) and address from the bill and pass them as new_contact to preview_bill.
   The contact is added to the register when the user saves. Never drop a seller that prints a tax ID.
4. Call lookup_options for exact category names, money accounts and jobs (jobs_required tells whether every line needs a job).
5. BEFORE preview_bill, ask the user in ONE message only what you are unsure of: which business (if several), paid from which
   account or unpaid, category, and the job of each line when jobs_required (one bill can have different jobs per line;
   a new job name is fine; "no job" means job_none = true and is stored empty). Skip questions whose answer is obvious.
6. Call preview_bill with the answers. total_on_bill = the grand total printed on the bill (incl. VAT, before withholding tax),
   read independently from the lines. price_mode "in" when unit prices include VAT, "ex" when VAT is added below.
   If the bill prints a subtotal before VAT and a VAT amount, also send bill_before_vat and bill_vat.
   NEVER tweak quantities or prices just to make totals match; re-read the bill instead.
7. preview_bill shows the user an interactive card. The user reviews and presses Save in the card. You cannot save bills:
   save_bill is only available to the card. If the user asks you to save, tell them to press บันทึก in the card.
   After preview_bill, write at most one short line.
8. To change the category, account, job or (existing) contact of a bill saved through this connector, use edit_bill,
   only after the user asks. Amounts and line items can only be changed in the app.
9. To add a seller/customer to the register outside a bill card (e.g. for a bill already saved), call add_contact
   (with link_tx_id to link it to that bill). It shows a card; the user checks the details and presses the button.
   You cannot add contacts directly.
Do not record bills the user did not send.`;

type Ctx = { db: SupabaseClient; me: ConnectorMe };

const text = (s: string, isError = false) => ({ content: [{ type: "text" as const, text: s }], ...(isError ? { isError: true } : {}) });
const json = (o: unknown) => text(JSON.stringify(o, null, 2));
/** คำตอบที่การ์ดอ่านได้ด้วย (structuredContent) — Claude ยังอ่านข้อความเหมือนเดิม */
const withSc = (o: Record<string, unknown>) => ({ ...json(o), structuredContent: o });

/** บริบทของกิจการสำหรับ checkBill — อ่านด้วยสิทธิ์ผู้ใช้ */
async function loadContext({ db, me }: Ctx, entityId: string): Promise<BillContext | string> {
  const [acc, set] = await Promise.all([
    db.from("bank_accounts").select("account_name, entity_ids, active").order("account_name"),
    db.from("app_settings").select("kind, value, sort").in("kind", ["expense_cat", "income_cat", FORWARD_CAT_KIND]).order("sort"),
  ]);
  // 🚨 อ่านไม่ได้ ≠ ไม่มีข้อมูล (D89) — ตอบ error แทนที่จะตรวจกับลิสต์ว่างแล้วบอกว่า "ไม่พบบัญชี"
  if (acc.error) return "อ่านบัญชีเงินไม่สำเร็จ: " + mapDbError(acc.error);
  if (set.error) return "อ่านหมวดหมู่ไม่สำเร็จ: " + mapDbError(set.error);
  const byKind = (k: string) => (set.data ?? []).filter((x) => x.kind === k).map((x) => String(x.value));
  const forwardCats = forwardCatsOf(byKind(FORWARD_CAT_KIND), hasModule(me.modules, "production"));
  const expense = byKind("expense_cat");
  return {
    entities: me.entities,
    accounts: accountsFor((acc.data ?? []) as { account_name: string; entity_ids: string[] | null; active: boolean | null }[], entityId).map((a) => a.account_name),
    forwardCats,
    // ชุดเดียวกับดร็อปดาวน์ใน EntryTab (cats + extraCats)
    categories: { รายจ่าย: [...expense, ...forwardCats.filter((c) => !expense.includes(c))], รายรับ: byKind("income_cat") },
    today: bangkokDateISO(),
  };
}

/** บิลล่าสุดของกิจการที่เอามาดูประวัติงาน — พอให้จัดอันดับ และไม่ทำ URL ยาวเกิน (in() ของ tx_id) */
const JOB_HISTORY_BILLS = 200;

/**
 * งานและหมวดสินค้าที่เคยใช้ของกิจการนี้ (คู่ค้าเจ้านี้ก่อน) + กิจการนี้ "ใช้งาน" ไหม (บังคับเลือกงาน)
 * ★ หมวดสินค้า (item_category · รอบ 5) ใช้ตัวจัดอันดับเดียวกับงาน แต่ **ไม่บังคับ**
 * 🚨 อ่านไม่ได้ = คืน error (ไม่เดาว่าไม่บังคับ — เดาผิด = บิลลงโดยไม่มีงานเงียบ ๆ)
 */
async function loadJobs({ db }: Ctx, entityId: string, contact: { id?: string; name?: string }): Promise<{ jobs: string[]; required: boolean; itemCats: string[] } | string> {
  const tx = await db
    .from("transactions")
    .select("tx_id, contact_id, contact_name")
    .eq("status", "ปกติ")
    .eq("entity_id", entityId)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(JOB_HISTORY_BILLS);
  if (tx.error) return "อ่านประวัติงานไม่สำเร็จ: " + mapDbError(tx.error);
  const bills = tx.data ?? [];
  if (!bills.length) return { jobs: [], required: false, itemCats: [] };
  const its = await db.from("transaction_items").select("tx_id, item_job, item_category").in("tx_id", bills.map((b) => b.tx_id));
  if (its.error) return "อ่านประวัติงานไม่สำเร็จ: " + mapDbError(its.error);
  const isContact = (b: { contact_id: string | null; contact_name: string | null }) =>
    contact.id ? b.contact_id === contact.id : Boolean(contact.name) && String(b.contact_name ?? "").trim() === String(contact.name).trim();
  const rank = (field: "item_job" | "item_category") => {
    const byTx = new Map<string, string[]>();
    for (const it of its.data ?? []) byTx.set(it.tx_id, [...(byTx.get(it.tx_id) ?? []), String(it[field] ?? "")]);
    return rankJobs(bills.filter(isContact).flatMap((b) => byTx.get(b.tx_id) ?? []), bills.flatMap((b) => byTx.get(b.tx_id) ?? []));
  };
  const jobs = rank("item_job");
  return { jobs, required: jobs.length > 0, itemCats: rank("item_category") };
}

/** บิลที่น่าจะซ้ำ (บันทึกไปแล้ว) — เลขใบกำกับเดียวกัน หรือ วันที่ + ยอดสุทธิ + คู่ค้าเดียวกัน */
async function findDuplicates({ db }: Ctx, d: BillDraft, net: number): Promise<{ tx_id: string; transaction_date: string; net_amount: number; tax_invoice_no: string | null }[] | string> {
  const cols = "tx_id, transaction_date, net_amount, tax_invoice_no, contact_name, contact_id";
  const invNo = String(d.tax_invoice_no ?? "").trim();
  const base = () => db.from("transactions").select(cols).eq("status", "ปกติ").eq("entity_id", d.entity_id).eq("type", d.type).limit(5);
  const [byInv, bySum] = await Promise.all([
    invNo ? base().eq("tax_invoice_no", invNo) : Promise.resolve({ data: [], error: null }),
    base().eq("transaction_date", d.transaction_date).eq("net_amount", net),
  ]);
  if (byInv.error || bySum.error) return "ตรวจบิลซ้ำไม่สำเร็จ: " + mapDbError(byInv.error ?? bySum.error);
  const sameContact = (r: { contact_name: string | null; contact_id: string | null }) =>
    d.contact_id ? r.contact_id === d.contact_id : String(r.contact_name ?? "").trim() === String(d.contact_name ?? "").trim();
  const seen = new Map<string, { tx_id: string; transaction_date: string; net_amount: number; tax_invoice_no: string | null }>();
  for (const r of [...(byInv.data ?? []), ...(bySum.data ?? [])] as { tx_id: string; transaction_date: string; net_amount: number; tax_invoice_no: string | null; contact_name: string | null; contact_id: string | null }[]) {
    if (sameContact(r)) seen.set(r.tx_id, { tx_id: r.tx_id, transaction_date: r.transaction_date, net_amount: Number(r.net_amount), tax_invoice_no: r.tax_invoice_no });
  }
  return [...seen.values()];
}

// ── คู่ค้า ─────────────────────────────────────────────────────────────────────
type Resolved = { draft: BillDraft; contact: CardContact; row?: ContactRow; error?: string };

/**
 * คู่ค้าของบิล: มีในทะเบียน (contact_id) · คู่ค้าใหม่ (new_contact → เช็คซ้ำก่อน) · ไม่ระบุ
 * ★ new_contact ที่เลขภาษี+สาขาตรงกับในทะเบียน = ผูกกับตัวเดิมเลย ไม่เพิ่มซ้ำ
 */
async function resolveContact({ db }: Ctx, d: BillDraft): Promise<Resolved | string> {
  if (d.contact_id) {
    const r = await db.from("contacts").select("contact_id, name, tax_id, branch").eq("contact_id", d.contact_id).maybeSingle();
    if (r.error) return "อ่านทะเบียนคู่ค้าไม่สำเร็จ: " + mapDbError(r.error);
    if (!r.data) return { draft: d, contact: { kind: "none" }, error: `ไม่พบคู่ค้า ${d.contact_id} ในทะเบียน — ใช้ find_contact ใหม่` };
    return { draft: { ...d, contact_name: d.contact_name || r.data.name }, contact: { kind: "existing", contact_id: r.data.contact_id, name: r.data.name, tax_id: r.data.tax_id } };
  }
  if (d.new_contact) {
    const row = newContactRow(d.new_contact, d.type);
    if (typeof row === "string") return { draft: d, contact: { kind: "none" }, error: row };
    const q = db.from("contacts").select("contact_id, name, tax_id, branch").limit(50);
    const r = await (row.tax_id ? q.eq("tax_id", row.tax_id) : q.eq("name", row.name));
    if (r.error) return "อ่านทะเบียนคู่ค้าไม่สำเร็จ: " + mapDbError(r.error);
    const found = findExistingContact(row, (r.data ?? []) as ExistingContact[]);
    if (found) {
      const { new_contact: _drop, ...rest } = d;
      void _drop;
      return { draft: { ...rest, contact_id: found.contact_id, contact_name: found.name }, contact: { kind: "existing", contact_id: found.contact_id, name: found.name, tax_id: found.tax_id } };
    }
    return { draft: { ...d, contact_name: row.name }, contact: { kind: "new", name: row.name, tax_id: row.tax_id, branch: row.branch, address: row.address }, row };
  }
  return { draft: d, contact: { kind: "none" } };
}

/** เพิ่มคู่ค้าเข้าทะเบียน — แบบเดียวกับ addContactAction ของแอป (next_serial CONTACT → C-0001) */
async function createContact({ db }: Ctx, row: ContactRow): Promise<string | { error: string }> {
  const { data: seq, error: seqErr } = await db.rpc("next_serial", { p_key: "CONTACT" });
  if (seqErr) return { error: "ออกเลขคู่ค้าไม่สำเร็จ: " + mapDbError(seqErr) };
  const contactId = "C-" + String(seq).padStart(4, "0");
  const { error } = await db.from("contacts").insert({ contact_id: contactId, ...row });
  if (error) return { error: "เพิ่มคู่ค้าไม่สำเร็จ: " + mapDbError(error) };
  return contactId;
}

// ── schema ของบิล (ใช้ทั้ง preview · recalc · save) ─────────────────────────────
const itemSchema = z.object({
  name: z.string().describe("Item name as printed"),
  quantity: z.number().describe("Quantity (> 0)"),
  unit_price: z.number().describe("Unit price as printed on the bill (VAT-inclusive or not per price_mode)"),
  discount_baht: z.number().optional().describe("Line discount in baht, same VAT basis as unit_price"),
  category: z.string().optional().describe("Item category of this line — prefer an existing name from lookup_options.item_categories; a new name only if none fits"),
  job: z.string().optional().describe("Job of this line (existing name from lookup_options or a new name)"),
  job_none: z.boolean().optional().describe("true = the user chose no job for this line (stored empty)"),
});

const contactSchema = z.object({
  name: z.string().describe("Seller/customer name as printed"),
  tax_id: z.string().optional().describe("13-digit tax ID as printed"),
  branch: z.string().optional().describe('"สำนักงานใหญ่" for head office, or the branch number as printed (e.g. 00152)'),
  address: z.string().optional().describe("Address as printed"),
});

const billShape = {
  entity_id: z.string().describe("Entity id from who_am_i, e.g. EID01"),
  type: z.enum(CONNECTOR_TYPES).describe("รายจ่าย = purchase/expense, รายรับ = income"),
  transaction_date: z.string().describe("Gregorian date YYYY-MM-DD (convert Buddhist-era years: subtract 543)"),
  category: z.string().describe("Exact category name from lookup_options"),
  description: z.string().optional().describe("Short Thai description of the bill"),
  contact_name: z.string().optional().describe("Seller/customer name (use the name from find_contact when found)"),
  contact_id: z.string().optional().describe("contact_id from find_contact (exact branch)"),
  new_contact: contactSchema.optional().describe("Seller/customer not found by find_contact — shown in the card and added to the register when the user saves"),
  account_name: z.string().optional().describe("Exact money account name from lookup_options; omit when unpaid"),
  price_mode: z.enum(["in", "ex"]).describe('"in" = unit prices include VAT, "ex" = VAT added on top'),
  has_vat: z.boolean().describe("Bill charges 7% VAT"),
  bill_discount: z.number().optional().describe("Bill-level discount in baht, same VAT basis as prices"),
  wht_rate: z.number().optional().describe("Withholding tax % (usually 0, 1, 3 or 5)"),
  tax_invoice_no: z.string().optional().describe("Tax invoice number printed on the bill"),
  tax_invoice_date: z.string().optional().describe("Tax invoice date YYYY-MM-DD if different from transaction_date"),
  unpaid: z.boolean().optional().describe("true = record as accounts payable/receivable (not yet paid)"),
  due_date: z.string().optional().describe("Due date YYYY-MM-DD when unpaid"),
  items: z.array(itemSchema).describe("Line items exactly as printed"),
  total_on_bill: z.number().describe("Grand total printed on the bill (incl. VAT, before withholding tax). Used only to cross-check."),
  bill_before_vat: z.number().optional().describe("Subtotal before VAT as printed on the bill, if printed"),
  bill_vat: z.number().optional().describe("VAT amount as printed on the bill, if printed"),
  use_bill_amounts: z.boolean().optional().describe("Save with the printed before-VAT/VAT amounts when they differ from the computed ones by at most 1 baht (vendor rounding). Only after the user agrees."),
};

/** หมวดที่คู่ค้าเจ้านี้เคยใช้ (ใหม่สุดก่อน) — ไว้เสนอเป็นปุ่มในการ์ด */
async function contactCategoryHistory({ db }: Ctx, d: BillDraft): Promise<string[]> {
  const who = String(d.contact_id || d.contact_name || "").trim();
  if (!who) return [];
  const r = await db
    .from("transactions")
    .select("category")
    .eq("status", "ปกติ")
    .eq("entity_id", d.entity_id)
    .eq("type", d.type)
    .eq(d.contact_id ? "contact_id" : "contact_name", who)
    .order("transaction_date", { ascending: false })
    .limit(20);
  // อ่านไม่ได้ = ไม่มีปุ่มเสนอเพิ่ม (ไม่ใช่ด่าน · ปุ่ม "อื่น ๆ" ยังกางหมวดทั้งหมดได้)
  return r.error ? [] : (r.data ?? []).map((x) => String(x.category ?? ""));
}

/** ตรวจทั้งบิล: คู่ค้า + งาน + ยอด — ใช้ทั้งการ์ด (preview/recalc) และตอนบันทึก */
async function evaluate(ctx: Ctx, input: BillDraft): Promise<{ resolved: Resolved; c: BillContext; jobs: string[]; itemCats: string[]; check: CheckResult } | string> {
  const resolved = await resolveContact(ctx, input);
  if (typeof resolved === "string") return resolved;
  const d = resolved.draft;
  const c0 = await loadContext(ctx, d.entity_id);
  if (typeof c0 === "string") return c0;
  const j = await loadJobs(ctx, d.entity_id, { id: d.contact_id, name: d.contact_name });
  if (typeof j === "string") return j;
  const c: BillContext = { ...c0, jobsRequired: j.required };
  const check = checkBill(d, c);
  if (resolved.error) check.errors.unshift(resolved.error);
  return { resolved, c, jobs: j.jobs, itemCats: j.itemCats, check };
}

/**
 * ตรวจ + ประกอบข้อมูลการ์ด — ใช้ทั้ง preview_bill (Claude เรียก) และ recalc_bill (การ์ดเรียก)
 * 🚨 ตัวเลขทุกตัวมาจาก checkBill (entryCalc ตัวเดิม) — การ์ดไม่คิดเงินเอง
 */
async function previewCard(ctx: Ctx, input: BillDraft): Promise<{ card: CardData; check: CheckResult } | string> {
  const e = await evaluate(ctx, input);
  if (typeof e === "string") return e;
  const { resolved, c, jobs, itemCats, check } = e;
  const d = resolved.draft;
  let dup: Awaited<ReturnType<typeof findDuplicates>> = [];
  if (check.computed) {
    dup = await findDuplicates(ctx, d, check.computed.net_amount);
    if (typeof dup === "string") return dup;
  }
  const history = await contactCategoryHistory(ctx, d);
  const mm = check.mismatch && !check.usedBillAmounts ? mismatchText(check.mismatch, d.items) : null;
  const ent = ctx.me.entities.find((x) => x.entity_id === d.entity_id);
  const card: CardData = {
    v: 1,
    tenant_slug: ctx.me.tenantSlug,
    tenant_name: ctx.me.tenantName,
    draft: d,
    entities: ctx.me.entities,
    category_chips: categoryChips(d.category, history, c.categories[d.type] ?? []),
    categories_all: [...(c.categories[d.type] ?? [])],
    accounts: c.accounts,
    jobs,
    jobs_required: Boolean(c.jobsRequired),
    item_categories: itemCats,
    contact: resolved.contact,
    vat_effective: Boolean(d.has_vat && ent?.is_vat),
    computed: check.computed,
    mismatch: check.mismatch,
    used_bill_amounts: check.usedBillAmounts,
    // ยอดไม่ตรงอยู่ใน mismatch แล้ว — แยกออกให้การ์ดตัดสินปุ่มเอง (cardView.primaryAction)
    errors: check.errors.filter((x) => x !== mm),
    warnings: resolved.contact.kind === "none" ? [...check.warnings, NO_CONTACT_WARN] : check.warnings,
    possible_duplicates: dup,
  };
  return { card, check };
}

const NO_CONTACT_WARN = "บิลนี้ไม่ได้ผูกคู่ค้าในทะเบียน — ภพ.30/ภงด. จะไม่มีเลขผู้เสียภาษีของคู่ค้าใบนี้ (ถ้าบิลมีเลขภาษี ให้ Claude ส่งเป็นคู่ค้าใหม่)";

function asDraft(a: z.infer<z.ZodObject<typeof billShape>>): BillDraft {
  return { ...a, type: a.type as ConnectorType };
}

const slugOk = (me: ConnectorMe, slug: string | undefined) => String(slug ?? "").trim().toLowerCase() === me.tenantSlug.toLowerCase();
const slugError = (me: ConnectorMe, slug: string | undefined) =>
  text(`ไม่บันทึก: tenant_slug "${slug}" ไม่ตรงกับบัญชีที่เชื่อมต่ออยู่ (${me.tenantSlug} · ${me.tenantName}) — ตรวจว่าใช้ connector ของลูกค้าถูกเจ้า`, true);

export function buildServer(ctx: Ctx): McpServer {
  const { db, me } = ctx;
  const server = new McpServer({ name: "insep-erp", version: "1.0.0" }, { instructions: SERVER_INSTRUCTIONS });

  server.registerTool(
    "who_am_i",
    {
      title: "ต่ออยู่กับลูกค้าไหน",
      description: "Returns the signed-in user, the customer (tenant) and the businesses (entities) bills can be recorded into. Call first.",
      annotations: { readOnlyHint: true },
    },
    async () =>
      json({
        tenant_slug: me.tenantSlug,
        tenant_name: me.tenantName,
        user: me.username,
        role: me.role,
        entities: me.entities.map((e) => ({ entity_id: e.entity_id, name: e.name, vat_registered: e.is_vat })),
        note: me.entities.length === 1 ? "มีกิจการเดียว — ใช้ entity_id นี้ทุกบิล" : "มีหลายกิจการ — ถามผู้ใช้ถ้าไม่แน่ใจว่าบิลนี้เป็นของกิจการไหน",
      }),
  );

  server.registerTool(
    "find_contact",
    {
      title: "ค้นคู่ค้า",
      description: "Find a seller/customer by 13-digit Thai tax ID or by name. Returns contact_id per branch. Not found = pass new_contact to preview_bill.",
      inputSchema: {
        tax_id: z.string().optional().describe("13-digit tax ID (dashes allowed)"),
        name: z.string().optional().describe("Part of the name"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ tax_id, name }) => {
      const tid = normalizeTaxId(tax_id);
      const q = String(name ?? "").trim();
      if (!tid && !q) return text("ส่ง tax_id หรือ name อย่างน้อยหนึ่งอย่าง", true);
      const notes: string[] = [];
      if (tid && !taxIdValid(tid)) notes.push(`เลข ${tid} ไม่ผ่านการตรวจหลักสุดท้าย — น่าจะอ่านผิดหลัก ให้อ่านเลขบนบิลใหม่อีกครั้ง`);
      let sel = db.from("contacts").select("contact_id, name, tax_id, branch, contact_type").order("name").limit(10);
      sel = tid ? sel.eq("tax_id", tid) : sel.ilike("name", `%${q.replace(/[%_]/g, "")}%`);
      const { data, error } = await sel;
      if (error) return text("ค้นคู่ค้าไม่สำเร็จ: " + mapDbError(error), true);
      if (!data?.length) notes.push("ไม่พบคู่ค้าในระบบ — อ่านชื่อ เลขผู้เสียภาษี สาขา ที่อยู่ จากบิล แล้วส่งเป็น new_contact ใน preview_bill (เพิ่มเข้าทะเบียนตอนผู้ใช้กดบันทึก)");
      return json({ matches: data ?? [], notes });
    },
  );

  server.registerTool(
    "lookup_options",
    {
      title: "ตัวเลือกหมวด/บัญชี/งาน",
      description: "Exact category names, money accounts, withholding rates, jobs and item categories for an entity (jobs_required = every line needs a job or job_none), plus the last 5 bills of a contact.",
      inputSchema: {
        entity_id: z.string(),
        type: z.enum(CONNECTOR_TYPES),
        contact_id: z.string().optional(),
        contact_name: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ entity_id, type, contact_id, contact_name }) => {
      const c = await loadContext(ctx, entity_id);
      if (typeof c === "string") return text(c, true);
      const j = await loadJobs(ctx, entity_id, { id: contact_id, name: contact_name });
      if (typeof j === "string") return text(j, true);
      const wht = await db.from("app_settings").select("value").eq("kind", "wht_rate").order("sort");
      let recent: unknown[] = [];
      const who = String(contact_id || contact_name || "").trim();
      if (who) {
        const r = await db
          .from("transactions")
          .select("tx_id, transaction_date, category, description, net_amount, account_name")
          .eq("status", "ปกติ")
          .eq("entity_id", entity_id)
          .eq(contact_id ? "contact_id" : "contact_name", who)
          .order("transaction_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(5);
        if (r.error) return text("อ่านบิลก่อนหน้าของคู่ค้าไม่สำเร็จ: " + mapDbError(r.error), true);
        const bills = r.data ?? [];
        // รายการของบิลเหล่านี้ (แพตเทิร์นเดียวกับ getRecentBillsByContact — ไม่พึ่ง embed ข้าม FK composite)
        const its = bills.length
          ? await db.from("transaction_items").select("tx_id, item_name, item_category, item_job").in("tx_id", bills.map((b) => b.tx_id)).order("item_id")
          : { data: [], error: null };
        if (its.error) return text("อ่านรายการของบิลก่อนหน้าไม่สำเร็จ: " + mapDbError(its.error), true);
        recent = bills.map((b) => ({ ...b, items: (its.data ?? []).filter((i) => i.tx_id === b.tx_id).map((i) => ({ item_name: i.item_name, item_category: i.item_category, item_job: i.item_job })) }));
      }
      return json({
        categories: c.categories[type],
        accounts: c.accounts,
        wht_rates: (wht.data ?? []).map((x) => x.value),
        jobs: j.jobs,
        jobs_required: j.required,
        item_categories: j.itemCats,
        recent_bills_of_contact: recent,
      });
    },
  );

  registerAppTool(
    server,
    "preview_bill",
    {
      title: "ตรวจบิลก่อนบันทึก",
      description: "Validate and compute a bill WITHOUT saving, and show the user an interactive card to review, adjust and save it. Returns errors (re-read the bill), warnings and a summary.",
      inputSchema: billShape,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: BILL_CARD_URI } },
    },
    async (a) => {
      const r = await previewCard(ctx, asDraft(a));
      if (typeof r === "string") return text(r, true);
      const { card, check } = r;
      const d = card.draft;
      const ent = me.entities.find((e) => e.entity_id === d.entity_id);
      return {
        ...json({
          ok: card.errors.length === 0 && !card.mismatch,
          errors: check.errors,
          warnings: card.warnings,
          contact: card.contact,
          possible_duplicates: card.possible_duplicates,
          summary: check.computed && ent ? previewSummary(d, ent.name, me.tenantName, check.computed) : null,
          computed: check.computed,
          card: "แสดงการ์ดให้ผู้ใช้แล้ว — ผู้ใช้ตรวจ/แก้/กดบันทึกในการ์ดเอง (Claude บันทึกเองไม่ได้)",
        }),
        structuredContent: card,
      };
    },
  );

  // การ์ดเรียกตัวนี้ทุกครั้งที่ผู้ใช้กดเลือกหรือแก้รายการ — Claude มองไม่เห็น (visibility: app)
  registerAppTool(
    server,
    "recalc_bill",
    {
      title: "คิดยอดบิลใหม่ (การ์ด)",
      description: "Recompute the bill card after the user changes a choice or a line item. Called by the card only.",
      inputSchema: billShape,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: BILL_CARD_URI, visibility: ["app"] } },
    },
    async (a) => {
      const r = await previewCard(ctx, asDraft(a));
      if (typeof r === "string") return text(r, true);
      return { ...text(r.card.errors[0] ?? "ok"), structuredContent: r.card };
    },
  );

  registerAppResource(server, "การ์ดตรวจบิล", BILL_CARD_URI, { description: "Interactive bill review card" }, async () => ({
    contents: [{ uri: BILL_CARD_URI, mimeType: RESOURCE_MIME_TYPE, text: BILL_CARD_HTML }],
  }));

  // 🚨 บันทึกได้จากการ์ดทางเดียว (visibility: app) — การกดปุ่มในการ์ดคือการยืนยันของผู้ใช้
  registerAppTool(
    server,
    "save_bill",
    {
      title: "บันทึกบิล (การ์ด)",
      description: "Save the bill into the ERP. Called by the card when the user presses Save. tenant_slug must equal who_am_i.tenant_slug.",
      inputSchema: {
        tenant_slug: z.string().describe("Must equal tenant_slug from who_am_i — guards against writing into the wrong customer"),
        confirm_not_duplicate: z.boolean().optional().describe("true only after the user confirmed a possible duplicate is a new bill"),
        ...billShape,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      _meta: { ui: { resourceUri: BILL_CARD_URI, visibility: ["app"] } },
    },
    async ({ tenant_slug, confirm_not_duplicate, ...rest }) => {
      // 🚨 ด่านลงผิดเจ้า: connector หลายตัวเปิดพร้อมกันได้ — ชื่อย่อต้องตรงกับเจ้าของ token
      if (!slugOk(me, tenant_slug)) return slugError(me, tenant_slug);
      const e = await evaluate(ctx, asDraft(rest));
      if (typeof e === "string") return text(e, true);
      const { resolved, c, check } = e;
      let d = resolved.draft;
      if (!check.payload || !check.computed) return withSc({ ok: false, errors: check.errors, warnings: check.warnings });
      const dup = await findDuplicates(ctx, d, check.computed.net_amount);
      if (typeof dup === "string") return text(dup, true);
      if (dup.length && !confirm_not_duplicate) {
        return withSc({ ok: false, errors: ["มีบิลที่หน้าตาเหมือนกันอยู่แล้ว — ถามผู้ใช้ก่อน ถ้าเป็นบิลใหม่จริงให้ส่ง confirm_not_duplicate = true"], possible_duplicates: dup });
      }
      // คู่ค้าใหม่: เพิ่มเข้าทะเบียนหลังด่านทุกตัวผ่านแล้ว (ล้มตรงไหนก่อนหน้านี้ = ไม่มีคู่ค้างอกค้าง)
      let addedContact: string | null = null;
      let payload = check.payload;
      if (resolved.row) {
        const id = await createContact(ctx, resolved.row);
        if (typeof id !== "string") return withSc({ ok: false, errors: [id.error] });
        addedContact = id;
        const { new_contact: _drop, ...rest2 } = d;
        void _drop;
        d = { ...rest2, contact_id: id, contact_name: resolved.row.name };
        const again = checkBill(d, c);
        if (!again.payload) return withSc({ ok: false, errors: again.errors, warnings: again.warnings, added_contact: id });
        payload = again.payload;
      }
      const { data, error } = await db.rpc("fn_save_transaction", { p: payload.p, p_items: payload.items });
      if (error) return withSc({ ok: false, errors: ["บันทึกไม่สำเร็จ: " + mapDbError(error)], added_contact: addedContact });
      const res = data as { ok: boolean; tx_id: string; warning?: string | null };
      const ent = me.entities.find((x) => x.entity_id === d.entity_id);
      return withSc({
        ok: true,
        tx_id: res.tx_id,
        added_contact: addedContact,
        // บันทึกได้บางส่วน ≠ สำเร็จ (D79) — เช่น รับวัตถุดิบเข้าสต็อกไม่สำเร็จ ต้องบอกผู้ใช้
        warnings: [...check.warnings, ...(res.warning ? [res.warning] : [])],
        summary: ent ? previewSummary(d, ent.name, me.tenantName, check.computed) : null,
        where_to_check: "แอป → บัญชี → ค้นบิล (แก้/ลบได้ที่นั่น)",
      });
    },
  );

  server.registerTool(
    "edit_bill",
    {
      title: "แก้บิลที่บันทึกผ่าน Claude",
      description: "Change category, money account, job(s), item categories or contact of a bill saved through this connector. Never changes amounts or line items. Only after the user asks.",
      inputSchema: {
        tenant_slug: z.string().describe("Must equal tenant_slug from who_am_i"),
        tx_id: z.string().describe("Bill id, e.g. TR-20261028-0002"),
        category: z.string().optional().describe("New exact category name from lookup_options"),
        account_name: z.string().optional().describe("New exact money account name (paid bills only)"),
        contact_id: z.string().optional().describe("Link to an existing contact (to add a new one use add_contact with link_tx_id)"),
        job_all: z.string().optional().describe("Set this job on every line"),
        job_none_all: z.boolean().optional().describe("true = clear the job on every line"),
        jobs: z.array(z.object({ line: z.number().describe("Line number starting at 1"), job: z.string().optional(), none: z.boolean().optional() })).optional()
          .describe("Per-line jobs"),
        item_categories: z.array(z.object({ line: z.number().describe("Line number starting at 1"), category: z.string().describe("Item category ('' = clear)") })).optional()
          .describe("Per-line item categories"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (a) => {
      if (!slugOk(me, a.tenant_slug)) return slugError(me, a.tenant_slug);
      const r = await editBill(ctx, a);
      return typeof r === "string" ? text(r, true) : json(r);
    },
  );

  const contactShape = {
    ...contactSchema.shape,
    type: z.enum(CONNECTOR_TYPES).optional().describe("รายจ่าย = seller (default), รายรับ = customer"),
    link_tx_id: z.string().optional().describe("Bill saved through this connector to link after adding (e.g. TR-20261028-0002)"),
  };

  registerAppTool(
    server,
    "add_contact",
    {
      title: "เพิ่มคู่ค้าใหม่ (การ์ด)",
      description: "Show a card for the user to check and add a seller/customer to the register (optionally linking a bill saved through this connector). Does not add anything by itself.",
      inputSchema: contactShape,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: BILL_CARD_URI } },
    },
    async (a) => {
      const card = await contactCard(ctx, a);
      if (typeof card === "string") return text(card, true);
      return { ...json({ card: "แสดงการ์ดคู่ค้าให้ผู้ใช้แล้ว — ผู้ใช้ตรวจแล้วกดเพิ่มเอง", error: card.error, existing: card.existing, link: card.link }), structuredContent: card };
    },
  );

  registerAppTool(
    server,
    "recalc_contact",
    {
      title: "ตรวจคู่ค้าใหม่ (การ์ด)",
      description: "Re-check the contact card after the user edits a field. Called by the card only.",
      inputSchema: contactShape,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: BILL_CARD_URI, visibility: ["app"] } },
    },
    async (a) => {
      const card = await contactCard(ctx, a);
      if (typeof card === "string") return text(card, true);
      return { ...text(card.error ?? "ok"), structuredContent: card };
    },
  );

  // 🚨 เพิ่มคู่ค้าได้จากการ์ดทางเดียว — การกดปุ่มในการ์ดคือการยืนยันของผู้ใช้
  registerAppTool(
    server,
    "create_contact",
    {
      title: "เพิ่มคู่ค้า (การ์ด)",
      description: "Add the checked contact to the register (and link the bill). Called by the card when the user presses the button.",
      inputSchema: { tenant_slug: z.string(), ...contactShape },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      _meta: { ui: { resourceUri: BILL_CARD_URI, visibility: ["app"] } },
    },
    async ({ tenant_slug, ...a }) => {
      if (!slugOk(me, tenant_slug)) return slugError(me, tenant_slug);
      // ตรวจใหม่ทั้งหมด ไม่เชื่อผลของการ์ดรอบก่อน
      const card = await contactCard(ctx, a);
      if (typeof card === "string") return text(card, true);
      if (card.error || (!card.row && !card.existing) || card.link?.error) {
        return withSc({ ok: false, errors: [card.error ?? card.link?.error ?? "ข้อมูลคู่ค้าไม่ครบ"] });
      }
      let contactId = card.existing?.contact_id ?? null;
      let created = false;
      if (!contactId && card.row) {
        const id = await createContact(ctx, card.row);
        if (typeof id !== "string") return withSc({ ok: false, errors: [id.error] });
        contactId = id;
        created = true;
      }
      let linked: string | null = null;
      if (card.link && contactId) {
        const r = await editBill(ctx, { tx_id: card.link.tx_id, contact_id: contactId });
        if (typeof r === "string") return withSc({ ok: false, contact_id: contactId, created, errors: [`${created ? "เพิ่มคู่ค้าแล้ว" : "พบคู่ค้า"} ${contactId} แต่ผูกกับบิลไม่สำเร็จ: ${r}`] });
        linked = card.link.tx_id;
      }
      return withSc({ ok: true, contact_id: contactId, created, linked });
    },
  );

  return server;
}

/** ตรวจคู่ค้าใหม่ + หาตัวซ้ำ + บิลที่จะผูก → ข้อมูลการ์ดคู่ค้า */
async function contactCard(
  ctx: Ctx,
  a: { name: string; tax_id?: string; branch?: string; address?: string; type?: ConnectorType; link_tx_id?: string },
): Promise<ContactCardData | string> {
  const type: ConnectorType = a.type ?? "รายจ่าย";
  const res = await resolveContact(ctx, { type, new_contact: { name: a.name, tax_id: a.tax_id, branch: a.branch, address: a.address } } as BillDraft);
  if (typeof res === "string") return res;
  let link: ContactCardData["link"] = null;
  if (a.link_tx_id) {
    const t = await ctx.db.from("transactions").select("tx_id, transaction_date, contact_name, net_amount, source, status").eq("tx_id", a.link_tx_id).maybeSingle();
    if (t.error) return "อ่านบิลไม่สำเร็จ: " + mapDbError(t.error);
    const tx = t.data;
    link = {
      tx_id: a.link_tx_id,
      summary: tx ? `${tx.transaction_date} · ${tx.contact_name ?? "(ไม่มีชื่อคู่ค้า)"} · ${Number(tx.net_amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "",
      error: !tx ? `ไม่พบบิล ${a.link_tx_id}`
        : tx.source !== "claude" ? `บิล ${a.link_tx_id} ไม่ได้บันทึกผ่าน Claude — ผูกคู่ค้าได้ที่แอป บัญชี → ค้นบิล`
        : tx.status !== "ปกติ" ? `บิล ${a.link_tx_id} ถูกยกเลิกแล้ว` : null,
    };
  }
  const existing = res.contact.kind === "existing"
    ? { contact_id: res.contact.contact_id, name: res.contact.name, tax_id: res.contact.tax_id, branch: null }
    : null;
  return {
    v: 1,
    kind: "contact",
    tenant_slug: ctx.me.tenantSlug,
    tenant_name: ctx.me.tenantName,
    input: { name: a.name, tax_id: a.tax_id, branch: a.branch, address: a.address, type },
    row: res.row ?? null,
    existing,
    error: res.error ?? null,
    link,
  };
}

// ── แก้บิลหลังบันทึก (หมวด · บัญชี · งาน · หมวดสินค้า · คู่ค้า) ─────────────────────────────────
type EditInput = {
  tx_id: string; category?: string; account_name?: string; contact_id?: string;
  job_all?: string; job_none_all?: boolean;
  jobs?: { line: number; job?: string; none?: boolean }[];
  item_categories?: { line: number; category: string }[];
};

const TX_COLS = "tx_id, transaction_date, type, account_name, category, contact_name, contact_id, description, base_amount, discount, amount_after_discount, vat_amount, wht_rate, wht_amount, net_amount, tax_invoice_no, tax_invoice_date, entity_id, source, status, ap_ar_status";

/**
 * แก้บิลที่บันทึกผ่าน Claude — ผ่าน fn_edit_transaction ตัวเดียวกับหน้าแก้บิลในแอป
 * 🚨 ไม่แตะยอดเงิน/รายการ (ส่งค่าเดิมกลับทุกช่อง) — แก้ยอดต้องดูกระดาษ ทำในแอป
 * 🚨 เฉพาะ source = claude · สถานะปกติ · หมวดที่จุดชนวนรับวัตถุดิบห้ามสลับเข้า/ออก (สต็อกผลิตไม่ตามให้)
 * 🚨 บิลค้างจ่าย/รับ ห้ามเปลี่ยนบัญชี (บัญชีของบิลค้างตั้งตอนเคลีย)
 */
async function editBill(ctx: Ctx, a: EditInput): Promise<Record<string, unknown> | string> {
  const { db } = ctx;
  const t = await db.from("transactions").select(TX_COLS).eq("tx_id", a.tx_id).maybeSingle();
  if (t.error) return "อ่านบิลไม่สำเร็จ: " + mapDbError(t.error);
  const tx = t.data as Record<string, unknown> | null;
  if (!tx) return `ไม่พบบิล ${a.tx_id}`;
  if (tx.source !== "claude") return `บิล ${a.tx_id} ไม่ได้บันทึกผ่าน Claude — แก้ได้ที่แอป บัญชี → ค้นบิล`;
  if (tx.status !== "ปกติ") return `บิล ${a.tx_id} ถูกยกเลิกแล้ว แก้ไม่ได้`;
  const type = tx.type as ConnectorType;
  const c = await loadContext(ctx, String(tx.entity_id));
  if (typeof c === "string") return c;
  const changes: string[] = [];
  const p: Record<string, unknown> = { ...tx };

  if (a.category !== undefined && a.category.trim() !== tx.category) {
    const cat = a.category.trim();
    if (!(c.categories[type] ?? []).includes(cat)) return `ไม่มีหมวด "${cat}" ใน${type}ของกิจการนี้ — ใช้ชื่อจาก lookup_options`;
    if (isForwardCat(cat, c.forwardCats) || isForwardCat(String(tx.category ?? ""), c.forwardCats)) {
      return "หมวดนี้เกี่ยวกับการรับวัตถุดิบเข้าสต็อกผลิต — เปลี่ยนเข้า/ออกจากหมวดนี้ต้องทำในแอป (สต็อกไม่ตามให้)";
    }
    changes.push(`หมวด ${tx.category} → ${cat}`);
    p.category = cat;
  }
  if (a.account_name !== undefined && a.account_name.trim() !== tx.account_name) {
    if (tx.ap_ar_status) return "บิลนี้ตั้งค้างอยู่ — บัญชีจะถูกตั้งตอนเคลียที่แอป (แท็บ ลูกหนี้-เจ้าหนี้)";
    const acc = a.account_name.trim();
    if (!c.accounts.includes(acc)) return `ไม่พบบัญชีเงิน "${acc}" ในกิจการนี้ — ใช้ชื่อจาก lookup_options`;
    changes.push(`บัญชี ${tx.account_name} → ${acc}`);
    p.account_name = acc;
  }
  // 🚨 รอบ 4: ผูกได้เฉพาะคู่ค้าที่มีในทะเบียนแล้ว — เพิ่มคู่ค้าใหม่ต้องผ่านการ์ด add_contact ให้ผู้ใช้รีเช็คก่อน
  if (a.contact_id && a.contact_id !== tx.contact_id) {
    const res = await resolveContact(ctx, { type, contact_id: a.contact_id } as BillDraft);
    if (typeof res === "string") return res;
    if (res.error) return res.error;
    changes.push(`คู่ค้า → ${a.contact_id} ${res.draft.contact_name ?? ""}`.trim());
    p.contact_id = a.contact_id;
    p.contact_name = res.draft.contact_name;
  }

  const it = await db
    .from("transaction_items")
    .select("item_name, quantity, in_vat, ex_vat, total_price, discount_pct, discount_baht, item_category, item_job")
    .eq("tx_id", a.tx_id)
    .order("item_id");
  if (it.error) return "อ่านรายการของบิลไม่สำเร็จ: " + mapDbError(it.error);
  const items = (it.data ?? []).map((x) => ({ ...x }));
  const setJob = (i: number, job: string) => {
    if (String(items[i].item_job ?? "") !== job) changes.push(`รายการที่ ${i + 1} งาน → ${job || "(ไม่ระบุ)"}`);
    items[i].item_job = job;
  };
  if (a.job_none_all) items.forEach((_, i) => setJob(i, ""));
  else if (a.job_all !== undefined) items.forEach((_, i) => setJob(i, a.job_all!.trim()));
  for (const j of a.jobs ?? []) {
    const i = j.line - 1;
    if (!items[i]) return `ไม่มีรายการที่ ${j.line} ในบิลนี้ (มี ${items.length} รายการ)`;
    setJob(i, j.none ? "" : String(j.job ?? "").trim());
  }
  for (const x of a.item_categories ?? []) {
    const i = x.line - 1;
    if (!items[i]) return `ไม่มีรายการที่ ${x.line} ในบิลนี้ (มี ${items.length} รายการ)`;
    const v = String(x.category ?? "").trim();
    if (String(items[i].item_category ?? "") !== v) changes.push(`รายการที่ ${i + 1} หมวดสินค้า → ${v || "(ไม่ระบุ)"}`);
    items[i].item_category = v;
  }

  if (!changes.length) return { ok: true, tx_id: a.tx_id, changes: [], note: "ไม่มีอะไรเปลี่ยน" };
  delete p.source; delete p.status; delete p.ap_ar_status; delete p.tx_id;
  const { data, error } = await db.rpc("fn_edit_transaction", { p_tx_id: a.tx_id, p, p_items: items });
  if (error) return "แก้บิลไม่สำเร็จ: " + mapDbError(error);
  const res = data as { ok: boolean; error?: string };
  if (!res.ok) return res.error ?? "แก้บิลไม่สำเร็จ";
  return { ok: true, tx_id: a.tx_id, changes };
}
