/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * lib/pdf/excise — เติมฟอร์มสรรพสามิต ภส.๐๗ ลง PDF template (กลไก A: coordinate overlay)
 * port verbatim จาก production/_js_reports.html — ⚠️ ห้ามแก้พิกัด/ชื่อ field/ขนาดฟอนต์
 *   ต่างจากเดิมแค่: ใช้ pdf-lib จาก npm (แทน global PDFLib/fontkit) + รับ template/font เป็น bytes
 * template/font โหลดจาก Supabase Storage (getPdfAsset signed URL) ฝั่ง caller
 */
import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export type ExciseKind = "0701" | "0702_1" | "0702_2" | "0704";

/** path ใน bucket pdf-templates (ตรงกับ scripts/upload-pdf-templates.ts) */
export const EXCISE_TEMPLATE_KEY: Record<ExciseKind, string> = {
  "0701": "excise/pso_07-01_1.pdf",
  "0702_1": "excise/pso_07-02_1.pdf",
  "0702_2": "excise/pso_07-02_12.pdf",
  "0704": "excise/pso_07-04_1.pdf",
};
// THSARABUN.TTF = เลขอารบิก (123) · ถ้าอยากได้เลขไทย (๑๒๓) เปลี่ยนเป็น fonts/THSARABUNIT9.TTF
export { FONT_KEY } from "./keys";

// ── helpers (verbatim) ────────────────────────────────────────────────────────
function rfFmt(v: any): string {
  const n = parseFloat(v);
  if (isNaN(n)) return String(v);
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}
function rfDrawCheck(page: PDFPage, x: number, y: number, size?: number) {
  const s = size || 8;
  const col = rgb(0, 0, 0);
  page.drawLine({ start: { x: x - s * 0.45, y: y + s * 0.1 }, end: { x: x - s * 0.1, y: y - s * 0.3 }, thickness: 1.2, color: col });
  page.drawLine({ start: { x: x - s * 0.1, y: y - s * 0.3 }, end: { x: x + s * 0.55, y: y + s * 0.55 }, thickness: 1.2, color: col });
}
function rfLerp(a: number, b: number, i: number, n: number) {
  return n <= 1 ? a : a + ((b - a) * i) / (n - 1);
}

async function loadDoc(templateBytes: Uint8Array, fontBytes: Uint8Array) {
  const tplDoc = await PDFDocument.load(templateBytes);
  const outDoc = await PDFDocument.create();
  outDoc.registerFontkit(fontkit);
  const f = await outDoc.embedFont(fontBytes);
  return { tplDoc, outDoc, f };
}

