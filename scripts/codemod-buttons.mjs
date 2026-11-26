// scripts/codemod-buttons.mjs — D184: เปลี่ยน <button className="… bg-brand … text-on-brand …"> ที่เขียนเอง
// เป็น <Button tone="primary"|"danger" size=…> (lib/shared/page) — **เฉพาะปุ่มธรรมดา**
//
// ★ ใช้ TypeScript AST (ไม่ใช่ regex) — ปุ่มมี onClick={() => …} ที่มี ">" ในแอตทริบิวต์ regex แยกไม่ออก
// ★ ข้าม (คงเดิม):
//   · className ไม่ใช่ข้อความคงที่ (มี ${…} = ปุ่มสลับสถานะ/แท็บ/ชิป ที่เปลี่ยนสีตามค่า)
//   · ปุ่มใหญ่พิเศษ (w-full · flex-1 · py-2.5/py-3 · text-base) — ขนาดตั้งใจ (ปุ่มเก็บเงิน/ขายหน้าร้าน)
//   · ปุ่มที่วางตำแหน่ง (absolute) / ทรงกลม (rounded-full) / ปุ่มไอคอนในกรอบ grid
// ★ คลาสจัดวาง (margin · shrink-0 · self-* · col-span · order) ถูกเก็บไว้ใน className
//
// usage: node scripts/codemod-buttons.mjs [--write] <files…>   (ไม่ใส่ --write = แค่รายงาน)
import fs from "node:fs";
import ts from "typescript";

const write = process.argv.includes("--write");
const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
// 🪤 (?<![\w-]) — ไม่ให้ min-h-[44px] / sm:min-h-0 ถูกนับเป็นปุ่มขนาดตายตัว (h-0 / h-8)
const SKIP = /\b(w-full|flex-1|py-2\.5|py-3|text-base|absolute|rounded-full|grid)\b|(?<![\w-])(h|w)-\d+\b/;
const KEEP = /^(-?m[trblxy]?-\S+|ml-auto|shrink-0|self-\S+|col-span-\S+|order-\S+)$/;

let total = 0;
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  const report = [];
  const visit = (n) => {
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText(sf) === "button") {
      const attrs = n.openingElement.attributes.properties;
      const cls = attrs.find((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === "className");
      const v = cls && ts.isJsxAttribute(cls) ? cls.initializer : null;
      if (v && ts.isStringLiteral(v)) {
        const c = v.text;
        let tone = null;
        if (/\bbg-brand\b/.test(c) && /\btext-on-brand\b/.test(c)) tone = "primary";
        else if (/\bborder-crit-line\b/.test(c) && /\btext-crit\b/.test(c) && !/\bbg-crit\b/.test(c)) tone = "danger";
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        if (tone && !SKIP.test(c)) {
          const size = /\btext-xs\b/.test(c) ? "sm" : "md";
          const keep = c.split(/\s+/).filter((t) => KEEP.test(t));
          // 🚨 <Button> ตั้ง type="button" เป็นค่าปริยาย — ปุ่มเดิมที่ไม่มี type ในฟอร์ม = submit ⇒ ต้องใส่ให้ ไม่งั้นกดแล้วฟอร์มไม่ส่ง
          const hasType = attrs.some((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === "type");
          let inForm = false;
          for (let p = n.parent; p; p = p.parent) {
            if (ts.isJsxElement(p) && p.openingElement.tagName.getText(sf) === "form") { inForm = true; break; }
          }
          const submit = !hasType && inForm ? ' type="submit"' : "";
          const repl = `tone="${tone}"${size === "sm" ? ' size="sm"' : ""}${submit}${keep.length ? ` className="${keep.join(" ")}"` : ""}`;
          const tagName = n.openingElement.tagName;
          edits.push([tagName.getStart(sf), tagName.getEnd(), "Button"]);
          edits.push([cls.getStart(sf), cls.getEnd(), repl]);
          const ct = n.closingElement.tagName;
          edits.push([ct.getStart(sf), ct.getEnd(), "Button"]);
          report.push(`  ✓ ${line}: ${tone}/${size}${submit ? " (submit)" : ""}  [${c}]`);
        } else if (tone) {
          report.push(`  · ${line}: ข้าม (ขนาด/ตำแหน่งพิเศษ)  [${c}]`);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const changed = edits.length / 3;
  if (!report.length) continue;
  console.log(`${file}  (${changed} ปุ่ม)`);
  for (const r of report) console.log(r);
  total += changed;
  if (write && changed) {
    let out = src;
    for (const [s, e, t] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + t + out.slice(e);
    if (!/import \{[^}]*\bButton\b[^}]*\} from "@\/lib\/shared\/page"/.test(out)) {
      const m = out.match(/import \{([^}]*)\} from "@\/lib\/shared\/page";/);
      if (m) out = out.replace(m[0], `import {${m[1].replace(/\s*$/, "")}, Button } from "@/lib/shared/page";`);
      else {
        // ใส่ต่อจาก import บรรทัดสุดท้ายของหัวไฟล์
        const imports = [...out.matchAll(/^import [^;]+;\r?\n/gm)];
        const last = imports[imports.length - 1];
        const at = last.index + last[0].length;
        out = out.slice(0, at) + `import { Button } from "@/lib/shared/page";\n` + out.slice(at);
      }
    }
    fs.writeFileSync(file, out);
  }
}
console.log(`\nรวม ${total} ปุ่ม${write ? " (เขียนไฟล์แล้ว)" : " (ยังไม่เขียน — ใส่ --write)"}`);
