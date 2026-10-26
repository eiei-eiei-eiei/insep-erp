import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { toastLife } from "./toast";

/**
 * D134 — กล่องยืนยัน/ข้อความของเบราว์เซอร์ + ผลการบันทึก
 *
 * 🐛 `window.confirm()` / `alert()` / `prompt()` ถูกเบราว์เซอร์บล็อกได้ **เงียบ ๆ**
 *    confirm คืน false = ปุ่มลบ/ยกเลิกกดแล้วไม่มีอะไรเกิดขึ้น (เจอของจริงที่แท็บบรรจุ/จ่าย · D99)
 *    alert หายไปเฉย ๆ = ข้อความเตือนไม่ถึงคน · build/lint/test มองไม่เห็นเลย
 * ⇒ เทสนี้ **อ่านซอร์สจริง** (ชั้นเดียวกับ tokens.test.ts / readGuard.test.ts)
 */

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const files = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "lib"))];
/** โค้ดล้วน — ตัดคอมเมนต์ทิ้ง (ตรวจโค้ดจริง ไม่ใช่คำในคอมเมนต์ · D92/D95) */
const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*/gm, "").replace(/\s\/\/[^\n]*/g, "");
const rel = (p: string) => path.relative(ROOT, p);

describe("D134 — ห้ามใช้กล่องของเบราว์เซอร์", () => {
  it("ไม่มี confirm() / alert() / prompt() ของเบราว์เซอร์ในซอร์ส (ใช้ useConfirm() / showToast() แทน)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const lines = code(f).split("\n");
      lines.forEach((l, i) => {
        if (/(?<![.\w])(confirm|alert|prompt)\s*\(|window\.(confirm|alert|prompt)\s*\(/.test(l)) {
          offenders.push(`${rel(f)}:${i + 1} → ${l.trim().slice(0, 100)}`);
        }
      });
    }
    expect(offenders, "เบราว์เซอร์บล็อกได้แล้วคืน false/หายเงียบ — ใช้ useConfirm() (ถาม) / showToast() (แจ้ง)").toEqual([]);
  });

  it("🪤 ทุก component ที่ใช้กล่องยืนยัน ต้องวาง {confirmNode} — ไม่งั้นกดแล้วค้างเงียบ ๆ", () => {
    const offenders: string[] = [];
    for (const f of files.filter((x) => x.endsWith(".tsx"))) {
      const c = code(f);
      // นับการเรียก hook ใน component — ไม่นับตัวที่อยู่ในนิยาม hook เอง (เช่น useAskDelete ของหน้าเงินเดือน)
      let uses = 0;
      for (const m of c.matchAll(/=\s*use(Confirm|AskDelete)\(\)/g)) {
        const before = c.slice(0, m.index);
        const fn = [...before.matchAll(/function\s+([A-Za-z0-9_]+)/g)].pop()?.[1] ?? "";
        if (!/^use[A-Z]/.test(fn)) uses += 1;
      }
      const renders = (c.match(/\{confirmNode\}/g) ?? []).length;
      if (uses !== renders) offenders.push(`${rel(f)} — เรียก hook ${uses} ครั้ง แต่วาง {confirmNode} ${renders} ที่`);
    }
    expect(offenders).toEqual([]);
  });

  it("🪤 D136 — ปุ่มยืนยันที่ขึ้นต้นด้วย 'ยกเลิก…' ต้องคู่กับปุ่ม 'กลับ' (ไม่งั้นได้ [ยกเลิกบิล] [ยกเลิก] กำกวม)", () => {
    // เจอตอนเทสเบราว์เซอร์: D134 ไล่เปลี่ยนแล้วแต่ตกที่ประวัติบิลบาร์ + ของทำเอง
    const offenders: string[] = [];
    for (const f of files.filter((x) => x.endsWith(".tsx"))) {
      const c = code(f);
      for (const m of c.matchAll(/ask\(\{([\s\S]*?)\}\)/g)) {
        const body = m[1];
        if (/confirmText:\s*[`"']ยกเลิก/.test(body) && !/cancelText:\s*[`"']กลับ[`"']/.test(body)) {
          offenders.push(`${rel(f)} → ${body.replace(/\s+/g, " ").slice(0, 90)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("🚩 เทสข้างบนจับได้จริง (กันผ่านเพราะไม่ได้ตรวจอะไร)", () => {
    const re = /(?<![.\w])(confirm|alert|prompt)\s*\(|window\.(confirm|alert|prompt)\s*\(/;
    expect(re.test(`if (!confirm("ลบ?")) return;`)).toBe(true);
    expect(re.test(`window.alert("x")`)).toBe(true);
    expect(re.test(`await ask({ title: "ลบ?" })`)).toBe(false);
    expect(re.test(`function confirmShip(o) {`)).toBe(false);
    expect(files.length).toBeGreaterThan(100);
  });
});

describe("D134 — ผลการบันทึกขึ้นเป็นป้ายลอย ไม่ใช่แถบในการ์ด", () => {
  it("สำเร็จหายเองใน 3 วิ · สำเร็จบางส่วน/ไม่สำเร็จค้างจนกดปิด", () => {
    expect(toastLife({ ok: true, text: "บันทึกแล้ว" })).toBe(3000);
    expect(toastLife({ ok: true, warn: true, text: "บันทึกได้บางส่วน" })).toBeNull();
    expect(toastLife({ ok: false, text: "ไม่สำเร็จ" })).toBeNull();
  });

  it("ไม่มีแถบผลลัพธ์ในการ์ดเหลือ (<Msg> ถูกลบแล้ว)", () => {
    const offenders = files.filter((f) => /<Msg\b/.test(code(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("layout ทั้งฝั่งลูกค้าและ /platform วางป้ายลอยไว้", () => {
    for (const f of ["app/(app)/layout.tsx", "app/(platform)/layout.tsx"]) {
      expect(code(path.join(ROOT, f)), f).toContain("<ToastHost />");
    }
  });

  it("🪤 useSaver เรียก onOk ก่อนขึ้นป้ายเขียว — onOk ที่ตั้งเหลืองเองต้องไม่ได้ 2 ป้ายขัดกัน", () => {
    const c = code(path.join(ROOT, "lib/shared/ui.tsx"));
    const run = c.slice(c.indexOf("function run("));
    expect(run.indexOf("onOk?.(r.data)")).toBeGreaterThan(0);
    expect(run.indexOf("onOk?.(r.data)")).toBeLessThan(run.indexOf("setMsg({ ok: true, text: okText })"));
    expect(c).toMatch(/if \(m\) \{\s*overridden\.current = true;\s*showToast\(m\)/);
  });
});
