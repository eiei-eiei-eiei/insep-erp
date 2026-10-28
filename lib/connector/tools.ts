import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { accountsFor } from "@/lib/accounting/bankAccounts";
import { forwardCatsOf, FORWARD_CAT_KIND } from "@/lib/accounting/forwardCats";
import { hasModule } from "@/lib/shared/workspaces";
import { mapDbError } from "@/lib/shared/dbError";
import { bangkokDateISO } from "@/lib/shared/datetime";
import { checkBill, previewSummary, taxIdValid, normalizeTaxId, CONNECTOR_TYPES, type BillDraft, type BillContext, type ConnectorType } from "./bill";
import type { ConnectorMe } from "./session";

/**
 * เครื่องมือของ Claude connector (D141) — 5 ตัว · รอบแรกบันทึกได้แค่ รายจ่าย/รายรับ (+ ตั้งค้าง)
 *
 * 🚨 ทุกคำสั่งอ่าน/เขียนผ่าน `db` ที่ทำงานในนามผู้ใช้ (RLS) — ไม่มี service role
 * 🚨 save_bill เรียก fn_save_transaction ตัวเดียวกับฟอร์ม · ยอดเงินคิดใหม่ทุกครั้งด้วย checkBill()
 *    (ไม่เชื่อผลของ preview รอบก่อน)
 * ★ คำอธิบายเครื่องมือเขียนเป็นภาษาอังกฤษ (คนอ่านคือ Claude) · ข้อความที่ผู้ใช้เห็นเป็นภาษาไทย
 */

/** ข้อความที่ Claude ได้ตอนเชื่อมต่อ — ขั้นตอนบังคับ */
export const SERVER_INSTRUCTIONS = `This connector records purchase/sales bills into a Thai ERP (accounting module).
Workflow for every bill image the user sends:
1. Call who_am_i once per conversation. Tell the user which customer (tenant) and business (entity) you are writing into.
2. Read the bill carefully. Thai bills often print Buddhist-era years (2569 = 2026): always send transaction_date in Gregorian YYYY-MM-DD.
3. Call find_contact with the seller's 13-digit tax ID (or name) to get contact_id.
4. Call lookup_options to get the exact category names and money accounts; prefer the category the same contact used before.
5. Call preview_bill. Send total_on_bill = the grand total printed on the bill (incl. VAT, before withholding tax) read independently from the line items.
   price_mode "in" when unit prices already include VAT, "ex" when VAT is added below the subtotal.
6. If preview_bill returns errors, re-read the bill. NEVER tweak quantities or prices just to make totals match.
7. Show the user the preview summary and every warning verbatim, then call save_bill with the same values only after the user agrees.
Do not record bills the user did not send. One bill per save_bill call.`;

type Ctx = { db: SupabaseClient; me: ConnectorMe };

const text = (s: string, isError = false) => ({ content: [{ type: "text" as const, text: s }], ...(isError ? { isError: true } : {}) });
const json = (o: unknown) => text(JSON.stringify(o, null, 2));

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

// ── schema ของบิล (ใช้ทั้ง preview และ save) ─────────────────────────────────
const itemSchema = z.object({
  name: z.string().describe("Item name as printed"),
  quantity: z.number().describe("Quantity (> 0)"),
  unit_price: z.number().describe("Unit price as printed on the bill (VAT-inclusive or not per price_mode)"),
  discount_baht: z.number().optional().describe("Line discount in baht, same VAT basis as unit_price"),
  category: z.string().optional().describe("Optional item category (free text)"),
  job: z.string().optional().describe("Optional job/project tag (free text)"),
});

const billShape = {
  entity_id: z.string().describe("Entity id from who_am_i, e.g. EID01"),
  type: z.enum(CONNECTOR_TYPES).describe("รายจ่าย = purchase/expense, รายรับ = income"),
  transaction_date: z.string().describe("Gregorian date YYYY-MM-DD (convert Buddhist-era years: subtract 543)"),
  category: z.string().describe("Exact category name from lookup_options"),
  description: z.string().optional().describe("Short Thai description of the bill"),
  contact_name: z.string().optional().describe("Seller/customer name (use the name from find_contact when found)"),
  contact_id: z.string().optional().describe("contact_id from find_contact (exact branch)"),
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
};

