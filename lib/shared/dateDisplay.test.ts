import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * D161 เฟส 2 — กันถอยหลัง: หน้าจอของโมดูลที่ไล่เสร็จแล้ว ต้องจัดรูปวันที่ผ่าน `useDateFmt()` เท่านั้น
 *
 * 🪤 ทำไมต้องอ่านซอร์ส: `{r.transaction_date}` เป็น TSX ที่ถูกต้องทุกประการ build/lint/test ผ่านหมด
 *    แต่บนจอคือ `2026-11-06` ดิบที่ไม่ตามค่าตั้งของลูกค้า (ตระกูลเดียวกับ D79/D85/D90 — ถูกทุกบรรทัดแค่ผิดที่)
 *
 * ★ เฟส 2 เติมโฟลเดอร์ทีละโมดูล · จบเฟส 2 แล้วครอบทั้ง app/
 * 🪤 เป็น**ตาข่ายรอง ไม่ใช่เครื่องตรวจว่าครบ** — รันกับของเดิมของเงินเดือนจับได้แค่ 2/5 จุด
 *    (นิพจน์เงื่อนไข · template ที่ไม่มีภาษาไทย · ประโยคที่ประกอบใน lib) ⇒ ของใหม่ยังต้อง grep เอง
 * 🚨 ไฟล์ที่สร้างฟอร์มราชการไม่อยู่ใน `app/**\/_components` ของโมดูลเหล่านี้ (อยู่ใน lib/) จึงไม่โดนกฎนี้
 */
export const DONE = [
  // ★ เฟส 2 ไล่ครบทุกโมดูลแล้ว (บัญชี · ขาย · ผลิต · บาร์ · เงินเดือน · ตั้งค่า · แพลตฟอร์ม · ล็อกอิน)
  //   → ครอบทั้ง app/ ทีเดียว ไฟล์ .tsx ใหม่ทุกไฟล์โดนกฎนี้ตั้งแต่วันแรก
  "app",
];

/**
 * ✅ เฟส 3 จบแล้ว — ลิสต์นี้**ต้องว่าง** (เคยมี 5 บรรทัด: ใบเสนอราคา 2 · บิลบาร์ 3)
 * 🚨 ห้ามเติมกลับ — วันที่บนเอกสารการค้าจัดรูปใน print.ts / receipt.ts / สลิป ด้วยรูปแบบเอกสารเท่านั้น
 */
export const PHASE3_DOC_ALLOW: string[] = [];

/**
 * D161 เฟส 3 — ไฟล์ที่สร้าง**เอกสารการค้า** (.ts) ต้องผ่านกฎเดียวกัน
 * 🪤 เดิม `formatThaiDate`/`toLocaleDateString` ฝังอยู่ในไฟล์เหล่านี้ ⇒ ค่าตั้ง "รูปแบบบนเอกสาร" ไม่มีผลกับกระดาษ
 * 🚨 ฟอร์มราชการ (`lib/accounting/reportHtml.ts` · `lib/payroll/filingHtml.ts` · `lib/pdf/*` · `lib/production/reports.ts`)
 *    **ไม่อยู่ในลิสต์นี้โดยตั้งใจ** — รูปแบบวันที่บนแบบเป็นของกรม ไม่ใช่ของลูกค้า
 */
export const DOC_FILES = [
  "app/(app)/sales/_components/print.ts",
  "lib/bar/receipt.ts",
  "lib/bar/print80.ts",
  "lib/payroll/slip.ts",
];

function files(p: string): string[] {
  if (statSync(p).isFile()) return [p];
  return readdirSync(p).flatMap((f) => {
    const full = join(p, f);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx$/.test(f) && !/\.test\./.test(f) ? [full] : [];
  });
}

