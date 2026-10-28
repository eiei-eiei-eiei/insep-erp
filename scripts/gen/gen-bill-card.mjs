/**
 * สร้าง HTML ของการ์ดตรวจบิล (MCP App · D141) เป็นไฟล์เดียว
 *   lib/connector/card/billCard.ts + billCard.css + @modelcontextprotocol/ext-apps
 *   → lib/connector/card/billCard.generated.ts (export BILL_CARD_HTML)
 *
 * ★ ฝังทุกอย่างลง HTML — การ์ดไม่โหลดอะไรจากเว็บภายนอก (CSP ของ Claude ปิดทุก origin ปริยาย)
 * ★ แก้ billCard.ts / billCard.css แล้วต้องรันใหม่:  npm run gen:bill-card
 *   (lib/connector/cardBundle.test.ts ฟ้องถ้าไฟล์ที่ commit ไม่ตรงกับที่ build ได้)
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(ROOT, "lib/connector/card");
const OUT = path.join(DIR, "billCard.generated.ts");

export async function buildBillCardHtml() {
  const r = await build({
    entryPoints: [path.join(DIR, "billCard.ts")],
    bundle: true,
    format: "esm",
    target: "es2022",
    minify: true,
    write: false,
    legalComments: "none",
    logLevel: "silent",
  });
  // ★ กันปิดแท็ก script ก่อนเวลา (ข้อความใน bundle มี </script> ไม่ได้)
  const js = r.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const css = fs.readFileSync(path.join(DIR, "billCard.css"), "utf8").replace(/\r\n/g, "\n").trim();
  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>ตรวจบิล</title><style>${css}</style></head><body><div id="root"></div><script type="module">${js}</script></body></html>`;
}

export function moduleSource(html) {
  return (
    "// ⛔ สร้างอัตโนมัติด้วย `npm run gen:bill-card` (scripts/gen/gen-bill-card.mjs) — ห้ามแก้มือ\n" +
    "// ต้นฉบับ: lib/connector/card/billCard.ts + billCard.css\n" +
    `export const BILL_CARD_HTML = ${JSON.stringify(html)};\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = await buildBillCardHtml();
  fs.writeFileSync(OUT, moduleSource(html));
  console.log(`เขียน ${path.relative(ROOT, OUT)} (${Math.round(html.length / 1024)} KB)`);
}