// ── ฟอร์มรายวัน (๐๗-๐๑/๑ วัตถุดิบ, ๐๗-๐๒/๑(๒) สุราขวด) ────────────────────────────
async function fillDailyForm(cfg: any, data: any, templateBytes: Uint8Array, fontBytes: Uint8Array) {
  const { tplDoc, outDoc, f } = await loadDoc(templateBytes, fontBytes);
  const S = cfg.size || 8.5;

  const records = data.grid.filter((r: any) => (r.desc && r.desc !== "") || r.inv != null || r.outv != null);
  const per = cfg.rowsPerPage;
  const pages: any[][] = [];
  for (let i = 0; i < records.length; i += per) pages.push(records.slice(i, i + per));
  if (pages.length === 0) pages.push([]);

  for (let pi = 0; pi < pages.length; pi++) {
    const [page] = await outDoc.copyPages(tplDoc, [0]);
    outDoc.addPage(page);
    const txt = (s: any, x: number, y: number, sz?: number) => { if (s === "" || s == null) return; page.drawText(String(s), { x, y, size: sz || S, font: f }); };
    const right = (v: any, xr: number, y: number, sz?: number) => { if (v == null || v === "") return; const s = rfFmt(v); const w = f.widthOfTextAtSize(s, sz || S); page.drawText(s, { x: xr - w, y, size: sz || S, font: f }); };
    const rightText = (s: any, xr: number, y: number, sz?: number) => { if (s === "" || s == null) return; const w = f.widthOfTextAtSize(String(s), sz || S); page.drawText(String(s), { x: xr - w, y, size: sz || S, font: f }); };
    const center = (s: any, xc: number, y: number, sz?: number) => { if (s === "" || s == null) return; const w = f.widthOfTextAtSize(String(s), sz || S); page.drawText(String(s), { x: xc - w / 2, y, size: sz || S, font: f }); };
    const drawCol = (col: any, val: any, y: number) => {
      if (!col) return;
      let s: string;
      if (col.align === "R") { const empty = col.keepZero ? val == null || val === "" : !val; s = empty ? "-" : rfFmt(val); }
      else s = val == null || val === "" ? "-" : String(val);
      if (col.align === "C") center(s, col.x, y, col.size);
      else if (col.align === "R") rightText(s, col.x, y, col.size);
      else txt(s, col.x, y, col.size);
    };

    if (cfg.header) cfg.header.forEach((h: any) => {
      const v = typeof h.text === "function" ? h.text(data) : h.text;
      if (h.align === "R") right(v, h.x, h.y, h.size); else if (h.align === "C") center(v, h.x, h.y, h.size); else txt(v, h.x, h.y, h.size);
    });
    if (cfg.reg && data.exciseId) {
      const digits = String(data.exciseId).replace(/\D/g, "");
      let idx = 0;
      cfg.reg.groups.forEach((g: any) => {
        for (let i = 0; i < g.count; i++, idx++) {
          if (idx >= digits.length) continue;
          const x = g.count > 1 ? g.xFirst + (g.xLast - g.xFirst) * (i / (g.count - 1)) : g.xFirst;
          center(digits[idx], x, cfg.reg.y, 9);
        }
      });
    }
    if (cfg.checkbox) rfDrawCheck(page, cfg.checkbox.x, cfg.checkbox.y);
    if (pi === 0 && cfg.bf) right(data.bfBalance, cfg.bf.x, cfg.bf.y, cfg.bf.size);

    pages[pi].forEach((r: any, k: number) => {
      const y = cfg.rowFirst + (cfg.rowLast - cfg.rowFirst) * (per > 1 ? k / (per - 1) : 0);
      drawCol(cfg.cols.day, r.date, y);
      drawCol(cfg.cols.desc, r.desc, y);
      drawCol(cfg.cols.ref, r.ref, y);
      drawCol(cfg.cols.inv, r.inv, y);
      drawCol(cfg.cols.outv, r.outv, y);
      drawCol(cfg.cols.bal, r.bal, y);
    });

    if (pi === pages.length - 1 && cfg.totals) {
      if (cfg.cols.inv) { right(data.monthIn, cfg.cols.inv.x, cfg.totals.monthY, S); right(data.yearIn, cfg.cols.inv.x, cfg.totals.yearY, S); }
      if (cfg.cols.outv) { right(data.monthOut, cfg.cols.outv.x, cfg.totals.monthY, S); right(data.yearOut, cfg.cols.outv.x, cfg.totals.yearY, S); }
    }
  }
  return outDoc.save();
}

