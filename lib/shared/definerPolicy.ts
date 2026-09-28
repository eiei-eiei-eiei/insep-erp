/**
 * นโยบายสิทธิ์ของ security definer — แหล่งเดียว (D99 · migration 0073-0074)
 *
 * ใช้โดย 2 ชั้น:
 *   · `tests/tenant/definer-grants.test.ts` — **ชั้นที่พิสูจน์** ถามสิทธิ์จริงจาก pg_proc
 *   · `lib/shared/definerGrantsSql.test.ts` — ชั้นเสริม อ่านไฟล์ migration
 *
 * 🔴 บน Supabase `revoke ... from public` **รันผ่านแต่ไม่มีผล** — default privileges grant
 *    execute ให้ anon/authenticated ตรง ๆ ⇒ ต้อง revoke จาก `public, anon, authenticated`
 *    และ drop+create ฟังก์ชันใหม่ (D69) = ได้สิทธิ์ default คืนมาเงียบ ๆ ต้อง revoke ซ้ำ
 */

/**
 * ต้องปิดจาก anon/authenticated **เสมอ** — ด่านในตัวช่วยไม่ได้ เพราะรับ tenant จากพารามิเตอร์
 * หรือกระทบทั้งฐาน · ผู้เรียกที่ถูกต้องมีแค่ service role หรือ definer ตัวอื่น
 */
export const MUST_CLOSED_DEFINERS = [
  "fn_mig_set_triggers", // ปิด trigger ทั้งตารางของทุกลูกค้า (D82)
  "fn_mig_truncate",
  "fn_mig_recompute_stock",
  "bar_apply_move", // ผู้เรียก = fn_bar_* ที่เป็น definer
  "apply_stock_delta", // ผู้เรียก = trg_update_stock_product (พลิกเป็น definer ใน 0074)
  "fn_audit_definer_grants", // แผนที่ช่องโหว่ทั้งฐาน
] as const;

export type AllowKind = "readonly" | "self" | "delegates";

/**
 * definer ที่เปิดให้ผู้ใช้เรียกได้ โดยไม่มีด่าน `my_tenant()` / `has_cap(` / `*_guard(` ใน body
 *
 * 🚨 ทุกหมวด **ตรวจตัวเองได้** — test:tenant อ่าน body จริงยืนยันเงื่อนไขของหมวด:
 *   readonly  = ไม่มีคำสั่งเขียน (insert/update/delete/truncate/merge/perform/execute)
 *               และไม่เรียกฟังก์ชันอื่นนอกจากหมวด readonly/self
 *   self      = แตะแค่ตาราง profiles และแก้ได้เฉพาะ `where id = auth.uid()`
 *   delegates = ไม่เขียนเองตรง ๆ และทุกฟังก์ชันที่เรียกต่อต้องปิดแล้วหรือมีด่าน
 * ⇒ วันไหนมีคนเติมคำสั่งเขียนเข้าไปในตัวที่อยู่ในลิสต์นี้ เทสแดงทันที
 */
export const DEFINER_ALLOWLIST: Record<string, { kind: AllowKind; why: string }> = {
  entity_is_vat: {
    kind: "readonly",
    why:
      "คืน boolean ว่ากิจการจด VAT ไหม (ข้อมูลสาธารณะ) · ผู้เรียกคือ trigger invoker 2 ตัว " +
      "(ด่าน ม.86/13) — revoke = บันทึกบิล/ออเดอร์ล้มทั้งระบบ",
  },
  fn_excise_months_open: {
    kind: "readonly",
    why: "ไม่มีผู้เรียกในแอปเลย (มีแต่ใน SQL ด้วยกัน) และอ่านอย่างเดียว — เลื่อนไปก่อน",
  },
  my_tenant: { kind: "self", why: "helper ตัวตน — อ่าน profile ของตัวเอง" },
  my_role: { kind: "self", why: "helper ตัวตน — อ่าน profile ของตัวเอง" },
  my_entities: { kind: "self", why: "helper ตัวตน — อ่าน profile ของตัวเอง" },
  has_cap: { kind: "self", why: "ตารางสิทธิ์ (D85) — อ่าน role ของตัวเอง" },
  clear_password_change_flag: { kind: "self", why: "เคลียร์ flag ของตัวเองคอลัมน์เดียว (0031)" },
  fn_bar_quick_sale: { kind: "delegates", why: "เรียก fn_bar_open_sale/add_lines/close_sale ต่อกัน" },
  // D100 (0076) — กลายเป็นตัวส่งต่อให้ fn_next_doc_no (มี my_tenant + has_cap/bar_guard)
  fn_bar_next_doc: { kind: "delegates", why: "แปลง B/BR เป็นชนิดเอกสาร แล้วส่งต่อให้ fn_next_doc_no" },
  fn_next_sales_doc: { kind: "delegates", why: "แปลง QU/ORD/INV/TAX/RC เป็นชนิดเอกสาร แล้วส่งต่อให้ fn_next_doc_no" },
};

