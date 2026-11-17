import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * D173 — ตัวอักษรต้องอ่านออกบนทุกพื้นผิว ทั้งโหมดสว่างและโหมดมืด
 *
 * ที่มา: ผู้ใช้แจ้งว่าโหมดมืด "ตัวอักษรจม" · วัดแล้ว `text-faint` ได้ 3.64:1 (มืด) / 3.07:1 (สว่าง)
 * ต่ำกว่าเกณฑ์อ่านง่าย 4.5:1 (WCAG AA) และใช้อยู่เกือบ 500 จุด
 *
 * เทสนี้อ่านค่าสีจริงจาก `app/globals.css` แล้วคิดคอนทราสต์ทุกคู่ที่ใช้จริง
 * → ใครปรับสี token แล้วทำให้จางลง เทสแดงทันที (build/lint มองไม่เห็นเรื่องนี้)
 */
const css = fs.readFileSync(path.join(__dirname, "../../app/globals.css"), "utf8");

function block(startMarker: string): string {
  const i = css.indexOf(startMarker);
  if (i < 0) throw new Error(`ไม่พบ ${startMarker} ใน globals.css`);
  return css.slice(i, css.indexOf("\n}", i));
}
function tokens(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2];
  return out;
}
const light = tokens(block("@theme {"));
const dark = { ...light, ...tokens(block('[data-mode="dark"] {')) };

function lum(hex: string): number {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a: string, b: string): number {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const SURFACES = ["page", "card", "nav", "input", "raised"];
const TEXT = ["ink", "muted", "faint"];
const STATUS = ["ok", "warn", "crit"];
const AA = 4.5;

describe("คอนทราสต์ของตัวอักษร (D173)", () => {
  it("อ่าน token จาก globals.css ได้ครบ (กันเทสกลายเป็นเทสเปล่าเมื่อไฟล์เปลี่ยนรูปแบบ)", () => {
    for (const t of [...SURFACES, ...TEXT, ...STATUS, "ok-bg", "warn-bg", "crit-bg"]) {
      expect(light[t], `สว่าง --color-${t}`).toMatch(/^#/);
      expect(dark[t], `มืด --color-${t}`).toMatch(/^#/);
    }
    // โหมดมืดต้องเป็นค่าคนละชุดจริง ไม่ใช่อ่านบล็อกเดิมซ้ำ
    expect(dark.page).not.toBe(light.page);
    expect(dark.faint).not.toBe(light.faint);
  });

  for (const [mode, t] of [["สว่าง", light], ["มืด", dark]] as const) {
    for (const text of TEXT) {
      for (const bg of SURFACES) {
        it(`${mode}: text-${text} บน bg-${bg} ≥ ${AA}:1`, () => {
          expect(contrast(t[text], t[bg])).toBeGreaterThanOrEqual(AA);
        });
      }
    }
    for (const s of STATUS) {
      it(`${mode}: text-${s} บนพื้นสถานะของตัวเอง และบนการ์ด ≥ ${AA}:1`, () => {
        expect(contrast(t[s], t[`${s}-bg`])).toBeGreaterThanOrEqual(AA);
        expect(contrast(t[s], t.card)).toBeGreaterThanOrEqual(AA);
      });
    }
    it(`${mode}: ลำดับความเข้ม ink > muted > faint ยังอยู่ (สามระดับต้องแยกจากกันได้)`, () => {
      const c = (k: string) => contrast(t[k], t.card);
      expect(c("ink")).toBeGreaterThan(c("muted") + 1);
      expect(c("muted")).toBeGreaterThan(c("faint") + 1);
    });
  }

  it("ประกาศ color-scheme ทั้งสองโหมด — ของที่เบราว์เซอร์วาดเอง (ปฏิทิน · รายการ select · แถบเลื่อน) ต้องตามโหมด", () => {
    expect(block('[data-mode="dark"] {')).toMatch(/color-scheme:\s*dark/);
    expect(css).toMatch(/html\s*\{[^}]*color-scheme:\s*light/);
  });

  it("ข้อความตัวอย่างในช่องกรอกใช้ token ไม่ใช่ความโปร่งใสของสีตัวอักษร", () => {
    expect(css).toMatch(/::placeholder\s*\{[^}]*var\(--color-faint\)[^}]*opacity:\s*1/);
  });
});