// ── งบเดือน ๐๗-๐๔/๑ (เมทริกซ์ 2 ตาราง) ────────────────────────────────────────────
async function fillSummaryForm(cfg: any, data: any, templateBytes: Uint8Array, fontBytes: Uint8Array) {
  const { tplDoc, outDoc, f } = await loadDoc(templateBytes, fontBytes);
  const S = cfg.size || 8;
  const cpp = cfg.colsPerPage;
  const totalPages = Math.max(1, Math.ceil(data.materials.length / cpp), Math.ceil(data.products.length / cpp));

  for (let pg = 0; pg < totalPages; pg++) {
    const [page] = await outDoc.copyPages(tplDoc, [0]);
    outDoc.addPage(page);
    const txt = (s: any, x: number, y: number, sz?: number) => { if (s === "" || s == null) return; page.drawText(String(s), { x, y, size: sz || S, font: f }); };
    const center = (s: any, xc: number, y: number, sz?: number) => { if (s === "" || s == null) return; const w = f.widthOfTextAtSize(String(s), sz || S); page.drawText(String(s), { x: xc - w / 2, y, size: sz || S, font: f }); };
    const cell = (v: any, xc: number, y: number) => { center(!v ? "-" : rfFmt(v), xc, y, S); };

    if (cfg.header) cfg.header.forEach((h: any) => { const v = typeof h.text === "function" ? h.text(data) : h.text; txt(v, h.x, h.y, h.size); });
    if (cfg.reg && data.exciseId) {
      const digits = String(data.exciseId).replace(/\D/g, ""); let idx = 0;
      cfg.reg.groups.forEach((g: any) => { for (let i = 0; i < g.count; i++, idx++) { if (idx >= digits.length) continue; const x = g.count > 1 ? g.xFirst + (g.xLast - g.xFirst) * (i / (g.count - 1)) : g.xFirst; center(digits[idx], x, cfg.reg.y, 9); } });
    }
    if (cfg.checkbox) rfDrawCheck(page, cfg.checkbox.x, cfg.checkbox.y);

    const colX = cfg.colX;
    data.materials.slice(pg * cpp, (pg + 1) * cpp).forEach((m: any, c: number) => {
      const nx = rfLerp(cfg.mat.nameX1, cfg.mat.nameX6, c, cpp);
      txt(m.name, nx, cfg.mat.nameY, S);
      txt(m.unit, nx, cfg.mat.unitY, S);
      const xc = colX[c];
      [m.bf, m.inv, m.total, m.outMain, m.outOther, m.damage, m.misc, m.balance].forEach((v: any, k: number) => cell(v, xc, rfLerp(cfg.mat.rowY1, cfg.mat.rowY8, k, 8)));
    });
    data.products.slice(pg * cpp, (pg + 1) * cpp).forEach((p: any, c: number) => {
      const nx = rfLerp(cfg.prod.nameX1, cfg.prod.nameX6, c, cpp);
      txt(p.name, nx, cfg.prod.nameY, S);
      txt(p.degree, rfLerp(cfg.prod.degX1, cfg.prod.degX6, c, cpp), cfg.prod.degY, S);
      txt(p.size, rfLerp(cfg.prod.sizeX1, cfg.prod.sizeX6, c, cpp), cfg.prod.degY, S);
      txt(p.unit, rfLerp(cfg.prod.unitX1, cfg.prod.unitX6, c, cpp), cfg.prod.unitY, S);
      const xc = colX[c];
      [p.bf, p.inv, p.total, p.outLocal, p.outExport, p.damage, p.misc, p.balance].forEach((v: any, k: number) => cell(v, xc, rfLerp(cfg.prod.rowY1, cfg.prod.rowY8, k, 8)));
    });
  }
  return outDoc.save();
}