/** รับ p_tenant แต่เปิดให้ authenticated ได้ เพราะมีด่านเทียบ `p_tenant <> my_tenant()` ในตัว */
export const P_TENANT_GUARDED = ["recompute_stock_product"] as const;

// ── ตัวตรวจ (แหล่งเดียว — test:tenant และ `npm run db:audit-grants` ใช้ตัวนี้) ─────────────

/** แถวจาก `fn_audit_definer_grants()` (0074) */
export type DefinerRow = {
  fn: string;
  name: string;
  definer: boolean;
  result_type: string;
  takes_p_tenant: boolean;
  anon: boolean;
  authed: boolean;
  service: boolean;
  owner_role: string;
  src: string;
};

/** ตัดคอมเมนต์ทิ้ง — ตรวจ **โค้ดจริง** ไม่ใช่คำในคอมเมนต์ (D92/D95) */
export const stripSqlComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
/** ตัดคอมเมนต์ + ข้อความในเครื่องหมายคำพูด (ข้อความ error ภาษาไทยอาจมีคำว่า update ฯลฯ) */
export const sqlCode = (s: string) => stripSqlComments(s).replace(/'(?:[^']|'')*'/g, "''");

/** ด่านในตัว (กฎ ข) */
const GUARD = /\bmy_tenant\s*\(\s*\)|\bhas_cap\s*\(|\b\w+_guard\s*\(/i;
/** คำสั่งเขียนทุกแบบ (รวม perform/execute เพราะเรียกของที่เขียนได้) */
const WRITE = /\b(insert|update|delete|truncate|merge|perform|execute)\b/i;
/** เขียนตรง ๆ ในตัวเอง (ไม่นับการส่งต่อด้วย perform) */
const DIRECT_WRITE = /\b(insert|update|delete|truncate|merge|execute)\b/i;

export const isClosed = (r: DefinerRow) => !r.anon && !r.authed;
/** trigger / event trigger เรียกแบบ RPC ไม่ได้อยู่แล้ว (Postgres ปฏิเสธเอง) */
export const isCallable = (r: DefinerRow) => !/\b(event_)?trigger$/.test(r.result_type);
export const hasGuard = (r: DefinerRow) => GUARD.test(sqlCode(r.src));

/** ชื่อฟังก์ชันใน public ที่ body เรียก */
function calledFns(rows: DefinerRow[], r: DefinerRow): string[] {
  const names = new Set(rows.map((x) => x.name));
  const found = new Set<string>();
  for (const m of sqlCode(r.src).matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/gi)) {
    const n = m[1].toLowerCase();
    if (names.has(n) && n !== r.name) found.add(n);
  }
  return [...found];
}

/** ตรวจเงื่อนไขของหมวดใน allowlist — คืนเหตุผลที่ไม่ผ่าน หรือ null */
export function allowViolation(
  rows: DefinerRow[],
  r: DefinerRow,
  allow: Record<string, { kind: AllowKind }> = DEFINER_ALLOWLIST,
): string | null {
  const a = allow[r.name];
  if (!a) return "เปิดให้ anon/authenticated โดยไม่มีด่าน และไม่อยู่ใน allowlist";
  const body = sqlCode(r.src);
  if (a.kind === "readonly") {
    if (WRITE.test(body)) return "หมวด readonly แต่มีคำสั่งเขียน";
    const bad = calledFns(rows, r).filter((n) => !(allow[n]?.kind === "readonly" || allow[n]?.kind === "self"));
    return bad.length ? `หมวด readonly แต่เรียก ${bad.join(", ")}` : null;
  }
  if (a.kind === "self") {
    if (!/\bauth\.uid\s*\(\s*\)/i.test(body)) return "หมวด self แต่ไม่ได้อ้าง auth.uid()";
    const other = [...body.matchAll(/\b(?:from|join|update|into)\s+([a-z_][a-z0-9_.]*)/gi)]
      .map((m) => m[1].toLowerCase().replace(/^public\./, ""))
      .filter((t) => t !== "profiles");
    if (other.length) return `หมวด self แต่แตะตาราง ${other.join(", ")}`;
    if (/\b(insert|delete|truncate|merge|execute|perform)\b/i.test(body)) return "หมวด self แต่มี insert/delete/…";
    if (/\bupdate\b/i.test(body) && !/where\s+id\s*=\s*auth\.uid\s*\(\s*\)/i.test(body)) {
      return "หมวด self แก้ profiles โดยไม่จำกัด where id = auth.uid()";
    }
    return null;
  }
  // delegates
  if (DIRECT_WRITE.test(body)) return "หมวด delegates แต่เขียนเองตรง ๆ";
  const calls = calledFns(rows, r);
  if (!calls.length) return "หมวด delegates แต่ไม่ได้เรียกฟังก์ชันใดเลย";
  const unguarded = calls.filter((n) => {
    const target = rows.filter((x) => x.name === n);
    // ต้องปิดแล้วหรือมีด่านในตัว — ห้ามส่งต่อเป็นทอด ๆ ผ่าน allowlist หมวด delegates
    return !target.length || !target.every((t) => isClosed(t) || hasGuard(t) || allow[n]?.kind === "self");
  });
  return unguarded.length ? `ส่งต่อให้ตัวที่ไม่มีด่าน: ${unguarded.join(", ")}` : null;
}

export type DefinerAudit = {
  /** ตัวใน MUST_CLOSED_DEFINERS ที่ยังเปิด (หรือ service_role เรียกไม่ได้) */
  mustClosedOpen: string[];
  /** ตัวใน MUST_CLOSED_DEFINERS ที่หาไม่เจอใน DB */
  mustClosedMissing: string[];
  /** definer ที่คนนอกเรียกได้โดยไม่มีด่าน */
  unguarded: { fn: string; why: string }[];
  /** รับ p_tenant และเปิดอยู่ โดยไม่อ่านอย่างเดียว/ไม่มีด่านเทียบ my_tenant() */
  pTenantOpen: string[];
};

/** ตรวจทั้งฐาน — ผ่าน = ทุก array ว่าง */
export function auditDefiners(rows: DefinerRow[]): DefinerAudit {
  const definers = rows.filter((r) => r.definer && isCallable(r));
  const mustClosedOpen: string[] = [];
  const mustClosedMissing: string[] = [];
  for (const name of MUST_CLOSED_DEFINERS) {
    const found = rows.filter((r) => r.name === name);
    if (!found.length) mustClosedMissing.push(name);
    for (const r of found) if (!isClosed(r) || !r.service) mustClosedOpen.push(r.fn);
  }
  const unguarded = definers
    .filter((r) => !isClosed(r) && !hasGuard(r))
    .map((r) => ({ fn: r.fn, why: allowViolation(rows, r) }))
    .filter((x): x is { fn: string; why: string } => x.why !== null);
  /**
   * 🪤 กฎ ข. (มีคำว่า my_tenant() ใน body) **ไม่พอ** สำหรับตัวที่รับ p_tenant —
   *    recompute_stock_product ก่อน 0074 มี `coalesce(p_tenant, my_tenant())` ซึ่งผ่านกฎ ข.
   *    ทั้งที่รับ tenant ของใครก็ได้ ⇒ ตัวใน P_TENANT_GUARDED ต้อง **เทียบ** p_tenant กับ
   *    my_tenant() จริง และปิดจาก anon
   */
  const comparesTenant = (r: DefinerRow) =>
    /\bp_tenant\s*(<>|!=|is\s+distinct\s+from)\s*my_tenant\s*\(\s*\)/i.test(sqlCode(r.src));
  const pTenantOpen = definers
    .filter((r) => r.takes_p_tenant && !isClosed(r))
    .filter((r) =>
      (P_TENANT_GUARDED as readonly string[]).includes(r.name)
        ? r.anon || !comparesTenant(r)
        : DEFINER_ALLOWLIST[r.name]?.kind !== "readonly")
    .map((r) => r.fn);
  return { mustClosedOpen, mustClosedMissing, unguarded, pTenantOpen };
}

/** ชื่อใน allowlist ที่ไม่ต้องอยู่แล้ว (หายไป / ปิดแล้ว / มีด่านแล้ว) — กันลิสต์เน่า */
export function staleAllowlist(rows: DefinerRow[]): string[] {
  return Object.keys(DEFINER_ALLOWLIST).filter((name) => {
    const found = rows.filter((r) => r.name === name);
    return !found.some((r) => r.definer && !isClosed(r) && !hasGuard(r));
  });
}