function asDraft(a: z.infer<z.ZodObject<typeof billShape>>): BillDraft {
  return { ...a, type: a.type as ConnectorType };
}

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
      description: "Find a seller/customer by 13-digit Thai tax ID or by name. Returns contact_id per branch.",
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
      if (!data?.length) notes.push("ไม่พบคู่ค้าในระบบ — บันทึกด้วย contact_name ได้ (ยังไม่สร้างคู่ค้าใหม่ให้ · เพิ่มได้ในแอป ตั้งค่า → คู่ค้า)");
      return json({ matches: data ?? [], notes });
    },
  );

  server.registerTool(
    "lookup_options",
    {
      title: "ตัวเลือกหมวด/บัญชี",
      description: "Exact category names, money accounts and withholding rates for an entity, plus the last 5 bills of a contact (to reuse its category/job).",
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
        recent_bills_of_contact: recent,
      });
    },
  );

  server.registerTool(
    "preview_bill",
    {
      title: "ตรวจบิลก่อนบันทึก",
      description: "Validate and compute a bill WITHOUT saving. Returns errors (must fix by re-reading the bill), warnings (tell the user) and a summary to show the user.",
      inputSchema: billShape,
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const d = asDraft(a);
      const c = await loadContext(ctx, d.entity_id);
      if (typeof c === "string") return text(c, true);
      const r = checkBill(d, c);
      const ent = me.entities.find((e) => e.entity_id === d.entity_id);
      let duplicates: unknown[] = [];
      if (r.computed) {
        const dup = await findDuplicates(ctx, d, r.computed.net_amount);
        if (typeof dup === "string") return text(dup, true);
        duplicates = dup;
      }
      return json({
        ok: r.errors.length === 0,
        errors: r.errors,
        warnings: [...r.warnings, ...(duplicates.length ? ["มีบิลที่หน้าตาเหมือนกันบันทึกไว้แล้ว — ถามผู้ใช้ก่อนว่าเป็นบิลใหม่จริงไหม (save_bill ต้องส่ง confirm_not_duplicate = true)"] : [])],
        possible_duplicates: duplicates,
        summary: r.computed && ent ? previewSummary(d, ent.name, me.tenantName, r.computed) : null,
        computed: r.computed,
      });
    },
  );

  server.registerTool(
    "save_bill",
    {
      title: "บันทึกบิล",
      description: "Save the bill into the ERP. Only after preview_bill passed and the user agreed. tenant_slug must equal who_am_i.tenant_slug.",
      inputSchema: {
        tenant_slug: z.string().describe("Must equal tenant_slug from who_am_i — guards against writing into the wrong customer"),
        confirm_not_duplicate: z.boolean().optional().describe("Set true only after the user confirmed a possible duplicate is a new bill"),
        ...billShape,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ tenant_slug, confirm_not_duplicate, ...rest }) => {
      // 🚨 ด่านลงผิดเจ้า: connector หลายตัวเปิดพร้อมกันได้ — ชื่อย่อต้องตรงกับเจ้าของ token
      if (String(tenant_slug ?? "").trim().toLowerCase() !== me.tenantSlug.toLowerCase()) {
        return text(`ไม่บันทึก: tenant_slug "${tenant_slug}" ไม่ตรงกับบัญชีที่เชื่อมต่ออยู่ (${me.tenantSlug} · ${me.tenantName}) — ตรวจว่าใช้ connector ของลูกค้าถูกเจ้า`, true);
      }
      const d = asDraft(rest);
      const c = await loadContext(ctx, d.entity_id);
      if (typeof c === "string") return text(c, true);
      const r = checkBill(d, c);
      if (!r.payload || !r.computed) return json({ ok: false, errors: r.errors, warnings: r.warnings });
      const dup = await findDuplicates(ctx, d, r.computed.net_amount);
      if (typeof dup === "string") return text(dup, true);
      if (dup.length && !confirm_not_duplicate) {
        return json({ ok: false, errors: ["มีบิลที่หน้าตาเหมือนกันอยู่แล้ว — ถามผู้ใช้ก่อน ถ้าเป็นบิลใหม่จริงให้ส่ง confirm_not_duplicate = true"], possible_duplicates: dup });
      }
      const { data, error } = await db.rpc("fn_save_transaction", { p: r.payload.p, p_items: r.payload.items });
      if (error) return text("บันทึกไม่สำเร็จ: " + mapDbError(error), true);
      const res = data as { ok: boolean; tx_id: string; warning?: string | null };
      const ent = me.entities.find((e) => e.entity_id === d.entity_id);
      return json({
        ok: true,
        tx_id: res.tx_id,
        // บันทึกได้บางส่วน ≠ สำเร็จ (D79) — เช่น รับวัตถุดิบเข้าสต็อกไม่สำเร็จ ต้องบอกผู้ใช้
        warnings: [...r.warnings, ...(res.warning ? [res.warning] : [])],
        summary: ent ? previewSummary(d, ent.name, me.tenantName, r.computed) : null,
        where_to_check: "แอป → บัญชี → ค้นบิล (แก้/ลบได้ที่นั่น)",
      });
    },
  );

  return server;
}