// ── ฟอร์มผลิตสุรา ๐๗-๐๒/๑(๑) (landscape 19 คอลัมน์) ────────────────────────────────
async function fillProductionForm(cfg: any, data: any, templateBytes: Uint8Array, fontBytes: Uint8Array) {
  const { tplDoc, outDoc, f } = await loadDoc(templateBytes, fontBytes);
  const S = cfg.size || 7.5;
  const per = cfg.rowsPerPage;
  const pages: any[][] = [];
  for (let i = 0; i < data.grid.length; i += per) pages.push(data.grid.slice(i, i + per));
  if (pages.length === 0) pages.push([]);

  for (let pi = 0; pi < pages.length; pi++) {
    const [page] = await outDoc.copyPages(tplDoc, [0]);
    outDoc.addPage(page);
    const txt = (s: any, x: number, y: number, sz?: number) => { if (s === "" || s == null) return; page.drawText(String(s), { x, y, size: sz || S, font: f }); };
    const right = (v: any, xr: number, y: number, sz?: number) => { if (v == null || v === "") return; const s = rfFmt(v); const w = f.widthOfTextAtSize(s, sz || S); page.drawText(s, { x: xr - w, y, size: sz || S, font: f }); };
    const rightText = (s: any, xr: number, y: number, sz?: number) => { if (s === "" || s == null) return; const w = f.widthOfTextAtSize(String(s), sz || S); page.drawText(String(s), { x: xr - w, y, size: sz || S, font: f }); };
    const center = (s: any, xc: number, y: number, sz?: number) => { if (s === "" || s == null) return; const w = f.widthOfTextAtSize(String(s), sz || S); page.drawText(String(s), { x: xc - w / 2, y, size: sz || S, font: f }); };
    const drawCol = (col: any, val: any, y: number) => {
      if (!col) return;
      let s: string;
      if (col.align === "R") { const empty = col.keepZero ? val == null || val === "" : !val; s = empty ? "-" : rfFmt(val); }
      else if (col.align === "RT") s = val == null || val === "" ? "-" : String(val);
      else s = val == null || val === "" ? "-" : String(val);
      if (col.align === "C") center(s, col.x, y, col.size);
      else if (col.align === "R" || col.align === "RT") rightText(s, col.x, y, col.size);
      else txt(s, col.x, y, col.size);
    };

    if (cfg.header) cfg.header.forEach((h: any) => {
      const v = typeof h.text === "function" ? h.text(data) : h.text;
      if (h.align === "R") right(v, h.x, h.y, h.size); else if (h.align === "C") center(v, h.x, h.y, h.size); else txt(v, h.x, h.y, h.size);
    });
    if (cfg.reg && data.exciseId) {
      const digits = String(data.exciseId).replace(/\D/g, "");
      let idx = 0;
      cfg.reg.groups.forEach((g: any) => {
        for (let i = 0; i < g.count; i++, idx++) {
          if (idx >= digits.length) continue;
          const x = g.count > 1 ? g.xFirst + (g.xLast - g.xFirst) * (i / (g.count - 1)) : g.xFirst;
          center(digits[idx], x, cfg.reg.y, 9);
        }
      });
    }
    if (cfg.checkbox) rfDrawCheck(page, cfg.checkbox.x, cfg.checkbox.y);
    if (cfg.degreeLabel && data.degree != null && data.degree !== "") txt(data.degree, cfg.degreeLabel.x, cfg.degreeLabel.y, cfg.degreeLabel.size || S);

    if (pi === 0 && cfg.bf) {
      right(data.bfSaa, cfg.bf.saa.x, cfg.bf.saa.y, S);
      right(data.bfDistill, cfg.bf.dist.x, cfg.bf.dist.y, S);
      right(data.bfDilute, cfg.bf.dilu.x, cfg.bf.dilu.y, S);
    }

    const C = cfg.cols;
    pages[pi].forEach((r: any, k: number) => {
      const y = cfg.rowFirst + (cfg.rowLast - cfg.rowFirst) * (per > 1 ? k / (per - 1) : 0);
      drawCol(C.day, r.date, y); drawCol(C.fermBatch, r.fermBatch, y); drawCol(C.fermQty, r.fermQty, y);
      drawCol(C.avgFermVol, r.avgFermVol, y); drawCol(C.fermSaa, r.fermSaa, y); drawCol(C.distBatch, r.distBatch, y);
      drawCol(C.distFermQty, r.distFermQty, y); drawCol(C.avgDistFermVol, r.avgDistFermVol, y); drawCol(C.distSaa, r.distSaa, y);
      drawCol(C.curSaa, r.curSaa, y); drawCol(C.avgAbv, r.avgAbv, y); drawCol(C.distVol, r.distVol, y);
      drawCol(C.diluStartVol, r.diluStartVol, y); drawCol(C.curDist, r.curDist, y); drawCol(C.packSize, r.packSize, y);
      drawCol(C.packQty, r.packQty, y); drawCol(C.packVol, r.packVol, y); drawCol(C.curDilu, r.curDilu, y); drawCol(C.note, r.note, y);
    });

    if (pi === pages.length - 1 && cfg.totals) {
      (cfg.totals.month || []).forEach((t: any) => right(data[t.key], t.x, t.y, S));
      (cfg.totals.year || []).forEach((t: any) => right(data[t.key], t.x, t.y, S));
    }
  }
  return outDoc.save();
}

