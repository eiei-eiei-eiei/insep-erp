import type { PayLineItem } from "./types";
import type { FilingEntity } from "./filingHtml";
import { branchLabel } from "../sales/company";
import { showToast } from "../shared/toast";
import { mountDocViewer, viewerHead } from "../shared/docViewer";

/**
 * lib/payroll/slip — สลิปเงินเดือน (HTML → หน้าต่างเอกสาร: พิมพ์ · คัดลอกเป็นภาพ · แชร์)
 *
 * ★ จงใจ **ไม่** ไปใช้ `app/(app)/sales/_components/print.ts` ร่วมกัน:
 *   ไฟล์นั้นคุมหน้าตาใบกำกับภาษี/ใบเสร็จที่ลูกค้าเทียบกับของเดิมทีละบรรทัดมาแล้ว
 *   แตะเพื่อ "ใช้ร่วมกัน" = เสี่ยงทำเอกสารการค้าขยับโดยไม่ได้ตั้งใจ ซึ่งแลกไม่คุ้ม
 *   ★ แต่ **แถบปุ่มของหน้าต่างเอกสาร** ใช้ `lib/shared/docViewer.ts` ตัวเดียวกับขาย/บาร์ (D106 · ห้ามก๊อป)
 *
 * 🚨 ดำบนขาวเสมอ ห้ามผูกกับ token ธีมของแอป (บทเรียน D43): เปิดโหมดมืดแล้วสั่งพิมพ์
 *    จะได้กระดาษพื้นดำ
 *
 * 🚨 หัวสลิปมาจากตาราง `entities` ของกิจการที่งวดนั้นสังกัด (`slipCompany`) —
 *    เดิมพิมพ์ `payroll_entity` (รหัสกิจการ เช่น "EID01") แทนชื่อบริษัท
 */

export type SlipData = {
  companyName: string;
  /** "(สำนักงานใหญ่) 5/15 ม.8 …" */
  companyAddress?: string;
  /** "เลขประจำตัวผู้เสียภาษี 0105…" */
  companyTaxLine?: string;
  periodLabel: string;   // "05/2026"
  payDate?: string;
  empName: string;
  empId: string;
  groupLabel?: string;
  baseLabel: string;     // "เงินเดือน (28 วัน)"
  baseAmount: number;
  items: PayLineItem[];
  sso: number;
  wht: number;
  gross: number;
  net: number;
};

export type SlipCompany = Pick<SlipData, "companyName" | "companyAddress" | "companyTaxLine">;

/** อ่านข้อมูลกิจการไม่สำเร็จ — ห้ามพิมพ์สลิปหัวเปล่า */
export const SLIP_ENTITY_READ_ERROR = "อ่านข้อมูลกิจการไม่สำเร็จ — โหลดงวดใหม่แล้วลองอีกครั้ง";
/** กิจการยังไม่มีชื่อ — บอกว่าไปตั้งที่ไหน */
export const SLIP_ENTITY_NO_NAME = "ยังไม่ได้ตั้งชื่อกิจการ — ไปกรอกที่ ตั้งค่า → กิจการ ก่อนพิมพ์สลิป";

/**
 * แถว entities → หัวสลิป · คืน `{ error }` เมื่อพิมพ์ไม่ได้ (บอกเหตุผลเสมอ)
 * 🚨 ห้าม fallback เป็นรหัสกิจการหรือคำว่า "บริษัท" — สลิปคือเอกสารที่พนักงานเอาไปยื่นกู้/ยื่นวีซ่า
 */
export function slipCompany(ent: FilingEntity | null | undefined): SlipCompany | { error: string } {
  if (!ent) return { error: SLIP_ENTITY_READ_ERROR };
  const name = (ent.name ?? "").trim();
  if (!name) return { error: SLIP_ENTITY_NO_NAME };
  const address = [branchLabel(ent.branch), (ent.address ?? "").trim()].filter(Boolean).join(" ");
  const taxId = (ent.taxId ?? "").trim();
  return {
    companyName: name,
    companyAddress: address || undefined,
    companyTaxLine: taxId ? `เลขประจำตัวผู้เสียภาษี ${taxId}` : undefined,
  };
}

