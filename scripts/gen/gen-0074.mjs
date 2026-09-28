/**
 * สร้าง migration 0074 (D99) — ยก recompute_stock_product (0029) / handle_new_user (0031)
 * มาทั้งดุ้น แล้วแก้เฉพาะจุดที่ตั้งใจ
 *
 *   recompute_stock_product → เติมบล็อกด่านต่อจาก `begin` (ไม่แตะบรรทัดคำนวณแม้บรรทัดเดียว)
 *   handle_new_user         → ตัด arm ที่ 3 ของ coalesce ทิ้ง (R6)
 *
 * 🚨 ห้ามพิมพ์มือ (D79/D91) · สคริปต์ **assert** ว่าถอดสิ่งที่แก้ออกแล้วได้ต้นฉบับเป๊ะ
 *    ⇒ ถ้าต้นฉบับขยับหรือจุดแทรกหาไม่เจอ = throw ไม่เขียนไฟล์
 *
 * รัน:  node scripts/gen/gen-0074.mjs
 */
import fs from "node:fs";
import path from "node:path";

const OUT_NAME = "20260928000074_definer_guards.sql";
const HEADER = "scripts/gen/0074-header.sql";
const OUT = `supabase/migrations/${OUT_NAME}`;
const DIR = "supabase/migrations";

const norm = (s) => s.replace(/\r\n/g, "\n");

/**
 * migration ล่าสุดที่ **นิยาม** ฟังก์ชันนี้ (ไม่นับไฟล์ที่สคริปต์นี้สร้างเอง)
 * 🪤 จับ `create ... function` ไม่ใช่คำว่า `function X` — บรรทัด revoke ก็มีคำนั้น (D99)
 */