// ── cfg แต่ละฟอร์ม (พิกัด verbatim จาก _js_reports.html) ──────────────────────────
const CFG_0701: any = {
  size: 8.5, rowsPerPage: 31, rowFirst: 620, rowLast: 213,
  header: [
    { text: (d: any) => d.company, x: 96.7, y: 702.1, align: "L" },
    { text: (d: any) => d.materialName, x: 91.7, y: 682.1, align: "L" },
    { text: (d: any) => d.liquorType, x: 216.7, y: 682.1, align: "L" },
    { text: (d: any) => d.monthThai, x: 351.7, y: 682.1, align: "L" },
    { text: (d: any) => d.unit, x: 455.7, y: 682.1, align: "L" },
  ],
  reg: { groups: [{ xFirst: 249.7, xLast: 338.7, count: 13 }, { xFirst: 347.7, xLast: 347.7, count: 1 }, { xFirst: 357.7, xLast: 372.7, count: 3 }], y: 702.1 },
  checkbox: { x: 385.7, y: 703.1 },
  bf: { x: 463, y: 634 },
  cols: { day: { x: 50, align: "C" }, desc: { x: 74, align: "L" }, ref: { x: 238, align: "L" }, inv: { x: 360, align: "R" }, outv: { x: 411, align: "R" }, bal: { x: 463, align: "R", keepZero: true } },
  totals: { monthY: 197, yearY: 183 },
};

const CFG_0702_2: any = {
  size: 8.5, rowsPerPage: 23, rowFirst: 633.8, rowLast: 339.8,
  header: [
    { text: (d: any) => d.company, x: 92.7, y: 716.1, align: "L" },
    { text: (d: any) => d.productName, x: 64.7, y: 702.1, align: "L" },
    { text: (d: any) => d.liquorType, x: 189.7, y: 702.1, align: "L" },
    { text: (d: any) => d.liquorKind, x: 270.7, y: 702.1, align: "L" },
    { text: (d: any) => d.degree, x: 375.7, y: 702.1, align: "L" },
    { text: (d: any) => d.bottleSize, x: 443.7, y: 702.1, align: "L" },
    { text: (d: any) => d.unit, x: 517.7, y: 702.1, align: "L" },
    { text: (d: any) => d.monthThai, x: 80.7, y: 690.1, align: "L" },
  ],
  reg: { groups: [{ xFirst: 258.7, xLast: 343.7, count: 13 }, { xFirst: 351.7, xLast: 351.7, count: 1 }, { xFirst: 360.7, xLast: 374.7, count: 3 }], y: 715.1 },
  checkbox: { x: 392.7, y: 717.1 },
  bf: { x: 496.7, y: 646.8 },
  cols: { day: { x: 51.7, align: "C" }, desc: { x: 83.7, align: "L" }, ref: { x: 245.7, align: "L" }, inv: { x: 365.7, align: "R" }, outv: { x: 430.7, align: "R" }, bal: { x: 495.7, align: "R", keepZero: true } },
  totals: { monthY: 327.5, yearY: 313.5 },
};

const CFG_0704: any = {
  size: 8, colsPerPage: 6, colX: [210.7, 321.7, 432.7, 546.7, 657.7, 767.7],
  header: [
    { text: (d: any) => d.company, x: 78.7, y: 471.5 },
    { text: (d: any) => d.liquorType, x: 62.7, y: 455.5 },
    { text: (d: any) => d.liquorKind, x: 192.7, y: 455.5 },
    { text: (d: any) => d.monthThai, x: 348.7, y: 455.5 },
  ],
  reg: { groups: [{ xFirst: 230.7, xLast: 310.7, count: 13 }, { xFirst: 318.7, xLast: 318.7, count: 1 }, { xFirst: 328.7, xLast: 341.7, count: 3 }], y: 471.5 },
  checkbox: { x: 357.7, y: 472.5 },
  mat: { nameX1: 206.7, nameX6: 759.7, nameY: 422.5, unitY: 413.5, rowY1: 390.9, rowY8: 291.5 },
  prod: { nameX1: 190.7, nameX6: 749.7, nameY: 255.5, degX1: 163.7, degX6: 721.7, sizeX1: 222.7, sizeX6: 783.7, degY: 245.5, unitX1: 204.7, unitX6: 762.7, unitY: 236.5, rowY1: 213.5, rowY8: 114.5 },
};