/** คืนบรรทัดที่ผิดกฎ (export ไว้ให้เทสพิสูจน์ว่ากฎจับของเก่าได้) */
export function dateDisplayViolations(src: string): string[] {
  const out: string[] = [];
  const lines = src.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const t = raw.trim();
    // key ของ React ไม่ขึ้นจอ — `key={\`${h.kind}-${h.period}\`}` ต้องไม่ถูกนับ
    const line = raw.replace(/key=\{`[^`]*`\}/g, "").replace(/key=\{[^}]*\}/g, "");
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("import ")) return;
    // 1) ตัวจัดรูปรุ่นเก่า / ของเบราว์เซอร์ (โซนเวลาตามเครื่อง + SSR บน server เป็น UTC)
    if (/\b(formatDateThai|formatThaiDate|formatMonthThai|receiveDateText|thaiDay)\s*\(/.test(line)) out.push(`${i + 1}: ตัวจัดรูปเก่า — ${t}`);
    if (/\.toLocaleDateString\(|\.toLocaleTimeString\(/.test(line)) out.push(`${i + 1}: toLocale*String — ${t}`);
    if (/new Date\([^)]*\)\.toLocaleString\(/.test(line)) out.push(`${i + 1}: Date.toLocaleString — ${t}`);
    //    · `d.toLocaleString("th-TH", { dateStyle … })` ในฟังก์ชันช่วยของไฟล์ (ตั้งค่า HistoryCard — รอบแรกกฎมองไม่เห็น)
    //      ★ ตัวเลข `n.toLocaleString("th-TH")` ไม่นับ — ต้องมีตัวเลือกที่เป็นของวันที่/เวลา
    else if (/\.toLocaleString\([^)]*\b(dateStyle|timeStyle|weekday|month|hour|timeZone)\b/.test(line)) out.push(`${i + 1}: toLocaleString(วันที่) — ${t}`);
    // 2) ฟิลด์วันที่ถูก render ดิบ — `{r.date}` `{x.transaction_date}` `{period}` `{o.timestamp}`
    //    · JSX `{x}` (ไม่นับ attribute `={…}`)
    //    · template `${x}` เฉพาะบรรทัดที่มีตัวอักษรไทย = ข้อความที่คนอ่าน (`${docDate}T00:00:00` ไม่ใช่)
    const isDateName = (expr: string) => {
      const last = expr.split(/[.?!]+/).filter(Boolean).pop() ?? "";
      // `effective\w*` = เงินเดือน ชุดอัตรา `{r.effectiveFrom}` (ชื่อไม่ลงท้าย date — รอบแรกกฎมองไม่เห็น)
      return /^(\w*[dD]ate|\w*_on|\w*_at|\w*At|timestamp|period|month|report_month|effective\w*)$/.test(last);
    };
    //    · บาร์: `{card.sales[0].business_date}` (มี `[0]`) · `{s.business_date ?? "—"}` (มี `??`) — รอบแรกกฎมองไม่เห็น
    for (const m of line.matchAll(/(^|[^=$])\{\s*([\w.?![\]]+)\s*(as string)?\s*(\?\?[^{}]*)?\}/g)) {
      if (isDateName(m[2])) out.push(`${i + 1}: render ดิบ {${m[2]}} — ${t}`);
    }
    //    · `${x}` ตรวจทุกบรรทัด ยกเว้นต่อด้วย `T` (`${docDate}T00:00:00` = ประกอบ ISO ไม่ใช่ข้อความ)
    //      template ที่ขึ้นจอ = มีตัวอักษรไทย หรือตัวคั่นที่ใช้บนจอ (`→` `–`) นอกตัวแปร
    //      ★ ไม่นับ คีย์ (`${range.from}|${range.to}`) · ชื่อไฟล์ (`${j.file}_${month}.pdf`) · CSS selector (`[data-x="${focusAt}"]`)
    for (const tpl of line.matchAll(/`([^`]*)`/g)) {
      const body = tpl[1];
      if (!/[ก-๙→–]/.test(body.replace(/\$\{[^}]*\}/g, ""))) continue;
      for (const m of body.matchAll(/\$\{\s*([\w.?![\]]+)\s*\}(?!T)/g)) {
        if (isDateName(m[1])) out.push(`${i + 1}: render ดิบ \${${m[1]}} — ${t}`);
      }
    }
    // 3) ตัดสตริงวันที่ใน template literal/JSX (`${b.date.substring(0, 7)}`) = เดือนแบบ ISO ดิบ
    //    · `.slice(5)` = `MM-DD` ดิบ (ผลิต MonitorTab — รอบแรกกฎนี้มองไม่เห็น)
    if (/\$?\{[^}]*\.(slice|substring)\((0,\s*(7|10)|5)\)[^}]*\}/.test(line) && /[dD]ate|_at|_on/.test(line)) {
      out.push(`${i + 1}: ตัด ISO ตรง ๆ — ${t}`);
    }
  });
  return out;
}