function latestDefining(name) {
  const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+(public\\.)?${name}\\s*\\(`, "i");
  const hit = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".sql") && f !== OUT_NAME)
    .sort()
    .reverse()
    .find((f) => re.test(fs.readFileSync(path.join(DIR, f), "utf8")));
  if (!hit) throw new Error("ไม่พบ migration ที่นิยาม " + name);
  return hit;
}

function lift(text, decl) {
  const start = text.indexOf(`create or replace function ${decl}(`);
  if (start < 0) throw new Error("ไม่พบ " + decl);
  const tag = text.slice(start).match(/\bas (\$[A-Za-z_]*\$)/)?.[1];
  if (!tag) throw new Error("อ่าน dollar-quote tag ของ " + decl + " ไม่ได้");
  const stop = `\nend ${tag};\n`;
  const end = text.indexOf(stop, start);
  if (end < 0) throw new Error("ไม่พบจุดจบของ " + decl);
  return text.slice(start, end + stop.length);
}

function mustOnce(text, needle, what) {
  const n = text.split(needle).length - 1;
  if (n !== 1) throw new Error(`${what}: ต้องเจอ 1 ครั้งพอดี แต่เจอ ${n}`);
}

// ── recompute_stock_product ──────────────────────────────────────────────────
const recSrc = latestDefining("recompute_stock_product");
const recOrig = lift(norm(fs.readFileSync(path.join(DIR, recSrc), "utf8")), "recompute_stock_product");

const REC_ANCHOR = "declare v_t uuid := coalesce(p_tenant, my_tenant());\nbegin\n";
mustOnce(recOrig, REC_ANCHOR, "จุดแทรกด่านใน recompute_stock_product");

const GUARD = [
  "  /*",
  "   * 🔐 ด่าน (D99 · 0074) — ผู้เรียกที่เชื่อได้ = service_role หรือ **ไม่มี JWT เลย**",
  "   *    (postgres / SQL editor / pg_cron) → ทำตามเดิมทุกกรณี",
  "   *    (fn_mig_recompute_stock ของ restore:tenant/import เรียกผ่าน service role)",
  "   *    นอกนั้น (authenticated/anon) ต้องมี tenant · มี prod.write · ซ่อมได้เฉพาะของตัวเอง",
  "   * 🪤 ห้ามใช้ \"my_tenant() เป็น null\" เป็นเงื่อนไขยกเว้น — anon กับผู้ใช้ที่ไม่มี profile",
  "   *    ก็ได้ null แล้ว v_t = null แปลว่า **ซ่อมทุก tenant**",
  "   */",
  "  if auth.role() is not null and auth.role() <> 'service_role' then",
  "    if my_tenant() is null then",
  "      raise exception 'คำนวณสต็อกใหม่ไม่ได้: ไม่รู้ว่าผู้ใช้นี้อยู่กิจการไหน';",
  "    end if;",
  "    if not has_cap('prod.write') then",
  "      raise exception 'ไม่มีสิทธิ์คำนวณสต็อกใหม่ (ต้องมีสิทธิ์บันทึกงานผลิต)';",
  "    end if;",
  "    if p_tenant is not null and p_tenant <> my_tenant() then",
  "      raise exception 'คำนวณสต็อกของกิจการอื่นไม่ได้';",
  "    end if;",
  "  end if;",
  "",
  "",
].join("\n");

const recNew = recOrig.replace(REC_ANCHOR, REC_ANCHOR + GUARD);
if (recNew.replace(GUARD, "") !== recOrig) throw new Error("recompute: ถอดด่านออกแล้วไม่ได้ต้นฉบับ");

// ── handle_new_user (R6) ─────────────────────────────────────────────────────
const hnuSrc = latestDefining("handle_new_user");
const hnuOrig = lift(norm(fs.readFileSync(path.join(DIR, hnuSrc), "utf8")), "public.handle_new_user");

const ARM3 = "    my_tenant(),\n    (select id from tenants where is_active limit 1)\n";
const ARM2 = "    my_tenant()\n";
mustOnce(hnuOrig, ARM3, "arm ที่ 3 ใน handle_new_user");

const hnuNew = hnuOrig.replace(ARM3, ARM2);
if (hnuNew.replace(ARM2, ARM3) !== hnuOrig) throw new Error("handle_new_user: ใส่ arm กลับแล้วไม่ได้ต้นฉบับ");

// ── เขียนไฟล์ ────────────────────────────────────────────────────────────────
fs.writeFileSync(
  OUT,
  [
    norm(fs.readFileSync(HEADER, "utf8")).trimEnd(),
    `-- ยกจาก ${recSrc} · เติมเฉพาะบล็อกด่าน`,
    recNew,
    "",
    "-- ผู้ใช้ปุ่มซ่อมสต็อกคือ authenticated (มีด่านข้างบน) · anon ไม่มีเหตุให้เรียกเลย",
    "revoke execute on function recompute_stock_product(uuid) from public, anon;",
    "grant  execute on function recompute_stock_product(uuid) to authenticated, service_role;",
    "",
    "-- ── 3. handle_new_user (R6): ไม่มี tenant = สร้างผู้ใช้ไม่ได้ ──────────────────────",
    `-- ยกจาก ${hnuSrc} · ตัด arm ที่ 3 ของ coalesce ทิ้งบรรทัดเดียว`,
    hnuNew,
    "",
    "-- ── 4. fn_audit_definer_grants — ให้ test:tenant ถาม pg_proc ───────────────────────",
    "--   security invoker โดยตั้งใจ (pg_proc / has_function_privilege อ่านได้ทุก role อยู่แล้ว",
    "--   ไม่ต้องยืมสิทธิ์ owner) · คืนทุกฟังก์ชันใน public รวมตัวมันเอง → เทสตรวจตัวมันเองด้วย",
    "create or replace function fn_audit_definer_grants()",
    "returns table (",
    "  fn text, name text, definer boolean, result_type text, takes_p_tenant boolean,",
    "  anon boolean, authed boolean, service boolean, owner_role text, src text",
    ")",
    "language sql stable security invoker set search_path = public, pg_catalog as $fn$",
    "  select p.oid::regprocedure::text,",
    "         p.proname::text,",
    "         p.prosecdef,",
    "         pg_get_function_result(p.oid),",
    "         coalesce(p.proargnames @> array['p_tenant'], false),",
    "         has_function_privilege('anon', p.oid, 'execute'),",
    "         has_function_privilege('authenticated', p.oid, 'execute'),",
    "         has_function_privilege('service_role', p.oid, 'execute'),",
    "         p.proowner::regrole::text,",
    "         p.prosrc",
    "  from pg_proc p",
    "  join pg_namespace n on n.oid = p.pronamespace",
    "  where n.nspname = 'public' and p.prokind = 'f'",
    "  order by 1;",
    "$fn$;",
    "",
    "-- 🚨 ต้องอยู่ในไฟล์เดียวกันเสมอ — ลืม = แจกแผนที่ช่องโหว่ให้คนถือ anon key",
    "revoke execute on function fn_audit_definer_grants() from public, anon, authenticated;",
    "grant  execute on function fn_audit_definer_grants() to service_role;",
    "",
    "notify pgrst, 'reload schema';",
    "",
  ].join("\n"),
);
console.log(`เขียน ${OUT} แล้ว (recompute จาก ${recSrc} · handle_new_user จาก ${hnuSrc})`);