const CFG_0702_1: any = {
  size: 7.5, rowsPerPage: 13, rowFirst: 372.5, rowLast: 222.5,
  header: [
    { text: (d: any) => d.company, x: 86.7, y: 480.5, align: "L" },
    { text: (d: any) => d.productName, x: 57.7, y: 466.5, align: "L" },
    { text: (d: any) => d.liquorType, x: 285.7, y: 466.5, align: "L" },
    { text: (d: any) => d.monthThai, x: 442.7, y: 466.5, align: "L" },
  ],
  reg: { groups: [{ xFirst: 289.7, xLast: 370.7, count: 13 }, { xFirst: 379.7, xLast: 379.7, count: 1 }, { xFirst: 388.7, xLast: 401.7, count: 3 }], y: 478.5 },
  checkbox: { x: 418.7, y: 479.5 },
  degreeLabel: { x: 605.7, y: 409.5, size: 8 },
  bf: { saa: { x: 429.7, y: 385.2 }, dist: { x: 564.7, y: 385.2 }, dilu: { x: 750.7, y: 384.5 } },
  cols: {
    day: { x: 35.7, align: "C", size: 6.5 }, fermBatch: { x: 73.7, align: "C" }, fermQty: { x: 131.7, align: "R" },
    avgFermVol: { x: 182.7, align: "R" }, fermSaa: { x: 222.7, align: "R" }, distBatch: { x: 249.7, align: "C" },
    distFermQty: { x: 304.7, align: "R" }, avgDistFermVol: { x: 346.7, align: "R" }, distSaa: { x: 379.7, align: "R" },
    curSaa: { x: 430.7, align: "R", keepZero: true }, avgAbv: { x: 451.7, align: "R" }, distVol: { x: 483.7, align: "R" },
    diluStartVol: { x: 527.7, align: "R" }, curDist: { x: 565.7, align: "R", keepZero: true }, packSize: { x: 598.7, align: "RT" },
    packQty: { x: 624.7, align: "R" }, packVol: { x: 710.7, align: "R" }, curDilu: { x: 751.7, align: "R", keepZero: true }, note: { x: 758.7, align: "L", size: 6.5 },
  },
  totals: {
    month: [
      { key: "monthFermSaa", x: 223.7, y: 209.5 }, { key: "monthDistSaa", x: 380.7, y: 210.5 }, { key: "endSaa", x: 431.7, y: 210.5 },
      { key: "monthDiluStart", x: 527.7, y: 210.5 }, { key: "endDist", x: 565.7, y: 210.5 }, { key: "monthPackVol", x: 710.7, y: 210.9 }, { key: "endDilu", x: 751.7, y: 211.2 },
    ],
    year: [
      { key: "yearFermSaa", x: 222.7, y: 198.2 }, { key: "yearDistSaa", x: 380.7, y: 199.2 }, { key: "yearDiluStart", x: 526.7, y: 198.9 }, { key: "yearPackVol", x: 710.7, y: 198.9 },
    ],
  },
};

/** สร้าง PDF ฟอร์ม ภส. → Uint8Array (caller โหลด template/font bytes มาให้) */
export async function fillExciseForm(
  kind: ExciseKind,
  data: any,
  templateBytes: Uint8Array,
  fontBytes: Uint8Array,
): Promise<Uint8Array> {
  if (kind === "0701") return fillDailyForm(CFG_0701, data, templateBytes, fontBytes);
  if (kind === "0702_2") return fillDailyForm(CFG_0702_2, data, templateBytes, fontBytes);
  if (kind === "0704") return fillSummaryForm(CFG_0704, data, templateBytes, fontBytes);
  if (kind === "0702_1") return fillProductionForm(CFG_0702_1, data, templateBytes, fontBytes);
  throw new Error("ชนิดรายงานไม่ถูกต้อง: " + kind);
}