/** ป้ายหน้า/ชื่อไฟล์ภาพ — "สลิปเงินเดือน สมชาย ใจดี" + เลขที่ "05/2026" → `สลิปเงินเดือน_สมชาย_ใจดี_05-2026.png` */
export function slipDocTitle(d: Pick<SlipData, "empName">): string {
  return `สลิปเงินเดือน ${d.empName}`.trim();
}

/** ชื่อหน้าต่าง — พิมพ์คนเดียวบอกชื่อคน · ทั้งงวดบอกจำนวน */
export function slipWindowTitle(slips: Pick<SlipData, "empName" | "periodLabel">[]): string {
  if (slips.length === 1) return `${slipDocTitle(slips[0])} งวด ${slips[0].periodLabel}`;
  return `สลิปเงินเดือน งวด ${slips[0]?.periodLabel ?? ""} (${slips.length} คน)`;
}

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SLIP_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&family=Kanit:wght@400;500&display=swap');
  * { box-sizing: border-box; }
  body { font-family: "Sarabun","TH Sarabun New",sans-serif; margin: 0; padding: 0;
         color: #000; background: #fff; font-size: 14px; }
  .slip { width: 190mm; margin: 0 auto 8mm; padding: 8mm; border-bottom: 1px dashed #999; }
  .slip:last-child { border-bottom: none; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .muted { color: #444; font-size: 12px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2px solid #000; padding-bottom: 4px; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 0; vertical-align: top; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .sec td { border-top: 1px solid #000; font-weight: 700; }
  .total td { border-top: 2px solid #000; border-bottom: 3px double #000;
              font-weight: 700; font-size: 16px; }
  .sign { margin-top: 14mm; display: flex; justify-content: space-between; }
  .sign div { width: 45%; text-align: center; border-top: 1px dotted #000; padding-top: 3px; font-size: 12px; }
  @page { size: A4; margin: 8mm; }
  @media print { .slip { page-break-after: always; } .slip:last-child { page-break-after: auto; } }
  /* 🪤 ตัวแสดงเอกสารห่อสลิปทีละใบเป็น .dv-sheet → ทุกใบกลายเป็น :last-child ของแผ่นตัวเอง
     กฎข้างบนจะคืนเป็น auto หมด = หลายคนพิมพ์ต่อกันในหน้าเดียว → ตัดหน้าที่ระดับแผ่นแทน */
  @media print { .dv-sheet { break-after: page; } .dv-sheet:last-child { break-after: auto; } }
`;

/**
 * แผ่นสลิปบนจอ — กว้างเท่า A4 แต่สูงตามเนื้อหา (สลิปยาวครึ่งหน้า · ภาพที่ส่ง LINE ไม่ต้องมีที่ว่างครึ่งรูป)
 * 🚨 อยู่ใน `@media screen` เท่านั้น — กระดาษที่พิมพ์ยังเป็น SLIP_CSS เดิมทุกบรรทัด (1 คน = 1 หน้า)
 */
export const SLIP_SHEET_CSS = `@media screen {
  .dv-sheet { width: 210mm; padding: 2mm 10mm 4mm; }
  .dv-sheet .slip { margin: 0; border-bottom: none; }
}`;

/** สลิป 1 ใบ — `data-doc-*` ให้ตัวแสดงเอกสารตั้งป้าย/ชื่อไฟล์ภาพ */
export function slipHtml(d: SlipData): string {
  const earn = d.items.filter((i) => i.kind === "earning");
  const ded = d.items.filter((i) => i.kind === "deduction");
  const row = (label: string, amount: number, cls = "") =>
    `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${money(amount)}</td></tr>`;

  return `
  <div class="slip" data-doc-title="${esc(slipDocTitle(d))}" data-doc-no="${esc(d.periodLabel)}">
    <div class="head">
      <div>
        <h1>${esc(d.companyName)}</h1>
        ${d.companyAddress ? `<div class="muted">${esc(d.companyAddress)}</div>` : ""}
        ${d.companyTaxLine ? `<div class="muted">${esc(d.companyTaxLine)}</div>` : ""}
      </div>
      <div style="text-align:right">
        <div style="font-weight:700">ใบแจ้งเงินเดือน</div>
        <div class="muted">งวด ${esc(d.periodLabel)}</div>
        ${d.payDate ? `<div class="muted">จ่ายวันที่ ${esc(d.payDate)}</div>` : ""}
      </div>
    </div>

    <table>
      <tr>
        <td><b>${esc(d.empName)}</b> <span class="muted">(${esc(d.empId)})</span></td>
        <td class="num muted">${esc(d.groupLabel ?? "")}</td>
      </tr>
    </table>

    <table style="margin-top:8px">
      ${row(d.baseLabel, d.baseAmount)}
      ${earn.map((i) => row(i.name, i.amount)).join("")}
      <tr class="sec"><td>รวมเงินได้</td><td class="num">${money(d.gross)}</td></tr>
      ${d.sso ? row("หัก ประกันสังคม", -d.sso) : ""}
      ${d.wht ? row("หัก ภาษี ณ ที่จ่าย", -d.wht) : ""}
      ${ded.map((i) => row("หัก " + i.name, -i.amount)).join("")}
      <tr class="total"><td>ยอดเงินสุทธิ</td><td class="num">${money(d.net)}</td></tr>
    </table>

    <div class="sign">
      <div>ผู้รับเงิน</div>
      <div>ผู้จ่ายเงิน</div>
    </div>
  </div>`;
}

/** เอกสารทั้งหน้า (ไม่รวมแถบปุ่ม — แถบติดตั้งทีหลังด้วย mountDocViewer) */
export function slipsDocument(slips: SlipData[]): string {
  return (
    `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>${esc(slipWindowTitle(slips))}</title>` +
    `<style>${SLIP_CSS}</style>${viewerHead(SLIP_SHEET_CSS, "width=860")}</head>` +
    `<body>${slips.map(slipHtml).join("")}</body></html>`
  );
}

/**
 * เปิดหน้าต่างสลิป (1 ใบ = 1 หน้ากระดาษ = 1 ภาพ) พร้อมแถบ พิมพ์ · คัดลอกเป็นภาพ · แชร์
 *
 * 🔄 ไม่เปิดหน้าพิมพ์เองแล้ว — เหมือนขาย (D105) / บาร์ (D106): คนที่จะส่ง LINE ไม่ต้องกดปิดหน้าพิมพ์ทุกครั้ง
 * 🪤 ต้องเรียกตรงจากการกดปุ่ม (ห้าม await อะไรก่อน `window.open`) ไม่งั้นเบราว์เซอร์บล็อก popup
 */
export function printSlips(slips: SlipData[]): void {
  const w = window.open("", "_blank", "width=900,height=1200");
  if (!w) {
    showToast({ ok: false, text: "เบราว์เซอร์บล็อกหน้าต่างสลิป — โปรดอนุญาต popup แล้วลองใหม่" });
    return;
  }
  w.document.open();
  w.document.write(slipsDocument(slips));
  w.document.close();
  // รอฟอนต์โหลดก่อนติดตั้งแถบ — ก่อนหน้านั้นภาพที่แปลงจะขาดฟอนต์
  let mounted = false;
  const ready = () => {
    if (mounted) return;
    mounted = true;
    mountDocViewer(
      w,
      () => {
        w.focus();
        w.print();
      },
      { pageSelector: ".slip" },
    );
    w.focus();
  };
  setTimeout(() => {
    const fonts = (w.document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) fonts.ready.then(ready).catch(ready);
    else ready();
  }, 300);
}

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