describe("D161 — หน้าจอที่ไล่เสร็จแล้ว จัดรูปวันที่ด้วย useDateFmt เท่านั้น", () => {
  for (const dir of DONE) {
    it(dir, () => {
      const all = files(dir)
        .flatMap((f) => dateDisplayViolations(readFileSync(f, "utf8")).map((v) => `${f}:${v}`))
        .filter((v) => !PHASE3_DOC_ALLOW.some((a) => v.includes(a)));
      expect(all).toEqual([]);
    });
  }

  it("เฟส 3 จบ — ไม่มีวันที่บนเอกสารค้างรอ", () => {
    expect(PHASE3_DOC_ALLOW).toEqual([]);
  });

  for (const f of DOC_FILES) {
    it(`เอกสารการค้า: ${f}`, () => {
      expect(dateDisplayViolations(readFileSync(f, "utf8"))).toEqual([]);
    });
  }

  it("กฎจับของจริงได้ (กันเทสผ่านเพราะ regex ไม่เจออะไร)", () => {
    const bad = [
      `<td>{r.date}</td>`,
      `<td className="x">{r.transaction_date}</td>`,
      `<span>เดือน {period}</span>`,
      "<Card title={`ยอดคงเหลือ ณ สิ้นเดือน ${period}`}>",
      `<td className="text-muted">{o.timestamp}</td>`,
      `<td>{r.createdAt}</td>`,
      `<td>{s.report_month as string}</td>`,
      "title: `ถ้ายื่น (${b.date.substring(0, 7)}) แล้ว`",
      `<td>{formatDateThai(h.pay_date)}</td>`,
      `{new Date(s.closed_at).toLocaleString("th-TH")}`,
      `new Date().toLocaleDateString("th-TH")`,
      `<td>{String(r.measure_date).slice(5)} {r.measure_time}</td>`,
      `<td className="x">{String(r.doc_date).slice(0, 10)}</td>`,
      `<td>{new Date(s.last_updated).toLocaleString("th-TH")}</td>`,
      `ล่าสุด <b className="text-ink">{card.sales[0].business_date}</b>`,
      `<td className="text-sm">{s.business_date ?? "—"}</td>`,
      "{b.finishDate && b.finishDate !== b.startDate && ` → ${b.finishDate}`}",
      "const span = r.from === r.to ? r.from : `${r.fromDate} – ${r.toDate}`;",
      `<td>{r.effectiveFrom}</td>`,
      "`ชุดอัตราที่เริ่มมีผล ${r.effectiveFrom}`",
      `return d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });`,
    ];
    for (const b of bad) expect(dateDisplayViolations(b), b).not.toEqual([]);
  });

  it("ไม่ฟ้องของที่ถูก", () => {
    const ok = [
      `<td>{d.date(r.date)}</td>`,
      `<TextInput type="date" value={payDate} />`,
      `<DashboardTab period={month} />`,
      `const x = { date: r.date };`,
      `// <td>{r.date}</td> คอมเมนต์`,
      `<td>{fmt(r.amount)}</td>`,
      "<tr key={`${h.kind}-${h.period}-${i}`}>",
      `import { formatThaiDate } from "@/lib/sales/orders";`,
      "const d = new Date(`${docDate}T00:00:00`);",
      "const rangeKey = `${range.fromDate}|${range.toDate}`;",
      "download(bytes, `${j.file}_${month}.pdf`);",
      "box.current?.querySelector(`[data-qty-row=\"${focusAt}\"] input`);",
      `<td>{s.business_date ? df.date(s.business_date) : "—"}</td>`,
      `<td className="num">{(result.counts[t] ?? 0).toLocaleString("th-TH")}</td>`,
    ];
    for (const o of ok) expect(dateDisplayViolations(o), o).toEqual([]);
  });
});
